/**
 * Chapter progress on the world map (pure, no DOM): which chapters are open, complete, their star
 * tallies, and which chapter cards (title card / "Chapter complete") are due on this map visit.
 *
 * Unlocking stays the campaign's single frontier over `LEVELS_2D` (progress2d.ts): the islands run
 * in chapter order and each chapter's finale is its last island, so winning a finale is exactly
 * what opens the next chapter's first island. A chapter counts as open as soon as any of its own
 * islands is unlocked; nothing here can lock an island the save already reached.
 */
import { chapterPages, nextChapter, type ChapterDef, type ChapterPage } from '../../data/chapters.ts';
import type { IslandState } from './progress2d.ts';

export interface ChapterState {
  readonly chapter: ChapterDef;
  readonly page: ChapterPage;
  /** Any of the chapter's own islands is unlocked (always false for a "coming soon" chapter). */
  readonly opened: boolean;
  /** The finale was won (the last registered island when the finale is missing). */
  readonly complete: boolean;
  /** Any of its own islands was won at least once. */
  readonly played: boolean;
  /** Own islands won at least once / registered own islands. */
  readonly cleared: number;
  readonly total: number;
  readonly stars: number;
  readonly maxStars: number;
  /** The frontier island (where the ship is) is on this chapter's page. */
  readonly frontier: boolean;
}

export function chapterStates(states: readonly IslandState[]): ChapterState[] {
  const pages = chapterPages(states.map((s) => s.level.id));
  return pages.map((page) => {
    const chapter = page.chapter;
    const own = page.own.map((i) => states[i]).filter((s): s is IslandState => !!s);
    const finale = own.find((s) => s.level.id === chapter.finale) ?? own[own.length - 1];
    return {
      chapter,
      page,
      opened: chapter.status === 'playable' && own.some((s) => s.unlocked),
      complete: !!finale && finale.clears > 0,
      played: own.some((s) => s.clears > 0),
      cleared: own.filter((s) => s.clears > 0).length,
      total: own.length,
      stars: own.reduce((a, s) => a + s.stars, 0),
      maxStars: own.length * 3,
      frontier: page.indexes.some((i) => states[i]?.frontier),
    };
  });
}

/** The page the map opens on: the frontier's chapter (Chapter 1 while the Prologue is the frontier). */
export function frontierPage(chapters: readonly ChapterState[]): number {
  const i = chapters.findIndex((c) => c.frontier);
  return i < 0 ? 0 : i;
}

/** Chapter cards already shown (localStorage), by chapter id. */
export interface CardsSeen {
  readonly title: readonly string[];
  readonly done: readonly string[];
}

export interface CardsDue {
  /** Show "Chapter complete" for this chapter first (null: none). */
  readonly done: ChapterDef | null;
  /** Then the title card of this chapter (null: none). */
  readonly title: ChapterDef | null;
  /** What to store as seen (everything due now, plus cards skipped silently). */
  readonly seen: CardsSeen;
}

/**
 * Which chapter cards to show on this map visit, at most one of each kind:
 * - "Chapter complete" for a chapter whose finale is won, once, and only while the next chapter
 *   is untouched (just finished). An old save that is already further along marks it seen silently.
 * - The title card of an open chapter none of whose islands was won yet (just opened), once.
 *   Chapters a save already plays in are marked seen silently: no stack of cards after an update.
 */
export function cardsDue(chapters: readonly ChapterState[], seen: CardsSeen): CardsDue {
  const title = new Set(seen.title);
  const done = new Set(seen.done);
  let showDone: ChapterDef | null = null;
  let showTitle: ChapterDef | null = null;
  for (const c of chapters) {
    const id = c.chapter.id;
    if (c.complete && !done.has(id)) {
      done.add(id);
      const next = nextChapter(c.chapter);
      const nextState = next ? chapters.find((x) => x.chapter.id === next.id) : undefined;
      if (!nextState?.played) showDone = c.chapter;
    }
    if (c.opened && !title.has(id)) {
      title.add(id);
      if (!c.played) showTitle = c.chapter;
    }
  }
  // Only the latest of each kind (a fresh update could find two "just opened" chapters).
  return { done: showDone, title: showTitle, seen: { title: [...title], done: [...done] } };
}

export function parseCardsSeen(raw: string | null): CardsSeen | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<CardsSeen> | null;
    const list = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
    return v && typeof v === 'object' ? { title: list(v.title), done: list(v.done) } : null;
  } catch {
    return null;
  }
}

/** The first island of a chapter (for its title card painting). */
export function firstIsland(c: ChapterState, states: readonly IslandState[]): IslandState | undefined {
  return states[c.page.own[0] ?? -1];
}
