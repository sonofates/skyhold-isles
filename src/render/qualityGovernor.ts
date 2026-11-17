/**
 * Adaptive quality governor: watches frame times and walks a quality ladder
 * (low <-> medium <-> high). Pure logic (no three / DOM) so it is unit-testable.
 *
 * Rules
 *  - Frames are sampled in fixed windows; the window score is the mean frame time with spikes
 *    clipped, so one shader-compile hitch cannot trigger a step.
 *  - Step down after `downWindows` consecutive slow windows (or immediately on one very slow window).
 *  - Step up only after `upStableSec` of comfortably smooth play. A step up that is followed by a
 *    step down within `bounceSec` is a "bounce": the higher tier is locked out for the session.
 *  - A display locked to a steady 30 Hz (iOS low-power mode, power saver) looks "slow" but lowering
 *    quality cannot fix it, so a flat ~33 ms signal is not treated as a GPU problem.
 *  - Warm-up frames after load / tier change / resume are ignored.
 *  - Frame pacing: on a 60/90/120 Hz display, a tier that keeps missing vsync alternates short and
 *    long frames (e.g. 8 ms / 17 ms at 120 Hz). The mean still looks fine, but motion judders.
 *    Each window estimates the display interval from its fastest frames and counts frames that
 *    took noticeably longer; too many misses count as a slow window.
 */
import type { QualityTier } from '../core/types.ts';

export const TIER_ORDER: readonly QualityTier[] = ['low', 'medium', 'high'];

export interface GovernorOptions {
  windowFrames: number;
  /** Window mean (ms) above which a window counts as slow. */
  slowMs: number;
  /** Window mean (ms) above which one window is enough to step down. */
  verySlowMs: number;
  downWindows: number;
  /** Window mean (ms) at or below which a window counts as smooth. */
  smoothMs: number;
  upStableSec: number;
  bounceSec: number;
  /** Frames ignored after reset / tier change. */
  warmupFrames: number;
  /** Single-frame clip (ms) applied before averaging. */
  clipMs: number;
  maxUpAttempts: number;
  /** Share of frames that missed the display interval above which a window counts as slow. */
  missRatioSlow: number;
  /** Share of missed frames at or below which a window may count as smooth. */
  missRatioSmooth: number;
}

export const DEFAULT_GOVERNOR_OPTIONS: GovernorOptions = {
  windowFrames: 60,
  slowMs: 22,
  verySlowMs: 40,
  downWindows: 2,
  smoothMs: 18.5,
  upStableSec: 20,
  bounceSec: 25,
  warmupFrames: 40,
  clipMs: 60,
  maxUpAttempts: 3,
  missRatioSlow: 0.15,
  missRatioSmooth: 0.05,
};

export function tierIndex(t: QualityTier): number {
  return TIER_ORDER.indexOf(t);
}

export class QualityGovernor {
  private readonly o: GovernorOptions;
  private tierNow: QualityTier;
  /** Highest tier we may climb to (lowered by bounces / by the caller). */
  private ceiling: QualityTier = 'high';
  private active = true;

  private warm = 0;
  private frames = 0;
  private sum = 0;
  private sumSq = 0;
  private slowStreak = 0;
  private smoothSec = 0;
  private clockSec = 0;
  private lastUpAtSec = -Infinity;
  private upAttempts = 0;
  private transitions = 0;
  /** Raw frame times of the current window (preallocated; sorted copy once per window). */
  private readonly buf: Float32Array;
  private readonly sorted: Float32Array;

  constructor(initial: QualityTier = 'high', opts: Partial<GovernorOptions> = {}) {
    this.o = { ...DEFAULT_GOVERNOR_OPTIONS, ...opts };
    this.buf = new Float32Array(this.o.windowFrames);
    this.sorted = new Float32Array(this.o.windowFrames);
    this.tierNow = initial;
    this.warm = this.o.warmupFrames;
  }

  get tier(): QualityTier {
    return this.tierNow;
  }

  get maxTier(): QualityTier {
    return this.ceiling;
  }

  get transitionCount(): number {
    return this.transitions;
  }

  /** Only an active governor changes tiers; fixed quality settings deactivate it. */
  setActive(active: boolean): void {
    this.active = active;
    this.resetWindow();
  }

  /** Force a tier (initial pick for Auto) without counting it as a transition. */
  setTier(tier: QualityTier): void {
    this.tierNow = tier;
    this.resetWindow();
  }

  /** Drop accumulated stats and ignore the next warm-up frames (level load, resume from hidden). */
  reset(): void {
    this.resetWindow();
  }

  private resetWindow(): void {
    this.warm = this.o.warmupFrames;
    this.frames = 0;
    this.sum = 0;
    this.sumSq = 0;
    this.slowStreak = 0;
    this.smoothSec = 0;
  }

  /**
   * Feed one frame time (ms). Returns the new tier when it changed, otherwise null.
   */
  sample(frameMs: number): QualityTier | null {
    if (!this.active || !(frameMs > 0)) return null;
    this.clockSec += frameMs / 1000;
    if (this.warm > 0) {
      this.warm--;
      return null;
    }
    const clipped = Math.min(frameMs, this.o.clipMs);
    this.buf[this.frames] = frameMs;
    this.frames++;
    this.sum += clipped;
    this.sumSq += clipped * clipped;
    if (this.frames < this.o.windowFrames) return null;

    const mean = this.sum / this.frames;
    const variance = Math.max(0, this.sumSq / this.frames - mean * mean);
    const sd = Math.sqrt(variance);
    const windowSec = this.sum / 1000;
    const missRatio = this.windowMissRatio(this.frames);
    this.frames = 0;
    this.sum = 0;
    this.sumSq = 0;
    return this.evaluateWindow(mean, sd, windowSec, missRatio);
  }

  /**
   * Share of frames in the window that missed the display interval. The interval is estimated from
   * the window's fast frames (20th percentile); only meaningful on >= ~50 Hz pacing, so a window
   * whose fast frames are already slow (30 Hz cap, heavy load) reports 0 and is left to the mean.
   */
  private windowMissRatio(n: number): number {
    if (n < 8) return 0;
    const s = this.sorted.subarray(0, n);
    s.set(this.buf.subarray(0, n));
    s.sort();
    const interval = s[Math.floor(n * 0.2)];
    if (!(interval > 4) || interval > 20) return 0;
    const limit = interval * 1.45;
    let missed = 0;
    for (let i = 0; i < n; i++) if (s[i] > limit) missed++;
    return missed / n;
  }

  private evaluateWindow(mean: number, sd: number, windowSec: number, missRatio = 0): QualityTier | null {
    const o = this.o;
    // Steady ~30 Hz (or slower) pacing with almost no jitter = refresh-rate cap, not load.
    const cappedRefresh = mean >= 28 && mean <= 36 && sd < 3;
    const juddering = missRatio > o.missRatioSlow;
    const slow = (mean > o.slowMs || juddering) && !cappedRefresh;
    if (slow) {
      this.smoothSec = 0;
      this.slowStreak++;
      if (mean > o.verySlowMs || this.slowStreak >= o.downWindows) {
        return this.stepDown();
      }
      return null;
    }
    this.slowStreak = 0;

    if (mean <= o.smoothMs && missRatio <= o.missRatioSmooth) {
      this.smoothSec += windowSec;
      if (
        this.smoothSec >= o.upStableSec &&
        tierIndex(this.tierNow) < tierIndex(this.ceiling) &&
        this.upAttempts < o.maxUpAttempts
      ) {
        return this.stepUp();
      }
    } else {
      this.smoothSec = 0;
    }
    return null;
  }

  private stepDown(): QualityTier | null {
    const i = tierIndex(this.tierNow);
    this.slowStreak = 0;
    this.smoothSec = 0;
    if (i <= 0) return null;
    // Bounce: we climbed recently and it did not hold. Lock the failed tier out.
    if (this.clockSec - this.lastUpAtSec <= this.o.bounceSec) {
      this.ceiling = TIER_ORDER[i - 1];
    }
    return this.moveTo(TIER_ORDER[i - 1]);
  }

  private stepUp(): QualityTier | null {
    const i = tierIndex(this.tierNow);
    this.upAttempts++;
    this.lastUpAtSec = this.clockSec;
    return this.moveTo(TIER_ORDER[i + 1]);
  }

  private moveTo(next: QualityTier): QualityTier {
    this.tierNow = next;
    this.transitions++;
    this.resetWindow();
    return next;
  }
}
