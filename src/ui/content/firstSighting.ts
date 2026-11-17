import type { EnemyType, TowerType } from '../../core/types.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import { ELITE_SEEN_ID, enemySeenId, towerSeenId, type SeenId } from '../../platform/contentStorage.ts';

export type CardRef =
  | { readonly kind: 'enemy'; readonly type: EnemyType }
  | { readonly kind: 'elite' }
  | { readonly kind: 'tower'; readonly type: TowerType };

interface SeenStore {
  hasSeen(id: SeenId): boolean;
  markSeen(id: SeenId): boolean;
}

/**
 * Collects "never seen before" things (enemy types, the elite variant, newly unlocked towers) and hands
 * them to the card UI in the order they appeared. An id is recorded as seen the moment it is offered, so
 * it can never be queued twice — even if the same foe keeps spawning while the card is up.
 */
export class SightingQueue {
  private readonly queue: CardRef[] = [];

  private readonly store: SeenStore;

  constructor(store: SeenStore) {
    this.store = store;
  }

  offerEnemy(type: EnemyType): boolean {
    return this.offer(enemySeenId(type), { kind: 'enemy', type });
  }

  offerElite(): boolean {
    return this.offer(ELITE_SEEN_ID, { kind: 'elite' });
  }

  offerTower(type: TowerType): boolean {
    return this.offer(towerSeenId(type), { kind: 'tower', type });
  }

  private offer(id: SeenId, ref: CardRef): boolean {
    if (this.store.hasSeen(id)) return false;
    this.store.markSeen(id);
    this.queue.push(ref);
    return true;
  }

  get size(): number {
    return this.queue.length;
  }

  /** Everything queued so far (cleared). */
  drain(): CardRef[] {
    return this.queue.splice(0, this.queue.length);
  }
}

/** Does wave `waveIndex` of `level` contain an elite group? */
export function waveHasElite(level: Pick<LevelDef, 'waves'>, waveIndex: number): boolean {
  const wave = level.waves[waveIndex];
  return wave ? wave.groups.some((g) => g.elite === true) : false;
}
