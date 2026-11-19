/**
 * Pure layout math for the painted 2D UI (no Pixi): the radial build / tower ring, its tooltip,
 * the lives + gold plaque and the end-of-run panel. Everything is in css px of the canvas and
 * respects the device safe-area insets (notches, rounded corners) plus a small visual margin.
 */
import { towerRole } from '../i18n/data.ts';
import { t } from '../i18n/index.ts';
import type { TowerType } from '../core/types.ts';
import { getTowerTierStats, TOWER_DEFS } from '../data/towers.ts';
import type { Level2DGate } from '../data/levels2d/gates.ts';

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

/**
 * Vertical centre of the centre plate (Paused / "Tap the road"): 42 % down the screen, unless that
 * covers `avoid`; then the band (top 17 % / bottom 80 %) further from it. Pure (tests).
 */
export function plateCentreY(screenH: number, plate: { readonly x: number; readonly w: number; readonly h: number }, avoid: Rect | null): number {
  const home = screenH * 0.42;
  if (!avoid) return home;
  const hits = (cy: number): number => {
    const y0 = cy - plate.h / 2;
    const ox = Math.max(0, Math.min(plate.x + plate.w, avoid.x + avoid.w) - Math.max(plate.x, avoid.x));
    const oy = Math.max(0, Math.min(y0 + plate.h, avoid.y + avoid.h) - Math.max(y0, avoid.y));
    return ox * oy;
  };
  if (hits(home) === 0) return home;
  const top = Math.max(screenH * 0.17, plate.h / 2 + 8);
  const bottom = Math.min(screenH * 0.8, screenH - plate.h / 2 - 8);
  return hits(top) <= hits(bottom) ? top : bottom;
}

// ---------------------------------------------------------------------------------------------
// Ability bar
// ---------------------------------------------------------------------------------------------

export type AbilityBarLayout = 'row' | 'column' | 'block' | 'stack';

export interface AbilityBarSpot {
  readonly x: number;
  readonly y: number;
  /** Column up a screen edge (kept for callers that only know row / column). */
  readonly vertical: boolean;
  /**
   * Row, column, the compact two-row block (hero group on top, abilities under it), or the narrow
   * three-row stack up a screen side (portrait / hero skills / abilities; short phone screens).
   */
  readonly layout: AbilityBarLayout;
  /** 0 = clear of every plot / tower and road; higher = worse (QA). */
  readonly score: number;
}

export interface AbilityBarInput {
  readonly w: number;
  readonly h: number;
  readonly insets: Insets;
  readonly pad: number;
  /** Bar size laid out horizontally (vertical candidates swap them). */
  readonly long: number;
  readonly short: number;
  readonly gap: number;
  /** The two-row block's size (no block candidates when absent). */
  readonly block?: { readonly w: number; readonly h: number };
  /** The narrow three-row stack's size (no stack candidates when absent). */
  readonly stack?: { readonly w: number; readonly h: number };
  /** HUD plaque (bottom-left) and wave banner (bottom-right), screen px. */
  readonly plaque: Rect;
  readonly banner: Rect;
  /** Never cover: build plots with their towers (1000 per px²). */
  readonly hard: readonly Rect[];
  /**
   * Never ever cover: the horn and the HUD pieces (10000 per px²). A bar over the wave banner or a
   * HUD button looks broken, so it loses to any spot that only grazes plots.
   */
  readonly hud?: readonly Rect[];
  /** Rather not cover: points along the roads (enemies walk there). */
  readonly soft: readonly Pt[];
  /** Painted landmarks with a weight per px² (castle heavier than a cave; plots count 1000). */
  readonly landmarks?: readonly { readonly rect: Rect; readonly weight: number }[];
}

/**
 * Where the ability bar goes on this island. In order of preference: the bottom band between the
 * plaque and the wave banner (centre first, then sliding towards either end), just above the
 * plaque / banner, the compact two-row block above the plaque / banner or in a bottom corner, a
 * column or the narrow three-row stack up the left / right edge, a row along the top edge, then
 * blocks / stacks / columns at other heights. A spot covering a plot (or its tower), the castle / caves or a HUD piece is only taken
 * when every spot does; then the least covered wins. Roads count a bit, the preference order and
 * the distance from the bottom centre break ties.
 */
export function abilityBarSpot(o: AbilityBarInput): AbilityBarSpot {
  const { w, h, insets, pad, long, short, gap } = o;
  const minX = insets.left + pad;
  const maxX = w - insets.right - pad;
  const minY = insets.top + pad;
  const maxY = h - insets.bottom - pad;
  const cands: { x: number; y: number; bw: number; bh: number; layout: AbilityBarLayout; rank: number }[] = [];
  const add = (x: number, y: number, layout: AbilityBarLayout, rank: number): void => {
    const bw = layout === 'column' ? short : layout === 'block' ? o.block!.w : layout === 'stack' ? o.stack!.w : long;
    const bh = layout === 'column' ? long : layout === 'block' ? o.block!.h : layout === 'stack' ? o.stack!.h : short;
    cands.push({ x: Math.max(minX, Math.min(maxX - bw, x)), y: Math.max(minY, Math.min(maxY - bh, y)), bw, bh, layout, rank });
  };
  const bottomY = maxY - short;
  const left = o.plaque.x + o.plaque.w + gap;
  const right = o.banner.x - gap;
  if (right - left >= long) {
    add((left + right) / 2 - long / 2, bottomY, 'row', 0);
    const steps = 8;
    for (let i = 0; i <= steps; i++) add(left + ((right - left - long) * i) / steps, bottomY, 'row', 1);
  }
  add(o.plaque.x, o.plaque.y - gap - short, 'row', 2);
  add(o.plaque.x + o.plaque.w - long, o.plaque.y - gap - short, 'row', 2);
  add(o.banner.x + o.banner.w - long, o.banner.y - gap - short, 'row', 2);
  add(o.banner.x, o.banner.y - gap - short, 'row', 2);
  if (o.block) {
    const b = o.block;
    add(o.plaque.x, o.plaque.y - gap - b.h, 'block', 3);
    add(o.banner.x + o.banner.w - b.w, o.banner.y - gap - b.h, 'block', 3);
    if (right - left >= b.w) {
      add(left, maxY - b.h, 'block', 3);
      add(right - b.w, maxY - b.h, 'block', 3);
      add((left + right) / 2 - b.w / 2, maxY - b.h, 'block', 3);
    }
  }
  add(minX, o.plaque.y - gap - long, 'column', 4);
  add(maxX - short, o.banner.y - gap - long, 'column', 4);
  if (o.stack) {
    // Up a side, above the plaque / banner, else anywhere along the sides (under the HUD buttons).
    const st = o.stack;
    add(minX, o.plaque.y - gap - st.h, 'stack', 4);
    add(maxX - st.w, o.banner.y - gap - st.h, 'stack', 4);
    for (let i = 0; i <= 6; i++) {
      add(minX, minY + ((maxY - minY - st.h) * i) / 6, 'stack', 5);
      add(maxX - st.w, minY + ((maxY - minY - st.h) * i) / 6, 'stack', 5);
    }
  }
  // Dense islands (plots along every edge of the bottom band): a row along the top edge (the HUD
  // buttons on the right are keep-outs), blocks and columns at other heights.
  const steps = 10;
  for (let i = 0; i <= steps; i++) add(minX + ((maxX - minX - long) * i) / steps, minY, 'row', 5);
  if (o.block) {
    const b = o.block;
    for (let i = 0; i <= 6; i++) {
      add(minX, minY + ((maxY - minY - b.h) * i) / 6, 'block', 5);
      add(maxX - b.w, minY + ((maxY - minY - b.h) * i) / 6, 'block', 5);
      add(minX + ((maxX - minX - b.w) * i) / 6, minY, 'block', 5);
    }
  }
  for (let i = 0; i <= 6; i++) {
    const y = minY + ((maxY - minY - long) * i) / 6;
    add(minX, y, 'column', 6);
    add(maxX - short, y, 'column', 6);
  }
  let best: AbilityBarSpot | null = null;
  let bestScore = Infinity;
  const cx = w / 2;
  for (const c of cands) {
    const box: Rect = { x: c.x, y: c.y, w: c.bw, h: c.bh };
    let hard = 0;
    for (const r of o.hard) hard += overlapArea(box, r);
    for (const r of o.hud ?? []) hard += overlapArea(box, r) * 10;
    let soft = 0;
    for (const p of o.soft) if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) soft++;
    let land = 0;
    for (const l of o.landmarks ?? []) land += overlapArea(box, l.rect) * l.weight;
    const score = hard * 1000 + land + soft * 40 + c.rank * 25 + Math.abs(box.x + box.w / 2 - cx) * 0.02 + (maxY - (box.y + box.h)) * 0.05;
    if (score < bestScore) {
      bestScore = score;
      best = { x: c.x, y: c.y, vertical: c.layout === 'column', layout: c.layout, score: Math.round(hard * 1000 + land + soft * 40) };
    }
  }
  return best ?? { x: (w - long) / 2, y: bottomY, vertical: false, layout: 'row', score: Infinity };
}

/**
 * Map-image rects (px) of the painted landmarks a HUD piece should not cover: the castle keep and
 * the raider caves. Only the gate's FRONT layer is in the level data; the building it belongs to
 * stands behind the mouth (opposite its facing) and rises above it, so the rect grows that way.
 */
export function gateKeepOutsPx(gates: readonly Level2DGate[]): (Rect & { castle: boolean })[] {
  const out: (Rect & { castle: boolean })[] = [];
  for (const g of gates) {
    if (!g.front) continue;
    const [x, y, w, h] = g.front.rect;
    const castle = g.role === 'goal';
    const grow = castle ? 0.2 : 0.15;
    // Castle v3 is one compact gatehouse-keep: it reaches a little behind and above its gate.
    const back = castle ? 0.4 : 0.4;
    const up = castle ? 0.6 : 0.3;
    let x0 = x - w * grow;
    let x1 = x + w * (1 + grow);
    let y0 = y - h * (grow + up);
    let y1 = y + h * (1 + grow);
    if (g.facing === 'W') x1 += w * back;
    else if (g.facing === 'E') x0 -= w * back;
    else if (g.facing === 'N') y1 += h * back;
    else y0 -= h * back;
    out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, castle });
  }
  return out;
}

/**
 * Where the wave horn goes (screen px): near the raider caves (it calls them out), on a ring of
 * spots around `near`, clear of plots (+ their towers), the caves / castle, the roads and the HUD.
 * `first` is the old fixed spot, kept when it is clear.
 */
export function hornSpot(
  near: Pt,
  first: Pt,
  r: number,
  screen: { w: number; h: number; top: number; bottom: number; margin: number },
  hard: readonly Rect[],
  landmarks: readonly { readonly rect: Rect; readonly weight: number }[],
  roads: readonly Pt[],
): Pt & { score: number } {
  const cands: { x: number; y: number; rank: number }[] = [{ x: first.x, y: first.y, rank: 0 }];
  for (const k of [1.7, 2.5, 3.4, 4.5, 5.8]) {
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      cands.push({ x: near.x + Math.cos(ang) * r * k, y: near.y + Math.sin(ang) * r * k * 0.8, rank: k });
    }
  }
  let best: (Pt & { score: number }) | null = null;
  let bestScore = Infinity;
  for (const c of cands) {
    const x = Math.max(screen.margin + r, Math.min(screen.w - screen.margin - r, c.x));
    const y = Math.max(screen.top + r, Math.min(screen.bottom - r, c.y));
    // The horn plus its label above and the seconds below.
    const box: Rect = { x: x - r, y: y - r * 1.35, w: r * 2, h: r * 2.5 };
    let hardA = 0;
    for (const k of hard) hardA += overlapArea(box, k);
    let land = 0;
    for (const k of landmarks) land += overlapArea(box, k.rect) * k.weight;
    let road = 0;
    for (const p of roads) if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r * r * 1.1) road++;
    const clean = hardA * 1000 + land + road * 120;
    const score = clean + c.rank * 40 + Math.hypot(x - near.x, y - near.y) * 0.3;
    if (score < bestScore) {
      bestScore = score;
      best = { x, y, score: Math.round(clean) };
    }
  }
  return best!;
}

// ---------------------------------------------------------------------------------------------
// Cards beside a round HUD anchor (next-wave card at the horn)
// ---------------------------------------------------------------------------------------------

export interface BesideSpot {
  readonly x: number;
  readonly y: number;
  readonly side: 'right' | 'left' | 'above' | 'below';
  /** Overlap (px²) with the keep-outs; 0 = clear. */
  readonly covered: number;
}

/**
 * Where a card of size `card` goes next to a round anchor (centre + radius): right / left of it
 * (centred, top- or bottom-aligned), below or above it, or diagonal. Inside the screen (margin),
 * above `bottomLimit`; the spot covering the least of `hard` wins, then the preferred order.
 */
export function besideAnchorSpot(
  anchor: { x: number; y: number; r: number },
  card: { w: number; h: number },
  screen: { w: number; h: number; bottomLimit: number },
  hard: readonly Rect[],
  margin = 8,
  /**
   * Covered on top of `hard`, each with its own weight: the plots' stone rings (worse than a
   * tower's headroom), HUD pieces (far worse: a card over the bar or a button looks broken).
   */
  weighted: readonly { readonly rect: Rect; readonly weight: number }[] = [],
): BesideSpot {
  const { x: ax, y: ay, r } = anchor;
  const { w, h } = card;
  const g = r * 0.35 + 6;
  const cands: { x: number; y: number; side: BesideSpot['side'] }[] = [
    { x: ax + r + g, y: ay - h / 2, side: 'right' },
    { x: ax - r - g - w, y: ay - h / 2, side: 'left' },
    { x: ax + r + g, y: ay - r, side: 'right' },
    { x: ax + r + g, y: ay + r - h, side: 'right' },
    { x: ax - r - g - w, y: ay - r, side: 'left' },
    { x: ax - r - g - w, y: ay + r - h, side: 'left' },
    { x: ax - w / 2, y: ay + r * 1.75, side: 'below' },
    { x: ax - w / 2, y: ay - r * 1.75 - h, side: 'above' },
    { x: ax + r * 0.5, y: ay + r * 1.6, side: 'below' },
    { x: ax - r * 0.5 - w, y: ay + r * 1.6, side: 'below' },
    { x: ax + r * 0.5, y: ay - r * 1.6 - h, side: 'above' },
    { x: ax - r * 0.5 - w, y: ay - r * 1.6 - h, side: 'above' },
    // A step further out (dense islands: every spot hugging the horn touches a plot).
    { x: ax - w / 2, y: ay + r * 2.9, side: 'below' },
    { x: ax - w / 2, y: ay - r * 2.9 - h, side: 'above' },
    { x: ax + r * 1.4, y: ay + r * 2.4, side: 'below' },
    { x: ax - r * 1.4 - w, y: ay + r * 2.4, side: 'below' },
    { x: ax + r * 1.4, y: ay - r * 2.4 - h, side: 'above' },
    { x: ax - r * 1.4 - w, y: ay - r * 2.4 - h, side: 'above' },
  ];
  let best: BesideSpot | null = null;
  let bestScore = Infinity;
  cands.forEach((c, rank) => {
    const x = Math.max(margin, Math.min(screen.w - margin - w, c.x));
    const y = Math.max(margin, Math.min(screen.bottomLimit - margin - h, c.y));
    const box: Rect = { x, y, w, h };
    let covered = 0;
    for (const k of hard) covered += overlapArea(box, k);
    for (const k of weighted) covered += overlapArea(box, k.rect) * k.weight;
    // Clamping can push a card over its own anchor: that counts as covering (as a HUD piece).
    covered += overlapArea(box, { x: ax - r, y: ay - r, w: r * 2, h: r * 2 }) * 12;
    const moved = Math.abs(x - c.x) + Math.abs(y - c.y);
    const score = covered * 10 + rank * 30 + moved * 2;
    if (score < bestScore) {
      bestScore = score;
      best = { x, y, side: c.side, covered: Math.round(covered) };
    }
  });
  return best!;
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
