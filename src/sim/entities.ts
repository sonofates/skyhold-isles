import type { EnemyType, TargetingMode, TowerType } from '../core/types.ts';

export interface EnemyEntity {
  readonly poolIndex: number;
  active: boolean;
  uid: number;
  type: EnemyType;
  hp: number;
  maxHp: number;
  speed: number;
  armor: number;
  reward: number;
  livesCost: number;
  flying: boolean;
  radius: number;
  height: number;

  dist: number;
  totalDist: number;
  x: number;
  y: number;
  z: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  yaw: number;
  prevYaw: number;

  slowTimer: number;
  slowRatio: number;
  hitFlashTimer: number;
  healTimer: number;
  walkPhase: number;
  bossPulseTimer: number;
  bossSummonedEscorts: boolean;
  scaleOverride: number;
  isSplitChild: boolean;
}

export function createEnemyEntity(poolIndex: number): EnemyEntity {
  return {
    poolIndex,
    active: false,
    uid: 0,
    type: 'grunt',
    hp: 0,
    maxHp: 1,
    speed: 1,
    armor: 0,
    reward: 0,
    livesCost: 1,
    flying: false,
    radius: 0.4,
    height: 1,
    dist: 0,
    totalDist: 1,
    x: 0,
    y: 0,
    z: 0,
    prevX: 0,
    prevY: 0,
    prevZ: 0,
    yaw: 0,
    prevYaw: 0,
    slowTimer: 0,
    slowRatio: 0,
    hitFlashTimer: 0,
    healTimer: 0,
    walkPhase: 0,
    bossPulseTimer: 0,
    bossSummonedEscorts: false,
    scaleOverride: 1,
    isSplitChild: false,
  };
}

export interface TowerEntity {
  readonly id: number;
  readonly col: number;
  readonly row: number;
  readonly x: number;
  readonly z: number;
  readonly type: TowerType;
  tier: 1 | 2 | 3;
  totalInvested: number;
  targetingMode: TargetingMode;
  cooldownTimer: number;
  stunTimer: number;
  yaw: number;
  prevYaw: number;
  targetYaw: number;
  recoil: number;
  popAnimTimer: number;
  totalDamageDealt: number;
  kills: number;
  /** Fire-rate bonus received from nearby Beacons this tick (0 = none). */
  auraRate: number;
  /** Range bonus received from nearby Beacons this tick (0 = none). */
  auraRange: number;
}

export interface ProjectileEntity {
  readonly poolIndex: number;
  active: boolean;
  towerType: TowerType;
  towerId: number;
  targetUid: number;
  targetPoolIndex: number;
  damage: number;
  splashRadius: number;
  splashFalloffMin: number;
  slowRatio: number;
  slowDuration: number;
  parabolic: boolean;
  arcHeight: number;
  speed: number;
  armorPierce: number;
  pierceCount: number;
  pierceLength: number;
  pierceFalloff: number;

  startX: number;
  startY: number;
  startZ: number;
  endX: number;
  endY: number;
  endZ: number;
  progress: number;
  duration: number;

  x: number;
  y: number;
  z: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  yaw: number;
  prevYaw: number;
}

export function createProjectileEntity(poolIndex: number): ProjectileEntity {
  return {
    poolIndex,
    active: false,
    towerType: 'archer',
    towerId: 0,
    targetUid: 0,
    targetPoolIndex: -1,
    damage: 0,
    splashRadius: 0,
    splashFalloffMin: 1,
    slowRatio: 0,
    slowDuration: 0,
    parabolic: false,
    arcHeight: 0,
    speed: 10,
    armorPierce: 0,
    pierceCount: 0,
    pierceLength: 0,
    pierceFalloff: 1,
    startX: 0,
    startY: 0,
    startZ: 0,
    endX: 0,
    endY: 0,
    endZ: 0,
    progress: 0,
    duration: 1,
    x: 0,
    y: 0,
    z: 0,
    prevX: 0,
    prevY: 0,
    prevZ: 0,
    yaw: 0,
    prevYaw: 0,
  };
}
