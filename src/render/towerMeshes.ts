import * as THREE from 'three';
import type { TowerType } from '../core/types.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import type { TowerEntity } from '../sim/entities.ts';
import type { KenneyAssetStore } from './kenneyAssets.ts';
import { applyAlphaPreserveBlend, type MaterialLibrary } from './materials.ts';
import { TowerGeometryCache } from './towerGeometries.ts';
import { getTowerPickHeight } from './towerPicking.ts';

interface TowerInstancedBucket {
  readonly type: TowerType;
  readonly tier: 1 | 2 | 3;
  baseMesh: THREE.InstancedMesh;
  turretMesh: THREE.InstancedMesh;
  highlightArray: Float32Array;
  highlightAttr: THREE.InstancedBufferAttribute;
  capacity: number;
  readonly turretAnchorY: number;
  readonly idleSpinTurret: boolean;
  readonly bobTurret: boolean;
}

const _baseDummy = new THREE.Object3D();
const _turretLocalDummy = new THREE.Object3D();
const _turretWorldMat = new THREE.Matrix4();
const _fxDummy = new THREE.Object3D();
const SELL_ANIM_SECONDS = 0.3;

// Bucket keys are looked up per tower per frame; cache the strings so the hot path allocates nothing.
const _keyCache = new Map<string, string[]>();
function towerKey(type: TowerType, tier: number): string {
  let row = _keyCache.get(type);
  if (!row) {
    row = [`${type}_0`, `${type}_1`, `${type}_2`, `${type}_3`];
    _keyCache.set(type, row);
  }
  return row[tier] ?? `${type}_${tier}`;
}

export class TowerRenderer {
  readonly group = new THREE.Group();
  readonly geometryCache: TowerGeometryCache;
  private readonly buckets = new Map<string, TowerInstancedBucket>();
  private readonly keyCounts = new Map<string, number>();
  /** Sold towers shrinking away (render-only; the sim has already removed them). */
  private readonly soldGhosts: { type: TowerType; tier: 1 | 2 | 3; x: number; z: number; start: number }[] = [];

  private readonly stunHaloGeo: THREE.BufferGeometry;
  private readonly stunHaloMat: THREE.MeshBasicMaterial;
  private stunHaloMesh: THREE.InstancedMesh;
  private stunHaloCapacity = 64;

  private readonly overchargeAuraGeo: THREE.BufferGeometry;
  private readonly overchargeAuraMat: THREE.MeshBasicMaterial;
  private overchargeAuraMesh: THREE.InstancedMesh;
  private overchargeAuraCapacity = 64;

  private readonly buffRingGeo: THREE.BufferGeometry;
  private readonly buffRingMat: THREE.MeshBasicMaterial;
  private buffRingMesh: THREE.InstancedMesh;
  private buffRingCapacity = 64;

  constructor(assets: KenneyAssetStore) {
    this.geometryCache = new TowerGeometryCache(assets);

    this.stunHaloGeo = new THREE.TorusGeometry(0.46, 0.065, 6, 12);
    this.stunHaloGeo.rotateX(Math.PI / 2);
    this.stunHaloMat = new THREE.MeshBasicMaterial({
      color: 0xd94fff,
      toneMapped: false,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    applyAlphaPreserveBlend(this.stunHaloMat);
    this.stunHaloMesh = new THREE.InstancedMesh(
      this.stunHaloGeo,
      this.stunHaloMat,
      this.stunHaloCapacity,
    );
    this.stunHaloMesh.count = 0;
    this.stunHaloMesh.visible = false;
    this.stunHaloMesh.frustumCulled = false;
    this.stunHaloMesh.renderOrder = 12;
    this.group.add(this.stunHaloMesh);

    this.overchargeAuraGeo = new THREE.RingGeometry(0.74, 0.94, 24);
    this.overchargeAuraGeo.rotateX(-Math.PI / 2);
    this.overchargeAuraMat = new THREE.MeshBasicMaterial({
      color: PALETTE_HEX.gold,
      toneMapped: false,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    applyAlphaPreserveBlend(this.overchargeAuraMat);
    this.overchargeAuraMesh = new THREE.InstancedMesh(
      this.overchargeAuraGeo,
      this.overchargeAuraMat,
      this.overchargeAuraCapacity,
    );
    this.overchargeAuraMesh.count = 0;
    this.overchargeAuraMesh.visible = false;
    this.overchargeAuraMesh.frustumCulled = false;
    this.overchargeAuraMesh.renderOrder = 4;
    this.group.add(this.overchargeAuraMesh);

    // Beacon buff marker: a thin cyan ring under every tower currently receiving a Beacon aura.
    this.buffRingGeo = new THREE.RingGeometry(0.62, 0.7, 24);
    this.buffRingGeo.rotateX(-Math.PI / 2);
    this.buffRingMat = new THREE.MeshBasicMaterial({
      color: PALETTE_HEX.water,
      toneMapped: false,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    applyAlphaPreserveBlend(this.buffRingMat);
    this.buffRingMesh = new THREE.InstancedMesh(this.buffRingGeo, this.buffRingMat, this.buffRingCapacity);
    this.buffRingMesh.count = 0;
    this.buffRingMesh.visible = false;
    this.buffRingMesh.frustumCulled = false;
    this.buffRingMesh.renderOrder = 4;
    this.group.add(this.buffRingMesh);
  }

  /** Start the sell-out animation for a tower the sim just removed. */
  addSoldGhost(type: TowerType, tier: number, x: number, z: number): void {
    if (this.soldGhosts.length >= 12) this.soldGhosts.shift();
    this.soldGhosts.push({ type, tier: (tier >= 3 ? 3 : tier <= 1 ? 1 : 2) as 1 | 2 | 3, x, z, start: -1 });
  }

  syncTowers(
    towers: readonly TowerEntity[],
    materials: MaterialLibrary,
    alpha: number,
    elapsedTime: number,
    hoveredTowerId: number | null = null,
    overchargeActive = false,
  ): void {
    this.keyCounts.clear();
    for (let i = this.soldGhosts.length - 1; i >= 0; i--) {
      const g = this.soldGhosts[i];
      if (g.start < 0) g.start = elapsedTime;
      if (elapsedTime - g.start >= SELL_ANIM_SECONDS || elapsedTime < g.start) {
        this.soldGhosts.splice(i, 1);
        continue;
      }
      const gk = towerKey(g.type, g.tier);
      this.keyCounts.set(gk, (this.keyCounts.get(gk) ?? 0) + 1);
    }
    let stunnedCount = 0;
    let overchargedCount = 0;
    let buffedCount = 0;
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      const key = towerKey(t.type, t.tier);
      this.keyCounts.set(key, (this.keyCounts.get(key) ?? 0) + 1);
      if (t.stunTimer > 0) stunnedCount++;
      else if (overchargeActive) overchargedCount++;
      if (t.auraRate > 0 && t.stunTimer <= 0) buffedCount++;
    }

    this.ensureFxCapacities(stunnedCount, overchargedCount);
    if (buffedCount > this.buffRingCapacity) {
      this.group.remove(this.buffRingMesh);
      this.buffRingMesh.dispose();
      this.buffRingCapacity = buffedCount + 32;
      this.buffRingMesh = new THREE.InstancedMesh(this.buffRingGeo, this.buffRingMat, this.buffRingCapacity);
      this.buffRingMesh.frustumCulled = false;
      this.buffRingMesh.renderOrder = 4;
      this.group.add(this.buffRingMesh);
    }
    let buffSlot = 0;

    this.buckets.forEach((bucket) => {
      bucket.baseMesh.count = 0;
      bucket.turretMesh.count = 0;
      bucket.baseMesh.visible = false;
      bucket.turretMesh.visible = false;
    });

    let stunSlot = 0;
    let overchargeSlot = 0;

    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      const key = towerKey(t.type, t.tier);
      const needed = this.keyCounts.get(key) ?? 1;
      const bucket = this.ensureBucket(key, t.type, t.tier, materials, needed);

      const stunned = t.stunTimer > 0;
      const slot = bucket.baseMesh.count;
      bucket.baseMesh.count = slot + 1;
      bucket.turretMesh.count = slot + 1;

      if (overchargeActive && !stunned) {
        const pulseGlow = 0.72 + 0.28 * Math.sin(elapsedTime * 7.5 + t.id);
        bucket.highlightArray[slot] = t.id === hoveredTowerId ? 1.45 : pulseGlow;
      } else if (stunned) {
        bucket.highlightArray[slot] = t.id === hoveredTowerId ? 0.5 : 0;
      } else {
        bucket.highlightArray[slot] = t.id === hoveredTowerId ? 1 : 0;
      }
      if (t.popAnimTimer > 0 && !stunned) {
        // Build / upgrade flash: bright at the start of the pop, fading as it settles.
        const flash = (t.popAnimTimer / 0.32) * 0.95;
        if (flash > bucket.highlightArray[slot]) bucket.highlightArray[slot] = flash;
      }

      // Squash-and-stretch pop animation on build & upgrade
      let sxz = 1;
      let sy = 1;
      if (t.popAnimTimer > 0) {
        const p = 1 - t.popAnimTimer / 0.32;
        const bounce = Math.sin(p * Math.PI);
        sy = p < 0.5 ? 0.45 + p * 1.6 : 1.0 + bounce * 0.28;
        sxz = p < 0.5 ? 1.28 - p * 0.45 : 1.0 - bounce * 0.14;
      }

      _baseDummy.position.set(t.x, 0, t.z);
      _baseDummy.rotation.set(0, 0, 0);
      _baseDummy.scale.set(sxz, sy, sxz);
      _baseDummy.updateMatrix();
      bucket.baseMesh.setMatrixAt(slot, _baseDummy.matrix);

      // Smoothly interpolate turret yaw + recoil kickback + idle bob/spin (frozen/drooped when stunned)
      let dyaw = t.yaw - t.prevYaw;
      if (dyaw > Math.PI) dyaw -= Math.PI * 2;
      if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const interpYaw = t.prevYaw + dyaw * alpha;

      let turretYaw: number;
      let bobOffset: number;
      let droopTiltX = 0;
      let jamTiltZ = 0;

      if (stunned) {
        turretYaw = interpYaw;
        bobOffset = -0.08;
        droopTiltX = 0.22 + Math.cos(elapsedTime * 31 + t.id * 1.7) * 0.05;
        jamTiltZ = Math.sin(elapsedTime * 38 + t.id * 3.1) * 0.08;
      } else {
        const spinRate = overchargeActive ? 2.5 : 1.35;
        const bobRate = overchargeActive ? 5.4 : 3.0;
        const bobAmp = overchargeActive ? 0.12 : 0.09;
        turretYaw = bucket.idleSpinTurret ? elapsedTime * spinRate + t.id : interpYaw;
        bobOffset = bucket.bobTurret ? Math.sin(elapsedTime * bobRate + t.id) * bobAmp : 0;
      }

      const recoilScale = 1 + t.recoil * 0.08 + (overchargeActive && !stunned ? 0.03 : 0);

      _turretLocalDummy.position.set(
        -Math.sin(interpYaw) * t.recoil * 0.1,
        bucket.turretAnchorY + bobOffset,
        -Math.cos(interpYaw) * t.recoil * 0.1,
      );
      _turretLocalDummy.rotation.set(droopTiltX, turretYaw, jamTiltZ);
      _turretLocalDummy.scale.setScalar(recoilScale);
      _turretLocalDummy.updateMatrix();

      _turretWorldMat.multiplyMatrices(_baseDummy.matrix, _turretLocalDummy.matrix);
      bucket.turretMesh.setMatrixAt(slot, _turretWorldMat);

      if (t.auraRate > 0 && !stunned) {
        const pulse = 1 + Math.sin(elapsedTime * 3.2 + t.id * 1.3) * 0.06;
        _fxDummy.position.set(t.x, 0.05, t.z);
        _fxDummy.rotation.set(0, -elapsedTime * 0.9 + t.id, 0);
        _fxDummy.scale.setScalar(pulse);
        _fxDummy.updateMatrix();
        this.buffRingMesh.setMatrixAt(buffSlot++, _fxDummy.matrix);
      }

      if (stunned) {
        const topY = getTowerPickHeight(t.type, t.tier);
        const wobble = Math.sin(elapsedTime * 7.0 + t.id) * 0.16;
        _fxDummy.position.set(t.x, topY + 0.08 + Math.sin(elapsedTime * 5.0 + t.id) * 0.05, t.z);
        _fxDummy.rotation.set(wobble, elapsedTime * 2.8 + t.id, -wobble);
        _fxDummy.scale.setScalar(0.95 + Math.sin(elapsedTime * 9.0 + t.id) * 0.08);
        _fxDummy.updateMatrix();
        this.stunHaloMesh.setMatrixAt(stunSlot++, _fxDummy.matrix);
      } else if (overchargeActive) {
        const pulse = 0.96 + Math.sin(elapsedTime * 6.5 + t.id * 0.9) * 0.12;
        _fxDummy.position.set(t.x, 0.06, t.z);
        _fxDummy.rotation.set(0, elapsedTime * 1.4, 0);
        _fxDummy.scale.setScalar(pulse);
        _fxDummy.updateMatrix();
        this.overchargeAuraMesh.setMatrixAt(overchargeSlot++, _fxDummy.matrix);
      }
    }

    for (let i = 0; i < this.soldGhosts.length; i++) {
      const g = this.soldGhosts[i];
      const bucket = this.ensureBucket(
        towerKey(g.type, g.tier),
        g.type,
        g.tier,
        materials,
        this.keyCounts.get(towerKey(g.type, g.tier)) ?? 1,
      );
      const p = Math.min(1, (elapsedTime - g.start) / SELL_ANIM_SECONDS);
      // Quick anticipation hop, then collapse into the ground.
      const shrink = p < 0.18 ? 1 + p * 0.6 : Math.max(0.001, 1 - ((p - 0.18) / 0.82) ** 1.6);
      const slot = bucket.baseMesh.count;
      bucket.baseMesh.count = slot + 1;
      bucket.turretMesh.count = slot + 1;
      bucket.highlightArray[slot] = 0.9 * (1 - p);
      _baseDummy.position.set(g.x, 0, g.z);
      _baseDummy.rotation.set(0, p * 1.8, 0);
      _baseDummy.scale.set(shrink, shrink, shrink);
      _baseDummy.updateMatrix();
      bucket.baseMesh.setMatrixAt(slot, _baseDummy.matrix);
      _turretLocalDummy.position.set(0, bucket.turretAnchorY, 0);
      _turretLocalDummy.rotation.set(0, 0, 0);
      _turretLocalDummy.scale.setScalar(1);
      _turretLocalDummy.updateMatrix();
      _turretWorldMat.multiplyMatrices(_baseDummy.matrix, _turretLocalDummy.matrix);
      bucket.turretMesh.setMatrixAt(slot, _turretWorldMat);
    }

    this.buckets.forEach((bucket) => {
      if (bucket.baseMesh.count > 0) {
        bucket.baseMesh.visible = true;
        bucket.turretMesh.visible = true;
        bucket.baseMesh.instanceMatrix.needsUpdate = true;
        bucket.turretMesh.instanceMatrix.needsUpdate = true;
        bucket.highlightAttr.needsUpdate = true;
      }
    });

    this.stunHaloMesh.count = stunSlot;
    this.stunHaloMesh.visible = stunSlot > 0;
    if (stunSlot > 0) {
      this.stunHaloMesh.instanceMatrix.needsUpdate = true;
    }

    this.buffRingMesh.count = buffSlot;
    this.buffRingMesh.visible = buffSlot > 0;
    if (buffSlot > 0) {
      this.buffRingMesh.instanceMatrix.needsUpdate = true;
    }

    this.overchargeAuraMesh.count = overchargeSlot;
    this.overchargeAuraMesh.visible = overchargeSlot > 0;
    if (overchargeSlot > 0) {
      this.overchargeAuraMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private ensureFxCapacities(stunNeeded: number, overchargeNeeded: number): void {
    if (stunNeeded > this.stunHaloCapacity) {
      this.group.remove(this.stunHaloMesh);
      this.stunHaloMesh.dispose();
      this.stunHaloCapacity = stunNeeded + 32;
      this.stunHaloMesh = new THREE.InstancedMesh(
        this.stunHaloGeo,
        this.stunHaloMat,
        this.stunHaloCapacity,
      );
      this.stunHaloMesh.frustumCulled = false;
      this.stunHaloMesh.renderOrder = 12;
      this.group.add(this.stunHaloMesh);
    }

    if (overchargeNeeded > this.overchargeAuraCapacity) {
      this.group.remove(this.overchargeAuraMesh);
      this.overchargeAuraMesh.dispose();
      this.overchargeAuraCapacity = overchargeNeeded + 32;
      this.overchargeAuraMesh = new THREE.InstancedMesh(
        this.overchargeAuraGeo,
        this.overchargeAuraMat,
        this.overchargeAuraCapacity,
      );
      this.overchargeAuraMesh.frustumCulled = false;
      this.overchargeAuraMesh.renderOrder = 4;
      this.group.add(this.overchargeAuraMesh);
    }
  }

  private ensureBucket(
    key: string,
    type: TowerType,
    tier: 1 | 2 | 3,
    materials: MaterialLibrary,
    neededCapacity: number,
  ): TowerInstancedBucket {
    let bucket = this.buckets.get(key);
    if (bucket && bucket.capacity >= neededCapacity) {
      return bucket;
    }

    const prevCount = bucket ? bucket.baseMesh.count : 0;
    const capacity = Math.max(64, neededCapacity + 16);
    const pair = this.geometryCache.get(type, tier);

    const newBase = new THREE.InstancedMesh(pair.base, materials.kenneyTower, capacity);
    newBase.count = prevCount;
    newBase.visible = prevCount > 0;
    newBase.castShadow = true;
    newBase.receiveShadow = true;
    newBase.frustumCulled = false;

    const newTurret = new THREE.InstancedMesh(pair.turret, materials.kenneyTower, capacity);
    newTurret.count = prevCount;
    newTurret.visible = prevCount > 0;
    newTurret.castShadow = false;
    newTurret.receiveShadow = true;
    newTurret.frustumCulled = false;

    const highlightArray = new Float32Array(capacity);
    const highlightAttr = new THREE.InstancedBufferAttribute(highlightArray, 1);
    highlightAttr.setUsage(THREE.DynamicDrawUsage);
    pair.base.setAttribute('aHighlight', highlightAttr);
    pair.turret.setAttribute('aHighlight', highlightAttr);

    if (bucket) {
      highlightArray.set(bucket.highlightArray.subarray(0, prevCount));
      for (let s = 0; s < prevCount; s++) {
        bucket.baseMesh.getMatrixAt(s, _turretWorldMat);
        newBase.setMatrixAt(s, _turretWorldMat);
        bucket.turretMesh.getMatrixAt(s, _turretWorldMat);
        newTurret.setMatrixAt(s, _turretWorldMat);
      }
      this.group.remove(bucket.baseMesh, bucket.turretMesh);
      bucket.baseMesh.dispose();
      bucket.turretMesh.dispose();
      bucket.baseMesh = newBase;
      bucket.turretMesh = newTurret;
      bucket.highlightArray = highlightArray;
      bucket.highlightAttr = highlightAttr;
      bucket.capacity = capacity;
      this.group.add(newBase, newTurret);
      return bucket;
    }

    this.group.add(newBase, newTurret);
    bucket = {
      type,
      tier,
      baseMesh: newBase,
      turretMesh: newTurret,
      highlightArray,
      highlightAttr,
      capacity,
      turretAnchorY: pair.turretAnchorY,
      idleSpinTurret: pair.idleSpinTurret,
      bobTurret: pair.bobTurret,
    };
    this.buckets.set(key, bucket);
    return bucket;
  }

  clearInstances(): void {
    this.soldGhosts.length = 0;
    this.buckets.forEach((bucket) => {
      bucket.baseMesh.count = 0;
      bucket.turretMesh.count = 0;
      bucket.baseMesh.visible = false;
      bucket.turretMesh.visible = false;
    });
    this.stunHaloMesh.count = 0;
    this.stunHaloMesh.visible = false;
    this.overchargeAuraMesh.count = 0;
    this.overchargeAuraMesh.visible = false;
    this.buffRingMesh.count = 0;
    this.buffRingMesh.visible = false;
  }

  dispose(): void {
    this.buckets.forEach((bucket) => {
      bucket.baseMesh.dispose();
      bucket.turretMesh.dispose();
    });
    this.stunHaloMesh.dispose();
    this.overchargeAuraMesh.dispose();
    this.buffRingMesh.dispose();
    this.buffRingGeo.dispose();
    this.buffRingMat.dispose();
    this.stunHaloGeo.dispose();
    this.stunHaloMat.dispose();
    this.overchargeAuraGeo.dispose();
    this.overchargeAuraMat.dispose();
    this.group.clear();
    this.buckets.clear();
    this.geometryCache.dispose();
  }
}
