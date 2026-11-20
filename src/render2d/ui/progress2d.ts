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
import type { HeroId, ProgressData } from '../../core/types.ts';
import { challengesForLevel, type ChallengeId } from '../../data/challenges.ts';
import { applyDailyWin, utcDayNumber } from '../../data/daily.ts';
import { DIFFICULTIES, difficultyWinsOf, isDifficultyId, starsAwarded, type DifficultyId } from '../../data/difficulty.ts';
import { isHeroId } from '../../data/heroes.ts';
import { workshopStarsSpent } from '../../data/workshop.ts';
import { LEVELS_2D } from '../../data/levels2d/index.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import { applyEndlessRecord, applyWin, isIslandMastered, type WinRecord } from '../../game/progression.ts';
import { badgesForWin, PLAIN_RUN, type RunConfig } from '../../game/runConfig.ts';
import { syncAchievementsFromProgress } from '../../platform/achievements.ts';
import type { CloudHydrateResult } from '../../platform/cloudSync.ts';
import { getPlatform, type PlatformAdapter } from '../../platform/platform.ts';
import {
  decodeSaveCode,
  describeMergeGain,
  encodeSaveCode,
  inspectSaveCodeHints,
  mergeProgress,
  type RecoverProgressResult,
  type SaveCodeResult,
} from '../../platform/saveCode.ts';
import {
  createDefaultProgress,
  hasAnyProgress,
  migrateProgress,
  PROGRESS_SAVE_VERSION,
  tryRepairTruncatedJson,
} from '../../platform/storage.ts';
import {
  applyHeroXp,
  applyNode,
  createDefaultHeroSave,
  migrateHeroSave,
  respec,
  selectHero,
  xpForRun,
  type HeroRunXpRecord,
} from '../heroes2d.ts';

export const PROGRESS_2D_KEY = 'skyhold_isles_progress2d_v1';
export const CLOUD_PROGRESS_2D_SLOT = 'progress2d';
export const STORY_SEEN_KEY = 'skyhold_isles_story2d_seen_v1';
export const PROGRESS_2D_RESET_BACKUP_KEY = 'skyhold_isles_progress2d_reset_backup';
export const PROGRESS_2D_IMPORT_BACKUP_KEY = 'skyhold_isles_progress2d_import_backup';
export const PROGRESS_2D_CORRUPT_BACKUP_KEY = 'skyhold_isles_progress2d_corrupt_backup';
const LOCAL_CLOUD_2D_MIRROR_KEY = `skyhold_isles_cloud_${CLOUD_PROGRESS_2D_SLOT}`;
const autoHydrated2DAdapters = new WeakSet<PlatformAdapter>();
const readingCloud2DAdapters = new WeakSet<PlatformAdapter>();
const completedHydrated2DAdapters = new WeakSet<PlatformAdapter>();
let resetGen2D = 0;

function isMockLevelRoster(levels: readonly Pick<LevelDef, 'id'>[]): boolean {
  return levels.some((l) => l.id.startsWith('mock-'));
}

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

function maxRawIslandArrayLen(raw: unknown): number {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 0;
  const r = raw as Record<string, unknown>;
  let maxLen = 0;
  for (const key of ['bestStars', 'bestEndlessWaves', 'bestLives', 'clears', 'challengeClears']) {
    const arr = r[key];
    if (Array.isArray(arr) && arr.length > maxLen) maxLen = arr.length;
  }
  const dw = r.difficultyWins ?? r.dw;
  if (dw && typeof dw === 'object' && !Array.isArray(dw)) {
    const dwo = dw as Record<string, unknown>;
    for (const key of ['easy', 'normal', 'hard', 'e', 'n', 'h']) {
      const arr = dwo[key];
      if (Array.isArray(arr) && arr.length > maxLen) maxLen = arr.length;
    }
  }
  return Math.min(512, maxLen);
}

/**
 * Re-indexes a stored save written for `oldIds` onto `levels` (pure). Islands that vanished drop
 * out; new islands start empty; the unlock frontier follows its island by id.
 */
export function remapProgress(raw: unknown, oldIds: readonly string[], levels: readonly Pick<LevelDef, 'id'>[]): ProgressData {
  const n = levels.length;
  const rawHeroes =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? ((raw as { heroes?: unknown; h?: unknown }).heroes ?? (raw as { h?: unknown }).h)
      : undefined;
  if (n === 0) {
    const empty = createDefaultProgress(0);
    empty.heroes = migrateHeroSave(rawHeroes, empty, levels);
    return empty;
  }
  const effectiveOldIds = oldIds.length > 0 ? oldIds : levels.map((l) => l.id);
  const oldCount = Math.max(1, effectiveOldIds.length, maxRawIslandArrayLen(raw));
  const old = migrateProgress(raw, oldCount);
  const same = effectiveOldIds.length === n && effectiveOldIds.every((id, i) => levels[i]?.id === id);
  if (same) {
    const migrated = migrateProgress(raw, n);
    migrated.heroes = migrateHeroSave(rawHeroes, migrated, levels);
    return migrated;
  }
  const out = createDefaultProgress(n);
  let frontier = 0;
  levels.forEach((lvl, i) => {
    for (let j = 0; j < effectiveOldIds.length; j++) {
      if (effectiveOldIds[j] !== lvl.id) continue;
      out.bestStars[i] = Math.max(out.bestStars[i], old.bestStars[j] ?? 0);
      out.bestEndlessWaves[i] = Math.max(out.bestEndlessWaves[i], old.bestEndlessWaves[j] ?? 0);
      out.bestLives[i] = Math.max(out.bestLives[i], old.bestLives[j] ?? 0);
      out.clears[i] = Math.max(out.clears[i], old.clears[j] ?? 0);
      for (const ch of old.challengeClears[j] ?? []) {
        if (!out.challengeClears[i].includes(ch)) out.challengeClears[i].push(ch);
      }
      if (old.difficultyWins) {
        const dw = (out.difficultyWins ??= { easy: new Array<number>(n).fill(0), normal: new Array<number>(n).fill(0), hard: new Array<number>(n).fill(0) });
        for (const d of ['easy', 'normal', 'hard'] as const) dw[d][i] = Math.max(dw[d][i], old.difficultyWins[d][j] ?? 0);
      }
      if (j <= old.unlockedLevelIndex) frontier = Math.max(frontier, i);
    }
  });
  out.workshop = { ...old.workshop };
  out.daily = { ...old.daily };
  out.unlockedLevelIndex = frontier;
  // Same walk-forward the campaign migration does: everything after a cleared island opens.
  const remapped = migrateProgress(out, n);
  remapped.heroes = migrateHeroSave(rawHeroes, remapped, levels);
  return remapped;
}

interface ParsedStored2D {
  readonly progress: ProgressData;
  readonly rawSelectedHero?: HeroId;
  readonly rawWorkshop?: Record<string, number>;
  readonly repairedFromTruncated?: boolean;
}

function parseStored2DRaw(
  raw: string,
  levels: readonly Pick<LevelDef, 'id'>[],
): ParsedStored2D | null {
  let parsed: unknown;
  let repairedFromTruncated = false;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = tryRepairTruncatedJson(raw);
    repairedFromTruncated = parsed !== null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Partial<Stored2D>;
  const hasWrapper = 'progress' in obj;
  let payload: unknown = hasWrapper ? obj.progress : obj;
  if (typeof payload === 'string') {
    const rawPayloadStr = payload;
    try {
      payload = JSON.parse(rawPayloadStr);
    } catch {
      payload = tryRepairTruncatedJson(rawPayloadStr);
      repairedFromTruncated = true;
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const rawHeroes =
    (payload as { heroes?: unknown; h?: unknown }).heroes ?? (payload as { h?: unknown }).h;
  const rawSelectedCand =
    rawHeroes && typeof rawHeroes === 'object' && !Array.isArray(rawHeroes)
      ? ((rawHeroes as { selectedHero?: unknown; s?: unknown }).selectedHero ??
        (rawHeroes as { s?: unknown }).s)
      : undefined;
  const rawSelectedHero = isHeroId(rawSelectedCand) ? rawSelectedCand : undefined;
  const mappedIds = Array.isArray(obj.ids)
    ? obj.ids.map((x) => (typeof x === 'string' ? x : ''))
    : [];
  const hasAnyValidId = mappedIds.some((x) => x.length > 0);
  const ids = hasAnyValidId ? mappedIds : levels.map((l) => l.id);
  const preRemapCount = Math.max(1, ids.length, maxRawIslandArrayLen(payload));
  const preRemapWorkshop = migrateProgress(payload, preRemapCount).workshop;
  const progress = remapProgress(payload, ids, levels);
  if (repairedFromTruncated && !hasAnyProgress(progress)) return null;
  const rawWorkshop =
    workshopStarsSpent(preRemapWorkshop) > workshopStarsSpent(progress.workshop)
      ? preRemapWorkshop
      : undefined;
  return { progress, rawSelectedHero, rawWorkshop, repairedFromTruncated };
}

function mergeParsedInto2D(
  base: ProgressData,
  candidate: ParsedStored2D,
  levels: readonly Pick<LevelDef, 'id'>[],
): ProgressData {
  let incoming = candidate.progress;
  if (
    candidate.rawSelectedHero &&
    incoming.heroes &&
    candidate.rawSelectedHero !== incoming.heroes.selectedHero
  ) {
    incoming = {
      ...incoming,
      heroes: { ...incoming.heroes, selectedHero: candidate.rawSelectedHero },
    };
  }
  if (candidate.rawWorkshop) {
    incoming = { ...incoming, workshop: candidate.rawWorkshop };
  }
  const merged = mergeProgress(base, incoming, levels.length);
  merged.heroes = migrateHeroSave(merged.heroes, merged, levels);
  return merged;
}

function serializeStored2D(
  progress: ProgressData,
  levels: readonly Pick<LevelDef, 'id'>[],
): string {
  progress.version = PROGRESS_SAVE_VERSION;
  progress.heroes = migrateHeroSave(progress.heroes, progress, levels);
  const data: Stored2D = { ids: levels.map((l) => l.id), progress };
  return JSON.stringify(data);
}

function loadLocalProgress2DInternal(levels: readonly LevelDef[]): ProgressData {
  const ls = storage();
  const makeFresh = (): ProgressData => {
    const fresh = createDefaultProgress(levels.length);
    fresh.heroes = createDefaultHeroSave();
    return fresh;
  };
  try {
    const raw = ls?.getItem(PROGRESS_2D_KEY);
    if (!raw) return makeFresh();
    const primary = parseStored2DRaw(raw, levels);
    if (primary && !primary.repairedFromTruncated) {
      return primary.progress;
    }
    // Primary slot was corrupted or truncated: preserve forensics once and fold in mirrored cloud slot if present.
    try {
      if (ls && ls.getItem(PROGRESS_2D_CORRUPT_BACKUP_KEY) === null) {
        ls.setItem(PROGRESS_2D_CORRUPT_BACKUP_KEY, raw);
      }
    } catch {
      // ignore storage errors
    }
    let recovered = primary ? primary.progress : makeFresh();
    let anyRecovered = Boolean(primary && hasAnyProgress(primary.progress));
    const mirrorRaw = ls?.getItem(LOCAL_CLOUD_2D_MIRROR_KEY) ?? null;
    if (mirrorRaw) {
      const mirror = parseStored2DRaw(mirrorRaw, levels);
      if (mirror && hasAnyProgress(mirror.progress)) {
        recovered = anyRecovered ? mergeParsedInto2D(recovered, mirror, levels) : mirror.progress;
        anyRecovered = true;
      }
    }
    return anyRecovered ? recovered : makeFresh();
  } catch {
    return makeFresh();
  }
}

/** The 2D save, migrated to the current island list (with truncated-JSON & cloud-mirror recovery). Never throws. */
export function loadProgress2D(levels: readonly LevelDef[] = LEVELS_2D): ProgressData {
  const result = loadLocalProgress2DInternal(levels);
  const platform = getPlatform();
  if (platform.isSteam && !isMockLevelRoster(levels) && !autoHydrated2DAdapters.has(platform)) {
    autoHydrated2DAdapters.add(platform);
    void hydrateProgress2DFromCloud(undefined, levels, platform);
  }
  return result;
}

/**
 * Multi-source recovery for 2D saves: inspects `PROGRESS_2D_KEY` (valid or truncated-JSON repaired),
 * mirrored `progress2d` cloud slot, `PROGRESS_2D_IMPORT_BACKUP_KEY`, and optionally
 * `PROGRESS_2D_RESET_BACKUP_KEY`, merging all valid candidates monotonically.
 */
export function recoverProgress2D(
  levels: readonly LevelDef[] = LEVELS_2D,
  options?: { readonly includeResetBackup?: boolean; readonly persist?: boolean },
): RecoverProgressResult {
  const ls = storage();
  let merged = createDefaultProgress(levels.length);
  merged.heroes = createDefaultHeroSave();
  const sources: string[] = [];

  const readKey = (key: string): string | null => {
    try {
      return ls?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };

  const candidates: readonly (readonly [string, string | null])[] = [
    ['primary', readKey(PROGRESS_2D_KEY)],
    ['cloud', readKey(LOCAL_CLOUD_2D_MIRROR_KEY)],
    ['importBackup', readKey(PROGRESS_2D_IMPORT_BACKUP_KEY)],
    ['corruptBackup', readKey(PROGRESS_2D_CORRUPT_BACKUP_KEY)],
    ...(options?.includeResetBackup
      ? ([['resetBackup', readKey(PROGRESS_2D_RESET_BACKUP_KEY)]] as const)
      : []),
  ];

  for (let i = 0; i < candidates.length; i++) {
    const [label, raw] = candidates[i];
    if (!raw) continue;
    const parsed = parseStored2DRaw(raw, levels);
    if (!parsed || !hasAnyProgress(parsed.progress)) continue;
    merged = mergeParsedInto2D(merged, parsed, levels);
    sources.push(label);
  }

  const recovered = sources.length > 0 && hasAnyProgress(merged);
  if (recovered && options?.persist !== false) {
    saveProgress2D(merged, levels);
  }
  return { progress: merged, recovered, sources };
}

/** Persists `progress` to `localStorage` (`PROGRESS_2D_KEY`) only, without Steam Cloud/achievement IPC. */
export function saveLocalProgress2D(
  progress: ProgressData,
  levels: readonly LevelDef[] = LEVELS_2D,
): string {
  const raw = serializeStored2D(progress, levels);
  const ls = storage();
  try {
    ls?.setItem(PROGRESS_2D_KEY, raw);
  } catch {
    // quota / private mode: progress just is not kept
  }
  return raw;
}

export function saveProgress2D(progress: ProgressData, levels: readonly LevelDef[] = LEVELS_2D): void {
  const raw = saveLocalProgress2D(progress, levels);
  const platform = getPlatform();
  if (platform.isSteam && !isMockLevelRoster(levels)) {
    if (readingCloud2DAdapters.has(platform)) {
      // An in-flight hydrateProgress2DFromCloud is currently awaiting cloudSave.read(progress2d);
      // it will fold in this fresh localStorage write via diskRawAfter, merge monotonically with
      // the remote cloud save, write the union to Steam Cloud, and sync achievements.
      return;
    }
    if (!completedHydrated2DAdapters.has(platform)) {
      // Never overwrite an un-fetched remote Steam Cloud save with a first local write on a new device.
      autoHydrated2DAdapters.add(platform);
      void hydrateProgress2DFromCloud(progress, levels, platform);
      return;
    }
    void platform.cloudSave.write(CLOUD_PROGRESS_2D_SLOT, raw);
    void syncAchievementsFromProgress(progress, platform, levels);
  }
}

function readLocalProgress2DRaw(): string | null {
  try {
    return storage()?.getItem(PROGRESS_2D_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * Pulls the 2D progress blob (`progress2d`) from `adapter.cloudSave`, remaps island IDs, merges
 * monotonically with `localProgress` (including persistent hero XP, skill trees, and unlocked
 * `selectedHero`), persists when either side gained records, and unlocks earned Steam achievements.
 */
export async function hydrateProgress2DFromCloud(
  localProgress?: ProgressData,
  levels: readonly LevelDef[] = LEVELS_2D,
  adapter: PlatformAdapter = getPlatform(),
): Promise<CloudHydrateResult> {
  const genAtStart = resetGen2D;
  const isMock = isMockLevelRoster(levels);
  if (!isMock) {
    autoHydrated2DAdapters.add(adapter);
  }
  const baseLocal = localProgress ?? loadLocalProgress2DInternal(levels);
  let normalizedLocal = remapProgress(
    baseLocal,
    levels.map((l) => l.id),
    levels,
  );
  if (isMock) {
    return { merged: normalizedLocal, updated: false, unlockedAchievements: [] };
  }

  const callerRaw = serializeStored2D(normalizedLocal, levels);
  const diskRawBefore = readLocalProgress2DRaw();
  let cloudRaw: string | null;
  let readFailed = false;
  readingCloud2DAdapters.add(adapter);
  try {
    cloudRaw = await adapter.cloudSave.read(CLOUD_PROGRESS_2D_SLOT);
  } catch {
    cloudRaw = null;
    readFailed = true;
  } finally {
    readingCloud2DAdapters.delete(adapter);
  }
  if (resetGen2D !== genAtStart) {
    return { merged: loadLocalProgress2DInternal(levels), updated: false, unlockedAchievements: [] };
  }
  const safeCloudWrite2D = async (json: string): Promise<void> => {
    try {
      await adapter.cloudSave.write(CLOUD_PROGRESS_2D_SLOT, json);
    } catch {
      // Never let a transient Steam Cloud write error abort local hydration or achievement sync.
    }
  };
  const diskRawAfter = readLocalProgress2DRaw();
  const concurrentHappened = diskRawAfter !== null && diskRawAfter !== diskRawBefore;
  if (concurrentHappened) {
    const concurrent = parseStored2DRaw(diskRawAfter, levels);
    if (concurrent) {
      normalizedLocal = mergeParsedInto2D(normalizedLocal, concurrent, levels);
    }
  }

  const localRaw = serializeStored2D(normalizedLocal, levels);
  let merged = normalizedLocal;
  let updated = false;

  if (cloudRaw) {
    const parsedCloud = parseStored2DRaw(cloudRaw, levels);
    if (parsedCloud) {
      merged = mergeParsedInto2D(normalizedLocal, parsedCloud, levels);
      const mergedRaw = serializeStored2D(merged, levels);
      if (mergedRaw !== localRaw) {
        saveLocalProgress2D(merged, levels);
      }
      if (!readFailed) completedHydrated2DAdapters.add(adapter);
      if (parsedCloud.repairedFromTruncated || mergedRaw !== cloudRaw) {
        if (resetGen2D === genAtStart) await safeCloudWrite2D(mergedRaw);
      }
    } else {
      if (!readFailed) completedHydrated2DAdapters.add(adapter);
      if (hasAnyProgress(normalizedLocal) && resetGen2D === genAtStart) {
        await safeCloudWrite2D(localRaw);
      }
    }
  } else {
    if (!readFailed) completedHydrated2DAdapters.add(adapter);
    if (!readFailed && adapter.isSteam && hasAnyProgress(normalizedLocal) && resetGen2D === genAtStart) {
      await safeCloudWrite2D(localRaw);
    }
  }
  if (resetGen2D !== genAtStart) {
    return { merged: loadLocalProgress2DInternal(levels), updated: false, unlockedAchievements: [] };
  }

  const finalMergedRaw = serializeStored2D(merged, levels);
  if (finalMergedRaw !== callerRaw) {
    updated = true;
  }
  if (concurrentHappened && finalMergedRaw !== diskRawAfter && hasAnyProgress(merged)) {
    saveLocalProgress2D(merged, levels);
  }

  const unlockedAchievements = await syncAchievementsFromProgress(merged, adapter, levels);
  return { merged, updated, unlockedAchievements };
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
  /** Best stars awarded per difficulty (0 = not won there; legacy wins read as Normal). */
  readonly diffStars: Readonly<Record<DifficultyId, number>>;
  /** Won on Hard at least once (the Hard ribbon on its medallion). */
  readonly hardWon: boolean;
}

export function islandStates(progress: ProgressData, levels: readonly LevelDef[] = LEVELS_2D): IslandState[] {
  if (levels.length === 0) return [];
  const frontier = Math.max(0, Math.min(levels.length - 1, progress.unlockedLevelIndex));
  const dw = difficultyWinsOf(progress);
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
    diffStars: { easy: dw.easy[i] ?? 0, normal: dw.normal[i] ?? 0, hard: dw.hard[i] ?? 0 },
    hardWon: (dw.hard[i] ?? 0) > 0,
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
  difficulty: DifficultyId = 'normal',
): WinRecord | null {
  const i = indexOf2D(levelId, levels);
  if (i < 0) return null;
  const p = loadProgress2D(levels);
  const diff: DifficultyId = isDifficultyId(difficulty) ? difficulty : 'normal';
  const earnedStars = (Number.isFinite(stars) ? Math.max(1, Math.min(3, Math.round(stars))) : 1) as 1 | 2 | 3;
  const awarded = starsAwarded(earnedStars, diff);
  const safeLives = Number.isFinite(livesLeft) ? Math.max(0, Math.floor(livesLeft)) : 0;
  const badges = DIFFICULTIES[diff].allowsChallenges ? badgesForWin(challengesForLevel(levels[i]), challenges) : [];
  // Read (and for a legacy save, derive) the record before applyWin moves bestStars.
  const dw = difficultyWinsOf(p);
  const prevBestLives = p.bestLives[i] ?? 0;
  let rec = applyWin(p, i, levels.length, awarded, safeLives, badges);
  if (diff === 'easy') {
    p.bestLives[i] = prevBestLives;
    rec = { ...rec, newBestLives: false };
  }
  dw[diff][i] = Math.max(dw[diff][i] ?? 0, awarded);
  p.difficultyWins = dw;
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
  const safeNowMs = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  const res = applyDailyWin(p.daily, day, utcDayNumber(safeNowMs));
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
  /** Hero fielded in this run (awards persistent hero XP on wins, losses, and endless runs). */
  readonly heroId?: HeroId | null;
  readonly enemiesKilled?: number;
  readonly wavesCleared?: number;
  /** Exact in-run hero XP tracked by `SimWorld.heroSystem.runXp` (falls back to `xpForRun`). */
  readonly heroXpEarned?: number;
}

/** What a win did on its difficulty (end panel wording). */
export interface DifficultyResult2D {
  readonly id: DifficultyId;
  /** Stars the run earned by its play, before the difficulty cap. */
  readonly earnedStars: number;
  /** Stars actually awarded (Easy: at most 1). */
  readonly awardedStars: number;
  /** First win of this island on this difficulty. */
  readonly firstWin: boolean;
}

export interface RunResultRecord2D {
  readonly win: WinRecord | null;
  /** Set on a recorded win: the difficulty it was played on and the stars it awarded. */
  readonly difficulty?: DifficultyResult2D;
  readonly daily: { readonly counted: boolean; readonly streak: number } | null;
  readonly endless: EndlessRecord2D | null;
  readonly hero?: HeroRunXpRecord;
}

function recordHeroOutcome(
  progress: ProgressData,
  outcome: RunOutcome2D,
  levels: readonly LevelDef[],
): HeroRunXpRecord | undefined {
  if (!outcome.heroId || !isHeroId(outcome.heroId)) return undefined;
  const xp =
    typeof outcome.heroXpEarned === 'number' && Number.isFinite(outcome.heroXpEarned)
      ? Math.max(0, Math.floor(outcome.heroXpEarned))
      : xpForRun(outcome);
  const applied = applyHeroXp(progress, outcome.heroId, xp, levels);
  progress.heroes = applied.progress.heroes;
  return applied.record;
}

/**
 * Pure outcome recorder matching `GameSession` in the 3D build:
 * - Endless run: records `bestEndlessWaves` once past story waves; never awards campaign stars.
 * - Campaign / Challenge / Daily win: applies `applyWin` (with island challenge badges) and, when
 *   `runConfig.daily !== null`, `applyDailyWin`.
 * - Non-endless loss: mutates no island progress.
 * - When `outcome.heroId` is set: awards persistent hero XP across all outcomes.
 */
export function applyRunResult2D(
  progress: ProgressData,
  outcome: RunOutcome2D,
  levels: readonly LevelDef[] = LEVELS_2D,
): RunResultRecord2D {
  const cfg = outcome.runConfig ?? PLAIN_RUN;
  const i = indexOf2D(outcome.levelId, levels);

  if (cfg.endless) {
    let endless: EndlessRecord2D | null = null;
    if (i >= 0) {
      const wave = Number.isFinite(outcome.waveReached) ? Math.floor(outcome.waveReached) : 0;
      if (wave <= levels[i].waves.length) {
        const best = progress.bestEndlessWaves[i] ?? 0;
        endless = { best, previousBest: best, isNewBest: false, reachedEndless: false };
      } else {
        const rec = applyEndlessRecord(progress, i, wave);
        endless = { ...rec, reachedEndless: true };
      }
    }
    const hero = recordHeroOutcome(progress, outcome, levels);
    return hero ? { win: null, daily: null, endless, hero } : { win: null, daily: null, endless };
  }

  if (!outcome.won) {
    const hero = recordHeroOutcome(progress, outcome, levels);
    return hero ? { win: null, daily: null, endless: null, hero } : { win: null, daily: null, endless: null };
  }

  const earned = (
    Number.isFinite(outcome.stars) ? Math.max(1, Math.min(3, Math.round(outcome.stars))) : 1
  ) as 1 | 2 | 3;
  // Daily / Endless are always Normal (modes2d.ts never sets a difficulty on them).
  const diff: DifficultyId = cfg.daily === null && isDifficultyId(cfg.difficulty) ? cfg.difficulty : 'normal';
  const stars = starsAwarded(earned, diff);
  const safeLives = Number.isFinite(outcome.livesRemaining)
    ? Math.max(0, Math.floor(outcome.livesRemaining))
    : 0;
  let win: WinRecord | null = null;
  let difficulty: DifficultyResult2D | undefined;
  if (i >= 0) {
    // Read (and for a legacy save, derive) the record before applyWin moves bestStars.
    const dw = difficultyWinsOf(progress);
    const before = dw[diff][i] ?? 0;
    const allows = DIFFICULTIES[diff].allowsChallenges;
    const badges = allows ? badgesForWin(challengesForLevel(levels[i]), cfg.challenges) : [];
    const prevBestLives = progress.bestLives[i] ?? 0;
    win = applyWin(progress, i, levels.length, stars, safeLives, badges);
    if (diff === 'easy') {
      // Easy's bonus lives would inflate the island's "best lives left" record: Easy keeps it.
      progress.bestLives[i] = prevBestLives;
      win = { ...win, newBestLives: false };
    }
    dw[diff][i] = Math.max(before, stars);
    progress.difficultyWins = dw;
    difficulty = { id: diff, earnedStars: earned, awardedStars: stars, firstWin: before === 0 };
  }
  const nowMs =
    typeof outcome.nowMs === 'number' && Number.isFinite(outcome.nowMs) ? outcome.nowMs : Date.now();
  const daily =
    cfg.daily !== null && Number.isFinite(cfg.daily)
      ? applyDailyWin(progress.daily, cfg.daily, utcDayNumber(nowMs))
      : null;
  const hero = recordHeroOutcome(progress, outcome, levels);
  const base = difficulty ? { win, difficulty, daily, endless: null } : { win, daily, endless: null };
  return hero ? { ...base, hero } : base;
}

/** Loads the 2D save, applies `applyRunResult2D`, persists if anything changed, and returns the record. */
export function recordRunResult2D(
  outcome: RunOutcome2D,
  levels: readonly LevelDef[] = LEVELS_2D,
): RunResultRecord2D {
  const p = loadProgress2D(levels);
  const prevDailyLast = p.daily.lastDay;
  const prevDailyStreak = p.daily.streak;
  const prevSelectedHero = p.heroes?.selectedHero;
  const res = applyRunResult2D(p, outcome, levels);
  const dailyChanged =
    Boolean(res.daily?.counted) || p.daily.lastDay !== prevDailyLast || p.daily.streak !== prevDailyStreak;
  const endlessChanged = Boolean(res.endless?.reachedEndless && res.endless.best !== res.endless.previousBest);
  const heroChanged = Boolean(
    res.hero && (res.hero.xpGained > 0 || p.heroes?.selectedHero !== prevSelectedHero),
  );
  if (res.win !== null || dailyChanged || endlessChanged || heroChanged) {
    saveProgress2D(p, levels);
  }
  return res;
}

/** Selects `heroId` in the 2D save if unlocked and persists; returns updated `ProgressData` or `null`. */
export function selectHero2D(heroId: HeroId, levels: readonly LevelDef[] = LEVELS_2D): ProgressData | null {
  const p = loadProgress2D(levels);
  const next = selectHero(p, heroId, levels);
  if (!next) return null;
  saveProgress2D(next, levels);
  return next;
}

/** Unlocks `nodeId` on `heroId` in the 2D save and persists; returns updated `ProgressData` or `null`. */
export function unlockHeroNode2D(
  heroId: HeroId,
  nodeId: string,
  levels: readonly LevelDef[] = LEVELS_2D,
): ProgressData | null {
  const p = loadProgress2D(levels);
  const next = applyNode(p, heroId, nodeId, levels);
  if (!next) return null;
  saveProgress2D(next, levels);
  return next;
}

/** Free world-map skill-tree respec for `heroId`; persists and returns updated `ProgressData`. */
export function respecHero2D(heroId: HeroId, levels: readonly LevelDef[] = LEVELS_2D): ProgressData {
  const p = loadProgress2D(levels);
  const next = respec(p, heroId, levels);
  saveProgress2D(next, levels);
  return next;
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

/** Encodes a 2D `ProgressData` (including island ID ordering and hero roster) into a `SKY2-...` code. */
export function encodeSaveCode2D(
  progress: ProgressData,
  levels: readonly Pick<LevelDef, 'id'>[] = LEVELS_2D,
): string {
  const clean: ProgressData = {
    ...progress,
    heroes: migrateHeroSave(progress.heroes, progress, levels),
  };
  return encodeSaveCode(
    clean,
    levels.map((l) => l.id),
  );
}

/** Decodes a `SKY2-...` save code onto `levels`, remapping by island ID when carried in the code. */
export function decodeSaveCode2D(
  code: string,
  levels: readonly Pick<LevelDef, 'id'>[] = LEVELS_2D,
): SaveCodeResult {
  const head = decodeSaveCode(code, Math.max(levels.length, 64));
  if (!head.ok) return head;
  if (head.levelIds && head.levelIds.length > 0) {
    const sized = decodeSaveCode(code, Math.max(head.levelIds.length, levels.length, 64));
    if (!sized.ok) return sized;
    return {
      ok: true,
      progress: remapProgress(sized.progress, head.levelIds, levels),
      levelIds: head.levelIds,
    };
  }
  const direct = decodeSaveCode(code, levels.length);
  if (!direct.ok) return direct;
  direct.progress.heroes = migrateHeroSave(direct.progress.heroes, direct.progress, levels);
  return direct;
}

/** Exports the persisted 2D save as a copy-paste `SKY2-...` save code. */
export function exportSaveCode2D(levels: readonly LevelDef[] = LEVELS_2D): string {
  return encodeSaveCode2D(loadProgress2D(levels), levels);
}

export type ImportSaveCode2DResult =
  | {
      readonly ok: true;
      readonly progress: ProgressData;
      readonly previous: ProgressData;
      readonly summary: string;
    }
  | { readonly ok: false; readonly error: string };

/** Merges a `SKY2-...` save code into the 2D save (backing up the pre-import save first). */
export function importSaveCode2D(
  code: string,
  levels: readonly LevelDef[] = LEVELS_2D,
): ImportSaveCode2DResult {
  const res = decodeSaveCode2D(code, levels);
  if (!res.ok) return res;
  let incoming = res.progress;
  const hints = inspectSaveCodeHints(code);
  if (res.levelIds && res.levelIds.length > 0) {
    // Preserve pre-remap selectedHero and source-affordable Workshop candidates so mergeProgress
    // evaluates unlock milestones and star affordability against combined (local + imported) progress.
    const rawSized = decodeSaveCode(code, Math.max(res.levelIds.length, levels.length, 64));
    if (rawSized.ok) {
      const rawSelected = hints.rawSelectedHero ?? rawSized.progress.heroes?.selectedHero;
      const rawWorkshop = rawSized.progress.workshop;
      if (incoming.heroes && rawSelected && rawSelected !== incoming.heroes.selectedHero) {
        incoming = { ...incoming, heroes: { ...incoming.heroes, selectedHero: rawSelected } };
      }
      if (workshopStarsSpent(rawWorkshop) > workshopStarsSpent(incoming.workshop)) {
        incoming = { ...incoming, workshop: rawWorkshop };
      }
    }
  } else if (hints.rawSelectedHero && incoming.heroes && hints.rawSelectedHero !== incoming.heroes.selectedHero) {
    incoming = { ...incoming, heroes: { ...incoming.heroes, selectedHero: hints.rawSelectedHero } };
  }
  const ls = storage();
  const current = loadProgress2D(levels);
  const merged = mergeProgress(current, incoming, levels.length);
  merged.heroes = migrateHeroSave(merged.heroes, merged, levels);
  const summary = describeMergeGain(current, merged);
  try {
    const raw = ls?.getItem(PROGRESS_2D_KEY);
    if (raw && (hasAnyProgress(current) || ls?.getItem(PROGRESS_2D_IMPORT_BACKUP_KEY) === null)) {
      ls?.setItem(PROGRESS_2D_IMPORT_BACKUP_KEY, raw);
    }
  } catch {
    // ignore storage errors
  }
  saveProgress2D(merged, levels);
  return { ok: true, progress: merged, previous: current, summary };
}

/**
 * Erases the 2D isles save and the story flags (Settings → reset), backing up non-empty 2D
 * progress to `PROGRESS_2D_RESET_BACKUP_KEY` first. Never overwrites a real backup with an empty save.
 * The 3D campaign save is untouched.
 */
export function resetProgress2D(levels: readonly LevelDef[] = LEVELS_2D): void {
  resetGen2D++;
  const ls = storage();
  try {
    const raw = ls?.getItem(PROGRESS_2D_KEY);
    if (raw && hasAnyProgress(loadLocalProgress2DInternal(levels))) {
      ls?.setItem(PROGRESS_2D_RESET_BACKUP_KEY, raw);
    }
    ls?.removeItem(PROGRESS_2D_KEY);
    ls?.removeItem(LOCAL_CLOUD_2D_MIRROR_KEY);
    ls?.removeItem(STORY_SEEN_KEY);
  } catch {
    // ignore
  }
  const platform = getPlatform();
  if (platform.isSteam && !isMockLevelRoster(levels)) {
    autoHydrated2DAdapters.add(platform);
    completedHydrated2DAdapters.add(platform);
    const fresh = createDefaultProgress(levels.length);
    fresh.heroes = createDefaultHeroSave();
    void platform.cloudSave.write(CLOUD_PROGRESS_2D_SLOT, serializeStored2D(fresh, levels));
  }
}
