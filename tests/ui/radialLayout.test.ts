import { describe, expect, it } from 'vitest';
import { clampPoint, layoutRing, placeBox, ringBounds } from '../../src/ui/radialLayout.ts';

const bounds = { left: 6, top: 70, right: 424, bottom: 640 };
const FOOT = 64;

function inside(p: { x: number; y: number }, b = bounds): boolean {
  const h = FOOT / 2;
  return p.x - h >= b.left - 0.5 && p.x + h <= b.right + 0.5 && p.y - h >= b.top - 0.5 && p.y + h <= b.bottom + 0.5;
}

function minGap(ps: { x: number; y: number }[]): number {
  let m = Infinity;
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) m = Math.min(m, Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y));
  return m;
}

describe('layoutRing', () => {
  it('uses a full ring in open space, centred on the anchor', () => {
    const r = layoutRing({ cx: 215, cy: 350, count: 5, radius: 82, footprint: FOOT, bounds });
    expect(r.span).toBe(360);
    expect(r.overflow).toBe(0);
    const cx = r.positions.reduce((s, p) => s + p.x, 0) / 5;
    expect(cx).toBeGreaterThan(205);
    expect(cx).toBeLessThan(225);
    for (const p of r.positions) expect(Math.hypot(p.x - 215, p.y - 350)).toBeCloseTo(82, 3);
    expect(minGap(r.positions)).toBeGreaterThan(FOOT * 0.9);
  });

  it('keeps every token inside the bounds near each edge and corner', () => {
    const anchors = [
      [20, 350],
      [410, 350],
      [215, 90],
      [215, 620],
      [14, 78],
      [418, 630],
      [14, 630],
      [418, 78],
    ];
    for (const [cx, cy] of anchors) {
      for (const count of [4, 5]) {
        const r = layoutRing({ cx, cy, count, radius: 82, footprint: FOOT, bounds });
        expect(r.positions).toHaveLength(count);
        for (const p of r.positions) expect(inside(p)).toBe(true);
        expect(minGap(r.positions)).toBeGreaterThan(FOOT * 0.8);
      }
    }
  });

  it('flips the arc away from the nearest edge', () => {
    const top = layoutRing({ cx: 215, cy: 90, count: 5, radius: 82, footprint: FOOT, bounds });
    expect(top.span).toBeLessThan(360);
    expect(top.positions.every((p) => p.y >= 90 - 1)).toBe(true);
    const bottom = layoutRing({ cx: 215, cy: 625, count: 5, radius: 82, footprint: FOOT, bounds });
    expect(bottom.positions.every((p) => p.y <= 625 + 1)).toBe(true);
  });

  it('clamps when the bounds are too small for any arrangement', () => {
    const tiny = { left: 0, top: 0, right: 150, bottom: 150 };
    const r = layoutRing({ cx: 75, cy: 75, count: 5, radius: 82, footprint: FOOT, bounds: tiny });
    for (const p of r.positions) expect(inside(p, tiny)).toBe(true);
  });

  it('handles a landscape phone (380px high)', () => {
    const b = ringBounds({ width: 932, height: 380, safe: { top: 0, right: 0, bottom: 0, left: 0 } });
    const r = layoutRing({ cx: 466, cy: 200, count: 5, radius: 74, footprint: FOOT, bounds: b });
    for (const p of r.positions) expect(inside(p, b)).toBe(true);
  });
});

describe('helpers', () => {
  it('placeBox and clampPoint stay within bounds', () => {
    const p = placeBox(5, 5, 200, 100, bounds);
    expect(p.x - 100).toBeGreaterThanOrEqual(bounds.left);
    expect(p.y - 50).toBeGreaterThanOrEqual(bounds.top);
    const c = clampPoint({ x: 9999, y: -50 }, 32, bounds);
    expect(c).toEqual({ x: bounds.right - 32, y: bounds.top + 32 });
  });

  it('ringBounds respects safe areas', () => {
    const b = ringBounds({ width: 430, height: 739, safe: { top: 47, right: 0, bottom: 34, left: 0 } });
    expect(b.top).toBeGreaterThanOrEqual(47 + 60);
    expect(b.bottom).toBeLessThanOrEqual(739 - 34);
  });
});
