import * as THREE from 'three';
import type { ObjectPool } from '../core/pool.ts';
import type { TowerType } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import type { ProjectileEntity } from '../sim/entities.ts';
import { mergeColoredParts } from './geometryHelpers.ts';
import type { MaterialLibrary } from './materials.ts';

const _dummy = new THREE.Object3D();

export class ProjectileRenderer {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<TowerType, THREE.InstancedMesh>();
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(materials: MaterialLibrary) {
    const cap = BALANCE.pools.maxProjectiles;
    const types: TowerType[] = ['archer', 'cannon', 'frost', 'mortar'];

    for (let i = 0; i < types.length; i++) {
      const type = types[i];
      const geo = this.buildProjectileGeo(type);
      this.geometries.push(geo);
      const mesh = new THREE.InstancedMesh(geo, materials.vertexColored, cap);
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

  private buildProjectileGeo(type: TowerType): THREE.BufferGeometry {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cone = new THREE.ConeGeometry(1, 1, 5);
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const oct = new THREE.OctahedronGeometry(1, 0);

    let geo: THREE.BufferGeometry;
    switch (type) {
      case 'archer':
        geo = mergeColoredParts([
          { geometry: box, colorHex: PALETTE_HEX.dirt, position: [0, 0, -0.1], scale: [0.07, 0.07, 0.56] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [0, 0, 0.24], rotation: [Math.PI / 2, 0, 0], scale: [0.09, 0.22, 0.09] },
          { geometry: box, colorHex: PALETTE_HEX.cream, position: [0, 0, -0.34], scale: [0.14, 0.04, 0.14] },
        ]);
        break;
      case 'cannon':
        geo = mergeColoredParts([
          { geometry: ico, colorHex: PALETTE_HEX.indigo, scale: [0.22, 0.22, 0.22] },
        ]);
        break;
      case 'frost':
        geo = mergeColoredParts([
          { geometry: oct, colorHex: PALETTE_HEX.water, scale: [0.14, 0.14, 0.34] },
          { geometry: oct, colorHex: PALETTE_HEX.cream, rotation: [0, 0, Math.PI / 4], scale: [0.1, 0.1, 0.28] },
        ]);
        break;
      case 'mortar':
      default:
        geo = mergeColoredParts([
          { geometry: ico, colorHex: PALETTE_HEX.indigo, scale: [0.26, 0.26, 0.34] },
          { geometry: cone, colorHex: PALETTE_HEX.coral, position: [0, 0, 0.24], rotation: [Math.PI / 2, 0, 0], scale: [0.22, 0.28, 0.22] },
          { geometry: box, colorHex: PALETTE_HEX.gold, position: [0, 0, -0.22], scale: [0.36, 0.06, 0.14] },
        ]);
        break;
    }

    box.dispose();
    cone.dispose();
    ico.dispose();
    oct.dispose();
    return geo;
  }

  dispose(): void {
    this.group.clear();
    for (let i = 0; i < this.geometries.length; i++) {
      this.geometries[i].dispose();
    }
    this.geometries.length = 0;
    this.meshes.clear();
  }
}
