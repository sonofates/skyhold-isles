import type { EnemyType } from '../core/types.ts';

/**
 * Endless escalation: every ENDLESS_MUTATOR_INTERVAL endless waves (from the 4th endless wave on) a
 * new mutator joins the run and they stack. The order is a fixed list rotated per island, so each
 * island escalates differently but deterministically (no RNG needed).
 */
export const ENDLESS_MUTATOR_INTERVAL = 3;

export type EndlessMutatorId =
  | 'tailwind'
  | 'ironbark'
  | 'swarmtide'
  | 'vanguard'
  | 'thickhide'
  | 'galeRiders'
  | 'leanPickings';

export interface EndlessMutatorDef {
  readonly id: EndlessMutatorId;
  readonly name: string;
  readonly description: string;
  readonly hpMul?: number;
  readonly speedMul?: number;
  readonly armorBonus?: number;
  /** Scales every group's count. */
  readonly countMul?: number;
  /** Scales flying groups' count. */
  readonly flyerCountMul?: number;
  /** Every spotlight group (the rotating newer archetypes) arrives Empowered. */
  readonly allSpotlightElite?: boolean;
  readonly killGoldMul?: number;
}

export const ENDLESS_MUTATORS: readonly EndlessMutatorDef[] = [
  { id: 'tailwind', name: 'Tailwind', description: 'Foes move 8% faster', speedMul: 1.08 },
  { id: 'ironbark', name: 'Ironbark', description: 'Foes gain +2 armor', armorBonus: 2 },
  { id: 'swarmtide', name: 'Swarmtide', description: '20% more foes per wave', countMul: 1.2 },
  { id: 'vanguard', name: 'Vanguard', description: 'Every spotlight group is Empowered', allSpotlightElite: true },
  { id: 'thickhide', name: 'Thick Hide', description: 'Foes have 12% more health', hpMul: 1.12 },
  { id: 'galeRiders', name: 'Gale Riders', description: '40% more flyers', flyerCountMul: 1.4 },
  { id: 'leanPickings', name: 'Lean Pickings', description: 'Foes drop 15% less gold', killGoldMul: 0.85 },
];

/** Aggregated mutator effects for one endless wave. */
export interface EndlessMutatorEffects {
  readonly hpMul: number;
  readonly speedMul: number;
  readonly armorBonus: number;
  readonly countMul: number;
  readonly flyerCountMul: number;
  readonly allSpotlightElite: boolean;
  readonly killGoldMul: number;
}

export const NO_ENDLESS_MUTATORS: EndlessMutatorEffects = Object.freeze({
  hpMul: 1,
  speedMul: 1,
  armorBonus: 0,
  countMul: 1,
  flyerCountMul: 1,
  allSpotlightElite: false,
  killGoldMul: 1,
});

/**
 * Mutators active on the endless wave `endlessOffset` (0 = first wave after the story) of the
 * island with index `islandIndex`. One more every ENDLESS_MUTATOR_INTERVAL waves; past the end of
 * the list the rotation repeats and copies stack.
 */
export function endlessMutatorsAt(endlessOffset: number, islandIndex: number): EndlessMutatorDef[] {
  const count = Math.max(0, Math.floor(endlessOffset / ENDLESS_MUTATOR_INTERVAL));
  const n = ENDLESS_MUTATORS.length;
  const start = ((Math.floor(islandIndex) * 3) % n + n) % n;
  const out: EndlessMutatorDef[] = [];
  for (let k = 0; k < count; k++) out.push(ENDLESS_MUTATORS[(start + k) % n]);
  return out;
}

/** The mutator that joins on this endless wave (null when none does). */
export function newEndlessMutatorAt(endlessOffset: number, islandIndex: number): EndlessMutatorDef | null {
  if (endlessOffset <= 0 || endlessOffset % ENDLESS_MUTATOR_INTERVAL !== 0) return null;
  const list = endlessMutatorsAt(endlessOffset, islandIndex);
  return list[list.length - 1] ?? null;
}

export function combineEndlessMutators(list: readonly EndlessMutatorDef[]): EndlessMutatorEffects {
  if (list.length === 0) return NO_ENDLESS_MUTATORS;
  let hpMul = 1;
  let speedMul = 1;
  let armorBonus = 0;
  let countMul = 1;
  let flyerCountMul = 1;
  let allSpotlightElite = false;
  let killGoldMul = 1;
  for (const m of list) {
    hpMul *= m.hpMul ?? 1;
    speedMul *= m.speedMul ?? 1;
    armorBonus += m.armorBonus ?? 0;
    countMul *= m.countMul ?? 1;
    flyerCountMul *= m.flyerCountMul ?? 1;
    allSpotlightElite = allSpotlightElite || m.allSpotlightElite === true;
    killGoldMul *= m.killGoldMul ?? 1;
  }
  return { hpMul, speedMul, armorBonus, countMul, flyerCountMul, allSpotlightElite, killGoldMul };
}

/** Group sizes stay bounded so huge stacks can't exhaust the enemy pool in one wave. */
export const ENDLESS_GROUP_COUNT_CAP = 60;

/** Scales a group's count by the active mutators (at least the original count, capped). */
export function mutatedGroupCount(
  baseCount: number,
  flying: boolean,
  fx: EndlessMutatorEffects,
): number {
  const mul = fx.countMul * (flying ? fx.flyerCountMul : 1);
  if (mul === 1) return baseCount;
  return Math.max(baseCount, Math.min(ENDLESS_GROUP_COUNT_CAP, Math.round(baseCount * mul)));
}

/** Types that are boss-class: mutators never multiply their counts. */
export const ENDLESS_UNSCALED_TYPES: readonly EnemyType[] = ['boss', 'tempest'];

/**
 * Units a single spawn can bring along mid-wave (split children, escorts, raiders, mites), used to
 * keep a mutated endless wave inside the enemy pool (same weights as the pool-capacity test).
 */
export const ENDLESS_POOL_EXTRA: Readonly<Partial<Record<EnemyType, number>>> = {
  splitter: 2,
  boss: 2,
  carrier: 2,
  tempest: 6,
};

export function poolWeight(type: EnemyType): number {
  return 1 + (ENDLESS_POOL_EXTRA[type] ?? 0);
}

/** Endless medal tiers by endless waves cleared beyond the story. */
export const ENDLESS_TIERS: readonly { readonly name: string; readonly cleared: number }[] = [
  { name: 'Bronze', cleared: 3 },
  { name: 'Silver', cleared: 6 },
  { name: 'Gold', cleared: 10 },
];

/**
 * Medal tier (0 none, 1 bronze, 2 silver, 3 gold) for an island's best endless wave. `bestWave` is
 * the one-based wave the run fell on, so waves cleared past the story = bestWave - 1 - storyWaves.
 */
export function endlessTier(bestWave: number, storyWaves: number): number {
  const cleared = Math.max(0, Math.floor(bestWave) - 1 - storyWaves);
  let tier = 0;
  for (let i = 0; i < ENDLESS_TIERS.length; i++) if (cleared >= ENDLESS_TIERS[i].cleared) tier = i + 1;
  return tier;
}
