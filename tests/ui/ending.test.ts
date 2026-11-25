/**
 * The game's ending (docs/handoff-ending.md): the `campaignComplete` trigger (only the first win of
 * the last chapter's finale), the save flag and its migration, the one-time "Campaign complete"
 * card, the ending's art slots and copy, and (with happy-dom, dev-only) skipping the story and the
 * credits roll, and Chapter 5's "Chapter complete" card promising no next chapter.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { campaignFinaleId, CHAPTERS, chapterOf, nextChapter, orderByChapters } from '../../src/data/chapters.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import type { ProgressData } from '../../src/core/types.ts';
import { applyWin } from '../../src/game/progression.ts';
import { setLocale, t } from '../../src/i18n/index.ts';
import { EN } from '../../src/i18n/en.ts';
import { TR } from '../../src/i18n/tr.ts';
import { PLAIN_RUN, type RunConfig } from '../../src/game/runConfig.ts';
import { decodeSaveCode, encodeSaveCode, mergeProgress } from '../../src/platform/saveCode.ts';
import { createDefaultProgress, migrateProgress } from '../../src/platform/storage.ts';
import { cardsDue, chapterStates, parseCardsSeen } from '../../src/render2d/ui/chapterState.ts';
import {
  campaignNudges,
  campaignSummary,
  endingArt,
  endingBeats,
  ENDING_ART_SLOTS,
  ENDING_PLACEHOLDER_ART,
} from '../../src/render2d/ui/ending2d.ts';
import { ROLL_ROLES, rollBlocks, rollOffset } from '../../src/render2d/ui/creditsRoll2d.ts';
import {
  applyRunResult2D,
  isCampaignComplete,
  islandStates,
  loadProgress2D,
  PROGRESS_2D_KEY,
  recordRunResult2D,
  remapProgress,
} from '../../src/render2d/ui/progress2d.ts';

const ROOT = resolve(__dirname, '../..');

/** Today's roster plus stand-ins for chapter slots not registered yet (i43-i45 while in production). */
const ROSTER: LevelDef[] = (() => {
  const have = new Set(LEVELS_2D.map((l) => l.id));
  const base = LEVELS_2D[LEVELS_2D.length - 1];
  const extra = CHAPTERS.flatMap((c) => c.islands).filter((id) => !have.has(id)).map((id) => ({ ...base, id }));
  return orderByChapters([...LEVELS_2D, ...extra]);
})();
const at = (id: string): number => ROSTER.findIndex((l) => l.id === id);

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

/** A save that won every island before `id` (2 stars each). */
function wonUpTo(id: string): ProgressData {
  const p = createDefaultProgress(ROSTER.length);
  for (let i = 0; i < at(id); i++) applyWin(p, i, ROSTER.length, 2, 10, []);
  return p;
}

const run = (p: ProgressData, levelId: string, won = true, cfg: Partial<RunConfig> = {}) =>
  applyRunResult2D(p, { levelId, won, stars: 3, livesRemaining: 12, waveReached: 17, runConfig: { ...PLAIN_RUN, ...cfg } }, ROSTER);

describe('campaign finale (data)', () => {
  it('is the last chapter’s finale, derived from chapters.ts (i45 today)', () => {
    const last = CHAPTERS[CHAPTERS.length - 1];
    expect(campaignFinaleId()).toBe(last.finale);
    expect(campaignFinaleId()).toBe('i45');
    expect(chapterOf('i45')?.id).toBe('ch5');
    expect(nextChapter(last)).toBeNull();
  });
});

describe('campaignComplete trigger', () => {
  it('fires on the first win of the last chapter’s finale only', () => {
    const p = wonUpTo('i45');
    expect(isCampaignComplete(p, ROSTER)).toBe(false);
    const res = run(p, 'i45');
    expect(res.win?.firstClear).toBe(true);
    expect(res.campaignComplete).toBe(true);
    expect(p.campaignComplete).toBe(true);
    expect(isCampaignComplete(p, ROSTER)).toBe(true);
    // Replays of the finale (any difficulty) never fire it again.
    expect(run(p, 'i45').campaignComplete).toBeUndefined();
    expect(run(p, 'i45', true, { difficulty: 'hard' }).campaignComplete).toBeUndefined();
  });

  it('never fires on other finales, other islands, losses or Endless', () => {
    for (const id of ['l1c', 'i09', 'i16', 'i24', 'i36', 'i37', 'i44']) {
      const p = wonUpTo(id);
      expect(run(p, id).campaignComplete, id).toBeUndefined();
      expect(p.campaignComplete, id).toBeUndefined();
    }
    const p = wonUpTo('i45');
    expect(run(p, 'i45', false).campaignComplete).toBeUndefined();
    expect(run(p, 'i45', false, { endless: true }).campaignComplete).toBeUndefined();
    expect(p.campaignComplete).toBeUndefined();
  });

  it('a Hard first win of the finale completes it too', () => {
    const p = wonUpTo('i45');
    expect(run(p, 'i45', true, { difficulty: 'hard' }).campaignComplete).toBe(true);
  });

  it('a save that won the finale before the flag existed does not fire it again', () => {
    const p = wonUpTo('i45');
    applyWin(p, at('i45'), ROSTER.length, 2, 10, []);
    expect(p.campaignComplete).toBeUndefined();
    expect(isCampaignComplete(p, ROSTER)).toBe(true);
    expect(run(p, 'i45').campaignComplete).toBeUndefined();
    expect(p.campaignComplete).toBe(true);
  });

  it('is saved through recordRunResult2D and loads back', () => {
    vi.stubGlobal('localStorage', memStorage());
    try {
      localStorage.setItem(PROGRESS_2D_KEY, JSON.stringify({ ids: ROSTER.map((l) => l.id), progress: wonUpTo('i45') }));
      const res = recordRunResult2D({ levelId: 'i45', won: true, stars: 2, livesRemaining: 8, waveReached: 17 }, ROSTER);
      expect(res.campaignComplete).toBe(true);
      const raw = JSON.parse(localStorage.getItem(PROGRESS_2D_KEY)!) as { progress: ProgressData };
      expect(raw.progress.campaignComplete).toBe(true);
      expect(loadProgress2D(ROSTER).campaignComplete).toBe(true);
      expect(recordRunResult2D({ levelId: 'i45', won: true, stars: 3, livesRemaining: 8, waveReached: 17 }, ROSTER).campaignComplete).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('campaignComplete save flag', () => {
  it('old saves without the flag: computed from the finale win when loading', () => {
    vi.stubGlobal('localStorage', memStorage());
    try {
      const won = wonUpTo('i45');
      applyWin(won, at('i45'), ROSTER.length, 3, 10, []);
      localStorage.setItem(PROGRESS_2D_KEY, JSON.stringify({ ids: ROSTER.map((l) => l.id), progress: won }));
      expect(loadProgress2D(ROSTER).campaignComplete).toBe(true);
      // Not won yet: no flag, not complete.
      localStorage.setItem(PROGRESS_2D_KEY, JSON.stringify({ ids: ROSTER.map((l) => l.id), progress: wonUpTo('i45') }));
      const p = loadProgress2D(ROSTER);
      expect(p.campaignComplete).toBeUndefined();
      expect(isCampaignComplete(p, ROSTER)).toBe(false);
      // A roster without the finale (today's LEVELS_2D before i45 ships) is never complete by itself.
      expect(isCampaignComplete(createDefaultProgress(3), [{ id: 'l1c' }, { id: 'i01' }, { id: 'i02' }])).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('survives migration, a reorder remap, save codes and merges (either side wins)', () => {
    const p = createDefaultProgress(ROSTER.length);
    p.campaignComplete = true;
    expect(migrateProgress(JSON.parse(JSON.stringify(p)), ROSTER.length).campaignComplete).toBe(true);
    expect(migrateProgress({ ...p, campaignComplete: 'yes' }, ROSTER.length).campaignComplete).toBeUndefined();
    const reordered = [...ROSTER].reverse();
    expect(remapProgress(p, ROSTER.map((l) => l.id), reordered).campaignComplete).toBe(true);
    const code = decodeSaveCode(encodeSaveCode(p), ROSTER.length);
    expect(code.ok && code.progress.campaignComplete).toBe(true);
    const plain = decodeSaveCode(encodeSaveCode(createDefaultProgress(ROSTER.length)), ROSTER.length);
    expect(plain.ok && plain.progress.campaignComplete).toBeUndefined();
    const fresh = createDefaultProgress(ROSTER.length);
    expect(mergeProgress(fresh, p, ROSTER.length).campaignComplete).toBe(true);
    expect(mergeProgress(p, fresh, ROSTER.length).campaignComplete).toBe(true);
    expect(mergeProgress(fresh, createDefaultProgress(ROSTER.length), ROSTER.length).campaignComplete).toBeUndefined();
  });
});

describe('"Campaign complete" card (cardsDue)', () => {
  const finished = (): ProgressData => {
    const p = wonUpTo('i45');
    run(p, 'i45');
    return p;
  };
  const chapters = (p: ProgressData) => chapterStates(islandStates(p, ROSTER));
  const seenBefore = { title: CHAPTERS.map((c) => c.id), done: ['ch1', 'ch2', 'ch3', 'ch4'] };

  it('shows once after the campaign, in place of Chapter 5’s "Chapter complete"', () => {
    const p = finished();
    const due = cardsDue(chapters(p), seenBefore, isCampaignComplete(p, ROSTER));
    expect(due.campaign).toBe(true);
    expect(due.done).toBeNull();
    expect(due.seen.campaign).toBe(true);
    expect(due.seen.done).toContain('ch5');
    const again = cardsDue(chapters(p), parseCardsSeen(JSON.stringify(due.seen))!, true);
    expect(again).toMatchObject({ campaign: false, done: null, title: null });
  });

  it('is not due before the campaign; Chapter 5’s own card still is when its finale is won without the flag', () => {
    const p = wonUpTo('i45');
    expect(cardsDue(chapters(p), seenBefore, isCampaignComplete(p, ROSTER)).campaign).toBe(false);
    const done = finished();
    const legacy = cardsDue(chapters(done), seenBefore, false);
    expect(legacy.campaign).toBe(false);
    expect(legacy.done?.id).toBe('ch5');
  });

  it('old "cards seen" records (no campaign field) parse; the field round-trips', () => {
    expect(parseCardsSeen('{"title":["ch1"],"done":[]}')).toEqual({ title: ['ch1'], done: [] });
    expect(parseCardsSeen('{"title":[],"done":[],"campaign":true}')?.campaign).toBe(true);
  });

  it('tallies the campaign and nudges to what is left', () => {
    const p = finished();
    const s = campaignSummary(islandStates(p, ROSTER));
    expect(s.islands).toBe(ROSTER.length);
    expect(s.maxStars).toBe(ROSTER.length * 3);
    expect(s.stars).toBe((ROSTER.length - 1) * 2 + 3);
    expect(s.threeStar).toBe(1);
    expect(s.hardWon).toBe(0);
    expect(campaignNudges(s).map((n) => n.id)).toEqual(['hard', 'stars', 'endless', 'daily']);
    const all = { ...s, hardWon: s.islands, threeStar: s.islands, bestEndless: 31 };
    const nudges = campaignNudges(all);
    expect(nudges.map((n) => n.id)).toEqual(['endless', 'daily']);
    setLocale('en');
    expect(t(nudges[0].key, nudges[0].params)).toContain('31');
  });
});

describe('ending art and copy', () => {
  it('declares three manifest slots and uses them when registered, placeholders otherwise', () => {
    expect([...ENDING_ART_SLOTS]).toEqual(['story-ending-1', 'story-ending-2', 'story-ending-3']);
    expect(endingArt(null)).toEqual([...ENDING_PLACEHOLDER_ART]);
    for (const url of ENDING_PLACEHOLDER_ART) expect(existsSync(resolve(ROOT, `public${url}`)), url).toBe(true);
    const art = endingArt({ paintedUi: { 'story-ending-2': 'ui/story-ending-2.webp' } });
    expect(art).toEqual([ENDING_PLACEHOLDER_ART[0], '/art2d/ui/story-ending-2.webp', ENDING_PLACEHOLDER_ART[2]]);
    expect(endingBeats({ paintedUi: { 'story-ending-1': 'ui/e1.webp' } })[0].art).toBe('/art2d/ui/e1.webp');
  });

  it('three beats in both languages, told by Pell', () => {
    for (const loc of ['en', 'tr'] as const) {
      setLocale(loc);
      const beats = endingBeats(null);
      expect(beats).toHaveLength(3);
      for (const b of beats) {
        expect(b.text.length).toBeGreaterThan(30);
        expect(b.speaker).toBe(t('story.pell'));
      }
    }
    setLocale('en');
    for (const k of Object.keys(EN).filter((k) => k.startsWith('ending.'))) expect((TR as Record<string, string>)[k], k).toBeTruthy();
  });

  it('the credits roll: title first, every role still unnamed (owner-gated), thanks last', () => {
    setLocale('en');
    const blocks = rollBlocks();
    expect(blocks[0]).toMatchObject({ kind: 'game', text: t('map.title') });
    expect(blocks[blocks.length - 1]).toMatchObject({ kind: 'thanks', text: 'Thank you for playing!' });
    expect(ROLL_ROLES.every((r) => r.who === null)).toBe(true);
    const roles = blocks.filter((b) => b.kind === 'role');
    expect(roles).toHaveLength(ROLL_ROLES.length);
    for (const r of roles) expect(r.sub).toBe(t('ending.rollTbd'));
    // The roll starts under the window and ends with the thanks line centred.
    expect(rollOffset(0, 400, 2000, 40)).toBe(400);
    expect(rollOffset(1, 400, 2000, 40)).toBe(200 + 20 - 2000);
    expect(rollOffset(2, 400, 2000, 40)).toBe(rollOffset(1, 400, 2000, 40));
  });
});

// --- DOM (happy-dom, dev-only) -------------------------------------------------------------------

let WindowCtor: (new () => unknown) | undefined;
try {
  const moduleName = 'happy-dom'; // variable specifier: not a declared dependency
  WindowCtor = ((await import(/* @vite-ignore */ moduleName)) as { Window: new () => unknown }).Window;
} catch {
  WindowCtor = undefined;
}

describe.skipIf(!WindowCtor)('ending UI (DOM)', () => {
  let now = 0;
  beforeAll(() => {
    const win = new WindowCtor!() as unknown as Window & typeof globalThis;
    const g = globalThis as unknown as Record<string, unknown>;
    for (const k of ['window', 'document', 'HTMLElement', 'HTMLButtonElement', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'getComputedStyle']) {
      g[k] = k === 'window' ? win : (win as unknown as Record<string, unknown>)[k];
    }
    g.requestAnimationFrame = () => 0;
    g.cancelAnimationFrame = () => undefined;
    setLocale('en');
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });
  const clock = (): void => {
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  };
  const q = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`);
  const key = (k: string): void => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));

  it('Chapter 5’s "Chapter complete" card promises no next chapter', async () => {
    const { showChapterDone } = await import('../../src/render2d/ui/chapterCards.ts');
    const ch5 = CHAPTERS[CHAPTERS.length - 1];
    const onNext = vi.fn();
    showChapterDone({ chapter: ch5, art: null, stars: 20, maxStars: 27, cleared: 9, total: 9, next: nextChapter(ch5), onNext, onDone: () => undefined });
    expect(q('chapter2d-next')).toBeNull();
    expect(q('chapter2d-map')).not.toBeNull();
    expect(q('chapter2d-final')?.textContent).toBe(t('chapter.doneFinal'));
    expect(q('chapter2d-done')?.textContent).not.toMatch(/Chapter 6|coming soon/i);
    q('chapter2d-map')!.click();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('the credits roll skips on a click / tap (after its guard) and on Esc', async () => {
    clock();
    const { openCreditsRoll } = await import('../../src/render2d/ui/creditsRoll2d.ts');
    now = 1000;
    const done = vi.fn();
    openCreditsRoll(done);
    expect(q('roll2d-thanks')?.textContent).toBe('Thank you for playing!');
    // The tap that opened it does not skip it.
    q('roll2d-col')!.click();
    expect(done).not.toHaveBeenCalled();
    now = 2000;
    q('roll2d-col')!.click();
    expect(done).toHaveBeenCalledTimes(1);
    q('roll2d-skip')!.click();
    expect(done).toHaveBeenCalledTimes(1);

    const done2 = vi.fn();
    now = 5000;
    openCreditsRoll(done2);
    now = 6000;
    key('Escape');
    expect(done2).toHaveBeenCalledTimes(1);
    key('Escape');
    expect(done2).toHaveBeenCalledTimes(1);
  });

  it('the ending: beats (Skip) → credits (Skip) → done, once', async () => {
    clock();
    const { playEnding } = await import('../../src/render2d/ui/ending2d.ts');
    now = 10_000;
    const done = vi.fn();
    const h = playEnding(null, done);
    expect(h.phase()).toBe('story');
    expect(document.querySelectorAll('[data-testid="ending2d"] .pu-panel')).toHaveLength(3);
    q('ending2d-skip')!.click();
    expect(h.phase()).toBe('credits');
    expect(q('roll2d')).not.toBeNull();
    now = 11_000;
    q('roll2d-skip')!.click();
    expect(h.phase()).toBe('done');
    expect(done).toHaveBeenCalledTimes(1);

    // Reading the beats to the end leads to the credits as well (closed boards fade out: clear them).
    document.body.innerHTML = '';
    const done2 = vi.fn();
    const h2 = playEnding(null, done2);
    for (let i = 0; i < 3; i++) q('ending2d-next')!.click();
    expect(h2.phase()).toBe('credits');
    now = 13_000;
    key('Enter');
    expect(done2).toHaveBeenCalledTimes(1);
  });

  it('the campaign card shows the tally and the nudges', async () => {
    const { showCampaignCard } = await import('../../src/render2d/ui/ending2d.ts');
    const done = vi.fn();
    const summary = { islands: 46, stars: 101, maxStars: 138, mastered: 7, threeStar: 12, hardWon: 3, bestEndless: 0 };
    showCampaignCard({ summary, art: null, onDone: done });
    expect(q('campaign2d-stars')?.textContent).toContain('101');
    expect(q('campaign2d-stars')?.textContent).toContain('138');
    expect(q('campaign2d-mastered')?.textContent).toBe('Isles mastered: 7/46');
    expect(document.querySelectorAll('[data-testid="campaign2d-nudges"] li')).toHaveLength(4);
    q('campaign2d-go')!.click();
    expect(done).toHaveBeenCalledTimes(1);
  });
});
