import type { TowerType } from '../../core/types.ts';
import { ENDLESS_MUTATORS } from '../../data/challenges.ts';
import { ENEMY_DEFS } from '../../data/enemies.ts';
import type { LevelDef, WaveDef, WaveGroupDef } from '../../data/levels/types.ts';
import { TOWER_DEFS, TOWER_TYPES } from '../../data/towers.ts';
import type { ModifierBadgeInfo, MutatorDef, ResolvedRunModifiers, RunModifiers } from './types.ts';

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

function dedupeStrings<T extends string>(raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item === 'string' && item.length > 0 && !seen.has(item)) {
      seen.add(item);
      out.push(item as T);
    }
  }
  return out;
}

/** Normalizes partial RunModifiers into concrete defaults. */
export function resolveRunModifiers(modifiers?: RunModifiers | null): ResolvedRunModifiers {
  if (!modifiers || typeof modifiers !== 'object' || Array.isArray(modifiers)) {
    return NEUTRAL_RUN_MODIFIERS;
  }
  const allowed = Array.isArray(modifiers.allowedTowerTypes)
    ? dedupeStrings<TowerType>(modifiers.allowedTowerTypes)
    : null;
  const forbidden = dedupeStrings<TowerType>(modifiers.forbiddenTowerTypes);
  const mutatorIds = dedupeStrings<string>(modifiers.activeMutatorIds);

  return {
    enemySpeedMultiplier: clampPositive(modifiers.enemySpeedMultiplier, 1),
    enemyHpMultiplier: clampPositive(modifiers.enemyHpMultiplier, 1),
    enemyArmorBonus:
      typeof modifiers.enemyArmorBonus === 'number' && Number.isFinite(modifiers.enemyArmorBonus)
        ? Math.max(0, Math.round(modifiers.enemyArmorBonus))
        : 0,
    flyerCountMultiplier:
      typeof modifiers.flyerCountMultiplier === 'number' &&
      Number.isFinite(modifiers.flyerCountMultiplier)
        ? Math.max(1, Math.round(modifiers.flyerCountMultiplier))
        : 1,
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
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
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

/**
 * Returns true if any modifier eases baseline difficulty (e.g. weaker enemies or bonus gold),
 * used to prevent custom beneficial modifiers from counting toward campaign challenges or records.
 */
export function isAdvantageousModifiers(modifiers: ResolvedRunModifiers): boolean {
  return (
    modifiers.enemyHpMultiplier < 1 ||
    modifiers.enemySpeedMultiplier < 1 ||
    modifiers.goldRewardMultiplier > 1 ||
    modifiers.startingGoldMultiplier > 1 ||
    modifiers.towerCostMultiplier < 1
  );
}

/** Returns true when modifiers alter gameplay rules away from the neutral baseline. */
export function hasActiveRunModifiers(modifiers: ResolvedRunModifiers): boolean {
  return (
    modifiers.activeMutatorIds.length > 0 ||
    modifiers.enemySpeedMultiplier !== 1 ||
    modifiers.enemyHpMultiplier !== 1 ||
    modifiers.enemyArmorBonus !== 0 ||
    modifiers.flyerCountMultiplier !== 1 ||
    modifiers.goldRewardMultiplier !== 1 ||
    modifiers.startingGoldMultiplier !== 1 ||
    modifiers.towerCostMultiplier !== 1 ||
    modifiers.allowedTowerTypes !== null ||
    modifiers.forbiddenTowerTypes.length > 0
  );
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
  if (!Number.isFinite(baseCost) || baseCost <= 0) return 0;
  if (modifiers.towerCostMultiplier === 1) return baseCost;
  return Math.max(1, Math.round(baseCost * modifiers.towerCostMultiplier));
}

/** Scales gold rewards (early/clear/kill) by goldRewardMultiplier (no-op when 1). */
export function scaleGoldReward(baseReward: number, modifiers: ResolvedRunModifiers): number {
  if (!Number.isFinite(baseReward) || baseReward <= 0) return 0;
  if (modifiers.goldRewardMultiplier === 1) return baseReward;
  return Math.max(1, Math.round(baseReward * modifiers.goldRewardMultiplier));
}

/**
 * Returns a modified copy of `level` reflecting wave-level modifiers (e.g. double flyers
 * on story waves). Does not mutate the original LevelDef.
 */
export function applyModifiersToLevel(level: LevelDef, modifiers?: RunModifiers | null): LevelDef {
  const mod = resolveRunModifiers(modifiers);
  if (mod.flyerCountMultiplier <= 1 || !level || !Array.isArray(level.waves as unknown)) {
    return level;
  }

  const mult = Math.max(1, Math.round(mod.flyerCountMultiplier));
  const waves: WaveDef[] = level.waves.map((wave) => {
    const rawGroups = wave && Array.isArray(wave.groups as unknown) ? wave.groups : [];
    const groups: WaveGroupDef[] = rawGroups.map((grp) => {
      const hasEnemy = Boolean(grp) && Object.hasOwn(ENEMY_DEFS, grp.enemyType);
      if (!hasEnemy || !ENEMY_DEFS[grp.enemyType].flying) return grp;
      const safeCount = Number.isFinite(grp.count) ? Math.max(0, Math.round(grp.count)) : 0;
      const safeInterval =
        Number.isFinite(grp.spawnInterval) && grp.spawnInterval > 0 ? grp.spawnInterval : 0.5;
      return {
        enemyType: grp.enemyType,
        count: safeCount * mult,
        spawnInterval: Math.max(0.18, +(safeInterval / mult).toFixed(2)),
        startDelay: Number.isFinite(grp.startDelay) ? Math.max(0, grp.startDelay) : 0,
      };
    });
    return {
      clearBonus: wave?.clearBonus ?? 0,
      groups,
    };
  });

  return {
    ...level,
    waves,
  };
}

/**
 * Produces human-readable modifier badges for active mutators and tower restrictions
 * (ready for HUD / Pause Menu / Endless Setup display).
 */
export function describeActiveModifiers(
  modifiers: ResolvedRunModifiers,
  mutatorCatalog: readonly MutatorDef[] = ENDLESS_MUTATORS,
): readonly ModifierBadgeInfo[] {
  if (!modifiers || typeof modifiers !== 'object' || Array.isArray(modifiers)) {
    return [];
  }
  const badges: ModifierBadgeInfo[] = [];
  const safeCatalog = Array.isArray(mutatorCatalog) ? mutatorCatalog : [];
  const mutatorById = new Map<string, MutatorDef>();
  for (let i = 0; i < safeCatalog.length; i++) {
    const entry = safeCatalog[i];
    if (
      entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      typeof entry.id === 'string' &&
      entry.id.length > 0 &&
      !mutatorById.has(entry.id)
    ) {
      mutatorById.set(entry.id, entry);
    }
  }

  const mutatorForbidden = new Set<TowerType>();
  const recognizedMutatorLayers: RunModifiers[] = [];
  const activeIds = dedupeStrings<string>(modifiers?.activeMutatorIds);
  for (let i = 0; i < activeIds.length; i++) {
    const id = activeIds[i];
    const def = mutatorById.get(id);
    if (def) {
      badges.push({ id: def.id, label: def.name, detail: def.description });
      if (def.modifiers && typeof def.modifiers === 'object' && !Array.isArray(def.modifiers)) {
        recognizedMutatorLayers.push(def.modifiers);
        const banned = dedupeStrings<TowerType>(def.modifiers.forbiddenTowerTypes);
        for (let j = 0; j < banned.length; j++) {
          mutatorForbidden.add(banned[j]);
        }
      }
    } else {
      badges.push({ id, label: id, detail: 'Active run modifier' });
    }
  }

  // Surface custom scalar RunModifiers whenever they differ from the recognized mutator baseline
  const baseline =
    recognizedMutatorLayers.length > 0
      ? mergeRunModifiers(...recognizedMutatorLayers)
      : NEUTRAL_RUN_MODIFIERS;
  const pushPctBadge = (
    id: string,
    name: string,
    mult: number,
    expectedMult: number,
    detail: string,
  ) => {
    if (!Number.isFinite(mult) || mult <= 0) return;
    if (Math.abs(mult - expectedMult) <= 1e-3 || mult === 1) return;
    const pct = Math.round((mult - 1) * 100);
    if (pct === 0) return;
    badges.push({ id, label: `${name} ${pct >= 0 ? '+' : ''}${pct}%`, detail });
  };
  pushPctBadge(
    'custom-enemy-hp',
    'Enemy HP',
    modifiers.enemyHpMultiplier,
    baseline.enemyHpMultiplier,
    `Enemies have ${modifiers.enemyHpMultiplier}x health.`,
  );
  pushPctBadge(
    'custom-enemy-speed',
    'Enemy Speed',
    modifiers.enemySpeedMultiplier,
    baseline.enemySpeedMultiplier,
    `Enemies move at ${modifiers.enemySpeedMultiplier}x speed.`,
  );
  const armorBonus = Number.isFinite(modifiers.enemyArmorBonus)
    ? Math.max(0, Math.round(modifiers.enemyArmorBonus))
    : 0;
  if (armorBonus !== baseline.enemyArmorBonus && armorBonus > 0) {
    badges.push({
      id: 'custom-enemy-armor',
      label: `Enemy Armor +${armorBonus}`,
      detail: `All enemies gain +${armorBonus} flat armor.`,
    });
  }
  const flyerMult = Number.isFinite(modifiers.flyerCountMultiplier)
    ? Math.round(modifiers.flyerCountMultiplier)
    : 1;
  if (flyerMult !== baseline.flyerCountMultiplier && flyerMult > 1) {
    badges.push({
      id: 'custom-flyer-count',
      label: `${flyerMult}x Flyers`,
      detail: `Aerial waves spawn ${flyerMult}x flying enemies.`,
    });
  }
  pushPctBadge(
    'custom-gold-reward',
    'Gold Rewards',
    modifiers.goldRewardMultiplier,
    baseline.goldRewardMultiplier,
    `Kills and wave bonuses grant ${modifiers.goldRewardMultiplier}x gold.`,
  );
  pushPctBadge(
    'custom-starting-gold',
    'Starting Gold',
    modifiers.startingGoldMultiplier,
    baseline.startingGoldMultiplier,
    `Start with ${modifiers.startingGoldMultiplier}x starting gold.`,
  );
  pushPctBadge(
    'custom-tower-cost',
    'Tower Cost',
    modifiers.towerCostMultiplier,
    baseline.towerCostMultiplier,
    `Tower builds and upgrades cost ${modifiers.towerCostMultiplier}x gold.`,
  );

  const forbiddenList = dedupeStrings<TowerType>(modifiers?.forbiddenTowerTypes);
  const allowedList = Array.isArray(modifiers?.allowedTowerTypes)
    ? dedupeStrings<TowerType>(modifiers.allowedTowerTypes)
    : null;
  if (allowedList !== null) {
    const effectiveAllowed = allowedList.filter(
      (t) => !forbiddenList.includes(t),
    );
    if (effectiveAllowed.length === 0) {
      badges.push({
        id: 'allowed-arsenal',
        label: 'No Towers Allowed',
        detail: 'No tower types are permitted under these modifiers.',
      });
    } else {
      const names = effectiveAllowed
        .map((t) => (Object.hasOwn(TOWER_DEFS, t) ? (TOWER_DEFS[t]?.name ?? t) : t))
        .join(', ');
      badges.push({
        id: 'allowed-arsenal',
        label: 'Limited Arsenal',
        detail: `Only ${names} can be built.`,
      });
    }
  }

  const extraBanned = forbiddenList.filter((t) => !mutatorForbidden.has(t));
  if (extraBanned.length > 0) {
    const names = extraBanned
      .map((t) => (Object.hasOwn(TOWER_DEFS, t) ? (TOWER_DEFS[t]?.name ?? t) : t))
      .join(', ');
    badges.push({
      id: 'restricted-towers',
      label: `No ${names}`,
      detail: `${names} cannot be built.`,
    });
  }

  return badges;
}
