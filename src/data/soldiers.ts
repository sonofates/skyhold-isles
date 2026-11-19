import type { EnemyType } from '../core/types.ts';
import { CHAPTER_ENEMY_MELEE } from './enemies.ts';

/**
 * Barracks soldiers vs enemies: how each archetype reacts to being blocked and how hard it hits
 * back. Soldier stats per tier live on the barracks tier (src/data/towers.ts).
 *
 * Rules (the system itself is src/sim/soldierSystem.ts):
 * - A soldier in melee contact blocks the enemy. An enemy with `holdCost` N stops when N soldiers
 *   are in contact; with fewer it is slowed to (1 - contact / N) of its speed.
 * - `ignore`: never engaged (flyers: Sky Skimmer, Cloud Hauler).
 * - Burrowers can be held only while surfaced: a dive breaks the hold and they tunnel past.
 * - Blinkers can be held, but their blink keeps charging (only chill slows it): the jump breaks
 *   the hold and lands them beyond the squad.
 * - Tempest Colossus tramples soldiers once enraged (phase 2): it can no longer be held.
 * - Enemy melee damage scales with sqrt(hp scale): wave growth and elites hit harder, but much
 *   less steeply than their HP grows.
 */
export interface MeleeProfile {
  /** 'block': soldiers can hold it; 'ignore': passes soldiers untouched. */
  readonly block: 'block' | 'ignore';
  /** Soldiers in contact needed to stop it completely. */
  readonly holdCost: number;
  /** Damage per strike against a soldier at hp scale 1 (soldier armor is subtracted, min 1). */
  readonly damage: number;
  /** Strikes per second while held. */
  readonly rate: number;
  /** Strikes every soldier in contact instead of only the first. */
  readonly sweep?: boolean;
  /** From this boss phase on it tramples through soldiers (cannot be held). */
  readonly trampleFromPhase?: number;
}

export const ENEMY_MELEE: Readonly<Record<EnemyType, MeleeProfile>> = {
  grunt: { block: 'block', holdCost: 1, damage: 7, rate: 1.0 },
  runner: { block: 'block', holdCost: 1, damage: 4, rate: 1.4 },
  brute: { block: 'block', holdCost: 1, damage: 18, rate: 0.8 },
  flyer: { block: 'ignore', holdCost: 1, damage: 0, rate: 0 },
  healer: { block: 'block', holdCost: 1, damage: 4, rate: 0.9 },
  splitter: { block: 'block', holdCost: 1, damage: 8, rate: 1.0 },
  warden: { block: 'block', holdCost: 1, damage: 8, rate: 0.9 },
  burrower: { block: 'block', holdCost: 1, damage: 9, rate: 1.0 },
  carrier: { block: 'ignore', holdCost: 1, damage: 0, rate: 0 },
  blinker: { block: 'block', holdCost: 1, damage: 7, rate: 1.1 },
  golem: { block: 'block', holdCost: 2, damage: 26, rate: 0.7 },
  mite: { block: 'block', holdCost: 1, damage: 3, rate: 1.6 },
  hexer: { block: 'block', holdCost: 1, damage: 5, rate: 0.9 },
  tempest: { block: 'block', holdCost: 3, damage: 40, rate: 0.75, sweep: true, trampleFromPhase: 2 },
  boss: { block: 'block', holdCost: 3, damage: 34, rate: 0.8, sweep: true },
  // Chapter two (i17–i24): hare / piper single-block, tortoise two-block, moth flies over.
  ...CHAPTER_ENEMY_MELEE,
};

/** Shared soldier tuning (not per tier). Distances in world units, times in seconds. */
export const SOLDIER_RULES = {
  /** Walking speed (faster than every ground enemy except runners / mites). */
  speed: 3.2,
  /** Body radius: contact distance = enemy radius + this. */
  radius: 0.3,
  /** Extra slack before a soldier in contact counts as out of contact (chasing). */
  contactSlack: 0.3,
  /** Enemies within this distance of the rally point get engaged. */
  engageRadius: 1.7,
  /** A held enemy further than this from the rally point is let go (blinks, drags, slips). */
  leashRadius: 2.8,
  /** Most soldiers that gang up on one enemy (after every enemy in reach is held). */
  maxPerEnemy: 3,
  /** Idle regeneration: fraction of max HP per second, after this long without being hit. */
  regenFrac: 0.05,
  regenDelay: 1.5,
  /** Cleave reach around the struck enemy. */
  cleaveRadius: 0.95,
  /** Rally clamp: path sampling step when searching the nearest road point in range. */
  rallySampleStep: 0.05,
} as const;

/** Formation around the rally point in (along road toward the goal, across road) units, per squad size. */
export const SOLDIER_FORMATION: readonly (readonly (readonly [number, number])[])[] = [
  [],
  [[0, 0]],
  [
    [0, -0.45],
    [0, 0.45],
  ],
  [
    [-0.45, 0],
    [0.25, -0.5],
    [0.25, 0.5],
  ],
  [
    [-0.4, -0.35],
    [-0.4, 0.35],
    [0.35, -0.45],
    [0.35, 0.45],
  ],
];
