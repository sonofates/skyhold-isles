import type { EventBus } from '../core/eventBus.ts';
import type { EnemyType } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import type { LevelDef } from '../data/levels/index.ts';

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
}

export function computeEarlyCallBonus(
  remainingCountdownSec: number,
  isClearingWave = false,
): number {
  if (isClearingWave) {
    return BALANCE.earlyWaveBonusMaxGold;
  }
  if (remainingCountdownSec <= 0) {
    return 0;
  }
  const ratio = Math.min(1, remainingCountdownSec / BALANCE.interWaveCountdownSec);
  return Math.max(1, Math.round(ratio * BALANCE.earlyWaveBonusMaxGold));
}

export function buildWaveSpawnQueue(level: LevelDef, waveIndex: number): QueuedSpawn[] {
  const wave = level.waves[waveIndex];
  if (!wave) return [];

  const queue: QueuedSpawn[] = [];
  for (let g = 0; g < wave.groups.length; g++) {
    const group = wave.groups[g];
    for (let i = 0; i < group.count; i++) {
      queue.push({
        enemyType: group.enemyType,
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

export class WaveSystem {
  private readonly level: LevelDef;
  private readonly events: EventBus;

  state: WaveState = 'preFirstWave';
  currentWaveIndex = -1;
  interWaveTimer = 0;
  waveElapsed = 0;
  pendingClearBonus = 0;

  private spawnQueue: QueuedSpawn[] = [];
  private spawnCursor = 0;

  constructor(level: LevelDef, events: EventBus) {
    this.level = level;
    this.events = events;
  }

  get totalWaves(): number {
    return this.level.waves.length;
  }

  get currentWaveOneBased(): number {
    return Math.max(0, this.currentWaveIndex + 1);
  }

  canStartNextWave(): boolean {
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
    if (this.state === 'clearing') {
      return computeEarlyCallBonus(BALANCE.interWaveCountdownSec, true);
    }
    return 0;
  }

  getNextWavePreview(): WavePreview | null {
    const nextIdx = this.state === 'preFirstWave' ? 0 : this.currentWaveIndex + 1;
    if (nextIdx < 0 || nextIdx >= this.level.waves.length) {
      return null;
    }

    const wave = this.level.waves[nextIdx];
    const counts = new Map<EnemyType, number>();
    const order: EnemyType[] = [];

    for (let g = 0; g < wave.groups.length; g++) {
      const grp = wave.groups[g];
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
      items.push({ enemyType: type, count: counts.get(type) ?? 0 });
    }

    return {
      waveOneBased: nextIdx + 1,
      items,
    };
  }

  startNextWave(onAwardGold: (amount: number) => void): boolean {
    if (!this.canStartNextWave()) return false;

    const earlyBonus = this.getEarlyCallBonus();
    if (earlyBonus > 0) {
      onAwardGold(earlyBonus);
    }

    this.currentWaveIndex++;
    this.spawnQueue = buildWaveSpawnQueue(this.level, this.currentWaveIndex);
    this.spawnCursor = 0;
    this.waveElapsed = 0;
    this.interWaveTimer = 0;
    this.state = 'spawning';

    this.events.emit('waveStarted', {
      waveIndex: this.currentWaveIndex,
      totalWaves: this.totalWaves,
      earlyBonus,
    });
    return true;
  }

  skipToWave(waveOneBased: number): boolean {
    if (this.totalWaves <= 0) return false;
    const clampedIdx = Math.max(0, Math.min(this.totalWaves - 1, Math.floor(waveOneBased) - 1));
    this.pendingClearBonus = 0;
    this.interWaveTimer = 0;
    this.currentWaveIndex = clampedIdx - 1;
    this.state = 'preFirstWave';
    return this.startNextWave(() => {});
  }

  getCurrentWaveHpScale(): number {
    const base = this.level.enemyHpScale ?? 1;
    const growth = this.level.waveHpGrowth ?? 0;
    const w = Math.max(0, this.currentWaveIndex);
    return base * (1 + w * growth);
  }

  update(
    dt: number,
    getActiveEnemiesCount: () => number,
    onSpawn: (type: EnemyType, hpScale: number) => void,
    onAwardGold: (amount: number) => void,
    onAllClearedWin: () => void,
  ): void {
    if (this.state === 'finished' || this.state === 'preFirstWave') {
      return;
    }

    if (this.state === 'spawning') {
      this.waveElapsed += dt;
      const hpScale = this.getCurrentWaveHpScale();
      while (
        this.spawnCursor < this.spawnQueue.length &&
        this.spawnQueue[this.spawnCursor].spawnTime <= this.waveElapsed
      ) {
        onSpawn(this.spawnQueue[this.spawnCursor].enemyType, hpScale);
        this.spawnCursor++;
      }

      if (this.spawnCursor >= this.spawnQueue.length) {
        const wave = this.level.waves[this.currentWaveIndex];
        this.pendingClearBonus += wave.clearBonus;
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
        const bonus = this.pendingClearBonus;
        this.pendingClearBonus = 0;
        if (bonus > 0) {
          onAwardGold(bonus);
        }
        this.events.emit('waveCompleted', {
          waveIndex: this.currentWaveIndex,
          bonus,
        });
        this.state = 'betweenWaves';
        this.interWaveTimer = BALANCE.interWaveCountdownSec;
      }
      return;
    }

    if (this.state === 'allSpawned') {
      if (getActiveEnemiesCount() === 0) {
        const bonus = this.pendingClearBonus;
        this.pendingClearBonus = 0;
        if (bonus > 0) {
          onAwardGold(bonus);
        }
        this.events.emit('waveCompleted', {
          waveIndex: this.currentWaveIndex,
          bonus,
        });
        this.state = 'finished';
        onAllClearedWin();
      }
    }
  }
}
