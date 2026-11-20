import type { ProgressData } from '../core/types.ts';
import { LEVELS, type LevelDef } from '../data/levels/index.ts';
import { syncAchievementsFromProgress } from './achievements.ts';
import { getPlatform, type PlatformAdapter } from './platform.ts';
import { mergeProgress } from './saveCode.ts';
import {
  CLOUD_PROGRESS_SLOT,
  hasAnyProgress,
  migrateProgress,
  readLocalProgressRaw,
  saveLocalProgress,
  tryRepairTruncatedJson,
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
  let normalizedLocal = migrateProgress(localProgress, levelCount);
  const callerRaw = JSON.stringify(normalizedLocal);
  const diskRawBefore = readLocalProgressRaw();
  let updated = false;

  let cloudRaw: string | null;
  let readFailed = false;
  try {
    cloudRaw = await adapter.cloudSave.read(CLOUD_PROGRESS_SLOT);
  } catch {
    cloudRaw = null;
    readFailed = true;
  }

  const safeCloudWrite = async (json: string): Promise<void> => {
    try {
      await adapter.cloudSave.write(CLOUD_PROGRESS_SLOT, json);
    } catch {
      // Never let a transient Steam Cloud write error abort local hydration or achievement sync.
    }
  };

  const diskRawAfter = readLocalProgressRaw();
  const concurrentHappened = diskRawAfter !== null && diskRawAfter !== diskRawBefore;
  if (concurrentHappened) {
    let concurrentParsed: unknown;
    try {
      concurrentParsed = JSON.parse(diskRawAfter);
    } catch {
      concurrentParsed = tryRepairTruncatedJson(diskRawAfter);
    }
    if (concurrentParsed && typeof concurrentParsed === 'object' && !Array.isArray(concurrentParsed)) {
      normalizedLocal = mergeProgress(
        normalizedLocal,
        migrateProgress(concurrentParsed, levelCount),
        levelCount,
      );
    }
  }

  const localRaw = JSON.stringify(normalizedLocal);
  let merged = normalizedLocal;

  if (cloudRaw) {
    let parsed: unknown = null;
    let parseFailed = false;
    try {
      parsed = JSON.parse(cloudRaw);
    } catch {
      parseFailed = true;
      const repaired = tryRepairTruncatedJson(cloudRaw);
      if (repaired && hasAnyProgress(migrateProgress(repaired, levelCount))) {
        parsed = repaired;
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      if (hasAnyProgress(normalizedLocal)) {
        await safeCloudWrite(localRaw);
      }
    } else {
      const cloudProgress = migrateProgress(parsed, levelCount);
      merged = mergeProgress(normalizedLocal, cloudProgress, levelCount);
      const mergedRaw = JSON.stringify(merged);
      if (mergedRaw !== localRaw) {
        saveLocalProgress(merged);
      }
      if (parseFailed || mergedRaw !== cloudRaw) {
        await safeCloudWrite(mergedRaw);
      }
    }
  } else if (!readFailed && adapter.isSteam && hasAnyProgress(normalizedLocal)) {
    await safeCloudWrite(localRaw);
  }

  const finalMergedRaw = JSON.stringify(merged);
  if (finalMergedRaw !== callerRaw) {
    updated = true;
  }
  if (concurrentHappened && finalMergedRaw !== diskRawAfter && hasAnyProgress(merged)) {
    saveLocalProgress(merged);
  }

  const unlockedAchievements = await syncAchievementsFromProgress(merged, adapter, levels);
  return { merged, updated, unlockedAchievements };
}
