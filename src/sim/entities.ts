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

  /** Damage-absorbing barrier (Aegis Warden ward). Absorbs post-armor damage before HP. */
  shield: number;
  shieldMax: number;
  /** Burrower: underground (left out of the spatial hash → untargetable & immune). */
  burrowed: boolean;
  /** Generic per-archetype timer: burrow phase, blink charge, ward pulse. */
  abilityTimer: number;
  /** Golem: seconds left of chill-cracked (brittle) armor. */
  armorBreakTimer: number;
  /** Armor to restore when brittleness wears off (includes elite bonus). */
  baseArmor: number;
  /** Empowered elite variant (more HP/armor/reward, gold aura). */
  elite: boolean;
  /** Raider dropped by a Cloud Hauler. */
  isDropped: boolean;
  /** Ground lane index (0 = main path, 1.. = level.extraGroundPaths). Flyers are always 0. */
  lane: number;
  /**
   * Added to `dist` and `totalDist` when ranking path progress, so enemies on lanes of different
   * lengths compare by distance left to the shared goal (0 on the main road and for flyers).
   */
  laneProgressOffset: number;
  /** Phase-boss progress (Tempest Colossus: 0 → 1 Stormwall → 2 enraged). */
  bossPhase: number;
  /** Seconds the enemy stands still channelling (e.g. Stormwall). */
  channelTimer: number;
  /** Gloam Hexer: tower id being hexed while channelling (-1 = none). */
  hexTargetId: number;
  /**
   * Barracks soldiers in melee contact (written by SoldierSystem every tick it runs; read by the
   * enemy movement as a hold: speed x max(0, 1 - blockers / holdCost)). 0 = free.
   */
  blockers: number;
  /** Seconds until this enemy's next strike at a soldier holding it. */
  meleeTimer: number;
  /** Seconds the enemy is stunned (hero Shield Bash / Thunder Call). */
  stunTimer: number;
  /** Seconds left of Wren's Hunter's Mark vulnerability. */
  markTimer: number;
  /** Extra damage multiplier taken while `markTimer > 0` (0.35 = +35%). */
  markVuln: number;
  /** Hold units applied by a melee hero this tick (`HeroSystem`, combined with `blockers`). */
  heroBlockers: number;
  /** Melee damage reduction applied by Bran's Bulwark while blocked (`0..0.65`). */
  heroDamageReduction: number;
  /** Seconds until this enemy's next melee strike against a hero in contact. */
  heroMeleeTimer: number;
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
    shield: 0,
    shieldMax: 0,
    burrowed: false,
    abilityTimer: 0,
    armorBreakTimer: 0,
    baseArmor: 0,
    elite: false,
    isDropped: false,
    lane: 0,
    laneProgressOffset: 0,
    bossPhase: 0,
    channelTimer: 0,
    hexTargetId: -1,
    blockers: 0,
    meleeTimer: 0,
    stunTimer: 0,
    markTimer: 0,
    markVuln: 0,
    heroBlockers: 0,
    heroDamageReduction: 0,
    heroMeleeTimer: 0,
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
  /** Shots fired so far; drives every-Nth-shot tier signatures (volley, overload). */
  shotCount: number;
  /** Fire-rate bonus received from Tobb's Tinker passive this tick (0 = none). */
  heroRateBonus?: number;
  /** Range bonus received from Tobb's upgraded Tinker passive this tick (0 = none). */
  heroRangeBonus?: number;
  /** Seconds remaining of Tobb's Overhaul active boost on this tower. */
  overhaulTimer?: number;
  /** Fire-rate bonus granted while `overhaulTimer > 0`. */
  overhaulRateBonus?: number;
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
  brittle: number;
  clusterCount: number;
  clusterDamage: number;
  clusterRadius: number;
  clusterOffset: number;
  clusterSeed: number;
  burnDamage: number;
  burnRadius: number;
  burnDuration: number;
  /** True when fired by a ranged hero or hero gizmo turret rather than a tower. */
  fromHero: boolean;
  /** Overrides `TOWER_DEFS[towerType].hitsFlyers` when `fromHero` is true. */
  hitsFlyersOverride: boolean;

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
    brittle: 0,
    clusterCount: 0,
    clusterDamage: 0,
    clusterRadius: 0,
    clusterOffset: 0,
    clusterSeed: 0,
    burnDamage: 0,
    burnRadius: 0,
    burnDuration: 0,
    fromHero: false,
    hitsFlyersOverride: false,
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
