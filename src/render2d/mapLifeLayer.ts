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
export const MAX_CLOUDS = 4;
export const MAX_BIRDS = 7;
export const MAX_BUTTERFLIES = 12;

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
  readonly activeClouds: number;
  readonly activeBirds: number;
  readonly activeButterflies: number;
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
    const textures = [...atlas.clouds, ...atlas.birds, atlas.birdShadow, atlas.butterfly];
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

  const source = new ImageSource({ resource: c });
  const sub = (x: number, y: number, w: number, h: number): Texture =>
    new Texture({ source, frame: new Rectangle(x, y, w, h) });

  cachedAtlas = {
    source,
    clouds: [sub(0, 0, 128, 128), sub(128, 0, 128, 128), sub(256, 0, 128, 128)],
    birds: [sub(0, 128, 64, 64), sub(64, 128, 64, 64), sub(128, 128, 64, 64), sub(192, 128, 64, 64)],
    birdShadow: sub(256, 128, 64, 64),
    butterfly: sub(320, 128, 64, 64),
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

class WindSwayPass {
  private readonly host: Container;
  private readonly width: number;
  private readonly height: number;
  private readonly wind: WindSwayConfig;
  private readonly image: HTMLImageElement | null;
  private maskSource: ImageSource | null = null;
  private uniforms: UniformGroup | null = null;
  private mesh: Mesh<MeshGeometry, Shader> | null = null;
  private lastMapSource: TextureSource | null = null;
  private time = 0;
  private failed = false;
  private destroyed = false;

  constructor(host: Container, width: number, height: number, wind: WindSwayConfig, base: string, mapSource: TextureSource | null) {
    this.host = host;
    this.width = width;
    this.height = height;
    this.wind = wind;
    this.lastMapSource = mapSource;

    if (typeof Image === 'undefined') {
      this.image = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = this.onMaskReady;
    img.onerror = this.onMaskError;
    img.src = base + wind.mask;
    this.image = img;
    if (img.complete && img.naturalWidth > 0) this.onMaskReady();
  }

  get ready(): boolean {
    return this.mesh !== null && !this.destroyed;
  }

  private onMaskError = (): void => {
    this.failed = true;
  };

  private onMaskReady = (): void => {
    if (this.destroyed || this.failed || this.mesh || !this.image || !this.image.naturalWidth) return;
    if (!this.lastMapSource || this.host.destroyed) return;

    this.maskSource = new ImageSource({ resource: this.image });
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

    const geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, this.width, 0, this.width, this.height, 0, this.height]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });

    const shader = new Shader({
      glProgram: GlProgram.from({ vertex: SWAY_VERTEX, fragment: SWAY_FRAGMENT, name: 'map-life-sway' }),
      resources: {
        uMap: this.lastMapSource,
        uMask: this.maskSource,
        windUniforms: this.uniforms,
      },
    });

    const mesh = new Mesh({ geometry, shader });
    mesh.eventMode = 'none';
    this.mesh = mesh;
    this.host.addChild(mesh);
  };

  sync(time: number, mapSource: TextureSource | null): void {
    if (this.destroyed) return;
    this.time = time;
    if (mapSource && mapSource !== this.lastMapSource) {
      this.lastMapSource = mapSource;
      if (this.mesh?.shader) {
        this.mesh.shader.resources.uMap = mapSource;
      } else if (this.image && this.image.naturalWidth > 0 && !this.failed) {
        this.onMaskReady();
      }
    }
    if (this.uniforms) {
      this.uniforms.uniforms.uTime = time;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.image) {
      this.image.onload = null;
      this.image.onerror = null;
    }
    if (this.mesh) {
      const { geometry, shader } = this.mesh;
      if (!this.mesh.destroyed) this.mesh.destroy();
      geometry.destroy(true);
      shader?.destroy();
      this.mesh = null;
    }
    this.uniforms = null;
    if (this.maskSource && !this.maskSource.destroyed) {
      this.maskSource.destroy();
    }
    this.maskSource = null;
    this.lastMapSource = null;
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

/**
 * Core procedural map-life runtime. Manages the sway mesh, clouds, birds, and butterflies across
 * three depth-appropriate containers.
 */
export class MapLifeLayer {
  readonly swayRoot = new Container();
  readonly butterflyRoot = new Container();
  readonly skyRoot = new Container();

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

  private atlas: MapLifeAtlas | null = null;
  private swayPass: WindSwayPass | null = null;
  private readonly clouds: CloudRuntime[] = [];
  private readonly birds: BirdRuntime[] = [];
  private readonly butterflies: ButterflyRuntime[] = [];

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
    const [dx, dy] = normalizeDir(config.wind?.dir);
    this.dirX = dx;
    this.dirY = dy;

    for (const c of [this.swayRoot, this.butterflyRoot, this.skyRoot, this.cloudLayer, this.birdShadowLayer, this.birdLayer]) {
      c.eventMode = 'none';
      c.interactiveChildren = false;
    }
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

    if (this.config.wind && clampedSwayStrength(this.config.wind.strength) > 0) {
      this.swayPass = new WindSwayPass(
        this.swayRoot,
        this.mapWidth,
        this.mapHeight,
        this.config.wind,
        this.baseUrl,
        this.getMapSource(),
      );
    }

    this.buildClouds();
    this.buildBirds();
    this.buildButterflies();
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

    this.swayPass?.sync(this.time, this.getMapSource());
    this.stepClouds(dt, tier);
    this.stepBirds(dt, tier);
    this.stepButterflies(dt, tier);
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
      // Pre-step 0.5 s so clouds, sway uniforms, and butterflies settle into natural motion on frame 1.
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
      swayReady: this.swayPass?.ready ?? false,
      activeClouds: this.built && this.enabled ? this.activeClouds : 0,
      activeBirds: this.built && this.enabled ? this.activeBirds : 0,
      activeButterflies: this.built && this.enabled ? this.activeButterflies : 0,
      flocksSpawned: this.flocksSpawned,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.enabled = false;
    this.warmed = false;
    this.hideBirds();
    this.swayPass?.destroy();
    this.swayPass = null;
    for (const root of [this.swayRoot, this.butterflyRoot, this.skyRoot]) {
      if (!root.destroyed) root.destroy({ children: true });
    }
    this.clouds.length = 0;
    this.birds.length = 0;
    this.butterflies.length = 0;
    this.activeClouds = 0;
    this.activeBirds = 0;
    this.activeButterflies = 0;
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
        activeClouds: 0,
        activeBirds: 0,
        activeButterflies: 0,
        flocksSpawned: 0,
      };
    },
    destroy(): void {
      releaseAll();
    },
  };
}
