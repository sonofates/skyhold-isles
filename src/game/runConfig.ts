import { isChallengeId, sanitizeChallengeSelection, type ChallengeId } from '../data/challenges.ts';
import type { LevelDef } from '../data/levels/types.ts';

/** How a run was launched (island briefing → mode + challenge toggles, or the Daily Squall). */
export interface RunConfig {
  /** Endless from wave 1 (no victory / stars). */
  endless: boolean;
  challenges: ChallengeId[];
  /** UTC day number when this run is that day's Daily Squall (null otherwise). */
  daily: number | null;
}

export const PLAIN_RUN: Readonly<RunConfig> = Object.freeze({
  endless: false,
  challenges: Object.freeze([]) as unknown as ChallengeId[],
  daily: null,
});

/**
 * Validates a requested run. Challenges, Endless-from-card and the Daily all require the island to
 * have been cleared once; anything else falls back to a plain campaign run (which still unlocks).
 * Normal challenge runs only accept the island's own challenges; the Daily may use any.
 */
export function resolveRunConfig(
  level: Pick<LevelDef, 'id' | 'difficulty'>,
  cleared: boolean,
  requested: Partial<RunConfig>,
): RunConfig {
  if (!cleared) return { endless: false, challenges: [], daily: null };
  if (typeof requested.daily === 'number' && requested.endless !== true) {
    const unique: ChallengeId[] = [];
    for (const id of requested.challenges ?? []) {
      if (isChallengeId(id) && !unique.includes(id)) unique.push(id);
    }
    return { endless: false, challenges: unique, daily: requested.daily };
  }
  if (requested.endless === true) return { endless: true, challenges: [], daily: null };
  return {
    endless: false,
    challenges: sanitizeChallengeSelection(level, requested.challenges ?? []),
    daily: null,
  };
}

/** Island badges a win earns: only the island's own challenges that were active. */
export function badgesForWin(offered: readonly ChallengeId[], active: readonly ChallengeId[]): ChallengeId[] {
  return active.filter((id) => offered.includes(id));
}
