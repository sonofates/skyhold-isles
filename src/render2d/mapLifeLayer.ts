import {
  Container,
  GlProgram,
  ImageSource,
  Mesh,
  MeshGeometry,
  Rectangle,
  Shader,
  Sprite,
  Texture,
  UniformGroup,
} from 'pixi.js';
import type { TextureSource } from 'pixi.js';
import { hashSeed, isReducedMotion, LAYOUT_HEIGHT, LAYOUT_WIDTH, nextRand, parseHexColor } from './ambientFx.ts';
import type { WorldLayers } from './layers.ts';
import type { MapView } from './mapView.ts';
import type { QualityTier } from './renderResolution.ts';

/**
 * Procedural "map life" layer for painted 2D islands (Pixi v8).
 *
 * Islands opt in via `src/data/mapLife/<id>.json` (layout-px coordinates, same 1846×852 space as
 * `MapView.world` and `ambientFx`). Islands without a JSON file get nothing (zero overhead).
 *
 * Four layers, mounted strictly in their intended depth order inside `MapView.world`:
 *  1. Wind through the grass (`swayHost`, index 1: right above the map sprite, below video loops,
 *     ambientFx, plots and units): one fullscreen quad Mesh re-sampling the active map texture
 *     with `swayMask × amplitude × (base breeze + travelling gusts)`. Strictly 0 on roads, plots,
 *     gates, castle, ruins, stone paving, and cliff edges.
 *  2. Butterflies (`butterflyHost`, right below `WorldLayers.plots`): small pale meadow butterflies
 *     fluttering around flower patches off the road (high quality only).
 *  3. Drifting cloud shadows + high-flying bird flocks (`skyHost`, right below `WorldLayers.bars`,
 *     strictly above towers/enemies/flyers and strictly below HP bars and HUD/DOM UI).
 *
 * Performance:
 *  - At most 1 extra full-map quad draw for grass sway; all cloud/bird/butterfly textures live in
 *    one shared refcounted 512×256 procedural atlas canvas (zero external art except the sway mask).
 *  - Every sprite, uniform group, and bird/cloud/butterfly record is pre-allocated; `update()` does
 *    zero heap allocations per frame.
 *  - Respects quality tier (`low` → off; `med` → wind + fewer clouds + smaller flocks, no
 *    butterflies), Settings → Reduced motion, game pause, `document.hidden`, texture bake swaps
 *    (`smallBake` / @1x / @1.5x / @2x / @3x), and clean teardown on destroy / pagehide.
 */

export const MAX_SWAY_STRENGTH_PX = 2.5;
export const MAX_WATER_STRENGTH_PX = 1.5;
export const MAX_WATER_REGIONS = 6;
export const MAX_HAZE_STRENGTH_PX = 1.0;
export const MAX_CLOUDS = 4;
export const MAX_BIRDS = 7;
export const MAX_BUTTERFLIES = 12;
export const MAX_DUST_WISPS = 16;

export interface WindSwayConfig {
  /** Precomputed grayscale mask path relative to art baseUrl (e.g. "life/i17-sway.webp"). */
  readonly mask: string;
  /** Wind travel vector `[dx, dy]` (normalized internally). */
  readonly dir: readonly [number, number];
  /** Max UV sway amplitude in layout px (clamped to <= 2.5). */
  readonly strength: number;
  /** Seconds between major travelling wind gusts (e.g. 5.5). */
  readonly gustPeriod: number;
  /** Travelling gust front speed in layout px/s (default 210). */
  readonly gustSpeed?: number;
  /** Slow base breeze angular frequency in rad/s (default 1.3). */
  readonly breezeFreq?: number;
  /** Subtle sunlit shimmer during gusts (0..0.06, default 0.035). */
  readonly sheen?: number;
}

export interface WaterFlowRegion {
  /** Region bounds `[x, y, w, h]` in layout px (1846×852 space). */
  readonly rect: readonly [number, number, number, number];
  /** Local flow direction `[dx, dy]` (normalized internally; `[0, 0]` = still water). */
  readonly dir: readonly [number, number];
  /** Local flow speed multiplier relative to `water.flowSpeed` (default 1.0; 0 = still). */
  readonly speedMul?: number;
  /** Local specular glint multiplier (default 1.0; e.g. 1.35 on weir/chute). */
  readonly glintMul?: number;
}

export interface WaterConfig {
  /** Precomputed grayscale mask path relative to art baseUrl (e.g. "life/i10-water.webp"). */
  readonly mask: string;
  /** Max UV ripple distortion in layout px (clamped to <= 1.5). */
  readonly strength: number;
  /** Default flow direction `[dx, dy]` (`[0, 0]` for still ponds). */
  readonly dir?: readonly [number, number];
  /** Base flow speed (0 for still ponds; ~1.1–2.0 for flowing streams). */
  readonly flowSpeed: number;
  /** Spatial frequency scale for ripples (default 1.0). */
  readonly rippleScale?: number;
  /** Soft palette-matched specular glint tint hex (warm daylight / cool moonlight silver). */
  readonly glintColor: string;
  /** Specular glint intensity (clamped to 0..0.24; subtle, never white flashes). */
  readonly glintStrength: number;
  /** Specular glint temporal speed multiplier (default 1.0). */
  readonly glintSpeed?: number;
  /** Optional per-region flow vectors (up to 6 regions, smoothly blended in UV space). */
  readonly regions?: readonly WaterFlowRegion[];
}

export interface HeatHazeConfig {
  /** Precomputed grayscale open-sand mask path relative to art baseUrl (e.g. "life/i14-haze.webp"). */
  readonly mask: string;
  /** Max UV shimmer amplitude in layout px (clamped to <= 1.0). */
  readonly strength: number;
  /** Convection / wind drift vector `[dx, dy]` (normalized internally). */
  readonly dir?: readonly [number, number];
  /** Shimmer wave angular speed in rad/s (default 1.45). */
  readonly speed?: number;
  /** Very subtle warm air shimmer tint (clamped to 0..0.025, default 0.01). */
  readonly warmth?: number;
}

export interface DustWispConfig {
  /** Airborne dust wisp count on high quality (clamped to 1..16). */
  readonly count: number;
  /** Wind travel vector `[dx, dy]` (normalized internally). */
  readonly dir: readonly [number, number];
  /** Drift speed in layout px/s (e.g. 38–64). */
  readonly speed: number;
  /** Peak wisp opacity (clamped to 0.02..0.18, soft and calm). */
  readonly alpha: number;
  /** Pale warm sand tint hex (default "#ebd0a7"). */
  readonly tint?: string;
  /** Secondary pale dust tint hex (default "#f5e3c6"). */
  readonly tint2?: string;
  /** Wisp length `[min, max]` in layout px (default [200, 380]). */
  readonly sizeRange?: readonly [number, number];
  /** Optional layout-px corridor rects `[x, y, w, h]` to bias wisp drift lanes. */
  readonly bands?: readonly (readonly [number, number, number, number])[];
}

export interface CloudShadowConfig {
  /** Cloud shadow count on high quality (2..4). */
  readonly count: number;
  /** Shadow opacity (0.06..0.16, typical 0.08..0.14). */
  readonly alpha: number;
  /** Drift speed in layout px/s along the wind direction. */
  readonly speed: number;
  /** Cool shadow tint hex (default "#1b2e4c"). */
  readonly tint?: string;
  /** Cloud shadow diameter `[min, max]` in layout px (default [500, 800]). */
  readonly sizeRange?: readonly [number, number];
}

export interface BirdFlockConfig {
  /** Flock size `[min, max]` (clamped to 1..7, typical [3, 7]). */
  readonly flockSize: readonly [number, number];
  /** Seconds between passing flocks `[min, max]` (typical [15, 40]). */
  readonly interval: readonly [number, number];
  /** Initial delay before first flock in seconds (default 4). */
  readonly initialDelay?: number;
  /** Flight speed in layout px/s (default 95). */
  readonly speed?: number;
  /** Warm dark bird tint hex (default "#473528"). */
  readonly tint?: string;
  /** Bird wingspan in layout px (default 16). */
  readonly scale?: number;
  /** Ground shadow offset `[dx, dy]` in layout px (default [30, 46]). */
  readonly shadowOffset?: readonly [number, number];
  /** Ground shadow alpha (default 0.15). */
  readonly shadowAlpha?: number;
}

export interface ButterflyZone {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface ButterflyConfig {
  /** Butterfly count on high quality. */
  readonly count: number;
  /** Hex palette (pale yellow/white/orange). */
  readonly colors: readonly string[];
  /** Wingspan in layout px (default 10). */
  readonly size?: number;
  /** Flower-patch loiter zones off the road and plots. */
  readonly zones: readonly ButterflyZone[];
}

export interface MapLifeConfig {
  readonly island: string;
  readonly wind?: WindSwayConfig;
  readonly water?: WaterConfig;
  readonly heatHaze?: HeatHazeConfig;
  readonly dust?: DustWispConfig;
  readonly clouds?: CloudShadowConfig;
  readonly birds?: BirdFlockConfig;
  readonly butterflies?: ButterflyConfig;
}

export interface MapLifeStats {
  readonly island: string;
  readonly built: boolean;
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly smallBake: boolean;
  readonly tier: QualityTier;
  readonly time: number;
  readonly swayReady: boolean;
  readonly waterReady: boolean;
  readonly hazeReady: boolean;
  readonly activeClouds: number;
  readonly activeBirds: number;
  readonly activeButterflies: number;
  readonly activeDust: number;
  readonly flocksSpawned: number;
}

export interface MapLifeController {
  update(enabled: boolean, paused: boolean, smallBake: boolean, dtSec?: number, tier?: QualityTier): void;
  /** QA: advance map life deterministically when ticker is frozen. */
  step(dtSec: number, tier?: QualityTier): void;
  /** QA: inspect runtime state. */
  debug(): MapLifeStats;
  /** Explicitly tear down all GPU resources and listeners. */
  destroy(): void;
}

// Eagerly bundle per-island map-life configs (same glob pattern as ambientFx.ts / mapAnimLayer.ts).
const configs = import.meta.glob<MapLifeConfig>('../data/mapLife/*.json', { eager: true, import: 'default' });

export function getMapLifeConfig(island: string): MapLifeConfig | undefined {
  return configs[`../data/mapLife/${island}.json`];
}

export function listMapLifeConfigs(): readonly MapLifeConfig[] {
  return Object.values(configs);
}

// --- Pure helpers (unit-tested) ------------------------------------------------------------------

/** Normalizes a 2D wind direction vector, falling back to `[1, 0]`. */
export function normalizeDir(dir: readonly [number, number] | undefined): readonly [number, number] {
  if (!dir) return [1, 0];
  const len = Math.hypot(dir[0], dir[1]);
  if (!Number.isFinite(len) || len <= 1e-5) return [1, 0];
  return [dir[0] / len, dir[1] / len];
}

/** Clamped wind sway strength in layout px (never exceeds `MAX_SWAY_STRENGTH_PX`). */
export function clampedSwayStrength(strength: number | undefined): number {
  if (!Number.isFinite(strength)) return 0;
  return Math.max(0, Math.min(MAX_SWAY_STRENGTH_PX, strength ?? 0));
}

/** Clamped water ripple strength in layout px (never exceeds `MAX_WATER_STRENGTH_PX`). */
export function clampedWaterStrength(strength: number | undefined): number {
  if (!Number.isFinite(strength)) return 0;
  return Math.max(0, Math.min(MAX_WATER_STRENGTH_PX, strength ?? 0));
}

/** Clamped sand heat-haze strength in layout px (never exceeds `MAX_HAZE_STRENGTH_PX`). */
export function clampedHazeStrength(strength: number | undefined): number {
  if (!Number.isFinite(strength)) return 0;
  return Math.max(0, Math.min(MAX_HAZE_STRENGTH_PX, strength ?? 0));
}

/** Effective drifting dust wisp count by quality tier (`low` → 0, `med` → fewer, `high` → full). */
export function effectiveDustCount(configCount: number | undefined, tier: QualityTier): number {
  if (tier === 'low' || !configCount || configCount <= 0) return 0;
  const clamped = Math.max(0, Math.min(MAX_DUST_WISPS, Math.round(configCount)));
  if (tier === 'med') return clamped <= 2 ? clamped : Math.max(2, Math.round(clamped * 0.55));
  return clamped;
}

/**
 * Packs up to `MAX_WATER_REGIONS` layout-px flow regions into flat uniform arrays:
 *  - `rects`: `[u0, v0, u1, v1]` in normalized UV space
 *  - `vecs`:  `[dx, dy, speedMul, glintMul]` (`[0, 0]` preserved for still regions)
 */
export function packWaterRegions(
  regions: readonly WaterFlowRegion[] | undefined,
  mapWidth: number,
  mapHeight: number,
): { count: number; rects: Float32Array; vecs: Float32Array } {
  const rects = new Float32Array(MAX_WATER_REGIONS * 4);
  const vecs = new Float32Array(MAX_WATER_REGIONS * 4);
  if (!regions || regions.length === 0) return { count: 0, rects, vecs };
  const invW = 1 / Math.max(1, mapWidth);
  const invH = 1 / Math.max(1, mapHeight);
  const count = Math.min(MAX_WATER_REGIONS, regions.length);
  for (let i = 0; i < count; i++) {
    const r = regions[i];
    const [x, y, w, h] = r.rect;
    const base = i * 4;
    rects[base] = x * invW;
    rects[base + 1] = y * invH;
    rects[base + 2] = (x + w) * invW;
    rects[base + 3] = (y + h) * invH;

    const len = Math.hypot(r.dir[0], r.dir[1]);
    if (Number.isFinite(len) && len > 1e-5) {
      vecs[base] = r.dir[0] / len;
      vecs[base + 1] = r.dir[1] / len;
    } else {
      vecs[base] = 0;
      vecs[base + 1] = 0;
    }
    vecs[base + 2] = Math.max(0, Math.min(3, r.speedMul ?? 1));
    vecs[base + 3] = Math.max(0, Math.min(2.5, r.glintMul ?? 1));
  }
  return { count, rects, vecs };
}

/** Effective drifting cloud count by quality tier (`low` → 0, `med` → fewer, `high` → full). */
export function effectiveCloudCount(configCount: number | undefined, tier: QualityTier): number {
  if (tier === 'low' || !configCount || configCount <= 0) return 0;
  const clamped = Math.max(0, Math.min(MAX_CLOUDS, Math.round(configCount)));
  if (tier === 'med') return Math.max(1, Math.min(2, clamped - 1));
  return clamped;
}

/** Effective max flock size for birds by quality tier (`low` → 0, `med` → smaller, `high` → full). */
export function effectiveBirdCap(range: readonly [number, number] | undefined, tier: QualityTier): number {
  if (tier === 'low' || !range) return 0;
  const hi = Math.max(1, Math.min(MAX_BIRDS, Math.round(Math.max(range[0], range[1]))));
  if (tier === 'med') return Math.max(2, Math.min(4, hi - 1));
  return hi;
}

/** Effective butterfly count by quality tier (`low` / `med` → 0, `high` → full). */
export function effectiveButterflyCount(configCount: number | undefined, tier: QualityTier): number {
  if (tier !== 'high' || !configCount || configCount <= 0) return 0;
  return Math.max(0, Math.min(MAX_BUTTERFLIES, Math.round(configCount)));
}

/** Wraps a coordinate into `[min, max)` smoothly without jumps. */
export function wrapCoord(v: number, min: number, max: number): number {
  const span = max - min;
  if (span <= 0) return min;
  const r = (v - min) % span;
  return r < 0 ? r + span + min : r + min;
}

// --- Shared refcounted 512×256 procedural atlas (clouds, birds, butterflies) ---------------------

interface MapLifeAtlas {
  readonly source: ImageSource;
  readonly clouds: readonly [Texture, Texture, Texture];
  readonly birds: readonly [Texture, Texture, Texture, Texture];
  readonly birdShadow: Texture;
  readonly butterfly: Texture;
  readonly dustWisps: readonly [Texture, Texture];
}

let cachedAtlas: MapLifeAtlas | null = null;
let atlasRefs = 0;

/** QA / tests: number of live built MapLifeLayer instances holding the shared procedural atlas. */
export function mapLifeAtlasRefCount(): number {
  return atlasRefs;
}

function acquireMapLifeAtlas(): MapLifeAtlas | null {
  const atlas = createMapLifeAtlas();
  if (!atlas) return null;
  atlasRefs++;
  return atlas;
}

function releaseMapLifeAtlas(atlas: MapLifeAtlas | null): void {
  if (!atlas) return;
  atlasRefs = Math.max(0, atlasRefs - 1);
  if (atlasRefs === 0 && cachedAtlas === atlas) {
    cachedAtlas = null;
    const textures = [...atlas.clouds, ...atlas.birds, atlas.birdShadow, atlas.butterfly, ...atlas.dustWisps];
    for (const tex of textures) {
      if (!tex.destroyed) tex.destroy(false);
    }
    if (!atlas.source.destroyed) atlas.source.destroy();
  }
}

function drawCloudBlob(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  lobes: readonly (readonly [number, number, number, number, number])[],
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox + 1, oy + 1, 126, 126);
  ctx.clip();
  for (const [cx, cy, rx, ry, a] of lobes) {
    ctx.save();
    ctx.translate(ox + cx, oy + cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, rx * 0.08, 0, 0, rx);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.45, `rgba(255,255,255,${a * 0.68})`);
    g.addColorStop(0.78, `rgba(255,255,255,${a * 0.22})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawBirdFrame(ctx: CanvasRenderingContext2D, ox: number, oy: number, wingLift: number, soft: boolean): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox + 1, oy + 1, 62, 62);
  ctx.clip();
  const cx = ox + 32;
  const cy = oy + 32;

  // Bird faces +X (right), so wings extend up/down along Y and sweep slightly back (-X).
  ctx.fillStyle = soft ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.96)';

  // Slender tapered body + forked tail pointing -X, head/beak pointing +X.
  ctx.beginPath();
  ctx.moveTo(cx + 12, cy);
  ctx.quadraticCurveTo(cx + 4, cy - 3.2, cx - 5, cy - 2.1);
  ctx.lineTo(cx - 14, cy - 4.0);
  ctx.lineTo(cx - 10, cy);
  ctx.lineTo(cx - 14, cy + 4.0);
  ctx.lineTo(cx - 5, cy + 2.1);
  ctx.quadraticCurveTo(cx + 4, cy + 3.2, cx + 12, cy);
  ctx.closePath();
  ctx.fill();

  // Curved swept storybook wings (wingLift in [-1..+1]: upstroke, glide, downstroke).
  const span = 25 - Math.abs(wingLift) * 5.5;
  const sweep = -6 - wingLift * 5.5;
  const bend = wingLift * 5.0;
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + 5, cy + side * 1.4);
    ctx.quadraticCurveTo(cx + 3 + bend * 0.4, cy + side * (span * 0.58), cx + sweep, cy + side * span);
    ctx.quadraticCurveTo(cx - 8 + bend * 0.3, cy + side * (span * 0.52), cx - 5, cy + side * 2.0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawButterfly(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox + 1, oy + 1, 62, 62);
  ctx.clip();
  const cx = ox + 32;
  const cy = oy + 32;

  // Paired forewings + hindwings (facing -Y/up in texture space; tinted by sprite.tint).
  for (const side of [-1, 1] as const) {
    // Forewing (larger upper lobe)
    const fg = ctx.createRadialGradient(cx + side * 11, cy - 7, 1, cx + side * 11, cy - 7, 18);
    fg.addColorStop(0, 'rgba(255,255,255,0.98)');
    fg.addColorStop(0.75, 'rgba(255,255,255,0.88)');
    fg.addColorStop(1, 'rgba(235,220,195,0.55)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(cx + side * 1.5, cy - 1);
    ctx.bezierCurveTo(cx + side * 12, cy - 24, cx + side * 27, cy - 17, cx + side * 22, cy - 2);
    ctx.quadraticCurveTo(cx + side * 12, cy + 3, cx + side * 1.5, cy + 1);
    ctx.closePath();
    ctx.fill();

    // Hindwing (smaller lower scalloped lobe)
    ctx.fillStyle = 'rgba(255,252,244,0.88)';
    ctx.beginPath();
    ctx.moveTo(cx + side * 1.5, cy + 2);
    ctx.bezierCurveTo(cx + side * 18, cy + 3, cx + side * 20, cy + 19, cx + side * 9, cy + 20);
    ctx.quadraticCurveTo(cx + side * 3, cy + 16, cx + side * 1.5, cy + 5);
    ctx.closePath();
    ctx.fill();
  }

  // Tiny warm dark thorax & head
  ctx.fillStyle = 'rgba(85,68,52,0.82)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 1, 2.2, 9.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawDustWisp(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  lobes: readonly (readonly [number, number, number, number, number])[],
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox + 1, oy + 1, 254, 62);
  ctx.clip();
  for (const [cx, cy, rx, ry, a] of lobes) {
    ctx.save();
    ctx.translate(ox + cx, oy + cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, rx * 0.05, 0, 0, rx);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.45, `rgba(255,255,255,${a * 0.58})`);
    g.addColorStop(0.8, `rgba(255,255,255,${a * 0.16})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function createMapLifeAtlas(): MapLifeAtlas | null {
  if (cachedAtlas && !cachedAtlas.source.destroyed) return cachedAtlas;
  cachedAtlas = null;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  // Row 0 (y=0..128): three distinct organic multi-lobe cloud shadow shapes (128×128 each).
  drawCloudBlob(ctx, 0, 0, [
    [60, 66, 44, 30, 0.88],
    [38, 60, 30, 22, 0.68],
    [84, 58, 32, 24, 0.72],
    [56, 46, 28, 22, 0.64],
    [74, 78, 28, 19, 0.56],
    [42, 76, 22, 16, 0.48],
  ]);
  drawCloudBlob(ctx, 128, 0, [
    [64, 62, 46, 28, 0.86],
    [34, 68, 28, 20, 0.66],
    [92, 66, 28, 21, 0.64],
    [48, 48, 26, 20, 0.62],
    [82, 50, 25, 19, 0.58],
    [64, 80, 34, 18, 0.52],
  ]);
  drawCloudBlob(ctx, 256, 0, [
    [58, 64, 42, 32, 0.88],
    [84, 68, 34, 24, 0.74],
    [36, 56, 26, 22, 0.64],
    [70, 46, 30, 20, 0.6],
    [48, 82, 26, 18, 0.54],
  ]);

  // Row 1 (y=128..192): 4 bird flap frames + soft bird shadow + butterfly (64×64 each).
  drawBirdFrame(ctx, 0, 128, 0.95, false);
  drawBirdFrame(ctx, 64, 128, 0.25, false);
  drawBirdFrame(ctx, 128, 128, -0.35, false);
  drawBirdFrame(ctx, 192, 128, -0.95, false);
  drawBirdFrame(ctx, 256, 128, 0.15, true);
  drawButterfly(ctx, 320, 128);

  // Row 2 (y=192..256): two distinct soft elongated windblown desert dust wisps (256×64 each).
  drawDustWisp(ctx, 0, 192, [
    [58, 34, 44, 13, 0.44],
    [96, 29, 54, 16, 0.64],
    [136, 31, 60, 17, 0.72],
    [176, 35, 50, 14, 0.54],
    [208, 33, 36, 10, 0.34],
    [122, 24, 46, 10, 0.32],
    [154, 40, 42, 10, 0.28],
  ]);
  drawDustWisp(ctx, 256, 192, [
    [50, 31, 38, 11, 0.38],
    [88, 36, 56, 15, 0.62],
    [132, 30, 58, 16, 0.70],
    [172, 28, 52, 14, 0.56],
    [206, 34, 38, 11, 0.34],
    [114, 40, 44, 10, 0.26],
    [160, 23, 40, 9, 0.30],
  ]);

  const source = new ImageSource({ resource: c });
  const sub = (x: number, y: number, w: number, h: number): Texture =>
    new Texture({ source, frame: new Rectangle(x, y, w, h) });

  cachedAtlas = {
    source,
    clouds: [sub(0, 0, 128, 128), sub(128, 0, 128, 128), sub(256, 0, 128, 128)],
    birds: [sub(0, 128, 64, 64), sub(64, 128, 64, 64), sub(128, 128, 64, 64), sub(192, 128, 64, 64)],
    birdShadow: sub(256, 128, 64, 64),
    butterfly: sub(320, 128, 64, 64),
    dustWisps: [sub(0, 192, 256, 64), sub(256, 192, 256, 64)],
  };
  return cachedAtlas;
}

// --- Wind sway Mesh shader (single fullscreen quad over map layout space) ------------------------

const SWAY_VERTEX = `
  in vec2 aPosition;
  in vec2 aUV;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
  out vec2 vUV;
  void main() {
    vUV = aUV;
    vec3 p = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0);
    gl_Position = vec4(p.xy, 0.0, 1.0);
  }
`;

const SWAY_FRAGMENT = `
  in vec2 vUV;
  uniform sampler2D uMap;
  uniform sampler2D uMask;
  uniform float uTime;
  uniform vec2 uDir;
  uniform vec2 uAmpUV;
  uniform vec4 uGustParams;
  uniform vec2 uAspect;
  out vec4 finalColor;

  void main() {
    float m = texture(uMask, vUV).r;
    if (m < 0.004) discard;

    float gustFreq = uGustParams.x;
    float gustSpeed = uGustParams.y;
    float breezeFreq = uGustParams.z;
    float sheenAmt = uGustParams.w;

    vec2 p = vUV * uAspect;
    vec2 perp = vec2(-uDir.y, uDir.x);
    float along = dot(p, uDir);
    float across = dot(p, perp);

    // Slow calm base breeze with organic cross-wind phase curvature.
    float w1 = sin(along * 16.0 - uTime * breezeFreq + sin(across * 7.5 + uTime * 0.42) * 1.35);
    float w2 = sin(along * 31.0 + across * 13.0 - uTime * (breezeFreq * 1.62)) * 0.42;
    float base = (w1 * 0.68 + w2 * 0.32) * 0.38;

    // Sweeping wind gusts travelling across the island every gustPeriod seconds.
    float bend = sin(across * 3.6 + uTime * 0.28) * 0.42 + sin(across * 7.9 - uTime * 0.21) * 0.16;
    float gustPhase = along * 2.8 - uTime * gustSpeed + bend;
    float g1 = pow(0.5 + 0.5 * sin(gustPhase), 2.8);
    float g2 = pow(0.5 + 0.5 * sin(gustPhase * 1.43 + 2.25 + across * 1.4), 3.6) * 0.52;
    // Gentle long-period envelope so gusts breathe naturally instead of pulsing metronomically.
    float envelope = 0.72 + 0.28 * sin(uTime * gustFreq + along * 0.9);
    float gust = clamp((g1 + g2) * envelope, 0.0, 1.0);

    float ripple = sin(along * 25.0 - uTime * 3.1 + across * 10.5);
    float dispAlong = clamp(base + gust * (0.64 + 0.36 * ripple), -1.0, 1.0) * m;
    float dispCross = clamp(sin(along * 20.0 - uTime * 1.85 + across * 14.0) * (0.16 + 0.22 * gust), -0.45, 0.45) * m;

    vec2 offset = (uDir * dispAlong + perp * dispCross) * uAmpUV;
    vec2 sampleUV = clamp(vUV - offset, vec2(0.001), vec2(0.999));
    vec3 col = texture(uMap, sampleUV).rgb;

    // Subtle sunlit ripple sheen on grass blades bending into a passing gust.
    float shimmer = gust * m * sheenAmt * (0.65 + 0.35 * sin(along * 15.0 - uTime * 2.3 + across * 5.5));
    col = min(vec3(1.0), col + vec3(0.96, 1.0, 0.58) * shimmer);

    float edge = smoothstep(0.004, 0.06, m);
    finalColor = vec4(col * edge, edge);
  }
`;

const SURFACE_WATER_FRAGMENT = `
  in vec2 vUV;
  uniform sampler2D uMap;
  uniform sampler2D uMask;
  uniform sampler2D uWaterMask;
  uniform float uTime;
  uniform vec2 uDir;
  uniform vec2 uAmpUV;
  uniform vec4 uGustParams;
  uniform vec2 uAspect;
  uniform vec2 uWaterDir;
  uniform vec2 uWaterAmpUV;
  uniform vec4 uWaterParams;
  uniform vec4 uGlintColor;
  uniform vec4 uFlags;
  uniform vec4 uFlowRects[6];
  uniform vec4 uFlowVecs[6];
  out vec4 finalColor;

  void main() {
    float ms = uFlags.x > 0.5 ? texture(uMask, vUV).r : 0.0;
    float mw = uFlags.y > 0.5 ? texture(uWaterMask, vUV).r : 0.0;
    if (ms < 0.004 && mw < 0.004) discard;

    vec2 p = vUV * uAspect;
    vec2 totalOffset = vec2(0.0);
    float swayShimmer = 0.0;

    if (ms >= 0.004) {
      float gustFreq = uGustParams.x;
      float gustSpeed = uGustParams.y;
      float breezeFreq = uGustParams.z;
      float sheenAmt = uGustParams.w;

      vec2 perp = vec2(-uDir.y, uDir.x);
      float along = dot(p, uDir);
      float across = dot(p, perp);

      float w1 = sin(along * 16.0 - uTime * breezeFreq + sin(across * 7.5 + uTime * 0.42) * 1.35);
      float w2 = sin(along * 31.0 + across * 13.0 - uTime * (breezeFreq * 1.62)) * 0.42;
      float base = (w1 * 0.68 + w2 * 0.32) * 0.38;

      float bend = sin(across * 3.6 + uTime * 0.28) * 0.42 + sin(across * 7.9 - uTime * 0.21) * 0.16;
      float gustPhase = along * 2.8 - uTime * gustSpeed + bend;
      float g1 = pow(0.5 + 0.5 * sin(gustPhase), 2.8);
      float g2 = pow(0.5 + 0.5 * sin(gustPhase * 1.43 + 2.25 + across * 1.4), 3.6) * 0.52;
      float envelope = 0.72 + 0.28 * sin(uTime * gustFreq + along * 0.9);
      float gust = clamp((g1 + g2) * envelope, 0.0, 1.0);

      float ripple = sin(along * 25.0 - uTime * 3.1 + across * 10.5);
      float dispAlong = clamp(base + gust * (0.64 + 0.36 * ripple), -1.0, 1.0) * ms;
      float dispCross = clamp(sin(along * 20.0 - uTime * 1.85 + across * 14.0) * (0.16 + 0.22 * gust), -0.45, 0.45) * ms;

      totalOffset += (uDir * dispAlong + perp * dispCross) * uAmpUV;
      swayShimmer = gust * ms * sheenAmt * (0.65 + 0.35 * sin(along * 15.0 - uTime * 2.3 + across * 5.5));
    }

    float waterGlint = 0.0;
    float isStillPond = 0.0;

    if (mw >= 0.004) {
      vec2 fDir = uWaterDir;
      float fSpd = uWaterParams.x;
      float fGlint = 1.0;

      float wSum = 0.0;
      vec2 accDir = vec2(0.0);
      float accSpd = 0.0;
      float accGlint = 0.0;
      int rCount = int(uFlags.z + 0.5);
      for (int i = 0; i < 6; i++) {
        if (i >= rCount) break;
        vec4 rc = uFlowRects[i];
        float bx = smoothstep(rc.x - 0.024, rc.x + 0.024, vUV.x) * (1.0 - smoothstep(rc.z - 0.024, rc.z + 0.024, vUV.x));
        float by = smoothstep(rc.y - 0.024, rc.y + 0.024, vUV.y) * (1.0 - smoothstep(rc.w - 0.024, rc.w + 0.024, vUV.y));
        float bw = bx * by;
        if (bw > 0.001) {
          vec4 fv = uFlowVecs[i];
          accDir += fv.xy * bw;
          accSpd += (uWaterParams.x * fv.z) * bw;
          accGlint += fv.w * bw;
          wSum += bw;
        }
      }
      if (wSum > 0.001) {
        float invW = 1.0 / wSum;
        float blend = min(1.0, wSum);
        fDir = mix(fDir, accDir * invW, blend);
        fSpd = mix(fSpd, accSpd * invW, blend);
        fGlint = mix(1.0, accGlint * invW, blend);
      }

      float dirLen = length(fDir);
      float flowing = step(0.05, fSpd) * step(0.05, dirLen);
      float rScale = uWaterParams.y;
      float gSpd = uWaterParams.z;
      float detail = uWaterParams.w;

      if (flowing > 0.5) {
        vec2 wDir = fDir / dirLen;
        vec2 wPerp = vec2(-wDir.y, wDir.x);
        float along = dot(p, wDir) * rScale;
        float across = dot(p, wPerp) * rScale;
        float tF = uTime * fSpd;

        float wA = sin(along * 40.0 - tF * 2.5 + sin(across * 28.0 + uTime * 0.65) * 1.15);
        float wB = detail > 0.7 ? sin(along * 70.0 + across * 38.0 - tF * 3.6) * 0.50 : 0.0;
        float wC = sin(along * 22.0 - across * 24.0 - tF * 1.55) * 0.45;

        float dAlong = clamp(wA * 0.48 + wC * 0.38, -1.0, 1.0) * 0.65 * mw;
        float dAcross = clamp(wA * 0.58 + wB * 0.46, -1.0, 1.0) * 0.98 * mw;
        totalOffset += (wDir * dAlong + wPerp * dAcross) * uWaterAmpUV;

        float c1 = 0.5 + 0.5 * sin(along * 46.0 - tF * 2.75 + sin(across * 26.0 - uTime * 0.55) * 1.45);
        float c2 = 0.5 + 0.5 * sin(along * 28.0 + across * 42.0 - tF * 1.85);
        float env = 0.52 + 0.48 * sin(along * 10.5 - uTime * (0.95 * gSpd) + across * 8.5);
        float crest = smoothstep(0.46, 0.96, c1 * 0.62 + c2 * 0.38);
        float waveShade = (c1 - 0.5) * 0.08;
        waterGlint = (crest * crest * env * uGlintColor.a * fGlint + waveShade) * mw * (0.72 + 0.28 * detail);
      } else {
        isStillPond = 1.0;
        float px = p.x * rScale;
        float py = p.y * rScale;
        float tS = uTime * gSpd;

        float rx = sin(py * 54.0 + tS * 1.18 + sin(px * 20.0 - tS * 0.48) * 1.35) * 0.68;
        rx += detail > 0.7 ? sin(py * 88.0 - px * 28.0 - tS * 1.55) * 0.36 : 0.0;
        float ry = sin(px * 40.0 + py * 26.0 + tS * 0.85) * 0.32;
        totalOffset += vec2(rx * 0.98, ry * 0.40) * uWaterAmpUV * mw;

        float m1 = 0.5 + 0.5 * sin(py * 68.0 - tS * 1.02 + sin(px * 18.0 + tS * 0.38) * 1.55);
        float m2 = 0.5 + 0.5 * sin(px * 22.0 + py * 34.0 + tS * 0.74);
        float env = 0.54 + 0.46 * sin(px * 8.5 - py * 11.5 + tS * 0.58);
        float crest = smoothstep(0.44, 0.96, m1 * 0.64 + m2 * 0.36);
        float waveShade = (m1 - 0.5) * 0.068;
        waterGlint = (crest * crest * env * uGlintColor.a * fGlint + waveShade) * mw * (0.72 + 0.28 * detail);
      }
    }

    vec2 sampleUV = clamp(vUV - totalOffset, vec2(0.001), vec2(0.999));
    vec3 col = texture(uMap, sampleUV).rgb;

    if (swayShimmer > 0.0001) {
      col = min(vec3(1.0), col + vec3(0.96, 1.0, 0.58) * swayShimmer);
    }
    if (mw >= 0.004) {
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      float lumaMod = mix(0.84 + 0.16 * luma, 0.66 + 0.34 * luma, isStillPond);
      vec3 glintDelta = uGlintColor.rgb * (waterGlint * lumaMod);
      col = clamp(col + glintDelta * (1.0 - col * 0.36), vec3(0.0), vec3(0.94));
    }

    float edge = smoothstep(0.004, 0.06, max(ms, mw));
    finalColor = vec4(col * edge, edge);
  }
`;

const SURFACE_HAZE_FRAGMENT = `
  in vec2 vUV;
  uniform sampler2D uMap;
  uniform sampler2D uMask;
  uniform float uTime;
  uniform vec2 uDir;
  uniform vec2 uAmpUV;
  uniform vec4 uHazeParams;
  uniform vec2 uAspect;
  out vec4 finalColor;

  void main() {
    float m = texture(uMask, vUV).r;
    if (m < 0.004) discard;

    float speed = uHazeParams.x;
    float warmth = uHazeParams.y;
    float detail = uHazeParams.z;

    vec2 p = vUV * uAspect;
    vec2 perp = vec2(-uDir.y, uDir.x);
    float along = dot(p, uDir);
    float across = dot(p, perp);

    float w1 = sin(along * 26.0 - uTime * speed + sin(across * 14.0 + uTime * 0.48) * 1.15);
    float w2 = detail > 0.7 ? sin(along * 48.0 + across * 22.0 - uTime * (speed * 1.45)) * 0.42 : 0.0;
    float env = 0.62 + 0.38 * sin(across * 5.2 - uTime * 0.34 + along * 3.1);

    float dPerp = clamp((w1 * 0.68 + w2 * 0.32) * env, -1.0, 1.0) * m * (0.65 + 0.35 * detail);
    float dAlong = clamp(sin(along * 18.0 - uTime * (speed * 0.8) + across * 16.0) * 0.35 * env, -0.4, 0.4) * m;

    vec2 offset = (perp * dPerp + uDir * dAlong) * uAmpUV;
    vec2 sampleUV = clamp(vUV - offset, vec2(0.001), vec2(0.999));
    vec3 col = texture(uMap, sampleUV).rgb;

    float glow = (0.5 + 0.5 * w1) * env * m * warmth;
    col = min(vec3(1.0), col + vec3(1.0, 0.86, 0.62) * glow);

    float edge = smoothstep(0.004, 0.08, m);
    finalColor = vec4(col * edge, edge);
  }
`;

function createDummyBlackSource(): ImageSource | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 2;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 2, 2);
  }
  return new ImageSource({ resource: c });
}

class SurfacePass {
  private readonly host: Container;
  private readonly width: number;
  private readonly height: number;
  private readonly wind: WindSwayConfig | null;
  private readonly water: WaterConfig | null;
  private readonly heatHaze: HeatHazeConfig | null;
  private readonly swayImage: HTMLImageElement | null;
  private readonly waterImage: HTMLImageElement | null;
  private readonly hazeImage: HTMLImageElement | null;
  private swayMaskSource: ImageSource | null = null;
  private waterMaskSource: ImageSource | null = null;
  private hazeMaskSource: ImageSource | null = null;
  private dummySource: ImageSource | null = null;
  private uniforms: UniformGroup | null = null;
  private mesh: Mesh<MeshGeometry, Shader> | null = null;
  private lastMapSource: TextureSource | null = null;
  private time = 0;
  private detail = 1.0;
  private swayLoaded = false;
  private waterLoaded = false;
  private hazeLoaded = false;
  private swayFailed = false;
  private waterFailed = false;
  private destroyed = false;

  constructor(
    host: Container,
    width: number,
    height: number,
    wind: WindSwayConfig | null,
    water: WaterConfig | null,
    heatHaze: HeatHazeConfig | null,
    base: string,
    mapSource: TextureSource | null,
  ) {
    this.host = host;
    this.width = width;
    this.height = height;
    this.wind = wind;
    this.water = water;
    this.heatHaze = heatHaze;
    this.lastMapSource = mapSource;

    if (typeof Image === 'undefined') {
      this.swayImage = null;
      this.waterImage = null;
      this.hazeImage = null;
      return;
    }

    if (wind) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = this.onSwayReady;
      img.onerror = this.onSwayError;
      img.src = base + wind.mask;
      this.swayImage = img;
    } else {
      this.swayImage = null;
    }

    if (water) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = this.onWaterReady;
      img.onerror = this.onWaterError;
      img.src = base + water.mask;
      this.waterImage = img;
    } else {
      this.waterImage = null;
    }

    if (heatHaze && !wind && !water) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = this.onHazeReady;
      img.onerror = this.onHazeError;
      img.src = base + heatHaze.mask;
      this.hazeImage = img;
    } else {
      this.hazeImage = null;
    }

    if (this.swayImage?.complete && this.swayImage.naturalWidth > 0) this.onSwayReady();
    if (this.waterImage?.complete && this.waterImage.naturalWidth > 0) this.onWaterReady();
    if (this.hazeImage?.complete && this.hazeImage.naturalWidth > 0) this.onHazeReady();
  }

  get swayReady(): boolean {
    return this.mesh !== null && !this.destroyed && this.swayLoaded;
  }

  get waterReady(): boolean {
    return this.mesh !== null && !this.destroyed && this.waterLoaded;
  }

  get hazeReady(): boolean {
    return this.mesh !== null && !this.destroyed && this.hazeLoaded;
  }

  private onSwayError = (): void => {
    this.swayLoaded = false;
    this.swayFailed = true;
    this.ensureMesh();
  };

  private onWaterError = (): void => {
    this.waterLoaded = false;
    this.waterFailed = true;
    this.ensureMesh();
  };

  private onHazeError = (): void => {
    this.hazeLoaded = false;
  };

  private onSwayReady = (): void => {
    if (this.destroyed || !this.swayImage || !this.swayImage.naturalWidth) return;
    if (!this.swayMaskSource) {
      this.swayMaskSource = new ImageSource({ resource: this.swayImage });
    }
    this.swayLoaded = true;
    this.ensureMesh();
    if (this.mesh?.shader) {
      this.mesh.shader.resources.uMask = this.swayMaskSource;
      if (this.uniforms && this.water) {
        (this.uniforms.uniforms.uFlags as Float32Array)[0] = 1;
        this.uniforms.update();
      }
    }
  };

  private onWaterReady = (): void => {
    if (this.destroyed || !this.waterImage || !this.waterImage.naturalWidth) return;
    if (!this.waterMaskSource) {
      this.waterMaskSource = new ImageSource({ resource: this.waterImage });
    }
    this.waterLoaded = true;
    this.ensureMesh();
    if (this.mesh?.shader) {
      this.mesh.shader.resources.uWaterMask = this.waterMaskSource;
      if (this.uniforms) {
        (this.uniforms.uniforms.uFlags as Float32Array)[1] = 1;
        this.uniforms.update();
      }
    }
  };

  private onHazeReady = (): void => {
    if (this.destroyed || !this.hazeImage || !this.hazeImage.naturalWidth) return;
    if (!this.hazeMaskSource) {
      this.hazeMaskSource = new ImageSource({ resource: this.hazeImage });
    }
    this.hazeLoaded = true;
    this.ensureMesh();
  };

  private ensureMesh(): void {
    if (this.destroyed || this.mesh || !this.lastMapSource || this.host.destroyed) return;

    const geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, this.width, 0, this.width, this.height, 0, this.height]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });

    let shader: Shader;
    if (this.water) {
      // Wait for all configured mask images (sway + water) to settle before creating the combined shader
      // so both sampler bindings and uFlags are final on frame 1 with zero hot-swap race.
      const swaySettled = !this.wind || this.swayLoaded || this.swayFailed;
      const waterSettled = this.waterLoaded || this.waterFailed;
      if (!swaySettled || !waterSettled || (!this.swayMaskSource && !this.waterMaskSource)) {
        geometry.destroy(true);
        return;
      }
      if (!this.swayMaskSource || !this.waterMaskSource) {
        this.dummySource ??= createDummyBlackSource();
      }
      const swayTex = this.swayMaskSource ?? this.dummySource ?? this.waterMaskSource!;
      const waterTex = this.waterMaskSource ?? this.dummySource ?? this.swayMaskSource!;

      const [dx, dy] = normalizeDir(this.wind?.dir);
      const strength = clampedSwayStrength(this.wind?.strength);
      const gustPeriod = Math.max(1.5, this.wind?.gustPeriod || 5.5);
      const gustFreq = (Math.PI * 2) / gustPeriod;
      const gustSpeed = ((this.wind?.gustSpeed ?? 210) / Math.max(1, this.width)) * 2.8 * (this.width / Math.max(1, this.height));
      const breezeFreq = this.wind?.breezeFreq ?? 1.3;
      const sheen = Math.max(0, Math.min(0.06, this.wind?.sheen ?? 0.035));

      const wDirRaw = this.water.dir;
      const wLen = wDirRaw ? Math.hypot(wDirRaw[0], wDirRaw[1]) : 0;
      const wdx = wDirRaw && wLen > 1e-5 ? wDirRaw[0] / wLen : 0;
      const wdy = wDirRaw && wLen > 1e-5 ? wDirRaw[1] / wLen : 0;
      const wStrength = clampedWaterStrength(this.water.strength);
      const flowSpeed = Math.max(0, Math.min(4, this.water.flowSpeed || 0));
      const rippleScale = Math.max(0.4, Math.min(2.5, this.water.rippleScale ?? 1.0));
      const glintSpeed = Math.max(0.2, Math.min(2.5, this.water.glintSpeed ?? 1.0));
      const glintHex = parseHexColor(this.water.glintColor, 0xeef6ff);
      const gr = ((glintHex >> 16) & 0xff) / 255;
      const gg = ((glintHex >> 8) & 0xff) / 255;
      const gb = (glintHex & 0xff) / 255;
      const glintStrength = Math.max(0, Math.min(0.24, this.water.glintStrength || 0));
      const packed = packWaterRegions(this.water.regions, this.width, this.height);

      this.uniforms = new UniformGroup({
        uTime: { value: this.time, type: 'f32' },
        uDir: { value: new Float32Array([dx, dy]), type: 'vec2<f32>' },
        uAmpUV: { value: new Float32Array([strength / this.width, strength / this.height]), type: 'vec2<f32>' },
        uGustParams: { value: new Float32Array([gustFreq, gustSpeed, breezeFreq, sheen]), type: 'vec4<f32>' },
        uAspect: { value: new Float32Array([this.width / Math.max(1, this.height), 1]), type: 'vec2<f32>' },
        uWaterDir: { value: new Float32Array([wdx, wdy]), type: 'vec2<f32>' },
        uWaterAmpUV: { value: new Float32Array([wStrength / this.width, wStrength / this.height]), type: 'vec2<f32>' },
        uWaterParams: { value: new Float32Array([flowSpeed, rippleScale, glintSpeed, this.detail]), type: 'vec4<f32>' },
        uGlintColor: { value: new Float32Array([gr, gg, gb, glintStrength]), type: 'vec4<f32>' },
        uFlags: {
          value: new Float32Array([this.swayLoaded && strength > 0 ? 1 : 0, this.waterLoaded ? 1 : 0, packed.count, 0]),
          type: 'vec4<f32>',
        },
        uFlowRects: { value: packed.rects, type: 'vec4<f32>', size: MAX_WATER_REGIONS },
        uFlowVecs: { value: packed.vecs, type: 'vec4<f32>', size: MAX_WATER_REGIONS },
      });

      shader = new Shader({
        glProgram: GlProgram.from({ vertex: SWAY_VERTEX, fragment: SURFACE_WATER_FRAGMENT, name: 'map-life-surface-water' }),
        resources: {
          uMap: this.lastMapSource,
          uMask: swayTex,
          uWaterMask: waterTex,
          surfaceUniforms: this.uniforms,
        },
      });
    } else if (this.heatHaze && !this.wind) {
      if (!this.hazeMaskSource) {
        geometry.destroy(true);
        return;
      }
      const [hdx, hdy] = normalizeDir(this.heatHaze.dir ?? [0.84, -0.54]);
      const hStrength = clampedHazeStrength(this.heatHaze.strength);
      const hSpeed = Math.max(0.3, Math.min(3.0, this.heatHaze.speed ?? 1.45));
      const hWarmth = Math.max(0, Math.min(0.025, this.heatHaze.warmth ?? 0.01));

      this.uniforms = new UniformGroup({
        uTime: { value: this.time, type: 'f32' },
        uDir: { value: new Float32Array([hdx, hdy]), type: 'vec2<f32>' },
        uAmpUV: { value: new Float32Array([hStrength / this.width, hStrength / this.height]), type: 'vec2<f32>' },
        uHazeParams: { value: new Float32Array([hSpeed, hWarmth, this.detail, 0]), type: 'vec4<f32>' },
        uAspect: { value: new Float32Array([this.width / Math.max(1, this.height), 1]), type: 'vec2<f32>' },
      });

      shader = new Shader({
        glProgram: GlProgram.from({ vertex: SWAY_VERTEX, fragment: SURFACE_HAZE_FRAGMENT, name: 'map-life-heat-haze' }),
        resources: {
          uMap: this.lastMapSource,
          uMask: this.hazeMaskSource,
          hazeUniforms: this.uniforms,
        },
      });
    } else if (this.wind && this.swayMaskSource) {
      const [dx, dy] = normalizeDir(this.wind.dir);
      const strength = clampedSwayStrength(this.wind.strength);
      const gustPeriod = Math.max(1.5, this.wind.gustPeriod || 5.5);
      const gustFreq = (Math.PI * 2) / gustPeriod;
      const gustSpeed = ((this.wind.gustSpeed ?? 210) / Math.max(1, this.width)) * 2.8 * (this.width / Math.max(1, this.height));
      const breezeFreq = this.wind.breezeFreq ?? 1.3;
      const sheen = Math.max(0, Math.min(0.06, this.wind.sheen ?? 0.035));

      this.uniforms = new UniformGroup({
        uTime: { value: this.time, type: 'f32' },
        uDir: { value: new Float32Array([dx, dy]), type: 'vec2<f32>' },
        uAmpUV: { value: new Float32Array([strength / this.width, strength / this.height]), type: 'vec2<f32>' },
        uGustParams: { value: new Float32Array([gustFreq, gustSpeed, breezeFreq, sheen]), type: 'vec4<f32>' },
        uAspect: { value: new Float32Array([this.width / Math.max(1, this.height), 1]), type: 'vec2<f32>' },
      });

      shader = new Shader({
        glProgram: GlProgram.from({ vertex: SWAY_VERTEX, fragment: SWAY_FRAGMENT, name: 'map-life-sway' }),
        resources: {
          uMap: this.lastMapSource,
          uMask: this.swayMaskSource,
          windUniforms: this.uniforms,
        },
      });
    } else {
      geometry.destroy(true);
      return;
    }

    const mesh = new Mesh({ geometry, shader });
    mesh.eventMode = 'none';
    this.mesh = mesh;
    this.host.addChild(mesh);
  }

  sync(time: number, mapSource: TextureSource | null, tier: QualityTier = 'high'): void {
    if (this.destroyed) return;
    this.time = time;
    this.detail = tier === 'med' ? 0.55 : 1.0;

    if (mapSource && mapSource !== this.lastMapSource) {
      this.lastMapSource = mapSource;
      if (this.mesh?.shader) {
        this.mesh.shader.resources.uMap = mapSource;
      } else {
        this.ensureMesh();
      }
    }
    if (this.uniforms) {
      this.uniforms.uniforms.uTime = time;
      if (this.water) {
        (this.uniforms.uniforms.uWaterParams as Float32Array)[3] = this.detail;
      } else if (this.heatHaze && !this.wind) {
        (this.uniforms.uniforms.uHazeParams as Float32Array)[2] = this.detail;
      }
      this.uniforms.update();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const img of [this.swayImage, this.waterImage, this.hazeImage]) {
      if (img) {
        img.onload = null;
        img.onerror = null;
      }
    }
    if (this.mesh) {
      const { geometry, shader } = this.mesh;
      if (!this.mesh.destroyed) this.mesh.destroy();
      geometry.destroy(true);
      shader?.destroy();
      this.mesh = null;
    }
    this.uniforms = null;
    for (const src of [this.swayMaskSource, this.waterMaskSource, this.hazeMaskSource, this.dummySource]) {
      if (src && !src.destroyed) src.destroy();
    }
    this.swayMaskSource = null;
    this.waterMaskSource = null;
    this.hazeMaskSource = null;
    this.dummySource = null;
    this.lastMapSource = null;
    this.swayLoaded = false;
    this.waterLoaded = false;
    this.hazeLoaded = false;
  }
}

// --- Runtime records (pre-allocated on build, zero allocations in step) --------------------------

interface CloudRuntime {
  readonly sprite: Sprite;
  x: number;
  y: number;
  readonly speedMul: number;
  readonly baseScaleX: number;
  readonly baseScaleY: number;
  readonly baseAlpha: number;
  readonly phase: number;
  readonly rot: number;
  readonly halfSpan: number;
}

interface BirdRuntime {
  readonly sprite: Sprite;
  readonly shadow: Sprite;
  active: boolean;
  offsetX: number;
  offsetY: number;
  flapPhase: number;
  flapRate: number;
  glideTimer: number;
  gliding: boolean;
  scale: number;
  swayPhase: number;
}

interface ButterflyRuntime {
  readonly sprite: Sprite;
  readonly shadow: Sprite;
  readonly homeX: number;
  readonly homeY: number;
  readonly radius: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  heading: number;
  speed: number;
  flapPhase: number;
  flapRate: number;
  restTimer: number;
  baseScale: number;
}

interface DustWispRuntime {
  readonly sprite: Sprite;
  x: number;
  y: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly speedMul: number;
  readonly baseScaleX: number;
  readonly baseScaleY: number;
  readonly baseAlpha: number;
  readonly phase: number;
  readonly rot: number;
  readonly swayAmp: number;
}

/**
 * Core procedural map-life runtime. Manages the single-pass surface shader (wind sway, water
 * ripples/glints, sand heat haze), drifting desert dust wisps, clouds, birds, and butterflies
 * across three depth-appropriate containers.
 */
export class MapLifeLayer {
  readonly swayRoot = new Container();
  readonly butterflyRoot = new Container();
  readonly skyRoot = new Container();

  private readonly dustLayer = new Container();
  private readonly cloudLayer = new Container();
  private readonly birdShadowLayer = new Container();
  private readonly birdLayer = new Container();

  private readonly config: MapLifeConfig;
  private readonly baseUrl: string;
  private readonly mapWidth: number;
  private readonly mapHeight: number;
  private readonly getMapSource: () => TextureSource | null;

  private readonly rng: { s: number };
  private readonly dirX: number;
  private readonly dirY: number;
  private readonly dustDirX: number;
  private readonly dustDirY: number;

  private atlas: MapLifeAtlas | null = null;
  private surfacePass: SurfacePass | null = null;
  private readonly clouds: CloudRuntime[] = [];
  private readonly birds: BirdRuntime[] = [];
  private readonly butterflies: ButterflyRuntime[] = [];
  private readonly dustWisps: DustWispRuntime[] = [];

  // Flock state (zero allocations)
  private flockActive = false;
  private flockX = 0;
  private flockY = 0;
  private flockVx = 0;
  private flockVy = 0;
  private flockHeading = 0;
  private flockCountdown = 4;
  private flocksSpawned = 0;
  private activeBirds = 0;
  private activeClouds = 0;
  private activeButterflies = 0;
  private activeDust = 0;

  private time = 0;
  private built = false;
  private enabled = false;
  private paused = false;
  private smallBake = false;
  private lastTier: QualityTier = 'high';
  private warmed = false;
  private destroyed = false;

  constructor(
    config: MapLifeConfig,
    baseUrl: string,
    getMapSource: () => TextureSource | null = () => null,
    mapWidth = LAYOUT_WIDTH,
    mapHeight = LAYOUT_HEIGHT,
  ) {
    this.config = config;
    this.baseUrl = baseUrl;
    this.getMapSource = getMapSource;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.rng = { s: hashSeed(`life:${config.island}`) };
    const [dx, dy] = normalizeDir(config.wind?.dir ?? config.dust?.dir);
    this.dirX = dx;
    this.dirY = dy;
    const [ddx, ddy] = normalizeDir(config.dust?.dir ?? config.wind?.dir);
    this.dustDirX = ddx;
    this.dustDirY = ddy;

    for (const c of [this.swayRoot, this.butterflyRoot, this.dustLayer, this.skyRoot, this.cloudLayer, this.birdShadowLayer, this.birdLayer]) {
      c.eventMode = 'none';
      c.interactiveChildren = false;
    }
    this.butterflyRoot.addChild(this.dustLayer);
    this.skyRoot.addChild(this.cloudLayer, this.birdShadowLayer, this.birdLayer);
    this.setAllVisible(false);
  }

  private setAllVisible(v: boolean): void {
    if (!this.swayRoot.destroyed) this.swayRoot.visible = v;
    if (!this.butterflyRoot.destroyed) this.butterflyRoot.visible = v;
    if (!this.skyRoot.destroyed) this.skyRoot.visible = v;
  }

  private ensureBuilt(): boolean {
    if (this.destroyed || this.swayRoot.destroyed || this.skyRoot.destroyed || this.butterflyRoot.destroyed) return false;
    if (this.built) return true;
    this.built = true;
    this.atlas = acquireMapLifeAtlas();

    const activeWind = this.config.wind && clampedSwayStrength(this.config.wind.strength) > 0 ? this.config.wind : null;
    const activeWater = this.config.water && (clampedWaterStrength(this.config.water.strength) > 0 || (this.config.water.glintStrength ?? 0) > 0)
      ? this.config.water
      : null;
    const activeHaze = this.config.heatHaze && clampedHazeStrength(this.config.heatHaze.strength) > 0 ? this.config.heatHaze : null;

    if (activeWind || activeWater || activeHaze) {
      this.surfacePass = new SurfacePass(
        this.swayRoot,
        this.mapWidth,
        this.mapHeight,
        activeWind,
        activeWater,
        activeHaze,
        this.baseUrl,
        this.getMapSource(),
      );
    }

    this.buildClouds();
    this.buildBirds();
    this.buildButterflies();
    this.buildDust();
    return true;
  }

  private buildClouds(): void {
    const cfg = this.config.clouds;
    if (!cfg || cfg.count <= 0) return;
    const maxCount = Math.min(MAX_CLOUDS, Math.max(0, Math.round(cfg.count)));
    const tint = parseHexColor(cfg.tint, 0x1b2e4c);
    const minSize = cfg.sizeRange?.[0] ?? 500;
    const maxSize = Math.max(minSize, cfg.sizeRange?.[1] ?? 800);
    const windRot = Math.atan2(this.dirY, this.dirX);

    for (let i = 0; i < maxCount; i++) {
      const tex = this.atlas ? this.atlas.clouds[i % 3] : Texture.WHITE;
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.tint = tint;
      const size = minSize + (maxSize - minSize) * (maxCount > 1 ? i / (maxCount - 1) : 0.5) * (0.92 + nextRand(this.rng) * 0.16);
      const aspect = 0.62 + nextRand(this.rng) * 0.16;
      const baseScaleX = size / 128;
      const baseScaleY = (size * aspect) / 128;
      sp.scale.set(baseScaleX, baseScaleY);
      const rot = windRot + (nextRand(this.rng) - 0.5) * 0.25;
      sp.rotation = rot;

      // Spread initial cloud centers across the island so sunlight & shade are balanced immediately.
      const x = ((i + 0.35 + nextRand(this.rng) * 0.25) / maxCount) * this.mapWidth;
      const y = (0.18 + ((i * 0.37 + nextRand(this.rng) * 0.2) % 0.7)) * this.mapHeight;
      sp.position.set(x, y);
      sp.alpha = Math.max(0.04, Math.min(0.2, cfg.alpha));
      this.cloudLayer.addChild(sp);

      this.clouds.push({
        sprite: sp,
        x,
        y,
        speedMul: 0.88 + nextRand(this.rng) * 0.24,
        baseScaleX,
        baseScaleY,
        baseAlpha: Math.max(0.04, Math.min(0.2, cfg.alpha)) * (0.9 + nextRand(this.rng) * 0.2),
        phase: nextRand(this.rng) * Math.PI * 2,
        rot,
        halfSpan: size * 0.58,
      });
    }
  }

  private buildBirds(): void {
    const cfg = this.config.birds;
    if (!cfg) return;
    const tint = parseHexColor(cfg.tint, 0x473528);
    const baseWingspan = cfg.scale ?? 16;
    const shadowAlpha = cfg.shadowAlpha ?? 0.15;

    for (let i = 0; i < MAX_BIRDS; i++) {
      const sprite = new Sprite(this.atlas ? this.atlas.birds[0] : Texture.WHITE);
      sprite.anchor.set(0.5);
      sprite.tint = tint;
      sprite.visible = false;
      this.birdLayer.addChild(sprite);

      const shadow = new Sprite(this.atlas ? this.atlas.birdShadow : Texture.WHITE);
      shadow.anchor.set(0.5);
      shadow.tint = 0x1a2433;
      shadow.alpha = shadowAlpha;
      shadow.visible = false;
      this.birdShadowLayer.addChild(shadow);

      this.birds.push({
        sprite,
        shadow,
        active: false,
        offsetX: 0,
        offsetY: 0,
        flapPhase: 0,
        flapRate: 4.5,
        glideTimer: 0,
        gliding: false,
        scale: baseWingspan / 44,
        swayPhase: 0,
      });
    }

    this.flockActive = false;
    this.flockCountdown = Math.max(0.5, cfg.initialDelay ?? 4.0);
  }

  private buildButterflies(): void {
    const cfg = this.config.butterflies;
    if (!cfg || cfg.count <= 0 || cfg.zones.length === 0) return;
    const maxCount = Math.min(MAX_BUTTERFLIES, Math.max(0, Math.round(cfg.count)));
    const size = cfg.size ?? 10;

    for (let i = 0; i < maxCount; i++) {
      const zone = cfg.zones[i % cfg.zones.length];
      const colorHex = cfg.colors.length > 0 ? cfg.colors[i % cfg.colors.length] : '#fff8d6';
      const tint = parseHexColor(colorHex, 0xfff8d6);

      const shadow = new Sprite(this.atlas ? this.atlas.butterfly : Texture.WHITE);
      shadow.anchor.set(0.5);
      shadow.tint = 0x202a1c;
      shadow.alpha = 0.14;
      shadow.visible = false;
      this.butterflyRoot.addChild(shadow);

      const sprite = new Sprite(this.atlas ? this.atlas.butterfly : Texture.WHITE);
      sprite.anchor.set(0.5);
      sprite.tint = tint;
      sprite.visible = false;
      this.butterflyRoot.addChild(sprite);

      const ang = nextRand(this.rng) * Math.PI * 2;
      const dist = nextRand(this.rng) * zone.radius * 0.7;
      const sx = zone.x + Math.cos(ang) * dist;
      const sy = zone.y + Math.sin(ang) * dist;
      const tang = nextRand(this.rng) * Math.PI * 2;
      const tdist = (0.3 + nextRand(this.rng) * 0.7) * zone.radius;
      const baseScale = (size * (0.85 + nextRand(this.rng) * 0.3)) / 48;

      this.butterflies.push({
        sprite,
        shadow,
        homeX: zone.x,
        homeY: zone.y,
        radius: Math.max(16, zone.radius),
        x: sx,
        y: sy,
        targetX: zone.x + Math.cos(tang) * tdist,
        targetY: zone.y + Math.sin(tang) * tdist,
        heading: ang,
        speed: 18 + nextRand(this.rng) * 14,
        flapPhase: nextRand(this.rng) * Math.PI * 2,
        flapRate: 18 + nextRand(this.rng) * 8,
        restTimer: 0,
        baseScale,
      });
    }
  }

  private buildDust(): void {
    const cfg = this.config.dust;
    if (!cfg || cfg.count <= 0) return;
    const maxCount = Math.min(MAX_DUST_WISPS, Math.max(0, Math.round(cfg.count)));
    const tint1 = parseHexColor(cfg.tint, 0xebd0a7);
    const tint2 = parseHexColor(cfg.tint2, 0xf5e3c6);
    const minLen = cfg.sizeRange?.[0] ?? 200;
    const maxLen = Math.max(minLen, cfg.sizeRange?.[1] ?? 380);
    const baseAlpha = Math.max(0.02, Math.min(0.18, cfg.alpha));
    const windRot = Math.atan2(this.dustDirY, this.dustDirX);
    const bands = cfg.bands && cfg.bands.length > 0 ? cfg.bands : null;

    for (let i = 0; i < maxCount; i++) {
      const tex = this.atlas ? this.atlas.dustWisps[i % 2] : Texture.WHITE;
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.tint = i % 2 === 0 ? tint1 : tint2;
      sp.visible = false;

      const len = minLen + (maxLen - minLen) * (0.2 + nextRand(this.rng) * 0.8);
      const thickness = len * (0.16 + nextRand(this.rng) * 0.08);
      const baseScaleX = len / 256;
      const baseScaleY = thickness / 64;
      const rot = windRot + (nextRand(this.rng) - 0.5) * 0.14;
      sp.scale.set(baseScaleX, baseScaleY);
      sp.rotation = rot;

      let minX = -len * 0.45;
      let maxX = this.mapWidth + len * 0.45;
      let minY = 54;
      let maxY = this.mapHeight - 54;
      if (bands) {
        const [bx, by, bw, bh] = bands[i % bands.length];
        minX = bx - len * 0.25;
        maxX = bx + bw + len * 0.25;
        minY = by;
        maxY = by + bh;
      }
      const x = minX + ((i + 0.3 + nextRand(this.rng) * 0.5) / maxCount) * (maxX - minX);
      const y = minY + nextRand(this.rng) * Math.max(1, maxY - minY);
      sp.position.set(x, y);
      sp.alpha = baseAlpha;
      this.dustLayer.addChild(sp);

      this.dustWisps.push({
        sprite: sp,
        x,
        y,
        minX,
        maxX,
        minY,
        maxY,
        speedMul: 0.78 + nextRand(this.rng) * 0.44,
        baseScaleX,
        baseScaleY,
        baseAlpha: baseAlpha * (0.72 + nextRand(this.rng) * 0.42),
        phase: nextRand(this.rng) * Math.PI * 2,
        rot,
        swayAmp: 6 + nextRand(this.rng) * 10,
      });
    }
  }

  private spawnFlock(tier: QualityTier): void {
    const cfg = this.config.birds;
    if (!cfg || this.birds.length === 0) return;
    const cap = effectiveBirdCap(cfg.flockSize, tier);
    if (cap <= 0) return;

    const lo = Math.max(1, Math.min(cap, Math.round(Math.min(cfg.flockSize[0], cfg.flockSize[1]))));
    const count = lo + Math.floor(nextRand(this.rng) * (cap - lo + 1));

    // Aim the flock through a central meadow waypoint so it always crosses clearly over the island.
    const baseAngle = Math.atan2(this.dirY, this.dirX);
    const angle = baseAngle + (nextRand(this.rng) - 0.5) * 0.44;
    const vx = Math.cos(angle);
    const vy = Math.sin(angle);
    const speed = (cfg.speed ?? 95) * (0.9 + nextRand(this.rng) * 0.2);

    const midX = this.mapWidth * (0.38 + nextRand(this.rng) * 0.24);
    const midY = this.mapHeight * (0.3 + nextRand(this.rng) * 0.34);
    const margin = 120;
    const backDistX = Math.abs(vx) > 1e-4 ? (vx > 0 ? midX + margin : this.mapWidth - midX + margin) / Math.abs(vx) : 1e6;
    const backDistY = Math.abs(vy) > 1e-4 ? (vy > 0 ? midY + margin : this.mapHeight - midY + margin) / Math.abs(vy) : 1e6;
    const backDist = Math.min(backDistX, backDistY);
    this.flockX = midX - vx * backDist;
    this.flockY = midY - vy * backDist;

    this.flockVx = vx * speed;
    this.flockVy = vy * speed;
    this.flockHeading = angle;
    this.flockActive = true;
    this.flocksSpawned++;

    const baseWingspan = cfg.scale ?? 16;
    const perpX = -vy;
    const perpY = vx;
    let live = 0;

    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      if (i < count) {
        b.active = true;
        // Loose organic V / staggered flock formation.
        const rank = Math.ceil(i / 2);
        const side = i === 0 ? 0 : i % 2 === 1 ? -1 : 1;
        const back = -rank * (22 + nextRand(this.rng) * 14);
        const lat = side * rank * (18 + nextRand(this.rng) * 14) + (nextRand(this.rng) - 0.5) * 10;
        b.offsetX = vx * back + perpX * lat;
        b.offsetY = vy * back + perpY * lat;
        b.flapPhase = nextRand(this.rng) * Math.PI * 2;
        b.flapRate = 4.2 + nextRand(this.rng) * 1.4;
        b.glideTimer = 0.6 + nextRand(this.rng) * 1.4;
        b.gliding = nextRand(this.rng) < 0.35;
        b.scale = (baseWingspan * (0.86 + nextRand(this.rng) * 0.26)) / 44;
        b.swayPhase = nextRand(this.rng) * Math.PI * 2;
        b.sprite.visible = true;
        b.shadow.visible = true;
        live++;
      } else {
        b.active = false;
        b.sprite.visible = false;
        b.shadow.visible = false;
      }
    }
    this.activeBirds = live;
  }

  private hideBirds(): void {
    this.flockActive = false;
    this.activeBirds = 0;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      b.active = false;
      if (!b.sprite.destroyed) b.sprite.visible = false;
      if (!b.shadow.destroyed) b.shadow.visible = false;
    }
  }

  private stepClouds(dt: number, tier: QualityTier): void {
    const cfg = this.config.clouds;
    const count = effectiveCloudCount(cfg?.count, tier);
    this.activeClouds = Math.min(count, this.clouds.length);
    if (!cfg) return;

    const speed = cfg.speed;
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      const on = i < this.activeClouds;
      c.sprite.visible = on;
      if (!on) continue;

      const pad = c.halfSpan;
      c.x = wrapCoord(c.x + this.dirX * speed * c.speedMul * dt, -pad, this.mapWidth + pad);
      c.y = wrapCoord(c.y + this.dirY * speed * c.speedMul * dt, -pad, this.mapHeight + pad);

      const breathe = Math.sin(this.time * 0.22 + c.phase);
      c.sprite.position.set(c.x, c.y);
      c.sprite.scale.set(c.baseScaleX * (1 + 0.04 * breathe), c.baseScaleY * (1 - 0.03 * breathe));
      c.sprite.rotation = c.rot + breathe * 0.025;
      c.sprite.alpha = c.baseAlpha * (0.92 + 0.08 * Math.cos(this.time * 0.17 + c.phase));
    }
  }

  private stepBirds(dt: number, tier: QualityTier): void {
    const cfg = this.config.birds;
    if (!cfg || this.birds.length === 0) return;
    if (tier === 'low') {
      this.hideBirds();
      return;
    }

    if (!this.flockActive) {
      this.flockCountdown -= dt;
      if (this.flockCountdown <= 0) {
        this.spawnFlock(tier);
      }
      return;
    }

    this.flockX += this.flockVx * dt;
    this.flockY += this.flockVy * dt;

    const shOffX = cfg.shadowOffset?.[0] ?? 30;
    const shOffY = cfg.shadowOffset?.[1] ?? 46;
    const frames = this.atlas ? this.atlas.birds : null;
    const perpX = -Math.sin(this.flockHeading);
    const perpY = Math.cos(this.flockHeading);

    const margin = 220;
    let anyInBounds = false;

    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      if (!b.active) continue;

      // Alternate gentle wingbeats and short glides so birds read naturally, not mechanical.
      b.glideTimer -= dt;
      if (b.glideTimer <= 0) {
        b.gliding = !b.gliding;
        b.glideTimer = b.gliding ? 0.65 + nextRand(this.rng) * 0.95 : 1.1 + nextRand(this.rng) * 1.4;
      }
      if (!b.gliding) {
        b.flapPhase += dt * b.flapRate * Math.PI * 2;
      }

      const sway = Math.sin(this.time * 1.4 + b.swayPhase) * 6.5;
      const bx = this.flockX + b.offsetX + perpX * sway;
      const by = this.flockY + b.offsetY + perpY * sway;

      if (bx > -margin && bx < this.mapWidth + margin && by > -margin && by < this.mapHeight + margin) {
        anyInBounds = true;
      }

      // Select wing frame (glide holds gently spread wings = frame 1).
      if (frames) {
        const idx = b.gliding
          ? 1
          : Math.min(3, Math.floor(((Math.sin(b.flapPhase) + 1) * 0.5) * 3.999));
        if (b.sprite.texture !== frames[idx]) b.sprite.texture = frames[idx];
      }

      const flapBob = b.gliding ? 0 : Math.sin(b.flapPhase) * 1.6;
      b.sprite.position.set(bx, by + flapBob);
      b.sprite.rotation = this.flockHeading;
      b.sprite.scale.set(b.scale, b.scale * (b.gliding ? 1.0 : 0.92 + 0.12 * Math.cos(b.flapPhase)));

      b.shadow.position.set(bx + shOffX, by + shOffY);
      b.shadow.rotation = this.flockHeading;
      b.shadow.scale.set(b.scale * 0.88);
    }

    if (!anyInBounds) {
      this.hideBirds();
      const lo = Math.max(8, Math.min(cfg.interval[0], cfg.interval[1]));
      const hi = Math.max(lo, Math.max(cfg.interval[0], cfg.interval[1]));
      this.flockCountdown = lo + nextRand(this.rng) * (hi - lo);
    }
  }

  private stepButterflies(dt: number, tier: QualityTier): void {
    const count = effectiveButterflyCount(this.config.butterflies?.count, tier);
    this.activeButterflies = Math.min(count, this.butterflies.length);
    if (this.butterflies.length === 0) return;

    for (let i = 0; i < this.butterflies.length; i++) {
      const bf = this.butterflies[i];
      const on = i < this.activeButterflies;
      bf.sprite.visible = on;
      bf.shadow.visible = on;
      if (!on) continue;

      if (bf.restTimer > 0) {
        bf.restTimer -= dt;
        bf.flapPhase += dt * 4.2;
      } else {
        const dx = bf.targetX - bf.x;
        const dy = bf.targetY - bf.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 8) {
          // Pick a new nearby flower spot inside this butterfly's meadow zone.
          const ang = nextRand(this.rng) * Math.PI * 2;
          const r = (0.2 + nextRand(this.rng) * 0.8) * bf.radius;
          bf.targetX = bf.homeX + Math.cos(ang) * r;
          bf.targetY = bf.homeY + Math.sin(ang) * r;
          if (nextRand(this.rng) < 0.42) {
            bf.restTimer = 0.4 + nextRand(this.rng) * 0.85;
          }
        } else {
          const desired = Math.atan2(dy, dx);
          // Shortest angular turn for graceful curved flight paths.
          let diff = desired - bf.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          bf.heading += Math.max(-3.6 * dt, Math.min(3.6 * dt, diff));

          const flutter = Math.sin(bf.flapPhase * 0.45) * 6;
          const vx = Math.cos(bf.heading) * bf.speed - Math.sin(bf.heading) * flutter;
          const vy = Math.sin(bf.heading) * bf.speed + Math.cos(bf.heading) * flutter;
          bf.x += vx * dt;
          bf.y += vy * dt;
        }
        bf.flapPhase += dt * bf.flapRate;
      }

      const wingOpen = 0.22 + 0.78 * Math.abs(Math.sin(bf.flapPhase));
      const bob = Math.sin(bf.flapPhase * 0.7) * 2.2;
      const rot = bf.heading + Math.PI * 0.5;

      bf.sprite.position.set(bf.x, bf.y + bob);
      bf.sprite.rotation = rot;
      bf.sprite.scale.set(bf.baseScale * wingOpen, bf.baseScale);
      bf.sprite.alpha = 0.92;

      bf.shadow.position.set(bf.x + 3.5, bf.y + 6.5);
      bf.shadow.rotation = rot;
      bf.shadow.scale.set(bf.baseScale * (0.45 + 0.45 * wingOpen), bf.baseScale * 0.75);
    }
  }

  private stepDust(dt: number, tier: QualityTier): void {
    const cfg = this.config.dust;
    const count = effectiveDustCount(cfg?.count, tier);
    this.activeDust = Math.min(count, this.dustWisps.length);
    if (!cfg || this.dustWisps.length === 0) return;

    const speed = cfg.speed;
    const perpX = -this.dustDirY;
    const perpY = this.dustDirX;

    for (let i = 0; i < this.dustWisps.length; i++) {
      const d = this.dustWisps[i];
      const on = i < this.activeDust;
      d.sprite.visible = on;
      if (!on) continue;

      d.x = wrapCoord(d.x + this.dustDirX * speed * d.speedMul * dt, d.minX, d.maxX);
      d.y = wrapCoord(d.y + this.dustDirY * speed * d.speedMul * dt, d.minY, d.maxY);

      const u = (d.x - d.minX) / Math.max(1, d.maxX - d.minX);
      const v = (d.y - d.minY) / Math.max(1, d.maxY - d.minY);
      // Smooth sine fade near entry/exit of each drift lane so wisps never pop in or out.
      const edgeFade = Math.sin(Math.max(0, Math.min(1, u)) * Math.PI) * Math.sin(Math.max(0, Math.min(1, v)) * Math.PI);
      const softFade = Math.min(1, edgeFade * 2.2);
      const breathe = 0.65 + 0.35 * Math.sin(this.time * 0.55 + d.phase);
      const cross = Math.sin(this.time * 0.65 + d.phase * 1.3) * d.swayAmp;

      d.sprite.position.set(d.x + perpX * cross, d.y + perpY * cross);
      d.sprite.scale.set(
        d.baseScaleX * (0.94 + 0.1 * Math.sin(this.time * 0.4 + d.phase)),
        d.baseScaleY * (0.92 + 0.12 * Math.cos(this.time * 0.35 + d.phase)),
      );
      d.sprite.rotation = d.rot + Math.sin(this.time * 0.32 + d.phase) * 0.04;
      d.sprite.alpha = d.baseAlpha * softFade * breathe;
    }
  }

  /** Advances map life deterministically by `dtSec` (clamped for stability). */
  step(dtSec: number, tier: QualityTier = 'high'): void {
    if (this.destroyed) return;
    this.lastTier = tier;
    if (!this.built) {
      if (tier === 'low' || isReducedMotion()) return;
      if (!this.ensureBuilt()) return;
    }
    const dt = Math.max(0, Math.min(0.1, Number.isFinite(dtSec) ? dtSec : 0));
    this.time += dt;

    this.surfacePass?.sync(this.time, this.getMapSource(), tier);
    this.stepClouds(dt, tier);
    this.stepBirds(dt, tier);
    this.stepButterflies(dt, tier);
    this.stepDust(dt, tier);
  }

  /**
   * Per-frame sync called from `main2d.ts` (mirrors `AmbientFxLayer.update`).
   * Disables cleanly on low tier / reduced motion, freezes cleanly on pause / hidden tab.
   */
  update(enabled: boolean, paused: boolean, smallBake: boolean, dtSec: number, tier: QualityTier = 'high'): void {
    if (this.destroyed) return;
    this.smallBake = smallBake;
    this.lastTier = tier;
    this.enabled = enabled && tier !== 'low' && !isReducedMotion();
    this.paused = paused || (typeof document !== 'undefined' && document.hidden);

    if (!this.enabled) {
      this.setAllVisible(false);
      if (this.built) {
        this.hideBirds();
        this.activeClouds = 0;
        this.activeButterflies = 0;
        this.activeDust = 0;
        this.warmed = false;
      }
      return;
    }

    // Never allocate sprites or advance warm-up behind a paused screen or hidden tab.
    if (this.paused) return;

    if (!this.ensureBuilt()) return;
    this.setAllVisible(true);

    if (!this.warmed) {
      this.warmed = true;
      // Pre-step 0.5 s so clouds, surface uniforms, butterflies, and dust settle into natural motion on frame 1.
      for (let i = 0; i < 5; i++) this.step(0.1, tier);
      return;
    }

    this.step(dtSec, tier);
  }

  debug(): MapLifeStats {
    return {
      island: this.config.island,
      built: this.built,
      enabled: this.enabled,
      paused: this.paused,
      smallBake: this.smallBake,
      tier: this.lastTier,
      time: Math.round(this.time * 1000) / 1000,
      swayReady: this.surfacePass?.swayReady ?? false,
      waterReady: this.surfacePass?.waterReady ?? false,
      hazeReady: this.surfacePass?.hazeReady ?? false,
      activeClouds: this.built && this.enabled ? this.activeClouds : 0,
      activeBirds: this.built && this.enabled ? this.activeBirds : 0,
      activeButterflies: this.built && this.enabled ? this.activeButterflies : 0,
      activeDust: this.built && this.enabled ? this.activeDust : 0,
      flocksSpawned: this.flocksSpawned,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.enabled = false;
    this.warmed = false;
    this.hideBirds();
    this.surfacePass?.destroy();
    this.surfacePass = null;
    for (const root of [this.swayRoot, this.butterflyRoot, this.skyRoot]) {
      if (!root.destroyed) root.destroy({ children: true });
    }
    this.clouds.length = 0;
    this.birds.length = 0;
    this.butterflies.length = 0;
    this.dustWisps.length = 0;
    this.activeClouds = 0;
    this.activeBirds = 0;
    this.activeButterflies = 0;
    this.activeDust = 0;
    const atlas = this.atlas;
    this.atlas = null;
    this.built = false;
    releaseMapLifeAtlas(atlas);
  }
}

/**
 * Mounts the procedural map-life layer for an island inside `world` (matching `mapAnimLayer`):
 *  - `swayHost`: index 1 (immediately above `mapBase`, below `mapAnimLayer` video loops & ambientFx)
 *  - `butterflyHost`: right below `layers.plots` (above swaying ground & ambientFx, under plots/units)
 *  - `skyHost`: right below `layers.bars` (above towers/enemies/flyers/fx, below HP bars & HUD/DOM UI)
 *
 * Returns `undefined` when the island has no `src/data/mapLife/<island>.json` (no behaviour change).
 */
export function mapLifeLayer(
  world: Container,
  map: Pick<MapView, 'textureSource' | 'imageW' | 'imageH'> | null,
  layers: Pick<WorldLayers, 'plots' | 'bars'> | null,
  island: string,
  base: string,
): MapLifeController | undefined {
  const cfg = getMapLifeConfig(island);
  if (!cfg) return undefined;

  const swayHost = new Container();
  const butterflyHost = new Container();
  const skyHost = new Container();
  for (const h of [swayHost, butterflyHost, skyHost]) {
    h.eventMode = 'none';
    h.interactiveChildren = false;
  }

  // 1. Sway host strictly at index 1: right above mapBase (0), under ambientHost & all battle layers.
  world.addChildAt(swayHost, Math.min(1, world.children.length));

  // 2. Butterfly host strictly below plots (so above ground, sway, video loops, ambientFx; under plots/units).
  const plotsIdx = layers && !layers.plots.destroyed ? world.children.indexOf(layers.plots) : -1;
  if (plotsIdx >= 0) {
    world.addChildAt(butterflyHost, plotsIdx);
  } else {
    world.addChild(butterflyHost);
  }

  // 3. Sky host (cloud shadows + birds) strictly above actors/air/projectiles/fx and below bars/HUD/DOM.
  const barsIdx = layers && !layers.bars.destroyed ? world.children.indexOf(layers.bars) : -1;
  if (barsIdx >= 0) {
    world.addChildAt(skyHost, barsIdx);
  } else {
    world.addChild(skyHost);
  }

  let life: MapLifeLayer | undefined;
  let destroyed = false;
  let lastPaused = false;
  let lastSmallBake = false;
  let lastTier: QualityTier = 'high';

  const releaseRuntime = (): void => {
    life?.destroy();
    life = undefined;
  };
  const releaseAll = (): void => {
    if (destroyed) return;
    destroyed = true;
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', releaseRuntime);
    releaseRuntime();
    for (const h of [swayHost, butterflyHost, skyHost]) {
      if (!h.destroyed) h.destroy({ children: true });
    }
  };
  const ensureLife = (): MapLifeLayer | undefined => {
    if (destroyed || swayHost.destroyed || butterflyHost.destroyed || skyHost.destroyed) return undefined;
    if (!life) {
      life = new MapLifeLayer(
        cfg,
        base,
        () => (map ? map.textureSource : null),
        map ? map.imageW : LAYOUT_WIDTH,
        map ? map.imageH : LAYOUT_HEIGHT,
      );
      swayHost.addChild(life.swayRoot);
      butterflyHost.addChild(life.butterflyRoot);
      skyHost.addChild(life.skyRoot);
    }
    return life;
  };

  if (typeof window !== 'undefined') window.addEventListener('pagehide', releaseRuntime);
  world.once('destroyed', releaseAll);

  return {
    update(enabled: boolean, paused: boolean, smallBake: boolean, dtSec = 1 / 60, tier: QualityTier = 'high'): void {
      if (destroyed || swayHost.destroyed) return;
      const hidden = typeof document !== 'undefined' && document.hidden;
      const effectiveEnabled = enabled && tier !== 'low' && !isReducedMotion();
      lastPaused = paused || hidden;
      lastSmallBake = smallBake;
      lastTier = tier;

      if (!effectiveEnabled) {
        if (life) releaseRuntime();
        return;
      }
      if (!lastPaused) {
        ensureLife()?.update(true, false, smallBake, dtSec, tier);
      } else if (life) {
        life.update(true, true, smallBake, dtSec, tier);
      }
    },
    step(dtSec: number, tier: QualityTier = 'high'): void {
      if (destroyed || tier === 'low' || isReducedMotion()) return;
      const layer = ensureLife();
      if (!layer) return;
      layer.swayRoot.visible = true;
      layer.butterflyRoot.visible = true;
      layer.skyRoot.visible = true;
      layer.step(dtSec, tier);
    },
    debug(): MapLifeStats {
      if (life) return life.debug();
      return {
        island: cfg.island,
        built: false,
        enabled: false,
        paused: lastPaused,
        smallBake: lastSmallBake,
        tier: lastTier,
        time: 0,
        swayReady: false,
        waterReady: false,
        hazeReady: false,
        activeClouds: 0,
        activeBirds: 0,
        activeButterflies: 0,
        activeDust: 0,
        flocksSpawned: 0,
      };
    },
    destroy(): void {
      releaseAll();
    },
  };
}
