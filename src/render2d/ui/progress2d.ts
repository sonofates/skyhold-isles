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
import { challengesForLevel, type ChallengeId } from '../../data/challenges.ts';
import { applyDailyWin, utcDayNumber } from '../../data/daily.ts';
import { LEVELS_2D } from '../../data/levels2d/index.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import { applyEndlessRecord, applyWin, isIslandMastered, type WinRecord } from '../../game/progression.ts';
import { badgesForWin, PLAIN_RUN, type RunConfig } from '../../game/runConfig.ts';
import { createDefaultProgress, migrateProgress, PROGRESS_SAVE_VERSION } from '../../platform/storage.ts';

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
    const hasWrapper = parsed !== null && typeof parsed === 'object' && 'progress' in parsed;
    const payload = hasWrapper ? parsed.progress : parsed;
    const ids = Array.isArray(parsed?.ids) ? parsed.ids.filter((x): x is string => typeof x === 'string') : levels.map((l) => l.id);
    return remapProgress(payload, ids, levels);
  } catch {
    return createDefaultProgress(levels.length);
  }
}

export function saveProgress2D(progress: ProgressData, levels: readonly LevelDef[] = LEVELS_2D): void {
  progress.version = PROGRESS_SAVE_VERSION;
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
  readonly bestEndlessWave: number;
  readonly challengeClears: readonly string[];
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
    bestEndlessWave: progress.bestEndlessWaves[i] ?? 0,
    challengeClears: [...(progress.challengeClears[i] ?? [])],
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
export function recordWin2D(
  levelId: string,
  stars: 1 | 2 | 3,
  livesLeft: number,
  levels: readonly LevelDef[] = LEVELS_2D,
  challenges: readonly ChallengeId[] = [],
): WinRecord | null {
  const i = indexOf2D(levelId, levels);
  if (i < 0) return null;
  const p = loadProgress2D(levels);
  const badges = badgesForWin(challengesForLevel(levels[i]), challenges);
  const rec = applyWin(p, i, levels.length, stars, livesLeft, badges);
  saveProgress2D(p, levels);
  return rec;
}

/** Records a Daily Squall completion for `day` judged at `nowMs` (`applyDailyWin`) and saves. */
export function recordDailyWin2D(
  day: number,
  nowMs = Date.now(),
  levels: readonly LevelDef[] = LEVELS_2D,
): { counted: boolean; streak: number } {
  const p = loadProgress2D(levels);
  const prevLast = p.daily.lastDay;
  const prevStreak = p.daily.streak;
  const res = applyDailyWin(p.daily, day, utcDayNumber(nowMs));
  if (res.counted || p.daily.lastDay !== prevLast || p.daily.streak !== prevStreak) {
    saveProgress2D(p, levels);
  }
  return res;
}

export interface EndlessRecord2D {
  readonly best: number;
  readonly previousBest: number;
  readonly isNewBest: boolean;
  readonly reachedEndless: boolean;
}

/**
 * Records an Endless run's furthest one-based wave on `levelId` (`applyEndlessRecord`).
 * Matches the 3D rule: falling during the island's story waves (`waveOneBased <= waves.length`)
 * does not write an endless record.
 */
export function recordEndless2D(
  levelId: string,
  waveOneBased: number,
  levels: readonly LevelDef[] = LEVELS_2D,
): EndlessRecord2D | null {
  const i = indexOf2D(levelId, levels);
  if (i < 0) return null;
  const p = loadProgress2D(levels);
  const wave = Number.isFinite(waveOneBased) ? Math.floor(waveOneBased) : 0;
  if (wave <= levels[i].waves.length) {
    const best = p.bestEndlessWaves[i] ?? 0;
    return { best, previousBest: best, isNewBest: false, reachedEndless: false };
  }
  const rec = applyEndlessRecord(p, i, wave);
  if (rec.best !== rec.previousBest) saveProgress2D(p, levels);
  return { ...rec, reachedEndless: true };
}

export interface RunOutcome2D {
  readonly levelId: string;
  readonly won: boolean;
  readonly stars: number;
  readonly livesRemaining: number;
  /** One-based wave reached (`waveSystem.currentWaveOneBased`). */
  readonly waveReached: number;
  readonly runConfig?: Readonly<RunConfig>;
  /** Wall-clock timestamp (ms) used to judge Daily Squall completion (defaults to `Date.now()`). */
  readonly nowMs?: number;
}

export interface RunResultRecord2D {
  readonly win: WinRecord | null;
  readonly daily: { readonly counted: boolean; readonly streak: number } | null;
  readonly endless: EndlessRecord2D | null;
}

/**
 * Pure outcome recorder matching `GameSession` in the 3D build:
 * - Endless run: records `bestEndlessWaves` once past story waves; never awards campaign stars.
 * - Campaign / Challenge / Daily win: applies `applyWin` (with island challenge badges) and, when
 *   `runConfig.daily !== null`, `applyDailyWin`.
 * - Non-endless loss: mutates nothing.
 */
export function applyRunResult2D(
  progress: ProgressData,
  outcome: RunOutcome2D,
  levels: readonly LevelDef[] = LEVELS_2D,
): RunResultRecord2D {
  const cfg = outcome.runConfig ?? PLAIN_RUN;
  const i = indexOf2D(outcome.levelId, levels);

  if (cfg.endless) {
    if (i < 0) return { win: null, daily: null, endless: null };
    const wave = Number.isFinite(outcome.waveReached) ? Math.floor(outcome.waveReached) : 0;
    if (wave <= levels[i].waves.length) {
      const best = progress.bestEndlessWaves[i] ?? 0;
      return { win: null, daily: null, endless: { best, previousBest: best, isNewBest: false, reachedEndless: false } };
    }
    const rec = applyEndlessRecord(progress, i, wave);
    return { win: null, daily: null, endless: { ...rec, reachedEndless: true } };
  }

  if (!outcome.won) {
    return { win: null, daily: null, endless: null };
  }

  const stars = Math.max(1, Math.min(3, Math.round(outcome.stars))) as 1 | 2 | 3;
  let win: WinRecord | null = null;
  if (i >= 0) {
    const badges = badgesForWin(challengesForLevel(levels[i]), cfg.challenges);
    win = applyWin(progress, i, levels.length, stars, outcome.livesRemaining, badges);
  }
  const daily =
    cfg.daily !== null
      ? applyDailyWin(progress.daily, cfg.daily, utcDayNumber(outcome.nowMs ?? Date.now()))
      : null;
  return { win, daily, endless: null };
}

/** Loads the 2D save, applies `applyRunResult2D`, persists if anything changed, and returns the record. */
export function recordRunResult2D(
  outcome: RunOutcome2D,
  levels: readonly LevelDef[] = LEVELS_2D,
): RunResultRecord2D {
  const p = loadProgress2D(levels);
  const prevDailyLast = p.daily.lastDay;
  const prevDailyStreak = p.daily.streak;
  const res = applyRunResult2D(p, outcome, levels);
  const dailyChanged =
    Boolean(res.daily?.counted) || p.daily.lastDay !== prevDailyLast || p.daily.streak !== prevDailyStreak;
  const endlessChanged = Boolean(res.endless?.reachedEndless && res.endless.best !== res.endless.previousBest);
  if (res.win !== null || dailyChanged || endlessChanged) {
    saveProgress2D(p, levels);
  }
  return res;
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
