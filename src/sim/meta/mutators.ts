import { SeededRng } from '../../core/rng.ts';
import { ENDLESS_MUTATOR_PRESETS, ENDLESS_MUTATORS } from '../../data/challenges.ts';
import {
  describeActiveModifiers,
  getAllowedTowerTypes,
  mergeRunModifiers,
  NEUTRAL_RUN_MODIFIERS,
  resolveRunModifiers,
} from './modifiers.ts';
import type {
  EndlessMutatorRoll,
  EndlessScoreBreakdown,
  MutatorDef,
  MutatorPreset,
  MutatorSelectionPreview,
  ResolvedRunModifiers,
  RunModifiers,
} from './types.ts';

export type MutatorSelectionInput =
  | { readonly presetId: string }
  | { readonly seed: number | string; readonly count?: number }
  | readonly string[]
  | RunModifiers;

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
  const safeCatalog = Array.isArray(catalog) ? catalog : [];
  const normalizedSeed = normalizeSeed(seed);
  const targetCount = Number.isFinite(count)
    ? Math.max(0, Math.min(safeCatalog.length, Math.floor(count)))
    : Math.min(2, safeCatalog.length);
  const rng = new SeededRng(normalizedSeed);

  // Fisher-Yates shuffle on a shallow copy so selection is uniform and deterministic
  const pool = [...safeCatalog];
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
  if (!Array.isArray(mutatorIds) || !Array.isArray(catalog)) {
    return finalizeMutatorRoll(hashSeedString(''), []);
  }
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
  if (!Array.isArray(presets)) return null;
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
  const waves = Number.isFinite(wavesClearedInEndless)
    ? Math.max(0, Math.floor(wavesClearedInEndless))
    : 0;
  const kills = Number.isFinite(enemiesKilled)
    ? Math.max(0, Math.floor(enemiesKilled))
    : 0;
  const mult = Number.isFinite(scoreMultiplier) && scoreMultiplier > 0 ? scoreMultiplier : 1;
  const baseScore = waves * 150 + kills * 2;
  return {
    baseScore,
    scoreMultiplier: +mult.toFixed(2),
    totalScore: Math.round(baseScore * mult),
  };
}

/** Shared campaign score formula for Daily Watch and Mutated Island replays (includes lives bonus). */
export function computeCampaignRunScore(
  wavesCleared: number,
  enemiesKilled: number,
  livesRemaining: number,
  scoreMultiplier = 1,
): number {
  const safeLives = Number.isFinite(livesRemaining)
    ? Math.max(0, Math.floor(livesRemaining))
    : 0;
  return computeEndlessScore(wavesCleared, enemiesKilled, scoreMultiplier).totalScore + safeLives * 25;
}

/**
 * Resolves a preset ID, seeded roll, mutator ID list, or explicit RunModifiers object
 * into concrete ResolvedRunModifiers for mutated replays or Endless Mode.
 */
export function resolveMutatorSelection(
  input: MutatorSelectionInput,
  presets: readonly MutatorPreset[] = ENDLESS_MUTATOR_PRESETS,
  catalog: readonly MutatorDef[] = ENDLESS_MUTATORS,
): ResolvedRunModifiers {
  if (!input || typeof input !== 'object') {
    return NEUTRAL_RUN_MODIFIERS;
  }
  if (Array.isArray(input)) {
    return buildEndlessMutatorLoadout(input, catalog).modifiers;
  }
  if ('presetId' in input) {
    const presetRoll = getMutatorPresetRoll(input.presetId, presets, catalog);
    if (!presetRoll) {
      throw new RangeError(`Unknown Endless mutator preset "${input.presetId}".`);
    }
    return presetRoll.modifiers;
  }
  if ('seed' in input) {
    return selectEndlessMutators(input.seed, input.count ?? 2, catalog).modifiers;
  }
  return resolveRunModifiers(input as RunModifiers);
}

/**
 * Returns mutator IDs from `catalog` that cannot be combined with `selectedIds`
 * because they share a conflictGroup with an already-selected mutator.
 */
export function getConflictingMutatorIds(
  selectedIds: readonly string[],
  catalog: readonly MutatorDef[] = ENDLESS_MUTATORS,
): readonly string[] {
  if (!Array.isArray(selectedIds) || !Array.isArray(catalog)) return [];
  const selectedSet = new Set(selectedIds);
  const usedGroups = new Set<string>();
  for (let i = 0; i < catalog.length; i++) {
    const def = catalog[i];
    if (selectedSet.has(def.id) && def.conflictGroup) {
      usedGroups.add(def.conflictGroup);
    }
  }
  if (usedGroups.size === 0) return [];
  const conflicting: string[] = [];
  for (let i = 0; i < catalog.length; i++) {
    const def = catalog[i];
    if (!selectedSet.has(def.id) && def.conflictGroup && usedGroups.has(def.conflictGroup)) {
      conflicting.push(def.id);
    }
  }
  return conflicting;
}

/**
 * Previews resolved modifiers, UI badges, score multiplier, legal towers, and conflicting mutator IDs
 * before launching an Endless or Mutated Island run.
 */
export function previewMutatorSelection(
  input: MutatorSelectionInput,
  presets: readonly MutatorPreset[] = ENDLESS_MUTATOR_PRESETS,
  catalog: readonly MutatorDef[] = ENDLESS_MUTATORS,
): MutatorSelectionPreview {
  const modifiers = resolveMutatorSelection(input, presets, catalog);
  return {
    modifiers,
    badges: describeActiveModifiers(modifiers, catalog),
    scoreMultiplier: modifiers.scoreMultiplier,
    allowedTowerTypes: getAllowedTowerTypes(modifiers),
    conflictingMutatorIds: getConflictingMutatorIds(modifiers.activeMutatorIds, catalog),
  };
}
