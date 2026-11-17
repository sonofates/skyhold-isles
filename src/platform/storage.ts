import type { GameSettings, ProgressData, QualityLevel } from '../core/types.ts';

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

export function createDefaultProgress(levelCount: number): ProgressData {
  return {
    unlockedLevelIndex: 0,
    bestStars: new Array<number>(levelCount).fill(0),
    bestEndlessWaves: new Array<number>(levelCount).fill(0),
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

export function loadProgress(levelCount: number): ProgressData {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return createDefaultProgress(levelCount);
    const parsed = JSON.parse(raw) as Partial<ProgressData>;
    const bestStars = new Array<number>(levelCount).fill(0);
    if (Array.isArray(parsed.bestStars)) {
      for (let i = 0; i < levelCount; i++) {
        const val = parsed.bestStars[i];
        if (typeof val === 'number' && Number.isFinite(val)) {
          bestStars[i] = Math.max(0, Math.min(3, Math.floor(val)));
        }
      }
    }
    const bestEndlessWaves = new Array<number>(levelCount).fill(0);
    if (Array.isArray(parsed.bestEndlessWaves)) {
      for (let i = 0; i < levelCount; i++) {
        const val = parsed.bestEndlessWaves[i];
        if (typeof val === 'number' && Number.isFinite(val)) {
          bestEndlessWaves[i] = Math.max(0, Math.floor(val));
        }
      }
    }
    const unlockedLevelIndex =
      typeof parsed.unlockedLevelIndex === 'number'
        ? Math.max(0, Math.min(levelCount - 1, Math.floor(parsed.unlockedLevelIndex)))
        : 0;

    // Walk forward from the stored unlock across islands the player has already cleared. Saves
    // from a build with fewer islands never recorded an unlock past their last island (there was
    // none), so islands appended later would otherwise stay locked for players who had finished
    // the campaign. Starting from the stored index keeps corrupted saves conservative.
    // A non-finite stored index (corrupted save, e.g. 1e500 -> Infinity) starts at island 0 and is not walked.
    const storedIndexOk = Number.isFinite(parsed.unlockedLevelIndex);
    let unlocked = storedIndexOk ? unlockedLevelIndex : 0;
    while (storedIndexOk && unlocked < bestStars.length - 1 && bestStars[unlocked] > 0) unlocked++;
    return { unlockedLevelIndex: unlocked, bestStars, bestEndlessWaves };
  } catch {
    return createDefaultProgress(levelCount);
  }
}

export function saveProgress(progress: ProgressData): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Ignore storage quota / private mode failures
  }
}
