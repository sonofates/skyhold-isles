import { describe, expect, it } from 'vitest';
import { axisRange, clampPlaneTarget } from '../../src/render/panLimits.ts';

const ext = { rMin: -20, rMax: 20, uMin: -10, uMax: 10 };

describe('axisRange', () => {
  it('keeps the view inside a larger island (plus overscroll)', () => {
    const { lo, hi } = axisRange(-20, 20, 10, 0.2);
    expect(lo).toBeCloseTo(-20 + 10 - 2);
    expect(hi).toBeCloseTo(20 - 10 + 2);
  });

  it('keeps a smaller island inside the view (plus overscroll)', () => {
    const { lo, hi } = axisRange(-5, 5, 10, 0.2);
    expect(lo).toBeCloseTo(5 - 10 - 2);
    expect(hi).toBeCloseTo(-5 + 10 + 2);
  });

  it('always includes the auto-fit target', () => {
    const { lo, hi } = axisRange(-20, 20, 10, 0.1, 14);
    expect(lo).toBeLessThanOrEqual(14);
    expect(hi).toBeGreaterThanOrEqual(14);
  });
});

describe('clampPlaneTarget', () => {
  it('leaves a target inside the range untouched', () => {
    expect(clampPlaneTarget(1, 1, ext, 8, 5, 0.2)).toEqual({ r: 1, u: 1 });
  });

  it('pulls a far-away target back so the island stays on screen', () => {
    const c = clampPlaneTarget(500, -500, ext, 8, 5, 0.2);
    expect(c.r).toBeCloseTo(20 - 8 + 1.6);
    // vertical: island (span 20) is bigger than the view (span 10) too
    expect(c.u).toBeCloseTo(-10 + 5 - 1);
  });

  it('zooming out (bigger half-view) shrinks the pannable range toward the centre', () => {
    const near = clampPlaneTarget(100, 0, ext, 8, 5, 0.2).r;
    const far = clampPlaneTarget(100, 0, ext, 18, 5, 0.2).r;
    expect(far).toBeLessThan(near);
  });
});
