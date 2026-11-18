import type { TowerType } from '../core/types.ts';
import type { LevelDef } from './levels/types.ts';
import {
  combineRunModifiers,
  hasModifierEffectIn2D,
  type RunModifierPatch,
  type RunModifiers,
} from './runModifiers.ts';
import { TOWER_DEFS } from './towers.ts';

/**
 * Island challenges: optional handicaps unlocked after an island's first clear. Winning with a
 * challenge toggled on earns its badge plus one bonus star (Workshop currency). Several can be
 * stacked in one run; each one won counts. A challenge win is still a normal win (stars, unlocks).
 */
export type ChallengeId =
  | 'thaw'
  | 'quietGuns'
  | 'bowless'
  | 'staticFree'
  | 'galeForce'
  | 'ironTide'
  | 'thinPurse'
  | 'glassSanctuary'
  | 'silentSkies'
  | 'championHost';

export interface ChallengeDef {
  readonly id: ChallengeId;
  readonly name: string;
  readonly description: string;
  /** Tower whose icon represents a ban (UI); absent for rule changes. */
  readonly bannedIcon?: TowerType;
  readonly patch: RunModifierPatch;
}

export const CHALLENGES: Readonly<Record<ChallengeId, ChallengeDef>> = {
  thaw: {
    id: 'thaw',
    name: 'Thaw',
    description: 'Frost Towers cannot be built',
    bannedIcon: 'frost',
    patch: { bannedTowers: ['frost'] },
  },
  quietGuns: {
    id: 'quietGuns',
    name: 'Quiet Guns',
    description: 'Cannons and Mortars cannot be built',
    bannedIcon: 'cannon',
    patch: { bannedTowers: ['cannon', 'mortar'] },
  },
  bowless: {
    id: 'bowless',
    name: 'Bowless',
    description: 'Archer Towers cannot be built',
    bannedIcon: 'archer',
    patch: { bannedTowers: ['archer'] },
  },
  staticFree: {
    id: 'staticFree',
    name: 'Still Air',
    description: 'Tesla Towers cannot be built',
    bannedIcon: 'tesla',
    patch: { bannedTowers: ['tesla'] },
  },
  galeForce: {
    id: 'galeForce',
    name: 'Gale Force',
    description: 'Foes move 12% faster',
    patch: { enemySpeedMul: 1.12 },
  },
  ironTide: {
    id: 'ironTide',
    name: 'Iron Tide',
    description: 'Foes have 12% more health',
    patch: { enemyHpMul: 1.12 },
  },
  thinPurse: {
    id: 'thinPurse',
    name: 'Thin Purse',
    description: '30% less starting gold, foes drop 15% less',
    patch: { startGoldMul: 0.7, killGoldMul: 0.85 },
  },
  glassSanctuary: {
    id: 'glassSanctuary',
    name: 'Glass Sanctuary',
    description: 'Only 8 lives (Workshop lives ignored)',
    patch: { maxLives: 8 },
  },
  silentSkies: {
    id: 'silentSkies',
    name: 'Silent Skies',
    description: 'Meteor Strike and Overcharge are disabled',
    patch: { abilitiesDisabled: true },
  },
  championHost: {
    id: 'championHost',
    name: 'Champion Host',
    description: 'The largest group of every wave arrives Empowered',
    patch: { championWaves: true },
  },
};

export const CHALLENGE_IDS = Object.keys(CHALLENGES) as ChallengeId[];

/**
 * Hand-picked pairs per island (keyed by level id so reordering never shuffles badges). Each pair
 * mixes a build restriction with a rule change that fits the island's theme.
 */
const ISLAND_CHALLENGES: Readonly<Record<string, readonly ChallengeId[]>> = {
  'sunlit-meadow': ['bowless', 'glassSanctuary'],
  'twin-bridge-cay': ['quietGuns', 'galeForce'],
  'highland-citadel': ['thaw', 'thinPurse'],
  'emerald-stepping-stones': ['staticFree', 'ironTide'],
  'windmill-switchback': ['galeForce', 'silentSkies'],
  'crescent-lagoon': ['bowless', 'thinPurse'],
  'skybridge-gauntlet': ['quietGuns', 'glassSanctuary'],
  'sunken-bastion': ['thaw', 'silentSkies'],
  'grand-skyhold': ['ironTide', 'glassSanctuary'],
  'confluence-terraces': ['staticFree', 'galeForce'],
  'galewatch-spires': ['bowless', 'silentSkies'],
  'lanternfall-hollow': ['thaw', 'ironTide'],
  'stormcrown-citadel': ['quietGuns', 'thinPurse'],
  // Islands 14-16 (CONTENT branch, merged on integration-day). Picked from a per-challenge greedy
  // sweep on the merged levels (see PROGRESS-skyhold-day-campaign).
  'amberstone-mesa': ['bowless', 'galeForce'],
  'moonwell-crossing': ['silentSkies', 'glassSanctuary'],
  'emberglass-sanctum': ['thaw', 'ironTide'],
};

/** Level ids with a hand-picked pair (tests check they are real or known-pending islands). */
export const HAND_PICKED_CHALLENGE_ISLANDS: readonly string[] = Object.keys(ISLAND_CHALLENGES);

/** Fallback for islands without a hand-picked pair (e.g. islands added later), by difficulty. */
const DEFAULT_BY_DIFFICULTY: Readonly<Record<LevelDef['difficulty'], readonly ChallengeId[]>> = {
  Breezy: ['bowless', 'glassSanctuary'],
  Challenging: ['thaw', 'galeForce'],
  Heroic: ['quietGuns', 'thinPurse'],
  Master: ['silentSkies', 'ironTide'],
};

export function challengesForLevel(
  level: Pick<LevelDef, 'id' | 'difficulty'> & { readonly layout2d?: unknown },
): readonly ChallengeId[] {
  const offered = ISLAND_CHALLENGES[level.id] ?? DEFAULT_BY_DIFFICULTY[level.difficulty] ?? [];
  return level.layout2d ? offered.filter((id) => isChallengeEffectiveIn2D(CHALLENGES[id])) : offered;
}

/**
 * Data-driven check for whether a challenge's modifier patch actually alters a 2D plot-map run
 * (where active abilities do not exist, and tower bans / rate multipliers only apply to 2D towers).
 */
export function isChallengeEffectiveIn2D(challenge: Pick<ChallengeDef, 'patch'>): boolean {
  const p = challenge.patch;
  const validBans = p.bannedTowers?.filter((t) => Object.prototype.hasOwnProperty.call(TOWER_DEFS, t));
  const validRates = p.towerFireRateMul
    ? (Object.fromEntries(
        Object.entries(p.towerFireRateMul).filter(([t]) => Object.prototype.hasOwnProperty.call(TOWER_DEFS, t)),
      ) as Partial<Record<TowerType, number>>)
    : undefined;
  return hasModifierEffectIn2D({
    ...p,
    bannedTowers: validBans,
    towerFireRateMul: validRates,
  });
}

/** Challenge IDs whose rules have a real gameplay effect in 2D (excludes e.g. `silentSkies`). */
export const CHALLENGE_IDS_2D: readonly ChallengeId[] = CHALLENGE_IDS.filter((id) =>
  isChallengeEffectiveIn2D(CHALLENGES[id]),
);

export function isChallengeId(id: unknown): id is ChallengeId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(CHALLENGES, id);
}

/** Only challenges offered on this island, deduplicated, in the island's order. */
export function sanitizeChallengeSelection(
  level: Pick<LevelDef, 'id' | 'difficulty'> & { readonly layout2d?: unknown },
  selected: readonly unknown[],
): ChallengeId[] {
  const offered = challengesForLevel(level);
  return offered.filter((id) => selected.includes(id));
}

export function challengeModifiers(ids: readonly ChallengeId[]): RunModifiers {
  return combineRunModifiers(...ids.map((id) => CHALLENGES[id].patch));
}

/** Workshop upgrades + the run's challenges (challenges' `maxLives` overrides Workshop lives). */
export function runModifiersFor(
  workshop: RunModifiers,
  challenges: readonly ChallengeId[],
): RunModifiers {
  if (challenges.length === 0) return workshop;
  return combineRunModifiers(workshop, ...challenges.map((id) => CHALLENGES[id].patch));
}
