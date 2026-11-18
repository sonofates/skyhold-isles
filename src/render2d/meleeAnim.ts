/**
 * Melee fight animation math (pure, no Pixi, allocation-free per frame). Render-only: the sim
 * decides when blows land (soldierSystem `meleeSwing` / `meleeHit` events); this lines the painted
 * swing up with them and keeps the two fighters apart and facing each other.
 *
 * Swing timing — every swing is a clip with a `lead` (sheet seconds from frame 0 to the impact
 * frame) and a `dur` (whole clip). A painted attack sheet gives lead = impact / fps; without one a
 * procedural clip (wind-up lean back → fast lunge → recover) is used.
 *  - `announceSwing`: the sim says the blow lands in `impactIn` s. With enough time the clip is
 *    queued to start at impactIn − lead (pre-roll, like the tower attack sheets); with less (first
 *    blow 0.2 s after contact, fast mites) it starts now, part-way, with the wind-up sped up (≤
 *    MAX_WINDUP_SPEED) so the impact frame still lands on the blow. A recovery still playing when
 *    the next wind-up is due is hurried to finish first.
 *  - `impactSwing`: the blow landed (authoritative): a clip short of its impact frame jumps to it;
 *    a blow with no clip playing shows the strike from the impact frame on.
 *  - `cancelSwing`: the fight ended before the impact (target died, held enemy walked on): the
 *    pose fades back to the walk over CANCEL_FADE s instead of finishing the blow in the air.
 */

export interface SwingClip {
  /** Sheet seconds from the first frame to the impact frame. */
  readonly lead: number;
  /** Sheet seconds of the whole clip (≥ lead). */
  readonly dur: number;
}

export interface SheetTiming {
  readonly count: number;
  readonly fps: number;
  /** Impact frame index (null / missing → the middle frame). */
  readonly impact: number | null;
}

/** Procedural swings: light (soldiers, most enemies) and heavy (golem, boss, tempest, brute). */
export const PROC_CLIP: SwingClip = { lead: 0.3, dur: 0.54 };
export const PROC_CLIP_HEAVY: SwingClip = { lead: 0.46, dur: 0.82 };
export const MAX_WINDUP_SPEED = 2.5;
export const MAX_RECOVER_SPEED = 3;
/** A blow arriving this long after the impact frame passed does not restart the clip. */
export const IMPACT_GRACE = 0.12;
export const CANCEL_FADE = 0.12;

export function sheetClip(t: SheetTiming): SwingClip {
  const fps = t.fps > 0 ? t.fps : 12;
  const count = Math.max(1, Math.floor(t.count));
  const raw = t.impact === null || !Number.isFinite(t.impact) ? Math.floor(count / 2) : Math.floor(t.impact);
  const impact = Math.max(0, Math.min(count - 1, raw));
  return { lead: impact / fps, dur: count / fps };
}

export interface SwingState {
  /** Sheet time of the playing clip; < 0 = not swinging. */
  t: number;
  clip: SwingClip;
  /** Playback speed up to the impact frame, then after it. */
  speed: number;
  recSpeed: number;
  /** Sim seconds until a queued clip starts (Infinity = none queued). */
  pendingIn: number;
  pendingClip: SwingClip;
  /** 1 = full pose; falls to 0 while a cancelled swing fades out. */
  fade: number;
  cancelled: boolean;
}

export function createSwing(): SwingState {
  return { t: -1, clip: PROC_CLIP, speed: 1, recSpeed: 1, pendingIn: Infinity, pendingClip: PROC_CLIP, fade: 1, cancelled: false };
}

function start(s: SwingState, clip: SwingClip, t: number, speed: number): void {
  s.clip = clip;
  s.t = t;
  s.speed = speed;
  s.recSpeed = 1;
  s.fade = 1;
  s.cancelled = false;
  s.pendingIn = Infinity;
}

/** True while a clip plays (including a fading cancelled one). */
export function swinging(s: SwingState): boolean {
  return s.t >= 0;
}

/** The sim announced a blow landing in `impactIn` sim seconds. */
export function announceSwing(s: SwingState, clip: SwingClip, impactIn: number): void {
  const startIn = impactIn - clip.lead;
  if (startIn > 1e-6) {
    s.pendingIn = startIn;
    s.pendingClip = clip;
    // Still recovering from the last blow: finish the recovery before the next wind-up.
    if (s.t >= s.clip.lead && s.t < s.clip.dur && !s.cancelled) {
      s.recSpeed = Math.max(1, Math.min(MAX_RECOVER_SPEED, (s.clip.dur - s.t) / startIn));
    }
    return;
  }
  const speed = Math.max(1, Math.min(MAX_WINDUP_SPEED, clip.lead / Math.max(1e-3, impactIn)));
  start(s, clip, Math.max(0, clip.lead - Math.max(0, impactIn) * speed), speed);
}

/** The blow landed now. `clip` = the attacker's clip (used when nothing is playing). */
export function impactSwing(s: SwingState, clip: SwingClip): void {
  const playing = s.t >= 0 && !s.cancelled;
  if (playing && s.t < s.clip.lead) {
    s.t = s.clip.lead;
    s.pendingIn = Infinity;
  } else if (playing && s.t <= s.clip.lead + IMPACT_GRACE) {
    s.pendingIn = Infinity;
  } else {
    start(s, clip, clip.lead, 1);
  }
  s.speed = 1;
}

/** The fight ended: a clip short of its impact fades out; a recovering one finishes. */
export function cancelSwing(s: SwingState): void {
  s.pendingIn = Infinity;
  if (s.t >= 0 && s.t < s.clip.lead) s.cancelled = true;
}

/** Advance by `dt` sim seconds. */
export function advanceSwing(s: SwingState, dt: number): void {
  if (dt <= 0) return;
  if (s.t >= 0) {
    if (s.cancelled) {
      s.fade -= dt / CANCEL_FADE;
      if (s.fade <= 0) {
        s.t = -1;
        s.fade = 1;
        s.cancelled = false;
      }
    } else {
      s.t += dt * (s.t < s.clip.lead ? s.speed : s.recSpeed);
      if (s.t >= s.clip.dur) s.t = -1;
    }
  }
  if (s.pendingIn !== Infinity) {
    s.pendingIn -= dt;
    if (s.pendingIn <= 0) start(s, s.pendingClip, Math.min(s.pendingClip.lead, -s.pendingIn), 1);
  }
}

/** Attack-sheet frame for the playing clip, or null when not swinging. */
export function swingFrame(s: SwingState, count: number, fps: number): number | null {
  if (s.t < 0) return null;
  const n = Math.max(1, Math.floor(count));
  return Math.max(0, Math.min(n - 1, Math.floor(s.t * (fps > 0 ? fps : 12) + 1e-9)));
}

export interface SwingPose {
  /** Along the facing: −0.35 (leaning back) … 1 (full lunge), × the unit's reach. */
  forward: number;
  /** Small hop, × the unit's height. */
  lift: number;
  /** −1 (leaning back) … 1.2 (pitched into the blow), × the unit's max tilt. */
  tilt: number;
  scaleX: number;
  scaleY: number;
}

export function createSwingPose(): SwingPose {
  return { forward: 0, lift: 0, tilt: 0, scaleX: 1, scaleY: 1 };
}

const easeInOut = (k: number): number => k * k * (3 - 2 * k);

/** Procedural swing pose (also layered lightly over painted sheets for weight). */
export function swingPose(s: SwingState, out: SwingPose): SwingPose {
  out.forward = 0;
  out.lift = 0;
  out.tilt = 0;
  out.scaleX = 1;
  out.scaleY = 1;
  if (s.t < 0) return out;
  const { lead, dur } = s.clip;
  const strike = Math.min(0.1, lead * 0.35);
  const windEnd = Math.max(0, lead - strike);
  const t = s.t;
  if (t < windEnd) {
    const k = easeInOut(t / Math.max(1e-6, windEnd));
    out.forward = -0.35 * k;
    out.tilt = -k;
    out.scaleX = 1 - 0.03 * k;
    out.scaleY = 1 + 0.05 * k;
  } else if (t < lead) {
    const k = Math.min(1, (t - windEnd) / Math.max(1e-6, strike));
    const e = k * k;
    out.forward = -0.35 + 1.35 * e;
    out.tilt = -1 + 2.2 * e;
    out.scaleX = 1 - 0.03 + 0.11 * e;
    out.scaleY = 1 + 0.05 - 0.12 * e;
    out.lift = 0.03 * Math.sin(Math.PI * k);
  } else {
    const k = Math.min(1, (t - lead) / Math.max(1e-6, dur - lead));
    const r = 1 - (1 - (1 - k) * (1 - k)); // ease-out back to rest
    out.forward = r;
    out.tilt = 1.2 * r;
    out.scaleX = 1 + 0.08 * r;
    out.scaleY = 1 - 0.07 * r;
  }
  const f = s.cancelled ? Math.max(0, s.fade) : 1;
  if (f < 1) {
    out.forward *= f;
    out.tilt *= f;
    out.lift *= f;
    out.scaleX = 1 + (out.scaleX - 1) * f;
    out.scaleY = 1 + (out.scaleY - 1) * f;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Facing and spacing.

/** +1 / −1 facing toward a foe `dx` world units to the right; keeps `current` when nearly vertical. */
export function faceToward(dx: number, current: number, eps = 0.06): number {
  if (dx > eps) return 1;
  if (dx < -eps) return -1;
  return current >= 0 ? 1 : -1;
}

/**
 * Which side (+1 right / −1 left) of its foe a fighter stands on, with hysteresis: it only
 * switches once it is clearly (`hyst` world units) on the other side.
 */
export function pickSide(dx: number, prev: number, hyst: number): number {
  if (prev === 0) return dx >= 0 ? 1 : -1;
  return prev > 0 ? (dx < -hyst ? -1 : 1) : dx > hyst ? 1 : -1;
}

/** Distance (world units) between a fighter's and its foe's centres so the sprites don't overlap. */
export function fightGap(contact: number, foeHeight: number, fighterHeight: number): number {
  return Math.max(contact, 0.3 * foeHeight + 0.3 * fighterHeight) + 0.04;
}

/**
 * Stand-off spots around one foe for the `n` fighters on it, relative to the foe (world units,
 * x right, z down the screen). Fighters stay on their own side (`sides[i]`); fighters sharing a
 * side stack up and down it (sorted by `dz[i]`, so nobody crosses another), the middle one of
 * three a little further out. One fighter keeps a bit of its own height offset (clamped).
 */
export function gangSlots(
  n: number,
  sides: ArrayLike<number>,
  dz: ArrayLike<number>,
  gap: number,
  outX: number[],
  outZ: number[],
): void {
  outX.length = n;
  outZ.length = n;
  for (let side = -1; side <= 1; side += 2) {
    let k = 0;
    for (let i = 0; i < n; i++) if (sides[i] === side) k++;
    if (k === 0) continue;
    for (let i = 0; i < n; i++) {
      if (sides[i] !== side) continue;
      // Rank among this side by dz (ties by index), no allocation.
      let rank = 0;
      for (let j = 0; j < n; j++) {
        if (j === i || sides[j] !== side) continue;
        if (dz[j] < dz[i] || (dz[j] === dz[i] && j < i)) rank++;
      }
      if (k === 1) {
        outX[i] = side * gap;
        outZ[i] = Math.max(-0.2 * gap, Math.min(0.2 * gap, dz[i]));
      } else {
        const spread = Math.min(0.42, 0.84 / (k - 1)) * gap;
        const mid = (k - 1) / 2;
        const off = rank - mid;
        const out = k >= 3 && Math.abs(off) < 0.5 ? 1.12 : 0.94;
        outX[i] = side * gap * out;
        outZ[i] = off * spread;
      }
    }
  }
}

/** Exponential smoothing factor for a time constant `tau` over `dt`. */
export function smoothK(dt: number, tau: number): number {
  if (dt <= 0) return 0;
  return tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
}

/** Knockback nudge: 0 → 1 → 0 over `life` s (a jolt, not a slide). */
export function knockCurve(t: number, life: number): number {
  if (t < 0 || t >= life) return 0;
  const k = t / life;
  return k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7;
}
