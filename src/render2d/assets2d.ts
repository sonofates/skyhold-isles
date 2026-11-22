import { bootPhase } from './bootTrace.ts';
import { Capacitor } from '@capacitor/core';
import { Assets, loadTextures, Rectangle, Texture, type TextureSource } from 'pixi.js';
import type { TowerType } from '../core/types.ts';
import { alphaFeetAnchor } from './alphaBox.ts';
import { enemyHasArt, mulTint, pickTier, resolveEnemyArt, resolveTowerTiers } from './artResolve.ts';
import { MASTER_SCALE, pickMapVariant } from './mapVariant.ts';
import { measureRing, type RingSpec } from './towerFit.ts';
import { parseTurretJson, TURRET_DIRS, type TurretSpec } from './turret.ts';
import {
  parseManifest,
  parseSheetJson,
  withArtVariant,
  type AnimMode,
  type ArtManifest,
  type EnemyArt,
  type HeroArtSpec,
  type TierRing,
  type TowerArt,
  type UiArt,
} from './manifest.ts';

/** Runtime art after loading: every slot holds a texture (fallbacks applied). */
export interface TowerArtRuntime {
  readonly spec: TowerArt;
  /** Texture per tier 1..3 (index 0..2), missing tiers reuse the highest loaded earlier tier. */
  readonly tiers: readonly Texture[];
  /** Per tier: file (manifest-relative) drawn, or null. */
  readonly tierFiles: readonly (string | null)[];
  /** Multiply tint (fallback art is tinted so it reads as a different tower). */
  readonly tint: number;
  /** Tower whose sprites stand in while this tower's own art is pending. */
  readonly fallbackOf: string | null;
  /** Per tier 1..3: the drawn file's stone ring (ring-convention art), or null (legacy placement). */
  readonly rings: readonly (RingSpec | null)[];
  /** Per tier 1..3: painted attack sheet (played once per shot), or null. */
  readonly attack: readonly (TowerSheetRuntime | null)[];
  /** Per tier 1..3: painted idle loop, or null. */
  readonly idle: readonly (TowerSheetRuntime | null)[];
  /**
   * Per tier 1..3: aimable turret (drawn as its body + the turret piece instead of `tiers`), or
   * null. Optional: art built by hand (placeholders, tests) may leave it out.
   */
  readonly turrets?: readonly (TurretRuntime | null)[];
}

/**
 * A loaded aimable turret: 5 direction frames (TURRET_DIRS order), the packed measurements and the
 * body drawn under it (its own stone ring). `tiers` keeps the full-tower picture (build ring, codex).
 */
export interface TurretRuntime {
  readonly spec: TurretSpec;
  readonly frames: readonly Texture[];
  readonly body: Texture;
  readonly bodyFile: string;
  readonly ring: RingSpec;
}

/** A tower animation sheet, ring-measured in its own frame px (so frames fit the plot like statics). */
export interface TowerSheetRuntime {
  readonly frames: readonly Texture[];
  readonly fps: number;
  readonly release: number | null;
  readonly ring: RingSpec;
  readonly frameW: number;
  readonly frameH: number;
}

export interface PlotArtRuntime {
  readonly texture: Texture;
  /** Ring in texture px (null = the whole sprite). */
  readonly ring: RingSpec | null;
}

export interface SheetRuntime {
  /** [down, up] frame sequences, plus [2] = side walk when the manifest lists `sheet.side` and it loaded. */
  readonly seqs: readonly (readonly Texture[])[];
  readonly fps: number;
  readonly anchor: readonly [number, number] | null;
}

/** A melee attack sheet (see EnemyArt.attack). */
export interface AttackSheetRuntime {
  readonly frames: readonly Texture[];
  readonly fps: number;
  /** Feet point (normalised), or null → the walk sheet's / art anchor. */
  readonly anchor: readonly [number, number] | null;
  /** Frame where the blow lands (null → middle frame). */
  readonly impact: number | null;
  /**
   * Multiplier on the walk sheet's px scale so the character in attack frame 0 stands as tall as
   * in the walk "down" sheet's first frame (measured from the alpha at load; 1 when unmeasurable).
   */
  readonly figScale: number;
}

/** A one-shot death sheet (see EnemyArt.death). */
export interface DeathSheetRuntime {
  readonly frames: readonly Texture[];
  readonly fps: number;
  /** Feet point (normalised), or null → the walk sheet's / art anchor. */
  readonly anchor: readonly [number, number] | null;
}

export interface EnemyArtRuntime {
  readonly key: string;
  readonly spec: EnemyArt;
  /** Effective mode: "sheet" only when both sequences loaded. */
  readonly mode: AnimMode;
  readonly base: Texture;
  /** Cheap-mode frames (base sprite stands in for any missing file). */
  readonly frames: readonly Texture[];
  /** Per cheap frame: feet anchor (bottom-centre of the alpha bbox), so leg swaps don't jump. */
  readonly frameAnchors: readonly (readonly [number, number])[];
  readonly sheet: SheetRuntime | null;
  /** Back view (walking away) for cheap mode, when the file exists. */
  readonly back: Texture | null;
  readonly backAnchor: readonly [number, number];
  /** Burrower underground mound texture, when the file exists. */
  readonly mound: Texture | null;
  /** Melee attack sheet, when the manifest lists one and it loaded. */
  readonly attack: AttackSheetRuntime | null;
  /** Death sheet, when the manifest lists one and it loaded (null → the puff-only death). */
  readonly death: DeathSheetRuntime | null;
  /** Fallback art: multiply tint / scale applied on top of the enemyMap entry. */
  readonly tintMul: number;
  readonly scaleMul: number;
  /** Art key that stands in while this art is pending (null = own art). */
  readonly fallbackOf: string | null;
  /** Manifest-relative file of the front sprite actually shown (for DOM use, e.g. the codex). */
  readonly frontFile: string;
}

export interface LoadedArt {
  readonly manifest: ArtManifest;
  /** Shared by all scene layers, including art copies with tower fallbacks. */
  readonly map: {
    key: string;
    texture: Texture;
    /** Mounted by the layout's front art key at every resolution. */
    overlays: Readonly<Record<string, Texture>>;
  };
  /** Empty build plot sprite (null when the manifest has none / it failed to load). */
  readonly plot: PlotArtRuntime | null;
  readonly ui: Readonly<Record<keyof UiArt, Texture>>;
  /** Painted UI kit textures that loaded (manifest `uiKit`; missing keys are simply absent). */
  readonly uiKit?: Readonly<Record<string, Texture>>;
  readonly towers: Readonly<Partial<Record<TowerType, TowerArtRuntime>>>;
  readonly enemies: Readonly<Record<string, EnemyArtRuntime>>;
  /** Human-readable fallback notes (missing tiers, frames, sheets). */
  readonly notes: readonly string[];
  /** Manifest-relative paths of every file that loaded (artcheck overlay, tests). */
  readonly present: ReadonlySet<string>;
  /** Directory URL of the manifest (with trailing slash). */
  readonly baseUrl: string;
  /** The run's hero sheets (loaded only for the hero picked for this run), or null. */
  readonly hero?: HeroArtRuntime | null;
}

/** One painted hero sequence (grid sheet): frames, fps, feet anchor (normalised), impact frame. */
export interface HeroSeqRuntime {
  readonly frames: readonly Texture[];
  readonly fps: number;
  readonly anchor: readonly [number, number];
  readonly impact: number | null;
}

/**
 * A hero's in-game art. Every sequence shares the frame size and feet anchor (handoff-codex-hero-art),
 * so one px→world scale (`height` over the idle figure's frame height) holds through attack + death.
 */
export interface HeroArtRuntime {
  readonly id: string;
  readonly spec: HeroArtSpec;
  readonly idle: HeroSeqRuntime;
  /** Walk towards the viewer / away / to screen right (mirror for left). Missing → idle. */
  readonly down: HeroSeqRuntime;
  readonly up: HeroSeqRuntime;
  readonly side: HeroSeqRuntime;
  readonly attack: HeroSeqRuntime | null;
  readonly death: HeroSeqRuntime | null;
  /** Frame height in px the `spec.height` world units map to (figure ≈ 90% of the frame). */
  readonly figurePx: number;
}

const textureCache = new Map<string, Promise<Texture | null>>();
/** Last load failure per texture URL (shown in the boot error so device-only failures are diagnosable). */
const loadErrors = new Map<string, string>();

/**
 * Loads a texture, or null when the file is missing / not an image (never throws). `mips`: build a
 * mip chain (sprites drawn much smaller than their file — map, plots, towers — stay crisp instead
 * of shimmering).
 */
/**
 * Inside the native iOS / Android shell the art is served from the app bundle through a custom
 * scheme (`capacitor://localhost`) that only the page's own requests can reach: Pixi's default
 * worker-side fetch + decode fails there, so every texture (the map first) would fail to load.
 * Decode on the main thread in the native shell; the web keeps the faster worker path.
 */
if (Capacitor.isNativePlatform() && loadTextures.config) loadTextures.config.preferWorkers = false;

function tryTexture(url: string, mips = false): Promise<Texture | null> {
  const cacheKey = mips ? `${url}#mips` : url;
  let p = textureCache.get(cacheKey);
  if (!p) {
    p = (async () => {
      // A burst of ~100 parallel requests at boot can drop a few on weak servers or flaky mobile
      // networks: retry transient failures; a real 404 / HTML fallback still returns null at once.
      for (let attempt = 0; attempt < LOAD_RETRIES; attempt++) {
        try {
          const tex = await Assets.load<Texture>(mips ? { src: url, data: { autoGenerateMipmaps: true } } : url);
          if (!tex) loadErrors.set(url, `${attempt + 1}: Assets.load returned ${String(tex)}`);
          return tex ?? null;
        } catch (err) {
          loadErrors.set(url, `${attempt + 1}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`.slice(0, 160));
          // Only probe failures. Missing optional art (including Vite's 200 HTML fallback)
          // should resolve immediately, while transient failures still get the existing retries.
          if (attempt + 1 === LOAD_RETRIES) break;
          const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
          if (head?.status === 404 || head?.headers.get('content-type')?.includes('text/html')) {
            loadErrors.set(url, `${loadErrors.get(url) ?? ''} | HEAD ${head.status} ${head.headers.get('content-type') ?? ''}`.slice(0, 220));
            return null;
          }
          await sleep(RETRY_BASE_MS * (attempt + 1));
        }
      }
      return null;
    })();
    textureCache.set(cacheKey, p);
  }
  return p;
}

/** Options for the map texture: device px per layout px at the current fit, and (QA) mipmaps. */
export interface MapLoadOptions {
  readonly need?: number;
  readonly maxScale?: number;
  readonly mips?: boolean;
  readonly overlayKeys?: readonly string[];
}

/**
 * Loads the bake of map `mapKey` that suits `need` (see mapVariant.ts). Resolves to null when that
 * file is missing; falls back to the master key when the variant fails.
 */
async function loadMapVariant(
  manifest: ArtManifest,
  baseUrl: string,
  mapKey: string,
  opts: MapLoadOptions,
): Promise<{ key: string; texture: Texture } | null> {
  // The first frame uses at most the master. The larger map and its fronts stream together later.
  const limit = Math.min(MASTER_SCALE, opts.maxScale ?? MASTER_SCALE);
  const key = pickMapVariant(manifest.maps, mapKey, opts.need ?? MASTER_SCALE, limit);
  if (!key) return null;
  const texture = await tryTexture(baseUrl + manifest.maps[key], opts.mips);
  if (texture) return { key, texture };
  if (key === mapKey || limit < MASTER_SCALE || !manifest.maps[mapKey]) return null;
  const master = await tryTexture(baseUrl + manifest.maps[mapKey], opts.mips);
  return master ? { key: mapKey, texture: master } : null;
}

/** Swap an island's map and its matching fronts as one frame, then evict superseded textures. */
export async function changeMapVariant(
  art: LoadedArt, key: string, fronts: readonly string[], mips: boolean,
  stillWanted: () => boolean, show: () => void,
): Promise<void> {
  const { manifest, baseUrl } = art;
  const suffix = (k: string): string => k.endsWith('@3x') ? '@3x' : '';
  const filesFor = (k: string): string[] => [
    manifest.maps[k], ...fronts.map((f) => manifest.overlays[f + suffix(k)]),
  ];
  const oldFiles = filesFor(art.map.key);
  const newFiles = filesFor(key);
  if (newFiles.some((f) => !f)) return;
  const textures = await Promise.all(newFiles.map((f, i) => tryTexture(baseUrl + f, i === 0 ? mips : true)));
  const [map, ...overlays] = textures;
  const apply = map !== null && overlays.every((t) => t !== null) && stillWanted();
  if (apply) {
    art.map.key = key;
    art.map.texture = map;
    art.map.overlays = Object.fromEntries(fronts.map((f, i) => [f, overlays[i]!]));
    show();
  }
  const retained = apply ? newFiles : oldFiles;
  await Promise.all((apply ? oldFiles : newFiles).map(async (file, i) => {
    if (retained.includes(file)) return;
    const url = baseUrl + file;
    textureCache.delete(i > 0 || mips ? url + '#mips' : url);
    if (Assets.cache.has(url)) await Assets.unload(url);
  }));
}

async function tryJson(url: string): Promise<unknown | null> {
  for (let attempt = 0; attempt < LOAD_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      // A dev / preview server may answer a missing file with index.html (200): not retryable.
      if ((res.headers.get('content-type') ?? '').includes('text/html')) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as unknown;
    } catch {
      // transient: retry
    }
    if (attempt + 1 < LOAD_RETRIES) await sleep(RETRY_BASE_MS * (attempt + 1));
  }
  return null;
}

const LOAD_RETRIES = 4;
const RETRY_BASE_MS = 250;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dirOf(url: string): string {
  const i = url.lastIndexOf('/');
  return i >= 0 ? url.slice(0, i + 1) : '';
}

interface LoadedSeq {
  frames: Texture[];
  fps: number;
  anchor: readonly [number, number] | null;
  release: number | null;
  impact: number | null;
  ringW: number | null;
  frameW: number;
  frameH: number;
}

async function loadSheetSeq(base: string, jsonPath: string, mips = false): Promise<LoadedSeq | null> {
  const jsonUrl = base + jsonPath;
  const raw = await tryJson(jsonUrl);
  if (!raw) return null;
  try {
    const sheet = parseSheetJson(raw, jsonPath.slice(jsonPath.lastIndexOf('/') + 1).replace(/\.json$/, '.png'));
    const tex = await tryTexture(dirOf(jsonUrl) + sheet.image, mips);
    if (!tex) return null;
    const frames = sheet.frames.map(
      (f) => new Texture({ source: tex.source, frame: new Rectangle(f.x, f.y, f.w, f.h) }),
    );
    return {
      frames,
      fps: sheet.fps,
      anchor: sheet.anchor,
      release: sheet.release,
      impact: sheet.impact,
      ringW: sheet.ringW,
      frameW: sheet.frames[0].w,
      frameH: sheet.frames[0].h,
    };
  } catch (err) {
    console.warn(`[art2d] bad sheet ${jsonUrl}:`, err);
    return null;
  }
}

let sharedProbeCanvas: HTMLCanvasElement | null = null;
let sharedProbeCtx: CanvasRenderingContext2D | null = null;

function probeContext(w: number, h: number): CanvasRenderingContext2D | null {
  if (!sharedProbeCanvas) {
    sharedProbeCanvas = document.createElement('canvas');
    sharedProbeCtx = sharedProbeCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!sharedProbeCtx || !sharedProbeCanvas) return null;
  sharedProbeCanvas.width = w;
  sharedProbeCanvas.height = h;
  sharedProbeCtx.clearRect(0, 0, w, h);
  return sharedProbeCtx;
}

/** RGBA pixels of a texture's source (null when unreadable). */
function texturePixels(tex: Texture): { data: Uint8ClampedArray; w: number; h: number } | null {
  try {
    const res = tex.source.resource as CanvasImageSource | undefined;
    const w = tex.source.pixelWidth;
    const h = tex.source.pixelHeight;
    if (!res || w <= 0 || h <= 0) return null;
    const ctx = probeContext(w, h);
    if (!ctx) return null;
    ctx.drawImage(res, 0, 0);
    return { data: ctx.getImageData(0, 0, w, h).data, w, h };
  } catch {
    return null;
  }
}

/** Opaque-pixel height (alpha > 40) of one sheet frame, or null when unreadable. */
export function figureHeight(tex: Texture): number | null {
  try {
    const res = tex.source.resource as CanvasImageSource | undefined;
    const f = tex.frame;
    const w = Math.round(f.width);
    const h = Math.round(f.height);
    if (!res || w <= 0 || h <= 0) return null;
    const ctx = probeContext(w, h);
    if (!ctx) return null;
    ctx.drawImage(res, f.x, f.y, w, h, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < h; y++) {
      let any = false;
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 40) {
          any = true;
          break;
        }
      }
      if (any) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    return top < 0 ? null : bottom - top + 1;
  } catch {
    return null;
  }
}

/** A tier's ring: the manifest measurement, or measured from the pixels for "auto". */
function resolveRing(spec: TierRing, tex: Texture | null): RingSpec | null {
  if (spec === null || !tex) return null;
  if (spec !== 'auto') return spec;
  const px = texturePixels(tex);
  return px ? measureRing(px.data, px.w, px.h) : null;
}

/** Ring of a tower sheet in frame px: its anchor (+ ringW), else the tier sprite's ring scaled to the frame. */
function sheetRing(seq: LoadedSeq, tierRing: RingSpec | null, tierTex: Texture | null): RingSpec {
  const k = tierTex && tierTex.width > 0 ? seq.frameW / tierTex.width : 1;
  const width = seq.ringW ?? (tierRing ? tierRing.ringWidthPx * k : seq.frameW);
  if (seq.anchor) return { ringWidthPx: width, ringCenterXPx: seq.anchor[0] * seq.frameW, ringBottomPx: seq.anchor[1] * seq.frameH };
  if (tierRing) return { ringWidthPx: width, ringCenterXPx: tierRing.ringCenterXPx * k, ringBottomPx: tierRing.ringBottomPx * k };
  return { ringWidthPx: width, ringCenterXPx: seq.frameW / 2, ringBottomPx: seq.frameH };
}

/** Feet anchor from the texture's pixels (falls back to the manifest anchor if unreadable). */
function feetAnchor(tex: Texture, fallback: readonly [number, number]): readonly [number, number] {
  try {
    const res = tex.source.resource as CanvasImageSource | undefined;
    const w = tex.source.pixelWidth;
    const h = tex.source.pixelHeight;
    if (!res || w <= 0 || h <= 0) return fallback;
    const ctx = probeContext(w, h);
    if (!ctx) return fallback;
    ctx.drawImage(res, 0, 0);
    return alphaFeetAnchor(ctx.getImageData(0, 0, w, h).data, w, h);
  } catch {
    return fallback;
  }
}

async function loadEnemy(
  base: string,
  key: string,
  spec: EnemyArt,
  notes: string[],
  present: Set<string>,
): Promise<EnemyArtRuntime> {
  const tex = async (path: string): Promise<Texture | null> => {
    const t = await tryTexture(base + path);
    if (t) present.add(path);
    return t;
  };
  const [frontTex, backTex, moundTex, attackSeq, deathSeq, down, up, side] = await Promise.all([
    tex(spec.file),
    spec.back ? tex(spec.back) : null,
    spec.mound ? tex(spec.mound) : null,
    spec.attack ? loadSheetSeq(base, spec.attack) : null,
    spec.death ? loadSheetSeq(base, spec.death) : null,
    spec.sheet ? loadSheetSeq(base, spec.sheet.down) : null,
    spec.sheet ? loadSheetSeq(base, spec.sheet.up) : null,
    spec.sheet?.side ? loadSheetSeq(base, spec.sheet.side) : null,
  ]);
  if (spec.attack) {
    if (attackSeq) present.add(spec.attack);
    else notes.push(`enemy ${key}: attack sheet pending (${spec.attack}) → procedural swing`);
  }
  if (spec.death) {
    if (deathSeq) present.add(spec.death);
    else notes.push(`enemy ${key}: death sheet pending (${spec.death}) → puff only`);
  }
  const death: DeathSheetRuntime | null = deathSeq?.frames.length
    ? { frames: deathSeq.frames, fps: deathSeq.fps, anchor: deathSeq.anchor }
    : null;
  let sheet: SheetRuntime | null = null;
  if (spec.sheet) {
    const sideSpec = spec.sheet.side;
    if (down) present.add(spec.sheet.down);
    if (up) present.add(spec.sheet.up);
    if (side && sideSpec) present.add(sideSpec);
    else if (sideSpec) notes.push(`enemy ${key}: side walk pending (${sideSpec}) → down/up only`);
    if (down && up) {
      const seqs = side?.frames.length ? [down.frames, up.frames, side.frames] : [down.frames, up.frames];
      sheet = { seqs, fps: down.fps, anchor: down.anchor };
    } else if (spec.mode === 'sheet' && (frontTex || down || up)) {
      notes.push(`enemy ${key}: walk sheets pending (${spec.sheet.down}, ${spec.sheet.up}) → cheap mode`);
    }
  }
  let attack: AttackSheetRuntime | null = null;
  if (attackSeq) {
    // Match the figure height of attack frame 0 to the walk "down" sheet (drawn at walkFrameH * 0.94 = art height).
    let figScale = 1;
    const walk0 = sheet?.seqs[0]?.[0];
    const a = figureHeight(attackSeq.frames[0]);
    const w = walk0 ? figureHeight(walk0) : null;
    // figScale multiplies the walk px scale (heightPx / (walkFrameH * 0.94)) applied to attack frames.
    if (a && w && walk0) figScale = w / a;
    attack = { frames: attackSeq.frames, fps: attackSeq.fps, anchor: attackSeq.anchor, impact: attackSeq.impact, figScale };
  }
  // A sheet-only enemy (no front file yet) still needs a base sprite: its first walk frame.
  const baseTex = frontTex ?? sheet?.seqs[0]?.[0] ?? Texture.WHITE;
  const frames: Texture[] = [];
  if (spec.frames && spec.frames.length > 0 && frontTex) {
    const loaded = await Promise.all(spec.frames.map((f) => tex(f)));
    const missing = spec.frames.filter((_, i) => !loaded[i]);
    if (missing.length > 0) notes.push(`enemy ${key}: frames pending (${[...new Set(missing)].join(', ')}) → base sprite`);
    for (const t of loaded) frames.push(t ?? baseTex);
  } else {
    frames.push(baseTex);
  }
  const anchorCache = new Map<Texture, readonly [number, number]>();
  const anchorOf = (t: Texture): readonly [number, number] => {
    let a = anchorCache.get(t);
    if (!a) {
      a = t === Texture.WHITE ? spec.anchor : feetAnchor(t, spec.anchor);
      anchorCache.set(t, a);
    }
    return a;
  };
  const frameAnchors = frames.map(anchorOf);
  const mode: AnimMode = spec.mode === 'sheet' && sheet ? 'sheet' : 'cheap';
  return {
    key,
    spec,
    mode,
    base: baseTex,
    frames,
    frameAnchors,
    sheet,
    back: backTex,
    backAnchor: backTex ? anchorOf(backTex) : spec.anchor,
    mound: moundTex,
    attack,
    death,
    tintMul: 0xffffff,
    scaleMul: 1,
    fallbackOf: null,
    frontFile: spec.file,
  };
}

async function loadTower(
  base: string,
  spec: TowerArt,
  present: Set<string>,
): Promise<TowerArtRuntime & { hasArt: boolean }> {
  const loaded = await Promise.all(
    spec.tiers.map(async (f, i) => {
      // Ring-convention art is drawn much smaller than its file: mipmapped.
      const t = await tryTexture(base + f, spec.ring[i] !== null);
      if (t) present.add(f);
      return t;
    }),
  );
  const has = loaded.map((t) => t !== null);
  const tiers: Texture[] = [];
  const tierFiles: (string | null)[] = [];
  const rings: (RingSpec | null)[] = [];
  for (let tier = 1; tier <= 3; tier++) {
    const idx = pickTier(has, tier);
    const tex = idx >= 0 ? loaded[idx] : null;
    tiers.push(tex ?? Texture.WHITE);
    tierFiles.push(idx >= 0 ? spec.tiers[idx] : null);
    rings.push(idx >= 0 ? resolveRing(spec.ring[idx] ?? null, tex) : null);
  }
  // Painted attack / idle sheets per tier (optional; absent → static sprite + procedural kick).
  const sheets = async (paths: readonly (string | null)[]): Promise<(TowerSheetRuntime | null)[]> =>
    Promise.all(
      [0, 1, 2].map(async (i) => {
        const p = paths[i];
        if (!p) return null;
        const seq = await loadSheetSeq(base, p, true);
        if (!seq) return null;
        present.add(p);
        const ring = sheetRing(seq, rings[i], tiers[i] === Texture.WHITE ? null : tiers[i]);
        return { frames: seq.frames, fps: seq.fps, release: seq.release, ring, frameW: seq.frameW, frameH: seq.frameH };
      }),
    );
  const [attack, idle, turrets] = await Promise.all([sheets(spec.attack), sheets(spec.idle), loadTurrets(base, spec, present)]);
  return {
    spec,
    tiers,
    tierFiles,
    tint: 0xffffff,
    fallbackOf: null,
    rings,
    attack,
    idle,
    turrets,
    hasArt: has.some(Boolean),
  };
}

/**
 * Per tier: the turret JSON, its 5-frame strip and its body sprite. Any part missing / unreadable
 * → null for that tier (the tower then draws its full `tiers` sprite as before).
 */
async function loadTurrets(
  base: string,
  spec: TowerArt,
  present: Set<string>,
): Promise<(TurretRuntime | null)[]> {
  return Promise.all(
    [0, 1, 2].map(async (i) => {
      const jsonPath = spec.turret[i];
      if (!jsonPath) return null;
      const raw = await tryJson(base + jsonPath);
      if (!raw) return null;
      let ts: TurretSpec;
      try {
        ts = parseTurretJson(raw, jsonPath.slice(jsonPath.lastIndexOf('/') + 1).replace(/\.json$/, '.webp'));
      } catch (err) {
        console.warn(`[art2d] bad turret ${jsonPath}:`, err);
        return null;
      }
      const dir = dirOf(jsonPath);
      const bodyFile = spec.body[i] ?? (ts.body ? dir + ts.body : null);
      if (!bodyFile) return null;
      const [strip, body] = await Promise.all([tryTexture(base + dir + ts.image, true), tryTexture(base + bodyFile, true)]);
      if (!strip || !body) return null;
      const ring = ts.bodyRing ?? resolveRing('auto', body);
      if (!ring) return null;
      present.add(jsonPath);
      present.add(dir + ts.image);
      present.add(bodyFile);
      const frames = TURRET_DIRS.map(
        (_, f) => new Texture({ source: strip.source, frame: new Rectangle(f * ts.frameW, 0, ts.frameW, ts.frameH) }),
      );
      return { spec: ts, frames, body, bodyFile, ring };
    }),
  );
}

function heroSeq(seq: LoadedSeq): HeroSeqRuntime {
  return { frames: seq.frames, fps: seq.fps, anchor: seq.anchor ?? [0.5, 0.977], impact: seq.impact };
}

/** Loads one hero's sheets (null when the manifest has no usable idle / standing art for it). */
export async function loadHeroArt(manifest: ArtManifest, base: string, heroId: string, present?: Set<string>, notes?: string[]): Promise<HeroArtRuntime | null> {
  const spec = manifest.heroes?.[heroId];
  if (!spec) return null;
  const seq = async (p: string | null): Promise<LoadedSeq | null> => {
    if (!p) return null;
    const r = await loadSheetSeq(base, p, true);
    if (r) present?.add(p);
    else notes?.push(`hero ${heroId}: sheet ${p} missing`);
    return r;
  };
  const [idle, down, up, side, attack, death, standing] = await Promise.all([
    seq(spec.idle),
    seq(spec.walk?.down ?? null),
    seq(spec.walk?.up ?? null),
    seq(spec.walk?.side ?? null),
    seq(spec.attack),
    seq(spec.death),
    spec.file ? tryTexture(base + spec.file, true) : Promise.resolve(null),
  ]);
  let idleRt: HeroSeqRuntime | null = idle ? heroSeq(idle) : null;
  if (!idleRt && standing) idleRt = { frames: [standing], fps: 1, anchor: [0.5, 0.977], impact: null };
  if (!idleRt) {
    notes?.push(`hero ${heroId}: no idle art`);
    return null;
  }
  const walkDown = down ? heroSeq(down) : idleRt;
  const frameH = idle?.frameH ?? idleRt.frames[0].height;
  return {
    id: heroId,
    spec,
    idle: idleRt,
    down: walkDown,
    up: up ? heroSeq(up) : walkDown,
    side: side ? heroSeq(side) : walkDown,
    attack: attack ? heroSeq(attack) : null,
    death: death ? heroSeq(death) : null,
    figurePx: frameH * 0.9,
  };
}

/**
 * Loads public/art2d/manifest.json and everything it references for one map. Missing optional
 * files fall back (see manifest.ts); a missing manifest or map throws.
 */
export async function loadArt(
  manifestUrl: string,
  mapKey: string,
  variants: Readonly<Record<string, string | null>> = {},
  mapOpts: MapLoadOptions = {},
  heroId: string | null = null,
  onManifest?: (manifest: ArtManifest) => void,
  onProgress?: (fraction: number) => void,
): Promise<LoadedArt> {
  const raw = await tryJson(manifestUrl);
  if (!raw) throw new Error(`art manifest not found: ${manifestUrl}`);
  let manifest = parseManifest(raw);
  for (const [base, variant] of Object.entries(variants)) manifest = withArtVariant(manifest, base, variant);
  bootPhase('manifest');
  onManifest?.(manifest);
  const base = dirOf(manifestUrl);
  const notes: string[] = [];
  const present = new Set<string>();
  const mapFile = manifest.maps[mapKey];
  if (!mapFile) throw new Error(`map ${mapKey} is not in the art manifest`);

  const uiKeys = Object.keys(manifest.ui) as (keyof UiArt)[];
  const kitEntries = Object.entries(manifest.uiKit ?? {});
  const plotSpec = manifest.plot;
  const overlayKeys = mapOpts.overlayKeys ?? Object.keys(manifest.overlays).filter((key) => !key.endsWith('@3x'));
  // All jobs are registered synchronously below, before the first one can settle.
  let total = 0;
  let done = 0;
  const track = async <T>(job: Promise<T>): Promise<T> => {
    total++;
    const result = await job;
    onProgress?.(++done / total);
    return result;
  };
  const [mapRes, plotTex, uiTex, kitTex, towerList, enemyList, overlayTex, hero] = await Promise.all([
    track(loadMapVariant(manifest, base, mapKey, mapOpts)),
    track(plotSpec ? tryTexture(base + plotSpec.file, true) : Promise.resolve(null)),
    Promise.all(uiKeys.map((k) => track(tryTexture(base + manifest.ui[k])))),
    Promise.all(kitEntries.map(([, f]) => track(tryTexture(base + f, true)))),
    Promise.all(
      Object.entries(manifest.towers).map(
        async ([type, spec]) => [type, await track(loadTower(base, spec as TowerArt, present))] as const,
      ),
    ),
    Promise.all(
      Object.entries(manifest.enemies).map(
        async ([key, spec]) => [key, await track(loadEnemy(base, key, spec, notes, present))] as const,
      ),
    ),
    // Gate front layers are drawn smaller than their file on phones: mipmapped.
    Promise.all(overlayKeys.map((k) => track(tryTexture(base + manifest.overlays[k], true)))),
    track(heroId ? loadHeroArt(manifest, base, heroId, present, notes) : Promise.resolve(null)),
  ]);
  bootPhase('load-textures-and-sheets');
  if (!mapRes) {
    const why = [...loadErrors].filter(([u]) => u.includes(mapKey)).map(([u, e]) => `${u.split('/').pop()} → ${e}`).join(' ; ');
    throw new Error(`map image failed to load: ${mapFile}${why ? ` (${why})` : ''}`);
  }
  const map = mapRes.texture;
  present.add(manifest.maps[mapRes.key]);
  const overlays: Record<string, Texture> = {};
  overlayKeys.forEach((k, i) => {
    const t = overlayTex[i];
    if (t) {
      overlays[k] = t;
      present.add(manifest.overlays[k]);
    } else notes.push(`overlay ${k}: ${manifest.overlays[k]} missing`);
  });
  if (plotSpec && plotTex) present.add(plotSpec.file);
  else if (plotSpec) notes.push(`plot sprite ${plotSpec.file} missing → plots not drawn`);
  const plot: PlotArtRuntime | null = plotSpec && plotTex ? { texture: plotTex, ring: plotSpec.ring } : null;
  const ui = Object.fromEntries(uiKeys.map((k, i) => [k, uiTex[i] ?? Texture.WHITE])) as Record<keyof UiArt, Texture>;
  const uiKit: Record<string, Texture> = {};
  kitEntries.forEach(([k, f], i) => {
    const t = kitTex[i];
    if (t) {
      uiKit[k] = t;
      present.add(f);
    } else notes.push(`ui kit ${k}: ${f} missing → core ui art`);
  });
  const has = (p: string): boolean => present.has(p);

  // Enemies whose art has not landed yet draw a tinted raider / brute / kite (manifest fallback).
  const ownEnemies = Object.fromEntries(enemyList) as Record<string, EnemyArtRuntime>;
  const enemies: Record<string, EnemyArtRuntime> = {};
  for (const [key, rt] of Object.entries(ownEnemies)) {
    if (enemyHasArt(rt.spec, has)) {
      enemies[key] = rt;
      continue;
    }
    const res = resolveEnemyArt(manifest, key, has);
    const target = ownEnemies[res.key];
    if (!res.own && target) {
      enemies[key] = { ...target, key, tintMul: res.tint, scaleMul: res.scale, fallbackOf: res.key };
      notes.push(`enemy ${key}: art pending → tinted ${res.key}`);
    } else {
      enemies[key] = rt;
      notes.push(`enemy ${key}: ${rt.spec.file} missing`);
    }
  }

  // Towers with no tier file yet draw a tinted similar tower.
  const ownTowers = Object.fromEntries(towerList) as Record<string, TowerArtRuntime & { hasArt: boolean }>;
  const towers: Partial<Record<TowerType, TowerArtRuntime>> = {};
  for (const [type, rt] of Object.entries(ownTowers)) {
    let out: TowerArtRuntime = rt;
    if (!rt.hasArt) {
      const res = resolveTowerTiers(manifest, type, has);
      const src = ownTowers[res.source];
      if (!res.own && src) {
        out = {
          spec: rt.spec,
          tiers: src.tiers,
          tierFiles: res.tierFiles,
          tint: mulTint(src.tint, res.tint),
          fallbackOf: res.source,
          rings: src.rings,
          attack: [null, null, null],
          idle: [null, null, null],
          turrets: [null, null, null],
        };
        notes.push(`tower ${type}: art pending → tinted ${res.source}`);
      } else {
        notes.push(`tower ${type}: art missing`);
      }
    } else {
      rt.tierFiles.forEach((f, i) => {
        if (i > 0 && f !== rt.spec.tiers[i]) notes.push(`tower ${type}: T${i + 1} art pending → ${f ?? 'none'}`);
      });
    }
    towers[type as TowerType] = out;
  }
  // Release pixel-probe scratch buffer once art loading finishes.
  if (sharedProbeCanvas) {
    sharedProbeCanvas.width = 1;
    sharedProbeCanvas.height = 1;
  }
  return { manifest, map: { key: mapRes.key, texture: map, overlays }, plot, ui, uiKit, towers, enemies, notes, present, baseUrl: base, hero };
}

/**
 * Collects every unique `TextureSource` referenced by `LoadedArt` (map, overlays, plot, UI kit,
 * all tower tiers/sheets/turrets, and all enemy walk/attack sheets) for ahead-of-wave GPU upload.
 */
export function collectArtTextureSources(
  art: LoadedArt, enemyKeys: Iterable<string> = [], combatTextures: readonly Texture[] = [],
): TextureSource[] {
  const seen = new Set<TextureSource>();
  const add = (tex: Texture | null | undefined): void => {
    if (!tex || tex === Texture.EMPTY) return;
    seen.add(tex.source);
  };
  const addList = (list: readonly (Texture | null | undefined)[] | undefined): void => {
    if (!list) return;
    for (let i = 0; i < list.length; i++) add(list[i]);
  };
  const addEnemy = (en: EnemyArtRuntime): void => {
    if (en.sheet) for (const seq of en.sheet.seqs) addList(seq);
    add(en.base);
    addList(en.frames);
    add(en.back);
    add(en.mound);
    addList(en.attack?.frames);
    addList(en.death?.frames);
  };
  for (const key of enemyKeys) if (art.enemies[key]) addEnemy(art.enemies[key]);
  // Cover every build choice at tier I before warming upgrades.
  for (let tier = 0; tier < 3; tier++) {
    for (const tw of Object.values(art.towers)) {
      if (!tw) continue;
      add(tw.tiers[tier]);
      addList(tw.attack[tier]?.frames);
      addList(tw.idle[tier]?.frames);
      const turret = tw.turrets?.[tier];
      add(turret?.body);
      addList(turret?.frames);
    }
  }
  addList(combatTextures);
  for (const en of Object.values(art.enemies)) addEnemy(en);
  add(art.map.texture);
  add(art.plot?.texture);
  for (const t of Object.values(art.map.overlays)) add(t);
  for (const t of Object.values(art.ui)) add(t);
  if (art.uiKit) for (const t of Object.values(art.uiKit)) add(t);
  const h = art.hero;
  if (h) for (const sq of [h.idle, h.down, h.up, h.side, h.attack, h.death]) addList(sq?.frames);
  return [...seen];
}
