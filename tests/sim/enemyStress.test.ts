import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { SeededRng } from '../../src/core/rng.ts';
import type { EnemyType, TowerType } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ENEMY_TYPES } from '../../src/data/enemies.ts';
import { LEVELS, type LevelDef, type WaveGroupDef } from '../../src/data/levels/index.ts';
import { TOWER_TYPES } from '../../src/data/towers.ts';
import { SimWorld } from '../../src/sim/world.ts';

const DT = BALANCE.fixedDt;

/** Seeded random waves using every enemy type (elites, lanes) on a given island. */
function randomLevel(base: LevelDef, seed: number): LevelDef {
  const rng = new SeededRng(seed);
  const lanes = 1 + (base.extraGroundPaths?.length ?? 0);
  const waves = [];
  for (let w = 0; w < 4; w++) {
    const groups: WaveGroupDef[] = [];
    const n = rng.int(3, 6);
    for (let g = 0; g < n; g++) {
      const type = ENEMY_TYPES[rng.int(0, ENEMY_TYPES.length - 1)] as EnemyType;
      groups.push({
        enemyType: type,
        count: type === 'boss' || type === 'tempest' ? 1 : rng.int(4, 40),
        spawnInterval: rng.range(0.05, 0.5),
        startDelay: rng.range(0, 3),
        elite: rng.chance(0.3),
        lane: rng.int(0, lanes - 1),
      });
    }
    waves.push({ groups, clearBonus: 50 });
  }
  return { ...base, enemyHpScale: rng.range(0.6, 2.5), waves };
}

function placeRandomTowers(world: SimWorld, seed: number, count: number): void {
  const rng = new SeededRng(seed);
  world.gold = 1e6;
  let placed = 0;
  for (let tries = 0; tries < 2000 && placed < count; tries++) {
    const col = rng.int(0, world.level.cols - 1);
    const row = rng.int(0, world.level.rows - 1);
    const type = TOWER_TYPES[rng.int(0, TOWER_TYPES.length - 1)] as TowerType;
    const t = world.placeTower(col, row, type);
    if (!t) continue;
    placed++;
    const ups = rng.int(0, 2);
    for (let u = 0; u < ups; u++) world.upgradeTower(t.id);
  }
}

describe('enemy stress (seeded fuzz over all archetypes)', () => {
  const islands = LEVELS.filter((l) => l.index >= 9 || l.index === 0);
  for (const base of islands) {
    for (const seed of [11, 29]) {
      it(`${base.name} seed ${seed}: invariants hold under random mixed waves`, { timeout: 30000 }, () => {
        const level = randomLevel(base, seed * 7919 + base.index);
        const events = new EventBus();
        const world = new SimWorld(level, events);
        placeRandomTowers(world, seed, 14);
        world.lives = 1e6; // never lose: we want the whole run exercised
        let meteorCd = 0;
        const violations: string[] = [];
        const hashed: number[] = [];
        world.startNextWave();
        for (let tick = 0; tick < 60 * 100 && world.outcome === 'ongoing'; tick++) {
          if (world.waveSystem.state === 'betweenWaves') world.startNextWave();
          if (--meteorCd <= 0 && world.enemyPool.getActiveCount() > 0) {
            const e = world.enemyPool.items[world.enemyPool.getActiveIndex(0)];
            world.castMeteor(e.x, e.z);
            world.castOvercharge();
            meteorCd = 600;
          }
          world.fixedTick(DT);

          for (let i = 0; i < world.enemyPool.getActiveCount(); i++) {
            const e = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
            let bad = '';
            if (!Number.isFinite(e.x + e.y + e.z + e.dist + e.hp + e.shield)) bad = 'non-finite';
            else if (e.hp > e.maxHp) bad = 'hp > maxHp';
            else if (e.shield < 0) bad = 'negative shield';
            else if (e.dist > e.totalDist + 1e-6) bad = 'past goal';
            else if (e.armor < 0) bad = 'negative armor';
            else if (e.flying && e.lane !== 0) bad = 'flyer on a lane';
            else if (e.burrowed) {
              world.spatialHash.query(e.x, e.z, 0.5, hashed);
              if (hashed.includes(e.poolIndex)) bad = 'burrowed but hashed';
            }
            if (bad && violations.length < 5) violations.push(`tick ${tick} ${e.type}#${e.uid}: ${bad}`);
          }
          if (world.enemyPool.getActiveCount() > BALANCE.pools.maxEnemies) violations.push('pool overflow');
        }
        expect(violations).toEqual([]);
        expect(world.enemiesKilledTotal).toBeGreaterThan(0);
      });
    }
  }
});
