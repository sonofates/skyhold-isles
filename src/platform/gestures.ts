/** Pure helpers for touch gestures (no DOM): kept separate so they can be unit-tested. */

export const LONG_PRESS_MS = 460;
export const DOUBLE_TAP_MAX_GAP_MS = 300;
export const DOUBLE_TAP_MAX_DIST_PX = 32;
/** Fling needs at least this release speed (px/s). */
export const FLING_MIN_SPEED = 320;

/** Recent pointer positions -> release velocity (px/s) over a short trailing window. */
export class VelocityTracker {
  private readonly xs = new Float64Array(8);
  private readonly ys = new Float64Array(8);
  private readonly ts = new Float64Array(8);
  private count = 0;
  private head = 0;

  reset(): void {
    this.count = 0;
    this.head = 0;
  }

  add(x: number, y: number, t: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) return;
    this.xs[this.head] = x;
    this.ys[this.head] = y;
    this.ts[this.head] = t;
    this.head = (this.head + 1) % 8;
    if (this.count < 8) this.count++;
  }

  /** Velocity from samples no older than `windowMs` before the newest one. */
  velocity(windowMs = 100): { vx: number; vy: number } {
    if (this.count < 2) return { vx: 0, vy: 0 };
    const newest = (this.head - 1 + 8) % 8;
    const tNew = this.ts[newest];
    let oldest = newest;
    for (let k = 1; k < this.count; k++) {
      const i = (newest - k + 8) % 8;
      if (tNew - this.ts[i] > windowMs) break;
      oldest = i;
    }
    const dt = (tNew - this.ts[oldest]) / 1000;
    if (dt <= 0.008) return { vx: 0, vy: 0 };
    return {
      vx: (this.xs[newest] - this.xs[oldest]) / dt,
      vy: (this.ys[newest] - this.ys[oldest]) / dt,
    };
  }
}

/** Detects a second tap close in time and space to the first. */
export class DoubleTapDetector {
  private lastT = -Infinity;
  private lastX = 0;
  private lastY = 0;

  /** Registers a tap; true when it completes a double tap (state then resets). */
  register(x: number, y: number, t: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) return false;
    const isDouble =
      t - this.lastT <= DOUBLE_TAP_MAX_GAP_MS &&
      Math.hypot(x - this.lastX, y - this.lastY) <= DOUBLE_TAP_MAX_DIST_PX;
    if (isDouble) {
      this.lastT = -Infinity;
      return true;
    }
    this.lastT = t;
    this.lastX = x;
    this.lastY = y;
    return false;
  }

  reset(): void {
    this.lastT = -Infinity;
  }
}
