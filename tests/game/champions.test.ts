import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { CHALLENGES, challengeModifiers } from '../../src/data/challenges.ts';
import { championLevel, championWave } from '../../src/data/champions.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { combineRunModifiers, NEUTRAL_RUN_MODIFIERS } from '../../src/data/runModifiers.ts';
import { SimWorld } from '../../src/sim/world.ts';

describe('Champion Host', () => {
  it('empowers exactly the largest ordinary group of each wave (ties → earliest)', () => {
    const w = championWave({
      clearBonus: 10,
      groups: [
        { enemyType: 'grunt', count: 6, spawnInterval: 1, startDelay: 0 },
        { enemyType: 'runner', count: 9, spawnInterval: 1, startDelay: 0 },
        { enemyType: 'brute', count: 9, spawnInterval: 1, startDelay: 0 },
        { enemyType: 'boss', count: 12, spawnInterval: 1, startDelay: 0 },
      ],
    });
    expect(w.groups.map((g) => g.elite === true)).toEqual([false, true, false, false]);
  });

  it('leaves waves that already have elites, or only bosses, unchanged', () => {
    const withElite = {
      clearBonus: 0,
      groups: [
        { enemyType: 'grunt' as const, count: 10, spawnInterval: 1, startDelay: 0 },
        { enemyType: 'brute' as const, count: 2, spawnInterval: 1, startDelay: 0, elite: true },
      ],
    };
    expect(championWave(withElite)).toBe(withElite);
    const bossOnly = { clearBonus: 0, groups: [{ enemyType: 'boss' as const, count: 1, spawnInterval: 1, startDelay: 0 }] };
    expect(championWave(bossOnly)).toBe(bossOnly);
  });

  it('never mutates the shared level data; every island gets champions on most waves', () => {
    for (const level of LEVELS) {
      const before = JSON.stringify(level.waves);
      const champ = championLevel(level);
      expect(JSON.stringify(level.waves)).toBe(before);
      expect(champ.waves).toHaveLength(level.waves.length);
      const wavesWithElite = champ.waves.filter((w) => w.groups.some((g) => g.elite)).length;
      expect(wavesWithElite / champ.waves.length, level.id).toBeGreaterThan(0.6);
    }
  });

  it('the challenge reaches the sim: the wave preview shows the champion group', () => {
    const level = LEVELS[0];
    const plain = new SimWorld(level, new EventBus());
    const champ = new SimWorld(level, new EventBus(), challengeModifiers(['championHost']));
    expect(plain.level).toBe(level);
    expect(champ.level).not.toBe(level);
    const elites = (w: SimWorld) =>
      (w.waveSystem.getNextWavePreview()?.items ?? []).reduce((n, g) => n + (g.eliteCount ?? 0), 0);
    expect(elites(plain)).toBe(0);
    expect(elites(champ)).toBeGreaterThan(0);
  });

  it('combines with OR and stays off by default', () => {
    expect(NEUTRAL_RUN_MODIFIERS.championWaves).toBe(false);
    expect(combineRunModifiers({ enemyHpMul: 1.1 }, CHALLENGES.championHost.patch).championWaves).toBe(true);
  });
});
