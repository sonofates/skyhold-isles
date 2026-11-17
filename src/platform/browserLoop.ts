import { FixedTimestepStepper } from '../core/gameLoop.ts';
import type { SpeedMultiplier } from '../core/types.ts';

export type RenderPacingMode = 'hidden' | 'active' | 'wake' | 'menu' | 'modal' | 'paused';

export interface RenderPacingContext {
  readonly hidden: boolean;
  readonly simActive: boolean;
  readonly paused: boolean;
  readonly modalOpen: boolean;
  readonly menuView: 'menu' | 'levelSelect' | 'playing';
  readonly wakeActive: boolean;
}

export interface RenderPacingTarget {
  readonly targetFps: number | null;
  readonly mode: RenderPacingMode;
}

const PACING_HIDDEN: RenderPacingTarget = Object.freeze({ targetFps: 0, mode: 'hidden' });
const PACING_ACTIVE: RenderPacingTarget = Object.freeze({ targetFps: null, mode: 'active' });
const PACING_WAKE: RenderPacingTarget = Object.freeze({ targetFps: null, mode: 'wake' });
const PACING_MODAL: RenderPacingTarget = Object.freeze({ targetFps: 15, mode: 'modal' });
const PACING_MENU: RenderPacingTarget = Object.freeze({ targetFps: 30, mode: 'menu' });
const PACING_PAUSED: RenderPacingTarget = Object.freeze({ targetFps: 20, mode: 'paused' });

/**
 * Pure frame-pacing policy for battery savings:
 * - Tab hidden -> skip rendering (0 fps)
 * - Active gameplay -> uncapped native VSync
 * - Active user input / camera motion while paused -> temporary full VSync wake
 * - Modals & level select -> 15 fps
 * - Main menu showcase -> 30 fps
 * - Idle paused gameplay -> 20 fps
 */
export function computeRenderPacingTarget(ctx: RenderPacingContext): RenderPacingTarget {
  if (ctx.hidden) {
    return PACING_HIDDEN;
  }
  if (ctx.simActive && !ctx.paused && !ctx.modalOpen) {
    return PACING_ACTIVE;
  }
  if (ctx.modalOpen || ctx.menuView === 'levelSelect') {
    return PACING_MODAL;
  }
  if (ctx.menuView === 'menu') {
    return PACING_MENU;
  }
  if (ctx.wakeActive) {
    return PACING_WAKE;
  }
  if (ctx.paused) {
    return PACING_PAUSED;
  }
  return PACING_ACTIVE;
}

export interface LoopCallbacks {
  onFixedTick: (fixedDt: number) => void;
  onRender: (frameDt: number, alpha: number, elapsedVisualTime: number) => void;
  onAfterRender?: (
    frameDt: number,
    workMs: number,
    throttled: boolean,
    sleepBoundary?: boolean,
    actualFrameDt?: number,
  ) => void;
  onVisibilityRestore?: () => void;
  resolveRenderPacing?: (wakeActive: boolean) => RenderPacingTarget;
}

export interface CameraPoseSnapshot {
  x: number;
  y: number;
  z: number;
  zoom: number;
}

const CAMERA_WAKE_POS_EPSILON = 0.002;
const CAMERA_WAKE_ZOOM_EPSILON = 0.0005;

/**
 * Returns true only when camera position or zoom moved past a sub-pixel threshold (~0.05-0.15px),
 * preventing asymptotic exponential pan/zoom lerps from keeping paused rendering awake at 60Hz.
 */
export function hasVisibleCameraMotion(
  prev: Readonly<CameraPoseSnapshot>,
  x: number,
  y: number,
  z: number,
  zoom: number,
): boolean {
  return (
    Math.abs(x - prev.x) > CAMERA_WAKE_POS_EPSILON ||
    Math.abs(y - prev.y) > CAMERA_WAKE_POS_EPSILON ||
    Math.abs(z - prev.z) > CAMERA_WAKE_POS_EPSILON ||
    Math.abs(zoom - prev.zoom) > CAMERA_WAKE_ZOOM_EPSILON
  );
}

const VSYNC_JITTER_TOLERANCE_MS = 1.5;

export class GameLoop {
  readonly stepper = new FixedTimestepStepper();
  private callbacks: LoopCallbacks;
  private rafId: number | null = null;
  private running = false;
  private lastTimestamp = 0;
  private lastRenderTimestamp = 0;
  private hasRendered = false;
  private maxRenderFps: number | null = null;
  private pacingMode: RenderPacingMode = 'active';
  private wakeUntilMs = 0;
  private lastWorkMs = 0;
  private lastThrottled = false;
  private visibilityBound = false;

  private readonly onVisibilityChange = (): void => {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      this.wakeUntilMs = 0;
      this.hasRendered = false;
      this.lastThrottled = false;
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      return;
    }
    if (this.running && this.rafId === null) {
      this.lastTimestamp = performance.now();
      this.lastRenderTimestamp = 0;
      this.hasRendered = false;
      this.callbacks.onVisibilityRestore?.();
      if (this.running && this.rafId === null) {
        this.rafId = requestAnimationFrame(this.tick);
      }
    }
  };

  private readonly tick = (now: number): void => {
    if (!this.running) {
      this.rafId = null;
      return;
    }
    if (typeof document !== 'undefined' && document.hidden) {
      this.wakeUntilMs = 0;
      this.hasRendered = false;
      this.lastThrottled = false;
      this.rafId = null;
      return;
    }

    // Schedule the next frame first so a single thrown frame cannot kill the loop forever.
    // If stop() is called from inside a callback it cancels this pending request.
    this.rafId = requestAnimationFrame(this.tick);

    const waking = now < this.wakeUntilMs;
    if (this.callbacks.resolveRenderPacing) {
      const nextPacing = this.callbacks.resolveRenderPacing(waking);
      this.maxRenderFps = nextPacing.targetFps;
      this.pacingMode = nextPacing.mode;
    }
    const capFps = this.callbacks.resolveRenderPacing
      ? this.maxRenderFps
      : waking && (this.pacingMode === 'paused' || this.pacingMode === 'wake')
        ? null
        : this.maxRenderFps;
    if (capFps !== null && capFps <= 0) {
      return;
    }
    if (capFps !== null && capFps > 0 && this.hasRendered) {
      const minIntervalMs = 1000 / capFps - VSYNC_JITTER_TOLERANCE_MS;
      if (now - this.lastRenderTimestamp < minIntervalMs) {
        return;
      }
    }

    const actualFrameDt = Math.max(0, (now - this.lastTimestamp) / 1000);
    const rawDt = Math.min(actualFrameDt, 0.1);
    this.lastTimestamp = now;
    this.lastRenderTimestamp = now;
    this.hasRendered = true;
    const throttled = capFps !== null && capFps > 0;
    const resumedFromThrottle = this.lastThrottled && !throttled;
    this.lastThrottled = throttled;

    const workStart = performance.now();
    try {
      const { alpha, elapsedVisualTime } = this.stepper.step(
        rawDt,
        this.callbacks.onFixedTick,
      );
      this.callbacks.onRender(rawDt, alpha, elapsedVisualTime);
    } catch (err) {
      console.error('[GameLoop] frame threw:', err);
    }
    this.lastWorkMs = performance.now() - workStart;
    this.callbacks.onAfterRender?.(
      rawDt,
      this.lastWorkMs,
      throttled || resumedFromThrottle,
      resumedFromThrottle,
      actualFrameDt,
    );
  };

  constructor(callbacks: LoopCallbacks) {
    this.callbacks = callbacks;
  }

  get speed(): SpeedMultiplier {
    return this.stepper.speed;
  }

  set speed(val: SpeedMultiplier) {
    this.stepper.speed = val;
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

  setRenderPacing(targetFps: number | null, mode: RenderPacingMode = 'active'): void {
    this.maxRenderFps = targetFps;
    this.pacingMode = mode;
  }

  wakeRender(durationSec = 0.75): void {
    if (!Number.isFinite(durationSec) || durationSec <= 0) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    this.wakeUntilMs = Math.max(this.wakeUntilMs, now + durationSec * 1000);
  }

  isWakeActive(): boolean {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    return now < this.wakeUntilMs;
  }

  getPacingInfo(): {
    mode: RenderPacingMode;
    targetFps: number | null;
    throttled: boolean;
    lastWorkMs: number;
  } {
    const wakePaused = this.pacingMode === 'paused' && this.isWakeActive();
    const wakeFpsNull = this.pacingMode === 'wake' || wakePaused;
    return {
      mode: wakePaused ? 'wake' : this.pacingMode,
      targetFps: wakeFpsNull ? null : this.maxRenderFps,
      throttled: this.lastThrottled,
      lastWorkMs: this.lastWorkMs,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimestamp = performance.now();
    this.lastRenderTimestamp = 0;
    this.hasRendered = false;

    if (typeof document !== 'undefined' && !this.visibilityBound) {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      this.visibilityBound = true;
    }

    if (typeof document !== 'undefined' && document.hidden) {
      return;
    }
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    this.wakeUntilMs = 0;
    this.lastThrottled = false;
    this.hasRendered = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (typeof document !== 'undefined' && this.visibilityBound) {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      this.visibilityBound = false;
    }
  }

  resetAccumulator(): void {
    this.stepper.resetAccumulator();
  }
}
