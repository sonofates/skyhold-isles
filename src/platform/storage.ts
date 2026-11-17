import type { GameSettings, ProgressData, QualityLevel } from '../core/types.ts';
import { createDailyRecord, sanitizeDailyRecord } from '../data/daily.ts';
import { sanitizeRanks } from '../data/workshop.ts';
import { starWallet } from '../game/progression.ts';

const SETTINGS_KEY = 'skyhold_isles_settings_v1';
const PROGRESS_KEY = 'skyhold_isles_progress_v1';
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
    quality: isTouchDevice() ? 'low' : 'high',
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
  return {
    version: PROGRESS_SAVE_VERSION,
    unlockedLevelIndex: 0,
    bestStars: new Array<number>(levelCount).fill(0),
    bestEndlessWaves: new Array<number>(levelCount).fill(0),
    bestLives: new Array<number>(levelCount).fill(0),
    clears: new Array<number>(levelCount).fill(0),
    workshop: {},
    challengeClears: Array.from({ length: levelCount }, () => []),
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
  return val === 'high' || val === 'low' ? val : fallback;
}

export function loadSettings(): GameSettings {
  const defaults = getDefaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      masterVolume:
        typeof parsed.masterVolume === 'number'
          ? Math.max(0, Math.min(1, parsed.masterVolume))
          : defaults.masterVolume,
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : defaults.muted,
      cameraShake:
        typeof parsed.cameraShake === 'boolean' ? parsed.cameraShake : defaults.cameraShake,
      damageNumbers:
        typeof parsed.damageNumbers === 'boolean'
          ? parsed.damageNumbers
          : defaults.damageNumbers,
      quality: parseQuality(parsed.quality, defaults.quality),
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
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
  if (!parsed || typeof parsed !== 'object') return createDefaultProgress(levelCount);
  const raw = parsed as Record<string, unknown>;
  const bestStars = parseIslandInts(raw.bestStars, levelCount, 3);
  const bestEndlessWaves = parseIslandInts(raw.bestEndlessWaves, levelCount);
  const bestLives = parseIslandInts(raw.bestLives, levelCount);
  const clears = parseIslandInts(raw.clears, levelCount);
  // v1 saves never counted clears: an island with stars was won at least once.
  for (let i = 0; i < levelCount; i++) {
    if (bestStars[i] > 0 && clears[i] === 0) clears[i] = 1;
  }
  const storedIndex = raw.unlockedLevelIndex;
  const unlockedLevelIndex =
    typeof storedIndex === 'number' && Number.isFinite(storedIndex)
      ? Math.max(0, Math.min(levelCount - 1, Math.floor(storedIndex)))
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
    challengeClears: parseIslandIdLists(raw.challengeClears, levelCount),
    daily: sanitizeDailyRecord(raw.daily),
  };
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
  try {
    progress.version = PROGRESS_SAVE_VERSION;
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Ignore storage quota / private mode failures
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

/** True when a save holds anything worth backing up. */
export function hasAnyProgress(p: ProgressData): boolean {
  return (
    p.unlockedLevelIndex > 0 ||
    p.bestStars.some((v) => v > 0) ||
    p.clears.some((v) => v > 0) ||
    p.bestEndlessWaves.some((v) => v > 0) ||
    p.challengeClears.some((l) => l.length > 0) ||
    p.daily.total > 0 ||
    Object.keys(p.workshop).length > 0
  );
}
