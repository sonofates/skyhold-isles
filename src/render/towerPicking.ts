import * as THREE from 'three';
import type { TowerType } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import type { TowerEntity } from '../sim/entities.ts';

export interface TowerPickBounds {
  readonly halfWidth: number;
  readonly height: number;
}

const DEFAULT_HALF_WIDTH = BALANCE.tileSize * 0.44;

export const TOWER_PICK_BOUNDS: Record<TowerType, readonly [TowerPickBounds, TowerPickBounds, TowerPickBounds]> = {
  archer: [
    { halfWidth: DEFAULT_HALF_WIDTH, height: 1.55 },
    { halfWidth: DEFAULT_HALF_WIDTH, height: 1.80 },
    { halfWidth: DEFAULT_HALF_WIDTH, height: 2.40 },
  ],
  cannon: [
    { halfWidth: DEFAULT_HALF_WIDTH, height: 1.45 },
    { halfWidth: DEFAULT_HALF_WIDTH, height: 2.05 },
    { halfWidth: DEFAULT_HALF_WIDTH, height: 2.40 },
  ],
  frost: [
    { halfWidth: DEFAULT_HALF_WIDTH, height: 2.15 },
    { halfWidth: DEFAULT_HALF_WIDTH, height: 2.55 },
    { halfWidth: DEFAULT_HALF_WIDTH, height: 3.05 },
  ],
  tesla: [
    { halfWidth: DEFAULT_HALF_WIDTH, height: 1.85 },
    { halfWidth: DEFAULT_HALF_WIDTH, height: 2.55 },
    { halfWidth: DEFAULT_HALF_WIDTH, height: 2.95 },
  ],
  mortar: [
    { halfWidth: DEFAULT_HALF_WIDTH, height: 1.40 },
    { halfWidth: DEFAULT_HALF_WIDTH, height: 1.95 },
    { halfWidth: DEFAULT_HALF_WIDTH, height: 2.45 },
  ],
};

export function getTowerPickBounds(type: TowerType, tier: 1 | 2 | 3): TowerPickBounds {
  return TOWER_PICK_BOUNDS[type][tier - 1];
}

export function getTowerPickHeight(type: TowerType, tier: 1 | 2 | 3): number {
  return TOWER_PICK_BOUNDS[type][tier - 1].height;
}

const _box = new THREE.Box3();
const _hit = new THREE.Vector3();

/**
 * Picks the nearest tower intersected by `ray` using each tower's (type, tier) bounding volume.
 * Returns null if no tower bounds are intersected so the caller can fall back to the ground plane.
 */
export function pickTowerByRay(ray: THREE.Ray, towers: readonly TowerEntity[]): TowerEntity | null {
  let bestTower: TowerEntity | null = null;
  let bestDistSq = Infinity;

  for (let i = 0; i < towers.length; i++) {
    const tower = towers[i];
    const bounds = getTowerPickBounds(tower.type, tower.tier);
    _box.min.set(tower.x - bounds.halfWidth, 0, tower.z - bounds.halfWidth);
    _box.max.set(tower.x + bounds.halfWidth, bounds.height, tower.z + bounds.halfWidth);

    const intersected = ray.intersectBox(_box, _hit);
    if (!intersected) {
      continue;
    }

    const distSq = ray.origin.distanceToSquared(intersected);
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestTower = tower;
    }
  }

  return bestTower;
}
