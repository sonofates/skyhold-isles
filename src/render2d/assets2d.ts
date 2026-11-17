import { Assets, Rectangle, Texture } from 'pixi.js';
import type { TowerType } from '../core/types.ts';
import { alphaFeetAnchor } from './alphaBox.ts';
import {
  parseManifest,
  parseSheetJson,
  towerTierIndex,
  withArtVariant,
  type AnimMode,
  type ArtManifest,
  type EnemyArt,
  type TowerArt,
  type UiArt,
} from './manifest.ts';

/** Runtime art after loading: every slot holds a texture (fallbacks applied). */
export interface TowerArtRuntime {
  readonly spec: TowerArt;
  /** Texture per tier 1..3 (index 0..2), missing tiers reuse the highest loaded earlier tier. */
  readonly tiers: readonly Texture[];
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
}

export interface LoadedArt {
  readonly manifest: ArtManifest;
  readonly map: Texture;
  readonly ui: Readonly<Record<keyof UiArt, Texture>>;
  readonly towers: Readonly<Partial<Record<TowerType, TowerArtRuntime>>>;
  readonly enemies: Readonly<Record<string, EnemyArtRuntime>>;
  /** Human-readable fallback notes (missing tiers, frames, sheets). */
  readonly notes: readonly string[];
}

const textureCache = new Map<string, Promise<Texture | null>>();

/** Loads a texture, or null when the file is missing / not an image (never throws). */
function tryTexture(url: string): Promise<Texture | null> {
  let p = textureCache.get(url);
  if (!p) {
    p = (async () => {
      try {
        // Probe first: a dev/preview server may answer a missing file with index.html (200).
        const head = await fetch(url, { method: 'HEAD' });
        const type = head.headers.get('content-type') ?? '';
        if (!head.ok || type.includes('text/html')) return null;
        const tex = await Assets.load<Texture>(url);
        return tex ?? null;
      } catch {
        return null;
      }
    })();
    textureCache.set(url, p);
  }
  return p;
}

async function tryJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function dirOf(url: string): string {
  const i = url.lastIndexOf('/');
  return i >= 0 ? url.slice(0, i + 1) : '';
}

async function loadSheetSeq(base: string, jsonPath: string): Promise<{ frames: Texture[]; fps: number; anchor: readonly [number, number] | null } | null> {
  const jsonUrl = base + jsonPath;
  const raw = await tryJson(jsonUrl);
  if (!raw) return null;
  try {
    const sheet = parseSheetJson(raw, jsonPath.slice(jsonPath.lastIndexOf('/') + 1).replace(/\.json$/, '.png'));
    const tex = await tryTexture(dirOf(jsonUrl) + sheet.image);
    if (!tex) return null;
    const frames = sheet.frames.map(
      (f) => new Texture({ source: tex.source, frame: new Rectangle(f.x, f.y, f.w, f.h) }),
    );
    return { frames, fps: sheet.fps, anchor: sheet.anchor };
  } catch (err) {
    console.warn(`[art2d] bad sheet ${jsonUrl}:`, err);
    return null;
  }
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

async function loadEnemy(base: string, key: string, spec: EnemyArt, notes: string[]): Promise<EnemyArtRuntime> {
  const baseTex = (await tryTexture(base + spec.file)) ?? Texture.WHITE;
  if (baseTex === Texture.WHITE) notes.push(`enemy ${key}: ${spec.file} missing`);
  const frames: Texture[] = [];
  if (spec.frames && spec.frames.length > 0) {
    const loaded = await Promise.all(spec.frames.map((f) => tryTexture(base + f)));
    const missing = spec.frames.filter((_, i) => !loaded[i]);
    if (missing.length > 0) notes.push(`enemy ${key}: frames pending (${[...new Set(missing)].join(', ')}) → base sprite`);
    for (const t of loaded) frames.push(t ?? baseTex);
  } else {
    frames.push(baseTex);
  }
  const anchorCache = new Map<Texture, readonly [number, number]>();
  const frameAnchors = frames.map((t) => {
    let a = anchorCache.get(t);
    if (!a) {
      a = t === Texture.WHITE ? spec.anchor : feetAnchor(t, spec.anchor);
      anchorCache.set(t, a);
    }
    return a;
  });
  let sheet: SheetRuntime | null = null;
  if (spec.sheet) {
    const [down, up] = await Promise.all([loadSheetSeq(base, spec.sheet.down), loadSheetSeq(base, spec.sheet.up)]);
    if (down && up) {
      sheet = { seqs: [down.frames, up.frames], fps: down.fps, anchor: down.anchor };
    } else if (spec.mode === 'sheet') {
      notes.push(`enemy ${key}: walk sheets pending (${spec.sheet.down}, ${spec.sheet.up}) → cheap mode`);
    }
  }
  const mode: AnimMode = spec.mode === 'sheet' && sheet ? 'sheet' : 'cheap';
  return { key, spec, mode, base: baseTex, frames, frameAnchors, sheet };
}

async function loadTower(base: string, type: string, spec: TowerArt, notes: string[]): Promise<TowerArtRuntime> {
  const loaded = await Promise.all(spec.tiers.map((f) => tryTexture(base + f)));
  const ok = loaded.map((t) => t !== null);
  const tiers: Texture[] = [];
  for (let tier = 1; tier <= 3; tier++) {
    const idx = towerTierIndex(ok, tier);
    tiers.push(loaded[idx] ?? Texture.WHITE);
    if (tier > 1 && idx < tier - 1) notes.push(`tower ${type}: T${tier} art pending → T${idx + 1}`);
  }
  return { spec, tiers };
}

/**
 * Loads public/art2d/manifest.json and everything it references for one map. Missing optional
 * files fall back (see manifest.ts); a missing manifest or map throws.
 */
export async function loadArt(
  manifestUrl: string,
  mapKey: string,
  variants: Readonly<Record<string, string | null>> = {},
): Promise<LoadedArt> {
  const raw = await tryJson(manifestUrl);
  if (!raw) throw new Error(`art manifest not found: ${manifestUrl}`);
  let manifest = parseManifest(raw);
  for (const [base, variant] of Object.entries(variants)) manifest = withArtVariant(manifest, base, variant);
  const base = dirOf(manifestUrl);
  const notes: string[] = [];
  const mapFile = manifest.maps[mapKey];
  if (!mapFile) throw new Error(`map ${mapKey} is not in the art manifest`);

  const uiKeys = Object.keys(manifest.ui) as (keyof UiArt)[];
  const [map, uiTex, towerList, enemyList] = await Promise.all([
    tryTexture(base + mapFile),
    Promise.all(uiKeys.map((k) => tryTexture(base + manifest.ui[k]))),
    Promise.all(
      Object.entries(manifest.towers).map(
        async ([type, spec]) => [type, await loadTower(base, type, spec as TowerArt, notes)] as const,
      ),
    ),
    Promise.all(
      Object.entries(manifest.enemies).map(async ([key, spec]) => [key, await loadEnemy(base, key, spec, notes)] as const),
    ),
  ]);
  if (!map) throw new Error(`map image failed to load: ${mapFile}`);
  const ui = Object.fromEntries(uiKeys.map((k, i) => [k, uiTex[i] ?? Texture.WHITE])) as Record<keyof UiArt, Texture>;
  return {
    manifest,
    map,
    ui,
    towers: Object.fromEntries(towerList) as Partial<Record<TowerType, TowerArtRuntime>>,
    enemies: Object.fromEntries(enemyList),
    notes,
  };
}
