/**
 * New-foe heads-up: which foe types the player has already faced (own UI key, seeded from the
 * islands they cleared so veterans see no recap), a **New** tag on unseen foes in the next-wave
 * card, and a short toast with the counter tip when a new foe first marches. Data-driven from the
 * wave groups, so new enemy types need nothing here.
 */
import './newFoes2d.css';
import type { EnemyType } from '../../core/types.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import { enemyCounter, enemyName } from '../../i18n/data.ts';
import { t } from '../../i18n/index.ts';
import { el, img } from './dom.ts';

export const FOES_SEEN_KEY = 'skyhold2d_foes_seen_v1';

/** Foe types in a wave (spawn order, no repeats). */
export function waveTypes(level: Pick<LevelDef, 'waves'>, waveIndex: number): EnemyType[] {
  const w = level.waves[waveIndex];
  if (!w) return [];
  const out: EnemyType[] = [];
  for (const g of w.groups) if (!out.includes(g.enemyType)) out.push(g.enemyType);
  return out;
}

/** Every foe type of the islands already cleared (a veteran's seed). */
export function seenFromCleared(levels: readonly Pick<LevelDef, 'waves'>[], cleared: (index: number) => boolean): Set<EnemyType> {
  const s = new Set<EnemyType>();
  levels.forEach((l, i) => {
    if (!cleared(i)) return;
    for (let w = 0; w < l.waves.length; w++) for (const ty of waveTypes(l, w)) s.add(ty);
  });
  return s;
}

export class FoesSeen {
  private readonly seen: Set<EnemyType>;

  constructor(seed: Iterable<EnemyType>) {
    this.seen = new Set(seed);
    try {
      const raw = localStorage.getItem(FOES_SEEN_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown) : null;
      if (Array.isArray(arr)) for (const v of arr) if (typeof v === 'string') this.seen.add(v as EnemyType);
    } catch {
      // corrupt / private mode: start from the seed
    }
  }

  has(t: EnemyType): boolean {
    return this.seen.has(t);
  }

  /** Records the types; returns the ones that were new. */
  mark(types: readonly EnemyType[]): EnemyType[] {
    const fresh = types.filter((ty) => !this.seen.has(ty));
    if (fresh.length === 0) return fresh;
    for (const ty of fresh) this.seen.add(ty);
    try {
      localStorage.setItem(FOES_SEEN_KEY, JSON.stringify([...this.seen]));
    } catch {
      // ignore
    }
    return fresh;
  }
}

export interface NewFoeToast {
  show(types: readonly EnemyType[]): void;
  update(dt: number, hidden: boolean): void;
  debug(): { shown: boolean; types: string[] };
}

/** A parchment toast under the top HUD row: portrait, "New foe: Name", how to stop it. */
export function mountNewFoeToast(portrait: (type: EnemyType) => string | null): NewFoeToast {
  const box = el('div', 'pu pu-newfoe', { role: 'status', 'aria-live': 'polite', 'data-testid': 'newfoe2d' });
  box.style.display = 'none';
  document.body.append(box);
  let left = 0;
  let types: EnemyType[] = [];
  return {
    show(list) {
      if (list.length === 0) return;
      types = [...list];
      box.replaceChildren(
        ...list.slice(0, 2).map((ty) => {
          const url = portrait(ty);
          const counter = enemyCounter(ty);
          return el(
            'div',
            'pu-newfoe-row',
            {},
            el('span', 'pu-newfoe-face', {}, url ? img(url) : null),
            el('div', 'pu-newfoe-text', {}, el('div', 'pu-newfoe-head pu-ink', {}, el('span', 'pu-newfoe-tag pu-letter', {}, t('foe.new')), enemyName(ty)), counter ? el('div', 'pu-newfoe-tip pu-ink-soft', {}, counter) : null),
          );
        }),
      );
      left = 6.5;
      box.classList.remove('in');
      void box.offsetWidth;
      box.classList.add('in');
    },
    update(dt, hidden) {
      if (left > 0) left -= dt;
      box.style.display = left > 0 && !hidden ? '' : 'none';
    },
    debug: () => ({ shown: left > 0, types }),
  };
}
