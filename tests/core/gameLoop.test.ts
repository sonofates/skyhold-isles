import { describe, expect, it } from 'vitest';
import { FixedTimestepStepper, MAX_ACCUMULATOR_SEC, MAX_STEPS_PER_FRAME } from '../../src/core/gameLoop.ts';
import { ObjectPool } from '../../src/core/pool.ts';
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
});

describe('ObjectPool', () => {
  it('clear() restores canonical ascending slot acquisition regardless of prior release order', () => {
    const pool = new ObjectPool(6, (id) => ({ id, active: false }));
    const a = pool.acquire()!;
    const b = pool.acquire()!;
    const c = pool.acquire()!;
    const d = pool.acquire()!;
    expect([a.id, b.id, c.id, d.id]).toEqual([0, 1, 2, 3]);

    // Release out of order to scramble activeIndices / freeIndices before clear().
    pool.releaseAtActivePos(2); // frees id=2
    pool.releaseAtActivePos(0); // frees id=0
    expect(pool.getActiveCount()).toBe(2);

    pool.clear();
    expect(pool.getActiveCount()).toBe(0);
    expect(pool.items.every((it) => !it.active)).toBe(true);

    // Post-clear acquisitions must match a fresh pool (0, 1, 2, 3, 4, 5).
    const idsAfter: number[] = [];
    for (let i = 0; i < 6; i++) {
      idsAfter.push(pool.acquire()!.id);
    }
    expect(idsAfter).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pool.acquire()).toBeNull();
  });
});
