import { Sprite, Texture } from 'pixi.js';
import type { TowerEntity } from '../sim/entities.ts';
import type { LoadedArt, TowerArtRuntime } from './assets2d.ts';
import type { WorldLayers } from './layers.ts';
import type { MapView } from './mapView.ts';
import type { ProcTextures } from './procTextures.ts';

interface TowerView {
  readonly sprite: Sprite;
  readonly shadow: Sprite;
  readonly art: TowerArtRuntime | null;
  tier: number;
  kick: number;
  /** +1 = target on the right. */
  aim: number;
  seen: number;
}

/**
 * Tower sprites on plots: tier art from the manifest (fallbacks applied at load), a fire kick
 * (squash + small hop), facing toward the target for art that supports it, and the sim's build /
 * upgrade pop. Views are created lazily per tower id and removed when the tower is sold.
 */
export class TowerLayer {
  private readonly views = new Map<number, TowerView>();
  private frameNo = 0;
  private readonly art: LoadedArt;
  private readonly map: MapView;
  private readonly layers: WorldLayers;
  private readonly tex: ProcTextures;

  constructor(art: LoadedArt, map: MapView, layers: WorldLayers, tex: ProcTextures) {
    this.art = art;
    this.map = map;
    this.layers = layers;
    this.tex = tex;
  }

  /** Tower fired (event): kick + face the shot direction (yaw = atan2(dx, dz)). */
  onFired(towerId: number, yaw: number): void {
    const v = this.views.get(towerId);
    if (!v) return;
    v.kick = 1;
    const dx = Math.sin(yaw);
    if (Math.abs(dx) > 0.15) v.aim = dx > 0 ? 1 : -1;
  }

  private create(t: TowerEntity): TowerView {
    const art = this.art.towers[t.type] ?? null;
    const sprite = new Sprite(art ? art.tiers[0] : Texture.WHITE);
    const shadow = new Sprite(this.tex.shadow);
    shadow.anchor.set(0.5);
    if (art) sprite.anchor.set(art.spec.anchor[0], art.spec.anchor[1]);
    this.layers.actors.addChild(sprite);
    this.layers.shadows.addChild(shadow);
    const v: TowerView = { sprite, shadow, art, tier: 0, kick: 0, aim: -1, seen: 0 };
    this.views.set(t.id, v);
    return v;
  }

  sync(towers: readonly TowerEntity[], dt: number): void {
    this.frameNo++;
    const ppu = this.map.layout.pxPerUnit;
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      const v = this.views.get(t.id) ?? this.create(t);
      v.seen = this.frameNo;
      const art = v.art;
      if (v.tier !== t.tier && art) {
        v.tier = t.tier;
        v.sprite.texture = art.tiers[Math.min(art.tiers.length, t.tier) - 1];
      }
      const px = this.map.pxX(t.x);
      const py = this.map.pxY(t.z);
      const height = (art ? art.spec.height : 3) * ppu * (1 + (t.tier - 1) * 0.04);
      const base = height / Math.max(1, v.sprite.texture.height);
      v.kick = Math.max(0, v.kick - dt * 6);
      const pop = t.popAnimTimer > 0 ? Math.sin((t.popAnimTimer / 0.32) * Math.PI) * 0.12 : 0;
      const squash = v.kick * 0.06;
      const flip = art && art.spec.flipToTarget ? (art.spec.facing === 'left' ? v.aim > 0 : v.aim < 0) : false;
      v.sprite.scale.set(base * (1 + squash * 0.5 + pop) * (flip ? -1 : 1), base * (1 - squash + pop));
      v.sprite.position.set(px, py);
      v.sprite.zIndex = py;
      v.shadow.position.set(px, py + 4);
      v.shadow.scale.set((ppu * 2.2) / 128, (ppu * 1.0) / 128);
      v.shadow.alpha = 0.5;
    }
    for (const [id, v] of this.views) {
      if (v.seen !== this.frameNo) {
        v.sprite.destroy();
        v.shadow.destroy();
        this.views.delete(id);
      }
    }
  }

  /** Screen-independent top of a tower sprite in map px (for panels / labels). */
  topPx(t: TowerEntity): number {
    const art = this.art.towers[t.type];
    return this.map.pxY(t.z) - (art ? art.spec.height : 3) * this.map.layout.pxPerUnit * 0.9;
  }

  muzzleHeight(type: TowerEntity['type']): number {
    return this.art.towers[type]?.spec.muzzle ?? 2;
  }
}
