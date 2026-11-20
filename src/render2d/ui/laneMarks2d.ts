/**
 * "They come from here": on islands with more than one cave, a small bobbing red chevron with the
 * foe count over each cave the next wave will march out of, shown together with the next-wave
 * card (before the first wave, between waves, paused). Data-driven from the wave's groups and the
 * island's ground paths. DOM + CSS, pointer-transparent; Reduced motion: no bobbing.
 */
import './laneMarks2d.css';
import { t } from '../../i18n/index.ts';
import { userUiScale, type Rect } from '../uiLayout.ts';
import { el } from './dom.ts';

export { pointAlong, waveLaneCounts } from '../lanePath.ts';
import { pointAlong } from '../lanePath.ts';

/** The painted kit's unit (`--s` in paintedUi.css) at this viewport, css px. */
export function kitUnit(w: number, h: number): number {
  const k = userUiScale();
  return Math.max(8.5, Math.min(0.0095 * w * k, 0.0185 * h * k, 17 * k));
}

/** Screen box of a mark whose chevron points at (x, y): the pill and chevron above it, with the bob. */
export function laneMarkBox(x: number, y: number, s: number): Rect {
  return { x: x - s * 1.7, y: y - s * 4.9, w: s * 3.4, h: s * 4.9 };
}

/**
 * Where a lane's mark stands: just out of the cave along its road, sliding further along it while
 * it would sit under the next-wave card, the horn or another HUD piece (pure).
 */
export function laneMarkSpot(
  path: readonly { readonly x: number; readonly z: number }[],
  toScreen: (p: { x: number; z: number }) => { x: number; y: number },
  avoid: readonly Rect[],
  s: number,
): { x: number; y: number } | null {
  // The first clear spot; when every spot is covered, the least covered (earlier wins ties).
  let best: { x: number; y: number } | null = null;
  let bestA = Infinity;
  for (const d of [1.6, 2.6, 3.6, 4.8, 6, 7.5, 9, 11]) {
    const p = pointAlong(path, d);
    if (!p) return null;
    const at = toScreen(p);
    const b = laneMarkBox(at.x, at.y, s);
    let a = 0;
    for (const r of avoid) a += Math.max(0, Math.min(b.x + b.w, r.x + r.w) - Math.max(b.x, r.x)) * Math.max(0, Math.min(b.y + b.h, r.y + r.h) - Math.max(b.y, r.y));
    if (a === 0) return at;
    if (a < bestA) {
      bestA = a;
      best = at;
    }
  }
  return best;
}

export interface LaneMark {
  readonly lane: number;
  /** Screen (css px) point the chevron points down at. */
  readonly x: number;
  readonly y: number;
  readonly count: number;
}

export interface LaneMarks2D {
  /** Every frame; null / empty hides them. */
  update(marks: readonly LaneMark[] | null): void;
  debug(): { shown: number; lanes: number[] };
}

export function mountLaneMarks(): LaneMarks2D {
  const pool: { root: HTMLElement; n: HTMLElement }[] = [];
  let key = '';
  let shownLanes: number[] = [];
  const get = (i: number): { root: HTMLElement; n: HTMLElement } => {
    while (pool.length <= i) {
      const n = el('span', 'pu-lane-n pu-letter');
      const root = el('div', 'pu pu-lane-mark', { 'aria-hidden': 'true', 'data-testid': 'lane2d-mark' }, n, el('span', 'pu-lane-chev'));
      root.style.display = 'none';
      document.body.append(root);
      pool.push({ root, n });
    }
    return pool[i];
  };
  return {
    update(marks) {
      const list = marks ?? [];
      const k = list.map((m) => `${m.lane}:${m.count}@${Math.round(m.x)},${Math.round(m.y)}`).join(';');
      if (k === key) return;
      key = k;
      shownLanes = list.map((m) => m.lane);
      list.forEach((m, i) => {
        const p = get(i);
        p.n.textContent = t('wave.laneCount', { n: m.count });
        p.root.style.display = '';
        p.root.style.transform = `translate(${Math.round(m.x)}px, ${Math.round(m.y)}px)`; // i18n-ignore (css)
      });
      for (let i = list.length; i < pool.length; i++) pool[i].root.style.display = 'none';
    },
    debug: () => ({ shown: shownLanes.length, lanes: shownLanes }),
  };
}
