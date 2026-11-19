/**
 * Full-bleed map fit (pure, no Pixi / DOM): the painted map covers the screen and the HUD sits in
 * the corners over it. The map's decorative edges are cropped first; what must stay visible is the
 * island's gameplay (`mustSee`: plots, the roads inside the safe area, cave mouths, the castle).
 *
 * The HUD pieces sit at their corner (hudDock.ts). A piece may lie over decorative art, never over
 * a plot, a cave or the castle, and over a road only where the road runs outside the safe area
 * (the outer decorative margin). When a piece would cover one of those:
 *  1. the map shifts inside its crop slack (offset nearest the centred one),
 *  2. the sliding pieces move along their edge (tray along the bottom, info card along the top),
 *     the horn may stand left of the banner instead of above it,
 *  3. only then the map shrinks, by the smallest step that clears (that island at that screen).
 *
 * Shrinking or an extreme aspect opens bands; MapView fills them with the painted frame.
 */
import { gateKeepOutsPx, type Rect } from './uiLayout.ts';
import { distSegRect, playfieldShapes, type Circle, type FitLike, type Seg } from './playfield.ts';
import type { Level2DLayout } from '../data/levels/types.ts';
import type { MapFit } from './viewFit.ts';
import type { HudDock } from './hudDock.ts';

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
  /** Scale relative to the cover scale (1 = full bleed). */
  readonly shrink: number;
  /** Share of the screen the map image covers (0..1). */
  readonly coverage: number;
  /** False only when no tried placement keeps every piece clear (the best try is returned). */
  readonly clear: boolean;
}

export interface FullBleedResult {
  readonly fit: FullBleedFit;
  /** The dock with its sliding pieces placed for this island. */
  readonly dock: HudDock;
}

/** Smallest map scale tried, relative to cover (an extreme aspect may need it). */
const MIN_SHRINK = 0.55;

function grow(r: Rect, m: number): Rect {
  return { x: r.x - m, y: r.y - m, w: r.w + m * 2, h: r.h + m * 2 };
}

/** Offsets (one axis) at `scale`: [lo, hi] and the preferred one, or null if `must` can't be shown. */
function axis(screen: number, image: number, safeStart: number, safeLen: number, mustStart: number, mustLen: number, scale: number): [number, number, number] | null {
  const img = image * scale;
  // Must-see on screen.
  let lo = -mustStart * scale;
  let hi = screen - (mustStart + mustLen) * scale;
  if (img >= screen) {
    // The image covers this axis (no band).
    lo = Math.max(lo, screen - img);
    hi = Math.min(hi, 0);
  }
  // Smaller than the screen: anywhere that shows the must-see box (cropping a decorative edge
  // gives one wider band on the other side, for the HUD to sit on).
  if (lo > hi + 1e-6) return null;
  // Preferred: the safe area centred, then clamped.
  const pref = Math.min(hi, Math.max(lo, screen / 2 - (safeStart + safeLen / 2) * scale));
  return [lo, hi, pref];
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

function fitAt(screenW: number, screenH: number, imageW: number, imageH: number, scale: number, ox: number, oy: number): MapFit {
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

export function fullBleedFit(screenW: number, screenH: number, layout: Level2DLayout, dock: HudDock, shapes: HardShapes = hardShapes(layout)): FullBleedResult {
  const [iw, ih] = layout.imageSize;
  const [sx, sy, sw, sh] = layout.safeArea;
  const m = shapes.mustSee;
  const cover = Math.max(screenW / iw, screenH / ih);
  const fixed: Rect[] = [dock.buttons, dock.plaque, dock.banner].map((r) => grow({ x: r.x, y: r.y, w: r.w, h: r.h }, HARD_MARGIN));
  const hornAlt = dock.hornAlt;
  const tryAt = (scale: number, ox: number, oy: number): HudDock | null => {
    const f: FitLike = { scale, offsetX: ox, offsetY: oy };
    for (const r of fixed) if (hardOverlaps(shapes, f, r, true).length > 0) return null;
    // Horn: above the banner, else left of it (then the tray's room ends at the horn).
    let horn = { horn: dock.horn, hornBox: dock.hornBox };
    if (hardOverlaps(shapes, f, grow(dock.hornBox, HARD_MARGIN), true).length > 0) {
      if (!hornAlt || hardOverlaps(shapes, f, grow(hornAlt.hornBox, HARD_MARGIN), true).length > 0) return null;
      horn = hornAlt;
    }
    // A horn on the tray's row ends the tray's room.
    const hb = horn.hornBox;
    const sameRow = hb.y < dock.tray.y + dock.tray.h && hb.y + hb.h > dock.tray.y && hb.x > dock.tray.x;
    const trayHi = sameRow ? Math.min(dock.trayRange[1], hb.x - dock.gap - dock.tray.w) : dock.trayRange[1];
    const tx = slideX(shapes, f, dock.tray, dock.trayRange[0], trayHi);
    if (tx === null) return null;
    const ix = slideX(shapes, f, dock.info, dock.infoRange[0], dock.infoRange[1]);
    if (ix === null) return null;
    return { ...dock, horn: horn.horn, hornBox: horn.hornBox, tray: { ...dock.tray, x: tx }, info: { ...dock.info, x: ix } };
  };
  /** The clear placement at scale `k` × cover nearest the preferred one, or null. */
  const at = (k: number): FullBleedResult | null => {
    const scale = cover * k;
    const ax = axis(screenW, iw, sx, sw, m.x, m.w, scale);
    const ay = axis(screenH, ih, sy, sh, m.y, m.h, scale);
    if (!ax || !ay) return null;
    const xs = samples(ax[0], ax[1], ax[2], Math.max(2, (ax[1] - ax[0]) / 48));
    const ys = samples(ay[0], ay[1], ay[2], Math.max(2, (ay[1] - ay[0]) / 48));
    const cand: [number, number, number][] = [];
    for (const x of xs) for (const y of ys) cand.push([Math.hypot(x - ax[2], y - ay[2]), x, y]);
    cand.sort((a, b) => a[0] - b[0]);
    for (const [, ox, oy] of cand) {
      const placed = tryAt(scale, ox, oy);
      if (placed) {
        const f = fitAt(screenW, screenH, iw, ih, scale, ox, oy);
        return { fit: { ...f, shrink: k, coverage: coverageOf(screenW, screenH, f), clear: true }, dock: placed };
      }
    }
    return null;
  };
  // Largest scale that clears: 2 % steps down from cover, then halved back up (≈ 0.1 %).
  let okK = -1;
  let ok: FullBleedResult | null = null;
  for (let k = 1; k >= MIN_SHRINK - 1e-9; k -= 0.02) {
    ok = at(k);
    if (ok) {
      okK = k;
      break;
    }
  }
  if (ok && okK < 1) {
    let lo = okK;
    let hi = Math.min(1, okK + 0.02);
    for (let i = 0; i < 4; i++) {
      const mid = (lo + hi) / 2;
      const r = at(mid);
      if (r) {
        lo = mid;
        ok = r;
      } else hi = mid;
    }
  }
  if (ok) return ok;
  // Nothing clears (should not happen on the shipped islands): the plain cover, HUD at home.
  let k = 1;
  let ax = axis(screenW, iw, sx, sw, m.x, m.w, cover);
  let ay = axis(screenH, ih, sy, sh, m.y, m.h, cover);
  while ((!ax || !ay) && k > MIN_SHRINK) {
    k -= 0.01;
    ax = axis(screenW, iw, sx, sw, m.x, m.w, cover * k);
    ay = axis(screenH, ih, sy, sh, m.y, m.h, cover * k);
  }
  const scale = cover * k;
  const f = fitAt(screenW, screenH, iw, ih, scale, ax ? ax[2] : (screenW - iw * scale) / 2, ay ? ay[2] : (screenH - ih * scale) / 2);
  return { fit: { ...f, shrink: k, coverage: coverageOf(screenW, screenH, f), clear: false }, dock };
}
