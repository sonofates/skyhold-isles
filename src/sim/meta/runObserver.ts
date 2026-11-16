import type { EventBus } from '../../core/eventBus.ts';
import type { SpeedMultiplier, TowerType } from '../../core/types.ts';
import { BALANCE } from '../../data/balance.ts';
import { getChallengesForLevel } from '../../data/challenges.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import { TOWER_DEFS } from '../../data/towers.ts';
import { resolveRunModifiers, scaleGoldCost, scaleGoldReward } from './modifiers.ts';
import type {
  ChallengeCondition,
  ChallengeDef,
  LiveChallengeState,
  LiveChallengeStatus,
  ResolvedRunModifiers,
  RunModifiers,
  RunTelemetry,
} from './types.ts';

/** Evaluates a single challenge condition against a completed run telemetry snapshot. */
export function evaluateChallengeCondition(
  condition: ChallengeCondition,
  telemetry: RunTelemetry,
  won: boolean,
  livesRemaining: number,
): boolean {
  if (!won || !telemetry.eligibleForChallenges) return false;

  switch (condition.kind) {
    case 'noLivesLost':
      return telemetry.livesLost === 0 && livesRemaining >= BALANCE.startingLives;
    case 'minLivesRemaining':
      return livesRemaining >= condition.minLives;
    case 'forbiddenTowerTypes':
      return condition.forbidden.every((type) => (telemetry.towersBuiltByType[type] ?? 0) === 0);
    case 'allowedTowerTypes': {
      for (const [type, count] of Object.entries(telemetry.towersBuiltByType)) {
        if (count > 0 && !condition.allowed.includes(type as TowerType)) {
          return false;
        }
      }
      return true;
    }
    case 'maxTowersBuilt':
      return telemetry.towersBuilt <= condition.maxCount;
    case 'maxPeakTowers':
      return telemetry.peakTowersActive <= condition.maxCount;
    case 'maxTowerTier':
      return telemetry.maxTowerTierBuilt <= condition.maxTier;
    case 'maxGoldSpent':
      return telemetry.grossGoldSpent <= condition.maxGold;
    case 'noAbilities':
      return telemetry.abilitiesCastTotal === 0;
    case 'noTowerSelling':
      return telemetry.towersSold === 0;
    case 'combatSpeedOnly':
      return (
        telemetry.minCombatSpeed !== null && telemetry.minCombatSpeed >= condition.requiredSpeed
      );
    case 'minEarlyWaves':
      return telemetry.earlyWavesCalled >= condition.minCount;
  }
}

/** Returns all challenges for `level` that were satisfied on this winning run. */
export function evaluateLevelChallenges(
  level: LevelDef,
  telemetry: RunTelemetry,
  won: boolean,
  livesRemaining: number,
): readonly ChallengeDef[] {
  if (!won || !telemetry.eligibleForChallenges) return [];
  const defs = getChallengesForLevel(level);
  const completed: ChallengeDef[] = [];
  for (let i = 0; i < defs.length; i++) {
    if (evaluateChallengeCondition(defs[i].condition, telemetry, won, livesRemaining)) {
      completed.push(defs[i]);
    }
  }
  return completed;
}

/** Evaluates live mid-run status & human-readable progress label for one challenge. */
export function evaluateLiveChallengeState(
  def: ChallengeDef,
  telemetry: RunTelemetry,
  livesRemaining: number,
  outcome: 'ongoing' | 'won' | 'lost',
  previouslyCompleted: boolean,
): LiveChallengeStatus {
  const cond = def.condition;
  if (!telemetry.eligibleForChallenges || outcome === 'lost') {
    return {
      def,
      state: 'failed',
      previouslyCompleted,
      progressLabel: !telemetry.eligibleForChallenges ? 'Debug/Skip ineligible' : 'Defeat',
    };
  }
  if (outcome === 'won') {
    const passed = evaluateChallengeCondition(cond, telemetry, true, livesRemaining);
    return {
      def,
      state: passed ? 'completed' : 'failed',
      previouslyCompleted,
      progressLabel: passed ? 'Completed' : 'Not met',
    };
  }

  let failed = false;
  let progressLabel = '';

  switch (cond.kind) {
    case 'noLivesLost':
      failed = telemetry.livesLost > 0 || livesRemaining < BALANCE.startingLives;
      progressLabel = failed ? `${telemetry.livesLost} lost` : `${livesRemaining}/${BALANCE.startingLives} lives`;
      break;
    case 'minLivesRemaining':
      failed = livesRemaining < cond.minLives;
      progressLabel = `${livesRemaining}/${cond.minLives}+ lives`;
      break;
    case 'forbiddenTowerTypes': {
      const builtForbidden = cond.forbidden.reduce(
        (sum, type) => sum + (telemetry.towersBuiltByType[type] ?? 0),
        0,
      );
      failed = builtForbidden > 0;
      progressLabel = failed ? 'Banned tower built' : 'Clean';
      break;
    }
    case 'allowedTowerTypes': {
      const hasDisallowed = Object.entries(telemetry.towersBuiltByType).some(
        ([type, count]) => count > 0 && !cond.allowed.includes(type as TowerType),
      );
      failed = hasDisallowed;
      progressLabel = failed ? 'Disallowed tower built' : 'Arsenal intact';
      break;
    }
    case 'maxTowersBuilt':
      failed = telemetry.towersBuilt > cond.maxCount;
      progressLabel = `${telemetry.towersBuilt}/${cond.maxCount} towers`;
      break;
    case 'maxPeakTowers':
      failed = telemetry.peakTowersActive > cond.maxCount;
      progressLabel = `${telemetry.activeTowers}/${cond.maxCount} active`;
      break;
    case 'maxTowerTier':
      failed = telemetry.maxTowerTierBuilt > cond.maxTier;
      progressLabel = `Max T${telemetry.maxTowerTierBuilt}/T${cond.maxTier}`;
      break;
    case 'maxGoldSpent':
      failed = telemetry.grossGoldSpent > cond.maxGold;
      progressLabel = `${telemetry.grossGoldSpent}/${cond.maxGold}g`;
      break;
    case 'noAbilities':
      failed = telemetry.abilitiesCastTotal > 0;
      progressLabel = failed ? `${telemetry.abilitiesCastTotal} cast` : '0 abilities';
      break;
    case 'noTowerSelling':
      failed = telemetry.towersSold > 0;
      progressLabel = failed ? `${telemetry.towersSold} sold` : '0 sold';
      break;
    case 'combatSpeedOnly':
      failed =
        telemetry.minCombatSpeed !== null && telemetry.minCombatSpeed < cond.requiredSpeed;
      progressLabel = failed
        ? `Dropped to ${telemetry.minCombatSpeed}x`
        : telemetry.minCombatSpeed === null
          ? telemetry.currentSpeed >= cond.requiredSpeed
            ? `${cond.requiredSpeed}x armed`
            : `Set ${cond.requiredSpeed}x before W1`
          : `${cond.requiredSpeed}x locked`;
      break;
    case 'minEarlyWaves': {
      const maxRemaining =
        telemetry.maxWaveReached === 0
          ? Math.max(0, telemetry.storyWaveCount - 1)
          : Math.max(0, telemetry.storyWaveCount - telemetry.maxWaveReached);
      failed = telemetry.earlyWavesCalled + maxRemaining < cond.minCount;
      progressLabel = `${telemetry.earlyWavesCalled}/${cond.minCount} early`;
      break;
    }
  }

  const state: LiveChallengeState = failed ? 'failed' : 'on_track';
  return {
    def,
    state,
    previouslyCompleted,
    progressLabel,
  };
}

/** Evaluates live mid-run challenge status for all challenges on `level`. */
export function evaluateLiveLevelChallenges(
  level: LevelDef,
  telemetry: RunTelemetry,
  livesRemaining: number,
  outcome: 'ongoing' | 'won' | 'lost',
  completedMap: Readonly<Record<string, boolean>>,
): readonly LiveChallengeStatus[] {
  const defs = getChallengesForLevel(level);
  return defs.map((def) =>
    evaluateLiveChallengeState(
      def,
      telemetry,
      livesRemaining,
      outcome,
      completedMap[def.id] === true,
    ),
  );
}

/**
 * Pure EventBus observer for a single SimWorld run.
 * Tracks telemetry for lifetime stats, achievements, and per-island optional challenges.
 */
export class RunObserver {
  readonly level: LevelDef;
  private modifiers: ResolvedRunModifiers;
  private readonly unsubs: Array<() => void> = [];
  private readonly spawnedFlyingIds = new Set<number>();

  private simTimeSec = 0;
  private towersBuilt = 0;
  private activeTowers = 0;
  private peakTowersActive = 0;
  private readonly towersBuiltByType: Record<string, number> = {};
  private towersUpgraded = 0;
  private towersUpgradedToTier3 = 0;
  private maxTowerTierBuilt = 0;
  private towersSold = 0;
  private grossGoldSpent = 0;
  private netGoldSpent = 0;
  private goldEarned = 0;
  private enemiesKilledTotal = 0;
  private endlessEnemiesKilled = 0;
  private readonly enemiesKilledByType: Record<string, number> = {};
  private flyingEnemiesKilled = 0;
  private livesLost = 0;
  private earlyWavesCalled = 0;
  private abilitiesCastTotal = 0;
  private meteorsCast = 0;
  private overchargesCast = 0;
  private towersCleansed = 0;
  private wavesCompleted = 0;
  private storyWavesCompleted = 0;
  private endlessWavesCompleted = 0;
  private pendingAbsorbedStoryWaves = 0;
  private pendingAbsorbedEndlessWaves = 0;
  private lastCompletedWaveIndex = -1;
  private endlessEntered = false;
  private maxWaveReached = 0;
  private currentSpeed: SpeedMultiplier = 1;
  private minCombatSpeed: SpeedMultiplier | null = null;
  private inCombat = false;
  private inWavePhase = false;
  private runEnded = false;
  private storyWinSnapshot: { livesRemaining: number; telemetry: RunTelemetry } | null = null;
  private expectedNextWaveIndex = 0;
  private skippedWaves = false;
  private eligibleForChallenges = true;
  private expectedGold: number;
  private expectedLives: number;
  private disposed = false;

  constructor(level: LevelDef, events: EventBus, modifiers?: RunModifiers | null) {
    this.level = level;
    this.modifiers = resolveRunModifiers(modifiers);
    this.expectedGold = Math.round(level.startingGold * this.modifiers.startingGoldMultiplier);
    this.expectedLives = BALANCE.startingLives;
    this.bind(events);
  }

  private bind(events: EventBus): void {
    this.unsubs.push(
      events.on('towerBuilt', (ev) => {
        this.towersBuilt++;
        this.activeTowers++;
        if (this.activeTowers > this.peakTowersActive) {
          this.peakTowersActive = this.activeTowers;
        }
        this.towersBuiltByType[ev.type] = (this.towersBuiltByType[ev.type] ?? 0) + 1;
        if (ev.tier > this.maxTowerTierBuilt) {
          this.maxTowerTierBuilt = ev.tier;
        }
        const tier = (ev.tier === 1 || ev.tier === 2 || ev.tier === 3 ? ev.tier : 1) as 1 | 2 | 3;
        const baseCost = TOWER_DEFS[ev.type]?.tiers[tier - 1]?.upgradeCost ?? 0;
        const paid = scaleGoldCost(baseCost, this.modifiers);
        this.grossGoldSpent += paid;
        this.netGoldSpent += paid;
        this.expectedGold -= paid;
      }),
      events.on('towerUpgraded', (ev) => {
        this.towersUpgraded++;
        if (ev.tier === 3) {
          this.towersUpgradedToTier3++;
        }
        if (ev.tier > this.maxTowerTierBuilt) {
          this.maxTowerTierBuilt = ev.tier;
        }
        const tier = (ev.tier === 1 || ev.tier === 2 || ev.tier === 3 ? ev.tier : 2) as 1 | 2 | 3;
        const baseCost = TOWER_DEFS[ev.type]?.tiers[tier - 1]?.upgradeCost ?? 0;
        const paid = scaleGoldCost(baseCost, this.modifiers);
        this.grossGoldSpent += paid;
        this.netGoldSpent += paid;
        this.expectedGold -= paid;
      }),
      events.on('towerSold', (ev) => {
        this.activeTowers = Math.max(0, this.activeTowers - 1);
        this.towersSold++;
        this.netGoldSpent = Math.max(0, this.netGoldSpent - ev.refund);
        this.expectedGold += ev.refund;
      }),
      events.on('enemySpawned', (ev) => {
        if (!this.inWavePhase) {
          this.eligibleForChallenges = false;
        }
        if (ev.flying) {
          this.spawnedFlyingIds.add(ev.enemyId);
        }
      }),
      events.on('enemyKilled', (ev) => {
        this.enemiesKilledTotal++;
        if (this.endlessEntered) {
          this.endlessEnemiesKilled++;
        }
        this.enemiesKilledByType[ev.enemyType] =
          (this.enemiesKilledByType[ev.enemyType] ?? 0) + 1;
        if (this.spawnedFlyingIds.delete(ev.enemyId)) {
          this.flyingEnemiesKilled++;
        }
        this.goldEarned += ev.reward;
        this.expectedGold += ev.reward;
      }),
      events.on('enemyLeaked', (ev) => {
        this.livesLost += ev.livesLost;
        this.expectedLives = Math.max(0, this.expectedLives - ev.livesLost);
      }),
      events.on('abilityTargeted', (ev) => {
        this.abilitiesCastTotal++;
        if (ev.abilityId === 'meteor') {
          this.meteorsCast++;
        }
      }),
      events.on('overchargeActivated', (ev) => {
        this.abilitiesCastTotal++;
        this.overchargesCast++;
        this.towersCleansed += ev.cleansedTowerIds.length;
      }),
      events.on('waveStarted', (ev) => {
        if (this.runEnded && !this.endlessEntered) {
          this.eligibleForChallenges = false;
        }
        if (ev.waveIndex !== this.expectedNextWaveIndex) {
          this.skippedWaves = true;
          this.eligibleForChallenges = false;
        }
        if (this.inWavePhase) {
          // Legitimate early-call during 'clearing'/'allSpawned' always awards earlyBonus > 0;
          // mid-wave debugSkipToWave awards 0 earlyBonus without firing waveCompleted.
          if (ev.earlyBonus <= 0) {
            this.skippedWaves = true;
            this.eligibleForChallenges = false;
          } else if (this.endlessEntered) {
            this.pendingAbsorbedEndlessWaves++;
          } else if (ev.waveIndex - 1 < this.level.waves.length) {
            this.pendingAbsorbedStoryWaves++;
          }
        }
        this.inWavePhase = true;
        this.expectedNextWaveIndex = ev.waveIndex + 1;
        if (ev.waveIndex + 1 > this.maxWaveReached) {
          this.maxWaveReached = ev.waveIndex + 1;
        }
        if (ev.earlyBonus > 0) {
          this.earlyWavesCalled++;
          const scaledEarly = scaleGoldReward(ev.earlyBonus, this.modifiers);
          this.goldEarned += scaledEarly;
          this.expectedGold += scaledEarly;
        }
        if (!this.inCombat) {
          this.inCombat = true;
          this.minCombatSpeed = this.currentSpeed;
        }
      }),
      events.on('waveCompleted', (ev) => {
        this.inWavePhase = false;
        this.lastCompletedWaveIndex = ev.waveIndex;
        if (this.endlessEntered || ev.waveIndex >= this.level.waves.length) {
          const cleared = 1 + this.pendingAbsorbedEndlessWaves;
          this.pendingAbsorbedEndlessWaves = 0;
          this.wavesCompleted += cleared;
          this.endlessWavesCompleted += cleared;
        } else {
          const cleared = 1 + this.pendingAbsorbedStoryWaves;
          this.pendingAbsorbedStoryWaves = 0;
          this.wavesCompleted += cleared;
          this.storyWavesCompleted += cleared;
        }
        if (ev.bonus > 0) {
          const scaledBonus = scaleGoldReward(ev.bonus, this.modifiers);
          this.goldEarned += scaledBonus;
          this.expectedGold += scaledBonus;
        }
      }),
      events.on('endlessEntered', () => {
        this.endlessEntered = true;
        this.inCombat = true;
      }),
      events.on('gameWon', (ev) => {
        this.inCombat = false;
        this.inWavePhase = false;
        this.runEnded = true;
        if (
          this.endlessEntered ||
          this.storyWinSnapshot !== null ||
          this.skippedWaves ||
          this.storyWavesCompleted < this.level.waves.length ||
          this.lastCompletedWaveIndex !== this.level.waves.length - 1
        ) {
          this.eligibleForChallenges = false;
        }
        if (this.storyWinSnapshot === null && !this.endlessEntered) {
          this.storyWinSnapshot = {
            livesRemaining: ev.livesRemaining,
            telemetry: this.getTelemetry(),
          };
        }
      }),
      events.on('gameLost', (ev) => {
        this.inCombat = false;
        this.inWavePhase = false;
        this.runEnded = true;
        if (ev.waveIndex + 1 > this.maxWaveReached) {
          this.maxWaveReached = ev.waveIndex + 1;
        }
      }),
    );
  }

  /** Records a speed setting change (call pre-wave and whenever loop speed changes). */
  recordSpeed(speed: SpeedMultiplier): void {
    this.currentSpeed = speed;
    if (this.inCombat) {
      if (this.minCombatSpeed === null || speed < this.minCombatSpeed) {
        this.minCombatSpeed = speed;
      }
    }
  }

  /** Advances observed simulation play time and optionally checks speed. */
  onTick(dt: number, speed?: SpeedMultiplier): void {
    if (dt > 0 && Number.isFinite(dt)) {
      this.simTimeSec += dt;
    }
    if (speed !== undefined) {
      this.recordSpeed(speed);
    }
  }

  /** Returns the currently active resolved run modifiers. */
  getModifiers(): ResolvedRunModifiers {
    return this.modifiers;
  }

  /** Updates active modifiers mid-run (e.g. when entering Endless Mode with mutators). */
  setModifiers(modifiers: RunModifiers | null | undefined): void {
    this.modifiers = resolveRunModifiers(modifiers);
  }

  /** Marks this run ineligible for challenges (e.g., if debug tools manipulated gold/lives). */
  markDebugTainted(): void {
    this.eligibleForChallenges = false;
  }

  /** Returns false if debug cheats, skipped waves, or economy tampering tainted this run. */
  isEligibleForChallenges(): boolean {
    return this.eligibleForChallenges;
  }

  /**
   * Verifies that live SimWorld gold & lives still match EventBus-derived economy state.
   * Any external mutation (e.g. `?debug` +100g / +500g / Lives=20) immediately taints the run.
   */
  verifyEconomyIntegrity(actualGold: number, actualLives: number): boolean {
    if (actualGold !== this.expectedGold || actualLives !== this.expectedLives) {
      this.eligibleForChallenges = false;
      return false;
    }
    return true;
  }

  /** Returns frozen story-win telemetry/lives once campaign waves are won (prevents Endless mutations). */
  getStoryWinSnapshot(): { livesRemaining: number; telemetry: RunTelemetry } | null {
    return this.storyWinSnapshot;
  }

  getTelemetry(): RunTelemetry {
    return {
      levelId: this.level.id,
      levelIndex: this.level.index,
      storyWaveCount: this.level.waves.length,
      simTimeSec: this.simTimeSec,
      towersBuilt: this.towersBuilt,
      activeTowers: this.activeTowers,
      peakTowersActive: this.peakTowersActive,
      towersBuiltByType: { ...this.towersBuiltByType },
      towersUpgraded: this.towersUpgraded,
      towersUpgradedToTier3: this.towersUpgradedToTier3,
      maxTowerTierBuilt: this.maxTowerTierBuilt,
      towersSold: this.towersSold,
      grossGoldSpent: this.grossGoldSpent,
      netGoldSpent: this.netGoldSpent,
      goldEarned: this.goldEarned,
      enemiesKilledTotal: this.enemiesKilledTotal,
      endlessEnemiesKilled: this.endlessEnemiesKilled,
      enemiesKilledByType: { ...this.enemiesKilledByType },
      flyingEnemiesKilled: this.flyingEnemiesKilled,
      livesLost: this.livesLost,
      earlyWavesCalled: this.earlyWavesCalled,
      abilitiesCastTotal: this.abilitiesCastTotal,
      meteorsCast: this.meteorsCast,
      overchargesCast: this.overchargesCast,
      towersCleansed: this.towersCleansed,
      wavesCompleted: this.wavesCompleted,
      storyWavesCompleted: this.storyWavesCompleted,
      endlessWavesCompleted: this.endlessWavesCompleted,
      endlessEntered: this.endlessEntered,
      maxWaveReached: this.maxWaveReached,
      currentSpeed: this.currentSpeed,
      minCombatSpeed: this.minCombatSpeed,
      activeMutatorIds: [...this.modifiers.activeMutatorIds],
      eligibleForChallenges: this.eligibleForChallenges,
    };
  }

  evaluateCompletedChallenges(won: boolean, livesRemaining: number): readonly ChallengeDef[] {
    return evaluateLevelChallenges(this.level, this.getTelemetry(), won, livesRemaining);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = 0; i < this.unsubs.length; i++) {
      this.unsubs[i]();
    }
    this.unsubs.length = 0;
    this.spawnedFlyingIds.clear();
  }
}
