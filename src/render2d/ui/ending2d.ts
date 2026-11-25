/**
 * The game's ending (docs/handoff-ending.md): what happens once the last chapter's finale
 * (`campaignFinaleId()` in data/chapters.ts, i45 today) is won for the first time.
 *
 * 1. Three story beats in the storybook card (storyPanels.ts): the eclipse breaks, the first light
 *    returns to Skyhold, the isles are rebuilt. Each beat's painting is the manifest slot
 *    `paintedUi['story-ending-N']` when it is registered (`ENDING_ART_SLOTS`), else a placeholder:
 *    an existing story painting (`ENDING_PLACEHOLDER_ART`). Painting the slots needs no code change.
 * 2. The credits roll (creditsRoll2d.ts), skippable.
 * 3. Back on the world map: the one-time "Campaign complete" card (chapterState.ts `cardsDue`),
 *    with the campaign's stars, mastered isles and nudges to what is left.
 *
 * The trigger is the `campaignComplete` hook of the 2D save (progress2d.ts: the save flag
 * `ProgressData.campaignComplete`, and `RunResultRecord2D.campaignComplete` on the winning run).
 * The full sequence never plays again on its own; Settings → General → "The ending" replays it.
 */
import { CHAPTERS } from '../../data/chapters.ts';
import { t, type MsgKey, type Params } from '../../i18n/index.ts';
import { spread } from './chapterCards.ts';
import { openCreditsRoll, type CreditsRoll } from './creditsRoll2d.ts';
import { el, img, KIT, openSheet, plank, starsRow } from './dom.ts';
import type { MapsManifest } from './islandArt.ts';
import type { IslandState } from './progress2d.ts';
import type { StoryBeat } from './storyBeats.ts';
import { showStory, type StoryCard } from './storyPanels.ts';
import './ending2d.css';

/** Manifest slots (`paintedUi`) of the three ending paintings, in beat order. */
export const ENDING_ART_SLOTS = ['story-ending-1', 'story-ending-2', 'story-ending-3'] as const;

/**
 * Placeholders until the slots are painted: light breaking through the sundial (i41), Skyhold on its
 * hill (the Prologue), a beacon lit again (i09).
 */
export const ENDING_PLACEHOLDER_ART: readonly string[] = [
  '/art2d/ui/story-i41-outro-1.webp',
  '/art2d/ui/story-l1c-intro-1.webp',
  '/art2d/ui/story-i09-outro-1.webp',
];

const BEAT_KEYS: readonly MsgKey[] = ['ending.beat1', 'ending.beat2', 'ending.beat3'];

/** The painting of each ending beat: its manifest slot when registered, else the placeholder. */
export function endingArt(manifest: Pick<MapsManifest, 'paintedUi'> | null, baseUrl = '/art2d/'): string[] {
  const pu = (manifest?.paintedUi ?? {}) as Readonly<Record<string, unknown>>;
  return ENDING_ART_SLOTS.map((slot, i) => {
    const file = pu[slot];
    return typeof file === 'string' && file ? baseUrl + file : ENDING_PLACEHOLDER_ART[i];
  });
}

/** The three ending beats, told by Warden Pell like the islands' stories. */
export function endingBeats(manifest: Pick<MapsManifest, 'paintedUi'> | null, baseUrl = '/art2d/'): StoryBeat[] {
  const art = endingArt(manifest, baseUrl);
  return BEAT_KEYS.map((key, i) => ({ text: t(key), speaker: t('story.pell'), portrait: KIT.portraitPell, art: art[i] }));
}

export interface EndingHandle {
  close(): void;
  /** `story` while the beats show, `credits` while the roll runs, `done` after. */
  phase(): 'story' | 'credits' | 'done';
  /** The roll (QA: seek / pause), once it runs. */
  roll(): CreditsRoll | null;
}

declare global {
  interface Window {
    /** QA: the ending sequence on screen (ending2d.ts). */
    __ending?: EndingHandle;
  }
}

/**
 * Plays the ending: the three beats, then the credits roll, then `onDone` (after a skip too).
 * `startAt: 'credits'` goes straight to the roll (QA).
 */
export function playEnding(
  manifest: Pick<MapsManifest, 'paintedUi'> | null,
  onDone: () => void,
  opts: { readonly baseUrl?: string; readonly startAt?: 'story' | 'credits' } = {},
): EndingHandle {
  let phase: 'story' | 'credits' | 'done' = 'story';
  let story: StoryCard | null = null;
  let roll: CreditsRoll | null = null;
  const finish = (): void => {
    if (phase === 'done') return;
    phase = 'done';
    onDone();
  };
  const toCredits = (): void => {
    if (phase !== 'story') return;
    phase = 'credits';
    roll = openCreditsRoll(finish);
  };
  const handle: EndingHandle = {
    close: () => {
      if (phase === 'story') story?.close();
      else if (phase === 'credits') roll?.close();
    },
    phase: () => phase,
    roll: () => roll,
  };
  if (typeof window !== 'undefined') window.__ending = handle;
  if (opts.startAt === 'credits') toCredits();
  else {
    story = showStory(null, 'outro', endingBeats(manifest, opts.baseUrl), null, toCredits, {
      title: t('ending.title'),
      kicker: t('ending.kicker'),
      lastLabel: t('ending.toCredits'),
      testid: 'ending2d',
    });
  }
  return handle;
}

// --- "Campaign complete" card ------------------------------------------------------------------

export interface CampaignSummary {
  readonly islands: number;
  readonly stars: number;
  readonly maxStars: number;
  readonly mastered: number;
  readonly threeStar: number;
  readonly hardWon: number;
  /** Best Endless wave on any isle (0 = never reached Endless). */
  readonly bestEndless: number;
}

/** The campaign's tally over every registered island (the Prologue included). Pure. */
export function campaignSummary(states: readonly IslandState[]): CampaignSummary {
  return {
    islands: states.length,
    stars: states.reduce((a, s) => a + s.stars, 0),
    maxStars: states.length * 3,
    mastered: states.filter((s) => s.mastered).length,
    threeStar: states.filter((s) => s.stars >= 3).length,
    hardWon: states.filter((s) => s.hardWon).length,
    bestEndless: states.reduce((a, s) => Math.max(a, s.bestEndlessWave), 0),
  };
}

export interface Nudge {
  readonly id: 'hard' | 'stars' | 'endless' | 'daily';
  readonly key: MsgKey;
  readonly params?: Params;
}

/**
 * Gentle nudges to what is left after the campaign: Hard ribbons and three-star isles while some
 * are missing, then Endless (with the best wave once there is one) and the Daily Squall. Pure.
 */
export function campaignNudges(s: CampaignSummary): Nudge[] {
  const out: Nudge[] = [];
  if (s.hardWon < s.islands) out.push({ id: 'hard', key: 'ending.nudgeHard', params: { n: s.hardWon, total: s.islands } });
  if (s.threeStar < s.islands) out.push({ id: 'stars', key: 'ending.nudgeStars', params: { n: s.threeStar, total: s.islands } });
  out.push(s.bestEndless > 0 ? { id: 'endless', key: 'ending.nudgeEndlessBest', params: { n: s.bestEndless } } : { id: 'endless', key: 'ending.nudgeEndless' });
  out.push({ id: 'daily', key: 'ending.nudgeDaily' });
  return out;
}

export interface CampaignCardOptions {
  readonly summary: CampaignSummary;
  /** The card's painting (the third ending beat's). */
  readonly art: string | null;
  readonly onDone: () => void;
}

/** "Campaign complete!": total stars, mastered isles, and what is still out there. */
export function showCampaignCard(o: CampaignCardOptions): { close(): void } {
  const s = o.summary;
  const sheet = openSheet(t('ending.cardTitle'), {
    cls: 'pu-story pu-chapter-card done pu-campaign-card',
    testid: 'campaign2d',
    onClose: o.onDone,
    modal: true,
    closeButton: false,
  });
  const kicker = el('div', 'pu-story-kicker pu-ink-soft', {}, t('ending.cardKicker'));
  const name = el('div', 'pu-chapter-name pu-letter', {}, t('ending.cardName'));
  const share = s.maxStars > 0 ? s.stars / s.maxStars : 0;
  const row = starsRow(share >= 0.999 ? 3 : share >= 0.66 ? 2 : share > 0 ? 1 : 0, 'pu-stars pu-chapter-stars');
  const tally = el(
    'div',
    'pu-chapter-tally pu-ink',
    { 'data-testid': 'campaign2d-stars', 'aria-label': t('ending.cardStarsAria', { n: s.stars, max: s.maxStars }) },
    img(KIT.star),
    el('b', '', {}, String(s.stars)),
    el('small', '', {}, `/ ${s.maxStars}`),
  );
  const mastered = el('div', 'pu-chapter-blurb', { 'data-testid': 'campaign2d-mastered' }, t('ending.cardMastered', { n: s.mastered, total: s.islands }));
  const list = el('ul', 'pu-campaign-nudges', { 'data-testid': 'campaign2d-nudges' });
  for (const n of campaignNudges(s)) list.append(el('li', 'pu-ink', { 'data-nudge': n.id }, t(n.key, n.params)));
  const left = el('div', 'pu-campaign-left', {}, el('div', 'pu-campaign-left-head pu-ink-soft', {}, t('ending.cardLeft')), list);
  const go = plank(t('ending.cardGo'), { kind: 'primary', icon: 'islands', testid: 'campaign2d-go' });
  go.dataset.navDefault = '';
  go.addEventListener('click', () => sheet.close());
  const accent = CHAPTERS[CHAPTERS.length - 1]?.accent ?? '#f2b33d';
  sheet.body.append(
    kicker,
    spread(o.art, accent, name, el('div', 'pu-chapter-starline', {}, row, tally), mastered, left),
    el('div', 'pu-story-actions pu-chapter-actions', {}, go),
  );
  return { close: () => sheet.close() };
}
