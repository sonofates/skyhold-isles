import { Sprite, Texture, type Container } from 'pixi.js';
import type { ObjectPool } from '../core/pool.ts';
import type { ProjectileEntity } from '../sim/entities.ts';
import type { FxLayer } from './fxLayer.ts';
import { HEIGHT_TO_SCREEN } from './layers.ts';
import type { MapView } from './mapView.ts';
import type { ProcTextures } from './procTextures.ts';
import { projectileReveal } from './towerAnim.ts';
import { cannonArcPx } from './turret.ts';

interface ProjView {
  readonly sprite: Sprite;
  shadow: Sprite | null;
  seen: number;
  /** Screen px travelled since the last trail particle. */
  trail: number;
  lastX: number;
  lastY: number;
  /** Launch offset (map px): drawn launch point minus the sim's start point, latched at the first frame. */
  offX: number;
  offY: number;
  /** Identity of the projectile the offset belongs to (pool slots are reused). */
  startX: number;
  startZ: number;
  lastProgress: number;
}

interface TrailSpec {
  /** Screen px between trail particles. */
  readonly step: number;
  readonly kind: 'puff' | 'spark';
  readonly size: number;
  readonly life: number;
  readonly tint: number;
}

const TRAILS: Readonly<Record<string, TrailSpec>> = {
  cannon: { step: 17, kind: 'puff', size: 6, life: 0.3, tint: 0xb8b0a0 },
  mortar: { step: 14, kind: 'puff', size: 8, life: 0.46, tint: 0xc8c0b0 },
  frost: { step: 11, kind: 'spark', size: 7, life: 0.3, tint: 0xbfeaff },
  ballista: { step: 18, kind: 'spark', size: 6, life: 0.16, tint: 0xffe9b0 },
};

const ICE = 0xcfefff;
const SHELL = 0x9a8f80;

/**
 * Projectiles from the sim pool, per tower type: arrows (rotated along their screen velocity),
 * heavy ballista bolts with a spark trail, cannonballs and mortar shells on their arcs (ground
 * shadow, smoke trail), frost shards (rotated, sparkle trail) and glowing crystal bolts. The
 * launch height blends from the 2D tower art's muzzle to the sim's own height so shots leave the
 * painted tower top. With a painted attack sheet the view stays hidden until the sheet's release
 * frame and then catches up with the sim projectile (towerAnim.ts; render-only, the sim is untouched).
 */
export class ProjectileLayer {
  private readonly views: (ProjView | undefined)[] = [];
  private frameNo = 0;
  private readonly map: MapView;
  private readonly parent: Container;
  private readonly shadows: Container;
  private readonly tex: ProcTextures;
  private readonly muzzle: (p: ProjectileEntity) => number;
  private readonly release: (p: ProjectileEntity) => number;
  private readonly launch: (p: ProjectileEntity) => { x: number; y: number } | null;
  private readonly fx: FxLayer | null;
  /** Lifetime counter (QA): trail particles requested. */
  trailsRequested = 0;

  constructor(
    map: MapView,
    parent: Container,
    shadows: Container,
    tex: ProcTextures,
    muzzle: (p: ProjectileEntity) => number,
    fx: FxLayer | null = null,
    release: (p: ProjectileEntity) => number = () => 0,
    launch: (p: ProjectileEntity) => { x: number; y: number } | null = () => null,
  ) {
    this.launch = launch;
    this.map = map;
    this.parent = parent;
    this.shadows = shadows;
    this.tex = tex;
    this.muzzle = muzzle;
    this.release = release;
    this.fx = fx;
  }

  private viewFor(i: number): ProjView {
    let v = this.views[i];
    if (!v) {
      const sprite = new Sprite(Texture.EMPTY);
      sprite.anchor.set(0.5);
      sprite.visible = false;
      this.parent.addChild(sprite);
      v = { sprite, shadow: null, seen: -1, trail: 0, lastX: 0, lastY: 0, offX: 0, offY: 0, startX: NaN, startZ: NaN, lastProgress: 0 };
      this.views[i] = v;
    }
    return v;
  }

  /** Pre-allocates projectile + shadow sprites during load so volleys allocate nothing in play. */
  prewarm(count = 64): void {
    for (let i = 0; i < count; i++) {
      const v = this.viewFor(i);
      if (!v.shadow) {
        v.shadow = new Sprite(this.tex.shadow);
        v.shadow.anchor.set(0.5);
        v.shadow.visible = false;
        this.shadows.addChild(v.shadow);
      }
    }
  }

  /**
   * Launch offset of a new projectile: the tower's drawn muzzle point (aimable turret: the barrel /
   * bolt / arrow tip it faces with; others: the measured crystal tip / barrel mouth) minus the sim's
   * start point, or, without a point, the muzzle height above the sim start. Render-only.
   */
  private launchOffset(p: ProjectileEntity): { x: number; y: number } {
    const k = HEIGHT_TO_SCREEN * this.map.layout.pxPerUnit;
    const sx = this.map.pxX(p.startX);
    const sy = this.map.pxY(p.startZ) - p.startY * k;
    const pt = this.launch(p);
    if (pt) return { x: pt.x - sx, y: pt.y - sy };
    return { x: 0, y: -(this.muzzle(p) - p.startY) * k };
  }

  sync(pool: ObjectPool<ProjectileEntity>, alpha: number): void {
    this.frameNo++;
    const n = pool.getActiveCount();
    for (let i = 0; i < n; i++) {
      const idx = pool.getActiveIndex(i);
      const p = pool.items[idx];
      const v = this.viewFor(idx);
      // A slot reused for a new projectile (same frame or not) counts as fresh too.
      const fresh = v.seen !== this.frameNo - 1 || p.progress < v.lastProgress || p.startX !== v.startX || p.startZ !== v.startZ;
      v.seen = this.frameNo;
      v.lastProgress = p.progress;
      if (fresh) {
        const o = this.launchOffset(p);
        v.offX = o.x;
        v.offY = o.y;
        v.startX = p.startX;
        v.startZ = p.startZ;
      }
      const x = p.prevX + (p.x - p.prevX) * alpha;
      const y = p.prevY + (p.y - p.prevY) * alpha;
      const z = p.prevZ + (p.z - p.prevZ) * alpha;
      const type = p.towerType as string;
      const k = HEIGHT_TO_SCREEN * this.map.layout.pxPerUnit;
      const t = Math.min(1, p.progress);
      const launchWeight = 1 - Math.max(0, t);
      let sx = this.map.pxX(x) + v.offX * launchWeight;
      // Cannonballs fly a short render-only arc (the sim shot is straight).
      let sy = this.map.pxY(z) - Math.max(0, y) * k + v.offY * launchWeight - (type === 'cannon' && !p.parabolic ? cannonArcPx(p.duration, t) : 0);
      const s = v.sprite;
      const reveal = projectileReveal(p.progress * p.duration, this.release(p));
      if (reveal < 0) {
        // Still in the tower's wind-up: not drawn yet.
        s.visible = false;
        if (v.shadow) v.shadow.visible = false;
        v.lastX = sx;
        v.lastY = sy;
        v.trail = 0;
        continue;
      }
      const lx = this.map.pxX(p.startX) + v.offX;
      const ly = this.map.pxY(p.startZ) - p.startY * k + v.offY;
      if (reveal < 1) {
        const mx = lx;
        const my = ly;
        sx = mx + (sx - mx) * reveal;
        sy = my + (sy - my) * reveal;
      }
      s.visible = true;
      s.position.set(sx, sy);
      if (fresh) {
        v.trail = 0;
        v.lastX = sx;
        v.lastY = sy;
      }
      const ball = type === 'cannon' || type === 'mortar';
      if (type === 'archer' || type === 'ballista') {
        const heavy = type === 'ballista';
        const bolt = heavy ? this.tex.bolt : this.tex.arrow;
        if (s.texture !== bolt) s.texture = bolt;
        // Along the drawn flight: frame-to-frame motion, or (first frame) from the launch point.
        let dx = sx - v.lastX;
        let dy = sy - v.lastY;
        if (dx * dx + dy * dy < 0.25) {
          dx = sx - lx;
          dy = sy - ly;
        }
        if (dx * dx + dy * dy < 0.25) {
          dx = this.map.pxX(p.x) - this.map.pxX(p.prevX);
          dy = this.map.pxY(p.z) - this.map.pxY(p.prevZ) - (p.y - p.prevY) * k;
        }
        if (dx * dx + dy * dy > 1e-4) s.rotation = Math.atan2(dy, dx);
        s.scale.set(heavy ? 0.78 : 0.7);
        s.tint = 0xffffff;
      } else if (ball) {
        if (s.texture !== this.tex.ball) s.texture = this.tex.ball;
        s.rotation = 0;
        const mortar = type === 'mortar';
        s.scale.set(mortar ? 0.95 : 0.6);
        s.tint = mortar ? SHELL : 0xffffff;
      } else if (type === 'frost') {
        if (s.texture !== this.tex.shard) s.texture = this.tex.shard;
        const dx = sx - v.lastX;
        const dy = sy - v.lastY;
        if (dx * dx + dy * dy > 1e-4) s.rotation = Math.atan2(dy, dx) + Math.PI / 2;
        s.scale.set(26 / 56);
        s.tint = ICE;
      } else {
        if (s.texture !== this.tex.glow) s.texture = this.tex.glow;
        s.rotation = 0;
        s.scale.set(0.45);
        s.tint = 0xffffff;
      }
      if (v.shadow) v.shadow.visible = ball;
      if (ball) {
        if (!v.shadow) {
          v.shadow = new Sprite(this.tex.shadow);
          v.shadow.anchor.set(0.5);
          this.shadows.addChild(v.shadow);
        }
        v.shadow.position.set(sx, this.map.pxY(z));
        const big = type === 'mortar';
        v.shadow.scale.set(big ? 0.22 : 0.16, big ? 0.11 : 0.08);
        v.shadow.alpha = 0.6;
      }
      const trail = TRAILS[type];
      if (trail && this.fx) {
        v.trail += Math.hypot(sx - v.lastX, sy - v.lastY);
        const step = trail.step / this.fx.density;
        let guard = 0;
        while (v.trail >= step && guard++ < 3) {
          v.trail -= step;
          this.trailsRequested++;
          this.fx.spawn(trail.kind, sx, sy, trail.size, 0, trail.kind === 'puff' ? -9 : 0, trail.life, trail.tint);
        }
      }
      v.lastX = sx;
      v.lastY = sy;
    }
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      if (v && v.seen !== this.frameNo && v.sprite.visible) {
        v.sprite.visible = false;
        if (v.shadow) v.shadow.visible = false;
      }
    }
  }
}
