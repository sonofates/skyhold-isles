import type { EventBus } from '../core/eventBus.ts';
import type { EnemyType } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import {
  combineEndlessMutators,
  ENDLESS_UNSCALED_TYPES,
  endlessMutatorsAt,
  mutatedGroupCount,
  NO_ENDLESS_MUTATORS,
  poolWeight,
  type EndlessMutatorEffects,
} from '../data/endlessMutators.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import { groundLaneCount, type LevelDef, type WaveDef, type WaveGroupDef } from '../data/levels/index.ts';

export type WaveState =
  | 'preFirstWave'
  | 'spawning'
  | 'clearing'
  | 'betweenWaves'
  | 'allSpawned'
  | 'finished';

export interface WavePreviewItem {
  readonly enemyType: EnemyType;
  readonly count: number;
  /** How many of `count` are Empowered elites (omitted when none). */
  readonly eliteCount?: number;
}

export interface WavePreview {
  readonly waveOneBased: number;
  readonly items: readonly WavePreviewItem[];
}

export interface QueuedSpawn {
  readonly enemyType: EnemyType;
  readonly spawnTime: number;
  readonly groupOrder: number;
  readonly seqInGroup: number;
  readonly elite: boolean;
  readonly lane: number;
}

export function computeEarlyCallBonus(
  remainingCountdownSec: number,
  isClearingWave = false,
): number {
  if (isClearingWave) {
    return BALANCE.earlyWaveBonusMaxGold;
  }
  if (!Number.isFinite(remainingCountdownSec) || remainingCountdownSec <= 0) {
    return 0;
  }
  const ratio = Math.min(1, remainingCountdownSec / BALANCE.interWaveCountdownSec);
  return Math.max(1, Math.round(ratio * BALANCE.earlyWaveBonusMaxGold));
}

/** Endless spotlight rotation (one pair per endless wave, cycling). */
export const ENDLESS_SPOTLIGHTS: readonly (readonly EnemyType[])[] = [
  ['warden', 'golem'],
  ['burrower', 'mite'],
  ['carrier', 'blinker'],
  ['golem', 'mite'],
  ['warden', 'burrower'],
  ['blinker', 'carrier'],
  ['hexer', 'mite'],
  ['golem', 'hexer'],
];

const ENDLESS_SPOTLIGHT_TUNING: Partial<
  Record<EnemyType, { base: number; perWave: number; max: number; interval: number }>
> = {
  warden: { base: 2, perWave: 0.35, max: 8, interval: 1.3 },
  golem: { base: 2, perWave: 0.45, max: 12, interval: 1.1 },
  burrower: { base: 3, perWave: 0.6, max: 16, interval: 0.8 },
  mite: { base: 12, perWave: 2.4, max: 48, interval: 0.2 },
  carrier: { base: 2, perWave: 0.4, max: 10, interval: 1.2 },
  blinker: { base: 4, perWave: 0.7, max: 18, interval: 0.6 },
  hexer: { base: 2, perWave: 0.35, max: 9, interval: 1.4 },
};

/**
 * Deterministically generates an escalating wave definition for Endless Mode beyond `level.waves`.
 */
export function buildEndlessWaveDef(waveIndex: number, level: LevelDef): WaveDef {
  const rawOffset = Number.isFinite(waveIndex) ? Math.floor(waveIndex) - level.waves.length : 0;
  const offset = Math.max(0, rawOffset);
  const scaleFactor = 1 + Math.max(0, level.waves.length - 10) * 0.05;

  const groups: WaveGroupDef[] = [
    {
      enemyType: 'grunt',
      count: Math.min(36, Math.round((9 + offset * 1.8) * scaleFactor) + (offset % 3 === 0 ? 4 : 0)),
      spawnInterval: Math.max(0.18, +(0.58 - offset * 0.025).toFixed(2)),
      startDelay: 0,
    },
    {
      enemyType: 'runner',
      count: Math.min(36, Math.round((7 + offset * 1.6) * scaleFactor) + (offset % 3 === 1 ? 5 : 0)),
      spawnInterval: Math.max(0.18, +(0.42 - offset * 0.02).toFixed(2)),
      startDelay: 0.8,
    },
    {
      enemyType: 'splitter',
      count: Math.min(24, Math.round((3 + offset * 1.1) * scaleFactor)),
      spawnInterval: Math.max(0.18, +(0.72 - offset * 0.025).toFixed(2)),
      startDelay: 1.4,
    },
    {
      enemyType: 'flyer',
      count: Math.min(34, Math.round((6 + offset * 1.5) * scaleFactor) + (offset % 2 === 1 ? 3 : 0)),
      spawnInterval: Math.max(0.18, +(0.54 - offset * 0.022).toFixed(2)),
      startDelay: 1.8,
    },
    {
      enemyType: 'brute',
      count: Math.min(26, Math.round((4 + offset * 1.0) * scaleFactor) + (offset % 3 === 2 ? 3 : 0)),
      spawnInterval: Math.max(0.18, +(0.88 - offset * 0.035).toFixed(2)),
      startDelay: 2.0,
    },
    {
      enemyType: 'healer',
      count: Math.min(12, Math.round((2 + offset * 0.55) * scaleFactor)),
      spawnInterval: Math.max(0.18, +(1.2 - offset * 0.045).toFixed(2)),
      startDelay: 2.6,
    },
  ];

  // Rotating "spotlight" pair of newer archetypes so every endless wave plays differently.
  const spotlightStart = groups.length;
  const spotlight = ENDLESS_SPOTLIGHTS[offset % ENDLESS_SPOTLIGHTS.length];
  for (let k = 0; k < spotlight.length; k++) {
    const type = spotlight[k];
    const tuning = ENDLESS_SPOTLIGHT_TUNING[type];
    if (!tuning) continue;
    groups.push({
      enemyType: type,
      count: Math.min(tuning.max, Math.round((tuning.base + offset * tuning.perWave) * scaleFactor)),
      spawnInterval: Math.max(0.18, +(tuning.interval - offset * 0.02).toFixed(2)),
      startDelay: 1.0 + k * 1.1,
      // From the 4th endless wave on, the lead spotlight group arrives Empowered.
      elite: offset >= 3 && k === 0 && type !== 'mite',
    });
  }

  // Boss / Tempest groups below are not spotlights (Vanguard must not empower them).
  const spotlightEnd = groups.length;

  if ((offset + 1) % 5 === 0) {
    const bossTier = Math.floor(offset / 5);
    // Every second boss wave brings a Tempest Colossus to lead the Dreadnoughts.
    if ((offset + 1) % 10 === 0) {
      groups.push({ enemyType: 'tempest', count: 1, spawnInterval: 1, startDelay: 2.6 });
    }
    groups.push({
      enemyType: 'boss',
      count: Math.min(12, (offset + 1) % 10 === 0 ? bossTier : 1 + bossTier),
      spawnInterval: Math.max(0.18, +(2.4 - bossTier * 0.25).toFixed(2)),
      startDelay: 3.2,
    });
  }

  // Escalating mutators (every ENDLESS_MUTATOR_INTERVAL endless waves) reshape the groups.
  const fx = endlessMutatorEffectsAt(waveIndex, level);
  let mutatedGroups = groups;
  if (fx !== NO_ENDLESS_MUTATORS) {
    const counts = groups.map((g) =>
      ENDLESS_UNSCALED_TYPES.includes(g.enemyType)
        ? g.count
        : mutatedGroupCount(g.count, ENEMY_DEFS[g.enemyType].flying, fx),
    );
    // Extra units from count mutators must still fit the enemy pool (incl. mid-wave spawns):
    // shrink the growth proportionally when the stacked wave would overflow it.
    let baseWorst = 0;
    let mutWorst = 0;
    for (let i = 0; i < groups.length; i++) {
      const w = poolWeight(groups[i].enemyType);
      baseWorst += groups[i].count * w;
      mutWorst += counts[i] * w;
    }
    const budget = BALANCE.pools.maxEnemies;
    if (mutWorst > budget && mutWorst > baseWorst) {
      const f = Math.max(0, budget - baseWorst) / (mutWorst - baseWorst);
      for (let i = 0; i < groups.length; i++) {
        counts[i] = groups[i].count + Math.floor((counts[i] - groups[i].count) * f);
      }
    }
    mutatedGroups = groups.map((g, i) => {
      const count = counts[i];
      const elite =
        g.elite === true ||
        (fx.allSpotlightElite &&
          i >= spotlightStart &&
          i < spotlightEnd &&
          g.enemyType !== 'mite');
      return count === g.count && elite === (g.elite === true) ? g : { ...g, count, elite };
    });
  }

  // Islands with extra spawn lanes: deal the groups round-robin across every lane.
  const laneCount = groundLaneCount(level);
  const lanedGroups =
    laneCount > 1
      ? mutatedGroups.map((g, i) => ({ ...g, lane: (i + offset) % laneCount }))
      : mutatedGroups;

  const lastStoryBonus = level.waves[level.waves.length - 1]?.clearBonus ?? 40;
  const clearBonus = Math.min(
    10_000,
    Math.round(Math.max(40, lastStoryBonus * 0.75) + offset * 5 + ((offset + 1) % 5 === 0 ? 25 : 0)),
  );

  return { groups: lanedGroups, clearBonus };
}

/** Aggregated endless mutator effects for wave `waveIndex` (neutral for story waves). */
export function endlessMutatorEffectsAt(waveIndex: number, level: LevelDef): EndlessMutatorEffects {
  const offset = waveIndex - level.waves.length;
  if (offset < 0) return NO_ENDLESS_MUTATORS;
  const list = endlessMutatorsAt(offset, level.index);
  return list.length === 0 ? NO_ENDLESS_MUTATORS : combineEndlessMutators(list);
}

function buildWaveQueueFromDef(wave: WaveDef): QueuedSpawn[] {
  const queue: QueuedSpawn[] = [];
  for (let g = 0; g < wave.groups.length; g++) {
    const group = wave.groups[g];
    for (let i = 0; i < group.count; i++) {
      queue.push({
        enemyType: group.enemyType,
        elite: group.elite === true,
        lane: group.lane ?? 0,
        spawnTime: group.startDelay + i * group.spawnInterval,
        groupOrder: g,
        seqInGroup: i,
      });
    }
  }

  queue.sort(
    (a, b) =>
      a.spawnTime - b.spawnTime ||
      a.groupOrder - b.groupOrder ||
      a.seqInGroup - b.seqInGroup,
  );
  return queue;
}

export function buildWaveSpawnQueue(
  level: LevelDef,
  waveIndex: number,
  endless = false,
): QueuedSpawn[] {
  if (waveIndex < 0) return [];
  const wave =
    waveIndex < level.waves.length
      ? level.waves[waveIndex]
      : endless
        ? buildEndlessWaveDef(waveIndex, level)
        : undefined;
  if (!wave) return [];
  return buildWaveQueueFromDef(wave);
}

/** Between-wave countdown while auto-wave is enabled. */
const AUTO_WAVE_COUNTDOWN_SEC = 0.75;

export class WaveSystem {
  private readonly level: LevelDef;
  private readonly events: EventBus;

  state: WaveState = 'preFirstWave';
  currentWaveIndex = -1;
  interWaveTimer = 0;
  waveElapsed = 0;
  pendingClearBonus = 0;
  endlessMode = false;
  autoWave = false;

  private spawnQueue: QueuedSpawn[] = [];
  private mutatorCacheIndex = -1;
  private mutatorCache: EndlessMutatorEffects = NO_ENDLESS_MUTATORS;
  private spawnCursor = 0;
  private currentWaveClearBonus = 0;
  /**
   * Seconds the between-wave countdown was cut short because auto-wave is on. Added back when
   * auto-wave is switched off so the manual countdown (and early-call bonus) is not lost.
   */
  private autoShortenedBy = 0;

  constructor(level: LevelDef, events: EventBus) {
    this.level = level;
    this.events = events;
  }

  get isEndless(): boolean {
    return this.endlessMode;
  }

  get totalWaves(): number {
    if (this.endlessMode) {
      return Math.max(this.level.waves.length, this.currentWaveIndex + 1);
    }
    return this.level.waves.length;
  }

  get currentWaveOneBased(): number {
    return Math.max(0, this.currentWaveIndex + 1);
  }

  getAutoShortenedBy(): number {
    return this.autoShortenedBy;
  }

  getSpawnCursor(): number {
    return this.spawnCursor;
  }

  getCurrentWaveClearBonus(): number {
    return this.currentWaveClearBonus;
  }

  setAutoWave(enabled: boolean): void {
    const wasEnabled = this.autoWave;
    this.autoWave = enabled;
    if (this.state !== 'betweenWaves' || wasEnabled === enabled) return;
    if (enabled) {
      if (this.interWaveTimer > AUTO_WAVE_COUNTDOWN_SEC) {
        this.autoShortenedBy += this.interWaveTimer - AUTO_WAVE_COUNTDOWN_SEC;
        this.interWaveTimer = AUTO_WAVE_COUNTDOWN_SEC;
      }
    } else {
      this.interWaveTimer += this.autoShortenedBy;
      this.autoShortenedBy = 0;
    }
  }

  /** Starts a between-wave countdown honouring auto-wave while remembering the manual length. */
  private beginCountdown(manualSec: number, autoSec: number): void {
    if (this.autoWave) {
      this.interWaveTimer = autoSec;
      this.autoShortenedBy = Math.max(0, manualSec - autoSec);
    } else {
      this.interWaveTimer = manualSec;
      this.autoShortenedBy = 0;
    }
  }

  /** Stat mutators for the wave in progress (neutral outside endless). */
  getEndlessMutatorEffects(): EndlessMutatorEffects {
    if (!this.endlessMode || this.currentWaveIndex < this.level.waves.length) return NO_ENDLESS_MUTATORS;
    if (this.mutatorCacheIndex !== this.currentWaveIndex) {
      this.mutatorCacheIndex = this.currentWaveIndex;
      this.mutatorCache = endlessMutatorEffectsAt(this.currentWaveIndex, this.level);
    }
    return this.mutatorCache;
  }

  /**
   * Starts an Endless run from wave 1 (island card → Endless): the story waves play without a
   * victory stop and the generated endless waves follow.
   */
  startEndlessFromStart(): void {
    if (this.state !== 'preFirstWave') return;
    this.endlessMode = true;
  }

  getRewardMultiplier(): number {
    if (this.currentWaveIndex < this.level.waves.length) {
      return 1;
    }
    const step = this.currentWaveIndex - this.level.waves.length + 1;
    return Math.max(0.32, 1 / (1 + step * 0.14));
  }

  enterEndlessMode(): number {
    this.endlessMode = true;
    this.currentWaveIndex = Math.max(this.currentWaveIndex, this.level.waves.length - 1);
    this.pendingClearBonus = 0;
    this.currentWaveClearBonus = 0;
    this.spawnQueue.length = 0;
    this.spawnCursor = 0;
    this.waveElapsed = 0;
    this.state = 'betweenWaves';
    this.beginCountdown(5.0, 0.8);
    const startingWave = this.currentWaveIndex + 2;
    this.events.emit('endlessEntered', { startingWave });
    return startingWave;
  }

  /** Transitions the wave state cleanly to `'finished'` when a story run is forced-won. */
  markFinished(): void {
    this.currentWaveIndex = Math.max(this.currentWaveIndex, this.level.waves.length - 1);
    this.pendingClearBonus = 0;
    this.currentWaveClearBonus = 0;
    this.spawnQueue.length = 0;
    this.spawnCursor = 0;
    this.interWaveTimer = 0;
    this.autoShortenedBy = 0;
    this.state = 'finished';
  }

  private getWaveDef(waveIndex: number): WaveDef | null {
    if (waveIndex < 0) return null;
    if (waveIndex < this.level.waves.length) {
      return this.level.waves[waveIndex];
    }
    return this.endlessMode ? buildEndlessWaveDef(waveIndex, this.level) : null;
  }

  canStartNextWave(): boolean {
    if (this.endlessMode) {
      return (
        this.state === 'preFirstWave' ||
        this.state === 'betweenWaves' ||
        this.state === 'clearing' ||
        this.state === 'allSpawned'
      );
    }
    return (
      (this.state === 'preFirstWave' ||
        this.state === 'betweenWaves' ||
        this.state === 'clearing') &&
      this.currentWaveIndex + 1 < this.level.waves.length
    );
  }

  getEarlyCallBonus(): number {
    if (this.state === 'betweenWaves') {
      return computeEarlyCallBonus(this.interWaveTimer, false);
    }
    if (this.state === 'clearing' || (this.endlessMode && this.state === 'allSpawned')) {
      return computeEarlyCallBonus(BALANCE.interWaveCountdownSec, true);
    }
    return 0;
  }

  getNextWavePreview(): WavePreview | null {
    if (this.state === 'finished') return null;
    const nextIdx = this.state === 'preFirstWave' ? 0 : this.currentWaveIndex + 1;
    const wave = this.getWaveDef(nextIdx);
    if (!wave) {
      return null;
    }

    const counts = new Map<EnemyType, number>();
    const eliteCounts = new Map<EnemyType, number>();
    const order: EnemyType[] = [];

    for (let g = 0; g < wave.groups.length; g++) {
      const grp = wave.groups[g];
      if (grp.elite) {
        eliteCounts.set(grp.enemyType, (eliteCounts.get(grp.enemyType) ?? 0) + grp.count);
      }
      if (!counts.has(grp.enemyType)) {
        order.push(grp.enemyType);
        counts.set(grp.enemyType, grp.count);
      } else {
        counts.set(grp.enemyType, counts.get(grp.enemyType)! + grp.count);
      }
    }

    const items: WavePreviewItem[] = [];
    for (let i = 0; i < order.length; i++) {
      const type = order[i];
      const eliteCount = eliteCounts.get(type) ?? 0;
      items.push(
        eliteCount > 0
          ? { enemyType: type, count: counts.get(type) ?? 0, eliteCount }
          : { enemyType: type, count: counts.get(type) ?? 0 },
      );
    }

    return {
      waveOneBased: nextIdx + 1,
      items,
    };
  }

  startNextWave(onAwardGold: (amount: number) => void): boolean {
    if (!this.canStartNextWave()) return false;

    const earlyBonus = this.getEarlyCallBonus();
    const startedWaveIndex = ++this.currentWaveIndex;
    const waveDef = this.getWaveDef(startedWaveIndex);
    this.currentWaveClearBonus = waveDef?.clearBonus ?? 0;
    this.spawnQueue = waveDef ? buildWaveQueueFromDef(waveDef) : [];
    this.spawnCursor = 0;
    this.waveElapsed = 0;
    this.interWaveTimer = 0;
    this.autoShortenedBy = 0;
    this.state = 'spawning';

    if (earlyBonus > 0) {
      onAwardGold(earlyBonus);
    }

    if (this.state === 'spawning' && this.currentWaveIndex === startedWaveIndex) {
      this.events.emit('waveStarted', {
        waveIndex: startedWaveIndex,
        totalWaves: this.totalWaves,
        earlyBonus,
        endless: this.endlessMode,
      });
    }
    return true;
  }

  skipToWave(waveOneBased: number): boolean {
    if (this.totalWaves <= 0 && !this.endlessMode) return false;
    const safeOneBased = Number.isFinite(waveOneBased) ? Math.floor(waveOneBased) : 1;
    const requestedIdx = Math.max(0, safeOneBased - 1);
    const clampedIdx = this.endlessMode
      ? Math.min(10_000, requestedIdx)
      : Math.min(this.level.waves.length - 1, requestedIdx);
    this.pendingClearBonus = 0;
    this.interWaveTimer = 0;
    this.autoShortenedBy = 0;
    this.currentWaveIndex = clampedIdx - 1;
    this.state = 'preFirstWave';
    return this.startNextWave(() => {});
  }

  private computeStoryWaveHpScale(waveIndex: number): number {
    const base = this.level.enemyHpScale ?? 1;
    const growth = this.level.waveHpGrowth ?? 0;
    const w = Math.max(0, waveIndex);
    const linear = base * (1 + w * growth);
    if (w <= 5) {
      return linear;
    }
    return linear * Math.pow(1.032, w - 5);
  }

  getCurrentWaveHpScale(): number {
    const storyCount = this.level.waves.length;
    if (this.currentWaveIndex < storyCount) {
      return this.computeStoryWaveHpScale(this.currentWaveIndex);
    }
    const finalStoryIndex = Math.max(0, storyCount - 1);
    const finalStoryScale = this.computeStoryWaveHpScale(finalStoryIndex);
    const offset = Math.max(0, this.currentWaveIndex - storyCount);
    // Cap endless HP scaling so extreme debug/endless wave skips never overflow IEEE-754 double to Infinity.
    return Math.min(1e12, finalStoryScale * Math.pow(1.22, Math.min(120, offset + 1)));
  }

  update(
    dt: number,
    getActiveEnemiesCount: () => number,
    onSpawn: (type: EnemyType, hpScale: number, elite: boolean, lane: number) => void,
    onAwardGold: (amount: number) => void,
    onAllClearedWin: () => void,
  ): void {
    if (this.state === 'finished' || this.state === 'preFirstWave') {
      return;
    }

    if (this.state === 'spawning') {
      const activeWaveIdx = this.currentWaveIndex;
      this.waveElapsed += dt;
      const hpScale = this.getCurrentWaveHpScale();
      while (
        this.state === 'spawning' &&
        this.currentWaveIndex === activeWaveIdx &&
        this.spawnCursor < this.spawnQueue.length &&
        this.spawnQueue[this.spawnCursor].spawnTime <= this.waveElapsed
      ) {
        const queued = this.spawnQueue[this.spawnCursor++];
        onSpawn(queued.enemyType, hpScale, queued.elite, queued.lane);
      }

      if (
        this.state === 'spawning' &&
        this.currentWaveIndex === activeWaveIdx &&
        this.spawnCursor >= this.spawnQueue.length
      ) {
        this.pendingClearBonus += this.currentWaveClearBonus;
        this.currentWaveClearBonus = 0;
        if (this.currentWaveIndex >= this.totalWaves - 1) {
          this.state = 'allSpawned';
        } else {
          this.state = 'clearing';
        }
      }
    }

    if (this.state === 'betweenWaves') {
      this.interWaveTimer -= dt;
      if (this.interWaveTimer <= 0) {
        this.startNextWave(onAwardGold);
      }
      return;
    }

    this.checkCompletion(getActiveEnemiesCount, onAwardGold, onAllClearedWin);
  }

  checkCompletion(
    getActiveEnemiesCount: () => number,
    onAwardGold: (amount: number) => void,
    onAllClearedWin: () => void,
  ): void {
    if (this.state === 'clearing') {
      if (getActiveEnemiesCount() === 0) {
        const completedWaveIndex = this.currentWaveIndex;
        const bonus = this.pendingClearBonus;
        this.pendingClearBonus = 0;
        this.state = 'betweenWaves';
        this.beginCountdown(BALANCE.interWaveCountdownSec, AUTO_WAVE_COUNTDOWN_SEC);
        if (bonus > 0) {
          onAwardGold(bonus);
        }
        this.events.emit('waveCompleted', {
          waveIndex: completedWaveIndex,
          bonus,
        });
      }
      return;
    }

    if (this.state === 'allSpawned') {
      if (getActiveEnemiesCount() === 0) {
        const completedWaveIndex = this.currentWaveIndex;
        const bonus = this.pendingClearBonus;
        this.pendingClearBonus = 0;
        const wasEndless = this.endlessMode;
        if (wasEndless) {
          this.state = 'betweenWaves';
          this.beginCountdown(BALANCE.interWaveCountdownSec, AUTO_WAVE_COUNTDOWN_SEC);
        } else {
          this.state = 'finished';
        }
        if (bonus > 0) {
          onAwardGold(bonus);
        }
        this.events.emit('waveCompleted', {
          waveIndex: completedWaveIndex,
          bonus,
        });
        if (!wasEndless && this.state === 'finished' && !this.endlessMode) {
          onAllClearedWin();
        }
      }
    }
  }
}
