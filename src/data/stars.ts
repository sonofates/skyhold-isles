import type { LevelDef } from './levels/types.ts';

export type Difficulty = LevelDef['difficulty'];

/**
 * Star rules per island difficulty, expressed as the most lives a win may LOSE for each rating
 * (a win always earns at least 1 star). Using lives lost instead of lives left means bonus lives
 * from the Workshop help survival but never inflate the star rating.
 *
 * Tuned against the balance sim's greedy script windows (lives left out of 20):
 *  - Breezy 18-20 → 3★, Challenging 12-16 → 2★, Heroic 8-13 → 2★, Master 5-10 → 1-2★,
 * so a "competent script" earns the expected rating and 3★ on hard islands needs real skill.
 */
export interface StarRule {
  /** Win with at most this many lives lost → 3 stars. */
  readonly threeStarMaxLost: number;
  /** Win with at most this many lives lost → 2 stars (otherwise 1). */
  readonly twoStarMaxLost: number;
}

export const STAR_RULES: Readonly<Record<Difficulty, StarRule>> = {
  Breezy: { threeStarMaxLost: 2, twoStarMaxLost: 10 },
  Challenging: { threeStarMaxLost: 3, twoStarMaxLost: 10 },
  Heroic: { threeStarMaxLost: 5, twoStarMaxLost: 12 },
  Master: { threeStarMaxLost: 7, twoStarMaxLost: 14 },
};

export const MAX_STARS_PER_ISLAND = 3;

export function computeStarsForLivesLost(livesLost: number, difficulty: Difficulty): 1 | 2 | 3 {
  const rule = STAR_RULES[difficulty] ?? STAR_RULES.Breezy;
  const lost = Math.max(0, Math.floor(Number.isFinite(livesLost) ? livesLost : 0));
  if (lost <= rule.threeStarMaxLost) return 3;
  if (lost <= rule.twoStarMaxLost) return 2;
  return 1;
}

/** Short human-readable goals for an island card / victory screen, e.g. "3★ ≤ 5 lost". */
export function describeStarGoals(difficulty: Difficulty): { three: string; two: string } {
  const rule = STAR_RULES[difficulty] ?? STAR_RULES.Breezy;
  const fmt = (n: number): string => (n === 0 ? 'no lives lost' : `lose ≤ ${n} ${n === 1 ? 'life' : 'lives'}`);
  return { three: fmt(rule.threeStarMaxLost), two: fmt(rule.twoStarMaxLost) };
}
