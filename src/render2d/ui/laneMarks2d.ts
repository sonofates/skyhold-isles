/**
 * "They come from here": a small bobbing chevron with the foe count over each cave (and dedicated
 * flyer entry) that the upcoming wave actually uses, shown before every wave while the next wave
 * can be called (before wave 1, between waves, and during the early-call window) and hidden as soon
 * as the wave starts spawning. Data-driven from the wave's groups and the island's paths. DOM +
 * CSS, pointer-transparent; Reduced motion: no bobbing.
 */
import './laneMarks2d.css';
import { t } from '../../i18n/index.ts';
import { userUiScale, type Rect } from '../uiLayout.ts';
import { el, glyph } from './dom.ts';

export { pointAlong, SHARED_ENTRANCE_DIST, waveEntranceCounts, waveLaneCounts, type EntranceCount } from '../lanePath.ts';
import { pointAlong } from '../lanePath.ts';

export interface EntranceMarksGate {
  readonly waveState: string;
  readonly canStartNextWave: boolean;
  readonly ongoing: boolean;
  readonly overlayOpen: boolean;
}

/**
 * True when entrance markers for the upcoming wave should be shown: before every wave while it can
 * be called (pre-first-wave, between-waves break, early-call window after the active wave finished
 * spawning), and false as soon as a wave starts spawning or an overlay covers the battlefield.
 */
export function shouldShowEntranceMarks(g: EntranceMarksGate): boolean {
  if (!g.ongoing || g.overlayOpen || !g.canStartNextWave) return false;
  return g.waveState === 'preFirstWave' || g.waveState === 'betweenWaves' || g.waveState === 'clearing' || g.waveState === 'allSpawned';
}

/** The painted kit's unit (`--s` in paintedUi.css) at this viewport, css px. */
export function kitUnit(w: number, h: number): number {
  const k = userUiScale();
  return Math.max(8.5, Math.min(0.0095 * w * k, 0.0185 * h * k, 17 * k));
}

/** Screen box of a mark whose chevron points at (x, y): the pill (incl. min 12 px font + 2 px outline) and chevron above it, with the bob. */
export function laneMarkBox(x: number, y: number, s: number): Rect {
  const font = Math.max(12, s * 1.1);
  const pillH = font * 1.45 + 4;
  const h = Math.max(s * 4.9, s * 3.15 + pillH);
  const halfW = Math.max(s * 1.7, font * 1.6 + 2);
  return { x: x - halfW, y: y - h, w: halfW * 2, h };
}

/** Visual clearance (css px) kept between an entrance marker and any HUD card / box it avoids. */
export const LANE_MARK_MARGIN = 6;

/**
 * Where a lane's mark stands: just out of the cave along its road, sliding further along it while
 * it would sit under the next-wave card, the horn, another HUD piece, or off the viewport (pure).
 */
export function laneMarkSpot(
  path: readonly { readonly x: number; readonly z: number }[],
  toScreen: (p: { x: number; z: number }) => { x: number; y: number },
  avoid: readonly Rect[],
  s: number,
  viewport?: { readonly w: number; readonly h: number },
): { x: number; y: number } | null {
  // The first clear spot; when every spot is covered, the least covered (earlier wins ties).
  let best: { x: number; y: number } | null = null;
  let bestA = Infinity;
  const pad = 4;
  const m = LANE_MARK_MARGIN;
  for (const d of [1.6, 2.6, 3.6, 4.8, 6, 7.5, 9, 11, 13, 15, 18]) {
    const p = pointAlong(path, d);
    if (!p) return null;
    const at = toScreen(p);
    const b = laneMarkBox(at.x, at.y, s);
    let a = 0;
    for (const r of avoid) {
      a +=
        Math.max(0, Math.min(b.x + b.w, r.x + r.w + m) - Math.max(b.x, r.x - m)) *
        Math.max(0, Math.min(b.y + b.h, r.y + r.h + m) - Math.max(b.y, r.y - m));
    }
    if (viewport) {
      const ix = Math.max(0, Math.min(b.x + b.w, viewport.w - pad) - Math.max(b.x, pad));
      const iy = Math.max(0, Math.min(b.y + b.h, viewport.h - pad) - Math.max(b.y, pad));
      a += Math.max(0, b.w * b.h - ix * iy);
    }
    // Tolerance avoids IEEE-754 `(x + w) - x < w` false positives rejecting a clean cave-mouth spot.
    if (a <= 1e-3) return at;
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
  /** Dedicated air-entry marker (flyers entering away from ground caves). */
  readonly flying?: boolean;
}

export interface LaneMarks2D {
  /** Every frame; null / empty hides them. */
  update(marks: readonly LaneMark[] | null): void;
  debug(): { shown: number; lanes: number[]; counts: { lane: number; count: number; flying: boolean }[] };
}

export function mountLaneMarks(): LaneMarks2D {
  const pool: { root: HTMLElement; n: HTMLElement; wing: HTMLElement; count: HTMLElement; chev: HTMLElement }[] = [];
  let key = '';
  let shownMarks: { lane: number; count: number; flying: boolean }[] = [];
  const get = (i: number): (typeof pool)[number] => {
    while (pool.length <= i) {
      const wing = glyph('wing');
      wing.style.display = 'none';
      wing.style.width = '0.95em';
      wing.style.height = '0.95em';
      wing.style.verticalAlign = '-0.12em';
      wing.style.marginRight = '0.2em';
      const count = el('span');
      const n = el('span', 'pu-lane-n pu-letter', {}, wing, count);
      const chev = el('span', 'pu-lane-chev');
      const root = el('div', 'pu pu-lane-mark', { 'aria-hidden': 'true', 'data-testid': 'lane2d-mark' }, n, chev);
      // Below the wave / foe info cards (z-index: 24) so a marker can never paint on top of a HUD card.
      root.style.zIndex = '18';
      root.style.display = 'none';
      document.body.append(root);
      pool.push({ root, n, wing, count, chev });
    }
    return pool[i];
  };
  return {
    update(marks) {
      const list = marks ?? [];
      const k = list.map((m) => `${m.flying ? 'a' : 'g'}${m.lane}:${m.count}@${Math.round(m.x)},${Math.round(m.y)}`).join(';');
      if (k === key) return;
      key = k;
      shownMarks = list.map((m) => ({ lane: m.lane, count: m.count, flying: !!m.flying }));
      list.forEach((m, i) => {
        const p = get(i);
        const air = !!m.flying;
        p.root.dataset.kind = air ? 'air' : 'ground';
        p.wing.style.display = air ? 'inline-flex' : 'none';
        p.count.textContent = t('wave.laneCount', { n: m.count });
        // Dedicated air entry: cool sky-blue tint (inline so laneMarks2d.css stays untouched).
        p.n.style.background = air ? 'linear-gradient(#2d78b8, #1a4b7a)' : '';
        p.chev.style.filter = air ? 'hue-rotate(195deg) saturate(1.15) drop-shadow(0 2px 2px rgba(30, 16, 4, 0.5))' : '';
        p.root.style.display = '';
        p.root.style.transform = `translate(${Math.round(m.x)}px, ${Math.round(m.y)}px)`; // i18n-ignore (css)
      });
      for (let i = list.length; i < pool.length; i++) pool[i].root.style.display = 'none';
    },
    debug: () => ({ shown: shownMarks.length, lanes: shownMarks.map((m) => m.lane), counts: shownMarks }),
  };
}
