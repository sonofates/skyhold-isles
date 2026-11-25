import { Container, ImageSource, Rectangle, Sprite, Texture } from 'pixi.js';
import { fxPrefsNow } from './fxLayer.ts';
import { AMBIENT_FX_TABLE as configs } from './islandTable.ts';
import type { QualityTier } from './renderResolution.ts';

/**
 * Procedural ambient FX layer for painted 2D islands (Pixi v8).
 *
 * Islands opt in via `src/data/ambientFx/<id>.json` using layout-px coordinates (same 1846x852
 * space as `mapAnim/*.json` and `MapView.world`), so effects stay locked to the painting at every
 * texture bake (@1x / @1.5x / @3x), viewport fit, and pan offset.
 *
 * Performance design:
 *  - All 10 painterly primitives are packed once into a single 256x256 procedural atlas canvas,
 *    so normal-blended sprites and additive-blended sprites batch into at most 2 draw calls.
 *  - Every sprite and particle slot is pre-allocated on construction; `update()` does zero heap
 *    allocations per frame.
 *  - Respects quality tier (`low` = off, `med` = scaled down, `high` = full), Settings → Graphics
 *    effects density and reducedMotion, game pause, and `document.hidden`.
 *  - Uses a local xorshift32 PRNG (never touches `Math.random()` or the gameplay sim RNG).
 */

export const GLOBAL_MAX_PARTICLES = 96;
export const LAYOUT_WIDTH = 1846;
export const LAYOUT_HEIGHT = 852;

export interface AmbientCrack {
  readonly id: string;
  /** Polyline vertices in layout px: `[[x, y], ...]`. */
  readonly points: readonly (readonly [number, number])[];
  /** Visual core glow thickness in layout px (default 12). */
  readonly width?: number;
  /** Outer molten hex color (default `#ff4e14`). */
  readonly color?: string;
  /** Optional inner hot core hex color (default `#ffbe4f`). */
  readonly coreColor?: string;
  readonly minAlpha?: number;
  readonly maxAlpha?: number;
  /** Breathing angular frequency in rad/s (default 1.35). */
  readonly speed?: number;
  readonly phase?: number;
  /** Rising embers/sec emitted along the polyline. */
  readonly embers?: number;
  /** Subtle heat shimmer sprites drifting above the crack. */
  readonly shimmer?: boolean;
}

export interface AmbientFlame {
  readonly id: string;
  /** Flame base anchor in layout px. */
  readonly x: number;
  readonly y: number;
  /** Flame height in layout px (default 34). */
  readonly size?: number;
  /** Warm ambient halo radius in layout px (default `size * 2.4`). */
  readonly glowRadius?: number;
  /** Outer flame tint hex (default `#ff6a14`). */
  readonly color?: string;
  /** Intensity multiplier (default 1). */
  readonly intensity?: number;
  /** Rising sparks/sec from flame tip. */
  readonly sparks?: number;
  /** Drifting smoke wisps/sec above flame. */
  readonly smoke?: number;
  readonly phase?: number;
}

export type AmbientGlowKind = 'glow' | 'shimmer' | 'beacon';

export interface AmbientGlow {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Horizontal radius in layout px. */
  readonly rx: number;
  /** Vertical radius in layout px (defaults to `rx`). */
  readonly ry?: number;
  /** Base rotation in radians (or center angle for `beacon`). */
  readonly rotation?: number;
  /** Sweep amplitude in radians for `beacon` (default 0.65). */
  readonly sweep?: number;
  readonly color: string;
  readonly minAlpha?: number;
  readonly maxAlpha?: number;
  readonly speed?: number;
  readonly phase?: number;
  readonly kind?: AmbientGlowKind;
  readonly sparks?: number;
  readonly smoke?: number;
}

export type AmbientParticleKind = 'ember' | 'smoke' | 'sparkle' | 'ripple' | 'firefly' | 'petal' | 'mist';

export interface AmbientZone {
  readonly id: string;
  readonly kind: AmbientParticleKind;
  /** Spawn bounding box `[x, y, w, h]` in layout px. */
  readonly rect: readonly [number, number, number, number];
  /** Optional polygon mask inside `rect` in layout px. */
  readonly polygon?: readonly (readonly [number, number])[];
  /** Spawn rate (particles/sec). */
  readonly rate: number;
  readonly color?: string;
  readonly color2?: string;
  /** Base sprite diameter in layout px. */
  readonly size?: number;
  /** Mean drift velocity `[vx, vy]` in layout px/s. */
  readonly drift?: readonly [number, number];
  /** Mean particle lifetime in seconds. */
  readonly life?: number;
  /** Peak alpha in 0..1. */
  readonly alpha?: number;
}

export interface AmbientFxConfig {
  readonly island: string;
  readonly maxParticles?: number;
  readonly cracks?: readonly AmbientCrack[];
  readonly flames?: readonly AmbientFlame[];
  readonly glows?: readonly AmbientGlow[];
  readonly zones?: readonly AmbientZone[];
}

export interface AmbientFxStats {
  readonly island: string;
  readonly built: boolean;
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly time: number;
  readonly activeParticles: number;
  readonly particleCap: number;
  readonly crackSegments: number;
  readonly flames: number;
  readonly glows: number;
  readonly zones: number;
}

/** Settings → Reduced motion (the page class main2d sets). */
export function isReducedMotion(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('pu-reduce-motion');
}

// Per-island procedural ambient data, one lazy chunk per island (islandTable.ts): the battle
// loads its island's file before building the map layers (`loadIslandTables`).

export function getAmbientFxConfig(island: string): AmbientFxConfig | undefined {
  return configs.get(island);
}

export function listAmbientFxConfigs(): readonly AmbientFxConfig[] {
  return configs.list();
}

// --- Pure helpers (unit-tested) ------------------------------------------------------------------

/** Parses `#rrggbb` or `#rgb` into a 24-bit Pixi tint integer. */
export function parseHexColor(hex: string | undefined, fallback: number): number {
  if (!hex || typeof hex !== 'string') return fallback;
  const s = hex.startsWith('#') ? hex.slice(1) : hex;
  if (s.length === 6) {
    const n = Number.parseInt(s, 16);
    return Number.isFinite(n) ? n & 0xffffff : fallback;
  }
  if (s.length === 3) {
    const r = Number.parseInt(s[0] + s[0], 16);
    const g = Number.parseInt(s[1] + s[1], 16);
    const b = Number.parseInt(s[2] + s[2], 16);
    return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? (r << 16) | (g << 8) | b : fallback;
  }
  return fallback;
}

/** Deterministic string hash to non-zero uint32 seed. */
export function hashSeed(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

/** Fast render-only xorshift32 PRNG step. */
export function nextRand(state: { s: number }): number {
  let x = state.s | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.s = x >>> 0 || 1;
  return (state.s & 0xffff) / 65536;
}

/** Ray-casting point-in-polygon test in layout px. */
export function pointInPolygon(x: number, y: number, poly: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Total polyline length in layout px. */
export function polylineLength(points: readonly (readonly [number, number])[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

/** Writes the point at normalized fraction `u` (0..1) along a polyline into `out`. */
export function samplePolyline(
  points: readonly (readonly [number, number])[],
  u: number,
  out: { x: number; y: number },
): void {
  if (points.length === 0) {
    out.x = 0;
    out.y = 0;
    return;
  }
  if (points.length === 1) {
    out.x = points[0][0];
    out.y = points[0][1];
    return;
  }
  const total = polylineLength(points);
  if (total <= 1e-4) {
    out.x = points[0][0];
    out.y = points[0][1];
    return;
  }
  let target = Math.max(0, Math.min(1, u)) * total;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    const len = Math.hypot(dx, dy);
    if (target <= len || i === points.length - 1) {
      const t = len > 1e-4 ? Math.max(0, Math.min(1, target / len)) : 0;
      out.x = points[i - 1][0] + dx * t;
      out.y = points[i - 1][1] + dy * t;
      return;
    }
    target -= len;
  }
}

/** Effective particle budget for a given island cap, quality tier, and user effects density. */
export function effectiveParticleCap(islandCap: number | undefined, tier: QualityTier, density: number): number {
  if (tier === 'low') return 0;
  const base = Math.max(0, Math.min(GLOBAL_MAX_PARTICLES, islandCap ?? 56));
  const tierScale = tier === 'med' ? 0.55 : 1;
  const d = Math.max(0.25, Math.min(1.35, Number.isFinite(density) ? density : 1));
  return Math.max(0, Math.min(GLOBAL_MAX_PARTICLES, Math.round(base * tierScale * d)));
}

/** Effective spawn-rate scale for a given quality tier and user effects density. */
export function effectiveRateScale(tier: QualityTier, density: number): number {
  if (tier === 'low') return 0;
  const tierScale = tier === 'med' ? 0.6 : 1;
  const d = Math.max(0.25, Math.min(1.35, Number.isFinite(density) ? density : 1));
  return tierScale * d;
}

// --- Single 256x256 procedural atlas (all 10 painterly textures in 1 TextureSource) --------------

interface AmbientAtlas {
  readonly source: ImageSource;
  readonly glow: Texture;
  readonly crack: Texture;
  readonly flame: Texture;
  readonly spark: Texture;
  readonly smoke: Texture;
  readonly ripple: Texture;
  readonly petal: Texture;
  readonly shimmer: Texture;
  readonly beam: Texture;
  readonly star: Texture;
}

let cachedAtlas: AmbientAtlas | null = null;
let atlasRefs = 0;

/** QA / tests: number of live built AmbientFxLayer instances holding the shared procedural atlas. */
export function ambientAtlasRefCount(): number {
  return atlasRefs;
}

function acquireAmbientAtlas(): AmbientAtlas | null {
  const atlas = createAmbientAtlas();
  if (!atlas) return null;
  atlasRefs++;
  return atlas;
}

function releaseAmbientAtlas(atlas: AmbientAtlas | null): void {
  if (!atlas) return;
  atlasRefs = Math.max(0, atlasRefs - 1);
  if (atlasRefs === 0 && cachedAtlas === atlas) {
    cachedAtlas = null;
    const textures = [
      atlas.glow,
      atlas.crack,
      atlas.flame,
      atlas.spark,
      atlas.smoke,
      atlas.ripple,
      atlas.petal,
      atlas.shimmer,
      atlas.beam,
      atlas.star,
    ];
    for (const tex of textures) {
      if (!tex.destroyed) tex.destroy(false);
    }
    if (!atlas.source.destroyed) atlas.source.destroy();
  }
}

function createAmbientAtlas(): AmbientAtlas | null {
  if (cachedAtlas && !cachedAtlas.source.destroyed) return cachedAtlas;
  cachedAtlas = null;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  const cell = (col: number, row: number, fn: (ox: number, oy: number) => void): void => {
    ctx.save();
    const ox = col * 64;
    const oy = row * 64;
    ctx.beginPath();
    ctx.rect(ox + 1, oy + 1, 62, 62);
    ctx.clip();
    fn(ox, oy);
    ctx.restore();
  };

  // (0,0) softGlow: smooth radial light falloff
  cell(0, 0, (ox, oy) => {
    const cx = ox + 32;
    const cy = oy + 32;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.28, 'rgba(255,255,255,0.68)');
    g.addColorStop(0.62, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, 64, 64);
  });

  // (1,0) crack: horizontal luminous molten seam with tapered ends
  cell(1, 0, (ox, oy) => {
    ctx.save();
    ctx.translate(ox + 32, oy + 32);
    ctx.scale(1, 0.34);
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.42, 'rgba(255,255,255,0.78)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.26)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // (2,0) flame: painterly tapered teardrop flame tongue (base near bottom center)
  cell(2, 0, (ox, oy) => {
    const cx = ox + 32;
    const g = ctx.createRadialGradient(cx, oy + 44, 2, cx, oy + 36, 28);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,245,220,0.88)');
    g.addColorStop(0.78, 'rgba(255,220,170,0.35)');
    g.addColorStop(1, 'rgba(255,200,140,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx, oy + 6);
    ctx.bezierCurveTo(cx + 10, oy + 18, cx + 22, oy + 36, cx + 14, oy + 52);
    ctx.quadraticCurveTo(cx, oy + 60, cx - 14, oy + 52);
    ctx.bezierCurveTo(cx - 22, oy + 36, cx - 10, oy + 18, cx, oy + 6);
    ctx.closePath();
    ctx.fill();
  });

  // (3,0) spark: crisp glowing ember / firefly speck
  cell(3, 0, (ox, oy) => {
    const cx = ox + 32;
    const cy = oy + 32;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 24);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.24, 'rgba(255,252,240,0.92)');
    g.addColorStop(0.55, 'rgba(255,240,210,0.32)');
    g.addColorStop(1, 'rgba(255,230,190,0)');
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, 64, 64);
  });

  // (0,1) smoke: organic multi-lobe painterly cloud wisp
  cell(0, 1, (ox, oy) => {
    const blobs: readonly [number, number, number, number][] = [
      [32, 34, 22, 0.72],
      [22, 30, 16, 0.55],
      [42, 30, 15, 0.5],
      [30, 22, 14, 0.48],
    ];
    for (const [bx, by, r, a] of blobs) {
      const g = ctx.createRadialGradient(ox + bx, oy + by, 0, ox + bx, oy + by, r);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.55, `rgba(255,255,255,${a * 0.45})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ox + bx, oy + by, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // (1,1) ripple: delicate feathered water ring
  cell(1, 1, (ox, oy) => {
    const cx = ox + 32;
    const cy = oy + 32;
    const g = ctx.createRadialGradient(cx, cy, 16, cx, cy, 29);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.66, 'rgba(255,255,255,0.92)');
    g.addColorStop(0.84, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, 64, 64);
  });

  // (2,1) petal: tiny painted tapered blossom petal / autumn leaf
  cell(2, 1, (ox, oy) => {
    const cx = ox + 32;
    const cy = oy + 32;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.moveTo(cx - 22, cy + 2);
    ctx.quadraticCurveTo(cx - 4, cy - 16, cx + 22, cy - 1);
    ctx.quadraticCurveTo(cx + 2, cy + 16, cx - 22, cy + 2);
    ctx.closePath();
    ctx.fill();
  });

  // (3,1) shimmer: soft wavy vertical heat-haze ribbon
  cell(3, 1, (ox, oy) => {
    const cx = ox + 32;
    for (const dx of [-10, 0, 10]) {
      const g = ctx.createLinearGradient(cx + dx, oy + 6, cx + dx, oy + 58);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.52)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.44)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = dx === 0 ? 7 : 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + dx, oy + 8);
      ctx.bezierCurveTo(cx + dx + 5, oy + 24, cx + dx - 5, oy + 40, cx + dx, oy + 56);
      ctx.stroke();
    }
  });

  // (0..1, 2) beam: soft lighthouse beacon fan cone (128x64)
  ctx.save();
  ctx.beginPath();
  ctx.rect(1, 129, 126, 62);
  ctx.clip();
  const bg = ctx.createRadialGradient(6, 160, 2, 6, 160, 120);
  bg.addColorStop(0, 'rgba(255,255,255,0.85)');
  bg.addColorStop(0.3, 'rgba(255,255,255,0.42)');
  bg.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  bg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(6, 160);
  ctx.lineTo(126, 130);
  ctx.quadraticCurveTo(128, 160, 126, 190);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // (2,2) star: four-point water / crystal glint sparkle
  cell(2, 2, (ox, oy) => {
    const cx = ox + 32;
    const cy = oy + 32;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 28);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 28);
    ctx.quadraticCurveTo(cx + 3, cy - 3, cx + 28, cy);
    ctx.quadraticCurveTo(cx + 3, cy + 3, cx, cy + 28);
    ctx.quadraticCurveTo(cx - 3, cy + 3, cx - 28, cy);
    ctx.quadraticCurveTo(cx - 3, cy - 3, cx, cy - 28);
    ctx.closePath();
    ctx.fill();
  });

  const source = new ImageSource({ resource: c });
  const sub = (x: number, y: number, w = 64, h = 64): Texture => new Texture({ source, frame: new Rectangle(x, y, w, h) });
  cachedAtlas = {
    source,
    glow: sub(0, 0),
    crack: sub(64, 0),
    flame: sub(128, 0),
    spark: sub(192, 0),
    smoke: sub(0, 64),
    ripple: sub(64, 64),
    petal: sub(128, 64),
    shimmer: sub(192, 64),
    beam: sub(0, 128, 128, 64),
    star: sub(128, 128),
  };
  return cachedAtlas;
}

// --- Internal runtime records (all pre-allocated on construction) --------------------------------

interface CrackSegRuntime {
  readonly outer: Sprite;
  readonly core: Sprite;
  readonly shimmer?: Sprite;
  readonly baseY: number;
  readonly minAlpha: number;
  readonly maxAlpha: number;
  readonly speed: number;
  readonly phase: number;
}

interface FlameRuntime {
  readonly halo: Sprite;
  readonly outer: Sprite;
  readonly mid: Sprite;
  readonly core: Sprite;
  readonly baseScaleX: number;
  readonly baseScaleY: number;
  readonly haloScale: number;
  readonly intensity: number;
  readonly phase: number;
}

interface GlowRuntime {
  readonly sprite: Sprite;
  readonly kind: AmbientGlowKind;
  readonly baseX: number;
  readonly baseY: number;
  readonly baseScaleX: number;
  readonly baseScaleY: number;
  readonly baseRot: number;
  readonly sweep: number;
  readonly minAlpha: number;
  readonly maxAlpha: number;
  readonly speed: number;
  readonly phase: number;
}

interface EmitterRuntime {
  readonly kind: AmbientParticleKind;
  readonly source: 'zone' | 'crack' | 'point';
  readonly zone?: AmbientZone;
  readonly crack?: AmbientCrack;
  readonly x: number;
  readonly y: number;
  readonly spreadX: number;
  readonly spreadY: number;
  readonly rate: number;
  readonly color: number;
  readonly color2: number;
  readonly size: number;
  readonly vx: number;
  readonly vy: number;
  readonly life: number;
  readonly alpha: number;
  acc: number;
}

interface ParticleSlot {
  active: boolean;
  kind: AmbientParticleKind;
  readonly addSprite: Sprite;
  readonly normSprite: Sprite;
  useAdd: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  alpha: number;
  rot: number;
  vr: number;
  wobbleAmp: number;
  wobbleFreq: number;
  phase: number;
  tint: number;
}

const DEFAULT_PARTICLE_STYLE: Readonly<
  Record<
    AmbientParticleKind,
    { color: number; color2: number; size: number; vx: number; vy: number; life: number; alpha: number; add: boolean }
  >
> = {
  ember: { color: 0xff8a24, color2: 0xffd25a, size: 8, vx: 8, vy: -32, life: 2.3, alpha: 0.9, add: true },
  smoke: { color: 0x3b2c26, color2: 0x5c473e, size: 32, vx: 12, vy: -18, life: 3.6, alpha: 0.24, add: false },
  sparkle: { color: 0xfff8dc, color2: 0xb8ecff, size: 12, vx: 0, vy: 0, life: 1.4, alpha: 0.78, add: true },
  ripple: { color: 0xd6f4ff, color2: 0xffffff, size: 34, vx: 0, vy: 0, life: 2.6, alpha: 0.3, add: true },
  firefly: { color: 0xffe878, color2: 0xc8ff7a, size: 10, vx: 6, vy: -4, life: 4.4, alpha: 0.85, add: true },
  petal: { color: 0xfff4e0, color2: 0xffd2b8, size: 11, vx: 22, vy: 11, life: 4.8, alpha: 0.78, add: false },
  mist: { color: 0xe6f0fa, color2: 0xd2e2f2, size: 78, vx: 14, vy: -4, life: 6.0, alpha: 0.16, add: false },
};

/**
 * Procedural ambient FX layer mounted inside the map's ambient container (strictly above the map
 * sprite and below all gameplay layers).
 */
export class AmbientFxLayer {
  readonly root = new Container();
  private readonly normalLayer = new Container();
  private readonly addLayer = new Container();
  private readonly config: AmbientFxConfig;
  private atlas: AmbientAtlas | null = null;
  private readonly rng: { s: number };
  private readonly cracks: CrackSegRuntime[] = [];
  private readonly flames: FlameRuntime[] = [];
  private readonly glows: GlowRuntime[] = [];
  private readonly emitters: EmitterRuntime[] = [];
  private readonly pool: ParticleSlot[] = [];
  private readonly scratchPt = { x: 0, y: 0 };
  private readonly maxPool: number;
  private activeParticles = 0;
  private currentCap = 0;
  private time = 0;
  private built = false;
  private enabled = false;
  private paused = false;
  private warmed = false;
  private destroyed = false;

  constructor(config: AmbientFxConfig) {
    this.config = config;
    this.rng = { s: hashSeed(config.island) };
    this.root.eventMode = 'none';
    this.root.interactiveChildren = false;
    this.normalLayer.eventMode = 'none';
    this.normalLayer.interactiveChildren = false;
    this.addLayer.eventMode = 'none';
    this.addLayer.interactiveChildren = false;
    this.root.addChild(this.normalLayer, this.addLayer);
    this.root.visible = false;

    this.maxPool = Math.max(0, Math.min(GLOBAL_MAX_PARTICLES, config.maxParticles ?? 56));
  }

  /** Lazily allocates the shared atlas and pre-pooled sprites on first eligible active frame. */
  private ensureBuilt(): boolean {
    if (this.destroyed || this.root.destroyed) return false;
    if (this.built) return true;
    this.built = true;
    this.atlas = acquireAmbientAtlas();
    this.currentCap = this.maxPool;
    this.buildCracks();
    this.buildFlames();
    this.buildGlows();
    this.buildZones();
    this.buildParticlePool();
    return true;
  }

  private tex(name: keyof Omit<AmbientAtlas, 'source'>): Texture {
    return this.atlas ? this.atlas[name] : Texture.WHITE;
  }

  private buildCracks(): void {
    const list = this.config.cracks ?? [];
    for (let ci = 0; ci < list.length; ci++) {
      const c = list[ci];
      if (c.points.length < 2) continue;
      const width = c.width ?? 12;
      const outerTint = parseHexColor(c.color, 0xff4e14);
      const coreTint = parseHexColor(c.coreColor, 0xffc152);
      const minA = c.minAlpha ?? 0.28;
      const maxA = c.maxAlpha ?? 0.72;
      const speed = c.speed ?? 1.35;
      const basePhase = c.phase ?? ci * 1.17;

      for (let i = 1; i < c.points.length; i++) {
        const [x0, y0] = c.points[i - 1];
        const [x1, y1] = c.points[i];
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        if (len < 1) continue;
        const mx = (x0 + x1) * 0.5;
        const my = (y0 + y1) * 0.5;
        const ang = Math.atan2(dy, dx);
        // Overlap slightly at joints so polylines blend seamlessly.
        const segLen = len + width * 0.65;

        const outer = new Sprite(this.tex('crack'));
        outer.anchor.set(0.5);
        outer.blendMode = 'add';
        outer.tint = outerTint;
        outer.position.set(mx, my);
        outer.rotation = ang;
        outer.scale.set(segLen / 54, (width * 2.15) / 22);
        this.addLayer.addChild(outer);

        const core = new Sprite(this.tex('crack'));
        core.anchor.set(0.5);
        core.blendMode = 'add';
        core.tint = coreTint;
        core.position.set(mx, my);
        core.rotation = ang;
        core.scale.set((len + width * 0.25) / 54, (width * 0.72) / 22);
        this.addLayer.addChild(core);

        let shimmer: Sprite | undefined;
        if (c.shimmer && i % 2 === 1) {
          shimmer = new Sprite(this.tex('shimmer'));
          shimmer.anchor.set(0.5, 0.85);
          shimmer.blendMode = 'add';
          shimmer.tint = 0xff9a48;
          shimmer.position.set(mx, my - 4);
          shimmer.scale.set(Math.max(0.55, Math.min(1.6, len / 42)), 0.75);
          shimmer.alpha = 0.08;
          this.addLayer.addChild(shimmer);
        }

        this.cracks.push({
          outer,
          core,
          shimmer,
          baseY: my - 4,
          minAlpha: minA,
          maxAlpha: maxA,
          speed,
          phase: basePhase + i * 0.45,
        });
      }

      if (c.embers && c.embers > 0) {
        const def = DEFAULT_PARTICLE_STYLE.ember;
        this.emitters.push({
          kind: 'ember',
          source: 'crack',
          crack: c,
          x: 0,
          y: 0,
          spreadX: 4,
          spreadY: 3,
          rate: c.embers,
          color: outerTint,
          color2: coreTint,
          size: def.size * 0.88,
          vx: def.vx,
          vy: def.vy,
          life: def.life,
          alpha: def.alpha,
          acc: nextRand(this.rng),
        });
      }
    }
  }

  private buildFlames(): void {
    const list = this.config.flames ?? [];
    for (let fi = 0; fi < list.length; fi++) {
      const f = list[fi];
      const size = f.size ?? 34;
      const glowRadius = f.glowRadius ?? size * 2.5;
      const outerTint = parseHexColor(f.color, 0xff6814);
      const intensity = f.intensity ?? 1;
      const phase = f.phase ?? fi * 1.93;

      const halo = new Sprite(this.tex('glow'));
      halo.anchor.set(0.5);
      halo.blendMode = 'add';
      halo.tint = outerTint;
      halo.position.set(f.x, f.y - size * 0.25);
      const haloScale = glowRadius / 30;
      halo.scale.set(haloScale, haloScale * 0.82);
      this.addLayer.addChild(halo);

      const baseScaleX = (size * 0.72) / 36;
      const baseScaleY = size / 52;

      const outer = new Sprite(this.tex('flame'));
      outer.anchor.set(0.5, 0.88);
      outer.blendMode = 'add';
      outer.tint = outerTint;
      outer.position.set(f.x, f.y);
      outer.scale.set(baseScaleX, baseScaleY);
      this.addLayer.addChild(outer);

      const mid = new Sprite(this.tex('flame'));
      mid.anchor.set(0.5, 0.88);
      mid.blendMode = 'add';
      mid.tint = 0xff941a;
      mid.position.set(f.x + 1.2, f.y - 1);
      mid.scale.set(baseScaleX * 0.74, baseScaleY * 0.82);
      this.addLayer.addChild(mid);

      const core = new Sprite(this.tex('flame'));
      core.anchor.set(0.5, 0.88);
      core.blendMode = 'add';
      core.tint = 0xffe478;
      core.position.set(f.x - 0.8, f.y - 2);
      core.scale.set(baseScaleX * 0.44, baseScaleY * 0.52);
      this.addLayer.addChild(core);

      this.flames.push({ halo, outer, mid, core, baseScaleX, baseScaleY, haloScale, intensity, phase });

      if (f.sparks && f.sparks > 0) {
        this.emitters.push({
          kind: 'ember',
          source: 'point',
          x: f.x,
          y: f.y - size * 0.55,
          spreadX: size * 0.28,
          spreadY: size * 0.18,
          rate: f.sparks,
          color: 0xffa030,
          color2: 0xffe484,
          size: 7,
          vx: 9,
          vy: -38,
          life: 1.9,
          alpha: 0.92,
          acc: nextRand(this.rng),
        });
      }
      if (f.smoke && f.smoke > 0) {
        const def = DEFAULT_PARTICLE_STYLE.smoke;
        this.emitters.push({
          kind: 'smoke',
          source: 'point',
          x: f.x,
          y: f.y - size * 0.72,
          spreadX: size * 0.25,
          spreadY: 4,
          rate: f.smoke,
          color: def.color,
          color2: def.color2,
          size: size * 0.95,
          vx: 14,
          vy: -20,
          life: 3.1,
          alpha: 0.22,
          acc: nextRand(this.rng),
        });
      }
    }
  }

  private buildGlows(): void {
    const list = this.config.glows ?? [];
    for (let gi = 0; gi < list.length; gi++) {
      const g = list[gi];
      const kind: AmbientGlowKind = g.kind ?? 'glow';
      const ry = g.ry ?? g.rx;
      const tint = parseHexColor(g.color, 0xff7824);
      const texKey = kind === 'shimmer' ? 'shimmer' : kind === 'beacon' ? 'beam' : 'glow';
      const sprite = new Sprite(this.tex(texKey));
      if (kind === 'beacon') {
        sprite.anchor.set(0.05, 0.5);
      } else if (kind === 'shimmer') {
        sprite.anchor.set(0.5, 0.8);
      } else {
        sprite.anchor.set(0.5);
      }
      sprite.blendMode = 'add';
      sprite.tint = tint;
      sprite.position.set(g.x, g.y);
      sprite.rotation = g.rotation ?? 0;

      const baseScaleX = kind === 'beacon' ? g.rx / 120 : g.rx / 30;
      const baseScaleY = kind === 'beacon' ? ry / 30 : ry / 30;
      sprite.scale.set(baseScaleX, baseScaleY);
      this.addLayer.addChild(sprite);

      this.glows.push({
        sprite,
        kind,
        baseX: g.x,
        baseY: g.y,
        baseScaleX,
        baseScaleY,
        baseRot: g.rotation ?? 0,
        sweep: g.sweep ?? 0.65,
        minAlpha: g.minAlpha ?? (kind === 'shimmer' ? 0.06 : 0.2),
        maxAlpha: g.maxAlpha ?? (kind === 'shimmer' ? 0.17 : 0.52),
        speed: g.speed ?? (kind === 'beacon' ? 0.55 : kind === 'shimmer' ? 2.4 : 1.5),
        phase: g.phase ?? gi * 1.37,
      });

      if (g.sparks && g.sparks > 0) {
        this.emitters.push({
          kind: 'ember',
          source: 'point',
          x: g.x,
          y: g.y,
          spreadX: g.rx * 0.55,
          spreadY: ry * 0.35,
          rate: g.sparks,
          color: tint,
          color2: 0xffe07d,
          size: 7.5,
          vx: 10,
          vy: -34,
          life: 2.1,
          alpha: 0.9,
          acc: nextRand(this.rng),
        });
      }
      if (g.smoke && g.smoke > 0) {
        const def = DEFAULT_PARTICLE_STYLE.smoke;
        this.emitters.push({
          kind: 'smoke',
          source: 'point',
          x: g.x,
          y: g.y - ry * 0.4,
          spreadX: g.rx * 0.45,
          spreadY: 6,
          rate: g.smoke,
          color: def.color,
          color2: def.color2,
          size: Math.max(24, g.rx * 0.85),
          vx: 15,
          vy: -20,
          life: 3.4,
          alpha: 0.22,
          acc: nextRand(this.rng),
        });
      }
    }
  }

  private buildZones(): void {
    const list = this.config.zones ?? [];
    for (let zi = 0; zi < list.length; zi++) {
      const z = list[zi];
      if (z.rate <= 0) continue;
      const def = DEFAULT_PARTICLE_STYLE[z.kind];
      this.emitters.push({
        kind: z.kind,
        source: 'zone',
        zone: z,
        x: z.rect[0],
        y: z.rect[1],
        spreadX: z.rect[2],
        spreadY: z.rect[3],
        rate: z.rate,
        color: parseHexColor(z.color, def.color),
        color2: parseHexColor(z.color2, def.color2),
        size: z.size ?? def.size,
        vx: z.drift ? z.drift[0] : def.vx,
        vy: z.drift ? z.drift[1] : def.vy,
        life: z.life ?? def.life,
        alpha: z.alpha ?? def.alpha,
        acc: nextRand(this.rng),
      });
    }
  }

  private buildParticlePool(): void {
    for (let i = 0; i < this.maxPool; i++) {
      const addSprite = new Sprite(this.tex('spark'));
      addSprite.anchor.set(0.5);
      addSprite.blendMode = 'add';
      addSprite.visible = false;
      this.addLayer.addChild(addSprite);

      const normSprite = new Sprite(this.tex('smoke'));
      normSprite.anchor.set(0.5);
      normSprite.visible = false;
      this.normalLayer.addChild(normSprite);

      this.pool.push({
        active: false,
        kind: 'ember',
        addSprite,
        normSprite,
        useAdd: true,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        age: 0,
        life: 1,
        size: 8,
        alpha: 1,
        rot: 0,
        vr: 0,
        wobbleAmp: 0,
        wobbleFreq: 0,
        phase: 0,
        tint: 0xffffff,
      });
    }
  }

  private clearParticles(): void {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      p.active = false;
      if (!p.addSprite.destroyed) p.addSprite.visible = false;
      if (!p.normSprite.destroyed) p.normSprite.visible = false;
    }
    this.activeParticles = 0;
  }

  private spawnFrom(em: EmitterRuntime): void {
    if (this.activeParticles >= this.currentCap) return;
    let slot: ParticleSlot | undefined;
    const n = Math.min(this.currentCap, this.pool.length);
    for (let i = 0; i < n; i++) {
      if (!this.pool[i].active) {
        slot = this.pool[i];
        break;
      }
    }
    if (!slot) return;

    let sx = em.x;
    let sy = em.y;
    if (em.source === 'crack' && em.crack) {
      samplePolyline(em.crack.points, nextRand(this.rng), this.scratchPt);
      sx = this.scratchPt.x + (nextRand(this.rng) - 0.5) * em.spreadX * 2;
      sy = this.scratchPt.y + (nextRand(this.rng) - 0.5) * em.spreadY * 2;
    } else if (em.source === 'zone' && em.zone) {
      const [rx, ry, rw, rh] = em.zone.rect;
      if (em.zone.polygon && em.zone.polygon.length >= 3) {
        let found = false;
        for (let tries = 0; tries < 8; tries++) {
          const tx = rx + nextRand(this.rng) * rw;
          const ty = ry + nextRand(this.rng) * rh;
          if (pointInPolygon(tx, ty, em.zone.polygon)) {
            sx = tx;
            sy = ty;
            found = true;
            break;
          }
        }
        if (!found) return;
      } else {
        sx = rx + nextRand(this.rng) * rw;
        sy = ry + nextRand(this.rng) * rh;
      }
    } else {
      sx = em.x + (nextRand(this.rng) - 0.5) * em.spreadX * 2;
      sy = em.y + (nextRand(this.rng) - 0.5) * em.spreadY * 2;
    }

    const r1 = nextRand(this.rng);
    const r2 = nextRand(this.rng);
    const r3 = nextRand(this.rng);
    const r4 = nextRand(this.rng);
    const def = DEFAULT_PARTICLE_STYLE[em.kind];

    slot.active = true;
    slot.kind = em.kind;
    slot.useAdd = def.add;
    slot.x = sx;
    slot.y = sy;
    slot.age = 0;
    slot.life = em.life * (0.72 + r1 * 0.56);
    slot.size = em.size * (0.75 + r2 * 0.5);
    slot.alpha = em.alpha * (0.8 + r3 * 0.35);
    slot.tint = r4 < 0.5 ? em.color : em.color2;
    slot.phase = r1 * Math.PI * 2;

    if (em.kind === 'ember') {
      slot.vx = em.vx + (r2 - 0.5) * 18;
      slot.vy = em.vy * (0.75 + r3 * 0.5);
      slot.rot = 0;
      slot.vr = 0;
      slot.wobbleAmp = 10 + r4 * 12;
      slot.wobbleFreq = 2.2 + r1 * 2.4;
    } else if (em.kind === 'smoke') {
      slot.vx = em.vx + (r2 - 0.5) * 10;
      slot.vy = em.vy * (0.8 + r3 * 0.4);
      slot.rot = r4 * Math.PI * 2;
      slot.vr = (r2 - 0.5) * 0.5;
      slot.wobbleAmp = 6;
      slot.wobbleFreq = 1.1;
    } else if (em.kind === 'sparkle') {
      slot.vx = em.vx * (0.6 + r2 * 0.8);
      slot.vy = em.vy * (0.6 + r3 * 0.8);
      slot.rot = r4 * Math.PI * 0.5;
      slot.vr = (r2 - 0.5) * 0.8;
      slot.wobbleAmp = 0;
      slot.wobbleFreq = 0;
    } else if (em.kind === 'ripple') {
      slot.vx = em.vx;
      slot.vy = em.vy;
      slot.rot = 0;
      slot.vr = 0;
      slot.wobbleAmp = 0;
      slot.wobbleFreq = 0;
    } else if (em.kind === 'firefly') {
      slot.vx = em.vx + (r2 - 0.5) * 16;
      slot.vy = em.vy + (r3 - 0.5) * 14;
      slot.rot = 0;
      slot.vr = 0;
      slot.wobbleAmp = 14 + r4 * 10;
      slot.wobbleFreq = 1.2 + r1 * 1.4;
    } else if (em.kind === 'petal') {
      slot.vx = em.vx * (0.75 + r2 * 0.5);
      slot.vy = em.vy * (0.75 + r3 * 0.5);
      slot.rot = r4 * Math.PI * 2;
      slot.vr = (r2 - 0.5) * 2.8;
      slot.wobbleAmp = 14;
      slot.wobbleFreq = 1.8 + r1 * 1.5;
    } else {
      // mist
      slot.vx = em.vx * (0.7 + r2 * 0.6);
      slot.vy = em.vy * (0.7 + r3 * 0.6);
      slot.rot = r4 * Math.PI * 2;
      slot.vr = (r2 - 0.5) * 0.14;
      slot.wobbleAmp = 4;
      slot.wobbleFreq = 0.6;
    }

    const sp = slot.useAdd ? slot.addSprite : slot.normSprite;
    const other = slot.useAdd ? slot.normSprite : slot.addSprite;
    other.visible = false;
    sp.texture =
      em.kind === 'sparkle'
        ? this.tex('star')
        : em.kind === 'ripple'
          ? this.tex('ripple')
          : em.kind === 'petal'
            ? this.tex('petal')
            : em.kind === 'smoke' || em.kind === 'mist'
              ? this.tex('smoke')
              : this.tex('spark');
    sp.tint = slot.tint;
    sp.rotation = slot.rot;
    sp.visible = true;
    this.activeParticles++;
  }

  /** Advances procedural animation by `dtSec` (clamped for stability). */
  step(dtSec: number, tier: QualityTier = 'high'): void {
    if (this.destroyed) return;
    if (!this.built) {
      if (tier === 'low' || isReducedMotion()) return;
      if (!this.ensureBuilt()) return;
    }
    const dt = Math.max(0, Math.min(0.1, Number.isFinite(dtSec) ? dtSec : 0));
    this.time += dt;
    const t = this.time;

    const density = fxPrefsNow().density;
    // Never above the pool that was allocated at build time (High density can ask for more slots than exist).
    const nextCap = Math.min(this.pool.length, effectiveParticleCap(this.config.maxParticles, tier, density));
    if (nextCap < this.currentCap) {
      for (let i = nextCap; i < this.pool.length; i++) {
        const p = this.pool[i];
        if (p.active) {
          p.active = false;
          p.addSprite.visible = false;
          p.normSprite.visible = false;
          this.activeParticles--;
        }
      }
    }
    this.currentCap = nextCap;

    // 1. Animate lava / crystal cracks
    for (let i = 0; i < this.cracks.length; i++) {
      const c = this.cracks[i];
      const wave = 0.5 + 0.5 * Math.sin(t * c.speed + c.phase);
      const ripple = 0.5 + 0.5 * Math.sin(t * (c.speed * 1.73) + c.phase * 1.4);
      const a = c.minAlpha + (c.maxAlpha - c.minAlpha) * (wave * 0.72 + ripple * 0.28);
      c.outer.alpha = a * 0.68;
      c.core.alpha = Math.min(1, a * 0.92);
      if (c.shimmer) {
        const sw = Math.sin(t * 2.8 + c.phase);
        c.shimmer.y = c.baseY - 4 - sw * 3.5;
        c.shimmer.alpha = 0.055 + 0.045 * (0.5 + 0.5 * Math.cos(t * 2.1 + c.phase));
      }
    }

    // 2. Animate brazier / torch / hearth flames
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const p = f.phase;
      const flick1 = Math.sin(t * 7.8 + p) * 0.5 + Math.sin(t * 13.1 + p * 1.7) * 0.5;
      const flick2 = Math.cos(t * 9.4 + p * 1.3) * 0.5 + Math.sin(t * 16.3 + p * 0.8) * 0.5;
      const sway = Math.sin(t * 4.6 + p) * 0.09 + Math.sin(t * 10.7 + p * 2.1) * 0.05;
      const k = f.intensity;

      f.halo.alpha = Math.min(0.5, (0.2 + 0.07 * flick1) * k);
      const hs = f.haloScale * (1 + 0.055 * flick2);
      f.halo.scale.set(hs, hs * 0.82);

      f.outer.scale.set(f.baseScaleX * (1 + 0.1 * flick2), f.baseScaleY * (1 + 0.18 * flick1));
      f.outer.rotation = sway * 1.15;
      f.outer.alpha = Math.min(0.82, (0.56 + 0.14 * flick1) * k);

      f.mid.scale.set(f.baseScaleX * 0.74 * (1 - 0.08 * flick1), f.baseScaleY * 0.82 * (1 + 0.2 * flick2));
      f.mid.rotation = -sway * 1.05;
      f.mid.alpha = Math.min(0.84, (0.58 + 0.14 * flick2) * k);

      f.core.scale.set(f.baseScaleX * 0.44 * (1 + 0.06 * flick1), f.baseScaleY * 0.52 * (1 + 0.14 * flick1));
      f.core.rotation = sway * 0.45;
      f.core.alpha = Math.min(0.76, (0.54 + 0.12 * flick2) * k);
    }

    // 3. Animate glows, heat shimmers, and beacons
    for (let i = 0; i < this.glows.length; i++) {
      const g = this.glows[i];
      if (g.kind === 'beacon') {
        const s = Math.sin(t * g.speed + g.phase);
        g.sprite.rotation = g.baseRot + s * g.sweep;
        const w = 0.5 + 0.5 * Math.cos(t * g.speed * 1.3 + g.phase);
        g.sprite.alpha = g.minAlpha + (g.maxAlpha - g.minAlpha) * w;
      } else if (g.kind === 'shimmer') {
        const s = Math.sin(t * g.speed + g.phase);
        g.sprite.position.set(g.baseX + s * 3.5, g.baseY - 4 - Math.cos(t * (g.speed * 0.7) + g.phase) * 4);
        g.sprite.scale.set(g.baseScaleX * (1 + 0.06 * s), g.baseScaleY * (1 + 0.1 * Math.cos(t * g.speed * 1.3 + g.phase)));
        g.sprite.alpha = g.minAlpha + (g.maxAlpha - g.minAlpha) * (0.5 + 0.5 * s);
      } else {
        const w = 0.5 + 0.5 * Math.sin(t * g.speed + g.phase);
        const f = 0.5 + 0.5 * Math.sin(t * (g.speed * 2.13) + g.phase * 1.3);
        g.sprite.alpha = g.minAlpha + (g.maxAlpha - g.minAlpha) * (w * 0.78 + f * 0.22);
        const sc = 0.96 + 0.08 * w;
        g.sprite.scale.set(g.baseScaleX * sc, g.baseScaleY * sc);
      }
    }

    // 4. Emit new particles from zones / cracks / points
    const rateScale = effectiveRateScale(tier, density);
    if (dt > 0 && rateScale > 0 && this.currentCap > 0) {
      for (let i = 0; i < this.emitters.length; i++) {
        const em = this.emitters[i];
        em.acc += em.rate * rateScale * dt;
        // Clamp spawns per frame per emitter to avoid bursts.
        let budget = 2;
        while (em.acc >= 1 && budget > 0) {
          em.acc -= 1;
          budget--;
          this.spawnFrom(em);
        }
        if (em.acc > 2) em.acc = 2;
      }
    }

    // 5. Update active particles (zero allocations)
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        p.addSprite.visible = false;
        p.normSprite.visible = false;
        this.activeParticles--;
        continue;
      }
      const u = p.age / p.life;
      const sp = p.useAdd ? p.addSprite : p.normSprite;

      if (p.kind === 'ember') {
        const wob = Math.sin(p.age * p.wobbleFreq + p.phase) * p.wobbleAmp;
        p.x += (p.vx + wob) * dt;
        p.y += p.vy * dt;
        const fade = u < 0.14 ? u / 0.14 : Math.pow(1 - u, 1.35);
        const sc = (p.size / 40) * (1 - u * 0.45);
        sp.position.set(p.x, p.y);
        sp.scale.set(sc, sc * 1.2);
        sp.alpha = p.alpha * fade;
      } else if (p.kind === 'smoke') {
        p.x += (p.vx + Math.sin(p.age * p.wobbleFreq + p.phase) * p.wobbleAmp) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        const fade = u < 0.22 ? u / 0.22 : 1 - (u - 0.22) / 0.78;
        const sc = (p.size / 44) * (0.65 + u * 1.15);
        sp.position.set(p.x, p.y);
        sp.rotation = p.rot;
        sp.scale.set(sc);
        sp.alpha = p.alpha * fade;
      } else if (p.kind === 'sparkle') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        const pulse = Math.sin(u * Math.PI);
        const sc = (p.size / 42) * (0.45 + pulse * 0.8);
        sp.position.set(p.x, p.y);
        sp.rotation = p.rot;
        sp.scale.set(sc);
        sp.alpha = p.alpha * pulse * pulse;
      } else if (p.kind === 'ripple') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const fade = u < 0.18 ? u / 0.18 : 1 - (u - 0.18) / 0.82;
        const sc = (p.size / 54) * (0.3 + u * 1.15);
        sp.position.set(p.x, p.y);
        // Squashed ellipse for 3/4 top-down water perspective.
        sp.scale.set(sc, sc * 0.46);
        sp.alpha = p.alpha * fade;
      } else if (p.kind === 'firefly') {
        p.x += (p.vx + Math.sin(p.age * p.wobbleFreq + p.phase) * p.wobbleAmp) * dt;
        p.y += (p.vy + Math.cos(p.age * (p.wobbleFreq * 0.85) + p.phase) * (p.wobbleAmp * 0.65)) * dt;
        const env = u < 0.18 ? u / 0.18 : u > 0.78 ? (1 - u) / 0.22 : 1;
        const blink = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(p.age * 3.8 + p.phase));
        const sc = (p.size / 36) * (0.75 + 0.35 * blink);
        sp.position.set(p.x, p.y);
        sp.scale.set(sc);
        sp.alpha = p.alpha * env * blink;
      } else if (p.kind === 'petal') {
        const flutter = Math.sin(p.age * p.wobbleFreq + p.phase);
        p.x += (p.vx + flutter * p.wobbleAmp) * dt;
        p.y += (p.vy + Math.cos(p.age * p.wobbleFreq * 0.7 + p.phase) * 6) * dt;
        p.rot += p.vr * dt;
        const env = u < 0.15 ? u / 0.15 : u > 0.8 ? (1 - u) / 0.2 : 1;
        const sc = p.size / 42;
        sp.position.set(p.x, p.y);
        sp.rotation = p.rot;
        // Slight vertical scale squash mimics 3D petal tumbling.
        sp.scale.set(sc, sc * (0.5 + 0.5 * Math.abs(flutter)));
        sp.alpha = p.alpha * env;
      } else {
        // mist
        p.x += p.vx * dt;
        p.y += (p.vy + Math.sin(p.age * p.wobbleFreq + p.phase) * p.wobbleAmp) * dt;
        p.rot += p.vr * dt;
        const env = Math.sin(u * Math.PI);
        const sc = (p.size / 44) * (0.85 + u * 0.45);
        sp.position.set(p.x, p.y);
        sp.rotation = p.rot;
        sp.scale.set(sc * 1.45, sc * 0.75);
        sp.alpha = p.alpha * env;
      }
    }
  }

  /**
   * Per-frame sync called by `mapAnimLayer`.
   * Disables cleanly on low tier / reduced motion, freezes cleanly on pause / hidden tab.
   */
  update(enabled: boolean, paused: boolean, dtSec: number, tier: QualityTier = 'high'): void {
    if (this.destroyed) return;
    this.enabled = enabled && tier !== 'low' && !isReducedMotion();
    this.paused = paused || (typeof document !== 'undefined' && document.hidden);

    if (!this.enabled) {
      if (this.root.visible) {
        this.root.visible = false;
      }
      if (this.built) {
        this.clearParticles();
        this.warmed = false;
      }
      return;
    }

    // Never allocate sprites or run warm-up steps behind a paused intro or hidden tab.
    if (this.paused) return;

    if (!this.ensureBuilt()) return;

    if (!this.root.visible) {
      this.root.visible = true;
    }

    if (!this.warmed) {
      this.warmed = true;
      // Pre-seed 2.5 seconds of steady-state ambient motion so the island feels alive on frame 1.
      for (let i = 0; i < 25; i++) this.step(0.1, tier);
      return;
    }

    this.step(dtSec, tier);
  }

  debug(): AmbientFxStats {
    return {
      island: this.config.island,
      built: this.built,
      enabled: this.enabled,
      paused: this.paused,
      time: Math.round(this.time * 1000) / 1000,
      activeParticles: this.activeParticles,
      particleCap: this.built ? this.currentCap : 0,
      crackSegments: this.cracks.length,
      flames: this.flames.length,
      glows: this.glows.length,
      zones: this.config.zones?.length ?? 0,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.enabled = false;
    this.warmed = false;
    if (!this.root.destroyed) {
      this.clearParticles();
      this.root.destroy({ children: true });
    }
    this.activeParticles = 0;
    this.currentCap = 0;
    this.cracks.length = 0;
    this.flames.length = 0;
    this.glows.length = 0;
    this.emitters.length = 0;
    this.pool.length = 0;
    const atlas = this.atlas;
    this.atlas = null;
    this.built = false;
    releaseAmbientAtlas(atlas);
  }
}
