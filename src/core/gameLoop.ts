import { BALANCE } from '../data/balance.ts';
import type { SpeedMultiplier } from './types.ts';

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
    const clampedDt = Math.min(Math.max(0, rawDt), BALANCE.maxFrameDt);
    this.elapsedVisualTime += clampedDt;

    let ticksExecuted = 0;
    if (this.simActive && !this.paused) {
      this.accumulator += clampedDt * this.speed;
      const maxStepsPerFrame = 12;
      while (this.accumulator >= BALANCE.fixedDt && ticksExecuted < maxStepsPerFrame) {
        onFixedTick(BALANCE.fixedDt);
        this.accumulator -= BALANCE.fixedDt;
        ticksExecuted++;
      }
      if (ticksExecuted >= maxStepsPerFrame) {
        this.accumulator = 0;
      }
    }

    const alpha = this.simActive ? this.accumulator / BALANCE.fixedDt : 0;
    return { alpha, elapsedVisualTime: this.elapsedVisualTime, ticksExecuted };
  }

  resetAccumulator(): void {
    this.accumulator = 0;
  }
}
