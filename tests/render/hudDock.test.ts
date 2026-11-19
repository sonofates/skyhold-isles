import { describe, expect, it } from 'vitest';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { fullBleedFit, hardOverlaps, hardShapes, slideX } from '../../src/render2d/fullBleed.ts';
import { dockPieces, hudDock, trayLong, trayShort, type HudDock, type HudDockOptions } from '../../src/render2d/hudDock.ts';
import { distSegRect, playfieldShapes, shapesOverlap } from '../../src/render2d/playfield.ts';
import { KIT_PLAQUE_SLOTS, NO_INSETS, type Insets, type Rect } from '../../src/render2d/uiLayout.ts';

/** The QA screens of the full-bleed task (desktop, the owner's window, ultrawide, laptops, 16:10, phones). */
const SIZES: readonly [string, number, number, Insets][] = [
  ['1920x1080', 1920, 1080, NO_INSETS],
  ['2000x991', 2000, 991, NO_INSETS],
  ['2560x1080', 2560, 1080, NO_INSETS],
  ['1366x768', 1366, 768, NO_INSETS],
  ['1600x900', 1600, 900, NO_INSETS],
  ['1440x900', 1440, 900, NO_INSETS],
  ['844x390', 844, 390, NO_INSETS],
  ['932x430', 932, 430, NO_INSETS],
  ['844x390 notch', 844, 390, { top: 0, right: 47, bottom: 21, left: 47 }],
];
const OPTS: HudDockOptions = { plaqueAspect: 1024 / 294, plaqueSlots: KIT_PLAQUE_SLOTS, bannerAspect: 512 / 152, hero: true };
const hits = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Fits of every island at every size (hero / no hero), computed once. */
const FITS = (() => {
  const out: { name: string; w: number; h: number; ins: Insets; hero: boolean; id: string; home: HudDock; r: ReturnType<typeof fullBleedFit>; shapes: ReturnType<typeof hardShapes> }[] = [];
  for (const hero of [true, false]) {
    for (const [name, w, h, ins] of SIZES) {
      const home = hudDock(w, h, ins, { ...OPTS, hero });
      for (const level of LEVELS_2D) {
        const L = level.layout2d!;
        const shapes = hardShapes(L);
        out.push({ name, w, h, ins, hero, id: level.id, home, r: fullBleedFit(w, h, L, home, shapes), shapes });
      }
    }
  }
  return out;
})();

describe('full-bleed map + corner HUD: nothing playable under a HUD piece', () => {
  it('every island, every QA screen, with and without a hero: no plot, cave, castle or safe-area road under a piece', () => {
    const bad: string[] = [];
    let n = 0;
    for (const f of FITS) {
      if (!f.r.fit.clear) bad.push(`${f.name} ${f.id}: no clear placement`);
      for (const [piece, rect] of Object.entries(dockPieces(f.r.dock))) {
        n++;
        const ov = hardOverlaps(f.shapes, f.r.fit, rect);
        if (ov.length > 0) bad.push(`${f.name}${f.hero ? ' hero' : ''} ${f.id} ${piece}: ${ov.map((o) => `${o.kind}#${o.index}`).join(',')}`);
      }
    }
    expect(LEVELS_2D.length).toBe(25);
    expect(n).toBe(2 * SIZES.length * 25 * 6);
    expect(bad).toEqual([]);
  });

  it('the gameplay (plots, castle, cave mouths, safe-area roads) always stays on screen', () => {
    for (const f of FITS) {
      const m = f.shapes.mustSee;
      const { scale: s, offsetX: ox, offsetY: oy } = f.r.fit;
      const tag = `${f.name} ${f.id}`;
      expect(ox + m.x * s, tag).toBeGreaterThanOrEqual(-0.5);
      expect(oy + m.y * s, tag).toBeGreaterThanOrEqual(-0.5);
      expect(ox + (m.x + m.w) * s, tag).toBeLessThanOrEqual(f.w + 0.5);
      expect(oy + (m.y + m.h) * s, tag).toBeLessThanOrEqual(f.h + 0.5);
    }
  });

  it('the map fills the screen: ≥ 97 % on average at 16:9, ~2:1 and 21:9, ≥ 95 % at 16:10; no island under 84 % on desktop', () => {
    const avg = (name: string): number => {
      const xs = FITS.filter((f) => f.hero && f.name === name).map((f) => f.r.fit.coverage);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(avg('1920x1080')).toBeGreaterThanOrEqual(0.97);
    expect(avg('2000x991')).toBeGreaterThanOrEqual(0.97);
    expect(avg('2560x1080')).toBeGreaterThanOrEqual(0.97);
    expect(avg('1440x900')).toBeGreaterThanOrEqual(0.95);
    for (const f of FITS) {
      if (f.h >= 700) expect(f.r.fit.coverage, `${f.name} ${f.id}`).toBeGreaterThanOrEqual(0.84);
      else expect(f.r.fit.coverage, `${f.name} ${f.id}`).toBeGreaterThanOrEqual(0.35);
      // Shrunk only as far as needed, never past the floor.
      expect(f.r.fit.shrink, `${f.name} ${f.id}`).toBeGreaterThanOrEqual(f.h >= 700 ? 0.84 : 0.58);
    }
  });

  it('a piece may lie over a road where it runs outside the safe area, not inside it', () => {
    const L = LEVELS_2D.find((l) => l.id === 'l1c')!.layout2d!;
    const s = hardShapes(L);
    const fit = { scale: 1, offsetX: 0, offsetY: 0 };
    // A road segment whose point lies left of the safe area (the cave approach) …
    const outside = s.roads.find((g) => Math.max(g.ax, g.bx) < s.safe.x - s.roadR);
    if (outside) {
      const r = { x: Math.min(outside.ax, outside.bx), y: Math.min(outside.ay, outside.by) - 2, w: 4, h: 4 };
      expect(hardOverlaps(s, fit, r).filter((o) => o.kind === 'road')).toEqual([]);
      expect(shapesOverlap(playfieldShapes(L), fit, r).some((o) => o.kind === 'road')).toBe(true);
    }
    // … and one inside it.
    const g = s.roads.find((q) => q.ax > s.safe.x + 200 && q.ax < s.safe.x + s.safe.w - 200)!;
    expect(hardOverlaps(s, fit, { x: g.ax - 2, y: g.ay - 2, w: 4, h: 4 }).some((o) => o.kind === 'road')).toBe(true);
  });
});

describe('corner HUD layout', () => {
  it('the same corners on every screen: info top-left, buttons top-right, plaque bottom-left, banner + horn bottom-right, tray one row bottom-centre', () => {
    for (const hero of [true, false]) {
      for (const [name, w, h, ins] of SIZES) {
        const k = hudDock(w, h, ins, { ...OPTS, hero });
        expect(k.form, name).toBe('corners');
        expect(k.trayLayout, name).toBe('row');
        expect(k.info.x + k.info.w / 2, name).toBeLessThan(w / 2);
        expect(k.info.y, name).toBeLessThan(h * 0.1);
        expect(k.buttons.x + k.buttons.w, name).toBeGreaterThan(w - 1);
        expect(k.plaque.x, name).toBeLessThan(w * 0.1);
        expect(k.plaque.y + k.plaque.h, name).toBeGreaterThan(h * 0.9);
        expect(k.banner.x + k.banner.w, name).toBeGreaterThan(w * 0.9);
        expect(k.banner.y + k.banner.h, name).toBeGreaterThan(h * 0.9);
        expect(k.hornBox.x + k.hornBox.w, name).toBeGreaterThan(w * 0.75);
        expect(k.hornBox.y + k.hornBox.h, name).toBeGreaterThan(h * 0.7);
        // One row at the bottom, centred when it can be, as wide as its buttons.
        expect(k.tray.y + k.tray.h, name).toBeCloseTo(k.plaque.y + k.plaque.h, 0);
        expect(k.tray.w, name).toBe(trayLong(k.d, k.gap, hero));
        expect(k.tray.h, name).toBe(trayShort(k.d, hero));
        expect(Math.abs(k.tray.x + k.tray.w / 2 - w / 2), name).toBeLessThan(w * 0.08);
        expect(k.tray.x, name).toBeGreaterThan(k.plaque.x + k.plaque.w);
        expect(k.tray.x + k.tray.w, name).toBeLessThan(k.banner.x);
        expect(k.d, name).toBeGreaterThanOrEqual(40);
        expect(k.horn.r * 2, name).toBeGreaterThanOrEqual(48);
      }
    }
  });

  it('compact: corner pieces take a small share of the screen on desktop', () => {
    const k = hudDock(1920, 1080, NO_INSETS, OPTS);
    expect(k.tray.w).toBeLessThan(1920 * 0.23);
    expect(k.tray.h).toBeLessThan(1080 * 0.09);
    expect(k.info.w * k.info.h).toBeLessThan(1920 * 1080 * 0.02);
    expect(k.buttons.h).toBeLessThan(1080 * 0.12);
  });

  it('placed pieces stay inside the safe screen and never overlap each other', () => {
    for (const f of FITS) {
      const { w, h, ins } = f;
      const pieces = Object.entries(dockPieces(f.r.dock));
      for (const [p, r] of pieces) {
        const tag = `${f.name} ${f.id} ${p}`;
        expect(r.x, tag).toBeGreaterThanOrEqual(ins.left - 0.5);
        // (The buttons' keep-out runs to the screen edge, past the inset, by design.)
        expect(r.x + r.w, tag).toBeLessThanOrEqual((p === 'buttons' ? w : w - ins.right) + 0.5);
        expect(r.y, tag).toBeGreaterThanOrEqual(-0.5);
        expect(r.y + r.h, tag).toBeLessThanOrEqual(h - ins.bottom + 0.5);
      }
      for (let i = 0; i < pieces.length; i++) {
        for (let j = i + 1; j < pieces.length; j++) expect(hits(pieces[i][1], pieces[j][1]), `${f.name} ${f.id} ${pieces[i][0]} × ${pieces[j][0]}`).toBe(false);
      }
      // Sliding pieces stay on their edge.
      expect(f.r.dock.tray.y, f.id).toBe(f.home.tray.y);
      expect(f.r.dock.info.y, f.id).toBe(f.home.info.y);
    }
  });
});

describe('sliding a piece clear', () => {
  it('a plot under the home spot pushes the piece to the nearest clear spot along its edge', () => {
    const s = {
      roads: [],
      roadR: 10,
      plots: [{ x: 500, y: 50, r: 30 }],
      gates: [],
      safe: { x: 0, y: 0, w: 1000, h: 100 },
      mustSee: { x: 0, y: 0, w: 1000, h: 100 },
    };
    const fit = { scale: 1, offsetX: 0, offsetY: 0 };
    const r = { x: 450, y: 40, w: 100, h: 20 };
    const x = slideX(s, fit, r, 0, 900)!;
    expect(x).not.toBeNull();
    expect(hardOverlaps(s, fit, { ...r, x })).toEqual([]);
    // Nearest: just left of the plot (home 450 → ≤ 470 - 100 - margin).
    expect(x).toBeLessThan(450);
    expect(x).toBeGreaterThan(350);
    // No room at all: null.
    expect(slideX(s, fit, r, 440, 460)).toBeNull();
  });
});

describe('playfield shapes', () => {
  const L = LEVELS_2D[0].layout2d!;
  it('segment-to-rect distance: crossing, touching, apart', () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(distSegRect({ ax: -5, ay: 5, bx: 15, by: 5 }, r)).toBe(0);
    expect(distSegRect({ ax: 5, ay: 5, bx: 6, by: 6 }, r)).toBe(0);
    expect(distSegRect({ ax: 13, ay: -5, bx: 13, by: 15 }, r)).toBeCloseTo(3, 9);
    expect(distSegRect({ ax: 13, ay: 14, bx: 20, by: 20 }, r)).toBeCloseTo(5, 9);
  });
  it('a rect over a road / plot / castle is reported; open grass is not', () => {
    const shapes = playfieldShapes(L);
    const fit = { scale: 1, offsetX: 0, offsetY: 0 };
    const g = shapes.roads[3];
    const onRoad = shapesOverlap(shapes, fit, { x: (g.ax + g.bx) / 2 - 2, y: (g.ay + g.by) / 2 - 2, w: 4, h: 4 });
    expect(onRoad.some((o) => o.kind === 'road')).toBe(true);
    const p = shapes.plots[0];
    expect(shapesOverlap(shapes, fit, { x: p.x - 1, y: p.y - 1, w: 2, h: 2 }).some((o) => o.kind === 'plot')).toBe(true);
    const castle = shapes.gates.find((q) => q.castle)!;
    expect(shapesOverlap(shapes, fit, { x: castle.x + 2, y: castle.y + 2, w: 4, h: 4 }).some((o) => o.kind === 'castle')).toBe(true);
    // Far outside the image: nothing.
    expect(shapesOverlap(shapes, fit, { x: -500, y: -500, w: 10, h: 10 })).toEqual([]);
  });
  it('roads are as wide as the painted ones (6.8 % of the image height)', () => {
    expect(playfieldShapes(L).roadR * 2).toBeCloseTo(0.068 * L.imageSize[1], 6);
  });
});
