/**
 * Storybook card: 2-3 painted panels (a vignette of the island's map + a line of story each),
 * revealed one at a time. "Next" reveals the next panel, the last one closes; "Skip" closes at once.
 */
import type { LevelDef } from '../../data/levels/types.ts';
import { islandName } from '../../i18n/data.ts';
import { t } from '../../i18n/index.ts';
import { el, openSheet, plank } from './dom.ts';
import { vignetteStyle } from './islandArt.ts';
import { defaultFocus, type StoryBeat, type StoryPart } from './storyBeats.ts';

export interface StoryCard {
  close(): void;
  /** Panels revealed so far (QA). */
  revealed(): number;
}

export function showStory(level: LevelDef, part: StoryPart, beats: readonly StoryBeat[], mapUrl: string | null, onDone: () => void): StoryCard {
  const sheet = openSheet(islandName(level), { cls: 'pu-story', testid: 'story2d', onClose: onDone, modal: true, closeButton: false });
  const kicker = el('div', 'pu-story-kicker pu-ink-soft', {}, part === 'intro' ? t('story.before') : t('story.after'));
  const strip = el('div', 'pu-story-strip');
  const panels: HTMLDivElement[] = [];
  const vignettes: HTMLDivElement[] = [];
  beats.forEach((b, i) => {
    const p = el('div', 'pu-panel pu-card pending', { 'data-beat': i });
    const v = el('div', 'pu-vignette');
    if (mapUrl) v.style.backgroundImage = `url("${mapUrl}")`;
    v.append(el('span', 'pu-vignette-num pu-letter', {}, String(i + 1)));
    const text = el('div', 'pu-panel-text');
    if (b.speaker) text.append(el('b', '', {}, b.speaker));
    text.append(b.text);
    p.append(v, text);
    strip.append(p);
    panels.push(p);
    vignettes.push(v);
  });
  const skip = plank(t('story.skip'), { kind: 'small', testid: 'story2d-skip' });
  const next = plank(t('story.next'), { kind: 'primary', icon: 'play', testid: 'story2d-next' });
  const actions = el('div', 'pu-story-actions', {}, skip, next);
  sheet.body.append(kicker, strip, actions);

  const imageSize = level.layout2d?.imageSize ?? ([1846, 852] as const);
  const frame = (): void => {
    vignettes.forEach((v, i) => {
      // Layout size (not getBoundingClientRect: the card pops in with a scale transform).
      const bw = v.clientWidth;
      const bh = v.clientHeight;
      if (bw < 2 || !mapUrl) return;
      const st = vignetteStyle(imageSize, beats[i].focus ?? defaultFocus(i, beats.length), bw, bh);
      v.style.backgroundSize = st.size;
      v.style.backgroundPosition = st.position;
    });
  };
  let shown = 0;
  const reveal = (): void => {
    panels.forEach((p, i) => {
      p.classList.toggle('pending', i >= shown);
      p.classList.toggle('current', i === shown - 1);
    });
    const last = shown >= panels.length;
    next.querySelector('span:last-child')!.textContent = last ? (part === 'intro' ? t('story.toBattle') : t('story.onward')) : t('story.next');
  };
  const advance = (): void => {
    if (shown >= panels.length) {
      sheet.close();
      return;
    }
    shown++;
    reveal();
  };
  skip.addEventListener('click', () => sheet.close());
  next.addEventListener('click', advance);
  // Tapping a panel area also turns the page.
  strip.addEventListener('click', advance);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(frame) : null;
  for (const v of vignettes) ro?.observe(v);
  requestAnimationFrame(frame);
  advance();
  return {
    close: () => {
      ro?.disconnect();
      sheet.close();
    },
    revealed: () => shown,
  };
}
