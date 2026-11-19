import type { Container, Text } from 'pixi.js';
import { paintedText, setText } from '../hudText.ts';

const POOL = 18;
const LIFE = 0.9;
/** At most this many pops per second (a mass kill reads as a few, not a cloud of numbers). */
const MAX_PER_SEC = 14;

interface Pop {
  readonly text: Text;
  t: number;
  x: number;
  y: number;
  active: boolean;
}

/**
 * "+4" gold numbers rising from a fallen foe (map px, in the FX layer so they follow the map fit
 * and shake). Pooled Texts; a slot keeps its string when the bounty repeats, so most pops do not
 * re-rasterise. Rate-limited; off on the Low effects tier.
 */
export class GoldPops2D {
  private readonly pops: Pop[] = [];
  private budget = MAX_PER_SEC;
  private next = 0;
  enabled = true;
  spawned = 0;

  constructor(parent: Container) {
    for (let i = 0; i < POOL; i++) {
      const text = paintedText(19, 'center', '#ffd75a');
      text.visible = false;
      parent.addChild(text);
      this.pops.push({ text, t: 0, x: 0, y: 0, active: false });
    }
  }

  spawn(amount: number, px: number, py: number): void {
    if (!this.enabled || amount <= 0 || this.budget < 1) return;
    this.budget -= 1;
    const p = this.pops[this.next];
    this.next = (this.next + 1) % POOL;
    const s = `+${Math.round(amount)}`;
    if (p.text.text !== s) setText(p.text, s);
    p.t = 0;
    p.x = px;
    p.y = py;
    p.active = true;
    p.text.visible = true;
    this.spawned++;
  }

  update(dt: number): void {
    this.budget = Math.min(MAX_PER_SEC, this.budget + dt * MAX_PER_SEC);
    for (const p of this.pops) {
      if (!p.active) continue;
      p.t += dt;
      const k = p.t / LIFE;
      if (k >= 1) {
        p.active = false;
        p.text.visible = false;
        continue;
      }
      // Pop up fast, drift, fade in the last third.
      const rise = 46 * (1 - (1 - k) * (1 - k));
      p.text.position.set(p.x, p.y - rise);
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1.1 - Math.min(0.1, (k - 0.15) * 0.4);
      p.text.scale.set(pop);
      p.text.alpha = k < 0.66 ? 1 : (1 - k) / 0.34;
    }
  }

  /** QA: live pops. */
  get active(): number {
    let n = 0;
    for (const p of this.pops) if (p.active) n++;
    return n;
  }

  clear(): void {
    for (const p of this.pops) {
      p.active = false;
      p.text.visible = false;
    }
  }
}
