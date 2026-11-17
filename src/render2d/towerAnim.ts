/**
 * Painted tower attack animation timing (pure, no Pixi). Render-only: the sim fires (and hits) on
 * its own clock; the renderer lines the painted shot up with it.
 *
 * Each `towerFired` plays the tier's attack sheet once. When the sheet names a `release` frame
 * (where the arrow / ball / bolt leaves), the projectile view is hidden until that frame and then
 * catches up with the sim projectile over CATCH_UP s, and a tesla bolt is drawn at that frame. To
 * keep the sim-vs-screen lag small the wind-up is clipped: playback starts late enough that the
 * release frame is at most MAX_RELEASE_LEAD s after the shot.
 *  - a new shot while the sheet is still playing restarts it (at the plan's start frame);
 *  - a projectile that lands before its release time is never drawn (its hit FX still play);
 *  - no `release` → the projectile shows at once and the sheet is purely decorative.
 */
export const MAX_RELEASE_LEAD = 0.15;
export const CATCH_UP = 0.08;

export interface AttackTiming {
  readonly count: number;
  readonly fps: number;
  /** Frame index where the shot leaves, or null. */
  readonly release: number | null;
}

export interface AttackPlan {
  readonly startFrame: number;
  /** Seconds from the shot (start of playback) to the release frame (0 = immediately). */
  readonly releaseDelay: number;
  /** Seconds of playback (start frame → last frame). */
  readonly duration: number;
}

export function attackPlan(t: AttackTiming, maxLead = MAX_RELEASE_LEAD): AttackPlan {
  const fps = t.fps > 0 ? t.fps : 12;
  const count = Math.max(1, Math.floor(t.count));
  if (t.release === null || !Number.isFinite(t.release)) {
    return { startFrame: 0, releaseDelay: 0, duration: count / fps };
  }
  const release = Math.max(0, Math.min(count - 1, Math.floor(t.release)));
  const leadFrames = Math.max(0, Math.floor(maxLead * fps + 1e-9));
  const startFrame = Math.max(0, release - leadFrames);
  return { startFrame, releaseDelay: (release - startFrame) / fps, duration: (count - startFrame) / fps };
}

/** Frame to show `elapsed` s after the shot, or null once the attack has finished. */
export function attackFrame(plan: AttackPlan, t: AttackTiming, elapsed: number): number | null {
  if (elapsed < 0 || elapsed >= plan.duration) return null;
  const fps = t.fps > 0 ? t.fps : 12;
  return Math.min(Math.max(1, Math.floor(t.count)) - 1, plan.startFrame + Math.floor(elapsed * fps + 1e-9));
}

/** Looping idle frame. */
export function idleFrame(count: number, fps: number, time: number): number {
  const n = Math.max(1, Math.floor(count));
  return ((Math.floor(time * (fps > 0 ? fps : 12)) % n) + n) % n;
}

/**
 * Projectile view reveal: -1 while hidden (before the release), else the blend 0..1 from the
 * muzzle to the sim position (1 = locked to the sim).
 */
export function projectileReveal(age: number, releaseDelay: number, catchUp = CATCH_UP): number {
  if (releaseDelay <= 0) return 1;
  if (age < releaseDelay) return -1;
  return catchUp <= 0 ? 1 : Math.min(1, (age - releaseDelay) / catchUp);
}
