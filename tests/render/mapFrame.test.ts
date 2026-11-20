import { describe, expect, it } from 'vitest';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { hudDock } from '../../src/render2d/hudDock.ts';
import {
  backdropPlacement, borderWidth, boxBlurRGBA, buildBackdropTexture, gradeRGBA, shadowReach,
} from '../../src/render2d/mapFrame.ts';
import { fullBleedFit, hardShapes } from '../../src/render2d/fullBleed.ts';
import { KIT_PLAQUE_SLOTS, NO_INSETS } from '../../src/render2d/uiLayout.ts';

function rgba(w: number, h: number, f: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y);
      d.set([r, g, b, 255], (y * w + x) * 4);
    }
  }
  return d;
}

describe('mapFrame pixel helpers', () => {
  it('box blur keeps a flat image flat and its alpha untouched', () => {
    const d = rgba(12, 7, () => [40, 120, 200]);
    boxBlurRGBA(d, 12, 7, 3, 3);
    for (let i = 0; i < d.length; i += 4) {
      expect([d[i], d[i + 1], d[i + 2], d[i + 3]]).toEqual([40, 120, 200, 255]);
    }
  });

  it('box blur spreads a hard edge into a smooth monotone ramp (no streaks / overshoot)', () => {
    const w = 40;
    const d = rgba(w, 3, (x) => (x < w / 2 ? [0, 0, 0] : [255, 255, 255]));
    boxBlurRGBA(d, w, 3, 4, 3);
    const row = Array.from({ length: w }, (_, x) => d[(1 * w + x) * 4]);
    for (let x = 1; x < w; x++) expect(row[x]).toBeGreaterThanOrEqual(row[x - 1]);
    expect(row[w / 2 - 1]).toBeGreaterThan(60);
    expect(row[w / 2]).toBeLessThan(195);
    // rows identical: the vertical pass of a column-constant image changes nothing
    for (let x = 0; x < w; x++) expect(d[(0 * w + x) * 4]).toBe(row[x]);
  });

  it('grade desaturates toward luma and darkens', () => {
    const d = new Uint8ClampedArray([200, 50, 50, 255]);
    gradeRGBA(d, 0, 0.5);
    const luma = 0.299 * 200 + 0.587 * 50 + 0.114 * 50;
    expect(d[0]).toBe(Math.round(luma * 0.5));
    expect(d[1]).toBe(d[0]);
    expect(d[2]).toBe(d[0]);
    expect(d[3]).toBe(255);
    const e = new Uint8ClampedArray([200, 50, 50, 255]);
    gradeRGBA(e, 1, 1);
    expect(Array.from(e)).toEqual([200, 50, 50, 255]);
  });

  it('no DOM: the backdrop is null (MapView falls back to a flat fill), never throws', () => {
    const fake = { source: { resource: {}, pixelWidth: 100, pixelHeight: 60 } } as unknown as Parameters<typeof buildBackdropTexture>[0];
    expect(buildBackdropTexture(fake)).toBeNull();
  });

  it('border and shadow sizes stay readable on phones and modest on desktop', () => {
    expect(borderWidth(844, 390)).toBe(4);
    expect(borderWidth(1920, 1080)).toBe(8);
    expect(borderWidth(2560, 1080)).toBe(8);
    expect(shadowReach(844, 390)).toBeGreaterThanOrEqual(14);
    expect(shadowReach(1920, 1080)).toBeLessThan(60);
  });
});

describe('backdrop placement', () => {
  const SIZES: readonly [number, number][] = [[1920, 1080], [2000, 991], [2560, 1080], [1366, 768], [1440, 900], [844, 390], [932, 430]];
  const OVER = 20;

  it('covers the whole screen (+ shake overscan) and shares the map centre, on every island and screen', () => {
    for (const level of LEVELS_2D) {
      const layout = level.layout2d;
      if (!layout) continue;
      const [iw, ih] = layout.imageSize;
      const shapes = hardShapes(layout);
      for (const [w, h] of SIZES) {
        const dock = hudDock(w, h, NO_INSETS, { plaqueAspect: 1024 / 294, plaqueSlots: KIT_PLAQUE_SLOTS, bannerAspect: 512 / 152, hero: true });
        const { fit } = fullBleedFit(w, h, layout, dock, shapes);
        const p = backdropPlacement(w, h, iw, ih, fit, OVER);
        const tag = `${level.id} ${w}x${h}`;
        expect(p.x, tag).toBeLessThanOrEqual(-OVER + 1e-6);
        expect(p.y, tag).toBeLessThanOrEqual(-OVER + 1e-6);
        expect(p.x + iw * p.scale, tag).toBeGreaterThanOrEqual(w + OVER - 1e-6);
        expect(p.y + ih * p.scale, tag).toBeGreaterThanOrEqual(h + OVER - 1e-6);
        expect(p.scale, tag).toBeGreaterThanOrEqual(fit.scale);
        expect(p.x + (iw * p.scale) / 2, tag).toBeCloseTo(fit.offsetX + (iw * fit.scale) / 2, 6);
        expect(p.y + (ih * p.scale) / 2, tag).toBeCloseTo(fit.offsetY + (ih * fit.scale) / 2, 6);
        // never blown up so far that the band shows only a smear of one corner of the island
        expect(p.scale / fit.scale, tag).toBeLessThan(2.2);
      }
    }
    // Every island × every screen (full fit each): ~3 s alone, past 5 s on a loaded machine.
  }, 20000);
});
