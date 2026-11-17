import type { EventBus } from '../../core/eventBus.ts';
import type { SpeedMultiplier, TowerType } from '../../core/types.ts';
import { BALANCE } from '../../data/balance.ts';
import { getChallengesForLevel } from '../../data/challenges.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import { TOWER_DEFS } from '../../data/towers.ts';
import {
  hasActiveRunModifiers,
  isAdvantageousModifiers,
  resolveRunModifiers,
  scaleGoldCost,
  scaleGoldReward,
} from './modifiers.ts';
import type {
  ChallengeCondition,
  ChallengeDef,
  LiveChallengeState,
  LiveChallengeStatus,
  ResolvedRunModifiers,
  RunModifiers,
  RunTelemetry,
} from './types.ts';

const IGNORED_OBSERVER_KEYS = new Set<string>(['__proto__', 'constructor', 'prototype']);

/** Evaluates a single challenge condition against a completed run telemetry snapshot. */
export function evaluateChallengeCondition(
  condition: ChallengeCondition,
  telemetry: RunTelemetry,
  won: boolean,
  livesRemaining: number,
): boolean {
  if (!won || !telemetry?.eligibleForChallenges) return false;
  const safeLives = Number.isFinite(livesRemaining) ? Math.max(0, Math.floor(livesRemaining)) : 0;
  const builtByType =
    telemetry.towersBuiltByType &&
    typeof telemetry.towersBuiltByType === 'object' &&
    !Array.isArray(telemetry.towersBuiltByType)
      ? telemetry.towersBuiltByType
      : {};

  switch (condition.kind) {
    case 'noLivesLost':
      return telemetry.livesLost === 0 && safeLives >= BALANCE.startingLives;
    case 'minLivesRemaining':
      return safeLives >= condition.minLives;
    case 'forbiddenTowerTypes':
      return condition.forbidden.every(
        (type) =>
          (Object.hasOwn(builtByType, type) ? (builtByType[type] ?? 0) : 0) === 0,
      );
    case 'allowedTowerTypes': {
      for (const [type, count] of Object.entries(builtByType)) {
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
  if (!won || !telemetry.eligibleForChallenges || !level || typeof level.id !== 'string') return [];
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
      progressLabel: !telemetry.eligibleForChallenges ? 'Modifier/Debug ineligible' : 'Defeat',
    };
  }
  const safeLives = Number.isFinite(livesRemaining) ? Math.max(0, Math.floor(livesRemaining)) : 0;
  if (outcome === 'won') {
    const passed = evaluateChallengeCondition(cond, telemetry, true, safeLives);
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
      failed = telemetry.livesLost > 0 || safeLives < BALANCE.startingLives;
      progressLabel =
        telemetry.livesLost > 0
          ? `${telemetry.livesLost} lost`
          : `${safeLives}/${BALANCE.startingLives} lives`;
      break;
    case 'minLivesRemaining':
      failed = safeLives < cond.minLives;
      progressLabel = `${safeLives}/${cond.minLives}+ lives`;
      break;
    case 'forbiddenTowerTypes': {
      const builtMap =
        telemetry.towersBuiltByType &&
        typeof telemetry.towersBuiltByType === 'object' &&
        !Array.isArray(telemetry.towersBuiltByType)
          ? telemetry.towersBuiltByType
          : {};
      const builtForbidden = cond.forbidden.reduce(
        (sum, type) => sum + (Object.hasOwn(builtMap, type) ? (builtMap[type] ?? 0) : 0),
        0,
      );
      failed = builtForbidden > 0;
      progressLabel = failed ? 'Banned tower built' : 'Clean';
      break;
    }
    case 'allowedTowerTypes': {
      const builtMap =
        telemetry.towersBuiltByType &&
        typeof telemetry.towersBuiltByType === 'object' &&
        !Array.isArray(telemetry.towersBuiltByType)
          ? telemetry.towersBuiltByType
          : {};
      const hasDisallowed = Object.entries(builtMap).some(
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
      progressLabel = failed
        ? `Peak ${telemetry.peakTowersActive}/${cond.maxCount}`
        : `${telemetry.activeTowers}/${cond.maxCount} active`;
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
  if (!level || typeof level.id !== 'string') return [];
  const defs = getChallengesForLevel(level);
  const safeCompleted =
    completedMap && typeof completedMap === 'object' && !Array.isArray(completedMap)
      ? completedMap
      : {};
  return defs.map((def) =>
    evaluateLiveChallengeState(
      def,
      telemetry,
      livesRemaining,
      outcome,
      Object.hasOwn(safeCompleted, def.id) && safeCompleted[def.id] === true,
    ),
  );
}

/** Looks up the upgrade/build gold cost for a tower tier cleanly (supports future extra tiers). */
function getTowerTierBaseCost(type: TowerType, tier: number, fallbackTier: number): number {
  const tiers = Object.hasOwn(TOWER_DEFS, type)
    ? (TOWER_DEFS[type]?.tiers as readonly { readonly upgradeCost: number }[] | undefined)
    : undefined;
  if (!tiers || tiers.length === 0) return 0;
  const resolvedTier = Number.isFinite(tier) ? Math.max(1, Math.floor(tier)) : fallbackTier;
  return tiers[resolvedTier - 1]?.upgradeCost ?? 0;
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
  private hasLost = false;
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
    if (isAdvantageousModifiers(this.modifiers)) {
      this.eligibleForChallenges = false;
    }
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
        if (!IGNORED_OBSERVER_KEYS.has(ev.type)) {
          const prevBuilt = Object.hasOwn(this.towersBuiltByType, ev.type)
            ? this.towersBuiltByType[ev.type]
            : 0;
          this.towersBuiltByType[ev.type] = prevBuilt + 1;
        }
        if (ev.tier > this.maxTowerTierBuilt) {
          this.maxTowerTierBuilt = ev.tier;
        }
        const paid = scaleGoldCost(getTowerTierBaseCost(ev.type, ev.tier, 1), this.modifiers);
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
        const paid = scaleGoldCost(getTowerTierBaseCost(ev.type, ev.tier, 2), this.modifiers);
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
        if (!IGNORED_OBSERVER_KEYS.has(ev.enemyType)) {
          const prevKills = Object.hasOwn(this.enemiesKilledByType, ev.enemyType)
            ? this.enemiesKilledByType[ev.enemyType]
            : 0;
          this.enemiesKilledByType[ev.enemyType] = prevKills + 1;
        }
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
        if (this.hasLost || (this.runEnded && !this.endlessEntered)) {
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
        if (this.hasLost) {
          this.eligibleForChallenges = false;
        }
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
        this.hasLost = true;
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
    if (isAdvantageousModifiers(this.modifiers)) {
      this.eligibleForChallenges = false;
    }
  }

  /** Marks this run ineligible for challenges (e.g., if debug tools manipulated gold/lives). */
  markDebugTainted(): void {
    this.eligibleForChallenges = false;
    if (this.storyWinSnapshot && !this.endlessEntered) {
      this.storyWinSnapshot = {
        ...this.storyWinSnapshot,
        telemetry: { ...this.storyWinSnapshot.telemetry, eligibleForChallenges: false },
      };
    }
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
      this.markDebugTainted();
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
      hasRunModifiers: hasActiveRunModifiers(this.modifiers),
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
