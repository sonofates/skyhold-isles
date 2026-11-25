/**
 * Story beats for the storybook panels shown before an island's first play and after a win.
 *
 * Source of truth is the level data: a `story` field on the island's `LevelDef` (not in the type
 * yet — the content owner adds it), in any of these shapes:
 *
 *   story: { intro: StoryBeat[] | string[], outro: StoryBeat[] | string[] }
 *
 * where a beat is `{ text, speaker?, portrait?, art?, focus?: [fx, fy] }` (`focus` = where the panel's
 * vignette looks on the island's painted map, as fractions of the map image; default: spread across
 * the map; `portrait` = URL of the speaker's round portrait, shown left of the caption).
 *
 * Until the data carries stories, two placeholder tables below fill in, and level data always wins:
 * - `PLACEHOLDER_STORY`: hand-written beats for the P0 island (l1c), 3 intro + 2 outro paintings.
 * - `GENERIC_STORY_ISLANDS`: every campaign island with a painted intro / outro (`story-<id>-intro-1`,
 *   `story-<id>-outro-1` in `public/art2d/ui/`). One beat per part, a neutral caption built from
 *   the island's own name and subtitle (`story.generic.*` in the i18n dictionaries).
 *   REAL COPY GOES HERE: give the island a `story` in its level data (or an entry in
 *   `PLACEHOLDER_STORY`) and the generic caption is no longer used for it.
 */
import type { LevelDef } from '../../data/levels/types.ts';
import { islandName, islandSubtitle } from '../../i18n/data.ts';
import { t, type MsgKey, type Params } from '../../i18n/index.ts';

export type StoryPart = 'intro' | 'outro';

export interface StoryBeat {
  /** URL of a painted panel illustration. */
  readonly art?: string;
  readonly text: string;
  readonly speaker?: string;
  /** URL of the speaker's round portrait (left of the caption). */
  readonly portrait?: string;
  /** Vignette centre on the island map, fractions of the image (0..1). */
  readonly focus?: readonly [number, number];
}

/**
 * Placeholder copy (original, short) until the level data has its own `story`. The words live in
 * the i18n dictionaries (story.<island>.*), so the placeholder reads in the player's language.
 */
interface PlaceholderBeat {
  readonly art?: string;
  readonly key: MsgKey;
  readonly params?: Params;
  readonly speaker?: MsgKey;
  readonly portrait?: string;
  readonly focus?: readonly [number, number];
}

/** The recurring narrator of the placeholder beats. */
const PELL = { speaker: 'story.pell', portrait: '/art2d/ui/portrait-pell.webp' } as const;
const PLACEHOLDER_STORY: Readonly<Record<string, Partial<Record<StoryPart, readonly PlaceholderBeat[]>>>> = {
  i25: {
    intro: [{ ...PELL, key: 'story.i25.intro', art: '/art2d/ui/story-i25-intro-1.webp' }],
    outro: [{ ...PELL, key: 'story.i25.outro', art: '/art2d/ui/story-i25-outro-1.webp' }],
  },
  i26: {
    intro: [{ ...PELL, key: 'story.i26.intro', art: '/art2d/ui/story-i26-intro-1.webp' }],
    outro: [{ ...PELL, key: 'story.i26.outro', art: '/art2d/ui/story-i26-outro-1.webp' }],
  },
  i27: {
    intro: [{ ...PELL, key: 'story.i27.intro', art: '/art2d/ui/story-i27-intro-1.webp' }],
    outro: [{ ...PELL, key: 'story.i27.outro', art: '/art2d/ui/story-i27-outro-1.webp' }],
  },
  i28: {
    intro: [{ ...PELL, key: 'story.i28.intro', art: '/art2d/ui/story-i28-intro-1.webp' }],
    outro: [{ ...PELL, key: 'story.i28.outro', art: '/art2d/ui/story-i28-outro-1.webp' }],
  },
  i29: {
    intro: [{ ...PELL, key: 'story.i29.intro', art: '/art2d/ui/story-i29-intro-1.webp' }],
    outro: [{ ...PELL, key: 'story.i29.outro', art: '/art2d/ui/story-i29-outro-1.webp' }],
  },
  i30: {
    intro: [{ ...PELL, key: 'story.i30.intro', art: '/art2d/ui/story-i30-intro-1.webp' }],
    outro: [{ ...PELL, key: 'story.i30.outro', art: '/art2d/ui/story-i30-outro-1.webp' }],
  },
  i31: {
    intro: [{ ...PELL, key: 'story.i31.intro', art: '/art2d/ui/story-i31-intro-1.webp' }],
    outro: [{ ...PELL, key: 'story.i31.outro', art: '/art2d/ui/story-i31-outro-1.webp' }],
  },
  i32: {
    intro: [{ ...PELL, key: 'story.i32.intro', art: '/art2d/ui/story-i32-intro-1.webp' }],
    outro: [{ ...PELL, key: 'story.i32.outro', art: '/art2d/ui/story-i32-outro-1.webp' }],
  },
  i33: {
    intro: [{ ...PELL, key: 'story.i33.intro', art: '/art2d/ui/story-i33-intro-1.webp' }],
    outro: [{ ...PELL, key: 'story.i33.outro', art: '/art2d/ui/story-i33-outro-1.webp' }],
  },
  l1c: {
    intro: [
      { ...PELL, key: 'story.l1c.intro.1', art: '/art2d/ui/story-l1c-intro-1.webp', focus: [0.12, 0.25] },
      { ...PELL, key: 'story.l1c.intro.2', art: '/art2d/ui/story-l1c-intro-2.webp', focus: [0.45, 0.6] },
      { ...PELL, key: 'story.l1c.intro.3', art: '/art2d/ui/story-l1c-intro-3.webp', focus: [0.85, 0.55] },
    ],
    outro: [
      { ...PELL, key: 'story.l1c.outro.1', art: '/art2d/ui/story-l1c-outro-1.webp', focus: [0.87, 0.24] },
      { ...PELL, key: 'story.l1c.outro.2', art: '/art2d/ui/story-l1c-outro-2.webp', focus: [0.15, 0.45] },
    ],
  },
};

/** Campaign islands that have a painted intro and outro but no written story yet. */
export const GENERIC_STORY_ISLANDS: readonly string[] = Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`);

/** One beat per part: the island's painting and a neutral caption from its name and subtitle. */
function genericBeats(level: StoryLevel, part: StoryPart): PlaceholderBeat[] {
  if (!GENERIC_STORY_ISLANDS.includes(level.id)) return [];
  const name = level.name ? islandName({ id: level.id, name: level.name }) : '';
  const sub = level.subtitle ? islandSubtitle({ id: level.id, subtitle: level.subtitle }).replace(/[.!…\s]+$/u, '') : '';
  if (!name) return [];
  const key: MsgKey = part === 'intro' ? (sub ? 'story.generic.intro' : 'story.generic.introShort') : 'story.generic.outro';
  return [{ ...PELL, key, params: { name, subtitle: sub }, art: `/art2d/ui/story-${level.id}-${part}-1.webp` }];
}

const placeholderBeats = (beats: readonly PlaceholderBeat[]): StoryBeat[] =>
  beats.map((b) => ({
    text: t(b.key, b.params),
    ...(b.art ? { art: b.art } : {}),
    ...(b.speaker ? { speaker: t(b.speaker) } : {}),
    ...(b.portrait ? { portrait: b.portrait } : {}),
    ...(b.focus ? { focus: b.focus } : {}),
  }));

function normBeat(v: unknown): StoryBeat | null {
  if (typeof v === 'string') return v.trim() ? { text: v.trim() } : null;
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  if (!text) return null;
  const speaker = typeof o.speaker === 'string' && o.speaker.trim() ? o.speaker.trim() : undefined;
  const f = o.focus;
  const focus =
    Array.isArray(f) && f.length === 2 && f.every((n) => typeof n === 'number' && Number.isFinite(n))
      ? ([Math.max(0, Math.min(1, f[0] as number)), Math.max(0, Math.min(1, f[1] as number))] as const)
      : undefined;
  const portrait = typeof o.portrait === 'string' && o.portrait ? o.portrait : undefined;
  return { text, ...(typeof o.art === 'string' && o.art ? { art: o.art } : {}), ...(speaker ? { speaker } : {}), ...(portrait ? { portrait } : {}), ...(focus ? { focus } : {}) };
}

/** Normalises any accepted shape to at most 3 beats (the storybook card has 2-3 panels). */
export function normalizeBeats(raw: unknown): StoryBeat[] {
  if (!Array.isArray(raw)) return [];
  const out: StoryBeat[] = [];
  for (const v of raw) {
    const b = normBeat(v);
    if (b) out.push(b);
    if (out.length === 3) break;
  }
  return out;
}

/** What the story lookup reads from a level (name / subtitle feed the generic captions). */
export type StoryLevel = Pick<LevelDef, 'id'> & Partial<Pick<LevelDef, 'name' | 'subtitle'>>;

/**
 * The island's beats for a part: level data first, then the hand-written placeholder table, then
 * the generic painted beat (islands in `GENERIC_STORY_ISLANDS`), else none.
 */
export function storyBeats(level: StoryLevel, part: StoryPart): StoryBeat[] {
  const story = (level as { story?: unknown }).story;
  if (story && typeof story === 'object') {
    const fromData = normalizeBeats((story as Record<string, unknown>)[part]);
    if (fromData.length > 0) return fromData;
  }
  const written = PLACEHOLDER_STORY[level.id]?.[part];
  return normalizeBeats(placeholderBeats(written && written.length > 0 ? written : genericBeats(level, part)));
}

/** Default vignette centres when beats carry no `focus`: left, middle, right of the map. */
export function defaultFocus(i: number, n: number): readonly [number, number] {
  if (n <= 1) return [0.5, 0.5];
  const fx = 0.18 + (0.64 * i) / (n - 1);
  return [fx, i % 2 === 0 ? 0.4 : 0.6];
}
