/**
 * Gentle map panning (pure, no Pixi / DOM): the map is fitted a little past "cover"
 * (fullBleed.ts PAN_ZOOM), so the player can slide it a bit in every direction — mouse / trackpad
 * drag on the ground, two-finger scroll, Shift + arrow keys, one-finger drag on touch.
 *
 * The state is the map's screen offset (screen px of image px (0, 0)), always inside the pan range
 * (never past the painting, bar the small reach past its top / bottom edge, fullBleed.ts
 * reachRange). A released drag glides on a little and stops (light inertia); keys glide to their
 * step. Reduced motion: no glide, no inertia — the view moves exactly as far as the hand did.
 */
import { clampPan, type PanRange } from './fullBleed.ts';

/** Movement (css px) before a press becomes a drag instead of a tap. */
export const PAN_SLOP = 10;
/** Inertia: velocity decay rate (1/s), launch share of the release speed, and its cap (px/s). */
export const PAN_FRICTION = 7;
export const PAN_LAUNCH = 0.55;
export const PAN_MAX_SPEED = 1400;
/** Below this speed (px/s) the glide stops. */
const PAN_STOP = 12;
/** Keyboard step (css px) and its glide rate (1/s). */
export const PAN_KEY_STEP = 90;
const PAN_KEY_RATE = 12;
/** Release velocity is measured over the drag's last this-many ms. */
const VEL_WINDOW_MS = 90;

export class MapPan {
  range: PanRange = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  x = 0;
  y = 0;
  private vx = 0;
  private vy = 0;
  private target: { x: number; y: number } | null = null;
  private samples: { t: number; x: number; y: number }[] = [];
  /** A drag is holding the map. */
  dragging = false;

  /** A new range (resize / new island) and the view to start at (the default view). */
  reset(range: PanRange, x: number, y: number): void {
    this.range = range;
    const c = clampPan(range, x, y);
    this.x = c.x;
    this.y = c.y;
    this.stop();
  }

  /** Stops every glide (and a drag). */
  stop(): void {
    this.vx = 0;
    this.vy = 0;
    this.target = null;
    this.dragging = false;
    this.samples.length = 0;
  }

  /** True while the view moves on its own (inertia or a key glide). */
  get gliding(): boolean {
    return this.target !== null || this.vx !== 0 || this.vy !== 0;
  }

  /** Moves the view by (dx, dy) css px (clamped); returns whether it moved. */
  private moveBy(dx: number, dy: number): boolean {
    const c = clampPan(this.range, this.x + dx, this.y + dy);
    const moved = Math.abs(c.x - this.x) > 1e-3 || Math.abs(c.y - this.y) > 1e-3;
    this.x = c.x;
    this.y = c.y;
    return moved;
  }

  /** A drag starts (the press already moved past PAN_SLOP). */
  beginDrag(tMs: number): void {
    this.stop();
    this.dragging = true;
    this.samples.push({ t: tMs, x: this.x, y: this.y });
  }

  /** The finger / mouse moved (dx, dy) while dragging: the map follows it. */
  dragBy(dx: number, dy: number, tMs: number): boolean {
    const moved = this.moveBy(dx, dy);
    this.samples.push({ t: tMs, x: this.x, y: this.y });
    while (this.samples.length > 2 && tMs - this.samples[0].t > VEL_WINDOW_MS) this.samples.shift();
    return moved;
  }

  /** The drag ends: a light glide on in its direction (none with reduced motion). */
  release(tMs: number, reduced: boolean): void {
    this.dragging = false;
    const s = this.samples;
    this.samples = [];
    if (reduced || s.length < 2) return;
    const a = s[0];
    const b = s[s.length - 1];
    const dt = Math.max(16, tMs - a.t) / 1000;
    // A drag that paused before the release has no speed left.
    if (tMs - b.t > 60) return;
    let vx = ((b.x - a.x) / dt) * PAN_LAUNCH;
    let vy = ((b.y - a.y) / dt) * PAN_LAUNCH;
    const v = Math.hypot(vx, vy);
    if (v > PAN_MAX_SPEED) {
      vx *= PAN_MAX_SPEED / v;
      vy *= PAN_MAX_SPEED / v;
    }
    if (Math.hypot(vx, vy) < PAN_STOP * 4) return;
    this.vx = vx;
    this.vy = vy;
  }

  /** Two-finger scroll / wheel: the view follows directly (the trackpad has its own momentum). */
  scrollBy(dx: number, dy: number): boolean {
    this.vx = 0;
    this.vy = 0;
    this.target = null;
    return this.moveBy(dx, dy);
  }

  /** Arrow key: glide a step that way (reduced motion: jump the step). */
  nudge(dirX: number, dirY: number, reduced: boolean): boolean {
    this.vx = 0;
    this.vy = 0;
    const from = this.target ?? { x: this.x, y: this.y };
    const t = clampPan(this.range, from.x + dirX * PAN_KEY_STEP, from.y + dirY * PAN_KEY_STEP);
    if (reduced) {
      this.target = null;
      return this.moveBy(t.x - this.x, t.y - this.y);
    }
    this.target = t;
    return false;
  }

  /** Advances the glides by dt seconds; returns whether the view moved. */
  step(dt: number): boolean {
    if (this.dragging || dt <= 0) return false;
    let moved = false;
    if (this.target) {
      const k = 1 - Math.exp(-PAN_KEY_RATE * dt);
      const dx = (this.target.x - this.x) * k;
      const dy = (this.target.y - this.y) * k;
      if (Math.hypot(this.target.x - this.x, this.target.y - this.y) < 0.5) {
        moved = this.moveBy(this.target.x - this.x, this.target.y - this.y);
        this.target = null;
      } else moved = this.moveBy(dx, dy);
    }
    if (this.vx !== 0 || this.vy !== 0) {
      const ox = this.x;
      const oy = this.y;
      moved = this.moveBy(this.vx * dt, this.vy * dt) || moved;
      // Against the range's edge the glide stops on that axis.
      if (Math.abs(this.x - ox) < 1e-3) this.vx = 0;
      if (Math.abs(this.y - oy) < 1e-3) this.vy = 0;
      const f = Math.exp(-PAN_FRICTION * dt);
      this.vx *= f;
      this.vy *= f;
      if (Math.hypot(this.vx, this.vy) < PAN_STOP) {
        this.vx = 0;
        this.vy = 0;
      }
    }
    return moved;
  }
}
