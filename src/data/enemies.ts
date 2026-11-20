import type { EnemyType } from '../core/types.ts';
import type { MeleeProfile } from './soldiers.ts';

export const CHAPTER_ENEMY_TYPES = ['bellrunner', 'kilnback', 'reedpiper', 'draftwing'] as const;
export type ChapterEnemyType = typeof CHAPTER_ENEMY_TYPES[number];

type ChapterAbility =
  | { kind: 'momentum'; runUpSec: number; speedBonus: number }
  | { kind: 'ceramic'; chip: number; resetSec: number }
  | { kind: 'refrain'; radius: number; interval: number; channelSec: number }
  | { kind: 'draft'; reach: number; spacing: number; coastSec: number; speedBonus: number };

export interface EnemyDef<T extends EnemyType | ChapterEnemyType = EnemyType> {
  readonly type: T;
  readonly ability?: ChapterAbility;
  readonly name: string;
  readonly description: string;
  readonly maxHp: number;
  readonly speed: number;
  readonly armor: number;
  readonly reward: number;
  readonly livesCost: number;
  readonly flying: boolean;
  readonly radius: number;
  readonly height: number;
  readonly healAmount?: number;
  readonly healRadius?: number;
  readonly healInterval?: number;
  /** Aegis Warden: barrier pulse radius / interval (s) / shield HP per ally at hp scale 1. */
  readonly wardRadius?: number;
  readonly wardInterval?: number;
  readonly wardShield?: number;
  /** Burrower: seconds surfaced, seconds underground, speed multiplier while underground. */
  readonly burrowSurfaceSec?: number;
  readonly burrowDiveSec?: number;
  readonly burrowSpeedMul?: number;
  /** Cloud Hauler: raiders dropped on death and their HP fraction of a scaled grunt. */
  readonly dropCount?: number;
  readonly dropHpFrac?: number;
  /** Rift Blinker: charge time (s) and forward teleport distance (world units). */
  readonly blinkInterval?: number;
  readonly blinkDistance?: number;
  /** Golem: armor while chill-cracked and how long a chill keeps it cracked. */
  readonly brittleArmor?: number;
  readonly brittleDuration?: number;
  /** Gloam Hexer: hex reach (world units), seconds between hexes, telegraph channel, tower stun. */
  readonly hexRadius?: number;
  readonly hexInterval?: number;
  readonly hexChannelSec?: number;
  readonly hexStunSec?: number;
  /** Boss-class: bigger hit numbers, camera shake, boss HP bar. */
  readonly isBoss?: boolean;
  /** Tempest Colossus phase thresholds (fraction of max HP) and phase tuning. */
  readonly phaseThresholds?: readonly [number, number];
  readonly stormwallSelfFrac?: number;
  readonly stormwallAllyFrac?: number;
  readonly stormwallRadius?: number;
  readonly stormwallChannelSec?: number;
  readonly enrageSpeedMul?: number;
  readonly enrageSummonCount?: number;
  readonly jamInterval?: number;
  readonly jamRadius?: number;
  /** Short counterplay hint shown in tooltips / codex. */
  readonly counterHint?: string;
}

// Chapter-two roster (i17–i24). Spread into ENEMY_DEFS / ENEMY_TYPES below and into ENEMY_MELEE.
export const CHAPTER_ENEMY_DEFS = {
  bellrunner: {
    type: 'bellrunner', name: 'Belfry Hare',
    description: 'The bells on its harness ring faster as it gathers speed on the open road.',
    counterHint: 'Block or slow the hare to break its sprint. It needs a clear road to build up speed again.',
    maxHp: 84, speed: 2.35, armor: 0, reward: 5, livesCost: 1,
    flying: false, radius: 0.37, height: 1.08,
    ability: { kind: 'momentum', runUpSec: 2.4, speedBonus: 0.85 },
  },
  kilnback: {
    type: 'kilnback', name: 'Kilnback Tortoise',
    description: 'Each hit that reaches its shell loosens a fired-clay plate. The plates settle back into place during a lull.',
    counterHint: 'Use quick shots to strip its shell, then land a heavy hit before the plates settle.',
    maxHp: 285, speed: 1.48, armor: 11, reward: 9, livesCost: 2,
    flying: false, radius: 0.57, height: 1.16,
    ability: { kind: 'ceramic', chip: 3, resetSec: 1.45 },
  },
  reedpiper: {
    type: 'reedpiper', name: 'Reed Piper',
    description: 'Stops to play a reed flute. The last note lifts frost from nearby ground troops.',
    counterHint: 'Stun the piper during its phrase, or wait for the last note before applying frost.',
    maxHp: 138, speed: 1.95, armor: 1, reward: 7, livesCost: 2,
    flying: false, radius: 0.42, height: 1.18,
    ability: { kind: 'refrain', radius: 3.2, interval: 4.2, channelSec: 0.85 },
  },
  draftwing: {
    type: 'draftwing', name: 'Slipstream Moth',
    description: 'Follows the wingbeats of another moth ahead on the sky lane, closing the gap in its wake.',
    counterHint: 'Chain lightning breaks up a flight. Pick off the lead moth to slow its follower.',
    maxHp: 47, speed: 2.5, armor: 0, reward: 3, livesCost: 1,
    flying: true, radius: 0.36, height: 0.84,
    ability: { kind: 'draft', reach: 3, spacing: 0.35, coastSec: 1.4, speedBonus: 0.65 },
  },
} as const satisfies { [T in ChapterEnemyType]: EnemyDef<T> };

export const CHAPTER_ENEMY_MELEE = {
  bellrunner: { block: 'block', holdCost: 1, damage: 5, rate: 1.25 },
  kilnback: { block: 'block', holdCost: 2, damage: 18, rate: 0.75 },
  reedpiper: { block: 'block', holdCost: 1, damage: 4, rate: 0.85 },
  draftwing: { block: 'ignore', holdCost: 1, damage: 0, rate: 0 },
} as const satisfies Record<ChapterEnemyType, MeleeProfile>;

/** Empowered elite variant multipliers (wave groups with `elite: true`). */
export const ELITE_MODIFIERS = {
  hpMul: 1.75,
  armorBonus: 1,
  rewardMul: 1.6,
  scaleMul: 1.14,
} as const;

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  grunt: {
    type: 'grunt',
    name: 'Raider Grunt',
    description: 'Balanced foot soldier marching steadily along the road.',
    maxHp: 75,
    speed: 2.3,
    armor: 0,
    reward: 4,
    livesCost: 1,
    flying: false,
    radius: 0.42,
    height: 1.05,
  },
  runner: {
    type: 'runner',
    name: 'Zephyr Runner',
    description: 'Swift scout with light health that sprints past slow turrets.',
    maxHp: 46,
    speed: 4.0,
    armor: 0,
    reward: 3,
    livesCost: 1,
    flying: false,
    radius: 0.36,
    height: 0.95,
  },
  brute: {
    type: 'brute',
    name: 'Iron Brute',
    description: 'Heavily armored juggernaut. Reduces flat damage from every hit.',
    maxHp: 260,
    speed: 1.45,
    armor: 6,
    reward: 7,
    livesCost: 2,
    flying: false,
    radius: 0.56,
    height: 1.35,
  },
  flyer: {
    type: 'flyer',
    name: 'Sky Skimmer',
    description: 'Soars over terrain along aerial lanes. Only anti-air towers can hit it.',
    maxHp: 54,
    speed: 2.3,
    armor: 0,
    reward: 4,
    livesCost: 1,
    flying: true,
    radius: 0.44,
    height: 0.9,
  },
  healer: {
    type: 'healer',
    name: 'Grove Mender',
    description: 'Periodically emits a restorative aura that heals nearby allies.',
    maxHp: 120,
    speed: 1.95,
    armor: 1,
    reward: 6,
    livesCost: 2,
    flying: false,
    radius: 0.45,
    height: 1.2,
    healAmount: 22,
    healRadius: 3.8,
    healInterval: 2.6,
  },
  splitter: {
    type: 'splitter',
    name: 'Cinder Splitling',
    description: 'Volatile ember construct that fractures into two swift hatchlings on death.',
    maxHp: 118,
    speed: 2.0,
    armor: 1,
    reward: 5,
    livesCost: 1,
    flying: false,
    radius: 0.46,
    height: 1.08,
  },
  warden: {
    type: 'warden',
    name: 'Aegis Warden',
    description: 'Raises a shimmering barrier on nearby allies every few seconds. Shields soak damage before health.',
    counterHint: 'Focus it first; splash and chains pop many shields at once.',
    maxHp: 150,
    speed: 1.8,
    armor: 2,
    reward: 8,
    livesCost: 2,
    flying: false,
    radius: 0.5,
    height: 1.35,
    wardRadius: 3.4,
    wardInterval: 4.0,
    wardShield: 26,
  },
  burrower: {
    type: 'burrower',
    name: 'Loam Burrower',
    description: 'Tunnels beneath the road in bursts — untargetable and faster while underground.',
    counterHint: 'Cover the whole road; splash where it resurfaces.',
    maxHp: 140,
    speed: 1.9,
    armor: 2,
    reward: 6,
    livesCost: 1,
    flying: false,
    radius: 0.48,
    height: 0.95,
    burrowSurfaceSec: 2.8,
    burrowDiveSec: 1.6,
    burrowSpeedMul: 1.6,
  },
  carrier: {
    type: 'carrier',
    name: 'Cloud Hauler',
    description: 'Lumbering sky barge on the aerial lane. Drops two raiders onto the road when shot down.',
    counterHint: 'Down it early — late kills drop raiders near the sanctuary.',
    maxHp: 150,
    speed: 1.55,
    armor: 1,
    reward: 8,
    livesCost: 2,
    flying: true,
    radius: 0.6,
    height: 1.1,
    dropCount: 2,
    dropHpFrac: 0.6,
  },
  blinker: {
    type: 'blinker',
    name: 'Rift Blinker',
    description: 'Charges a rift and blinks forward along the road. Chill slows its charge.',
    counterHint: 'Frost delays every blink; burst it before the jump.',
    maxHp: 95,
    speed: 2.1,
    armor: 0,
    reward: 6,
    livesCost: 1,
    flying: false,
    radius: 0.4,
    height: 1.05,
    blinkInterval: 3.4,
    blinkDistance: 4.5,
  },
  golem: {
    type: 'golem',
    name: 'Basalt Golem',
    description: 'Walking basalt with immense armor. Chilling hits crack its shell for a few seconds.',
    counterHint: 'Frost cracks its armor to 3 — then fast or armor-piercing hits finish it.',
    maxHp: 340,
    speed: 1.25,
    armor: 12,
    reward: 10,
    livesCost: 3,
    flying: false,
    radius: 0.62,
    height: 1.45,
    brittleArmor: 3,
    brittleDuration: 2.6,
  },
  mite: {
    type: 'mite',
    name: 'Scuttle Mite',
    description: 'Tiny skittering pest that arrives in dense swarms.',
    counterHint: 'Splash and chain lightning shred swarms.',
    maxHp: 22,
    speed: 3.5,
    armor: 0,
    reward: 1,
    livesCost: 1,
    flying: false,
    radius: 0.26,
    height: 0.5,
  },
  hexer: {
    type: 'hexer',
    name: 'Gloam Hexer',
    description:
      'Lantern-bearing hexcaster. When a tower stands close to the road it stops, raises its lantern and hexes that tower silent for a moment.',
    counterHint: 'Kill it before it reaches your towers — towers 2 tiles off the road are out of its reach; Overcharge lifts hexes.',
    maxHp: 120,
    speed: 1.9,
    armor: 1,
    reward: 7,
    livesCost: 2,
    flying: false,
    radius: 0.42,
    height: 1.3,
    hexRadius: 3.6,
    hexInterval: 5.5,
    hexChannelSec: 0.7,
    hexStunSec: 2.4,
  },
  tempest: {
    type: 'tempest',
    name: 'Tempest Colossus',
    description:
      'Storm-forged titan. At two-thirds health it raises a Stormwall over itself and nearby allies; at one-third it enrages, striding faster and jamming towers with thunderclaps.',
    counterHint: 'Save burst for each phase; Overcharge clears the jams.',
    maxHp: 1500,
    speed: 1.0,
    armor: 8,
    reward: 50,
    livesCost: 6,
    flying: false,
    radius: 0.86,
    height: 2.05,
    isBoss: true,
    phaseThresholds: [0.66, 0.33],
    stormwallSelfFrac: 0.2,
    stormwallAllyFrac: 0.6,
    stormwallRadius: 5.0,
    stormwallChannelSec: 1.3,
    enrageSpeedMul: 1.35,
    enrageSummonCount: 6,
    jamInterval: 6.0,
    jamRadius: 7.6,
  },
  boss: {
    type: 'boss',
    name: 'Skyhold Dreadnought',
    description: 'Colossal armored warlord. Calls escorts at half health and pulses to jam nearby towers. Costs 5 lives if it reaches the sanctuary.',
    maxHp: 1150,
    speed: 1.15,
    armor: 8,
    reward: 35,
    livesCost: 5,
    flying: false,
    radius: 0.78,
    height: 1.85,
    isBoss: true,
  },
  // Chapter two. Kept last so key order matches the pre-integration roster + appended chapter.
  ...CHAPTER_ENEMY_DEFS,
};

export const ENEMY_TYPES: readonly EnemyType[] = [
  'grunt',
  'runner',
  'brute',
  'flyer',
  'healer',
  'splitter',
  'warden',
  'burrower',
  'carrier',
  'blinker',
  'golem',
  'mite',
  'hexer',
  ...CHAPTER_ENEMY_TYPES,
  'tempest',
  'boss',
];
