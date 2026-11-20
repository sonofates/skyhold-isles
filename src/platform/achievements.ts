import type { HeroId, ProgressData } from '../core/types.ts';
import { CHALLENGES, challengesForLevel, type ChallengeId } from '../data/challenges.ts';
import { ENDLESS_TIERS, endlessWavesCleared } from '../data/endlessMutators.ts';
import { HERO_DEFS, HERO_IDS, HERO_MAX_LEVEL, heroLevelFromXp } from '../data/heroes.ts';
import { LEVELS, type LevelDef } from '../data/levels/index.ts';
import { describeStarGoals, STAR_RULES, type Difficulty } from '../data/stars.ts';
import { FEATS } from '../game/feats.ts';
import { isIslandMastered } from '../game/progression.ts';
import { getPlatform, type PlatformAdapter } from './platform.ts';

/**
 * Steam achievement catalog derived from Feats (`src/game/feats.ts`), difficulty star goals
 * (`src/data/stars.ts`), island challenges (`src/data/challenges.ts`), Chapter Two (`i17`–`i24`),
 * heroes (`src/data/heroes.ts`), Hard ribbons (`src/data/difficulty.ts`), Endless medals
 * (`src/data/endlessMutators.ts`), and Daily Squall streaks (`src/data/daily.ts`).
 *
 * Kept 1-to-1 with `desktop/achievements.json`. Existing achievement IDs are permanent once shipped.
 */

export type SteamAchievementCategory =
  | 'feat'
  | 'stars'
  | 'challenge'
  | 'chapter'
  | 'hero'
  | 'hard'
  | 'endless'
  | 'daily';

export interface SteamAchievementMeta {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export interface SteamAchievementDef extends SteamAchievementMeta {
  readonly category: SteamAchievementCategory;
  readonly isEarned: (progress: ProgressData, levels: readonly LevelDef[]) => boolean;
}

function toUpperSnake(camel: string): string {
  return camel
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase();
}

const CHAPTER_TWO_ISLAND_IDS: readonly string[] = [
  'i17',
  'i18',
  'i19',
  'i20',
  'i21',
  'i22',
  'i23',
  'i24',
];
const CHAPTER_TWO_SET: ReadonlySet<string> = new Set<string>(CHAPTER_TWO_ISLAND_IDS);
const FINALE_BOSS_ISLAND_ID = 'i24';

function safeNonNegInt(val: unknown): number {
  return typeof val === 'number' && Number.isFinite(val) ? Math.max(0, Math.floor(val)) : 0;
}

type RawDiffWins = Partial<
  Record<'easy' | 'normal' | 'hard' | 'e' | 'n' | 'h', readonly unknown[] | undefined>
>;

function rawDiffWinsOf(progress: ProgressData): RawDiffWins | undefined {
  const dw = progress.difficultyWins ?? (progress as unknown as { readonly dw?: unknown }).dw;
  return dw && typeof dw === 'object' && !Array.isArray(dw) ? (dw as RawDiffWins) : undefined;
}

function safeBestStarsAt(progress: ProgressData, index: number): number {
  const dw = rawDiffWinsOf(progress);
  return Math.min(
    3,
    Math.max(
      safeNonNegInt(progress.bestStars?.[index]),
      Math.min(1, Math.max(safeNonNegInt(dw?.easy?.[index]), safeNonNegInt(dw?.e?.[index]))),
      safeNonNegInt(dw?.normal?.[index]),
      safeNonNegInt(dw?.n?.[index]),
      safeNonNegInt(dw?.hard?.[index]),
      safeNonNegInt(dw?.h?.[index]),
    ),
  );
}

function hasHardWinAt(progress: ProgressData, index: number): boolean {
  const dw = rawDiffWinsOf(progress);
  return safeNonNegInt(dw?.hard?.[index]) > 0 || safeNonNegInt(dw?.h?.[index]) > 0;
}

function isIslandClearedAt(progress: ProgressData, index: number): boolean {
  return safeNonNegInt(progress.clears?.[index]) > 0 || safeBestStarsAt(progress, index) > 0;
}

function normalizeProgressForAchievements(progress: ProgressData, count: number): ProgressData {
  const bsArr = Array.isArray(progress.bestStars) ? progress.bestStars : null;
  const clArr = Array.isArray(progress.clears) ? progress.clears : null;
  const ewArr = Array.isArray(progress.bestEndlessWaves) ? progress.bestEndlessWaves : null;
  const ccArr = Array.isArray(progress.challengeClears) ? progress.challengeClears : null;
  const rawDaily = progress.daily;
  const dailyStreak = safeNonNegInt(rawDaily?.streak);
  const dailyBestStreak = Math.max(safeNonNegInt(rawDaily?.bestStreak), dailyStreak);
  const dailyTotal = safeNonNegInt(rawDaily?.total);
  const dailyLastDay = safeNonNegInt(rawDaily?.lastDay);
  const dailyClean =
    Boolean(rawDaily) &&
    rawDaily.streak === dailyStreak &&
    rawDaily.bestStreak === dailyBestStreak &&
    rawDaily.total === dailyTotal &&
    rawDaily.lastDay === dailyLastDay;

  let needsPatch =
    !bsArr ||
    !clArr ||
    !ewArr ||
    !ccArr ||
    !dailyClean ||
    bsArr.length !== count ||
    clArr.length !== count ||
    ewArr.length !== count ||
    ccArr.length !== count;

  for (let i = 0; i < count && !needsPatch; i++) {
    const effStars = safeBestStarsAt(progress, i);
    const rawStar = bsArr![i];
    const rawClear = clArr![i];
    const rawEw = ewArr![i];
    if (
      rawStar !== effStars ||
      typeof rawClear !== 'number' ||
      !Number.isFinite(rawClear) ||
      rawClear < 0 ||
      rawClear !== Math.floor(rawClear) ||
      (effStars > 0 && rawClear === 0) ||
      typeof rawEw !== 'number' ||
      !Number.isFinite(rawEw) ||
      rawEw < 0 ||
      rawEw !== Math.floor(rawEw) ||
      !Array.isArray(ccArr![i])
    ) {
      needsPatch = true;
      break;
    }
  }
  if (!needsPatch) return progress;
  const bestStars = Array.from({ length: count }, (_, i) => safeBestStarsAt(progress, i));
  const clears = Array.from({ length: count }, (_, i) => {
    const c = safeNonNegInt(clArr?.[i]);
    return c > 0 ? c : bestStars[i] > 0 ? 1 : 0;
  });
  const bestEndlessWaves = Array.from({ length: count }, (_, i) => safeNonNegInt(ewArr?.[i]));
  const challengeClears = Array.from({ length: count }, (_, i) => {
    const list = ccArr?.[i];
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
  });
  return {
    ...progress,
    bestStars,
    clears,
    bestEndlessWaves,
    challengeClears,
    daily: {
      lastDay: dailyLastDay,
      streak: dailyStreak,
      bestStreak: dailyBestStreak,
      total: dailyTotal,
    },
  };
}

function countClearedIslands(progress: ProgressData, levels: readonly LevelDef[]): number {
  let cleared = 0;
  for (let i = 0; i < levels.length; i++) {
    if (isIslandClearedAt(progress, i)) cleared++;
  }
  return cleared;
}

function isHeroUnlockedOnSave(
  progress: ProgressData,
  heroId: HeroId,
  levels: readonly LevelDef[],
): boolean {
  const rule = HERO_DEFS[heroId].unlock;
  if (rule.kind === 'starter') return true;
  const cleared = countClearedIslands(progress, levels);
  const frontier = safeNonNegInt(progress.unlockedLevelIndex);
  return cleared >= rule.count || frontier >= rule.count;
}

function heroLevelOf(progress: ProgressData, heroId: HeroId): number {
  const rawH = (progress.heroes ?? (progress as unknown as { readonly h?: unknown }).h) as
    | {
        readonly roster?: Partial<Record<HeroId, { readonly xp?: unknown; readonly x?: unknown }>>;
        readonly r?: Partial<Record<HeroId, { readonly xp?: unknown; readonly x?: unknown }>>;
      }
    | undefined;
  const fe = rawH?.roster?.[heroId];
  const ce = rawH?.r?.[heroId];
  const xp = fe?.xp ?? fe?.x ?? ce?.xp ?? ce?.x;
  if (typeof xp !== 'number' || !Number.isFinite(xp) || xp <= 0) return 1;
  return heroLevelFromXp(xp);
}

function countHardWins(progress: ProgressData, levels: readonly LevelDef[]): number {
  let wins = 0;
  for (let i = 0; i < levels.length; i++) {
    if (hasHardWinAt(progress, i)) wins++;
  }
  return wins;
}

function bestEndlessCleared(progress: ProgressData, levels: readonly LevelDef[]): number {
  let best = 0;
  for (let i = 0; i < levels.length; i++) {
    best = Math.max(
      best,
      endlessWavesCleared(safeNonNegInt(progress.bestEndlessWaves?.[i]), levels[i].waves.length),
    );
  }
  return best;
}

function countEndlessIslandsAtLeast(
  progress: ProgressData,
  levels: readonly LevelDef[],
  minCleared: number,
): number {
  let count = 0;
  for (let i = 0; i < levels.length; i++) {
    if (endlessWavesCleared(safeNonNegInt(progress.bestEndlessWaves?.[i]), levels[i].waves.length) >= minCleared) {
      count++;
    }
  }
  return count;
}

function dailyTotalOf(progress: ProgressData): number {
  return safeNonNegInt(progress.daily?.total);
}

function dailyBestStreakOf(progress: ProgressData): number {
  return Math.max(safeNonNegInt(progress.daily?.bestStreak), safeNonNegInt(progress.daily?.streak));
}

/** Island challenges offered across the campaign (`championHost` is a Daily-only modifier). */
const CAMPAIGN_CHALLENGE_IDS: readonly ChallengeId[] = [
  'thaw',
  'quietGuns',
  'bowless',
  'staticFree',
  'galeForce',
  'ironTide',
  'thinPurse',
  'glassSanctuary',
  'silentSkies',
];

const DIFFICULTIES = Object.keys(STAR_RULES) as Difficulty[];

const BRONZE_ENDLESS_WAVES = ENDLESS_TIERS[0]?.cleared ?? 3;
const SILVER_ENDLESS_WAVES = ENDLESS_TIERS[1]?.cleared ?? 6;
const GOLD_ENDLESS_WAVES = ENDLESS_TIERS[ENDLESS_TIERS.length - 1]?.cleared ?? 10;

const featAchievements: readonly SteamAchievementDef[] = FEATS.map((feat) => ({
  id: `FEAT_${toUpperSnake(feat.id)}`,
  name: feat.name,
  description: feat.description,
  category: 'feat',
  isEarned: (progress, levels) => {
    const m = feat.measure(normalizeProgressForAchievements(progress, levels.length), levels);
    const target = Math.max(1, Math.floor(Number.isFinite(m.target) ? m.target : 1));
    const current = Math.max(0, Math.floor(Number.isFinite(m.current) ? m.current : 0));
    return current >= target;
  },
}));

const starTierAchievements: readonly SteamAchievementDef[] = DIFFICULTIES.map((difficulty) => ({
  id: `STARS_${toUpperSnake(difficulty)}_SWEEP`,
  name: `${difficulty} Star Sweep`,
  description: `Earn 3 stars on every ${difficulty} island (${describeStarGoals(difficulty).three})`,
  category: 'stars',
  isEarned: (progress, levels) => {
    let matching = 0;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].difficulty !== difficulty) continue;
      matching++;
      if (safeBestStarsAt(progress, i) < 3) return false;
    }
    return matching > 0;
  },
}));

const challengeAchievements: readonly SteamAchievementDef[] = [
  ...CAMPAIGN_CHALLENGE_IDS.map((cid): SteamAchievementDef => {
    const def = CHALLENGES[cid];
    return {
      id: `CHALLENGE_${toUpperSnake(cid)}`,
      name: def.name,
      description: `Win an island with ${def.name} (${def.description})`,
      category: 'challenge',
      isEarned: (progress, levels) => {
        const wc = progress.wonChallenges ?? (progress as unknown as { readonly wc?: unknown }).wc;
        if (Array.isArray(wc) && wc.includes(cid)) {
          return true;
        }
        for (let i = 0; i < levels.length; i++) {
          const done = progress.challengeClears?.[i];
          if (Array.isArray(done) && done.includes(cid)) return true;
        }
        return false;
      },
    };
  }),
  {
    id: 'CHALLENGE_ALL_BADGES',
    name: 'Archipelago Challenger',
    description: 'Complete every island challenge badge across all campaign islands',
    category: 'challenge',
    isEarned: (progress, levels) => {
      if (levels.length === 0) return false;
      for (let i = 0; i < levels.length; i++) {
        const rawDone = progress.challengeClears?.[i];
        const done = Array.isArray(rawDone) ? rawDone : [];
        const offered = challengesForLevel(levels[i]);
        if (offered.some((id) => !done.includes(id))) return false;
      }
      return true;
    },
  },
  {
    id: 'CROWN_ALL_ISLANDS',
    name: 'Sovereign of the Skies',
    description: 'Master every island (3 stars and all challenge badges on every island)',
    category: 'challenge',
    isEarned: (progress, levels) => {
      if (levels.length === 0) return false;
      const normalized = normalizeProgressForAchievements(progress, levels.length);
      for (let i = 0; i < levels.length; i++) {
        if (!isIslandMastered(normalized, i, challengesForLevel(levels[i]))) return false;
      }
      return true;
    },
  },
];

const chapterAchievements: readonly SteamAchievementDef[] = [
  {
    id: 'CHAPTER_TWO_LANDING',
    name: 'Cloudbell Arrival',
    description: 'Clear your first Chapter Two island',
    category: 'chapter',
    isEarned: (progress, levels) => {
      for (let i = 0; i < levels.length; i++) {
        if (CHAPTER_TWO_SET.has(levels[i].id) && isIslandClearedAt(progress, i)) return true;
      }
      return false;
    },
  },
  {
    id: 'CHAPTER_TWO_CLEARED',
    name: 'Outer Archipelago Charted',
    description: `Clear all ${CHAPTER_TWO_ISLAND_IDS.length} Chapter Two islands`,
    category: 'chapter',
    isEarned: (progress, levels) => {
      let matched = 0;
      for (let i = 0; i < levels.length; i++) {
        if (!CHAPTER_TWO_SET.has(levels[i].id)) continue;
        matched++;
        if (!isIslandClearedAt(progress, i)) return false;
      }
      return matched === CHAPTER_TWO_ISLAND_IDS.length;
    },
  },
  {
    id: 'CHAPTER_TWO_THREE_STARS',
    name: 'Lanterns Relit',
    description: 'Earn 3 stars on every Chapter Two island',
    category: 'chapter',
    isEarned: (progress, levels) => {
      let matched = 0;
      for (let i = 0; i < levels.length; i++) {
        if (!CHAPTER_TWO_SET.has(levels[i].id)) continue;
        matched++;
        if (safeBestStarsAt(progress, i) < 3) return false;
      }
      return matched === CHAPTER_TWO_ISLAND_IDS.length;
    },
  },
  {
    id: 'BOSS_I24_CLEARED',
    name: 'Keeper of Lastlight',
    description: 'Defeat the Tempest Colossus and clear Lastlight Head',
    category: 'chapter',
    isEarned: (progress, levels) => {
      const idx = levels.findIndex((l) => l.id === FINALE_BOSS_ISLAND_ID);
      return idx >= 0 && isIslandClearedAt(progress, idx);
    },
  },
];

const fullCampaignThreeStarAchievements: readonly SteamAchievementDef[] = [
  {
    id: 'STARS_ALL_25_ISLANDS',
    name: 'Constellation Complete',
    description: 'Earn 3 stars on all 25 Skyhold islands',
    category: 'stars',
    isEarned: (progress, levels) => {
      if (levels.length < 25) return false;
      for (let i = 0; i < levels.length; i++) {
        if (safeBestStarsAt(progress, i) < 3) return false;
      }
      return true;
    },
  },
];

const heroAchievements: readonly SteamAchievementDef[] = [
  {
    id: 'HERO_ALL_ROSTER',
    name: 'Fellowship of Skyhold',
    description: `Unlock all ${HERO_IDS.length} heroes`,
    category: 'hero',
    isEarned: (progress, levels) =>
      (progress.heroes !== undefined ||
        (progress as unknown as { readonly h?: unknown }).h !== undefined ||
        levels.some((l) => CHAPTER_TWO_SET.has(l.id))) &&
      HERO_IDS.every((id) => isHeroUnlockedOnSave(progress, id, levels)),
  },
  ...HERO_IDS.flatMap((heroId): SteamAchievementDef[] => {
    const def = HERO_DEFS[heroId];
    const token = toUpperSnake(heroId);
    return [
      {
        id: `HERO_${token}_LV10`,
        name: `${def.name} Veteran`,
        description: `Reach Level 10 with ${def.name}`,
        category: 'hero',
        isEarned: (progress) => heroLevelOf(progress, heroId) >= 10,
      },
      {
        id: `HERO_${token}_LV20`,
        name: `${def.name} Paragon`,
        description: `Reach Level ${HERO_MAX_LEVEL} with ${def.name}`,
        category: 'hero',
        isEarned: (progress) => heroLevelOf(progress, heroId) >= HERO_MAX_LEVEL,
      },
    ];
  }),
  {
    id: 'HERO_ALL_LV20',
    name: 'Legends of the Skyhold',
    description: `Reach Level ${HERO_MAX_LEVEL} with all ${HERO_IDS.length} heroes`,
    category: 'hero',
    isEarned: (progress) => HERO_IDS.every((id) => heroLevelOf(progress, id) >= HERO_MAX_LEVEL),
  },
];

const hardAchievements: readonly SteamAchievementDef[] = [
  {
    id: 'HARD_FIRST_RIBBON',
    name: 'First Crimson Seal',
    description: 'Earn your first Hard ribbon by winning an island on Hard difficulty',
    category: 'hard',
    isEarned: (progress, levels) => countHardWins(progress, levels) >= 1,
  },
  {
    id: 'HARD_FIVE_RIBBONS',
    name: 'Iron Vanguard',
    description: 'Earn Hard ribbons on 5 islands',
    category: 'hard',
    isEarned: (progress, levels) => levels.length >= 5 && countHardWins(progress, levels) >= 5,
  },
  {
    id: 'HARD_TEN_RIBBONS',
    name: 'Hardened Commander',
    description: 'Earn Hard ribbons on 10 islands',
    category: 'hard',
    isEarned: (progress, levels) => levels.length >= 10 && countHardWins(progress, levels) >= 10,
  },
  {
    id: 'HARD_BOSS_I24',
    name: 'Lastlight Unbroken',
    description: 'Defeat Lastlight Head on Hard difficulty',
    category: 'hard',
    isEarned: (progress, levels) => {
      const idx = levels.findIndex((l) => l.id === FINALE_BOSS_ISLAND_ID);
      return idx >= 0 && hasHardWinAt(progress, idx);
    },
  },
  {
    id: 'HARD_ALL_ISLANDS',
    name: 'Crimson Sovereign',
    description: 'Earn a Hard ribbon on every island',
    category: 'hard',
    isEarned: (progress, levels) => levels.length > 0 && countHardWins(progress, levels) >= levels.length,
  },
];

const endlessAchievements: readonly SteamAchievementDef[] = [
  {
    id: 'ENDLESS_BRONZE_MEDAL',
    name: 'Hold the Line',
    description: `Earn a Bronze endless medal (${BRONZE_ENDLESS_WAVES} endless waves on one island)`,
    category: 'endless',
    isEarned: (progress, levels) => bestEndlessCleared(progress, levels) >= BRONZE_ENDLESS_WAVES,
  },
  {
    id: 'ENDLESS_SILVER_MEDAL',
    name: 'Tempest Watcher',
    description: `Earn a Silver endless medal (${SILVER_ENDLESS_WAVES} endless waves on one island)`,
    category: 'endless',
    isEarned: (progress, levels) => bestEndlessCleared(progress, levels) >= SILVER_ENDLESS_WAVES,
  },
  {
    id: 'ENDLESS_DEEP_20',
    name: 'Eye of the Maelstrom',
    description: 'Clear 20 endless waves beyond the story on one island',
    category: 'endless',
    isEarned: (progress, levels) => bestEndlessCleared(progress, levels) >= 20,
  },
  {
    id: 'ENDLESS_FIVE_GOLDS',
    name: 'Bastion Eternal',
    description: `Earn Gold endless medals (${GOLD_ENDLESS_WAVES}+ endless waves) on 5 islands`,
    category: 'endless',
    isEarned: (progress, levels) =>
      levels.length >= 5 && countEndlessIslandsAtLeast(progress, levels, GOLD_ENDLESS_WAVES) >= 5,
  },
];

const dailyAchievements: readonly SteamAchievementDef[] = [
  {
    id: 'DAILY_FIRST_WIN',
    name: 'First Squall',
    description: 'Win your first Daily Squall',
    category: 'daily',
    isEarned: (progress) => dailyTotalOf(progress) >= 1,
  },
  {
    id: 'DAILY_STREAK_7',
    name: 'Seven-Day Gale',
    description: 'Reach a 7-day Daily Squall streak',
    category: 'daily',
    isEarned: (progress) => dailyBestStreakOf(progress) >= 7,
  },
  {
    id: 'DAILY_STREAK_14',
    name: 'Fortnight Tradewinds',
    description: 'Reach a 14-day Daily Squall streak',
    category: 'daily',
    isEarned: (progress) => dailyBestStreakOf(progress) >= 14,
  },
  {
    id: 'DAILY_TOTAL_20',
    name: 'Weatherproof Warden',
    description: 'Win 20 Daily Squalls',
    category: 'daily',
    isEarned: (progress) => dailyTotalOf(progress) >= 20,
  },
];

export const STEAM_ACHIEVEMENTS: readonly SteamAchievementDef[] = [
  ...featAchievements,
  ...starTierAchievements,
  ...challengeAchievements,
  ...chapterAchievements,
  ...fullCampaignThreeStarAchievements,
  ...heroAchievements,
  ...hardAchievements,
  ...endlessAchievements,
  ...dailyAchievements,
];

/** Pure metadata list matching `desktop/achievements.json`. */
export function exportAchievementManifest(): SteamAchievementMeta[] {
  return STEAM_ACHIEVEMENTS.map(({ id, name, description }) => ({ id, name, description }));
}

/** Achievement IDs currently satisfied by `progress`. */
export function earnedSteamAchievementIds(
  progress: ProgressData,
  levels: readonly LevelDef[] = LEVELS,
): string[] {
  const normalized = normalizeProgressForAchievements(progress, levels.length);
  const out: string[] = [];
  for (const ach of STEAM_ACHIEVEMENTS) {
    if (ach.isEarned(normalized, levels)) out.push(ach.id);
  }
  return out;
}

/** Unlocks every achievement satisfied by `progress` via the platform adapter; returns unlocked IDs. */
export async function syncAchievementsFromProgress(
  progress: ProgressData,
  adapter: PlatformAdapter = getPlatform(),
  levels: readonly LevelDef[] = LEVELS,
): Promise<string[]> {
  const earned = earnedSteamAchievementIds(progress, levels);
  if (earned.length === 0) return [];
  const unlocked: string[] = [];
  for (const id of earned) {
    try {
      if (await adapter.achievements.unlock(id)) unlocked.push(id);
    } catch {
      // Never let a single achievement IPC error abort remaining unlocks or cloud hydration.
    }
  }
  return unlocked;
}
