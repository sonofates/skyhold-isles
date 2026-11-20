import { describe, expect, it } from 'vitest';
import { MapPan, PAN_KEY_STEP, PAN_MAX_SPEED } from '../../src/render2d/mapPan.ts';
import { clampPan, panRange, viewScale } from '../../src/render2d/fullBleed.ts';

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
});
