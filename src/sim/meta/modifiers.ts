import type { TowerType } from '../../core/types.ts';
import type { LevelDef, WaveDef, WaveGroupDef } from '../../data/levels/types.ts';
import { TOWER_TYPES } from '../../data/towers.ts';
import type { ResolvedRunModifiers, RunModifiers } from './types.ts';

export const NEUTRAL_RUN_MODIFIERS: ResolvedRunModifiers = {
  enemySpeedMultiplier: 1,
  enemyHpMultiplier: 1,
  enemyArmorBonus: 0,
  flyerCountMultiplier: 1,
  goldRewardMultiplier: 1,
  startingGoldMultiplier: 1,
  towerCostMultiplier: 1,
  allowedTowerTypes: null,
  forbiddenTowerTypes: [],
  activeMutatorIds: [],
  scoreMultiplier: 1,
};

function clampPositive(value: number | undefined, fallback: number, min = 0.1): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(min, value);
}

/** Normalizes partial RunModifiers into concrete defaults. */
export function resolveRunModifiers(modifiers?: RunModifiers | null): ResolvedRunModifiers {
  if (!modifiers) return NEUTRAL_RUN_MODIFIERS;
  const allowed =
    modifiers.allowedTowerTypes && modifiers.allowedTowerTypes.length > 0
      ? [...new Set(modifiers.allowedTowerTypes)]
      : null;
  const forbidden = modifiers.forbiddenTowerTypes
    ? [...new Set(modifiers.forbiddenTowerTypes)]
    : [];
  const mutatorIds = modifiers.activeMutatorIds ? [...new Set(modifiers.activeMutatorIds)] : [];

  return {
    enemySpeedMultiplier: clampPositive(modifiers.enemySpeedMultiplier, 1),
    enemyHpMultiplier: clampPositive(modifiers.enemyHpMultiplier, 1),
    enemyArmorBonus:
      typeof modifiers.enemyArmorBonus === 'number' && Number.isFinite(modifiers.enemyArmorBonus)
        ? Math.max(0, Math.round(modifiers.enemyArmorBonus))
        : 0,
    flyerCountMultiplier: clampPositive(modifiers.flyerCountMultiplier, 1, 1),
    goldRewardMultiplier: clampPositive(modifiers.goldRewardMultiplier, 1),
    startingGoldMultiplier: clampPositive(modifiers.startingGoldMultiplier, 1),
    towerCostMultiplier: clampPositive(modifiers.towerCostMultiplier, 1),
    allowedTowerTypes: allowed,
    forbiddenTowerTypes: forbidden,
    activeMutatorIds: mutatorIds,
    scoreMultiplier: clampPositive(modifiers.scoreMultiplier, 1, 0.5),
  };
}

/** Combines multiple modifier layers into one resolved RunModifiers object. */
export function mergeRunModifiers(...layers: Array<RunModifiers | undefined | null>): ResolvedRunModifiers {
  let enemySpeedMultiplier = 1;
  let enemyHpMultiplier = 1;
  let enemyArmorBonus = 0;
  let flyerCountMultiplier = 1;
  let goldRewardMultiplier = 1;
  let startingGoldMultiplier = 1;
  let towerCostMultiplier = 1;
  let allowedTowerTypes: Set<TowerType> | null = null;
  const forbiddenSet = new Set<TowerType>();
  const mutatorIdSet = new Set<string>();
  let extraScoreBonus = 0;

  for (let i = 0; i < layers.length; i++) {
    const raw = layers[i];
    if (!raw) continue;
    const mod = resolveRunModifiers(raw);
    enemySpeedMultiplier *= mod.enemySpeedMultiplier;
    enemyHpMultiplier *= mod.enemyHpMultiplier;
    enemyArmorBonus += mod.enemyArmorBonus;
    flyerCountMultiplier = Math.max(flyerCountMultiplier, mod.flyerCountMultiplier);
    goldRewardMultiplier *= mod.goldRewardMultiplier;
    startingGoldMultiplier *= mod.startingGoldMultiplier;
    towerCostMultiplier *= mod.towerCostMultiplier;

    if (mod.allowedTowerTypes !== null) {
      if (allowedTowerTypes === null) {
        allowedTowerTypes = new Set(mod.allowedTowerTypes);
      } else {
        const nextAllowed = new Set<TowerType>();
        for (const t of allowedTowerTypes) {
          if (mod.allowedTowerTypes.includes(t)) {
            nextAllowed.add(t);
          }
        }
        allowedTowerTypes = nextAllowed;
      }
    }
    for (let j = 0; j < mod.forbiddenTowerTypes.length; j++) {
      forbiddenSet.add(mod.forbiddenTowerTypes[j]);
    }
    for (let j = 0; j < mod.activeMutatorIds.length; j++) {
      mutatorIdSet.add(mod.activeMutatorIds[j]);
    }
    extraScoreBonus += mod.scoreMultiplier - 1;
  }

  return {
    enemySpeedMultiplier: +enemySpeedMultiplier.toFixed(4),
    enemyHpMultiplier: +enemyHpMultiplier.toFixed(4),
    enemyArmorBonus,
    flyerCountMultiplier,
    goldRewardMultiplier: +goldRewardMultiplier.toFixed(4),
    startingGoldMultiplier: +startingGoldMultiplier.toFixed(4),
    towerCostMultiplier: +towerCostMultiplier.toFixed(4),
    allowedTowerTypes: allowedTowerTypes ? [...allowedTowerTypes] : null,
    forbiddenTowerTypes: [...forbiddenSet],
    activeMutatorIds: [...mutatorIdSet],
    scoreMultiplier: +(1 + Math.max(0, extraScoreBonus)).toFixed(2),
  };
}

/** Checks whether a tower type can be built under the active run modifiers. */
export function isTowerTypeAllowed(type: TowerType, modifiers: ResolvedRunModifiers): boolean {
  if (modifiers.forbiddenTowerTypes.includes(type)) {
    return false;
  }
  if (modifiers.allowedTowerTypes !== null && !modifiers.allowedTowerTypes.includes(type)) {
    return false;
  }
  return true;
}

/** Returns all tower types allowed under the active run modifiers in canonical order. */
export function getAllowedTowerTypes(modifiers: ResolvedRunModifiers): readonly TowerType[] {
  return TOWER_TYPES.filter((type) => isTowerTypeAllowed(type, modifiers));
}

/** Scales a tower build or upgrade cost by towerCostMultiplier (no-op when 1). */
export function scaleGoldCost(baseCost: number, modifiers: ResolvedRunModifiers): number {
  if (modifiers.towerCostMultiplier === 1) return baseCost;
  return Math.max(1, Math.round(baseCost * modifiers.towerCostMultiplier));
}

/** Scales gold rewards (early/clear/kill) by goldRewardMultiplier (no-op when 1). */
export function scaleGoldReward(baseReward: number, modifiers: ResolvedRunModifiers): number {
  if (baseReward <= 0 || modifiers.goldRewardMultiplier === 1) return baseReward;
  return Math.max(1, Math.round(baseReward * modifiers.goldRewardMultiplier));
}

/**
 * Returns a modified copy of `level` reflecting wave-level modifiers (e.g. double flyers
 * on story waves). Does not mutate the original LevelDef.
 */
export function applyModifiersToLevel(level: LevelDef, modifiers?: RunModifiers | null): LevelDef {
  const mod = resolveRunModifiers(modifiers);
  if (mod.flyerCountMultiplier <= 1) {
    return level;
  }

  const mult = Math.max(1, Math.round(mod.flyerCountMultiplier));
  const waves: WaveDef[] = level.waves.map((wave) => {
    const groups: WaveGroupDef[] = wave.groups.map((grp) => {
      if (grp.enemyType !== 'flyer') return grp;
      return {
        enemyType: grp.enemyType,
        count: grp.count * mult,
        spawnInterval: Math.max(0.18, +(grp.spawnInterval / mult).toFixed(2)),
        startDelay: grp.startDelay,
      };
    });
    return {
      clearBonus: wave.clearBonus,
      groups,
    };
  });

  return {
    ...level,
    waves,
  };
}
