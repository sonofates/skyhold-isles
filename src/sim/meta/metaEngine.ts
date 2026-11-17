import type { EnemyType, ProgressData, TowerType } from '../../core/types.ts';
import { BALANCE } from '../../data/balance.ts';
import { ACHIEVEMENTS, getChallengeById, getChallengesForLevel } from '../../data/challenges.ts';
import { ENEMY_DEFS, ENEMY_TYPES } from '../../data/enemies.ts';
import { LEVELS } from '../../data/levels/index.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import { TOWER_DEFS, TOWER_TYPES } from '../../data/towers.ts';
import {
  computeDailyStreaks,
  generateDailyChallenge,
  getRecentDailySpecs,
  isValidDateString,
} from './daily.ts';
import { computeCampaignRunScore, computeEndlessScore } from './mutators.ts';
import type {
  AchievementCategory,
  AchievementCategorySummary,
  AchievementDef,
  AchievementStatus,
  AchievementSummary,
  AllChallengeProgress,
  AllIslandMastery,
  ChallengeDef,
  ChallengeItemStatus,
  DailyHistoryEntry,
  EndlessScoreBreakdown,
  EnemyIntelEntry,
  IslandMasteryStatus,
  LevelChallengeStatus,
  LifetimeStats,
  MetaCareerRank,
  MetaCareerSummary,
  MetaSaveData,
  RecommendedGoal,
  RunMetaOutcome,
  RunTelemetry,
  TowerMasteryRank,
  TowerMasteryStat,
} from './types.ts';
import { evaluateLevelChallenges } from './runObserver.ts';

export const META_SAVE_VERSION = 2 as const;

export function createEmptyLifetimeStats(): LifetimeStats {
  return {
    totalPlayTimeSec: 0,
    gamesPlayed: 0,
    gamesWon: 0,
    gamesLost: 0,
    wavesCleared: 0,
    earlyWavesCalled: 0,
    enemiesDefeatedTotal: 0,
    enemiesDefeatedByType: {},
    flyingEnemiesDefeated: 0,
    towersBuiltTotal: 0,
    towersBuiltByType: {},
    towersUpgradedToTier3: 0,
    towersUpgradedTotal: 0,
    towersSoldTotal: 0,
    goldEarnedTotal: 0,
    goldSpentTotal: 0,
    abilitiesCastTotal: 0,
    meteorsCast: 0,
    overchargesCast: 0,
    towersCleansed: 0,
    perfectClears: 0,
    bestEndlessWaveOverall: 0,
    bestEndlessScoreOverall: 0,
    dailyChallengesCompleted: 0,
  };
}

export function createDefaultMetaSave(levelCount: number): MetaSaveData {
  return {
    version: META_SAVE_VERSION,
    campaign: {
      unlockedLevelIndex: 0,
      bestStars: new Array<number>(levelCount).fill(0),
      bestEndlessWaves: new Array<number>(levelCount).fill(0),
    },
    completedChallenges: {},
    unlockedAchievements: {},
    achievementMilestones: {
      wonNoLivesLost: false,
      wonAt3xSpeed: false,
      wonMax6Towers: false,
      bestMutatedEndlessWavesCleared: 0,
    },
    stats: createEmptyLifetimeStats(),
    bestEndlessScoresByLevelId: {},
    bestMutatedScoresByLevelId: {},
    bestLivesByLevelId: {},
    fastestWinSecByLevelId: {},
    completedDailyDates: [],
    dailyBestScores: {},
  };
}

function sanitizePositiveFloatRecord(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      out[key] = Math.max(0.1, +val.toFixed(1));
    }
  }
  return out;
}

function asNonNegInt(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function asNonNegFloat(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

function sanitizeCountRecord(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const n = asNonNegInt(val, 0);
    if (n > 0) out[key] = n;
  }
  return out;
}

function sanitizeDailyScoreRecord(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const trimmed = key.trim();
    if (!isValidDateString(trimmed)) continue;
    const n = asNonNegInt(val, 0);
    if (n > (out[trimmed] ?? 0)) {
      out[trimmed] = n;
    }
  }
  return out;
}

function sanitizeBoolRecord(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (val === true) out[key] = true;
  }
  return out;
}

function sanitizeCampaign(raw: unknown, levelCount: number): ProgressData {
  const safeCount = Math.max(1, levelCount);
  const bestStars = new Array<number>(safeCount).fill(0);
  const bestEndlessWaves = new Array<number>(safeCount).fill(0);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { unlockedLevelIndex: 0, bestStars, bestEndlessWaves };
  }
  const obj = raw as Partial<ProgressData>;
  const starLen = Array.isArray(obj.bestStars) ? obj.bestStars.length : 0;
  const maxStarLen = Math.max(safeCount, starLen);
  while (bestStars.length < maxStarLen) bestStars.push(0);
  if (Array.isArray(obj.bestStars)) {
    for (let i = 0; i < obj.bestStars.length; i++) {
      const val = obj.bestStars[i];
      if (typeof val === 'number' && Number.isFinite(val)) {
        bestStars[i] = Math.max(0, Math.min(3, Math.floor(val)));
      }
    }
  }

  const endLen = Array.isArray(obj.bestEndlessWaves) ? obj.bestEndlessWaves.length : 0;
  const maxEndLen = Math.max(safeCount, endLen);
  while (bestEndlessWaves.length < maxEndLen) bestEndlessWaves.push(0);
  if (Array.isArray(obj.bestEndlessWaves)) {
    for (let i = 0; i < obj.bestEndlessWaves.length; i++) {
      const val = obj.bestEndlessWaves[i];
      if (typeof val === 'number' && Number.isFinite(val)) {
        bestEndlessWaves[i] = Math.max(0, Math.floor(val));
      }
    }
  }

  const unlockedLevelIndex =
    typeof obj.unlockedLevelIndex === 'number' && Number.isFinite(obj.unlockedLevelIndex)
      ? Math.max(0, Math.min(safeCount - 1, Math.floor(obj.unlockedLevelIndex)))
      : 0;

  return { unlockedLevelIndex, bestStars, bestEndlessWaves };
}

/** Merges two ProgressData records monotonically (never wiping higher stars/unlocks/endless waves). */
export function mergeCampaignProgress(
  a: ProgressData,
  b: ProgressData,
  levelCount: number,
): ProgressData {
  const safeCount = Math.max(1, levelCount);
  const aStars = Array.isArray(a.bestStars) ? a.bestStars : [];
  const bStars = Array.isArray(b.bestStars) ? b.bestStars : [];
  const aEndless = Array.isArray(a.bestEndlessWaves) ? a.bestEndlessWaves : [];
  const bEndless = Array.isArray(b.bestEndlessWaves) ? b.bestEndlessWaves : [];
  const len = Math.max(
    safeCount,
    aStars.length,
    bStars.length,
    aEndless.length,
    bEndless.length,
  );
  const bestStars = new Array<number>(len).fill(0);
  const bestEndlessWaves = new Array<number>(len).fill(0);
  for (let i = 0; i < len; i++) {
    const sa = typeof aStars[i] === 'number' && Number.isFinite(aStars[i])
      ? Math.max(0, Math.min(3, Math.floor(aStars[i])))
      : 0;
    const sb = typeof bStars[i] === 'number' && Number.isFinite(bStars[i])
      ? Math.max(0, Math.min(3, Math.floor(bStars[i])))
      : 0;
    bestStars[i] = Math.max(sa, sb);

    const ea = asNonNegInt(aEndless[i], 0);
    const eb = asNonNegInt(bEndless[i], 0);
    bestEndlessWaves[i] = Math.max(ea, eb);
  }
  const ua = asNonNegInt(a.unlockedLevelIndex, 0);
  const ub = asNonNegInt(b.unlockedLevelIndex, 0);
  const unlockedLevelIndex = Math.max(0, Math.min(safeCount - 1, Math.max(ua, ub)));
  return { unlockedLevelIndex, bestStars, bestEndlessWaves };
}

/**
 * Pure migration from `skyhold_isles_progress_v1` and/or `skyhold_isles_meta_v2` JSON payloads.
 * Preserves all v1 stars, unlocked islands, and endless records without ever wiping progress.
 */
export function migrateToMetaSave(
  rawV2: unknown,
  rawV1: unknown,
  levelCount: number,
  levels: readonly LevelDef[] = LEVELS,
): MetaSaveData {
  const base = createDefaultMetaSave(levelCount);
  const v1Campaign = sanitizeCampaign(rawV1, levelCount);

  if (rawV2 && typeof rawV2 === 'object' && !Array.isArray(rawV2)) {
    const obj = rawV2 as Partial<MetaSaveData> & { campaign?: unknown };
    // Support accidentally passing a v1 shape directly into rawV2
    const looksLikeV1Only =
      obj.version === undefined && ('bestStars' in obj || 'unlockedLevelIndex' in obj);
    const v2Campaign = looksLikeV1Only
      ? sanitizeCampaign(rawV2, levelCount)
      : sanitizeCampaign(obj.campaign, levelCount);
    base.campaign = mergeCampaignProgress(v2Campaign, v1Campaign, levelCount);

    base.completedChallenges = sanitizeBoolRecord(obj.completedChallenges);
    base.unlockedAchievements = sanitizeBoolRecord(obj.unlockedAchievements);

    if (obj.achievementMilestones && typeof obj.achievementMilestones === 'object') {
      const m = obj.achievementMilestones as Partial<MetaSaveData['achievementMilestones']>;
      base.achievementMilestones = {
        wonNoLivesLost: m.wonNoLivesLost === true,
        wonAt3xSpeed: m.wonAt3xSpeed === true,
        wonMax6Towers: m.wonMax6Towers === true,
        bestMutatedEndlessWavesCleared: asNonNegInt(m.bestMutatedEndlessWavesCleared, 0),
      };
    }

    if (obj.stats && typeof obj.stats === 'object' && !Array.isArray(obj.stats)) {
      const s = obj.stats as Partial<LifetimeStats>;
      base.stats = {
        totalPlayTimeSec: asNonNegFloat(s.totalPlayTimeSec),
        gamesPlayed: asNonNegInt(s.gamesPlayed),
        gamesWon: asNonNegInt(s.gamesWon),
        gamesLost: asNonNegInt(s.gamesLost),
        wavesCleared: asNonNegInt(s.wavesCleared),
        earlyWavesCalled: asNonNegInt(s.earlyWavesCalled),
        enemiesDefeatedTotal: asNonNegInt(s.enemiesDefeatedTotal),
        enemiesDefeatedByType: sanitizeCountRecord(s.enemiesDefeatedByType),
        flyingEnemiesDefeated: asNonNegInt(s.flyingEnemiesDefeated),
        towersBuiltTotal: asNonNegInt(s.towersBuiltTotal),
        towersBuiltByType: sanitizeCountRecord(s.towersBuiltByType),
        towersUpgradedToTier3: asNonNegInt(s.towersUpgradedToTier3),
        towersUpgradedTotal: asNonNegInt(s.towersUpgradedTotal),
        towersSoldTotal: asNonNegInt(s.towersSoldTotal),
        goldEarnedTotal: asNonNegInt(s.goldEarnedTotal),
        goldSpentTotal: asNonNegInt(s.goldSpentTotal),
        abilitiesCastTotal: asNonNegInt(s.abilitiesCastTotal),
        meteorsCast: asNonNegInt(s.meteorsCast),
        overchargesCast: asNonNegInt(s.overchargesCast),
        towersCleansed: asNonNegInt(s.towersCleansed),
        perfectClears: asNonNegInt(s.perfectClears),
        bestEndlessWaveOverall: asNonNegInt(s.bestEndlessWaveOverall),
        bestEndlessScoreOverall: asNonNegInt(s.bestEndlessScoreOverall),
        dailyChallengesCompleted: asNonNegInt(s.dailyChallengesCompleted),
      };
    }

    if (Array.isArray(obj.completedDailyDates)) {
      const uniqueDates = new Set<string>();
      for (const d of obj.completedDailyDates) {
        if (typeof d === 'string' && isValidDateString(d)) {
          uniqueDates.add(d.trim());
        }
      }
      base.completedDailyDates = [...uniqueDates].sort();
    }

    base.bestEndlessScoresByLevelId = sanitizeCountRecord(obj.bestEndlessScoresByLevelId);
    base.bestMutatedScoresByLevelId = sanitizeCountRecord(obj.bestMutatedScoresByLevelId);
    const rawBestLives = sanitizeCountRecord(obj.bestLivesByLevelId);
    for (const [lid, lives] of Object.entries(rawBestLives)) {
      base.bestLivesByLevelId[lid] = Math.min(BALANCE.startingLives, lives);
    }
    base.fastestWinSecByLevelId = sanitizePositiveFloatRecord(obj.fastestWinSecByLevelId);
    base.dailyBestScores = sanitizeDailyScoreRecord(obj.dailyBestScores);
  } else {
    base.campaign = v1Campaign;
  }

  // Unlock the next island if a cleared final island predated newly added levels (e.g. Islands 10+)
  let highestClearedIndex = -1;
  for (let i = 0; i < base.campaign.bestStars.length; i++) {
    if (base.campaign.bestStars[i] > 0) highestClearedIndex = i;
  }
  if (highestClearedIndex >= 0) {
    base.campaign.unlockedLevelIndex = Math.max(
      base.campaign.unlockedLevelIndex,
      Math.min(Math.max(0, levelCount - 1), highestClearedIndex + 1),
    );
  }

  for (const score of Object.values(base.bestEndlessScoresByLevelId)) {
    if (score > base.stats.bestEndlessScoreOverall) {
      base.stats.bestEndlessScoreOverall = score;
    }
  }

  // Keep stats consistent with migrated v1 endless waves and wins
  let maxEndless = base.stats.bestEndlessWaveOverall;
  for (let i = 0; i < base.campaign.bestEndlessWaves.length; i++) {
    if (base.campaign.bestEndlessWaves[i] > maxEndless) {
      maxEndless = base.campaign.bestEndlessWaves[i];
    }
  }
  base.stats.bestEndlessWaveOverall = maxEndless;

  const clearedIslandsCount = base.campaign.bestStars.filter((s) => s > 0).length;
  if (base.stats.gamesWon < clearedIslandsCount) {
    base.stats.gamesWon = clearedIslandsCount;
  }
  if (base.stats.gamesPlayed < base.stats.gamesWon + base.stats.gamesLost) {
    base.stats.gamesPlayed = base.stats.gamesWon + base.stats.gamesLost;
  }
  if (base.stats.dailyChallengesCompleted < base.completedDailyDates.length) {
    base.stats.dailyChallengesCompleted = base.completedDailyDates.length;
  }

  // Keep sticky achievement milestones consistent with migrated challenge/life records
  for (const [cid, done] of Object.entries(base.completedChallenges)) {
    if (!done) continue;
    const chDef = getChallengeById(cid, levels);
    if (!chDef) continue;
    if (chDef.condition.kind === 'noLivesLost') {
      base.achievementMilestones.wonNoLivesLost = true;
    } else if (chDef.condition.kind === 'combatSpeedOnly' && chDef.condition.requiredSpeed >= 3) {
      base.achievementMilestones.wonAt3xSpeed = true;
    } else if (chDef.condition.kind === 'maxTowersBuilt' && chDef.condition.maxCount <= 6) {
      base.achievementMilestones.wonMax6Towers = true;
    }
  }
  for (const lives of Object.values(base.bestLivesByLevelId)) {
    if (lives >= BALANCE.startingLives) {
      base.achievementMilestones.wonNoLivesLost = true;
      break;
    }
  }

  recomputeAchievements(base, levels);
  return base;
}

/**
 * Applies incremental telemetry delta from an ongoing or ended run into `save.stats`.
 * Pass the difference `(currentTelemetry - alreadyCommittedTelemetry)` so multiple flushes
 * during a long endless run never double-count.
 */
export function applyTelemetryDeltaToStats(
  save: MetaSaveData,
  current: RunTelemetry,
  committed: RunTelemetry | null,
): void {
  if (!current.eligibleForChallenges) return;
  const prev = committed;
  const d = (curr: number, old: number | undefined): number => Math.max(0, curr - (old ?? 0));

  save.stats.totalPlayTimeSec = +(
    save.stats.totalPlayTimeSec + d(current.simTimeSec, prev?.simTimeSec)
  ).toFixed(3);
  save.stats.wavesCleared += d(current.wavesCompleted, prev?.wavesCompleted);
  save.stats.earlyWavesCalled += d(current.earlyWavesCalled, prev?.earlyWavesCalled);
  save.stats.enemiesDefeatedTotal += d(current.enemiesKilledTotal, prev?.enemiesKilledTotal);
  save.stats.flyingEnemiesDefeated += d(
    current.flyingEnemiesKilled,
    prev?.flyingEnemiesKilled,
  );
  save.stats.towersBuiltTotal += d(current.towersBuilt, prev?.towersBuilt);
  save.stats.towersSoldTotal += d(current.towersSold, prev?.towersSold);
  save.stats.goldEarnedTotal += d(current.goldEarned, prev?.goldEarned);
  save.stats.goldSpentTotal += d(current.grossGoldSpent, prev?.grossGoldSpent);
  save.stats.abilitiesCastTotal += d(current.abilitiesCastTotal, prev?.abilitiesCastTotal);
  save.stats.meteorsCast += d(current.meteorsCast, prev?.meteorsCast);
  save.stats.overchargesCast += d(current.overchargesCast, prev?.overchargesCast);
  save.stats.towersCleansed += d(current.towersCleansed, prev?.towersCleansed);
  save.stats.towersUpgradedToTier3 += d(
    current.towersUpgradedToTier3,
    prev?.towersUpgradedToTier3,
  );
  save.stats.towersUpgradedTotal += d(current.towersUpgraded, prev?.towersUpgraded);

  for (const [enemyType, count] of Object.entries(current.enemiesKilledByType)) {
    const delta = d(count, prev?.enemiesKilledByType[enemyType]);
    if (delta > 0) {
      save.stats.enemiesDefeatedByType[enemyType] =
        (save.stats.enemiesDefeatedByType[enemyType] ?? 0) + delta;
    }
  }

  for (const [towerType, count] of Object.entries(current.towersBuiltByType)) {
    const delta = d(count, prev?.towersBuiltByType[towerType]);
    if (delta > 0) {
      save.stats.towersBuiltByType[towerType] =
        (save.stats.towersBuiltByType[towerType] ?? 0) + delta;
    }
  }

  if (
    current.eligibleForChallenges &&
    current.endlessEntered &&
    current.maxWaveReached > current.storyWaveCount &&
    current.maxWaveReached > save.stats.bestEndlessWaveOverall
  ) {
    save.stats.bestEndlessWaveOverall = current.maxWaveReached;
  }
}

function getAchievementCurrentValue(
  def: AchievementDef,
  save: MetaSaveData,
): number {
  const bestStars = save.campaign.bestStars;
  const islandsWithStars = bestStars.filter((s) => s > 0).length;
  const totalStars = bestStars.reduce((sum, s) => sum + s, 0);
  const completedChallengeCount = Object.values(save.completedChallenges).filter(Boolean).length;

  switch (def.id) {
    case 'first_victory':
      return Math.max(save.stats.gamesWon, islandsWithStars > 0 ? 1 : 0);
    case 'island_explorer':
      return islandsWithStars;
    case 'campaign_champion':
      return islandsWithStars;
    case 'star_collector_15':
    case 'star_collector_27':
      return totalStars;
    case 'challenger_5':
    case 'challenger_15':
      return completedChallengeCount;
    case 'flawless_defense':
      return save.achievementMilestones.wonNoLivesLost || save.stats.perfectClears > 0 ? 1 : 0;
    case 'speed_demon':
      return save.achievementMilestones.wonAt3xSpeed ? 1 : 0;
    case 'minimalist':
      return save.achievementMilestones.wonMax6Towers ? 1 : 0;
    case 'slayer_250':
    case 'slayer_2500':
      return save.stats.enemiesDefeatedTotal;
    case 'boss_slayer_10':
      return save.stats.enemiesDefeatedByType.boss ?? 0;
    case 'anti_air_ace':
      return save.stats.flyingEnemiesDefeated;
    case 'overcharge_cleanse':
      return save.stats.towersCleansed;
    case 'meteor_caller':
      return save.stats.meteorsCast;
    case 'master_architect':
      return save.stats.towersBuiltTotal;
    case 'tier3_forge':
      return save.stats.towersUpgradedToTier3;
    case 'upgrade_specialist':
      return save.stats.towersUpgradedTotal;
    case 'gold_baron':
      return save.stats.goldEarnedTotal;
    case 'early_bird':
      return save.stats.earlyWavesCalled;
    case 'endless_survivor':
      return save.stats.bestEndlessWaveOverall;
    case 'mutated_endless':
      return save.achievementMilestones.bestMutatedEndlessWavesCleared;
    case 'daily_victor':
      return Math.max(save.stats.dailyChallengesCompleted, save.completedDailyDates.length);
    case 'daily_streak_3': {
      const refDate = save.completedDailyDates[save.completedDailyDates.length - 1] ?? '1970-01-01';
      return computeDailyStreaks(save.completedDailyDates, refDate).bestStreak;
    }
    default:
      return 0;
  }
}

/** Updates unlockedAchievements monotonically and returns newly unlocked achievement IDs. */
export function recomputeAchievements(
  save: MetaSaveData,
  _levels: readonly LevelDef[] = LEVELS,
): readonly string[] {
  void _levels;
  const newlyUnlocked: string[] = [];
  for (let i = 0; i < ACHIEVEMENTS.length; i++) {
    const def = ACHIEVEMENTS[i];
    if (save.unlockedAchievements[def.id]) continue;
    const current = getAchievementCurrentValue(def, save);
    if (current >= def.target) {
      save.unlockedAchievements[def.id] = true;
      newlyUnlocked.push(def.id);
    }
  }
  return newlyUnlocked;
}

/** Updates endless wave, mutated endless, and endless high-score records monotonically. */
export function recordEndlessRunStats(
  save: MetaSaveData,
  level: LevelDef,
  telemetry: RunTelemetry,
  scoreMultiplier = 1,
): EndlessScoreBreakdown | null {
  if (
    !telemetry.eligibleForChallenges ||
    !telemetry.endlessEntered ||
    (telemetry.maxWaveReached <= telemetry.storyWaveCount && telemetry.endlessWavesCompleted === 0)
  ) {
    return null;
  }
  while (save.campaign.bestEndlessWaves.length <= level.index) {
    save.campaign.bestEndlessWaves.push(0);
  }
  save.campaign.bestEndlessWaves[level.index] = Math.max(
    save.campaign.bestEndlessWaves[level.index] ?? 0,
    telemetry.maxWaveReached,
  );
  if (telemetry.maxWaveReached > save.stats.bestEndlessWaveOverall) {
    save.stats.bestEndlessWaveOverall = telemetry.maxWaveReached;
  }
  const endlessWavesCleared = telemetry.endlessWavesCompleted;
  if (
    (telemetry.hasRunModifiers || telemetry.activeMutatorIds.length > 0) &&
    endlessWavesCleared > save.achievementMilestones.bestMutatedEndlessWavesCleared
  ) {
    save.achievementMilestones.bestMutatedEndlessWavesCleared = endlessWavesCleared;
  }
  const endlessScore = computeEndlessScore(
    endlessWavesCleared,
    telemetry.endlessEnemiesKilled,
    scoreMultiplier,
  );
  save.bestEndlessScoresByLevelId[level.id] = Math.max(
    save.bestEndlessScoresByLevelId[level.id] ?? 0,
    endlessScore.totalScore,
  );
  if (endlessScore.totalScore > save.stats.bestEndlessScoreOverall) {
    save.stats.bestEndlessScoreOverall = endlessScore.totalScore;
  }
  return endlessScore;
}

const ACHIEVEMENT_BY_ID = new Map<string, AchievementDef>(
  ACHIEVEMENTS.map((def) => [def.id, def]),
);

/** Looks up an achievement definition by ID (returns null if unknown). */
export function getAchievementById(achievementId: string): AchievementDef | null {
  return ACHIEVEMENT_BY_ID.get(achievementId) ?? null;
}

/** Resolves an array of achievement IDs into their definitions in order. */
export function resolveAchievementDefs(ids: readonly string[]): readonly AchievementDef[] {
  const out: AchievementDef[] = [];
  for (let i = 0; i < ids.length; i++) {
    const def = ACHIEVEMENT_BY_ID.get(ids[i]);
    if (def) out.push(def);
  }
  return out;
}

/** Records a completed campaign win, daily win, or endless/campaign loss into `save`. */
export function recordRunCompletion(
  save: MetaSaveData,
  params: {
    level: LevelDef;
    telemetry: RunTelemetry;
    won: boolean;
    stars: 0 | 1 | 2 | 3;
    livesRemaining: number;
    levels?: readonly LevelDef[];
    dailyDate?: string | null;
    scoreMultiplier?: number;
    previousBestEndlessWave?: number;
    previousBestEndlessScore?: number;
  },
): RunMetaOutcome {
  const levels = params.levels ?? LEVELS;
  const { level, telemetry, won, stars, livesRemaining } = params;
  const normalizedDailyDate =
    params.dailyDate && isValidDateString(params.dailyDate) ? params.dailyDate.trim() : null;
  const isDaily = normalizedDailyDate !== null && !telemetry.endlessEntered;
  const newlyCompletedChallengeIds: string[] = [];
  const completedChallengeIds: string[] = [];
  const newlyCompletedChallenges: ChallengeDef[] = [];
  let isNewBestLives = false;
  let isNewFastestWin = false;
  let mutatedScore: number | null = null;
  let isNewBestMutatedScore = false;

  const prevEndlessWave =
    params.previousBestEndlessWave ?? (save.campaign.bestEndlessWaves[level.index] ?? 0);
  const prevEndlessScore =
    params.previousBestEndlessScore ?? (save.bestEndlessScoresByLevelId[level.id] ?? 0);
  const runDurationSec = Number.isFinite(telemetry.simTimeSec)
    ? +Math.max(0, telemetry.simTimeSec).toFixed(1)
    : 0;

  if (won) {
    if (telemetry.eligibleForChallenges) {
      save.stats.gamesWon++;
      if (!isDaily && stars > 0) {
        while (save.campaign.bestStars.length <= level.index) {
          save.campaign.bestStars.push(0);
        }
        save.campaign.bestStars[level.index] = Math.max(
          save.campaign.bestStars[level.index] ?? 0,
          stars,
        );
        if (level.index + 1 < levels.length) {
          save.campaign.unlockedLevelIndex = Math.max(
            save.campaign.unlockedLevelIndex,
            level.index + 1,
          );
        }

        const hasModifiers = telemetry.hasRunModifiers || telemetry.activeMutatorIds.length > 0;
        if (!hasModifiers) {
          const safeLives = Number.isFinite(livesRemaining) ? Math.floor(livesRemaining) : 0;
          const clampedLives = Math.max(0, Math.min(BALANCE.startingLives, safeLives));
          if (clampedLives > (save.bestLivesByLevelId[level.id] ?? 0)) {
            save.bestLivesByLevelId[level.id] = clampedLives;
            isNewBestLives = true;
          }
          if (Number.isFinite(telemetry.simTimeSec) && telemetry.simTimeSec > 0) {
            const clearSec = Math.max(0.1, +telemetry.simTimeSec.toFixed(1));
            const prevFastest = save.fastestWinSecByLevelId[level.id];
            if (prevFastest === undefined || clearSec < prevFastest) {
              save.fastestWinSecByLevelId[level.id] = clearSec;
              isNewFastestWin = true;
            }
          }
        } else {
          const score = computeCampaignRunScore(
            telemetry.storyWavesCompleted,
            telemetry.enemiesKilledTotal,
            livesRemaining,
            params.scoreMultiplier ?? 1,
          );
          mutatedScore = score;
          const prevMutatedBest = save.bestMutatedScoresByLevelId[level.id] ?? 0;
          if (score > prevMutatedBest) {
            isNewBestMutatedScore = true;
          }
          save.bestMutatedScoresByLevelId[level.id] = Math.max(prevMutatedBest, score);
        }
      }

      if (telemetry.livesLost === 0 && livesRemaining >= BALANCE.startingLives) {
        save.stats.perfectClears++;
        save.achievementMilestones.wonNoLivesLost = true;
      }
      if (telemetry.minCombatSpeed !== null && telemetry.minCombatSpeed >= 3) {
        save.achievementMilestones.wonAt3xSpeed = true;
      }
      if (telemetry.towersBuilt <= 6) {
        save.achievementMilestones.wonMax6Towers = true;
      }

      if (!isDaily) {
        const satisfied = evaluateLevelChallenges(level, telemetry, true, livesRemaining);
        for (let i = 0; i < satisfied.length; i++) {
          const chDef = satisfied[i];
          const cid = chDef.id;
          completedChallengeIds.push(cid);
          if (!save.completedChallenges[cid]) {
            save.completedChallenges[cid] = true;
            newlyCompletedChallengeIds.push(cid);
            newlyCompletedChallenges.push(chDef);
          }
        }
      }
    }
  } else if (!telemetry.endlessEntered && telemetry.eligibleForChallenges) {
    save.stats.gamesLost++;
  }
  if (save.stats.gamesPlayed < save.stats.gamesWon + save.stats.gamesLost) {
    save.stats.gamesPlayed = save.stats.gamesWon + save.stats.gamesLost;
  }

  const endlessScore = recordEndlessRunStats(
    save,
    level,
    telemetry,
    params.scoreMultiplier ?? 1,
  );
  const isNewBestEndlessWave =
    endlessScore !== null && telemetry.maxWaveReached > prevEndlessWave;
  const isNewBestEndlessScore =
    endlessScore !== null && endlessScore.totalScore > prevEndlessScore;

  let dailyScore: number | null = null;
  let isNewBestDailyScore = false;
  if (isDaily && won && normalizedDailyDate && telemetry.eligibleForChallenges) {
    const score = computeCampaignRunScore(
      telemetry.storyWavesCompleted,
      telemetry.enemiesKilledTotal,
      livesRemaining,
      params.scoreMultiplier ?? 1,
    );
    dailyScore = score;
    const prevDailyBest = save.dailyBestScores[normalizedDailyDate] ?? 0;
    if (score > prevDailyBest) {
      isNewBestDailyScore = true;
    }
    if (!save.completedDailyDates.includes(normalizedDailyDate)) {
      save.completedDailyDates.push(normalizedDailyDate);
      save.completedDailyDates.sort();
      save.stats.dailyChallengesCompleted++;
    }
    save.dailyBestScores[normalizedDailyDate] = Math.max(prevDailyBest, score);
  }

  const newlyUnlockedAchievementIds = recomputeAchievements(save, levels);
  const newlyUnlockedAchievements = resolveAchievementDefs(newlyUnlockedAchievementIds);

  return {
    won,
    isDaily,
    newlyCompletedChallengeIds,
    completedChallengeIds,
    newlyCompletedChallenges,
    newlyUnlockedAchievementIds,
    newlyUnlockedAchievements,
    endlessScore,
    dailyScore,
    mutatedScore,
    runDurationSec,
    isNewBestLives,
    isNewFastestWin,
    isNewBestEndlessWave,
    isNewBestEndlessScore,
    isNewBestDailyScore,
    isNewBestMutatedScore,
  };
}

/** Typed UI query: challenge status & challenge stars for a single island index. */
export function getChallengeStatus(
  save: MetaSaveData,
  levelIndex: number,
  levels: readonly LevelDef[] = LEVELS,
): LevelChallengeStatus | null {
  const level = levels[levelIndex];
  if (!level) return null;
  const defs = getChallengesForLevel(level);
  const challenges: ChallengeItemStatus[] = [];
  let earnedStars = 0;

  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const completed = save.completedChallenges[def.id] === true;
    if (completed) earnedStars++;
    challenges.push({ def, completed });
  }

  return {
    levelId: level.id,
    levelIndex,
    levelName: level.name,
    earnedStars,
    totalStars: defs.length,
    challenges,
  };
}

/** Typed UI query: challenge stars aggregated across all registered islands. */
export function getAllChallengeProgress(
  save: MetaSaveData,
  levels: readonly LevelDef[] = LEVELS,
): AllChallengeProgress {
  const byLevel: LevelChallengeStatus[] = [];
  let earnedStars = 0;
  let totalStars = 0;

  for (let i = 0; i < levels.length; i++) {
    const status = getChallengeStatus(save, i, levels);
    if (status) {
      byLevel.push(status);
      earnedStars += status.earnedStars;
      totalStars += status.totalStars;
    }
  }

  return { earnedStars, totalStars, byLevel };
}

/** Typed UI query: all achievements with unlock status and progress ratio. */
export function getAchievements(save: MetaSaveData): readonly AchievementStatus[] {
  return ACHIEVEMENTS.map((def) => {
    const unlocked = save.unlockedAchievements[def.id] === true;
    const rawCurrent = getAchievementCurrentValue(def, save);
    const current = unlocked ? Math.max(def.target, rawCurrent) : Math.min(def.target, rawCurrent);
    return {
      def,
      unlocked,
      current,
      target: def.target,
      progressRatio: def.target > 0 ? Math.min(1, current / def.target) : unlocked ? 1 : 0,
    };
  });
}

/** Typed UI query: cloned snapshot of lifetime player stats. */
export function getStats(save: MetaSaveData): LifetimeStats {
  return {
    ...save.stats,
    enemiesDefeatedByType: { ...save.stats.enemiesDefeatedByType },
    towersBuiltByType: { ...save.stats.towersBuiltByType },
  };
}

/** Looks up a challenge definition across registered islands (returns null if unknown). */
export function resolveChallengeDef(
  challengeId: string,
  levels: readonly LevelDef[] = LEVELS,
): ChallengeDef | null {
  return getChallengeById(challengeId, levels) ?? null;
}

/** Typed UI query: combined campaign stars, challenge stars, endless records, personal bests, and mastery flag for one island. */
export function getIslandMasteryStatus(
  save: MetaSaveData,
  levelIndex: number,
  levels: readonly LevelDef[] = LEVELS,
): IslandMasteryStatus | null {
  const challengeStatus = getChallengeStatus(save, levelIndex, levels);
  if (!challengeStatus) return null;
  const campaignStars = save.campaign.bestStars[levelIndex] ?? 0;
  const bestEndlessWave = save.campaign.bestEndlessWaves[levelIndex] ?? 0;
  const bestEndlessScore = save.bestEndlessScoresByLevelId[challengeStatus.levelId] ?? 0;
  const bestMutatedScore = save.bestMutatedScoresByLevelId[challengeStatus.levelId] ?? 0;
  const bestLivesRemaining = save.bestLivesByLevelId[challengeStatus.levelId] ?? 0;
  const fastestWinSec = save.fastestWinSecByLevelId[challengeStatus.levelId] ?? null;
  return {
    levelId: challengeStatus.levelId,
    levelIndex,
    levelName: challengeStatus.levelName,
    campaignStars,
    challengeStars: challengeStatus.earnedStars,
    challengeTotal: challengeStatus.totalStars,
    bestEndlessWave,
    bestEndlessScore,
    bestMutatedScore,
    bestLivesRemaining,
    fastestWinSec,
    mastered:
      campaignStars >= 3 &&
      challengeStatus.totalStars > 0 &&
      challengeStatus.earnedStars >= challengeStatus.totalStars,
  };
}

/** Typed UI query: mastery status across every registered island. */
export function getAllIslandMasteryStatuses(
  save: MetaSaveData,
  levels: readonly LevelDef[] = LEVELS,
): AllIslandMastery {
  const islands: IslandMasteryStatus[] = [];
  let masteredCount = 0;
  for (let i = 0; i < levels.length; i++) {
    const status = getIslandMasteryStatus(save, i, levels);
    if (status) {
      islands.push(status);
      if (status.mastered) masteredCount++;
    }
  }
  return {
    masteredCount,
    totalIslands: islands.length,
    islands,
  };
}

const ACHIEVEMENT_CATEGORIES: readonly AchievementCategory[] = [
  'campaign',
  'combat',
  'economy',
  'mastery',
  'endless',
];

/** Typed UI query: unlocked achievement totals broken down by category. */
export function getAchievementSummary(save: MetaSaveData): AchievementSummary {
  const totals: Record<AchievementCategory, { unlocked: number; total: number }> = {
    campaign: { unlocked: 0, total: 0 },
    combat: { unlocked: 0, total: 0 },
    economy: { unlocked: 0, total: 0 },
    mastery: { unlocked: 0, total: 0 },
    endless: { unlocked: 0, total: 0 },
  };
  let unlockedCount = 0;

  for (let i = 0; i < ACHIEVEMENTS.length; i++) {
    const def = ACHIEVEMENTS[i];
    const bucket = totals[def.category];
    bucket.total++;
    if (save.unlockedAchievements[def.id] === true) {
      bucket.unlocked++;
      unlockedCount++;
    }
  }

  const byCategory: AchievementCategorySummary[] = ACHIEVEMENT_CATEGORIES.map((category) => ({
    category,
    unlocked: totals[category].unlocked,
    total: totals[category].total,
  }));

  return {
    unlockedCount,
    totalCount: ACHIEVEMENTS.length,
    completionRatio:
      ACHIEVEMENTS.length > 0 ? +(unlockedCount / ACHIEVEMENTS.length).toFixed(3) : 1,
    byCategory,
  };
}

const CAREER_RANK_TIERS: readonly { minPoints: number; title: string }[] = [
  { minPoints: 0, title: 'Sky Recruit' },
  { minPoints: 12, title: 'Cloud Warden' },
  { minPoints: 30, title: 'Gale Tactician' },
  { minPoints: 60, title: 'Bastion Commander' },
  { minPoints: 95, title: 'Tempest Marshal' },
  { minPoints: 130, title: 'Sovereign of the Skies' },
];

/** Computes the player's Archipelago Career Rank from campaign stars, challenge stars, achievements, and dailies. */
export function getMetaCareerRank(
  save: MetaSaveData,
  levels: readonly LevelDef[] = LEVELS,
): MetaCareerRank {
  let campaignStars = 0;
  for (let i = 0; i < levels.length; i++) {
    campaignStars += Math.min(3, asNonNegInt(save.campaign.bestStars[i]));
  }
  const challengeStars = getAllChallengeProgress(save, levels).earnedStars;
  let achievementsUnlocked = 0;
  for (let i = 0; i < ACHIEVEMENTS.length; i++) {
    if (save.unlockedAchievements[ACHIEVEMENTS[i].id]) achievementsUnlocked++;
  }
  const dailyBonus = Math.min(20, save.completedDailyDates.length * 2);
  const points = campaignStars + challengeStars * 2 + achievementsUnlocked * 2 + dailyBonus;

  let rankIndex = 0;
  for (let i = 0; i < CAREER_RANK_TIERS.length; i++) {
    if (points >= CAREER_RANK_TIERS[i].minPoints) {
      rankIndex = i;
    }
  }
  const currentTier = CAREER_RANK_TIERS[rankIndex];
  const nextTier = rankIndex + 1 < CAREER_RANK_TIERS.length ? CAREER_RANK_TIERS[rankIndex + 1] : null;
  const progressRatio = nextTier
    ? Math.min(1, Math.max(0, (points - currentTier.minPoints) / (nextTier.minPoints - currentTier.minPoints)))
    : 1;

  return {
    rankIndex,
    title: currentTier.title,
    points,
    nextRankTitle: nextTier ? nextTier.title : null,
    nextRankPoints: nextTier ? nextTier.minPoints : null,
    progressRatio: +progressRatio.toFixed(3),
  };
}

/** Suggests the next highest-value goal (Daily Watch, new island, challenge star, 3-star, achievement, or Endless). */
export function getRecommendedNextGoal(
  save: MetaSaveData,
  todayDateStr: string,
  levels: readonly LevelDef[] = LEVELS,
): RecommendedGoal | null {
  if (levels.length === 0) return null;

  const normalizedToday = todayDateStr.trim();
  if (isValidDateString(normalizedToday) && !save.completedDailyDates.includes(normalizedToday)) {
    const daily = generateDailyChallenge(normalizedToday, levels);
    return {
      kind: 'daily',
      title: daily.title,
      detail: `${daily.summary} (${daily.scoreMultiplier}x Score)`,
      levelIndex: daily.levelIndex,
      levelId: daily.levelId,
      dailyDate: daily.date,
    };
  }

  const maxUnlocked = Math.min(levels.length - 1, Math.max(0, save.campaign.unlockedLevelIndex));

  for (let i = 0; i <= maxUnlocked; i++) {
    if ((save.campaign.bestStars[i] ?? 0) === 0) {
      const lvl = levels[i];
      return {
        kind: 'campaign',
        title: `Secure ${lvl.name}`,
        detail: `${lvl.difficulty} · Island ${i + 1}`,
        levelIndex: i,
        levelId: lvl.id,
      };
    }
  }

  for (let i = 0; i <= maxUnlocked; i++) {
    const chStatus = getChallengeStatus(save, i, levels);
    const missing = chStatus?.challenges.find((c) => !c.completed);
    if (missing) {
      return {
        kind: 'challenge',
        title: missing.def.title,
        detail: `${levels[i].name}: ${missing.def.description}`,
        levelIndex: i,
        levelId: levels[i].id,
        challengeId: missing.def.id,
      };
    }
  }

  for (let i = 0; i <= maxUnlocked; i++) {
    if ((save.campaign.bestStars[i] ?? 0) < 3) {
      const lvl = levels[i];
      return {
        kind: 'campaign',
        title: `3-Star ${lvl.name}`,
        detail: `Finish with ${BALANCE.starThresholds.threeStarsMinLives}+ lives to master this island.`,
        levelIndex: i,
        levelId: lvl.id,
      };
    }
  }

  const achs = getAchievements(save);
  let closestAch = null as (typeof achs)[number] | null;
  for (let i = 0; i < achs.length; i++) {
    const a = achs[i];
    if (!a.unlocked && a.progressRatio >= 0.4) {
      if (!closestAch || a.progressRatio > closestAch.progressRatio) {
        closestAch = a;
      }
    }
  }
  if (closestAch) {
    return {
      kind: 'achievement',
      title: closestAch.def.name,
      detail: `${closestAch.def.description} (${closestAch.current}/${closestAch.target})`,
      achievementId: closestAch.def.id,
    };
  }

  const focusLevel = levels[maxUnlocked];
  const bestWave = Math.max(
    focusLevel.waves.length,
    save.campaign.bestEndlessWaves[maxUnlocked] ?? 0,
  );
  return {
    kind: 'endless',
    title: `Endless Watch · ${focusLevel.name}`,
    detail: `Push beyond Wave ${bestWave} with Endless Mutators.`,
    levelIndex: maxUnlocked,
    levelId: focusLevel.id,
  };
}

const KNOWN_TOWER_TYPES = new Set<string>(TOWER_TYPES);
const KNOWN_ENEMY_TYPES = new Set<string>(ENEMY_TYPES);

function getTopKey(
  record: Readonly<Record<string, number>>,
  allowedKeys?: ReadonlySet<string>,
): string | null {
  let bestKey: string | null = null;
  let bestCount = 0;
  for (const [key, count] of Object.entries(record)) {
    if (allowedKeys && !allowedKeys.has(key)) continue;
    if (
      Number.isFinite(count) &&
      (count > bestCount || (count === bestCount && count > 0 && (bestKey === null || key < bestKey)))
    ) {
      bestCount = count;
      bestKey = key;
    }
  }
  return bestKey;
}

/** Typed UI query: high-level progression & career summary across campaign, challenges, achievements, and dailies. */
export function getMetaCareerSummary(
  save: MetaSaveData,
  todayDateStr: string,
  levels: readonly LevelDef[] = LEVELS,
): MetaCareerSummary {
  const challengeProg = getAllChallengeProgress(save, levels);
  let campaignStarsEarned = 0;
  let islandsCleared = 0;
  let islandsMastered = 0;

  for (let i = 0; i < levels.length; i++) {
    const stars = save.campaign.bestStars[i] ?? 0;
    campaignStarsEarned += stars;
    if (stars > 0) islandsCleared++;
    const mastery = getIslandMasteryStatus(save, i, levels);
    if (mastery?.mastered) islandsMastered++;
  }

  let achievementsUnlocked = 0;
  for (let i = 0; i < ACHIEVEMENTS.length; i++) {
    if (save.unlockedAchievements[ACHIEVEMENTS[i].id]) {
      achievementsUnlocked++;
    }
  }

  const streaks = computeDailyStreaks(save.completedDailyDates, todayDateStr);
  const won = asNonNegInt(save.stats.gamesWon);
  const lost = asNonNegInt(save.stats.gamesLost);
  const completedOutcomes = won + lost;
  const winRatePct =
    completedOutcomes > 0 ? Math.round((won / completedOutcomes) * 100) : 0;

  return {
    campaignStarsEarned,
    campaignStarsTotal: levels.length * 3,
    challengeStarsEarned: challengeProg.earnedStars,
    challengeStarsTotal: challengeProg.totalStars,
    islandsCleared,
    islandsMastered,
    totalIslands: levels.length,
    achievementsUnlocked,
    achievementsTotal: ACHIEVEMENTS.length,
    dailyCompletedTotal: save.completedDailyDates.length,
    dailyCurrentStreak: streaks.currentStreak,
    dailyBestStreak: streaks.bestStreak,
    winRatePct,
    favoriteTowerType: getTopKey(save.stats.towersBuiltByType, KNOWN_TOWER_TYPES) as TowerType | null,
    mostDefeatedEnemyType: getTopKey(
      save.stats.enemiesDefeatedByType,
      KNOWN_ENEMY_TYPES,
    ) as EnemyType | null,
    rank: getMetaCareerRank(save, levels),
  };
}

const TOWER_MASTERY_THRESHOLDS: readonly { minBuilt: number; rank: TowerMasteryRank }[] = [
  { minBuilt: 0, rank: 'Recruit' },
  { minBuilt: 10, rank: 'Apprentice' },
  { minBuilt: 25, rank: 'Artificer' },
  { minBuilt: 60, rank: 'Grandmaster' },
];

/** Typed UI query: per-tower lifetime build counts, share percentages, and mastery tiers. */
export function getTowerMasteryStats(save: MetaSaveData): readonly TowerMasteryStat[] {
  const totalBuilt = TOWER_TYPES.reduce(
    (sum, type) => sum + asNonNegInt(save.stats.towersBuiltByType[type]),
    0,
  );
  return TOWER_TYPES.map((type) => {
    const def = TOWER_DEFS[type];
    const builtCount = asNonNegInt(save.stats.towersBuiltByType[type]);
    let tierIdx = 0;
    for (let i = 0; i < TOWER_MASTERY_THRESHOLDS.length; i++) {
      if (builtCount >= TOWER_MASTERY_THRESHOLDS[i].minBuilt) {
        tierIdx = i;
      }
    }
    const current = TOWER_MASTERY_THRESHOLDS[tierIdx];
    const next =
      tierIdx + 1 < TOWER_MASTERY_THRESHOLDS.length ? TOWER_MASTERY_THRESHOLDS[tierIdx + 1] : null;
    const progressRatio = next
      ? Math.min(1, Math.max(0, (builtCount - current.minBuilt) / (next.minBuilt - current.minBuilt)))
      : 1;
    return {
      type,
      name: def.name,
      shortDesc: def.shortDesc,
      hitsFlyers: def.hitsFlyers,
      buildCost: def.tiers[0].upgradeCost,
      builtCount,
      sharePct: totalBuilt > 0 ? Math.round((builtCount / totalBuilt) * 100) : 0,
      rank: current.rank,
      nextTarget: next ? next.minBuilt : null,
      progressRatio: +progressRatio.toFixed(3),
    };
  });
}

/** Typed UI query: per-enemy bestiary/intel status derived from lifetime defeats. */
export function getEnemyIntelStats(save: MetaSaveData): readonly EnemyIntelEntry[] {
  return ENEMY_TYPES.map((type) => {
    const def = ENEMY_DEFS[type];
    const defeatedCount = asNonNegInt(save.stats.enemiesDefeatedByType[type]);
    return {
      type,
      name: def.name,
      description: def.description,
      defeatedCount,
      discovered: defeatedCount > 0,
      maxHp: def.maxHp,
      speed: def.speed,
      flying: def.flying,
      armor: def.armor,
      reward: def.reward,
      livesCost: def.livesCost,
    };
  });
}

/** Typed UI query: recent Daily Watch history entries with completion & personal-best score status. */
export function getRecentDailyHistory(
  save: MetaSaveData,
  todayDateStr: string,
  days = 7,
  endDateStr: string = todayDateStr,
  levels: readonly LevelDef[] = LEVELS,
): readonly DailyHistoryEntry[] {
  const completedSet = new Set(save.completedDailyDates);
  const normalizedToday = todayDateStr.trim();
  return getRecentDailySpecs(endDateStr, days, levels).map((spec) => ({
    spec,
    completed: completedSet.has(spec.date),
    bestScore: save.dailyBestScores[spec.date] ?? 0,
    isToday: spec.date === normalizedToday,
  }));
}

function mergeMaxCountRecords(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(a)) {
    if (Number.isFinite(v) && v > 0) out[k] = v;
  }
  for (const [k, v] of Object.entries(b)) {
    if (Number.isFinite(v) && v > (out[k] ?? 0)) out[k] = v;
  }
  return out;
}

function mergeMinPositiveRecords(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(a)) {
    if (Number.isFinite(v) && v > 0) out[k] = v;
  }
  for (const [k, v] of Object.entries(b)) {
    if (Number.isFinite(v) && v > 0 && (out[k] === undefined || v < out[k])) {
      out[k] = v;
    }
  }
  return out;
}

function maxFiniteNonNeg(a: number, b: number): number {
  const va = typeof a === 'number' && Number.isFinite(a) && a > 0 ? a : 0;
  const vb = typeof b === 'number' && Number.isFinite(b) && b > 0 ? b : 0;
  return Math.max(va, vb);
}

/** Monotonically merges two MetaSaveData objects, preserving highest stars, records, and unlocks. */
export function mergeMetaSaves(
  base: MetaSaveData,
  incoming: MetaSaveData,
  levelCount: number,
  levels: readonly LevelDef[] = LEVELS,
): MetaSaveData {
  const completedChallenges: Record<string, boolean> = { ...base.completedChallenges };
  for (const [k, v] of Object.entries(incoming.completedChallenges)) {
    if (v) completedChallenges[k] = true;
  }
  const unlockedAchievements: Record<string, boolean> = { ...base.unlockedAchievements };
  for (const [k, v] of Object.entries(incoming.unlockedAchievements)) {
    if (v) unlockedAchievements[k] = true;
  }
  const completedDailyDates = [
    ...new Set([...base.completedDailyDates, ...incoming.completedDailyDates]),
  ].sort();

  const merged: MetaSaveData = {
    version: META_SAVE_VERSION,
    campaign: mergeCampaignProgress(base.campaign, incoming.campaign, levelCount),
    completedChallenges,
    unlockedAchievements,
    achievementMilestones: {
      wonNoLivesLost:
        base.achievementMilestones.wonNoLivesLost || incoming.achievementMilestones.wonNoLivesLost,
      wonAt3xSpeed:
        base.achievementMilestones.wonAt3xSpeed || incoming.achievementMilestones.wonAt3xSpeed,
      wonMax6Towers:
        base.achievementMilestones.wonMax6Towers || incoming.achievementMilestones.wonMax6Towers,
      bestMutatedEndlessWavesCleared: maxFiniteNonNeg(
        base.achievementMilestones.bestMutatedEndlessWavesCleared,
        incoming.achievementMilestones.bestMutatedEndlessWavesCleared,
      ),
    },
    stats: {
      totalPlayTimeSec: maxFiniteNonNeg(
        base.stats.totalPlayTimeSec,
        incoming.stats.totalPlayTimeSec,
      ),
      gamesPlayed: maxFiniteNonNeg(base.stats.gamesPlayed, incoming.stats.gamesPlayed),
      gamesWon: maxFiniteNonNeg(base.stats.gamesWon, incoming.stats.gamesWon),
      gamesLost: maxFiniteNonNeg(base.stats.gamesLost, incoming.stats.gamesLost),
      wavesCleared: maxFiniteNonNeg(base.stats.wavesCleared, incoming.stats.wavesCleared),
      earlyWavesCalled: maxFiniteNonNeg(
        base.stats.earlyWavesCalled,
        incoming.stats.earlyWavesCalled,
      ),
      enemiesDefeatedTotal: maxFiniteNonNeg(
        base.stats.enemiesDefeatedTotal,
        incoming.stats.enemiesDefeatedTotal,
      ),
      enemiesDefeatedByType: mergeMaxCountRecords(
        base.stats.enemiesDefeatedByType,
        incoming.stats.enemiesDefeatedByType,
      ),
      flyingEnemiesDefeated: maxFiniteNonNeg(
        base.stats.flyingEnemiesDefeated,
        incoming.stats.flyingEnemiesDefeated,
      ),
      towersBuiltTotal: maxFiniteNonNeg(
        base.stats.towersBuiltTotal,
        incoming.stats.towersBuiltTotal,
      ),
      towersBuiltByType: mergeMaxCountRecords(
        base.stats.towersBuiltByType,
        incoming.stats.towersBuiltByType,
      ),
      towersUpgradedToTier3: maxFiniteNonNeg(
        base.stats.towersUpgradedToTier3,
        incoming.stats.towersUpgradedToTier3,
      ),
      towersUpgradedTotal: maxFiniteNonNeg(
        base.stats.towersUpgradedTotal,
        incoming.stats.towersUpgradedTotal,
      ),
      towersSoldTotal: maxFiniteNonNeg(base.stats.towersSoldTotal, incoming.stats.towersSoldTotal),
      goldEarnedTotal: maxFiniteNonNeg(base.stats.goldEarnedTotal, incoming.stats.goldEarnedTotal),
      goldSpentTotal: maxFiniteNonNeg(base.stats.goldSpentTotal, incoming.stats.goldSpentTotal),
      abilitiesCastTotal: maxFiniteNonNeg(
        base.stats.abilitiesCastTotal,
        incoming.stats.abilitiesCastTotal,
      ),
      meteorsCast: maxFiniteNonNeg(base.stats.meteorsCast, incoming.stats.meteorsCast),
      overchargesCast: maxFiniteNonNeg(base.stats.overchargesCast, incoming.stats.overchargesCast),
      towersCleansed: maxFiniteNonNeg(base.stats.towersCleansed, incoming.stats.towersCleansed),
      perfectClears: maxFiniteNonNeg(base.stats.perfectClears, incoming.stats.perfectClears),
      bestEndlessWaveOverall: maxFiniteNonNeg(
        base.stats.bestEndlessWaveOverall,
        incoming.stats.bestEndlessWaveOverall,
      ),
      bestEndlessScoreOverall: maxFiniteNonNeg(
        base.stats.bestEndlessScoreOverall,
        incoming.stats.bestEndlessScoreOverall,
      ),
      dailyChallengesCompleted: Math.max(
        maxFiniteNonNeg(base.stats.dailyChallengesCompleted, incoming.stats.dailyChallengesCompleted),
        completedDailyDates.length,
      ),
    },
    bestEndlessScoresByLevelId: mergeMaxCountRecords(
      base.bestEndlessScoresByLevelId,
      incoming.bestEndlessScoresByLevelId,
    ),
    bestMutatedScoresByLevelId: mergeMaxCountRecords(
      base.bestMutatedScoresByLevelId,
      incoming.bestMutatedScoresByLevelId,
    ),
    bestLivesByLevelId: mergeMaxCountRecords(base.bestLivesByLevelId, incoming.bestLivesByLevelId),
    fastestWinSecByLevelId: mergeMinPositiveRecords(
      base.fastestWinSecByLevelId,
      incoming.fastestWinSecByLevelId,
    ),
    completedDailyDates,
    dailyBestScores: mergeMaxCountRecords(base.dailyBestScores, incoming.dailyBestScores),
  };

  return migrateToMetaSave(merged, null, levelCount, levels);
}

/** Serializes a MetaSaveData snapshot to portable JSON for user backup. */
export function exportMetaSaveJson(save: MetaSaveData): string {
  return JSON.stringify(save);
}

/**
 * Validates and parses an exported Skyhold Isles v1 or v2 JSON save string.
 * Rejects malformed or unrelated JSON without mutating existing progress.
 */
export function importMetaSaveJson(
  rawJson: string,
  currentSave: MetaSaveData | null,
  levelCount: number,
  levels: readonly LevelDef[] = LEVELS,
  mode: 'merge' | 'replace' = 'merge',
): { ok: true; save: MetaSaveData } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: 'Invalid JSON syntax.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Save payload must be a JSON object.' };
  }

  const obj = parsed as Record<string, unknown>;
  const campaignObj =
    obj.campaign && typeof obj.campaign === 'object' && !Array.isArray(obj.campaign)
      ? (obj.campaign as Record<string, unknown>)
      : null;
  const isValidV2 =
    obj.version === META_SAVE_VERSION &&
    campaignObj !== null &&
    Array.isArray(campaignObj.bestStars);
  const isValidV1 = obj.version === undefined && Array.isArray(obj.bestStars);

  if (!isValidV2 && !isValidV1) {
    return { ok: false, error: 'Unrecognized Skyhold Isles save format.' };
  }

  const imported = isValidV2
    ? migrateToMetaSave(obj, null, levelCount, levels)
    : migrateToMetaSave(null, obj, levelCount, levels);

  if (mode === 'replace' || !currentSave) {
    return { ok: true, save: imported };
  }
  return { ok: true, save: mergeMetaSaves(currentSave, imported, levelCount, levels) };
}
