export type TileType = 'empty' | 'grass' | 'decor' | 'path' | 'spawn' | 'goal';

export interface GridCoord {
  readonly col: number;
  readonly row: number;
}

export type TowerType =
  | 'archer'
  | 'cannon'
  | 'frost'
  | 'tesla'
  | 'mortar'
  | 'ballista'
  | 'beacon'
  /** Soldier tower (2D plot maps only; hidden from the 3D build bar via TowerDef.only2d). */
  | 'barracks';

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

/** Quality setting chosen by the player; 'auto' lets the frame-time governor pick a tier. */
export type QualityLevel = 'auto' | 'high' | 'medium' | 'low';
/** Concrete rendering tier applied to the renderer. */
export type QualityTier = Exclude<QualityLevel, 'auto'>;

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
  /** Vibrate on touch devices for taps, placement and hits (navigator.vibrate). */
  haptics: boolean;
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
  /** Workshop upgrade ranks bought with stars (upgrade id -> rank). */
  workshop: Record<string, number>;
  /** Challenge ids completed per island (each one is worth a bonus star). */
  challengeClears: string[][];
  /** Daily Squall record (see src/data/daily.ts). */
  daily: { lastDay: number; streak: number; bestStreak: number; total: number };
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
