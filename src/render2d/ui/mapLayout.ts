/**
 * Pure layout math for the world map (no DOM): where the island nodes sit along the sea route, how
 * big they are, and how wide the scrollable sea is. css px; respects safe-area insets.
 */
import type { Insets, Pt } from '../uiLayout.ts';

export interface WorldMapLayout {
  /** Scrollable world width (≥ the viewport width). */
  readonly worldW: number;
  readonly worldH: number;
  /** Node centres in world px. */
  readonly nodes: readonly Pt[];
  /** Medallion diameter. */
  readonly nodeD: number;
  /** Top of the area free of the top bar. */
  readonly top: number;
}

/** Vertical rhythm of the route (fractions of the free band): a meandering line, never a straight row. */
const Y_RHYTHM = [0.64, 0.3, 0.6, 0.26, 0.68, 0.36, 0.56, 0.24] as const;

/**
 * Islands along a meandering route, left to right. When they all fit, the route is centred on
 * screen; otherwise the sea gets wider than the viewport and scrolls sideways. `topBar` = height
 * reserved for the title / buttons strip.
 */
export function worldMapLayout(n: number, w: number, h: number, insets: Insets, topBar: number): WorldMapLayout {
  const top = insets.top + topBar;
  const bottom = h - insets.bottom - Math.max(10, h * 0.03);
  const band = Math.max(60, bottom - top);
  // Node size: room above for stars (0.3 D) and below for the name plank (0.45 D).
  const nodeD = Math.round(Math.max(76, Math.min(204, band / 1.9, w * 0.16)));
  const spacing = nodeD * 1.62;
  const marginX = Math.max(insets.left, insets.right) + nodeD * 0.85;
  const span = Math.max(0, n - 1) * spacing;
  const worldW = Math.max(w, Math.ceil(span + marginX * 2));
  const x0 = (worldW - span) / 2;
  // With one or two islands the route sits near the middle band.
  const usable = band - nodeD * 0.3 - nodeD * 0.45 - nodeD;
  const yTop = top + nodeD * 0.3 + nodeD / 2;
  const nodes: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : Y_RHYTHM[i % Y_RHYTHM.length];
    nodes.push({ x: x0 + i * spacing, y: yTop + Math.max(0, usable) * f });
  }
  return { worldW, worldH: h, nodes, nodeD, top };
}

/** Smooth SVG path through points (Catmull-Rom → cubic Bézier). */
export function routePath(pts: readonly Pt[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/** Scroll offset that puts world x `focusX` in the middle of a `viewW` viewport (clamped). */
export function scrollToCentre(focusX: number, viewW: number, worldW: number): number {
  return Math.max(0, Math.min(worldW - viewW, focusX - viewW / 2));
}

/** The cubic Bézier segments `routePath` draws (Catmull-Rom through the points). */
function routeSegments(pts: readonly Pt[]): [Pt, Pt, Pt, Pt][] {
  const segs: [Pt, Pt, Pt, Pt][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    segs.push([p1, { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }, { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }, p2]);
  }
  return segs;
}

function bez(s: readonly [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * s[0].x + b * s[1].x + c * s[2].x + d * s[3].x, y: a * s[0].y + b * s[1].y + c * s[2].y + d * s[3].y };
}

/** One painted mark on the route: centre, heading (radians, along the route) and which leg it is on. */
export interface RouteMark {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  /** Leg index: the mark lies between island `leg` and island `leg + 1`. */
  readonly leg: number;
}

export interface RouteMarks {
  readonly dashes: readonly RouteMark[];
  /** One anchor halfway along each leg (where the leg is long enough to show one). */
  readonly anchors: readonly RouteMark[];
}

/**
 * Places the painted route pieces along the same curve `routePath` draws: a dash every `step` px
 * of arc length, none within `clear` px of an island centre (the medallion and its shore sit
 * there) or of a leg's anchor, which sits at the leg's arc-length midpoint. Pure, css px.
 */
export function routeMarks(pts: readonly Pt[], step: number, clear: number, anchorClear = step): RouteMarks {
  const dashes: RouteMark[] = [];
  const anchors: RouteMark[] = [];
  if (pts.length < 2 || step <= 0) return { dashes, anchors };
  const N = 64;
  routeSegments(pts).forEach((seg, leg) => {
    // Arc-length table for the segment.
    const samples: { p: Pt; s: number; t: number }[] = [{ p: seg[0], s: 0, t: 0 }];
    for (let k = 1; k <= N; k++) {
      const p = bez(seg, k / N);
      const prev = samples[k - 1];
      samples.push({ p, s: prev.s + Math.hypot(p.x - prev.p.x, p.y - prev.p.y), t: k / N });
    }
    const len = samples[N].s;
    const at = (s: number): RouteMark => {
      let k = 1;
      while (k < N && samples[k].s < s) k++;
      const a = samples[k - 1];
      const b = samples[k];
      const f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
      return { x: a.p.x + (b.p.x - a.p.x) * f, y: a.p.y + (b.p.y - a.p.y) * f, angle: Math.atan2(b.p.y - a.p.y, b.p.x - a.p.x), leg };
    };
    const free = len - 2 * clear;
    if (free <= 0) return;
    const mid = len / 2;
    const hasAnchor = free > anchorClear * 2 + step * 2;
    if (hasAnchor) anchors.push(at(mid));
    // Dashes centred on the free stretch, so both ends of a leg look the same.
    const n = Math.floor(free / step);
    const start = clear + (free - n * step) / 2 + step / 2;
    for (let i = 0; i < n; i++) {
      const s = start + i * step;
      if (hasAnchor && Math.abs(s - mid) < anchorClear) continue;
      dashes.push(at(s));
    }
  });
  return { dashes, anchors };
}
