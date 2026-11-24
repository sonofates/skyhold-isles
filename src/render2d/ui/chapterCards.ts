/**
 * Chapter cards on the world map, in the storybook card's style (storyPanels.ts, one-beat "book
 * spread": the painting on the left page, the words on the right):
 * - the title card when a chapter first opens (the painting of its first island's intro story),
 * - "Chapter complete" after its finale is won (the finale's outro painting, the chapter's stars,
 *   and the next chapter button, or the "coming soon" line before chapters 4-5 exist).
 * Which card is due is decided in chapterState.ts (`cardsDue`).
 */
import type { ChapterDef } from '../../data/chapters.ts';
import { t } from '../../i18n/index.ts';
import { el, img, KIT, openSheet, plank, starsRow } from './dom.ts';
import './chapterCards.css';

export interface ChapterCard {
  close(): void;
}

function spread(art: string | null, accent: string, ...words: (HTMLElement | null)[]): HTMLElement {
  const v = el('div', 'pu-vignette pu-chapter-art');
  if (art) v.style.background = `center / cover no-repeat url("${art}")`;
  const text = el('div', 'pu-panel-text pu-chapter-words', {}, ...words);
  const panel = el('div', 'pu-panel pu-card current pu-chapter-panel', {}, v, text);
  panel.style.setProperty('--chapter-accent', accent);
  return el('div', 'pu-story-strip', {}, panel);
}

/** The title card of a chapter that just opened. `art` = its first island's story painting. */
export function showChapterTitle(chapter: ChapterDef, art: string | null, onDone: () => void): ChapterCard {
  const label = t('chapter.label', { n: chapter.n });
  const sheet = openSheet(label, { cls: 'pu-story pu-chapter-card', testid: 'chapter2d-title', onClose: onDone, modal: true, closeButton: false });
  const kicker = el('div', 'pu-story-kicker pu-ink-soft', {}, t('chapter.cardKicker'));
  const name = el('div', 'pu-chapter-name pu-letter', { 'data-testid': 'chapter2d-name' }, t(chapter.nameKey));
  const blurb = el('div', 'pu-chapter-blurb', {}, t(chapter.blurbKey));
  const go = plank(t('chapter.cardGo'), { kind: 'primary', icon: 'play', testid: 'chapter2d-go' });
  go.dataset.navDefault = '';
  go.addEventListener('click', () => sheet.close());
  sheet.body.append(kicker, spread(art, chapter.accent, name, blurb), el('div', 'pu-story-actions pu-chapter-actions', {}, go));
  return { close: () => sheet.close() };
}

export interface ChapterDoneOptions {
  readonly chapter: ChapterDef;
  /** The finale's outro painting. */
  readonly art: string | null;
  readonly stars: number;
  readonly maxStars: number;
  readonly cleared: number;
  readonly total: number;
  /** The chapter after this one (null after the last). */
  readonly next: ChapterDef | null;
  /** Pressed the next chapter button (only offered when `next` is playable). */
  readonly onNext: () => void;
  /** Closed (after `onNext` when that was the button). */
  readonly onDone: () => void;
}

/** "Chapter complete": the chapter's stars, its islands, then on to the next chapter. */
export function showChapterDone(o: ChapterDoneOptions): ChapterCard {
  let next = false;
  const sheet = openSheet(t('chapter.doneTitle'), {
    cls: 'pu-story pu-chapter-card done',
    testid: 'chapter2d-done',
    onClose: () => {
      if (next) o.onNext();
      o.onDone();
    },
    modal: true,
    closeButton: false,
  });
  const kicker = el('div', 'pu-story-kicker pu-ink-soft', {}, t('chapter.label', { n: o.chapter.n }));
  const name = el('div', 'pu-chapter-name pu-letter', {}, t(o.chapter.nameKey));
  // Stars as a ratio of three-star stamps (full / partial), then the exact tally.
  const share = o.maxStars > 0 ? o.stars / o.maxStars : 0;
  const row = starsRow(share >= 0.999 ? 3 : share >= 0.66 ? 2 : share > 0 ? 1 : 0, 'pu-stars pu-chapter-stars');
  const tally = el(
    'div',
    'pu-chapter-tally pu-letter',
    { 'data-testid': 'chapter2d-stars', 'aria-label': t('chapter.doneStarsAria', { n: o.stars, max: o.maxStars }) },
    img(KIT.star),
    el('b', '', {}, String(o.stars)),
    el('small', '', {}, `/ ${o.maxStars}`),
  );
  const islands = el('div', 'pu-chapter-blurb', {}, t('chapter.doneIslands', { done: o.cleared, total: o.total }));
  const soon = o.next && o.next.status === 'soon' ? el('div', 'pu-chapter-blurb soon', {}, t('chapter.doneSoon', { n: o.next.n })) : null;
  const playable = o.next && o.next.status === 'playable';
  const main = playable && o.next
    ? plank(t('chapter.doneNext', { n: o.next.n }), { kind: 'primary', icon: 'next', testid: 'chapter2d-next' })
    : plank(t('chapter.doneMap'), { kind: 'primary', icon: 'islands', testid: 'chapter2d-map' });
  main.dataset.navDefault = '';
  main.addEventListener('click', () => {
    next = !!playable;
    sheet.close();
  });
  sheet.body.append(
    kicker,
    spread(o.art, o.chapter.accent, name, el('div', 'pu-chapter-starline', {}, row, tally), islands, soon),
    el('div', 'pu-story-actions pu-chapter-actions', {}, main),
  );
  return { close: () => sheet.close() };
}
