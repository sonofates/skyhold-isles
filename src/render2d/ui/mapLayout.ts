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
