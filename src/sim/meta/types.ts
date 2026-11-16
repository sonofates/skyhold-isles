import type { EnemyType, ProgressData, SpeedMultiplier, TowerType } from '../../core/types.ts';

/** Optional gameplay modifiers applied to a SimWorld run (endless mutators / daily challenges). */
export interface RunModifiers {
  readonly enemySpeedMultiplier?: number;
  readonly enemyHpMultiplier?: number;
  readonly enemyArmorBonus?: number;
  readonly flyerCountMultiplier?: number;
  readonly goldRewardMultiplier?: number;
  readonly startingGoldMultiplier?: number;
  readonly towerCostMultiplier?: number;
  readonly allowedTowerTypes?: readonly TowerType[] | null;
  readonly forbiddenTowerTypes?: readonly TowerType[];
  readonly activeMutatorIds?: readonly string[];
  readonly scoreMultiplier?: number;
}

/** Normalized RunModifiers with concrete defaults for zero-overhead sim checks. */
export interface ResolvedRunModifiers {
  readonly enemySpeedMultiplier: number;
  readonly enemyHpMultiplier: number;
  readonly enemyArmorBonus: number;
  readonly flyerCountMultiplier: number;
  readonly goldRewardMultiplier: number;
  readonly startingGoldMultiplier: number;
  readonly towerCostMultiplier: number;
  readonly allowedTowerTypes: readonly TowerType[] | null;
  readonly forbiddenTowerTypes: readonly TowerType[];
  readonly activeMutatorIds: readonly string[];
  readonly scoreMultiplier: number;
}

export type ChallengeCondition =
  | { readonly kind: 'noLivesLost' }
  | { readonly kind: 'minLivesRemaining'; readonly minLives: number }
  | { readonly kind: 'forbiddenTowerTypes'; readonly forbidden: readonly TowerType[] }
  | { readonly kind: 'allowedTowerTypes'; readonly allowed: readonly TowerType[] }
  | { readonly kind: 'maxTowersBuilt'; readonly maxCount: number }
  | { readonly kind: 'maxPeakTowers'; readonly maxCount: number }
  | { readonly kind: 'maxTowerTier'; readonly maxTier: 1 | 2 }
  | { readonly kind: 'maxGoldSpent'; readonly maxGold: number }
  | { readonly kind: 'noAbilities' }
  | { readonly kind: 'noTowerSelling' }
  | { readonly kind: 'combatSpeedOnly'; readonly requiredSpeed: SpeedMultiplier }
  | { readonly kind: 'minEarlyWaves'; readonly minCount: number };

export interface ChallengeDef {
  readonly id: string;
  readonly levelId: string;
  readonly title: string;
  readonly description: string;
  readonly condition: ChallengeCondition;
}

export interface ChallengeItemStatus {
  readonly def: ChallengeDef;
  readonly completed: boolean;
}

export type LiveChallengeState = 'on_track' | 'failed' | 'completed';

export interface LiveChallengeStatus {
  readonly def: ChallengeDef;
  readonly state: LiveChallengeState;
  readonly previouslyCompleted: boolean;
  readonly progressLabel: string;
}

export interface LevelChallengeStatus {
  readonly levelId: string;
  readonly levelIndex: number;
  readonly levelName: string;
  readonly earnedStars: number;
  readonly totalStars: number;
  readonly challenges: readonly ChallengeItemStatus[];
}

export interface AllChallengeProgress {
  readonly earnedStars: number;
  readonly totalStars: number;
  readonly byLevel: readonly LevelChallengeStatus[];
}

export interface ModifierBadgeInfo {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

/** Live run metrics observed purely via EventBus and tick/speed hooks. */
export interface RunTelemetry {
  readonly levelId: string;
  readonly levelIndex: number;
  readonly storyWaveCount: number;
  readonly simTimeSec: number;
  readonly towersBuilt: number;
  readonly activeTowers: number;
  readonly peakTowersActive: number;
  readonly towersBuiltByType: Record<string, number>;
  readonly towersUpgraded: number;
  readonly towersUpgradedToTier3: number;
  readonly maxTowerTierBuilt: number;
  readonly towersSold: number;
  readonly grossGoldSpent: number;
  readonly netGoldSpent: number;
  readonly goldEarned: number;
  readonly enemiesKilledTotal: number;
  readonly endlessEnemiesKilled: number;
  readonly enemiesKilledByType: Record<string, number>;
  readonly flyingEnemiesKilled: number;
  readonly livesLost: number;
  readonly earlyWavesCalled: number;
  readonly abilitiesCastTotal: number;
  readonly meteorsCast: number;
  readonly overchargesCast: number;
  readonly towersCleansed: number;
  readonly wavesCompleted: number;
  readonly storyWavesCompleted: number;
  readonly endlessWavesCompleted: number;
  readonly endlessEntered: boolean;
  readonly maxWaveReached: number;
  readonly currentSpeed: SpeedMultiplier;
  readonly minCombatSpeed: SpeedMultiplier | null;
  readonly activeMutatorIds: readonly string[];
  readonly eligibleForChallenges: boolean;
}

export interface LifetimeStats {
  totalPlayTimeSec: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  wavesCleared: number;
  earlyWavesCalled: number;
  enemiesDefeatedTotal: number;
  enemiesDefeatedByType: Record<string, number>;
  flyingEnemiesDefeated: number;
  towersBuiltTotal: number;
  towersBuiltByType: Record<string, number>;
  towersUpgradedToTier3: number;
  towersUpgradedTotal: number;
  towersSoldTotal: number;
  goldEarnedTotal: number;
  goldSpentTotal: number;
  abilitiesCastTotal: number;
  meteorsCast: number;
  overchargesCast: number;
  towersCleansed: number;
  perfectClears: number;
  bestEndlessWaveOverall: number;
  bestEndlessScoreOverall: number;
  dailyChallengesCompleted: number;
}

export type AchievementCategory = 'campaign' | 'combat' | 'economy' | 'mastery' | 'endless';

export interface AchievementDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: AchievementCategory;
  readonly target: number;
}

export interface AchievementStatus {
  readonly def: AchievementDef;
  readonly unlocked: boolean;
  readonly current: number;
  readonly target: number;
  readonly progressRatio: number;
}

export interface MutatorDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly scoreMultiplierBonus: number;
  readonly conflictGroup?: string;
  readonly modifiers: RunModifiers;
}

export interface MutatorPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly mutatorIds: readonly string[];
}

export interface IslandMasteryStatus {
  readonly levelId: string;
  readonly levelIndex: number;
  readonly levelName: string;
  readonly campaignStars: number;
  readonly challengeStars: number;
  readonly challengeTotal: number;
  readonly bestEndlessWave: number;
  readonly bestEndlessScore: number;
  readonly bestLivesRemaining: number;
  readonly fastestWinSec: number | null;
  readonly mastered: boolean;
}

export interface MetaCareerRank {
  readonly rankIndex: number;
  readonly title: string;
  readonly points: number;
  readonly nextRankTitle: string | null;
  readonly nextRankPoints: number | null;
  readonly progressRatio: number;
}

export type RecommendedGoalKind = 'daily' | 'campaign' | 'challenge' | 'achievement' | 'endless';

export interface RecommendedGoal {
  readonly kind: RecommendedGoalKind;
  readonly title: string;
  readonly detail: string;
  readonly levelIndex?: number;
  readonly levelId?: string;
  readonly challengeId?: string;
  readonly achievementId?: string;
  readonly dailyDate?: string;
}

export interface MetaCareerSummary {
  readonly campaignStarsEarned: number;
  readonly campaignStarsTotal: number;
  readonly challengeStarsEarned: number;
  readonly challengeStarsTotal: number;
  readonly islandsCleared: number;
  readonly islandsMastered: number;
  readonly totalIslands: number;
  readonly achievementsUnlocked: number;
  readonly achievementsTotal: number;
  readonly dailyCompletedTotal: number;
  readonly dailyCurrentStreak: number;
  readonly dailyBestStreak: number;
  readonly winRatePct: number;
  readonly favoriteTowerType: TowerType | null;
  readonly mostDefeatedEnemyType: EnemyType | null;
  readonly rank: MetaCareerRank;
}

export interface EndlessMutatorRoll {
  readonly seed: number;
  readonly mutators: readonly MutatorDef[];
  readonly modifiers: ResolvedRunModifiers;
  readonly scoreMultiplier: number;
}

export interface EndlessScoreBreakdown {
  readonly baseScore: number;
  readonly scoreMultiplier: number;
  readonly totalScore: number;
}

export interface DailyTowerRestriction {
  readonly kind: 'none' | 'ban_one' | 'limited_arsenal';
  readonly label: string;
  readonly allowedTowerTypes: readonly TowerType[] | null;
  readonly forbiddenTowerTypes: readonly TowerType[];
}

export interface DailyChallengeSpec {
  readonly date: string;
  readonly seed: number;
  readonly levelIndex: number;
  readonly levelId: string;
  readonly levelName: string;
  readonly mutators: readonly MutatorDef[];
  readonly towerRestriction: DailyTowerRestriction;
  readonly modifiers: ResolvedRunModifiers;
  readonly scoreMultiplier: number;
  readonly title: string;
  readonly summary: string;
}

export interface DailyStatus {
  readonly spec: DailyChallengeSpec;
  readonly completedToday: boolean;
  readonly bestScoreToday: number;
  readonly totalDailyCompleted: number;
  readonly currentStreak: number;
  readonly bestStreak: number;
}

export interface RunMetaOutcome {
  readonly won: boolean;
  readonly isDaily: boolean;
  readonly newlyCompletedChallengeIds: readonly string[];
  readonly newlyUnlockedAchievementIds: readonly string[];
  readonly endlessScore: EndlessScoreBreakdown | null;
  readonly dailyScore: number | null;
  readonly isNewFastestWin: boolean;
  readonly isNewBestEndlessWave: boolean;
  readonly isNewBestEndlessScore: boolean;
  readonly isNewBestDailyScore: boolean;
}

/** Versioned persisted meta save format (v2), backward-compatible with v1 ProgressData. */
export interface MetaSaveData {
  version: 2;
  campaign: ProgressData;
  completedChallenges: Record<string, boolean>;
  unlockedAchievements: Record<string, boolean>;
  /** Extra sticky flags for single-run achievements not directly inferable from cumulative totals. */
  achievementMilestones: {
    wonNoLivesLost: boolean;
    wonAt3xSpeed: boolean;
    wonMax6Towers: boolean;
    bestMutatedEndlessWavesCleared: number;
  };
  stats: LifetimeStats;
  bestEndlessScoresByLevelId: Record<string, number>;
  bestLivesByLevelId: Record<string, number>;
  fastestWinSecByLevelId: Record<string, number>;
  completedDailyDates: string[];
  dailyBestScores: Record<string, number>;
}
