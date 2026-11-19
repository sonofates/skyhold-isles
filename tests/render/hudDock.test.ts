import { describe, expect, it } from 'vitest';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { dockForm, dockPieces, hudDock, trayLong, trayShort, trayStack, type HudDockOptions } from '../../src/render2d/hudDock.ts';
import { distSegRect, playfieldBoxes, playfieldShapes, shapesOverlap } from '../../src/render2d/playfield.ts';
import { KIT_PLAQUE_SLOTS, NO_INSETS, type Insets, type Rect } from '../../src/render2d/uiLayout.ts';
import { computeMapFit, fitAroundHud } from '../../src/render2d/viewFit.ts';

/** The QA screens of the HUD task (desktop, ultrawide, laptop, phones). */
const SIZES: readonly [string, number, number, Insets][] = [
  ['1920x1080', 1920, 1080, NO_INSETS],
  ['2560x1080', 2560, 1080, NO_INSETS],
  ['1366x768', 1366, 768, NO_INSETS],
  ['1600x900', 1600, 900, NO_INSETS],
  ['844x390', 844, 390, NO_INSETS],
  ['932x430', 932, 430, NO_INSETS],
  ['844x390 notch', 844, 390, { top: 0, right: 47, bottom: 21, left: 47 }],
];
const OPTS: HudDockOptions = { plaqueAspect: 1024 / 294, plaqueSlots: KIT_PLAQUE_SLOTS, bannerAspect: 512 / 152, hero: true };
const hits = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe('HUD dock: nothing playable under any HUD piece', () => {
  it('every island, every QA screen, with and without a hero: no road, plot, cave or castle under a piece', () => {
    const bad: string[] = [];
    let n = 0;
    for (const hero of [true, false]) {
      for (const [name, w, h, ins] of SIZES) {
        const dock = hudDock(w, h, ins, { ...OPTS, hero });
        for (const level of LEVELS_2D) {
          const L = level.layout2d!;
          const shapes = playfieldShapes(L);
          const fit = fitAroundHud(w, h, L.imageSize[0], L.imageSize[1], L.safeArea, playfieldBoxes(shapes), dock.reserved);
          if (!fit.clear) bad.push(`${name} ${level.id}: no clear fit`);
          for (const [piece, rect] of Object.entries(dockPieces(dock))) {
            const ov = shapesOverlap(shapes, fit, rect);
            n++;
            if (ov.length > 0) bad.push(`${name}${hero ? ' hero' : ''} ${level.id} ${piece}: ${ov.map((o) => `${o.kind}#${o.index}`).join(',')}`);
          }
        }
      }
    }
    expect(LEVELS_2D.length).toBe(25);
    expect(n).toBe(2 * SIZES.length * 25 * 6);
    expect(bad).toEqual([]);
  });

  it('the map shrinks only as much as it must (16:9 ≥ 70 %, phones ≥ 60 %, ultrawide ≥ 75 %)', () => {
    for (const [name, w, h, ins] of SIZES) {
      const dock = hudDock(w, h, ins, OPTS);
      for (const level of LEVELS_2D) {
        const L = level.layout2d!;
        const fit = fitAroundHud(w, h, L.imageSize[0], L.imageSize[1], L.safeArea, playfieldBoxes(playfieldShapes(L)), dock.reserved);
        const min = w / h >= 2.3 ? 0.75 : h <= 560 ? 0.6 : 0.7;
        expect(fit.shrink, `${name} ${level.id}`).toBeGreaterThanOrEqual(min);
        // The whole safe area (all gameplay) stays on screen.
        const [sx, sy, sw, sh] = L.safeArea;
        expect(fit.offsetX + sx * fit.scale, `${name} ${level.id}`).toBeGreaterThanOrEqual(-0.5);
        expect(fit.offsetY + sy * fit.scale, `${name} ${level.id}`).toBeGreaterThanOrEqual(-0.5);
        expect(fit.offsetX + (sx + sw) * fit.scale, `${name} ${level.id}`).toBeLessThanOrEqual(w + 0.5);
        expect(fit.offsetY + (sy + sh) * fit.scale, `${name} ${level.id}`).toBeLessThanOrEqual(h + 0.5);
      }
    }
  });
});

describe('HUD dock layout', () => {
  it('bands on 16:9-ish screens, side columns on phones / ultrawide', () => {
    expect(dockForm(1920, 1080)).toBe('bands');
    expect(dockForm(1366, 768)).toBe('bands');
    expect(dockForm(1280, 1024)).toBe('bands');
    expect(dockForm(844, 390)).toBe('columns');
    expect(dockForm(932, 430)).toBe('columns');
    expect(dockForm(2560, 1080)).toBe('columns');
  });

  it('every piece inside the safe screen, no two pieces overlapping, touch-size buttons', () => {
    for (const hero of [true, false]) {
      for (const [name, w, h, ins] of SIZES) {
        const k = hudDock(w, h, ins, { ...OPTS, hero });
        const pieces = Object.entries(dockPieces(k));
        for (const [p, r] of pieces) {
          expect(r.x, `${name} ${p}`).toBeGreaterThanOrEqual(ins.left - 0.5);
          // (The buttons' keep-out runs to the screen edge, past the inset, by design.)
          expect(r.x + r.w, `${name} ${p}`).toBeLessThanOrEqual((p === 'buttons' ? w : w - ins.right) + 0.5);
          expect(r.y, `${name} ${p}`).toBeGreaterThanOrEqual(-0.5);
          expect(r.y + r.h, `${name} ${p}`).toBeLessThanOrEqual(h - ins.bottom + 0.5);
          expect(r.w > 0 && r.h > 0, `${name} ${p}`).toBe(true);
        }
        for (let i = 0; i < pieces.length; i++) {
          for (let j = i + 1; j < pieces.length; j++) expect(hits(pieces[i][1], pieces[j][1]), `${name} ${pieces[i][0]} × ${pieces[j][0]}`).toBe(false);
        }
        expect(k.d, name).toBeGreaterThanOrEqual(40);
        expect(k.horn.r * 2, name).toBeGreaterThanOrEqual(48);
      }
    }
  });

  it('desktop: the tray is one row at the bottom centre; phones: a stack over the plaque', () => {
    const d = hudDock(1920, 1080, NO_INSETS, OPTS);
    expect(d.trayLayout).toBe('row');
    expect(d.tray.x + d.tray.w / 2).toBeCloseTo(960, 0);
    expect(d.tray.y + d.tray.h).toBeCloseTo(d.plaque.y + d.plaque.h, 0);
    expect(d.tray.w).toBe(trayLong(d.d, d.gap, true));
    expect(d.tray.h).toBe(trayShort(d.d, true));
    expect(d.info.x).toBeLessThan(d.tray.x);
    const p = hudDock(844, 390, NO_INSETS, OPTS);
    expect(p.trayLayout).toBe('stack');
    expect(p.tray.x).toBeCloseTo(p.plaque.x, 5);
    expect(p.tray.y + p.tray.h).toBeLessThan(p.plaque.y);
    expect(p.tray.w).toBe(trayStack(p.d, p.gap, true).w);
    // The info slot sits above the stack, the horn above the banner.
    expect(p.info.y + p.info.h).toBeLessThan(p.tray.y);
    expect(p.hornBox.y + p.hornBox.h).toBeLessThanOrEqual(p.banner.y + 0.5);
  });
});

describe('map fit around the HUD', () => {
  const L = LEVELS_2D[0].layout2d!;
  const boxes = playfieldBoxes(playfieldShapes(L));
  it('no HUD (or HUD over open sky): the plain fit, unchanged', () => {
    const plain = computeMapFit(1920, 1080, L.imageSize[0], L.imageSize[1], L.safeArea);
    expect(fitAroundHud(1920, 1080, L.imageSize[0], L.imageSize[1], L.safeArea, boxes, [])).toMatchObject({ ...plain, shrink: 1, clear: true });
    const sky = fitAroundHud(1920, 1080, L.imageSize[0], L.imageSize[1], L.safeArea, boxes, [{ x: 0, y: 1079, w: 2, h: 1 }]);
    expect(sky.scale).toBe(plain.scale);
  });
  it('a band over the island: shrinks / shifts until every box clears it', () => {
    const band = { x: 0, y: 950, w: 1920, h: 130 };
    const f = fitAroundHud(1920, 1080, L.imageSize[0], L.imageSize[1], L.safeArea, boxes, [band]);
    expect(f.clear).toBe(true);
    expect(f.shrink).toBeLessThan(1);
    for (const b of boxes) {
      const r = { x: f.offsetX + b.x * f.scale, y: f.offsetY + b.y * f.scale, w: b.w * f.scale, h: b.h * f.scale };
      expect(hits(r, band)).toBe(false);
    }
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
