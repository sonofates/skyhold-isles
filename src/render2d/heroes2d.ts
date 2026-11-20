/**
 * Pure hero progression, unlock milestone, XP/level curve, skill-tree, and selection helpers for 2D.
 *
 * No DOM, Pixi, or storage side effects — every state-updating helper returns a fresh `ProgressData`
 * copy without mutating its input, matching `workshop.ts` (`buyRank`).
 */
import type {
  HeroId,
  HeroProgressEntry,
  HeroSaveData,
  ProgressData,
} from '../core/types.ts';
import {
  areHeroNodePrerequisitesMet,
  buildLevel20Specialization,
  countHeroSkillPointsSpent,
  createFreshHeroSaveData,
  defaultLevel20Skills,
  defaultSkillsForLevel,
  getHeroSkillNode,
  hasHeroSaveProgress,
  HERO_DEFS,
  HERO_IDS,
  HERO_LEVEL_XP,
  HERO_MAX_LEVEL,
  HERO_XP_RULES,
  heroLevelFromXp,
  heroSkillPointsForLevel,
  isHeroId,
  mergeHeroSaveData,
  resolveHeroStats,
  sanitizeHeroSaveData,
  sanitizeHeroSkillsForBudget,
  sanitizeHeroXp,
  totalHeroSaveXp,
  type HeroDef,
  type HeroSkillNodeDef,
  type HeroUnlockRule,
  type ResolvedHeroStats,
} from '../data/heroes.ts';
import { LEVELS_2D } from '../data/levels2d/index.ts';
import type { LevelDef } from '../data/levels/types.ts';

export {
  areHeroNodePrerequisitesMet,
  buildLevel20Specialization,
  countHeroSkillPointsSpent,
  createFreshHeroSaveData,
  defaultLevel20Skills,
  defaultSkillsForLevel,
  getHeroSkillNode,
  hasHeroSaveProgress,
  HERO_DEFS,
  HERO_IDS,
  HERO_LEVEL_XP,
  HERO_MAX_LEVEL,
  HERO_XP_RULES,
  heroLevelFromXp,
  heroSkillPointsForLevel,
  isHeroId,
  mergeHeroSaveData,
  resolveHeroStats,
  sanitizeHeroSaveData,
  sanitizeHeroSkillsForBudget,
  sanitizeHeroXp,
  totalHeroSaveXp,
};

export const MAX_HERO_XP = 1_000_000;

export interface HeroLevelProgress {
  readonly level: number;
  readonly maxLevel: number;
  readonly xp: number;
  readonly currentLevelXp: number;
  readonly nextLevelXp: number | null;
  readonly xpIntoLevel: number;
  readonly xpForNextLevel: number;
  /** Progress `[0, 1]` toward the next level (`1` at max level 20). */
  readonly fraction: number;
  readonly totalSkillPoints: number;
}

export type HeroNodeUnlockStatus =
  | 'unlocked'
  | 'available'
  | 'insufficientPoints'
  | 'lockedPrereq'
  | 'heroLocked'
  | 'invalid';

export interface HeroRosterEntry {
  readonly id: HeroId;
  readonly def: HeroDef;
  readonly unlocked: boolean;
  readonly unlockRule: HeroUnlockRule;
  readonly selected: boolean;
  readonly xp: number;
  readonly level: number;
  readonly xpProgress: HeroLevelProgress;
  readonly unlockedSkills: readonly string[];
  readonly skillPointsEarned: number;
  readonly skillPointsSpent: number;
  readonly skillPointsAvailable: number;
  readonly resolvedStats: ResolvedHeroStats;
}

export interface HeroRunXpInput {
  readonly won: boolean;
  readonly stars?: number;
  readonly enemiesKilled?: number;
  readonly wavesCleared?: number;
  /** Used when `wavesCleared` is omitted (`won ? waveReached : Math.max(0, waveReached - 1)`). */
  readonly waveReached?: number;
}

export interface HeroRunXpRecord {
  readonly heroId: HeroId;
  readonly xpGained: number;
  readonly previousXp: number;
  readonly newXp: number;
  readonly previousLevel: number;
  readonly newLevel: number;
  readonly leveledUp: boolean;
  readonly skillPointsGained: number;
}

export interface HeroRunSelection {
  readonly heroId: HeroId;
  readonly level: number;
  readonly skills: readonly string[];
}

/** Cumulative XP threshold required to reach `level` (`1..20`). */
export function xpForHeroLevel(level: number): number {
  const clamped = Math.max(1, Math.min(HERO_MAX_LEVEL, Math.floor(Number.isFinite(level) ? level : 1)));
  return HERO_LEVEL_XP[clamped - 1] ?? 0;
}

/** Hero level (`1..20`) for a total persistent XP count. */
export function heroLevel(xp: number): number {
  return heroLevelFromXp(xp);
}

/** Detailed level & XP-bar progress for a given total XP count. */
export function heroLevelProgress(xp: number): HeroLevelProgress {
  const cleanXp = sanitizeHeroXp(xp);
  const level = heroLevelFromXp(cleanXp);
  const currentLevelXp = HERO_LEVEL_XP[level - 1] ?? 0;
  const nextLevelXp = level < HERO_MAX_LEVEL ? (HERO_LEVEL_XP[level] ?? null) : null;
  const xpIntoLevel = cleanXp - currentLevelXp;
  const xpForNextLevel = nextLevelXp !== null ? Math.max(1, nextLevelXp - currentLevelXp) : 0;
  const fraction =
    nextLevelXp !== null ? Math.max(0, Math.min(1, xpIntoLevel / xpForNextLevel)) : 1;
  return {
    level,
    maxLevel: HERO_MAX_LEVEL,
    xp: cleanXp,
    currentLevelXp,
    nextLevelXp,
    xpIntoLevel,
    xpForNextLevel,
    fraction,
    totalSkillPoints: heroSkillPointsForLevel(level),
  };
}

/** Count of distinct 2D campaign islands cleared in `progress`. */
export function clearedIslandsCount2D(
  progress: ProgressData,
  levels: readonly Pick<LevelDef, 'id'>[] = LEVELS_2D,
): number {
  const dw = progress.difficultyWins;
  const dwMaxLen = dw ? Math.max(dw.easy.length, dw.normal.length, dw.hard.length) : 0;
  const limit = Math.min(
    levels.length,
    Math.max(progress.clears.length, progress.bestStars.length, dwMaxLen),
  );
  let cleared = 0;
  for (let i = 0; i < limit; i++) {
    if (
      (progress.clears[i] ?? 0) > 0 ||
      (progress.bestStars[i] ?? 0) > 0 ||
      (dw?.easy[i] ?? 0) > 0 ||
      (dw?.normal[i] ?? 0) > 0 ||
      (dw?.hard[i] ?? 0) > 0
    ) {
      cleared++;
    }
  }
  return cleared;
}

/** Whether `heroId` has met its campaign unlock milestone on `progress`. */
export function isHeroUnlocked(
  progress: ProgressData,
  heroId: HeroId,
  levels: readonly Pick<LevelDef, 'id'>[] = LEVELS_2D,
): boolean {
  if (!isHeroId(heroId)) return false;
  const rule = HERO_DEFS[heroId].unlock;
  if (rule.kind === 'starter') return true;
  const cleared = clearedIslandsCount2D(progress, levels);
  const frontier = Number.isFinite(progress.unlockedLevelIndex) ? progress.unlockedLevelIndex : 0;
  return cleared >= rule.count || frontier >= rule.count;
}

/** Fresh default `HeroSaveData` (`bran` selected, 0 XP and empty skill trees for all 5 heroes). */
export function createDefaultHeroSave(): HeroSaveData {
  return createFreshHeroSaveData();
}

/** True when `unlockedSkills` satisfies `node`'s prerequisite rule (`all` or `minPrerequisites`). */
export function arePrerequisitesMet(
  node: HeroSkillNodeDef,
  unlockedSkills: readonly string[],
): boolean {
  return areHeroNodePrerequisitesMet(node, unlockedSkills);
}

/** Total skill points spent across `unlockedSkills` for `heroId`. */
export function heroSkillPointsSpent(heroId: HeroId, unlockedSkills: readonly string[]): number {
  return countHeroSkillPointsSpent(heroId, unlockedSkills);
}

/**
 * Validates and normalizes a stored skill-node list for `heroId` against `maxSkillPoints`.
 * Unknown or duplicate IDs are dropped; if the remaining set violates prerequisites or exceeds
 * earned skill points (corrupted / edited save), refunds to `[]` while keeping XP intact.
 */
export function sanitizeHeroSkills(
  heroId: HeroId,
  rawSkills: unknown,
  maxSkillPoints: number,
): string[] {
  return sanitizeHeroSkillsForBudget(heroId, rawSkills, maxSkillPoints);
}

/**
 * Pure migration / sanitization of `progress.heroes` from any older or partial save payload.
 * Never loses valid XP; falls back `selectedHero` to `'bran'` when missing or still locked.
 */
export function migrateHeroSave(
  raw: unknown,
  progress?: ProgressData,
  levels: readonly Pick<LevelDef, 'id'>[] = LEVELS_2D,
): HeroSaveData {
  if (!progress) return sanitizeHeroSaveData(raw);
  const cleared = clearedIslandsCount2D(progress, levels);
  const frontier = Number.isFinite(progress.unlockedLevelIndex) ? progress.unlockedLevelIndex : 0;
  return sanitizeHeroSaveData(raw, cleared, frontier);
}

function cloneWithHeroes(progress: ProgressData, heroes: HeroSaveData): ProgressData {
  return {
    ...progress,
    heroes: {
      selectedHero: heroes.selectedHero,
      roster: Object.fromEntries(
        HERO_IDS.map((id) => {
          const e = heroes.roster[id] ?? { xp: 0, skills: [] };
          return [id, { xp: e.xp, skills: [...e.skills] }];
        }),
      ) as Partial<Record<HeroId, HeroProgressEntry>>,
    },
  };
}

function readHeroSave(
  progress: ProgressData,
  levels: readonly Pick<LevelDef, 'id'>[] = LEVELS_2D,
): HeroSaveData {
  return migrateHeroSave(progress.heroes, progress, levels);
}

/** Returns the last-selected hero if unlocked, otherwise `'bran'`. */
export function lastHero(
  progress: ProgressData,
  levels: readonly Pick<LevelDef, 'id'>[] = LEVELS_2D,
): HeroId {
  const save = readHeroSave(progress, levels);
  return isHeroUnlocked(progress, save.selectedHero, levels) ? save.selectedHero : 'bran';
}

/** Selects `heroId` when unlocked; returns a new `ProgressData` or `null` if locked / unknown. */
export function selectHero(
  progress: ProgressData,
  heroId: HeroId,
  levels: readonly Pick<LevelDef, 'id'>[] = LEVELS_2D,
): ProgressData | null {
  if (!isHeroId(heroId) || !isHeroUnlocked(progress, heroId, levels)) return null;
  const save = readHeroSave(progress, levels);
  save.selectedHero = heroId;
  return cloneWithHeroes(progress, save);
}

/** Detailed unlock eligibility state of `nodeId` on `heroId` for UI skill-tree buttons. */
export function nodeUnlockStatus(
  progress: ProgressData,
  heroId: HeroId,
  nodeId: string,
  levels: readonly Pick<LevelDef, 'id'>[] = LEVELS_2D,
): HeroNodeUnlockStatus {
  if (!isHeroId(heroId)) return 'invalid';
  const node = getHeroSkillNode(heroId, nodeId);
  if (!node) return 'invalid';
  if (!isHeroUnlocked(progress, heroId, levels)) return 'heroLocked';

  const save = readHeroSave(progress, levels);
  const entry = save.roster[heroId] ?? { xp: 0, skills: [] };
  if (entry.skills.includes(nodeId)) return 'unlocked';
  if (!arePrerequisitesMet(node, entry.skills)) return 'lockedPrereq';

  const earned = heroSkillPointsForLevel(heroLevel(entry.xp));
  const spent = heroSkillPointsSpent(heroId, entry.skills);
  if (earned - spent < node.cost) return 'insufficientPoints';
  return 'available';
}

/** True when `nodeId` can be unlocked right now on `heroId`. */
export function canUnlockNode(
  progress: ProgressData,
  heroId: HeroId,
  nodeId: string,
  levels: readonly Pick<LevelDef, 'id'>[] = LEVELS_2D,
): boolean {
  return nodeUnlockStatus(progress, heroId, nodeId, levels) === 'available';
}

/** Unlocks `nodeId` on `heroId`, returning a fresh `ProgressData`, or `null` if not allowed. */
export function applyNode(
  progress: ProgressData,
  heroId: HeroId,
  nodeId: string,
  levels: readonly Pick<LevelDef, 'id'>[] = LEVELS_2D,
): ProgressData | null {
  if (!canUnlockNode(progress, heroId, nodeId, levels)) return null;
  const save = readHeroSave(progress, levels);
  const entry = save.roster[heroId] ?? { xp: 0, skills: [] };
  save.roster[heroId] = { xp: entry.xp, skills: [...entry.skills, nodeId] };
  return cloneWithHeroes(progress, save);
}

/** Refunds all unlocked skill nodes on `heroId` for free on the world map (XP is kept). */
export function respec(
  progress: ProgressData,
  heroId: HeroId,
  levels: readonly Pick<LevelDef, 'id'>[] = LEVELS_2D,
): ProgressData {
  if (!isHeroId(heroId)) return progress;
  const save = readHeroSave(progress, levels);
  const entry = save.roster[heroId] ?? { xp: 0, skills: [] };
  save.roster[heroId] = { xp: entry.xp, skills: [] };
  return cloneWithHeroes(progress, save);
}

/** Computes persistent hero XP earned from a run's kills, cleared waves, and victory stars. */
export function xpForRun(result: HeroRunXpInput): number {
  const kills = Math.max(0, Math.floor(Number.isFinite(result.enemiesKilled) ? (result.enemiesKilled ?? 0) : 0));
  const fallbackWaves =
    typeof result.waveReached === 'number' && Number.isFinite(result.waveReached)
      ? result.won
        ? Math.max(0, Math.floor(result.waveReached))
        : Math.max(0, Math.floor(result.waveReached) - 1)
      : 0;
  const wavesCleared =
    typeof result.wavesCleared === 'number' && Number.isFinite(result.wavesCleared)
      ? Math.max(0, Math.floor(result.wavesCleared))
      : fallbackWaves;
  const stars = result.won
    ? Math.max(1, Math.min(3, Math.round(Number.isFinite(result.stars) ? (result.stars ?? 1) : 1)))
    : 0;
  const winBonus = result.won ? HERO_XP_RULES.winBase + stars * HERO_XP_RULES.perStar : 0;
  const rawTotal = kills * HERO_XP_RULES.perKill + wavesCleared * HERO_XP_RULES.perWaveCleared + winBonus;
  return Number.isFinite(rawTotal) ? Math.min(MAX_HERO_XP, Math.max(0, Math.floor(rawTotal))) : MAX_HERO_XP;
}

/** Adds `xpGained` to `heroId` (pure), returning the updated `ProgressData` and level-up delta. */
export function applyHeroXp(
  progress: ProgressData,
  heroId: HeroId,
  xpGained: number,
  levels: readonly Pick<LevelDef, 'id'>[] = LEVELS_2D,
): { progress: ProgressData; record: HeroRunXpRecord } {
  if (!isHeroId(heroId)) {
    return {
      progress,
      record: {
        heroId,
        xpGained: 0,
        previousXp: 0,
        newXp: 0,
        previousLevel: 1,
        newLevel: 1,
        leveledUp: false,
        skillPointsGained: 0,
      },
    };
  }
  const save = readHeroSave(progress, levels);
  const entry = save.roster[heroId] ?? { xp: 0, skills: [] };
  const added = Math.max(0, Math.floor(Number.isFinite(xpGained) ? xpGained : 0));
  const previousXp = entry.xp;
  const newXp = Math.min(MAX_HERO_XP, previousXp + added);
  const previousLevel = heroLevel(previousXp);
  const newLevel = heroLevel(newXp);
  save.roster[heroId] = { xp: newXp, skills: [...entry.skills] };
  if (isHeroUnlocked(progress, heroId, levels)) {
    save.selectedHero = heroId;
  }
  return {
    progress: cloneWithHeroes(progress, save),
    record: {
      heroId,
      xpGained: newXp - previousXp,
      previousXp,
      newXp,
      previousLevel,
      newLevel,
      leveledUp: newLevel > previousLevel,
      skillPointsGained: Math.max(0, heroSkillPointsForLevel(newLevel) - heroSkillPointsForLevel(previousLevel)),
    },
  };
}

/** Full 5-hero roster snapshot for world map / island briefing / hero skill-tree UI. */
export function heroRoster(
  progress: ProgressData,
  levels: readonly Pick<LevelDef, 'id'>[] = LEVELS_2D,
): HeroRosterEntry[] {
  const save = readHeroSave(progress, levels);
  const activeId = isHeroUnlocked(progress, save.selectedHero, levels) ? save.selectedHero : 'bran';
  return HERO_IDS.map((id) => {
    const def = HERO_DEFS[id];
    const unlocked = isHeroUnlocked(progress, id, levels);
    const entry = save.roster[id] ?? { xp: 0, skills: [] };
    const xpProg = heroLevelProgress(entry.xp);
    const earned = xpProg.totalSkillPoints;
    const spent = heroSkillPointsSpent(id, entry.skills);
    return {
      id,
      def,
      unlocked,
      unlockRule: def.unlock,
      selected: id === activeId,
      xp: xpProg.xp,
      level: xpProg.level,
      xpProgress: xpProg,
      unlockedSkills: [...entry.skills],
      skillPointsEarned: earned,
      skillPointsSpent: spent,
      skillPointsAvailable: Math.max(0, earned - spent),
      resolvedStats: resolveHeroStats(id, xpProg.level, entry.skills),
    };
  });
}

/**
 * Resolves the hero configuration to bring into a 2D run from `progress` and optional URL overrides
 * (`?hero=<id>|none`, `?herolevel=<1..20>`).
 */
export function resolveHeroForRun(
  progress: ProgressData,
  heroParam?: string | null,
  levelParam?: string | null,
  levels: readonly Pick<LevelDef, 'id'>[] = LEVELS_2D,
): HeroRunSelection | null {
  if (heroParam === 'none') return null;
  const save = readHeroSave(progress, levels);
  const heroId: HeroId =
    heroParam && isHeroId(heroParam)
      ? heroParam
      : isHeroUnlocked(progress, save.selectedHero, levels)
        ? save.selectedHero
        : 'bran';

  const entry = save.roster[heroId] ?? { xp: 0, skills: [] };
  const parsedLevel = levelParam ? Number(levelParam) : NaN;
  if (Number.isFinite(parsedLevel) && parsedLevel >= 1) {
    const forcedLevel = Math.max(1, Math.min(HERO_MAX_LEVEL, Math.floor(parsedLevel)));
    const savedLevel = heroLevel(entry.xp);
    const budget = heroSkillPointsForLevel(forcedLevel);
    const validSaved = sanitizeHeroSkills(heroId, entry.skills, budget);
    const skills =
      forcedLevel <= savedLevel && validSaved.length > 0
        ? validSaved
        : defaultSkillsForLevel(heroId, forcedLevel);
    return { heroId, level: forcedLevel, skills: [...skills] };
  }
  return {
    heroId,
    level: heroLevel(entry.xp),
    skills: [...entry.skills],
  };
}
