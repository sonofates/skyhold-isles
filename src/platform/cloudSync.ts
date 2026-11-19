import type { ProgressData } from '../core/types.ts';
import { LEVELS, type LevelDef } from '../data/levels/index.ts';
import { syncAchievementsFromProgress } from './achievements.ts';
import { getPlatform, type PlatformAdapter } from './platform.ts';
import { mergeProgress } from './saveCode.ts';
import {
  CLOUD_PROGRESS_SLOT,
  hasAnyProgress,
  migrateProgress,
  saveLocalProgress,
} from './storage.ts';

export interface CloudHydrateResult {
  readonly merged: ProgressData;
  readonly updated: boolean;
  readonly unlockedAchievements: string[];
}

/**
 * Pulls the progress blob from `adapter.cloudSave`, merges it record-by-record with `localProgress`
 * (best of both, never dropping earned progress), persists the merged save when either side gained
 * records, and unlocks all satisfied Steam achievements.
 */
export async function hydrateProgressFromCloud(
  localProgress: ProgressData,
  levelCount = LEVELS.length,
  adapter: PlatformAdapter = getPlatform(),
  levels: readonly LevelDef[] = LEVELS,
): Promise<CloudHydrateResult> {
  const normalizedLocal = migrateProgress(localProgress, levelCount);
  const localRaw = JSON.stringify(normalizedLocal);
  let merged = normalizedLocal;
  let updated = false;

  const cloudRaw = await adapter.cloudSave.read(CLOUD_PROGRESS_SLOT);
  if (cloudRaw) {
    try {
      const parsed: unknown = JSON.parse(cloudRaw);
      const cloudProgress = migrateProgress(parsed, levelCount);
      merged = mergeProgress(normalizedLocal, cloudProgress, levelCount);
      const mergedRaw = JSON.stringify(merged);
      if (mergedRaw !== localRaw) {
        updated = true;
        saveLocalProgress(merged);
      }
      if (mergedRaw !== cloudRaw) {
        await adapter.cloudSave.write(CLOUD_PROGRESS_SLOT, mergedRaw);
      }
    } catch {
      // Corrupt cloud blob: keep local progress and overwrite cloud when local has progress.
      if (hasAnyProgress(normalizedLocal)) {
        await adapter.cloudSave.write(CLOUD_PROGRESS_SLOT, localRaw);
      }
    }
  } else if (adapter.isSteam && hasAnyProgress(normalizedLocal)) {
    await adapter.cloudSave.write(CLOUD_PROGRESS_SLOT, localRaw);
  }

  const unlockedAchievements = await syncAchievementsFromProgress(merged, adapter, levels);
  return { merged, updated, unlockedAchievements };
}
