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

export { pathLength, pointAlong, primaryWaveEntrance, SHARED_ENTRANCE_DIST, waveEntranceCounts, waveLaneCounts, type EntranceCount } from '../lanePath.ts';
import { pathLength, pointAlong } from '../lanePath.ts';

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

export interface LaneMarkSpot {
  readonly x: number;
  readonly y: number;
  /**
   * Set when the entire path lies off-screen (e.g. after a pan) and the marker is clamped to the
   * viewport edge: radians clockwise from pointing down (0 = down, π/2 = left, -π/2 = right, π = up),
   * pointing toward the off-screen entrance.
   */
  readonly angle?: number;
}

const INITIAL_MARK_DISTS = [1.6, 2.6, 3.6, 4.8, 6, 7.5, 9, 11, 13, 15, 18] as const;
const MARK_TAIL_STEP = 2;

function rectAvoidOverlap(b: Rect, avoid: readonly Rect[], m: number): number {
  let a = 0;
  for (const r of avoid) {
    a +=
      Math.max(0, Math.min(b.x + b.w, r.x + r.w + m) - Math.max(b.x, r.x - m)) *
      Math.max(0, Math.min(b.y + b.h, r.y + r.h + m) - Math.max(b.y, r.y - m));
  }
  return a;
}

/**
 * Where a lane's mark stands: just out of the cave along its road, sliding further along the whole
 * road while it would sit under the next-wave card, the horn, another HUD piece, or off the
 * viewport. If no point on the road fits in the viewport (after a pan), clamps the marker inside
 * the viewport edge (dodging HUD cards) and points its chevron toward the off-screen entrance (pure).
 */
export function laneMarkSpot(
  path: readonly { readonly x: number; readonly z: number }[],
  toScreen: (p: { x: number; z: number }) => { x: number; y: number },
  avoid: readonly Rect[],
  s: number,
  viewport?: { readonly w: number; readonly h: number },
): LaneMarkSpot | null {
  if (path.length === 0) return null;
  const totalLen = pathLength(path);
  const pick: { at: { x: number; y: number } | null; off: number; avoid: number } = { at: null, off: Infinity, avoid: Infinity };
  const pad = 4;
  const m = LANE_MARK_MARGIN;

  const evalDist = (d: number): { x: number; y: number } | null => {
    const p = pointAlong(path, d);
    if (!p) return null;
    const at = toScreen(p);
    const b = laneMarkBox(at.x, at.y, s);
    const avoidA = rectAvoidOverlap(b, avoid, m);
    let offA = 0;
    if (viewport && (b.x < pad || b.x + b.w > viewport.w - pad || b.y < pad || b.y + b.h > viewport.h - pad)) {
      const ix = Math.max(0, Math.min(b.x + b.w, viewport.w - pad) - Math.max(b.x, pad));
      const iy = Math.max(0, Math.min(b.y + b.h, viewport.h - pad) - Math.max(b.y, pad));
      offA = Math.max(0, b.w * b.h - ix * iy);
    }
    if (avoidA === 0 && offA === 0) return at;
    if (offA < pick.off || (offA === pick.off && avoidA < pick.avoid)) {
      pick.off = offA;
      pick.avoid = avoidA;
      pick.at = at;
    }
    return null;
  };

  let reachedEnd = false;
  for (const d of INITIAL_MARK_DISTS) {
    const clean = evalDist(d);
    if (clean) return clean;
    if (d >= totalLen) {
      reachedEnd = true;
      break;
    }
  }
  if (!reachedEnd) {
    for (let d = INITIAL_MARK_DISTS[INITIAL_MARK_DISTS.length - 1] + MARK_TAIL_STEP; d < totalLen; d += MARK_TAIL_STEP) {
      const clean = evalDist(d);
      if (clean) return clean;
    }
    const cleanEnd = evalDist(totalLen);
    if (cleanEnd) return cleanEnd;
  }

  const best = pick.at;
  if (!best || !viewport || pick.off === 0) return best;

  // No point on the entire path kept the marker box inside the viewport: clamp inside the viewport
  // edge (dodging HUD cards along the edge) and point the chevron toward the off-screen entrance.
  const sampleBox = laneMarkBox(0, 0, s);
  const halfW = sampleBox.w / 2;
  const boxH = sampleBox.h;
  const minX = pad + halfW;
  const maxX = viewport.w - pad - halfW;
  const minY = pad + boxH;
  const maxY = viewport.h - pad;
  const clampX = (v: number): number => (minX <= maxX ? Math.max(minX, Math.min(maxX, v)) : viewport.w / 2);
  const clampY = (v: number): number => (minY <= maxY ? Math.max(minY, Math.min(maxY, v)) : (minY + maxY) / 2);
  const cx = clampX(best.x);
  const cy = clampY(best.y);
  let fx = cx;
  let fy = cy;
  let clampedAvoid = rectAvoidOverlap(laneMarkBox(cx, cy, s), avoid, m);
  if (clampedAvoid > 0) {
    const xs = [cx];
    const ys = [cy];
    for (const r of avoid) {
      const lx = r.x - m - halfW;
      const rx = r.x + r.w + m + halfW;
      const ty = r.y - m;
      const by = r.y + r.h + m + boxH;
      if (lx >= minX && lx <= maxX) xs.push(lx);
      if (rx >= minX && rx <= maxX) xs.push(rx);
      if (ty >= minY && ty <= maxY) ys.push(ty);
      if (by >= minY && by <= maxY) ys.push(by);
    }
    let bestD = Infinity;
    for (const px of xs) {
      for (const py of ys) {
        const a = rectAvoidOverlap(laneMarkBox(px, py, s), avoid, m);
        const dist = Math.hypot(px - cx, py - cy);
        if (a < clampedAvoid || (a === clampedAvoid && dist < bestD)) {
          clampedAvoid = a;
          bestD = dist;
          fx = px;
          fy = py;
        }
      }
    }
  }
  const offScreenEntrance = best.x < minX - 12 || best.x > maxX + 12 || best.y < minY - 12 || best.y > maxY + 12;
  if (!offScreenEntrance) return { x: fx, y: fy };
  const mouth = toScreen(pointAlong(path, INITIAL_MARK_DISTS[0]) ?? path[0]);
  const angle = Math.atan2(mouth.y - (fy - s * 1.5), mouth.x - fx) - Math.PI / 2;
  return { x: fx, y: fy, angle };
}

export interface LaneMarkPlaceInputs {
  readonly waveKey: string;
  readonly viewW: number;
  readonly viewH: number;
  readonly unit: number;
  readonly fitScale: number;
  readonly fitOffsetX: number;
  readonly fitOffsetY: number;
  readonly card: Rect | null;
  readonly foe: Rect | null;
  readonly toast: Rect | null;
  readonly hornBox: Rect;
  readonly plaque: Rect;
  readonly banner: Rect;
  readonly tray: Rect;
  readonly hasDiffBadge: boolean;
  readonly coachKey: string;
  readonly specHintShown: boolean;
  readonly keepOutsVersion: number;
  readonly layoutGen: number;
}

const rKey = (r: Rect | null): string => (r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}` : '');

/** Pure cache key for entrance marker measurements & placements (changes only when wave, camera, viewport or HUD geometry changes). */
export function laneMarkPlaceKey(i: LaneMarkPlaceInputs): string {
  return [
    i.waveKey,
    i.viewW,
    i.viewH,
    i.unit,
    i.fitScale,
    i.fitOffsetX,
    i.fitOffsetY,
    rKey(i.card),
    rKey(i.foe),
    rKey(i.toast),
    rKey(i.hornBox),
    rKey(i.plaque),
    rKey(i.banner),
    rKey(i.tray),
    i.hasDiffBadge ? 1 : 0,
    i.coachKey,
    i.specHintShown ? 1 : 0,
    i.keepOutsVersion,
    i.layoutGen,
  ].join('|');
}

export interface LaneMark {
  readonly lane: number;
  /** Screen (css px) point the chevron points down at. */
  readonly x: number;
  readonly y: number;
  readonly count: number;
  /** Dedicated air-entry marker (flyers entering away from ground caves). */
  readonly flying?: boolean;
  /** Optional chevron rotation (radians clockwise from pointing down) when clamped to the viewport edge. */
  readonly angle?: number;
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
      const k = list.map((m) => `${m.flying ? 'a' : 'g'}${m.lane}:${m.count}@${Math.round(m.x)},${Math.round(m.y)},${Math.round(((m.angle ?? 0) * 180) / Math.PI)}`).join(';');
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
        const deg = m.angle ? Math.round((m.angle * 180) / Math.PI) : 0;
        p.chev.style.rotate = deg ? `${deg}deg` : ''; // i18n-ignore (css)
        p.root.style.display = '';
        p.root.style.transform = `translate(${Math.round(m.x)}px, ${Math.round(m.y)}px)`; // i18n-ignore (css)
      });
      for (let i = list.length; i < pool.length; i++) pool[i].root.style.display = 'none';
    },
    debug: () => ({ shown: shownMarks.length, lanes: shownMarks.map((m) => m.lane), counts: shownMarks }),
  };
}
