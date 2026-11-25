import type { EnemyType, GridCoord, TargetingMode, TileType, TowerType } from '../../core/types.ts';
import type { Level2DGate } from '../levels2d/gates.ts';

export interface WaveGroupDef {
  readonly enemyType: EnemyType;
  readonly count: number;
  readonly spawnInterval: number;
  readonly startDelay: number;
  /** HP multiplier for members of this formation. Cloud Hauler cargo retains the wave HP scale. */
  readonly hpScale?: number;
  /** Spawn the group as Empowered elites (more HP/armor/reward, gold aura). */
  readonly elite?: boolean;
  /** Ground lane to spawn on: 0 = `pathWaypoints` (default), n = `extraGroundPaths[n - 1]`. */
  readonly lane?: number;
}

export interface WaveDef {
  /** Optional flavour name (shown by UIs that choose to, e.g. Gull Squadron). */
  readonly name?: string;
  readonly groups: readonly WaveGroupDef[];
  readonly clearBonus: number;
}

export interface ScriptedBuildAction {
  readonly waveIndex: number; // Execute before or during start of this 0-based wave
  readonly action: 'build' | 'upgrade';
  /** Grid column; on plot levels (`layout2d`) the plot index (with `row` 0). */
  readonly col: number;
  readonly row: number;
  readonly towerType?: TowerType;
  readonly targetingMode?: TargetingMode;
}

/** A point on the ground plane in world units (x → east, z → south / down the screen). */
export interface WorldPoint {
  readonly x: number;
  readonly z: number;
}

/**
 * 2D painted-map layout (plot maps). Everything gameplay-relevant is in world units; the image
 * fields are only for renderers. World origin = image centre, 1 world unit = `pxPerUnit` image px
 * (default 50, so a ~100 px stone plot is about one old 2.0-unit tile):
 *   x = (px - imageW / 2) / pxPerUnit,   z = (py - imageH / 2) / pxPerUnit.
 * See `src/data/levels2d/loader.ts`.
 */
export interface Level2DLayout {
  /** Art key of the painted map (renderer looks it up in the art manifest). */
  readonly image: string;
  /** Map image size in px. */
  readonly imageSize: readonly [number, number];
  readonly pxPerUnit: number;
  /** Centred part of the image (px, [x, y, w, h]) that contains all gameplay; never cropped. */
  readonly safeArea: readonly [number, number, number, number];
  /** Initial landscape phone framing in image pixels [x, y, width, height]. */
  readonly phoneFrame?: readonly [number, number, number, number];
  /** Spawn points; entrance i starts ground lane i (`paths[i]`). */
  readonly entrances: readonly (WorldPoint & { readonly id: string })[];
  readonly goal: WorldPoint;
  /** Ground road per entrance (lane i). Every lane ends at `goal`; lanes may merge and share a tail. */
  readonly paths: readonly (readonly WorldPoint[])[];
  /** Flyer route (straight-ish line from entrance 0 to the goal unless the map supplies one). */
  readonly flightPath: readonly WorldPoint[];
  /** Build plots: one tower per plot. */
  readonly plots: readonly WorldPoint[];
  /** Plot radius in world units (picking / footprint). */
  readonly plotRadius: number;
  /** Renderer-only: entrance caves / goal gate (facing + front layer, image px). Empty when the map has none. */
  readonly gates?: readonly Level2DGate[];
}

export interface LevelDef {
  readonly id: string;
  readonly index: number;
  readonly name: string;
  readonly subtitle: string;
  readonly difficulty: 'Breezy' | 'Challenging' | 'Heroic' | 'Master';
  readonly cols: number;
  readonly rows: number;
  readonly layout: readonly string[];
  readonly pathWaypoints: readonly GridCoord[];
  /**
   * Optional extra spawn lanes. Each must end on the same goal tile as `pathWaypoints`
   * (lanes typically merge into the main road partway).
   */
  readonly extraGroundPaths?: readonly (readonly GridCoord[])[];
  readonly flightPath: readonly GridCoord[];
  readonly decorationSeed: number;
  readonly startingGold: number;
  readonly enemyHpScale?: number;
  readonly waveHpGrowth?: number;
  /** Optional hex casting reach in world units for maps with sheltered build sites. */
  readonly hexRadius?: number;
  readonly waves: readonly WaveDef[];
  readonly scriptedBuildOrder?: readonly ScriptedBuildAction[];
  readonly weakBuildOrder?: readonly ScriptedBuildAction[];
  /**
   * 2D plot map. When present the sim ignores the tile grid for placement and paths: towers go on
   * `plots` (build site `col` = plot index, `row` = 0) and enemies follow `paths` / `flightPath`.
   * The grid fields stay (an all-empty layout sized to the map) so grid-based code keeps working.
   */
  readonly layout2d?: Level2DLayout;
}

/** Number of ground spawn lanes (lane 0 = main road). */
export function groundLaneCount(level: LevelDef): number {
  if (level.layout2d) return Math.max(1, level.layout2d.paths.length);
  return 1 + (level.extraGroundPaths?.length ?? 0);
}

export function parseTileChar(ch: string): TileType {
  switch (ch) {
    case '.':
      return 'grass';
    case 'T':
      return 'decor';
    case 'P':
      return 'path';
    case 'S':
      return 'spawn';
    case 'G':
      return 'goal';
    case '~':
    default:
      return 'empty';
  }
}

export function parseLevelGrid(level: LevelDef): TileType[][] {
  const grid: TileType[][] = [];
  for (let r = 0; r < level.rows; r++) {
    const rowStr = level.layout[r] ?? '';
    const tokens = rowStr.trim().split(/\s+/);
    const row: TileType[] = [];
    for (let c = 0; c < level.cols; c++) {
      row.push(parseTileChar(tokens[c] ?? '~'));
    }
    grid.push(row);
  }
  return grid;
}
