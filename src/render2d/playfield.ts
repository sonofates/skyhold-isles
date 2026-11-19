/**
 * What the HUD must never cover (pure, no Pixi): the island's roads (with their painted width),
 * the build plots and the caves / castle. In map image px; `toScreen` maps them through a fit.
 *
 * Two forms:
 * - `playfieldShapes`: the exact shapes (road capsules, plot circles, gate rects). The overlap
 *   check (`shapesOverlap`) and the QA / tests use these.
 * - `playfieldBoxes`: conservative boxes for the map fit (hudFit.ts), grown upward by the height of
 *   what stands on them (walkers on a road, a tower on a plot), so the top band never hides a head.
 */
import type { Level2DLayout } from '../data/levels/types.ts';
import { gateKeepOutsPx, type Rect } from './uiLayout.ts';

/** Painted road width as a fraction of the map image height (tools/map-compose/compose.py ROAD_W). */
export const ROAD_WIDTH_FRAC = 0.068;

export interface Seg {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
}

export interface Circle {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface PlayShapes {
  /** Road centre lines and the road's half width (image px). */
  readonly roads: readonly Seg[];
  readonly roadR: number;
  readonly plots: readonly Circle[];
  /** Caves and the castle (the building around the gate, see gateKeepOutsPx). */
  readonly gates: readonly (Rect & { readonly castle: boolean })[];
}

export function playfieldShapes(layout: Level2DLayout): PlayShapes {
  const [iw, ih] = layout.imageSize;
  const k = layout.pxPerUnit;
  const px = (x: number): number => x * k + iw / 2;
  const py = (z: number): number => z * k + ih / 2;
  const roads: Seg[] = [];
  for (const path of layout.paths) {
    for (let i = 1; i < path.length; i++) roads.push({ ax: px(path[i - 1].x), ay: py(path[i - 1].z), bx: px(path[i].x), by: py(path[i].z) });
    if (path.length === 1) roads.push({ ax: px(path[0].x), ay: py(path[0].z), bx: px(path[0].x), by: py(path[0].z) });
  }
  const r = layout.plotRadius * k;
  // The keep-out rects grow past the art; the building itself is painted inside the image.
  const gates = gateKeepOutsPx(layout.gates ?? []).map((g) => {
    const x0 = Math.max(0, g.x);
    const y0 = Math.max(0, g.y);
    return { x: x0, y: y0, w: Math.min(iw, g.x + g.w) - x0, h: Math.min(ih, g.y + g.h) - y0, castle: g.castle };
  });
  return {
    roads,
    roadR: (ROAD_WIDTH_FRAC * ih) / 2,
    plots: layout.plots.map((p) => ({ x: px(p.x), y: py(p.z), r })),
    gates: gates.filter((g) => g.w > 0 && g.h > 0),
  };
}

export interface BoxOptions {
  /** Height (road widths) of the walkers above the road: their bodies must clear the HUD too. */
  readonly walkerUp: number;
  /** Height (plot radii) of a tower above its plot's centre. */
  readonly towerUp: number;
}

/** Default headroom: a walker is about 1.5 road widths tall, a tower about 2.6 plot radii. */
export const PLAYFIELD_HEADROOM: BoxOptions = { walkerUp: 1.5, towerUp: 2.6 };

/**
 * Conservative boxes (image px) covering the shapes plus the headroom above them: roads cut into
 * pieces no longer than a road width (each piece's box holds its capsule), plots with their tower,
 * the gates as they are.
 */
export function playfieldBoxes(s: PlayShapes, o: BoxOptions = PLAYFIELD_HEADROOM): Rect[] {
  const out: Rect[] = [];
  const rr = s.roadR;
  const up = o.walkerUp * rr * 2;
  for (const g of s.roads) {
    const len = Math.hypot(g.bx - g.ax, g.by - g.ay);
    const n = Math.max(1, Math.ceil(len / (rr * 2)));
    for (let i = 0; i < n; i++) {
      const x0 = g.ax + ((g.bx - g.ax) * i) / n;
      const y0 = g.ay + ((g.by - g.ay) * i) / n;
      const x1 = g.ax + ((g.bx - g.ax) * (i + 1)) / n;
      const y1 = g.ay + ((g.by - g.ay) * (i + 1)) / n;
      const lx = Math.min(x0, x1) - rr;
      const ty = Math.min(y0, y1) - Math.max(rr, up);
      out.push({ x: lx, y: ty, w: Math.max(x0, x1) + rr - lx, h: Math.max(y0, y1) + rr - ty });
    }
  }
  for (const p of s.plots) {
    const top = p.y - Math.max(p.r, o.towerUp * p.r);
    out.push({ x: p.x - p.r, y: top, w: p.r * 2, h: p.y + p.r - top });
  }
  for (const g of s.gates) out.push({ x: g.x, y: g.y, w: g.w, h: g.h });
  return out;
}

/** Shortest distance from point (px, py) to the segment a-b. */
function distPointSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function segsCross(a: Seg, b: Seg): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const o1 = o(a.ax, a.ay, a.bx, a.by, b.ax, b.ay);
  const o2 = o(a.ax, a.ay, a.bx, a.by, b.bx, b.by);
  const o3 = o(b.ax, b.ay, b.bx, b.by, a.ax, a.ay);
  const o4 = o(b.ax, b.ay, b.bx, b.by, a.bx, a.by);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/** Shortest distance from a segment to a rect (0 when it touches or crosses it). */
export function distSegRect(g: Seg, r: Rect): number {
  const inside = (x: number, y: number): boolean => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  if (inside(g.ax, g.ay) || inside(g.bx, g.by)) return 0;
  const x1 = r.x + r.w;
  const y1 = r.y + r.h;
  const edges: Seg[] = [
    { ax: r.x, ay: r.y, bx: x1, by: r.y },
    { ax: x1, ay: r.y, bx: x1, by: y1 },
    { ax: x1, ay: y1, bx: r.x, by: y1 },
    { ax: r.x, ay: y1, bx: r.x, by: r.y },
  ];
  if (edges.some((e) => segsCross(g, e))) return 0;
  let d = Infinity;
  for (const e of edges) {
    d = Math.min(d, distPointSeg(e.ax, e.ay, g.ax, g.ay, g.bx, g.by), distPointSeg(g.ax, g.ay, e.ax, e.ay, e.bx, e.by), distPointSeg(g.bx, g.by, e.ax, e.ay, e.bx, e.by));
  }
  return d;
}

function circleHitsRect(c: Circle, r: Rect): boolean {
  const nx = Math.max(r.x, Math.min(c.x, r.x + r.w));
  const ny = Math.max(r.y, Math.min(c.y, r.y + r.h));
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 < c.r * c.r;
}

export interface Overlap {
  readonly kind: 'road' | 'plot' | 'gate' | 'castle';
  readonly index: number;
  /** How deep (screen px) the shape reaches into the rect (road / plot), or the overlap area (gate). */
  readonly depth: number;
}

/** A fit in the form the map uses (image px → screen px). */
export interface FitLike {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * Exact overlaps of a screen rect with the playfield shapes under a fit (screen px). Empty = the
 * rect covers no road, plot, cave or castle. Shapes off screen count too (the caller passes
 * on-screen rects only).
 */
export function shapesOverlap(s: PlayShapes, fit: FitLike, rect: Rect): Overlap[] {
  const k = fit.scale;
  // The rect in image px.
  const r: Rect = { x: (rect.x - fit.offsetX) / k, y: (rect.y - fit.offsetY) / k, w: rect.w / k, h: rect.h / k };
  const out: Overlap[] = [];
  s.roads.forEach((g, i) => {
    const d = distSegRect(g, r);
    if (d < s.roadR) out.push({ kind: 'road', index: i, depth: Math.round((s.roadR - d) * k * 10) / 10 });
  });
  s.plots.forEach((c, i) => {
    if (circleHitsRect(c, r)) out.push({ kind: 'plot', index: i, depth: 1 });
  });
  s.gates.forEach((g, i) => {
    const w = Math.min(r.x + r.w, g.x + g.w) - Math.max(r.x, g.x);
    const h = Math.min(r.y + r.h, g.y + g.h) - Math.max(r.y, g.y);
    if (w > 0 && h > 0) out.push({ kind: g.castle ? 'castle' : 'gate', index: i, depth: Math.round(w * h * k * k) });
  });
  return out;
}
