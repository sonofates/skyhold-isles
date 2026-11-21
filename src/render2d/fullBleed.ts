/**
 * Full-bleed map fit (pure, no Pixi / DOM): the painted map covers the screen, a little zoomed in
 * past "cover" (PAN_ZOOM) so the player can always pan it a bit in every direction (mapPan.ts), and
 * the HUD sits in the corners over it. What matters is the island's gameplay (`mustSee`: plots, the
 * roads inside the safe area, cave mouths, the castle); the decorative edges crop first.
 *
 * The scale never changes to make room for the HUD (owner feedback 2026-11-21: no bands on a
 * laptop). Between ~4:3 and ~21:9 the map covers the screen; only a more extreme aspect (MIN_VIEW)
 * opens bands, which MapView fills with the painted frame.
 *
 * The HUD pieces sit at their corner (hudDock.ts). A piece may lie over decorative art, never over a
 * plot, a cave or the castle, and over a road only where the road runs outside the safe area. The
 * DEFAULT VIEW (the pan offset a run starts at, and returns to on resize) is the offset nearest the
 * safe area's centre, inside the pan range, at which:
 *  1. every piece is clear (the tray may slide along the bottom, the horn may stand left of the
 *     banner) and the gameplay shows as fully as the screen allows,
 *  2. else every piece is clear,
 *  3. else every piece but the info card (it shows only between waves, and fades as one marches),
 *  4. else the offset covering the fewest shapes (`clear` false; panning shows any spot).
 */
import { gateKeepOutsPx, type Rect } from './uiLayout.ts';
import { distSegRect, playfieldShapes, type Circle, type FitLike, type Seg } from './playfield.ts';
import type { Level2DLayout } from '../data/levels/types.ts';
import type { MapFit } from './viewFit.ts';
import { dockPieces, type HornSpot, type HudDock } from './hudDock.ts';

export interface HardShapes {
  readonly roads: readonly Seg[];
  readonly roadR: number;
  readonly plots: readonly Circle[];
  /** Caves and the castle (the building around the gate, image px). */
  readonly gates: readonly (Rect & { readonly castle: boolean })[];
  /** Safe area (image px): roads count only inside it. */
  readonly safe: Rect;
  /** Box (image px) that must stay on screen. */
  readonly mustSee: Rect;
}

export type HardKind = 'road' | 'plot' | 'gate' | 'castle';

export interface HardOverlap {
  readonly kind: HardKind;
  readonly index: number;
  readonly depth: number;
}

/** Margin (css px) kept between a HUD piece and a hard shape. */
export const HARD_MARGIN = 3;

export function hardShapes(layout: Level2DLayout): HardShapes {
  const s = playfieldShapes(layout);
  const [iw, ih] = layout.imageSize;
  const [sx, sy, sw, sh] = layout.safeArea;
  const safe: Rect = { x: sx, y: sy, w: sw, h: sh };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (ax: number, ay: number, bx: number, by: number): void => {
    x0 = Math.min(x0, ax);
    y0 = Math.min(y0, ay);
    x1 = Math.max(x1, bx);
    y1 = Math.max(y1, by);
  };
  for (const p of s.plots) add(p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r);
  // Roads: the part inside the safe area (they run on into the caves past it).
  for (const g of s.roads) {
    const ax = Math.max(sx, Math.min(g.ax, g.bx) - s.roadR);
    const ay = Math.max(sy, Math.min(g.ay, g.by) - s.roadR);
    const bx = Math.min(sx + sw, Math.max(g.ax, g.bx) + s.roadR);
    const by = Math.min(sy + sh, Math.max(g.ay, g.by) + s.roadR);
    if (bx > ax && by > ay) add(ax, ay, bx, by);
  }
  // The castle keep whole; a cave's painted front inside the safe area (its outer rock may be
  // cropped) and its mouth (the road's first point, a road width around it).
  const k = layout.pxPerUnit;
  for (const g of gateKeepOutsPx(layout.gates ?? [])) {
    if (g.castle) add(Math.max(0, g.x), Math.max(0, g.y), Math.min(iw, g.x + g.w), Math.min(ih, g.y + g.h));
  }
  for (const g of layout.gates ?? []) {
    if (!g.front || g.role === 'goal') continue;
    let [gx, gy, gw, gh] = g.front.rect;
    // The rock behind the mouth (opposite its facing) may be cropped: keep the mouth's 60 %.
    const cut = 0.4;
    if (g.facing === 'E') {
      gx += gw * cut;
      gw *= 1 - cut;
    } else if (g.facing === 'W') gw *= 1 - cut;
    else if (g.facing === 'S') {
      gy += gh * cut;
      gh *= 1 - cut;
    } else gh *= 1 - cut;
    const ax = Math.max(sx, gx);
    const ay = Math.max(sy, gy);
    const bx = Math.min(sx + sw, gx + gw);
    const by = Math.min(sy + sh, gy + gh);
    if (bx > ax && by > ay) add(ax, ay, bx, by);
  }
  for (const e of layout.entrances) {
    const ex = e.x * k + iw / 2;
    const ey = e.z * k + ih / 2;
    add(Math.max(0, ex - s.roadR * 2), Math.max(0, ey - s.roadR * 2), Math.min(iw, ex + s.roadR * 2), Math.min(ih, ey + s.roadR * 2));
  }
  return { roads: s.roads, roadR: s.roadR, plots: s.plots, gates: s.gates, safe, mustSee: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

function circleHitsRect(c: Circle, r: Rect): boolean {
  const nx = Math.max(r.x, Math.min(c.x, r.x + r.w));
  const ny = Math.max(r.y, Math.min(c.y, r.y + r.h));
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 < c.r * c.r;
}

function clip(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * What a screen rect covers under a fit: plots, caves, the castle, and roads inside the safe area.
 * Empty = the rect is fine there. `first` stops at the first hit (the fit search).
 */
export function hardOverlaps(s: HardShapes, fit: FitLike, rect: Rect, first = false): HardOverlap[] {
  const k = fit.scale;
  const r: Rect = { x: (rect.x - fit.offsetX) / k, y: (rect.y - fit.offsetY) / k, w: rect.w / k, h: rect.h / k };
  const out: HardOverlap[] = [];
  for (let i = 0; i < s.plots.length; i++) {
    if (circleHitsRect(s.plots[i], r)) {
      out.push({ kind: 'plot', index: i, depth: 1 });
      if (first) return out;
    }
  }
  for (let i = 0; i < s.gates.length; i++) {
    const g = s.gates[i];
    const w = Math.min(r.x + r.w, g.x + g.w) - Math.max(r.x, g.x);
    const h = Math.min(r.y + r.h, g.y + g.h) - Math.max(r.y, g.y);
    if (w > 0 && h > 0) {
      out.push({ kind: g.castle ? 'castle' : 'gate', index: i, depth: Math.round(w * h * k * k) });
      if (first) return out;
    }
  }
  const rs = clip(r, s.safe);
  if (rs) {
    const rr = s.roadR;
    for (let i = 0; i < s.roads.length; i++) {
      const g = s.roads[i];
      if (Math.max(g.ax, g.bx) + rr <= rs.x || Math.min(g.ax, g.bx) - rr >= rs.x + rs.w || Math.max(g.ay, g.by) + rr <= rs.y || Math.min(g.ay, g.by) - rr >= rs.y + rs.h) continue;
      const d = distSegRect(g, rs);
      if (d < rr) {
        out.push({ kind: 'road', index: i, depth: Math.round((rr - d) * k * 10) / 10 });
        if (first) return out;
      }
    }
  }
  return out;
}

export interface FullBleedFit extends MapFit {
  /** Scale relative to the cover scale (≈ PAN_ZOOM; under 1 only past MIN_VIEW, with bands). */
  readonly shrink: number;
  /** Share of the screen the map image covers (0..1). */
  readonly coverage: number;
  /** False when no offset in the pan range keeps every piece clear (the best one is returned). */
  readonly clear: boolean;
  /** Every piece clear but the info card (it shows between waves only). */
  readonly clearButInfo: boolean;
}

/** Offsets (screen px of image px (0, 0)) the view may pan between: never past the painting's edge. */
export interface PanRange {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface FullBleedResult {
  /** The default view. */
  readonly fit: FullBleedFit;
  /** The dock with its sliding pieces placed for the default view. */
  readonly dock: HudDock;
  /** Where the player may pan to (same scale). */
  readonly pan: PanRange;
}

/** Zoom past "cover": the room to pan (≈ 5 % of the screen along the tighter axis). */
export const PAN_ZOOM = 1.05;
/**
 * Maximum zoom past "cover" used ONLY when a covered screen (e.g. phone landscape whose aspect
 * matches the map so PAN_ZOOM leaves barely any pan room) would otherwise trap a plot behind a HUD
 * piece. Keeps the painting covering 100 % of the screen (zero bands) while giving enough pan room
 * for every plot to clear the HUD.
 */
export const MAX_REACH_ZOOM = 1.45;
/**
 * Share of a plot's radius around its centre that must be reachable on screen completely clear of
 * every HUD piece at some offset inside the pan range (0.5 → a clean bullseye disc of diameter
 * `plotRadius × scale`, ~25–64 css px, with ≥ 0.5 r clearance in every direction).
 */
export const PLOT_REACH_FRAC = 0.5;
/**
 * Least share of the painting's width / height on screen. Past it (an aspect beyond ~4:3 or
 * ~21:9 for these 2.17:1 maps) the scale stops growing and bands open on the other axis.
 */
export const MIN_VIEW = { x: 0.55, y: 0.78 } as const;

/** Map scale for a screen: cover × PAN_ZOOM, capped so at least MIN_VIEW of the painting shows. */
export function viewScale(screenW: number, screenH: number, imageW: number, imageH: number): number {
  const cover = Math.max(screenW / imageW, screenH / imageH);
  const cap = Math.min(screenW / (MIN_VIEW.x * imageW), screenH / (MIN_VIEW.y * imageH));
  return Math.min(cover * PAN_ZOOM, cap);
}

function rangeAxis(screen: number, img: number): [number, number] {
  // Covered: anywhere that keeps the painting over the screen; else centred (a band each side).
  return img >= screen ? [screen - img, 0] : [(screen - img) / 2, (screen - img) / 2];
}

/** The pan range at a scale: never past the painting's edges. */
export function panRange(screenW: number, screenH: number, imageW: number, imageH: number, scale: number): PanRange {
  const [minX, maxX] = rangeAxis(screenW, imageW * scale);
  const [minY, maxY] = rangeAxis(screenH, imageH * scale);
  return { minX, maxX, minY, maxY };
}

/** An offset clamped into the pan range. */
export function clampPan(r: PanRange, x: number, y: number): { x: number; y: number } {
  const loX = Math.min(r.minX, r.maxX);
  const hiX = Math.max(r.minX, r.maxX);
  const loY = Math.min(r.minY, r.maxY);
  const hiY = Math.max(r.minY, r.maxY);
  return { x: Math.min(hiX, Math.max(loX, x)), y: Math.min(hiY, Math.max(loY, y)) };
}

function grow(r: Rect, m: number): Rect {
  return { x: r.x - m, y: r.y - m, w: r.w + m * 2, h: r.h + m * 2 };
}

/**
 * Offsets (one axis) where the must-see box shows as fully as it can: all of it when it fits on
 * screen, else the screen wholly inside it.
 */
function mustAxis(screen: number, mustStart: number, mustLen: number, scale: number): [number, number] {
  const a = -mustStart * scale;
  const b = screen - (mustStart + mustLen) * scale;
  return [Math.min(a, b), Math.max(a, b)];
}

function samples(lo: number, hi: number, pref: number, step: number): number[] {
  if (hi - lo < 1e-6) return [lo];
  const out = [pref];
  for (let d = step; pref - d >= lo - 1e-6 || pref + d <= hi + 1e-6; d += step) {
    if (pref + d <= hi + 1e-6) out.push(Math.min(hi, pref + d));
    if (pref - d >= lo - 1e-6) out.push(Math.max(lo, pref - d));
  }
  if (out[out.length - 1] !== lo && !out.includes(lo)) out.push(lo);
  if (!out.includes(hi)) out.push(hi);
  return out;
}

/** The map fit (with its bands) for a scale and offset. */
export function fitAt(screenW: number, screenH: number, imageW: number, imageH: number, scale: number, ox: number, oy: number): MapFit {
  const band = (v: number): number => (v > 1e-6 ? v : 0);
  return {
    scale,
    offsetX: ox,
    offsetY: oy,
    bandLeft: band(ox),
    bandRight: band(screenW - (ox + imageW * scale)),
    bandTop: band(oy),
    bandBottom: band(screenH - (oy + imageH * scale)),
  };
}

export function coverageOf(screenW: number, screenH: number, f: MapFit): number {
  const x0 = Math.max(0, f.offsetX);
  const y0 = Math.max(0, f.offsetY);
  const x1 = Math.min(screenW, screenW - f.bandRight);
  const y1 = Math.min(screenH, screenH - f.bandBottom);
  return (Math.max(0, x1 - x0) * Math.max(0, y1 - y0)) / (screenW * screenH);
}

/**
 * Clear spot for a piece sliding along x with its left edge in [lo, hi] (screen px), nearest its
 * home `r.x`; null if none. Every shape blocks an open interval of left edges (roads: the part
 * of the capsule in the piece's row, inside the safe area — a slight over-estimate at the capsule
 * ends); the free intervals are what is left.
 */
export function slideX(s: HardShapes, fit: FitLike, r: Rect, lo: number, hi: number): number | null {
  if (hi < lo) return null;
  const k = fit.scale;
  const m = HARD_MARGIN;
  // The piece's row in image px, and its width.
  const y0 = (r.y - m - fit.offsetY) / k;
  const y1 = (r.y + r.h + m - fit.offsetY) / k;
  const w = (r.w + 2 * m) / k;
  // Blocked left edges (image px, of the grown rect).
  const blocked: [number, number][] = [];
  for (const c of s.plots) {
    const dy = c.y < y0 ? y0 - c.y : c.y > y1 ? c.y - y1 : 0;
    if (dy >= c.r) continue;
    const hw = Math.sqrt(c.r * c.r - dy * dy);
    blocked.push([c.x - hw - w, c.x + hw]);
  }
  for (const g of s.gates) {
    if (g.y + g.h <= y0 || g.y >= y1) continue;
    blocked.push([g.x - w, g.x + g.w]);
  }
  const sf = s.safe;
  const rr = s.roadR;
  // Roads count only inside the safe area: the row clipped to it.
  const ry0 = Math.max(y0, sf.y);
  const ry1 = Math.min(y1, sf.y + sf.h);
  if (ry1 > ry0) {
    for (const g of s.roads) {
      // Part of the segment within rr of the row (vertically).
      const lo2 = ry0 - rr;
      const hi2 = ry1 + rr;
      let t0 = 0;
      let t1 = 1;
      const dy = g.by - g.ay;
      if (Math.abs(dy) < 1e-9) {
        if (g.ay <= lo2 || g.ay >= hi2) continue;
      } else {
        const ta = (lo2 - g.ay) / dy;
        const tb = (hi2 - g.ay) / dy;
        t0 = Math.max(0, Math.min(ta, tb));
        t1 = Math.min(1, Math.max(ta, tb));
        if (t1 <= t0) continue;
      }
      const xa = g.ax + (g.bx - g.ax) * t0;
      const xb = g.ax + (g.bx - g.ax) * t1;
      // Reach of the road, clipped to the safe area's columns.
      const a = Math.max(sf.x, Math.min(xa, xb) - rr);
      const b = Math.min(sf.x + sf.w, Math.max(xa, xb) + rr);
      if (b <= a) continue;
      blocked.push([a - w, b]);
    }
  }
  // Back to screen px (left edge of the un-grown rect).
  const toS = (v: number): number => fit.offsetX + v * k + m;
  const iv = blocked.map(([a, b]) => [toS(a), toS(b)] as [number, number]).filter(([a, b]) => b > lo && a < hi);
  iv.sort((p, q) => p[0] - q[0]);
  const home = Math.min(hi, Math.max(lo, r.x));
  let best: number | null = null;
  let bestD = Infinity;
  const consider = (a: number, b: number): void => {
    // Free closed interval [a, b] (shrunk a hair so the open blocked ends never touch).
    const fa = Math.max(lo, a + 0.01);
    const fb = Math.min(hi, b - 0.01);
    if (fb < fa) return;
    const x = Math.min(fb, Math.max(fa, home));
    const d = Math.abs(x - home);
    if (d < bestD) {
      bestD = d;
      best = x;
    }
  };
  let cur = lo - 0.02;
  for (const [a, b] of iv) {
    if (a > cur) consider(cur, a);
    cur = Math.max(cur, b);
  }
  consider(cur, hi + 0.02);
  return best;
}

/**
 * Returns a pan offset `{ x, y }` inside `pan` at which a clear tap disc of radius
 * `plot.r × scale × reachFrac` around the plot's centre sits on screen without touching any rect in
 * `rects`, or `null` if no pan offset in `pan` uncovers it.
 */
export function plotReachSpot(
  plot: Circle,
  imageW: number,
  imageH: number,
  screenW: number,
  screenH: number,
  scale: number,
  pan: PanRange,
  rects: readonly Rect[],
  reachFrac = PLOT_REACH_FRAC,
): { readonly x: number; readonly y: number } | null {
  const clearR = plot.r * scale * reachFrac;
  const px = plot.x * scale;
  const py = plot.y * scale;
  // Clamped to the painting's own margins (a plot hugging an edge only needs its on-painting side on screen).
  const inL = Math.min(clearR, px);
  const inR = Math.min(clearR, (imageW - plot.x) * scale);
  const inT = Math.min(clearR, py);
  const inB = Math.min(clearR, (imageH - plot.y) * scale);
  const x0 = Math.max(inL - 0.5, pan.minX + px);
  const x1 = Math.min(screenW - inR + 0.5, pan.maxX + px);
  const y0 = Math.max(inT - 0.5, pan.minY + py);
  const y1 = Math.min(screenH - inB + 0.5, pan.maxY + py);
  if (x1 < x0 - 1e-6 || y1 < y0 - 1e-6) return null;

  // Candidate screen Y positions for the plot centre: extremes, midpoint, rect clearance lines, and
  // a few interior samples (a single rect's blocked X-width shrinks monotonically away from it).
  const ys: number[] = [y0, y1];
  if (y1 - y0 > 1e-3) {
    const mid = (y0 + y1) / 2;
    ys.push(mid);
    const n = Math.min(8, Math.max(2, Math.floor((y1 - y0) / 12)));
    for (let i = 1; i < n; i++) ys.push(y0 + ((y1 - y0) * i) / n);
    for (const rc of rects) {
      const a = rc.y - clearR - 0.05;
      const b = rc.y + rc.h + clearR + 0.05;
      if (a > y0 && a < y1) ys.push(a);
      if (b > y0 && b < y1) ys.push(b);
    }
  }

  for (const cy of ys) {
    const blocked: [number, number][] = [];
    for (const rc of rects) {
      const dy = cy < rc.y ? rc.y - cy : cy > rc.y + rc.h ? cy - (rc.y + rc.h) : 0;
      if (clearR === 0 ? dy > 0 : dy >= clearR) continue;
      const dx = clearR > 0 ? Math.sqrt(Math.max(0, clearR * clearR - dy * dy)) : 0;
      blocked.push([rc.x - dx, rc.x + rc.w + dx]);
    }
    if (blocked.length === 0) {
      const cx = (x0 + x1) / 2;
      return clampPan(pan, cx - px, cy - py);
    }
    blocked.sort((a, b) => a[0] - b[0]);
    let cur = x0;
    for (const [a, b] of blocked) {
      if (a > cur + 1e-6) {
        const cx = (cur + Math.min(a, x1)) / 2;
        return clampPan(pan, cx - px, cy - py);
      }
      cur = Math.max(cur, b);
      if (cur > x1 + 1e-6) break;
    }
    if (cur < x1 - 1e-6) {
      const cx = (cur + x1) / 2;
      return clampPan(pan, cx - px, cy - py);
    }
  }
  return null;
}

/** True when `plot` can be panned to a spot where its clear tap disc avoids every rect in `rects`. */
export function plotReachable(
  plot: Circle,
  imageW: number,
  imageH: number,
  screenW: number,
  screenH: number,
  scale: number,
  pan: PanRange,
  rects: readonly Rect[],
  reachFrac = PLOT_REACH_FRAC,
): boolean {
  return plotReachSpot(plot, imageW, imageH, screenW, screenH, scale, pan, rects, reachFrac) !== null;
}

/** Indices of plots that cannot be panned clear of `dock` anywhere in `pan`. */
export function unreachablePlots(
  shapes: HardShapes,
  imageW: number,
  imageH: number,
  screenW: number,
  screenH: number,
  scale: number,
  pan: PanRange,
  dock: HudDock,
  reachFrac = PLOT_REACH_FRAC,
): number[] {
  const rects = Object.values(dockPieces(dock));
  const out: number[] = [];
  for (let i = 0; i < shapes.plots.length; i++) {
    if (!plotReachable(shapes.plots[i], imageW, imageH, screenW, screenH, scale, pan, rects, reachFrac)) out.push(i);
  }
  return out;
}

/** Hard shapes every dock piece covers at a fit's default view (+½ when the island can't clear). */
export function dockCost(shapes: HardShapes, r: FullBleedResult): number {
  return Object.values(dockPieces(r.dock)).reduce((n, rect) => n + hardOverlaps(shapes, r.fit, rect).length, 0) + (r.fit.clear ? 0 : 0.5);
}

/**
 * The fit with the item belt in the tray: its row form where the bottom line has room, every plot
 * stays reachable without extra zoom, and it covers no more of the island than the one-button
 * pouch would; else the pouch (the slots open above the tray on a tap, Z / X / C still cast
 * straight away).
 */
export function fullBleedFitItems(screenW: number, screenH: number, layout: Level2DLayout, dockFor: (mode: 'row' | 'pouch') => HudDock, shapes: HardShapes = hardShapes(layout)): FullBleedResult {
  const row = fullBleedFit(screenW, screenH, layout, dockFor('row'), shapes);
  if (row.dock.items.n === 0 || row.dock.items.mode === 'pouch') return row;
  const pouch = fullBleedFit(screenW, screenH, layout, dockFor('pouch'), shapes);
  const [iw, ih] = layout.imageSize;
  const rowBad = unreachablePlots(shapes, iw, ih, screenW, screenH, row.fit.scale, row.pan, row.dock).length;
  const pouchBad = unreachablePlots(shapes, iw, ih, screenW, screenH, pouch.fit.scale, pouch.pan, pouch.dock).length;
  if (rowBad !== pouchBad) return rowBad > pouchBad ? pouch : row;
  if (row.fit.scale > pouch.fit.scale + 1e-6) return pouch;
  return dockCost(shapes, row) > dockCost(shapes, pouch) ? pouch : row;
}

export function fullBleedFit(screenW: number, screenH: number, layout: Level2DLayout, dock: HudDock, shapes: HardShapes = hardShapes(layout)): FullBleedResult {
  const [iw, ih] = layout.imageSize;
  const [sx, sy, sw, sh] = layout.safeArea;
  const m = shapes.mustSee;
  const cover = Math.max(screenW / iw, screenH / ih);
  const baseScale = viewScale(screenW, screenH, iw, ih);
  const fixed: Rect[] = [dock.buttons, dock.plaque, dock.banner].map((r) => grow({ x: r.x, y: r.y, w: r.w, h: r.h }, HARD_MARGIN));
  const info = grow(dock.info, HARD_MARGIN);
  const hornHome = grow(dock.hornBox, HARD_MARGIN);
  const hornAlt = dock.hornAlt;
  const hornAltBox = hornAlt ? grow(hornAlt.hornBox, HARD_MARGIN) : null;
  const hornPairs: readonly (readonly [HornSpot, Rect])[] = [
    [{ horn: dock.horn, hornBox: dock.hornBox }, hornHome],
    ...(hornAlt && hornAltBox ? [[hornAlt, hornAltBox] as const] : []),
  ];
  /** Shapes a rect covers (a road counts half: the eye finds the road again either side). */
  const cost = (f: FitLike, r: Rect): number => {
    let n = 0;
    for (const o of hardOverlaps(shapes, f, r)) n += o.kind === 'road' ? 0.5 : 1;
    return n;
  };
  const trayHiFor = (hb: Rect): number => {
    const sameRow = hb.y < dock.tray.y + dock.tray.h && hb.y + hb.h > dock.tray.y && hb.x > dock.tray.x;
    return sameRow ? Math.min(dock.trayRange[1], hb.x - dock.gap - dock.tray.w) : dock.trayRange[1];
  };
  /** Reachable `(horn, trayX)` choices at `scale` (empty when `scale` leaves a plot trapped). */
  const reachableChoices = (scale: number): { horn: HornSpot; box: Rect; trayXs: number[]; fixedRects: Rect[] }[] => {
    const pan = panRange(screenW, screenH, iw, ih, scale);
    const out: { horn: HornSpot; box: Rect; trayXs: number[]; fixedRects: Rect[] }[] = [];
    for (const [horn, box] of hornPairs) {
      const trayHi = trayHiFor(horn.hornBox);
      if (trayHi < dock.trayRange[0]) continue;
      const fixedRects: Rect[] = [
        dock.buttons,
        dock.info,
        { x: dock.plaque.x, y: dock.plaque.y, w: dock.plaque.w, h: dock.plaque.h },
        dock.banner,
        horn.hornBox,
      ];
      // Fast reject: if any plot is already trapped by the non-sliding pieces, no trayX can help.
      let fixedOk = true;
      for (const p of shapes.plots) {
        if (!plotReachable(p, iw, ih, screenW, screenH, scale, pan, fixedRects)) {
          fixedOk = false;
          break;
        }
      }
      if (!fixedOk) continue;
      const lo = dock.trayRange[0];
      const homeX = Math.min(trayHi, Math.max(lo, dock.tray.x));
      const cands: number[] = [homeX];
      if (trayHi > lo + 0.5) {
        const steps = 12;
        for (let i = 0; i <= steps; i++) {
          const tx = lo + ((trayHi - lo) * i) / steps;
          if (Math.abs(tx - homeX) > 0.5) cands.push(tx);
        }
      }
      const trayXs: number[] = [];
      for (const tx of cands) {
        const rects = [...fixedRects, { ...dock.tray, x: tx }];
        let ok = true;
        for (const p of shapes.plots) {
          if (!plotReachable(p, iw, ih, screenW, screenH, scale, pan, rects)) {
            ok = false;
            break;
          }
        }
        if (ok) trayXs.push(tx);
      }
      if (trayXs.length > 0) {
        // Keep a compact representative subset (home / endpoints / evenly spaced) for fast default-view scoring.
        const slim =
          trayXs.length <= 5
            ? trayXs
            : [trayXs[0], trayXs[Math.floor(trayXs.length / 4)], trayXs[Math.floor(trayXs.length / 2)], trayXs[Math.floor((trayXs.length * 3) / 4)], trayXs[trayXs.length - 1]];
        out.push({ horn, box, trayXs: slim, fixedRects });
      }
    }
    return out;
  };
  const fitAtScale = (scale: number, allowed: ReturnType<typeof reachableChoices> | null): FullBleedResult => {
    const pan = panRange(screenW, screenH, iw, ih, scale);
    const evalAt = (ox: number, oy: number): { dock: HudDock; cost: number; info: number } => {
      const f: FitLike = { scale, offsetX: ox, offsetY: oy };
      let c = 0;
      for (const r of fixed) c += cost(f, r);
      let pick: { horn: HornSpot; trayX: number; c: number; dist: number } | null = null;
      if (allowed) {
        for (const ch of allowed) {
          const hb = ch.horn.hornBox;
          const trayHi = trayHiFor(hb);
          const baseC = cost(f, ch.box);
          // Try slideX first: if the free spot is also reachable, it has zero tray cost.
          const txSlide = slideX(shapes, f, dock.tray, dock.trayRange[0], trayHi);
          if (txSlide !== null) {
            const rects = [...ch.fixedRects, { ...dock.tray, x: txSlide }];
            if (shapes.plots.every((p) => plotReachable(p, iw, ih, screenW, screenH, scale, pan, rects))) {
              const dist = Math.abs(txSlide - dock.tray.x);
              if (!pick || baseC < pick.c || (baseC === pick.c && dist < pick.dist)) pick = { horn: ch.horn, trayX: txSlide, c: baseC, dist };
              if (baseC === 0) break;
              continue;
            }
          }
          for (const tx of ch.trayXs) {
            const hc = baseC + cost(f, grow({ ...dock.tray, x: tx }, HARD_MARGIN));
            const dist = Math.abs(tx - dock.tray.x);
            if (!pick || hc < pick.c || (hc === pick.c && dist < pick.dist)) pick = { horn: ch.horn, trayX: tx, c: hc, dist };
            if (hc === 0) break;
          }
          if (pick && pick.c === 0) break;
        }
      } else {
        // Horn above the banner, or left of it (then the tray's room ends at the horn); the tray
        // slides clear along the bottom where it can. The pair covering least wins (home on a tie).
        for (const [horn, box] of hornPairs) {
          const trayHi = trayHiFor(horn.hornBox);
          if (trayHi < dock.trayRange[0]) continue;
          const tx = slideX(shapes, f, dock.tray, dock.trayRange[0], trayHi);
          const trayX = tx ?? Math.min(trayHi, Math.max(dock.trayRange[0], dock.tray.x));
          const hc = cost(f, box) + (tx === null ? cost(f, grow({ ...dock.tray, x: trayX }, HARD_MARGIN)) : 0);
          if (!pick || hc < pick.c) pick = { horn, trayX, c: hc, dist: Math.abs(trayX - dock.tray.x) };
          if (hc === 0) break;
        }
      }
      const chosen = pick ?? { horn: { horn: dock.horn, hornBox: dock.hornBox }, trayX: dock.tray.x, c: cost(f, hornHome) + cost(f, grow(dock.tray, HARD_MARGIN)), dist: 0 };
      c += chosen.c;
      return { dock: { ...dock, horn: chosen.horn.horn, hornBox: chosen.horn.hornBox, tray: { ...dock.tray, x: chosen.trayX } }, cost: c, info: cost(f, info) };
    };
    // Preferred: the safe area centred, inside the pan range and (where it can) the must-see range.
    const [mx0, mx1] = mustAxis(screenW, m.x, m.w, scale);
    const [my0, my1] = mustAxis(screenH, m.y, m.h, scale);
    const pickAxis = (lo: number, hi: number, a: number, b: number, want: number): number => {
      const l2 = Math.max(lo, a);
      const h2 = Math.min(hi, b);
      return l2 <= h2 ? Math.min(h2, Math.max(l2, want)) : Math.min(hi, Math.max(lo, want));
    };
    const px = pickAxis(pan.minX, pan.maxX, mx0, mx1, screenW / 2 - (sx + sw / 2) * scale);
    const py = pickAxis(pan.minY, pan.maxY, my0, my1, screenH / 2 - (sy + sh / 2) * scale);
    const divs = allowed ? 20 : 40;
    const xs = samples(pan.minX, pan.maxX, px, Math.max(2, (pan.maxX - pan.minX) / divs));
    const ys = samples(pan.minY, pan.maxY, py, Math.max(2, (pan.maxY - pan.minY) / divs));
    const cand: [number, number, number][] = [];
    for (const x of xs) for (const y of ys) cand.push([Math.hypot(x - px, y - py), x, y]);
    cand.sort((a, b) => a[0] - b[0]);
    const mustOk = (ox: number, oy: number): boolean => ox >= mx0 - 0.5 && ox <= mx1 + 0.5 && oy >= my0 - 0.5 && oy <= my1 + 0.5;
    /** Gameplay the view leaves off screen: plots not wholly on it, caves / the castle whose middle is off it (twice: the entrances matter most). */
    const offScreen = (ox: number, oy: number): number => {
      let n = 0;
      for (const p of shapes.plots) {
        const x = ox + p.x * scale;
        const y = oy + p.y * scale;
        const r = p.r * scale;
        if (x - r < 0 || y - r < 0 || x + r > screenW || y + r > screenH) n++;
      }
      for (const g of shapes.gates) {
        const x = ox + (g.x + g.w / 2) * scale;
        const y = oy + (g.y + g.h / 2) * scale;
        if (x < 0 || y < 0 || x > screenW || y > screenH) n += 2;
      }
      return n;
    };
    // Ranked by the gameplay hidden — under a piece (the info card counts half: it shows between
    // waves only) or off screen — then by showing the must-see box whole, then by distance from the
    // preferred view.
    let best: { key: number; ox: number; oy: number; r: ReturnType<typeof evalAt> } | null = null;
    for (const [, ox, oy] of cand) {
      const r = evalAt(ox, oy);
      const key = (r.cost + r.info * 0.5 + offScreen(ox, oy)) * 2 + (mustOk(ox, oy) ? 0 : 1);
      if (!best || key < best.key) best = { key, ox, oy, r };
      if (key === 0) break;
    }
    const b = best!;
    const f = fitAt(screenW, screenH, iw, ih, scale, b.ox, b.oy);
    return {
      fit: { ...f, shrink: scale / cover, coverage: coverageOf(screenW, screenH, f), clear: b.r.cost === 0 && b.r.info === 0, clearButInfo: b.r.cost === 0 },
      dock: b.r.dock,
      pan,
    };
  };

  const base = fitAtScale(baseScale, null);
  if (unreachablePlots(shapes, iw, ih, screenW, screenH, baseScale, base.pan, base.dock).length === 0) return base;

  // Stage 1: keep baseScale (zero extra zoom) and nudge the tray / horn so every plot can be reached.
  const atBase = reachableChoices(baseScale);
  if (atBase.length > 0) return fitAtScale(baseScale, atBase);

  // Stage 2: on covered screens where baseScale leaves too little pan room (e.g. phone landscape
  // matching the map's aspect), grow scale strictly inside [baseScale, cover × MAX_REACH_ZOOM] —
  // never opening any band — just far enough that every plot can be panned clear of the HUD.
  const covered = iw * baseScale >= screenW - 1e-6 && ih * baseScale >= screenH - 1e-6;
  const maxScale = Math.max(baseScale, cover * MAX_REACH_ZOOM);
  if (covered && maxScale > baseScale + 1e-6) {
    let bestChoices = reachableChoices(maxScale);
    if (bestChoices.length > 0) {
      let lo = baseScale;
      let hi = maxScale;
      for (let iter = 0; iter < 7; iter++) {
        const mid = (lo + hi) / 2;
        const ch = reachableChoices(mid);
        if (ch.length > 0) {
          hi = mid;
          bestChoices = ch;
        } else {
          lo = mid;
        }
      }
      return fitAtScale(hi, bestChoices);
    }
  }
  return base;
}
