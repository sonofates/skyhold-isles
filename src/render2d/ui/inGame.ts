/**
 * World-map side of a 2D run (UI routing only): where the end panel's Next Isle / World Map go,
 * recording a win in the 2D save, and the story panels before an island's first play and after a
 * win. Used by main2d.ts.
 */
import { LEVELS_2D } from '../../data/levels2d/index.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import type { WinRecord } from '../../game/progression.ts';
import { islandMapUrl, type MapsManifest } from './islandArt.ts';
import { loadDifficultyPref } from './difficulty2d.ts';
export { endNoteFor } from './modeBits.ts';
import {
  indexOf2D,
  islandStates,
  isUnlocked2D,
  loadProgress2D,
  markStorySeen,
  recordRunResult2D,
  recordWin2D,
  storySeen,
  type RunOutcome2D,
  type RunResultRecord2D,
} from './progress2d.ts';
import { storyBeats, type StoryPart } from './storyBeats.ts';
import { showStory } from './storyPanels.ts';

/** The island after `levelId` on the world map route (undefined at the end / off the list). */
export function nextIsland2D(levelId: string, levels: readonly LevelDef[] = LEVELS_2D): LevelDef | undefined {
  const i = indexOf2D(levelId, levels);
  return i >= 0 ? levels[i + 1] : undefined;
}

/** End panel "Next Isle" target: the next island when it is open (or this run just won it open). */
export function nextIslandOpen(levelId: string, wonNow: boolean): LevelDef | undefined {
  const next = nextIsland2D(levelId);
  if (!next) return undefined;
  return wonNow || isUnlocked2D(loadProgress2D(), next.id) ? next : undefined;
}

export function worldMapHref(): string {
  return location.pathname;
}

/**
 * URL that plays an island (end panel Next Isle) on the player's remembered difficulty; `intro=1`
 * asks for its story panels when it was never won.
 */
export function islandHref(level: LevelDef): string {
  const p = loadProgress2D();
  const i = indexOf2D(level.id);
  const firstPlay = i >= 0 && (p.clears[i] ?? 0) === 0;
  const diff = loadDifficultyPref();
  return `${location.pathname}?level=${encodeURIComponent(level.id)}${diff !== 'normal' ? `&diff=${diff}` : ''}${firstPlay ? '&intro=1' : ''}`;
}

export function recordRun(level: LevelDef, won: boolean, stars: number, lives: number): WinRecord | null {
  if (!won) return null;
  const s = Math.max(1, Math.min(3, Math.round(stars))) as 1 | 2 | 3;
  return recordWin2D(level.id, s, lives);
}

/** Is the island mastered in the 2D save (3 stars + all its challenge badges)? */
export function isMastered(levelId: string): boolean {
  const i = indexOf2D(levelId);
  return i >= 0 && (islandStates(loadProgress2D())[i]?.mastered ?? false);
}

/** Records a campaign, challenge, Daily Squall, or Endless run outcome into the 2D save. */
export function recordRunOutcome(outcome: RunOutcome2D): RunResultRecord2D {
  return recordRunResult2D(outcome);
}

/**
 * Shows the island's story beats for `part` once (unless `force`): resolves true when the card was
 * shown (after it closes), false when there was nothing to show.
 */
export function playStoryOnce(level: LevelDef, part: StoryPart, manifest: MapsManifest | null, baseUrl: string, force = false): Promise<boolean> {
  const beats = storyBeats(level, part);
  if (beats.length === 0 || (!force && storySeen(level.id, part))) return Promise.resolve(false);
  return new Promise((resolve) => {
    showStory(level, part, beats, islandMapUrl(manifest, level, baseUrl), () => {
      markStorySeen(level.id, part);
      resolve(true);
    });
  });
}
