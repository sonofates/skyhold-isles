/**
 * Painted tower attack animation timing (pure, no Pixi). Render-only: the sim fires (and hits) on
 * its own clock; the renderer lines the painted shot up with it.
 *
 * Each shot plays the tier's attack sheet from frame 0; the projectile / bolt / muzzle FX appear
 * at the sheet's `release` frame. Because the sim decides to fire on the tick it fires, the sheet
 * is PRE-ROLLED: when a tower has a target and its cooldown will run out within the release delay,
 * playback starts early so the release frame lands on the actual shot (shot delay ~0). If a shot
 * comes without a pre-roll (first shot right after a target appears), the sheet starts at frame 0
 * on the shot and the projectile view waits for the release frame, then catches up with the sim
 * projectile over CATCH_UP s (a projectile that lands before that is not drawn; its hit FX play).
 *  - a shot while the sheet is still playing (not pre-rolled for it) restarts it from frame 0;
 *  - a pre-roll whose shot never comes (target lost) just plays out and disarms;
 *  - no `release` → the projectile shows at once and the sheet is purely decorative;
 *  - idle (no sheet playing) → the static tier sprite.
 */
export const MAX_RELEASE_LEAD = Number.POSITIVE_INFINITY;
export const CATCH_UP = 0.08;
/** A pre-roll with no shot this long after its release frame disarms. */
export const PREROLL_GRACE = 0.3;

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

export interface PrerollInput {
  /** The tower has a target in range now (and is not stunned). */
  readonly hasTarget: boolean;
  /** Sim seconds until the cooldown runs out (Infinity when unknown). */
  readonly eta: number;
  readonly releaseDelay: number;
  /** Already pre-rolled for the upcoming shot. */
  readonly armed: boolean;
}

/** Start the attack sheet now so its release frame lands on the predicted shot. */
export function shouldPreroll(o: PrerollInput): boolean {
  return o.hasTarget && !o.armed && o.releaseDelay > 0 && o.eta <= o.releaseDelay;
}

/**
 * Shot arrives: keep a pre-rolled playback (shot delay = what is left to the release frame) or
 * restart from frame 0 (delay = the full release delay). Returns the playback time to continue
 * from and the projectile / FX delay.
 */
export function onShot(armed: boolean, elapsed: number, releaseDelay: number): { elapsed: number; shotDelay: number } {
  if (armed && elapsed >= 0 && elapsed <= releaseDelay + PREROLL_GRACE) return { elapsed, shotDelay: Math.max(0, releaseDelay - elapsed) };
  return { elapsed: 0, shotDelay: releaseDelay };
}

/**
 * Playback time to set when a pre-roll starts this frame. The renderer advances the sheet by `simDt`
 * right after (same frame), so start one frame back, but never below 0: a negative time reads as
 * "not playing" and would freeze the sheet until the shot (it then restarts from frame 0, delayed).
 * The release frame lands at most one frame early.
 */
export function prerollStart(releaseDelay: number, eta: number, simDt: number): number {
  return Math.max(0, releaseDelay - Math.max(0, eta) - simDt);
}

/** Cooldown seconds left → sim seconds to the shot, from the observed cooldown drain rate (per sim s). */
export function shotEta(cooldown: number, drainPerSec: number): number {
  if (cooldown <= 0) return 0;
  return drainPerSec > 1e-6 ? cooldown / drainPerSec : Number.POSITIVE_INFINITY;
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
