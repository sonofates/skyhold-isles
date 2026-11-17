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

export interface ProgressData {
  unlockedLevelIndex: number;
  bestStars: number[];
  bestEndlessWaves: number[];
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
