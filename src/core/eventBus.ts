import type { AbilityId, EnemyType, HeroId, HeroSkillSlot, TowerType, Vec3 } from './types.ts';

export interface GameEventMap {
  towerBuilt: { towerId: number; type: TowerType; tier: number; x: number; z: number };
  towerUpgraded: { towerId: number; type: TowerType; tier: number; x: number; z: number };
  towerSold: { towerId: number; type: TowerType; tier: number; refund: number; x: number; z: number };
  towerFired: {
    towerId: number;
    type: TowerType;
    tier: number;
    x: number;
    y: number;
    z: number;
    yaw: number;
    /** True on tier-signature shots (archer volley, tesla overload). */
    special?: boolean;
  };
  groundZone: {
    kind: 'fire';
    x: number;
    z: number;
    radius: number;
    duration: number;
  };
  beaconPulse: { towerId: number; tier: number; x: number; z: number; radius: number };
  projectileImpact: {
    towerType: TowerType;
    x: number;
    y: number;
    z: number;
    radius: number;
    isBossHit: boolean;
    /** Ballista bolts that keep flying: unit direction (xz) and corridor length, for the pierce streak. */
    pierce?: { dx: number; dz: number; length: number };
  };
  lightningChain: {
    points: readonly Vec3[];
    overload?: boolean;
  };
  /** Frost T3 Brittle: a frost bolt hit a chilled enemy for bonus damage (cap-limited by the emitter). */
  brittleCrack: { x: number; y: number; z: number; bonus: number };
  enemySpawned: {
    enemyId: number;
    enemyType: EnemyType;
    flying: boolean;
  };
  enemyHit: {
    enemyId: number;
    enemyType: EnemyType;
    damage: number;
    x: number;
    y: number;
    z: number;
    isBoss: boolean;
  };
  enemyKilled: {
    enemyId: number;
    enemyType: EnemyType;
    reward: number;
    x: number;
    y: number;
    z: number;
  };
  enemySplit: {
    parentUid: number;
    x: number;
    y: number;
    z: number;
    count: number;
  };
  enemyLeaked: {
    enemyType: EnemyType;
    livesLost: number;
    x: number;
    y: number;
    z: number;
  };
  healerPulse: {
    x: number;
    y: number;
    z: number;
    radius: number;
  };
  bossPulse: {
    x: number;
    y: number;
    z: number;
    radius: number;
    stunnedTowerIds: readonly number[];
  };
  wardPulse: {
    x: number;
    y: number;
    z: number;
    radius: number;
    shieldedCount: number;
  };
  /** A hit was (partly) soaked by a barrier. */
  shieldAbsorb: {
    enemyId: number;
    amount: number;
    x: number;
    y: number;
    z: number;
  };
  shieldBroken: {
    enemyId: number;
    x: number;
    y: number;
    z: number;
  };
  enemyBurrow: {
    enemyId: number;
    burrowed: boolean;
    x: number;
    y: number;
    z: number;
  };
  enemyBlink: {
    enemyId: number;
    fromX: number;
    fromY: number;
    fromZ: number;
    toX: number;
    toY: number;
    toZ: number;
  };
  carrierDrop: {
    x: number;
    y: number;
    z: number;
    groundX: number;
    groundY: number;
    groundZ: number;
    count: number;
  };
  armorCracked: {
    enemyId: number;
    x: number;
    y: number;
    z: number;
  };
  bossPhase: {
    enemyId: number;
    enemyType: EnemyType;
    /** 1 = Stormwall raised, 2 = enraged. */
    phase: number;
    x: number;
    y: number;
    z: number;
    radius: number;
  };
  /** Gloam Hexer starts channelling a hex on a tower (telegraph). */
  hexCharge: {
    enemyId: number;
    towerId: number;
    x: number;
    y: number;
    z: number;
    towerX: number;
    towerZ: number;
  };
  /** A Gloam Hexer's hex landed: the tower is stunned for `duration` seconds. */
  towerHexed: {
    enemyId: number;
    towerId: number;
    x: number;
    y: number;
    z: number;
    towerX: number;
    towerZ: number;
    duration: number;
  };
  bossSummon: {
    x: number;
    y: number;
    z: number;
    count: number;
  };
  abilityTargeted: {
    abilityId: AbilityId;
    x: number;
    z: number;
    radius: number;
  };
  meteorImpact: {
    x: number;
    y: number;
    z: number;
    radius: number;
  };
  overchargeActivated: {
    duration: number;
    cleansedTowerIds: readonly number[];
  };
  endlessEntered: {
    startingWave: number;
  };
  waveStarted: {
    waveIndex: number;
    totalWaves: number;
    earlyBonus: number;
    endless?: boolean;
  };
  waveCompleted: {
    waveIndex: number;
    bonus: number;
  };
  /** A barracks soldier stepped out of its barracks (spawn or respawn) and walks to its post. */
  soldierSpawned: { soldierId: number; towerId: number; x: number; z: number };
  /** A soldier struck an enemy in melee (`cleave` = the T3 side swing). */
  soldierAttack: {
    soldierId: number;
    towerId: number;
    enemyId: number;
    x: number;
    z: number;
    targetX: number;
    targetZ: number;
    damage: number;
    cleave: boolean;
  };
  /**
   * Render-facing melee timing (no gameplay meaning). A melee attacker armed its next blow: it lands
   * in `impactIn` sim seconds at the current swing rate (aura / Overcharge / chill changes can shift
   * it; `meleeHit` is authoritative). Emitted when a soldier makes contact, when an enemy becomes
   * held, and right after every blow. Soldier: `attackerId` = soldier id, `targetId` = enemy uid.
   * Enemy: `attackerId` = enemy uid, `targetId` = the soldier it strikes (its first in contact).
   */
  meleeSwing: { attacker: 'soldier' | 'enemy'; attackerId: number; targetId: number; impactIn: number; sweep: boolean };
  /**
   * A melee blow landed (one per swing; a T3 cleave adds one with `cleave`, a sweeping boss blow is
   * one event with `struck` = soldiers hit). Positions are the attacker's and the target's.
   */
  meleeHit: {
    attacker: 'soldier' | 'enemy';
    attackerId: number;
    targetId: number;
    damage: number;
    x: number;
    z: number;
    targetX: number;
    targetZ: number;
    struck: number;
    cleave: boolean;
    sweep: boolean;
    killed: boolean;
  };
  /** An enemy struck a soldier. */
  soldierHurt: { soldierId: number; towerId: number; enemyId: number; damage: number; x: number; z: number };
  /** A soldier fell; it respawns at the barracks after the tier's respawn time. */
  soldierDied: { soldierId: number; towerId: number; x: number; z: number; respawnSec: number };
  /** A soldier was removed without dying (its barracks was sold). */
  soldierRemoved: { soldierId: number; towerId: number; x: number; z: number };
  /** A barracks rally point moved (build, player order); its squad walks to the new posts. */
  rallyMoved: { towerId: number; x: number; z: number };
  /** An enemy is held by soldiers (was free last tick). */
  enemyBlocked: { enemyId: number; enemyType: EnemyType; x: number; y: number; z: number };
  /** A held enemy is free again (its soldiers died, were sold, or it dived / blinked / trampled away). */
  enemyUnblocked: { enemyId: number; enemyType: EnemyType; x: number; y: number; z: number };
  /** Player ordered the hero to walk along the ground road graph to (targetX, targetZ). */
  heroMoved: {
    heroId: HeroId;
    x: number;
    z: number;
    targetX: number;
    targetZ: number;
    waypoints: readonly { readonly x: number; readonly z: number }[];
  };
  /** The hero swung in melee or loosed a ranged projectile at an enemy. */
  heroAttack: {
    heroId: HeroId;
    mode: 'melee' | 'ranged';
    x: number;
    z: number;
    targetX: number;
    targetZ: number;
    targetEnemyId: number;
    yaw: number;
    damage: number;
    crit: boolean;
    cleave: boolean;
  };
  /** The hero took damage from an enemy strike. */
  heroHit: {
    heroId: HeroId;
    enemyId: number;
    damage: number;
    hp: number;
    maxHp: number;
    x: number;
    z: number;
  };
  /** The hero cast one of its two active skills. */
  heroSkillCast: {
    heroId: HeroId;
    slot: HeroSkillSlot;
    skillId: string;
    x: number;
    z: number;
    targetX: number;
    targetZ: number;
    radius: number;
    duration: number;
  };
  /** The hero fell in battle and begins its respawn countdown at the castle. */
  heroDied: {
    heroId: HeroId;
    x: number;
    z: number;
    respawnSec: number;
  };
  /** The hero respawned at the castle at full health. */
  heroRespawn: {
    heroId: HeroId;
    x: number;
    z: number;
    hp: number;
    maxHp: number;
  };
  /** The hero earned persistent progression XP during a run. */
  heroXpGained: {
    heroId: HeroId;
    amount: number;
    totalRunXp: number;
    source: 'kill' | 'wave' | 'victory';
    x: number;
    z: number;
  };
  economyChanged: {
    gold: number;
    lives: number;
  };
  gameWon: {
    stars: 1 | 2 | 3;
    livesRemaining: number;
  };
  gameLost: {
    waveIndex: number;
    endless?: boolean;
  };
}

type Listener<T> = (payload: T) => void;

export class EventBus {
  private listeners: { [K in keyof GameEventMap]?: Array<Listener<GameEventMap[K]>> } = {};

  on<K extends keyof GameEventMap>(event: K, listener: Listener<GameEventMap[K]>): () => void {
    let list = this.listeners[event];
    if (!list) {
      list = [];
      this.listeners[event] = list;
    }
    list.push(listener);
    return () => {
      const idx = list.indexOf(listener);
      if (idx !== -1) {
        list.splice(idx, 1);
      }
    };
  }

  emit<K extends keyof GameEventMap>(event: K, payload: GameEventMap[K]): void {
    const list = this.listeners[event];
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      list[i](payload);
    }
  }

  clear(): void {
    this.listeners = {};
  }
}
