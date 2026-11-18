import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Vec3 } from '../core/types.ts';
import { HEIGHT_TO_SCREEN } from './layers.ts';
import type { MapView } from './mapView.ts';
import type { QualityTier } from './renderResolution.ts';
import { SlotPool } from './slotPool.ts';

export type FxKind = 'puff' | 'ring' | 'coin' | 'spark' | 'glow' | 'flash' | 'wring' | 'crater' | 'shard' | 'orb';

const GROUND_KINDS: ReadonlySet<FxKind> = new Set<FxKind>(['ring', 'wring', 'crater']);
const ADDITIVE_KINDS: ReadonlySet<FxKind> = new Set<FxKind>(['glow', 'spark', 'flash', 'orb']);

export interface Particle {
  readonly sprite: Sprite;
  kind: FxKind;
  t: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  /** Rotation (rad), spin (rad/s) and gravity (px/s², +down); reset on every spawn. */
  rot: number;
  vr: number;
  gy: number;
  active: boolean;
}

interface Bolt {
  readonly g: Graphics;
  t: number;
  life: number;
  active: boolean;
}

interface Zone {
  readonly scorch: Sprite;
  readonly flame: Sprite;
  x: number;
  y: number;
  r: number;
  t: number;
  life: number;
  ember: number;
  active: boolean;
}

const MAX_PARTICLES = 360;
const MAX_BOLTS = 16;
const MAX_BEAMS = 24;
const MAX_ZONES = 6;

/**
 * Pooled painted-looking FX in map px: smoke puffs, rings, coin pops, sparks, glows, shards,
 * ground craters, lightning bolts, light beams and burning-ground zones. Particle sprites grow
 * to the observed peak and are reused; when a pool is full the newest FX is dropped (counted in `stats()`).
 */
export class FxLayer {
  private readonly particles: Particle[] = [];
  private readonly pool = new SlotPool(MAX_PARTICLES);
  private readonly bolts: Bolt[] = [];
  private readonly beams: Bolt[] = [];
  private readonly beamPool = new SlotPool(MAX_BEAMS);
  private readonly zones: Zone[] = [];
  private readonly zonePool = new SlotPool(MAX_ZONES);
  private readonly textures: Record<FxKind, Texture>;
  private readonly ground: Container;
  private readonly top: Container;
  private readonly map: MapView;
  private seed = 1;
  private additive: Container | null = null;
  private particleLimit = MAX_PARTICLES;
  density = 1;

  setQuality(tier: QualityTier): void {
    this.particleLimit = tier === 'high' ? MAX_PARTICLES : tier === 'med' ? 144 : 64;
    this.density = tier === 'high' ? 1 : tier === 'med' ? 0.55 : 0.25;
    // Decorative light sprites can share one additive batch on reduced tiers.
    if (tier !== 'high' && !this.additive) {
      this.additive = new Container();
      this.top.addChild(this.additive);
    }
  }
  /** Lifetime counters (QA): bolts / beams / zones drawn. */
  boltsDrawn = 0;
  beamsDrawn = 0;
  zonesSpawned = 0;
  /** Bolt zigzag offsets, shared by the glow and core strokes so both trace the same line. */
  private readonly jitter = new Float32Array(256);

  get particlesSpawned(): number {
    return this.pool.spawned;
  }

  constructor(map: MapView, ground: Container, top: Container, textures: Record<FxKind, Texture>) {
    this.map = map;
    this.ground = ground;
    this.top = top;
    this.textures = textures;
    for (let i = 0; i < MAX_BOLTS; i++) {
      const g = new Graphics();
      g.visible = false;
      g.blendMode = 'add';
      top.addChild(g);
      this.bolts.push({ g, t: 0, life: 0.18, active: false });
    }
    for (let i = 0; i < MAX_BEAMS; i++) {
      const g = new Graphics();
      g.visible = false;
      g.blendMode = 'add';
      top.addChild(g);
      this.beams.push({ g, t: 0, life: 0.3, active: false });
    }
    for (let i = 0; i < MAX_ZONES; i++) {
      const scorch = new Sprite(textures.crater);
      const flame = new Sprite(textures.orb);
      scorch.anchor.set(0.5);
      flame.anchor.set(0.5);
      flame.blendMode = 'add';
      flame.tint = 0xff8a2a;
      scorch.visible = false;
      flame.visible = false;
      ground.addChild(scorch, flame);
      this.zones.push({ scorch, flame, x: 0, y: 0, r: 1, t: 0, life: 1, ember: 0, active: false });
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

  /** Render-only random in [0,1) for the callers that scatter FX. */
  random(): number {
    return this.rand();
  }

  /** Spawns one particle at map px (null when the pool is full: the newest particle is dropped). */
  spawn(kind: FxKind, px: number, py: number, size: number, vx = 0, vy = 0, life = 0.5, tint = 0xffffff): Particle | null {
    const i = this.pool.acquire(this.particleLimit);
    if (i < 0) return null;
    let p = this.particles[i];
    if (!p) {
      const sprite = new Sprite(Texture.EMPTY);
      sprite.anchor.set(0.5);
      p = this.particles[i] = { sprite, kind, t: 0, life, x: px, y: py, vx, vy, size, rot: 0, vr: 0, gy: 0, active: true };
    }
    p.active = true;
    p.kind = kind;
    p.t = 0;
    p.life = life;
    p.x = px;
    p.y = py;
    p.vx = vx;
    p.vy = vy;
    p.size = size;
    p.rot = 0;
    p.vr = 0;
    p.gy = 0;
    const s = p.sprite;
    s.texture = this.textures[kind];
    s.visible = true;
    s.alpha = 1;
    s.rotation = 0;
    s.tint = tint;
    s.blendMode = ADDITIVE_KINDS.has(kind) ? 'add' : 'normal';
    let parent = this.top;
    if (GROUND_KINDS.has(kind)) parent = this.ground;
    else if (this.additive && ADDITIVE_KINDS.has(kind)) parent = this.additive;
    if (s.parent !== parent) parent.addChild(s);
    this.place(p);
    return p;
  }

  /** A burst of `n` puffs around a point (kill smoke, build dust, cannon blast). */
  puffs(px: number, py: number, n: number, spread: number, tint = 0xfff3d6): void {
    n = Math.ceil(n * this.density);
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

  /** A radial burst of `n` particles of `kind` (shards fly out, spin and fall under `gravity`). */
  burst(kind: FxKind, px: number, py: number, n: number, size: number, speed: number, life: number, tint = 0xffffff, gravity = 0): void {
    n = Math.ceil(n * this.density);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand() * 0.8;
      const sp = speed * (0.55 + this.rand() * 0.6);
      const p = this.spawn(
        kind,
        px,
        py,
        size * (0.7 + this.rand() * 0.6),
        Math.cos(a) * sp,
        Math.sin(a) * sp * 0.8 - speed * 0.25,
        life * (0.75 + this.rand() * 0.5),
        tint,
      );
      if (p) {
        p.gy = gravity;
        p.vr = (this.rand() - 0.5) * 12;
        if (kind === 'shard') p.rot = Math.atan2(p.vy, p.vx) + Math.PI / 2;
      }
    }
  }

  /** A straight fading light beam in map px (blink trail, hex tether, buff link, pierce streak). */
  beam(x1: number, y1: number, x2: number, y2: number, color: number, width: number, life: number, dotted = false): void {
    const i = this.beamPool.acquire();
    if (i < 0) return;
    const b = this.beams[i];
    const g = b.g;
    g.clear();
    if (dotted) {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const n = Math.max(2, Math.floor(len / (width * 3.2)));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const r = width * (0.55 + 0.45 * Math.sin(k * 1.7) ** 2);
        g.circle(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, r).fill({ color, alpha: 0.9 });
      }
    } else {
      g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: width * 2.4, color, alpha: 0.32 });
      g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width, color: 0xffffff, alpha: 0.9 });
    }
    b.t = 0;
    b.life = life;
    b.active = true;
    g.visible = true;
    g.alpha = 1;
    this.beamsDrawn++;
  }

  /** Burning ground (incendiary shells): a scorch decal with licking flames and embers. */
  zone(px: number, py: number, radiusPx: number, life: number): void {
    const i = this.zonePool.acquire();
    if (i < 0) return;
    const z = this.zones[i];
    z.x = px;
    z.y = py;
    z.r = radiusPx;
    z.t = 0;
    z.life = life;
    z.ember = 0;
    z.active = true;
    z.scorch.position.set(px, py);
    z.flame.position.set(px, py);
    const tw = Math.max(1, z.scorch.texture.width);
    z.scorch.scale.set((radiusPx * 2.1) / tw, (radiusPx * 1.2) / tw);
    z.scorch.visible = true;
    z.flame.visible = true;
    this.zonesSpawned++;
  }

  /** Pool counters for QA overlays / tests. */
  stats(): { particles: ReturnType<SlotPool['snapshot']>; beams: ReturnType<SlotPool['snapshot']>; zones: ReturnType<SlotPool['snapshot']> } {
    return { particles: this.pool.snapshot(), beams: this.beamPool.snapshot(), zones: this.zonePool.snapshot() };
  }

  /** Clears everything (new run). */
  clear(): void {
    for (const p of this.particles) {
      p.active = false;
      p.sprite.visible = false;
    }
    for (const b of this.bolts) {
      b.active = false;
      b.g.visible = false;
    }
    for (const b of this.beams) {
      b.active = false;
      b.g.visible = false;
    }
    for (const z of this.zones) {
      z.active = false;
      z.scorch.visible = false;
      z.flame.visible = false;
    }
    this.pool.releaseAll();
    this.beamPool.releaseAll();
    this.zonePool.releaseAll();
  }

  /** Lightning between sim points (copied at event time; drawn immediately into a pooled Graphics). */
  bolt(points: readonly Vec3[], overload: boolean, muzzle: number): void {
    const b = this.bolts.find((x) => !x.active);
    if (!b || points.length < 2) return;
    const ppu = this.map.layout.pxPerUnit;
    const g = b.g;
    g.clear();
    const segs = Math.max(2, Math.ceil(6 * this.density));
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
        s.scale.set((size / texW) * 2);
        s.alpha = (1 - k) * 0.9;
        break;
      }
      case 'ring':
      case 'wring': {
        const size = p.size * (0.35 + k * 1.1);
        s.scale.set((size * 2) / texW, (size * 0.9) / texW);
        s.alpha = 1 - k;
        break;
      }
      case 'crater': {
        const size = p.size * (1 + k * 0.12);
        s.scale.set((size * 2) / texW, (size * 1.1) / texW);
        s.alpha = k < 0.55 ? 1 : Math.max(0, (1 - k) / 0.45);
        break;
      }
      case 'shard': {
        s.scale.set(p.size / Math.max(1, s.texture.height));
        s.rotation = p.rot;
        s.alpha = k < 0.55 ? 1 : Math.max(0, (1 - k) / 0.45);
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
      case 'orb':
      case 'flash': {
        const size = p.size * (1 + k * 0.6);
        s.scale.set((size / texW) * 2);
        s.alpha = 1 - k;
        break;
      }
    }
  }

  update(dt: number): void {
    // High retains the original release order (and hence the layering of reused sprites).
    // On reduced tiers walk the dense list backwards so swap-removal never skips a particle.
    const high = this.density === 1;
    const count = high ? this.particles.length : this.pool.active;
    for (let pos = 0; pos < count; pos++) {
      const i = high ? pos : this.pool.activeSlots[count - 1 - pos];
      const p = this.particles[i];
      if (!p.active) continue;
      p.t += dt;
      if (p.t >= p.life) {
        p.active = false;
        p.sprite.visible = false;
        this.pool.release(i);
        continue;
      }
      p.vy += p.gy * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
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
    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i];
      if (!b.active) continue;
      b.t += dt;
      if (b.t >= b.life) {
        b.active = false;
        b.g.visible = false;
        this.beamPool.release(i);
        continue;
      }
      const k = b.t / b.life;
      b.g.alpha = 1 - k * k;
    }
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i];
      if (!z.active) continue;
      z.t += dt;
      if (z.t >= z.life) {
        z.active = false;
        z.scorch.visible = false;
        z.flame.visible = false;
        this.zonePool.release(i);
        continue;
      }
      const k = z.t / z.life;
      const fade = k < 0.1 ? k / 0.1 : k > 0.8 ? Math.max(0, (1 - k) / 0.2) : 1;
      const flick = 0.72 + 0.28 * Math.sin(z.t * 17 + i * 2.1) * Math.sin(z.t * 9.3 + i);
      z.scorch.alpha = 0.85 * fade;
      z.flame.alpha = 0.55 * fade * flick;
      const fw = (z.r * 1.8 * (0.92 + 0.08 * flick)) / Math.max(1, z.flame.texture.width);
      z.flame.scale.set(fw, fw * 0.55);
      z.ember -= dt;
      if (z.ember <= 0 && fade > 0.3) {
        z.ember = 0.09 + this.rand() * 0.08;
        const a = this.rand() * Math.PI * 2;
        const r = Math.sqrt(this.rand()) * z.r * 0.8;
        this.spawn('spark', z.x + Math.cos(a) * r, z.y + Math.sin(a) * r * 0.5, 7 + this.rand() * 5, (this.rand() - 0.5) * 8, -26 - this.rand() * 20, 0.5 + this.rand() * 0.3, 0xff9a40);
      }
    }
  }
}
