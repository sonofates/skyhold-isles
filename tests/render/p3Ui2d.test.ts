import { describe, expect, it } from 'vitest';
import { createDefaultProgress } from '../../src/platform/storage.ts';
import { routePath, scrollToCentre, worldMapLayout } from '../../src/render2d/ui/mapLayout.ts';
import { islandStates, remapProgress } from '../../src/render2d/ui/progress2d.ts';
import { defaultFocus, normalizeBeats, storyBeats } from '../../src/render2d/ui/storyBeats.ts';
import { vignetteStyle } from '../../src/render2d/ui/islandArt.ts';
import { hudButtonsLayout, NO_INSETS } from '../../src/render2d/uiLayout.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';

const VIEWPORTS: [number, number][] = [
  [844, 390],
  [1600, 900],
  [2560, 1080],
  [1280, 720],
];

describe('world map layout', () => {
  for (const [w, h] of VIEWPORTS) {
    for (const n of [1, 2, 5, 16]) {
      it(`${n} islands at ${w}x${h}: nodes inside the sea, below the top bar, never overlapping`, () => {
        const insets = { top: 0, right: 30, bottom: 12, left: 30 };
        const L = worldMapLayout(n, w, h, insets, 70);
        expect(L.nodes).toHaveLength(n);
        expect(L.worldW).toBeGreaterThanOrEqual(w);
        for (const p of L.nodes) {
          expect(p.x - L.nodeD / 2).toBeGreaterThanOrEqual(insets.left);
          expect(p.x + L.nodeD / 2).toBeLessThanOrEqual(L.worldW - insets.right);
          // Stars above the medallion stay under the bar, the name plank stays on screen.
          expect(p.y - L.nodeD * 0.8).toBeGreaterThanOrEqual(70 - 1);
          expect(p.y + L.nodeD * 0.95).toBeLessThanOrEqual(h - insets.bottom);
        }
        for (let i = 1; i < n; i++) expect(Math.hypot(L.nodes[i].x - L.nodes[i - 1].x, L.nodes[i].y - L.nodes[i - 1].y)).toBeGreaterThan(L.nodeD * 1.3);
      });
    }
  }

  it('scrolls only when the route is wider than the screen', () => {
    expect(worldMapLayout(2, 1600, 900, NO_INSETS, 80).worldW).toBe(1600);
    expect(worldMapLayout(16, 844, 390, NO_INSETS, 60).worldW).toBeGreaterThan(844);
    expect(scrollToCentre(100, 800, 3000)).toBe(0);
    expect(scrollToCentre(2900, 800, 3000)).toBe(2200);
    expect(scrollToCentre(1500, 800, 3000)).toBe(1100);
  });

  it('route path passes through every node', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: 200, y: 0 },
    ];
    const d = routePath(pts);
    expect(d.startsWith('M0.0 0.0')).toBe(true);
    expect(d).toContain('100.0 50.0');
    expect(d.endsWith('200.0 0.0')).toBe(true);
    expect(routePath([])).toBe('');
  });
});

describe('2D save adapter', () => {
  const lv = (id: string): LevelDef => ({ ...LEVELS_2D[0], id });

  it('keeps records with their island when the list is reordered or grows', () => {
    const old = createDefaultProgress(2);
    old.bestStars = [3, 2];
    old.clears = [1, 1];
    old.bestLives = [20, 15];
    old.unlockedLevelIndex = 1;
    const levels = [lv('new'), lv('b'), lv('a'), lv('c')];
    const p = remapProgress(old, ['a', 'b'], levels);
    expect(p.bestStars).toEqual([0, 2, 3, 0]);
    expect(p.bestLives).toEqual([0, 15, 20, 0]);
    // The frontier follows its islands by id (a is now index 2), then walks past cleared a: c opens.
    expect(p.unlockedLevelIndex).toBe(3);
  });

  it('island states: unlocked up to the frontier, stars clamped, frontier flagged', () => {
    const p = createDefaultProgress(3);
    p.unlockedLevelIndex = 1;
    p.bestStars = [3, 0, 0];
    const st = islandStates(p, [lv('a'), lv('b'), lv('c')]);
    expect(st.map((s) => s.unlocked)).toEqual([true, true, false]);
    expect(st.map((s) => s.frontier)).toEqual([false, true, false]);
    expect(st[0].stars).toBe(3);
  });
});

describe('story beats', () => {
  it('reads level data first, in string or object form, max 3 beats', () => {
    const level = { id: 'zz', story: { intro: ['One', { text: 'Two', speaker: 'Pell', focus: [2, -1] }, '', 'Three', 'Four'] } };
    const beats = storyBeats(level as unknown as LevelDef, 'intro');
    expect(beats.map((b) => b.text)).toEqual(['One', 'Two', 'Three']);
    expect(beats[1].focus).toEqual([1, 0]);
    expect(storyBeats(level as unknown as LevelDef, 'outro')).toEqual([]);
  });

  it('falls back to the placeholder beats for the slice island', () => {
    expect(storyBeats({ id: 'l1c' }, 'intro').length).toBeGreaterThanOrEqual(2);
    expect(normalizeBeats('nope')).toEqual([]);
    expect(defaultFocus(0, 3)[0]).toBeLessThan(defaultFocus(2, 3)[0]);
  });

  it('vignette always covers its box', () => {
    for (const f of [
      [0, 0],
      [1, 1],
      [0.5, 0.5],
    ] as const) {
      const st = vignetteStyle([1846, 852], f, 300, 180);
      const [w, h] = st.size.split(' ').map((v) => parseFloat(v));
      const [x, y] = st.position.split(' ').map((v) => parseFloat(v));
      expect(x).toBeLessThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(0);
      expect(x + w).toBeGreaterThanOrEqual(300 - 1);
      expect(y + h).toBeGreaterThanOrEqual(180 - 1);
    }
  });
});

describe('HUD button row', () => {
  it('codex sits left of pause, pause left of speed, all inside the safe area with 48 px targets', () => {
    for (const [w, h] of VIEWPORTS) {
      const insets = { top: 10, right: 40, bottom: 0, left: 40 };
      const L = hudButtonsLayout(w, h, insets);
      expect(L.r * 2).toBeGreaterThanOrEqual(48);
      expect(L.speedX + L.r).toBeLessThanOrEqual(w - insets.right);
      expect(L.pauseX + L.r).toBeLessThan(L.speedX - L.r);
      expect(L.codexX + L.r).toBeLessThan(L.pauseX - L.r);
      expect(L.y - L.r).toBeGreaterThanOrEqual(insets.top);
    }
  });
});
