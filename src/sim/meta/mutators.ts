import { SeededRng } from '../../core/rng.ts';
import { ENDLESS_MUTATOR_PRESETS, ENDLESS_MUTATORS } from '../../data/challenges.ts';
import { mergeRunModifiers } from './modifiers.ts';
import type { EndlessMutatorRoll, EndlessScoreBreakdown, MutatorDef, MutatorPreset } from './types.ts';

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

function finalizeMutatorRoll(seed: number, selected: readonly MutatorDef[]): EndlessMutatorRoll {
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
    seed,
    mutators: selected,
    modifiers,
    scoreMultiplier,
  };
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

  return finalizeMutatorRoll(normalizedSeed, selected);
}

/**
 * Builds a validated Endless mutator loadout from explicit mutator IDs,
 * deduplicating and skipping conflicting groups cleanly in order.
 */
export function buildEndlessMutatorLoadout(
  mutatorIds: readonly string[],
  catalog: readonly MutatorDef[] = ENDLESS_MUTATORS,
): EndlessMutatorRoll {
  const byId = new Map<string, MutatorDef>();
  for (let i = 0; i < catalog.length; i++) {
    byId.set(catalog[i].id, catalog[i]);
  }

  const selected: MutatorDef[] = [];
  const seenIds = new Set<string>();
  const usedGroups = new Set<string>();

  for (let i = 0; i < mutatorIds.length; i++) {
    const def = byId.get(mutatorIds[i]);
    if (!def || seenIds.has(def.id)) continue;
    if (def.conflictGroup && usedGroups.has(def.conflictGroup)) continue;
    seenIds.add(def.id);
    if (def.conflictGroup) usedGroups.add(def.conflictGroup);
    selected.push(def);
  }

  const seed = hashSeedString(selected.map((m) => m.id).join('+'));
  return finalizeMutatorRoll(seed, selected);
}

/** Resolves a curated Endless mutator preset by ID into an EndlessMutatorRoll. */
export function getMutatorPresetRoll(
  presetId: string,
  presets: readonly MutatorPreset[] = ENDLESS_MUTATOR_PRESETS,
  catalog: readonly MutatorDef[] = ENDLESS_MUTATORS,
): EndlessMutatorRoll | null {
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) return null;
  return buildEndlessMutatorLoadout(preset.mutatorIds, catalog);
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
