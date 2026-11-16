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
});
