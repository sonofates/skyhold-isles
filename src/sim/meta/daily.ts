import { SeededRng } from '../../core/rng.ts';
import type { TowerType } from '../../core/types.ts';
import { ENDLESS_MUTATORS } from '../../data/challenges.ts';
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
): { restriction: DailyTowerRestriction; scoreBonus: number; modifiers: RunModifiers } {
  const available = TOWER_TYPES.filter((t) => !alreadyForbidden.includes(t));
  const antiAirAvailable = available.filter((t) => TOWER_DEFS[t].hitsFlyers);

  if (available.length <= 2 || antiAirAvailable.length === 0) {
    return {
      restriction: {
        kind: 'none',
        label: 'Full Arsenal',
        allowedTowerTypes: null,
        forbiddenTowerTypes: [],
      },
      scoreBonus: 0,
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
      scoreBonus: 0,
      modifiers: {},
    };
  }

  // Ban one tower while guaranteeing at least 1 anti-air tower remains legal
  if (roll < 0.65 || available.length <= 3) {
    const bannable = available.filter(
      (t) => !TOWER_DEFS[t].hitsFlyers || antiAirAvailable.length > 1,
    );
    if (bannable.length > 0) {
      const banned = rng.pick(bannable);
      return {
        restriction: {
          kind: 'ban_one',
          label: `No ${TOWER_DEFS[banned].name}`,
          allowedTowerTypes: null,
          forbiddenTowerTypes: [banned],
        },
        scoreBonus: 0.2,
        modifiers: { forbiddenTowerTypes: [banned] },
      };
    }
  }

  // Limited arsenal: pick 3 available towers including at least 1 anti-air tower
  const targetSize = Math.min(3, available.length);
  const chosen: TowerType[] = [rng.pick(antiAirAvailable)];
  const remaining = available.filter((t) => t !== chosen[0]);
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
    scoreBonus: 0.3,
    modifiers: { allowedTowerTypes: chosen },
  };
}

/**
 * Pure deterministic generator for the Daily Challenge of a given `YYYY-MM-DD` date string.
 * Selects island, compatible mutators, and tower restrictions with at least 1 legal anti-air tower.
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
  const mutatorCount = rng.chance(0.55) ? 2 : 1;
  const mutatorSeed = (seed ^ Math.imul(rng.int(1, 0x7fffffff), 2654435761)) >>> 0;
  const mutatorRoll = selectEndlessMutators(mutatorSeed, mutatorCount, mutatorCatalog);

  const { restriction, scoreBonus, modifiers: restrictionMods } = pickTowerRestriction(
    rng,
    mutatorRoll.modifiers.forbiddenTowerTypes,
  );

  const scoreMultiplier = +(mutatorRoll.scoreMultiplier + scoreBonus).toFixed(2);
  const modifiers = mergeRunModifiers(mutatorRoll.modifiers, restrictionMods, {
    scoreMultiplier,
  });

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
