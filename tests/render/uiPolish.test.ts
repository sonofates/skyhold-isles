import { describe, expect, it } from 'vitest';
import { hornNearCave, hornSideBox, hornStackBox, rectsTouch, roadMouths, type HornLabelSize } from '../../src/render2d/hornSpot.ts';
import { heroGroupLong, hudDock, TRAY_DIVIDER, TRAY_PAD, TRAY_PORTRAIT, trayLong, trayShort } from '../../src/render2d/hudDock.ts';
import { titleBannerWidth } from '../../src/render2d/ui/worldMap.ts';
import { NO_INSETS } from '../../src/render2d/uiLayout.ts';

const SIZE: HornLabelSize = { labelW: 70, labelH: 30, secsH: 24 };
const SCREEN = { x: 0, y: 0, w: 1920, h: 1080 };
const inside = (a: { x: number; y: number; w: number; h: number }, b: typeof SCREEN): boolean => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

describe('horn beside the cave (hornSpot.ts)', () => {
  it('stands next to the mouth when nothing is in the way, the label above it', () => {
    const p = hornNearCave({ mouth: { x: 600, y: 500 }, out: { x: 1, y: 0 }, r: 40, size: SIZE, bounds: SCREEN, blocked: () => false });
    expect(p).not.toBeNull();
    expect(p!.shape).toBe('stack');
    expect(Math.hypot(p!.horn.x - 600, p!.horn.y - 500)).toBeLessThanOrEqual(40 * 1.5 + 1e-6);
    // Not in front of the mouth (the road leaves to the right).
    expect(p!.horn.x).toBeLessThanOrEqual(600 + 1e-6);
  });

  it('keeps the whole piece on screen and off anything blocked; null when nothing is clear', () => {
    const wall = { x: 0, y: 0, w: 120, h: 1080 };
    const p = hornNearCave({ mouth: { x: 30, y: 20 }, out: { x: 0, y: 1 }, r: 40, size: SIZE, bounds: SCREEN, blocked: (b) => rectsTouch(b, wall) });
    expect(p).not.toBeNull();
    expect(inside(p!.hornBox, SCREEN)).toBe(true);
    expect(rectsTouch(p!.hornBox, wall)).toBe(false);
    expect(hornNearCave({ mouth: { x: 30, y: 20 }, out: { x: 0, y: 1 }, r: 40, size: SIZE, bounds: SCREEN, blocked: () => true })).toBeNull();
  });

  it('falls back to the label beside the horn where the stack does not fit', () => {
    // Only a short band is free: the stacked piece (label above, seconds below) is too tall for it.
    const band = { x: 0, y: 400, w: 1920, h: 110 };
    const p = hornNearCave({ mouth: { x: 900, y: 455 }, out: { x: 0, y: -1 }, r: 40, size: SIZE, bounds: band, blocked: () => false });
    expect(p).not.toBeNull();
    expect(p!.shape).not.toBe('stack');
    expect(p!.hornBox.h).toBeCloseTo(40 * 2.44, 5);
  });

  it('piece boxes hold the ring, the label and the seconds', () => {
    const s = hornStackBox(100, 200, 40, SIZE);
    expect(s.h).toBeCloseTo(40 * 2.44 + SIZE.labelH + SIZE.secsH, 5);
    expect(s.w).toBeGreaterThanOrEqual(SIZE.labelW);
    const l = hornSideBox(100, 200, 40, SIZE, 'left');
    const r = hornSideBox(100, 200, 40, SIZE, 'right');
    expect(l.x + l.w).toBeCloseTo(100 + 40 * 1.22, 5);
    expect(r.x).toBeCloseTo(100 - 40 * 1.22, 5);
  });

  it('road mouths: the first stretch of every road, cut at the given length', () => {
    const segs = roadMouths([[{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 100 }]], 50);
    expect(segs).toHaveLength(2);
    expect(segs[1]).toEqual({ ax: 30, ay: 0, bx: 30, by: 20 });
  });
});

describe('hero + ability tray (hudDock.ts)', () => {
  it('row = portrait, two skills, divider, two abilities, even gaps and the backing padding', () => {
    const d = 60;
    const g = 14;
    expect(heroGroupLong(d, g)).toBe(Math.round(d * TRAY_PORTRAIT + 2 * d + d * TRAY_DIVIDER + 3 * g));
    expect(trayLong(d, g, true)).toBe(Math.round(heroGroupLong(d, g) + g + 2 * d + g + 2 * d * TRAY_PAD));
    expect(trayShort(d, true)).toBe(Math.ceil(d * TRAY_PORTRAIT + 2 * d * TRAY_PAD));
    expect(trayShort(d, false)).toBe(Math.ceil(d + 2 * d * TRAY_PAD));
  });

  it('skill buttons are close to the portrait in size (>= 80 %) and stay touchable', () => {
    expect(1 / TRAY_PORTRAIT).toBeGreaterThanOrEqual(0.8);
    for (const [w, h] of [
      [1920, 1080],
      [2000, 991],
      [1366, 768],
      [844, 390],
    ]) {
      const k = hudDock(w, h, NO_INSETS, { plaqueAspect: 1024 / 294, plaqueSlots: { lives: [0.2, 0.45], gold: [0.6, 0.9], midY: 0.5 }, bannerAspect: 512 / 152, hero: true });
      expect(k.d, `${w}x${h}`).toBeGreaterThanOrEqual(40);
    }
  });
});

describe('title banner (worldMap.ts)', () => {
  it('the cloth between the knots is wider than the title plus a margin', () => {
    const r = titleBannerWidth(200, 30, 1920);
    expect(r.scale).toBe(1);
    expect(r.width * (352 / 512)).toBeGreaterThanOrEqual(200 + 30 * 0.9 - 1);
  });

  it('a long title on a narrow screen gets a smaller size instead of a huge banner', () => {
    const r = titleBannerWidth(400, 30, 844);
    expect(r.width).toBeLessThanOrEqual(Math.max(160, 844 * 0.34));
    expect(r.scale).toBeLessThan(1);
    expect(r.scale).toBeGreaterThanOrEqual(0.72);
  });
});
