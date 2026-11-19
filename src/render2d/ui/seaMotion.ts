/**
 * The living sea on the world map — the pure part: which motion a device gets (quality tier,
 * reduced motion, effects density, frame-rate cap), the loop clock, and where gulls / the rare
 * whale may appear (open water, away from the islands, the route and the screen's text).
 * No DOM here, so it is unit-tested (tests/render/seaLife.test.ts); seaLife.ts does the drawing.
 */
import type { QualityLevel } from '../../core/types.ts';
import type { QualityTier } from '../renderResolution.ts';
import { EFFECTS_DENSITY, qualityLock, type EffectsDensity } from './graphicsSettings.ts';

/**
 * Seconds in one loop of the water. Every periodic motion of the water (noise drift, foam and
 * glint pulses) completes a whole number of cycles in this time, so the clock wraps without a seam.
 */
export const SEA_PERIOD = 240;

export interface SeaInputs {
  /** `?quality=` (QA) — wins over the player's preset. */
  readonly override: QualityTier | null;
  /** The player's Quality preset (Settings → Graphics). */
  readonly quality: QualityLevel | undefined;
  readonly reducedMotion: boolean;
  readonly effects: EffectsDensity;
  /** Settings frame-rate cap (0 = none). */
  readonly fpsCap: number;
  readonly touch: boolean;
  /** Software WebGL (SwiftShader / llvmpipe): treated like a weak phone. */
  readonly software: boolean;
}

export interface SeaConfig {
  readonly tier: QualityTier;
  /** Auto tier (no preset, no override): the frame-time governor may step it down. */
  readonly auto: boolean;
  /** Reduced motion: one still frame, nothing travels. */
  readonly still: boolean;
  /** Upper bound of water canvas px per css px (the device ratio and the texture cap it too). */
  readonly waterMaxScale: number;
  /** Life canvas (gulls, clouds, whale) px per css px, upper bound. */
  readonly lifeMaxScale: number;
  /** Minimum ms between drawn frames (0 = every display frame). */
  readonly minFrameMs: number;
  /** Effects density × tier: scales how many gulls / clouds / glints there are. */
  readonly density: number;
  /** Water displacement in css px. */
  readonly amp: number;
  readonly clouds: number;
  readonly gulls: boolean;
  readonly whale: boolean;
  /** Island medallions bob: every island, only the frontier one, or none. */
  readonly bob: 'all' | 'frontier' | 'none';
  /**
   * The WebGL water runs. Off on Auto with a software rasteriser (no real GPU: the full-screen
   * pass costs a CPU core there) — the painted sea stays, the clouds, gulls and islands still move.
   */
  readonly water: boolean;
}

const TIER_ORDER: readonly QualityTier[] = ['low', 'med', 'high'];

export function seaTier(i: SeaInputs): { tier: QualityTier; auto: boolean } {
  const fixed = i.override ?? qualityLock(i.quality);
  if (fixed) return { tier: fixed, auto: false };
  return { tier: i.software ? 'low' : i.touch ? 'med' : 'high', auto: true };
}

export function seaConfig(i: SeaInputs, tierOverride?: QualityTier): SeaConfig {
  const base = seaTier(i);
  const tier = tierOverride ?? base.tier;
  const density = EFFECTS_DENSITY[i.effects] * (tier === 'low' ? 0.6 : tier === 'med' ? 0.85 : 1);
  const capMs = i.fpsCap > 0 ? 1000 / i.fpsCap : 0;
  // Phones and the low tier draw the sea at 30 fps: the water moves slowly, the battery matters.
  const minFrameMs = tier === 'high' ? capMs : Math.max(capMs, 1000 / 30);
  return {
    tier,
    auto: base.auto,
    still: i.reducedMotion,
    waterMaxScale: tier === 'high' ? 2 : tier === 'med' ? 1.5 : 0.75,
    lifeMaxScale: tier === 'high' ? 2 : tier === 'med' ? 1.5 : 1,
    minFrameMs,
    density,
    amp: tier === 'low' ? 1.8 : 2.4,
    clouds: i.reducedMotion ? Math.min(2, Math.round(3 * density)) : Math.max(1, Math.round(3 * density)),
    gulls: !i.reducedMotion,
    whale: !i.reducedMotion,
    bob: i.reducedMotion ? 'none' : tier === 'low' ? 'frontier' : 'all',
    water: !(base.auto && i.software),
  };
}

/** The governor's next step down (Auto only), or null when already at the bottom. */
export function stepDownTier(tier: QualityTier): QualityTier | null {
  const k = TIER_ORDER.indexOf(tier);
  return k > 0 ? TIER_ORDER[k - 1] : null;
}

/**
 * Water canvas px per css px: no sharper than the device, the tier cap, or the painted texture
 * itself (`texH` texels spread over the sea's height — more canvas px than texels adds nothing).
 */
export function waterScale(cfg: Pick<SeaConfig, 'waterMaxScale'>, dpr: number, cssH: number, texH: number): number {
  const texel = Math.max(1, texH / Math.max(1, cssH));
  return Math.max(0.5, Math.min(dpr > 0 ? dpr : 1, cfg.waterMaxScale, texel));
}

/** Advances the loop clock by a frame (clamped so a stall or a hidden tab never jumps). */
export function advanceClock(t: number, dtMs: number): number {
  const dt = Math.min(Math.max(dtMs, 0), 100) / 1000;
  return (t + dt) % SEA_PERIOD;
}

/** Governor window: true when a window's frames are this much slower than the target. */
export function frameWindowSlow(avgMs: number, targetMs: number): boolean {
  return avgMs > Math.max(targetMs, 1000 / 60) * 1.6;
}

// ---- where life may appear ------------------------------------------------------------------

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** Part of the world (css px) life may use: the visible strip minus the title band and the hint. */
export interface SeaView {
  readonly x0: number;
  readonly x1: number;
  readonly top: number;
  readonly bottom: number;
}

/** Distance from p to the route: the polyline through the island centres. */
export function distToRoute(p: Pt, nodes: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    best = Math.min(best, Math.hypot(p.x - a.x, p.y - a.y));
    if (i === 0) continue;
    const b = nodes[i - 1];
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const len2 = dx * dx + dy * dy;
    if (len2 <= 0) continue;
    const k = Math.max(0, Math.min(1, ((p.x - b.x) * dx + (p.y - b.y) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - (b.x + dx * k), p.y - (b.y + dy * k)));
  }
  return best;
}

/** Distance to the nearest island centre. */
export function distToNodes(p: Pt, nodes: readonly Pt[]): number {
  let best = Infinity;
  for (const n of nodes) best = Math.min(best, Math.hypot(p.x - n.x, p.y - n.y));
  return best;
}

/**
 * A spot in open water for the whale: inside the view (with a margin), at least `keepOut` from
 * every island and `keepOut * 0.6` from the route. Null when the view has no such water.
 */
export function whaleSpot(rand: () => number, view: SeaView, nodes: readonly Pt[], keepOut: number, margin: number, tries = 32): Pt | null {
  const x0 = view.x0 + margin;
  const x1 = view.x1 - margin;
  const y0 = view.top + margin;
  const y1 = view.bottom - margin;
  if (x1 <= x0 || y1 <= y0) return null;
  for (let k = 0; k < tries; k++) {
    const p = { x: x0 + rand() * (x1 - x0), y: y0 + rand() * (y1 - y0) };
    if (distToNodes(p, nodes) >= keepOut && distToRoute(p, nodes) >= keepOut * 0.6) return p;
  }
  return null;
}

export interface GullFlight {
  readonly x: number;
  readonly y: number;
  /** css px / s */
  readonly vx: number;
  readonly vy: number;
  /** 1–3 birds in a loose line. */
  readonly count: number;
}

/** A gull flight across the view: enters at one side, leaves at the other, gently climbing or sinking. */
export function gullFlight(rand: () => number, view: SeaView, span: number): GullFlight {
  const leftToRight = rand() < 0.62; // the wind on the chart blows east
  const speed = span * (1.6 + rand() * 0.9);
  const y = view.top + span + rand() * Math.max(1, view.bottom - view.top - span * 2);
  const r = rand();
  return {
    x: leftToRight ? view.x0 - span * 2 : view.x1 + span * 2,
    y,
    vx: leftToRight ? speed : -speed,
    vy: (rand() - 0.5) * speed * 0.18,
    count: r < 0.45 ? 1 : r < 0.85 ? 2 : 3,
  };
}

/** Seconds until the next event: uniform in [min, max], stretched when the density is low. */
export function nextGap(rand: () => number, min: number, max: number, density: number): number {
  return (min + rand() * (max - min)) / Math.max(0.25, density);
}

/** Small seeded PRNG (xorshift32) so a visit's sea is varied but reproducible in QA (?seaseed=). */
export function seaRng(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
