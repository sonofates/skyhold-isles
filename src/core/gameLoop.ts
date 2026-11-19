import { BALANCE } from '../data/balance.ts';
import type { SpeedMultiplier } from './types.ts';

/** Supported simulation speed multipliers (`1x`, `2x`, `3x`). */
export const SPEED_MULTIPLIERS: readonly SpeedMultiplier[] = BALANCE.speedMultipliers;

/** Type guard for valid `SpeedMultiplier` values (`1 | 2 | 3`). */
export function isSpeedMultiplier(val: unknown): val is SpeedMultiplier {
  return val === 1 || val === 2 || val === 3;
}

/** Coerces arbitrary numeric input to the nearest valid `SpeedMultiplier` (`1 | 2 | 3`). */
export function clampSpeedMultiplier(val: unknown, fallback: SpeedMultiplier = 1): SpeedMultiplier {
  if (isSpeedMultiplier(val)) return val;
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  if (val >= 2.5) return 3;
  if (val >= 1.5) return 2;
  return 1;
}

/** Cycles gameplay speed `1x -> 2x -> 3x -> 1x`. */
export function nextSpeedMultiplier(current: SpeedMultiplier): SpeedMultiplier {
  if (current === 1) return 2;
  if (current === 2) return 3;
  return 1;
}

/** 3x speed at the max frame dt (0.1 s) needs exactly 18 fixed ticks. */
export const MAX_STEPS_PER_FRAME = 18;
/** Upper bound of carried-over sim time when a frame hits the step cap. */
export const MAX_ACCUMULATOR_SEC = 0.25;

/**
 * Pure platform-independent fixed 60 Hz simulation accumulator.
 * Speed multiplier runs multiple fixed ticks per frame rather than scaling dt,
 * preserving bit-exact determinism across 1x, 2x, and 3x speeds.
 */
export class FixedTimestepStepper {
  private accumulator = 0;
  private elapsedVisualTime = 0;

  speed: SpeedMultiplier = 1;
  paused = false;
  simActive = false;

  /** Sets speed to a validated `1 | 2 | 3` multiplier and returns it. */
  setSpeed(speed: unknown): SpeedMultiplier {
    this.speed = clampSpeedMultiplier(speed, this.speed);
    return this.speed;
  }

  /** Cycles speed `1x -> 2x -> 3x -> 1x` and returns the new multiplier. */
  cycleSpeed(): SpeedMultiplier {
    this.speed = nextSpeedMultiplier(this.speed);
    return this.speed;
  }

  step(
    rawDt: number,
    onFixedTick: (fixedDt: number) => void,
    shouldContinue?: () => boolean,
  ): { alpha: number; elapsedVisualTime: number; ticksExecuted: number } {
    const safeDt = Number.isFinite(rawDt) ? rawDt : 0;
    const clampedDt = Math.min(Math.max(0, safeDt), BALANCE.maxFrameDt);
    this.elapsedVisualTime += clampedDt;

    let ticksExecuted = 0;
    if (this.simActive && !this.paused && (!shouldContinue || shouldContinue())) {
      const mult = clampSpeedMultiplier(this.speed, 1);
      this.accumulator += clampedDt * mult;
      while (
        this.simActive &&
        !this.paused &&
        (!shouldContinue || shouldContinue()) &&
        this.accumulator >= BALANCE.fixedDt &&
        ticksExecuted < MAX_STEPS_PER_FRAME
      ) {
        this.accumulator -= BALANCE.fixedDt;
        ticksExecuted++;
        onFixedTick(BALANCE.fixedDt);
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
