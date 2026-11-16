import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import type { ProgressData } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ACHIEVEMENTS } from '../../src/data/challenges.ts';
import { LEVELS, type LevelDef } from '../../src/data/levels/index.ts';
import { MetaSession } from '../../src/platform/metaSession.ts';
import {
  loadMetaSave,
  loadProgress,
  META_PROGRESS_KEY,
  PROGRESS_KEY,
  saveMetaSave,
} from '../../src/platform/storage.ts';
import {
  createDefaultMetaSave,
  getAchievements,
  getAllChallengeProgress,
  getChallengeStatus,
  getStats,
  migrateToMetaSave,
} from '../../src/sim/meta/metaEngine.ts';
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

    // Check Island Mastery & Career Summary APIs
    const mastery = meta.getIslandMasteryStatus(0)!;
    expect(mastery.campaignStars).toBe(3);
    expect(mastery.challengeStars).toBe(3);
    expect(mastery.mastered).toBe(true);
    expect(mastery.bestEndlessScore).toBeGreaterThan(0);

    const summary = meta.getMetaCareerSummary();
    expect(summary.islandsMastered).toBe(1);
    expect(summary.winRatePct).toBe(100);
    expect(summary.favoriteTowerType).toBe('archer');
    expect(summary.mostDefeatedEnemyType).toBe('grunt');
    meta.dispose();
  });
});
