import type { TowerType } from '../core/types.ts';
import type { LevelDef } from './levels/types.ts';
import { combineRunModifiers, type RunModifierPatch, type RunModifiers } from './runModifiers.ts';

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
  | 'silentSkies';

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
    description: 'Foes move 15% faster',
    patch: { enemySpeedMul: 1.15 },
  },
  ironTide: {
    id: 'ironTide',
    name: 'Iron Tide',
    description: 'Foes have 20% more health',
    patch: { enemyHpMul: 1.2 },
  },
  thinPurse: {
    id: 'thinPurse',
    name: 'Thin Purse',
    description: 'Half starting gold, foes drop 20% less',
    patch: { startGoldMul: 0.5, killGoldMul: 0.8 },
  },
  glassSanctuary: {
    id: 'glassSanctuary',
    name: 'Glass Sanctuary',
    description: 'Only 5 lives (Workshop lives ignored)',
    patch: { maxLives: 5 },
  },
  silentSkies: {
    id: 'silentSkies',
    name: 'Silent Skies',
    description: 'Meteor Strike and Overcharge are disabled',
    patch: { abilitiesDisabled: true },
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
};

/** Fallback for islands without a hand-picked pair (e.g. islands added later), by difficulty. */
const DEFAULT_BY_DIFFICULTY: Readonly<Record<LevelDef['difficulty'], readonly ChallengeId[]>> = {
  Breezy: ['bowless', 'glassSanctuary'],
  Challenging: ['thaw', 'galeForce'],
  Heroic: ['quietGuns', 'thinPurse'],
  Master: ['silentSkies', 'ironTide'],
};

export function challengesForLevel(level: Pick<LevelDef, 'id' | 'difficulty'>): readonly ChallengeId[] {
  return ISLAND_CHALLENGES[level.id] ?? DEFAULT_BY_DIFFICULTY[level.difficulty] ?? [];
}

export function isChallengeId(id: unknown): id is ChallengeId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(CHALLENGES, id);
}

/** Only challenges offered on this island, deduplicated, in the island's order. */
export function sanitizeChallengeSelection(
  level: Pick<LevelDef, 'id' | 'difficulty'>,
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
