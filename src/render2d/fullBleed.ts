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

/**
 * Offsets (screen px of image px (0, 0)) the view may pan between: inside the painting, bar the
 * reach past a covered edge a plot under the HUD needs (reachRange; MapView mirrors the art there).
 */
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
export function slideX(s: HardShapes, fit: FitLike, r: Rect, lo: number, hi: number, margin = HARD_MARGIN): number | null {
  if (hi < lo) return null;
  const k = fit.scale;
  const m = margin;
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

/** Safety margin (css px) kept between a plot's tap circle and any HUD rect at the default view. */
export const PLOT_HUD_MARGIN = HARD_MARGIN;

/**
 * Pure geometry check: indices of plots whose tap circle (radius `p.r * fit.scale + margin`,
 * matching the plot layer's radius) intersects any screen rect in `rects`.
 */
export function coveredPlotIndices(plots: readonly Circle[], fit: FitLike, rects: readonly Rect[], margin = 0): number[] {
  const out: number[] = [];
  const k = fit.scale;
  for (let i = 0; i < plots.length; i++) {
    const p = plots[i];
    const sx = fit.offsetX + p.x * k;
    const sy = fit.offsetY + p.y * k;
    const sr = p.r * k + margin;
    const sr2 = sr * sr;
    for (let j = 0; j < rects.length; j++) {
      const r = rects[j];
      const nx = Math.max(r.x, Math.min(sx, r.x + r.w));
      const ny = Math.max(r.y, Math.min(sy, r.y + r.h));
      const dx = sx - nx;
      const dy = sy - ny;
      if (dx * dx + dy * dy < sr2) {
        out.push(i);
        break;
      }
    }
  }
  return out;
}

/** Hard shapes every dock piece covers at a fit's default view (+½ when the island can't clear). */
export function dockCost(shapes: HardShapes, r: FullBleedResult): number {
  let n = r.fit.clear ? 0 : 0.5;
  for (const rect of Object.values(dockPieces(r.dock))) {
    for (const o of hardOverlaps(shapes, r.fit, rect)) n += o.kind === 'plot' ? 10 : 1;
  }
  return n;
}

/** Scale factors tried in descending order when the default cover-fit cannot clear every plot. */
const PLOT_CLEAR_SCALES = [1, 0.98, 0.96, 0.94, 0.92, 0.9, 0.88, 0.86, 0.84, 0.82, 0.8, 0.78, 0.76, 0.74, 0.72] as const;

/**
 * Finds a default camera placement (and tray/horn/item-mode choice) where NO tower plot is covered
 * by any HUD piece (within `margin` px). Returns `base` untouched when it already clears every plot.
 * Otherwise tries auto-nudging the camera into mirrored-edge reach at full scale first, then steps
 * the scale down gently only as far as needed to leave every plot tappable without panning.
 */
export function fitClearOfPlots(
  screenW: number,
  screenH: number,
  layout: Level2DLayout,
  dockFor: (mode: 'row' | 'pouch') => HudDock,
  shapes: HardShapes,
  base: FullBleedResult,
  margin = PLOT_HUD_MARGIN,
): FullBleedResult {
  const baseHits0 = coveredPlotIndices(shapes.plots, base.fit, Object.values(dockPieces(base.dock)), 0).length;
  const baseHitsM = baseHits0 > 0 ? baseHits0 : coveredPlotIndices(shapes.plots, base.fit, Object.values(dockPieces(base.dock)), margin).length;
  if (baseHitsM === 0) return base;
  const [iw, ih] = layout.imageSize;
  const [sx, sy, sw, sh] = layout.safeArea;
  const cover = Math.max(screenW / iw, screenH / ih);
  const baseScale = viewScale(screenW, screenH, iw, ih);
  const plotsOnly: HardShapes = { ...shapes, roads: [], gates: [] };
  const rowDock = dockFor('row');
  const docks: HudDock[] = rowDock.items.n > 0 && rowDock.items.mode !== 'pouch' ? [rowDock, dockFor('pouch')] : [rowDock];

  const nonPlotCost = (fit: FitLike, rects: readonly Rect[]): number => {
    let n = 0;
    for (const r of rects) {
      for (const o of hardOverlaps(shapes, fit, r)) {
        if (o.kind !== 'plot') n += o.kind === 'road' ? 0.5 : 1;
      }
    }
    return n;
  };

  for (const sm of PLOT_CLEAR_SCALES) {
    const sc = baseScale * sm;
    const pr = panRange(screenW, screenH, iw, ih, sc);
    // Keep horizontal reach tight when the painting already covers screenW (avoids wide side mirror seams on desktop).
    const capX = iw * sc >= screenW - 0.5 ? Math.min(screenW * 0.05, 64) : screenW * 0.14;
    const capY = screenH * 0.24;
    const minX = Math.min(pr.minX, pr.maxX) - capX;
    const maxX = Math.max(pr.minX, pr.maxX) + capX;
    const minY = Math.min(pr.minY, pr.maxY) - capY;
    const maxY = Math.max(pr.minY, pr.maxY) + capY;
    const prefX = screenW / 2 - (sx + sw / 2) * sc;
    const prefY = screenH / 2 - (sy + sh / 2) * sc;
    const steps = 18;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i <= steps; i++) {
      xs.push(minX + ((maxX - minX) * i) / steps);
      ys.push(minY + ((maxY - minY) * i) / steps);
    }
    xs.push(Math.min(maxX, Math.max(minX, pr.minX)), Math.min(maxX, Math.max(minX, pr.maxX)), Math.min(maxX, Math.max(minX, prefX)));
    ys.push(Math.min(maxY, Math.max(minY, pr.minY)), Math.min(maxY, Math.max(minY, pr.maxY)), Math.min(maxY, Math.max(minY, prefY)));

    let best: { score: number; ox: number; oy: number; dock: HudDock; nonPlot: number } | null = null;
    for (const dock of docks) {
      const horns: HornSpot[] = [{ horn: dock.horn, hornBox: dock.hornBox }, ...(dock.hornAlt ? [dock.hornAlt] : [])];
      const fixed: Rect[] = [dock.buttons, dock.info, { x: dock.plaque.x, y: dock.plaque.y, w: dock.plaque.w, h: dock.plaque.h }, dock.banner];
      for (const ox of xs) {
        for (const oy of ys) {
          let offY = false;
          let offX = 0;
          for (let i = 0; i < shapes.plots.length; i++) {
            const p = shapes.plots[i];
            const px = ox + p.x * sc;
            const py = oy + p.y * sc;
            const prs = p.r * sc;
            if (py - prs < -1 || py + prs > screenH + 1) {
              offY = true;
              break;
            }
            if (px - prs < -1 || px + prs > screenW + 1) offX++;
          }
          if (offY) continue;
          const fit: FitLike = { scale: sc, offsetX: ox, offsetY: oy };
          // Quick reject: if any fixed piece covers a plot, neither horn nor tray can save this offset.
          if (coveredPlotIndices(shapes.plots, fit, fixed, margin).length > 0) continue;
          for (const horn of horns) {
            if (coveredPlotIndices(shapes.plots, fit, [horn.hornBox], margin).length > 0) continue;
            const hb = horn.hornBox;
            const sameRow = hb.y < dock.tray.y + dock.tray.h && hb.y + hb.h > dock.tray.y && hb.x > dock.tray.x;
            const trayHi = sameRow ? Math.min(dock.trayRange[1], hb.x - dock.gap - dock.tray.w) : dock.trayRange[1];
            if (trayHi < dock.trayRange[0]) continue;
            const tx = slideX(plotsOnly, fit, dock.tray, dock.trayRange[0], trayHi, margin);
            if (tx === null) continue;
            const trayRect: Rect = { ...dock.tray, x: tx };
            const allPieces: Rect[] = [...fixed, horn.hornBox, trayRect];
            if (coveredPlotIndices(shapes.plots, fit, [trayRect], margin).length > 0) continue;
            const np = nonPlotCost(fit, allPieces);
            let offGates = 0;
            for (let g = 0; g < shapes.gates.length; g++) {
              const gt = shapes.gates[g];
              const gx = ox + (gt.x + gt.w / 2) * sc;
              const gy = oy + (gt.y + gt.h / 2) * sc;
              if (gx < 0 || gy < 0 || gx > screenW || gy > screenH) offGates++;
            }
            const reachX = Math.max(0, pr.minX - ox, ox - pr.maxX);
            const reachY = Math.max(0, pr.minY - oy, oy - pr.maxY);
            const score = (offX + offGates * 2) * 10_000 + np * 100 + (reachX * 2 + reachY) * 10 + Math.hypot(ox - prefX, oy - prefY) * 0.1 + (dock.items.mode === 'pouch' ? 0.05 : 0);
            if (!best || score < best.score) {
              best = { score, ox, oy, dock: { ...dock, horn: horn.horn, hornBox: horn.hornBox, tray: trayRect }, nonPlot: np };
            }
          }
        }
      }
    }
    if (best) {
      const f = fitAt(screenW, screenH, iw, ih, sc, best.ox, best.oy);
      const basePan = reachRange(pr, best.dock, shapes, sc, screenW, screenH, iw, ih);
      const pan: PanRange = {
        minX: Math.min(basePan.minX, best.ox),
        maxX: Math.max(basePan.maxX, best.ox),
        minY: Math.min(basePan.minY, best.oy),
        maxY: Math.max(basePan.maxY, best.oy),
      };
      const allPieces = Object.values(dockPieces(best.dock));
      const anyHard = allPieces.some((r) => hardOverlaps(shapes, f, r, true).length > 0);
      const anyNonInfo = Object.entries(dockPieces(best.dock)).some(([k, r]) => k !== 'info' && hardOverlaps(shapes, f, r, true).length > 0);
      const out: FullBleedResult = {
        fit: { ...f, shrink: sc / cover, coverage: coverageOf(screenW, screenH, f), clear: !anyHard, clearButInfo: !anyNonInfo },
        dock: best.dock,
        pan,
      };
      // If base already had 0 strict plot overlaps, only replace it when the extra margin doesn't worsen dockCost.
      if (baseHits0 === 0 && dockCost(shapes, out) > dockCost(shapes, base)) return base;
      return out;
    }
  }
  return base;
}

/**
 * The fit with the item belt in the tray: its row form where the bottom line has room and it covers
 * no more of the island than the one-button pouch would; else the pouch (the slots open above the
 * tray on a tap, Z / X / C still cast straight away). Guarantees no tower plot sits under any HUD
 * piece at the default view (auto-nudging the camera / scaling gently when needed).
 */
export function fullBleedFitItems(screenW: number, screenH: number, layout: Level2DLayout, dockFor: (mode: 'row' | 'pouch') => HudDock, shapes: HardShapes = hardShapes(layout)): FullBleedResult {
  const row = fullBleedFit(screenW, screenH, layout, dockFor('row'), shapes);
  let base = row;
  if (row.dock.items.n > 0 && row.dock.items.mode !== 'pouch') {
    const pouch = fullBleedFit(screenW, screenH, layout, dockFor('pouch'), shapes);
    if (dockCost(shapes, row) > dockCost(shapes, pouch)) base = pouch;
  }
  return fitClearOfPlots(screenW, screenH, layout, dockFor, shapes, base);
}

export function fullBleedFit(screenW: number, screenH: number, layout: Level2DLayout, dock: HudDock, shapes: HardShapes = hardShapes(layout)): FullBleedResult {
  const [iw, ih] = layout.imageSize;
  const [sx, sy, sw, sh] = layout.safeArea;
  const m = shapes.mustSee;
  const cover = Math.max(screenW / iw, screenH / ih);
  const scale = viewScale(screenW, screenH, iw, ih);
  const pan = panRange(screenW, screenH, iw, ih, scale);
  const fixed: Rect[] = [dock.buttons, dock.plaque, dock.banner].map((r) => grow({ x: r.x, y: r.y, w: r.w, h: r.h }, HARD_MARGIN));
  const info = grow(dock.info, HARD_MARGIN);
  const hornHome = grow(dock.hornBox, HARD_MARGIN);
  const hornAlt = dock.hornAlt;
  const hornAltBox = hornAlt ? grow(hornAlt.hornBox, HARD_MARGIN) : null;
  /** Shapes a rect covers (a road counts half: the eye finds the road again either side). */
  const cost = (f: FitLike, r: Rect): number => {
    let n = 0;
    for (const o of hardOverlaps(shapes, f, r)) n += o.kind === 'road' ? 0.5 : 1;
    return n;
  };
  /** The dock placed at an offset (horn home / alt, tray slid clear where it can) and what it covers. */
  const evalAt = (ox: number, oy: number): { dock: HudDock; cost: number; info: number } => {
    const f: FitLike = { scale, offsetX: ox, offsetY: oy };
    let c = 0;
    for (const r of fixed) c += cost(f, r);
    // Horn above the banner, or left of it (then the tray's room ends at the horn); the tray
    // slides clear along the bottom where it can. The pair covering least wins (home on a tie).
    let pick: { horn: HornSpot; trayX: number; c: number } | null = null;
    for (const [horn, box] of [[{ horn: dock.horn, hornBox: dock.hornBox }, hornHome], ...(hornAlt && hornAltBox ? [[hornAlt, hornAltBox] as const] : [])] as const) {
      const hb = horn.hornBox;
      const sameRow = hb.y < dock.tray.y + dock.tray.h && hb.y + hb.h > dock.tray.y && hb.x > dock.tray.x;
      const trayHi = sameRow ? Math.min(dock.trayRange[1], hb.x - dock.gap - dock.tray.w) : dock.trayRange[1];
      // No room left for the tray between the plaque and this horn spot.
      if (trayHi < dock.trayRange[0]) continue;
      const tx = slideX(shapes, f, dock.tray, dock.trayRange[0], trayHi);
      const trayX = tx ?? Math.min(trayHi, Math.max(dock.trayRange[0], dock.tray.x));
      const hc = cost(f, box) + (tx === null ? cost(f, grow({ ...dock.tray, x: trayX }, HARD_MARGIN)) : 0);
      if (!pick || hc < pick.c) pick = { horn, trayX, c: hc };
      if (hc === 0) break;
    }
    const chosen = pick ?? { horn: { horn: dock.horn, hornBox: dock.hornBox }, trayX: dock.tray.x, c: cost(f, hornHome) + cost(f, grow(dock.tray, HARD_MARGIN)) };
    c += chosen.c;
    const horn = chosen.horn;
    const trayX = chosen.trayX;
    return { dock: { ...dock, horn: horn.horn, hornBox: horn.hornBox, tray: { ...dock.tray, x: trayX } }, cost: c, info: cost(f, info) };
  };
  // Preferred: the safe area centred, inside the pan range and (where it can) the must-see range.
  const [mx0, mx1] = mustAxis(screenW, m.x, m.w, scale);
  const [my0, my1] = mustAxis(screenH, m.y, m.h, scale);
  const pick = (lo: number, hi: number, a: number, b: number, want: number): number => {
    const l2 = Math.max(lo, a);
    const h2 = Math.min(hi, b);
    return l2 <= h2 ? Math.min(h2, Math.max(l2, want)) : Math.min(hi, Math.max(lo, want));
  };
  const px = pick(pan.minX, pan.maxX, mx0, mx1, screenW / 2 - (sx + sw / 2) * scale);
  const py = pick(pan.minY, pan.maxY, my0, my1, screenH / 2 - (sy + sh / 2) * scale);
  const xs = samples(pan.minX, pan.maxX, px, Math.max(2, (pan.maxX - pan.minX) / 40));
  const ys = samples(pan.minY, pan.maxY, py, Math.max(2, (pan.maxY - pan.minY) / 40));
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
    pan: reachRange(pan, b.r.dock, shapes, scale, screenW, screenH, iw, ih),
  };
}

/** Most the pan may reach past a covered edge, as a share of the screen along that axis. */
export const REACH_MAX = 0.25;

/** The dock pieces a plot's tap area must clear to be tapped (the horn at its dock spot: the worst case). */
export function reachPieces(dock: HudDock): Rect[] {
  return Object.values(dockPieces(dock));
}

/**
 * The pan range grown past the painting's edges just far enough that every plot can be brought
 * to a spot where its tap area (the plot's circle, the part painted on the map) lies on screen
 * and under no dock piece (owner feedback 2026-11-21: never an empty band, yet every plot must be
 * tappable). Only an axis the painting covers grows (MapView fills that strip with the painting
 * mirrored about its edge, so it reads as more of the same edge art, not a frame); usually by
 * 0 on a desktop, a few dozen px on a phone where the tray sits over the bottom of the island.
 * The default view never uses it.
 *
 * Per plot: the offsets clearing it are the allowed box (screen, range + REACH_MAX) minus each
 * piece grown by the plot's radius (a box — a hair stricter than the circle); a free offset with
 * the least reach lies on a box edge or a range bound, so only those candidates are tried. Each
 * side then reaches as far as its neediest plot.
 */
export function reachRange(pan: PanRange, dock: HudDock, shapes: HardShapes, scale: number, screenW: number, screenH: number, imageW: number, imageH: number): PanRange {
  const pieces = reachPieces(dock);
  const coverX = imageW * scale >= screenW * 0.68;
  const coverY = imageH * scale >= screenH * 0.68;
  const capX = coverX ? screenW * REACH_MAX : 0;
  const capY = coverY ? screenH * REACH_MAX : 0;
  let extL = 0;
  let extR = 0;
  let extT = 0;
  let extB = 0;
  for (const c of shapes.plots) {
    const R = c.r * scale;
    const cx = c.x * scale;
    const cy = c.y * scale;
    // The plot's painted part must be on screen (a plot may poke a px past the art's edge).
    const x0 = Math.max(0, c.x - c.r) * scale;
    const x1 = Math.min(imageW, c.x + c.r) * scale;
    const y0 = Math.max(0, c.y - c.r) * scale;
    const y1 = Math.min(imageH, c.y + c.r) * scale;
    const ax0 = Math.max(pan.minX - capX, -x0);
    const ax1 = Math.min(pan.maxX + capX, screenW - x1);
    const ay0 = Math.max(pan.minY - capY, -y0);
    const ay1 = Math.min(pan.maxY + capY, screenH - y1);
    if (ax1 < ax0 || ay1 < ay0) continue;
    // Blocked offsets (open boxes) per piece.
    const boxes = pieces.map((b) => [b.x - R - cx, b.x + b.w + R - cx, b.y - R - cy, b.y + b.h + R - cy] as const);
    const free = (ox: number, oy: number): boolean => boxes.every(([bx0, bx1, by0, by1]) => ox <= bx0 || ox >= bx1 || oy <= by0 || oy >= by1);
    const inside = (v: number, lo: number, hi: number): boolean => v >= lo && v <= hi;
    const xs = [ax0, ax1, Math.min(ax1, Math.max(ax0, pan.minX)), Math.min(ax1, Math.max(ax0, pan.maxX))];
    const ys = [ay0, ay1, Math.min(ay1, Math.max(ay0, pan.minY)), Math.min(ay1, Math.max(ay0, pan.maxY))];
    for (const [bx0, bx1, by0, by1] of boxes) {
      if (inside(bx0, ax0, ax1)) xs.push(bx0);
      if (inside(bx1, ax0, ax1)) xs.push(bx1);
      if (inside(by0, ay0, ay1)) ys.push(by0);
      if (inside(by1, ay0, ay1)) ys.push(by1);
    }
    let best: [number, number, number, number] | null = null;
    let bestCost = Infinity;
    for (const ox of xs) {
      for (const oy of ys) {
        if (!free(ox, oy)) continue;
        // Reach this offset needs on each side (left / right / top / bottom of the painting).
        const need: [number, number, number, number] = [Math.max(0, ox - pan.maxX), Math.max(0, pan.minX - ox), Math.max(0, oy - pan.maxY), Math.max(0, pan.minY - oy)];
        // Reach already granted (another plot) is free; then the least new reach.
        const cost = Math.max(0, need[0] - extL) + Math.max(0, need[1] - extR) + Math.max(0, need[2] - extT) + Math.max(0, need[3] - extB) + (need[0] + need[1] + need[2] + need[3]) * 1e-3;
        if (cost < bestCost) {
          bestCost = cost;
          best = need;
        }
      }
    }
    if (!best) continue;
    extL = Math.max(extL, best[0]);
    extR = Math.max(extR, best[1]);
    extT = Math.max(extT, best[2]);
    extB = Math.max(extB, best[3]);
  }
  // A hair more than needed, so the plot's circle clears the piece's edge after rounding.
  const g = (v: number): number => (v > 0 ? Math.ceil(v + 1) : 0);
  return { minX: pan.minX - g(extR), maxX: pan.maxX + g(extL), minY: pan.minY - g(extB), maxY: pan.maxY + g(extT) };
}
