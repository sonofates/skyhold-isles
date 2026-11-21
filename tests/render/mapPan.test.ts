import { describe, expect, it } from 'vitest';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { MapPan, PAN_KEY_STEP, PAN_MAX_SPEED } from '../../src/render2d/mapPan.ts';
import { clampPan, fitAt, fullBleedFit, hardShapes, panRange, viewScale } from '../../src/render2d/fullBleed.ts';
import { hudDock, type HudDockOptions } from '../../src/render2d/hudDock.ts';
import { KIT_PLAQUE_SLOTS, NO_INSETS, type Insets } from '../../src/render2d/uiLayout.ts';

const RANGE = { minX: -300, maxX: 0, minY: -80, maxY: 0 };

function settle(p: MapPan, sec = 3): number {
  let moves = 0;
  for (let t = 0; t < sec; t += 1 / 60) if (p.step(1 / 60)) moves++;
  return moves;
}

describe('gentle map pan (mapPan.ts)', () => {
  it('the pan range keeps the painting over the screen (covered axes) and centres a banded one', () => {
    const s = viewScale(1920, 1080, 1846, 852);
    const r = panRange(1920, 1080, 1846, 852, s);
    expect(r.maxX).toBe(0);
    expect(r.minX).toBeCloseTo(1920 - 1846 * s, 9);
    expect(r.minY).toBeCloseTo(1080 - 852 * s, 9);
    expect(r.minY).toBeLessThan(-40);
    const wide = panRange(4000, 1000, 1846, 852, 1000 / 852);
    expect(wide.minX).toBe(wide.maxX);
    expect(wide.minX).toBeGreaterThan(0);
    expect(clampPan(RANGE, 50, -500)).toEqual({ x: 0, y: -80 });
  });

  it('a drag moves the view with the hand and never past the range', () => {
    const p = new MapPan();
    p.reset(RANGE, -150, -40);
    p.beginDrag(0);
    expect(p.dragBy(-20, 10, 16)).toBe(true);
    expect([p.x, p.y]).toEqual([-170, -30]);
    p.dragBy(-1000, 1000, 32);
    expect([p.x, p.y]).toEqual([-300, 0]);
    expect(p.dragBy(-5, 5, 48)).toBe(false);
  });

  it('a flick glides on a little and stops; a held-still release does not glide; reduced motion never glides', () => {
    const p = new MapPan();
    p.reset(RANGE, -150, -40);
    p.beginDrag(0);
    for (let i = 1; i <= 5; i++) p.dragBy(-8, 0, i * 16);
    const at = p.x;
    p.release(80, false);
    expect(p.gliding).toBe(true);
    settle(p);
    expect(p.gliding).toBe(false);
    const glide = at - p.x;
    expect(glide).toBeGreaterThan(5);
    // Light: well under a screen's worth.
    expect(glide).toBeLessThan(PAN_MAX_SPEED / 7 + 1);

    p.reset(RANGE, -150, -40);
    p.beginDrag(0);
    for (let i = 1; i <= 5; i++) p.dragBy(-8, 0, i * 16);
    p.release(400, false);
    expect(p.gliding).toBe(false);

    p.reset(RANGE, -150, -40);
    p.beginDrag(0);
    for (let i = 1; i <= 5; i++) p.dragBy(-8, 0, i * 16);
    p.release(80, true);
    expect(p.gliding).toBe(false);
    expect(p.x).toBe(-190);
  });

  it('the glide stops at the range edge', () => {
    const p = new MapPan();
    p.reset(RANGE, -20, -40);
    p.beginDrag(0);
    for (let i = 1; i <= 5; i++) p.dragBy(4, 0, i * 16);
    p.release(80, false);
    settle(p);
    expect(p.x).toBe(0);
    expect(p.gliding).toBe(false);
  });

  it('keys glide a step (clamped); reduced motion jumps it; scroll follows directly', () => {
    const p = new MapPan();
    p.reset(RANGE, -150, -40);
    expect(p.nudge(-1, 0, false)).toBe(false);
    expect(settle(p)).toBeGreaterThan(3);
    expect(p.x).toBeCloseTo(-150 - PAN_KEY_STEP, 6);
    p.nudge(-1, 0, false);
    p.nudge(-1, 0, false);
    settle(p);
    expect(p.x).toBe(-300);
    expect(p.nudge(1, 0, true)).toBe(true);
    expect(p.x).toBe(-300 + PAN_KEY_STEP);
    expect(p.scrollBy(0, -15)).toBe(true);
    expect(p.y).toBe(-55);
    expect(p.gliding).toBe(false);
  });

  it('a reset (resize) re-centres and drops any glide', () => {
    const p = new MapPan();
    p.reset(RANGE, -150, -40);
    p.nudge(1, 1, false);
    p.reset({ minX: -100, maxX: 0, minY: -10, maxY: 0 }, -150, -40);
    expect([p.x, p.y]).toEqual([-100, -10]);
    expect(p.gliding).toBe(false);
  });

  it('clampPan handles swapped bounds defensively', () => {
    expect(clampPan({ minX: 10, maxX: -20, minY: 5, maxY: -15 }, 50, -50)).toEqual({ x: 10, y: -15 });
  });

  it('never pans past the map art across aspect ratios (16:9, 21:9, 16:10, 4:3, phone landscape, portrait, ultrawide)', () => {
    const opts: HudDockOptions = { plaqueAspect: 1024 / 294, plaqueSlots: KIT_PLAQUE_SLOTS, bannerAspect: 512 / 152, hero: true };
    const i16 = LEVELS_2D.find((l) => l.id === 'i16' || l.id === 'emberglass-sanctum')!.layout2d!;
    const shapes = hardShapes(i16);
    const [iw, ih] = i16.imageSize;
    const cases: readonly [string, number, number, Insets, boolean, boolean][] = [
      // name, w, h, insets, expectCoverX, expectCoverY
      ['16:9 1920x1080', 1920, 1080, NO_INSETS, true, true],
      ['16:9 1366x768', 1366, 768, NO_INSETS, true, true],
      ['21:9 2560x1080', 2560, 1080, NO_INSETS, true, true],
      ['21:9 3440x1440', 3440, 1440, NO_INSETS, true, true],
      ['16:10 1440x900', 1440, 900, NO_INSETS, true, true],
      ['16:10 1512x982', 1512, 982, NO_INSETS, true, true],
      ['4:3 1024x768', 1024, 768, NO_INSETS, true, true],
      ['phone landscape 844x390', 844, 390, { top: 0, right: 47, bottom: 21, left: 47 }, true, true],
      ['phone portrait 390x844', 390, 844, { top: 47, right: 0, bottom: 34, left: 0 }, true, false],
      ['32:9 3840x1080', 3840, 1080, NO_INSETS, false, true],
    ];
    for (const [name, w, h, ins, coverX, coverY] of cases) {
      const dock = hudDock(w, h, ins, opts);
      const r = fullBleedFit(w, h, i16, dock, shapes);
      const { fit, pan } = r;
      const p = new MapPan();
      p.reset(pan, fit.offsetX, fit.offsetY);
      // Aggressive pan in every corner direction (drag + scroll + key nudge).
      for (const [dx, dy] of [[-5000, -5000], [5000, 5000], [-5000, 5000], [5000, -5000]]) {
        p.scrollBy(dx, dy);
        const f = fitAt(w, h, iw, ih, fit.scale, p.x, p.y);
        if (coverX) {
          expect(f.bandLeft, `${name} (${dx},${dy}) bandLeft`).toBe(0);
          expect(f.bandRight, `${name} (${dx},${dy}) bandRight`).toBe(0);
        } else {
          // Banded axis stays locked centred and never shifts off centre.
          expect(pan.minX, name).toBeCloseTo(pan.maxX, 6);
          expect(f.bandLeft, name).toBeCloseTo(f.bandRight, 6);
        }
        if (coverY) {
          expect(f.bandTop, `${name} (${dx},${dy}) bandTop`).toBe(0);
          expect(f.bandBottom, `${name} (${dx},${dy}) bandBottom`).toBe(0);
        } else {
          expect(pan.minY, name).toBeCloseTo(pan.maxY, 6);
          expect(f.bandTop, name).toBeCloseTo(f.bandBottom, 6);
        }
      }
    }
  });

  it('resize and orientation changes re-clamp pan inside the new art bounds', () => {
    const opts: HudDockOptions = { plaqueAspect: 1024 / 294, plaqueSlots: KIT_PLAQUE_SLOTS, bannerAspect: 512 / 152, hero: true };
    const i16 = LEVELS_2D.find((l) => l.id === 'i16' || l.id === 'emberglass-sanctum')!.layout2d!;
    const shapes = hardShapes(i16);
    const [iw, ih] = i16.imageSize;
    const p = new MapPan();
    for (const [w, h] of [[844, 390], [390, 844], [844, 390], [2560, 1080], [1366, 768]] as const) {
      const r = fullBleedFit(w, h, i16, hudDock(w, h, NO_INSETS, opts), shapes);
      p.reset(r.pan, r.fit.offsetX, r.fit.offsetY);
      p.beginDrag(0);
      p.dragBy(0, -4000, 16);
      p.release(32, false);
      settle(p);
      const f = fitAt(w, h, iw, ih, r.fit.scale, p.x, p.y);
      if (ih * r.fit.scale >= h) expect(f.bandBottom, `${w}x${h}`).toBe(0);
      if (iw * r.fit.scale >= w) expect(f.bandRight, `${w}x${h}`).toBe(0);
    }
  });
});
