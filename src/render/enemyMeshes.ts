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
      // Large armored units cast directional PCF shadows; flyers & nimble troops use shared contact shadow decals
      mesh.castShadow = type === 'brute' || type === 'boss';
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;

      // Initialize instance colors to white so vertex colors show cleanly
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

    // Shared soft shadow decals under flyers and lighter ground units (1 draw call total)
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
    // Reset active instance counts
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

      // Interpolate yaw smoothly across -PI..PI wrap
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

      // Frost tint when slowed, white otherwise
      if (e.slowTimer > 0) {
        _color.copy(_white).lerp(_frostTint, Math.min(1, 0.55 + e.slowRatio));
      } else {
        _color.copy(_white);
      }
      layer.mesh.setColorAt(slot, _color);

      // Hit flash emissive pulse
      layer.flashArray[slot] = e.hitFlashTimer > 0 ? Math.min(1, e.hitFlashTimer / 0.12) : 0;

      // Contact shadow decals under flyers (spatial lane marker) and lighter ground troops
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

      // Billboarded HP bar (only visible when damaged)
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
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cone = new THREE.ConeGeometry(1, 1, 5);
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 6);

    let parts: ColoredPart[] = [];
    switch (type) {
      case 'grunt':
        parts = [
          { geometry: box, colorHex: PALETTE_HEX.dirt, position: [-0.14, 0.14, 0], scale: [0.16, 0.28, 0.18] },
          { geometry: box, colorHex: PALETTE_HEX.dirt, position: [0.14, 0.14, 0], scale: [0.16, 0.28, 0.18] },
          { geometry: box, colorHex: PALETTE_HEX.coral, position: [0, 0.46, 0], scale: [0.44, 0.42, 0.34] },
          { geometry: box, colorHex: PALETTE_HEX.cream, position: [0, 0.78, 0.02], scale: [0.3, 0.28, 0.28] },
          { geometry: cone, colorHex: PALETTE_HEX.stone, position: [0, 0.96, 0], scale: [0.24, 0.22, 0.24] },
          { geometry: box, colorHex: PALETTE_HEX.stone, position: [-0.28, 0.48, 0.12], scale: [0.1, 0.34, 0.28] },
        ];
        break;
      case 'runner':
        parts = [
          { geometry: box, colorHex: PALETTE_HEX.indigo, position: [-0.12, 0.15, 0], scale: [0.13, 0.3, 0.16] },
          { geometry: box, colorHex: PALETTE_HEX.indigo, position: [0.12, 0.15, 0], scale: [0.13, 0.3, 0.16] },
          { geometry: box, colorHex: PALETTE_HEX.coral, position: [0, 0.46, 0], scale: [0.34, 0.38, 0.28] },
          { geometry: ico, colorHex: PALETTE_HEX.cream, position: [0, 0.74, 0.04], scale: [0.18, 0.18, 0.18] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [0, 0.8, -0.2], rotation: [-1.1, 0, 0], scale: [0.12, 0.34, 0.12] },
          { geometry: box, colorHex: PALETTE_HEX.gold, position: [0, 0.56, -0.18], scale: [0.28, 0.1, 0.14] },
        ];
        break;
      case 'brute':
        parts = [
          { geometry: box, colorHex: PALETTE_HEX.indigo, position: [-0.2, 0.18, 0], scale: [0.22, 0.36, 0.26] },
          { geometry: box, colorHex: PALETTE_HEX.indigo, position: [0.2, 0.18, 0], scale: [0.22, 0.36, 0.26] },
          { geometry: box, colorHex: PALETTE_HEX.stone, position: [0, 0.62, 0], scale: [0.74, 0.58, 0.52] },
          { geometry: box, colorHex: PALETTE_HEX.coral, position: [0, 0.44, 0.04], scale: [0.58, 0.18, 0.5] },
          { geometry: box, colorHex: PALETTE_HEX.stone, position: [-0.46, 0.74, 0], scale: [0.24, 0.32, 0.36] },
          { geometry: box, colorHex: PALETTE_HEX.stone, position: [0.46, 0.74, 0], scale: [0.24, 0.32, 0.36] },
          { geometry: box, colorHex: PALETTE_HEX.indigo, position: [0, 1.02, 0.04], scale: [0.36, 0.3, 0.34] },
          { geometry: cone, colorHex: PALETTE_HEX.cream, position: [-0.22, 1.2, 0.04], rotation: [0, 0, 0.4], scale: [0.09, 0.26, 0.09] },
          { geometry: cone, colorHex: PALETTE_HEX.cream, position: [0.22, 1.2, 0.04], rotation: [0, 0, -0.4], scale: [0.09, 0.26, 0.09] },
        ];
        break;
      case 'flyer':
        parts = [
          { geometry: cone, colorHex: PALETTE_HEX.indigo, position: [0, 0.1, 0.08], rotation: [Math.PI / 2, 0, 0], scale: [0.2, 0.78, 0.18] },
          { geometry: box, colorHex: PALETTE_HEX.cream, position: [-0.46, 0.14, -0.04], rotation: [0, -0.28, 0.08], scale: [0.68, 0.06, 0.32] },
          { geometry: box, colorHex: PALETTE_HEX.cream, position: [0.46, 0.14, -0.04], rotation: [0, 0.28, -0.08], scale: [0.68, 0.06, 0.32] },
          { geometry: box, colorHex: PALETTE_HEX.water, position: [0, 0.22, -0.28], scale: [0.07, 0.24, 0.26] },
          { geometry: ico, colorHex: PALETTE_HEX.gold, position: [0, 0.14, 0.18], scale: [0.13, 0.13, 0.16] },
        ];
        break;
      case 'healer':
        parts = [
          { geometry: cyl, colorHex: PALETTE_HEX.foliageDark, position: [0, 0.38, 0], scale: [0.24, 0.72, 0.24] },
          { geometry: cyl, colorHex: PALETTE_HEX.grass, position: [0, 0.56, 0], scale: [0.2, 0.34, 0.2] },
          { geometry: ico, colorHex: PALETTE_HEX.cream, position: [0, 0.86, 0], scale: [0.19, 0.2, 0.19] },
          { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 1.16, 0], scale: [0.18, 0.05, 0.18] },
          { geometry: cyl, colorHex: PALETTE_HEX.dirt, position: [0.3, 0.56, 0.12], scale: [0.045, 0.92, 0.045] },
          { geometry: ico, colorHex: PALETTE_HEX.gold, position: [0.3, 1.06, 0.12], scale: [0.12, 0.14, 0.12] },
        ];
        break;
      case 'boss':
        parts = [
          { geometry: box, colorHex: PALETTE_HEX.indigo, position: [-0.32, 0.24, 0], scale: [0.34, 0.48, 0.38] },
          { geometry: box, colorHex: PALETTE_HEX.indigo, position: [0.32, 0.24, 0], scale: [0.34, 0.48, 0.38] },
          { geometry: box, colorHex: PALETTE_HEX.indigo, position: [0, 0.86, 0], scale: [1.06, 0.84, 0.76] },
          { geometry: ico, colorHex: PALETTE_HEX.coral, position: [0, 0.86, 0.36], scale: [0.24, 0.24, 0.16] },
          { geometry: box, colorHex: PALETTE_HEX.stone, position: [-0.66, 0.96, 0], scale: [0.36, 0.54, 0.48] },
          { geometry: box, colorHex: PALETTE_HEX.stone, position: [0.66, 0.96, 0], scale: [0.36, 0.54, 0.48] },
          { geometry: box, colorHex: PALETTE_HEX.indigo, position: [0, 1.44, 0.05], scale: [0.52, 0.4, 0.46] },
          { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 1.72, 0.05], scale: [0.3, 0.18, 0.3] },
          { geometry: cone, colorHex: PALETTE_HEX.coral, position: [-0.32, 1.7, 0.05], rotation: [0, 0, 0.35], scale: [0.12, 0.36, 0.12] },
          { geometry: cone, colorHex: PALETTE_HEX.coral, position: [0.32, 1.7, 0.05], rotation: [0, 0, -0.35], scale: [0.12, 0.36, 0.12] },
        ];
        break;
    }

    const merged = mergeColoredParts(parts);
    box.dispose();
    cone.dispose();
    ico.dispose();
    cyl.dispose();
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
