import type { EventBus } from '../core/eventBus.ts';
import type { ProgressData, SpeedMultiplier, TowerType } from '../core/types.ts';
import { ENDLESS_MUTATORS, ENDLESS_MUTATOR_PRESETS } from '../data/challenges.ts';
import { LEVELS } from '../data/levels/index.ts';
import type { LevelDef } from '../data/levels/types.ts';
import { TOWER_TYPES } from '../data/towers.ts';
import {
  computeDailyStreaks,
  generateDailyChallenge,
  getRecentDailySpecs,
  isValidDateString,
} from '../sim/meta/daily.ts';
import {
  applyTelemetryDeltaToStats,
  exportMetaSaveJson,
  getAchievementById,
  getAchievements,
  getAchievementSummary,
  getAllChallengeProgress,
  getAllIslandMasteryStatuses,
  getChallengeStatus,
  getIslandMasteryStatus,
  getMetaCareerRank,
  getMetaCareerSummary,
  getRecentDailyHistory,
  getRecommendedNextGoal,
  getStats,
  importMetaSaveJson,
  recomputeAchievements,
  recordEndlessRunStats,
  recordRunCompletion,
  resolveAchievementDefs,
  resolveChallengeDef,
} from '../sim/meta/metaEngine.ts';
import {
  describeActiveModifiers,
  getAllowedTowerTypes,
  isTowerTypeAllowed,
} from '../sim/meta/modifiers.ts';
import {
  buildEndlessMutatorLoadout,
  computeEndlessScore,
  getMutatorPresetRoll,
  resolveMutatorSelection,
  selectEndlessMutators,
  type MutatorSelectionInput,
} from '../sim/meta/mutators.ts';
import { evaluateLiveLevelChallenges, RunObserver } from '../sim/meta/runObserver.ts';
import type {
  AchievementDef,
  AchievementStatus,
  AchievementSummary,
  AllChallengeProgress,
  AllIslandMastery,
  ChallengeDef,
  DailyChallengeSpec,
  DailyHistoryEntry,
  DailyStatus,
  EndlessMutatorRoll,
  EndlessScoreBreakdown,
  IslandMasteryStatus,
  LevelChallengeStatus,
  LifetimeStats,
  LiveChallengeStatus,
  MetaCareerRank,
  MetaCareerSummary,
  MetaSaveData,
  ModifierBadgeInfo,
  MutatorDef,
  MutatorPreset,
  RecommendedGoal,
  ResolvedRunModifiers,
  RunMetaOutcome,
  RunModifiers,
  RunTelemetry,
} from '../sim/meta/types.ts';
import { getTodayUtcDateString, loadMetaSave, saveMetaSave } from './storage.ts';

export interface MetaSessionOptions {
  readonly levels?: readonly LevelDef[];
  readonly saveData?: MetaSaveData;
  readonly onSave?: (save: MetaSaveData, overwriteV1?: boolean) => void;
  readonly getTodayDate?: () => string;
}

/**
 * Platform-layer coordinator connecting RunObserver, versioned save storage,
 * and typed meta queries for the UI (challenges, achievements, stats, endless mutators, daily).
 */
export class MetaSession {
  private readonly levels: readonly LevelDef[];
  private readonly save: MetaSaveData;
  private readonly persistFn: (save: MetaSaveData, overwriteV1?: boolean) => void;
  private readonly getTodayDateFn: () => string;

  private observer: RunObserver | null = null;
  private committedTelemetry: RunTelemetry | null = null;
  private unsubs: Array<() => void> = [];
  private countedGamePlayed = false;
  private activeDailyDate: string | null = null;
  private lastRunOutcome: RunMetaOutcome | null = null;
  private runUnlockedAchievementIds: string[] = [];
  private runStartBestEndlessWave = 0;
  private runStartBestEndlessScore = 0;

  constructor(options?: MetaSessionOptions) {
    this.levels = options?.levels ?? LEVELS;
    this.persistFn = options?.onSave ?? saveMetaSave;
    this.getTodayDateFn = options?.getTodayDate ?? getTodayUtcDateString;
    this.save = options?.saveData ?? loadMetaSave(this.levels.length, this.levels);
  }

  getCampaignProgress(): ProgressData {
    return this.save.campaign;
  }

  getSaveSnapshot(): MetaSaveData {
    return this.save;
  }

  startRun(
    level: LevelDef,
    events: EventBus,
    options?: {
      modifiers?: RunModifiers | null;
      dailyDate?: string | null;
      speed?: SpeedMultiplier;
    },
  ): void {
    this.endRun();

    const observer = new RunObserver(level, events, options?.modifiers);
    if (options?.speed) {
      observer.recordSpeed(options.speed);
    }
    this.observer = observer;
    this.committedTelemetry = null;
    this.countedGamePlayed = false;
    this.activeDailyDate =
      options?.dailyDate && isValidDateString(options.dailyDate)
        ? options.dailyDate.trim()
        : null;
    this.lastRunOutcome = null;
    this.runUnlockedAchievementIds = [];
    this.runStartBestEndlessWave = this.save.campaign.bestEndlessWaves[level.index] ?? 0;
    this.runStartBestEndlessScore = this.save.bestEndlessScoresByLevelId[level.id] ?? 0;

    this.unsubs.push(
      events.on('waveStarted', () => {
        if (!this.countedGamePlayed && observer.isEligibleForChallenges()) {
          this.countedGamePlayed = true;
          this.save.stats.gamesPlayed++;
        }
      }),
      events.on('waveCompleted', () => {
        this.flushStats();
      }),
      events.on('endlessEntered', () => {
        this.flushStats();
      }),
      events.on('gameWon', (ev) => {
        if (observer.getTelemetry().endlessEntered) return;
        this.flushStats(false);
        const telemetry = observer.getTelemetry();
        const outcome = recordRunCompletion(this.save, {
          level,
          telemetry,
          won: true,
          stars: ev.stars,
          livesRemaining: ev.livesRemaining,
          levels: this.levels,
          dailyDate: this.activeDailyDate,
          scoreMultiplier: observer.getModifiers().scoreMultiplier,
          previousBestEndlessWave: this.runStartBestEndlessWave,
          previousBestEndlessScore: this.runStartBestEndlessScore,
        });
        this.collectRunAchievements(outcome.newlyUnlockedAchievementIds);
        const unlockedIds = [...this.runUnlockedAchievementIds];
        this.lastRunOutcome = {
          ...outcome,
          newlyUnlockedAchievementIds: unlockedIds,
          newlyUnlockedAchievements: resolveAchievementDefs(unlockedIds),
        };
        this.runUnlockedAchievementIds = [];
        this.persist();
      }),
      events.on('gameLost', () => {
        this.flushStats(false);
        const telemetry = observer.getTelemetry();
        const outcome = recordRunCompletion(this.save, {
          level,
          telemetry,
          won: false,
          stars: 0,
          livesRemaining: 0,
          levels: this.levels,
          dailyDate: this.activeDailyDate,
          scoreMultiplier: observer.getModifiers().scoreMultiplier,
          previousBestEndlessWave: this.runStartBestEndlessWave,
          previousBestEndlessScore: this.runStartBestEndlessScore,
        });
        this.collectRunAchievements(outcome.newlyUnlockedAchievementIds);
        const unlockedIds = [...this.runUnlockedAchievementIds];
        this.lastRunOutcome = {
          ...outcome,
          newlyUnlockedAchievementIds: unlockedIds,
          newlyUnlockedAchievements: resolveAchievementDefs(unlockedIds),
        };
        this.runUnlockedAchievementIds = [];
        this.persist();
      }),
    );
  }

  onEndlessEntered(modifiers?: RunModifiers | null): void {
    if (!this.observer) return;
    this.runStartBestEndlessWave = this.save.campaign.bestEndlessWaves[this.observer.level.index] ?? 0;
    this.runStartBestEndlessScore =
      this.save.bestEndlessScoresByLevelId[this.observer.level.id] ?? 0;
    if (modifiers !== undefined) {
      this.observer.setModifiers(modifiers);
    }
    this.flushStats();
  }

  onTick(dt: number, speed: SpeedMultiplier): void {
    this.observer?.onTick(dt, speed);
  }

  onSpeedChanged(speed: SpeedMultiplier): void {
    this.observer?.recordSpeed(speed);
  }

  private collectRunAchievements(ids: readonly string[]): void {
    for (let i = 0; i < ids.length; i++) {
      if (!this.runUnlockedAchievementIds.includes(ids[i])) {
        this.runUnlockedAchievementIds.push(ids[i]);
      }
    }
  }

  markDebugTainted(): void {
    this.observer?.markDebugTainted();
  }

  isCurrentRunEligible(): boolean {
    return this.observer ? this.observer.isEligibleForChallenges() : true;
  }

  verifyWorldIntegrity(actualGold: number, actualLives: number): boolean {
    if (!this.observer) return true;
    return this.observer.verifyEconomyIntegrity(actualGold, actualLives);
  }

  flushStats(persistAfter = true): void {
    if (!this.observer) return;
    const current = this.observer.getTelemetry();
    applyTelemetryDeltaToStats(this.save, current, this.committedTelemetry);
    if (current.eligibleForChallenges) {
      this.committedTelemetry = current;
    }

    if (current.endlessEntered) {
      recordEndlessRunStats(
        this.save,
        this.observer.level,
        current,
        this.observer.getModifiers().scoreMultiplier,
      );
    }

    this.collectRunAchievements(recomputeAchievements(this.save, this.levels));
    if (persistAfter) {
      this.persist();
    }
  }

  endRun(): void {
    if (this.observer) {
      this.flushStats();
      this.observer.dispose();
      this.observer = null;
    }
    this.committedTelemetry = null;
    this.countedGamePlayed = false;
    this.activeDailyDate = null;
    this.runUnlockedAchievementIds = [];
    this.runStartBestEndlessWave = 0;
    this.runStartBestEndlessScore = 0;
    for (let i = 0; i < this.unsubs.length; i++) {
      this.unsubs[i]();
    }
    this.unsubs.length = 0;
  }

  private persist(overwriteV1 = false): void {
    this.persistFn(this.save, overwriteV1);
  }

  dispose(): void {
    this.endRun();
  }

  // --- Typed UI API ---

  getChallengeStatus(levelIndex: number): LevelChallengeStatus | null {
    return getChallengeStatus(this.save, levelIndex, this.levels);
  }

  getAllChallengeProgress(): AllChallengeProgress {
    return getAllChallengeProgress(this.save, this.levels);
  }

  getAchievements(): readonly AchievementStatus[] {
    return getAchievements(this.save);
  }

  getAchievementSummary(): AchievementSummary {
    return getAchievementSummary(this.save);
  }

  getStats(): LifetimeStats {
    return getStats(this.save);
  }

  getDailyChallenge(dateStr?: string): DailyChallengeSpec {
    return generateDailyChallenge(dateStr ?? this.getTodayDateFn(), this.levels);
  }

  getDailyStatus(dateStr?: string): DailyStatus {
    const date = dateStr ?? this.getTodayDateFn();
    const spec = generateDailyChallenge(date, this.levels);
    const { currentStreak, bestStreak } = computeDailyStreaks(
      this.save.completedDailyDates,
      spec.date,
    );
    return {
      spec,
      completedToday: this.save.completedDailyDates.includes(spec.date),
      bestScoreToday: this.save.dailyBestScores[spec.date] ?? 0,
      totalDailyCompleted: this.save.completedDailyDates.length,
      currentStreak,
      bestStreak,
    };
  }

  getLiveChallengeStates(
    livesRemaining: number,
    outcome: 'ongoing' | 'won' | 'lost' = 'ongoing',
  ): readonly LiveChallengeStatus[] {
    if (!this.observer || this.activeDailyDate !== null) return [];
    const storySnapshot = this.observer.getStoryWinSnapshot();
    if (storySnapshot) {
      return evaluateLiveLevelChallenges(
        this.observer.level,
        storySnapshot.telemetry,
        storySnapshot.livesRemaining,
        'won',
        this.save.completedChallenges,
      );
    }
    return evaluateLiveLevelChallenges(
      this.observer.level,
      this.observer.getTelemetry(),
      livesRemaining,
      outcome,
      this.save.completedChallenges,
    );
  }

  getActiveDailyChallenge(): DailyChallengeSpec | null {
    if (!this.activeDailyDate) return null;
    return generateDailyChallenge(this.activeDailyDate, this.levels);
  }

  getActiveModifierBadges(): readonly ModifierBadgeInfo[] {
    if (!this.observer) return [];
    return describeActiveModifiers(this.observer.getModifiers());
  }

  getAllowedTowerTypes(): readonly TowerType[] {
    if (!this.observer) return TOWER_TYPES;
    return getAllowedTowerTypes(this.observer.getModifiers());
  }

  isTowerAllowed(type: TowerType): boolean {
    if (!this.observer) return true;
    return isTowerTypeAllowed(type, this.observer.getModifiers());
  }

  rollEndlessMutators(seed?: number | string, count = 2): EndlessMutatorRoll {
    const resolvedSeed = seed ?? this.getTodayDateFn();
    return selectEndlessMutators(resolvedSeed, count);
  }

  getEndlessMutators(): readonly MutatorDef[] {
    return ENDLESS_MUTATORS;
  }

  getEndlessMutatorPresets(): readonly MutatorPreset[] {
    return ENDLESS_MUTATOR_PRESETS;
  }

  buildEndlessMutatorLoadout(mutatorIds: readonly string[]): EndlessMutatorRoll {
    return buildEndlessMutatorLoadout(mutatorIds);
  }

  getMutatorPresetRoll(presetId: string): EndlessMutatorRoll | null {
    return getMutatorPresetRoll(presetId);
  }

  getIslandMasteryStatus(levelIndex: number): IslandMasteryStatus | null {
    return getIslandMasteryStatus(this.save, levelIndex, this.levels);
  }

  getAllIslandMasteryStatuses(): AllIslandMastery {
    return getAllIslandMasteryStatuses(this.save, this.levels);
  }

  getMetaCareerRank(): MetaCareerRank {
    return getMetaCareerRank(this.save, this.levels);
  }

  getMetaCareerSummary(dateStr?: string): MetaCareerSummary {
    return getMetaCareerSummary(this.save, dateStr ?? this.getTodayDateFn(), this.levels);
  }

  getRecommendedNextGoal(dateStr?: string): RecommendedGoal | null {
    return getRecommendedNextGoal(this.save, dateStr ?? this.getTodayDateFn(), this.levels);
  }

  getRecentDailyChallenges(days = 7, endDateStr?: string): readonly DailyChallengeSpec[] {
    return getRecentDailySpecs(endDateStr ?? this.getTodayDateFn(), days, this.levels);
  }

  getRecentDailyHistory(days = 7, endDateStr?: string): readonly DailyHistoryEntry[] {
    const today = this.getTodayDateFn();
    return getRecentDailyHistory(this.save, today, days, endDateStr ?? today, this.levels);
  }

  getChallengeDef(challengeId: string): ChallengeDef | null {
    return resolveChallengeDef(challengeId, this.levels);
  }

  getAchievementDef(achievementId: string): AchievementDef | null {
    return getAchievementById(achievementId);
  }

  getTodayDailyDate(): string {
    return this.getTodayDateFn();
  }

  resolveMutatorSelection(input: MutatorSelectionInput): ResolvedRunModifiers {
    return resolveMutatorSelection(input);
  }

  getActiveRunModifiers(): ResolvedRunModifiers | null {
    return this.observer ? this.observer.getModifiers() : null;
  }

  getLiveRunTelemetry(): RunTelemetry | null {
    return this.observer ? this.observer.getTelemetry() : null;
  }

  getLiveEndlessScore(): EndlessScoreBreakdown | null {
    if (!this.observer) return null;
    const t = this.observer.getTelemetry();
    if (!t.endlessEntered) return null;
    return computeEndlessScore(
      t.endlessWavesCompleted,
      t.endlessEnemiesKilled,
      this.observer.getModifiers().scoreMultiplier,
    );
  }

  getActiveDailyDate(): string | null {
    return this.activeDailyDate;
  }

  getLastRunOutcome(): RunMetaOutcome | null {
    return this.lastRunOutcome;
  }

  exportSaveJson(): string {
    return exportMetaSaveJson(this.save);
  }

  importSaveJson(
    rawJson: string,
    mode: 'merge' | 'replace' = 'merge',
  ): { ok: true } | { ok: false; error: string } {
    const res = importMetaSaveJson(
      rawJson,
      this.save,
      this.levels.length,
      this.levels,
      mode,
    );
    if (!res.ok) return res;

    const next = res.save;
    // Preserve campaign object/array references held by GameSession.progress
    this.save.campaign.unlockedLevelIndex = next.campaign.unlockedLevelIndex;
    this.save.campaign.bestStars.splice(
      0,
      this.save.campaign.bestStars.length,
      ...next.campaign.bestStars,
    );
    this.save.campaign.bestEndlessWaves.splice(
      0,
      this.save.campaign.bestEndlessWaves.length,
      ...next.campaign.bestEndlessWaves,
    );
    this.save.completedChallenges = next.completedChallenges;
    this.save.unlockedAchievements = next.unlockedAchievements;
    this.save.achievementMilestones = next.achievementMilestones;
    this.save.stats = next.stats;
    this.save.bestEndlessScoresByLevelId = next.bestEndlessScoresByLevelId;
    this.save.bestMutatedScoresByLevelId = next.bestMutatedScoresByLevelId;
    this.save.bestLivesByLevelId = next.bestLivesByLevelId;
    this.save.fastestWinSecByLevelId = next.fastestWinSecByLevelId;
    this.save.completedDailyDates = next.completedDailyDates;
    this.save.dailyBestScores = next.dailyBestScores;

    if (this.observer) {
      this.runStartBestEndlessWave =
        this.save.campaign.bestEndlessWaves[this.observer.level.index] ?? 0;
      this.runStartBestEndlessScore =
        this.save.bestEndlessScoresByLevelId[this.observer.level.id] ?? 0;
      if (mode === 'replace') {
        this.lastRunOutcome = null;
      }
    }

    this.persist(mode === 'replace');
    return { ok: true };
  }
}
