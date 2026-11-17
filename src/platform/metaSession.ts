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
  createEmptyLifetimeStats,
  exportMetaSaveJson,
  getAchievementById,
  getAchievements,
  getAchievementSummary,
  getAllChallengeProgress,
  getAllIslandMasteryStatuses,
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
  getValidDailyDateSet,
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
  previewMutatorSelection,
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
  EnemyIntelEntry,
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
  MutatorSelectionPreview,
  RecommendedGoal,
  ResolvedRunModifiers,
  RunMetaOutcome,
  RunModifiers,
  RunTelemetry,
  TowerMasteryStat,
} from '../sim/meta/types.ts';
import { getTodayUtcDateString, loadMetaSave, saveMetaSave } from './storage.ts';

function nonNegIntOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

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
  private isDebugTaintedFn: (() => boolean) | null = null;
  private getEconomyStateFn: (() => { gold: number; lives: number }) | null = null;

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
      isDebugTainted?: () => boolean;
      getEconomyState?: () => { gold: number; lives: number };
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
    this.syncRunEndlessBaseline(level);
    this.isDebugTaintedFn = options?.isDebugTainted ?? null;
    this.getEconomyStateFn = options?.getEconomyState ?? null;

    this.unsubs.push(
      events.on('waveStarted', () => {
        this.syncWorldTaint(true);
        if (!this.countedGamePlayed && observer.isEligibleForChallenges()) {
          this.markGamePlayed();
        }
      }),
      events.on('waveCompleted', () => {
        this.syncWorldTaint(true);
        this.flushStats();
      }),
      events.on('endlessEntered', () => {
        this.syncWorldTaint(true);
        this.flushStats();
      }),
      events.on('gameWon', (ev) => {
        if (observer.getTelemetry().endlessEntered) return;
        this.syncWorldTaint(true);
        this.finalizeRunOutcome(level, observer, true, ev.stars, ev.livesRemaining);
      }),
      events.on('gameLost', () => {
        this.syncWorldTaint(false);
        this.finalizeRunOutcome(level, observer, false, 0, 0);
      }),
    );
  }

  private markGamePlayed(): void {
    this.countedGamePlayed = true;
    if (!this.save.stats || typeof this.save.stats !== 'object' || Array.isArray(this.save.stats)) {
      this.save.stats = createEmptyLifetimeStats();
    }
    this.save.stats.gamesPlayed = nonNegIntOrZero(this.save.stats.gamesPlayed) + 1;
  }

  private syncRunEndlessBaseline(level: LevelDef): void {
    this.runStartBestEndlessWave = nonNegIntOrZero(
      this.save?.campaign?.bestEndlessWaves?.[level.index],
    );
    this.runStartBestEndlessScore = nonNegIntOrZero(
      this.save?.bestEndlessScoresByLevelId?.[level.id],
    );
  }

  private finalizeRunOutcome(
    level: LevelDef,
    observer: RunObserver,
    won: boolean,
    stars: 0 | 1 | 2 | 3,
    livesRemaining: number,
  ): void {
    const endlessEntered = observer.getTelemetry().endlessEntered;
    if (!this.countedGamePlayed && observer.isEligibleForChallenges() && (won || !endlessEntered)) {
      this.markGamePlayed();
    }
    this.flushStats(false);
    const telemetry = observer.getTelemetry();
    const outcome = recordRunCompletion(this.save, {
      level,
      telemetry,
      won,
      stars,
      livesRemaining,
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
  }

  onEndlessEntered(modifiers?: RunModifiers | null): void {
    if (!this.observer) return;
    this.syncRunEndlessBaseline(this.observer.level);
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

  private syncWorldTaint(checkEconomy: boolean): void {
    if (!this.observer) return;
    if (this.isDebugTaintedFn?.()) {
      this.observer.markDebugTainted();
    }
    if (checkEconomy && this.getEconomyStateFn) {
      const econ = this.getEconomyStateFn();
      this.observer.verifyEconomyIntegrity(econ.gold, econ.lives);
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
    this.syncWorldTaint(false);
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
    this.isDebugTaintedFn = null;
    this.getEconomyStateFn = null;
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
    const validDates = getValidDailyDateSet(this.save.completedDailyDates);
    const { currentStreak, bestStreak } = computeDailyStreaks([...validDates], spec.date);
    return {
      spec,
      completedToday: validDates.has(spec.date),
      bestScoreToday: getDailyBestScore(this.save.dailyBestScores, spec.date),
      totalDailyCompleted: validDates.size,
      currentStreak,
      bestStreak,
    };
  }

  getLiveChallengeStates(
    livesRemaining: number,
    outcome: 'ongoing' | 'won' | 'lost' = 'ongoing',
  ): readonly LiveChallengeStatus[] {
    if (!this.observer || this.activeDailyDate !== null) return [];
    const completedMap =
      this.save?.completedChallenges &&
      typeof this.save.completedChallenges === 'object' &&
      !Array.isArray(this.save.completedChallenges)
        ? this.save.completedChallenges
        : {};
    const storySnapshot = this.observer.getStoryWinSnapshot();
    if (storySnapshot) {
      return evaluateLiveLevelChallenges(
        this.observer.level,
        storySnapshot.telemetry,
        storySnapshot.livesRemaining,
        'won',
        completedMap,
      );
    }
    return evaluateLiveLevelChallenges(
      this.observer.level,
      this.observer.getTelemetry(),
      livesRemaining,
      outcome,
      completedMap,
    );
  }

  getActiveDailyChallenge(): DailyChallengeSpec | null {
    if (!this.activeDailyDate || this.observer?.getTelemetry().endlessEntered) return null;
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

  getTowerMasteryStats(): readonly TowerMasteryStat[] {
    return getTowerMasteryStats(this.save);
  }

  getEnemyIntelStats(): readonly EnemyIntelEntry[] {
    return getEnemyIntelStats(this.save);
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

  previewMutatorSelection(input: MutatorSelectionInput): MutatorSelectionPreview {
    return previewMutatorSelection(input);
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
    if (!this.save.campaign || typeof this.save.campaign !== 'object' || Array.isArray(this.save.campaign)) {
      this.save.campaign = {
        unlockedLevelIndex: next.campaign.unlockedLevelIndex,
        bestStars: [...next.campaign.bestStars],
        bestEndlessWaves: [...next.campaign.bestEndlessWaves],
      };
    } else {
      this.save.campaign.unlockedLevelIndex = next.campaign.unlockedLevelIndex;
      if (Array.isArray(this.save.campaign.bestStars)) {
        this.save.campaign.bestStars.splice(
          0,
          this.save.campaign.bestStars.length,
          ...next.campaign.bestStars,
        );
      } else {
        this.save.campaign.bestStars = [...next.campaign.bestStars];
      }
      if (Array.isArray(this.save.campaign.bestEndlessWaves)) {
        this.save.campaign.bestEndlessWaves.splice(
          0,
          this.save.campaign.bestEndlessWaves.length,
          ...next.campaign.bestEndlessWaves,
        );
      } else {
        this.save.campaign.bestEndlessWaves = [...next.campaign.bestEndlessWaves];
      }
    }
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

    if (mode === 'replace') {
      this.lastRunOutcome = null;
    }
    if (this.observer) {
      this.syncRunEndlessBaseline(this.observer.level);
      if (mode === 'replace') {
        this.committedTelemetry = this.observer.isEligibleForChallenges()
          ? this.observer.getTelemetry()
          : null;
        this.countedGamePlayed = false;
        this.runUnlockedAchievementIds = [];
      }
    }

    this.persist(mode === 'replace');
    return { ok: true };
  }
}
