import type { GameSettings, ProgressData, QualityLevel } from '../core/types.ts';
import { createDailyRecord, sanitizeDailyRecord } from '../data/daily.ts';
import { hasHeroSaveProgress, sanitizeHeroSaveData } from '../data/heroes.ts';
import { sanitizeRanks } from '../data/workshop.ts';
import { starWallet } from '../game/progression.ts';
import { syncAchievementsFromProgress } from './achievements.ts';
import { getPlatform } from './platform.ts';

const SETTINGS_KEY = 'skyhold_isles_settings_v1';
const PROGRESS_KEY = 'skyhold_isles_progress_v1';
export const CLOUD_PROGRESS_SLOT = 'progress';
const FLYER_TOAST_SEEN_KEY = 'skyhold_isles_flyer_toast_seen_v1';
const UPGRADE_TOAST_SEEN_KEY = 'skyhold_isles_upgrade_toast_seen_v1';
const ENEMY_INTROS_SEEN_KEY = 'skyhold_isles_enemy_intros_seen_v1';

let enemyIntrosSeen: Set<string> | null = null;

function loadEnemyIntrosSeen(): Set<string> {
  if (enemyIntrosSeen) return enemyIntrosSeen;
  enemyIntrosSeen = new Set<string>();
  try {
    const raw = localStorage.getItem(ENEMY_INTROS_SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      for (const v of parsed) if (typeof v === 'string') enemyIntrosSeen.add(v);
    }
  } catch {
    // ignore storage / parse errors
  }
  return enemyIntrosSeen;
}

/** First-encounter "new foe" hint per enemy type (cached in memory; persisted in localStorage). */
export function hasSeenEnemyIntro(type: string): boolean {
  return loadEnemyIntrosSeen().has(type);
}

export function markEnemyIntroSeen(type: string): void {
  const seen = loadEnemyIntrosSeen();
  if (seen.has(type)) return;
  seen.add(type);
  try {
    localStorage.setItem(ENEMY_INTROS_SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // ignore storage errors
  }
}

export function hasSeenUpgradeToast(): boolean {
  try {
    return localStorage.getItem(UPGRADE_TOAST_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markUpgradeToastSeen(): void {
  try {
    localStorage.setItem(UPGRADE_TOAST_SEEN_KEY, '1');
  } catch {
    // ignore storage errors
  }
}

export function hasSeenFlyerToast(): boolean {
  try {
    return localStorage.getItem(FLYER_TOAST_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markFlyerToastSeen(): void {
  try {
    localStorage.setItem(FLYER_TOAST_SEEN_KEY, '1');
  } catch {
    // Ignore storage quota / private mode failures
  }
}

export function isTouchDevice(): boolean {
  if (getPlatform().isMobile) return true;
  if (typeof window === 'undefined') return false;
  const hasTouchPoints = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  const hasTouchEvent = 'ontouchstart' in window;
  const coarsePointer =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return hasTouchPoints || hasTouchEvent || coarsePointer;
}

export function getDefaultSettings(): GameSettings {
  return {
    masterVolume: 0.65,
    muted: false,
    cameraShake: true,
    damageNumbers: true,
    // Everyone starts in Auto: the frame-time governor begins at High on desktop / Medium on touch
    // and steps down only when frames are actually slow.
    quality: 'auto',
    haptics: true,
  };
}

export const DEFAULT_SETTINGS: GameSettings = getDefaultSettings();

/**
 * Current progress save format. v1 = unlock/stars/endless only; v2 adds bestLives, clears,
 * Workshop ranks and challenge clears.
 */
export const PROGRESS_SAVE_VERSION = 2;
/** One-time copy of a pre-migration save, written before the first save in a newer format. */
const PROGRESS_BACKUP_KEY = 'skyhold_isles_progress_backup_v1';

export function createDefaultProgress(levelCount: number): ProgressData {
  const count = Number.isFinite(levelCount) ? Math.max(0, Math.floor(levelCount)) : 0;
  return {
    version: PROGRESS_SAVE_VERSION,
    unlockedLevelIndex: 0,
    bestStars: new Array<number>(count).fill(0),
    bestEndlessWaves: new Array<number>(count).fill(0),
    bestLives: new Array<number>(count).fill(0),
    clears: new Array<number>(count).fill(0),
    workshop: {},
    challengeClears: Array.from({ length: count }, () => []),
    daily: createDailyRecord(),
  };
}

/** Per-island list of unique short id strings (junk → empty list). */
function parseIslandIdLists(val: unknown, levelCount: number): string[][] {
  const out: string[][] = Array.from({ length: levelCount }, () => []);
  if (!Array.isArray(val)) return out;
  for (let i = 0; i < levelCount; i++) {
    const list: unknown = val[i];
    if (!Array.isArray(list)) continue;
    for (const id of list) {
      if (typeof id === 'string' && id.length > 0 && id.length <= 40 && !out[i].includes(id)) {
        out[i].push(id);
      }
    }
  }
  return out;
}

/** Per-island non-negative integer array of exactly `levelCount` entries (junk → 0). */
function parseIslandInts(val: unknown, levelCount: number, max = Number.MAX_SAFE_INTEGER): number[] {
  const out = new Array<number>(levelCount).fill(0);
  if (!Array.isArray(val)) return out;
  for (let i = 0; i < levelCount; i++) {
    const v: unknown = val[i];
    if (typeof v === 'number' && Number.isFinite(v)) out[i] = Math.max(0, Math.min(max, Math.floor(v)));
  }
  return out;
}

function parseQuality(val: unknown, fallback: QualityLevel): QualityLevel {
  return val === 'auto' || val === 'high' || val === 'medium' || val === 'low' ? val : fallback;
}

/** Bump when the stored settings shape changes; see loadSettings for the migration notes. */
const SETTINGS_VERSION = 3;

export function loadSettings(): GameSettings {
  const defaults = getDefaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const rawParsed: unknown = JSON.parse(raw);
    if (!rawParsed || typeof rawParsed !== 'object' || Array.isArray(rawParsed)) return defaults;
    const parsed = rawParsed as Partial<GameSettings> & { v?: number };
    let quality = parseQuality(parsed.quality, defaults.quality);
    // v1 (pre-Auto) defaulted touch devices to 'low', so a stored 'low' on a touch device is
    // almost always that old default rather than a choice: move it to Auto. Explicit choices
    // made on desktop (or any v2 save) are kept as they are.
    if (parsed.v === undefined && quality === 'low' && isTouchDevice()) quality = 'auto';
    // Before v3, desktop defaulted to a fixed 'high' (no governor), which stutters on weaker GPUs.
    // A stored desktop 'high' from v1/v2 is that old default, not a choice: move it to Auto.
    if ((parsed.v === undefined || parsed.v < 3) && quality === 'high' && !isTouchDevice()) quality = 'auto';
    return {
      masterVolume:
        typeof parsed.masterVolume === 'number' && Number.isFinite(parsed.masterVolume)
          ? Math.max(0, Math.min(1, parsed.masterVolume))
          : defaults.masterVolume,
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : defaults.muted,
      cameraShake:
        typeof parsed.cameraShake === 'boolean' ? parsed.cameraShake : defaults.cameraShake,
      damageNumbers:
        typeof parsed.damageNumbers === 'boolean'
          ? parsed.damageNumbers
          : defaults.damageNumbers,
      quality,
      haptics: typeof parsed.haptics === 'boolean' ? parsed.haptics : defaults.haptics,
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, v: SETTINGS_VERSION }));
  } catch {
    // Ignore storage quota / private mode failures
  }
}

/**
 * Pure migration of any stored progress object (v1 or v2, possibly from a build with a different
 * island count) to the current format. Never drops earned progress: stars, unlocks and records
 * are kept, unknown junk becomes 0.
 */
export function migrateProgress(parsed: unknown, levelCount: number): ProgressData {
  const count = Number.isFinite(levelCount) ? Math.max(0, Math.floor(levelCount)) : 0;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return createDefaultProgress(count);
  }
  const raw = parsed as Record<string, unknown>;
  const bestStars = parseIslandInts(raw.bestStars, count, 3);
  const bestEndlessWaves = parseIslandInts(raw.bestEndlessWaves, count);
  const bestLives = parseIslandInts(raw.bestLives, count);
  const clears = parseIslandInts(raw.clears, count);
  // v1 saves never counted clears: an island with stars was won at least once.
  for (let i = 0; i < count; i++) {
    if (bestStars[i] > 0 && clears[i] === 0) clears[i] = 1;
  }
  const storedIndex = raw.unlockedLevelIndex;
  const maxIndex = Math.max(0, count - 1);
  const unlockedLevelIndex =
    typeof storedIndex === 'number' && Number.isFinite(storedIndex)
      ? Math.max(0, Math.min(maxIndex, Math.floor(storedIndex)))
      : 0;

  // Walk forward from the stored unlock across islands the player has already cleared. Saves
  // from a build with fewer islands never recorded an unlock past their last island (there was
  // none), so islands appended later would otherwise stay locked for players who had finished
  // the campaign. Starting from the stored index keeps corrupted saves conservative.
  // A non-finite stored index (corrupted save, e.g. 1e500 -> Infinity) starts at island 0 and is not walked.
  const storedIndexOk = typeof storedIndex === 'number' && Number.isFinite(storedIndex);
  let unlocked = storedIndexOk ? unlockedLevelIndex : 0;
  while (storedIndexOk && unlocked < bestStars.length - 1 && bestStars[unlocked] > 0) unlocked++;
  const progress: ProgressData = {
    version: PROGRESS_SAVE_VERSION,
    unlockedLevelIndex: unlocked,
    bestStars,
    bestEndlessWaves,
    bestLives,
    clears,
    workshop: sanitizeRanks(raw.workshop),
    challengeClears: parseIslandIdLists(raw.challengeClears, count),
    daily: sanitizeDailyRecord(raw.daily),
  };
  if (raw.heroes && typeof raw.heroes === 'object' && !Array.isArray(raw.heroes)) {
    let clearedCount = 0;
    for (let i = 0; i < count; i++) {
      if (clears[i] > 0 || bestStars[i] > 0) clearedCount++;
    }
    progress.heroes = sanitizeHeroSaveData(raw.heroes, clearedCount, unlocked);
  }
  // Upgrades are always refundable: if a save somehow spends more stars than it has earned
  // (edited save, retuned costs), refund everything instead of keeping an impossible state.
  if (starWallet(progress).available < 0) progress.workshop = {};
  return progress;
}

export function loadProgress(levelCount: number): ProgressData {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return createDefaultProgress(levelCount);
    const parsed: unknown = JSON.parse(raw);
    const storedVersion =
      parsed && typeof parsed === 'object' ? (parsed as { version?: unknown }).version : undefined;
    if (typeof storedVersion !== 'number' || storedVersion < PROGRESS_SAVE_VERSION) {
      // Keep the untouched pre-migration save once, so a bad migration can always be recovered.
      try {
        if (localStorage.getItem(PROGRESS_BACKUP_KEY) === null) {
          localStorage.setItem(PROGRESS_BACKUP_KEY, raw);
        }
      } catch {
        // ignore storage errors
      }
    }
    return migrateProgress(parsed, levelCount);
  } catch {
    return createDefaultProgress(levelCount);
  }
}

export function saveProgress(progress: ProgressData): void {
  progress.version = PROGRESS_SAVE_VERSION;
  const raw = JSON.stringify(progress);
  try {
    localStorage.setItem(PROGRESS_KEY, raw);
  } catch {
    // Ignore storage quota / private mode failures
  }
  const platform = getPlatform();
  if (platform.isSteam) {
    void platform.cloudSave.write(CLOUD_PROGRESS_SLOT, raw);
    void syncAchievementsFromProgress(progress, platform);
  }
}

/** Copy of the save erased by Settings → Reset progress (kept so a reset can be undone by hand). */
const PROGRESS_RESET_BACKUP_KEY = 'skyhold_isles_progress_reset_backup';

/** Erases campaign progress (settings untouched) after backing up the current save. */
export function resetProgressSave(levelCount: number): ProgressData {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    // Never let a reset of an already-empty save overwrite the backup of real progress.
    if (raw && hasAnyProgress(migrateProgress(JSON.parse(raw), levelCount))) {
      localStorage.setItem(PROGRESS_RESET_BACKUP_KEY, raw);
    }
  } catch {
    // ignore storage errors
  }
  const fresh = createDefaultProgress(levelCount);
  saveProgress(fresh);
  return fresh;
}

/** Copy of the save as it was before the last Settings → Save code → Load. */
const PROGRESS_IMPORT_BACKUP_KEY = 'skyhold_isles_progress_import_backup';

export function backupProgressBeforeImport(): void {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (raw) localStorage.setItem(PROGRESS_IMPORT_BACKUP_KEY, raw);
  } catch {
    // ignore storage errors
  }
}

/** True when a save holds anything worth backing up. */
export function hasAnyProgress(p: ProgressData): boolean {
  return (
    p.unlockedLevelIndex > 0 ||
    p.bestStars.some((v) => v > 0) ||
    p.clears.some((v) => v > 0) ||
    p.bestEndlessWaves.some((v) => v > 0) ||
    p.challengeClears.some((l) => l.length > 0) ||
    p.daily.total > 0 ||
    Object.keys(p.workshop).length > 0 ||
    hasHeroSaveProgress(p.heroes)
  );
}
