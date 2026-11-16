import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ENDLESS_MUTATORS } from '../../src/data/challenges.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVELS, type LevelDef } from '../../src/data/levels/index.ts';
import { getTowerTierStats, TOWER_DEFS } from '../../src/data/towers.ts';
import { computeDailyStreaks, generateDailyChallenge, isValidDateString } from '../../src/sim/meta/daily.ts';
import { getAllowedTowerTypes, isTowerTypeAllowed } from '../../src/sim/meta/modifiers.ts';
import { computeEndlessScore, hashSeedString, selectEndlessMutators } from '../../src/sim/meta/mutators.ts';
import { RunObserver } from '../../src/sim/meta/runObserver.ts';
import { SimWorld } from '../../src/sim/world.ts';

describe('Endless mutators determinism & scoring', () => {
  it('selects identical mutator sets and score multipliers for identical numeric or string seeds', () => {
    const rollA1 = selectEndlessMutators(424242, 2);
    const rollA2 = selectEndlessMutators(424242, 2);
    expect(rollA1).toEqual(rollA2);
    expect(rollA1.mutators).toHaveLength(2);
    expect(rollA1.scoreMultiplier).toBeGreaterThan(1);

    const rollStr1 = selectEndlessMutators('skyhold-season-1', 3);
    const rollStr2 = selectEndlessMutators('skyhold-season-1', 3);
    expect(rollStr1).toEqual(rollStr2);
    expect(rollStr1.seed).toBe(hashSeedString('skyhold-season-1'));
    expect(rollStr1.mutators).toHaveLength(3);
  });

  it('never picks two mutators from the same conflict group', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const roll = selectEndlessMutators(seed, 4);
      const groups = new Set<string>();
      for (const m of roll.mutators) {
        if (m.conflictGroup) {
          expect(groups.has(m.conflictGroup)).toBe(false);
          groups.add(m.conflictGroup);
        }
      }
      // Verify scoreMultiplier matches sum of bonuses
      const expectedMult = +(
        1 + roll.mutators.reduce((sum, m) => sum + m.scoreMultiplierBonus, 0)
      ).toFixed(2);
      expect(roll.scoreMultiplier).toBe(expectedMult);
    }
    expect(ENDLESS_MUTATORS.length).toBeGreaterThanOrEqual(6);
  });

  it('computes endless score with mutator multiplier', () => {
    const base = computeEndlessScore(4, 120, 1);
    expect(base.baseScore).toBe(4 * 150 + 120 * 2);
    expect(base.totalScore).toBe(base.baseScore);

    const boosted = computeEndlessScore(4, 120, 1.55);
    expect(boosted.baseScore).toBe(base.baseScore);
    expect(boosted.totalScore).toBe(Math.round(base.baseScore * 1.55));
  });
});

describe('SimWorld integration with RunModifiers', () => {
  it('applies speed, armor, HP, gold drought, tower cost scaling, and tower bans', () => {
    const testLevel: LevelDef = {
      ...LEVELS[0],
      startingGold: 400,
      waves: [
        {
          clearBonus: 40,
          groups: [
            { enemyType: 'grunt', count: 2, spawnInterval: 0.5, startDelay: 0 },
            { enemyType: 'flyer', count: 2, spawnInterval: 0.5, startDelay: 0 },
          ],
        },
      ],
    };

    const modifiers = {
      enemySpeedMultiplier: 1.5,
      enemyHpMultiplier: 1.5,
      enemyArmorBonus: 4,
      flyerCountMultiplier: 2,
      goldRewardMultiplier: 0.5,
      towerCostMultiplier: 1.2,
      forbiddenTowerTypes: ['frost'] as const,
      scoreMultiplier: 2.0,
    };

    const events = new EventBus();
    const world = new SimWorld(testLevel, events, modifiers);
    const observer = new RunObserver(testLevel, events, modifiers);

    // Forbidden tower is rejected
    expect(world.placeTower(4, 2, 'frost')).toBeNull();
    // Allowed tower pays scaled cost (50 * 1.2 = 60)
    const archer = world.placeTower(4, 2, 'archer');
    expect(archer).not.toBeNull();
    expect(archer!.totalInvested).toBe(Math.round(getTowerTierStats('archer', 1).upgradeCost * 1.2));
    expect(world.gold).toBe(400 - 60);

    // Wave flyer count doubled (2 -> 4 flyers + 2 grunts = 6 total enemies)
    let spawnedFlyers = 0;
    let spawnedGrunts = 0;
    events.on('enemySpawned', (e) => {
      if (e.enemyType === 'flyer') spawnedFlyers++;
      if (e.enemyType === 'grunt') spawnedGrunts++;
    });

    world.startNextWave();
    for (let i = 0; i < 60 * 6; i++) {
      world.fixedTick(BALANCE.fixedDt);
    }

    expect(spawnedGrunts).toBe(2);
    expect(spawnedFlyers).toBe(4);

    // Verify active spawned enemy has modified speed, hp, armor, reward
    const idx = world.enemyPool.getActiveIndex(0);
    const sampleEnemy = world.enemyPool.items[idx];
    const baseDef = ENEMY_DEFS[sampleEnemy.type];
    expect(sampleEnemy.speed).toBeCloseTo(baseDef.speed * 1.5, 4);
    expect(sampleEnemy.maxHp).toBe(Math.round(baseDef.maxHp * 1.5));
    expect(sampleEnemy.armor).toBe(baseDef.armor + 4);
    expect(sampleEnemy.reward).toBe(Math.max(1, Math.round(baseDef.reward * 0.5)));

    observer.dispose();
  });

  it('spawns extra flyers and applies modifiers when entering endless mode with mutators', () => {
    const miniLevel: LevelDef = {
      ...LEVELS[0],
      startingGold: 800,
      waves: [
        {
          clearBonus: 20,
          groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 0.5, startDelay: 0 }],
        },
      ],
    };

    const events = new EventBus();
    const world = new SimWorld(miniLevel, events);
    world.placeTower(4, 2, 'archer');
    world.startNextWave();
    for (let i = 0; i < 60 * 30 && world.outcome === 'ongoing'; i++) {
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(world.outcome).toBe('won');

    const roll = {
      enemySpeedMultiplier: 1.22,
      flyerCountMultiplier: 2,
      activeMutatorIds: ['swift_march', 'sky_swarm'],
      scoreMultiplier: 1.55,
    };
    expect(world.enterEndlessMode(roll)).toBe(true);
    let endlessFlyers = 0;
    events.on('enemySpawned', (e) => {
      if (e.enemyType === 'flyer') endlessFlyers++;
    });

    world.startNextWave();
    // Tick until all enemies in wave 2 have spawned (buildEndlessWaveDef at offset 0 has 6 flyers -> 12 with 2x)
    for (let i = 0; i < 60 * 15; i++) {
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(endlessFlyers).toBe(12);
  });
});

describe('Daily challenge pure date-seeded generator', () => {
  it('validates YYYY-MM-DD calendar strings accurately', () => {
    expect(isValidDateString('2026-11-17')).toBe(true);
    expect(isValidDateString('2024-02-29')).toBe(true);
    expect(isValidDateString('2025-02-29')).toBe(false);
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidDateString('2026-13-01')).toBe(false);
    expect(isValidDateString('2026-11-7')).toBe(false);
    expect(isValidDateString('invalid')).toBe(false);
    expect(() => generateDailyChallenge('2026-02-30')).toThrow(RangeError);
  });

  it('produces deterministic daily specs for a given date string and always retains anti-air', () => {
    const spec1 = generateDailyChallenge('2026-11-17', LEVELS);
    const spec2 = generateDailyChallenge('2026-11-17', LEVELS);
    expect(spec1).toEqual(spec2);
    expect(spec1.date).toBe('2026-11-17');
    expect(spec1.levelIndex).toBeGreaterThanOrEqual(0);
    expect(spec1.levelIndex).toBeLessThan(LEVELS.length);
    expect(spec1.mutators.length).toBeGreaterThanOrEqual(1);
    expect(spec1.scoreMultiplier).toBeGreaterThan(1);

    // Check 60 consecutive dates to ensure diversity and anti-air viability on every single day
    const islandsSeen = new Set<string>();
    for (let day = 1; day <= 30; day++) {
      const d1 = `2026-03-${String(day).padStart(2, '0')}`;
      const d2 = `2026-04-${String(day).padStart(2, '0')}`;
      for (const d of [d1, d2]) {
        const spec = generateDailyChallenge(d, LEVELS);
        islandsSeen.add(spec.levelId);
        const allowed = spec.modifiers.allowedTowerTypes;
        const forbidden = spec.modifiers.forbiddenTowerTypes;
        const legalTowers = (allowed ?? (Object.keys(TOWER_DEFS) as Array<keyof typeof TOWER_DEFS>)).filter(
          (t) => !forbidden.includes(t),
        );
        expect(legalTowers.some((t) => TOWER_DEFS[t].hitsFlyers)).toBe(true);
      }
    }
    expect(islandsSeen.size).toBeGreaterThanOrEqual(6);
  });

  it('computes daily calendar streaks accurately across month boundaries and pending today', () => {
    const completed = [
      '2026-01-29',
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      // gap
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ];
    // On 2026-03-02 (yesterday completed, today not yet played): current streak stays alive at 3
    expect(computeDailyStreaks(completed, '2026-03-02')).toEqual({
      currentStreak: 3,
      bestStreak: 4,
    });
    // Completing 2026-03-02 bumps current streak to 4
    expect(computeDailyStreaks([...completed, '2026-03-02'], '2026-03-02')).toEqual({
      currentStreak: 4,
      bestStreak: 4,
    });
    // Missing two days resets currentStreak to 0 while preserving bestStreak
    expect(computeDailyStreaks(completed, '2026-03-03')).toEqual({
      currentStreak: 0,
      bestStreak: 4,
    });
  });

  it('resolves allowed and forbidden towers cleanly for build bar restrictions', () => {
    const spec = generateDailyChallenge('2026-11-17', LEVELS);
    const allowed = getAllowedTowerTypes(spec.modifiers);
    expect(allowed.length).toBeGreaterThanOrEqual(1);
    for (const t of allowed) {
      expect(isTowerTypeAllowed(t, spec.modifiers)).toBe(true);
    }
    for (const banned of spec.modifiers.forbiddenTowerTypes) {
      expect(isTowerTypeAllowed(banned, spec.modifiers)).toBe(false);
      expect(allowed).not.toContain(banned);
    }
  });
});
