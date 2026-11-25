/**
 * Regression: a save written before chapters (the flat island order `l1c`, `i01`..`i24`) must keep
 * every star, Hard ribbon, difficulty win, record and unlock on the SAME island id after the chapter
 * reorder put i25/i26 before i16 and i27 before i24 (so i16..i24 moved off their flat indexes).
 *
 * Every path an old save can come back through is covered with the REAL roster: the stored local
 * save (with and without its id order), save codes (with and without ids), importing a code into
 * an existing save, and Steam Cloud hydration in both directions (an old flat cloud blob into a new
 * local save, and a new cloud blob into an old flat local save).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgressData } from '../../src/core/types.ts';
import { challengesForLevel } from '../../src/data/challenges.ts';
import { LEGACY_2D_ORDER } from '../../src/data/chapters.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import type { PlatformAdapter } from '../../src/platform/platform.ts';
import { describeMergeGain, encodeSaveCode } from '../../src/platform/saveCode.ts';
import { createDefaultProgress } from '../../src/platform/storage.ts';
import {
  applyRunResult2D,
  CLOUD_PROGRESS_2D_SLOT,
  decodeSaveCode2D,
  hydrateProgress2DFromCloud,
  importSaveCode2D,
  islandStates,
  loadProgress2D,
  PROGRESS_2D_KEY,
  resetProgress2D,
} from '../../src/render2d/ui/progress2d.ts';

const NEW_IDS = LEVELS_2D.map((l) => l.id);
const at = (id: string): number => {
  const i = NEW_IDS.indexOf(id);
  if (i < 0) throw new Error(id);
  return i;
};
const flat = (id: string): number => LEGACY_2D_ORDER.indexOf(id);
const level = (id: string) => LEVELS_2D[at(id)];

/** The ids whose index changed with the reorder; the whole point of this file. */
const MOVED = ['i16', 'i17', 'i20', 'i23', 'i24'] as const;

/**
 * An old save in the flat 25-island order: every island up to i24 won, i24 is the frontier.
 * Each island carries a unique fingerprint (`bestEndlessWaves = 100 + flat index`,
 * `bestLives = flat index + 1`), so any shift by one or two islands is caught.
 * i16 and i24 were won on Hard (ribbon), i17 only on Easy (1★), i20 on Normal with a badge.
 */
function oldFlatSave(): ProgressData {
  const n = LEGACY_2D_ORDER.length;
  const p = createDefaultProgress(n);
  p.difficultyWins = {
    easy: new Array<number>(n).fill(0),
    normal: new Array<number>(n).fill(0),
    hard: new Array<number>(n).fill(0),
  };
  for (let j = 0; j < n; j++) {
    p.bestStars[j] = 2;
    p.difficultyWins.normal[j] = 2;
    p.clears[j] = 1 + (j % 4);
    p.bestEndlessWaves[j] = 100 + j;
    p.bestLives[j] = j + 1;
  }
  for (const id of ['i16', 'i24']) {
    p.bestStars[flat(id)] = 3;
    p.difficultyWins.hard[flat(id)] = 3;
  }
  p.bestStars[flat('i17')] = 1;
  p.difficultyWins.normal[flat('i17')] = 0;
  p.difficultyWins.easy[flat('i17')] = 1;
  p.challengeClears[flat('i20')] = [challengesForLevel(level('i20'))[0]];
  p.unlockedLevelIndex = flat('i24');
  return p;
}

/** Everything the old save recorded for `id`, read from a progress laid out in `order`. */
function islandRecord(p: ProgressData, order: readonly string[], id: string) {
  const i = order.indexOf(id);
  return {
    stars: p.bestStars[i],
    endless: p.bestEndlessWaves[i],
    lives: p.bestLives[i],
    clears: p.clears[i],
    badges: [...(p.challengeClears[i] ?? [])],
    easy: p.difficultyWins?.easy[i] ?? 0,
    normal: p.difficultyWins?.normal[i] ?? 0,
    hard: p.difficultyWins?.hard[i] ?? 0,
  };
}

/** Asserts that every old island's data sits on its own id in a progress on today's roster. */
function expectOnTheRightIds(p: ProgressData, old: ProgressData): void {
  expect(p.bestStars).toHaveLength(LEVELS_2D.length);
  for (const id of LEGACY_2D_ORDER) {
    expect(islandRecord(p, NEW_IDS, id), id).toEqual(islandRecord(old, LEGACY_2D_ORDER, id));
  }
  // Spot checks in plain numbers (what a player would see on the medallions).
  expect(p.difficultyWins?.hard[at('i16')]).toBe(3);
  expect(p.difficultyWins?.hard[at('i24')]).toBe(3);
  expect(p.bestStars[at('i17')]).toBe(1);
  expect(p.difficultyWins?.easy[at('i17')]).toBe(1);
  expect(p.bestEndlessWaves[at('i16')]).toBe(100 + 16);
  expect(p.bestEndlessWaves[at('i24')]).toBe(100 + 24);
  // The new islands start empty, but nothing is relocked: clearing i24 opens i28, and i25..i27 are already open.
  for (const id of ['i25', 'i26', 'i27', 'i28', 'i29', 'i30', 'i31', 'i32', 'i33', 'i34', 'i35', 'i36', 'i37', 'i38', 'i39']) {
    expect(p.bestStars[at(id)], id).toBe(0);
    expect(p.difficultyWins?.hard[at(id)] ?? 0, id).toBe(0);
    expect(p.bestEndlessWaves[at(id)], id).toBe(0);
  }
  expect(LEVELS_2D[p.unlockedLevelIndex].id).toBe('i28');
  const st = islandStates(p, LEVELS_2D);
  expect(st.filter(s => !s.unlocked).map(s => s.level.id)).toEqual(['i29', 'i30', 'i31', 'i32', 'i33', 'i34', 'i35', 'i36', 'i37', 'i38', 'i39']);
  expect(st[at('i16')].hardWon).toBe(true);
  expect(st[at('i24')].hardWon).toBe(true);
  expect(st[at('i25')].hardWon).toBe(false);
}

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  };
}

function steamAdapter(cloud: Map<string, string>): PlatformAdapter {
  return {
    isSteam: true,
    isMobile: false,
    mobilePlatform: 'web',
    overlayActive: false,
    triggerHaptic: () => Promise.resolve(false),
    onPause: () => () => undefined,
    onResume: () => () => undefined,
    onOverlayChange: () => () => undefined,
    achievements: { unlock: () => Promise.resolve(true) },
    cloudSave: {
      read: (slot) => Promise.resolve(cloud.get(slot) ?? null),
      write: (slot, json) => {
        cloud.set(slot, json);
        return Promise.resolve(true);
      },
    },
  };
}

let ls: Storage;
beforeEach(() => {
  ls = memStorage();
  vi.stubGlobal('localStorage', ls);
});
afterEach(() => {
  resetProgress2D(LEVELS_2D);
  vi.unstubAllGlobals();
});

describe('old flat-order saves after the chapter reorder (real roster)', () => {
  it('the reorder really moved i16..i24 (otherwise this file proves nothing)', () => {
    for (const id of MOVED) expect(at(id), id).not.toBe(flat(id));
    expect(at('i16')).toBe(flat('i16') + 2);
    expect(at('i24')).toBe(flat('i24') + 3);
  });

  it('a stored save with its flat id order loads onto the right ids', () => {
    const old = oldFlatSave();
    ls.setItem(PROGRESS_2D_KEY, JSON.stringify({ ids: LEGACY_2D_ORDER, progress: old }));
    expectOnTheRightIds(loadProgress2D(LEVELS_2D), old);
  });

  it('a stored save WITHOUT an id order (bare or wrapped) is read in the flat order', () => {
    const old = oldFlatSave();
    ls.setItem(PROGRESS_2D_KEY, JSON.stringify(old));
    expectOnTheRightIds(loadProgress2D(LEVELS_2D), old);
    ls.setItem(PROGRESS_2D_KEY, JSON.stringify({ progress: old }));
    expectOnTheRightIds(loadProgress2D(LEVELS_2D), old);
  });

  it('save codes with and without ids decode onto the right ids', () => {
    const old = oldFlatSave();
    for (const code of [encodeSaveCode(old, LEGACY_2D_ORDER), encodeSaveCode(old)]) {
      const res = decodeSaveCode2D(code, LEVELS_2D);
      expect(res.ok).toBe(true);
      if (res.ok) expectOnTheRightIds(res.progress, old);
    }
  });

  it('importing an old id-less code into a new save keeps the Hard ribbons on i16 / i24', () => {
    const old = oldFlatSave();
    const res = importSaveCode2D(encodeSaveCode(old), LEVELS_2D);
    expect(res.ok).toBe(true);
    if (res.ok) expectOnTheRightIds(res.progress, old);
    expectOnTheRightIds(loadProgress2D(LEVELS_2D), old);
  });

  it('cloud: an old flat-order cloud blob (with or without ids) merges onto the right ids', async () => {
    const old = oldFlatSave();
    for (const blob of [{ ids: LEGACY_2D_ORDER, progress: old }, old]) {
      resetProgress2D(LEVELS_2D);
      const cloud = new Map([[CLOUD_PROGRESS_2D_SLOT, JSON.stringify(blob)]]);
      const local = createDefaultProgress(LEVELS_2D.length);
      const { merged } = await hydrateProgress2DFromCloud(local, LEVELS_2D, steamAdapter(cloud));
      expectOnTheRightIds(merged, old);
      expect(describeMergeGain(local, merged)).toContain('+2 Hard ribbons');
      // The union written back to the cloud is in today's order, with ids.
      const written = JSON.parse(cloud.get(CLOUD_PROGRESS_2D_SLOT)!) as { ids: string[] };
      expect(written.ids).toEqual(NEW_IDS);
    }
  });

  it('cloud: a new Hard ribbon on i16 from another device lands on i16 of an old flat local save', async () => {
    // The old save stopped at i16 (won on Normal), stored flat with ids, as the last build wrote it.
    const old = oldFlatSave();
    old.difficultyWins!.hard[flat('i16')] = 0;
    old.difficultyWins!.normal[flat('i16')] = 2;
    old.bestStars[flat('i16')] = 2;
    ls.setItem(PROGRESS_2D_KEY, JSON.stringify({ ids: LEGACY_2D_ORDER, progress: old }));
    const local = loadProgress2D(LEVELS_2D);
    expect(local.difficultyWins?.hard[at('i16')]).toBe(0);

    // The other device (already updated) beat i16 on Hard.
    const other = createDefaultProgress(LEVELS_2D.length);
    applyRunResult2D(
      other,
      {
        levelId: 'i16',
        won: true,
        stars: 3,
        livesRemaining: 20,
        waveReached: level('i16').waves.length,
        runConfig: { endless: false, challenges: [], daily: null, difficulty: 'hard' },
      },
      LEVELS_2D,
    );
    expect(other.difficultyWins?.hard[at('i16')]).toBe(3);
    const cloud = new Map([[CLOUD_PROGRESS_2D_SLOT, JSON.stringify({ ids: NEW_IDS, progress: other })]]);
    const { merged } = await hydrateProgress2DFromCloud(local, LEVELS_2D, steamAdapter(cloud));
    expect(merged.difficultyWins?.hard[at('i16')]).toBe(3);
    expect(merged.bestStars[at('i16')]).toBe(3);
    expect(describeMergeGain(local, merged)).toContain('+1 Hard ribbon');
    // Nothing leaked onto i25 (flat index 16) or i26, and i24 keeps its own ribbon.
    expect(merged.difficultyWins?.hard[at('i25')]).toBe(0);
    expect(merged.difficultyWins?.hard[at('i26')]).toBe(0);
    expect(merged.difficultyWins?.hard[at('i24')]).toBe(3);
    expect(merged.bestEndlessWaves[at('i17')]).toBe(100 + 17);
  });
});
