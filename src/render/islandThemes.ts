import type { LevelDef } from '../data/levels/index.ts';
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
  | 'boat'
  | 'gatehouse'
  | 'obelisk';

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

export interface AmbientSpec {
  readonly birds: number;
  readonly butterflies: number;
  readonly islets: number;
  readonly clouds: number;
  /** Colour of the extra floating "sky petals" / leaves (0 = none). */
  readonly leafColors?: readonly number[];
  readonly leafCount?: number;
}

export interface IslandTheme {
  readonly pathStyle: PathStyle;
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
    /** 0..1 share of tufts replaced by golden wheat tufts. */
    readonly wheat: number;
    /** shells/starfish on sand tiles. */
    readonly shells: boolean;
  };
  readonly setPieces: readonly SetPieceSpec[];
  readonly ambient: AmbientSpec;
}

export const DEFAULT_THEME: IslandTheme = {
  pathStyle: 'dirt',
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
  decorBake: { rockChance: 0.28, shrubChance: 0.32, crystalChance: 0.14, crystalTint: 0xffffff },
  details: {
    flowerMul: 1,
    pebbleMul: 1,
    tuftMul: 1,
    flowers: [
      [0xf8f4e8, 0xf6bd41],
      [0xf6bd41, 0xf28729],
      [0xe85d5d, 0xf8f4e8],
    ],
    wheat: 0,
    shells: false,
  },
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
