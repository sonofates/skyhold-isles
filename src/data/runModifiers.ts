import type { TowerType } from '../core/types.ts';

/**
 * Everything outside the island data that changes a run: Workshop upgrades (small permanent
 * boosts) and challenge toggles (handicaps). Pure data, applied by SimWorld at construction.
 * The neutral value reproduces the classic game exactly (the balance sim runs with it).
 */
export interface RunModifiers {
  /** Flat gold added to the island's starting gold (after `startGoldMul`). */
  readonly startGoldBonus: number;
  readonly startGoldMul: number;
  /** Extra lives on top of the base 20 (ignored when `maxLives` is set). */
  readonly bonusLives: number;
  /** Fixed starting lives (challenge), or null for base + bonus. */
  readonly maxLives: number | null;
  readonly abilityCooldownMul: number;
  /** Scales kill rewards. */
  readonly killGoldMul: number;
  /** Scales wave-clear and early-call bonuses. */
  readonly waveBonusMul: number;
  /** Per tower type fire-rate multiplier (missing = 1). */
  readonly towerFireRateMul: Readonly<Partial<Record<TowerType, number>>>;
  readonly enemySpeedMul: number;
  readonly enemyHpMul: number;
  /** Tower types that cannot be built this run. */
  readonly bannedTowers: readonly TowerType[];
  readonly abilitiesDisabled: boolean;
  /** Story waves: the largest ordinary group of every wave spawns Empowered (see champions.ts). */
  readonly championWaves: boolean;
}

export const NEUTRAL_RUN_MODIFIERS: RunModifiers = Object.freeze({
  startGoldBonus: 0,
  startGoldMul: 1,
  bonusLives: 0,
  maxLives: null,
  abilityCooldownMul: 1,
  killGoldMul: 1,
  waveBonusMul: 1,
  towerFireRateMul: Object.freeze({}),
  enemySpeedMul: 1,
  enemyHpMul: 1,
  bannedTowers: Object.freeze([]) as readonly TowerType[],
  abilitiesDisabled: false,
  championWaves: false,
});

/** Partial description used by data tables; missing fields are neutral. */
export type RunModifierPatch = Partial<RunModifiers>;

/**
 * Stacks modifier patches: flat values add, multipliers multiply, `maxLives` takes the lowest,
 * bans union, `abilitiesDisabled` / `championWaves` OR.
 */
export function combineRunModifiers(...patches: readonly RunModifierPatch[]): RunModifiers {
  let startGoldBonus = 0;
  let startGoldMul = 1;
  let bonusLives = 0;
  let maxLives: number | null = null;
  let abilityCooldownMul = 1;
  let killGoldMul = 1;
  let waveBonusMul = 1;
  const towerFireRateMul: Partial<Record<TowerType, number>> = {};
  let enemySpeedMul = 1;
  let enemyHpMul = 1;
  const banned = new Set<TowerType>();
  let abilitiesDisabled = false;
  let championWaves = false;
  for (const p of patches) {
    startGoldBonus += p.startGoldBonus ?? 0;
    startGoldMul *= p.startGoldMul ?? 1;
    bonusLives += p.bonusLives ?? 0;
    if (p.maxLives !== undefined && p.maxLives !== null) {
      maxLives = maxLives === null ? p.maxLives : Math.min(maxLives, p.maxLives);
    }
    abilityCooldownMul *= p.abilityCooldownMul ?? 1;
    killGoldMul *= p.killGoldMul ?? 1;
    waveBonusMul *= p.waveBonusMul ?? 1;
    if (p.towerFireRateMul) {
      for (const [type, mul] of Object.entries(p.towerFireRateMul) as [TowerType, number][]) {
        towerFireRateMul[type] = (towerFireRateMul[type] ?? 1) * mul;
      }
    }
    enemySpeedMul *= p.enemySpeedMul ?? 1;
    enemyHpMul *= p.enemyHpMul ?? 1;
    for (const t of p.bannedTowers ?? []) banned.add(t);
    abilitiesDisabled = abilitiesDisabled || p.abilitiesDisabled === true;
    championWaves = championWaves || p.championWaves === true;
  }
  return {
    startGoldBonus,
    startGoldMul,
    bonusLives,
    maxLives,
    abilityCooldownMul,
    killGoldMul,
    waveBonusMul,
    towerFireRateMul,
    enemySpeedMul,
    enemyHpMul,
    bannedTowers: [...banned],
    abilitiesDisabled,
    championWaves,
  };
}

/** True when the modifiers change nothing (used to label runs / skip work). */
export function isNeutralRun(m: RunModifiers): boolean {
  return (
    m.startGoldBonus === 0 &&
    m.startGoldMul === 1 &&
    m.bonusLives === 0 &&
    m.maxLives === null &&
    m.abilityCooldownMul === 1 &&
    m.killGoldMul === 1 &&
    m.waveBonusMul === 1 &&
    Object.values(m.towerFireRateMul).every((v) => v === 1) &&
    m.enemySpeedMul === 1 &&
    m.enemyHpMul === 1 &&
    m.bannedTowers.length === 0 &&
    !m.abilitiesDisabled &&
    !m.championWaves
  );
}

/**
 * True when `patch` changes at least one gameplay rule active in the 2D build.
 * The 2D game has no active abilities (Meteor Strike / Overcharge), so ability-only patches
 * (`abilitiesDisabled`, `abilityCooldownMul`) evaluate to neutral and have no effect in 2D.
 */
export function hasModifierEffectIn2D(patch: RunModifierPatch): boolean {
  const m = combineRunModifiers(patch);
  return !isNeutralRun({
    ...m,
    abilityCooldownMul: 1,
    abilitiesDisabled: false,
  });
}
