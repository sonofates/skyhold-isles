/**
 * Story beats for the storybook panels shown before an island's first play and after a win.
 *
 * Source of truth is the level data: a `story` field on the island's `LevelDef` (not in the type
 * yet — the content owner adds it), in any of these shapes:
 *
 *   story: { intro: StoryBeat[] | string[], outro: StoryBeat[] | string[] }
 *
 * where a beat is `{ text, speaker?, art?, focus?: [fx, fy] }` (`focus` = where the panel's vignette looks
 * on the island's painted map, as fractions of the map image; default: spread across the map).
 *
 * Until the data carries stories, `PLACEHOLDER_STORY` below supplies short placeholder beats for
 * the P0 island so the panels can be seen and QA'd. Level data always wins over the placeholder.
 */
import type { LevelDef } from '../../data/levels/types.ts';
import { t, type MsgKey } from '../../i18n/index.ts';

export type StoryPart = 'intro' | 'outro';

export interface StoryBeat {
  /** URL of a painted panel illustration. */
  readonly art?: string;
  readonly text: string;
  readonly speaker?: string;
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
  readonly speaker?: MsgKey;
  readonly focus?: readonly [number, number];
}
const PLACEHOLDER_STORY: Readonly<Record<string, Partial<Record<StoryPart, readonly PlaceholderBeat[]>>>> = {
  l1c: {
    intro: [
      { speaker: 'story.l1c.speaker', key: 'story.l1c.intro.1', art: '/art2d/ui/story-l1c-intro-1.webp', focus: [0.12, 0.25] },
      { speaker: 'story.l1c.speaker', key: 'story.l1c.intro.2', art: '/art2d/ui/story-l1c-intro-2.webp', focus: [0.45, 0.6] },
      { speaker: 'story.l1c.speaker', key: 'story.l1c.intro.3', art: '/art2d/ui/story-l1c-intro-3.webp', focus: [0.85, 0.55] },
    ],
    outro: [
      { speaker: 'story.l1c.speaker', key: 'story.l1c.outro.1', art: '/art2d/ui/story-l1c-outro-1.webp', focus: [0.87, 0.24] },
      { speaker: 'story.l1c.speaker', key: 'story.l1c.outro.2', art: '/art2d/ui/story-l1c-outro-2.webp', focus: [0.15, 0.45] },
    ],
  },
};

const placeholderBeats = (beats: readonly PlaceholderBeat[]): StoryBeat[] =>
  beats.map((b) => ({ text: t(b.key), ...(b.art ? { art: b.art } : {}), ...(b.speaker ? { speaker: t(b.speaker) } : {}), ...(b.focus ? { focus: b.focus } : {}) }));

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
  return { text, ...(typeof o.art === 'string' && o.art ? { art: o.art } : {}), ...(speaker ? { speaker } : {}), ...(focus ? { focus } : {}) };
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

/** The island's beats for a part: level data first, then the placeholder table, else none. */
export function storyBeats(level: Pick<LevelDef, 'id'>, part: StoryPart): StoryBeat[] {
  const story = (level as { story?: unknown }).story;
  if (story && typeof story === 'object') {
    const fromData = normalizeBeats((story as Record<string, unknown>)[part]);
    if (fromData.length > 0) return fromData;
  }
  return normalizeBeats(placeholderBeats(PLACEHOLDER_STORY[level.id]?.[part] ?? []));
}

/** Default vignette centres when beats carry no `focus`: left, middle, right of the map. */
export function defaultFocus(i: number, n: number): readonly [number, number] {
  if (n <= 1) return [0.5, 0.5];
  const fx = 0.18 + (0.64 * i) / (n - 1);
  return [fx, i % 2 === 0 ? 0.4 : 0.6];
}
