import * as THREE from 'three';
import type { TowerType } from '../core/types.ts';
import type { TowerEntity } from '../sim/entities.ts';
import type { KenneyAssetStore } from './kenneyAssets.ts';
import type { MaterialLibrary } from './materials.ts';
import { TowerGeometryCache } from './towerGeometries.ts';

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

export class TowerRenderer {
  readonly group = new THREE.Group();
  readonly geometryCache: TowerGeometryCache;
  private readonly buckets = new Map<string, TowerInstancedBucket>();
  private readonly keyCounts = new Map<string, number>();

  constructor(assets: KenneyAssetStore) {
    this.geometryCache = new TowerGeometryCache(assets);
  }

  syncTowers(
    towers: readonly TowerEntity[],
    materials: MaterialLibrary,
    alpha: number,
    elapsedTime: number,
    hoveredTowerId: number | null = null,
  ): void {
    this.keyCounts.clear();
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      const key = `${t.type}_${t.tier}`;
      this.keyCounts.set(key, (this.keyCounts.get(key) ?? 0) + 1);
    }

    this.buckets.forEach((bucket) => {
      bucket.baseMesh.count = 0;
      bucket.turretMesh.count = 0;
      bucket.baseMesh.visible = false;
      bucket.turretMesh.visible = false;
    });

    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      const key = `${t.type}_${t.tier}`;
      const needed = this.keyCounts.get(key) ?? 1;
      const bucket = this.ensureBucket(key, t.type, t.tier, materials, needed);

      const slot = bucket.baseMesh.count;
      bucket.baseMesh.count = slot + 1;
      bucket.turretMesh.count = slot + 1;
      bucket.highlightArray[slot] = t.id === hoveredTowerId ? 1 : 0;

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

      // Smoothly interpolate turret yaw + recoil kickback + idle bob/spin
      let dyaw = t.yaw - t.prevYaw;
      if (dyaw > Math.PI) dyaw -= Math.PI * 2;
      if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const interpYaw = t.prevYaw + dyaw * alpha;
      const turretYaw = bucket.idleSpinTurret ? elapsedTime * 1.35 + t.id : interpYaw;
      const bobOffset = bucket.bobTurret ? Math.sin(elapsedTime * 3.0 + t.id) * 0.09 : 0;
      const recoilScale = 1 + t.recoil * 0.08;

      _turretLocalDummy.position.set(
        -Math.sin(interpYaw) * t.recoil * 0.1,
        bucket.turretAnchorY + bobOffset,
        -Math.cos(interpYaw) * t.recoil * 0.1,
      );
      _turretLocalDummy.rotation.set(0, turretYaw, 0);
      _turretLocalDummy.scale.setScalar(recoilScale);
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
    this.buckets.forEach((bucket) => {
      bucket.baseMesh.count = 0;
      bucket.turretMesh.count = 0;
      bucket.baseMesh.visible = false;
      bucket.turretMesh.visible = false;
    });
  }

  dispose(): void {
    this.buckets.forEach((bucket) => {
      bucket.baseMesh.dispose();
      bucket.turretMesh.dispose();
    });
    this.group.clear();
    this.buckets.clear();
    this.geometryCache.dispose();
  }
}
