/**
 * "They come from here": on islands with more than one cave, a small bobbing red chevron with the
 * foe count over each cave the next wave will march out of, shown together with the next-wave
 * card (before the first wave, between waves, paused). Data-driven from the wave's groups and the
 * island's ground paths. DOM + CSS, pointer-transparent; Reduced motion: no bobbing.
 */
import './laneMarks2d.css';
import { t } from '../../i18n/index.ts';
import type { Rect } from '../uiLayout.ts';
import { el } from './dom.ts';

/** Foes per ground lane in a wave (pure). Groups without a lane march from lane 0. */
export function waveLaneCounts(groups: readonly { readonly lane?: number; readonly count: number }[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const g of groups) {
    const lane = g.lane ?? 0;
    out.set(lane, (out.get(lane) ?? 0) + g.count);
  }
  return out;
}

/**
 * A point `dist` world units along a path from its start (just outside the cave mouth, where the
 * marker stands), clamped to the path's end (pure).
 */
export function pointAlong(path: readonly { readonly x: number; readonly z: number }[], dist: number): { x: number; z: number } | null {
  if (path.length === 0) return null;
  let left = dist;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len >= left && len > 0) return { x: a.x + ((b.x - a.x) * left) / len, z: a.z + ((b.z - a.z) * left) / len };
    left -= len;
  }
  const end = path[path.length - 1];
  return { x: end.x, z: end.z };
}

/** The painted kit's unit (`--s` in paintedUi.css) at this viewport, css px. */
export function kitUnit(w: number, h: number): number {
  return Math.max(8.5, Math.min(0.0095 * w, 0.0185 * h, 17));
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
  let first: { x: number; y: number } | null = null;
  for (const d of [1.6, 2.6, 3.6, 4.8, 6]) {
    const p = pointAlong(path, d);
    if (!p) return null;
    const at = toScreen(p);
    first ??= at;
    const b = laneMarkBox(at.x, at.y, s);
    if (!avoid.some((r) => b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y)) return at;
  }
  return first;
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
