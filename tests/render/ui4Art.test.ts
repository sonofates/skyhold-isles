/**
 * UI round 4: the painted route marks, the generic story beats for islands with paintings but no
 * written story, and the painted-asset paths the DOM builders point at (every one must exist).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHALLENGES } from '../../src/data/challenges.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { setLocale } from '../../src/i18n/index.ts';
import { routeMarks, worldMapLayout } from '../../src/render2d/ui/mapLayout.ts';
import { GENERIC_STORY_ISLANDS, storyBeats } from '../../src/render2d/ui/storyBeats.ts';
import { NO_INSETS } from '../../src/render2d/uiLayout.ts';

const PUBLIC = resolve(__dirname, '../../public');
const exists = (url: string): boolean => existsSync(resolve(PUBLIC, `.${url}`));

describe('painted route marks', () => {
  for (const [w, h] of [
    [844, 390],
    [1600, 900],
    [2560, 1080],
  ] as const) {
    it(`cover every leg of the 17-isle route at ${w}x${h}, clear of the islands`, () => {
      const L = worldMapLayout(LEVELS_2D.length, w, h, NO_INSETS, 70);
      const step = 24;
      const clear = L.nodeD * 0.56;
      const m = routeMarks(L.nodes, step, clear, 22);
      const legs = L.nodes.length - 1;
      for (let leg = 0; leg < legs; leg++) {
        expect(m.dashes.filter((d) => d.leg === leg).length).toBeGreaterThanOrEqual(2);
        expect(m.anchors.filter((a) => a.leg === leg).length).toBeLessThanOrEqual(1);
      }
      for (const d of [...m.dashes, ...m.anchors]) {
        for (const n of L.nodes) expect(Math.hypot(d.x - n.x, d.y - n.y)).toBeGreaterThan(clear * 0.95);
        expect(d.x).toBeGreaterThanOrEqual(0);
        expect(d.x).toBeLessThanOrEqual(L.worldW);
      }
      // Consecutive dashes of a leg are evenly spaced (about `step` apart, more across the anchor).
      const leg0 = m.dashes.filter((d) => d.leg === 0);
      for (let i = 1; i < leg0.length; i++) {
        const gap = Math.hypot(leg0[i].x - leg0[i - 1].x, leg0[i].y - leg0[i - 1].y);
        expect(gap).toBeGreaterThan(step * 0.8);
      }
    });
  }

  it('is empty for fewer than two islands and skips legs too short to show', () => {
    expect(routeMarks([{ x: 0, y: 0 }], 20, 10)).toEqual({ dashes: [], anchors: [] });
    const m = routeMarks(
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
      ],
      20,
      20,
    );
    expect(m.dashes).toEqual([]);
    expect(m.anchors).toEqual([]);
  });

  it('points dashes along the route', () => {
    const m = routeMarks(
      [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
      ],
      20,
      40,
    );
    expect(m.dashes.length).toBeGreaterThan(5);
    for (const d of m.dashes) expect(Math.abs(d.angle)).toBeLessThan(1e-6);
  });
});

describe('generic story beats', () => {
  afterEach(() => setLocale('en'));

  it('every campaign island with paintings gets one painted beat per part, narrated by Pell', () => {
    for (const id of GENERIC_STORY_ISLANDS) {
      const level = LEVELS_2D.find((l) => l.id === id);
      expect(level, id).toBeDefined();
      for (const part of ['intro', 'outro'] as const) {
        const beats = storyBeats(level!, part);
        expect(beats.length).toBe(1);
        expect(beats[0].art).toBe(`/art2d/ui/story-${id}-${part}-1.webp`);
        expect(exists(beats[0].art!)).toBe(true);
        expect(beats[0].portrait).toBe('/art2d/ui/portrait-pell.webp');
        expect(beats[0].speaker).toBe('Warden Pell');
        expect(beats[0].text).toContain(level!.name);
      }
    }
  });

  it('builds the caption from the localised name and subtitle', () => {
    const level = LEVELS_2D.find((l) => l.id === 'i01')!;
    expect(storyBeats(level, 'intro')[0].text).toBe(`Next stop: ${level.name}. ${level.subtitle}.`);
    setLocale('tr');
    const tr = storyBeats(level, 'intro')[0];
    expect(tr.text.startsWith('Sıradaki durak: Güneşli Çayır.')).toBe(true);
    expect(tr.speaker).toBe('Muhafız Pell');
  });

  it('level data and the hand-written slice story still win', () => {
    const level = { ...LEVELS_2D.find((l) => l.id === 'i02')!, story: { intro: ['Real copy'] } };
    expect(storyBeats(level, 'intro').map((b) => b.text)).toEqual(['Real copy']);
    expect(storyBeats(level, 'outro')[0].art).toBe('/art2d/ui/story-i02-outro-1.webp');
    const slice = storyBeats({ id: 'l1c' }, 'intro');
    expect(slice.length).toBe(3);
    expect(slice.every((b) => b.portrait === '/art2d/ui/portrait-pell.webp')).toBe(true);
  });

  it('an island without paintings or a name gets no generic beat', () => {
    expect(storyBeats({ id: 'zz', name: 'Nowhere', subtitle: 'x' }, 'intro')).toEqual([]);
    expect(storyBeats({ id: 'i03' }, 'intro')).toEqual([]);
  });
});

describe('painted UI assets the DOM points at', () => {
  it('has a seal for every challenge and feat icon, a gem per difficulty, pips, toggles, portrait', () => {
    for (const id of Object.keys(CHALLENGES)) expect(exists(`/art2d/ui/seal-${id}.webp`), id).toBe(true);
    for (const f of ['star', 'islands', 'medal', 'crown', 'endless', 'daily', 'trophy']) expect(exists(`/art2d/ui/seal-${f}.webp`), f).toBe(true);
    for (const d of new Set(LEVELS_2D.map((l) => l.difficulty))) expect(exists(`/art2d/ui/gem-${d.toLowerCase()}.webp`), d).toBe(true);
    for (const f of ['pip-empty', 'pip-filled', 'toggle-on', 'toggle-off', 'portrait-pell', 'route-dash', 'route-anchor', 'price-tag', 'icon-play', 'icon-map'])
      expect(exists(`/art2d/ui/${f}.webp`), f).toBe(true);
  });
});
