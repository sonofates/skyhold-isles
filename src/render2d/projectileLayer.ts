import { Sprite, Texture, type Container } from 'pixi.js';
import type { ObjectPool } from '../core/pool.ts';
import type { ProjectileEntity } from '../sim/entities.ts';
import { HEIGHT_TO_SCREEN } from './layers.ts';
import type { MapView } from './mapView.ts';
import type { ProcTextures } from './procTextures.ts';

interface ProjView {
  readonly sprite: Sprite;
  readonly shadow: Sprite;
  seen: number;
}

/**
 * Projectiles from the sim pool: arrows (rotated along their screen velocity), cannonballs on
 * their arc with a ground shadow, glowing bolts for anything else. The launch height blends from
 * the 2D tower art's muzzle to the sim's own height so shots leave the painted tower top.
 */
export class ProjectileLayer {
  private readonly views: (ProjView | undefined)[] = [];
  private frameNo = 0;
  private readonly map: MapView;
  private readonly parent: Container;
  private readonly shadows: Container;
  private readonly tex: ProcTextures;
  private readonly muzzle: (type: ProjectileEntity['towerType']) => number;

  constructor(
    map: MapView,
    parent: Container,
    shadows: Container,
    tex: ProcTextures,
    muzzle: (type: ProjectileEntity['towerType']) => number,
  ) {
    this.map = map;
    this.parent = parent;
    this.shadows = shadows;
    this.tex = tex;
    this.muzzle = muzzle;
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
      v = { sprite, shadow, seen: -1 };
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
      v.seen = this.frameNo;
      const x = p.prevX + (p.x - p.prevX) * alpha;
      const y = p.prevY + (p.y - p.prevY) * alpha;
      const z = p.prevZ + (p.z - p.prevZ) * alpha;
      const sx = this.map.pxX(x);
      const sy = this.screenY(p, z, y);
      const s = v.sprite;
      s.visible = true;
      s.position.set(sx, sy);
      const ball = p.towerType === 'cannon' || p.towerType === 'mortar';
      if (p.towerType === 'archer' || p.towerType === 'ballista') {
        if (s.texture !== this.tex.arrow) s.texture = this.tex.arrow;
        const psx = this.map.pxX(p.prevX);
        const psy = this.screenY(p, p.prevZ, p.prevY);
        const dx = sx - psx;
        const dy = sy - psy;
        if (dx * dx + dy * dy > 1e-4) s.rotation = Math.atan2(dy, dx);
        s.scale.set(p.towerType === 'ballista' ? 0.75 : 0.5);
        s.tint = 0xffffff;
      } else if (ball) {
        if (s.texture !== this.tex.ball) s.texture = this.tex.ball;
        s.rotation = 0;
        s.scale.set(p.towerType === 'mortar' ? 0.85 : 0.6);
        s.tint = 0xffffff;
      } else {
        if (s.texture !== this.tex.glow) s.texture = this.tex.glow;
        s.rotation = 0;
        s.scale.set(0.45);
        s.tint = p.towerType === 'frost' ? 0xbfefff : 0xffffff;
      }
      v.shadow.visible = ball;
      if (ball) {
        v.shadow.position.set(sx, this.map.pxY(z));
        v.shadow.scale.set(0.16, 0.08);
        v.shadow.alpha = 0.6;
      }
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
