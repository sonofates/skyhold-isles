import type { EnemyType, TowerType } from '../core/types.ts';

/**
 * public/art2d/manifest.json — drives every sprite the 2D renderer draws (pure types + parsing; no
 * Pixi so it is unit-testable). File paths are relative to the manifest. A file that is missing
 * or fails to decode falls back (tier N → tier N-1 → T1, extra walk frames → the base sprite,
 * walk sheets → the cheap mode), so art can be dropped in without code changes.
 */
export interface ArtManifest {
  readonly version: number;
  /** Map art key (Level2DLayout.image) → file. */
  readonly maps: Readonly<Record<string, string>>;
  readonly ui: UiArt;
  readonly towers: Readonly<Partial<Record<TowerType, TowerArt>>>;
  /** Tower types offered in the build ring, in ring order. */
  readonly buildRing: readonly TowerType[];
  readonly enemies: Readonly<Record<string, EnemyArt>>;
  /** Sim enemy type → art (+ optional tint / scale); `*` is the fallback for unmapped types. */
  readonly enemyMap: Readonly<Record<string, EnemyMapEntry>>;
}

export interface UiArt {
  readonly plaque: string;
  readonly banner: string;
  readonly button: string;
  readonly horn: string;
  readonly heart: string;
  readonly gold: string;
}

export interface TowerArt {
  /** Sprite per tier (index 0 = T1). Missing tiers reuse the highest earlier tier. */
  readonly tiers: readonly string[];
  /** On-screen height in world units (1 unit = Level2DLayout.pxPerUnit map px). */
  readonly height: number;
  /** Sprite anchor; y is where the plot centre sits on the image (the stone base). */
  readonly anchor: readonly [number, number];
  /** Mirror the sprite to face targets on the left (art faces left/right symmetric otherwise). */
  readonly flipToTarget: boolean;
  /** Projectile launch height in world units. */
  readonly muzzle: number;
  /** Art faces this way in the file. */
  readonly facing: 'left' | 'right';
}

export type AnimMode = 'cheap' | 'sheet';

export interface CheapWalkSpec {
  /** Vertical hop per step, world units. */
  readonly bob: number;
  /** Squash/stretch amount (0.06 = ±6 %). */
  readonly squash: number;
  /** Lean into movement, radians at full speed. */
  readonly lean: number;
  /** World units travelled per full stride (two steps). */
  readonly stride: number;
  /** Side-to-side rock, radians. */
  readonly rock: number;
}

export interface SheetSpec {
  /** Walking toward the camera (screen-down), and away (screen-up). JSON paths (see SheetJson). */
  readonly down: string;
  readonly up: string;
  /** Direction the walk faces in the sheet; the other side is mirrored. */
  readonly facing: 'left' | 'right';
  /** World units per animation loop (keeps feet planted); falls back to the sheet's fps. */
  readonly stride?: number;
}

export interface EnemyArt {
  readonly mode: AnimMode;
  /** Base painted sprite (cheap mode, and the fallback for a sheet that fails to load). */
  readonly file: string;
  /** Optional extra leg-swap frames for cheap mode, cycled with the stride (base sprite first). */
  readonly frames?: readonly string[];
  readonly sheet?: SheetSpec;
  readonly height: number;
  readonly anchor: readonly [number, number];
  readonly facing: 'left' | 'right';
  readonly cheap: CheapWalkSpec;
  /** Shadow radius in world units. */
  readonly shadow: number;
}

export interface EnemyMapEntry {
  readonly art: string;
  /** 0xRRGGBB tint (multiply). */
  readonly tint?: number;
  readonly scale?: number;
}

/**
 * Sprite sheet JSON. Either a simple grid
 *   { "image": "raider-walk-down.png", "frameW": 256, "frameH": 256, "count": 8, "fps": 12, "cols": 4 }
 * or the Pixi/TexturePacker format ({ "frames": {...}, "meta": { "image": ... }, "animations"? }) plus
 * an optional top-level "fps".
 */
export interface GridSheetJson {
  readonly image?: string;
  readonly frameW: number;
  readonly frameH: number;
  readonly count: number;
  readonly fps: number;
  readonly cols?: number;
  /** Feet point: frame px, or normalised when both values are <= 1. */
  readonly anchor?: readonly [number, number];
}

export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ParsedSheet {
  readonly image: string;
  readonly frames: readonly FrameRect[];
  readonly fps: number;
  readonly anchor: readonly [number, number] | null;
}

const DEFAULT_CHEAP: CheapWalkSpec = { bob: 0.07, squash: 0.06, lean: 0.12, stride: 1.1, rock: 0.06 };

export class ManifestError extends Error {}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new ManifestError(`${what} must be a non-empty string`);
  return v;
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function pair(v: unknown, fallback: readonly [number, number]): readonly [number, number] {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
    return [v[0], v[1]];
  }
  return fallback;
}

function facing(v: unknown): 'left' | 'right' {
  return v === 'left' ? 'left' : 'right';
}

function tint(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v)) return parseInt(v.replace('#', ''), 16);
  return undefined;
}

type Json = Record<string, unknown>;

function obj(v: unknown, what: string): Json {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ManifestError(`${what} must be an object`);
  return v as Json;
}

export function parseManifest(raw: unknown): ArtManifest {
  const m = obj(raw, 'manifest');
  const ui = obj(m.ui, 'ui');
  const towersIn = obj(m.towers, 'towers');
  const towers: Partial<Record<TowerType, TowerArt>> = {};
  for (const [type, v] of Object.entries(towersIn)) {
    const t = obj(v, `towers.${type}`);
    const tiers = Array.isArray(t.tiers) ? t.tiers.map((f, i) => str(f, `towers.${type}.tiers[${i}]`)) : [];
    if (tiers.length === 0) throw new ManifestError(`towers.${type}.tiers needs at least T1`);
    towers[type as TowerType] = {
      tiers,
      height: numOr(t.height, 3),
      anchor: pair(t.anchor, [0.5, 0.88]),
      flipToTarget: t.flipToTarget === true,
      muzzle: numOr(t.muzzle, 2.2),
      facing: facing(t.facing),
    };
  }
  const enemiesIn = obj(m.enemies, 'enemies');
  const enemies: Record<string, EnemyArt> = {};
  for (const [key, v] of Object.entries(enemiesIn)) {
    const e = obj(v, `enemies.${key}`);
    const c = e.cheap && typeof e.cheap === 'object' ? (e.cheap as Json) : {};
    let sheet: SheetSpec | undefined;
    if (e.sheet && typeof e.sheet === 'object') {
      const s = e.sheet as Json;
      sheet = {
        down: str(s.down, `enemies.${key}.sheet.down`),
        up: str(s.up, `enemies.${key}.sheet.up`),
        facing: facing(s.facing),
        ...(typeof s.stride === 'number' ? { stride: s.stride } : {}),
      };
    }
    const mode: AnimMode = e.mode === 'sheet' && sheet ? 'sheet' : 'cheap';
    enemies[key] = {
      mode,
      file: str(e.file, `enemies.${key}.file`),
      ...(Array.isArray(e.frames) ? { frames: e.frames.map((f, i) => str(f, `enemies.${key}.frames[${i}]`)) } : {}),
      ...(sheet ? { sheet } : {}),
      height: numOr(e.height, 1.3),
      anchor: pair(e.anchor, [0.5, 0.94]),
      facing: facing(e.facing),
      cheap: {
        bob: numOr(c.bob, DEFAULT_CHEAP.bob),
        squash: numOr(c.squash, DEFAULT_CHEAP.squash),
        lean: numOr(c.lean, DEFAULT_CHEAP.lean),
        stride: numOr(c.stride, DEFAULT_CHEAP.stride),
        rock: numOr(c.rock, DEFAULT_CHEAP.rock),
      },
      shadow: numOr(e.shadow, 0.45),
    };
  }
  const mapIn = obj(m.enemyMap, 'enemyMap');
  const enemyMap: Record<string, EnemyMapEntry> = {};
  for (const [type, v] of Object.entries(mapIn)) {
    const entry: EnemyMapEntry =
      typeof v === 'string'
        ? { art: v }
        : (() => {
            const o = obj(v, `enemyMap.${type}`);
            const t = tint(o.tint);
            return {
              art: str(o.art, `enemyMap.${type}.art`),
              ...(t !== undefined ? { tint: t } : {}),
              ...(typeof o.scale === 'number' ? { scale: o.scale } : {}),
            };
          })();
    if (!enemies[entry.art]) throw new ManifestError(`enemyMap.${type} → unknown art "${entry.art}"`);
    enemyMap[type] = entry;
  }
  if (!enemyMap['*']) throw new ManifestError('enemyMap needs a "*" fallback');
  const maps = obj(m.maps, 'maps');
  const buildRing = Array.isArray(m.buildRing) ? (m.buildRing as TowerType[]).filter((t) => towers[t]) : [];
  return {
    version: numOr(m.version, 1),
    maps: Object.fromEntries(Object.entries(maps).map(([k, f]) => [k, str(f, `maps.${k}`)])),
    ui: {
      plaque: str(ui.plaque, 'ui.plaque'),
      banner: str(ui.banner, 'ui.banner'),
      button: str(ui.button, 'ui.button'),
      horn: str(ui.horn, 'ui.horn'),
      heart: str(ui.heart, 'ui.heart'),
      gold: str(ui.gold, 'ui.gold'),
    },
    towers,
    buildRing,
    enemies,
    enemyMap,
  };
}

/** Art for a sim enemy type. Unmapped flying types fall back to `*Flying` when present. */
export function enemyArtFor(manifest: ArtManifest, type: EnemyType, flying: boolean): EnemyMapEntry {
  return (
    manifest.enemyMap[type] ??
    (flying ? manifest.enemyMap['*Flying'] : undefined) ??
    manifest.enemyMap['*']
  );
}

/** Index of the tier sprite to use given which tier files loaded (`loaded[i]`). */
export function towerTierIndex(loaded: readonly boolean[], tier: number): number {
  for (let i = Math.min(tier, loaded.length) - 1; i >= 0; i--) {
    if (loaded[i]) return i;
  }
  return 0;
}

/**
 * Parses either sheet JSON format into frame rects. Grid sheets may omit `image` (then the PNG
 * next to the JSON with the same basename, `defaultImage`, is used) and may give `anchor` (the
 * feet point) in frame px or normalised 0..1.
 */
export function parseSheetJson(raw: unknown, defaultImage = ''): ParsedSheet {
  const j = obj(raw, 'sheet');
  if (typeof j.frameW === 'number') {
    const g = j as unknown as GridSheetJson;
    const cols = Math.max(1, Math.floor(g.cols ?? g.count));
    const frames: FrameRect[] = [];
    for (let i = 0; i < g.count; i++) {
      frames.push({ x: (i % cols) * g.frameW, y: Math.floor(i / cols) * g.frameH, w: g.frameW, h: g.frameH });
    }
    if (frames.length === 0) throw new ManifestError('sheet has no frames');
    let anchor: readonly [number, number] | null = null;
    if (g.anchor) {
      const [ax, ay] = pair(g.anchor, [0.5, 0.94]);
      anchor = ax > 1 || ay > 1 ? [ax / g.frameW, ay / g.frameH] : [ax, ay];
    }
    const image = typeof g.image === 'string' && g.image.length > 0 ? g.image : defaultImage;
    return { image: str(image, 'sheet.image'), frames, fps: numOr(g.fps, 12), anchor };
  }
  // Pixi / TexturePacker JSON-hash or JSON-array.
  const meta = obj(j.meta, 'sheet.meta');
  const framesIn = j.frames;
  const list: Array<[string, Json]> = Array.isArray(framesIn)
    ? (framesIn as Json[]).map((f, i) => [String(f.filename ?? i), f])
    : Object.entries(obj(framesIn, 'sheet.frames')).map(([k, f]) => [k, obj(f, `frame ${k}`)]);
  let order = list.map(([k]) => k);
  const anims = j.animations && typeof j.animations === 'object' ? (j.animations as Record<string, string[]>) : null;
  if (anims) {
    const first = Object.values(anims)[0];
    if (Array.isArray(first) && first.length > 0) order = first;
  }
  const byName = new Map(list);
  const frames = order.map((name) => {
    const f = byName.get(name);
    if (!f) throw new ManifestError(`sheet animation references missing frame ${name}`);
    const r = obj(f.frame, `frame ${name}.frame`);
    return { x: numOr(r.x, 0), y: numOr(r.y, 0), w: numOr(r.w, 1), h: numOr(r.h, 1) };
  });
  if (frames.length === 0) throw new ManifestError('sheet has no frames');
  return { image: str(meta.image, 'sheet.meta.image'), frames, fps: numOr(j.fps, 12), anchor: null };
}

/**
 * URL-selectable art variant for one enemy art key (e.g. `?raider=veo31q`): every enemyMap entry
 * that uses `base` switches to `<base>-<variant>` when that art exists; `cheap` forces the
 * procedural mode for `base` instead. Unknown variants leave the manifest unchanged.
 */
export function withArtVariant(manifest: ArtManifest, base: string, variant: string | null): ArtManifest {
  if (!variant) return manifest;
  if (variant === 'cheap') {
    const art = manifest.enemies[base];
    if (!art) return manifest;
    return { ...manifest, enemies: { ...manifest.enemies, [base]: { ...art, mode: 'cheap' } } };
  }
  const key = `${base}-${variant}`;
  if (!manifest.enemies[key]) return manifest;
  const enemyMap: Record<string, EnemyMapEntry> = {};
  for (const [type, e] of Object.entries(manifest.enemyMap)) {
    enemyMap[type] = e.art === base ? { ...e, art: key } : e;
  }
  return { ...manifest, enemyMap };
}
