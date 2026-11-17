import { beforeEach, describe, expect, it } from 'vitest';
import { loadProgress, resetProgressSave, saveProgress } from '../../src/platform/storage.ts';
import { ContentStore, type StorageLike } from '../../src/platform/contentStorage.ts';
import { LEVELS } from '../../src/data/levels/index.ts';

const KEY = 'skyhold_isles_progress_v1';
const BACKUP_KEY = 'skyhold_isles_progress_backup_v1';
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};

function save(data: unknown): void {
  store.set(KEY, JSON.stringify(data));
}

describe('progress load across island-count changes', () => {
  beforeEach(() => store.clear());

  it('a player who finished the old 9-island campaign gets island 10 unlocked', () => {
    // The 9-island build never raised unlockedLevelIndex past 8 (no island after L9 existed).
    save({ unlockedLevelIndex: 8, bestStars: [3, 3, 2, 2, 3, 1, 2, 1, 1], bestEndlessWaves: [] });
    const p = loadProgress(13);
    expect(p.unlockedLevelIndex).toBe(9);
    expect(p.bestStars).toHaveLength(13);
    expect(p.bestStars.slice(9)).toEqual([0, 0, 0, 0]);
  });

  it('does not unlock past the island after the furthest cleared one', () => {
    save({ unlockedLevelIndex: 3, bestStars: [2, 2, 1], bestEndlessWaves: [] });
    expect(loadProgress(13).unlockedLevelIndex).toBe(3);
    save({ unlockedLevelIndex: 0, bestStars: [2, 2, 1], bestEndlessWaves: [] });
    expect(loadProgress(13).unlockedLevelIndex).toBe(3);
    save({ unlockedLevelIndex: 0, bestStars: [], bestEndlessWaves: [] });
    expect(loadProgress(13).unlockedLevelIndex).toBe(0);
  });

  it('clamps to the last island and ignores junk', () => {
    save({ unlockedLevelIndex: 40, bestStars: new Array(13).fill(3) });
    expect(loadProgress(13).unlockedLevelIndex).toBe(12);
    // A corrupted stored index is not walked forward, even across islands with stars.
    save({ unlockedLevelIndex: 'x', bestStars: [1, 'a', null] });
    expect(loadProgress(13).unlockedLevelIndex).toBe(0);
    store.set(KEY, '{"unlockedLevelIndex":1e500,"bestStars":[2],"bestEndlessWaves":[5]}');
    expect(loadProgress(13).unlockedLevelIndex).toBe(0);
    store.set(KEY, '{not json');
    expect(loadProgress(13).unlockedLevelIndex).toBe(0);
  });
});

describe('progress save versioning', () => {
  beforeEach(() => store.clear());

  it('backs up a pre-v2 save once and saves back as v2 without losing anything', () => {
    const v1 = { unlockedLevelIndex: 2, bestStars: [3, 1], bestEndlessWaves: [12] };
    save(v1);
    const p = loadProgress(13);
    expect(JSON.parse(store.get(BACKUP_KEY) ?? 'null')).toEqual(v1);
    saveProgress(p);
    const stored = JSON.parse(store.get(KEY) ?? '{}') as Record<string, unknown>;
    expect(stored.version).toBe(2);
    expect(stored.bestStars).toEqual([3, 1, ...new Array<number>(11).fill(0)]);
    expect(stored.bestEndlessWaves).toEqual([12, ...new Array<number>(12).fill(0)]);
    expect(loadProgress(13).unlockedLevelIndex).toBe(2);
    // A later load does not overwrite the original backup.
    expect(JSON.parse(store.get(BACKUP_KEY) ?? 'null')).toEqual(v1);
  });

  it('reset progress keeps a backup of the erased save and leaves settings alone', () => {
    store.set('skyhold_isles_settings_v1', '{"muted":true}');
    save({ version: 2, unlockedLevelIndex: 5, bestStars: [3, 3, 3, 3, 3, 1], workshop: { bastion: 2 } });
    const before = store.get(KEY);
    const fresh = resetProgressSave(13);
    expect(fresh.unlockedLevelIndex).toBe(0);
    expect(fresh.workshop).toEqual({});
    expect(store.get('skyhold_isles_progress_reset_backup')).toBe(before);
    expect(loadProgress(13).bestStars.every((s) => s === 0)).toBe(true);
    expect(store.get('skyhold_isles_settings_v1')).toBe('{"muted":true}');
    // Resetting the now-empty save again must not overwrite the backup of the real progress.
    resetProgressSave(13);
    expect(store.get('skyhold_isles_progress_reset_backup')).toBe(before);
  });
  it('a v2 save from the 13-island build opens islands 14-16 and keeps Workshop / challenge data', () => {
    save({
      version: 2,
      unlockedLevelIndex: 12,
      bestStars: new Array<number>(13).fill(3),
      bestEndlessWaves: [],
      bestLives: new Array<number>(13).fill(18),
      clears: new Array<number>(13).fill(2),
      workshop: { bastion: 2 },
      challengeClears: [['bowless']],
    });
    const p = loadProgress(16);
    expect(p.unlockedLevelIndex).toBe(13);
    expect(p.bestStars).toHaveLength(16);
    expect(p.bestStars.slice(13)).toEqual([0, 0, 0]);
    expect(p.clears.slice(13)).toEqual([0, 0, 0]);
    expect(p.workshop).toEqual({ bastion: 2 });
    expect(p.challengeClears[0]).toEqual(['bowless']);
  });

  it('onboarding (CONTENT) reads the v2 progress: veterans skip it, fresh saves get it', () => {
    const mem = (): StorageLike => {
      const m = new Map<string, string>();
      return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
    };
    save({ version: 2, unlockedLevelIndex: 4, bestStars: [3, 2, 2, 1], workshop: {}, clears: [1, 1, 1, 1] });
    const veteran = new ContentStore(mem());
    veteran.migrate(LEVELS, loadProgress(LEVELS.length));
    expect(veteran.getOnboardingStatus()).toBe('done');

    // An old v1 save migrated on the same load is still a veteran.
    save({ unlockedLevelIndex: 2, bestStars: [3, 1], bestEndlessWaves: [] });
    const v1Veteran = new ContentStore(mem());
    v1Veteran.migrate(LEVELS, loadProgress(LEVELS.length));
    expect(v1Veteran.getOnboardingStatus()).toBe('done');

    store.clear();
    const fresh = new ContentStore(mem());
    fresh.migrate(LEVELS, loadProgress(LEVELS.length));
    expect(fresh.getOnboardingStatus()).toBe('pending');
  });
});
