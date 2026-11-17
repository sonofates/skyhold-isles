import type { ProgressData } from '../core/types.ts';
import { workshopStarsSpent } from '../data/workshop.ts';

/** What a recorded win changed — drives the victory screen's "new best" / unlock callouts. */
export interface WinRecord {
  readonly stars: 1 | 2 | 3;
  readonly previousBestStars: number;
  readonly firstClear: boolean;
  /** Stars added to the island's best (0 when the run did not beat it). */
  readonly starsGained: number;
  readonly newBestLives: boolean;
  /** Island index newly unlocked by this win (null when nothing new opened). */
  readonly unlockedIndex: number | null;
  /** Challenge ids completed for the first time by this win (each = +1 bonus star). */
  readonly newChallenges: readonly string[];
}

/**
 * Applies a campaign win to the save (pure; caller persists). A win ALWAYS unlocks the next
 * island, whatever modifiers the run used.
 */
export function applyWin(
  progress: ProgressData,
  levelIndex: number,
  levelCount: number,
  stars: 1 | 2 | 3,
  livesRemaining: number,
  challenges: readonly string[] = [],
): WinRecord {
  const previousBestStars = progress.bestStars[levelIndex] ?? 0;
  const previousClears = progress.clears[levelIndex] ?? 0;
  const previousBestLives = progress.bestLives[levelIndex] ?? 0;
  const lives = Math.max(0, Math.floor(livesRemaining));

  progress.bestStars[levelIndex] = Math.max(previousBestStars, stars);
  progress.clears[levelIndex] = previousClears + 1;
  progress.bestLives[levelIndex] = Math.max(previousBestLives, lives);

  const newChallenges: string[] = [];
  if (challenges.length > 0) {
    while (progress.challengeClears.length <= levelIndex) progress.challengeClears.push([]);
    const done = progress.challengeClears[levelIndex];
    for (const id of challenges) {
      if (!done.includes(id)) {
        done.push(id);
        newChallenges.push(id);
      }
    }
  }

  let unlockedIndex: number | null = null;
  if (levelIndex + 1 < levelCount && progress.unlockedLevelIndex < levelIndex + 1) {
    progress.unlockedLevelIndex = levelIndex + 1;
    unlockedIndex = levelIndex + 1;
  }
  return {
    stars,
    previousBestStars,
    firstClear: previousClears === 0 && previousBestStars === 0,
    starsGained: Math.max(0, stars - previousBestStars),
    newBestLives: previousClears > 0 && lives > previousBestLives,
    unlockedIndex,
    newChallenges,
  };
}

/** Records an endless run's furthest wave; returns whether it beat the island's personal best. */
export function applyEndlessRecord(
  progress: ProgressData,
  levelIndex: number,
  waveReached: number,
): { best: number; previousBest: number; isNewBest: boolean } {
  const previousBest = progress.bestEndlessWaves[levelIndex] ?? 0;
  const wave = Math.max(0, Math.floor(Number.isFinite(waveReached) ? waveReached : 0));
  const best = Math.max(previousBest, wave);
  progress.bestEndlessWaves[levelIndex] = best;
  return { best, previousBest, isNewBest: wave > previousBest };
}

/** Sum of best campaign stars across islands. */
export function totalCampaignStars(progress: ProgressData): number {
  let total = 0;
  for (const s of progress.bestStars) total += Math.max(0, Math.min(3, s | 0));
  return total;
}

/** Bonus stars from completed island challenges (one per challenge). */
export function totalChallengeStars(progress: ProgressData): number {
  let total = 0;
  for (const list of progress.challengeClears ?? []) total += list?.length ?? 0;
  return total;
}

/** Star currency for the Workshop: everything earned minus what upgrades currently hold. */
export interface StarWallet {
  readonly campaign: number;
  readonly challenge: number;
  readonly earned: number;
  readonly spent: number;
  readonly available: number;
}

export function starWallet(progress: ProgressData): StarWallet {
  const campaign = totalCampaignStars(progress);
  const challenge = totalChallengeStars(progress);
  const spent = workshopStarsSpent(progress.workshop ?? {});
  return { campaign, challenge, earned: campaign + challenge, spent, available: campaign + challenge - spent };
}
