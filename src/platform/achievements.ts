import type { ProgressData } from '../core/types.ts';
import { CHALLENGES, challengesForLevel, type ChallengeId } from '../data/challenges.ts';
import { LEVELS, type LevelDef } from '../data/levels/index.ts';
import { describeStarGoals, STAR_RULES, type Difficulty } from '../data/stars.ts';
import { FEATS } from '../game/feats.ts';
import { isIslandMastered } from '../game/progression.ts';
import { getPlatform, type PlatformAdapter } from './platform.ts';

/**
 * Steam achievement catalog derived from the game's existing Feats (`src/game/feats.ts` /
 * `src/ui/feats.ts`), difficulty star goals (`src/data/stars.ts`), and island challenges
 * (`src/data/challenges.ts`). Kept 1-to-1 with `desktop/achievements.json`.
 */

export interface SteamAchievementMeta {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export interface SteamAchievementDef extends SteamAchievementMeta {
  readonly category: 'feat' | 'stars' | 'challenge';
  readonly isEarned: (progress: ProgressData, levels: readonly LevelDef[]) => boolean;
}

function toUpperSnake(camel: string): string {
  return camel
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase();
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

const featAchievements: readonly SteamAchievementDef[] = FEATS.map((feat) => ({
  id: `FEAT_${toUpperSnake(feat.id)}`,
  name: feat.name,
  description: feat.description,
  category: 'feat',
  isEarned: (progress, levels) => {
    const m = feat.measure(progress, levels);
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
      if ((progress.bestStars[i] ?? 0) < 3) return false;
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
        for (let i = 0; i < levels.length; i++) {
          if ((progress.challengeClears[i] ?? []).includes(cid)) return true;
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
        const done = progress.challengeClears[i] ?? [];
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
      for (let i = 0; i < levels.length; i++) {
        if (!isIslandMastered(progress, i, challengesForLevel(levels[i]))) return false;
      }
      return true;
    },
  },
];

export const STEAM_ACHIEVEMENTS: readonly SteamAchievementDef[] = [
  ...featAchievements,
  ...starTierAchievements,
  ...challengeAchievements,
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
  const out: string[] = [];
  for (const ach of STEAM_ACHIEVEMENTS) {
    if (ach.isEarned(progress, levels)) out.push(ach.id);
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
    if (await adapter.achievements.unlock(id)) unlocked.push(id);
  }
  return unlocked;
}
