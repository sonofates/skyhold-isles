/**
 * Soft pan limits in camera-plane coordinates (pure math). The camera target may wander only as
 * far as keeps the island meaningfully on screen:
 *  - island bigger than the view on an axis: the view stays inside the island (plus overscroll),
 *  - island smaller than the view: the island stays inside the view (plus overscroll),
 * and the framing chosen by the auto-fit is always reachable so the first drag never snaps back.
 */
export interface PlaneExtents {
  rMin: number;
  rMax: number;
  uMin: number;
  uMax: number;
}

/** Allowed target range on one axis. `half` = half the view span (world units). */
export function axisRange(
  min: number,
  max: number,
  half: number,
  slack: number,
  keep?: number,
): { lo: number; hi: number } {
  const s = slack * half;
  const span = max - min;
  let lo: number;
  let hi: number;
  if (span >= 2 * half) {
    lo = min + half - s;
    hi = max - half + s;
  } else {
    lo = max - half - s;
    hi = min + half + s;
  }
  if (keep !== undefined) {
    if (keep < lo) lo = keep;
    if (keep > hi) hi = keep;
  }
  return { lo, hi };
}

export function clampPlaneTarget(
  tr: number,
  tu: number,
  ext: PlaneExtents,
  halfR: number,
  halfU: number,
  slack: number,
  keep?: { r: number; u: number },
): { r: number; u: number } {
  const rr = axisRange(ext.rMin, ext.rMax, halfR, slack, keep?.r);
  const ru = axisRange(ext.uMin, ext.uMax, halfU, slack, keep?.u);
  return {
    r: Math.max(rr.lo, Math.min(rr.hi, tr)),
    u: Math.max(ru.lo, Math.min(ru.hi, tu)),
  };
}

/** Speed (px/s) under which a running fling stops. */
export const FLING_STOP_SPEED = 25;

/** One step of an exponentially decaying fling. Returns the new velocity and the movement. */
export function stepFling(
  vx: number,
  vy: number,
  dt: number,
  decayPerSec = 4.2,
): { vx: number; vy: number; dx: number; dy: number } {
  const k = Math.exp(-decayPerSec * dt);
  return { vx: vx * k, vy: vy * k, dx: vx * dt, dy: vy * dt };
}
