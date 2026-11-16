import type { AbilityId, EnemyType, TowerType, Vec3 } from './types.ts';

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
