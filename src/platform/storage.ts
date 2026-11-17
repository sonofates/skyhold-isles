import type { GameSettings, ProgressData, QualityLevel } from '../core/types.ts';
import type { LevelDef } from '../data/levels/types.ts';
import {
  createDefaultMetaSave,
  mergeCampaignProgress,
  migrateToMetaSave,
} from '../sim/meta/metaEngine.ts';
import type { MetaSaveData } from '../sim/meta/types.ts';

const SETTINGS_KEY = 'skyhold_isles_settings_v1';
export const PROGRESS_KEY = 'skyhold_isles_progress_v1';
export const META_PROGRESS_KEY = 'skyhold_isles_meta_v2';
const FLYER_TOAST_SEEN_KEY = 'skyhold_isles_flyer_toast_seen_v1';
const UPGRADE_TOAST_SEEN_KEY = 'skyhold_isles_upgrade_toast_seen_v1';

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

function normalizeLevelCount(levelCount: number): number {
  return typeof levelCount === 'number' && Number.isFinite(levelCount)
    ? Math.max(1, Math.floor(levelCount))
    : 1;
}

export function createDefaultProgress(levelCount: number): ProgressData {
  const safeCount = normalizeLevelCount(levelCount);
  return {
    unlockedLevelIndex: 0,
    bestStars: new Array<number>(safeCount).fill(0),
    bestEndlessWaves: new Array<number>(safeCount).fill(0),
  };
}

function parseQuality(val: unknown, fallback: QualityLevel): QualityLevel {
  return val === 'high' || val === 'low' ? val : fallback;
}

export function loadSettings(): GameSettings {
  const defaults = getDefaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const rawParsed: unknown = JSON.parse(raw);
    if (!rawParsed || typeof rawParsed !== 'object' || Array.isArray(rawParsed)) {
      return defaults;
    }
    const parsed = rawParsed as Partial<GameSettings>;
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

export function loadProgress(levelCount: number): ProgressData {
  const safeCount = normalizeLevelCount(levelCount);
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return createDefaultProgress(safeCount);
    const rawParsed: unknown = JSON.parse(raw);
    if (!rawParsed || typeof rawParsed !== 'object' || Array.isArray(rawParsed)) {
      return createDefaultProgress(safeCount);
    }
    const parsed = rawParsed as Partial<ProgressData>;
    const bestStars = new Array<number>(safeCount).fill(0);
    if (Array.isArray(parsed.bestStars)) {
      for (let i = 0; i < safeCount; i++) {
        const val = parsed.bestStars[i];
        if (typeof val === 'number' && Number.isFinite(val)) {
          bestStars[i] = Math.max(0, Math.min(3, Math.floor(val)));
        }
      }
    }
    const bestEndlessWaves = new Array<number>(safeCount).fill(0);
    if (Array.isArray(parsed.bestEndlessWaves)) {
      for (let i = 0; i < safeCount; i++) {
        const val = parsed.bestEndlessWaves[i];
        if (typeof val === 'number' && Number.isFinite(val)) {
          bestEndlessWaves[i] = Math.max(0, Math.floor(val));
        }
      }
    }
    const unlockedLevelIndex =
      typeof parsed.unlockedLevelIndex === 'number' && Number.isFinite(parsed.unlockedLevelIndex)
        ? Math.max(0, Math.min(safeCount - 1, Math.floor(parsed.unlockedLevelIndex)))
        : 0;
    return { unlockedLevelIndex, bestStars, bestEndlessWaves };
  } catch {
    return createDefaultProgress(safeCount);
  }
}

export function saveProgress(progress: ProgressData): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Ignore storage quota / private mode failures
  }
}

export function getTodayUtcDateString(now: Date = new Date()): string {
  const safeNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const y = String(safeNow.getUTCFullYear()).padStart(4, '0');
  const m = String(safeNow.getUTCMonth() + 1).padStart(2, '0');
  const d = String(safeNow.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function readJsonSafely(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Loads versioned v2 meta save, transparently migrating any existing v1 progress
 * (`skyhold_isles_progress_v1`) without ever wiping stars, unlocks, or endless records.
 */
export function loadMetaSave(levelCount: number, levels?: readonly LevelDef[]): MetaSaveData {
  try {
    const rawV2 = readJsonSafely(META_PROGRESS_KEY);
    const rawV1 = readJsonSafely(PROGRESS_KEY);
    return migrateToMetaSave(rawV2, rawV1, levelCount, levels);
  } catch {
    return createDefaultMetaSave(levelCount);
  }
}

/**
 * Persists versioned v2 meta save and mirrors campaign progress back to `skyhold_isles_progress_v1`
 * monotonically by default (or directly when `overwriteV1` is true for explicit restore).
 */
export function saveMetaSave(save: MetaSaveData, overwriteV1 = false): void {
  if (!save || typeof save !== 'object' || Array.isArray(save)) return;
  try {
    localStorage.setItem(META_PROGRESS_KEY, JSON.stringify(save));
    const hasCampaign =
      Boolean(save?.campaign) && typeof save.campaign === 'object' && !Array.isArray(save.campaign);
    const starsLen =
      hasCampaign && Array.isArray(save.campaign.bestStars) ? save.campaign.bestStars.length : 0;
    const endlessLen =
      hasCampaign && Array.isArray(save.campaign.bestEndlessWaves)
        ? save.campaign.bestEndlessWaves.length
        : 0;
    const levelCount = Math.max(1, starsLen, endlessLen);
    const campaign = hasCampaign ? save.campaign : createDefaultProgress(levelCount);
    if (overwriteV1) {
      const sanitizedV1 = mergeCampaignProgress(createDefaultProgress(levelCount), campaign, levelCount);
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(sanitizedV1));
      return;
    }
    const existingV1Raw = readJsonSafely(PROGRESS_KEY);
    const existingV1Obj =
      existingV1Raw && typeof existingV1Raw === 'object' && !Array.isArray(existingV1Raw)
        ? (existingV1Raw as Partial<ProgressData>)
        : null;
    const existingStarsLen = Array.isArray(existingV1Obj?.bestStars)
      ? existingV1Obj.bestStars.length
      : 0;
    const existingEndlessLen = Array.isArray(existingV1Obj?.bestEndlessWaves)
      ? existingV1Obj.bestEndlessWaves.length
      : 0;
    const mergeCount = Math.max(levelCount, existingStarsLen, existingEndlessLen);
    const existingV1 = loadProgress(mergeCount);
    const mergedV1 = mergeCampaignProgress(existingV1, campaign, mergeCount);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(mergedV1));
  } catch {
    // Ignore storage quota / private mode failures
  }
}
