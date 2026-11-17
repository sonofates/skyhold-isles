import { Graphics, Sprite, Texture, type Container } from 'pixi.js';
import type { Vec3 } from '../core/types.ts';
import { HEIGHT_TO_SCREEN } from './layers.ts';
import type { MapView } from './mapView.ts';

export type FxKind = 'puff' | 'ring' | 'coin' | 'spark' | 'glow' | 'flash';

interface Particle {
  readonly sprite: Sprite;
  kind: FxKind;
  t: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  active: boolean;
}

interface Bolt {
  readonly g: Graphics;
  t: number;
  life: number;
  active: boolean;
}

const MAX_PARTICLES = 320;
const MAX_BOLTS = 16;

/**
 * Pooled painted-looking FX in map px: smoke puffs, explosion rings (ground), coin pops, sparks,
 * crystal glows and lightning bolts. Nothing is allocated after construction; when the pool is
 * full new particles are dropped.
 */
export class FxLayer {
  private readonly particles: Particle[] = [];
  private readonly bolts: Bolt[] = [];
  private readonly textures: Record<FxKind, Texture>;
  private readonly ground: Container;
  private readonly top: Container;
  private readonly map: MapView;
  private seed = 1;
  /** Lifetime counters (QA): bolts drawn, particles spawned. */
  boltsDrawn = 0;
  particlesSpawned = 0;
  /** Bolt zigzag offsets, shared by the glow and core strokes so both trace the same line. */
  private readonly jitter = new Float32Array(256);

  constructor(map: MapView, ground: Container, top: Container, textures: Record<FxKind, Texture>) {
    this.map = map;
    this.ground = ground;
    this.top = top;
    this.textures = textures;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const sprite = new Sprite(Texture.EMPTY);
      sprite.anchor.set(0.5);
      sprite.visible = false;
      this.particles.push({ sprite, kind: 'puff', t: 0, life: 1, x: 0, y: 0, vx: 0, vy: 0, size: 1, active: false });
    }
    for (let i = 0; i < MAX_BOLTS; i++) {
      const g = new Graphics();
      g.visible = false;
      g.blendMode = 'add';
      top.addChild(g);
      this.bolts.push({ g, t: 0, life: 0.18, active: false });
    }
  }

  private rand(): number {
    // Render-only jitter (xorshift); never touches the sim RNG.
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0 || 1;
    return (this.seed % 10000) / 10000;
  }

  /** Spawns one particle at map px. */
  spawn(kind: FxKind, px: number, py: number, size: number, vx = 0, vy = 0, life = 0.5, tint = 0xffffff): Particle | null {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.active) continue;
      p.active = true;
      this.particlesSpawned++;
      p.kind = kind;
      p.t = 0;
      p.life = life;
      p.x = px;
      p.y = py;
      p.vx = vx;
      p.vy = vy;
      p.size = size;
      const s = p.sprite;
      s.texture = this.textures[kind];
      s.visible = true;
      s.alpha = 1;
      s.rotation = 0;
      s.tint = tint;
      s.blendMode = (kind === 'glow' || kind === 'spark' || kind === 'flash' ? 'add' : 'normal');
      const parent = kind === 'ring' ? this.ground : this.top;
      if (s.parent !== parent) parent.addChild(s);
      this.place(p);
      return p;
    }
    return null;
  }

  /** A burst of `n` puffs around a point (kill smoke, build dust, cannon blast). */
  puffs(px: number, py: number, n: number, spread: number, tint = 0xfff3d6): void {
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = this.rand() * spread;
      this.spawn(
        'puff',
        px + Math.cos(a) * r,
        py + Math.sin(a) * r * 0.5,
        10 + this.rand() * 10,
        Math.cos(a) * 30,
        -20 - this.rand() * 30,
        0.45 + this.rand() * 0.3,
        tint,
      );
    }
  }

  /** Lightning between sim points (copied at event time; drawn immediately into a pooled Graphics). */
  bolt(points: readonly Vec3[], overload: boolean, muzzle: number): void {
    const b = this.bolts.find((x) => !x.active);
    if (!b || points.length < 2) return;
    const ppu = this.map.layout.pxPerUnit;
    const g = b.g;
    g.clear();
    const segs = 6;
    const jn = Math.min(this.jitter.length, (points.length - 1) * segs);
    for (let k = 0; k < jn; k++) this.jitter[k] = (this.rand() - 0.5) * 18;
    const core = overload ? 0xfff6c8 : 0xeafcff;
    const glow = overload ? 0xffc94a : 0x6cc8ff;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const c = points[i + 1];
        const ah = i === 0 ? muzzle : a.y;
        const ax = this.map.pxX(a.x);
        const ay = this.map.pxY(a.z) - ah * HEIGHT_TO_SCREEN * ppu;
        const cx = this.map.pxX(c.x);
        const cy = this.map.pxY(c.z) - c.y * HEIGHT_TO_SCREEN * ppu;
        g.moveTo(ax, ay);
        for (let k = 1; k < segs; k++) {
          const t = k / segs;
          const j = this.jitter[Math.min(jn - 1, i * segs + k)] ?? 0;
          g.lineTo(ax + (cx - ax) * t + j, ay + (cy - ay) * t + j * 0.6);
        }
        g.lineTo(cx, cy);
      }
      g.stroke(pass === 0 ? { width: 9, color: glow, alpha: 0.45 } : { width: 3, color: core, alpha: 1 });
    }
    b.active = true;
    this.boltsDrawn++;
    b.t = 0;
    b.life = overload ? 0.26 : 0.18;
    g.visible = true;
    g.alpha = 1;
    // Glow at each struck point.
    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      this.spawn('glow', this.map.pxX(p.x), this.map.pxY(p.z) - p.y * HEIGHT_TO_SCREEN * ppu, 26, 0, 0, 0.25);
    }
  }

  private place(p: Particle): void {
    const k = p.t / p.life;
    const s = p.sprite;
    s.position.set(p.x, p.y);
    const texW = Math.max(1, s.texture.width);
    switch (p.kind) {
      case 'puff': {
        const size = p.size * (1 + k * 1.4);
        s.scale.set(size / texW * 2);
        s.alpha = (1 - k) * 0.9;
        break;
      }
      case 'ring': {
        const size = p.size * (0.35 + k * 1.1);
        s.scale.set((size * 2) / texW, (size * 0.9) / texW);
        s.alpha = 1 - k;
        break;
      }
      case 'coin': {
        const size = p.size * (k < 0.15 ? k / 0.15 : 1);
        s.scale.set(size / texW);
        s.alpha = 1 - k * k;
        break;
      }
      case 'spark':
      case 'glow':
      case 'flash': {
        const size = p.size * (1 + k * 0.6);
        s.scale.set(size / texW * 2);
        s.alpha = 1 - k;
        break;
      }
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.t += dt;
      if (p.t >= p.life) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'coin') p.vy *= 1 - dt * 2.5;
      this.place(p);
    }
    for (let i = 0; i < this.bolts.length; i++) {
      const b = this.bolts[i];
      if (!b.active) continue;
      b.t += dt;
      if (b.t >= b.life) {
        b.active = false;
        b.g.visible = false;
        continue;
      }
      b.g.alpha = 1 - b.t / b.life;
    }
  }
}
