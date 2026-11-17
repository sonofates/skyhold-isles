import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import type { SpeedMultiplier, TowerType } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import {
  CHALLENGES_BY_LEVEL_ID,
  getChallengeById,
  getChallengesForLevel,
} from '../../src/data/challenges.ts';
import { LEVELS, type LevelDef, type ScriptedBuildAction } from '../../src/data/levels/index.ts';
import { getTowerTierStats } from '../../src/data/towers.ts';
import { MetaSession } from '../../src/platform/metaSession.ts';
import { isAdvantageousModifiers } from '../../src/sim/meta/modifiers.ts';
import {
  evaluateChallengeCondition,
  evaluateLiveChallengeState,
  evaluateLiveLevelChallenges,
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

  it('tracks live mid-run challenge states (on_track -> failed / completed)', () => {
    const level = LEVELS[0]; // Sunlit Meadow: perfect, lean (<=6), rush3x
    const events = new EventBus();
    const world = new SimWorld(level, events);
    const observer = new RunObserver(level, events);
    observer.recordSpeed(3);

    // Pre-wave 1: all 3 challenges are on_track
    const initial = evaluateLiveLevelChallenges(level, observer.getTelemetry(), world.lives, 'ongoing', {
      'sunlit-meadow:perfect': true,
    });
    expect(initial.every((s) => s.state === 'on_track')).toBe(true);
    expect(initial[0].previouslyCompleted).toBe(true);
    expect(initial[1].progressLabel).toBe('0/6 towers');

    // Place 7 towers -> lean (<=6) transitions immediately to 'failed'
    const spots: Array<[number, number]> = [
      [4, 2],
      [4, 3],
      [7, 5],
      [8, 5],
      [10, 4],
      [5, 7],
      [7, 3],
    ];
    for (const [c, r] of spots) {
      world.gold = 500;
      expect(world.placeTower(c, r, 'archer')).not.toBeNull();
    }
    const after7 = evaluateLiveLevelChallenges(level, observer.getTelemetry(), world.lives, 'ongoing', {});
    expect(after7.find((s) => s.def.id === 'sunlit-meadow:lean')?.state).toBe('failed');
    expect(after7.find((s) => s.def.id === 'sunlit-meadow:perfect')?.state).toBe('on_track');

    // Start wave at 3x then drop to 1x -> rush3x transitions immediately to 'failed'
    world.startNextWave();
    observer.onTick(BALANCE.fixedDt, 1);
    const afterSlow = evaluateLiveLevelChallenges(level, observer.getTelemetry(), world.lives, 'ongoing', {});
    expect(afterSlow.find((s) => s.def.id === 'sunlit-meadow:rush3x')?.state).toBe('failed');

    // Test minEarlyWaves impossibility detection (L4 requires 6 early waves out of 14 waves)
    const l4 = LEVELS[3];
    const ev4 = new EventBus();
    const w4 = new SimWorld(l4, ev4);
    const obs4 = new RunObserver(l4, ev4);
    // Skip straight to wave 10 normally? No, simulate starting waves without early bonus (countdown expire)
    for (let w = 0; w < 10; w++) {
      ev4.emit('waveStarted', { waveIndex: w, totalWaves: l4.waves.length, earlyBonus: 0 });
    }
    // Only 4 waves left (11..14) and 0 early calls so far -> 0 + 4 < 6 -> mathematically failed!
    const l4Live = evaluateLiveLevelChallenges(l4, obs4.getTelemetry(), w4.lives, 'ongoing', {});
    expect(l4Live.find((s) => s.def.id === 'emerald-stepping-stones:early-waves')?.state).toBe('failed');

    obs4.dispose();
    observer.dispose();
  });

  it('freezes story challenge completion snapshot once won and stays intact in endless mode', () => {
    const level = makeSimpleTestLevel();
    const events = new EventBus();
    const world = new SimWorld(level, events);
    const meta = new MetaSession({
      levels: [level],
      onSave: () => {},
      getTodayDate: () => '2026-11-17',
    });

    meta.startRun(level, events, { speed: 3 });
    const archer = world.placeTower(4, 2, 'archer')!;
    world.upgradeTower(archer.id);
    world.upgradeTower(archer.id);
    world.startNextWave();
    for (let i = 0; i < 60 * 30 && world.waveSystem.state !== 'betweenWaves'; i++) {
      meta.onTick(BALANCE.fixedDt, 3);
      world.fixedTick(BALANCE.fixedDt);
    }
    world.startNextWave();
    for (let i = 0; i < 60 * 60 && world.outcome === 'ongoing'; i++) {
      meta.onTick(BALANCE.fixedDt, 3);
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(world.outcome).toBe('won');

    const postWinLive = meta.getLiveChallengeStates(world.lives, world.outcome);
    expect(postWinLive.every((s) => s.state === 'completed')).toBe(true);

    // Enter Endless Mode and break story constraints (build 7+ towers, drop speed to 1x)
    expect(world.enterEndlessMode()).toBe(true);
    meta.onEndlessEntered();
    meta.onSpeedChanged(1);
    const extraSpots: Array<[number, number]> = [
      [4, 3],
      [7, 5],
      [8, 5],
      [10, 4],
      [5, 7],
      [7, 3],
    ];
    for (const [c, r] of extraSpots) {
      world.gold = 500;
      expect(world.placeTower(c, r, 'archer')).not.toBeNull();
    }

    const duringEndlessLive = meta.getLiveChallengeStates(world.lives, world.outcome);
    expect(duringEndlessLive.every((s) => s.state === 'completed')).toBe(true);
    meta.dispose();
  });

  it('rejects challenges if enemies are debug-spawned outside wave phase or resumed after loss', () => {
    const level = makeSimpleTestLevel();
    const events1 = new EventBus();
    const world1 = new SimWorld(level, events1);
    const obs1 = new RunObserver(level, events1);
    // Simulate debug enemy spawn during preFirstWave
    world1.enemySystem.spawnEnemy('grunt');
    expect(obs1.getTelemetry().eligibleForChallenges).toBe(false);
    obs1.dispose();

    const events2 = new EventBus();
    const world2 = new SimWorld(level, events2);
    const obs2 = new RunObserver(level, events2);
    world2.startNextWave();
    world2.debugForceLose();
    world2.debugSkipToWave(1);
    expect(obs2.getTelemetry().eligibleForChallenges).toBe(false);
    obs2.dispose();
  });

  it('preserves challenge eligibility and accurate wave counts when calling waves early during clearing (Island 4)', () => {
    const level4 = LEVELS[3]; // Emerald Stepping Stones: 14 waves, challenge requires 6 early waves
    const events = new EventBus();
    const world = new SimWorld(level4, events);
    const observer = new RunObserver(level4, events);

    const queue = [...(level4.scriptedBuildOrder ?? [])];
    const tryStep = (): boolean => {
      while (queue.length > 0) {
        const a = queue[0];
        if (a.action === 'build') {
          const cost = getTowerTierStats(a.towerType!, 1).upgradeCost;
          if (world.gold < cost) return false;
          if (!world.placeTower(a.col, a.row, a.towerType!, a.targetingMode ?? 'first')) {
            queue.shift();
            continue;
          }
          queue.shift();
          return true;
        }
        const tid = world.grid.getTowerIdAt(a.col, a.row);
        const tw = tid === -1 ? null : world.getTowerById(tid);
        if (!tw || tw.tier >= 3) {
          queue.shift();
          continue;
        }
        const cost = getTowerTierStats(tw.type, (tw.tier + 1) as 2 | 3).upgradeCost;
        if (world.gold < cost) return false;
        if (world.upgradeTower(tid)) {
          queue.shift();
          return true;
        }
        queue.shift();
      }
      return false;
    };

    while (tryStep()) {
      // initial towers
    }
    world.startNextWave();

    let clearingEarlyCalls = 0;
    for (let tick = 0; tick < 60 * 1800 && world.outcome === 'ongoing'; tick++) {
      if (world.waveSystem.state === 'betweenWaves') {
        while (tryStep()) {
          // build between waves
        }
      } else if (tick % (60 * 6) === 0) {
        tryStep();
      }
      // Explicitly call next waves early during 'clearing' once few stragglers remain (realistic early-call pacing)
      if (
        world.waveSystem.state === 'clearing' &&
        world.enemyPool.getActiveCount() <= 3 &&
        clearingEarlyCalls < 7 &&
        world.waveSystem.canStartNextWave()
      ) {
        while (tryStep()) {
          // spend accumulated gold before rushing next wave
        }
        if (world.startNextWave()) clearingEarlyCalls++;
      }
      observer.onTick(BALANCE.fixedDt, 1);
      world.fixedTick(BALANCE.fixedDt);
    }

    expect(clearingEarlyCalls).toBeGreaterThanOrEqual(6);
    expect(world.outcome).toBe('won');
    const telemetry = observer.getTelemetry();
    expect(telemetry.eligibleForChallenges).toBe(true);
    expect(telemetry.storyWavesCompleted).toBe(level4.waves.length);
    expect(telemetry.wavesCompleted).toBe(level4.waves.length);
    expect(telemetry.earlyWavesCalled).toBe(clearingEarlyCalls);
    expect(observer.verifyEconomyIntegrity(world.gold, world.lives)).toBe(true);

    const completed = observer.evaluateCompletedChallenges(true, world.lives);
    expect(completed.some((c) => c.id === 'emerald-stepping-stones:early-waves')).toBe(true);
    observer.dispose();
  });

  it('detects mid-wave debugSkipToWave and out-of-band gold/lives tampering via verifyEconomyIntegrity', () => {
    const level = makeSimpleTestLevel();
    const events1 = new EventBus();
    const world1 = new SimWorld(level, events1);
    const obs1 = new RunObserver(level, events1);
    world1.startNextWave();
    // Skip straight to next wave mid-wave (earlyBonus === 0 while inWavePhase === true)
    world1.debugSkipToWave(2);
    expect(obs1.getTelemetry().eligibleForChallenges).toBe(false);
    obs1.dispose();

    const events2 = new EventBus();
    const world2 = new SimWorld(level, events2);
    const meta = new MetaSession({ levels: [level], onSave: () => {} });
    meta.startRun(level, events2);
    expect(meta.verifyWorldIntegrity(world2.gold, world2.lives)).toBe(true);
    // Simulate ?debug +500g cheat
    world2.gold += 500;
    expect(meta.verifyWorldIntegrity(world2.gold, world2.lives)).toBe(false);

    // Simulate ?debug Lives=20 cheat on another run
    const events3 = new EventBus();
    const world3 = new SimWorld(level, events3);
    meta.startRun(level, events3);
    world3.lives = 15;
    expect(meta.verifyWorldIntegrity(world3.gold, world3.lives)).toBe(false);
    meta.dispose();
  });

  it('scales fallback minLives reasonably for Master vs Heroic islands 10+', () => {
    const heroic10: LevelDef = { ...LEVELS[2], id: 'cloud-bastion', index: 9, difficulty: 'Heroic' };
    const master11: LevelDef = { ...LEVELS[8], id: 'abyssal-spire', index: 10, difficulty: 'Master' };
    const hCh = getChallengesForLevel(heroic10);
    const mCh = getChallengesForLevel(master11);
    expect(hCh[0].condition).toEqual({ kind: 'minLivesRemaining', minLives: 13 });
    expect(mCh[0].condition).toEqual({ kind: 'minLivesRemaining', minLives: 10 });
  });

  it('shows armed vs Set-before-W1 labels accurately on combatSpeedOnly live tracker', () => {
    const level = LEVELS[0];
    const events = new EventBus();
    const world = new SimWorld(level, events);
    const obs = new RunObserver(level, events);

    const at1x = evaluateLiveLevelChallenges(level, obs.getTelemetry(), world.lives, 'ongoing', {});
    expect(at1x.find((s) => s.def.id === 'sunlit-meadow:rush3x')?.progressLabel).toBe(
      'Set 3x before W1',
    );

    obs.recordSpeed(3);
    const armed = evaluateLiveLevelChallenges(level, obs.getTelemetry(), world.lives, 'ongoing', {});
    expect(armed.find((s) => s.def.id === 'sunlit-meadow:rush3x')?.progressLabel).toBe('3x armed');

    world.startNextWave();
    const locked = evaluateLiveLevelChallenges(level, obs.getTelemetry(), world.lives, 'ongoing', {});
    expect(locked.find((s) => s.def.id === 'sunlit-meadow:rush3x')?.progressLabel).toBe('3x locked');
    obs.dispose();
  });

  it('confirms tight curated challenges across Islands 2-9 are winnable in SimWorld', () => {
    const runScenario = (
      levelIdx: number,
      opts: {
        ban?: TowerType;
        sub?: TowerType;
        maxTier?: 2 | 3;
        maxGold?: number;
        maxTowers?: number;
        useAbilities?: boolean;
      },
    ): readonly string[] => {
      const level = LEVELS[levelIdx];
      const events = new EventBus();
      const world = new SimWorld(level, events);
      const obs = new RunObserver(level, events);
      obs.recordSpeed(3);

      const queue: ScriptedBuildAction[] = (level.scriptedBuildOrder ?? []).map((a) =>
        a.action === 'build' && opts.ban && a.towerType === opts.ban
          ? { ...a, towerType: opts.sub ?? 'archer' }
          : a,
      );
      let builtCount = 0;
      let spentGold = 0;
      const tryStep = (): boolean => {
        while (queue.length > 0) {
          const a = queue[0];
          if (a.action === 'build') {
            if (opts.maxTowers !== undefined && builtCount >= opts.maxTowers) {
              queue.shift();
              continue;
            }
            const cost = getTowerTierStats(a.towerType!, 1).upgradeCost;
            if (opts.maxGold !== undefined && spentGold + cost > opts.maxGold) {
              queue.shift();
              continue;
            }
            if (world.gold < cost) return false;
            if (!world.placeTower(a.col, a.row, a.towerType!, a.targetingMode ?? 'first')) {
              queue.shift();
              continue;
            }
            builtCount++;
            spentGold += cost;
            queue.shift();
            return true;
          }
          const tid = world.grid.getTowerIdAt(a.col, a.row);
          const tw = tid === -1 ? null : world.getTowerById(tid);
          if (!tw || tw.tier >= (opts.maxTier ?? 3)) {
            queue.shift();
            continue;
          }
          const cost = getTowerTierStats(tw.type, (tw.tier + 1) as 2 | 3).upgradeCost;
          if (opts.maxGold !== undefined && spentGold + cost > opts.maxGold) {
            queue.shift();
            continue;
          }
          if (world.gold < cost) return false;
          if (world.upgradeTower(tid)) {
            spentGold += cost;
            queue.shift();
            return true;
          }
          queue.shift();
        }
        return false;
      };

      while (tryStep()) {
        // pre-wave build
      }
      world.startNextWave();

      let combatCd = 8.0;
      let wasBetween = false;
      for (let t = 0; t < 60 * 2400 && world.outcome === 'ongoing'; t++) {
        const st = world.waveSystem.state;
        if (st === 'betweenWaves') {
          wasBetween = true;
          while (tryStep()) {
            // between-wave build
          }
        } else {
          if (wasBetween) {
            combatCd = 8.0;
            wasBetween = false;
          }
          combatCd = Math.max(0, combatCd - BALANCE.fixedDt);
          if (combatCd <= 0 && tryStep()) combatCd = 8.0;
        }
        if (opts.useAbilities !== false) {
          if (
            st !== 'preFirstWave' &&
            world.abilitySystem.canCast('overcharge') &&
            (world.towers.some((tw) => tw.stunTimer > 0) || world.enemyPool.getActiveCount() >= 10)
          ) {
            world.castOvercharge();
          }
          if (
            st !== 'preFirstWave' &&
            world.abilitySystem.canCast('meteor') &&
            world.enemyPool.getActiveCount() > 0
          ) {
            let target = null;
            for (let i = 0; i < world.enemyPool.getActiveCount(); i++) {
              const e = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
              if (!e.flying && (!target || e.dist > target.dist)) target = e;
            }
            if (target && (target.type === 'boss' || target.type === 'brute' || target.dist / target.totalDist > 0.5)) {
              world.castMeteor(target.x, target.z);
            }
          }
        }
        obs.onTick(BALANCE.fixedDt, 3);
        world.fixedTick(BALANCE.fixedDt);
      }

      expect(world.outcome).toBe('won');
      expect(obs.verifyEconomyIntegrity(world.gold, world.lives)).toBe(true);
      const ids = obs.evaluateCompletedChallenges(true, world.lives).map((c) => c.id);
      obs.dispose();
      return ids;
    };

    // Island 2 (Twin-Bridge Cay): all 3 curated challenges
    expect(runScenario(1, { maxTier: 2 })).toContain('twin-bridge-cay:max-t2');
    expect(runScenario(1, { ban: 'frost', sub: 'archer' })).toContain('twin-bridge-cay:no-frost');
    expect(runScenario(1, { useAbilities: false })).toContain('twin-bridge-cay:no-abilities');

    // Island 3 (Highland Citadel): all 3 curated challenges
    expect(runScenario(2, { ban: 'mortar', sub: 'cannon' })).toEqual(
      expect.arrayContaining(['highland-citadel:no-mortar', 'highland-citadel:no-sell', 'highland-citadel:sturdy']),
    );

    // Island 4 (Emerald Stepping Stones): no-tesla & frugal (early-waves covered in dedicated test)
    expect(runScenario(3, { ban: 'tesla', sub: 'archer' })).toEqual(
      expect.arrayContaining(['emerald-stepping-stones:no-tesla', 'emerald-stepping-stones:frugal']),
    );

    // Island 5 (Windmill Switchback): all 3 curated challenges
    expect(runScenario(4, { ban: 'cannon', sub: 'mortar' })).toEqual(
      expect.arrayContaining(['windmill-switchback:no-cannon', 'windmill-switchback:perfect', 'windmill-switchback:rush3x']),
    );

    // Island 6 (Crescent Lagoon): all 3 curated challenges
    expect(runScenario(5, { maxGold: 3100 })).toContain('crescent-lagoon:frugal');
    expect(runScenario(5, { ban: 'frost', sub: 'archer' })).toContain('crescent-lagoon:no-frost');
    expect(runScenario(5, { useAbilities: false })).toContain('crescent-lagoon:no-abilities');

    // Island 7 (Skybridge Gauntlet): all 3 curated challenges
    expect(runScenario(6, { maxTowers: 15 })).toContain('skybridge-gauntlet:lean');
    expect(runScenario(6, { ban: 'cannon', sub: 'mortar' })).toEqual(
      expect.arrayContaining(['skybridge-gauntlet:no-cannon', 'skybridge-gauntlet:sturdy']),
    );

    // Island 8 (Sunken Bastion): all 3 curated challenges
    expect(runScenario(7, { maxGold: 5200 })).toEqual(
      expect.arrayContaining(['sunken-bastion:frugal', 'sunken-bastion:rush3x']),
    );
    expect(runScenario(7, { ban: 'tesla', sub: 'archer' })).toContain('sunken-bastion:no-tesla');

    // Island 9 (Grand Skyhold): all 3 curated challenges
    expect(runScenario(8, { ban: 'mortar', sub: 'cannon' })).toEqual(
      expect.arrayContaining(['grand-skyhold:no-mortar', 'grand-skyhold:no-sell']),
    );
    expect(runScenario(8, {})).toContain('grand-skyhold:sturdy');
  });

  it('scales Islands 10+ fallback tower cap from scriptedBuildOrder and tracks early Endless waves accurately', () => {
    const scripted20 = Array.from({ length: 20 }, (_, idx) => ({
      waveIndex: idx,
      action: 'build' as const,
      col: 4 + (idx % 4),
      row: 2 + Math.floor(idx / 4),
      towerType: 'archer' as const,
    }));
    const futureWithScript: LevelDef = {
      ...LEVELS[7],
      id: 'tempest-citadel',
      index: 9,
      scriptedBuildOrder: scripted20,
    };
    const futureWithoutScript: LevelDef = {
      ...LEVELS[7],
      id: 'unscripted-isle',
      index: 10,
      scriptedBuildOrder: undefined,
    };

    const withScriptCh = getChallengesForLevel(futureWithScript).find((c) => c.condition.kind === 'maxTowersBuilt');
    const noScriptCh = getChallengesForLevel(futureWithoutScript).find((c) => c.condition.kind === 'maxTowersBuilt');
    expect(withScriptCh?.condition).toEqual({ kind: 'maxTowersBuilt', maxCount: 17 });
    expect(noScriptCh?.condition).toEqual({ kind: 'maxTowersBuilt', maxCount: 15 });

    // Endless Mode early-wave calling during 'allSpawned' must absorb & count every Endless wave and preserve gold integrity
    const miniLevel = makeSimpleTestLevel({
      startingGold: 4000,
      waves: [{ clearBonus: 20, groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 0.3, startDelay: 0 }] }],
    });
    const events = new EventBus();
    const world = new SimWorld(miniLevel, events);
    const obs = new RunObserver(miniLevel, events);

    const spots: Array<[number, number, TowerType]> = [
      [4, 2, 'archer'],
      [4, 3, 'cannon'],
      [7, 5, 'frost'],
      [8, 5, 'tesla'],
      [10, 4, 'tesla'],
      [5, 7, 'mortar'],
    ];
    for (const [c, r, t] of spots) {
      const tw = world.placeTower(c, r, t);
      if (tw) {
        world.upgradeTower(tw.id);
        world.upgradeTower(tw.id);
      }
    }
    world.startNextWave();
    runTicksUntilSettled(world, obs, 3);
    expect(world.outcome).toBe('won');

    expect(world.enterEndlessMode({ goldRewardMultiplier: 0.75, activeMutatorIds: ['gold_drought'] })).toBe(true);
    obs.setModifiers({ goldRewardMultiplier: 0.75, activeMutatorIds: ['gold_drought'] });

    // Start Endless Wave 2 during the 5s endless betweenWaves countdown (early call #1),
    // wait until 'allSpawned', then immediately early-call Endless Wave 3 (early call #2)
    world.startNextWave();
    expect(obs.getTelemetry().earlyWavesCalled).toBe(1);
    for (let i = 0; i < 60 * 30 && world.waveSystem.state !== 'allSpawned'; i++) {
      obs.onTick(BALANCE.fixedDt, 3);
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(world.waveSystem.state).toBe('allSpawned');
    expect(world.startNextWave()).toBe(true);

    // Let both overlapping Endless waves clear completely
    for (let i = 0; i < 60 * 120 && world.waveSystem.state !== 'betweenWaves'; i++) {
      obs.onTick(BALANCE.fixedDt, 3);
      world.fixedTick(BALANCE.fixedDt);
    }

    const telemetry = obs.getTelemetry();
    expect(telemetry.endlessWavesCompleted).toBe(2);
    expect(telemetry.earlyWavesCalled).toBe(2);
    expect(obs.verifyEconomyIntegrity(world.gold, world.lives)).toBe(true);
    obs.dispose();
  });

  it('taints post-loss Endless debugSkipToWave and rejects advantageous custom modifiers on challenges', () => {
    const level = makeSimpleTestLevel({
      waves: [{ clearBonus: 20, groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 0.3, startDelay: 0 }] }],
    });

    // 1. Lose in Endless then debugSkipToWave to next wave -> must taint eligibility
    const ev1 = new EventBus();
    const w1 = new SimWorld(level, ev1);
    const obs1 = new RunObserver(level, ev1);
    w1.placeTower(4, 2, 'archer');
    w1.startNextWave();
    runTicksUntilSettled(w1, obs1, 3);
    expect(w1.outcome).toBe('won');
    expect(w1.enterEndlessMode()).toBe(true);
    w1.startNextWave();
    w1.debugForceLose();
    // Skip straight to the next endless wave index after losing in Endless
    w1.debugSkipToWave(3);
    expect(obs1.getTelemetry().eligibleForChallenges).toBe(false);
    obs1.dispose();

    // 2. Advantageous custom modifiers (e.g. weaker enemies or bonus starting gold) must not award challenges
    const ev2 = new EventBus();
    const w2 = new SimWorld(level, ev2, { enemyHpMultiplier: 0.5, startingGoldMultiplier: 1.5 });
    const obs2 = new RunObserver(level, ev2, { enemyHpMultiplier: 0.5, startingGoldMultiplier: 1.5 });
    expect(isAdvantageousModifiers(obs2.getModifiers())).toBe(true);
    w2.placeTower(4, 2, 'archer');
    w2.startNextWave();
    runTicksUntilSettled(w2, obs2, 3);
    expect(w2.outcome).toBe('won');
    expect(obs2.getTelemetry().eligibleForChallenges).toBe(false);
    expect(obs2.evaluateCompletedChallenges(true, w2.lives)).toHaveLength(0);
    obs2.dispose();
  });

  it('keeps run eligible across economyChanged bridge emissions during kills, leaks, early calls, and wave clears', () => {
    const level = makeSimpleTestLevel({
      startingGold: 300,
      waves: [
        {
          clearBonus: 30,
          groups: [
            { enemyType: 'grunt', count: 3, spawnInterval: 0.35, startDelay: 0 },
            { enemyType: 'runner', count: 2, spawnInterval: 0.35, startDelay: 0.2 },
          ],
        },
        {
          clearBonus: 40,
          groups: [{ enemyType: 'flyer', count: 2, spawnInterval: 0.4, startDelay: 0 }],
        },
      ],
    });
    const events = new EventBus();
    const world = new SimWorld(level, events);
    const meta = new MetaSession({ levels: [level], onSave: () => {} });
    meta.startRun(level, events, { speed: 3 });

    // Mirror GameSession.bindSimEvents deferIntegrityCheck pattern on economyChanged
    let deferIntegrityCheck = false;
    const syncUi = () => {
      if (!deferIntegrityCheck && world.outcome === 'ongoing') {
        meta.verifyWorldIntegrity(world.gold, world.lives);
      }
    };
    events.on('economyChanged', () => {
      const prev = deferIntegrityCheck;
      deferIntegrityCheck = true;
      try {
        syncUi();
      } finally {
        deferIntegrityCheck = prev;
      }
    });

    // Place a single weak Tier-1 archer near start? No, place far back or let Wave 1 leak runners first, then build
    const frontTower = world.placeTower(10, 4, 'archer')!;
    expect(frontTower).not.toBeNull();
    world.startNextWave();
    syncUi();

    for (let t = 0; t < 60 * 35 && world.waveSystem.state !== 'betweenWaves' && world.outcome === 'ongoing'; t++) {
      if (world.outcome === 'ongoing') {
        meta.onTick(BALANCE.fixedDt, 3);
        meta.verifyWorldIntegrity(world.gold, world.lives);
      }
      world.fixedTick(BALANCE.fixedDt);
      if (world.outcome === 'ongoing') {
        meta.verifyWorldIntegrity(world.gold, world.lives);
      }
    }

    // Build more defense before calling Wave 2 early
    world.upgradeTower(frontTower.id);
    world.placeTower(4, 2, 'archer');
    expect(world.startNextWave()).toBe(true);
    syncUi();

    for (let t = 0; t < 60 * 60 && world.outcome === 'ongoing'; t++) {
      meta.onTick(BALANCE.fixedDt, 3);
      meta.verifyWorldIntegrity(world.gold, world.lives);
      world.fixedTick(BALANCE.fixedDt);
      if (world.outcome === 'ongoing') {
        meta.verifyWorldIntegrity(world.gold, world.lives);
      }
    }

    expect(world.outcome).toBe('won');
    expect(meta.isCurrentRunEligible()).toBe(true);
    expect(meta.getStats().enemiesDefeatedTotal).toBeGreaterThan(0);

    // Confirm direct out-of-band gold mutation still taints immediately via syncUi
    const cheatEv = new EventBus();
    const cheatWorld = new SimWorld(level, cheatEv);
    meta.startRun(level, cheatEv);
    cheatWorld.gold += 100;
    expect(meta.verifyWorldIntegrity(cheatWorld.gold, cheatWorld.lives)).toBe(false);
    expect(meta.isCurrentRunEligible()).toBe(false);

    // SimWorld.debugTainted catches betweenWaves next-wave debugSkipToWave & debugForceWin
    const skipEv = new EventBus();
    const skipWorld = new SimWorld(level, skipEv);
    meta.startRun(level, skipEv);
    expect(skipWorld.debugTainted).toBe(false);
    skipWorld.placeTower(4, 2, 'archer');
    skipWorld.upgradeTower(1);
    skipWorld.startNextWave();
    for (let t = 0; t < 60 * 30 && skipWorld.waveSystem.state !== 'betweenWaves'; t++) {
      meta.onTick(BALANCE.fixedDt, 3);
      skipWorld.fixedTick(BALANCE.fixedDt);
    }
    expect(skipWorld.waveSystem.state).toBe('betweenWaves');
    skipWorld.debugSkipToWave(2);
    expect(skipWorld.debugTainted).toBe(true);
    if (skipWorld.debugTainted) meta.markDebugTainted();
    expect(meta.isCurrentRunEligible()).toBe(false);

    // maxPeakTowers live status explains Peak X/Y failure even after selling back down
    const peakEv = new EventBus();
    const peakWorld = new SimWorld(level, peakEv);
    const peakObs = new RunObserver(level, peakEv);
    const tA = peakWorld.placeTower(4, 2, 'archer')!;
    peakWorld.placeTower(4, 3, 'archer');
    peakWorld.placeTower(7, 5, 'archer');
    peakWorld.sellTower(tA.id);
    const peakLive = evaluateLiveChallengeState(
      {
        id: 'test:peak',
        levelId: level.id,
        title: 'Peak Cap',
        description: 'At most 2 active towers at once.',
        condition: { kind: 'maxPeakTowers', maxCount: 2 },
      },
      peakObs.getTelemetry(),
      peakWorld.lives,
      'ongoing',
      false,
    );
    expect(peakLive.state).toBe('failed');
    expect(peakLive.progressLabel).toBe('Peak 3/2');
    peakObs.dispose();
    meta.dispose();
  });
});
