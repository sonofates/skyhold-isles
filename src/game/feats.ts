import type { ProgressData } from '../core/types.ts';
import { challengesForLevel } from '../data/challenges.ts';
import { endlessTier } from '../data/endlessMutators.ts';
import type { LevelDef } from '../data/levels/index.ts';
import { LEVELS } from '../data/levels/index.ts';
import { isIslandMastered, totalCampaignStars } from './progression.ts';

/**
 * Feats: long-term goals read straight from the progress save (nothing new is stored, so there is no
 * migration and old saves show their feats at once). Every input is a "best" record that never goes
 * down (stars, clears, badges, endless bests, Daily totals), so a feat once earned stays earned until
 * the player resets progress. Feats are cosmetic — they grant no stars or power.
 */
export type FeatIcon = 'star' | 'islands' | 'medal' | 'crown' | 'endless' | 'daily' | 'trophy';

export interface FeatDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: FeatIcon;
  /** Progress toward the goal; earned when `current >= target` (target ≥ 1). */
  readonly measure: (p: ProgressData, levels: readonly LevelDef[]) => { current: number; target: number };
}

export interface FeatStatus {
  readonly def: FeatDef;
  readonly current: number;
  readonly target: number;
  readonly earned: boolean;
}

const isCleared = (p: ProgressData, i: number): boolean => (p.clears[i] ?? 0) > 0 || (p.bestStars[i] ?? 0) > 0;

function countIslands(levels: readonly LevelDef[], test: (i: number) => boolean): number {
  let n = 0;
  for (let i = 0; i < levels.length; i++) if (test(i)) n++;
  return n;
}

function badgeCount(p: ProgressData, levels: readonly LevelDef[]): number {
  let n = 0;
  for (let i = 0; i < levels.length; i++) {
    const done = p.challengeClears[i] ?? [];
    n += challengesForLevel(levels[i]).filter((id) => done.includes(id)).length;
  }
  return n;
}

function bestEndlessTier(p: ProgressData, levels: readonly LevelDef[]): number {
  let best = 0;
  for (let i = 0; i < levels.length; i++) {
    best = Math.max(best, endlessTier(p.bestEndlessWaves[i] ?? 0, levels[i].waves.length));
  }
  return best;
}

const totalWins = (p: ProgressData, levels: readonly LevelDef[]): number => {
  let n = 0;
  for (let i = 0; i < levels.length; i++) n += Math.max(0, p.clears[i] ?? 0);
  return n;
};

const atLeastOne = (n: number): number => Math.max(1, n);

export const FEATS: readonly FeatDef[] = [
  {
    id: 'firstLanding',
    name: 'First Landing',
    description: 'Clear your first island',
    icon: 'islands',
    measure: (p, ls) => ({ current: Math.min(1, countIslands(ls, (i) => isCleared(p, i))), target: 1 }),
  },
  {
    id: 'islandHopper',
    name: 'Island Hopper',
    description: 'Clear 5 islands',
    icon: 'islands',
    measure: (p, ls) => ({ current: countIslands(ls, (i) => isCleared(p, i)), target: Math.min(5, atLeastOne(ls.length)) }),
  },
  {
    id: 'skyCharted',
    name: 'The Skies Charted',
    description: 'Clear every island',
    icon: 'islands',
    measure: (p, ls) => ({ current: countIslands(ls, (i) => isCleared(p, i)), target: atLeastOne(ls.length) }),
  },
  {
    id: 'starcatcher',
    name: 'Starcatcher',
    description: 'Earn 3 stars on any island',
    icon: 'star',
    measure: (p, ls) => ({ current: Math.min(1, countIslands(ls, (i) => (p.bestStars[i] ?? 0) >= 3)), target: 1 }),
  },
  {
    id: 'stargazer',
    name: 'Stargazer',
    description: 'Collect half of all campaign stars',
    icon: 'star',
    measure: (p, ls) => ({ current: totalCampaignStars(p), target: atLeastOne(Math.ceil((ls.length * 3) / 2)) }),
  },
  {
    id: 'fullFirmament',
    name: 'Full Firmament',
    description: 'Collect every campaign star',
    icon: 'star',
    measure: (p, ls) => ({ current: totalCampaignStars(p), target: atLeastOne(ls.length * 3) }),
  },
  {
    id: 'masterStroke',
    name: 'Master Stroke',
    description: 'Earn 3 stars on a Master island',
    icon: 'trophy',
    measure: (p, ls) => ({
      current: Math.min(1, countIslands(ls, (i) => ls[i].difficulty === 'Master' && (p.bestStars[i] ?? 0) >= 3)),
      target: 1,
    }),
  },
  {
    id: 'badgeHunter',
    name: 'Badge Hunter',
    description: 'Win 6 island challenges',
    icon: 'medal',
    measure: (p, ls) => ({ current: badgeCount(p, ls), target: 6 }),
  },
  {
    id: 'crowned',
    name: 'Crowned',
    description: 'Master an island (3 stars and both badges)',
    icon: 'crown',
    measure: (p, ls) => ({
      current: Math.min(1, countIslands(ls, (i) => isIslandMastered(p, i, challengesForLevel(ls[i])))),
      target: 1,
    }),
  },
  {
    id: 'stormChaser',
    name: 'Storm Chaser',
    description: 'Earn a Gold endless medal (10 endless waves)',
    icon: 'endless',
    measure: (p, ls) => ({ current: bestEndlessTier(p, ls), target: 3 }),
  },
  {
    id: 'squallRider',
    name: 'Squall Rider',
    description: 'Win 7 Daily Squalls',
    icon: 'daily',
    measure: (p) => ({ current: Math.max(0, p.daily?.total ?? 0), target: 7 }),
  },
  {
    id: 'steadyWinds',
    name: 'Steady Winds',
    description: 'Reach a 3-day Daily Squall streak',
    icon: 'daily',
    measure: (p) => ({ current: Math.max(0, p.daily?.bestStreak ?? 0), target: 3 }),
  },
  {
    id: 'veteran',
    name: 'Seasoned Warden',
    description: 'Win 30 battles',
    icon: 'trophy',
    measure: (p, ls) => ({ current: totalWins(p, ls), target: 30 }),
  },
];

export function featStatuses(progress: ProgressData, levels: readonly LevelDef[] = LEVELS): FeatStatus[] {
  return FEATS.map((def) => {
    const m = def.measure(progress, levels);
    const target = Math.max(1, Math.floor(Number.isFinite(m.target) ? m.target : 1));
    const current = Math.max(0, Math.floor(Number.isFinite(m.current) ? m.current : 0));
    return { def, current: Math.min(current, target), target, earned: current >= target };
  });
}

/** Ids of earned feats (for before/after comparisons around a run). */
export function earnedFeatIds(progress: ProgressData, levels: readonly LevelDef[] = LEVELS): Set<string> {
  const out = new Set<string>();
  for (const s of featStatuses(progress, levels)) if (s.earned) out.add(s.def.id);
  return out;
}

/** Feats earned in `after` but not in `before`, in FEATS order. */
export function newlyEarnedFeats(before: ReadonlySet<string>, after: ProgressData, levels: readonly LevelDef[] = LEVELS): FeatDef[] {
  return featStatuses(after, levels)
    .filter((s) => s.earned && !before.has(s.def.id))
    .map((s) => s.def);
}
