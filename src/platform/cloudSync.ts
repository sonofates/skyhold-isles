import type { ProgressData } from '../core/types.ts';
import { LEVELS, type LevelDef } from '../data/levels/index.ts';
import { rankOf, sanitizeRanks, WORKSHOP_UPGRADES, workshopStarsSpent } from '../data/workshop.ts';
import { starWallet } from '../game/progression.ts';
import { syncAchievementsFromProgress } from './achievements.ts';
import { getPlatform, type PlatformAdapter } from './platform.ts';
import { mergeProgress, migrateProgressForMerge } from './saveCode.ts';
import {
  CLOUD_PROGRESS_SLOT,
  getProgressResetGen,
  hasAnyProgress,
  loadProgress,
  markCloudHydrated,
  migrateProgress,
  readLocalCloudProgressMirrorRaw,
  readLocalProgressRaw,
  registerCloudHydrator,
  saveLocalProgress,
  setCloudReadInFlight,
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
function topUpWorkshopRanks(
  base: Readonly<Record<string, number>>,
  extra: Readonly<Record<string, number>>,
  totalEarned: number,
): Record<string, number> {
  const topped: Record<string, number> = { ...sanitizeRanks(base) };
  let remaining = totalEarned - workshopStarsSpent(topped);
  if (remaining < 0) return {};
  for (const def of WORKSHOP_UPGRADES) {
    let cur = rankOf(topped, def.id);
    const want = rankOf(extra, def.id);
    while (cur < want) {
      const stepCost = def.costs[cur];
      if (stepCost === undefined || stepCost > remaining) break;
      cur++;
      topped[def.id] = cur;
      remaining -= stepCost;
    }
  }
  return sanitizeRanks(topped);
}

export async function hydrateProgressFromCloud(
  localProgress: ProgressData,
  levelCount = LEVELS.length,
  adapter: PlatformAdapter = getPlatform(),
  levels: readonly LevelDef[] = LEVELS,
): Promise<CloudHydrateResult> {
  const genAtStart = getProgressResetGen();
  let normalizedLocal = migrateProgress(localProgress, levelCount);
  const preReadWorkshop = sanitizeRanks(normalizedLocal.workshop);
  const callerRaw = JSON.stringify(normalizedLocal);
  const diskRawBefore = readLocalProgressRaw();
  let updated = false;

  let cloudRaw: string | null;
  let readFailed = false;
  setCloudReadInFlight(adapter, true);
  try {
    cloudRaw = await adapter.cloudSave.read(CLOUD_PROGRESS_SLOT);
    if (adapter.cloudSave.didLastReadFail?.(CLOUD_PROGRESS_SLOT) === true) {
      readFailed = true;
    }
  } catch {
    cloudRaw = null;
    readFailed = true;
  } finally {
    setCloudReadInFlight(adapter, false);
  }
  if (getProgressResetGen() !== genAtStart) {
    return { merged: loadProgress(levelCount), updated: false, unlockedAchievements: [] };
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
  let concurrentRefundedWorkshop: Record<string, number> | null = null;
  let concurrentAddedWorkshop: Record<string, number> | null = null;
  if (concurrentHappened) {
    let concurrentParsed: unknown;
    try {
      concurrentParsed = JSON.parse(diskRawAfter);
    } catch {
      concurrentParsed = tryRepairTruncatedJson(diskRawAfter);
    }
    if (concurrentParsed && typeof concurrentParsed === 'object' && !Array.isArray(concurrentParsed)) {
      const concurrentStrict = migrateProgress(concurrentParsed, levelCount);
      const concW = sanitizeRanks(concurrentStrict.workshop);
      if (WORKSHOP_UPGRADES.some((def) => rankOf(concW, def.id) < rankOf(preReadWorkshop, def.id))) {
        concurrentRefundedWorkshop = concW;
      } else if (
        WORKSHOP_UPGRADES.some((def) => rankOf(concW, def.id) > rankOf(preReadWorkshop, def.id))
      ) {
        concurrentAddedWorkshop = concW;
      }
      normalizedLocal = mergeProgress(
        normalizedLocal,
        migrateProgressForMerge(concurrentParsed as Record<string, unknown>, levelCount),
        levelCount,
      );
      if (concurrentRefundedWorkshop !== null) {
        normalizedLocal.workshop = { ...concurrentRefundedWorkshop };
        if (starWallet(normalizedLocal).available < 0) normalizedLocal.workshop = {};
      }
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
    if (parseFailed) {
      const mirrorRaw = readLocalCloudProgressMirrorRaw();
      if (mirrorRaw && mirrorRaw !== cloudRaw) {
        let mirrorParsed: unknown;
        try {
          mirrorParsed = JSON.parse(mirrorRaw);
        } catch {
          mirrorParsed = tryRepairTruncatedJson(mirrorRaw);
        }
        if (mirrorParsed && typeof mirrorParsed === 'object' && !Array.isArray(mirrorParsed)) {
          const mirrorProgress = migrateProgressForMerge(
            mirrorParsed as Record<string, unknown>,
            levelCount,
          );
          if (hasAnyProgress(mirrorProgress) || Object.keys(mirrorProgress.workshop).length > 0) {
            normalizedLocal = mergeProgress(normalizedLocal, mirrorProgress, levelCount);
            merged = normalizedLocal;
          }
        }
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const healedLocalRaw = JSON.stringify(normalizedLocal);
      if (healedLocalRaw !== localRaw && getProgressResetGen() === genAtStart) {
        saveLocalProgress(normalizedLocal);
      }
      if (!readFailed) {
        markCloudHydrated(adapter);
        if (hasAnyProgress(normalizedLocal) && getProgressResetGen() === genAtStart) {
          await safeCloudWrite(healedLocalRaw);
        }
      }
    } else {
      const cloudProgress = migrateProgressForMerge(parsed as Record<string, unknown>, levelCount);
      merged = mergeProgress(normalizedLocal, cloudProgress, levelCount);
      if (concurrentRefundedWorkshop !== null) {
        merged.workshop = { ...concurrentRefundedWorkshop };
        if (starWallet(merged).available < 0) merged.workshop = {};
      } else if (concurrentAddedWorkshop !== null) {
        const lostLocalRank = WORKSHOP_UPGRADES.some(
          (def) => rankOf(merged.workshop, def.id) < rankOf(concurrentAddedWorkshop, def.id),
        );
        const totalEarned = starWallet(merged).earned;
        if (lostLocalRank && workshopStarsSpent(concurrentAddedWorkshop) <= totalEarned) {
          merged.workshop = topUpWorkshopRanks(
            concurrentAddedWorkshop,
            cloudProgress.workshop,
            totalEarned,
          );
        }
      }
      const mergedRaw = JSON.stringify(merged);
      if (mergedRaw !== localRaw && getProgressResetGen() === genAtStart) {
        saveLocalProgress(merged);
      }
      if (!readFailed) {
        markCloudHydrated(adapter);
        if ((parseFailed || mergedRaw !== cloudRaw) && getProgressResetGen() === genAtStart) {
          await safeCloudWrite(mergedRaw);
        }
      }
    }
  } else if (!readFailed) {
    markCloudHydrated(adapter);
    if (adapter.isSteam && hasAnyProgress(normalizedLocal) && getProgressResetGen() === genAtStart) {
      await safeCloudWrite(localRaw);
    }
  }
  if (getProgressResetGen() !== genAtStart) {
    return { merged: loadProgress(levelCount), updated: false, unlockedAchievements: [] };
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

registerCloudHydrator((progress, levelCount, adapter) =>
  hydrateProgressFromCloud(progress, levelCount, adapter),
);
