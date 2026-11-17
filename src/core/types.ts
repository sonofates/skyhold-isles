export type TileType = 'empty' | 'grass' | 'decor' | 'path' | 'spawn' | 'goal';

export interface GridCoord {
  readonly col: number;
  readonly row: number;
}

export type TowerType = 'archer' | 'cannon' | 'frost' | 'tesla' | 'mortar' | 'ballista' | 'beacon';

export type EnemyType =
  | 'grunt'
  | 'runner'
  | 'brute'
  | 'flyer'
  | 'healer'
  | 'splitter'
  | 'warden'
  | 'burrower'
  | 'carrier'
  | 'blinker'
  | 'golem'
  | 'mite'
  | 'hexer'
  | 'tempest'
  | 'boss';

export type AbilityId = 'meteor' | 'overcharge';

export type TargetingMode = 'first' | 'last' | 'strongest' | 'closest';

export type GameScreen = 'menu' | 'levelSelect' | 'playing' | 'won' | 'lost';

export type SpeedMultiplier = 1 | 2 | 3;

export type QualityLevel = 'high' | 'low';

export interface TowerMvpSummary {
  readonly name: string;
  readonly type: TowerType;
  readonly tier: 1 | 2 | 3;
  readonly damageDealt: number;
  readonly kills: number;
}

export interface GameSettings {
  masterVolume: number;
  muted: boolean;
  cameraShake: boolean;
  damageNumbers: boolean;
  quality: QualityLevel;
}

/**
 * Campaign save (localStorage `skyhold_isles_progress_v1` key; the format version lives in
 * `version`). v1 saves had only the first three fields; `loadProgress` migrates them in place.
 * Arrays are indexed by island index (islands are only ever appended).
 */
export interface ProgressData {
  /** Save format version (see PROGRESS_SAVE_VERSION in platform/storage.ts). */
  version: number;
  unlockedLevelIndex: number;
  bestStars: number[];
  bestEndlessWaves: number[];
  /** Most lives left on a win per island (0 = no recorded win). */
  bestLives: number[];
  /** Number of wins per island. */
  clears: number[];
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
