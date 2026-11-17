import { LEVELS } from '../levels/index.ts';
import type { LevelDef } from '../levels/types.ts';
import { LEVEL_L1C } from './l1c.ts';

/**
 * 2D plot-map islands. Kept apart from the 16-island campaign list (`LEVELS`), so campaign
 * progression, saves and every UI that iterates `LEVELS` stay untouched; load these by id.
 */
export const LEVELS_2D: readonly LevelDef[] = [LEVEL_L1C];

/** Any island by id: campaign islands first, then the 2D side entries. */
export function getLevelById(id: string): LevelDef | null {
  return LEVELS.find((l) => l.id === id) ?? LEVELS_2D.find((l) => l.id === id) ?? null;
}

export { LEVEL_L1C };
