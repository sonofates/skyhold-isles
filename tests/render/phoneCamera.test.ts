import { describe, expect, it } from 'vitest';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { fitAt, fullBleedFitItems, hardShapes } from '../../src/render2d/fullBleed.ts';
import { hudDock, type HudDockOptions } from '../../src/render2d/hudDock.ts';
import { primaryWaveEntrance, waveEntranceCounts } from '../../src/render2d/lanePath.ts';
import { PAN_SLOP } from '../../src/render2d/mapPan.ts';
import {
  clampPhonePan,
  clampZoom,
  exceedsDragThreshold,
  firstSpawnPointPx,
  isPhoneCamera,
  phoneCameraFit,
  pinchStep,
  PLOT_RING_WIDTH_SHARE,
  strictPanRange,
} from '../../src/render2d/phoneCamera.ts';
import { playfieldShapes } from '../../src/render2d/playfield.ts';
import { KIT_PLAQUE_SLOTS, NO_INSETS } from '../../src/render2d/uiLayout.ts';

const OPTS: HudDockOptions = { plaqueAspect: 1024 / 294, plaqueSlots: KIT_PLAQUE_SLOTS, bannerAspect: 512 / 152, hero: true, items: 3 };
const PHONE_SIZES: readonly [number, number][] = [[932, 430], [844, 390], [667, 375], [390, 844]];

function spawnOf(lvl: (typeof LEVELS_2D)[number]): { x: number; y: number } {
  const L = lvl.layout2d!;
  const entries = lvl.waves[0]
    ? waveEntranceCounts(lvl.waves[0].groups, L.paths, L.flightPath, (ty) => Boolean(ENEMY_DEFS[ty as keyof typeof ENEMY_DEFS]?.flying))
    : [];
  const primary = primaryWaveEntrance(entries);
  return firstSpawnPointPx(L, primary?.path);
}

describe('phone battle camera (phoneCamera.ts)', () => {
  it('activates only on non-desktop phone viewports and never on desktop', () => {
    expect(isPhoneCamera(false, 932, 430)).toBe(true);
    expect(isPhoneCamera(false, 844, 390)).toBe(true);
    expect(isPhoneCamera(false, 667, 375)).toBe(true);
    expect(isPhoneCamera(false, 390, 844)).toBe(true);
    // Desktop stays untouched at every size.
    expect(isPhoneCamera(true, 2000, 991)).toBe(false);
    expect(isPhoneCamera(true, 1440, 900)).toBe(false);
    expect(isPhoneCamera(true, 932, 430)).toBe(false);
    expect(isPhoneCamera(true, 667, 375)).toBe(false);
    // Large tablets are not treated as small phone viewports.
    expect(isPhoneCamera(false, 1024, 768)).toBe(false);
  });

  it('strict clamp keeps the viewport wholly inside the painted map at every zoom level (zero bands)', () => {
    for (const [w, h] of PHONE_SIZES) {
      for (const lvl of LEVELS_2D) {
        const L = lvl.layout2d!;
        const [iw, ih] = L.imageSize;
        const shapes = hardShapes(L);
        const r = phoneCameraFit(w, h, L, (m) => hudDock(w, h, NO_INSETS, { ...OPTS, itemMode: m }), shapes, spawnOf(lvl));
        const { minScale, defaultScale, maxScale } = r.limits;
        expect(minScale).toBeCloseTo(Math.max(w / iw, h / ih), 9);
        expect(defaultScale).toBeGreaterThanOrEqual(minScale - 1e-9);
        expect(maxScale).toBeGreaterThan(defaultScale);

        // Check default view itself has zero bands.
        expect([r.fit.bandLeft, r.fit.bandRight, r.fit.bandTop, r.fit.bandBottom], `${lvl.id} ${w}x${h}`).toEqual([0, 0, 0, 0]);
        expect(r.fit.coverage, `${lvl.id} ${w}x${h}`).toBeCloseTo(1, 6);

        // Check extreme pan attempts at minScale, defaultScale, mid-zoom, and maxScale.
        for (const sc of [minScale, defaultScale, (defaultScale + maxScale) / 2, maxScale]) {
          const range = strictPanRange(w, h, iw, ih, sc);
          expect(range.maxX).toBeLessThanOrEqual(1e-6);
          expect(range.maxY).toBeLessThanOrEqual(1e-6);
          for (const [tx, ty] of [[-99999, -99999], [99999, 99999], [-99999, 99999], [99999, -99999], [0, 0]]) {
            const c = clampPhonePan(w, h, iw, ih, sc, tx, ty);
            const f = fitAt(w, h, iw, ih, sc, c.x, c.y);
            expect(f.bandLeft, `${lvl.id} ${w}x${h} sc=${sc}`).toBe(0);
            expect(f.bandRight, `${lvl.id} ${w}x${h} sc=${sc}`).toBe(0);
            expect(f.bandTop, `${lvl.id} ${w}x${h} sc=${sc}`).toBe(0);
            expect(f.bandBottom, `${lvl.id} ${w}x${h} sc=${sc}`).toBe(0);
          }
        }
      }
    }
  });

  it('initial framing contains the playable bbox centre, keeps first spawn, castle and majority of plots visible, and enlarges phone views', () => {
    for (const [w, h] of [[932, 430], [844, 390], [667, 375]] as const) {
      for (const lvl of LEVELS_2D) {
        const L = lvl.layout2d!;
        const [iw, ih] = L.imageSize;
        const k = L.pxPerUnit;
        const shapes = hardShapes(L);
        const spawn = spawnOf(lvl);
        const r = phoneCameraFit(w, h, L, (m) => hudDock(w, h, NO_INSETS, { ...OPTS, itemMode: m }), shapes, spawn);
        const { fit, limits } = r;
        const tag = `${lvl.id} ${w}x${h}`;

        // Playable bbox centre is on screen (near centre).
        const cx = limits.playable.x + limits.playable.w / 2;
        const cy = limits.playable.y + limits.playable.h / 2;
        const scx = fit.offsetX + cx * fit.scale;
        const scy = fit.offsetY + cy * fit.scale;
        expect(scx, `${tag} playable cx`).toBeGreaterThan(w * 0.2);
        expect(scx, `${tag} playable cx`).toBeLessThan(w * 0.8);
        expect(scy, `${tag} playable cy`).toBeGreaterThan(h * 0.2);
        expect(scy, `${tag} playable cy`).toBeLessThan(h * 0.8);

        // First spawn and castle are both visible inside the viewport.
        const spScreenX = fit.offsetX + spawn.x * fit.scale;
        const spScreenY = fit.offsetY + spawn.y * fit.scale;
        expect(spScreenX, `${tag} spawn x`).toBeGreaterThanOrEqual(0);
        expect(spScreenX, `${tag} spawn x`).toBeLessThanOrEqual(w);
        expect(spScreenY, `${tag} spawn y`).toBeGreaterThanOrEqual(0);
        expect(spScreenY, `${tag} spawn y`).toBeLessThanOrEqual(h);

        const gx = Math.max(0, Math.min(iw, L.goal.x * k + iw / 2));
        const gy = Math.max(0, Math.min(ih, L.goal.z * k + ih / 2));
        const gScreenX = fit.offsetX + gx * fit.scale;
        const gScreenY = fit.offsetY + gy * fit.scale;
        expect(gScreenX, `${tag} castle x`).toBeGreaterThanOrEqual(0);
        expect(gScreenX, `${tag} castle x`).toBeLessThanOrEqual(w);
        expect(gScreenY, `${tag} castle y`).toBeGreaterThanOrEqual(0);
        expect(gScreenY, `${tag} castle y`).toBeLessThanOrEqual(h);

        // Majority of plots visible at the default view.
        const plots = playfieldShapes(L).plots;
        const visiblePlots = plots.filter((p) => {
          const sx = fit.offsetX + p.x * fit.scale;
          const sy = fit.offsetY + p.y * fit.scale;
          return sx >= 0 && sx <= w && sy >= 0 && sy <= h;
        }).length;
        expect(visiblePlots / plots.length, `${tag} plot share`).toBeGreaterThanOrEqual(0.7);

        // At 932x430, plot ring diameter is >= 44 CSS px across every island.
        if (w === 932 && h === 430) {
          const ringCssPx = L.plotRadius * k * 2 * PLOT_RING_WIDTH_SHARE * fit.scale;
          expect(ringCssPx, `${tag} plot ring px`).toBeGreaterThanOrEqual(44);
        }
      }
    }

    // Target 1.3-1.6x larger scale than the previous plot-clear fit on the key islands at 932x430.
    for (const id of ['l1c', 'i04', 'i13', 'i19', 'i24']) {
      const lvl = LEVELS_2D.find((l) => l.id === id)!;
      const L = lvl.layout2d!;
      const shapes = hardShapes(L);
      const before = fullBleedFitItems(932, 430, L, (m) => hudDock(932, 430, NO_INSETS, { ...OPTS, itemMode: m }), shapes);
      const after = phoneCameraFit(932, 430, L, (m) => hudDock(932, 430, NO_INSETS, { ...OPTS, itemMode: m }), shapes, spawnOf(lvl));
      const ratio = after.fit.scale / before.fit.scale;
      expect(ratio, `${id} zoom ratio`).toBeGreaterThanOrEqual(1.3);
      expect(ratio, `${id} zoom ratio`).toBeLessThanOrEqual(1.65);
    }
  });

  it('pinchStep respects zoom limits, anchors the focal point, and never exposes out-of-map edges', () => {
    const lvl = LEVELS_2D.find((l) => l.id === 'l1c')!;
    const L = lvl.layout2d!;
    const [iw, ih] = L.imageSize;
    const w = 932;
    const h = 430;
    const shapes = hardShapes(L);
    const r = phoneCameraFit(w, h, L, (m) => hudDock(w, h, NO_INSETS, { ...OPTS, itemMode: m }), shapes, spawnOf(lvl));
    const { limits } = r;

    expect(clampZoom(0.01, limits)).toBe(limits.minScale);
    expect(clampZoom(99, limits)).toBe(limits.maxScale);
    expect(clampZoom(NaN, limits)).toBe(limits.minScale);

    // Pinch in around screen centre: image point under (466, 215) stays anchored.
    const start = { scale: r.fit.scale, offsetX: r.fit.offsetX, offsetY: r.fit.offsetY };
    const imgBeforeX = (466 - start.offsetX) / start.scale;
    const imgBeforeY = (215 - start.offsetY) / start.scale;
    const zoomedIn = pinchStep(start, 466, 215, 466, 215, 1.35, w, h, iw, ih, limits);
    expect(zoomedIn.scale).toBeCloseTo(start.scale * 1.35, 6);
    const imgAfterX = (466 - zoomedIn.offsetX) / zoomedIn.scale;
    const imgAfterY = (215 - zoomedIn.offsetY) / zoomedIn.scale;
    expect(imgAfterX).toBeCloseTo(imgBeforeX, 5);
    expect(imgAfterY).toBeCloseTo(imgBeforeY, 5);

    // Extreme pinch out clamps at minScale (whole painting cover-fit) with zero bands.
    const zoomedOut = pinchStep(zoomedIn, 100, 100, 300, 200, 0.1, w, h, iw, ih, limits);
    expect(zoomedOut.scale).toBe(limits.minScale);
    const fOut = fitAt(w, h, iw, ih, zoomedOut.scale, zoomedOut.offsetX, zoomedOut.offsetY);
    expect([fOut.bandLeft, fOut.bandRight, fOut.bandTop, fOut.bandBottom]).toEqual([0, 0, 0, 0]);

    // Extreme pinch in clamps at maxScale with zero bands even near corner (0, 0).
    const maxIn = pinchStep(start, 10, 10, 500, 300, 10, w, h, iw, ih, limits);
    expect(maxIn.scale).toBe(limits.maxScale);
    const fIn = fitAt(w, h, iw, ih, maxIn.scale, maxIn.offsetX, maxIn.offsetY);
    expect([fIn.bandLeft, fIn.bandRight, fIn.bandTop, fIn.bandBottom]).toEqual([0, 0, 0, 0]);
  });

  it('tap-vs-drag threshold cleanly separates small finger jitter from intentional pan drags', () => {
    expect(exceedsDragThreshold(100, 100, 100, 100)).toBe(false);
    expect(exceedsDragThreshold(100, 100, 105, 104)).toBe(false);
    expect(exceedsDragThreshold(100, 100, 100 + PAN_SLOP - 0.1, 100)).toBe(false);
    expect(exceedsDragThreshold(100, 100, 100 + PAN_SLOP, 100)).toBe(true);
    expect(exceedsDragThreshold(100, 100, 108, 108)).toBe(true);
  });
});
