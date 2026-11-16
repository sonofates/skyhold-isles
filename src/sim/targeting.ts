import type { ObjectPool } from '../core/pool.ts';
import type { TargetingMode } from '../core/types.ts';
import { TOWER_DEFS, type TowerTierStats } from '../data/towers.ts';
import type { EnemyEntity, TowerEntity } from './entities.ts';
import type { SpatialHashGrid } from './spatialHash.ts';

const _candidates: number[] = [];

export function acquireTarget(
  tower: TowerEntity,
  stats: TowerTierStats,
  enemyPool: ObjectPool<EnemyEntity>,
  spatialHash: SpatialHashGrid,
): EnemyEntity | null {
  const def = TOWER_DEFS[tower.type];
  const maxR = stats.range;
  const maxRSq = maxR * maxR;
  const minRSq = stats.minRange * stats.minRange;
  const mode: TargetingMode = tower.targetingMode;

  spatialHash.query(tower.x, tower.z, maxR, _candidates);

  let best: EnemyEntity | null = null;
  let bestScore = mode === 'last' || mode === 'closest' ? Infinity : -Infinity;

  for (let i = 0; i < _candidates.length; i++) {
    const e = enemyPool.items[_candidates[i]];
    if (!e.active || e.hp <= 0) continue;
    if (e.flying && !def.hitsFlyers) continue;

    const dx = e.x - tower.x;
    const dz = e.z - tower.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > maxRSq || distSq < minRSq) continue;

    let score: number;
    switch (mode) {
      case 'first':
        // Progress toward the goal; the lane offset makes unequal spawn lanes comparable.
        score = (e.dist + e.laneProgressOffset) / (e.totalDist + e.laneProgressOffset);
        if (score > bestScore) {
          bestScore = score;
          best = e;
        }
        break;
      case 'last':
        score = (e.dist + e.laneProgressOffset) / (e.totalDist + e.laneProgressOffset);
        if (score < bestScore) {
          bestScore = score;
          best = e;
        }
        break;
      case 'strongest':
        score = e.hp;
        if (score > bestScore || (score === bestScore && best && e.dist > best.dist)) {
          bestScore = score;
          best = e;
        }
        break;
      case 'closest':
        score = distSq;
        if (score < bestScore) {
          bestScore = score;
          best = e;
        }
        break;
    }
  }

  return best;
}
