import { BALANCE } from '../data/balance.ts';
import type { SpeedMultiplier } from './types.ts';

/** 3x speed at the max frame dt (0.1 s) needs exactly 18 fixed ticks. */
export const MAX_STEPS_PER_FRAME = 18;
/** Upper bound of carried-over sim time when a frame hits the step cap. */
export const MAX_ACCUMULATOR_SEC = 0.25;

/**
 * Pure platform-independent fixed 60 Hz simulation accumulator.
 * Speed multiplier runs multiple fixed ticks per frame rather than scaling dt.
 */
export class FixedTimestepStepper {
  private accumulator = 0;
  private elapsedVisualTime = 0;

  speed: SpeedMultiplier = 1;
  paused = false;
  simActive = false;

  step(
    rawDt: number,
    onFixedTick: (fixedDt: number) => void,
  ): { alpha: number; elapsedVisualTime: number; ticksExecuted: number } {
    const safeDt = Number.isNaN(rawDt) ? 0 : rawDt;
    const clampedDt = Math.min(Math.max(0, safeDt), BALANCE.maxFrameDt);
    this.elapsedVisualTime += clampedDt;

    let ticksExecuted = 0;
    if (this.simActive && !this.paused) {
      this.accumulator += clampedDt * this.speed;
      while (this.accumulator >= BALANCE.fixedDt && ticksExecuted < MAX_STEPS_PER_FRAME) {
        onFixedTick(BALANCE.fixedDt);
        this.accumulator -= BALANCE.fixedDt;
        ticksExecuted++;
      }
      // Carry any backlog to the next frame instead of dropping sim time, but bound it so a
      // long stall cannot trigger a spiral of catch-up frames.
      if (this.accumulator > MAX_ACCUMULATOR_SEC) {
        this.accumulator = MAX_ACCUMULATOR_SEC;
      }
    }

    const alpha = this.simActive
      ? Math.min(1, Math.max(0, this.accumulator / BALANCE.fixedDt))
      : 0;
    return { alpha, elapsedVisualTime: this.elapsedVisualTime, ticksExecuted };
  }

  resetAccumulator(): void {
    this.accumulator = 0;
  }
}
