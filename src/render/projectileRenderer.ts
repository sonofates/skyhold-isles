import * as THREE from 'three';
import type { ObjectPool } from '../core/pool.ts';
import type { TowerType } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import type { ProjectileEntity } from '../sim/entities.ts';
import { disposeInstancedMeshes, mergeTexturedParts } from './geometryHelpers.ts';
import type { KenneyAssetStore } from './kenneyAssets.ts';
import { remapUvCell } from './kenneyPalette.ts';
import type { MaterialLibrary } from './materials.ts';

const _dummy = new THREE.Object3D();

export class ProjectileRenderer {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<TowerType, THREE.InstancedMesh>();
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(materials: MaterialLibrary, assets: KenneyAssetStore) {
    const cap = BALANCE.pools.maxProjectiles;
    const types: TowerType[] = ['archer', 'cannon', 'frost', 'mortar'];

    for (let i = 0; i < types.length; i++) {
      const type = types[i];
      const geo = this.buildProjectileGeo(type, assets);
      this.geometries.push(geo);
      const mat = type === 'frost' ? materials.frostProjectile : materials.kenneyProjectile;
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.count = 0;
      mesh.visible = false;
      mesh.castShadow = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.meshes.set(type, mesh);
    }
  }

  update(pool: ObjectPool<ProjectileEntity>, alpha: number): void {
    this.meshes.forEach((m) => {
      m.count = 0;
    });

    const activeCount = pool.getActiveCount();
    for (let i = 0; i < activeCount; i++) {
      const p = pool.items[pool.getActiveIndex(i)];
      const mesh = this.meshes.get(p.towerType);
      if (!mesh) continue;

      const slot = mesh.count;
      mesh.count = slot + 1;

      const ix = p.prevX + (p.x - p.prevX) * alpha;
      const iy = p.prevY + (p.y - p.prevY) * alpha;
      const iz = p.prevZ + (p.z - p.prevZ) * alpha;

      let dyaw = p.yaw - p.prevYaw;
      if (dyaw > Math.PI) dyaw -= Math.PI * 2;
      if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const iyaw = p.prevYaw + dyaw * alpha;

      // Tilt parabolic projectiles along flight arc tangent
      let pitch = 0;
      if (p.parabolic) {
        const slope = 4 * p.arcHeight * (1 - 2 * Math.min(1, p.progress));
        pitch = -Math.atan2(slope, Math.max(1, Math.hypot(p.endX - p.startX, p.endZ - p.startZ))) * 0.65;
      }

      _dummy.position.set(ix, iy, iz);
      _dummy.rotation.set(pitch, iyaw, 0);
      _dummy.scale.setScalar(1);
      _dummy.updateMatrix();
      mesh.setMatrixAt(slot, _dummy.matrix);
    }

    this.meshes.forEach((m) => {
      m.visible = m.count > 0;
      if (m.count > 0) m.instanceMatrix.needsUpdate = true;
    });
  }

  clear(): void {
    this.meshes.forEach((m) => {
      m.count = 0;
      m.visible = false;
    });
  }

  private buildProjectileGeo(type: TowerType, assets: KenneyAssetStore): THREE.BufferGeometry {
    switch (type) {
      case 'archer': {
        const arrow = assets.cloneGeometry('weapon-ammo-arrow');
        const geo = mergeTexturedParts([
          { geometry: arrow, colorHex: PALETTE_HEX.gold, scale: [1.05, 1.05, 0.92] },
        ]);
        arrow.dispose();
        return geo;
      }
      case 'cannon': {
        const ball = assets.cloneGeometry('weapon-ammo-cannonball');
        const geo = mergeTexturedParts([
          { geometry: ball, scale: [1.55, 1.55, 1.55] },
        ]);
        ball.dispose();
        return geo;
      }
      case 'frost': {
        const crystal = remapUvCell(assets.cloneGeometry('detail-crystal'), [2, 1], [0, 3]);
        const geo = mergeTexturedParts([
          { geometry: crystal, position: [0, 0, -0.22], rotation: [Math.PI / 2, 0, 0], scale: [1.1, 1.15, 1.1] },
        ]);
        crystal.dispose();
        return geo;
      }
      case 'mortar':
      default: {
        const boulder = assets.cloneGeometry('weapon-ammo-boulder');
        const geo = mergeTexturedParts([
          { geometry: boulder, colorHex: 0xffb380, scale: [2.2, 2.2, 2.2] },
        ]);
        boulder.dispose();
        return geo;
      }
    }
  }

  dispose(): void {
    disposeInstancedMeshes(this.group);
    this.group.clear();
    for (let i = 0; i < this.geometries.length; i++) {
      this.geometries[i].dispose();
    }
    this.geometries.length = 0;
    this.meshes.clear();
  }
}
