import { describe, expect, it } from 'vitest';
import { FixedTimestepStepper, MAX_ACCUMULATOR_SEC, MAX_STEPS_PER_FRAME } from '../../src/core/gameLoop.ts';
import { BALANCE } from '../../src/data/balance.ts';

function runFrames(stepper: FixedTimestepStepper, frames: number, dt: number): number {
  let ticks = 0;
  for (let i = 0; i < frames; i++) {
    stepper.step(dt, () => {
      ticks++;
    });
  }
  return ticks;
}

describe('FixedTimestepStepper', () => {
  it('does not drop sim time at 3x speed with max-length frames', () => {
    const stepper = new FixedTimestepStepper();
    stepper.simActive = true;
    stepper.speed = 3;
    const frames = 20;
    const ticks = runFrames(stepper, frames, BALANCE.maxFrameDt);
    const expected = (frames * BALANCE.maxFrameDt * 3) / BALANCE.fixedDt;
    expect(Math.abs(ticks - expected)).toBeLessThanOrEqual(1);
  });

  it('caps ticks per frame and carries a bounded remainder', () => {
    const stepper = new FixedTimestepStepper();
    stepper.simActive = true;
    stepper.speed = 3;
    // Oversized frames (clamped to maxFrameDt) must never exceed the per-frame step cap.
    let maxPerFrame = 0;
    for (let i = 0; i < 10; i++) {
      const { ticksExecuted, alpha } = stepper.step(1, () => {});
      maxPerFrame = Math.max(maxPerFrame, ticksExecuted);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(1);
    }
    expect(maxPerFrame).toBeLessThanOrEqual(MAX_STEPS_PER_FRAME);
    // Remainder never exceeds the clamp: the next zero-length frame runs at most that many ticks.
    const { ticksExecuted } = stepper.step(0, () => {});
    expect(ticksExecuted).toBeLessThanOrEqual(Math.ceil(MAX_ACCUMULATOR_SEC / BALANCE.fixedDt));
  });

  it('is deterministic: same frame sequence yields same tick count', () => {
    const seq = [0.016, 0.1, 0.033, 0.1, 0.1, 0.008, 0.05];
    const run = (): number => {
      const s = new FixedTimestepStepper();
      s.simActive = true;
      s.speed = 3;
      let t = 0;
      for (const dt of seq) s.step(dt, () => t++);
      return t;
    };
    expect(run()).toBe(run());
  });

  it('does not tick while paused or inactive', () => {
    const stepper = new FixedTimestepStepper();
    stepper.simActive = true;
    stepper.paused = true;
    expect(runFrames(stepper, 5, 0.1)).toBe(0);
    stepper.paused = false;
    stepper.simActive = false;
    expect(runFrames(stepper, 5, 0.1)).toBe(0);
  });

  it('clamps negative, NaN, and +Infinity frame dts safely without poisoning state', () => {
    const stepper = new FixedTimestepStepper();
    stepper.simActive = true;

    const neg = stepper.step(-0.5, () => {});
    expect(neg.ticksExecuted).toBe(0);
    expect(neg.elapsedVisualTime).toBe(0);
    expect(neg.alpha).toBe(0);

    const nan = stepper.step(Number.NaN, () => {});
    expect(nan.ticksExecuted).toBe(0);
    expect(nan.elapsedVisualTime).toBe(0);
    expect(nan.alpha).toBe(0);

    const inf = stepper.step(Number.POSITIVE_INFINITY, () => {});
    expect(inf.elapsedVisualTime).toBeCloseTo(BALANCE.maxFrameDt, 6);
    expect(inf.ticksExecuted).toBe(Math.floor(BALANCE.maxFrameDt / BALANCE.fixedDt));
    expect(Number.isFinite(inf.alpha)).toBe(true);
  });

  it('computes alpha cleanly, resets accumulator, and preserves remainder across pause and speed switches', () => {
    const stepper = new FixedTimestepStepper();
    // Inactive -> alpha is always 0 even if visual time advances
    const inactive = stepper.step(0.05, () => {});
    expect(inactive.alpha).toBe(0);
    expect(inactive.elapsedVisualTime).toBeCloseTo(0.05, 6);

    stepper.simActive = true;
    stepper.speed = 1;
    // Half a fixed step -> 0 ticks, alpha ~ 0.5
    const halfStep = stepper.step(BALANCE.fixedDt * 0.5, () => {});
    expect(halfStep.ticksExecuted).toBe(0);
    expect(halfStep.alpha).toBeCloseTo(0.5, 5);

    // Pausing freezes accumulator/alpha while visual time still advances
    stepper.paused = true;
    const whilePaused = stepper.step(0.05, () => {});
    expect(whilePaused.ticksExecuted).toBe(0);
    expect(whilePaused.alpha).toBeCloseTo(0.5, 5);
    expect(whilePaused.elapsedVisualTime).toBeCloseTo(0.1 + BALANCE.fixedDt * 0.5, 6);

    // resetAccumulator clears partial remainder
    stepper.resetAccumulator();
    stepper.paused = false;
    const afterReset = stepper.step(0, () => {});
    expect(afterReset.ticksExecuted).toBe(0);
    expect(afterReset.alpha).toBe(0);

    // Speed switch preserves fractional accumulator: 0.5 tick at 1x + 0.25 tick at 2x = 1 tick
    stepper.step(BALANCE.fixedDt * 0.5, () => {});
    stepper.speed = 2;
    const combined = stepper.step(BALANCE.fixedDt * 0.26, () => {});
    expect(combined.ticksExecuted).toBe(1);
    expect(combined.alpha).toBeGreaterThanOrEqual(0);
    expect(combined.alpha).toBeLessThan(1);
  });

  it('bounds carried-over accumulator to MAX_ACCUMULATOR_SEC when hitting MAX_STEPS_PER_FRAME', () => {
    const stepper = new FixedTimestepStepper();
    stepper.simActive = true;
    stepper.speed = 3;

    // Seed near-max remainder then step with an oversized frame that exceeds 18 * fixedDt
    // Even if speed is temporarily raised via cast or large accumulator builds, remainder stays <= MAX_ACCUMULATOR_SEC
    (stepper as unknown as { accumulator: number }).accumulator = 0.5;
    let ticks = 0;
    const res = stepper.step(BALANCE.maxFrameDt, () => {
      ticks++;
    });
    expect(ticks).toBe(MAX_STEPS_PER_FRAME);
    expect(res.ticksExecuted).toBe(MAX_STEPS_PER_FRAME);
    // 0.5 + 0.3 - 18/60 = 0.5 -> clamped to MAX_ACCUMULATOR_SEC (0.25)
    stepper.speed = 1;
    let drained = 0;
    while (stepper.step(0, () => drained++).ticksExecuted > 0) {
      // drain clamped remainder
    }
    expect(drained).toBe(Math.floor(MAX_ACCUMULATOR_SEC / BALANCE.fixedDt));
  });
});
