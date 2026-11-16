/**
 * Pure layout math for the radial menu (no DOM). Screen coordinates, y grows downward;
 * angles are in degrees, -90 = straight up.
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface RingLayoutOptions {
  cx: number;
  cy: number;
  count: number;
  radius: number;
  /** Footprint diameter of one token (token plus label) used for overlap and edge checks. */
  footprint: number;
  /** Area the footprints must stay inside (viewport minus safe areas and HUD). */
  bounds: Rect;
  /** Preferred direction of the ring's centre line, degrees. Default: up. */
  preferredAngle?: number;
}

export interface RingLayout {
  positions: Point[];
  /** Angular span used (360 = full ring). */
  span: number;
  /** Total px the footprints still overflow the bounds after clamping (0 = clean fit). */
  overflow: number;
}

const SPANS = [360, 280, 210, 160];
const DIRECTION_STEP = 15;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function overflowOf(p: Point, half: number, b: Rect): number {
  return (
    Math.max(0, b.left - (p.x - half)) +
    Math.max(0, p.x + half - b.right) +
    Math.max(0, b.top - (p.y - half)) +
    Math.max(0, p.y + half - b.bottom)
  );
}

export function clampPoint(p: Point, half: number, b: Rect): Point {
  const minX = b.left + half;
  const maxX = Math.max(minX, b.right - half);
  const minY = b.top + half;
  const maxY = Math.max(minY, b.bottom - half);
  return { x: Math.min(maxX, Math.max(minX, p.x)), y: Math.min(maxY, Math.max(minY, p.y)) };
}

/** Directions ordered by closeness to `preferred` (0, +15, -15, +30, ...). */
function directionsFrom(preferred: number): number[] {
  const out = [preferred];
  for (let k = 1; k * DIRECTION_STEP <= 180; k++) {
    out.push(preferred + k * DIRECTION_STEP);
    if (k * DIRECTION_STEP < 180) out.push(preferred - k * DIRECTION_STEP);
  }
  return out;
}

/**
 * Places `count` tokens on a ring around (cx, cy). Prefers a full ring pointing up; when the ring
 * would leave the bounds it tries narrower arcs facing other directions (an arc keeps its tokens
 * from overlapping by growing the radius), and finally clamps tokens into the bounds.
 */
export function layoutRing(o: RingLayoutOptions): RingLayout {
  const n = o.count;
  if (n <= 0) return { positions: [], span: 0, overflow: 0 };
  const half = o.footprint / 2;
  const preferred = o.preferredAngle ?? -90;
  const dirs = directionsFrom(preferred);
  const bcx = (o.bounds.left + o.bounds.right) / 2;
  const bcy = (o.bounds.top + o.bounds.bottom) / 2;

  const search = (
    cx: number,
    cy: number,
  ): { positions: Point[]; span: number; overflow: number; clean: boolean } => {
    let best: { positions: Point[]; span: number; overflow: number } | null = null;
    for (const span of n === 1 ? [360] : SPANS) {
      const full = span >= 360;
      const step = n === 1 ? 0 : full ? 360 / n : span / (n - 1);
      let radius = o.radius;
      if (n > 1 && step > 0) {
        // chord between neighbours must clear the footprint (slightly overlapping is OK)
        const needed = (o.footprint * 0.94) / (2 * Math.sin(toRad(Math.min(step, 179)) / 2));
        radius = Math.max(radius, needed);
      }
      for (const dir of dirs) {
        const positions: Point[] = [];
        let overflow = 0;
        for (let i = 0; i < n; i++) {
          const ang = toRad(dir + (i - (n - 1) / 2) * step);
          const p = { x: cx + Math.cos(ang) * radius, y: cy + Math.sin(ang) * radius };
          overflow += overflowOf(p, half, o.bounds);
          positions.push(p);
        }
        if (overflow <= 0.5) return { positions, span, overflow: 0, clean: true };
        if (!best || overflow < best.overflow) best = { positions, span, overflow };
      }
    }
    return { ...(best as { positions: Point[]; span: number; overflow: number }), clean: false };
  };

  // Anchor itself first; when nothing fits slide the ring toward the middle of the free area
  // (corner tiles) until an arrangement fits, so tokens never collapse on top of each other.
  let last = search(o.cx, o.cy);
  if (last.clean) return last;
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const r = search(o.cx + (bcx - o.cx) * t, o.cy + (bcy - o.cy) * t);
    if (r.clean) return r;
    last = r;
  }
  const clamped = last.positions.map((p) => clampPoint(p, half, o.bounds));
  let remaining = 0;
  for (const p of clamped) remaining += overflowOf(p, half, o.bounds);
  return { positions: clamped, span: last.span, overflow: remaining };
}

/** Centres a w x h box on (cx, cy) shifted by (dx, dy), then clamps it into the bounds. */
export function placeBox(
  cx: number,
  cy: number,
  w: number,
  h: number,
  b: Rect,
  dx = 0,
  dy = 0,
): Point {
  const minX = b.left + w / 2;
  const maxX = Math.max(minX, b.right - w / 2);
  const minY = b.top + h / 2;
  const maxY = Math.max(minY, b.bottom - h / 2);
  return {
    x: Math.min(maxX, Math.max(minX, cx + dx)),
    y: Math.min(maxY, Math.max(minY, cy + dy)),
  };
}

export interface ViewportInfo {
  width: number;
  height: number;
  safe: Rect;
}

/**
 * Area tokens may occupy: viewport minus safe areas minus the HUD bands. Portrait keeps clear of
 * the bottom gem row; landscape keeps clear of the top plate only.
 */
export function ringBounds(v: ViewportInfo, margin = 6): Rect {
  const portrait = v.height > v.width;
  const top = v.safe.top + (portrait ? 66 : 52);
  const bottom = v.height - v.safe.bottom - (portrait ? 96 : 6);
  return {
    left: v.safe.left + margin,
    top: Math.min(top, v.height * 0.4),
    right: v.width - v.safe.right - margin,
    bottom: Math.max(bottom, v.height * 0.6),
  };
}
