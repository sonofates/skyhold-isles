import { describe, expect, it } from 'vitest';
import {
  DOUBLE_TAP_MAX_GAP_MS,
  DoubleTapDetector,
  FLING_MIN_SPEED,
  VelocityTracker,
} from '../../src/platform/gestures.ts';
import { stepFling } from '../../src/render/panLimits.ts';

describe('VelocityTracker', () => {
  it('measures a steady drag in px/s', () => {
    const v = new VelocityTracker();
    for (let i = 0; i <= 6; i++) v.add(100 + i * 10, 200, i * 16);
    const { vx, vy } = v.velocity();
    expect(vx).toBeGreaterThan(550);
    expect(vx).toBeLessThan(700);
    expect(vy).toBe(0);
  });

  it('ignores samples older than the window (a pause before release means no fling)', () => {
    const v = new VelocityTracker();
    v.add(0, 0, 0);
    v.add(300, 0, 30);
    v.add(300, 0, 400);
    v.add(300, 0, 430);
    expect(Math.abs(v.velocity().vx)).toBeLessThan(FLING_MIN_SPEED);
  });

  it('returns zero for fewer than two samples and after reset', () => {
    const v = new VelocityTracker();
    expect(v.velocity()).toEqual({ vx: 0, vy: 0 });
    v.add(1, 1, 0);
    v.add(50, 1, 16);
    v.reset();
    expect(v.velocity()).toEqual({ vx: 0, vy: 0 });
  });

  it('works across the ring-buffer wrap-around', () => {
    const v = new VelocityTracker();
    for (let i = 0; i < 20; i++) v.add(0, i * 8, i * 16);
    expect(v.velocity().vy).toBeGreaterThan(450);
    expect(v.velocity().vy).toBeLessThan(550);
  });
});

describe('DoubleTapDetector', () => {
  it('fires on a quick nearby second tap, once', () => {
    const d = new DoubleTapDetector();
    expect(d.register(100, 100, 1000)).toBe(false);
    expect(d.register(110, 104, 1200)).toBe(true);
    // a third tap right after starts a new sequence
    expect(d.register(110, 104, 1250)).toBe(false);
  });

  it('does not fire when too slow or too far apart', () => {
    const d = new DoubleTapDetector();
    d.register(100, 100, 1000);
    expect(d.register(100, 100, 1000 + DOUBLE_TAP_MAX_GAP_MS + 50)).toBe(false);
    d.reset();
    d.register(100, 100, 5000);
    expect(d.register(260, 100, 5100)).toBe(false);
  });
});

describe('stepFling', () => {
  it('decays toward zero and travels a finite distance', () => {
    let vx = 1500;
    let vy = 0;
    let dist = 0;
    for (let i = 0; i < 600; i++) {
      const s = stepFling(vx, vy, 1 / 60);
      vx = s.vx;
      vy = s.vy;
      dist += s.dx;
    }
    expect(vx).toBeLessThan(1);
    expect(dist).toBeGreaterThan(200);
    expect(dist).toBeLessThan(600);
  });
});
