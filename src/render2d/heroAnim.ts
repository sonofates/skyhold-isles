import { BALANCE } from '../data/balance.ts';
import type { HeroState } from '../sim/heroSystem.ts';

/**
 * Pure, Pixi-free hero sprite animation & facing state machine for `HeroLayer`.
 *
 * Driven directly by sim-authoritative displacement (`x - prevX`, `z - prevZ`) and `waypoints[0]`
 * rather than lagged screen-space EMA deltas:
 * - Plays `walk` whenever the hero actually steps along the ground (including `'moving'`,
 *   `'engaging'`, and post-combat return walks to `(postX, postZ)` in `'idle'`).
 * - Immediately cancels lingering `attack` swings when a move order is issued or the hero begins
 *   walking, preventing frozen-swing skating.
 * - Uses angular hysteresis on `walkSeq` (`down` / `up` / `side`) and an angular ratio + distance
 *   deadzone on horizontal `facing` so near-vertical paths and shots never flip-flop.
 */

export const DEATH_HOLD = 2.0;
export const DEATH_FADE = 0.7;

const FIXED_DT = BALANCE.fixedDt;
/** Steps larger than this in one 60Hz tick are teleports (respawn / seek), not walks. */
const HERO_TELEPORT_DIST = 1.5;
/** World-unit horizontal deadzone for combat/cast facing updates (`~4 px` @ 50 px/u). */
export const HERO_FACE_DEADZONE = 0.08;
/** Minimum `|vx / vz|` ratio (`~11.3°` off vertical) before a walk step flips horizontal facing. */
const WALK_FACE_RATIO = 0.2;

export type HeroWalkSeq = 'down' | 'up' | 'side';
export type HeroAnimKind = 'idle' | HeroWalkSeq | 'attack' | 'death';

export interface HeroSeqDesc {
  readonly frames: { readonly length: number };
  readonly fps: number;
  readonly impact: number | null;
}

export interface HeroArtDesc {
  readonly idle: HeroSeqDesc;
  readonly down: HeroSeqDesc;
  readonly up: HeroSeqDesc;
  readonly side: HeroSeqDesc;
  readonly attack: HeroSeqDesc | null;
  readonly death: HeroSeqDesc | null;
}

export interface HeroAnimState {
  facing: 1 | -1;
  animT: number;
  walkSeq: HeroWalkSeq;
  attackT: number;
  attackRate: number;
  impactPending: boolean;
  deathT: number;
}

export interface HeroAnimStepInput {
  readonly heroState: HeroState;
  readonly x: number;
  readonly z: number;
  readonly prevX: number;
  readonly prevZ: number;
  readonly yaw: number;
  readonly moveSpeed: number;
  readonly attackTimer: number;
  readonly expectsAttack: boolean;
  readonly targetX: number | null;
  readonly nextWaypointX: number | null;
  readonly nextWaypointZ: number | null;
  readonly simDt: number;
  readonly dt: number;
}

export interface HeroPoseOut {
  kind: HeroAnimKind;
  frame: number;
  flip: boolean;
  alphaBody: number;
  prerolled: boolean;
}

export function createHeroAnimState(): HeroAnimState {
  return {
    facing: 1,
    animT: 0,
    walkSeq: 'down',
    attackT: -1,
    attackRate: 1,
    impactPending: false,
    deathT: -1,
  };
}

export function createHeroPoseOut(): HeroPoseOut {
  return {
    kind: 'idle',
    frame: 0,
    flip: false,
    alphaBody: 1,
    prerolled: false,
  };
}

export function resetHeroAnimState(state: HeroAnimState): void {
  state.attackT = -1;
  state.attackRate = 1;
  state.impactPending = false;
  state.deathT = -1;
}

export function faceToward(
  dx: number,
  currentFacing: 1 | -1,
  deadzone = HERO_FACE_DEADZONE,
): 1 | -1 {
  if (Math.abs(dx) > deadzone) return dx > 0 ? 1 : -1;
  return currentFacing;
}

export function applyMotionFacing(state: HeroAnimState, vx: number, vz: number): void {
  const avx = Math.abs(vx);
  const avz = Math.abs(vz);
  if (avx + avz <= 1e-6) return;

  // Hysteresis: near-diagonal motion retains the active walk sheet unless vertical sign reversed.
  if (avx > avz * 1.25) {
    state.walkSeq = 'side';
  } else if (avz > avx * 0.9) {
    state.walkSeq = vz > 0 ? 'down' : 'up';
  } else if (state.walkSeq === 'down' && vz < -avx * 0.25) {
    state.walkSeq = 'up';
  } else if (state.walkSeq === 'up' && vz > avx * 0.25) {
    state.walkSeq = 'down';
  }

  // Only flip horizontal facing when lateral motion exceeds the vertical-bevel deadzone ratio.
  if (avx > avz * WALK_FACE_RATIO) {
    state.facing = vx > 0 ? 1 : -1;
  }
}

export function onHeroMoveOrdered(
  state: HeroAnimState,
  fromX: number,
  fromZ: number,
  targetX: number,
  targetZ: number,
): void {
  state.attackT = -1;
  state.impactPending = false;
  const dx = targetX - fromX;
  const dz = targetZ - fromZ;
  if (Math.hypot(dx, dz) > 1e-4) {
    applyMotionFacing(state, dx, dz);
  }
}

export function onHeroAttackImpact(
  state: HeroAnimState,
  x: number,
  targetX: number,
  atk: HeroSeqDesc | null,
): void {
  state.facing = faceToward(targetX - x, state.facing);
  if (!atk) return;
  const impact = atk.impact ?? 2;
  const atImpact =
    state.attackT >= 0 && Math.floor(state.attackT * atk.fps * state.attackRate) >= impact - 1;
  if (!(state.attackT >= 0 && state.impactPending && atImpact)) {
    state.attackRate = 1;
    state.attackT = impact / atk.fps;
  }
  state.impactPending = false;
}

export function onHeroCastAnim(
  state: HeroAnimState,
  x: number,
  targetX: number,
  atk: HeroSeqDesc | null,
): void {
  state.facing = faceToward(targetX - x, state.facing);
  if (atk) {
    state.attackT = 0;
    state.attackRate = 1.2;
    state.impactPending = false;
  }
}

export function stepHeroAnim(
  state: HeroAnimState,
  art: HeroArtDesc,
  input: HeroAnimStepInput,
  out: HeroPoseOut,
): void {
  out.prerolled = false;
  out.alphaBody = 1;

  if (input.heroState === 'dead') {
    state.deathT += input.simDt > 0 ? input.simDt : input.dt * 0.25;
    const d = art.death;
    if (d && d.frames.length > 0) {
      out.kind = 'death';
      out.frame = Math.min(d.frames.length - 1, Math.floor(state.deathT * d.fps));
    } else {
      out.kind = 'idle';
      out.frame = 0;
    }
    const fadeK = (state.deathT - DEATH_HOLD) / DEATH_FADE;
    out.alphaBody = fadeK <= 0 ? 1 : Math.max(0, 1 - fadeK);
    out.flip = state.facing < 0;
    return;
  }

  const stepDx = input.x - input.prevX;
  const stepDz = input.z - input.prevZ;
  const stepDist = Math.hypot(stepDx, stepDz);
  let walking = false;
  let vx = 0;
  let vz = 0;

  if (input.heroState !== 'fighting' && stepDist > 1e-4 && stepDist <= HERO_TELEPORT_DIST) {
    walking = true;
    vx = stepDx;
    vz = stepDz;
  } else if (
    input.heroState === 'moving' &&
    stepDist <= 1e-4 &&
    input.nextWaypointX !== null &&
    input.nextWaypointZ !== null
  ) {
    const wdx = input.nextWaypointX - input.x;
    const wdz = input.nextWaypointZ - input.z;
    if (Math.hypot(wdx, wdz) > 1e-4) {
      walking = true;
      vx = wdx;
      vz = wdz;
    }
  }

  // Never skate across the ground in a lingering attack/cast frame while walking.
  if (walking && state.attackT >= 0) {
    state.attackT = -1;
    state.impactPending = false;
  }

  const atk = art.attack;
  if (!walking && atk && state.attackT < 0 && input.simDt > 0) {
    const lead = (atk.impact ?? 2) / atk.fps;
    if (input.attackTimer > 0 && input.attackTimer <= lead && input.expectsAttack) {
      state.attackRate = 1;
      state.attackT = Math.max(0, lead - input.attackTimer);
      state.impactPending = true;
      out.prerolled = true;
      if (input.targetX !== null) {
        state.facing = faceToward(input.targetX - input.x, state.facing);
      }
    }
  }

  if (state.attackT >= 0 && atk && atk.frames.length > 0) {
    state.attackT += input.simDt;
    const f = Math.floor(state.attackT * atk.fps * state.attackRate);
    if (f >= atk.frames.length) {
      state.attackT = -1;
      state.impactPending = false;
    } else {
      out.kind = 'attack';
      out.frame = f;
      out.flip = state.facing < 0;
      return;
    }
  }

  if (walking) {
    applyMotionFacing(state, vx, vz);
    const seq = art[state.walkSeq];
    const nominalStep = Math.max(1e-4, input.moveSpeed * FIXED_DT);
    const speedRatio =
      stepDist > 1e-4 ? Math.max(0.6, Math.min(1.6, stepDist / nominalStep)) : 1;
    state.animT += input.simDt * speedRatio;
    const n = Math.max(1, seq.frames.length);
    out.kind = state.walkSeq;
    out.frame = Math.floor(state.animT * seq.fps) % n;
    // Manifest metadata: `down` & `side` face right; `up` faces left (`facingUp: "left"`).
    out.flip = state.walkSeq === 'up' ? state.facing > 0 : state.facing < 0;
    return;
  }

  if (input.heroState !== 'moving' && state.attackT < 0) {
    const sx = Math.sin(input.yaw);
    if (Math.abs(sx) > 0.3) state.facing = sx > 0 ? 1 : -1;
  }
  const idleSeq = art.idle;
  const n = Math.max(1, idleSeq.frames.length);
  state.animT += input.dt;
  out.kind = 'idle';
  out.frame = Math.floor(state.animT * idleSeq.fps) % n;
  out.flip = state.facing < 0;
}
