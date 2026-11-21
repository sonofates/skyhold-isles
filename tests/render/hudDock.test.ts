import { describe, expect, it } from 'vitest';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { clampPan, fullBleedFit, hardOverlaps, hardShapes, PAN_ZOOM, slideX, viewScale } from '../../src/render2d/fullBleed.ts';
import { dockPieces, hudDock, trayLong, trayShort, type HudDock, type HudDockOptions } from '../../src/render2d/hudDock.ts';
import { distSegRect, playfieldShapes, shapesOverlap } from '../../src/render2d/playfield.ts';
import { KIT_PLAQUE_SLOTS, NO_INSETS, type Insets, type Rect } from '../../src/render2d/uiLayout.ts';
import type { Level2DLayout } from '../../src/data/levels/types.ts';

/** The QA screens of the full-bleed task (desktop, the owner's window, ultrawide, laptops, 16:10, phones). */
const SIZES: readonly [string, number, number, Insets][] = [
  ['1920x1080', 1920, 1080, NO_INSETS],
  ['2000x991', 2000, 991, NO_INSETS],
  ['2000x1150', 2000, 1150, NO_INSETS],
  ['1512x982', 1512, 982, NO_INSETS],
  ['1024x768', 1024, 768, NO_INSETS],
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
  const out: { name: string; w: number; h: number; ins: Insets; hero: boolean; id: string; L: Level2DLayout; home: HudDock; r: ReturnType<typeof fullBleedFit>; shapes: ReturnType<typeof hardShapes> }[] = [];
  for (const hero of [true, false]) {
    for (const [name, w, h, ins] of SIZES) {
      const home = hudDock(w, h, ins, { ...OPTS, hero });
      for (const level of LEVELS_2D) {
        const L = level.layout2d!;
        const shapes = hardShapes(L);
        out.push({ name, w, h, ins, hero, id: level.id, L, home, r: fullBleedFit(w, h, L, home, shapes), shapes });
      }
    }
  }
  return out;
})();

describe('map fit + gentle pan + corner HUD (owner feedback 2026-11-21: no bands, a little pan)', () => {
  const desktop = (f: (typeof FITS)[number]): boolean => f.h >= 700;

  it('the map covers the screen at every QA size (no bands from ~4:3 to ~21:9), zoomed a little past cover', () => {
    for (const f of FITS) {
      const tag = `${f.name} ${f.id}`;
      const { fit, pan } = f.r;
      expect([fit.bandLeft, fit.bandTop, fit.bandRight, fit.bandBottom], tag).toEqual([0, 0, 0, 0]);
      expect(fit.coverage, tag).toBeCloseTo(1, 6);
      expect(fit.shrink, tag).toBeGreaterThan(1);
      expect(fit.shrink, tag).toBeLessThanOrEqual(PAN_ZOOM + 1e-9);
      // Room to pan both ways on both axes (≥ 4 % of the screen).
      expect(pan.maxX - pan.minX, tag).toBeGreaterThanOrEqual(f.w * 0.04);
      expect(pan.maxY - pan.minY, tag).toBeGreaterThanOrEqual(f.h * 0.04);
    }
    // 4:3 and 5:4 still cover; only past ~21:9 (32:9 here) does the frame open, on the long axis.
    const L = LEVELS_2D[0].layout2d!;
    for (const [w, h, banded] of [[1024, 768, false], [1280, 1024, false], [3440, 1440, false], [3840, 1080, true]] as const) {
      const r = fullBleedFit(w, h, L, hudDock(w, h, NO_INSETS, OPTS));
      const side = r.fit.bandLeft + r.fit.bandRight;
      expect(side > 0, `${w}x${h}`).toBe(banded);
      expect(r.fit.bandTop + r.fit.bandBottom, `${w}x${h}`).toBe(0);
    }
    expect(viewScale(1920, 1080, 1846, 852)).toBeCloseTo((1080 / 852) * PAN_ZOOM, 9);
  });

  it('neither the default view nor any pan offset ever shows past the painting', () => {
    for (const f of FITS) {
      const tag = `${f.name} ${f.id}`;
      const { fit, pan } = f.r;
      const [iw, ih] = f.L.imageSize;
      const s = fit.scale;
      expect(fit.offsetX, tag).toBeLessThanOrEqual(1e-6);
      expect(fit.offsetY, tag).toBeLessThanOrEqual(1e-6);
      expect(fit.offsetX + iw * s, tag).toBeGreaterThanOrEqual(f.w - 1e-6);
      expect(fit.offsetY + ih * s, tag).toBeGreaterThanOrEqual(f.h - 1e-6);
      expect(pan.minX, tag).toBeCloseTo(f.w - iw * s, 6);
      expect(pan.maxX, tag).toBeCloseTo(0, 6);
      expect(pan.minY, tag).toBeCloseTo(f.h - ih * s, 6);
      expect(pan.maxY, tag).toBeCloseTo(0, 6);
      const c = clampPan(pan, fit.offsetX, fit.offsetY);
      expect([c.x, c.y], tag).toEqual([fit.offsetX, fit.offsetY]);
    }
  });

  it('panning keeps every plot and every cave / castle on screen without ever leaving the painting', () => {
    const bad: string[] = [];
    for (const f of FITS) {
      if (!f.hero) continue;
      const { pan, fit } = f.r;
      const s = fit.scale;
      const steps = 16;
      const offsets: [number, number][] = [];
      for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) offsets.push([pan.minX + ((pan.maxX - pan.minX) * i) / steps, pan.minY + ((pan.maxY - pan.minY) * j) / steps]);
      const [iw, ih] = f.L.imageSize;
      f.shapes.plots.forEach((p, k) => {
        const ok = offsets.some(([ox, oy]) => {
          const x0 = ox + Math.max(0, p.x - p.r) * s;
          const y0 = oy + Math.max(0, p.y - p.r) * s;
          const x1 = ox + Math.min(iw, p.x + p.r) * s;
          const y1 = oy + Math.min(ih, p.y + p.r) * s;
          return x0 >= -0.5 && y0 >= -0.5 && x1 <= f.w + 0.5 && y1 <= f.h + 0.5;
        });
        if (!ok) bad.push(`${f.name} ${f.id} plot${k}`);
      });
      f.shapes.gates.forEach((g, k) => {
        const ok = offsets.some(([ox, oy]) => {
          const cx = ox + (g.x + g.w / 2) * s;
          const cy = oy + (g.y + g.h / 2) * s;
          return cx >= 0 && cy >= 0 && cx <= f.w && cy <= f.h;
        });
        if (!ok) bad.push(`${f.name} ${f.id} gate${k}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('the default view keeps the pieces off the gameplay wherever the island leaves room (and says so when it cannot)', () => {
    const clearShare = new Map<string, number[]>();
    for (const f of FITS) {
      const tag = `${f.name}${f.hero ? ' hero' : ''} ${f.id}`;
      const covered: string[] = [];
      for (const [piece, rect] of Object.entries(dockPieces(f.r.dock))) {
        for (const o of hardOverlaps(f.shapes, f.r.fit, rect)) {
          if (piece !== 'info' || o.kind !== 'road') covered.push(`${piece}:${o.kind}${o.index}`);
        }
      }
      const notInfo = covered.filter((c) => !c.startsWith('info:'));
      // `clear` / `clearButInfo` tell the truth.
      if (f.r.fit.clear) expect(covered, tag).toEqual([]);
      if (f.r.fit.clearButInfo) expect(notInfo.filter((c) => !c.includes(':road')), tag).toEqual([]);
      // On a desktop screen at most five plots / caves / the castle sit under a lasting piece.
      if (desktop(f)) expect(notInfo.filter((c) => !c.includes(":road")).length, tag).toBeLessThanOrEqual(5);
      const k = clearShare.get(f.name) ?? [0, 0];
      k[0] += f.r.fit.clearButInfo ? 1 : 0;
      k[1]++;
      clearShare.set(f.name, k);
    }
    // Every desktop screen clears a fifth or more of the islands outright (the rest: as little as it can, pan to see).
    for (const [name, [n, all]] of clearShare) {
      if (FITS.find((f) => f.name === name)!.h >= 700) expect(n / all, name).toBeGreaterThanOrEqual(0.2);
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
