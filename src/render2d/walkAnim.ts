import type { CheapWalkSpec } from './manifest.ts';

/**
 * Enemy walk animation math (pure, allocation-free; one AnimState per pooled enemy view).
 *
 * cheap  — one painted sprite + procedural walk: a hop per step (bob), squash/stretch timed to
 *          the hop, lean into the direction of travel, a small per-step rock, facing flip, and
 *          optional leg-swap frames cycled with the stride (feet stay planted at any speed).
 * sheet  — frame sequences from a walk cycle: "down" (toward the camera) and "up" (away), each
 *          mirrored for the other horizontal side; frames advance with distance travelled.
 */
export interface AnimState {
  /** Stride phase in radians (2π = one stride = two steps). */
  phase: number;
  /** +1 = facing screen-right, -1 = screen-left. */
  facing: number;
  /** Smoothed lean, radians. */
  lean: number;
  /** Sheet: 0 = down (toward camera), 1 = up (away). */
  seq: number;
  /** Sheet: fractional frame cursor. */
  frameCursor: number;
}

export interface WalkPose {
  /** Lift above the ground, world units. */
  lift: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  /** True when the sprite must be mirrored (relative to the art's own facing). */
  flip: boolean;
  /** Frame index into the cheap frames list or the active sheet sequence. */
  frame: number;
  /** Sheet sequence (0 = down, 1 = up). */
  seq: number;
}

export function createAnimState(seed: number): AnimState {
  return { phase: seed % (Math.PI * 2), facing: 1, lean: 0, seq: 0, frameCursor: 0 };
}

export function createPose(): WalkPose {
  return { lift: 0, scaleX: 1, scaleY: 1, rotation: 0, flip: false, frame: 0, seq: 0 };
}

const TWO_PI = Math.PI * 2;
/** Screen px of horizontal motion needed before the facing flips (stops jitter on vertical roads). */
const FACE_EPS = 0.02;

function updateFacing(state: AnimState, dxScreen: number, dyScreen: number): void {
  if (Math.abs(dxScreen) > FACE_EPS && Math.abs(dxScreen) > Math.abs(dyScreen) * 0.15) {
    state.facing = dxScreen > 0 ? 1 : -1;
  }
}

/**
 * Cheap mode. `moved` = world units travelled this frame, `speedRatio` = current speed / nominal
 * speed (0 when stopped), (dxScreen, dyScreen) = screen-space motion this frame.
 */
export function cheapWalk(
  state: AnimState,
  spec: CheapWalkSpec,
  moved: number,
  speedRatio: number,
  dxScreen: number,
  dyScreen: number,
  dt: number,
  frameCount: number,
  artFacesRight: boolean,
  out: WalkPose,
): void {
  updateFacing(state, dxScreen, dyScreen);
  state.phase = (state.phase + (moved / Math.max(0.05, spec.stride)) * TWO_PI) % TWO_PI;

  const walking = speedRatio > 0.05 ? Math.min(1, speedRatio) : 0;
  const k = Math.abs(Math.sin(state.phase)); // 0 at foot contact, 1 mid-step (twice per stride)
  out.lift = spec.bob * k * walking;
  const s = spec.squash * walking;
  out.scaleY = 1 - s + 2 * s * k;
  out.scaleX = 1 + s * 0.6 * (1 - 2 * k);

  // Lean into horizontal travel; less when walking straight up/down the screen.
  const len = Math.hypot(dxScreen, dyScreen);
  const horiz = len > 1e-6 ? Math.abs(dxScreen) / len : 0;
  const target = spec.lean * Math.min(1.5, speedRatio) * (0.35 + 0.65 * horiz) * state.facing;
  const a = 1 - Math.exp(-dt * 10);
  state.lean += (target - state.lean) * a;
  out.rotation = state.lean + spec.rock * Math.sin(state.phase) * walking;

  out.flip = (state.facing > 0) !== artFacesRight;
  out.frame = frameCount > 1 ? Math.floor((state.phase / TWO_PI) * frameCount) % frameCount : 0;
  out.seq = 0;
}

/**
 * Picks the sheet sequence from screen motion: clearly downward → "down", clearly upward →
 * "up"; mostly horizontal motion keeps the previous sequence (the cycles are three-quarter views).
 */
export function sheetSequence(prevSeq: number, dxScreen: number, dyScreen: number): number {
  if (Math.abs(dyScreen) > Math.abs(dxScreen) * 0.35 && Math.abs(dyScreen) > FACE_EPS) {
    return dyScreen > 0 ? 0 : 1;
  }
  return prevSeq;
}

/**
 * Sheet mode. With `stride` (world units per loop) frames advance with distance travelled;
 * otherwise at the sheet fps scaled by the speed ratio.
 */
export function sheetWalk(
  state: AnimState,
  frameCount: number,
  fps: number,
  stride: number | undefined,
  moved: number,
  speedRatio: number,
  dxScreen: number,
  dyScreen: number,
  dt: number,
  artFacesRight: boolean,
  out: WalkPose,
): void {
  updateFacing(state, dxScreen, dyScreen);
  state.seq = sheetSequence(state.seq, dxScreen, dyScreen);
  const n = Math.max(1, frameCount);
  const advance = stride && stride > 0 ? (moved / stride) * n : fps * dt * Math.min(2, speedRatio);
  state.frameCursor = (state.frameCursor + advance) % n;
  out.frame = Math.floor(state.frameCursor) % n;
  out.seq = state.seq;
  out.flip = (state.facing > 0) !== artFacesRight;
  out.lift = 0;
  out.scaleX = 1;
  out.scaleY = 1;
  out.rotation = 0;
}
