import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import type { ProgressData } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ACHIEVEMENTS } from '../../src/data/challenges.ts';
import { LEVELS, type LevelDef } from '../../src/data/levels/index.ts';
import { MetaSession } from '../../src/platform/metaSession.ts';
import {
  getTodayUtcDateString,
  loadMetaSave,
  loadProgress,
  loadSettings,
  META_PROGRESS_KEY,
  PROGRESS_KEY,
  saveMetaSave,
} from '../../src/platform/storage.ts';
import {
  applyTelemetryDeltaToStats,
  createDefaultMetaSave,
  getAchievements,
  getAchievementSummary,
  getAllChallengeProgress,
  getChallengeStatus,
  getDailyBestScore,
  getEnemyIntelStats,
  getIslandMasteryStatus,
  getMetaCareerRank,
  getMetaCareerSummary,
  getRecentDailyHistory,
  getRecommendedNextGoal,
  getStats,
  getTowerMasteryStats,
  importMetaSaveJson,
  mergeCampaignProgress,
  mergeMetaSaves,
  migrateToMetaSave,
  recomputeAchievements,
  recordRunCompletion,
} from '../../src/sim/meta/metaEngine.ts';
import { RunObserver } from '../../src/sim/meta/runObserver.ts';
import { SimWorld } from '../../src/sim/world.ts';

function installMockLocalStorage(initial?: Record<string, string>): Map<string, string> {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  const mockStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
  return store;
}

afterEach(() => {
  // Clean up mock global if installed
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('Save migration from skyhold_isles_progress_v1', () => {
  it('migrates v1 progress without wiping stars, unlockedLevelIndex, or endless records', () => {
    const v1: ProgressData = {
      unlockedLevelIndex: 4,
      bestStars: [3, 2, 2, 1, 0, 0, 0, 0, 0],
      bestEndlessWaves: [16, 12, 0, 0, 0, 0, 0, 0, 0],
    };

    const migrated = migrateToMetaSave(null, v1, 9, LEVELS);
    expect(migrated.version).toBe(2);
    expect(migrated.campaign.unlockedLevelIndex).toBe(4);
    expect(migrated.campaign.bestStars).toEqual([3, 2, 2, 1, 0, 0, 0, 0, 0]);
    expect(migrated.campaign.bestEndlessWaves).toEqual([16, 12, 0, 0, 0, 0, 0, 0, 0]);
    expect(migrated.stats.bestEndlessWaveOverall).toBe(16);
    expect(migrated.stats.gamesWon).toBeGreaterThanOrEqual(4);

    // Retroactive achievements unlocked from existing v1 data
    expect(migrated.unlockedAchievements.first_victory).toBe(true);
    expect(migrated.unlockedAchievements.endless_survivor).toBe(true);
  });

  it('merges v1 and v2 monotonically and expands safely when new levels are added', () => {
    const existingV2 = createDefaultMetaSave(9);
    existingV2.campaign.unlockedLevelIndex = 2;
    existingV2.campaign.bestStars[0] = 3;
    existingV2.completedChallenges['sunlit-meadow:perfect'] = true;

    const newerV1: ProgressData = {
      unlockedLevelIndex: 5,
      bestStars: [2, 3, 2, 1, 1, 0, 0, 0, 0],
      bestEndlessWaves: [0, 18, 0, 0, 0, 0, 0, 0, 0],
    };

    // Simulate 12 levels after an expansion
    const expanded = migrateToMetaSave(existingV2, newerV1, 12, LEVELS);
    expect(expanded.campaign.unlockedLevelIndex).toBe(5);
    expect(expanded.campaign.bestStars).toHaveLength(12);
    expect(expanded.campaign.bestStars[0]).toBe(3); // Kept higher v2 star
    expect(expanded.campaign.bestStars[1]).toBe(3); // Merged higher v1 star
    expect(expanded.campaign.bestEndlessWaves[1]).toBe(18);
    expect(expanded.completedChallenges['sunlit-meadow:perfect']).toBe(true);
  });

  it('handles malformed storage JSON safely without throwing', () => {
    const recovered = migrateToMetaSave('corrupt', { bestStars: ['bad', 99, -2] }, 9, LEVELS);
    expect(recovered.version).toBe(2);
    expect(recovered.campaign.bestStars[0]).toBe(0);
    expect(recovered.campaign.bestStars[1]).toBe(3); // clamped to 3
    expect(recovered.campaign.bestStars[2]).toBe(0); // clamped to 0
  });

  it('persists via localStorage and keeps skyhold_isles_progress_v1 synced', () => {
    const v1Seed: ProgressData = {
      unlockedLevelIndex: 3,
      bestStars: [3, 3, 2, 0, 0, 0, 0, 0, 0],
      bestEndlessWaves: [15, 0, 0, 0, 0, 0, 0, 0, 0],
    };
    const store = installMockLocalStorage({
      [PROGRESS_KEY]: JSON.stringify(v1Seed),
    });

    const loaded = loadMetaSave(9, LEVELS);
    expect(loaded.campaign.unlockedLevelIndex).toBe(3);
    expect(loaded.campaign.bestStars[0]).toBe(3);
    expect(loaded.stats.bestEndlessWaveOverall).toBe(15);

    loaded.completedChallenges['sunlit-meadow:perfect'] = true;
    loaded.campaign.bestStars[3] = 2;
    loaded.campaign.unlockedLevelIndex = 4;
    saveMetaSave(loaded);

    expect(store.has(META_PROGRESS_KEY)).toBe(true);
    const v1After = loadProgress(9);
    expect(v1After.unlockedLevelIndex).toBe(4);
    expect(v1After.bestStars[3]).toBe(2);
  });
});

describe('MetaSession stats, achievements, challenges & daily persistence', () => {
  it('tracks stats incrementally without double-counting and exposes typed UI APIs', () => {
    installMockLocalStorage();
    const tinyLevel: LevelDef = {
      ...LEVELS[0],
      startingGold: 1000,
      waves: [
        {
          clearBonus: 25,
          groups: [{ enemyType: 'grunt', count: 3, spawnInterval: 0.4, startDelay: 0 }],
        },
        {
          clearBonus: 35,
          groups: [{ enemyType: 'flyer', count: 2, spawnInterval: 0.4, startDelay: 0 }],
        },
      ],
    };
    const testLevels = [tinyLevel, ...LEVELS.slice(1)];

    const meta = new MetaSession({
      levels: testLevels,
      getTodayDate: () => '2026-11-17',
    });

    const events = new EventBus();
    const world = new SimWorld(tinyLevel, events);
    meta.startRun(tinyLevel, events, { speed: 3 });

    const tower = world.placeTower(4, 2, 'archer')!;
    world.upgradeTower(tower.id);
    world.upgradeTower(tower.id); // Tier 3

    world.startNextWave();
    for (let i = 0; i < 60 * 30 && world.waveSystem.state !== 'betweenWaves'; i++) {
      meta.onTick(BALANCE.fixedDt, 3);
      world.fixedTick(BALANCE.fixedDt);
    }
    // Wave 1 completed -> stats flushed mid-run
    const midStats = meta.getStats();
    expect(midStats.wavesCleared).toBe(1);
    expect(midStats.enemiesDefeatedTotal).toBe(3);
    expect(midStats.enemiesDefeatedByType.grunt).toBe(3);
    expect(midStats.towersBuiltTotal).toBe(1);
    expect(midStats.towersUpgradedToTier3).toBe(1);

    // Early-call wave 2 and finish run
    world.startNextWave();
    for (let i = 0; i < 60 * 60 && world.outcome === 'ongoing'; i++) {
      meta.onTick(BALANCE.fixedDt, 3);
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(world.outcome).toBe('won');

    const finalStats = meta.getStats();
    expect(finalStats.gamesPlayed).toBe(1);
    expect(finalStats.gamesWon).toBe(1);
    expect(finalStats.wavesCleared).toBe(2); // No double-count of wave 1!
    expect(finalStats.enemiesDefeatedTotal).toBe(5); // 3 grunts + 2 flyers
    expect(finalStats.flyingEnemiesDefeated).toBe(2);
    expect(finalStats.earlyWavesCalled).toBe(1);
    expect(finalStats.perfectClears).toBe(1);
    expect(finalStats.totalPlayTimeSec).toBeGreaterThan(2);

    const outcome = meta.getLastRunOutcome();
    expect(outcome).not.toBeNull();
    expect(outcome!.won).toBe(true);
    expect(outcome!.newlyCompletedChallengeIds).toEqual([
      'sunlit-meadow:perfect',
      'sunlit-meadow:lean',
      'sunlit-meadow:rush3x',
    ]);
    expect(outcome!.newlyUnlockedAchievementIds).toContain('first_victory');
    expect(outcome!.newlyUnlockedAchievementIds).toContain('flawless_defense');
    expect(outcome!.newlyUnlockedAchievementIds).toContain('speed_demon');
    expect(outcome!.newlyUnlockedAchievementIds).toContain('minimalist');

    // Typed UI queries
    const chStatus = meta.getChallengeStatus(0)!;
    expect(chStatus.earnedStars).toBe(3);
    expect(chStatus.totalStars).toBe(3);
    expect(meta.getLiveChallengeStates(world.lives, world.outcome).every((s) => s.state === 'completed')).toBe(true);
    expect(meta.getAllowedTowerTypes()).toHaveLength(5);
    expect(meta.isTowerAllowed('archer')).toBe(true);
    expect(meta.getAllChallengeProgress().earnedStars).toBe(3);
    expect(meta.getChallengeStatus(99)).toBeNull();

    const achievements = meta.getAchievements();
    expect(achievements).toHaveLength(ACHIEVEMENTS.length);
    expect(achievements.find((a) => a.def.id === 'first_victory')?.unlocked).toBe(true);

    // Reload from localStorage into a fresh MetaSession to verify persistence
    const reloaded = new MetaSession({
      levels: testLevels,
      getTodayDate: () => '2026-11-17',
    });
    expect(reloaded.getStats().enemiesDefeatedTotal).toBe(5);
    expect(reloaded.getChallengeStatus(0)!.earnedStars).toBe(3);
    expect(reloaded.getAchievements().find((a) => a.def.id === 'speed_demon')?.unlocked).toBe(true);
    meta.dispose();
    reloaded.dispose();
  });

  it('records daily challenge completion without unlocking locked campaign islands', () => {
    installMockLocalStorage();
    const quickLevels: LevelDef[] = LEVELS.map((lvl, idx) => ({
      ...lvl,
      index: idx,
      startingGold: 1500,
      waves: [
        {
          clearBonus: 30,
          groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 0.4, startDelay: 0 }],
        },
      ],
    }));

    // Pick a date whose daily lands on a non-zero island
    let dailyDate = '2026-11-17';
    const probe = new MetaSession({ levels: quickLevels, getTodayDate: () => dailyDate });
    for (let d = 1; d <= 20; d++) {
      const candidate = `2026-11-${String(d).padStart(2, '0')}`;
      if (probe.getDailyChallenge(candidate).levelIndex > 1) {
        dailyDate = candidate;
        break;
      }
    }
    const spec = probe.getDailyChallenge(dailyDate);
    expect(spec.levelIndex).toBeGreaterThan(1);
    expect(probe.getCampaignProgress().unlockedLevelIndex).toBe(0);

    const events = new EventBus();
    const dailyLevel = quickLevels[spec.levelIndex];
    const world = new SimWorld(dailyLevel, events, spec.modifiers);
    probe.startRun(world.level, events, {
      modifiers: spec.modifiers,
      dailyDate: spec.date,
    });

    // Find a buildable grass tile and place an archer (if allowed) or any legal tower
    const allowedTower =
      spec.modifiers.allowedTowerTypes?.[0] ??
      (['archer', 'tesla', 'frost', 'cannon', 'mortar'] as const).find(
        (t) => !spec.modifiers.forbiddenTowerTypes.includes(t),
      )!;
    let placed = false;
    for (let r = 0; r < world.level.rows && !placed; r++) {
      for (let c = 0; c < world.level.cols && !placed; c++) {
        if (world.grid.canPlaceTower(c, r)) {
          placed = world.placeTower(c, r, allowedTower) !== null;
        }
      }
    }
    expect(placed).toBe(true);

    world.startNextWave();
    for (let i = 0; i < 60 * 40 && world.outcome === 'ongoing'; i++) {
      probe.onTick(BALANCE.fixedDt, 1);
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(world.outcome).toBe('won');

    const dailyStatus = probe.getDailyStatus(dailyDate);
    expect(dailyStatus.completedToday).toBe(true);
    expect(dailyStatus.bestScoreToday).toBeGreaterThan(0);
    expect(dailyStatus.totalDailyCompleted).toBe(1);
    expect(dailyStatus.currentStreak).toBe(1);
    expect(dailyStatus.bestStreak).toBe(1);
    // Campaign progress remains untouched so daily doesn't bypass campaign progression
    expect(probe.getCampaignProgress().unlockedLevelIndex).toBe(0);
    expect(probe.getAchievements().find((a) => a.def.id === 'daily_victor')?.unlocked).toBe(true);
    probe.dispose();
  });

  it('tracks overcharge tower cleansing and boss defeats in achievements', () => {
    const save = createDefaultMetaSave(9);
    const events = new EventBus();
    const level = LEVELS[0];
    const meta = new MetaSession({ levels: LEVELS, saveData: save, onSave: () => {} });

    meta.startRun(level, events);
    events.emit('overchargeActivated', { duration: 7, cleansedTowerIds: [1, 2] });
    for (let i = 0; i < 10; i++) {
      events.emit('enemyKilled', {
        enemyId: 100 + i,
        enemyType: 'boss',
        reward: 35,
        x: 0,
        y: 0,
        z: 0,
      });
    }
    meta.flushStats(false);

    const achs = getAchievements(save);
    expect(achs.find((a) => a.def.id === 'overcharge_cleanse')?.unlocked).toBe(true);
    expect(achs.find((a) => a.def.id === 'boss_slayer_10')?.unlocked).toBe(true);
    expect(getStats(save).enemiesDefeatedByType.boss).toBe(10);
    expect(getChallengeStatus(save, 0, LEVELS)?.totalStars).toBe(3);
    expect(getAllChallengeProgress(save, LEVELS).totalStars).toBe(27);
    meta.dispose();
  });

  it('tracks mutated endless waves, endless scores on quit, daily streaks, and rejects debug daily wins', () => {
    installMockLocalStorage();
    const tinyLevel: LevelDef = {
      ...LEVELS[0],
      startingGold: 1500,
      waves: [
        {
          clearBonus: 30,
          groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 0.4, startDelay: 0 }],
        },
      ],
    };
    const meta = new MetaSession({
      levels: [tinyLevel],
      getTodayDate: () => '2026-11-17',
    });

    // 1. Debug-forced win on a Daily Challenge must NOT grant daily completion or daily_victor
    const dailyEv = new EventBus();
    const dailySpec = meta.getDailyChallenge('2026-11-17');
    const dailyWorld = new SimWorld(tinyLevel, dailyEv, dailySpec.modifiers);
    meta.startRun(tinyLevel, dailyEv, {
      modifiers: dailySpec.modifiers,
      dailyDate: '2026-11-17',
    });
    expect(meta.getActiveDailyChallenge()?.date).toBe('2026-11-17');
    expect(meta.getActiveModifierBadges().length).toBeGreaterThanOrEqual(dailySpec.mutators.length);
    dailyWorld.debugForceWin();
    expect(meta.getDailyStatus('2026-11-17').completedToday).toBe(false);
    expect(meta.getStats().gamesWon).toBe(0);

    // 2. Story win followed by mutated Endless waves -> quitting mid-Endless still flushes score & achievement
    const ev = new EventBus();
    const world = new SimWorld(tinyLevel, ev);
    meta.startRun(tinyLevel, ev);
    world.placeTower(4, 2, 'archer');
    world.upgradeTower(1);
    world.upgradeTower(1);
    world.startNextWave();
    for (let i = 0; i < 60 * 30 && world.outcome === 'ongoing'; i++) {
      meta.onTick(BALANCE.fixedDt, 1);
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(world.outcome).toBe('won');

    const mutators = meta.rollEndlessMutators('season-test', 2);
    expect(world.enterEndlessMode(mutators.modifiers)).toBe(true);
    meta.onEndlessEntered(mutators.modifiers);
    expect(meta.getActiveModifierBadges().length).toBe(2);

    // Clear 5 endless waves cleanly by upgrading a full defense & letting combat play out
    world.gold = 6000;
    const placements: Array<[number, number, 'archer' | 'cannon' | 'frost' | 'tesla' | 'mortar']> = [
      [4, 3, 'cannon'],
      [7, 5, 'frost'],
      [8, 5, 'archer'],
      [10, 4, 'tesla'],
      [5, 7, 'mortar'],
      [7, 3, 'cannon'],
      [6, 2, 'tesla'],
    ];
    for (const [col, row, type] of placements) {
      const t = world.placeTower(col, row, type);
      if (t) {
        world.upgradeTower(t.id);
        world.upgradeTower(t.id);
      }
    }

    let endlessWavesCompleted = 0;
    ev.on('waveCompleted', (w) => {
      if (w.waveIndex >= tinyLevel.waves.length) endlessWavesCompleted++;
    });
    for (let i = 0; i < 60 * 180 && endlessWavesCompleted < 5 && world.outcome === 'ongoing'; i++) {
      if (world.waveSystem.state === 'betweenWaves') {
        world.startNextWave();
      }
      meta.onTick(BALANCE.fixedDt, 3);
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(endlessWavesCompleted).toBeGreaterThanOrEqual(5);

    // Quit mid-run without dying -> endRun() flushes bestEndlessScoreOverall & mutated_endless
    meta.endRun();
    const stats = meta.getStats();
    expect(stats.bestEndlessScoreOverall).toBeGreaterThan(0);
    expect(stats.bestEndlessWaveOverall).toBeGreaterThanOrEqual(6);
    const achs = meta.getAchievements();
    expect(achs.find((a) => a.def.id === 'mutated_endless')?.unlocked).toBe(true);

    // 3. Migrate a save with 3 consecutive daily dates -> unlocks daily_streak_3
    const partialV2 = meta.getSaveSnapshot();
    partialV2.completedDailyDates = ['2026-11-15', '2026-11-16', '2026-11-17'];
    const migrated = migrateToMetaSave(partialV2, null, 9, LEVELS);
    expect(migrated.unlockedAchievements.daily_streak_3).toBe(true);
    meta.dispose();
  });

  it('preserves mid-run achievement unlocks in lastRunOutcome and does not count Endless loss as gamesLost', () => {
    installMockLocalStorage();
    const save = createDefaultMetaSave(9);
    // Seed 249 kills before run so killing enemy #1 in Wave 1 unlocks slayer_250 mid-run!
    save.stats.enemiesDefeatedTotal = 249;

    const twoWaveLevel: LevelDef = {
      ...LEVELS[0],
      startingGold: 1000,
      waves: [
        { clearBonus: 20, groups: [{ enemyType: 'grunt', count: 2, spawnInterval: 0.3, startDelay: 0 }] },
        { clearBonus: 25, groups: [{ enemyType: 'grunt', count: 2, spawnInterval: 0.3, startDelay: 0 }] },
      ],
    };

    const meta = new MetaSession({
      levels: [twoWaveLevel, ...LEVELS.slice(1)],
      saveData: save,
      getTodayDate: () => '2026-11-17',
    });

    const events = new EventBus();
    const world = new SimWorld(twoWaveLevel, events);
    meta.startRun(twoWaveLevel, events, { speed: 3 });
    const archer = world.placeTower(4, 2, 'archer')!;
    world.upgradeTower(archer.id);
    world.upgradeTower(archer.id);

    // Wave 1 completes -> flushStats unlocks slayer_250 mid-run!
    world.startNextWave();
    for (let i = 0; i < 60 * 30 && world.waveSystem.state !== 'betweenWaves'; i++) {
      meta.onTick(BALANCE.fixedDt, 3);
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(meta.getAchievements().find((a) => a.def.id === 'slayer_250')?.unlocked).toBe(true);

    // Finish Wave 2 -> gameWon outcome must STILL report slayer_250 among newlyUnlockedAchievementIds
    world.startNextWave();
    for (let i = 0; i < 60 * 30 && world.outcome === 'ongoing'; i++) {
      meta.onTick(BALANCE.fixedDt, 3);
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(world.outcome).toBe('won');
    const storyOutcome = meta.getLastRunOutcome()!;
    expect(storyOutcome.won).toBe(true);
    expect(storyOutcome.newlyUnlockedAchievementIds).toContain('slayer_250');
    expect(storyOutcome.newlyUnlockedAchievementIds).toContain('first_victory');

    // Continue into Endless, clear 1 Endless wave, then lose -> gamesLost must stay 0!
    const roll = meta.getMutatorPresetRoll('iron-skies')!;
    expect(world.enterEndlessMode(roll.modifiers)).toBe(true);
    meta.onEndlessEntered(roll.modifiers);
    world.startNextWave();
    for (let i = 0; i < 60 * 60 && world.waveSystem.state !== 'betweenWaves'; i++) {
      meta.onTick(BALANCE.fixedDt, 3);
      world.fixedTick(BALANCE.fixedDt);
    }
    // Force defeat in Endless
    world.debugForceLose();

    const statsAfterEndless = meta.getStats();
    expect(statsAfterEndless.gamesWon).toBe(1);
    expect(statsAfterEndless.gamesLost).toBe(0);

    const endlessOutcome = meta.getLastRunOutcome()!;
    expect(endlessOutcome.endlessScore).not.toBeNull();
    expect(endlessOutcome.endlessScore!.totalScore).toBeGreaterThan(0);

    // Check Island Mastery, Personal Bests, Rank & Career Summary APIs
    const mastery = meta.getIslandMasteryStatus(0)!;
    expect(mastery.campaignStars).toBe(3);
    expect(mastery.challengeStars).toBe(3);
    expect(mastery.mastered).toBe(true);
    expect(mastery.bestEndlessScore).toBeGreaterThan(0);
    expect(mastery.bestLivesRemaining).toBe(20);
    expect(mastery.fastestWinSec).toBeGreaterThan(0);

    expect(storyOutcome.isNewFastestWin).toBe(true);
    expect(endlessOutcome.isNewBestEndlessWave).toBe(true);
    expect(endlessOutcome.isNewBestEndlessScore).toBe(true);

    const summary = meta.getMetaCareerSummary();
    expect(summary.islandsMastered).toBe(1);
    expect(summary.winRatePct).toBe(100);
    expect(summary.favoriteTowerType).toBe('archer');
    expect(summary.mostDefeatedEnemyType).toBe('grunt');
    expect(summary.rank.points).toBeGreaterThan(0);
    expect(meta.getEndlessMutators().length).toBeGreaterThanOrEqual(8);
    meta.dispose();
  });

  it('guards premature endless quit, clears active daily on endRun, unlocks Island 10+ on migration, and recommends next goals', () => {
    installMockLocalStorage();
    const nineClearedSave = createDefaultMetaSave(9);
    nineClearedSave.campaign.unlockedLevelIndex = 8;
    nineClearedSave.campaign.bestStars = [3, 3, 3, 3, 3, 3, 3, 3, 2];
    const expanded10 = migrateToMetaSave(nineClearedSave, null, 10, LEVELS);
    expect(expanded10.campaign.unlockedLevelIndex).toBe(9);

    const miniLevel: LevelDef = {
      ...LEVELS[0],
      waves: [
        { clearBonus: 20, groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 0.3, startDelay: 0 }] },
      ],
    };
    const meta = new MetaSession({
      levels: [miniLevel, ...LEVELS.slice(1)],
      getTodayDate: () => '2026-11-17',
    });

    // Next goal starts by recommending today's Daily Watch
    const g1 = meta.getRecommendedNextGoal()!;
    expect(g1.kind).toBe('daily');
    expect(g1.dailyDate).toBe('2026-11-17');

    // Start a daily run, verify getActiveDailyChallenge() is set, then endRun() -> must clear!
    const dailyEv = new EventBus();
    const dailySpec = meta.getDailyChallenge('2026-11-17');
    meta.startRun(LEVELS[dailySpec.levelIndex], dailyEv, {
      modifiers: dailySpec.modifiers,
      dailyDate: dailySpec.date,
    });
    expect(meta.getActiveDailyChallenge()?.date).toBe('2026-11-17');
    meta.endRun();
    expect(meta.getActiveDailyChallenge()).toBeNull();

    // Story win on Island 9-length test or miniLevel followed by entering Endless and quitting BEFORE Endless wave starts
    const bigStoryLevel: LevelDef = {
      ...LEVELS[0],
      id: 'big-story',
      waves: new Array(16).fill(0).map(() => ({
        clearBonus: 10,
        groups: [{ enemyType: 'grunt' as const, count: 1, spawnInterval: 0.3, startDelay: 0 }],
      })),
    };
    const evBig = new EventBus();
    const wBig = new SimWorld(bigStoryLevel, evBig);
    const bigMeta = new MetaSession({
      levels: [bigStoryLevel],
      onSave: () => {},
      getTodayDate: () => '2026-11-17',
    });
    bigMeta.startRun(bigStoryLevel, evBig, { speed: 3 });
    const archer = wBig.placeTower(4, 2, 'archer')!;
    wBig.upgradeTower(archer.id);
    wBig.startNextWave();
    for (let i = 0; i < 60 * 600 && wBig.outcome === 'ongoing'; i++) {
      if (wBig.waveSystem.state === 'betweenWaves') wBig.startNextWave();
      bigMeta.onTick(BALANCE.fixedDt, 3);
      wBig.fixedTick(BALANCE.fixedDt);
    }
    expect(wBig.outcome).toBe('won');
    // Enter Endless and immediately quit without starting Wave 17
    expect(wBig.enterEndlessMode()).toBe(true);
    bigMeta.onEndlessEntered();
    bigMeta.endRun();

    expect(bigMeta.getStats().bestEndlessWaveOverall).toBe(0);
    expect(bigMeta.getAchievements().find((a) => a.def.id === 'endless_survivor')?.unlocked).toBe(false);

    // Goal progression after marking daily complete -> recommends clearing/mastering Island 1
    const progSave = bigMeta.getSaveSnapshot();
    progSave.completedDailyDates.push('2026-11-17');
    const g2 = bigMeta.getRecommendedNextGoal('2026-11-17')!;
    expect(['challenge', 'campaign', 'achievement', 'endless']).toContain(g2.kind);

    bigMeta.dispose();
    meta.dispose();
  });

  it('blocks debug-tainted endless runs, normalizes invalid daily dates, summarizes mastery/achievements, and exports/imports saves', () => {
    const store = installMockLocalStorage();
    const miniLevel: LevelDef = {
      ...LEVELS[0],
      waves: [
        { clearBonus: 20, groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 0.3, startDelay: 0 }] },
      ],
    };
    const testLevels = [miniLevel, ...LEVELS.slice(1)];
    const meta = new MetaSession({
      levels: testLevels,
      getTodayDate: () => '2026-11-17',
    });

    // 1. Invalid dailyDate passed to startRun normalizes safely without throwing
    const badDailyEv = new EventBus();
    meta.startRun(miniLevel, badDailyEv, { dailyDate: 'invalid-date' });
    expect(meta.getActiveDailyChallenge()).toBeNull();
    meta.endRun();

    // 2. debugForceWin followed by entering Endless + skipping waves must NOT record Endless wave/score or achievements
    const cheatEv = new EventBus();
    const cheatWorld = new SimWorld(miniLevel, cheatEv);
    meta.startRun(miniLevel, cheatEv);
    cheatWorld.debugForceWin();
    expect(cheatWorld.enterEndlessMode({ activeMutatorIds: ['swift_march'], scoreMultiplier: 1.25 })).toBe(true);
    meta.onEndlessEntered({ activeMutatorIds: ['swift_march'], scoreMultiplier: 1.25 });
    cheatWorld.debugSkipToWave(20);
    meta.endRun();

    expect(meta.getStats().bestEndlessWaveOverall).toBe(0);
    expect(meta.getStats().bestEndlessScoreOverall).toBe(0);
    expect(meta.getCampaignProgress().bestEndlessWaves[0]).toBe(0);
    expect(meta.getAchievements().find((a) => a.def.id === 'endless_survivor')?.unlocked).toBe(false);
    expect(meta.getAchievements().find((a) => a.def.id === 'mutated_endless')?.unlocked).toBe(false);

    // 3. Honest win checks enriched RunMetaOutcome + AllIslandMastery + AchievementSummary
    const legEv = new EventBus();
    const legWorld = new SimWorld(miniLevel, legEv);
    meta.startRun(miniLevel, legEv, { speed: 3 });
    const archer = legWorld.placeTower(4, 2, 'archer')!;
    legWorld.upgradeTower(archer.id);
    legWorld.startNextWave();
    for (let i = 0; i < 60 * 30 && legWorld.outcome === 'ongoing'; i++) {
      meta.onTick(BALANCE.fixedDt, 3);
      legWorld.fixedTick(BALANCE.fixedDt);
    }
    expect(legWorld.outcome).toBe('won');

    const outcome = meta.getLastRunOutcome()!;
    expect(outcome.completedChallengeIds).toEqual([
      'sunlit-meadow:perfect',
      'sunlit-meadow:lean',
      'sunlit-meadow:rush3x',
    ]);
    expect(outcome.isNewBestLives).toBe(true);
    expect(outcome.isNewFastestWin).toBe(true);
    expect(outcome.runDurationSec).toBeGreaterThan(0);

    // Replay same island cleanly -> newlyCompletedChallengeIds is empty, completedChallengeIds still lists cleared challenges
    const repEv = new EventBus();
    const repWorld = new SimWorld(miniLevel, repEv);
    meta.startRun(miniLevel, repEv, { speed: 3 });
    const archer2 = repWorld.placeTower(4, 2, 'archer')!;
    repWorld.upgradeTower(archer2.id);
    repWorld.startNextWave();
    for (let i = 0; i < 60 * 30 && repWorld.outcome === 'ongoing'; i++) {
      meta.onTick(BALANCE.fixedDt, 3);
      repWorld.fixedTick(BALANCE.fixedDt);
    }
    const repeatOutcome = meta.getLastRunOutcome()!;
    expect(repeatOutcome.newlyCompletedChallengeIds).toHaveLength(0);
    expect(repeatOutcome.completedChallengeIds).toHaveLength(3);
    expect(repeatOutcome.isNewBestLives).toBe(false);

    const allMastery = meta.getAllIslandMasteryStatuses();
    expect(allMastery.totalIslands).toBe(testLevels.length);
    expect(allMastery.masteredCount).toBe(1);
    expect(allMastery.islands[0].mastered).toBe(true);

    const achSummary = meta.getAchievementSummary();
    expect(achSummary.totalCount).toBe(ACHIEVEMENTS.length);
    expect(achSummary.unlockedCount).toBeGreaterThanOrEqual(4);
    expect(achSummary.byCategory.reduce((s, c) => s + c.total, 0)).toBe(ACHIEVEMENTS.length);

    // 4. Export & import save JSON (preserves campaign ref identity, merges monotonically, rejects garbage)
    const exportedJson = meta.exportSaveJson();
    expect(meta.importSaveJson('not-json').ok).toBe(false);
    expect(meta.importSaveJson('{"hello":"world"}').ok).toBe(false);
    expect(meta.importSaveJson('[1,2,3]').ok).toBe(false);

    const progressRef = meta.getCampaignProgress();
    const freshSave = createDefaultMetaSave(testLevels.length);
    freshSave.campaign.bestStars[2] = 3;
    freshSave.completedChallenges['highland-citadel:no-mortar'] = true;
    freshSave.fastestWinSecByLevelId['sunlit-meadow'] = 0.5;
    freshSave.completedDailyDates = ['2026-11-16'];

    const mergedRes = meta.importSaveJson(JSON.stringify(freshSave), 'merge');
    expect(mergedRes.ok).toBe(true);
    expect(meta.getCampaignProgress()).toBe(progressRef);
    expect(progressRef.bestStars[0]).toBe(3); // Kept local star
    expect(progressRef.bestStars[2]).toBe(3); // Merged imported star
    expect(meta.getChallengeStatus(2)?.earnedStars).toBe(1);
    expect(meta.getIslandMasteryStatus(0)?.fastestWinSec).toBe(0.5); // Kept faster time via Math.min

    // Replace mode cleanly resets back to exported snapshot and syncs v1 storage
    const replacedRes = meta.importSaveJson(exportedJson, 'replace');
    expect(replacedRes.ok).toBe(true);
    expect(meta.getCampaignProgress()).toBe(progressRef);
    expect(progressRef.bestStars[2]).toBe(0);
    expect(loadProgress(testLevels.length).bestStars[2]).toBe(0);
    expect(store.has(META_PROGRESS_KEY)).toBe(true);

    meta.dispose();
  });

  it('builds Daily Watch history calendar, trims daily dates cleanly, and tightens v2 import validation', () => {
    installMockLocalStorage();
    const save = createDefaultMetaSave(9);
    const events = new EventBus();
    const obs = new RunObserver(LEVELS[0], events);

    // Padded dailyDate is trimmed cleanly without duplicating completedDailyDates
    recordRunCompletion(save, {
      level: LEVELS[0],
      telemetry: obs.getTelemetry(),
      won: true,
      stars: 3,
      livesRemaining: 20,
      levels: LEVELS,
      dailyDate: ' 2026-11-16 ',
      scoreMultiplier: 1.5,
    });
    recordRunCompletion(save, {
      level: LEVELS[0],
      telemetry: obs.getTelemetry(),
      won: true,
      stars: 3,
      livesRemaining: 20,
      levels: LEVELS,
      dailyDate: '2026-11-17',
      scoreMultiplier: 1.2,
    });
    obs.dispose();

    expect(save.completedDailyDates).toEqual(['2026-11-16', '2026-11-17']);
    expect(save.stats.dailyChallengesCompleted).toBe(2);

    const history = getRecentDailyHistory(save, '2026-11-17', 3, '2026-11-17', LEVELS);
    expect(history).toHaveLength(3);
    expect(history.map((h) => [h.spec.date, h.completed, h.isToday])).toEqual([
      ['2026-11-15', false, false],
      ['2026-11-16', true, false],
      ['2026-11-17', true, true],
    ]);
    expect(history[1].bestScore).toBeGreaterThan(0);

    // Reject malformed v2 save object missing campaign.bestStars array
    expect(importMetaSaveJson('{"version":2,"campaign":{}}', save, 9, LEVELS).ok).toBe(false);
    expect(ACHIEVEMENTS).toHaveLength(25);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(25);

    // MetaSession.getRecentDailyHistory and mid-run importSaveJson baseline refresh
    const meta = new MetaSession({
      levels: LEVELS,
      saveData: save,
      getTodayDate: () => '2026-11-17',
    });
    expect(meta.getRecentDailyHistory(3)).toHaveLength(3);
    expect(meta.getRecentDailyHistory(3)[2].isToday).toBe(true);

    const activeEv = new EventBus();
    meta.startRun(LEVELS[0], activeEv);
    const highSave = createDefaultMetaSave(9);
    highSave.campaign.bestEndlessWaves[0] = 25;
    highSave.bestEndlessScoresByLevelId['sunlit-meadow'] = 9999;
    expect(meta.importSaveJson(JSON.stringify(highSave), 'merge').ok).toBe(true);
    expect(meta.getCampaignProgress().bestEndlessWaves[0]).toBe(25);
    meta.dispose();
  });

  it('tracks mutated story replay scores, hydrated outcome definitions, daily score sanitization, and v1 gamesPlayed consistency', () => {
    installMockLocalStorage();

    // 1. v1 migration keeps gamesPlayed >= gamesWon and sanitizes whitespace-padded dailyBestScores
    const v1: ProgressData = {
      unlockedLevelIndex: 2,
      bestStars: [3, 2, 0, 0, 0, 0, 0, 0, 0],
      bestEndlessWaves: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    };
    const migratedV1 = migrateToMetaSave(null, v1, 9, LEVELS);
    expect(migratedV1.stats.gamesWon).toBeGreaterThanOrEqual(2);
    expect(migratedV1.stats.gamesPlayed).toBeGreaterThanOrEqual(migratedV1.stats.gamesWon);

    const messyV2 = createDefaultMetaSave(9);
    messyV2.dailyBestScores = {
      ' 2026-11-16 ': 1200,
      '2026-11-16': 900,
      'not-a-date': 9999,
    };
    messyV2.bestMutatedScoresByLevelId = { 'sunlit-meadow': 420 };
    messyV2.fastestWinSecByLevelId = { 'twin-bridge-cay': 0.02 };
    const cleaned = migrateToMetaSave(messyV2, null, 9, LEVELS);
    expect(cleaned.dailyBestScores).toEqual({ '2026-11-16': 1200 });
    expect(cleaned.bestMutatedScoresByLevelId['sunlit-meadow']).toBe(420);
    expect(cleaned.fastestWinSecByLevelId['twin-bridge-cay']).toBe(0.1);

    // 2. Mutated non-daily story win records mutatedScore & preserves fastestWinSec fairness
    const tinyLevel: LevelDef = {
      ...LEVELS[0],
      startingGold: 1000,
      waves: [{ clearBonus: 25, groups: [{ enemyType: 'grunt', count: 2, spawnInterval: 0.3, startDelay: 0 }] }],
    };
    const meta = new MetaSession({
      levels: [tinyLevel, ...LEVELS.slice(1)],
      getTodayDate: () => '2026-11-17',
    });

    expect(meta.getTodayDailyDate()).toBe('2026-11-17');
    expect(meta.getChallengeDef('sunlit-meadow:perfect')?.title).toBe('Flawless Meadow');
    expect(meta.getChallengeDef('unknown')).toBeNull();
    expect(meta.getAchievementDef('first_victory')?.name).toBe('First Skyhold Secured');
    expect(meta.getAchievementDef('unknown')).toBeNull();

    const presetMods = meta.resolveMutatorSelection({ presetId: 'blitz-tide' });
    const ev = new EventBus();
    const world = new SimWorld(tinyLevel, ev, presetMods);
    meta.startRun(tinyLevel, ev, { modifiers: presetMods, speed: 3 });
    const archer = world.placeTower(4, 2, 'archer')!;
    world.upgradeTower(archer.id);
    world.startNextWave();
    for (let i = 0; i < 60 * 30 && world.outcome === 'ongoing'; i++) {
      meta.onTick(BALANCE.fixedDt, 3);
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(world.outcome).toBe('won');

    const outcome = meta.getLastRunOutcome()!;
    expect(outcome.mutatedScore).toBeGreaterThan(0);
    expect(outcome.isNewBestMutatedScore).toBe(true);
    expect(outcome.isNewFastestWin).toBe(false); // Mutated speed runs don't overwrite standard speedrun bests
    expect(outcome.newlyCompletedChallenges.map((c) => c.id)).toEqual(outcome.newlyCompletedChallengeIds);
    expect(outcome.newlyUnlockedAchievements.map((a) => a.id)).toEqual(outcome.newlyUnlockedAchievementIds);
    expect(meta.getIslandMasteryStatus(0)?.bestMutatedScore).toBe(outcome.mutatedScore);
    expect(meta.getIslandMasteryStatus(0)?.fastestWinSec).toBeNull();

    // 3. Export & merge preserves bestMutatedScoresByLevelId
    const otherSave = createDefaultMetaSave(9);
    otherSave.bestMutatedScoresByLevelId['sunlit-meadow'] = 99999;
    expect(meta.importSaveJson(JSON.stringify(otherSave), 'merge').ok).toBe(true);
    expect(meta.getIslandMasteryStatus(0)?.bestMutatedScore).toBe(99999);
    meta.dispose();
  });

  it('blocks debug-tainted stat/achievement farming, supports raw RunModifiers replays, and exposes live endless score', () => {
    installMockLocalStorage();
    const tinyLevel: LevelDef = {
      ...LEVELS[0],
      startingGold: 1500,
      waves: [{ clearBonus: 25, groups: [{ enemyType: 'grunt', count: 2, spawnInterval: 0.3, startDelay: 0 }] }],
    };
    const testLevels = [tinyLevel, ...LEVELS.slice(1)];
    const meta = new MetaSession({
      levels: testLevels,
      getTodayDate: () => '2026-11-17',
    });

    // 1. Debug-spawned bosses / cheated gold must NOT unlock boss_slayer_10, master_architect, or pollute stats
    const dbgEv = new EventBus();
    const dbgWorld = new SimWorld(tinyLevel, dbgEv);
    meta.startRun(tinyLevel, dbgEv);
    meta.markDebugTainted();
    dbgWorld.placeTower(4, 2, 'archer');
    for (let i = 0; i < 15; i++) {
      dbgWorld.enemySystem.spawnEnemy('boss');
      dbgEv.emit('enemyKilled', {
        enemyId: 200 + i,
        enemyType: 'boss',
        reward: 35,
        x: 0,
        y: 0,
        z: 0,
      });
    }
    dbgWorld.debugForceLose();
    meta.endRun();

    expect(meta.getStats().enemiesDefeatedTotal).toBe(0);
    expect(meta.getStats().towersBuiltTotal).toBe(0);
    expect(meta.getStats().gamesLost).toBe(0);
    expect(meta.getAchievements().find((a) => a.def.id === 'boss_slayer_10')?.unlocked).toBe(false);

    // 2. Raw RunModifiers without activeMutatorIds still score mutated replays & unlock mutated_endless
    const rawMods = meta.resolveMutatorSelection({ enemyHpMultiplier: 1.35, scoreMultiplier: 1.4 });
    const rawEv = new EventBus();
    const rawWorld = new SimWorld(tinyLevel, rawEv, rawMods);
    meta.startRun(tinyLevel, rawEv, { modifiers: rawMods, speed: 3 });
    expect(meta.getLiveEndlessScore()).toBeNull();
    expect(meta.getLiveRunTelemetry()?.hasRunModifiers).toBe(true);

    const archer = rawWorld.placeTower(4, 2, 'archer')!;
    rawWorld.upgradeTower(archer.id);
    rawWorld.upgradeTower(archer.id);
    rawWorld.startNextWave();
    for (let i = 0; i < 60 * 30 && rawWorld.outcome === 'ongoing'; i++) {
      meta.onTick(BALANCE.fixedDt, 3);
      rawWorld.fixedTick(BALANCE.fixedDt);
    }
    expect(rawWorld.outcome).toBe('won');
    const storyOutcome = meta.getLastRunOutcome()!;
    expect(storyOutcome.mutatedScore).toBeGreaterThan(0);
    expect(storyOutcome.isNewFastestWin).toBe(false);
    expect(meta.getIslandMasteryStatus(0)?.fastestWinSec).toBeNull();

    // Enter Endless with raw custom modifiers -> live Endless score updates & mutated_endless unlocks
    expect(rawWorld.enterEndlessMode(rawMods)).toBe(true);
    meta.onEndlessEntered(rawMods);
    expect(meta.getLiveEndlessScore()?.totalScore).toBe(0);

    rawWorld.gold = 6000;
    const spots: Array<[number, number, 'archer' | 'cannon' | 'frost' | 'tesla' | 'mortar']> = [
      [4, 3, 'cannon'],
      [7, 5, 'frost'],
      [8, 5, 'archer'],
      [10, 4, 'tesla'],
      [5, 7, 'mortar'],
      [7, 3, 'cannon'],
    ];
    for (const [col, row, type] of spots) {
      const tw = rawWorld.placeTower(col, row, type);
      if (tw) {
        rawWorld.upgradeTower(tw.id);
        rawWorld.upgradeTower(tw.id);
      }
    }

    let clearedEndless = 0;
    rawEv.on('waveCompleted', (w) => {
      if (w.waveIndex >= tinyLevel.waves.length) clearedEndless++;
    });
    for (let i = 0; i < 60 * 180 && clearedEndless < 5 && rawWorld.outcome === 'ongoing'; i++) {
      if (rawWorld.waveSystem.state === 'betweenWaves') {
        rawWorld.startNextWave();
      }
      meta.onTick(BALANCE.fixedDt, 3);
      rawWorld.fixedTick(BALANCE.fixedDt);
    }
    expect(clearedEndless).toBeGreaterThanOrEqual(5);
    const liveScore = meta.getLiveEndlessScore();
    expect(liveScore).not.toBeNull();
    expect(liveScore!.scoreMultiplier).toBe(1.4);
    expect(liveScore!.totalScore).toBeGreaterThan(0);

    meta.endRun();
    expect(meta.getAchievements().find((a) => a.def.id === 'mutated_endless')?.unlocked).toBe(true);

    // 3. Partial v2 migration infers sticky milestones from completed challenges & bestLivesByLevelId
    const partialSave = createDefaultMetaSave(9);
    partialSave.completedChallenges['sunlit-meadow:perfect'] = true;
    partialSave.completedChallenges['sunlit-meadow:rush3x'] = true;
    partialSave.completedChallenges['sunlit-meadow:lean'] = true;
    const inferred = migrateToMetaSave(partialSave, null, 9, LEVELS);
    expect(inferred.achievementMilestones.wonNoLivesLost).toBe(true);
    expect(inferred.achievementMilestones.wonAt3xSpeed).toBe(true);
    expect(inferred.achievementMilestones.wonMax6Towers).toBe(true);
    expect(inferred.unlockedAchievements.flawless_defense).toBe(true);
    expect(inferred.unlockedAchievements.speed_demon).toBe(true);
    expect(inferred.unlockedAchievements.minimalist).toBe(true);

    // Padded todayDateStr is trimmed in getRecommendedNextGoal
    meta.getSaveSnapshot().completedDailyDates.push('2026-11-17');
    expect(meta.getRecommendedNextGoal(' 2026-11-17 ')?.kind).not.toBe('daily');
    meta.dispose();
  });

  it('previews mutator selections on MetaSession and guards replace-import & post-win Endless tamper edges', () => {
    installMockLocalStorage();
    const tinyLevel: LevelDef = {
      ...LEVELS[0],
      startingGold: 1000,
      waves: [{ clearBonus: 25, groups: [{ enemyType: 'grunt', count: 2, spawnInterval: 0.3, startDelay: 0 }] }],
    };
    const meta = new MetaSession({
      levels: [tinyLevel, ...LEVELS.slice(1)],
      getTodayDate: () => '2026-11-17',
    });

    const preview = meta.previewMutatorSelection({ presetId: 'lean-siege' });
    expect(preview.scoreMultiplier).toBe(1.5);
    expect(preview.allowedTowerTypes).not.toContain('frost');
    expect(preview.conflictingMutatorIds).toContain('gold_drought');
    expect(preview.conflictingMutatorIds).toContain('sky_swarm');

    // 1. Tampering with gold after story win before entering Endless must taint the Endless phase
    const ev1 = new EventBus();
    const w1 = new SimWorld(tinyLevel, ev1);
    meta.startRun(tinyLevel, ev1);
    w1.placeTower(4, 2, 'archer');
    w1.startNextWave();
    for (let i = 0; i < 60 * 30 && w1.outcome === 'ongoing'; i++) {
      meta.onTick(BALANCE.fixedDt, 3);
      w1.fixedTick(BALANCE.fixedDt);
    }
    expect(w1.outcome).toBe('won');
    w1.gold += 5000;
    expect(w1.enterEndlessMode()).toBe(true);
    expect(meta.verifyWorldIntegrity(w1.gold, w1.lives)).toBe(false);
    meta.onEndlessEntered();
    expect(meta.isCurrentRunEligible()).toBe(false);

    // 2. Replace-mode import mid-run clears prior run-collected achievements cleanly
    const ev2 = new EventBus();
    meta.startRun(tinyLevel, ev2);
    ev2.emit('overchargeActivated', { duration: 7, cleansedTowerIds: [1] });
    meta.flushStats(false);
    expect(meta.getAchievements().find((a) => a.def.id === 'overcharge_cleanse')?.unlocked).toBe(true);

    const blankJson = JSON.stringify(createDefaultMetaSave(9));
    expect(meta.importSaveJson(blankJson, 'replace').ok).toBe(true);
    expect(meta.getAchievements().find((a) => a.def.id === 'overcharge_cleanse')?.unlocked).toBe(false);
    ev2.emit('gameWon', { stars: 3, livesRemaining: 20 });
    expect(meta.getLastRunOutcome()!.newlyUnlockedAchievementIds).not.toContain('overcharge_cleanse');

    // 3. Replace-mode import BEFORE any flushStats() must also discard un-flushed Wave 1 telemetry
    const ev3 = new EventBus();
    const w3 = new SimWorld(tinyLevel, ev3);
    meta.startRun(tinyLevel, ev3);
    w3.placeTower(4, 2, 'archer');
    w3.startNextWave();
    ev3.emit('overchargeActivated', { duration: 7, cleansedTowerIds: [1] });
    ev3.emit('enemyKilled', { enemyId: 901, enemyType: 'grunt', reward: 4, x: 0, y: 0, z: 0 });
    expect(meta.importSaveJson(blankJson, 'replace').ok).toBe(true);
    expect(meta.getStats().enemiesDefeatedTotal).toBe(0);
    expect(meta.getStats().towersBuiltTotal).toBe(0);
    ev3.emit('waveCompleted', { waveIndex: 0, bonus: 25 });
    // Pre-import kill, tower, and cleanse did NOT leak into the replaced save
    expect(meta.getStats().enemiesDefeatedTotal).toBe(0);
    expect(meta.getStats().towersBuiltTotal).toBe(0);
    expect(meta.getAchievements().find((a) => a.def.id === 'overcharge_cleanse')?.unlocked).toBe(false);
    // Post-import kills DO accumulate cleanly
    ev3.emit('enemyKilled', { enemyId: 902, enemyType: 'grunt', reward: 4, x: 0, y: 0, z: 0 });
    meta.flushStats(false);
    expect(meta.getStats().enemiesDefeatedTotal).toBe(1);

    // 4. Daily Watch story win -> Enter Endless Mode -> Endless loss isolates dailyScore and isDaily
    const dailyLevels: LevelDef[] = LEVELS.map((lvl, idx) => ({
      ...lvl,
      index: idx,
      startingGold: 1500,
      waves: [{ clearBonus: 25, groups: [{ enemyType: 'grunt', count: 2, spawnInterval: 0.3, startDelay: 0 }] }],
    }));
    const dailyMeta = new MetaSession({
      levels: dailyLevels,
      saveData: createDefaultMetaSave(dailyLevels.length),
      onSave: () => {},
      getTodayDate: () => '2026-11-17',
    });
    const dailySpec = dailyMeta.getDailyChallenge('2026-11-17');
    const dailyEv = new EventBus();
    const dailyWorld = new SimWorld(dailyLevels[dailySpec.levelIndex], dailyEv, dailySpec.modifiers);
    dailyMeta.startRun(dailyWorld.level, dailyEv, {
      modifiers: dailySpec.modifiers,
      dailyDate: dailySpec.date,
      speed: 3,
    });
    const legalType = dailyMeta.getAllowedTowerTypes()[0]!;
    let builtSpot = false;
    for (let r = 0; r < dailyWorld.level.rows && !builtSpot; r++) {
      for (let c = 0; c < dailyWorld.level.cols && !builtSpot; c++) {
        if (dailyWorld.grid.canPlaceTower(c, r)) {
          builtSpot = dailyWorld.placeTower(c, r, legalType) !== null;
        }
      }
    }
    expect(builtSpot).toBe(true);
    dailyWorld.startNextWave();
    for (let i = 0; i < 60 * 40 && dailyWorld.outcome === 'ongoing'; i++) {
      dailyMeta.onTick(BALANCE.fixedDt, 3);
      dailyWorld.fixedTick(BALANCE.fixedDt);
    }
    expect(dailyWorld.outcome).toBe('won');
    expect(dailyMeta.getActiveDailyChallenge()?.date).toBe('2026-11-17');
    const savedDailyBest = dailyMeta.getDailyStatus('2026-11-17').bestScoreToday;
    expect(savedDailyBest).toBeGreaterThan(0);

    expect(dailyWorld.enterEndlessMode()).toBe(true);
    dailyMeta.onEndlessEntered();
    expect(dailyMeta.getActiveDailyChallenge()).toBeNull();
    expect(dailyMeta.getLiveChallengeStates(dailyWorld.lives, dailyWorld.outcome)).toEqual([]);
    dailyWorld.startNextWave();
    dailyEv.emit('enemyKilled', { enemyId: 777, enemyType: 'grunt', reward: 4, x: 0, y: 0, z: 0 });
    dailyWorld.debugForceLose();

    const endlessAfterDaily = dailyMeta.getLastRunOutcome()!;
    expect(endlessAfterDaily.won).toBe(false);
    expect(endlessAfterDaily.isDaily).toBe(false);
    expect(endlessAfterDaily.dailyScore).toBeNull();
    expect(endlessAfterDaily.endlessScore).not.toBeNull();
    expect(dailyMeta.getStats().gamesLost).toBe(0);
    expect(dailyMeta.getDailyStatus('2026-11-17').bestScoreToday).toBe(savedDailyBest);

    // 5. Tower mastery & enemy intel stats + mid-final-wave replace-import gamesPlayed tracking
    const codexSave = createDefaultMetaSave(9);
    codexSave.stats.towersBuiltByType = { archer: 65, cannon: 25, frost: 10, tesla: 0, mortar: 0 };
    codexSave.stats.enemiesDefeatedByType = { grunt: 120, boss: 3 };
    const towerMastery = getTowerMasteryStats(codexSave);
    expect(towerMastery.map((t) => [t.type, t.rank, t.sharePct])).toEqual([
      ['archer', 'Grandmaster', 65],
      ['cannon', 'Artificer', 25],
      ['frost', 'Apprentice', 10],
      ['tesla', 'Recruit', 0],
      ['mortar', 'Recruit', 0],
    ]);
    expect(towerMastery.find((t) => t.type === 'archer')?.nextTarget).toBeNull();
    expect(towerMastery.find((t) => t.type === 'frost')?.nextTarget).toBe(25);

    const enemyIntel = getEnemyIntelStats(codexSave);
    const gruntIntel = enemyIntel.find((e) => e.type === 'grunt')!;
    expect(gruntIntel.discovered).toBe(true);
    expect(gruntIntel.maxHp).toBeGreaterThan(0);
    expect(gruntIntel.speed).toBeGreaterThan(0);
    expect(gruntIntel.reward).toBeGreaterThan(0);
    expect(enemyIntel.find((e) => e.type === 'flyer')?.discovered).toBe(false);
    expect(enemyIntel.find((e) => e.type === 'boss')?.defeatedCount).toBe(3);
    expect(towerMastery[0].hitsFlyers).toBe(true);
    expect(towerMastery[0].buildCost).toBeGreaterThan(0);
    expect(towerMastery[0].shortDesc.length).toBeGreaterThan(5);

    // Mid-final-wave replace import increments gamesPlayed on gameWon even when gamesPlayed > gamesWon + gamesLost
    const importedSave = createDefaultMetaSave(9);
    importedSave.stats.gamesPlayed = 5;
    importedSave.stats.gamesWon = 2;
    importedSave.stats.gamesLost = 1;
    const finalWaveEv = new EventBus();
    const finalWaveWorld = new SimWorld(tinyLevel, finalWaveEv);
    meta.startRun(tinyLevel, finalWaveEv);
    finalWaveWorld.placeTower(4, 2, 'archer');
    finalWaveWorld.startNextWave();
    expect(meta.importSaveJson(JSON.stringify(importedSave), 'replace').ok).toBe(true);
    expect(meta.getTowerMasteryStats()[0].rank).toBe('Recruit');
    expect(meta.getEnemyIntelStats()).toHaveLength(enemyIntel.length);
    for (let i = 0; i < 60 * 30 && finalWaveWorld.outcome === 'ongoing'; i++) {
      meta.onTick(BALANCE.fixedDt, 3);
      finalWaveWorld.fixedTick(BALANCE.fixedDt);
    }
    expect(finalWaveWorld.outcome).toBe('won');
    expect(meta.getStats().gamesPlayed).toBe(6);
    expect(meta.getStats().gamesWon).toBe(3);
    // Replace-import after run ends clears stale lastRunOutcome
    meta.endRun();
    expect(meta.getLastRunOutcome()).not.toBeNull();
    expect(meta.importSaveJson(JSON.stringify(importedSave), 'replace').ok).toBe(true);
    expect(meta.getLastRunOutcome()).toBeNull();

    // Replaying an already-completed Daily Watch with higher score updates dailyBestScores once without double-counting completion
    const replaySave = createDefaultMetaSave(9);
    const replayEv = new EventBus();
    const replayObs = new RunObserver(LEVELS[0], replayEv);
    const firstDaily = recordRunCompletion(replaySave, {
      level: LEVELS[0],
      telemetry: replayObs.getTelemetry(),
      won: true,
      stars: 2,
      livesRemaining: 10,
      levels: LEVELS,
      dailyDate: '2026-11-17',
      scoreMultiplier: 1.3,
    });
    expect(firstDaily.isNewBestDailyScore).toBe(true);
    const secondDaily = recordRunCompletion(replaySave, {
      level: LEVELS[0],
      telemetry: replayObs.getTelemetry(),
      won: true,
      stars: 3,
      livesRemaining: 20,
      levels: LEVELS,
      dailyDate: '2026-11-17',
      scoreMultiplier: 1.3,
    });
    expect(secondDaily.isNewBestDailyScore).toBe(true);
    expect(secondDaily.dailyScore).toBeGreaterThan(firstDaily.dailyScore!);
    expect(replaySave.completedDailyDates).toEqual(['2026-11-17']);
    expect(replaySave.stats.dailyChallengesCompleted).toBe(1);
    expect(replaySave.dailyBestScores['2026-11-17']).toBe(secondDaily.dailyScore);

    // Non-finite livesRemaining / simTimeSec safely sanitize to 0
    const nanOutcome = recordRunCompletion(replaySave, {
      level: LEVELS[0],
      telemetry: { ...replayObs.getTelemetry(), simTimeSec: Number.NaN },
      won: true,
      stars: 1,
      livesRemaining: Number.NaN,
      levels: LEVELS,
    });
    expect(nanOutcome.runDurationSec).toBe(0);
    expect(replaySave.bestLivesByLevelId[LEVELS[0].id]).toBeUndefined();
    replayObs.dispose();

    // mergeCampaignProgress & mergeMetaSaves ignore non-finite outlier records/stats so valid finite data survives
    const mergedCampaign = mergeCampaignProgress(
      { unlockedLevelIndex: Number.NaN, bestStars: [Number.POSITIVE_INFINITY, Number.NaN], bestEndlessWaves: [Number.NaN, 12] },
      { unlockedLevelIndex: 4, bestStars: [2, 3], bestEndlessWaves: [8, Number.POSITIVE_INFINITY] },
      9,
    );
    expect(mergedCampaign.unlockedLevelIndex).toBe(4);
    expect(mergedCampaign.bestStars.slice(0, 2)).toEqual([2, 3]);
    expect(mergedCampaign.bestEndlessWaves.slice(0, 2)).toEqual([8, 12]);

    const corruptBase = createDefaultMetaSave(9);
    corruptBase.bestEndlessScoresByLevelId[LEVELS[0].id] = Number.POSITIVE_INFINITY;
    corruptBase.fastestWinSecByLevelId[LEVELS[0].id] = Number.NaN;
    corruptBase.stats.towersBuiltByType.archer = Number.POSITIVE_INFINITY;
    corruptBase.stats.totalPlayTimeSec = Number.POSITIVE_INFINITY;
    corruptBase.stats.gamesPlayed = Number.NaN;
    corruptBase.stats.enemiesDefeatedTotal = Number.POSITIVE_INFINITY;
    corruptBase.achievementMilestones.bestMutatedEndlessWavesCleared = Number.NaN;
    const validIncoming = createDefaultMetaSave(9);
    validIncoming.bestEndlessScoresByLevelId[LEVELS[0].id] = 480;
    validIncoming.fastestWinSecByLevelId[LEVELS[0].id] = 55.4;
    validIncoming.stats.towersBuiltByType.cannon = 12;
    validIncoming.stats.totalPlayTimeSec = 142.5;
    validIncoming.stats.gamesPlayed = 7;
    validIncoming.stats.gamesWon = 5;
    validIncoming.stats.gamesLost = 2;
    validIncoming.stats.enemiesDefeatedTotal = 310;
    validIncoming.achievementMilestones.bestMutatedEndlessWavesCleared = 6;
    const mergedClean = mergeMetaSaves(corruptBase, validIncoming, 9, LEVELS);
    expect(mergedClean.bestEndlessScoresByLevelId[LEVELS[0].id]).toBe(480);
    expect(mergedClean.fastestWinSecByLevelId[LEVELS[0].id]).toBe(55.4);
    expect(mergedClean.stats.towersBuiltByType.cannon).toBe(12);
    expect(mergedClean.stats.towersBuiltByType.archer).toBeUndefined();
    expect(mergedClean.stats.totalPlayTimeSec).toBe(142.5);
    expect(mergedClean.stats.gamesPlayed).toBe(7);
    expect(mergedClean.stats.enemiesDefeatedTotal).toBe(310);
    expect(mergedClean.achievementMilestones.bestMutatedEndlessWavesCleared).toBe(6);

    // getMetaCareerSummary filters obsolete/unknown tower or enemy keys and handles non-finite win/loss counts safely
    mergedClean.stats.towersBuiltByType.unknown_tower = 999;
    mergedClean.stats.enemiesDefeatedByType.unknown_enemy = 999;
    mergedClean.stats.enemiesDefeatedByType.grunt = 45;
    const careerSummary = getMetaCareerSummary(mergedClean, '2026-11-17', LEVELS);
    expect(careerSummary.favoriteTowerType).toBe('cannon');
    expect(careerSummary.mostDefeatedEnemyType).toBe('grunt');
    expect(careerSummary.winRatePct).toBe(71);

    // Unsanitized non-finite / negative values & prototype keys in query/codex/rank inputs never propagate NaN or throw
    const dirtyCodexSave = createDefaultMetaSave(9);
    dirtyCodexSave.campaign.unlockedLevelIndex = Number.NaN;
    dirtyCodexSave.campaign.bestStars[0] = Number.NaN;
    dirtyCodexSave.campaign.bestStars[1] = 2;
    dirtyCodexSave.campaign.bestEndlessWaves[0] = Number.NaN;
    dirtyCodexSave.bestEndlessScoresByLevelId[LEVELS[0].id] = Number.NaN;
    dirtyCodexSave.bestMutatedScoresByLevelId[LEVELS[0].id] = Number.POSITIVE_INFINITY;
    dirtyCodexSave.bestLivesByLevelId[LEVELS[0].id] = Number.NaN;
    dirtyCodexSave.fastestWinSecByLevelId[LEVELS[0].id] = Number.NaN;
    dirtyCodexSave.dailyBestScores['2026-11-17'] = Number.NaN;
    dirtyCodexSave.stats.enemiesDefeatedTotal = Number.NaN;
    dirtyCodexSave.stats.gamesWon = Number.NaN;
    dirtyCodexSave.stats.towersBuiltByType = { archer: Number.NaN, cannon: -3, frost: 10.9 };
    dirtyCodexSave.stats.enemiesDefeatedByType = { grunt: Number.POSITIVE_INFINITY, flyer: -1, brute: 4.7 };
    const dirtyTowerStats = getTowerMasteryStats(dirtyCodexSave);
    expect(dirtyTowerStats.find((t) => t.type === 'archer')?.builtCount).toBe(0);
    expect(dirtyTowerStats.find((t) => t.type === 'cannon')?.builtCount).toBe(0);
    expect(dirtyTowerStats.find((t) => t.type === 'frost')).toMatchObject({
      builtCount: 10,
      sharePct: 100,
      rank: 'Apprentice',
    });
    const dirtyEnemyIntel = getEnemyIntelStats(dirtyCodexSave);
    expect(dirtyEnemyIntel.find((e) => e.type === 'grunt')).toMatchObject({
      defeatedCount: 0,
      discovered: false,
    });
    expect(dirtyEnemyIntel.find((e) => e.type === 'brute')).toMatchObject({
      defeatedCount: 4,
      discovered: true,
    });
    const dirtySummary = getMetaCareerSummary(dirtyCodexSave, '2026-11-17', LEVELS);
    expect(dirtySummary.campaignStarsEarned).toBe(2);
    expect(dirtySummary.islandsCleared).toBe(1);
    expect(dirtySummary.rank.points).toBe(2);
    // Padded daily dates, padded dailyBestScores keys, and non-boolean achievement flags stay sanitized in queries & merges
    dirtyCodexSave.completedDailyDates = [' 2026-11-16 ', 'invalid-date'];
    dirtyCodexSave.dailyBestScores[' 2026-11-16 '] = 1450;
    dirtyCodexSave.unlockedAchievements = { first_victory: 'yes' as unknown as boolean };
    expect(getMetaCareerSummary(dirtyCodexSave, '2026-11-17', LEVELS).achievementsUnlocked).toBe(0);
    expect(getRecentDailyHistory(dirtyCodexSave, '2026-11-17', 2, '2026-11-17', LEVELS)[0]).toMatchObject({
      completed: true,
      bestScore: 1450,
    });
    expect(getMetaCareerSummary(dirtyCodexSave, '2026-11-17', LEVELS).dailyCompletedTotal).toBe(1);
    expect(getMetaCareerRank(dirtyCodexSave, LEVELS).points).toBe(4);
    const paddedDailyMeta = new MetaSession({
      levels: LEVELS,
      saveData: dirtyCodexSave,
      onSave: () => {},
      getTodayDate: () => '2026-11-16',
    });
    expect(paddedDailyMeta.getDailyStatus('2026-11-16')).toMatchObject({
      completedToday: true,
      bestScoreToday: 1450,
      totalDailyCompleted: 1,
    });
    paddedDailyMeta.dispose();
    const mergedPadded = mergeMetaSaves(dirtyCodexSave, createDefaultMetaSave(9), 9, LEVELS);
    expect(mergedPadded.completedDailyDates).toEqual(['2026-11-16']);
    expect(mergedPadded.stats.dailyChallengesCompleted).toBe(1);

    // loadSettings & loadProgress sanitize non-finite (1e500 -> Infinity) / zero-levelCount storage edges
    const prevStorage = globalThis.localStorage;
    try {
      const storageStore = installMockLocalStorage({
        skyhold_isles_settings_v1: '{"masterVolume":1e500}',
        [PROGRESS_KEY]: '{"unlockedLevelIndex":1e500,"bestStars":[2],"bestEndlessWaves":[5]}',
      });
      expect(Number.isFinite(loadSettings().masterVolume)).toBe(true);
      expect(loadSettings().masterVolume).toBe(0.65);
      expect(loadProgress(0).bestStars).toHaveLength(1);
      expect(loadProgress(9).unlockedLevelIndex).toBe(0);
      storageStore.clear();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        value: prevStorage,
        configurable: true,
        writable: true,
      });
    }

    expect(getIslandMasteryStatus(dirtyCodexSave, 0, LEVELS)).toMatchObject({
      campaignStars: 0,
      bestEndlessWave: 0,
      bestEndlessScore: 0,
      bestMutatedScore: 0,
      bestLivesRemaining: 0,
      fastestWinSec: null,
    });
    expect(getAchievements(dirtyCodexSave).every((a) => Number.isFinite(a.current) && Number.isFinite(a.progressRatio))).toBe(true);
    expect(getRecommendedNextGoal(dirtyCodexSave, '2026-11-17', LEVELS)?.kind).toBe('daily');
    dirtyCodexSave.completedDailyDates.push('2026-11-17');
    expect(getRecommendedNextGoal(dirtyCodexSave, '2026-11-17', LEVELS)?.levelIndex).toBe(0);
    expect(getRecentDailyHistory(dirtyCodexSave, '2026-11-17', 2, '2026-11-17', LEVELS)[1]?.bestScore).toBe(0);

    // Crafted JSON with __proto__/constructor/prototype keys is ignored safely during migration/import
    const protoJson = JSON.stringify({
      version: 2,
      campaign: { unlockedLevelIndex: 0, bestStars: [1, 0, 0, 0, 0, 0, 0, 0, 0], bestEndlessWaves: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
      completedChallenges: JSON.parse('{"__proto__":true,"constructor":true,"sunlit-meadow:perfect":true}'),
      stats: {
        enemiesDefeatedByType: JSON.parse('{"__proto__":99,"prototype":5,"grunt":3}'),
      },
    });
    const protoImport = importMetaSaveJson(protoJson, null, 9, LEVELS, 'replace');
    expect(protoImport.ok).toBe(true);
    if (protoImport.ok) {
      expect(Object.prototype.hasOwnProperty.call(protoImport.save.completedChallenges, 'constructor')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(protoImport.save.stats.enemiesDefeatedByType, 'prototype')).toBe(false);
      expect(protoImport.save.completedChallenges['sunlit-meadow:perfect']).toBe(true);
      expect(protoImport.save.stats.enemiesDefeatedByType.grunt).toBe(3);
    }

    const testLevels = [tinyLevel, ...LEVELS.slice(1)];
    // Pre-wave quit does not bump gamesPlayed, whereas mid-Wave-1 quit flushes stats & increments gamesPlayed
    const quitMeta = new MetaSession({
      levels: testLevels,
      saveData: createDefaultMetaSave(testLevels.length),
      onSave: () => {},
    });
    const preEv = new EventBus();
    const preWorld = new SimWorld(tinyLevel, preEv);
    quitMeta.startRun(tinyLevel, preEv);
    preWorld.placeTower(4, 2, 'archer');
    quitMeta.endRun();
    expect(quitMeta.getStats().gamesPlayed).toBe(0);
    expect(quitMeta.getStats().towersBuiltTotal).toBe(1);

    const midEv = new EventBus();
    const midWorld = new SimWorld(tinyLevel, midEv);
    quitMeta.startRun(tinyLevel, midEv);
    midWorld.placeTower(4, 2, 'archer');
    midWorld.startNextWave();
    for (let i = 0; i < 60 * 10 && midWorld.enemiesKilledTotal === 0; i++) {
      quitMeta.onTick(BALANCE.fixedDt, 3);
      midWorld.fixedTick(BALANCE.fixedDt);
    }
    quitMeta.endRun();
    expect(quitMeta.getStats().gamesPlayed).toBe(1);
    expect(quitMeta.getStats().gamesWon).toBe(0);
    expect(quitMeta.getStats().gamesLost).toBe(0);
    expect(quitMeta.getStats().enemiesDefeatedTotal).toBeGreaterThan(0);

    // Mutated story win -> Endless continuation preserves mutatedScore, storyWinSnapshot, and unlocks mutated_endless
    const mutTinyLevel: LevelDef = { ...tinyLevel, startingGold: 6000 };
    const mutLevels = [mutTinyLevel, ...LEVELS.slice(1)];
    const mutEndlessMeta = new MetaSession({
      levels: mutLevels,
      saveData: createDefaultMetaSave(mutLevels.length),
      onSave: () => {},
    });
    const mutRoll = mutEndlessMeta.getMutatorPresetRoll('iron-skies')!;
    const mutEv = new EventBus();
    const mutWorld = new SimWorld(mutTinyLevel, mutEv, mutRoll.modifiers);
    mutEndlessMeta.startRun(mutTinyLevel, mutEv, { modifiers: mutRoll.modifiers, speed: 3 });
    const spots: Array<[number, number, 'archer' | 'cannon' | 'frost' | 'tesla' | 'mortar']> = [
      [4, 2, 'archer'],
      [4, 3, 'cannon'],
      [7, 5, 'frost'],
      [8, 5, 'archer'],
      [10, 4, 'tesla'],
      [5, 7, 'mortar'],
      [7, 3, 'cannon'],
    ];
    for (const [col, row, type] of spots) {
      const tw = mutWorld.placeTower(col, row, type);
      if (tw) {
        mutWorld.upgradeTower(tw.id);
        mutWorld.upgradeTower(tw.id);
      }
    }
    mutWorld.startNextWave();
    for (let i = 0; i < 60 * 30 && mutWorld.outcome === 'ongoing'; i++) {
      mutEndlessMeta.onTick(BALANCE.fixedDt, 3);
      mutWorld.fixedTick(BALANCE.fixedDt);
    }
    expect(mutWorld.outcome).toBe('won');
    expect(mutEndlessMeta.getLastRunOutcome()?.mutatedScore).toBeGreaterThan(0);
    expect(mutEndlessMeta.getIslandMasteryStatus(0)?.fastestWinSec).toBeNull();
    expect(mutWorld.enterEndlessMode()).toBe(true);
    mutEndlessMeta.onEndlessEntered();
    expect(mutEndlessMeta.getActiveModifierBadges().map((b) => b.id)).toEqual([
      'iron_clad',
      'sky_swarm',
    ]);
    let clearedEndless = 0;
    mutEv.on('waveCompleted', (w) => {
      if (w.waveIndex >= mutTinyLevel.waves.length) clearedEndless++;
    });
    for (let i = 0; i < 60 * 180 && clearedEndless < 5 && mutWorld.outcome === 'ongoing'; i++) {
      if (mutWorld.waveSystem.state === 'betweenWaves') {
        mutWorld.startNextWave();
      }
      mutEndlessMeta.onTick(BALANCE.fixedDt, 3);
      mutWorld.fixedTick(BALANCE.fixedDt);
    }
    expect(clearedEndless).toBeGreaterThanOrEqual(5);
    expect(mutEndlessMeta.verifyWorldIntegrity(mutWorld.gold, mutWorld.lives)).toBe(true);
    expect(mutEndlessMeta.getLiveEndlessScore()!.totalScore).toBeGreaterThan(0);
    expect(
      mutEndlessMeta.getAchievements().find((a) => a.def.id === 'mutated_endless')?.unlocked,
    ).toBe(true);

    // Pre-existing NaN fields in an unsanitized save recover cleanly on applyTelemetryDeltaToStats & recordRunCompletion
    const nanRecSave = createDefaultMetaSave(9);
    nanRecSave.stats.gamesWon = Number.NaN;
    nanRecSave.stats.enemiesDefeatedTotal = Number.NaN;
    nanRecSave.stats.totalPlayTimeSec = Number.NaN;
    nanRecSave.campaign.bestStars[0] = Number.NaN;
    nanRecSave.bestLivesByLevelId[LEVELS[0].id] = Number.NaN;
    nanRecSave.fastestWinSecByLevelId[LEVELS[0].id] = Number.NaN;
    nanRecSave.dailyBestScores['2026-11-17'] = Number.NaN;
    const nanEv = new EventBus();
    const nanObs = new RunObserver(LEVELS[0], nanEv);
    nanObs.onTick(12.3, 3);
    const nanTelemetry = { ...nanObs.getTelemetry(), enemiesKilledTotal: 8, storyWavesCompleted: 10 };
    applyTelemetryDeltaToStats(nanRecSave, nanTelemetry, null);
    const nanCampaignOutcome = recordRunCompletion(nanRecSave, {
      level: LEVELS[0],
      telemetry: nanTelemetry,
      won: true,
      stars: 3,
      livesRemaining: 20,
      levels: LEVELS,
    });
    const nanRecOutcome = recordRunCompletion(nanRecSave, {
      level: LEVELS[0],
      telemetry: nanTelemetry,
      won: true,
      stars: 3,
      livesRemaining: 20,
      levels: LEVELS,
      dailyDate: '2026-11-17',
      scoreMultiplier: 1.2,
    });
    nanObs.dispose();
    expect(nanRecSave.stats.gamesWon).toBe(2);
    expect(nanRecSave.stats.enemiesDefeatedTotal).toBe(8);
    expect(nanRecSave.stats.totalPlayTimeSec).toBe(12.3);
    expect(nanRecSave.campaign.bestStars[0]).toBe(3);
    expect(nanRecSave.bestLivesByLevelId[LEVELS[0].id]).toBe(20);
    expect(nanRecSave.fastestWinSecByLevelId[LEVELS[0].id]).toBe(12.3);
    expect(nanCampaignOutcome.isNewBestLives).toBe(true);
    expect(nanCampaignOutcome.isNewFastestWin).toBe(true);
    expect(nanRecOutcome.isNewBestDailyScore).toBe(true);
    expect(nanRecSave.dailyBestScores['2026-11-17']).toBe(nanRecOutcome.dailyScore);

    // getStats & applyTelemetryDeltaToStats sanitize non-finite fields & prototype-polluting keys,
    // and MetaSession recovers from pre-existing NaN gamesPlayed on waveStarted
    const dirtyStatsSave = createDefaultMetaSave(9);
    dirtyStatsSave.stats.gamesPlayed = Number.NaN;
    dirtyStatsSave.stats.goldEarnedTotal = Number.POSITIVE_INFINITY;
    dirtyStatsSave.stats.totalPlayTimeSec = -4;
    dirtyStatsSave.stats.enemiesDefeatedByType = JSON.parse('{"__proto__":7,"constructor":3,"grunt":5,"flyer":-2}');
    dirtyStatsSave.stats.towersBuiltByType = JSON.parse('{"prototype":9,"archer":4}');
    expect(getStats(dirtyStatsSave)).toMatchObject({
      gamesPlayed: 0,
      goldEarnedTotal: 0,
      totalPlayTimeSec: 0,
      enemiesDefeatedByType: { grunt: 5 },
      towersBuiltByType: { archer: 4 },
    });
    expect(Object.prototype.hasOwnProperty.call(getStats(dirtyStatsSave).enemiesDefeatedByType, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(getStats(dirtyStatsSave).towersBuiltByType, 'prototype')).toBe(false);

    const dirtyDeltaTarget = createDefaultMetaSave(9);
    const badObsEv = new EventBus();
    const badObs = new RunObserver(LEVELS[0], badObsEv);
    const badTelemetry = {
      ...badObs.getTelemetry(),
      simTimeSec: Number.NaN,
      wavesCompleted: Number.POSITIVE_INFINITY,
      enemiesKilledTotal: -5,
      enemiesKilledByType: JSON.parse('{"__proto__":9,"constructor":4,"grunt":2}'),
      towersBuiltByType: JSON.parse('{"prototype":8,"archer":3}'),
    };
    applyTelemetryDeltaToStats(dirtyDeltaTarget, badTelemetry, null);
    badObs.dispose();
    expect(dirtyDeltaTarget.stats.totalPlayTimeSec).toBe(0);
    expect(dirtyDeltaTarget.stats.wavesCleared).toBe(0);
    expect(dirtyDeltaTarget.stats.enemiesDefeatedTotal).toBe(0);
    expect(dirtyDeltaTarget.stats.enemiesDefeatedByType).toEqual({ grunt: 2 });
    expect(dirtyDeltaTarget.stats.towersBuiltByType).toEqual({ archer: 3 });
    expect(Object.prototype.hasOwnProperty.call(dirtyDeltaTarget.stats.enemiesDefeatedByType, 'constructor')).toBe(false);

    const nanPlayedSave = createDefaultMetaSave(9);
    nanPlayedSave.stats.gamesPlayed = Number.NaN;
    const nanPlayedMeta = new MetaSession({
      levels: LEVELS,
      saveData: nanPlayedSave,
      onSave: () => {},
    });
    const npEv = new EventBus();
    nanPlayedMeta.startRun(LEVELS[0], npEv);
    npEv.emit('waveStarted', { waveIndex: 0, totalWaves: 10, earlyBonus: 0 });
    expect(nanPlayedMeta.getStats().gamesPlayed).toBe(1);
    nanPlayedMeta.dispose();

    mutEndlessMeta.dispose();
    quitMeta.dispose();
    dailyMeta.dispose();
    meta.dispose();
  });

  it('unlocks all 25 achievements, advances through all 6 Career Ranks, exercises every Next-Goal branch, and tolerates partial saves', () => {
    const save = createDefaultMetaSave(LEVELS.length);
    expect(getMetaCareerRank(save, LEVELS)).toMatchObject({
      rankIndex: 0,
      title: 'Sky Recruit',
      points: 0,
      nextRankTitle: 'Cloud Warden',
    });
    expect(getRecommendedNextGoal(save, '2026-11-17', [])).toBeNull();

    // 1. Recommended Next Goal cascade: daily -> campaign clear -> challenge -> 3-star -> achievement (>=40%) -> endless
    const goalDaily = getRecommendedNextGoal(save, '2026-11-17', LEVELS)!;
    expect(goalDaily.kind).toBe('daily');

    save.completedDailyDates.push('2026-11-17');
    const goalClear = getRecommendedNextGoal(save, '2026-11-17', LEVELS)!;
    expect(goalClear).toMatchObject({ kind: 'campaign', levelIndex: 0 });

    save.campaign.bestStars[0] = 2;
    const goalChallenge = getRecommendedNextGoal(save, '2026-11-17', LEVELS)!;
    expect(goalChallenge).toMatchObject({ kind: 'challenge', levelIndex: 0 });

    save.completedChallenges['sunlit-meadow:perfect'] = true;
    save.completedChallenges['sunlit-meadow:lean'] = true;
    save.completedChallenges['sunlit-meadow:rush3x'] = true;
    const goalThreeStar = getRecommendedNextGoal(save, '2026-11-17', LEVELS)!;
    expect(goalThreeStar).toMatchObject({ kind: 'campaign', levelIndex: 0 });
    expect(goalThreeStar.title).toContain('3-Star');

    save.campaign.bestStars[0] = 3;
    save.stats.enemiesDefeatedTotal = 1200; // 1200/2500 = 48% on slayer_2500
    recomputeAchievements(save, LEVELS);
    const goalAch = getRecommendedNextGoal(save, '2026-11-17', LEVELS)!;
    expect(goalAch.kind).toBe('achievement');

    // Fill all 9 islands with 3 stars, all 27 challenges, all 25 achievements, and 10 dailies -> Sovereign of the Skies & Endless goal
    save.campaign.unlockedLevelIndex = LEVELS.length - 1;
    for (let i = 0; i < LEVELS.length; i++) {
      save.campaign.bestStars[i] = 3;
      const chStatus = getChallengeStatus(save, i, LEVELS)!;
      for (const ch of chStatus.challenges) {
        save.completedChallenges[ch.def.id] = true;
      }
    }
    save.achievementMilestones.wonNoLivesLost = true;
    save.achievementMilestones.wonAt3xSpeed = true;
    save.achievementMilestones.wonMax6Towers = true;
    save.achievementMilestones.bestMutatedEndlessWavesCleared = 5;
    save.stats.gamesWon = 9;
    save.stats.perfectClears = 3;
    save.stats.enemiesDefeatedTotal = 2500;
    save.stats.enemiesDefeatedByType.boss = 10;
    save.stats.flyingEnemiesDefeated = 250;
    save.stats.towersCleansed = 2;
    save.stats.meteorsCast = 20;
    save.stats.towersBuiltTotal = 100;
    save.stats.towersUpgradedToTier3 = 25;
    save.stats.towersUpgradedTotal = 100;
    save.stats.goldEarnedTotal = 25000;
    save.stats.earlyWavesCalled = 30;
    save.stats.bestEndlessWaveOverall = 15;
    save.completedDailyDates = [
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
    ];
    save.stats.dailyChallengesCompleted = 10;

    recomputeAchievements(save, LEVELS);
    const allAchievements = getAchievements(save);
    expect(allAchievements).toHaveLength(ACHIEVEMENTS.length);
    for (const ach of allAchievements) {
      expect(ach.unlocked).toBe(true);
      expect(ach.progressRatio).toBe(1);
    }
    const summary = getAchievementSummary(save);
    expect(summary.unlockedCount).toBe(ACHIEVEMENTS.length);
    expect(summary.completionRatio).toBe(1);
    expect(summary.byCategory.every((c) => c.unlocked === c.total && c.total > 0)).toBe(true);

    const sovereign = getMetaCareerRank(save, LEVELS);
    expect(sovereign.rankIndex).toBe(5);
    expect(sovereign.title).toBe('Sovereign of the Skies');
    expect(sovereign.nextRankTitle).toBeNull();
    expect(sovereign.progressRatio).toBe(1);
    expect(sovereign.points).toBe(151);

    // Check all intermediate rank tiers too (Cloud Warden -> Gale Tactician -> Bastion Commander -> Tempest Marshal)
    const rankProgressSave = createDefaultMetaSave(LEVELS.length);
    rankProgressSave.campaign.bestStars[0] = 3; // 3 pts
    rankProgressSave.completedDailyDates = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']; // +10 -> 13 pts (Cloud Warden)
    expect(getMetaCareerRank(rankProgressSave, LEVELS).title).toBe('Cloud Warden');
    rankProgressSave.campaign.bestStars = [3, 3, 3, 3, 3, 3, 0, 0, 0]; // 18 + 10 + 4(ch)=32 -> Gale Tactician
    rankProgressSave.completedChallenges['sunlit-meadow:perfect'] = true;
    rankProgressSave.completedChallenges['sunlit-meadow:lean'] = true;
    expect(getMetaCareerRank(rankProgressSave, LEVELS).title).toBe('Gale Tactician');
    rankProgressSave.campaign.bestStars = [3, 3, 3, 3, 3, 3, 3, 3, 3]; // 27 stars + 10 daily + 24 (12 challenges) = 61 -> Bastion Commander
    for (let i = 1; i <= 5; i++) {
      const chs = getChallengeStatus(rankProgressSave, i, LEVELS)!;
      rankProgressSave.completedChallenges[chs.challenges[0].def.id] = true;
      rankProgressSave.completedChallenges[chs.challenges[1].def.id] = true;
    }
    expect(getMetaCareerRank(rankProgressSave, LEVELS).title).toBe('Bastion Commander');
    for (let i = 0; i < 9; i++) {
      const chs = getChallengeStatus(rankProgressSave, i, LEVELS)!;
      for (const c of chs.challenges) rankProgressSave.completedChallenges[c.def.id] = true;
    }
    // 27 stars + 10 daily + 54 (27 challenges) + 4 (2 achievements) = 95 -> Tempest Marshal
    rankProgressSave.unlockedAchievements.first_victory = true;
    rankProgressSave.unlockedAchievements.challenger_5 = true;
    expect(getMetaCareerRank(rankProgressSave, LEVELS).title).toBe('Tempest Marshal');

    const goalEndless = getRecommendedNextGoal(save, '2026-11-17', LEVELS)!;
    expect(goalEndless.kind).toBe('endless');

    // 2. Partial/missing sub-records never throw in direct query or merge calls
    const partialObj = { version: 2, campaign: { unlockedLevelIndex: 0, bestStars: [], bestEndlessWaves: [] } } as unknown as ReturnType<typeof createDefaultMetaSave>;
    expect(getAchievements(partialObj)).toHaveLength(ACHIEVEMENTS.length);
    expect(getStats(partialObj).enemiesDefeatedTotal).toBe(0);
    expect(getTowerMasteryStats(partialObj).every((t) => t.builtCount === 0)).toBe(true);
    expect(getEnemyIntelStats(partialObj).every((e) => !e.discovered)).toBe(true);
    expect(getIslandMasteryStatus(partialObj, 0, LEVELS)?.campaignStars).toBe(0);
    expect(getMetaCareerSummary(partialObj, '2026-11-17', LEVELS).rank.title).toBe('Sky Recruit');
    expect(mergeMetaSaves(partialObj, partialObj, 9, LEVELS).version).toBe(2);
    expect(getDailyBestScore(null as unknown as Record<string, number>, '2026-11-17')).toBe(0);
    expect(getDailyBestScore([] as unknown as Record<string, number>, '2026-11-17')).toBe(0);
    expect(getDailyBestScore({ '2026-11-17': 100 }, null as unknown as string)).toBe(0);
    expect(getTodayUtcDateString(new Date('0920-03-04T00:00:00Z'))).toBe('0920-03-04');

    // Non-positive/NaN levelCount & non-string/array runtime save inputs never throw or leak NaN/array indices
    expect(createDefaultMetaSave(0).campaign.bestStars).toHaveLength(1);
    expect(createDefaultMetaSave(Number.NaN).campaign.bestStars).toHaveLength(1);
    const nanCampaign = mergeCampaignProgress(
      { unlockedLevelIndex: 0, bestStars: [1], bestEndlessWaves: [0] },
      { unlockedLevelIndex: 0, bestStars: [2], bestEndlessWaves: [0] },
      Number.NaN,
    );
    expect(nanCampaign.unlockedLevelIndex).toBe(0);
    expect(loadProgress(Number.NaN).bestStars).toHaveLength(1);
    expect(importMetaSaveJson(null as unknown as string, null, 9, LEVELS).ok).toBe(false);
    expect(getRecommendedNextGoal(partialObj, null as unknown as string, LEVELS)?.kind).toBe('campaign');
    expect(getRecentDailyHistory(partialObj, null as unknown as string, 2, '2026-11-17', LEVELS)).toHaveLength(2);

    const arrayCorrupt = {
      ...createDefaultMetaSave(9),
      completedChallenges: [true] as unknown as Record<string, boolean>,
      unlockedAchievements: [true] as unknown as Record<string, boolean>,
      bestEndlessScoresByLevelId: [999] as unknown as Record<string, number>,
      fastestWinSecByLevelId: [1.5] as unknown as Record<string, number>,
    };
    const mergedArraySafe = mergeMetaSaves(createDefaultMetaSave(9), arrayCorrupt, 9, LEVELS);
    expect(Object.keys(mergedArraySafe.completedChallenges)).toEqual([]);
    expect(Object.keys(mergedArraySafe.unlockedAchievements)).toEqual([]);
    expect(Object.keys(mergedArraySafe.bestEndlessScoresByLevelId)).toEqual([]);
    expect(Object.keys(mergedArraySafe.fastestWinSecByLevelId)).toEqual([]);
  });
});
