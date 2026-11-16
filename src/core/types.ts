export type TileType = 'empty' | 'grass' | 'decor' | 'path' | 'spawn' | 'goal';

export interface GridCoord {
  readonly col: number;
  readonly row: number;
}

export type TowerType = 'archer' | 'cannon' | 'frost' | 'tesla' | 'mortar';

export type EnemyType = 'grunt' | 'runner' | 'brute' | 'flyer' | 'healer' | 'splitter' | 'boss';

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
