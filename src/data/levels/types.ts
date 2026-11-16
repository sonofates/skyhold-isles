import type { EnemyType, GridCoord, TargetingMode, TileType, TowerType } from '../../core/types.ts';

export interface WaveGroupDef {
  readonly enemyType: EnemyType;
  readonly count: number;
  readonly spawnInterval: number;
  readonly startDelay: number;
  /** Spawn the group as Empowered elites (more HP/armor/reward, gold aura). */
  readonly elite?: boolean;
}

export interface WaveDef {
  readonly groups: readonly WaveGroupDef[];
  readonly clearBonus: number;
}

export interface ScriptedBuildAction {
  readonly waveIndex: number; // Execute before or during start of this 0-based wave
  readonly action: 'build' | 'upgrade';
  readonly col: number;
  readonly row: number;
  readonly towerType?: TowerType;
  readonly targetingMode?: TargetingMode;
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
  readonly flightPath: readonly GridCoord[];
  readonly decorationSeed: number;
  readonly startingGold: number;
  readonly enemyHpScale?: number;
  readonly waveHpGrowth?: number;
  readonly waves: readonly WaveDef[];
  readonly scriptedBuildOrder?: readonly ScriptedBuildAction[];
  readonly weakBuildOrder?: readonly ScriptedBuildAction[];
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
