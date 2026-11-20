import { MARKET_RULES } from './market.ts';
import type { TowerType } from '../core/types.ts';
import { TOWER_DEFS } from './towers.ts';

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
  readonly itemsDisabled: boolean;
  readonly itemUseCap: number;
  /** Story waves: the largest ordinary group of every wave spawns Empowered (see champions.ts). */
  readonly championWaves: boolean;
  /** Scales the hero's respawn timer (difficulty; 1 = the hero's own timer). */
  readonly heroRespawnMul: number;
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
  itemsDisabled: false,
  itemUseCap: MARKET_RULES.useCap.normal,
  championWaves: false,
  heroRespawnMul: 1,
});

/** Partial description used by data tables; missing fields are neutral. */
export type RunModifierPatch = Partial<RunModifiers>;

const is2DTower = (t: unknown): t is TowerType =>
  typeof t === 'string' && Object.prototype.hasOwnProperty.call(TOWER_DEFS, t);

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
  let itemUseCap: number = MARKET_RULES.useCap.normal;
  let championWaves = false;
  let heroRespawnMul = 1;
  const fin = (v: number | undefined, fb: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fb;
  const finNonNeg = (v: number | undefined, fb: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fb;
  const finPos = (v: number | undefined, fb: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fb;
  for (const p of patches) {
    startGoldBonus += Math.round(fin(p.startGoldBonus, 0));
    startGoldMul *= finNonNeg(p.startGoldMul, 1);
    bonusLives += Math.round(fin(p.bonusLives, 0));
    if (p.maxLives !== undefined && p.maxLives !== null && Number.isFinite(p.maxLives) && p.maxLives >= 1) {
      const cleanMax = Math.floor(p.maxLives);
      maxLives = maxLives === null ? cleanMax : Math.min(maxLives, cleanMax);
    }
    abilityCooldownMul *= finPos(p.abilityCooldownMul, 1);
    killGoldMul *= finNonNeg(p.killGoldMul, 1);
    waveBonusMul *= finNonNeg(p.waveBonusMul, 1);
    if (p.towerFireRateMul) {
      for (const [type, mul] of Object.entries(p.towerFireRateMul)) {
        if (is2DTower(type) && typeof mul === 'number' && Number.isFinite(mul) && mul > 0) {
          towerFireRateMul[type] = (towerFireRateMul[type] ?? 1) * mul;
        }
      }
    }
    enemySpeedMul *= finPos(p.enemySpeedMul, 1);
    enemyHpMul *= finPos(p.enemyHpMul, 1);
    for (const t of p.bannedTowers ?? []) {
      if (is2DTower(t)) banned.add(t);
    }
    itemUseCap = Math.min(itemUseCap, Math.floor(finNonNeg(p.itemUseCap, itemUseCap)));
    abilitiesDisabled = abilitiesDisabled || p.abilitiesDisabled === true;
    championWaves = championWaves || p.championWaves === true;
    heroRespawnMul *= finPos(p.heroRespawnMul, 1);
  }
  const clampRange = (v: number, min: number, max: number, fb: number): number =>
    Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fb;
  for (const k of Object.keys(towerFireRateMul) as TowerType[]) {
    towerFireRateMul[k] = clampRange(towerFireRateMul[k]!, 0.05, 1_000, 1);
  }
  return {
    startGoldBonus: Math.round(clampRange(startGoldBonus, -1_000_000, 1_000_000, 0)),
    startGoldMul: clampRange(startGoldMul, 0, 1_000, 1),
    bonusLives: Math.round(clampRange(bonusLives, -10_000, 10_000, 0)),
    maxLives: maxLives !== null ? Math.max(1, Math.min(10_000, maxLives)) : null,
    abilityCooldownMul: clampRange(abilityCooldownMul, 0.05, 1_000, 1),
    killGoldMul: clampRange(killGoldMul, 0, 1_000, 1),
    waveBonusMul: clampRange(waveBonusMul, 0, 1_000, 1),
    towerFireRateMul,
    enemySpeedMul: clampRange(enemySpeedMul, 0.05, 1_000, 1),
    enemyHpMul: clampRange(enemyHpMul, 0.05, 1_000, 1),
    bannedTowers: [...banned],
    abilitiesDisabled,
    itemUseCap,
    itemsDisabled: abilitiesDisabled || patches.some(p => p.itemsDisabled === true),
    championWaves,
    heroRespawnMul: clampRange(heroRespawnMul, 0.05, 100, 1),
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
    !m.itemsDisabled &&
    (m.itemUseCap ?? MARKET_RULES.useCap.normal) === MARKET_RULES.useCap.normal &&
    !m.championWaves &&
    (m.heroRespawnMul ?? 1) === 1
  );
}

/**
 * True when `patch` changes at least one gameplay rule active in the 2D build.
 * Global abilities (Meteor Strike and Overcharge) are active in 2D, so `abilitiesDisabled` and
 * `abilityCooldownMul` count as real effects; neutral values and bans/multipliers targeting
 * non-existent towers evaluate to false.
 */
export function hasModifierEffectIn2D(patch: RunModifierPatch): boolean {
  const validBans = patch.bannedTowers?.filter(is2DTower);
  const validRates = patch.towerFireRateMul
    ? (Object.fromEntries(
        Object.entries(patch.towerFireRateMul).filter(([t]) => is2DTower(t)),
      ) as Partial<Record<TowerType, number>>)
    : undefined;
  return !isNeutralRun(
    combineRunModifiers({
      ...patch,
      bannedTowers: validBans,
      towerFireRateMul: validRates,
    }),
  );
}
