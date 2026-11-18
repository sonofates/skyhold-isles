import { Assets, Rectangle, Texture } from 'pixi.js';
import type { TowerType } from '../core/types.ts';
import { alphaFeetAnchor } from './alphaBox.ts';
import { enemyHasArt, mulTint, pickTier, resolveEnemyArt, resolveTowerTiers } from './artResolve.ts';
import { pickMapVariant } from './mapVariant.ts';
import { measureRing, type RingSpec } from './towerFit.ts';
import { parseTurretJson, TURRET_DIRS, type TurretSpec } from './turret.ts';
import {
  parseManifest,
  parseSheetJson,
  withArtVariant,
  type AnimMode,
  type ArtManifest,
  type EnemyArt,
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
  /** [down, up] frame sequences. */
  readonly seqs: readonly (readonly Texture[])[];
  readonly fps: number;
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
  readonly map: Texture;
  /** Manifest maps key of the bake that was loaded (a resolution variant of the level's map). */
  readonly mapKey: string;
  /** Map overlays (gate front layers) by manifest `overlays` key; missing files are absent. */
  readonly overlays: Readonly<Record<string, Texture>>;
  /** Empty build plot sprite (null when the manifest has none / it failed to load). */
  readonly plot: PlotArtRuntime | null;
  readonly ui: Readonly<Record<keyof UiArt, Texture>>;
  readonly towers: Readonly<Partial<Record<TowerType, TowerArtRuntime>>>;
  readonly enemies: Readonly<Record<string, EnemyArtRuntime>>;
  /** Human-readable fallback notes (missing tiers, frames, sheets). */
  readonly notes: readonly string[];
  /** Manifest-relative paths of every file that loaded (artcheck overlay, tests). */
  readonly present: ReadonlySet<string>;
  /** Directory URL of the manifest (with trailing slash). */
  readonly baseUrl: string;
}

const textureCache = new Map<string, Promise<Texture | null>>();

/**
 * Loads a texture, or null when the file is missing / not an image (never throws). `mips`: build a
 * mip chain (sprites drawn much smaller than their file — map, plots, towers — stay crisp instead
 * of shimmering).
 */
function tryTexture(url: string, mips = false): Promise<Texture | null> {
  const cacheKey = mips ? `${url}#mips` : url;
  let p = textureCache.get(cacheKey);
  if (!p) {
    p = (async () => {
      // A burst of ~100 parallel requests at boot can drop a few on weak servers or flaky mobile
      // networks: retry transient failures; a real 404 / HTML fallback still returns null at once.
      for (let attempt = 0; attempt < LOAD_RETRIES; attempt++) {
        try {
          // Probe first: a dev/preview server may answer a missing file with index.html (200).
          const head = await fetch(url, { method: 'HEAD' });
          const type = head.headers.get('content-type') ?? '';
          if (head.status === 404 || type.includes('text/html')) return null;
          if (!head.ok) throw new Error(`HTTP ${head.status}`);
          const tex = await Assets.load<Texture>(mips ? { src: url, data: { autoGenerateMipmaps: true } } : url);
          if (tex) return tex;
        } catch {
          // transient: fall through to the retry
        }
        await sleep(RETRY_BASE_MS * (attempt + 1));
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
  readonly mips?: boolean;
}

/**
 * Loads the bake of map `mapKey` that suits `need` (see mapVariant.ts). Resolves to null when that
 * file is missing; falls back to the master key when the variant fails.
 */
export async function loadMapVariant(
  manifest: ArtManifest,
  baseUrl: string,
  mapKey: string,
  opts: MapLoadOptions = {},
): Promise<{ key: string; texture: Texture } | null> {
  const key = pickMapVariant(manifest.maps, mapKey, opts.need ?? 2) ?? mapKey;
  const file = manifest.maps[key];
  if (file) {
    const tex = await tryTexture(baseUrl + file, opts.mips === true);
    if (tex) return { key, texture: tex };
  }
  const master = manifest.maps[mapKey];
  if (!master || key === mapKey) return null;
  const tex = await tryTexture(baseUrl + master, opts.mips === true);
  return tex ? { key: mapKey, texture: tex } : null;
}

async function tryJson(url: string): Promise<unknown | null> {
  for (let attempt = 0; attempt < LOAD_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as unknown;
    } catch {
      // transient: retry
    }
    await sleep(RETRY_BASE_MS * (attempt + 1));
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
      ringW: sheet.ringW,
      frameW: sheet.frames[0].w,
      frameH: sheet.frames[0].h,
    };
  } catch (err) {
    console.warn(`[art2d] bad sheet ${jsonUrl}:`, err);
    return null;
  }
}

/** RGBA pixels of a texture's source (null when unreadable). */
function texturePixels(tex: Texture): { data: Uint8ClampedArray; w: number; h: number } | null {
  try {
    const res = tex.source.resource as CanvasImageSource | undefined;
    const w = tex.source.pixelWidth;
    const h = tex.source.pixelHeight;
    if (!res || w <= 0 || h <= 0) return null;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(res, 0, 0);
    return { data: ctx.getImageData(0, 0, w, h).data, w, h };
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
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
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
  const [frontTex, backTex, moundTex] = await Promise.all([
    tex(spec.file),
    spec.back ? tex(spec.back) : Promise.resolve(null),
    spec.mound ? tex(spec.mound) : Promise.resolve(null),
  ]);
  let sheet: SheetRuntime | null = null;
  if (spec.sheet) {
    const [down, up] = await Promise.all([loadSheetSeq(base, spec.sheet.down), loadSheetSeq(base, spec.sheet.up)]);
    if (down) present.add(spec.sheet.down);
    if (up) present.add(spec.sheet.up);
    if (down && up) {
      sheet = { seqs: [down.frames, up.frames], fps: down.fps, anchor: down.anchor };
    } else if (spec.mode === 'sheet' && (frontTex || down || up)) {
      notes.push(`enemy ${key}: walk sheets pending (${spec.sheet.down}, ${spec.sheet.up}) → cheap mode`);
    }
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

/**
 * Loads public/art2d/manifest.json and everything it references for one map. Missing optional
 * files fall back (see manifest.ts); a missing manifest or map throws.
 */
export async function loadArt(
  manifestUrl: string,
  mapKey: string,
  variants: Readonly<Record<string, string | null>> = {},
  mapOpts: MapLoadOptions = {},
): Promise<LoadedArt> {
  const raw = await tryJson(manifestUrl);
  if (!raw) throw new Error(`art manifest not found: ${manifestUrl}`);
  let manifest = parseManifest(raw);
  for (const [base, variant] of Object.entries(variants)) manifest = withArtVariant(manifest, base, variant);
  const base = dirOf(manifestUrl);
  const notes: string[] = [];
  const present = new Set<string>();
  const mapFile = manifest.maps[mapKey];
  if (!mapFile) throw new Error(`map ${mapKey} is not in the art manifest`);

  const uiKeys = Object.keys(manifest.ui) as (keyof UiArt)[];
  const plotSpec = manifest.plot;
  const overlayKeys = Object.keys(manifest.overlays);
  const [mapRes, plotTex, uiTex, towerList, enemyList, overlayTex] = await Promise.all([
    loadMapVariant(manifest, base, mapKey, mapOpts),
    plotSpec ? tryTexture(base + plotSpec.file, true) : Promise.resolve(null),
    Promise.all(uiKeys.map((k) => tryTexture(base + manifest.ui[k]))),
    Promise.all(
      Object.entries(manifest.towers).map(
        async ([type, spec]) => [type, await loadTower(base, spec as TowerArt, present)] as const,
      ),
    ),
    Promise.all(
      Object.entries(manifest.enemies).map(
        async ([key, spec]) => [key, await loadEnemy(base, key, spec, notes, present)] as const,
      ),
    ),
    // Gate front layers are drawn smaller than their file on phones: mipmapped.
    Promise.all(overlayKeys.map((k) => tryTexture(base + manifest.overlays[k], true))),
  ]);
  if (!mapRes) throw new Error(`map image failed to load: ${mapFile}`);
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
  return { manifest, map, mapKey: mapRes.key, overlays, plot, ui, towers, enemies, notes, present, baseUrl: base };
}
