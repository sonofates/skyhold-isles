import * as THREE from 'three';
import type { ObjectPool } from '../core/pool.ts';
import type { EnemyType, QualityLevel } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { ENEMY_TYPES } from '../data/enemies.ts';
import { FROST_TINT_HEX, PALETTE_HEX } from '../data/palette.ts';
import type { EnemyEntity } from '../sim/entities.ts';
import { mergeColoredParts, type ColoredPart } from './geometryHelpers.ts';
import type { MaterialLibrary } from './materials.ts';

interface EnemyInstancedLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly flashAttr: THREE.InstancedBufferAttribute;
  readonly flashArray: Float32Array;
}

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _barPos = new THREE.Vector3();
const _white = new THREE.Color(0xffffff);
const _frostTint = new THREE.Color(FROST_TINT_HEX);
const _hpGreen = new THREE.Color(PALETTE_HEX.grass);
const _hpGold = new THREE.Color(PALETTE_HEX.gold);
const _hpCoral = new THREE.Color(PALETTE_HEX.coral);

/** Creates a unit chamfered low-poly block roughly fitting [-0.5..0.5]^3 for figurine silhouettes. */
function createChamferedBoxGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const h = 0.42;
  const c = 0.08;
  s.moveTo(-h + c, -h);
  s.lineTo(h - c, -h);
  s.lineTo(h, -h + c);
  s.lineTo(h, h - c);
  s.lineTo(h - c, h);
  s.lineTo(-h + c, h);
  s.lineTo(-h, h - c);
  s.lineTo(-h, -h + c);
  s.closePath();

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.84,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geo.center();
  return geo;
}

/** Creates a swept pointed wing membrane pointing along +X (mirror with scaleX = -1). */
function createWingGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.08);
  s.lineTo(0.45, 0.16);
  s.lineTo(0.88, 0.02);
  s.lineTo(0.66, -0.18);
  s.lineTo(0.36, -0.12);
  s.lineTo(0.14, -0.2);
  s.closePath();

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.035,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geo.rotateX(Math.PI / 2);
  return geo;
}

function addEyes(
  parts: ColoredPart[],
  eyeGeo: THREE.BufferGeometry,
  y: number,
  z: number,
  spread: number,
  radius: number,
  colorHex: number,
): void {
  parts.push(
    { geometry: eyeGeo, colorHex, position: [-spread, y, z], scale: [radius, radius, radius * 0.7] },
    { geometry: eyeGeo, colorHex, position: [spread, y, z], scale: [radius, radius, radius * 0.7] },
  );
}

export class EnemyRenderer {
  readonly group = new THREE.Group();
  private layers = new Map<EnemyType, EnemyInstancedLayer>();
  private geometries: THREE.BufferGeometry[] = [];

  private hpBarMesh: THREE.InstancedMesh;
  private hpRatioAttr: THREE.InstancedBufferAttribute;
  private hpRatioArray: Float32Array;
  private shadowDecalMesh: THREE.InstancedMesh;
  private groundDecalsEnabled = true;

  constructor(materials: MaterialLibrary) {
    const cap = BALANCE.pools.maxEnemies;

    for (let i = 0; i < ENEMY_TYPES.length; i++) {
      const type = ENEMY_TYPES[i];
      const geo = this.buildEnemyGeometry(type);
      this.geometries.push(geo);

      const flashArray = new Float32Array(cap);
      const flashAttr = new THREE.InstancedBufferAttribute(flashArray, 1);
      flashAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aFlash', flashAttr);

      const mesh = new THREE.InstancedMesh(geo, materials.enemyInstancedMaterial, cap);
      mesh.count = 0;
      mesh.castShadow = type === 'brute' || type === 'boss';
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;

      for (let k = 0; k < cap; k++) {
        mesh.setColorAt(k, _white);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      this.group.add(mesh);
      this.layers.set(type, { mesh, flashAttr, flashArray });
    }

    // Billboarded HP bars rendered in 1 draw call (border + track + fill via aHpRatio shader)
    const planeGeo = new THREE.PlaneGeometry(1, 1);
    this.geometries.push(planeGeo);

    this.hpRatioArray = new Float32Array(cap);
    this.hpRatioAttr = new THREE.InstancedBufferAttribute(this.hpRatioArray, 1);
    this.hpRatioAttr.setUsage(THREE.DynamicDrawUsage);
    planeGeo.setAttribute('aHpRatio', this.hpRatioAttr);

    this.hpBarMesh = new THREE.InstancedMesh(planeGeo, materials.hpBarMaterial, cap);
    this.hpBarMesh.count = 0;
    this.hpBarMesh.frustumCulled = false;
    this.hpBarMesh.renderOrder = 20;
    for (let k = 0; k < cap; k++) {
      this.hpBarMesh.setColorAt(k, _hpGreen);
    }
    if (this.hpBarMesh.instanceColor) this.hpBarMesh.instanceColor.needsUpdate = true;
    this.group.add(this.hpBarMesh);

    const shadowGeo = new THREE.CircleGeometry(0.45, 8);
    shadowGeo.rotateX(-Math.PI / 2);
    this.geometries.push(shadowGeo);
    this.shadowDecalMesh = new THREE.InstancedMesh(shadowGeo, materials.shadowDecalMaterial, cap);
    this.shadowDecalMesh.count = 0;
    this.shadowDecalMesh.frustumCulled = false;
    this.group.add(this.shadowDecalMesh);
  }

  setQuality(quality: QualityLevel): void {
    this.groundDecalsEnabled = quality !== 'low';
  }

  update(
    pool: ObjectPool<EnemyEntity>,
    alpha: number,
    elapsedTime: number,
    camera: THREE.Camera,
  ): void {
    this.layers.forEach((layer) => {
      layer.mesh.count = 0;
    });
    let hpCount = 0;
    let shadowDecalCount = 0;

    const activeCount = pool.getActiveCount();
    for (let i = 0; i < activeCount; i++) {
      const idx = pool.getActiveIndex(i);
      const e = pool.items[idx];
      const layer = this.layers.get(e.type);
      if (!layer) continue;

      const slot = layer.mesh.count;
      layer.mesh.count = slot + 1;

      const ix = e.prevX + (e.x - e.prevX) * alpha;
      const iy = e.prevY + (e.y - e.prevY) * alpha;
      const iz = e.prevZ + (e.z - e.prevZ) * alpha;

      let dyaw = e.yaw - e.prevYaw;
      if (dyaw > Math.PI) dyaw -= Math.PI * 2;
      if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const iyaw = e.prevYaw + dyaw * alpha;

      let bobY: number;
      let tiltZ: number;
      let tiltX = 0;
      if (e.flying) {
        bobY = Math.sin(elapsedTime * 4.5 + e.walkPhase) * 0.16;
        tiltZ = Math.sin(elapsedTime * 3.2 + e.walkPhase) * 0.12;
      } else {
        bobY = Math.abs(Math.sin(e.walkPhase)) * 0.08;
        tiltZ = Math.sin(e.walkPhase) * 0.08;
        tiltX = e.type === 'runner' ? 0.18 : 0.04;
      }

      _dummy.position.set(ix, iy + bobY, iz);
      _dummy.rotation.set(tiltX, iyaw, tiltZ);
      _dummy.scale.setScalar(1);
      _dummy.updateMatrix();
      layer.mesh.setMatrixAt(slot, _dummy.matrix);

      if (e.slowTimer > 0) {
        _color.copy(_white).lerp(_frostTint, Math.min(1, 0.55 + e.slowRatio));
      } else {
        _color.copy(_white);
      }
      layer.mesh.setColorAt(slot, _color);

      layer.flashArray[slot] = e.hitFlashTimer > 0 ? Math.min(1, e.hitFlashTimer / 0.12) : 0;

      if (e.flying) {
        _dummy.position.set(ix, 0.03, iz);
        _dummy.rotation.set(0, 0, 0);
        const s = 0.85 + Math.sin(elapsedTime * 4.5 + e.walkPhase) * 0.08;
        _dummy.scale.setScalar(s);
        _dummy.updateMatrix();
        this.shadowDecalMesh.setMatrixAt(shadowDecalCount++, _dummy.matrix);
      } else if (this.groundDecalsEnabled && e.type !== 'brute' && e.type !== 'boss') {
        _dummy.position.set(ix, 0.02, iz);
        _dummy.rotation.set(0, 0, 0);
        const s = e.type === 'runner' ? 0.65 : e.type === 'healer' ? 0.78 : 0.72;
        _dummy.scale.setScalar(s);
        _dummy.updateMatrix();
        this.shadowDecalMesh.setMatrixAt(shadowDecalCount++, _dummy.matrix);
      }

      if (e.hp < e.maxHp && e.hp > 0) {
        const ratio = Math.max(0.02, Math.min(1, e.hp / e.maxHp));
        const barW = e.type === 'boss' ? 1.55 : e.type === 'brute' ? 1.05 : 0.84;
        const barH = e.type === 'boss' ? 0.18 : 0.13;

        _barPos.set(ix, iy + bobY + e.height + 0.32, iz);

        _dummy.position.copy(_barPos);
        _dummy.quaternion.copy(camera.quaternion);
        _dummy.scale.set(barW + 0.04, barH + 0.04, 1);
        _dummy.updateMatrix();
        this.hpBarMesh.setMatrixAt(hpCount, _dummy.matrix);
        this.hpRatioArray[hpCount] = ratio;

        if (ratio > 0.55) {
          this.hpBarMesh.setColorAt(hpCount, _hpGreen);
        } else if (ratio > 0.28) {
          this.hpBarMesh.setColorAt(hpCount, _hpGold);
        } else {
          this.hpBarMesh.setColorAt(hpCount, _hpCoral);
        }
        hpCount++;
      }
    }

    this.layers.forEach((layer) => {
      layer.mesh.visible = layer.mesh.count > 0;
      if (layer.mesh.count > 0) {
        layer.mesh.instanceMatrix.needsUpdate = true;
        if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true;
        layer.flashAttr.needsUpdate = true;
      }
    });

    this.hpBarMesh.count = hpCount;
    this.hpBarMesh.visible = hpCount > 0;
    if (hpCount > 0) {
      this.hpBarMesh.instanceMatrix.needsUpdate = true;
      if (this.hpBarMesh.instanceColor) this.hpBarMesh.instanceColor.needsUpdate = true;
      this.hpRatioAttr.needsUpdate = true;
    }

    this.shadowDecalMesh.count = shadowDecalCount;
    this.shadowDecalMesh.visible = shadowDecalCount > 0;
    if (shadowDecalCount > 0) {
      this.shadowDecalMesh.instanceMatrix.needsUpdate = true;
    }
  }

  clear(): void {
    this.layers.forEach((layer) => {
      layer.mesh.count = 0;
      layer.mesh.visible = false;
    });
    this.hpBarMesh.count = 0;
    this.hpBarMesh.visible = false;
    this.shadowDecalMesh.count = 0;
    this.shadowDecalMesh.visible = false;
  }

  private buildEnemyGeometry(type: EnemyType): THREE.BufferGeometry {
    const chamfer = createChamferedBoxGeometry();
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cone = new THREE.ConeGeometry(1, 1, 5);
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 6);
    const wing = createWingGeometry();

    const eyeDark = 0x1a1829;
    const eyeGlowGold = 0xffcf4d;
    const eyeGlowRed = 0xff6b52;
    const skinWarm = 0xd6b08c;
    const leatherDark = 0x5c3c28;
    const ironDark = 0x545d70;
    const steelMid = 0x768194;
    const navyDeep = 0x353358;

    let parts: ColoredPart[];
    switch (type) {
      case 'grunt': {
        // Armored goblin raider with nasal steel helmet, kite shield, dagger, and dark eyes
        parts = [
          { geometry: chamfer, colorHex: leatherDark, position: [-0.14, 0.14, 0], scale: [0.16, 0.28, 0.2] },
          { geometry: chamfer, colorHex: leatherDark, position: [0.14, 0.14, 0], scale: [0.16, 0.28, 0.2] },
          { geometry: chamfer, colorHex: 0xd94848, position: [0, 0.45, 0], scale: [0.46, 0.42, 0.34] },
          { geometry: box, colorHex: leatherDark, position: [0, 0.31, 0], scale: [0.48, 0.08, 0.36] },
          { geometry: chamfer, colorHex: skinWarm, position: [0, 0.78, 0.03], scale: [0.3, 0.26, 0.28] },
          // Nasal helm dome + brow + back neckguard
          { geometry: cyl, colorHex: ironDark, position: [0, 0.9, 0.01], scale: [0.22, 0.16, 0.22] },
          { geometry: cone, colorHex: steelMid, position: [0, 1.03, 0.01], scale: [0.22, 0.14, 0.22] },
          { geometry: box, colorHex: ironDark, position: [0, 0.82, 0.16], scale: [0.05, 0.14, 0.06] },
          // Left shield with brass boss + right short blade
          { geometry: chamfer, colorHex: ironDark, position: [-0.29, 0.48, 0.1], rotation: [0, 0.2, 0], scale: [0.1, 0.38, 0.32] },
          { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [-0.34, 0.48, 0.1], rotation: [0, 0, Math.PI / 2], scale: [0.09, 0.04, 0.09] },
          { geometry: chamfer, colorHex: steelMid, position: [0.28, 0.48, 0.18], rotation: [0.85, 0, 0], scale: [0.07, 0.32, 0.08] },
        ];
        addEyes(parts, ico, 0.77, 0.17, 0.075, 0.034, eyeDark);
        break;
      }

      case 'runner': {
        // Agile hooded wind-scout with crimson scarf, swept plumes, amber goggles, and twin blades
        parts = [
          { geometry: chamfer, colorHex: navyDeep, position: [-0.11, 0.15, -0.02], scale: [0.13, 0.3, 0.16] },
          { geometry: chamfer, colorHex: navyDeep, position: [0.11, 0.15, 0.02], scale: [0.13, 0.3, 0.16] },
          { geometry: chamfer, colorHex: 0xde9f2c, position: [0, 0.46, 0], scale: [0.36, 0.38, 0.28] },
          { geometry: chamfer, colorHex: 0xc93f3f, position: [0, 0.62, -0.06], rotation: [-0.2, 0, 0], scale: [0.32, 0.12, 0.34] },
          { geometry: chamfer, colorHex: navyDeep, position: [0, 0.75, 0.04], scale: [0.28, 0.26, 0.28] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [-0.08, 0.85, -0.2], rotation: [-1.15, 0, 0.14], scale: [0.08, 0.34, 0.08] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [0.08, 0.85, -0.2], rotation: [-1.15, 0, -0.14], scale: [0.08, 0.34, 0.08] },
          { geometry: box, colorHex: leatherDark, position: [0, 0.5, -0.19], scale: [0.24, 0.24, 0.12] },
          { geometry: cone, colorHex: steelMid, position: [-0.22, 0.42, 0.18], rotation: [Math.PI / 2, 0, 0], scale: [0.045, 0.26, 0.045] },
          { geometry: cone, colorHex: steelMid, position: [0.22, 0.42, 0.18], rotation: [Math.PI / 2, 0, 0], scale: [0.045, 0.26, 0.045] },
        ];
        addEyes(parts, ico, 0.74, 0.18, 0.065, 0.036, eyeGlowGold);
        break;
      }

      case 'brute': {
        // Heavy horned siege juggernaut with iron pauldrons, crimson sash, amber visor slit
        parts = [
          { geometry: chamfer, colorHex: navyDeep, position: [-0.2, 0.18, 0], scale: [0.24, 0.36, 0.28] },
          { geometry: chamfer, colorHex: navyDeep, position: [0.2, 0.18, 0], scale: [0.24, 0.36, 0.28] },
          { geometry: chamfer, colorHex: ironDark, position: [0, 0.64, 0], scale: [0.76, 0.58, 0.54] },
          { geometry: chamfer, colorHex: 0xc94141, position: [0, 0.45, 0.04], scale: [0.64, 0.18, 0.52] },
          { geometry: chamfer, colorHex: 0x3f4659, position: [-0.47, 0.78, 0], rotation: [0, 0, 0.16], scale: [0.26, 0.34, 0.38] },
          { geometry: chamfer, colorHex: 0x3f4659, position: [0.47, 0.78, 0], rotation: [0, 0, -0.16], scale: [0.26, 0.34, 0.38] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [-0.49, 0.98, 0], scale: [0.06, 0.14, 0.06] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [0.49, 0.98, 0], scale: [0.06, 0.14, 0.06] },
          { geometry: chamfer, colorHex: navyDeep, position: [0, 1.04, 0.05], scale: [0.38, 0.32, 0.36] },
          { geometry: box, colorHex: 0x1a1929, position: [0, 1.04, 0.21], scale: [0.26, 0.09, 0.06] },
          { geometry: cone, colorHex: 0xdfd0b4, position: [-0.22, 1.22, 0.05], rotation: [0, 0, 0.42], scale: [0.09, 0.28, 0.09] },
          { geometry: cone, colorHex: 0xdfd0b4, position: [0.22, 1.22, 0.05], rotation: [0, 0, -0.42], scale: [0.09, 0.28, 0.09] },
        ];
        addEyes(parts, ico, 1.04, 0.23, 0.075, 0.036, eyeGlowGold);
        break;
      }

      case 'flyer': {
        // Winged obsidian-indigo sky drake with swept teal-slate wings and golden drake eyes
        parts = [
          { geometry: chamfer, colorHex: 0x3b3863, position: [0, 0.1, 0.04], scale: [0.26, 0.22, 0.62] },
          { geometry: cone, colorHex: 0x4ca6c9, position: [0, 0.06, -0.34], rotation: [-Math.PI / 2, 0, 0], scale: [0.13, 0.36, 0.12] },
          { geometry: wing, colorHex: 0x3f7999, position: [0.1, 0.14, 0.02], rotation: [0, -0.18, 0.06], scale: [0.95, 1.0, 1.0] },
          { geometry: wing, colorHex: 0x3f7999, position: [-0.1, 0.14, 0.02], rotation: [0, 0.18, -0.06], scale: [-0.95, 1.0, 1.0] },
          { geometry: box, colorHex: navyDeep, position: [0.42, 0.16, 0.08], rotation: [0, -0.15, 0.06], scale: [0.64, 0.045, 0.05] },
          { geometry: box, colorHex: navyDeep, position: [-0.42, 0.16, 0.08], rotation: [0, 0.15, -0.06], scale: [0.64, 0.045, 0.05] },
          { geometry: chamfer, colorHex: 0x4b4778, position: [0, 0.18, 0.34], scale: [0.22, 0.18, 0.28] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [-0.08, 0.3, 0.26], rotation: [-0.65, 0, 0.2], scale: [0.05, 0.18, 0.05] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [0.08, 0.3, 0.26], rotation: [-0.65, 0, -0.2], scale: [0.05, 0.18, 0.05] },
        ];
        addEyes(parts, ico, 0.2, 0.45, 0.075, 0.036, eyeGlowGold);
        break;
      }

      case 'healer': {
        // Emerald druid cleric with layered robes, cowl hood, floating gold halo, and crystal staff
        parts = [
          { geometry: cyl, colorHex: 0x367532, position: [0, 0.38, 0], scale: [0.25, 0.72, 0.25] },
          { geometry: cyl, colorHex: 0x6ab848, position: [0, 0.56, 0], scale: [0.22, 0.36, 0.22] },
          { geometry: chamfer, colorHex: PALETTE_HEX.gold, position: [0, 0.42, 0.16], scale: [0.1, 0.48, 0.05] },
          { geometry: chamfer, colorHex: 0x2c612b, position: [0, 0.87, -0.02], scale: [0.3, 0.3, 0.3] },
          { geometry: ico, colorHex: skinWarm, position: [0, 0.86, 0.06], scale: [0.16, 0.17, 0.16] },
          { geometry: cone, colorHex: 0x3a8035, position: [0, 1.07, -0.02], rotation: [-0.15, 0, 0], scale: [0.18, 0.22, 0.18] },
          { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 1.22, 0], scale: [0.19, 0.05, 0.19] },
          { geometry: cyl, colorHex: leatherDark, position: [0.31, 0.56, 0.12], scale: [0.045, 0.94, 0.045] },
          { geometry: ico, colorHex: 0x7be06b, position: [0.31, 1.08, 0.12], scale: [0.12, 0.15, 0.12] },
        ];
        addEyes(parts, ico, 0.87, 0.2, 0.055, 0.028, eyeDark);
        break;
      }

      case 'boss':
      default: {
        // Towering Obsidian Siege Overlord with furnace core, brass pauldrons, dread crown, glowing crimson eyes
        parts = [
          { geometry: chamfer, colorHex: navyDeep, position: [-0.32, 0.24, 0], scale: [0.34, 0.48, 0.38] },
          { geometry: chamfer, colorHex: navyDeep, position: [0.32, 0.24, 0], scale: [0.34, 0.48, 0.38] },
          { geometry: chamfer, colorHex: 0x2f2d4f, position: [0, 0.86, 0], scale: [1.08, 0.84, 0.78] },
          { geometry: chamfer, colorHex: PALETTE_HEX.gold, position: [0, 0.54, 0], scale: [1.04, 0.14, 0.8] },
          { geometry: ico, colorHex: PALETTE_HEX.coral, position: [0, 0.9, 0.38], scale: [0.26, 0.26, 0.16] },
          { geometry: chamfer, colorHex: ironDark, position: [-0.67, 0.98, 0], rotation: [0, 0, 0.14], scale: [0.38, 0.56, 0.5] },
          { geometry: chamfer, colorHex: ironDark, position: [0.67, 0.98, 0], rotation: [0, 0, -0.14], scale: [0.38, 0.56, 0.5] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [-0.72, 1.32, 0], scale: [0.11, 0.24, 0.11] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [0.72, 1.32, 0], scale: [0.11, 0.24, 0.11] },
          { geometry: chamfer, colorHex: 0x262442, position: [0, 1.44, 0.06], scale: [0.52, 0.42, 0.48] },
          { geometry: box, colorHex: 0x161526, position: [0, 1.44, 0.28], scale: [0.34, 0.11, 0.06] },
          { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 1.72, 0.06], scale: [0.31, 0.16, 0.31] },
          { geometry: cone, colorHex: PALETTE_HEX.coral, position: [-0.32, 1.72, 0.06], rotation: [0, 0, 0.36], scale: [0.12, 0.38, 0.12] },
          { geometry: cone, colorHex: PALETTE_HEX.coral, position: [0.32, 1.72, 0.06], rotation: [0, 0, -0.36], scale: [0.12, 0.38, 0.12] },
          // Back shoulder war banners / exhaust spires
          { geometry: box, colorHex: PALETTE_HEX.coral, position: [-0.42, 1.54, -0.32], scale: [0.1, 0.62, 0.08] },
          { geometry: box, colorHex: PALETTE_HEX.coral, position: [0.42, 1.54, -0.32], scale: [0.1, 0.62, 0.08] },
        ];
        addEyes(parts, ico, 1.44, 0.3, 0.11, 0.055, eyeGlowRed);
        break;
      }
    }

    const merged = mergeColoredParts(parts);
    chamfer.dispose();
    box.dispose();
    cone.dispose();
    ico.dispose();
    cyl.dispose();
    wing.dispose();
    return merged;
  }

  dispose(): void {
    this.group.clear();
    for (let i = 0; i < this.geometries.length; i++) {
      this.geometries[i].dispose();
    }
    this.geometries.length = 0;
    this.layers.clear();
  }
}
