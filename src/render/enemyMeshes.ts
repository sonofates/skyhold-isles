import * as THREE from 'three';
import type { ObjectPool } from '../core/pool.ts';
import type { EnemyType } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { ENEMY_TYPES } from '../data/enemies.ts';
import { FROST_TINT_HEX, PALETTE_HEX } from '../data/palette.ts';
import type { EnemyEntity } from '../sim/entities.ts';
import { disposeInstancedMeshes, mergeColoredParts, type ColoredPart } from './geometryHelpers.ts';
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
const _splitChildTint = new THREE.Color(0xff7898);
const _hpGreen = new THREE.Color(PALETTE_HEX.grass);
const _hpGold = new THREE.Color(PALETTE_HEX.gold);
const _hpCoral = new THREE.Color(PALETTE_HEX.coral);
const _eliteTint = new THREE.Color(PALETTE_HEX.gold);
const _blinkGlow = new THREE.Color(0xc8fff8);
/** Seconds before a Rift Blinker's jump during which it flickers as a telegraph. */
const BLINK_TELEGRAPH_SEC = 0.55;
const GROUND_SHADOW_SCALE: Partial<Record<EnemyType, number>> = {
  boss: 1.95,
  tempest: 2.1,
  brute: 1.48,
  golem: 1.62,
  splitter: 1.18,
  warden: 1.14,
  burrower: 1.3,
  runner: 0.94,
  blinker: 0.92,
  mite: 0.62,
};
const HP_BAR_WIDTH: Partial<Record<EnemyType, number>> = {
  boss: 1.75,
  tempest: 1.9,
  brute: 1.2,
  golem: 1.3,
  carrier: 1.1,
  mite: 0.6,
};

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
  private moundMesh: THREE.InstancedMesh;
  private bubbleMesh: THREE.InstancedMesh;
  private bubbleMaterial: THREE.MeshBasicMaterial;
  private eliteRingMesh: THREE.InstancedMesh;
  private eliteRingMaterial: THREE.MeshBasicMaterial;

  constructor(materials: MaterialLibrary) {
    const cap = BALANCE.pools.maxEnemies;

    for (let i = 0; i < ENEMY_TYPES.length; i++) {
      const type = ENEMY_TYPES[i];
      const geo = EnemyRenderer.buildEnemyGeometry(type);
      this.geometries.push(geo);

      const flashArray = new Float32Array(cap);
      const flashAttr = new THREE.InstancedBufferAttribute(flashArray, 1);
      flashAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aFlash', flashAttr);

      const mesh = new THREE.InstancedMesh(geo, materials.enemyInstancedMaterial, cap);
      mesh.count = 0;
      mesh.castShadow = type === 'brute' || type === 'boss' || type === 'tempest' || type === 'golem';
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

    // Burrower dirt mounds (shares the enemy material, so it needs its own aFlash attribute)
    const moundGeo = this.buildMoundGeometry();
    this.geometries.push(moundGeo);
    const moundFlash = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    moundGeo.setAttribute('aFlash', moundFlash);
    this.moundMesh = new THREE.InstancedMesh(moundGeo, materials.enemyInstancedMaterial, cap);
    this.moundMesh.count = 0;
    this.moundMesh.visible = false;
    this.moundMesh.frustumCulled = false;
    this.group.add(this.moundMesh);

    // Warden barrier bubbles: one translucent draw call for every shielded enemy
    const bubbleGeo = new THREE.IcosahedronGeometry(0.5, 1);
    this.geometries.push(bubbleGeo);
    this.bubbleMaterial = new THREE.MeshBasicMaterial({
      color: 0x9fdcff,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    this.bubbleMesh = new THREE.InstancedMesh(bubbleGeo, this.bubbleMaterial, cap);
    this.bubbleMesh.count = 0;
    this.bubbleMesh.visible = false;
    this.bubbleMesh.frustumCulled = false;
    this.bubbleMesh.renderOrder = 6;
    this.group.add(this.bubbleMesh);

    // Empowered elite aura rings (flat gold rings at the feet / under flyers)
    const ringGeo = new THREE.RingGeometry(0.42, 0.56, 18, 1);
    ringGeo.rotateX(-Math.PI / 2);
    this.geometries.push(ringGeo);
    this.eliteRingMaterial = new THREE.MeshBasicMaterial({
      color: PALETTE_HEX.gold,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.eliteRingMesh = new THREE.InstancedMesh(ringGeo, this.eliteRingMaterial, cap);
    this.eliteRingMesh.count = 0;
    this.eliteRingMesh.visible = false;
    this.eliteRingMesh.frustumCulled = false;
    this.eliteRingMesh.renderOrder = 3;
    this.group.add(this.eliteRingMesh);

    const shadowGeo = new THREE.PlaneGeometry(1.15, 1.15);
    shadowGeo.rotateX(-Math.PI / 2);
    this.geometries.push(shadowGeo);
    this.shadowDecalMesh = new THREE.InstancedMesh(shadowGeo, materials.shadowDecalMaterial, cap);
    this.shadowDecalMesh.count = 0;
    this.shadowDecalMesh.renderOrder = 2;
    this.shadowDecalMesh.frustumCulled = false;
    this.group.add(this.shadowDecalMesh);
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
    let moundCount = 0;
    let bubbleCount = 0;
    let ringCount = 0;

    const activeCount = pool.getActiveCount();
    for (let i = 0; i < activeCount; i++) {
      const idx = pool.getActiveIndex(i);
      const e = pool.items[idx];
      const layer = this.layers.get(e.type);
      if (!layer) continue;

      const ix = e.prevX + (e.x - e.prevX) * alpha;
      const iy = e.prevY + (e.y - e.prevY) * alpha;
      const iz = e.prevZ + (e.z - e.prevZ) * alpha;

      let dyaw = e.yaw - e.prevYaw;
      if (dyaw > Math.PI) dyaw -= Math.PI * 2;
      if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const iyaw = e.prevYaw + dyaw * alpha;

      if (e.burrowed) {
        // Underground: only a wobbling dirt mound travels along the road (no body, no HP bar).
        const wob = Math.sin(e.walkPhase * 1.6);
        _dummy.position.set(ix, iy + 0.02, iz);
        _dummy.rotation.set(0, iyaw, wob * 0.06);
        _dummy.scale.set(1 + wob * 0.06, 1 - wob * 0.08, 1 + wob * 0.04);
        _dummy.updateMatrix();
        this.moundMesh.setMatrixAt(moundCount, _dummy.matrix);
        moundCount++;
        continue;
      }

      const slot = layer.mesh.count;
      layer.mesh.count = slot + 1;

      let bobY: number;
      let tiltZ: number;
      let tiltX = 0;
      if (e.flying) {
        bobY = Math.sin(elapsedTime * 4.5 + e.walkPhase) * 0.16;
        tiltZ = Math.sin(elapsedTime * 3.2 + e.walkPhase) * 0.12;
      } else {
        bobY = Math.abs(Math.sin(e.walkPhase)) * (e.isSplitChild ? 0.11 : 0.08);
        tiltZ = Math.sin(e.walkPhase) * (e.isSplitChild ? 0.12 : 0.08);
        tiltX =
          e.type === 'runner'
            ? e.isSplitChild
              ? 0.24
              : 0.18
            : e.type === 'splitter' || e.type === 'burrower'
              ? 0.08
              : e.type === 'mite'
                ? 0.1
                : 0.04;
        if (e.type === 'golem') {
          // Heavy stomp: less sway, more vertical thud
          tiltZ *= 0.5;
          bobY *= 0.7;
        }
      }

      const scaleMul = e.scaleOverride || 1;
      const enemyScale = (e.type === 'boss' || e.type === 'tempest' ? 1.26 : 1.28) * scaleMul;
      _dummy.position.set(ix, iy + bobY, iz);
      _dummy.rotation.set(tiltX, iyaw, tiltZ);
      _dummy.scale.setScalar(enemyScale);
      _dummy.updateMatrix();
      layer.mesh.setMatrixAt(slot, _dummy.matrix);

      _color.copy(e.isSplitChild ? _splitChildTint : _white);
      if (e.elite) {
        _color.lerp(_eliteTint, 0.28);
      }
      if (e.slowTimer > 0) {
        _color.lerp(_frostTint, Math.min(1, 0.55 + e.slowRatio));
      } else if (e.armorBreakTimer > 0) {
        _color.lerp(_frostTint, 0.45);
      }
      if (e.type === 'blinker' && e.abilityTimer < BLINK_TELEGRAPH_SEC) {
        // Rift charge telegraph: flicker toward bright aqua right before the jump
        const k = 1 - e.abilityTimer / BLINK_TELEGRAPH_SEC;
        _color.lerp(_blinkGlow, k * (0.55 + 0.45 * Math.abs(Math.sin(elapsedTime * 30))));
      }
      layer.mesh.setColorAt(slot, _color);

      if (e.shield > 0) {
        const fill = e.shieldMax > 0 ? Math.min(1, e.shield / e.shieldMax) : 1;
        const s = Math.max(e.radius * 2.5, e.height * 1.2) * enemyScale * (0.82 + fill * 0.18);
        _dummy.position.set(ix, iy + bobY + e.height * enemyScale * 0.5, iz);
        _dummy.rotation.set(0, elapsedTime * 0.8 + e.walkPhase, 0);
        _dummy.scale.set(s, s * 1.04, s);
        _dummy.updateMatrix();
        this.bubbleMesh.setMatrixAt(bubbleCount++, _dummy.matrix);
      }
      if (e.elite) {
        const pulse = 1 + Math.sin(elapsedTime * 3.4 + e.walkPhase) * 0.06;
        _dummy.position.set(ix, e.flying ? iy + bobY - 0.12 : iy + 0.035, iz);
        _dummy.rotation.set(0, elapsedTime * 1.2, 0);
        _dummy.scale.setScalar((e.radius * 2.4 + 0.2) * scaleMul * pulse);
        _dummy.updateMatrix();
        this.eliteRingMesh.setMatrixAt(ringCount++, _dummy.matrix);
      }

      layer.flashArray[slot] = e.hitFlashTimer > 0 ? Math.min(1, e.hitFlashTimer / 0.12) : 0;

      if (e.flying) {
        _dummy.position.set(ix, 0.024, iz);
        _dummy.rotation.set(0, 0, 0);
        const s =
          (e.type === 'carrier' ? 1.45 : 1.12 + Math.sin(elapsedTime * 4.5 + e.walkPhase) * 0.08) *
          scaleMul;
        _dummy.scale.setScalar(s);
        _dummy.updateMatrix();
        this.shadowDecalMesh.setMatrixAt(shadowDecalCount++, _dummy.matrix);
      } else {
        _dummy.position.set(ix, iy + 0.018, iz);
        _dummy.rotation.set(0, 0, 0);
        const baseShadowScale = GROUND_SHADOW_SCALE[e.type] ?? 1.08;
        _dummy.scale.setScalar(baseShadowScale * scaleMul);
        _dummy.updateMatrix();
        this.shadowDecalMesh.setMatrixAt(shadowDecalCount++, _dummy.matrix);
      }

      if (e.hp < e.maxHp && e.hp > 0) {
        const ratio = Math.max(0.02, Math.min(1, e.hp / e.maxHp));
        const barW = (HP_BAR_WIDTH[e.type] ?? 0.94) * (e.isSplitChild ? 0.8 : 1);
        const barH = e.type === 'boss' || e.type === 'tempest' ? 0.2 : 0.14;

        _barPos.set(ix, iy + bobY + e.height * enemyScale + 0.34, iz);

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

    this.finishExtraLayer(this.moundMesh, moundCount);
    this.finishExtraLayer(this.bubbleMesh, bubbleCount);
    this.finishExtraLayer(this.eliteRingMesh, ringCount);

    this.shadowDecalMesh.count = shadowDecalCount;
    this.shadowDecalMesh.visible = shadowDecalCount > 0;
    if (shadowDecalCount > 0) {
      this.shadowDecalMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private finishExtraLayer(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.visible = count > 0;
    if (count > 0) mesh.instanceMatrix.needsUpdate = true;
  }

  /** Low lumpy dirt mound with a few pebbles, used for burrowed Loam Burrowers. */
  private buildMoundGeometry(): THREE.BufferGeometry {
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const parts: ColoredPart[] = [
      { geometry: ico, colorHex: PALETTE_HEX.dirt, position: [0, 0.04, 0], scale: [0.5, 0.2, 0.62] },
      { geometry: ico, colorHex: 0x7d5236, position: [0.12, 0.1, -0.12], scale: [0.26, 0.16, 0.3] },
      { geometry: ico, colorHex: 0xb5835c, position: [-0.14, 0.08, 0.18], scale: [0.22, 0.12, 0.24] },
      { geometry: ico, colorHex: 0x8b95a5, position: [0.3, 0.05, 0.3], scale: [0.07, 0.06, 0.07] },
      { geometry: ico, colorHex: 0x8b95a5, position: [-0.32, 0.04, -0.2], scale: [0.06, 0.05, 0.06] },
    ];
    const merged = mergeColoredParts(parts);
    ico.dispose();
    return merged;
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
    this.moundMesh.count = 0;
    this.moundMesh.visible = false;
    this.bubbleMesh.count = 0;
    this.bubbleMesh.visible = false;
    this.eliteRingMesh.count = 0;
    this.eliteRingMesh.visible = false;
  }

  /** Merged flat-shaded figurine geometry for one enemy type (static so tests can inspect it). */
  static buildEnemyGeometry(type: EnemyType): THREE.BufferGeometry {
    const chamfer = createChamferedBoxGeometry();
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cone = new THREE.ConeGeometry(1, 1, 5);
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 6);
    const wing = createWingGeometry();

    const eyeDark = 0x1a1829;
    const eyeGlowGold = 0xffcf4d;
    const skinWarm = 0xd6b08c;
    const leatherDark = 0x5c3c28;
    const steelMid = 0x768194;

    let parts: ColoredPart[];
    switch (type) {
      case 'grunt': {
        // Crimson raider goblin with steel nasal helm, kite shield, dagger, and expressive dark eyes
        parts = [
          { geometry: chamfer, colorHex: 0x733229, position: [-0.14, 0.14, 0], scale: [0.16, 0.28, 0.2] },
          { geometry: chamfer, colorHex: 0x733229, position: [0.14, 0.14, 0], scale: [0.16, 0.28, 0.2] },
          { geometry: chamfer, colorHex: 0xed3b3b, position: [0, 0.45, 0], scale: [0.46, 0.42, 0.34] },
          { geometry: box, colorHex: leatherDark, position: [0, 0.31, 0], scale: [0.48, 0.08, 0.36] },
          { geometry: chamfer, colorHex: skinWarm, position: [0, 0.78, 0.03], scale: [0.3, 0.26, 0.28] },
          { geometry: cyl, colorHex: steelMid, position: [0, 0.9, 0.01], scale: [0.22, 0.16, 0.22] },
          { geometry: cone, colorHex: 0xa2b0c4, position: [0, 1.03, 0.01], scale: [0.22, 0.14, 0.22] },
          { geometry: box, colorHex: steelMid, position: [0, 0.82, 0.16], scale: [0.05, 0.14, 0.06] },
          { geometry: chamfer, colorHex: 0xb82828, position: [-0.29, 0.48, 0.1], rotation: [0, 0.2, 0], scale: [0.1, 0.38, 0.32] },
          { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [-0.34, 0.48, 0.1], rotation: [0, 0, Math.PI / 2], scale: [0.09, 0.04, 0.09] },
          { geometry: chamfer, colorHex: 0xb8c3d4, position: [0.28, 0.48, 0.18], rotation: [0.85, 0, 0], scale: [0.07, 0.32, 0.08] },
        ];
        addEyes(parts, ico, 0.77, 0.17, 0.075, 0.034, eyeDark);
        break;
      }

      case 'runner': {
        // High-visibility canary-yellow wind-scout with orange-red scarf, swept gold plumes, and twin daggers
        parts = [
          { geometry: chamfer, colorHex: 0xc28a18, position: [-0.11, 0.15, -0.02], scale: [0.13, 0.3, 0.16] },
          { geometry: chamfer, colorHex: 0xc28a18, position: [0.11, 0.15, 0.02], scale: [0.13, 0.3, 0.16] },
          { geometry: chamfer, colorHex: 0xffd22b, position: [0, 0.46, 0], scale: [0.36, 0.38, 0.28] },
          { geometry: chamfer, colorHex: 0xf25a2b, position: [0, 0.62, -0.06], rotation: [-0.2, 0, 0], scale: [0.32, 0.12, 0.34] },
          { geometry: chamfer, colorHex: 0xf5b81d, position: [0, 0.75, 0.04], scale: [0.28, 0.26, 0.28] },
          { geometry: cone, colorHex: 0xffe666, position: [-0.08, 0.85, -0.2], rotation: [-1.15, 0, 0.14], scale: [0.08, 0.34, 0.08] },
          { geometry: cone, colorHex: 0xffe666, position: [0.08, 0.85, -0.2], rotation: [-1.15, 0, -0.14], scale: [0.08, 0.34, 0.08] },
          { geometry: box, colorHex: leatherDark, position: [0, 0.5, -0.19], scale: [0.24, 0.24, 0.12] },
          { geometry: cone, colorHex: 0xc4cfde, position: [-0.22, 0.42, 0.18], rotation: [Math.PI / 2, 0, 0], scale: [0.045, 0.26, 0.045] },
          { geometry: cone, colorHex: 0xc4cfde, position: [0.22, 0.42, 0.18], rotation: [Math.PI / 2, 0, 0], scale: [0.045, 0.26, 0.045] },
        ];
        addEyes(parts, ico, 0.74, 0.18, 0.065, 0.036, eyeDark);
        break;
      }

      case 'brute': {
        // Steel-grey armored siege juggernaut with bold crimson belt/pauldrons, horns, and glowing amber eyes
        parts = [
          { geometry: chamfer, colorHex: 0x6c798c, position: [-0.2, 0.18, 0], scale: [0.24, 0.36, 0.28] },
          { geometry: chamfer, colorHex: 0x6c798c, position: [0.2, 0.18, 0], scale: [0.24, 0.36, 0.28] },
          { geometry: chamfer, colorHex: 0x9aa7ba, position: [0, 0.64, 0], scale: [0.76, 0.58, 0.54] },
          { geometry: chamfer, colorHex: 0xe63636, position: [0, 0.45, 0.04], scale: [0.64, 0.18, 0.52] },
          { geometry: chamfer, colorHex: 0x8593a8, position: [-0.47, 0.78, 0], rotation: [0, 0, 0.16], scale: [0.26, 0.34, 0.38] },
          { geometry: chamfer, colorHex: 0x8593a8, position: [0.47, 0.78, 0], rotation: [0, 0, -0.16], scale: [0.26, 0.34, 0.38] },
          { geometry: cone, colorHex: 0xe63636, position: [-0.49, 0.98, 0], scale: [0.075, 0.16, 0.075] },
          { geometry: cone, colorHex: 0xe63636, position: [0.49, 0.98, 0], scale: [0.075, 0.16, 0.075] },
          { geometry: chamfer, colorHex: 0x7b889c, position: [0, 1.04, 0.05], scale: [0.38, 0.32, 0.36] },
          { geometry: box, colorHex: 0x2a2f3d, position: [0, 1.04, 0.21], scale: [0.26, 0.09, 0.06] },
          { geometry: cone, colorHex: 0xf0e1c4, position: [-0.22, 1.22, 0.05], rotation: [0, 0, 0.42], scale: [0.09, 0.28, 0.09] },
          { geometry: cone, colorHex: 0xf0e1c4, position: [0.22, 1.22, 0.05], rotation: [0, 0, -0.42], scale: [0.09, 0.28, 0.09] },
        ];
        addEyes(parts, ico, 1.04, 0.23, 0.075, 0.036, eyeGlowGold);
        break;
      }

      case 'flyer': {
        // Vivid royal-purple sky drake with lavender-purple wing membranes and gold horns
        parts = [
          { geometry: chamfer, colorHex: 0x8b3ee8, position: [0, 0.1, 0.04], scale: [0.26, 0.22, 0.62] },
          { geometry: cone, colorHex: 0xa65bf5, position: [0, 0.06, -0.34], rotation: [-Math.PI / 2, 0, 0], scale: [0.13, 0.36, 0.12] },
          { geometry: wing, colorHex: 0xb068fa, position: [0.1, 0.14, 0.02], rotation: [0, -0.18, 0.06], scale: [0.95, 1.0, 1.0] },
          { geometry: wing, colorHex: 0xb068fa, position: [-0.1, 0.14, 0.02], rotation: [0, 0.18, -0.06], scale: [-0.95, 1.0, 1.0] },
          { geometry: box, colorHex: 0x5c24a8, position: [0.42, 0.16, 0.08], rotation: [0, -0.15, 0.06], scale: [0.64, 0.045, 0.05] },
          { geometry: box, colorHex: 0x5c24a8, position: [-0.42, 0.16, 0.08], rotation: [0, 0.15, -0.06], scale: [0.64, 0.045, 0.05] },
          { geometry: chamfer, colorHex: 0x9b50f2, position: [0, 0.18, 0.34], scale: [0.22, 0.18, 0.28] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [-0.08, 0.3, 0.26], rotation: [-0.65, 0, 0.2], scale: [0.05, 0.18, 0.05] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [0.08, 0.3, 0.26], rotation: [-0.65, 0, -0.2], scale: [0.05, 0.18, 0.05] },
        ];
        addEyes(parts, ico, 0.2, 0.45, 0.075, 0.036, eyeGlowGold);
        break;
      }

      case 'healer': {
        // Vivid emerald-green druid cleric with gold stole, halo, and bright mint healing orb staff
        parts = [
          { geometry: cyl, colorHex: 0x26a648, position: [0, 0.38, 0], scale: [0.25, 0.72, 0.25] },
          { geometry: cyl, colorHex: 0x45e06b, position: [0, 0.56, 0], scale: [0.22, 0.36, 0.22] },
          { geometry: chamfer, colorHex: PALETTE_HEX.gold, position: [0, 0.42, 0.16], scale: [0.1, 0.48, 0.05] },
          { geometry: chamfer, colorHex: 0x208c3b, position: [0, 0.87, -0.02], scale: [0.3, 0.3, 0.3] },
          { geometry: ico, colorHex: skinWarm, position: [0, 0.86, 0.06], scale: [0.16, 0.17, 0.16] },
          { geometry: cone, colorHex: 0x3ad15c, position: [0, 1.07, -0.02], rotation: [-0.15, 0, 0], scale: [0.18, 0.22, 0.18] },
          { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 1.22, 0], scale: [0.19, 0.05, 0.19] },
          { geometry: cyl, colorHex: leatherDark, position: [0.31, 0.56, 0.12], scale: [0.045, 0.94, 0.045] },
          { geometry: ico, colorHex: 0x94ffb0, position: [0.31, 1.08, 0.12], scale: [0.12, 0.15, 0.12] },
        ];
        addEyes(parts, ico, 0.87, 0.2, 0.055, 0.028, eyeDark);
        break;
      }

      case 'splitter': {
        // Faceted crimson-magenta Cinder Splitling with twin glowing amber crystalline cores
        parts = [
          { geometry: chamfer, colorHex: 0x421e36, position: [-0.14, 0.14, 0], scale: [0.15, 0.28, 0.19] },
          { geometry: chamfer, colorHex: 0x421e36, position: [0.14, 0.14, 0], scale: [0.15, 0.28, 0.19] },
          { geometry: chamfer, colorHex: 0xd9386a, position: [-0.15, 0.5, 0], rotation: [0, 0, 0.12], scale: [0.25, 0.44, 0.38] },
          { geometry: chamfer, colorHex: 0xe84a7f, position: [0.15, 0.5, 0], rotation: [0, 0, -0.12], scale: [0.25, 0.44, 0.38] },
          { geometry: box, colorHex: 0xffb833, position: [0, 0.52, 0], scale: [0.12, 0.38, 0.3] },
          { geometry: ico, colorHex: 0xffcf4d, position: [-0.19, 0.56, 0.16], scale: [0.11, 0.14, 0.09] },
          { geometry: ico, colorHex: 0xffe885, position: [0.19, 0.56, 0.16], scale: [0.11, 0.14, 0.09] },
          { geometry: cone, colorHex: 0xff9d2e, position: [-0.26, 0.8, -0.04], rotation: [0, 0, 0.38], scale: [0.09, 0.28, 0.09] },
          { geometry: cone, colorHex: 0xff9d2e, position: [0.26, 0.8, -0.04], rotation: [0, 0, -0.38], scale: [0.09, 0.28, 0.09] },
          { geometry: chamfer, colorHex: 0x5c2044, position: [0, 0.86, 0.04], scale: [0.32, 0.26, 0.28] },
          { geometry: cone, colorHex: 0xff5c8a, position: [-0.08, 1.05, -0.02], rotation: [-0.12, 0, 0.18], scale: [0.075, 0.24, 0.075] },
          { geometry: cone, colorHex: 0xffb833, position: [0.08, 1.05, -0.02], rotation: [-0.12, 0, -0.18], scale: [0.075, 0.24, 0.075] },
        ];
        addEyes(parts, ico, 0.86, 0.19, 0.075, 0.036, eyeGlowGold);
        break;
      }

      case 'warden': {
        // Cobalt-robed shield priest: huge cream tower-shield with gold rim, gold halo, azure orb staff
        parts = [
          { geometry: chamfer, colorHex: 0x23306e, position: [-0.13, 0.15, 0], scale: [0.15, 0.3, 0.19] },
          { geometry: chamfer, colorHex: 0x23306e, position: [0.13, 0.15, 0], scale: [0.15, 0.3, 0.19] },
          { geometry: cyl, colorHex: 0x3d5bd9, position: [0, 0.48, 0], scale: [0.27, 0.56, 0.25] },
          { geometry: chamfer, colorHex: 0x5b7cf0, position: [0, 0.68, 0.02], scale: [0.44, 0.32, 0.34] },
          { geometry: box, colorHex: PALETTE_HEX.gold, position: [0, 0.52, 0.02], scale: [0.5, 0.07, 0.38] },
          { geometry: chamfer, colorHex: skinWarm, position: [0, 0.98, 0.03], scale: [0.27, 0.25, 0.26] },
          { geometry: chamfer, colorHex: PALETTE_HEX.cream, position: [0, 1.1, 0.0], scale: [0.31, 0.15, 0.3] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [0, 1.25, 0.0], scale: [0.07, 0.2, 0.07] },
          { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 1.42, -0.04], scale: [0.3, 0.035, 0.3] },
          { geometry: cyl, colorHex: 0xfff2c4, position: [0, 1.425, -0.04], scale: [0.21, 0.04, 0.21] },
          // Tower shield (gold rim behind cream face + cobalt emblem)
          { geometry: chamfer, colorHex: PALETTE_HEX.gold, position: [-0.3, 0.62, 0.22], rotation: [0, 0.35, 0], scale: [0.1, 0.78, 0.5] },
          { geometry: chamfer, colorHex: PALETTE_HEX.cream, position: [-0.34, 0.62, 0.25], rotation: [0, 0.35, 0], scale: [0.08, 0.68, 0.42] },
          { geometry: box, colorHex: 0x3d5bd9, position: [-0.385, 0.66, 0.27], rotation: [0, 0.35, 0], scale: [0.03, 0.34, 0.1] },
          { geometry: box, colorHex: 0x3d5bd9, position: [-0.385, 0.7, 0.27], rotation: [0, 0.35, 0], scale: [0.03, 0.1, 0.28] },
          // Staff with azure orb
          { geometry: cyl, colorHex: leatherDark, position: [0.3, 0.62, 0.1], scale: [0.04, 1.0, 0.04] },
          { geometry: ico, colorHex: 0x8fd3ff, position: [0.3, 1.18, 0.1], scale: [0.12, 0.14, 0.12] },
        ];
        addEyes(parts, ico, 0.98, 0.17, 0.065, 0.032, eyeDark);
        break;
      }

      case 'burrower': {
        // Squat ochre mole-beast: steel drill snout, cream digging claws, dark spiny back ridge
        parts = [
          { geometry: chamfer, colorHex: 0x6b4423, position: [-0.2, 0.12, 0.05], scale: [0.18, 0.22, 0.24] },
          { geometry: chamfer, colorHex: 0x6b4423, position: [0.2, 0.12, 0.05], scale: [0.18, 0.22, 0.24] },
          { geometry: chamfer, colorHex: 0xc2832f, position: [0, 0.42, -0.04], scale: [0.7, 0.5, 0.78] },
          { geometry: chamfer, colorHex: PALETTE_HEX.sand, position: [0, 0.32, 0.12], scale: [0.5, 0.28, 0.52] },
          { geometry: chamfer, colorHex: 0xd6953d, position: [0, 0.56, 0.36], scale: [0.42, 0.34, 0.3] },
          { geometry: cone, colorHex: 0xa2b0c4, position: [0, 0.52, 0.64], rotation: [Math.PI / 2, 0, 0], scale: [0.13, 0.32, 0.13] },
          { geometry: cyl, colorHex: steelMid, position: [0, 0.52, 0.5], rotation: [Math.PI / 2, 0, 0], scale: [0.16, 0.06, 0.16] },
          { geometry: cone, colorHex: PALETTE_HEX.cream, position: [-0.34, 0.24, 0.42], rotation: [1.25, 0, 0.3], scale: [0.07, 0.24, 0.07] },
          { geometry: cone, colorHex: PALETTE_HEX.cream, position: [-0.24, 0.22, 0.46], rotation: [1.25, 0, 0.1], scale: [0.07, 0.24, 0.07] },
          { geometry: cone, colorHex: PALETTE_HEX.cream, position: [0.34, 0.24, 0.42], rotation: [1.25, 0, -0.3], scale: [0.07, 0.24, 0.07] },
          { geometry: cone, colorHex: PALETTE_HEX.cream, position: [0.24, 0.22, 0.46], rotation: [1.25, 0, -0.1], scale: [0.07, 0.24, 0.07] },
          { geometry: cone, colorHex: 0x5c3a1e, position: [0, 0.76, -0.1], rotation: [-0.3, 0, 0], scale: [0.08, 0.22, 0.08] },
          { geometry: cone, colorHex: 0x5c3a1e, position: [0, 0.72, -0.34], rotation: [-0.5, 0, 0], scale: [0.08, 0.22, 0.08] },
          { geometry: cone, colorHex: 0x5c3a1e, position: [-0.2, 0.7, -0.22], rotation: [-0.4, 0, 0.35], scale: [0.07, 0.2, 0.07] },
          { geometry: cone, colorHex: 0x5c3a1e, position: [0.2, 0.7, -0.22], rotation: [-0.4, 0, -0.35], scale: [0.07, 0.2, 0.07] },
        ];
        addEyes(parts, ico, 0.66, 0.5, 0.13, 0.034, eyeDark);
        break;
      }

      case 'carrier': {
        // Striped cream sky-balloon with a wicker gondola, coral pennants and a little rear propeller
        parts = [
          { geometry: ico, colorHex: PALETTE_HEX.cream, position: [0, 0.82, 0], scale: [0.6, 0.5, 0.74] },
          { geometry: cyl, colorHex: PALETTE_HEX.coral, position: [0, 0.82, 0], scale: [0.63, 0.12, 0.77] },
          { geometry: cyl, colorHex: PALETTE_HEX.coral, position: [0, 1.08, 0], scale: [0.42, 0.08, 0.52] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [0, 1.36, 0], scale: [0.08, 0.16, 0.08] },
          { geometry: box, colorHex: leatherDark, position: [-0.2, 0.36, 0], scale: [0.03, 0.4, 0.03] },
          { geometry: box, colorHex: leatherDark, position: [0.2, 0.36, 0], scale: [0.03, 0.4, 0.03] },
          { geometry: chamfer, colorHex: 0x9c6b49, position: [0, 0.06, 0], scale: [0.5, 0.26, 0.56] },
          { geometry: box, colorHex: 0x6b4423, position: [0, 0.12, 0], scale: [0.52, 0.05, 0.58] },
          { geometry: chamfer, colorHex: 0xc28a52, position: [0, 0.22, 0.04], scale: [0.26, 0.16, 0.22] },
          { geometry: cone, colorHex: PALETTE_HEX.coral, position: [0.3, 0.3, 0.2], rotation: [0, 0, -Math.PI / 2], scale: [0.07, 0.2, 0.03] },
          { geometry: cone, colorHex: PALETTE_HEX.coral, position: [-0.3, 0.3, 0.2], rotation: [0, 0, Math.PI / 2], scale: [0.07, 0.2, 0.03] },
          { geometry: cyl, colorHex: steelMid, position: [0, 0.08, -0.34], rotation: [Math.PI / 2, 0, 0], scale: [0.05, 0.14, 0.05] },
          { geometry: box, colorHex: PALETTE_HEX.sand, position: [0, 0.08, -0.42], scale: [0.4, 0.06, 0.03] },
        ];
        break;
      }

      case 'blinker': {
        // Slim aqua crystal imp in deep-indigo robes with a floating shard crown and glowing hands
        parts = [
          { geometry: chamfer, colorHex: 0x2b2550, position: [-0.1, 0.14, 0], scale: [0.12, 0.28, 0.15] },
          { geometry: chamfer, colorHex: 0x2b2550, position: [0.1, 0.14, 0], scale: [0.12, 0.28, 0.15] },
          { geometry: cone, colorHex: 0x3a2f7a, position: [0, 0.46, 0], rotation: [Math.PI, 0, 0], scale: [0.3, 0.5, 0.26] },
          { geometry: ico, colorHex: 0x3fe0d0, position: [0, 0.6, 0.04], scale: [0.18, 0.22, 0.14] },
          { geometry: ico, colorHex: 0x8ff5ea, position: [0, 0.86, 0.02], scale: [0.2, 0.22, 0.2] },
          { geometry: cone, colorHex: 0x3fe0d0, position: [0, 1.16, -0.02], scale: [0.06, 0.18, 0.06] },
          { geometry: cone, colorHex: PALETTE_HEX.cream, position: [-0.17, 1.08, -0.02], rotation: [0, 0, 0.5], scale: [0.05, 0.15, 0.05] },
          { geometry: cone, colorHex: PALETTE_HEX.cream, position: [0.17, 1.08, -0.02], rotation: [0, 0, -0.5], scale: [0.05, 0.15, 0.05] },
          { geometry: ico, colorHex: 0x3fe0d0, position: [-0.27, 0.56, 0.12], scale: [0.08, 0.1, 0.08] },
          { geometry: ico, colorHex: 0x3fe0d0, position: [0.27, 0.56, 0.12], scale: [0.08, 0.1, 0.08] },
          { geometry: box, colorHex: 0x3a2f7a, position: [-0.21, 0.6, 0.04], rotation: [0, 0, 0.5], scale: [0.06, 0.22, 0.07] },
          { geometry: box, colorHex: 0x3a2f7a, position: [0.21, 0.6, 0.04], rotation: [0, 0, -0.5], scale: [0.06, 0.22, 0.07] },
        ];
        addEyes(parts, ico, 0.87, 0.17, 0.07, 0.035, 0xfff6c8);
        break;
      }

      case 'golem': {
        // Hulking basalt golem: dark stone blocks, glowing coral magma cracks, mossy shoulder tufts
        parts = [
          { geometry: chamfer, colorHex: 0x34303a, position: [-0.24, 0.2, 0], scale: [0.28, 0.4, 0.32] },
          { geometry: chamfer, colorHex: 0x34303a, position: [0.24, 0.2, 0], scale: [0.28, 0.4, 0.32] },
          { geometry: chamfer, colorHex: 0x4a4550, position: [0, 0.7, 0], scale: [0.86, 0.66, 0.6] },
          { geometry: box, colorHex: 0xff7a3d, position: [-0.12, 0.72, 0.31], rotation: [0, 0, 0.5], scale: [0.05, 0.42, 0.03] },
          { geometry: box, colorHex: 0xff7a3d, position: [0.14, 0.62, 0.31], rotation: [0, 0, -0.35], scale: [0.05, 0.32, 0.03] },
          { geometry: box, colorHex: 0xffb347, position: [0.02, 0.86, 0.31], scale: [0.2, 0.05, 0.03] },
          { geometry: ico, colorHex: 0x5a5560, position: [-0.52, 0.92, 0], scale: [0.3, 0.28, 0.3] },
          { geometry: ico, colorHex: 0x5a5560, position: [0.52, 0.92, 0], scale: [0.3, 0.28, 0.3] },
          { geometry: ico, colorHex: PALETTE_HEX.foliageDark, position: [-0.52, 1.12, -0.02], scale: [0.2, 0.1, 0.2] },
          { geometry: ico, colorHex: PALETTE_HEX.grass, position: [0.5, 1.13, 0.02], scale: [0.18, 0.09, 0.18] },
          { geometry: chamfer, colorHex: 0x403b46, position: [-0.56, 0.5, 0.06], scale: [0.24, 0.42, 0.26] },
          { geometry: chamfer, colorHex: 0x403b46, position: [0.56, 0.5, 0.06], scale: [0.24, 0.42, 0.26] },
          { geometry: chamfer, colorHex: 0x55505c, position: [0, 1.14, 0.08], scale: [0.36, 0.28, 0.32] },
          { geometry: ico, colorHex: PALETTE_HEX.foliageDark, position: [0.05, 1.3, 0.02], scale: [0.16, 0.08, 0.16] },
        ];
        addEyes(parts, ico, 1.15, 0.25, 0.08, 0.038, 0xff7a3d);
        break;
      }

      case 'mite': {
        // Tiny hot-orange scuttling beetle with a cream back stripe and dark head (sized for swarms)
        parts = [
          { geometry: ico, colorHex: 0xff8a1f, position: [0, 0.2, -0.04], scale: [0.3, 0.2, 0.38] },
          { geometry: box, colorHex: PALETTE_HEX.cream, position: [0, 0.37, -0.04], scale: [0.08, 0.04, 0.5] },
          { geometry: chamfer, colorHex: 0x3a2418, position: [0, 0.2, 0.3], scale: [0.22, 0.16, 0.16] },
          { geometry: box, colorHex: 0x3a2418, position: [-0.06, 0.34, 0.4], rotation: [-0.7, 0, 0.3], scale: [0.025, 0.22, 0.025] },
          { geometry: box, colorHex: 0x3a2418, position: [0.06, 0.34, 0.4], rotation: [-0.7, 0, -0.3], scale: [0.025, 0.22, 0.025] },
          { geometry: box, colorHex: 0x3a2418, position: [-0.3, 0.08, 0.1], rotation: [0, 0, 0.6], scale: [0.18, 0.035, 0.04] },
          { geometry: box, colorHex: 0x3a2418, position: [0.3, 0.08, 0.1], rotation: [0, 0, -0.6], scale: [0.18, 0.035, 0.04] },
          { geometry: box, colorHex: 0x3a2418, position: [-0.3, 0.08, -0.14], rotation: [0, 0, 0.6], scale: [0.18, 0.035, 0.04] },
          { geometry: box, colorHex: 0x3a2418, position: [0.3, 0.08, -0.14], rotation: [0, 0, -0.6], scale: [0.18, 0.035, 0.04] },
        ];
        addEyes(parts, ico, 0.24, 0.38, 0.06, 0.03, 0xffe885);
        break;
      }

      case 'tempest': {
        // Storm-forged colossus: slate-blue stone titan, gold storm core, cloud pauldrons, bolt crown
        parts = [
          { geometry: chamfer, colorHex: 0x2a3550, position: [-0.34, 0.26, 0], scale: [0.36, 0.52, 0.4] },
          { geometry: chamfer, colorHex: 0x2a3550, position: [0.34, 0.26, 0], scale: [0.36, 0.52, 0.4] },
          { geometry: chamfer, colorHex: 0x3b5a8c, position: [0, 0.98, 0], scale: [1.12, 0.92, 0.8] },
          { geometry: chamfer, colorHex: 0x324c78, position: [0, 0.6, 0.02], scale: [0.92, 0.2, 0.74] },
          { geometry: ico, colorHex: 0xffd34d, position: [0, 1.02, 0.4], scale: [0.28, 0.28, 0.16] },
          { geometry: ico, colorHex: 0xfff2b0, position: [0, 1.02, 0.47], scale: [0.14, 0.14, 0.08] },
          { geometry: ico, colorHex: 0xdfe7f2, position: [-0.7, 1.32, 0], scale: [0.36, 0.28, 0.38] },
          { geometry: ico, colorHex: 0xb8c4d6, position: [-0.86, 1.22, -0.1], scale: [0.24, 0.2, 0.26] },
          { geometry: ico, colorHex: 0xdfe7f2, position: [0.7, 1.32, 0], scale: [0.36, 0.28, 0.38] },
          { geometry: ico, colorHex: 0xb8c4d6, position: [0.86, 1.22, -0.1], scale: [0.24, 0.2, 0.26] },
          { geometry: chamfer, colorHex: 0x2f4670, position: [-0.74, 0.7, 0.08], scale: [0.3, 0.6, 0.32] },
          { geometry: chamfer, colorHex: 0x2f4670, position: [0.74, 0.7, 0.08], scale: [0.3, 0.6, 0.32] },
          { geometry: ico, colorHex: 0x46689e, position: [-0.76, 0.34, 0.12], scale: [0.24, 0.22, 0.24] },
          { geometry: ico, colorHex: 0x46689e, position: [0.76, 0.34, 0.12], scale: [0.24, 0.22, 0.24] },
          { geometry: chamfer, colorHex: 0x46689e, position: [0, 1.62, 0.06], scale: [0.48, 0.4, 0.44] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [-0.22, 1.98, 0.04], rotation: [0, 0, 0.32], scale: [0.09, 0.34, 0.09] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [0, 2.04, 0.04], scale: [0.1, 0.4, 0.1] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [0.22, 1.98, 0.04], rotation: [0, 0, -0.32], scale: [0.09, 0.34, 0.09] },
        ];
        addEyes(parts, ico, 1.64, 0.27, 0.11, 0.05, 0x9fdcff);
        break;
      }

      case 'boss':
      default: {
        // Large dark-crimson Dread Warlord with burnished gold armor trim, crown, pauldrons, and banners
        parts = [
          { geometry: chamfer, colorHex: 0x751524, position: [-0.32, 0.24, 0], scale: [0.34, 0.48, 0.38] },
          { geometry: chamfer, colorHex: 0x751524, position: [0.32, 0.24, 0], scale: [0.34, 0.48, 0.38] },
          { geometry: chamfer, colorHex: 0xa61e30, position: [0, 0.86, 0], scale: [1.08, 0.84, 0.78] },
          { geometry: chamfer, colorHex: PALETTE_HEX.gold, position: [0, 0.54, 0], scale: [1.04, 0.14, 0.8] },
          { geometry: ico, colorHex: 0xffc83b, position: [0, 0.9, 0.38], scale: [0.26, 0.26, 0.16] },
          { geometry: chamfer, colorHex: 0xd99b26, position: [-0.67, 0.98, 0], rotation: [0, 0, 0.14], scale: [0.38, 0.56, 0.5] },
          { geometry: chamfer, colorHex: 0xd99b26, position: [0.67, 0.98, 0], rotation: [0, 0, -0.14], scale: [0.38, 0.56, 0.5] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [-0.72, 1.32, 0], scale: [0.11, 0.24, 0.11] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [0.72, 1.32, 0], scale: [0.11, 0.24, 0.11] },
          { geometry: chamfer, colorHex: 0x7d1726, position: [0, 1.44, 0.06], scale: [0.52, 0.42, 0.48] },
          { geometry: box, colorHex: 0x260a10, position: [0, 1.44, 0.28], scale: [0.34, 0.11, 0.06] },
          { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 1.72, 0.06], scale: [0.31, 0.16, 0.31] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [-0.32, 1.72, 0.06], rotation: [0, 0, 0.36], scale: [0.12, 0.38, 0.12] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [0.32, 1.72, 0.06], rotation: [0, 0, -0.36], scale: [0.12, 0.38, 0.12] },
          { geometry: box, colorHex: 0xd92b3a, position: [-0.42, 1.54, -0.32], scale: [0.1, 0.62, 0.08] },
          { geometry: box, colorHex: 0xd92b3a, position: [0.42, 1.54, -0.32], scale: [0.1, 0.62, 0.08] },
        ];
        addEyes(parts, ico, 1.44, 0.3, 0.11, 0.055, eyeGlowGold);
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
    disposeInstancedMeshes(this.group);
    this.group.clear();
    for (let i = 0; i < this.geometries.length; i++) {
      this.geometries[i].dispose();
    }
    this.geometries.length = 0;
    this.layers.clear();
    this.bubbleMaterial.dispose();
    this.eliteRingMaterial.dispose();
  }
}
