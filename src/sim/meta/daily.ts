import { SeededRng } from '../../core/rng.ts';
import type { TowerType } from '../../core/types.ts';
import { ENDLESS_MUTATORS } from '../../data/challenges.ts';
import { ENEMY_DEFS } from '../../data/enemies.ts';
import { LEVELS } from '../../data/levels/index.ts';
import type { LevelDef } from '../../data/levels/types.ts';
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
  return types.map((t) => TOWER_DEFS[t]?.name ?? t).join(', ');
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
  const available = TOWER_TYPES.filter((t) => !alreadyForbidden.includes(t));
  const antiAirAvailable = available.filter((t) => TOWER_DEFS[t].hitsFlyers);
  const antiAirDpsAvailable = antiAirAvailable.filter((t) => {
    const t1 = TOWER_DEFS[t].tiers[0];
    return t1.damage >= 15 || t1.damage * t1.fireRate >= 20;
  });
  const primaryAntiAirPool =
    antiAirDpsAvailable.length > 0 ? antiAirDpsAvailable : antiAirAvailable;
  const armorBreakersAvailable = available.filter((t) => TOWER_DEFS[t].tiers[0].damage >= 35);

  if (options?.forceNone || available.length <= 2 || antiAirAvailable.length === 0) {
    return {
      restriction: {
        kind: 'none',
        label: 'Full Arsenal',
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
        label: 'Full Arsenal',
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
      if (options?.preserveAntiAir && TOWER_DEFS[t].hitsFlyers) return false;
      if (primaryAntiAirPool.includes(t) && primaryAntiAirPool.length <= 1) return false;
      if (
        options?.requireArmorBreaker &&
        TOWER_DEFS[t].tiers[0].damage >= 35 &&
        armorBreakersAvailable.length <= 1
      ) {
        return false;
      }
      return !TOWER_DEFS[t].hitsFlyers || antiAirAvailable.length > 1;
    });
    if (bannable.length > 0) {
      const banned = rng.pick(bannable);
      return {
        restriction: {
          kind: 'ban_one',
          label: `No ${TOWER_DEFS[banned].name}`,
          allowedTowerTypes: null,
          forbiddenTowerTypes: [banned],
        },
        modifiers: { forbiddenTowerTypes: [banned], scoreMultiplier: 1.2 },
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
    !chosen.some((t) => TOWER_DEFS[t].tiers[0].damage >= 35)
  ) {
    const armorBreakers = available.filter(
      (t) => !chosen.includes(t) && TOWER_DEFS[t].tiers[0].damage >= 35,
    );
    if (armorBreakers.length > 0) {
      chosen.push(rng.pick(armorBreakers));
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
  const normalizedDate = dateStr.trim();
  if (!isValidDateString(normalizedDate)) {
    throw new RangeError(`Invalid daily challenge date "${dateStr}": expected YYYY-MM-DD.`);
  }
  if (levels.length === 0) {
    throw new Error('Cannot generate daily challenge with an empty level list.');
  }

  const seed = hashSeedString(`skyhold-daily:${normalizedDate}`);
  const rng = new SeededRng(seed);

  const levelIndex = rng.int(0, levels.length - 1);
  const level = levels[levelIndex];
  const isMaster = level.difficulty === 'Master';
  const isHeroic = level.difficulty === 'Heroic';
  const hasHeavyArmoredWaves = level.waves.some((wave) =>
    wave.groups.some((grp) => {
      const def = ENEMY_DEFS[grp.enemyType];
      if (!def) return false;
      return (
        def.livesCost >= 3 ||
        (def.armor >= 5 && grp.count >= 5) ||
        (def.armor >= 4 && def.maxHp >= 400)
      );
    }),
  );

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
    ? mutatorCatalog.filter((m) => m.id !== 'gold_drought')
    : mutatorCatalog;
  const effectivePool = masterSafePool.length > 0 ? masterSafePool : mutatorCatalog;

  const mutatorSeed = (seed ^ Math.imul(rng.int(1, 0x7fffffff), 2654435761)) >>> 0;
  const mutatorRoll = selectEndlessMutators(mutatorSeed, mutatorCount, effectivePool);

  const { restriction, modifiers: restrictionMods } = pickTowerRestriction(
    rng,
    mutatorRoll.modifiers.forbiddenTowerTypes,
    {
      allowLimitedArsenal:
        !isMaster &&
        (!isHeroic ||
          (mutatorRoll.mutators.length < 2 && mutatorRoll.modifiers.goldRewardMultiplier >= 1)),
      forceNone:
        mutatorRoll.modifiers.forbiddenTowerTypes.length > 0 ||
        (isHeroic && mutatorRoll.mutators.length >= 2 && mutatorRoll.modifiers.goldRewardMultiplier < 1),
      preserveAntiAir: mutatorRoll.modifiers.flyerCountMultiplier > 1,
      requireArmorBreaker:
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

  return {
    date: normalizedDate,
    seed,
    levelIndex,
    levelId: level.id,
    levelName: level.name,
    mutators: mutatorRoll.mutators,
    towerRestriction: restriction,
    modifiers,
    scoreMultiplier,
    title: `Daily Watch · ${level.name}`,
    summary: parts.length > 0 ? parts.join(' · ') : 'Standard Rules',
  };
}

/** Pure UTC epoch-day index for a validated `YYYY-MM-DD` string. */
function dateStringToEpochDay(dateStr: string): number | null {
  const match = DATE_PATTERN.exec(dateStr.trim());
  if (!match || !isValidDateString(dateStr)) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function epochDayToDateString(epochDay: number): string {
  const dt = new Date(epochDay * 86_400_000);
  const y = dt.getUTCFullYear();
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
  const clampedDays = Math.max(1, Math.min(31, Math.floor(days)));
  const specs: DailyChallengeSpec[] = [];
  for (let offset = clampedDays - 1; offset >= 0; offset--) {
    const ds = epochDayToDateString(endDay - offset);
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
