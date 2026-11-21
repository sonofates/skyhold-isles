import { clampSpeedMultiplier, FixedTimestepStepper } from '../core/gameLoop.ts';
import type { SpeedMultiplier } from '../core/types.ts';

export interface LoopCallbacks {
  onFixedTick: (fixedDt: number) => void;
  onRender: (frameDt: number, alpha: number, elapsedVisualTime: number) => void;
}

export class GameLoop {
  readonly stepper = new FixedTimestepStepper();
  private callbacks: LoopCallbacks;
  private rafId: number | null = null;
  private lastTimestamp = 0;
  private runId = 0;

  constructor(callbacks: LoopCallbacks) {
    this.callbacks = callbacks;
  }

  get speed(): SpeedMultiplier {
    return clampSpeedMultiplier(this.stepper.speed);
  }

  set speed(val: SpeedMultiplier) {
    this.stepper.setSpeed(val);
  }

  /** Cycles gameplay speed `1x -> 2x -> 3x -> 1x` and returns the new multiplier. */
  cycleSpeed(): SpeedMultiplier {
    return this.stepper.cycleSpeed();
  }

  get paused(): boolean {
    return this.stepper.paused;
  }

  set paused(val: boolean) {
    this.stepper.paused = val;
  }

  get simActive(): boolean {
    return this.stepper.simActive;
  }

  set simActive(val: boolean) {
    this.stepper.simActive = val;
  }

  start(): void {
    if (this.rafId !== null) return;
    const myRunId = ++this.runId;
    const isStillRunning = (): boolean => this.runId === myRunId;
    this.lastTimestamp = performance.now();
    const tick = (now: number): void => {
      if (this.runId !== myRunId) return;
      // Schedule the next frame first so a single thrown frame cannot kill the loop forever.
      // If stop() is called from inside a callback it cancels this pending request and bumps runId.
      this.rafId = requestAnimationFrame(tick);
      const deltaSec = Number.isFinite(now) ? (now - this.lastTimestamp) / 1000 : 0;
      const rawDt = Math.max(0, Math.min(deltaSec, 0.1));
      if (Number.isFinite(now)) this.lastTimestamp = now;
      try {
        const { alpha, elapsedVisualTime } = this.stepper.step(
          rawDt,
          this.callbacks.onFixedTick,
          isStillRunning,
        );
        if (this.runId !== myRunId) return;
        this.callbacks.onRender(rawDt, alpha, elapsedVisualTime);
      } catch (err) {
        console.error('[GameLoop] frame threw:', err);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.runId++;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resetAccumulator(): void {
    this.stepper.resetAccumulator();
  }
}
