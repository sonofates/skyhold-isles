/**
 * Save adapter for the painted 2D isles (thin layer over the 3D build's progression code).
 *
 * The 2D islands (`LEVELS_2D`) are a separate list from the 16-island campaign (`LEVELS`), and the
 * campaign save (`skyhold_isles_progress_v1`) is indexed by `LEVELS` position — writing 2D results
 * there would corrupt it. So the 2D isles keep their own `ProgressData` under its own key, built
 * and migrated by the same functions the 3D build uses (`createDefaultProgress`, `migrateProgress`,
 * `applyWin`, `starWallet`, `isIslandMastered`). Nothing here forks those rules.
 *
 * Islands are stored by index (that is what `ProgressData` is), but the id order is saved next to
 * it, so a parallel change that inserts or reorders islands in `LEVELS_2D` remaps the records by id
 * instead of shifting stars onto the wrong island.
 */
import type { ProgressData } from '../../core/types.ts';
import { challengesForLevel } from '../../data/challenges.ts';
import { LEVELS_2D } from '../../data/levels2d/index.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import { applyWin, isIslandMastered, type WinRecord } from '../../game/progression.ts';
import { createDefaultProgress, migrateProgress } from '../../platform/storage.ts';

export const PROGRESS_2D_KEY = 'skyhold_isles_progress2d_v1';
export const STORY_SEEN_KEY = 'skyhold_isles_story2d_seen_v1';

interface Stored2D {
  readonly ids: readonly string[];
  readonly progress: unknown;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Re-indexes a stored save written for `oldIds` onto `levels` (pure). Islands that vanished drop
 * out; new islands start empty; the unlock frontier follows its island by id.
 */
export function remapProgress(raw: unknown, oldIds: readonly string[], levels: readonly Pick<LevelDef, 'id'>[]): ProgressData {
  const n = levels.length;
  const old = migrateProgress(raw, Math.max(1, oldIds.length));
  const same = oldIds.length === n && oldIds.every((id, i) => levels[i]?.id === id);
  if (same) return migrateProgress(raw, n);
  const out = createDefaultProgress(n);
  let frontier = 0;
  levels.forEach((lvl, i) => {
    const j = oldIds.indexOf(lvl.id);
    if (j < 0) return;
    out.bestStars[i] = old.bestStars[j] ?? 0;
    out.bestEndlessWaves[i] = old.bestEndlessWaves[j] ?? 0;
    out.bestLives[i] = old.bestLives[j] ?? 0;
    out.clears[i] = old.clears[j] ?? 0;
    out.challengeClears[i] = [...(old.challengeClears[j] ?? [])];
    if (j <= old.unlockedLevelIndex) frontier = Math.max(frontier, i);
  });
  out.workshop = { ...old.workshop };
  out.daily = { ...old.daily };
  out.unlockedLevelIndex = frontier;
  // Same walk-forward the campaign migration does: everything after a cleared island opens.
  return migrateProgress(out, n);
}

/** The 2D save, migrated to the current island list. Never throws. */
export function loadProgress2D(levels: readonly LevelDef[] = LEVELS_2D): ProgressData {
  const ls = storage();
  try {
    const raw = ls?.getItem(PROGRESS_2D_KEY);
    if (!raw) return createDefaultProgress(levels.length);
    const parsed = JSON.parse(raw) as Partial<Stored2D>;
    const ids = Array.isArray(parsed.ids) ? parsed.ids.filter((x): x is string => typeof x === 'string') : levels.map((l) => l.id);
    return remapProgress(parsed.progress, ids, levels);
  } catch {
    return createDefaultProgress(levels.length);
  }
}

export function saveProgress2D(progress: ProgressData, levels: readonly LevelDef[] = LEVELS_2D): void {
  const ls = storage();
  try {
    const data: Stored2D = { ids: levels.map((l) => l.id), progress };
    ls?.setItem(PROGRESS_2D_KEY, JSON.stringify(data));
  } catch {
    // quota / private mode: progress just is not kept
  }
}

export interface IslandState {
  readonly index: number;
  readonly level: LevelDef;
  readonly unlocked: boolean;
  readonly stars: number;
  readonly clears: number;
  readonly bestLives: number;
  readonly mastered: boolean;
  /** The furthest unlocked island (where the "you are here" flag stands). */
  readonly frontier: boolean;
}

export function islandStates(progress: ProgressData, levels: readonly LevelDef[] = LEVELS_2D): IslandState[] {
  const frontier = Math.max(0, Math.min(levels.length - 1, progress.unlockedLevelIndex));
  return levels.map((level, i) => ({
    index: i,
    level,
    unlocked: i <= progress.unlockedLevelIndex,
    stars: Math.max(0, Math.min(3, progress.bestStars[i] ?? 0)),
    clears: progress.clears[i] ?? 0,
    bestLives: progress.bestLives[i] ?? 0,
    mastered: isIslandMastered(progress, i, challengesForLevel(level)),
    frontier: i === frontier,
  }));
}

export function indexOf2D(levelId: string, levels: readonly LevelDef[] = LEVELS_2D): number {
  return levels.findIndex((l) => l.id === levelId);
}

/** Is the island playable from the map (deep links ignore this)? */
export function isUnlocked2D(progress: ProgressData, levelId: string, levels: readonly LevelDef[] = LEVELS_2D): boolean {
  const i = indexOf2D(levelId, levels);
  return i >= 0 && i <= progress.unlockedLevelIndex;
}

/** Records a 2D win with the campaign rules (`applyWin`) and saves. Null for islands not in the list. */
export function recordWin2D(levelId: string, stars: 1 | 2 | 3, livesLeft: number, levels: readonly LevelDef[] = LEVELS_2D): WinRecord | null {
  const i = indexOf2D(levelId, levels);
  if (i < 0) return null;
  const p = loadProgress2D(levels);
  const rec = applyWin(p, i, levels.length, stars, livesLeft);
  saveProgress2D(p, levels);
  return rec;
}

// --- story beats seen ------------------------------------------------------------------------

function readSeen(): Set<string> {
  try {
    const raw = storage()?.getItem(STORY_SEEN_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function storySeen(levelId: string, part: 'intro' | 'outro'): boolean {
  return readSeen().has(`${levelId}:${part}`);
}

export function markStorySeen(levelId: string, part: 'intro' | 'outro'): void {
  const s = readSeen();
  s.add(`${levelId}:${part}`);
  try {
    storage()?.setItem(STORY_SEEN_KEY, JSON.stringify([...s]));
  } catch {
    // ignore
  }
}

/** Erases the 2D isles save and the story flags (Settings → reset). The 3D campaign save is untouched. */
export function resetProgress2D(): void {
  try {
    storage()?.removeItem(PROGRESS_2D_KEY);
    storage()?.removeItem(STORY_SEEN_KEY);
  } catch {
    // ignore
  }
}
