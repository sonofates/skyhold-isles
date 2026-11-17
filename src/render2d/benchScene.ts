import type { EnemyType, TowerType, Vec3 } from '../core/types.ts';
import type { ScriptedBuildAction } from '../data/levels/types.ts';
import type { SimWorld } from '../sim/world.ts';
import type { Game2DHooks } from './game2d.ts';

const BENCH_TYPES: readonly EnemyType[] = ['grunt', 'runner', 'brute', 'flyer', 'grunt', 'brute'];
const BENCH_TOWERS: readonly TowerType[] = ['archer', 'cannon', 'tesla'];
const _v: Vec3 = { x: 0, y: 0, z: 0 };

/** Builds a mixed tower on every plot (bench setup). */
export function fillPlots(world: SimWorld): void {
  world.gold = 1e9;
  for (let p = 0; p < world.grid.plotCount; p++) {
    const t = world.placeTowerOnPlot(p, BENCH_TOWERS[p % BENCH_TOWERS.length]);
    if (t && p % 2 === 0) world.upgradeTower(t.id);
    if (t && p % 4 === 0) world.upgradeTower(t.id);
  }
}

/**
 * `?bench=N`: keeps ~N mixed enemies alive on the map (tough HP, spread along every lane), towers
 * on all plots, no lose condition and no waves. Pure stress scene for frame-time measurement.
 */
export function benchHooks(target: number): Game2DHooks {
  let k = 0;
  let setup = false;
  return {
    endless: true,
    beforeTick(world: SimWorld): void {
      if (!setup) {
        setup = true;
        fillPlots(world);
      }
      world.lives = 1e6;
      world.gold = 1e9;
      const pool = world.enemyPool;
      const lanes = world.enemySystem.groundLaneCount;
      for (let guard = 0; guard < 10 && pool.getActiveCount() < target; guard++) {
        const type = BENCH_TYPES[k % BENCH_TYPES.length];
        const e = world.enemySystem.spawnEnemy(type, 7, false, k % lanes);
        if (e) {
          const path = world.enemySystem.getPath(e.flying, e.lane);
          e.dist = ((k * 0.6180339887) % 1) * e.totalDist * 0.9;
          path.sample(e.dist, _v);
          e.x = e.prevX = _v.x;
          e.z = e.prevZ = _v.z;
          e.y = e.prevY = _v.y;
        }
        k++;
      }
    },
  };
}

/**
 * `?autoplay=1`: plays the level's greedy build script (as gold allows) and auto-calls waves, for
 * screenshots and recordings. Taps still work on top.
 */
export function autoplayHooks(script: readonly ScriptedBuildAction[]): Game2DHooks {
  let queue = [...script];
  let started = false;
  let lastWorld: SimWorld | null = null;
  return {
    beforeTick(world: SimWorld): void {
      if (world !== lastWorld) {
        lastWorld = world;
        queue = [...script];
        started = false;
      }
      while (queue.length > 0) {
        const a = queue[0];
        let ok: boolean;
        if (a.action === 'build') {
          if (!world.grid.canPlaceTower(a.col, a.row)) {
            queue.shift();
            continue;
          }
          ok = world.placeTower(a.col, a.row, a.towerType ?? 'archer', a.targetingMode ?? 'first') !== null;
        } else {
          const id = world.grid.getTowerIdAt(a.col, a.row);
          const t = id === -1 ? null : world.getTowerById(id);
          if (!t || t.tier >= 3) {
            queue.shift();
            continue;
          }
          ok = world.upgradeTower(id);
        }
        if (!ok) break;
        queue.shift();
      }
      if (!started) {
        started = true;
        world.setAutoWave(true);
        world.startNextWave();
      }
    },
  };
}
