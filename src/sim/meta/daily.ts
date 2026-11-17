import { SeededRng } from '../../core/rng.ts';
import type { TowerType } from '../../core/types.ts';
import { ENDLESS_MUTATORS } from '../../data/challenges.ts';
import { ENEMY_DEFS } from '../../data/enemies.ts';
import { LEVELS } from '../../data/levels/index.ts';
import type { LevelDef, WaveDef, WaveGroupDef } from '../../data/levels/types.ts';
import { TOWER_DEFS, TOWER_TYPES } from '../../data/towers.ts';
import { mergeRunModifiers } from './modifiers.ts';
import { hashSeedString, selectEndlessMutators } from './mutators.ts';
import type { DailyChallengeSpec, DailyTowerRestriction, MutatorDef, RunModifiers } from './types.ts';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Validates a strict `YYYY-MM-DD` calendar date string without timezone dependencies. */
export function isValidDateString(dateStr: string): boolean {
  if (typeof dateStr !== 'string') return false;
  const match = DATE_PATTERN.exec(dateStr.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return day <= maxDay;
}

function formatTowerNames(types: readonly TowerType[]): string {
  return types
    .map((t) => (Object.hasOwn(TOWER_DEFS, t) ? (TOWER_DEFS[t]?.name ?? t) : t))
    .join(', ');
}

function pickTowerRestriction(
  rng: SeededRng,
  alreadyForbidden: readonly TowerType[],
  options?: {
    allowLimitedArsenal?: boolean;
    forceNone?: boolean;
    preserveAntiAir?: boolean;
    requireArmorBreaker?: boolean;
  },
): { restriction: DailyTowerRestriction; modifiers: RunModifiers } {
  const available = TOWER_TYPES.filter((t) => Boolean(TOWER_DEFS[t]) && !alreadyForbidden.includes(t));
  const antiAirAvailable = available.filter((t) => TOWER_DEFS[t]?.hitsFlyers === true);
  const antiAirDpsAvailable = antiAirAvailable.filter((t) => {
    const t1 = TOWER_DEFS[t]?.tiers?.[0];
    return Boolean(t1) && (t1.damage >= 15 || t1.damage * t1.fireRate >= 20);
  });
  const primaryAntiAirPool =
    antiAirDpsAvailable.length > 0 ? antiAirDpsAvailable : antiAirAvailable;
  const armorBreakersAvailable = available.filter(
    (t) => (TOWER_DEFS[t]?.tiers?.[0]?.damage ?? 0) >= 35,
  );

  const noneLabel = alreadyForbidden.length > 0 ? 'No Extra Ban' : 'Full Arsenal';
  if (options?.forceNone || available.length <= 2 || antiAirAvailable.length === 0) {
    return {
      restriction: {
        kind: 'none',
        label: noneLabel,
        allowedTowerTypes: null,
        forbiddenTowerTypes: [],
      },
      modifiers: {},
    };
  }

  const roll = rng.next();
  if (roll < 0.2) {
    return {
      restriction: {
        kind: 'none',
        label: noneLabel,
        allowedTowerTypes: null,
        forbiddenTowerTypes: [],
      },
      modifiers: {},
    };
  }

  // Ban one tower while guaranteeing at least 1 primary anti-air DPS tower remains legal
  const allowLimited = options?.allowLimitedArsenal ?? true;
  if (!allowLimited || roll < 0.65 || available.length <= 3) {
    const bannable = available.filter((t) => {
      const def = TOWER_DEFS[t];
      const t1Damage = def?.tiers?.[0]?.damage ?? 0;
      const hitsFlyers = def?.hitsFlyers === true;
      if (options?.preserveAntiAir && hitsFlyers) return false;
      if (primaryAntiAirPool.includes(t) && primaryAntiAirPool.length <= 1) return false;
      if (
        options?.requireArmorBreaker &&
        t1Damage >= 35 &&
        armorBreakersAvailable.length <= 1
      ) {
        return false;
      }
      return !hitsFlyers || antiAirAvailable.length > 1;
    });
    if (bannable.length > 0) {
      const banned = rng.pick(bannable);
      return {
        restriction: {
          kind: 'ban_one',
          label: `No ${TOWER_DEFS[banned]?.name ?? banned}`,
          allowedTowerTypes: null,
          forbiddenTowerTypes: [banned],
        },
        modifiers: { forbiddenTowerTypes: [banned], scoreMultiplier: 1.2 },
      };
    }
    if (!allowLimited) {
      return {
        restriction: {
          kind: 'none',
          label: noneLabel,
          allowedTowerTypes: null,
          forbiddenTowerTypes: [],
        },
        modifiers: {},
      };
    }
  }

  // Limited arsenal: pick 3 available towers including at least 1 primary anti-air DPS tower
  // and (when armored/heroic waves demand it) at least 1 heavy anti-armor/splash tower.
  const targetSize = Math.min(3, available.length);
  const chosen: TowerType[] = [rng.pick(primaryAntiAirPool)];
  if (
    options?.requireArmorBreaker &&
    chosen.length < targetSize &&
    !chosen.some((t) => (TOWER_DEFS[t]?.tiers?.[0]?.damage ?? 0) >= 35)
  ) {
    const armorBreakers = available.filter(
      (t) => !chosen.includes(t) && (TOWER_DEFS[t]?.tiers?.[0]?.damage ?? 0) >= 35,
    );
    if (armorBreakers.length > 0) {
      chosen.push(rng.pick(armorBreakers));
    }
  }
  if (
    options?.preserveAntiAir &&
    chosen.length < targetSize &&
    chosen.filter((t) => TOWER_DEFS[t]?.hitsFlyers === true).length < 2
  ) {
    const extraAntiAir = available.filter(
      (t) => !chosen.includes(t) && TOWER_DEFS[t]?.hitsFlyers === true,
    );
    if (extraAntiAir.length > 0) {
      chosen.push(rng.pick(extraAntiAir));
    }
  }
  const remaining = available.filter((t) => !chosen.includes(t));
  while (chosen.length < targetSize && remaining.length > 0) {
    const idx = rng.int(0, remaining.length - 1);
    chosen.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  // Keep canonical TOWER_TYPES ordering for clean UI display & deterministic equality
  chosen.sort((a, b) => TOWER_TYPES.indexOf(a) - TOWER_TYPES.indexOf(b));

  return {
    restriction: {
      kind: 'limited_arsenal',
      label: `Only ${formatTowerNames(chosen)}`,
      allowedTowerTypes: chosen,
      forbiddenTowerTypes: [],
    },
    modifiers: { allowedTowerTypes: chosen, scoreMultiplier: 1.3 },
  };
}

/**
 * Pure deterministic generator for the Daily Challenge of a given `YYYY-MM-DD` date string.
 * Selects island, compatible mutators, and tower restrictions with at least 1 legal anti-air tower
 * while scaling rule severity by island difficulty so Master dailies stay fair.
 */
export function generateDailyChallenge(
  dateStr: string,
  levels: readonly LevelDef[] = LEVELS,
  mutatorCatalog: readonly MutatorDef[] = ENDLESS_MUTATORS,
): DailyChallengeSpec {
  if (typeof dateStr !== 'string') {
    throw new RangeError(`Invalid daily challenge date "${String(dateStr)}": expected YYYY-MM-DD.`);
  }
  const normalizedDate = dateStr.trim();
  if (!isValidDateString(normalizedDate)) {
    throw new RangeError(`Invalid daily challenge date "${dateStr}": expected YYYY-MM-DD.`);
  }
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new Error('Cannot generate daily challenge with an empty level list.');
  }
  const safeLevels: readonly LevelDef[] = levels;
  const safeCatalog: readonly MutatorDef[] = Array.isArray(mutatorCatalog)
    ? mutatorCatalog.filter(
        (m): m is MutatorDef => Boolean(m) && typeof m === 'object' && typeof m.id === 'string' && m.id.length > 0,
      )
    : [];

  const seed = hashSeedString(`skyhold-daily:${normalizedDate}`);
  const rng = new SeededRng(seed);

  const levelIndex = rng.int(0, safeLevels.length - 1);
  const rawLevel = safeLevels[levelIndex];
  const level =
    rawLevel && typeof rawLevel.id === 'string'
      ? rawLevel
      : safeLevels.find((l): l is LevelDef => Boolean(l) && typeof l.id === 'string');
  if (!level) {
    throw new Error('Cannot generate daily challenge without any valid level definitions.');
  }
  const resolvedLevelIndex = safeLevels.indexOf(level);
  const isMaster = level.difficulty === 'Master';
  const isHeroic = level.difficulty === 'Heroic';
  const isChallenging = level.difficulty === 'Challenging';
  const waves: readonly WaveDef[] = Array.isArray(level.waves) ? level.waves : [];
  const hasHeavyArmoredWaves = waves.some((wave) => {
    const groups: readonly WaveGroupDef[] | null =
      wave && Array.isArray(wave.groups) ? wave.groups : null;
    if (!groups) return false;
    let armoredSwarmCount = 0;
    for (let g = 0; g < groups.length; g++) {
      const grp = groups[g];
      const def =
        grp && Object.hasOwn(ENEMY_DEFS, grp.enemyType) ? ENEMY_DEFS[grp.enemyType] : undefined;
      if (!def) continue;
      if (def.livesCost >= 3 || (def.armor >= 4 && def.maxHp >= 400)) {
        return true;
      }
      if (def.armor >= 5) {
        armoredSwarmCount += Number.isFinite(grp.count) ? Math.max(0, grp.count) : 0;
        if (armoredSwarmCount >= 5) return true;
      }
    }
    return false;
  });

  const mutatorCount = isMaster
    ? 1
    : isHeroic
      ? rng.chance(0.35)
        ? 2
        : 1
      : rng.chance(0.55)
        ? 2
        : 1;

  const masterSafePool = isMaster
    ? safeCatalog.filter((m) => m.id !== 'gold_drought')
    : safeCatalog;
  const effectivePool = masterSafePool.length > 0 ? masterSafePool : safeCatalog;

  const mutatorSeed = (seed ^ Math.imul(rng.int(1, 0x7fffffff), 2654435761)) >>> 0;
  let mutatorRoll = selectEndlessMutators(mutatorSeed, mutatorCount, effectivePool);

  // On Heroic/Challenging islands, keep gold_drought solo and avoid pairing two heavy
  // Heroic multipliers (economy squeeze + HP/flyers/speed, Titan Tide + Sky Swarm, or Sky Swarm + Tailwind March).
  if ((isHeroic || isChallenging) && mutatorRoll.mutators.length >= 2) {
    const mMods = mutatorRoll.modifiers;
    const hasDrought = mutatorRoll.mutators.some((m) => m.id === 'gold_drought');
    const hasSqueeze = mMods.goldRewardMultiplier < 1 || mMods.towerCostMultiplier > 1;
    const hasHpOrFlyers = mMods.enemyHpMultiplier > 1 || mMods.flyerCountMultiplier > 1;
    const hasDoubleSpike =
      hasDrought ||
      (isHeroic &&
        ((hasSqueeze && (hasHpOrFlyers || mMods.enemySpeedMultiplier > 1)) ||
          (mMods.enemyHpMultiplier > 1 && mMods.flyerCountMultiplier > 1) ||
          (mMods.flyerCountMultiplier > 1 && mMods.enemySpeedMultiplier > 1)));
    if (hasDoubleSpike) {
      mutatorRoll = selectEndlessMutators(mutatorSeed, 1, effectivePool);
    }
  }

  const hasEconomySqueeze =
    mutatorRoll.modifiers.goldRewardMultiplier < 1 || mutatorRoll.modifiers.towerCostMultiplier > 1;
  const hasMasterIntensity =
    hasEconomySqueeze ||
    mutatorRoll.modifiers.enemyHpMultiplier > 1 ||
    mutatorRoll.modifiers.enemySpeedMultiplier > 1 ||
    mutatorRoll.modifiers.flyerCountMultiplier > 1;

  const { restriction, modifiers: restrictionMods } = pickTowerRestriction(
    rng,
    mutatorRoll.modifiers.forbiddenTowerTypes,
    {
      allowLimitedArsenal:
        !isMaster &&
        !isHeroic &&
        (!isChallenging ||
          (mutatorRoll.mutators.length < 2 &&
            !hasEconomySqueeze &&
            mutatorRoll.modifiers.enemyHpMultiplier <= 1 &&
            mutatorRoll.modifiers.flyerCountMultiplier <= 1)),
      forceNone:
        mutatorRoll.modifiers.forbiddenTowerTypes.length > 0 ||
        (isMaster && hasMasterIntensity) ||
        (isHeroic &&
          (hasEconomySqueeze ||
            mutatorRoll.modifiers.enemyHpMultiplier > 1 ||
            mutatorRoll.mutators.length >= 2)) ||
        (isChallenging && mutatorRoll.mutators.length >= 2 && hasEconomySqueeze),
      preserveAntiAir: mutatorRoll.modifiers.flyerCountMultiplier > 1,
      requireArmorBreaker:
        isMaster ||
        isHeroic ||
        (level.difficulty !== 'Breezy' && hasHeavyArmoredWaves) ||
        mutatorRoll.modifiers.enemyArmorBonus > 0 ||
        mutatorRoll.modifiers.enemyHpMultiplier > 1,
    },
  );

  const modifiers = mergeRunModifiers(mutatorRoll.modifiers, restrictionMods);
  const scoreMultiplier = modifiers.scoreMultiplier;

  const parts: string[] = [];
  if (mutatorRoll.mutators.length > 0) {
    parts.push(mutatorRoll.mutators.map((m) => m.name).join(' + '));
  }
  if (restriction.kind !== 'none') {
    parts.push(restriction.label);
  }

  const levelName = typeof level.name === 'string' && level.name.length > 0 ? level.name : level.id;
  return {
    date: normalizedDate,
    seed,
    levelIndex: resolvedLevelIndex,
    levelId: level.id,
    levelName,
    mutators: mutatorRoll.mutators,
    towerRestriction: restriction,
    modifiers,
    scoreMultiplier,
    title: `Daily Watch · ${levelName}`,
    summary: parts.length > 0 ? parts.join(' · ') : 'Standard Rules',
  };
}

/** Pure UTC epoch-day index for a validated `YYYY-MM-DD` string. */
function dateStringToEpochDay(dateStr: string): number | null {
  if (typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  const match = DATE_PATTERN.exec(trimmed);
  if (!match || !isValidDateString(trimmed)) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(0);
  dt.setUTCFullYear(year, month - 1, day);
  return Math.floor(dt.getTime() / 86_400_000);
}

function epochDayToDateString(epochDay: number): string {
  const dt = new Date(epochDay * 86_400_000);
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Pure helper returning Daily Challenge specs for `days` consecutive calendar days
 * ending on `endDateStr` (ordered oldest -> newest). Useful for UI history/archive cards.
 */
export function getRecentDailySpecs(
  endDateStr: string,
  days = 7,
  levels: readonly LevelDef[] = LEVELS,
  mutatorCatalog: readonly MutatorDef[] = ENDLESS_MUTATORS,
): readonly DailyChallengeSpec[] {
  const endDay = dateStringToEpochDay(endDateStr);
  if (endDay === null) {
    throw new RangeError(`Invalid daily challenge date "${endDateStr}": expected YYYY-MM-DD.`);
  }
  const clampedDays = Number.isFinite(days) ? Math.max(1, Math.min(31, Math.floor(days))) : 7;
  const minEpochDay = dateStringToEpochDay('0000-01-01')!;
  const specs: DailyChallengeSpec[] = [];
  for (let offset = clampedDays - 1; offset >= 0; offset--) {
    const targetDay = endDay - offset;
    if (targetDay < minEpochDay) continue;
    const ds = epochDayToDateString(targetDay);
    specs.push(generateDailyChallenge(ds, levels, mutatorCatalog));
  }
  return specs;
}

/**
 * Pure calendar calculation of current and best consecutive-day Daily Challenge streaks.
 * Current streak stays alive if either `referenceDate` or the immediately preceding day is completed.
 */
export function computeDailyStreaks(
  completedDates: readonly string[],
  referenceDate: string,
): { currentStreak: number; bestStreak: number } {
  if (!Array.isArray(completedDates)) {
    return { currentStreak: 0, bestStreak: 0 };
  }
  const dayNumbers = new Set<number>();
  for (let i = 0; i < completedDates.length; i++) {
    const day = dateStringToEpochDay(completedDates[i]);
    if (day !== null) dayNumbers.add(day);
  }
  if (dayNumbers.size === 0) {
    return { currentStreak: 0, bestStreak: 0 };
  }

  const sorted = [...dayNumbers].sort((a, b) => a - b);
  let bestStreak = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      run++;
      if (run > bestStreak) bestStreak = run;
    } else {
      run = 1;
    }
  }

  const refDay = dateStringToEpochDay(referenceDate);
  if (refDay === null) {
    return { currentStreak: 0, bestStreak };
  }

  let cursor = dayNumbers.has(refDay) ? refDay : dayNumbers.has(refDay - 1) ? refDay - 1 : null;
  let currentStreak = 0;
  while (cursor !== null && dayNumbers.has(cursor)) {
    currentStreak++;
    cursor--;
  }

  return { currentStreak, bestStreak };
}
