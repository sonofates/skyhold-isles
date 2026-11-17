import type { LevelDef } from '../data/levels/index.ts';
import type { TileType } from '../core/types.ts';
import { parseLevelGrid } from '../data/levels/index.ts';

/**
 * Per-island visual identity (render side only; the sim/data layer never sees this).
 * Themes are keyed by `LevelDef.id`; unknown ids (e.g. levels added on other branches) fall back to DEFAULT_THEME.
 */

export type GroundKind = 'grass' | 'sand' | 'cobble' | 'field' | 'moss';
export type PathStyle = 'dirt' | 'stone' | 'sand';
export type TreeKind = 'tree' | 'treeLarge' | 'oak' | 'pine' | 'palm' | 'autumn' | 'blossom';
export type RGB = readonly [number, number, number];

export type SetPieceKind =
  | 'windmill'
  | 'cottage'
  | 'lighthouse'
  | 'waterfall'
  | 'arch'
  | 'ruinWall'
  | 'pillars'
  | 'banner'
  | 'crystalGrove'
  | 'dock'
  | 'watchtower'
  | 'hayBales'
  | 'scarecrow'
  | 'brazier'
  | 'seaStack'
  | 'peak'
  | 'boat'
  | 'fish'
  | 'sailboat'
  | 'kite'
  | 'windsock'
  | 'gatehouse'
  | 'obelisk'
  | 'pond'
  | 'stall'
  | 'hut'
  | 'parasol'
  | 'tent'
  | 'statue'
  | 'cabin'
  | 'cairn'
  | 'fountain'
  | 'sheep'
  | 'lamp';

export interface SetPieceSpec {
  readonly kind: SetPieceKind;
  /** Grid coordinates (may be fractional). Land origins must be decor (`T`) tiles; water origins are free. */
  readonly col: number;
  readonly row: number;
  /** Rotation about Y in radians (0 = front faces +Z / south). */
  readonly yaw?: number;
  readonly scale?: number;
  /** Free variant selector (colour scheme etc.) interpreted by the piece builder. */
  readonly variant?: number;
}

export interface ZoneTint {
  readonly col: number;
  readonly row: number;
  /** Radius in tiles at full strength; blends to zero over another `soft` tiles. */
  readonly radius: number;
  readonly soft: number;
  readonly tint: RGB;
}

export interface GroundRule {
  readonly kind: GroundKind;
  /** 'shore' = land tile touching water (4-neighbourhood); 'shore2' = within 2 tiles of water; 'zone' uses `zone`. */
  readonly where: 'shore' | 'shore2' | 'zone' | 'all';
  readonly zone?: { readonly col: number; readonly row: number; readonly radius: number };
  /** Probability per tile (hash based, deterministic). Default 1. */
  readonly chance?: number;
  /** Also applies to non-buildable decor tiles. Default true. */
  readonly includeDecor?: boolean;
}

export type IsletStyle = 'meadow' | 'palm' | 'crystal' | 'pine' | 'ruin' | 'rock';

export interface AmbientSpec {
  readonly isletStyle?: IsletStyle;
  readonly birds: number;
  readonly butterflies: number;
  /** Optional wing colours / size multiplier for the butterfly swarm (fireflies, crystal moths...). */
  readonly butterflyColors?: readonly number[];
  readonly butterflySize?: number;
  readonly islets: number;
  readonly clouds: number;
  /** Colour of the extra floating "sky petals" / leaves (0 = none). */
  readonly leafColors?: readonly number[];
  readonly leafCount?: number;
  /** Leaves float UP as small glowing lanterns (box shape, slower sway) instead of falling. */
  readonly leafRise?: boolean;
}

export type GoalDeco = 'none' | 'pillars' | 'goldPillars' | 'shards' | 'sheaves' | 'shells' | 'poles';

export type BridgeStyle = 'timber' | 'rope' | 'stone';

export interface Atmosphere {
  readonly horizon?: number;
  readonly zenith?: number;
  readonly hemiSky?: number;
  readonly sun?: number;
  readonly sunIntensity?: number;
}

export interface IslandTheme {
  readonly pathStyle: PathStyle;
  /** Sea colour (water material base colour) and sky mood. */
  readonly water: number;
  readonly atmosphere: Atmosphere;
  /** Kenney colormap cell used for the spawn-gate crystals (coral by default). */
  readonly spawnCrystalCell: readonly [number, number];
  readonly goal: {
    readonly color: number;
    readonly shard: number;
    readonly ring: number;
    readonly glow: number;
    readonly deco: GoalDeco;
  };
  readonly bridge: BridgeStyle;
  /** Global multiplicative grass tint (1,1,1 = unchanged). */
  readonly grassTint: RGB;
  readonly grassZones: readonly ZoneTint[];
  readonly ground: readonly GroundRule[];
  readonly cliff: {
    readonly stones: readonly number[];
    readonly bedrocks: readonly number[];
    readonly dirts: readonly number[];
    readonly depthMul: number;
    readonly spireMul: number;
  };
  readonly trees: {
    /** Chance that a decor tile gets a second tree. */
    readonly density: number;
    readonly weights: Partial<Record<TreeKind, number>>;
    /** Pines get cream snow caps. */
    readonly snow?: boolean;
  };
  /** Chance a free decor tile rises into a grassy/sandy hillock, and its max height (world units). */
  readonly hills: {
    readonly chance: number;
    readonly minH: number;
    readonly maxH: number;
    readonly cap: 'grass' | 'stone' | 'snow';
  };
  readonly decorBake: {
    readonly rockChance: number;
    readonly shrubChance: number;
    readonly crystalChance: number;
    /** Multiplier applied to baked crystal colour (0xffffff = pale cyan default). */
    readonly crystalTint: number;
  };
  readonly details: {
    readonly flowerMul: number;
    readonly pebbleMul: number;
    readonly tuftMul: number;
    /** petal/centre colours for the three flower buckets. */
    readonly flowers: readonly [readonly [number, number], readonly [number, number], readonly [number, number]];
    /** Density multiplier for small bushes on buildable/decor grass (hidden when a tower is built). */
    readonly bushMul: number;
    /** Main / highlight foliage colours of the bushes. */
    readonly bushColors: readonly [number, number];
    /** 0..1 share of tufts replaced by golden wheat tufts. */
    readonly wheat: number;
    /** shells/starfish on sand tiles. */
    readonly shells: boolean;
  };
  /** Optional crenellated wall rim along exposed coast edges of non-route tiles. */
  readonly parapet?: {
    readonly color: number;
    readonly merlon: number;
    readonly height: number;
    /** Probability that an edge segment is missing (ruin look). */
    readonly gap: number;
    readonly merlons: boolean;
  };
  /** Small floating props on the sea near the coast. */
  readonly waterDetails: { readonly lilies: number; readonly buoys: number; readonly driftwood: number };
  readonly setPieces: readonly SetPieceSpec[];
  readonly ambient: AmbientSpec;
}

export const DEFAULT_THEME: IslandTheme = {
  pathStyle: 'dirt',
  water: 0x26aadf,
  atmosphere: {},
  spawnCrystalCell: [6, 2],
  goal: { color: 0x5be3ff, shard: 0xccf7ff, ring: 0xf6bd41, glow: 0x0b7cb8, deco: 'none' },
  bridge: 'timber',
  grassTint: [1, 1, 1],
  grassZones: [],
  ground: [],
  cliff: {
    stones: [0x8b95a5, 0x9aa4b0],
    bedrocks: [0x768393, 0x677484],
    dirts: [0x9c6b49, 0x7b5338],
    depthMul: 1,
    spireMul: 1,
  },
  trees: { density: 0.45, weights: { tree: 0.34, treeLarge: 0.38, oak: 0.28 } },
  hills: { chance: 0, minH: 0.3, maxH: 0.5, cap: 'grass' },
  decorBake: { rockChance: 0.28, shrubChance: 0.32, crystalChance: 0.14, crystalTint: 0xffffff },
  details: {
    flowerMul: 1,
    pebbleMul: 1,
    tuftMul: 1,
    bushMul: 1,
    bushColors: [0x4d9440, 0x6ac74a],
    flowers: [
      [0xf8f4e8, 0xf6bd41],
      [0xf6bd41, 0xf28729],
      [0xe85d5d, 0xf8f4e8],
    ],
    wheat: 0,
    shells: false,
  },
  waterDetails: { lilies: 0, buoys: 0, driftwood: 0 },
  setPieces: [],
  ambient: { birds: 3, butterflies: 0, islets: 4, clouds: 5 },
};

/** Tiles (as `col,row` keys) whose trees/baked decor are replaced by an authored set piece. */
export function claimedDecorTiles(level: LevelDef, theme: IslandTheme): Set<string> {
  const claimed = new Set<string>();
  const grid = parseLevelGrid(level);
  for (const p of theme.setPieces) {
    const c = Math.round(p.col);
    const r = Math.round(p.row);
    if (grid[r]?.[c] === 'decor') claimed.add(`${c},${r}`);
  }
  return claimed;
}

/** Deterministic 0..1 hash for per-tile style rolls (no RNG state so render order never matters). */
export function tileHash(c: number, r: number, salt: number): number {
  let n = Math.imul(c + 101, 374761393) ^ Math.imul(r + 211, 668265263) ^ Math.imul(salt + 17, 1442695041);
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export function resolveGroundKind(
  theme: IslandTheme,
  c: number,
  r: number,
  isLand: (c: number, r: number) => boolean,
  isDecor: boolean,
): GroundKind {
  for (let i = 0; i < theme.ground.length; i++) {
    const rule = theme.ground[i];
    if (isDecor && rule.includeDecor === false) continue;
    let hit = false;
    switch (rule.where) {
      case 'all':
        hit = true;
        break;
      case 'shore':
        hit = !isLand(c - 1, r) || !isLand(c + 1, r) || !isLand(c, r - 1) || !isLand(c, r + 1);
        break;
      case 'shore2': {
        hit = false;
        for (let dr = -2; dr <= 2 && !hit; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            if (Math.abs(dc) + Math.abs(dr) > 2) continue;
            if (!isLand(c + dc, r + dr)) {
              hit = true;
              break;
            }
          }
        }
        break;
      }
      case 'zone': {
        const z = rule.zone;
        hit = !!z && Math.hypot(c - z.col, r - z.row) <= z.radius;
        break;
      }
    }
    if (!hit) continue;
    if (rule.chance !== undefined && tileHash(c, r, 7 + i) > rule.chance) continue;
    return rule.kind;
  }
  return 'grass';
}

/** Smooth multiplicative grass tint at a world position (grid-space zones converted by caller). */
export function sampleZoneTint(
  theme: IslandTheme,
  gridCol: number,
  gridRow: number,
  out: [number, number, number],
): void {
  out[0] = theme.grassTint[0];
  out[1] = theme.grassTint[1];
  out[2] = theme.grassTint[2];
  for (let i = 0; i < theme.grassZones.length; i++) {
    const z = theme.grassZones[i];
    const d = Math.hypot(gridCol - z.col, gridRow - z.row);
    if (d >= z.radius + z.soft) continue;
    const t = d <= z.radius ? 1 : 1 - (d - z.radius) / Math.max(0.001, z.soft);
    const k = t * t * (3 - 2 * t);
    out[0] *= 1 + (z.tint[0] - 1) * k;
    out[1] *= 1 + (z.tint[1] - 1) * k;
    out[2] *= 1 + (z.tint[2] - 1) * k;
  }
}

/** Height of the hillock on a decor tile (0 = flat). Deterministic per tile so trees/decor can follow it. */
export function decorHillHeight(
  theme: IslandTheme,
  grid: readonly (readonly TileType[])[],
  c: number,
  r: number,
  claimed: boolean,
): number {
  if (claimed || theme.hills.chance <= 0) return 0;
  if (tileHash(c, r, 991) >= theme.hills.chance) return 0;
  const h = theme.hills.minH + tileHash(c, r, 992) * (theme.hills.maxH - theme.hills.minH);
  // Keep hills beside the enemy route low so they never hide walking units from the iso camera.
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const t = grid[r + dr]?.[c + dc];
      if (t === 'path' || t === 'spawn' || t === 'goal') return Math.min(h, 0.28);
    }
  }
  return h;
}
