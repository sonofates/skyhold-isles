import { SeededRng } from '../../core/rng.ts';
import { ENDLESS_MUTATORS } from '../../data/challenges.ts';
import { mergeRunModifiers } from './modifiers.ts';
import type { EndlessMutatorRoll, EndlessScoreBreakdown, MutatorDef } from './types.ts';

/** Deterministic 32-bit FNV-1a hash of a seed string. */
export function hashSeedString(input: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Converts a numeric or string seed into an unsigned 32-bit integer seed. */
export function normalizeSeed(seed: number | string): number {
  if (typeof seed === 'string') {
    return hashSeedString(seed);
  }
  if (!Number.isFinite(seed)) return 1;
  return Math.floor(seed) >>> 0;
}

/**
 * Deterministically selects `count` compatible mutators from `catalog` using `SeededRng`,
 * avoiding conflicting groups (e.g. double economy squeezes or stacking multiple anti-air bans).
 */
export function selectEndlessMutators(
  seed: number | string,
  count = 2,
  catalog: readonly MutatorDef[] = ENDLESS_MUTATORS,
): EndlessMutatorRoll {
  const normalizedSeed = normalizeSeed(seed);
  const targetCount = Math.max(0, Math.min(catalog.length, Math.floor(count)));
  const rng = new SeededRng(normalizedSeed);

  // Fisher-Yates shuffle on a shallow copy so selection is uniform and deterministic
  const pool = [...catalog];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }

  const selected: MutatorDef[] = [];
  const usedConflictGroups = new Set<string>();

  for (let i = 0; i < pool.length && selected.length < targetCount; i++) {
    const candidate = pool[i];
    if (candidate.conflictGroup && usedConflictGroups.has(candidate.conflictGroup)) {
      continue;
    }
    selected.push(candidate);
    if (candidate.conflictGroup) {
      usedConflictGroups.add(candidate.conflictGroup);
    }
  }

  let scoreBonusSum = 0;
  const mutatorIds: string[] = [];
  for (let i = 0; i < selected.length; i++) {
    scoreBonusSum += selected[i].scoreMultiplierBonus;
    mutatorIds.push(selected[i].id);
  }
  const scoreMultiplier = +(1 + scoreBonusSum).toFixed(2);
  const modifiers = mergeRunModifiers(
    ...selected.map((m) => m.modifiers),
    { activeMutatorIds: mutatorIds, scoreMultiplier },
  );

  return {
    seed: normalizedSeed,
    mutators: selected,
    modifiers,
    scoreMultiplier,
  };
}

/** Computes Endless Mode score factoring in cleared waves, kills, and active mutator multiplier. */
export function computeEndlessScore(
  wavesClearedInEndless: number,
  enemiesKilled: number,
  scoreMultiplier = 1,
): EndlessScoreBreakdown {
  const waves = Math.max(0, Math.floor(wavesClearedInEndless));
  const kills = Math.max(0, Math.floor(enemiesKilled));
  const mult = Number.isFinite(scoreMultiplier) && scoreMultiplier > 0 ? scoreMultiplier : 1;
  const baseScore = waves * 150 + kills * 2;
  return {
    baseScore,
    scoreMultiplier: +mult.toFixed(2),
    totalScore: Math.round(baseScore * mult),
  };
}
