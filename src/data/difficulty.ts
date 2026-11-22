import { MARKET_RULES } from './market.ts';
import { combineRunModifiers, type RunModifierPatch, type RunModifiers } from './runModifiers.ts';

/**
 * Difficulty: a layer ON TOP of each island's own tuning, applied in the sim like a challenge
 * (a deterministic RunModifiers patch). Normal is the island exactly as tuned (no patch), so it
 * keeps working whatever numbers the islands themselves carry. Numbers and the sim pass behind
 * them: docs/difficulty.md (`npm run sim:difficulty`).
 *
 * Rewards: Normal and Hard earn stars as usual (a Hard win also earns the island's Hard ribbon);
 * an Easy win unlocks the next island but awards at most 1 star and no challenge badges, so
 * Easy is a way through, not a star farm. Daily Squall and Endless always run on Normal (their
 * records stay comparable).
 */
export type DifficultyId = 'easy' | 'normal' | 'hard';

export const DIFFICULTY_IDS: readonly DifficultyId[] = ['easy', 'normal', 'hard'];

export const DEFAULT_DIFFICULTY: DifficultyId = 'normal';

export interface DifficultyDef {
  readonly id: DifficultyId;
  /** Applied after Workshop upgrades and challenges (see `combineRunModifiers` stacking rules). */
  readonly patch: RunModifierPatch;
  /** Most stars a win on this difficulty awards (Easy: 1). */
  readonly maxStars: 1 | 2 | 3;
  /** Challenge switches can be combined with it (and their badges earned). */
  readonly allowsChallenges: boolean;
}

export const DIFFICULTIES: Readonly<Record<DifficultyId, DifficultyDef>> = {
  easy: {
    id: 'easy',
    patch: { enemyHpMul: 0.65, enemySpeedMul: 0.92, startGoldMul: 1.25, bonusLives: 5 },
    maxStars: 1,
    allowsChallenges: false,
  },
  normal: {
    id: 'normal',
    patch: {},
    maxStars: 3,
    allowsChallenges: true,
  },
  hard: {
    id: 'hard',
    patch: {
      itemUseCap: MARKET_RULES.useCap.hard,
      enemyHpMul: 1.09,
      startGoldMul: 0.87, startGoldBonus: -250, killGoldMul: 1.3,
      abilityCooldownMul: 1.25, heroRespawnMul: 1.25,
    },
    maxStars: 3,
    allowsChallenges: true,
  },
};

export function isDifficultyId(v: unknown): v is DifficultyId {
  return v === 'easy' || v === 'normal' || v === 'hard';
}

/** URL / storage value → difficulty, null when it is not one (callers decide the fallback). */
export function parseDifficulty(raw: unknown): DifficultyId | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return isDifficultyId(v) ? v : null;
}

export function difficultyPatch(id: DifficultyId): RunModifierPatch {
  return (DIFFICULTIES[id] ?? DIFFICULTIES.normal).patch;
}

/** Effective island starting gold on `id` (same rounding and ≥ 0 floor as SimWorld). */
export function startingGoldForDifficulty(baseGold: number, id: DifficultyId): number {
  const p = difficultyPatch(id);
  const mul = p.startGoldMul !== undefined && Number.isFinite(p.startGoldMul) ? p.startGoldMul : 1;
  const bonus = p.startGoldBonus !== undefined && Number.isFinite(p.startGoldBonus) ? Math.round(p.startGoldBonus) : 0;
  return Math.max(0, Math.round(baseGold * mul) + bonus);
}

/** Stacks the difficulty patch on already composed run modifiers (Normal returns `base` as is). */
export function withDifficulty(base: RunModifiers, id: DifficultyId): RunModifiers {
  if (!isDifficultyId(id) || id === 'normal') return base;
  return combineRunModifiers(base, DIFFICULTIES[id].patch);
}

/** Stars a win on `id` awards (the performance stars capped by the difficulty). */
export function starsAwarded(stars: number, id: DifficultyId): 1 | 2 | 3 {
  const s = Number.isFinite(stars) ? Math.max(1, Math.min(3, Math.round(stars))) : 1;
  const cap = (DIFFICULTIES[id] ?? DIFFICULTIES.normal).maxStars;
  return Math.min(s, cap) as 1 | 2 | 3;
}

/**
 * Per-island best stars awarded on each difficulty (0 = never won there). Saves from before
 * difficulty existed have no record: every win they hold was played on the island's tuning, so
 * they read as Normal wins (`difficultyWinsOf`).
 */
export type DifficultyWins = Record<DifficultyId, number[]>;

const clampStars = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(3, Math.floor(v))) : 0;

/** Sanitises a stored record onto `count` islands (null when `raw` is not a record at all). */
export function sanitizeDifficultyWins(raw: unknown, count: number): DifficultyWins | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const list = (v: unknown, cap: number): number[] =>
    Array.from({ length: n }, (_, i) => Math.min(cap, clampStars(Array.isArray(v) ? v[i] : 0)));
  return {
    easy: list(r.easy, DIFFICULTIES.easy.maxStars),
    normal: list(r.normal, 3),
    hard: list(r.hard, 3),
  };
}

/** The save's per-difficulty record, deriving it for a legacy save (all its wins = Normal). */
export function difficultyWinsOf(progress: {
  readonly bestStars: readonly number[];
  readonly difficultyWins?: unknown;
}): DifficultyWins {
  const n = progress.bestStars.length;
  return (
    sanitizeDifficultyWins(progress.difficultyWins, n) ?? {
      easy: new Array<number>(n).fill(0),
      normal: progress.bestStars.map(clampStars),
      hard: new Array<number>(n).fill(0),
    }
  );
}

/** Best of two records (merging saves): per island, per difficulty, the higher one. */
export function mergeDifficultyWins(a: DifficultyWins, b: DifficultyWins, count: number): DifficultyWins {
  const n = Math.max(0, Math.floor(count));
  const m = (x: readonly number[], y: readonly number[]): number[] =>
    Array.from({ length: n }, (_, i) => Math.max(clampStars(x[i]), clampStars(y[i])));
  return { easy: m(a.easy, b.easy).map((v) => Math.min(v, DIFFICULTIES.easy.maxStars)), normal: m(a.normal, b.normal), hard: m(a.hard, b.hard) };
}
