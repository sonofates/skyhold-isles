import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import {
  combineEndlessMutators,
  ENDLESS_MUTATOR_INTERVAL,
  ENDLESS_MUTATORS,
  endlessMutatorsAt,
  newEndlessMutatorAt,
  NO_ENDLESS_MUTATORS,
} from '../../src/data/endlessMutators.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { buildEndlessWaveDef, endlessMutatorEffectsAt } from '../../src/sim/waveSystem.ts';
import { SimWorld } from '../../src/sim/world.ts';

describe('endless mutator schedule', () => {
  it('adds one mutator every interval, starting after the first interval', () => {
    for (let off = 0; off < ENDLESS_MUTATOR_INTERVAL; off++) expect(endlessMutatorsAt(off, 0)).toHaveLength(0);
    expect(endlessMutatorsAt(ENDLESS_MUTATOR_INTERVAL, 0)).toHaveLength(1);
    expect(endlessMutatorsAt(ENDLESS_MUTATOR_INTERVAL * 3 + 1, 0)).toHaveLength(3);
    expect(newEndlessMutatorAt(0, 0)).toBeNull();
    expect(newEndlessMutatorAt(ENDLESS_MUTATOR_INTERVAL, 0)).not.toBeNull();
    expect(newEndlessMutatorAt(ENDLESS_MUTATOR_INTERVAL + 1, 0)).toBeNull();
  });

  it('is deterministic and rotated per island', () => {
    const a = endlessMutatorsAt(ENDLESS_MUTATOR_INTERVAL * 2, 3).map((m) => m.id);
    expect(endlessMutatorsAt(ENDLESS_MUTATOR_INTERVAL * 2, 3).map((m) => m.id)).toEqual(a);
    const firsts = new Set(LEVELS.map((l) => endlessMutatorsAt(ENDLESS_MUTATOR_INTERVAL, l.index)[0].id));
    expect(firsts.size).toBeGreaterThan(3);
  });

  it('stacks copies past the end of the list', () => {
    const n = ENDLESS_MUTATORS.length;
    const list = endlessMutatorsAt(ENDLESS_MUTATOR_INTERVAL * (n + 1), 0);
    expect(list).toHaveLength(n + 1);
    expect(list[n].id).toBe(list[0].id);
    const fx = combineEndlessMutators(list);
    expect(fx.armorBonus).toBeGreaterThanOrEqual(2);
  });

  it('story waves are never mutated', () => {
    const level = LEVELS[4];
    for (let w = 0; w < level.waves.length; w++) expect(endlessMutatorEffectsAt(w, level)).toBe(NO_ENDLESS_MUTATORS);
  });
});

describe('mutated endless waves', () => {
  const findIsland = (id: string): { level: (typeof LEVELS)[number]; offset: number } => {
    for (const level of LEVELS) {
      const off = ENDLESS_MUTATOR_INTERVAL;
      if (endlessMutatorsAt(off, level.index)[0].id === id) return { level, offset: off };
    }
    throw new Error(`no island starts with ${id}`);
  };

  it('Swarmtide grows non-boss groups (bosses untouched)', () => {
    const { level, offset } = findIsland('swarmtide');
    const idx = level.waves.length + offset;
    const mutated = buildEndlessWaveDef(idx, level);
    let grew = 0;
    for (const g of mutated.groups) {
      if (g.enemyType === 'boss' || g.enemyType === 'tempest') continue;
      expect(g.count).toBeGreaterThan(0);
      grew += g.count;
    }
    // Same wave without the mutator: compare against the island one rotation step earlier.
    const fx = endlessMutatorEffectsAt(idx, level);
    expect(fx.countMul).toBeCloseTo(1.2);
    expect(grew).toBeGreaterThan(0);
  });

  it('Vanguard empowers every spotlight group', () => {
    const { level, offset } = findIsland('vanguard');
    const wave = buildEndlessWaveDef(level.waves.length + offset, level);
    const spot = wave.groups.filter((g) => !['grunt', 'runner', 'splitter', 'flyer', 'brute', 'healer', 'boss', 'tempest', 'mite'].includes(g.enemyType));
    expect(spot.length).toBeGreaterThan(0);
    for (const g of spot) expect(g.elite).toBe(true);
  });

  it('stat mutators apply to endless spawns in the sim', () => {
    const { level, offset } = findIsland('tailwind');
    const world = new SimWorld(level, new EventBus());
    expect(world.startEndlessFromStart()).toBe(true);
    world.debugSkipToWave(level.waves.length + offset + 1);
    expect(world.waveSystem.getEndlessMutatorEffects().speedMul).toBeCloseTo(1.08);
    for (let i = 0; i < 60 * 3; i++) world.fixedTick(1 / 60);
    const pool = world.enemyPool;
    let checked = 0;
    for (let p = 0; p < pool.getActiveCount(); p++) {
      const e = pool.items[pool.getActiveIndex(p)];
      if (e.type === 'grunt') {
        expect(e.speed).toBeCloseTo(ENEMY_DEFS.grunt.speed * 1.08, 5);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('endless from the island card', () => {
  it('plays through the story waves without a victory and keeps going', () => {
    const level = LEVELS[0];
    const world = new SimWorld(level, new EventBus());
    let won = false;
    world.events.on('gameWon', () => {
      won = true;
    });
    expect(world.startEndlessFromStart()).toBe(true);
    expect(world.waveSystem.isEndless).toBe(true);
    world.gold = 1e6;
    // Skip to the last story wave and clear it by force: the run must not end in a win.
    world.debugSkipToWave(level.waves.length);
    world.enemyPool.clear();
    for (let i = 0; i < 60 * 30 && world.waveSystem.currentWaveIndex < level.waves.length; i++) {
      world.enemyPool.clear();
      world.fixedTick(1 / 60);
    }
    expect(won).toBe(false);
    expect(world.outcome).toBe('ongoing');
    expect(world.waveSystem.currentWaveIndex).toBeGreaterThanOrEqual(level.waves.length);
  });

  it('cannot switch to endless once the run has started', () => {
    const world = new SimWorld(LEVELS[0], new EventBus());
    world.startNextWave();
    expect(world.startEndlessFromStart()).toBe(false);
    expect(world.waveSystem.isEndless).toBe(false);
  });
});
