import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEVELS } from '../../src/data/levels/index.ts';
import { recordEndlessProgress, recordWinProgress } from '../../src/platform/sessionBridge.ts';
import {
  createDefaultProgress,
  getDefaultSettings,
  hasSeenFlyerToast,
  hasSeenUpgradeToast,
  isTouchDevice,
  loadProgress,
  loadSettings,
  markFlyerToastSeen,
  markUpgradeToastSeen,
  saveProgress,
  saveSettings,
} from '../../src/platform/storage.ts';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  throwOnGet = false;
  throwOnSet = false;

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    if (this.throwOnGet) throw new Error('Storage get failed');
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.throwOnSet) throw new Error('Storage quota exceeded');
    this.store.set(key, String(value));
  }
}

describe('platform storage and progression', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads default settings, round-trips valid saves, and sanitizes corrupt or out-of-range fields', () => {
    expect(isTouchDevice()).toBe(false);
    expect(loadSettings()).toEqual(getDefaultSettings());

    const custom = {
      masterVolume: 0.42,
      muted: true,
      cameraShake: false,
      damageNumbers: false,
      quality: 'low' as const,
    };
    saveSettings(custom);
    expect(loadSettings()).toEqual(custom);

    // Out-of-range volume and invalid types are clamped/reverted per field
    storage.setItem(
      'skyhold_isles_settings_v1',
      JSON.stringify({
        masterVolume: 2.5,
        muted: 'yes',
        cameraShake: false,
        damageNumbers: 123,
        quality: 'ultra',
      }),
    );
    expect(loadSettings()).toEqual({
      masterVolume: 1,
      muted: false,
      cameraShake: false,
      damageNumbers: true,
      quality: 'high',
    });

    storage.setItem(
      'skyhold_isles_settings_v1',
      JSON.stringify({ masterVolume: -0.75, quality: 'low' }),
    );
    expect(loadSettings().masterVolume).toBe(0);
    expect(loadSettings().quality).toBe('low');

    // Corrupt JSON, JSON null, and JSON array safely return defaults; explicit 0/1 bounds & quality preserved
    storage.setItem('skyhold_isles_settings_v1', '{not valid json');
    expect(loadSettings()).toEqual(getDefaultSettings());
    storage.setItem('skyhold_isles_settings_v1', 'null');
    expect(loadSettings()).toEqual(getDefaultSettings());
    storage.setItem('skyhold_isles_settings_v1', '[]');
    expect(loadSettings()).toEqual(getDefaultSettings());
    storage.setItem(
      'skyhold_isles_settings_v1',
      JSON.stringify({ masterVolume: 0, muted: false, cameraShake: true, damageNumbers: true, quality: 'high' }),
    );
    expect(loadSettings()).toEqual({
      masterVolume: 0,
      muted: false,
      cameraShake: true,
      damageNumbers: true,
      quality: 'high',
    });
  });

  it('handles storage read/write exceptions gracefully without throwing', () => {
    storage.throwOnGet = true;
    storage.throwOnSet = true;

    expect(() => saveSettings(getDefaultSettings())).not.toThrow();
    expect(loadSettings()).toEqual(getDefaultSettings());

    expect(() => saveProgress(createDefaultProgress(LEVELS.length))).not.toThrow();
    expect(loadProgress(LEVELS.length)).toEqual(createDefaultProgress(LEVELS.length));

    expect(hasSeenFlyerToast()).toBe(false);
    expect(() => markFlyerToastSeen()).not.toThrow();
    expect(hasSeenUpgradeToast()).toBe(false);
    expect(() => markUpgradeToastSeen()).not.toThrow();
  });

  it('persists one-time toast flags cleanly', () => {
    storage.setItem('skyhold_isles_flyer_toast_seen_v1', '0');
    storage.setItem('skyhold_isles_upgrade_toast_seen_v1', 'true');
    expect(hasSeenFlyerToast()).toBe(false);
    expect(hasSeenUpgradeToast()).toBe(false);

    markFlyerToastSeen();
    expect(hasSeenFlyerToast()).toBe(true);

    markUpgradeToastSeen();
    expect(hasSeenUpgradeToast()).toBe(true);
  });

  it('migrates legacy progress saves cleanly across level count changes and sanitizes corrupted arrays', () => {
    expect(loadProgress(LEVELS.length)).toEqual(createDefaultProgress(LEVELS.length));

    // Legacy v1 progress from 4-island era without bestEndlessWaves
    storage.setItem(
      'skyhold_isles_progress_v1',
      JSON.stringify({
        unlockedLevelIndex: 3,
        bestStars: [3, 2, 1, 0],
      }),
    );

    const migratedUp = loadProgress(9);
    expect(migratedUp.unlockedLevelIndex).toBe(3);
    expect(migratedUp.bestStars).toEqual([3, 2, 1, 0, 0, 0, 0, 0, 0]);
    expect(migratedUp.bestEndlessWaves).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);

    // Shrinking levelCount clamps unlockedLevelIndex and truncates arrays cleanly
    const shrunk = loadProgress(3);
    expect(shrunk.unlockedLevelIndex).toBe(2);
    expect(shrunk.bestStars).toEqual([3, 2, 1]);
    expect(shrunk.bestEndlessWaves).toEqual([0, 0, 0]);

    // Corrupted/fractional/negative array entries are clamped & sanitized
    storage.setItem(
      'skyhold_isles_progress_v1',
      JSON.stringify({
        unlockedLevelIndex: -5,
        bestStars: [-2, 99, 2.9, 'bad', null],
        bestEndlessWaves: [-1, 14.8, 'x', null, 5],
      }),
    );
    const sanitized = loadProgress(5);
    expect(sanitized.unlockedLevelIndex).toBe(0);
    expect(sanitized.bestStars).toEqual([0, 3, 2, 0, 0]);
    expect(sanitized.bestEndlessWaves).toEqual([0, 14, 0, 0, 5]);

    storage.setItem('skyhold_isles_progress_v1', 'not-json');
    expect(loadProgress(4)).toEqual(createDefaultProgress(4));
    storage.setItem('skyhold_isles_progress_v1', 'null');
    expect(loadProgress(4)).toEqual(createDefaultProgress(4));
    storage.setItem('skyhold_isles_progress_v1', '[]');
    expect(loadProgress(4)).toEqual(createDefaultProgress(4));
    storage.setItem('skyhold_isles_progress_v1', JSON.stringify({ unlockedLevelIndex: 999 }));
    expect(loadProgress(4).unlockedLevelIndex).toBe(3);
  });

  it('updates bestStars and unlockedLevelIndex monotonically in recordWinProgress and persists', () => {
    const progress = createDefaultProgress(LEVELS.length);

    // Win level 0 with 2 stars -> unlocks level 1
    recordWinProgress(progress, 0, 2);
    expect(progress.bestStars[0]).toBe(2);
    expect(progress.unlockedLevelIndex).toBe(1);
    expect(loadProgress(LEVELS.length)).toEqual(progress);

    // Re-win level 0 with 1 star -> keeps higher 2 stars
    recordWinProgress(progress, 0, 1);
    expect(progress.bestStars[0]).toBe(2);
    expect(progress.unlockedLevelIndex).toBe(1);

    // Re-win level 0 with 3 stars -> upgrades stars, preserves unlockedLevelIndex
    recordWinProgress(progress, 0, 3);
    expect(progress.bestStars[0]).toBe(3);
    expect(progress.unlockedLevelIndex).toBe(1);

    // Win level 4 out of order (e.g. jump unlock) -> unlocks level 5; re-winning level 2 doesn't regress unlock
    recordWinProgress(progress, 4, 2);
    expect(progress.unlockedLevelIndex).toBe(5);
    recordWinProgress(progress, 2, 3);
    expect(progress.unlockedLevelIndex).toBe(5);

    // Unlock and win final level -> never exceeds LEVELS.length - 1
    const lastIdx = LEVELS.length - 1;
    recordWinProgress(progress, lastIdx - 1, 2);
    expect(progress.unlockedLevelIndex).toBe(lastIdx);
    recordWinProgress(progress, lastIdx, 3);
    expect(progress.bestStars[lastIdx]).toBe(3);
    expect(progress.unlockedLevelIndex).toBe(lastIdx);
    expect(loadProgress(LEVELS.length)).toEqual(progress);
  });

  it('records best endless wave monotonically and initializes missing bestEndlessWaves arrays', () => {
    const legacyShape = {
      unlockedLevelIndex: 1,
      bestStars: new Array<number>(LEVELS.length).fill(0),
    } as unknown as ReturnType<typeof createDefaultProgress>;

    recordEndlessProgress(legacyShape, 0, 16.7);
    expect(legacyShape.bestEndlessWaves).toHaveLength(LEVELS.length);
    expect(legacyShape.bestEndlessWaves[0]).toBe(16);
    expect(loadProgress(LEVELS.length).bestEndlessWaves[0]).toBe(16);

    // Lower subsequent run does not overwrite best
    recordEndlessProgress(legacyShape, 0, 12);
    expect(legacyShape.bestEndlessWaves[0]).toBe(16);

    // Negative wave clamps to 0; higher wave updates and persists
    recordEndlessProgress(legacyShape, 1, -3);
    expect(legacyShape.bestEndlessWaves[1]).toBe(0);
    recordEndlessProgress(legacyShape, 1, 27);
    expect(legacyShape.bestEndlessWaves[1]).toBe(27);
    expect(loadProgress(LEVELS.length).bestEndlessWaves[1]).toBe(27);
  });

  it('handles missing global localStorage and zero-level counts without throwing', () => {
    vi.unstubAllGlobals();
    expect(() => saveSettings(getDefaultSettings())).not.toThrow();
    expect(loadSettings()).toEqual(getDefaultSettings());
    expect(() => saveProgress(createDefaultProgress(LEVELS.length))).not.toThrow();
    expect(loadProgress(LEVELS.length)).toEqual(createDefaultProgress(LEVELS.length));
    expect(loadProgress(0)).toEqual({
      unlockedLevelIndex: 0,
      bestStars: [],
      bestEndlessWaves: [],
    });
    expect(hasSeenFlyerToast()).toBe(false);
    expect(() => markFlyerToastSeen()).not.toThrow();
    expect(hasSeenUpgradeToast()).toBe(false);
    expect(() => markUpgradeToastSeen()).not.toThrow();
  });
});
