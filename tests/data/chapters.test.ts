import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CAMPAIGN_ORDER,
  CHAPTERS,
  chapterOf,
  chapterPages,
  freeIslandIds,
  LEGACY_2D_ORDER,
  nextChapter,
  orderByChapters,
  pageOfIsland,
  PROLOGUE,
  PLAYABLE_ISLAND_IDS,
} from '../../src/data/chapters.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { applyWin } from '../../src/game/progression.ts';
import { EN } from '../../src/i18n/en.ts';
import { setLocale, t } from '../../src/i18n/index.ts';
import { TR } from '../../src/i18n/tr.ts';
import { FREE_ISLANDS, isUnlocked } from '../../src/platform/iap.ts';
import { encodeSaveCode } from '../../src/platform/saveCode.ts';
import { createDefaultProgress } from '../../src/platform/storage.ts';
import { cardsDue, chapterStates, frontierPage, parseCardsSeen } from '../../src/render2d/ui/chapterState.ts';
import { nextIsland2D, nextIslandOpen } from '../../src/render2d/ui/inGame.ts';
import {
  decodeSaveCode2D,
  islandStates,
  legacyIdOrder,
  loadProgress2D,
  PROGRESS_2D_KEY,
  remapProgress,
} from '../../src/render2d/ui/progress2d.ts';
import { pageFrontier } from '../../src/render2d/ui/worldMap.ts';

const ids = (levels: readonly { id: string }[]): string[] => levels.map((l) => l.id);
const FROSTVEIL = ['i28', 'i29', 'i30', 'i31', 'i32', 'i33', 'i34', 'i35', 'i36'];
const ECLIPSE = ['i37', 'i38', 'i39'];
const UNPUBLISHED = ['i40', 'i41', 'i42', 'i43', 'i44', 'i45'];
/** The real roster: the three new islands (i25 Galeglass Orrery, i26, i27) are registered. */
const WITH_NEW: readonly LevelDef[] = LEVELS_2D;
/** A synthetic pool with two chapter slots unfilled (i25 in Chapter 2, i27 in Chapter 3). */
const PARTIAL: readonly LevelDef[] = orderByChapters(LEVELS_2D.filter((l) => l.id !== 'i25' && l.id !== 'i27'));
/** The roster before the new islands landed (the shape every pre-chapter save was written for). */
const PRE_NEW: readonly LevelDef[] = orderByChapters(LEVELS_2D.filter((l) => LEGACY_2D_ORDER.includes(l.id)));

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

afterEach(() => vi.unstubAllGlobals());

describe('chapter list', () => {
  it('five playable chapters reserve nine slots each and publish exactly three Eclipse islands', () => {
    expect(PROLOGUE.islands).toEqual(['l1c']);
    expect(CHAPTERS.map((c) => c.n)).toEqual([1, 2, 3, 4, 5]);
    for (const c of CHAPTERS) {
      expect(c.status, c.id).toBe('playable');
      expect(c.islands, c.id).toHaveLength(9);
      expect(c.islands.at(-1), c.id).toBe(c.finale);
    }
    expect(CHAPTERS.map((c) => c.finale)).toEqual(['i09', 'i16', 'i24', 'i36', 'i45']);
    expect(chapterOf('i37')).toMatchObject({ islands: [...ECLIPSE, ...UNPUBLISHED], playableThrough: 'i39' });
    expect(new Set(CAMPAIGN_ORDER).size).toBe(CAMPAIGN_ORDER.length);
  });

  it('every chapter has a name and a blurb in both languages', () => {
    for (const c of [PROLOGUE, ...CHAPTERS]) {
      for (const k of [c.nameKey, c.blurbKey]) {
        expect(EN[k], k).toBeTruthy();
        expect(TR[k], k).toBeTruthy();
      }
    }
    expect(EN['chapter.ch2.name']).toBe('Stormcrown Reach');
    expect(TR['chapter.ch3.name']).toBe('Çan ve Fener Adaları');
  });

  it('chapterOf / nextChapter', () => {
    expect(chapterOf('l1c')).toBe(PROLOGUE);
    expect(chapterOf('i09')?.n).toBe(1);
    expect(chapterOf('i25')?.n).toBe(2);
    expect(chapterOf('i27')?.n).toBe(3);
    expect(chapterOf('nope')).toBeNull();
    expect(nextChapter(PROLOGUE)?.n).toBe(1);
    expect(nextChapter(chapterOf('i24')!)?.id).toBe('ch4');
    expect(nextChapter(chapterOf('i36')!)).toMatchObject({ id: 'ch5', status: 'playable' });
    expect(nextChapter(CHAPTERS[4])).toBeNull();
  });
});

describe('LEVELS_2D order comes from the chapters', () => {
  it('orders all 40 shipping islands through Umbral Grove', () => {
    expect(CAMPAIGN_ORDER).toEqual([...ids(LEVELS_2D), ...UNPUBLISHED]);
    expect(PLAYABLE_ISLAND_IDS).toEqual(ids(LEVELS_2D));
    expect(LEVELS_2D).toHaveLength(40);
    // The new islands moved i16..i24 off their flat (pre-chapter) indexes.
    expect(ids(LEVELS_2D)).not.toEqual([...LEGACY_2D_ORDER]);
    for (const l of LEVELS_2D) expect(chapterOf(l.id), l.id).not.toBeNull();
  });

  it('an unregistered slot is skipped (synthetic pool without i25 / i27)', () => {
    expect(ids(PARTIAL)).toEqual(PLAYABLE_ISLAND_IDS.filter((id) => id !== 'i25' && id !== 'i27'));
    // Without any of the three new islands the order is exactly the old flat one.
    expect(ids(PRE_NEW)).toEqual([...LEGACY_2D_ORDER]);
  });

  it('a registered new island takes its chapter slot, before the finale', () => {
    const order = ids(WITH_NEW);
    expect(order.slice(order.indexOf('i15'), order.indexOf('i17'))).toEqual(['i15', 'i25', 'i26', 'i16']);
    expect(order.slice(order.indexOf('i23'))).toEqual(['i23', 'i27', 'i24', ...FROSTVEIL, ...ECLIPSE]);
    expect(order).toHaveLength(40);
  });

  it('the first four chapters each show their nine islands', () => {
    const pages = chapterPages(ids(LEVELS_2D));
    expect(pages.map((p) => p.own.length)).toEqual([9, 9, 9, 9, 3]);
    expect(pages[0].indexes).toEqual([0, ...pages[0].own]);
    expect(ids(pages[1].own.map((i) => LEVELS_2D[i]))).toEqual([...CHAPTERS[1].islands]);
    expect(ids(pages[2].own.map((i) => LEVELS_2D[i]))).toEqual([...CHAPTERS[2].islands]);
    expect(pageOfIsland(pages, ids(LEVELS_2D).indexOf('i26'))).toBe(1);
    expect(pageOfIsland(pages, ids(LEVELS_2D).indexOf('i27'))).toBe(2);
  });

  it('missing slots leave a shorter chapter page that still works', () => {
    const pages = chapterPages(ids(PARTIAL));
    expect(pages.map((p) => p.own.length)).toEqual([9, 8, 8, 9, 3]);
    // Chapter 1's page leads with the Prologue.
    expect(pages[0].indexes).toEqual([0, ...pages[0].own]);
    expect(ids(pages[1].own.map((i) => PARTIAL[i]))).toEqual(['i10', 'i11', 'i12', 'i13', 'i14', 'i15', 'i26', 'i16']);
    expect(ids(pages[2].own.map((i) => PARTIAL[i]))).toEqual(['i17', 'i18', 'i19', 'i20', 'i21', 'i22', 'i23', 'i24']);
    expect(pageOfIsland(pages, 0)).toBe(0);
    expect(pageOfIsland(pages, ids(PARTIAL).indexOf('i17'))).toBe(2);
    // QA stand-ins (no chapter) go on the last page with islands.
    const mock = chapterPages([...ids(LEVELS_2D), 'mock-1']);
    expect(mock.find(p => p.chapter.id === 'ch5')!.indexes.at(-1)).toBe(LEVELS_2D.length);
  });
});

describe('unlock chain', () => {
  it('winning each finale opens the next chapter; the islands open one by one inside it', () => {
    const roster = WITH_NEW;
    const p = createDefaultProgress(roster.length);
    const chapters = () => chapterStates(islandStates(p, roster as LevelDef[]));
    expect(chapters().map((c) => c.opened)).toEqual([false, false, false, false, false]);
    applyWin(p, 0, roster.length, 3, 10, []); // the Prologue
    expect(chapters().map((c) => c.opened)).toEqual([true, false, false, false, false]);
    const win = (id: string) => applyWin(p, ids(roster).indexOf(id), roster.length, 2, 10, []);
    for (const id of ['i01', 'i02', 'i03', 'i04', 'i05', 'i06', 'i07', 'i08']) win(id);
    expect(chapters()[1].opened).toBe(false);
    expect(roster[p.unlockedLevelIndex].id).toBe('i09');
    win('i09');
    expect(chapters()[0].complete).toBe(true);
    expect(chapters()[1].opened).toBe(true);
    expect(roster[p.unlockedLevelIndex].id).toBe('i10');
    for (const id of ['i10', 'i11', 'i12', 'i13', 'i14', 'i15']) win(id);
    expect(roster[p.unlockedLevelIndex].id).toBe('i25');
    win('i25');
    win('i26');
    expect(roster[p.unlockedLevelIndex].id).toBe('i16');
    expect(chapters()[2].opened).toBe(false);
    win('i16');
    expect(chapters()[1].complete).toBe(true);
    expect(chapters()[2].opened).toBe(true);
    expect(roster[p.unlockedLevelIndex].id).toBe('i17');
    for (const id of ['i17', 'i18', 'i19', 'i20', 'i21', 'i22', 'i23', 'i27', 'i24']) win(id);
    expect(chapters().map((c) => [c.opened, c.complete])).toEqual([
      [true, true],
      [true, true],
      [true, true],
      [true, false],
      [false, false],
    ]);
    for (const id of FROSTVEIL) {
      expect(roster[p.unlockedLevelIndex].id).toBe(id);
      expect(chapters().find(c => c.chapter.id === 'ch4')!.complete).toBe(false);
      win(id);
    }
    expect(chapters().find(c => c.chapter.id === 'ch4')).toMatchObject({ cleared: 9, total: 9, complete: true });
    const due = cardsDue(chapters(), { done: ['ch1', 'ch2', 'ch3'], title: ['ch1', 'ch2', 'ch3', 'ch4'] });
    expect(due.done?.id).toBe('ch4');
    expect(due.title?.id).toBe('ch5');
    expect(nextChapter(due.done!)).toBe(due.title);
    expect(cardsDue(chapters(), due.seen).title).toBeNull();
    for (const id of ECLIPSE) {
      expect(roster[p.unlockedLevelIndex].id).toBe(id);
      win(id);
    }
    expect(chapters().find(c => c.chapter.id === 'ch5')).toMatchObject({ opened: true, cleared: 3, total: 3, complete: false });
    expect(cardsDue(chapters(), due.seen).done).toBeNull();
    expect(chapters()[1]).toMatchObject({ cleared: 9, total: 9, stars: 18, maxStars: 27 });
  });

  it('the map opens on the frontier chapter (Chapter 1 while the Prologue is the frontier)', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    expect(frontierPage(chapterStates(islandStates(p, LEVELS_2D)))).toBe(0);
    p.unlockedLevelIndex = ids(LEVELS_2D).indexOf('i12');
    expect(frontierPage(chapterStates(islandStates(p, LEVELS_2D)))).toBe(1);
  });

  it('Next Isle stops at a chapter boundary (the World Map shows the chapter cards)', () => {
    expect(nextIsland2D('i09')?.id).toBe('i10');
    expect(nextIslandOpen('i09', true)).toBeUndefined();
    expect(nextIslandOpen('l1c', true)).toBeUndefined();
    expect(nextIslandOpen('i16', true)).toBeUndefined();
    expect(nextIsland2D('i24')?.id).toBe('i28');
    expect(nextIslandOpen('i24', true)).toBeUndefined();
    expect(nextIslandOpen('i29', true)?.id).toBe('i30');
    expect(nextIslandOpen('i30', true)?.id).toBe('i31');
    expect(nextIslandOpen('i33', true)?.id).toBe('i34');
    expect(nextIslandOpen('i35', true)?.id).toBe('i36');
    expect(nextIsland2D('i36')?.id).toBe('i37');
    expect(nextIslandOpen('i36', true)).toBeUndefined();
    expect(nextIslandOpen('i37', true)?.id).toBe('i38');
    expect(nextIslandOpen('i38', true)?.id).toBe('i39');
    expect(nextIslandOpen('i39', true)).toBeUndefined();
    expect(nextIslandOpen('i08', true)?.id).toBe('i09');
    expect(nextIslandOpen('i10', true)?.id).toBe('i11');
  });

  it('the sailed legs of a chapter page follow the frontier', () => {
    expect(pageFrontier([10, 11, 12, 13], 5)).toBe(0);
    expect(pageFrontier([10, 11, 12, 13], 12)).toBe(2);
    expect(pageFrontier([10, 11, 12, 13], 20)).toBe(3);
    expect(pageFrontier([], 3)).toBe(0);
  });
});

describe('old saves never relock', () => {
  /** A save written before chapters: the flat order, won up to (not including) `upTo`. */
  function flatSave(upTo: string): ReturnType<typeof createDefaultProgress> {
    const order = LEGACY_2D_ORDER;
    const p = createDefaultProgress(order.length);
    for (let i = 0; i < order.indexOf(upTo); i++) applyWin(p, i, order.length, i % 3 === 0 ? 3 : 2, 10, []);
    return p;
  }

  it.each([['i33', 'i34'], ['i36', 'i37']])('an older save opens %s’s successor %s only after victory', (last, next) => {
    const before = ids(LEVELS_2D).slice(0, ids(LEVELS_2D).indexOf(next));
    const p = createDefaultProgress(before.length);
    for (const id of before) {
      if (id === last) break;
      applyWin(p, before.indexOf(id), before.length, 2, 10, []);
    }
    const frontier = () => islandStates(remapProgress(p, before, LEVELS_2D), LEVELS_2D).find(s => s.frontier)?.level.id;
    expect(frontier()).toBe(last);
    applyWin(p, before.indexOf(last), before.length, 2, 10, []);
    expect(frontier()).toBe(next);
  });

  it('a player who beat i16 keeps i17+, and the new i25 / i26 appear open and unplayed', () => {
    const old = flatSave('i19');
    const p = remapProgress(old, LEGACY_2D_ORDER, WITH_NEW);
    const st = islandStates(p, WITH_NEW as LevelDef[]);
    const at = (id: string) => st[ids(WITH_NEW).indexOf(id)];
    for (const id of ['i15', 'i16', 'i17', 'i18', 'i19']) expect(at(id).unlocked, id).toBe(true);
    expect(at('i19').frontier).toBe(true);
    expect(at('i20').unlocked).toBe(false);
    for (const id of ['i25', 'i26']) {
      expect(at(id).unlocked, id).toBe(true);
      expect(at(id).stars, id).toBe(0);
    }
    // Stars stay on their island, by id.
    for (const id of ['l1c', 'i09', 'i16', 'i18']) expect(at(id).stars, id).toBe(old.bestStars[LEGACY_2D_ORDER.indexOf(id)]);
    const ch = chapterStates(st);
    expect(ch[1]).toMatchObject({ opened: true, complete: true, cleared: 7, total: 9 });
    expect(ch[2].opened).toBe(true);
  });

  it('a player stopped at i16 (not won) keeps it open, and the new islands before it open too', () => {
    const p = remapProgress(flatSave('i16'), LEGACY_2D_ORDER, WITH_NEW);
    const st = islandStates(p, WITH_NEW as LevelDef[]);
    const at = (id: string) => st[ids(WITH_NEW).indexOf(id)];
    expect(at('i16').unlocked).toBe(true);
    expect(at('i25').unlocked).toBe(true);
    expect(at('i26').unlocked).toBe(true);
    expect(at('i17').unlocked).toBe(false);
  });

  it('a stored save (with its id order) loads onto the new roster without losing anything', () => {
    const ls = memStorage();
    vi.stubGlobal('localStorage', ls);
    const old = flatSave('i18');
    ls.setItem(PROGRESS_2D_KEY, JSON.stringify({ ids: LEGACY_2D_ORDER, progress: old }));
    const p = loadProgress2D(WITH_NEW as LevelDef[]);
    expect(WITH_NEW[p.unlockedLevelIndex].id).toBe('i18');
    const st = islandStates(p, WITH_NEW as LevelDef[]);
    expect(st.filter((s) => s.unlocked).map((s) => s.level.id)).toEqual(ids(WITH_NEW).slice(0, ids(WITH_NEW).indexOf('i18') + 1));
    expect(st[ids(WITH_NEW).indexOf('i16')].stars).toBe(old.bestStars[16]);
  });

  it('a save without an id order is read in the flat pre-chapter order', () => {
    // Before the new islands, the flat order and the chapter order were the same.
    expect(legacyIdOrder(PRE_NEW)).toEqual(ids(PRE_NEW));
    // With them registered, an id-less save is still read flat; the new islands come after it.
    expect(legacyIdOrder(LEVELS_2D)).toEqual([...LEGACY_2D_ORDER, 'i25', 'i26', 'i27', ...FROSTVEIL, ...ECLIPSE]);
    expect(legacyIdOrder(LEVELS_2D)).not.toEqual(ids(LEVELS_2D));
    expect(legacyIdOrder(PARTIAL)).toEqual([...LEGACY_2D_ORDER, 'i26', ...FROSTVEIL, ...ECLIPSE]);
    expect(legacyIdOrder([{ id: 'a' }, { id: 'b' }])).toEqual(['a', 'b']);
    const ls = memStorage();
    vi.stubGlobal('localStorage', ls);
    const old = flatSave('i17');
    ls.setItem(PROGRESS_2D_KEY, JSON.stringify(old));
    const p = loadProgress2D(WITH_NEW as LevelDef[]);
    expect(WITH_NEW[p.unlockedLevelIndex].id).toBe('i17');
    expect(p.bestStars[ids(WITH_NEW).indexOf('i16')]).toBe(old.bestStars[16]);
    expect(p.bestStars[ids(WITH_NEW).indexOf('i25')]).toBe(0);
  });

  it('a save code without ids is read in the flat order too', () => {
    const old = flatSave('i17');
    const res = decodeSaveCode2D(encodeSaveCode(old), WITH_NEW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(WITH_NEW[res.progress.unlockedLevelIndex].id).toBe('i17');
    expect(res.progress.bestStars[ids(WITH_NEW).indexOf('i16')]).toBe(old.bestStars[16]);
  });
});

describe('free scope (mobile)', () => {
  it('is the Prologue + Chapter 1; Chapter 2 onward needs the full adventure', () => {
    expect(FREE_ISLANDS).toEqual(freeIslandIds());
    expect(FREE_ISLANDS).toEqual(['l1c', ...CHAPTERS[0].islands]);
    for (const id of CAMPAIGN_ORDER) {
      const free = chapterOf(id)!.n <= 1;
      expect(isUnlocked(id, []), id).toBe(free);
      expect(isUnlocked(id, ['full_unlock']), id).toBe(true);
    }
  });
});

describe('store copy', () => {
  it('the lock says the full adventure is Chapter 2 onward (both languages)', () => {
    setLocale('en');
    expect(t('store.intro', { free: 1, n: 2, total: 25 })).toBe('The Prologue and Chapter 1 are free. The full adventure opens Chapter 2 onward: all 25 isles.');
    expect(t('chapter.lockedPaid', { n: 2 })).toContain('Chapter 2 onward');
    setLocale('tr');
    expect(t('store.intro', { free: 1, n: 2, total: 25 })).toContain('2. Bölüm ve sonrası');
    expect(t('store.blurbFull', { n: 2 })).toContain('2. Bölüm');
    setLocale('en');
  });
});

describe('chapter cards', () => {
  const states = (upTo: string) => {
    const p = createDefaultProgress(LEVELS_2D.length);
    for (let i = 0; i < ids(LEVELS_2D).indexOf(upTo); i++) applyWin(p, i, LEVELS_2D.length, 2, 10, []);
    return chapterStates(islandStates(p, LEVELS_2D));
  };
  const none = { title: [], done: [] };

  it('a fresh player sees nothing until the Prologue is won, then Chapter 1 title card once', () => {
    expect(cardsDue(states('l1c'), none)).toMatchObject({ done: null, title: null });
    const due = cardsDue(states('i01'), none);
    expect(due.title?.id).toBe('ch1');
    expect(due.done).toBeNull();
    expect(cardsDue(states('i01'), due.seen).title).toBeNull();
  });

  it('a finale win shows Chapter complete, then the next chapter title card', () => {
    const seen = cardsDue(states('i09'), none).seen;
    const due = cardsDue(states('i10'), seen);
    expect(due.done?.id).toBe('ch1');
    expect(due.title?.id).toBe('ch2');
    expect(cardsDue(states('i10'), due.seen)).toMatchObject({ done: null, title: null });
  });

  it('an old save deep in a chapter gets no stack of cards (marked seen silently)', () => {
    const due = cardsDue(states('i12'), none);
    expect(due.done).toBeNull();
    expect(due.title).toBeNull();
    expect([...due.seen.title].sort()).toEqual(['ch1', 'ch2']);
    expect(due.seen.done).toEqual(['ch1']);
  });

  it('Lastlight shows the Chapter 3 completion and Frostveil title together', () => {
    const ch = states('i28');
    const seen = { title: ['ch1', 'ch2', 'ch3'], done: ['ch1', 'ch2'] };
    expect(cardsDue(ch, seen)).toMatchObject({ done: { id: 'ch3' }, title: { id: 'ch4' } });
  });

  it('parses a stored record defensively', () => {
    expect(parseCardsSeen(null)).toBeNull();
    expect(parseCardsSeen('{oops')).toBeNull();
    expect(parseCardsSeen('{"title":["ch1",3],"done":"x"}')).toEqual({ title: ['ch1'], done: [] });
  });
});
