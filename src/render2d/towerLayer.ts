import { Sprite, Texture } from 'pixi.js';
import type { EventBus, GameEventMap } from '../core/eventBus.ts';
import type { TowerType } from '../core/types.ts';
import type { TowerEntity } from '../sim/entities.ts';
import { mixTint } from './artResolve.ts';
import type { LoadedArt, TowerArtRuntime } from './assets2d.ts';
import type { FxLayer } from './fxLayer.ts';
import { HEIGHT_TO_SCREEN, type WorldLayers } from './layers.ts';
import type { MapView } from './mapView.ts';
import type { ProcTextures } from './procTextures.ts';

/** Procedural attack animation of one tower type (lookup with a default, so new towers just work). */
export interface FireProfile {
  /** Seconds the kick takes to settle. */
  readonly dur: number;
  /** Recoil along the (screen-x) aim direction, px at full kick. */
  readonly recoilPx: number;
  readonly squashY: number;
  readonly stretchX: number;
  /** Uniform scale pulse (sin over the kick). */
  readonly pulse: number;
  /** Downward press, px. */
  readonly press: number;
  /** Rotational wobble (rad). */
  readonly wobble: number;
  readonly flash: 'arrow' | 'blast' | 'crystal' | 'frost' | 'mortar' | 'bolt' | 'none';
  /** Colour of the tier-3 / special flourish ring. */
  readonly accent: number;
}

const DEFAULT_PROFILE: FireProfile = { dur: 0.22, recoilPx: 2, squashY: 0.05, stretchX: 0.025, pulse: 0, press: 0, wobble: 0, flash: 'none', accent: 0xffe9b0 };

export const FIRE_PROFILES: Readonly<Partial<Record<TowerType, FireProfile>>> = {
  archer: { dur: 0.16, recoilPx: 2.5, squashY: 0.04, stretchX: 0.07, pulse: 0, press: 0, wobble: 0.02, flash: 'arrow', accent: 0xffd45a },
  cannon: { dur: 0.3, recoilPx: 8, squashY: 0.1, stretchX: 0.05, pulse: 0, press: 2, wobble: 0.015, flash: 'blast', accent: 0xffa24a },
  tesla: { dur: 0.24, recoilPx: 0, squashY: 0, stretchX: 0, pulse: 0.085, press: 0, wobble: 0, flash: 'crystal', accent: 0x6cc8ff },
  frost: { dur: 0.28, recoilPx: 1, squashY: 0.03, stretchX: 0.02, pulse: 0.06, press: 0, wobble: 0.03, flash: 'frost', accent: 0xbfeaff },
  mortar: { dur: 0.42, recoilPx: 2, squashY: 0.15, stretchX: 0.06, pulse: 0, press: 4, wobble: 0, flash: 'mortar', accent: 0xffa24a },
  ballista: { dur: 0.32, recoilPx: 6, squashY: 0.03, stretchX: 0.1, pulse: 0, press: 0, wobble: 0.05, flash: 'bolt', accent: 0xffe9b0 },
  beacon: { dur: 0.6, recoilPx: 0, squashY: 0, stretchX: 0, pulse: 0.1, press: 0, wobble: 0, flash: 'none', accent: 0xffd45a },
};

export function fireProfile(type: string): FireProfile {
  return FIRE_PROFILES[type as TowerType] ?? DEFAULT_PROFILE;
}

const JAM_TINT = 0xb9a0d8;

interface TowerView {
  readonly sprite: Sprite;
  readonly shadow: Sprite;
  readonly art: TowerArtRuntime | null;
  jam: Sprite | null;
  aura: Sprite | null;
  star: Sprite | null;
  tier: number;
  kick: number;
  prof: FireProfile;
  dirX: number;
  /** +1 = target on the right. */
  aim: number;
  px: number;
  py: number;
  seen: number;
}

/**
 * Tower sprites on plots: tier art from the manifest (fallbacks applied at load, fallback art
 * tinted), per-type procedural attack animation (recoil / squash / pulse / wobble + muzzle FX),
 * aim flip, the sim's build / upgrade pop, the jammed-tower marker (hexer / boss / tempest) and
 * the Beacon buff glow. Views are created lazily per tower id and removed when the tower is sold.
 */
export class TowerLayer {
  private readonly views = new Map<number, TowerView>();
  private frameNo = 0;
  private time = 0;
  private readonly art: LoadedArt;
  private readonly map: MapView;
  private readonly layers: WorldLayers;
  private readonly tex: ProcTextures;
  private readonly fx: FxLayer | null;
  /** Lifetime counters (QA). */
  firedSeen = 0;
  specialSeen = 0;

  constructor(art: LoadedArt, map: MapView, layers: WorldLayers, tex: ProcTextures, fx: FxLayer | null = null) {
    this.art = art;
    this.map = map;
    this.layers = layers;
    this.tex = tex;
    this.fx = fx;
  }

  /** Wires the tower events this layer animates. */
  bind(ev: EventBus): void {
    ev.on('towerFired', (e) => this.onFired(e));
    ev.on('beaconPulse', (e) => {
      const v = this.views.get(e.towerId);
      if (v) {
        v.kick = 1;
        v.prof = fireProfile('beacon');
      }
    });
  }

  /** Tower fired (event): attack animation, muzzle flash and the tier signature flourish. */
  onFired(e: GameEventMap['towerFired']): void {
    const v = this.views.get(e.towerId);
    if (!v) return;
    this.firedSeen++;
    const prof = fireProfile(e.type);
    v.kick = 1;
    v.prof = prof;
    const dx = Math.sin(e.yaw);
    const dy = Math.cos(e.yaw);
    v.dirX = Math.abs(dx) > 0.05 ? Math.sign(dx) : v.dirX;
    if (Math.abs(dx) > 0.15) v.aim = dx > 0 ? 1 : -1;
    const fx = this.fx;
    if (!fx) return;
    const ppu = this.map.layout.pxPerUnit;
    const muzzleH = this.art.towers[e.type]?.spec.muzzle ?? 2;
    const mx = v.px + dx * 12;
    const my = v.py - muzzleH * HEIGHT_TO_SCREEN * ppu + dy * 6;
    const big = e.tier >= 3 ? 1.3 : e.tier === 2 ? 1.12 : 1;
    switch (prof.flash) {
      case 'arrow':
        fx.spawn('spark', mx, my, 12 * big, dx * 20, dy * 14, 0.14, 0xfff2c4);
        break;
      case 'blast':
        fx.spawn('flash', mx, my, 34 * big, 0, 0, 0.14, 0xffc070);
        for (let i = 0; i < 3; i++) fx.spawn('puff', mx, my, (9 + i * 3) * big, dx * (50 + i * 22), dy * 30 - 10, 0.36 + i * 0.07, 0xb9b0a2);
        break;
      case 'crystal':
        fx.spawn('orb', mx, my, 36 * big, 0, 0, 0.26, 0x7fd4ff);
        fx.spawn('wring', mx, my + 6, 20 * big, 0, 0, 0.26, 0x9fdcff);
        break;
      case 'frost':
        fx.spawn('orb', mx, my, 30 * big, 0, 0, 0.3, 0xbfeaff);
        fx.burst('shard', mx, my, 3, 9, 52, 0.34, 0xdff6ff, 120);
        fx.burst('spark', mx, my, 4, 7, 40, 0.36, 0xffffff);
        break;
      case 'mortar':
        fx.spawn('flash', mx, my, 40 * big, 0, 0, 0.16, 0xffb060);
        for (let i = 0; i < 4; i++) fx.spawn('puff', mx + (i - 1.5) * 4, my, (11 + i * 2) * big, (i - 1.5) * 8, -58 - i * 12, 0.5 + i * 0.07, 0xa89c8e);
        fx.spawn('wring', v.px, v.py + 2, 24 * big, 0, 0, 0.32, 0xd9c29a);
        break;
      case 'bolt':
        fx.spawn('spark', mx, my, 14 * big, 0, 0, 0.16, 0xffe9b0);
        fx.beam(mx - dx * 16, my - dy * 8, mx + dx * 22, my + dy * 11, 0xffe9b0, 2.6, 0.14);
        break;
      default:
        break;
    }
    if (e.special) {
      // Tier signature flourish (archer volley, tesla overload): ring + sparks in the tower's accent colour.
      this.specialSeen++;
      fx.spawn('wring', v.px, v.py, 38, 0, 0, 0.5, prof.accent);
      fx.spawn('orb', mx, my, 52, 0, 0, 0.3, prof.accent);
      fx.burst('spark', mx, my, 7, 10, 80, 0.5, prof.accent);
    } else if (e.tier >= 3 && prof.flash !== 'none') {
      fx.spawn('wring', v.px, v.py, 20, 0, 0, 0.24, prof.accent);
    }
  }

  private create(t: TowerEntity): TowerView {
    const art = this.art.towers[t.type] ?? null;
    const sprite = new Sprite(art ? art.tiers[0] : Texture.WHITE);
    const shadow = new Sprite(this.tex.shadow);
    shadow.anchor.set(0.5);
    if (art) {
      sprite.anchor.set(art.spec.anchor[0], art.spec.anchor[1]);
      sprite.tint = art.tint;
    }
    this.layers.actors.addChild(sprite);
    this.layers.shadows.addChild(shadow);
    const v: TowerView = {
      sprite,
      shadow,
      art,
      jam: null,
      aura: null,
      star: null,
      tier: 0,
      kick: 0,
      prof: fireProfile(t.type),
      dirX: 1,
      aim: -1,
      px: 0,
      py: 0,
      seen: 0,
    };
    this.views.set(t.id, v);
    return v;
  }

  private overlay(v: TowerView, slot: 'jam' | 'aura' | 'star', on: boolean): Sprite | null {
    let s = v[slot];
    if (!on) {
      if (s) s.visible = false;
      return null;
    }
    if (!s) {
      s = new Sprite(slot === 'jam' ? this.tex.jam : slot === 'aura' ? this.tex.orb : this.tex.star);
      s.anchor.set(0.5);
      if (slot !== 'jam') s.blendMode = 'add';
      (slot === 'aura' ? this.layers.shadows : this.layers.air).addChild(s);
      v[slot] = s;
    }
    s.visible = true;
    return s;
  }

  sync(towers: readonly TowerEntity[], dt: number): void {
    this.frameNo++;
    this.time += dt;
    const time = this.time;
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
      v.px = px;
      v.py = py;
      const height = (art ? art.spec.height : 3) * ppu * (1 + (t.tier - 1) * 0.04);
      const base = height / Math.max(1, v.sprite.texture.height);
      v.kick = Math.max(0, v.kick - dt / v.prof.dur);
      const pop = t.popAnimTimer > 0 ? Math.sin((t.popAnimTimer / 0.32) * Math.PI) * 0.12 : 0;
      const k = v.kick;
      const p = v.prof;
      const pulse = p.pulse * Math.sin(k * Math.PI);
      let sx = 1 + p.stretchX * k + pulse;
      let sy = 1 - p.squashY * k + pulse;
      const recoil = -v.dirX * p.recoilPx * k * k;
      const press = p.press * k;
      let rot = Math.sin(k * 16) * p.wobble * k * v.dirX;
      if (t.type === 'beacon') {
        const idle = 0.025 * Math.sin(time * 2.4 + t.id);
        sx += idle;
        sy += idle;
      }
      const jammed = t.stunTimer > 0;
      const buffed = t.auraRate > 0 || t.auraRange > 0;
      const flip = art && art.spec.flipToTarget ? (art.spec.facing === 'left' ? v.aim > 0 : v.aim < 0) : false;
      v.sprite.scale.set(base * (sx + pop * 0.5) * (flip ? -1 : 1), base * (sy + pop));
      if (jammed) rot += Math.sin(time * 31) * 0.02;
      v.sprite.rotation = rot;
      v.sprite.position.set(px + recoil, py + press);
      v.sprite.zIndex = py;
      let tint = art ? art.tint : 0xffffff;
      if (jammed) tint = mixTint(tint, JAM_TINT, 0.45 + 0.1 * Math.sin(time * 12));
      v.sprite.tint = tint;
      v.shadow.position.set(px, py + 4);
      v.shadow.scale.set((ppu * 2.2) / 128, (ppu * 1.0) / 128);
      v.shadow.alpha = 0.5;

      // Jam marker: a spinning magenta ring with a bolt over the silenced tower.
      const jam = this.overlay(v, 'jam', jammed);
      if (jam) {
        const fade = Math.min(1, t.stunTimer / 0.4);
        jam.position.set(px, py - height * 0.98 - 16 + Math.sin(time * 5) * 2);
        jam.scale.set(((34 + 3 * Math.sin(time * 9)) / 64) * (0.7 + 0.3 * fade));
        jam.alpha = fade * (0.8 + 0.2 * Math.sin(time * 16));
        jam.rotation = Math.sin(time * 3) * 0.2;
        jam.zIndex = py + 1;
      }
      // Beacon buff: a warm ground glow and a drifting sparkle on buffed towers.
      const aura = this.overlay(v, 'aura', buffed);
      if (aura) {
        aura.tint = 0xffd45a;
        aura.alpha = 0.28 + 0.12 * Math.sin(time * 3 + t.id);
        aura.position.set(px, py + 2);
        aura.scale.set((ppu * 3.2) / 64, (ppu * 1.5) / 64);
      }
      const star = this.overlay(v, 'star', buffed && !jammed);
      if (star) {
        const a = time * 2.2 + t.id * 1.7;
        star.tint = 0xffe27a;
        star.position.set(px + Math.cos(a) * ppu * 0.55, py - height * 0.55 + Math.sin(a * 1.3) * ppu * 0.3);
        star.scale.set((9 + 4 * Math.sin(time * 7 + t.id)) / 32);
        star.alpha = 0.8;
        star.zIndex = py + 1;
      }
    }
    for (const [id, v] of this.views) {
      if (v.seen !== this.frameNo) {
        v.sprite.destroy();
        v.shadow.destroy();
        v.jam?.destroy();
        v.aura?.destroy();
        v.star?.destroy();
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

  /** QA: towers currently drawn with the jam marker / buff glow. */
  markers(): { jammed: number; buffed: number } {
    let jammed = 0;
    let buffed = 0;
    for (const v of this.views.values()) {
      if (v.jam?.visible) jammed++;
      if (v.aura?.visible) buffed++;
    }
    return { jammed, buffed };
  }
}
