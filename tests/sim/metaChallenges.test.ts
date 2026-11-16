import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import type { SpeedMultiplier } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import {
  CHALLENGES_BY_LEVEL_ID,
  getChallengeById,
  getChallengesForLevel,
} from '../../src/data/challenges.ts';
import { LEVELS, type LevelDef } from '../../src/data/levels/index.ts';
import { getTowerTierStats } from '../../src/data/towers.ts';
import {
  evaluateChallengeCondition,
  RunObserver,
} from '../../src/sim/meta/runObserver.ts';
import { SimWorld } from '../../src/sim/world.ts';

function makeSimpleTestLevel(overrides?: Partial<LevelDef>): LevelDef {
  return {
    ...LEVELS[0],
    id: overrides?.id ?? 'test-island',
    index: overrides?.index ?? 0,
    name: overrides?.name ?? 'Test Island',
    startingGold: overrides?.startingGold ?? 1000,
    waves: overrides?.waves ?? [
      {
        clearBonus: 20,
        groups: [{ enemyType: 'grunt', count: 3, spawnInterval: 0.4, startDelay: 0 }],
      },
      {
        clearBonus: 30,
        groups: [{ enemyType: 'flyer', count: 2, spawnInterval: 0.4, startDelay: 0 }],
      },
    ],
    ...overrides,
  };
}

function runTicksUntilSettled(
  world: SimWorld,
  observer: RunObserver,
  speed: SpeedMultiplier = 1,
  maxSeconds = 180,
): void {
  const ticks = Math.ceil(maxSeconds / BALANCE.fixedDt);
  for (let i = 0; i < ticks && world.outcome === 'ongoing'; i++) {
    observer.onTick(BALANCE.fixedDt, speed);
    world.fixedTick(BALANCE.fixedDt);
  }
}

describe('Per-island challenges catalog and fallback generation', () => {
  it('defines 3 unique challenges for every island 1-9', () => {
    const seenIds = new Set<string>();
    expect(LEVELS.length).toBeGreaterThanOrEqual(9);

    for (let i = 0; i < 9; i++) {
      const level = LEVELS[i];
      expect(CHALLENGES_BY_LEVEL_ID[level.id]).toBeDefined();
      const challenges = getChallengesForLevel(level);
      expect(challenges).toHaveLength(3);
      for (const ch of challenges) {
        expect(ch.levelId).toBe(level.id);
        expect(ch.title.length).toBeGreaterThan(2);
        expect(ch.description.length).toBeGreaterThan(5);
        expect(seenIds.has(ch.id)).toBe(false);
        seenIds.add(ch.id);
        expect(getChallengeById(ch.id, LEVELS)).toEqual(ch);
      }
    }
  });

  it('deterministically generates 3 valid challenges by levelId for future islands 10+', () => {
    const futureIsland10: LevelDef = {
      ...LEVELS[2],
      id: 'obsidian-aerie',
      index: 9,
      name: 'Obsidian Aerie',
      difficulty: 'Master',
    };
    const futureIsland11: LevelDef = {
      ...LEVELS[5],
      id: 'storm-spire',
      index: 10,
      name: 'Storm Spire',
      difficulty: 'Breezy',
    };

    const a1 = getChallengesForLevel(futureIsland10);
    const a2 = getChallengesForLevel(futureIsland10);
    const b = getChallengesForLevel(futureIsland11);

    expect(a1).toEqual(a2);
    expect(a1).toHaveLength(3);
    expect(b).toHaveLength(3);
    expect(a1[0].levelId).toBe('obsidian-aerie');
    expect(b[0].levelId).toBe('storm-spire');
    expect(new Set(a1.map((c) => c.id)).size).toBe(3);
    expect(a1[0].id).not.toBe(b[0].id);
  });
});

describe('RunObserver challenge condition tracking', () => {
  it('evaluates all challenge conditions accurately on winning runs', () => {
    const level = makeSimpleTestLevel();
    const events = new EventBus();
    const world = new SimWorld(level, events);
    const observer = new RunObserver(level, events);

    observer.recordSpeed(3);
    const t1 = world.placeTower(4, 2, 'archer')!;
    const t2 = world.placeTower(4, 3, 'cannon')!;
    expect(t1).not.toBeNull();
    expect(t2).not.toBeNull();
    world.upgradeTower(t1.id); // Tier 2 archer

    world.startNextWave();
    // Run wave 1 until betweenWaves
    for (let i = 0; i < 60 * 30 && world.waveSystem.state !== 'betweenWaves'; i++) {
      observer.onTick(BALANCE.fixedDt, 3);
      world.fixedTick(BALANCE.fixedDt);
    }
    // Call wave 2 early to get earlyBonus
    expect(world.startNextWave()).toBe(true);
    runTicksUntilSettled(world, observer, 3);

    expect(world.outcome).toBe('won');
    expect(world.lives).toBe(20);

    const telemetry = observer.getTelemetry();
    expect(telemetry.eligibleForChallenges).toBe(true);
    expect(telemetry.towersBuilt).toBe(2);
    expect(telemetry.maxTowerTierBuilt).toBe(2);
    expect(telemetry.towersSold).toBe(0);
    expect(telemetry.abilitiesCastTotal).toBe(0);
    expect(telemetry.earlyWavesCalled).toBe(1);
    expect(telemetry.minCombatSpeed).toBe(3);

    const expectedSpent =
      getTowerTierStats('archer', 1).upgradeCost +
      getTowerTierStats('archer', 2).upgradeCost +
      getTowerTierStats('cannon', 1).upgradeCost;
    expect(telemetry.grossGoldSpent).toBe(expectedSpent);

    expect(evaluateChallengeCondition({ kind: 'noLivesLost' }, telemetry, true, 20)).toBe(true);
    expect(evaluateChallengeCondition({ kind: 'minLivesRemaining', minLives: 18 }, telemetry, true, 20)).toBe(true);
    expect(evaluateChallengeCondition({ kind: 'forbiddenTowerTypes', forbidden: ['frost', 'mortar'] }, telemetry, true, 20)).toBe(true);
    expect(evaluateChallengeCondition({ kind: 'forbiddenTowerTypes', forbidden: ['archer'] }, telemetry, true, 20)).toBe(false);
    expect(evaluateChallengeCondition({ kind: 'allowedTowerTypes', allowed: ['archer', 'cannon'] }, telemetry, true, 20)).toBe(true);
    expect(evaluateChallengeCondition({ kind: 'allowedTowerTypes', allowed: ['archer'] }, telemetry, true, 20)).toBe(false);
    expect(evaluateChallengeCondition({ kind: 'maxTowersBuilt', maxCount: 2 }, telemetry, true, 20)).toBe(true);
    expect(evaluateChallengeCondition({ kind: 'maxTowersBuilt', maxCount: 1 }, telemetry, true, 20)).toBe(false);
    expect(evaluateChallengeCondition({ kind: 'maxPeakTowers', maxCount: 2 }, telemetry, true, 20)).toBe(true);
    expect(evaluateChallengeCondition({ kind: 'maxTowerTier', maxTier: 2 }, telemetry, true, 20)).toBe(true);
    expect(evaluateChallengeCondition({ kind: 'maxTowerTier', maxTier: 1 }, telemetry, true, 20)).toBe(false);
    expect(evaluateChallengeCondition({ kind: 'maxGoldSpent', maxGold: expectedSpent }, telemetry, true, 20)).toBe(true);
    expect(evaluateChallengeCondition({ kind: 'maxGoldSpent', maxGold: expectedSpent - 1 }, telemetry, true, 20)).toBe(false);
    expect(evaluateChallengeCondition({ kind: 'noAbilities' }, telemetry, true, 20)).toBe(true);
    expect(evaluateChallengeCondition({ kind: 'noTowerSelling' }, telemetry, true, 20)).toBe(true);
    expect(evaluateChallengeCondition({ kind: 'combatSpeedOnly', requiredSpeed: 3 }, telemetry, true, 20)).toBe(true);
    expect(evaluateChallengeCondition({ kind: 'minEarlyWaves', minCount: 1 }, telemetry, true, 20)).toBe(true);
    expect(evaluateChallengeCondition({ kind: 'minEarlyWaves', minCount: 2 }, telemetry, true, 20)).toBe(false);

    // Loss always fails challenges even if constraints held
    expect(evaluateChallengeCondition({ kind: 'noAbilities' }, telemetry, false, 0)).toBe(false);
    observer.dispose();
  });

  it('prevents sell-cheese on maxTowersBuilt and detects speed drops, sells, and abilities', () => {
    const level = makeSimpleTestLevel();
    const events = new EventBus();
    const world = new SimWorld(level, events);
    const observer = new RunObserver(level, events);

    observer.recordSpeed(3);
    const a = world.placeTower(4, 2, 'archer')!;
    const b = world.placeTower(4, 3, 'archer')!;
    world.sellTower(b.id);
    const c = world.placeTower(7, 5, 'archer')!;
    expect(c).not.toBeNull();
    world.upgradeTower(a.id);
    world.upgradeTower(a.id); // Tier 3

    world.startNextWave();
    world.castOvercharge();
    // Drop to 2x mid-combat
    observer.onTick(BALANCE.fixedDt, 2);
    // Re-raise to 3x afterward — minCombatSpeed must stay 2
    observer.onTick(BALANCE.fixedDt, 3);
    runTicksUntilSettled(world, observer, 3);

    expect(world.outcome).toBe('won');
    const telemetry = observer.getTelemetry();
    expect(telemetry.towersBuilt).toBe(3);
    expect(telemetry.peakTowersActive).toBe(2);
    expect(telemetry.towersSold).toBe(1);
    expect(telemetry.abilitiesCastTotal).toBe(1);
    expect(telemetry.minCombatSpeed).toBe(2);

    expect(evaluateChallengeCondition({ kind: 'maxTowersBuilt', maxCount: 2 }, telemetry, true, 20)).toBe(false);
    expect(evaluateChallengeCondition({ kind: 'maxPeakTowers', maxCount: 2 }, telemetry, true, 20)).toBe(true);
    expect(evaluateChallengeCondition({ kind: 'noTowerSelling' }, telemetry, true, 20)).toBe(false);
    expect(evaluateChallengeCondition({ kind: 'noAbilities' }, telemetry, true, 20)).toBe(false);
    expect(evaluateChallengeCondition({ kind: 'combatSpeedOnly', requiredSpeed: 3 }, telemetry, true, 20)).toBe(false);
    expect(evaluateChallengeCondition({ kind: 'maxTowerTier', maxTier: 2 }, telemetry, true, 20)).toBe(false);
    observer.dispose();
  });

  it('rejects challenges if debugForceWin or debugSkipToWave bypassed waves', () => {
    const level = makeSimpleTestLevel();
    const events1 = new EventBus();
    const world1 = new SimWorld(level, events1);
    const obs1 = new RunObserver(level, events1);
    world1.debugForceWin();
    expect(obs1.evaluateCompletedChallenges(true, 20)).toHaveLength(0);
    obs1.dispose();

    const events2 = new EventBus();
    const world2 = new SimWorld(level, events2);
    const obs2 = new RunObserver(level, events2);
    world2.placeTower(4, 2, 'archer');
    world2.placeTower(4, 3, 'archer');
    world2.debugSkipToWave(2);
    runTicksUntilSettled(world2, obs2, 3);
    expect(world2.outcome).toBe('won');
    expect(obs2.evaluateCompletedChallenges(true, world2.lives)).toHaveLength(0);
    obs2.dispose();
  });

  it('completes Sunlit Meadow challenges (6-tower lean win at 3x speed with no lives lost)', () => {
    const level1 = LEVELS[0];
    const events = new EventBus();
    const world = new SimWorld(level1, events);
    const observer = new RunObserver(level1, events);

    observer.recordSpeed(3);
    // 6-tower defense on Sunlit Meadow (using upgrades & Meteor/Overcharge on wave 10)
    const script: Array<{ wave: number; fn: () => boolean }> = [
      { wave: 0, fn: () => world.placeTower(4, 2, 'archer') !== null },
      { wave: 0, fn: () => world.placeTower(4, 3, 'cannon') !== null },
      { wave: 0, fn: () => world.placeTower(7, 5, 'frost') !== null },
      { wave: 1, fn: () => world.placeTower(8, 5, 'archer') !== null },
      { wave: 2, fn: () => world.placeTower(10, 4, 'tesla') !== null },
      { wave: 3, fn: () => world.upgradeTower(1) }, // archer T2
      { wave: 4, fn: () => world.placeTower(5, 7, 'mortar', 'strongest') !== null },
      { wave: 5, fn: () => world.upgradeTower(3) }, // frost T2
      { wave: 5, fn: () => world.upgradeTower(2) }, // cannon T2
      { wave: 6, fn: () => world.upgradeTower(5) }, // tesla T2
      { wave: 7, fn: () => world.upgradeTower(6) }, // mortar T2
      { wave: 8, fn: () => world.upgradeTower(5) }, // tesla T3
      { wave: 8, fn: () => world.upgradeTower(6) }, // mortar T3
      { wave: 9, fn: () => world.upgradeTower(3) }, // frost T3
      { wave: 9, fn: () => world.upgradeTower(2) }, // cannon T3
      { wave: 9, fn: () => world.upgradeTower(1) }, // archer T3
      { wave: 9, fn: () => world.upgradeTower(4) }, // archer2 T2
    ];

    let cursor = 0;
    while (cursor < script.length && script[cursor].wave === 0) {
      if (!script[cursor].fn()) break;
      cursor++;
    }
    world.startNextWave();

    for (let tick = 0; tick < 60 * 1200 && world.outcome === 'ongoing'; tick++) {
      const waveIdx = Math.max(0, world.waveSystem.currentWaveIndex);
      while (cursor < script.length && script[cursor].wave <= waveIdx) {
        if (!script[cursor].fn()) break;
        cursor++;
      }
      if (waveIdx >= 9 && world.abilitySystem.canCast('overcharge')) {
        world.castOvercharge();
      }
      if (waveIdx >= 9 && world.abilitySystem.canCast('meteor')) {
        // Strike near the central choke / boss lane
        const firstActive = world.enemyPool.getActiveCount() > 0
          ? world.enemyPool.items[world.enemyPool.getActiveIndex(0)]
          : null;
        if (firstActive) {
          world.castMeteor(firstActive.x, firstActive.z);
        }
      }
      observer.onTick(BALANCE.fixedDt, 3);
      world.fixedTick(BALANCE.fixedDt);
    }

    expect(world.outcome).toBe('won');
    expect(world.lives).toBe(20);
    const completed = observer.evaluateCompletedChallenges(true, world.lives);
    const ids = completed.map((c) => c.id);
    expect(ids).toContain('sunlit-meadow:perfect');
    expect(ids).toContain('sunlit-meadow:lean');
    expect(ids).toContain('sunlit-meadow:rush3x');
    observer.dispose();
  });
});
