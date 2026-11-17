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

function getSafeCountMap(raw: unknown): Readonly<Record<string, number>> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, number>)
    : {};
}

function isNonNegFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function countForbiddenTowersBuilt(
  builtMap: Readonly<Record<string, number>>,
  forbidden: readonly TowerType[],
): number {
  let total = 0;
  for (let i = 0; i < forbidden.length; i++) {
    const type = forbidden[i];
    if (Object.hasOwn(builtMap, type)) {
      const count = builtMap[type];
      if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
        total += count;
      }
    }
  }
  return total;
}

function hasDisallowedTowerBuilt(
  builtMap: Readonly<Record<string, number>>,
  allowed: readonly TowerType[],
): boolean {
  for (const [type, count] of Object.entries(builtMap)) {
    if (typeof count === 'number' && Number.isFinite(count) && count > 0 && !allowed.includes(type as TowerType)) {
      return true;
    }
  }
  return false;
}

/** Evaluates a single challenge condition against a completed run telemetry snapshot. */
export function evaluateChallengeCondition(
  condition: ChallengeCondition,
  telemetry: RunTelemetry,
  won: boolean,
  livesRemaining: number,
): boolean {
  if (!won || !telemetry?.eligibleForChallenges) return false;
  const safeLives = Number.isFinite(livesRemaining) ? Math.max(0, Math.floor(livesRemaining)) : 0;
  const builtByType = getSafeCountMap(telemetry.towersBuiltByType);

  switch (condition.kind) {
    case 'noLivesLost':
      return telemetry.livesLost === 0 && safeLives >= BALANCE.startingLives;
    case 'minLivesRemaining':
      return safeLives >= condition.minLives;
    case 'forbiddenTowerTypes':
      return countForbiddenTowersBuilt(builtByType, condition.forbidden) === 0;
    case 'allowedTowerTypes':
      return !hasDisallowedTowerBuilt(builtByType, condition.allowed);
    case 'maxTowersBuilt':
      return isNonNegFinite(telemetry.towersBuilt) && telemetry.towersBuilt <= condition.maxCount;
    case 'maxPeakTowers':
      return (
        isNonNegFinite(telemetry.peakTowersActive) &&
        telemetry.peakTowersActive <= condition.maxCount
      );
    case 'maxTowerTier':
      return (
        isNonNegFinite(telemetry.maxTowerTierBuilt) &&
        telemetry.maxTowerTierBuilt <= condition.maxTier
      );
    case 'maxGoldSpent':
      return isNonNegFinite(telemetry.grossGoldSpent) && telemetry.grossGoldSpent <= condition.maxGold;
    case 'noAbilities':
      return telemetry.abilitiesCastTotal === 0;
    case 'noTowerSelling':
      return telemetry.towersSold === 0;
    case 'combatSpeedOnly':
      return (
        typeof telemetry.minCombatSpeed === 'number' &&
        Number.isFinite(telemetry.minCombatSpeed) &&
        telemetry.minCombatSpeed >= condition.requiredSpeed
      );
    case 'minEarlyWaves':
      return (
        isNonNegFinite(telemetry.earlyWavesCalled) &&
        telemetry.earlyWavesCalled >= condition.minCount
      );
  }
}

/** Returns all challenges for `level` that were satisfied on this winning run. */
export function evaluateLevelChallenges(
  level: LevelDef,
  telemetry: RunTelemetry,
  won: boolean,
  livesRemaining: number,
): readonly ChallengeDef[] {
  if (!won || !telemetry?.eligibleForChallenges || !level || typeof level.id !== 'string' || level.id.length === 0) {
    return [];
  }
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
  if (!telemetry || !telemetry.eligibleForChallenges || outcome === 'lost') {
    return {
      def,
      state: 'failed',
      previouslyCompleted,
      progressLabel: !telemetry?.eligibleForChallenges ? 'Modifier/Debug ineligible' : 'Defeat',
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
    case 'noLivesLost': {
      const livesLost = isNonNegFinite(telemetry.livesLost) ? Math.floor(telemetry.livesLost) : null;
      failed = livesLost === null || livesLost > 0 || safeLives < BALANCE.startingLives;
      progressLabel =
        livesLost === null
          ? 'Invalid lives'
          : livesLost > 0
            ? `${livesLost} lost`
            : `${safeLives}/${BALANCE.startingLives} lives`;
      break;
    }
    case 'minLivesRemaining':
      failed = safeLives < cond.minLives;
      progressLabel = `${safeLives}/${cond.minLives}+ lives`;
      break;
    case 'forbiddenTowerTypes': {
      const builtMap = getSafeCountMap(telemetry.towersBuiltByType);
      failed = countForbiddenTowersBuilt(builtMap, cond.forbidden) > 0;
      progressLabel = failed ? 'Banned tower built' : 'Clean';
      break;
    }
    case 'allowedTowerTypes': {
      const builtMap = getSafeCountMap(telemetry.towersBuiltByType);
      failed = hasDisallowedTowerBuilt(builtMap, cond.allowed);
      progressLabel = failed ? 'Disallowed tower built' : 'Arsenal intact';
      break;
    }
    case 'maxTowersBuilt': {
      const validBuilt = isNonNegFinite(telemetry.towersBuilt);
      const built = validBuilt ? Math.floor(telemetry.towersBuilt) : 0;
      failed = !validBuilt || built > cond.maxCount;
      progressLabel = validBuilt ? `${built}/${cond.maxCount} towers` : `Invalid/${cond.maxCount} towers`;
      break;
    }
    case 'maxPeakTowers': {
      const validPeak = isNonNegFinite(telemetry.peakTowersActive);
      const peak = validPeak ? Math.floor(telemetry.peakTowersActive) : 0;
      const active = isNonNegFinite(telemetry.activeTowers) ? Math.floor(telemetry.activeTowers) : 0;
      failed = !validPeak || peak > cond.maxCount;
      progressLabel = !validPeak
        ? `Peak ?/${cond.maxCount}`
        : failed
          ? `Peak ${peak}/${cond.maxCount}`
          : `${active}/${cond.maxCount} active`;
      break;
    }
    case 'maxTowerTier': {
      const validTier = isNonNegFinite(telemetry.maxTowerTierBuilt);
      const maxTier = validTier ? Math.floor(telemetry.maxTowerTierBuilt) : 0;
      failed = !validTier || maxTier > cond.maxTier;
      progressLabel = validTier ? `Max T${maxTier}/T${cond.maxTier}` : `Max T?/T${cond.maxTier}`;
      break;
    }
    case 'maxGoldSpent': {
      const validSpent = isNonNegFinite(telemetry.grossGoldSpent);
      const spent = validSpent ? Math.floor(telemetry.grossGoldSpent) : 0;
      failed = !validSpent || spent > cond.maxGold;
      progressLabel = validSpent ? `${spent}/${cond.maxGold}g` : `Invalid/${cond.maxGold}g`;
      break;
    }
    case 'noAbilities': {
      const casts = isNonNegFinite(telemetry.abilitiesCastTotal)
        ? Math.floor(telemetry.abilitiesCastTotal)
        : null;
      failed = casts === null || casts > 0;
      progressLabel = casts === null ? 'Invalid casts' : failed ? `${casts} cast` : '0 abilities';
      break;
    }
    case 'noTowerSelling': {
      const sold = isNonNegFinite(telemetry.towersSold) ? Math.floor(telemetry.towersSold) : null;
      failed = sold === null || sold > 0;
      progressLabel = sold === null ? 'Invalid sells' : failed ? `${sold} sold` : '0 sold';
      break;
    }
    case 'combatSpeedOnly': {
      const minSpeed = telemetry.minCombatSpeed;
      if (minSpeed === null) {
        const currSpeed =
          typeof telemetry.currentSpeed === 'number' && Number.isFinite(telemetry.currentSpeed)
            ? telemetry.currentSpeed
            : 0;
        failed = false;
        progressLabel =
          currSpeed >= cond.requiredSpeed
            ? `${cond.requiredSpeed}x armed`
            : `Set ${cond.requiredSpeed}x before W1`;
      } else if (typeof minSpeed === 'number' && Number.isFinite(minSpeed)) {
        failed = minSpeed < cond.requiredSpeed;
        progressLabel = failed ? `Dropped to ${minSpeed}x` : `${cond.requiredSpeed}x locked`;
      } else {
        failed = true;
        progressLabel = 'Speed invalid';
      }
      break;
    }
    case 'minEarlyWaves': {
      const validEarly = isNonNegFinite(telemetry.earlyWavesCalled);
      const earlyCalled = validEarly ? Math.floor(telemetry.earlyWavesCalled) : 0;
      const maxWave = isNonNegFinite(telemetry.maxWaveReached)
        ? Math.floor(telemetry.maxWaveReached)
        : 0;
      const storyWaves = isNonNegFinite(telemetry.storyWaveCount)
        ? Math.floor(telemetry.storyWaveCount)
        : 0;
      const maxRemaining =
        maxWave === 0 ? Math.max(0, storyWaves - 1) : Math.max(0, storyWaves - maxWave);
      failed = !validEarly || earlyCalled + maxRemaining < cond.minCount;
      progressLabel = validEarly
        ? `${earlyCalled}/${cond.minCount} early`
        : `Invalid/${cond.minCount} early`;
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
  if (!level || typeof level.id !== 'string' || level.id.length === 0) return [];
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
  private readonly storyWaveCount: number;
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
    this.storyWaveCount = Array.isArray(level?.waves) ? level.waves.length : 0;
    this.modifiers = resolveRunModifiers(modifiers);
    if (isAdvantageousModifiers(this.modifiers)) {
      this.eligibleForChallenges = false;
    }
    const baseStartingGold = Number.isFinite(level?.startingGold) ? Math.max(0, level.startingGold) : 0;
    this.expectedGold = Math.round(baseStartingGold * this.modifiers.startingGoldMultiplier);
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
        this.towersCleansed += Array.isArray(ev.cleansedTowerIds) ? ev.cleansedTowerIds.length : 0;
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
          } else if (ev.waveIndex - 1 < this.storyWaveCount) {
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
        if (this.endlessEntered || ev.waveIndex >= this.storyWaveCount) {
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
          this.storyWavesCompleted < this.storyWaveCount ||
          this.lastCompletedWaveIndex !== this.storyWaveCount - 1
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
      levelId: typeof this.level?.id === 'string' ? this.level.id : '',
      levelIndex:
        typeof this.level?.index === 'number' && Number.isFinite(this.level.index)
          ? Math.max(0, Math.floor(this.level.index))
          : 0,
      storyWaveCount: this.storyWaveCount,
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
