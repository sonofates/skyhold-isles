import { beforeEach, describe, expect, it } from 'vitest';
import { loadProgress } from '../../src/platform/storage.ts';

const KEY = 'skyhold_isles_progress_v1';
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
    save({ unlockedLevelIndex: 'x', bestStars: [1, 'a', null] });
    expect(loadProgress(13).unlockedLevelIndex).toBe(1);
    store.set(KEY, '{not json');
    expect(loadProgress(13).unlockedLevelIndex).toBe(0);
  });
});
