import type { TowerType } from '../core/types.ts';

export interface TowerTierStats {
  readonly tier: 1 | 2 | 3;
  readonly upgradeCost: number; // Cost to build (tier 1) or upgrade to this tier
  readonly damage: number;
  readonly fireRate: number; // Attacks per second
  readonly range: number;
  readonly minRange: number;
  readonly projectileSpeed: number;
  readonly splashRadius: number;
  readonly splashFalloffMin: number; // Minimum damage multiplier at splash edge
  readonly parabolicArcHeight: number;
  readonly slowRatio: number;
  readonly slowDuration: number;
  readonly chainCount: number;
  readonly chainRange: number;
  readonly chainFalloff: number;
  /** Flat armor ignored by this tower's direct hits (Ballista). */
  readonly armorPierce?: number;
  /** Extra enemies a bolt runs through behind its primary target. */
  readonly pierceCount?: number;
  /** Length (world units) of the corridor behind the target that pierced enemies must lie in. */
  readonly pierceLength?: number;
  /** Damage multiplier applied to each pierced enemy. */
  readonly pierceFalloff?: number;
  /** Support aura: fire-rate bonus (0.15 = +15%) granted to other towers inside `range`. */
  readonly auraRate?: number;
  /** Support aura: range bonus (0.1 = +10%) granted to other towers inside `range`. */
  readonly auraRange?: number;
  /** Archer T3 volley: every Nth shot also looses `volleyExtra` extra arrows at `volleyDamage` x damage. */
  readonly volleyEvery?: number;
  readonly volleyExtra?: number;
  readonly volleyDamage?: number;
  /** Cannon T3 cluster shells: `clusterCount` bomblets land `clusterOffset` away from the main blast. */
  readonly clusterCount?: number;
  readonly clusterDamage?: number;
  readonly clusterRadius?: number;
  readonly clusterOffset?: number;
  /** Frost T3 brittle: damage x (1 + brittle * target's current slow ratio). */
  readonly brittle?: number;
  /** Tesla T3 overload: every Nth discharge deals `overloadDamage` x and jumps `overloadChain` extra times. */
  readonly overloadEvery?: number;
  readonly overloadDamage?: number;
  readonly overloadChain?: number;
  /** Mortar T3 incendiary: each impact leaves a burning patch (ground only) ticking `burnDamage` (armor-ignoring). */
  readonly burnDamage?: number;
  readonly burnRadius?: number;
  readonly burnDuration?: number;
  /**
   * Barracks (role 'barracks'): soldiers on the road. `range` is how far from the tower the rally
   * point may be; `damage` / `fireRate` mirror `soldierDamage` / `soldierRate` for UI text.
   */
  readonly soldierCount?: number;
  readonly soldierHp?: number;
  readonly soldierDamage?: number;
  /** Soldier swings per second. */
  readonly soldierRate?: number;
  /** Flat armor against enemy melee hits (min 1 damage gets through). */
  readonly soldierArmor?: number;
  /** Seconds from a soldier's death until it steps out of the barracks again. */
  readonly soldierRespawnSec?: number;
  /** Barracks T3 Cleave: each swing also hits one other enemy within reach for this fraction. */
  readonly soldierCleave?: number;
}

export interface TowerDef {
  readonly type: TowerType;
  readonly name: string;
  readonly hotkey: number;
  readonly shortDesc: string;
  readonly hitsFlyers: boolean;
  readonly turretHeight: number;
  /**
   * 'support' towers never shoot; their `range` is the aura radius. 'barracks' towers never shoot
   * either: they field soldiers (SoldierSystem) and their `range` bounds the rally point.
   */
  readonly role: 'attack' | 'support' | 'barracks';
  /**
   * Only offered on 2D plot maps (the 2D build ring). The 3D build bar, radial menu, hotkeys and
   * codex iterate `TOWER_TYPES`, which leaves these out.
   */
  readonly only2d?: boolean;
  /** Tier III signature, for UI text (tower panel / build tooltips). */
  readonly signature: { readonly name: string; readonly desc: string };
  readonly tiers: readonly [TowerTierStats, TowerTierStats, TowerTierStats];
}

/** Every tower the sim knows, 3D roster first. */
export const ALL_TOWER_TYPES: readonly TowerType[] = [
  'archer',
  'cannon',
  'frost',
  'tesla',
  'mortar',
  'ballista',
  'beacon',
  'barracks',
];

export const TOWER_DEFS: Record<TowerType, TowerDef> = {
  archer: {
    type: 'archer',
    name: 'Archer Tower',
    hotkey: 1,
    shortDesc: 'Fast single-target arrows. Hits ground & flyers.',
    hitsFlyers: true,
    turretHeight: 1.55,
    role: 'attack',
    signature: { name: 'Volley', desc: 'Every 6th shot also looses an extra arrow at a nearby foe.' },
    tiers: [
      {
        tier: 1,
        upgradeCost: 50,
        damage: 18,
        fireRate: 1.65,
        range: 5.5,
        minRange: 0,
        projectileSpeed: 22,
        splashRadius: 0,
        splashFalloffMin: 1,
        parabolicArcHeight: 0,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
      },
      {
        tier: 2,
        upgradeCost: 55,
        damage: 27,
        fireRate: 1.95,
        range: 6.2,
        minRange: 0,
        projectileSpeed: 25,
        splashRadius: 0,
        splashFalloffMin: 1,
        parabolicArcHeight: 0,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
      },
      {
        tier: 3,
        upgradeCost: 95,
        damage: 36,
        fireRate: 2.32,
        range: 6.9,
        minRange: 0,
        projectileSpeed: 28,
        splashRadius: 0,
        splashFalloffMin: 1,
        parabolicArcHeight: 0,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
        volleyEvery: 6,
        volleyExtra: 1,
        volleyDamage: 0.5,
      },
    ],
  },
  cannon: {
    type: 'cannon',
    name: 'Cannon Bastion',
    hotkey: 2,
    shortDesc: 'Explosive parabolic shells with splash damage. Ground only.',
    hitsFlyers: false,
    turretHeight: 1.05,
    role: 'attack',
    signature: { name: 'Cluster Shells', desc: 'Each blast scatters bomblets that hit enemies around the crater.' },
    tiers: [
      {
        tier: 1,
        upgradeCost: 75,
        damage: 38,
        fireRate: 0.72,
        range: 4.8,
        minRange: 0,
        projectileSpeed: 13.5,
        splashRadius: 1.9,
        splashFalloffMin: 0.45,
        parabolicArcHeight: 1.85,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
      },
      {
        tier: 2,
        upgradeCost: 85,
        damage: 55,
        fireRate: 0.82,
        range: 5.3,
        minRange: 0,
        projectileSpeed: 14.5,
        splashRadius: 2.2,
        splashFalloffMin: 0.5,
        parabolicArcHeight: 2.05,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
      },
      {
        tier: 3,
        upgradeCost: 140,
        damage: 80,
        fireRate: 0.95,
        range: 5.8,
        minRange: 0,
        projectileSpeed: 16,
        splashRadius: 2.55,
        splashFalloffMin: 0.55,
        parabolicArcHeight: 2.25,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
        clusterCount: 3,
        clusterDamage: 0.35,
        clusterRadius: 1.5,
        clusterOffset: 2.7,
      },
    ],
  },
  frost: {
    type: 'frost',
    name: 'Frost Spire',
    hotkey: 3,
    shortDesc: 'Chills targets in a small burst, stacking slow. Hits ground & flyers.',
    hitsFlyers: true,
    turretHeight: 1.45,
    role: 'attack',
    signature: { name: 'Brittle', desc: 'Chilled enemies take bonus damage from frost bolts - the colder, the harder.' },
    tiers: [
      {
        tier: 1,
        upgradeCost: 65,
        damage: 9,
        fireRate: 1.1,
        range: 4.6,
        minRange: 0,
        projectileSpeed: 16,
        splashRadius: 1.65,
        splashFalloffMin: 0.65,
        parabolicArcHeight: 0,
        slowRatio: 0.28,
        slowDuration: 2.4,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
      },
      {
        tier: 2,
        upgradeCost: 75,
        damage: 13,
        fireRate: 1.24,
        range: 5.1,
        minRange: 0,
        projectileSpeed: 18,
        splashRadius: 1.95,
        splashFalloffMin: 0.7,
        parabolicArcHeight: 0,
        slowRatio: 0.35,
        slowDuration: 2.7,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
      },
      {
        tier: 3,
        upgradeCost: 120,
        damage: 17,
        fireRate: 1.45,
        range: 5.6,
        minRange: 0,
        projectileSpeed: 20,
        splashRadius: 2.25,
        splashFalloffMin: 0.75,
        parabolicArcHeight: 0,
        slowRatio: 0.42,
        slowDuration: 3.0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
        brittle: 1.0,
      },
    ],
  },
  tesla: {
    type: 'tesla',
    name: 'Tesla Coil',
    hotkey: 4,
    shortDesc: 'Arcs chain lightning across nearby foes. Hits ground & flyers.',
    hitsFlyers: true,
    turretHeight: 1.65,
    role: 'attack',
    signature: { name: 'Overload', desc: 'Every 6th discharge hits much harder and arcs one jump further.' },
    tiers: [
      {
        tier: 1,
        upgradeCost: 90,
        damage: 28,
        fireRate: 0.95,
        range: 4.7,
        minRange: 0,
        projectileSpeed: 0,
        splashRadius: 0,
        splashFalloffMin: 1,
        parabolicArcHeight: 0,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 3,
        chainRange: 3.3,
        chainFalloff: 0.75,
      },
      {
        tier: 2,
        upgradeCost: 100,
        damage: 39,
        fireRate: 1.06,
        range: 5.2,
        minRange: 0,
        projectileSpeed: 0,
        splashRadius: 0,
        splashFalloffMin: 1,
        parabolicArcHeight: 0,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 4,
        chainRange: 3.7,
        chainFalloff: 0.78,
      },
      {
        tier: 3,
        upgradeCost: 160,
        damage: 47,
        fireRate: 1.18,
        range: 5.7,
        minRange: 0,
        projectileSpeed: 0,
        splashRadius: 0,
        splashFalloffMin: 1,
        parabolicArcHeight: 0,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 5,
        chainRange: 4.0,
        chainFalloff: 0.78,
        overloadEvery: 6,
        overloadDamage: 1.8,
        overloadChain: 1,
      },
    ],
  },
  mortar: {
    type: 'mortar',
    name: 'Siege Mortar',
    hotkey: 5,
    shortDesc: 'Extreme-range heavy shells with a close blind spot. Ground only.',
    hitsFlyers: false,
    turretHeight: 1.15,
    role: 'attack',
    signature: { name: 'Incendiary', desc: 'Shells leave burning ground that scorches enemies, ignoring armor.' },
    tiers: [
      {
        tier: 1,
        upgradeCost: 110,
        damage: 82,
        fireRate: 0.38,
        range: 10.6,
        minRange: 3.4,
        projectileSpeed: 10.5,
        splashRadius: 2.75,
        splashFalloffMin: 0.45,
        parabolicArcHeight: 5.2,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
      },
      {
        tier: 2,
        upgradeCost: 120,
        damage: 116,
        fireRate: 0.43,
        range: 11.6,
        minRange: 3.4,
        projectileSpeed: 11.5,
        splashRadius: 3.1,
        splashFalloffMin: 0.5,
        parabolicArcHeight: 5.6,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
      },
      {
        tier: 3,
        upgradeCost: 195,
        damage: 160,
        fireRate: 0.5,
        range: 12.6,
        minRange: 3.2,
        projectileSpeed: 12.5,
        splashRadius: 3.5,
        splashFalloffMin: 0.55,
        parabolicArcHeight: 6.0,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
        burnDamage: 5,
        burnRadius: 2.0,
        burnDuration: 3.0,
      },
    ],
  },
  ballista: {
    type: 'ballista',
    name: 'Skypiercer Ballista',
    hotkey: 6,
    shortDesc: 'Long-range bolts that punch through armor. Slow, hits ground & flyers.',
    hitsFlyers: true,
    turretHeight: 1.7,
    role: 'attack',
    signature: { name: 'Skewer', desc: 'Bolts run through up to two more enemies lined up behind the target.' },
    tiers: [
      {
        tier: 1,
        upgradeCost: 120,
        damage: 66,
        fireRate: 0.52,
        range: 8.2,
        minRange: 0,
        projectileSpeed: 34,
        splashRadius: 0,
        splashFalloffMin: 1,
        parabolicArcHeight: 0,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
        armorPierce: 6,
      },
      {
        tier: 2,
        upgradeCost: 105,
        damage: 100,
        fireRate: 0.56,
        range: 9.0,
        minRange: 0,
        projectileSpeed: 38,
        splashRadius: 0,
        splashFalloffMin: 1,
        parabolicArcHeight: 0,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
        armorPierce: 8,
        pierceCount: 1,
        pierceLength: 3.4,
        pierceFalloff: 0.6,
      },
      {
        tier: 3,
        upgradeCost: 170,
        damage: 150,
        fireRate: 0.62,
        range: 9.8,
        minRange: 0,
        projectileSpeed: 42,
        splashRadius: 0,
        splashFalloffMin: 1,
        parabolicArcHeight: 0,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
        armorPierce: 10,
        pierceCount: 2,
        pierceLength: 4.4,
        pierceFalloff: 0.65,
      },
    ],
  },
  beacon: {
    type: 'beacon',
    name: 'Windcaller Beacon',
    hotkey: 7,
    shortDesc: 'Never attacks. Speeds up the fire rate of towers around it.',
    hitsFlyers: true,
    turretHeight: 1.5,
    role: 'support',
    signature: { name: 'Far Sight', desc: 'Also extends the range of towers inside its aura.' },
    tiers: [
      {
        tier: 1,
        upgradeCost: 85,
        damage: 0,
        fireRate: 0,
        range: 3.4,
        minRange: 0,
        projectileSpeed: 0,
        splashRadius: 0,
        splashFalloffMin: 1,
        parabolicArcHeight: 0,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
        auraRate: 0.14,
        auraRange: 0,
      },
      {
        tier: 2,
        upgradeCost: 90,
        damage: 0,
        fireRate: 0,
        range: 4.0,
        minRange: 0,
        projectileSpeed: 0,
        splashRadius: 0,
        splashFalloffMin: 1,
        parabolicArcHeight: 0,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
        auraRate: 0.2,
        auraRange: 0,
      },
      {
        tier: 3,
        upgradeCost: 140,
        damage: 0,
        fireRate: 0,
        range: 4.6,
        minRange: 0,
        projectileSpeed: 0,
        splashRadius: 0,
        splashFalloffMin: 1,
        parabolicArcHeight: 0,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
        auraRate: 0.26,
        auraRange: 0.1,
      },
    ],
  },
  barracks: {
    type: 'barracks',
    name: 'Militia Barracks',
    hotkey: 8,
    shortDesc: 'Sends soldiers to hold the road. They block ground foes in melee; flyers pass over.',
    hitsFlyers: false,
    turretHeight: 1.2,
    role: 'barracks',
    only2d: true,
    signature: { name: 'Cleave', desc: 'Every soldier swing also hits a second foe beside its target.' },
    tiers: [
      {
        tier: 1,
        upgradeCost: 70,
        damage: 8,
        fireRate: 1.0,
        range: 3.2,
        minRange: 0,
        projectileSpeed: 0,
        splashRadius: 0,
        splashFalloffMin: 1,
        parabolicArcHeight: 0,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
        soldierCount: 2,
        soldierHp: 90,
        soldierDamage: 8,
        soldierRate: 1.0,
        soldierArmor: 1,
        soldierRespawnSec: 9,
      },
      {
        tier: 2,
        upgradeCost: 80,
        damage: 12,
        fireRate: 1.1,
        range: 3.5,
        minRange: 0,
        projectileSpeed: 0,
        splashRadius: 0,
        splashFalloffMin: 1,
        parabolicArcHeight: 0,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
        soldierCount: 3,
        soldierHp: 130,
        soldierDamage: 12,
        soldierRate: 1.1,
        soldierArmor: 2,
        soldierRespawnSec: 8,
      },
      {
        tier: 3,
        upgradeCost: 130,
        damage: 17,
        fireRate: 1.2,
        range: 3.8,
        minRange: 0,
        projectileSpeed: 0,
        splashRadius: 0,
        splashFalloffMin: 1,
        parabolicArcHeight: 0,
        slowRatio: 0,
        slowDuration: 0,
        chainCount: 0,
        chainRange: 0,
        chainFalloff: 1,
        soldierCount: 3,
        soldierHp: 190,
        soldierDamage: 17,
        soldierRate: 1.2,
        soldierArmor: 4,
        soldierRespawnSec: 7,
        soldierCleave: 0.5,
      },
    ],
  },
};

/**
 * Towers offered by the 3D game (build bar, radial menu, number hotkeys, codex): everything except
 * `only2d` towers such as the barracks.
 */
export const TOWER_TYPES: readonly TowerType[] = ALL_TOWER_TYPES.filter((t) => !TOWER_DEFS[t].only2d);

export function getTowerTierStats(type: TowerType, tier: 1 | 2 | 3): TowerTierStats {
  return TOWER_DEFS[type].tiers[tier - 1];
}
