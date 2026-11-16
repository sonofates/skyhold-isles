import type { EventBus } from '../core/eventBus.ts';
import type { ProgressData, SpeedMultiplier, TowerType } from '../core/types.ts';
import { LEVELS } from '../data/levels/index.ts';
import type { LevelDef } from '../data/levels/types.ts';
import { TOWER_TYPES } from '../data/towers.ts';
import { computeDailyStreaks, generateDailyChallenge } from '../sim/meta/daily.ts';
import {
  applyTelemetryDeltaToStats,
  getAchievements,
  getAllChallengeProgress,
  getChallengeStatus,
  getStats,
  recomputeAchievements,
  recordRunCompletion,
} from '../sim/meta/metaEngine.ts';
import { getAllowedTowerTypes, isTowerTypeAllowed } from '../sim/meta/modifiers.ts';
import { selectEndlessMutators } from '../sim/meta/mutators.ts';
import { evaluateLiveLevelChallenges, RunObserver } from '../sim/meta/runObserver.ts';
import type {
  AchievementStatus,
  AllChallengeProgress,
  DailyChallengeSpec,
  DailyStatus,
  EndlessMutatorRoll,
  LevelChallengeStatus,
  LifetimeStats,
  LiveChallengeStatus,
  MetaSaveData,
  ResolvedRunModifiers,
  RunMetaOutcome,
  RunModifiers,
  RunTelemetry,
} from '../sim/meta/types.ts';
import { getTodayUtcDateString, loadMetaSave, saveMetaSave } from './storage.ts';

export interface MetaSessionOptions {
  readonly levels?: readonly LevelDef[];
  readonly saveData?: MetaSaveData;
  readonly onSave?: (save: MetaSaveData) => void;
  readonly getTodayDate?: () => string;
}

/**
 * Platform-layer coordinator connecting RunObserver, versioned save storage,
 * and typed meta queries for the UI (challenges, achievements, stats, endless mutators, daily).
 */
export class MetaSession {
  private readonly levels: readonly LevelDef[];
  private readonly save: MetaSaveData;
  private readonly persistFn: (save: MetaSaveData) => void;
  private readonly getTodayDateFn: () => string;

  private observer: RunObserver | null = null;
  private committedTelemetry: RunTelemetry | null = null;
  private unsubs: Array<() => void> = [];
  private countedGamePlayed = false;
  private activeDailyDate: string | null = null;
  private lastRunOutcome: RunMetaOutcome | null = null;

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
    this.activeDailyDate = options?.dailyDate ?? null;
    this.lastRunOutcome = null;

    this.unsubs.push(
      events.on('waveStarted', () => {
        if (!this.countedGamePlayed) {
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
        this.flushStats(false);
        const telemetry = observer.getTelemetry();
        this.lastRunOutcome = recordRunCompletion(this.save, {
          level,
          telemetry,
          won: true,
          stars: ev.stars,
          livesRemaining: ev.livesRemaining,
          levels: this.levels,
          dailyDate: this.activeDailyDate,
          scoreMultiplier: observer.getModifiers().scoreMultiplier,
        });
        this.persist();
      }),
      events.on('gameLost', () => {
        this.flushStats(false);
        const telemetry = observer.getTelemetry();
        this.lastRunOutcome = recordRunCompletion(this.save, {
          level,
          telemetry,
          won: false,
          stars: 0,
          livesRemaining: 0,
          levels: this.levels,
          dailyDate: this.activeDailyDate,
          scoreMultiplier: observer.getModifiers().scoreMultiplier,
        });
        this.persist();
      }),
    );
  }

  onEndlessEntered(modifiers?: RunModifiers | null): void {
    if (!this.observer) return;
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

  flushStats(persistAfter = true): void {
    if (!this.observer) return;
    const current = this.observer.getTelemetry();
    applyTelemetryDeltaToStats(this.save, current, this.committedTelemetry);
    this.committedTelemetry = current;

    if (current.endlessEntered && current.maxWaveReached > 0) {
      const idx = current.levelIndex;
      while (this.save.campaign.bestEndlessWaves.length <= idx) {
        this.save.campaign.bestEndlessWaves.push(0);
      }
      this.save.campaign.bestEndlessWaves[idx] = Math.max(
        this.save.campaign.bestEndlessWaves[idx] ?? 0,
        current.maxWaveReached,
      );
    }

    recomputeAchievements(this.save, this.levels);
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
    for (let i = 0; i < this.unsubs.length; i++) {
      this.unsubs[i]();
    }
    this.unsubs.length = 0;
  }

  private persist(): void {
    this.persistFn(this.save);
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
    return evaluateLiveLevelChallenges(
      this.observer.level,
      this.observer.getTelemetry(),
      livesRemaining,
      outcome,
      this.save.completedChallenges,
    );
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

  getActiveRunModifiers(): ResolvedRunModifiers | null {
    return this.observer ? this.observer.getModifiers() : null;
  }

  getActiveDailyDate(): string | null {
    return this.activeDailyDate;
  }

  getLastRunOutcome(): RunMetaOutcome | null {
    return this.lastRunOutcome;
  }
}
