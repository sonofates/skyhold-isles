/**
 * Which earned feats the player has already looked at in the Logbook. A feat earned since then puts a
 * red dot on the map's Logbook button and the Feats tab, and a "New" tag on its row until the Feats
 * tab is opened. Remembered per browser; the first look at a save only records a baseline (no dots
 * for feats earned before this existed).
 */
import type { LevelDef } from '../../data/levels/types.ts';
import type { ProgressData } from '../../core/types.ts';
import { earnedFeatIds } from '../../game/feats.ts';

const KEY = 'skyhold2d_feats_seen_v1';

/** Earned feats not in `seen`, in `earned` order; none when there is no baseline yet (`seen` null). */
export function unseenFeatIds(earned: Iterable<string>, seen: ReadonlySet<string> | null): string[] {
  if (!seen) return [];
  return [...earned].filter((id) => !seen.has(id));
}

export function readSeenFeats(): Set<string> | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const v: unknown = JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return null;
  }
}

export function writeSeenFeats(ids: Iterable<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    /* storage full / blocked: dots simply come back */
  }
}

/** Records `earned` as the baseline when there is none yet (first map visit, or a run's save-before). */
export function ensureFeatBaseline(earned: Iterable<string>): void {
  if (readSeenFeats() === null) writeSeenFeats(earned);
}

/** The feats earned and not yet looked at; sets the baseline on a first visit. */
export function unseenFeats(progress: ProgressData, levels: readonly LevelDef[]): string[] {
  const earned = earnedFeatIds(progress, levels);
  ensureFeatBaseline(earned);
  return unseenFeatIds(earned, readSeenFeats());
}

/** The Feats tab was opened: everything earned now counts as seen. */
export function markFeatsSeen(progress: ProgressData, levels: readonly LevelDef[]): void {
  const seen = readSeenFeats() ?? new Set<string>();
  for (const id of earnedFeatIds(progress, levels)) seen.add(id);
  writeSeenFeats(seen);
}
