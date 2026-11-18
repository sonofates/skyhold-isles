/**
 * Pure layout math for the painted 2D UI (no Pixi): the radial build / tower ring, its tooltip,
 * the lives + gold plaque and the end-of-run panel. Everything is in css px of the canvas and
 * respects the device safe-area insets (notches, rounded corners) plus a small visual margin.
 */
import { towerRole } from '../i18n/data.ts';
import { t } from '../i18n/index.ts';
import type { TowerType } from '../core/types.ts';
import { getTowerTierStats, TOWER_DEFS } from '../data/towers.ts';

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pt {
  x: number;
  y: number;
}

/** UI scale for a viewport: 1 at ~1400x760, clamped so phones and 4K stay readable. */
export function uiScale(w: number, h: number): number {
  return Math.max(0.5, Math.min(1.4, Math.min(w / 1400, h / 760)));
}

// ---------------------------------------------------------------------------------------------
// Radial ring
// ---------------------------------------------------------------------------------------------

/** Minimum gap between two medallion discs (css px), on top of the price tag allowance. */
const RING_GAP = 8;

/** Angles (radians, screen space: 0 = right, π/2 = down) for `count` evenly spaced build medallions, first at the top, clockwise. */
export function evenAngles(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(-Math.PI / 2 + (Math.PI * 2 * i) / Math.max(1, count));
  return out;
}

/**
 * Ring radius (centre → medallion centre) so neighbouring medallions — each a disc of `tokenR`
 * with a price tag of height `tagH` hanging under it — never touch, and the plot in the middle
 * stays visible.
 */
export function ringRadius(angles: readonly number[], tokenR: number, tagH: number): number {
  let minStep = Math.PI * 2;
  const n = angles.length;
  if (n >= 2) {
    const sorted = [...angles].map((a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b);
    for (let i = 0; i < n; i++) {
      const next = i + 1 < n ? sorted[i + 1] : sorted[0] + Math.PI * 2;
      minStep = Math.min(minStep, next - sorted[i]);
    }
  }
  const need = tokenR * 2 + RING_GAP + tagH * 0.5;
  const chordR = n >= 2 ? need / (2 * Math.sin(Math.min(Math.PI / 2, minStep / 2))) : 0;
  return Math.max(tokenR * 2.35, chordR);
}

export interface RingLayout {
  /** Where the ring is centred after the on-screen clamp (may differ from the plot). */
  cx: number;
  cy: number;
  radius: number;
  /** Bounding box of medallions + tags. */
  box: Rect;
}

/**
 * Places medallions at `angles` around (cx, cy) and shifts the whole ring (never squashes it) so
 * every medallion and its price tag stays inside the screen minus the safe insets and `margin`.
 * Writes centres to `out` (reused array) and returns the clamped centre + bounding box.
 */
export function layoutRadial(
  cx: number,
  cy: number,
  angles: readonly number[],
  tokenR: number,
  tagH: number,
  screenW: number,
  screenH: number,
  insets: Insets,
  out: Pt[],
  margin = 6,
  minRadius = 0,
  avoid: readonly Rect[] = [],
): RingLayout {
  const radius = Math.max(minRadius, ringRadius(angles, tokenR, tagH));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < angles.length; i++) {
    const dx = Math.cos(angles[i]) * radius;
    const dy = Math.sin(angles[i]) * radius;
    minX = Math.min(minX, dx - tokenR);
    maxX = Math.max(maxX, dx + tokenR);
    minY = Math.min(minY, dy - tokenR);
    maxY = Math.max(maxY, dy + tokenR + tagH * 0.75);
  }
  if (angles.length === 0) minX = maxX = minY = maxY = 0;
  const loX = insets.left + margin - minX;
  const hiX = screenW - insets.right - margin - maxX;
  const loY = insets.top + margin - minY;
  const hiY = screenH - insets.bottom - margin - maxY;
  let x = loX <= hiX ? Math.min(hiX, Math.max(loX, cx)) : (loX + hiX) / 2;
  let y = loY <= hiY ? Math.min(hiY, Math.max(loY, cy)) : (loY + hiY) / 2;
  if (avoid.length > 0) {
    const p = dodgeRects(x, y, { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, [loX, hiX, loY, hiY], avoid, margin);
    x = p.x;
    y = p.y;
  }
  for (let i = 0; i < angles.length; i++) {
    const p = out[i] ?? (out[i] = { x: 0, y: 0 });
    p.x = x + Math.cos(angles[i]) * radius;
    p.y = y + Math.sin(angles[i]) * radius;
  }
  out.length = angles.length;
  return { cx: x, cy: y, radius, box: { x: x + minX, y: y + minY, w: maxX - minX, h: maxY - minY } };
}

/**
 * Moves a box (offset `rel` from the point (x, y)) the shortest distance so it clears every rect
 * in `avoid` (by `gap`) while (x, y) stays inside `[loX, hiX] × [loY, hiY]`. Candidate spots sit
 * flush beside / above / below each rect (and their combinations). When no spot clears them all,
 * the point is left where it was.
 */
export function dodgeRects(x: number, y: number, rel: Rect, bounds: readonly [number, number, number, number], avoid: readonly Rect[], gap = 6): Pt {
  const [loX, hiX, loY, hiY] = bounds;
  const box = (px: number, py: number): Rect => ({ x: px + rel.x, y: py + rel.y, w: rel.w, h: rel.h });
  const clear = (px: number, py: number): boolean => avoid.every((a) => !rectsHit(box(px, py), a));
  if (clear(x, y)) return { x, y };
  const inRange = (v: number, lo: number, hi: number): boolean => (lo <= hi ? v >= lo - 0.5 && v <= hi + 0.5 : Math.abs(v - (lo + hi) / 2) < 0.5);
  const xs = [x];
  const ys = [y];
  for (const a of avoid) {
    xs.push(a.x - gap - (rel.x + rel.w), a.x + a.w + gap - rel.x);
    ys.push(a.y - gap - (rel.y + rel.h), a.y + a.h + gap - rel.y);
  }
  let best: Pt | null = null;
  let bestD = Infinity;
  for (const px of xs) {
    if (!inRange(px, loX, hiX)) continue;
    for (const py of ys) {
      if (!inRange(py, loY, hiY) || !clear(px, py)) continue;
      const d = Math.hypot(px - x, py - y);
      if (d < bestD) {
        bestD = d;
        best = { x: px, y: py };
      }
    }
  }
  return best ?? { x, y };
}

const DEG = Math.PI / 180;
/** Tower ring arrangements (upgrade, [targeting | rally], sell), tried in order. */
const TOWER_RING_3: readonly (readonly number[])[] = [
  [-90 * DEG, 150 * DEG, 30 * DEG], // upgrade above, the others low left / right
  [90 * DEG, 180 * DEG, 0], // top-row plots: upgrade below, the others beside
  [90 * DEG, -150 * DEG, -30 * DEG],
  [-90 * DEG, 0, 90 * DEG], // left-edge plots: everything on the right half
  [-90 * DEG, 180 * DEG, 90 * DEG], // right-edge plots
  [90 * DEG, 35 * DEG, 0], // corners
  [90 * DEG, 145 * DEG, 180 * DEG],
  [-90 * DEG, -35 * DEG, 0],
  [-90 * DEG, -145 * DEG, 180 * DEG],
];
const TOWER_RING_2: readonly (readonly number[])[] = [
  [-90 * DEG, 90 * DEG],
  [180 * DEG, 0],
  [-90 * DEG, 0],
  [-90 * DEG, 180 * DEG],
  [90 * DEG, 0],
  [90 * DEG, 180 * DEG],
];

function rectsHit(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Disc + hanging price tag of a medallion centred at (x, y). */
export function tokenRect(x: number, y: number, tokenR: number, tagH: number): Rect {
  return { x: x - tokenR, y: y - tokenR, w: tokenR * 2, h: tokenR * 2 + tagH * 0.75 };
}

/**
 * Tower ring: picks the first arrangement whose medallions fit on screen WITHOUT shifting and
 * stay off the built tower (`keepOut`, screen px). Shifting a ring that wraps a tower would slide
 * a medallion onto it, so the arrangement flips instead (e.g. upgrade below on a top-row plot).
 * If nothing fits unshifted, the arrangement needing the smallest shift that still clears the
 * tower wins (then the least shift overall).
 */
export function towerRingAngles(
  count: number,
  cx: number,
  cy: number,
  tokenR: number,
  tagH: number,
  radius: number,
  screenW: number,
  screenH: number,
  insets: Insets,
  keepOut: Rect | null,
  margin = 6,
  avoid: readonly Rect[] = [],
): readonly number[] {
  const cands = count >= 3 ? TOWER_RING_3 : TOWER_RING_2;
  const out: Pt[] = [];
  let best: readonly number[] = cands[0];
  let bestScore = Infinity;
  for (const angles of cands) {
    const lay = layoutRadial(cx, cy, angles, tokenR, tagH, screenW, screenH, insets, out, margin, radius, avoid);
    const shift = Math.hypot(lay.cx - cx, lay.cy - cy);
    const hitsTower = keepOut !== null && out.some((p) => rectsHit(tokenRect(p.x, p.y, tokenR, tagH), keepOut));
    if (shift < 0.5 && !hitsTower) return angles;
    const score = shift + (hitsTower ? 1e6 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = angles;
    }
  }
  return best;
}

export type TipSide = 'right' | 'left' | 'below' | 'above' | 'clamped';

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Tooltip beside the ring: right, left, below, then above — the first spot that is fully on
 * screen without covering the ring wins. If none fits (tiny screens) it takes the on-screen spot
 * that covers the least of the ring. Spots covering a rect in `avoid` (the HUD buttons) never
 * count as fitting.
 */
export function placeTooltip(ring: Rect, tipW: number, tipH: number, screenW: number, screenH: number, insets: Insets, gap = 10, margin = 6, avoid: readonly Rect[] = []): Rect & { side: TipSide } {
  const L = insets.left + margin;
  const R = screenW - insets.right - margin;
  const T = insets.top + margin;
  const B = screenH - insets.bottom - margin;
  const clampX = (x: number): number => Math.max(L, Math.min(R - tipW, x));
  const clampY = (y: number): number => Math.max(T, Math.min(B - tipH, y));
  const ccx = ring.x + ring.w / 2;
  const ccy = ring.y + ring.h / 2;
  const cands: { side: TipSide; x: number; y: number }[] = [
    { side: 'right', x: ring.x + ring.w + gap, y: clampY(ccy - tipH / 2) },
    { side: 'left', x: ring.x - gap - tipW, y: clampY(ccy - tipH / 2) },
    { side: 'below', x: clampX(ccx - tipW / 2), y: ring.y + ring.h + gap },
    { side: 'above', x: clampX(ccx - tipW / 2), y: ring.y - gap - tipH },
    // Beside the ring but dropped under a HUD piece it would otherwise cover.
    ...avoid.flatMap((a) => [
      { side: 'right' as const, x: ring.x + ring.w + gap, y: clampY(a.y + a.h + gap) },
      { side: 'left' as const, x: ring.x - gap - tipW, y: clampY(a.y + a.h + gap) },
    ]),
  ];
  for (const c of cands) {
    const free = avoid.every((a) => !rectsHit({ x: c.x, y: c.y, w: tipW, h: tipH }, a));
    if (free && c.x >= L - 0.01 && c.x + tipW <= R + 0.01 && c.y >= T - 0.01 && c.y + tipH <= B + 0.01) {
      return { x: c.x, y: c.y, w: tipW, h: tipH, side: c.side };
    }
  }
  let best: (Rect & { side: TipSide }) | null = null;
  let bestCover = Infinity;
  for (const c of cands) {
    const r = { x: clampX(c.x), y: clampY(c.y), w: tipW, h: tipH };
    const cover = overlapArea(r, ring) + avoid.reduce((sum, a) => sum + overlapArea(r, a), 0);
    if (cover < bestCover) {
      bestCover = cover;
      best = { ...r, side: 'clamped' };
    }
  }
  return best!;
}

// ---------------------------------------------------------------------------------------------
// Tower stat pips (tooltip)
// ---------------------------------------------------------------------------------------------

export interface StatRow {
  readonly label: string;
  /** 0..5 */
  readonly pips: number;
}

function pipsFor(v: number, steps: readonly number[]): number {
  let n = 0;
  for (const s of steps) if (v >= s) n++;
  return n;
}

const DMG_STEPS = [1, 15, 30, 60, 110] as const;
const RATE_STEPS = [0.01, 0.5, 0.9, 1.3, 1.9] as const;
const RANGE_STEPS = [0.1, 4.5, 5.5, 7.5, 10] as const;

/** Three 0..5 pip rows for a tower tier (attack: damage / range / speed; support / barracks get their own). */
export function statRows(type: TowerType, tier: 1 | 2 | 3): StatRow[] {
  const def = TOWER_DEFS[type];
  const s = getTowerTierStats(type, tier);
  if (def.role === 'support') {
    return [
      { label: t('stat.haste'), pips: pipsFor((s.auraRate ?? 0) * 100, [1, 10, 16, 22, 28]) },
      { label: t('stat.reach'), pips: pipsFor((s.auraRange ?? 0) * 100, [0.01, 5, 10, 15, 20]) },
      { label: t('stat.aura'), pips: pipsFor(s.range, [0.1, 3, 3.8, 4.4, 5.2]) },
    ];
  }
  if (def.role === 'barracks') {
    return [
      { label: t('stat.soldiers'), pips: Math.min(5, s.soldierCount ?? 0) },
      { label: t('stat.toughness'), pips: pipsFor(s.soldierHp ?? 0, [1, 100, 150, 210, 300]) },
      { label: t('stat.damage'), pips: pipsFor(s.soldierDamage ?? s.damage, [1, 10, 18, 25, 40]) },
    ];
  }
  return [
    { label: t('stat.damage'), pips: pipsFor(s.damage, DMG_STEPS) },
    { label: t('stat.range'), pips: pipsFor(s.range, RANGE_STEPS) },
    { label: t('stat.speed'), pips: pipsFor(s.fireRate, RATE_STEPS) },
  ];
}

/** One-line role under a tower's name in the build-ring tooltip (localised; see src/i18n/data.ts). */
export function roleLine(type: TowerType): string {
  return towerRole(type);
}

// ---------------------------------------------------------------------------------------------
// HUD plaque
// ---------------------------------------------------------------------------------------------

/** Number areas of the plaque art, as fractions of its width / height (measured from the art). */
export interface PlaqueSlots {
  /** Left edge and right edge (fractions of width) of the lives / gold number areas. */
  readonly lives: readonly [number, number];
  readonly gold: readonly [number, number];
  /** Vertical centre of the numbers (fraction of height). */
  readonly midY: number;
}

/** Number areas of the painted HUD plaque (heart + coins carved in) — measured from public/art2d/ui/hud-plaque.webp. */
export const KIT_PLAQUE_SLOTS: PlaqueSlots = { lives: [0.268, 0.455], gold: [0.688, 0.898], midY: 0.514 };

export interface PlaqueLayout {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly livesBox: Rect;
  readonly goldBox: Rect;
  readonly fontSize: number;
}

/**
 * Lives + gold plaque, bottom-left inside the safe area. Width scales with the viewport but never
 * takes more than 40% of the usable width (the wave banner mirrors it on the right), and never
 * gets smaller than what keeps a 4-digit gold readable.
 */
export function plaqueLayout(w: number, h: number, insets: Insets, aspect: number, slots: PlaqueSlots): PlaqueLayout {
  const u = uiScale(w, h);
  const pad = Math.max(8, 14 * u);
  const usableW = w - insets.left - insets.right - pad * 2;
  const pw = Math.max(170, Math.min(300 * u, usableW * 0.4));
  const ph = pw / aspect;
  const x = insets.left + pad;
  const y = h - insets.bottom - pad - ph;
  const box = (s: readonly [number, number]): Rect => ({ x: x + s[0] * pw, y: y + slots.midY * ph - ph * 0.3, w: (s[1] - s[0]) * pw, h: ph * 0.6 });
  return { x, y, w: pw, h: ph, livesBox: box(slots.lives), goldBox: box(slots.gold), fontSize: Math.round(Math.max(15, ph * 0.4)) };
}

// ---------------------------------------------------------------------------------------------
// Top-right round buttons (speed, pause, codex)
// ---------------------------------------------------------------------------------------------

/** Smallest touch target (css px) of the round HUD buttons. */
export const HUD_MIN_TOUCH = 48;

export interface HudButtonsLayout {
  /** Button radius and the margin from the safe edge. */
  readonly r: number;
  readonly pad: number;
  /** Centre y of the row, and centre x of each button (right to left: speed, pause, codex, settings). */
  readonly y: number;
  readonly speedX: number;
  readonly pauseX: number;
  readonly codexX: number;
  readonly settingsX: number;
}

/**
 * The top-right button row: speed at the edge, pause left of it, the Codex (Guide) button left of
 * pause, the Settings button left of that (Guide and Settings are captioned, a touch smaller).
 */
export function hudButtonsLayout(w: number, h: number, insets: Insets): HudButtonsLayout {
  const u = uiScale(w, h);
  const pad = Math.max(8, 14 * u);
  const r = Math.max(HUD_MIN_TOUCH / 2, 38 * u);
  const edge = w - insets.right - pad;
  return { r, pad, y: insets.top + pad + r, speedX: edge - r, pauseX: edge - r * 3.25, codexX: edge - r * 5.5, settingsX: edge - r * 7.75 };
}

/**
 * Screen area the top-right HUD row (speed, pause, the Guide and Settings buttons and their captions)
 * takes, so the build ring and its tooltip can stay clear of it. The caption size follows the
 * painted-UI CSS (`--s`, `.pu-codex-btn .pu-round-label`); the Guide button reports its real box
 * on top of this (see `uiKit.hudKeepOuts`).
 */
export function hudButtonsKeepOut(w: number, h: number, insets: Insets): Rect {
  const hb = hudButtonsLayout(w, h, insets);
  const codexR = Math.max(22, hb.r * 0.86);
  const s = Math.max(8.5, Math.min(0.0095 * w, 0.0185 * h, 17));
  const capH = Math.max(11, s * 1.05) * 1.25;
  const capHalfW = Math.max(codexR, Math.max(11, s * 1.05) * 2.4);
  const x = hb.settingsX - capHalfW - 2;
  const y = 0;
  const bottom = hb.y + Math.max(hb.r, codexR + capH * 0.9) + 2;
  return { x, y, w: w - x, h: bottom - y };
}

// ---------------------------------------------------------------------------------------------
// End panel
// ---------------------------------------------------------------------------------------------

/**
 * Where the parchment and the title ribbon sit inside the end-panel art (fractions of its
 * height) — measured from public/art2d/ui/end-panel.webp.
 */
export const END_FRAME = { ribbonMid: 0.105, innerTop: 0.235, innerBottom: 0.9 } as const;

/** Stars a finished run shows: the sim's rating (SimWorld.computeStars) on a win, none on a defeat. */
export function endStars(won: boolean, simStars: number): number {
  return won ? Math.max(1, Math.min(3, Math.round(simStars))) : 0;
}

export interface EndLayout {
  readonly panel: Rect;
  /** Star centres (3) and their radius. */
  readonly stars: readonly Pt[];
  readonly starR: number;
  /** Button centres (Retry / Next / Menu) and radius. */
  readonly buttons: readonly Pt[];
  readonly buttonR: number;
  /** Title (on the ribbon) and the summary line. */
  readonly title: Pt;
  readonly summary: Pt;
  readonly fontTitle: number;
  readonly fontBody: number;
}

/**
 * End-of-run panel centred in the safe area, as large as fits (art `aspect` = width / height),
 * with stars, a summary line and a row of round buttons inside it. `ribbonFrac` = share of the
 * art's height taken by the title ribbon at the top; `innerTop`/`innerBottom` = where the
 * parchment interior starts / ends (fractions of height).
 */
export function endLayout(
  w: number,
  h: number,
  insets: Insets,
  aspect: number,
  frame: { readonly ribbonMid: number; readonly innerTop: number; readonly innerBottom: number },
): EndLayout {
  const availW = w - insets.left - insets.right - 24;
  const availH = h - insets.top - insets.bottom - 24;
  const pw = Math.min(availW * 0.92, availH * aspect, h * 0.64 * aspect);
  const ph = pw / aspect;
  const px = insets.left + (w - insets.left - insets.right - pw) / 2;
  const py = insets.top + (h - insets.top - insets.bottom - ph) / 2;
  const top = py + ph * frame.innerTop;
  const bottom = py + ph * frame.innerBottom;
  const inner = bottom - top;
  const starR = Math.max(16, Math.min(pw * 0.065, inner * 0.14));
  // The raised, larger middle star (1.15 R, lifted 0.25 R) stays below the ribbon.
  const starY = top + Math.max(inner * 0.18, starR * 1.45);
  const stars = [-1, 0, 1].map((k) => ({ x: px + pw / 2 + k * starR * 2.4, y: starY + (k === 0 ? -starR * 0.25 : starR * 0.12) }));
  const buttonR = Math.max(24, Math.min(pw * 0.062, inner * 0.13));
  const btnY = top + inner * 0.75;
  const buttons = [-1, 0, 1].map((k) => ({ x: px + pw / 2 + k * buttonR * 3.3, y: btnY }));
  const fontBody = Math.round(Math.max(14, Math.min(26, inner * 0.085)));
  return {
    panel: { x: px, y: py, w: pw, h: ph },
    stars,
    starR,
    buttons,
    buttonR,
    title: { x: px + pw / 2, y: py + ph * frame.ribbonMid },
    summary: { x: px + pw / 2, y: top + inner * 0.445 },
    fontTitle: Math.round(Math.max(22, Math.min(54, ph * 0.085))),
    fontBody,
  };
}
