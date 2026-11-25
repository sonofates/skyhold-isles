/**
 * The campaign's chapters (docs/chapters-plan.md, Phase A): the Prologue (`l1c`, the tutorial)
 * and five chapters of nine islands each, the ninth being the chapter's finale.
 *
 * This file is the one place that decides the island ORDER: `LEVELS_2D` (levels2d/index.ts) is
 * built from it, and the campaign's "next island" is simply the next one in that order. Island ids
 * never change, so saves, stars, the Daily and challenges keep working; a chapter is only an
 * ordering and grouping layer on top of the ids.
 *
 * Unregistered chapter slots are skipped. Frostveil opens after Lastlight Head.
 *
 * Pure data, no DOM and no i18n runtime (only the message key names).
 */
import type { MsgKey } from '../i18n/en.ts';

export type ChapterId = 'prologue' | 'ch1' | 'ch2' | 'ch3' | 'ch4' | 'ch5';

/**
 * Colour grade of the chapter's sea (the world map's water): per-channel multipliers and a
 * saturation (1 = the painting as is). Small on purpose: the painted sea keeps its look.
 */
export type SeaGrade = readonly [r: number, g: number, b: number, saturation: number];

export interface ChapterDef {
  readonly id: ChapterId;
  /** 0 = the Prologue, 1-5 = the chapters. */
  readonly n: number;
  readonly nameKey: MsgKey;
  /** One line for the chapter's title card. */
  readonly blurbKey: MsgKey;
  /** Island ids in play order (slots; an unregistered id is skipped). */
  readonly islands: readonly string[];
  /** The island whose win completes the chapter (and opens the next one). */
  readonly finale: string | null;
  /** Last published slot when the rest of this chapter is still in production. */
  readonly playableThrough?: string;
  /** `soon` = on the chart, fogged, no islands yet. */
  readonly status: 'playable' | 'soon';
  /** Accent colour of the chapter's tab and cards (css). */
  readonly accent: string;
  readonly sea: SeaGrade;
}

export const PROLOGUE: ChapterDef = {
  id: 'prologue',
  n: 0,
  nameKey: 'chapter.prologue.name',
  blurbKey: 'chapter.prologue.blurb',
  islands: ['l1c'],
  finale: 'l1c',
  status: 'playable',
  accent: '#7fae4a',
  sea: [1, 1, 1, 1],
};

export const CHAPTERS: readonly ChapterDef[] = [
  {
    id: 'ch1',
    n: 1,
    nameKey: 'chapter.ch1.name',
    blurbKey: 'chapter.ch1.blurb',
    islands: ['i01', 'i02', 'i03', 'i04', 'i05', 'i06', 'i07', 'i08', 'i09'],
    finale: 'i09',
    status: 'playable',
    accent: '#e0a82e',
    sea: [1, 1, 1, 1],
  },
  {
    id: 'ch2',
    n: 2,
    nameKey: 'chapter.ch2.name',
    blurbKey: 'chapter.ch2.blurb',
    // Two new islands (i25, i26) sit before the finale; until they are registered they are skipped.
    islands: ['i10', 'i11', 'i12', 'i13', 'i14', 'i15', 'i25', 'i26', 'i16'],
    finale: 'i16',
    status: 'playable',
    accent: '#5b84c4',
    sea: [0.8, 0.88, 1.05, 0.72],
  },
  {
    id: 'ch3',
    n: 3,
    nameKey: 'chapter.ch3.name',
    blurbKey: 'chapter.ch3.blurb',
    islands: ['i17', 'i18', 'i19', 'i20', 'i21', 'i22', 'i23', 'i27', 'i24'],
    finale: 'i24',
    status: 'playable',
    accent: '#d9733a',
    sea: [1.12, 0.98, 0.8, 0.95],
  },
  {
    id: 'ch4',
    n: 4,
    nameKey: 'chapter.ch4.name',
    blurbKey: 'chapter.ch4.blurb',
    islands: ['i28', 'i29', 'i30', 'i31', 'i32', 'i33', 'i34', 'i35', 'i36'],
    finale: 'i36',
    playableThrough: 'i33',
    status: 'playable',
    accent: '#7cc3d8',
    sea: [0.96, 1.06, 1.15, 0.5],
  },
  {
    id: 'ch5',
    n: 5,
    nameKey: 'chapter.ch5.name',
    blurbKey: 'chapter.ch5.blurb',
    islands: [],
    finale: null,
    status: 'soon',
    accent: '#8a6cc8',
    sea: [0.78, 0.68, 1.0, 0.7],
  },
];

/** Every island slot in campaign order: the Prologue, then each chapter's islands. */
export const CAMPAIGN_ORDER: readonly string[] = [...PROLOGUE.islands, ...CHAPTERS.flatMap((c) => c.islands)];

/** Published slots for metadata consumers that do not load the 2D game. */
export const PLAYABLE_ISLAND_IDS = [PROLOGUE, ...CHAPTERS].filter(c => c.status === 'playable')
  .flatMap(c => c.playableThrough ? c.islands.slice(0, c.islands.indexOf(c.playableThrough) + 1) : c.islands);

/**
 * The flat 2D island order every save before chapters was written in (`l1c`, `i01`-`i24`). A save
 * that never recorded its id order is read in this order (islands were only ever appended to it).
 */
export const LEGACY_2D_ORDER: readonly string[] = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];

/**
 * The islands of `pool` in campaign order (chapter slots whose island is not in the pool are
 * skipped). Islands of the pool that no chapter lists are left out.
 */
export function orderByChapters<T extends { readonly id: string }>(pool: readonly T[]): T[] {
  const byId = new Map(pool.map((l) => [l.id, l] as const));
  const out: T[] = [];
  for (const id of CAMPAIGN_ORDER) {
    const l = byId.get(id);
    if (l) out.push(l);
  }
  return out;
}

/** The chapter (or the Prologue) an island belongs to; null for an id no chapter lists. */
export function chapterOf(islandId: string): ChapterDef | null {
  if (PROLOGUE.islands.includes(islandId)) return PROLOGUE;
  return CHAPTERS.find((c) => c.islands.includes(islandId)) ?? null;
}

/** The chapter after `c` (null after the last one). The Prologue leads into Chapter 1. */
export function nextChapter(c: ChapterDef): ChapterDef | null {
  return CHAPTERS.find((x) => x.n === c.n + 1) ?? null;
}

/** The free version's scope on mobile (owner decision 2026-11-24): the Prologue + Chapter 1. */
export function freeIslandIds(): string[] {
  return [...PROLOGUE.islands, ...CHAPTERS[0].islands];
}

/** One world-map page: a chapter and the indexes (into `ids`) of the islands drawn on it. */
export interface ChapterPage {
  readonly chapter: ChapterDef;
  /** Indexes into the island list, in route order (Chapter 1's page leads with the Prologue). */
  readonly indexes: readonly number[];
  /** Indexes of the chapter's own islands (Chapter 1 without the Prologue). */
  readonly own: readonly number[];
}

/**
 * Splits an island list (ids in `LEVELS_2D` order) into one page per chapter. The Prologue sits
 * on Chapter 1's page, before i01. Ids no chapter lists (the ?mockislands QA stand-ins) go on the
 * last page that has islands. Chapters with no islands ("coming soon") get an empty page.
 */
export function chapterPages(ids: readonly string[]): ChapterPage[] {
  const pages = CHAPTERS.map((chapter) => ({ chapter, indexes: [] as number[], own: [] as number[] }));
  const stray: number[] = [];
  const prologue: number[] = [];
  ids.forEach((id, i) => {
    if (PROLOGUE.islands.includes(id)) {
      prologue.push(i);
      return;
    }
    const p = pages.find((pg) => pg.chapter.islands.includes(id));
    if (p) {
      p.indexes.push(i);
      p.own.push(i);
    } else stray.push(i);
  });
  pages[0].indexes.unshift(...prologue);
  if (stray.length > 0) {
    const last = [...pages].reverse().find((p) => p.indexes.length > 0) ?? pages[0];
    last.indexes.push(...stray);
    last.own.push(...stray);
  }
  return pages;
}

/** The page (index into `chapterPages`) that holds island index `i` (0 when none does). */
export function pageOfIsland(pages: readonly ChapterPage[], i: number): number {
  const p = pages.findIndex((pg) => pg.indexes.includes(i));
  return p < 0 ? 0 : p;
}
