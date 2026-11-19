import type { TowerType } from '../core/types.ts';
import { combineRunModifiers, type RunModifierPatch, type RunModifiers } from './runModifiers.ts';

/**
 * The Skywright Workshop: small permanent upgrades bought with stars, refundable at any time.
 *
 * Power budget (all ranks owned): +20 start gold, +4% kill gold, +2 lives, −15% ability cooldowns
 * and +2% fire rate for every attacking tower — roughly +5% effective strength. The level balance
 * is knife-edge (a +6% fire-rate test wiped out every lost life on some Master islands), so the
 * budget is deliberately below the ~10% ceiling; lives/cooldowns carry most of the felt value. The balance sim
 * runs with NO upgrades (baseline) and separately checks that a fully upgraded greedy script still
 * loses lives on every Master island (`scripts/balanceSim.ts`, "Workshop max" section).
 */
export type WorkshopBranch = 'economy' | 'defense' | 'towers';

export type WorkshopUpgradeId =
  | 'treasury'
  | 'bounty'
  | 'bastion'
  | 'quickcast'
  | 'fletcher'
  | 'powder'
  | 'storm';

export interface WorkshopUpgradeDef {
  readonly id: WorkshopUpgradeId;
  readonly name: string;
  readonly branch: WorkshopBranch;
  /** Star cost of each rank (index 0 = rank 1). */
  readonly costs: readonly number[];
  /** Effect text per rank (index 0 = rank 1), e.g. "+10 starting gold". */
  readonly rankText: readonly string[];
  /** Short flavour line under the name. */
  readonly blurb: string;
  /** Towers this upgrade boosts (for icons), if any. */
  readonly towers?: readonly TowerType[];
  /** Modifier patch granted at a given rank (1..costs.length). */
  readonly effect: (rank: number) => RunModifierPatch;
}

const rateFor = (types: readonly TowerType[], mul: number): RunModifierPatch => {
  const towerFireRateMul: Partial<Record<TowerType, number>> = {};
  for (const t of types) towerFireRateMul[t] = mul;
  return { towerFireRateMul };
};

const FAMILY_RATE = [1.01, 1.02] as const;

export const WORKSHOP_UPGRADES: readonly WorkshopUpgradeDef[] = [
  {
    id: 'treasury',
    name: 'Sky Treasury',
    branch: 'economy',
    blurb: 'A coin chest waits on every island.',
    costs: [1, 2],
    rankText: ['+10 starting gold', '+20 starting gold'],
    effect: (rank) => ({ startGoldBonus: 10 * rank }),
  },
  {
    id: 'bounty',
    name: 'Bounty Charter',
    branch: 'economy',
    blurb: 'Raiders carry a little more loot.',
    costs: [2, 3],
    rankText: ['+2% gold per foe', '+4% gold per foe'],
    effect: (rank) => ({ killGoldMul: 1 + 0.02 * rank }),
  },
  {
    id: 'bastion',
    name: 'Bastion Walls',
    branch: 'defense',
    blurb: 'Sturdier sanctuary gates. Stars still count lives lost.',
    costs: [2, 3],
    rankText: ['+1 life', '+2 lives'],
    effect: (rank) => ({ bonusLives: rank }),
  },
  {
    id: 'quickcast',
    name: 'Quickcast Runes',
    branch: 'defense',
    blurb: 'Meteor Strike and Overcharge recharge faster.',
    costs: [2, 3],
    rankText: ['−8% ability cooldowns', '−15% ability cooldowns'],
    effect: (rank) => ({ abilityCooldownMul: rank >= 2 ? 0.85 : 0.92 }),
  },
  {
    id: 'fletcher',
    name: "Fletcher's Kit",
    branch: 'towers',
    blurb: 'Archer and Ballista crews reload faster.',
    towers: ['archer', 'ballista'],
    costs: [2, 3],
    rankText: ['+1% fire rate', '+2% fire rate'],
    effect: (rank) => rateFor(['archer', 'ballista'], FAMILY_RATE[rank - 1] ?? 1),
  },
  {
    id: 'powder',
    name: 'Powder Works',
    branch: 'towers',
    blurb: 'Cannon and Mortar shells are loaded quicker.',
    towers: ['cannon', 'mortar'],
    costs: [2, 3],
    rankText: ['+1% fire rate', '+2% fire rate'],
    effect: (rank) => rateFor(['cannon', 'mortar'], FAMILY_RATE[rank - 1] ?? 1),
  },
  {
    id: 'storm',
    name: 'Storm Lore',
    branch: 'towers',
    blurb: 'Frost and Tesla spires charge faster.',
    towers: ['frost', 'tesla'],
    costs: [2, 3],
    rankText: ['+1% fire rate', '+2% fire rate'],
    effect: (rank) => rateFor(['frost', 'tesla'], FAMILY_RATE[rank - 1] ?? 1),
  },
];

export const WORKSHOP_BRANCHES: readonly { id: WorkshopBranch; name: string }[] = [
  { id: 'economy', name: 'Economy' },
  { id: 'defense', name: 'Defense' },
  { id: 'towers', name: 'Towers' },
];

const BY_ID = new Map<string, WorkshopUpgradeDef>(WORKSHOP_UPGRADES.map((u) => [u.id, u]));

export function getWorkshopUpgrade(id: string): WorkshopUpgradeDef | undefined {
  return BY_ID.get(id);
}

/** Owned ranks per upgrade id. Unknown ids are ignored everywhere. */
export type WorkshopRanks = Readonly<Record<string, number>>;

export function maxRank(def: WorkshopUpgradeDef): number {
  return def.costs.length;
}

/** Clamped owned rank of an upgrade (0..max). */
export function rankOf(ranks: WorkshopRanks, id: WorkshopUpgradeId): number {
  const def = BY_ID.get(id);
  const raw = ranks[id];
  if (!def || typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(maxRank(def), Math.floor(raw)));
}

/** Stars spent on everything owned. */
export function workshopStarsSpent(ranks: WorkshopRanks): number {
  let total = 0;
  for (const def of WORKSHOP_UPGRADES) {
    const r = rankOf(ranks, def.id);
    for (let i = 0; i < r; i++) total += def.costs[i];
  }
  return total;
}

/** Stars needed to buy every rank of every upgrade. */
export function workshopTotalCost(): number {
  let total = 0;
  for (const def of WORKSHOP_UPGRADES) for (const c of def.costs) total += c;
  return total;
}

/** Cost of the next rank, or null at max rank. */
export function nextRankCost(ranks: WorkshopRanks, id: WorkshopUpgradeId): number | null {
  const def = BY_ID.get(id);
  if (!def) return null;
  const r = rankOf(ranks, id);
  return r >= maxRank(def) ? null : def.costs[r];
}

/**
 * Buys the next rank if affordable with `availableStars`. Returns the new ranks object (input is
 * not mutated) or null when the purchase is not possible.
 */
export function buyRank(
  ranks: WorkshopRanks,
  id: WorkshopUpgradeId,
  availableStars: number,
): Record<string, number> | null {
  const cost = nextRankCost(ranks, id);
  if (cost === null || !Number.isFinite(availableStars) || availableStars < cost) return null;
  return { ...sanitizeRanks(ranks), [id]: rankOf(ranks, id) + 1 };
}

/** Drops unknown ids and clamps ranks into range. */
export function sanitizeRanks(ranks: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!ranks || typeof ranks !== 'object') return out;
  for (const def of WORKSHOP_UPGRADES) {
    const r = rankOf(ranks as WorkshopRanks, def.id);
    if (r > 0) out[def.id] = r;
  }
  return out;
}

/** All owned upgrades folded into one modifier patch list entry. */
export function workshopModifiers(ranks: WorkshopRanks): RunModifiers {
  const patches: RunModifierPatch[] = [];
  for (const def of WORKSHOP_UPGRADES) {
    const r = rankOf(ranks, def.id);
    if (r > 0) patches.push(def.effect(r));
  }
  return combineRunModifiers(...patches);
}

/** Every upgrade at max rank (balance sim "Workshop max" check). */
export function maxedWorkshopRanks(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const def of WORKSHOP_UPGRADES) out[def.id] = maxRank(def);
  return out;
}
