import { Sprite, Texture, type Container } from 'pixi.js';
import type { ObjectPool } from '../core/pool.ts';
import type { ProjectileEntity } from '../sim/entities.ts';
import type { FxLayer } from './fxLayer.ts';
import { HEIGHT_TO_SCREEN } from './layers.ts';
import type { MapView } from './mapView.ts';
import type { ProcTextures } from './procTextures.ts';

interface ProjView {
  readonly sprite: Sprite;
  readonly shadow: Sprite;
  seen: number;
  /** Screen px travelled since the last trail particle. */
  trail: number;
  lastX: number;
  lastY: number;
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
 * painted tower top.
 */
export class ProjectileLayer {
  private readonly views: (ProjView | undefined)[] = [];
  private frameNo = 0;
  private readonly map: MapView;
  private readonly parent: Container;
  private readonly shadows: Container;
  private readonly tex: ProcTextures;
  private readonly muzzle: (type: ProjectileEntity['towerType']) => number;
  private readonly fx: FxLayer | null;
  /** Lifetime counter (QA): trail particles requested. */
  trailsRequested = 0;

  constructor(
    map: MapView,
    parent: Container,
    shadows: Container,
    tex: ProcTextures,
    muzzle: (type: ProjectileEntity['towerType']) => number,
    fx: FxLayer | null = null,
  ) {
    this.map = map;
    this.parent = parent;
    this.shadows = shadows;
    this.tex = tex;
    this.muzzle = muzzle;
    this.fx = fx;
  }

  private viewFor(i: number): ProjView {
    let v = this.views[i];
    if (!v) {
      const sprite = new Sprite(Texture.EMPTY);
      sprite.anchor.set(0.5);
      const shadow = new Sprite(this.tex.shadow);
      shadow.anchor.set(0.5);
      this.parent.addChild(sprite);
      this.shadows.addChild(shadow);
      v = { sprite, shadow, seen: -1, trail: 0, lastX: 0, lastY: 0 };
      this.views[i] = v;
    }
    return v;
  }

  private screenY(p: ProjectileEntity, z: number, y: number): number {
    const t = Math.min(1, p.progress);
    const h = y + (this.muzzle(p.towerType) - p.startY) * (1 - t);
    return this.map.pxY(z) - Math.max(0, h) * HEIGHT_TO_SCREEN * this.map.layout.pxPerUnit;
  }

  sync(pool: ObjectPool<ProjectileEntity>, alpha: number): void {
    this.frameNo++;
    const n = pool.getActiveCount();
    for (let i = 0; i < n; i++) {
      const idx = pool.getActiveIndex(i);
      const p = pool.items[idx];
      const v = this.viewFor(idx);
      const fresh = v.seen !== this.frameNo - 1;
      v.seen = this.frameNo;
      const x = p.prevX + (p.x - p.prevX) * alpha;
      const y = p.prevY + (p.y - p.prevY) * alpha;
      const z = p.prevZ + (p.z - p.prevZ) * alpha;
      const sx = this.map.pxX(x);
      const sy = this.screenY(p, z, y);
      const s = v.sprite;
      s.visible = true;
      s.position.set(sx, sy);
      if (fresh) {
        v.trail = 0;
        v.lastX = sx;
        v.lastY = sy;
      }
      const type = p.towerType as string;
      const ball = type === 'cannon' || type === 'mortar';
      if (type === 'archer' || type === 'ballista') {
        const heavy = type === 'ballista';
        const bolt = heavy ? this.tex.bolt : this.tex.arrow;
        if (s.texture !== bolt) s.texture = bolt;
        const psx = this.map.pxX(p.prevX);
        const psy = this.screenY(p, p.prevZ, p.prevY);
        const dx = sx - psx;
        const dy = sy - psy;
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
      v.shadow.visible = ball;
      if (ball) {
        v.shadow.position.set(sx, this.map.pxY(z));
        const big = type === 'mortar';
        v.shadow.scale.set(big ? 0.22 : 0.16, big ? 0.11 : 0.08);
        v.shadow.alpha = 0.6;
      }
      const trail = TRAILS[type];
      if (trail && this.fx) {
        v.trail += Math.hypot(sx - v.lastX, sy - v.lastY);
        let guard = 0;
        while (v.trail >= trail.step && guard++ < 3) {
          v.trail -= trail.step;
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
        v.shadow.visible = false;
      }
    }
  }
}
