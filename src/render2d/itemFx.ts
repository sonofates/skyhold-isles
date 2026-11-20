import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { EventBus } from '../core/eventBus.ts';
import type { Level2DLayout } from '../data/levels/types.ts';
import { ITEMS, type ItemId } from '../data/market.ts';
import { fxPrefsNow } from './fxLayer.ts';
import type { Game2D } from './game2d.ts';
import type { QualityTier } from './renderResolution.ts';

/**
 * Painted FX of the Market's belt items (docs/market.md "Renderer events"), driven by the sim's
 * own events so live play and replays look the same:
 *  - aiming: Ember Pot / Frost Lantern radius ring in the item's colour (like Meteor's), the
 *    Cloudguard Banner as a ghost standard on the road point the sim would snap to,
 *  - Ember Pot: the pot shatters (flash, terracotta shards, embers, a warm ring); the burning patch
 *    itself is the shared `groundZone` fire (specialFx.ts),
 *  - Frost Lantern: an icy ring and a frost patch that thaws over the freeze; each frozen foe gets
 *    a shard puff (its icy tint is enemyLayer.ts's, from the sim's `frozenTimer`),
 *  - Heartstone: hearts float from the castle to the lives counter,
 *  - Sky Purse: coins spill from mid-screen into the gold counter,
 *  - Cloudguard Banner: a cloud-blue standard rises on the road and sways while its squad holds
 *    (the soldiers are soldierLayer.ts's barracks soldiers, negative tower ids),
 *  - Gale Bell: rings at the castle and a wind streak along every pushed foe's way back.
 * Low quality / Low effects thin the particles out; Reduced motion keeps short fades and draws no
 * flying hearts or coins (one glow at the counter instead).
 */

const EMBER = 0xff9a3a;
const FIRE = 0xffc25a;
const CLAY = 0xb4643a;
const ICE = 0x9fdcff;
const ICE_DEEP = 0x5fb2e8;
const FROST_WHITE = 0xeaf8ff;
const WIND = 0xe6f6ef;
const GOLD = 0xffd75a;
const HEART = 0xff6f86;
const BAD = 0xd06050;

/** Aim colour per targeted item. */
export const ITEM_AIM_TINT: Readonly<Record<'emberPot' | 'frostLantern' | 'cloudguard', number>> = {
  emberPot: EMBER,
  frostLantern: ICE,
  cloudguard: 0xbfe0ff,
};

/** Same rule as the sim (itemSystem.ts `onMap`): the point lies on the island's painting. */
export function itemOnMap(layout: Pick<Level2DLayout, 'imageSize' | 'pxPerUnit'>, x: number, z: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  return Math.abs(x) <= layout.imageSize[0] / (2 * layout.pxPerUnit) && Math.abs(z) <= layout.imageSize[1] / (2 * layout.pxPerUnit);
}

/**
 * How many hearts / coins fly for a cast: `base` at full effects, thinned by the effects density
 * (Low ≈ a third), never fewer than 2; Reduced motion → 0 (a glow at the counter instead).
 */
export function flyCount(base: number, density: number, reduced: boolean): number {
  if (reduced) return 0;
  return Math.max(2, Math.min(base, Math.round(base * Math.max(0, Math.min(1, density)))));
}

/** A point on the quadratic arc from `a` to `b` bulging up by `lift` (screen px), `t` in 0..1. */
export function arcPoint(a: { x: number; y: number }, b: { x: number; y: number }, lift: number, t: number): { x: number; y: number } {
  const k = Math.max(0, Math.min(1, t));
  const cx = (a.x + b.x) / 2;
  const cy = Math.min(a.y, b.y) - lift;
  const u = 1 - k;
  return { x: u * u * a.x + 2 * u * k * cx + k * k * b.x, y: u * u * a.y + 2 * u * k * cy + k * k * b.y };
}

/** Effects density of a quality tier with the Settings multiplier (1 = High / Normal). */
export function tierDensity(tier: QualityTier, prefs: number): number {
  return (tier === 'high' ? 1 : tier === 'med' ? 0.6 : 0.3) * prefs;
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture {
  if (typeof document === 'undefined') return Texture.WHITE;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return Texture.WHITE;
  draw(ctx);
  return Texture.from(c);
}

/** Painted heart with a dark outline and a soft highlight (48 px). */
function heartTexture(): Texture {
  return canvasTexture(48, 48, (ctx) => {
    ctx.beginPath();
    ctx.moveTo(24, 41);
    ctx.bezierCurveTo(4, 28, 3, 13, 13, 9);
    ctx.bezierCurveTo(19, 7, 23, 11, 24, 15);
    ctx.bezierCurveTo(25, 11, 29, 7, 35, 9);
    ctx.bezierCurveTo(45, 13, 44, 28, 24, 41);
    ctx.closePath();
    const g = ctx.createRadialGradient(18, 16, 2, 24, 22, 22);
    g.addColorStop(0, '#ffd0d8');
    g.addColorStop(0.35, '#ff6f86');
    g.addColorStop(1, '#b8283e');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#3a1410';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.ellipse(16, 16, 4, 2.6, -0.6, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** Painted gold coin, slightly tilted (40 px). */
function coinTexture(): Texture {
  return canvasTexture(40, 40, (ctx) => {
    ctx.beginPath();
    ctx.ellipse(20, 20, 16, 14, 0, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(15, 14, 2, 20, 20, 17);
    g.addColorStop(0, '#fff6c2');
    g.addColorStop(0.45, '#ffd25a');
    g.addColorStop(1, '#b07418');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = '#3a2410';
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(20, 20, 9.5, 8, 0, 0, Math.PI * 2);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(122,76,20,0.8)';
    ctx.stroke();
  });
}

/** Cloudguard standard: a wooden pole with a sky-blue cloth, a cloud and a shield, dark outline. Base at (24, 94). */
function bannerTexture(): Texture {
  return canvasTexture(64, 96, (ctx) => {
    ctx.lineJoin = 'round';
    // Pole.
    ctx.fillStyle = '#8a5a2c';
    ctx.strokeStyle = '#2a1408';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.rect(21, 8, 6, 86);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(24, 8, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd25a';
    ctx.fill();
    ctx.stroke();
    // Cloth with a swallow-tail.
    ctx.beginPath();
    ctx.moveTo(27, 14);
    ctx.lineTo(60, 16);
    ctx.lineTo(58, 52);
    ctx.lineTo(48, 46);
    ctx.lineTo(38, 54);
    ctx.lineTo(27, 50);
    ctx.closePath();
    const g = ctx.createLinearGradient(27, 14, 58, 54);
    g.addColorStop(0, '#9fd2ff');
    g.addColorStop(1, '#3f7fd0');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.stroke();
    // Cloud and shield.
    ctx.fillStyle = '#f4fbff';
    ctx.beginPath();
    ctx.arc(37, 26, 5, 0, Math.PI * 2);
    ctx.arc(44, 23, 6.5, 0, Math.PI * 2);
    ctx.arc(51, 27, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(38, 32);
    ctx.lineTo(50, 32);
    ctx.lineTo(50, 39);
    ctx.quadraticCurveTo(44, 46, 44, 46);
    ctx.quadraticCurveTo(38, 42, 38, 39);
    ctx.closePath();
    ctx.fillStyle = '#ffd25a';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2a1408';
    ctx.stroke();
  });
}

interface Flyer {
  readonly sprite: Sprite;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  lift: number;
  delay: number;
  t: number;
  life: number;
  size: number;
  active: boolean;
}

interface Decal {
  readonly sprite: Sprite;
  t: number;
  life: number;
  alpha: number;
  pulse: number;
  active: boolean;
}

interface Streak {
  readonly g: Graphics;
  t: number;
  life: number;
  active: boolean;
}

interface Banner {
  readonly sprite: Sprite;
  readonly ring: Sprite;
  x: number;
  z: number;
  t: number;
  life: number;
  fading: number;
  active: boolean;
}

const MAX_STREAKS = 24;
const MAX_FLYERS = 18;
const RISE = 0.35;

export class ItemFx {
  private readonly game: Game2D;
  private readonly ground = new Container();
  private readonly top = new Container();
  private readonly screen = new Container();
  private readonly aimRing: Sprite;
  private readonly aimFill: Sprite;
  private readonly aimReach: Sprite;
  private readonly aimBanner: Sprite;
  private readonly heartTex: Texture;
  private readonly coinTex: Texture;
  private readonly bannerTex: Texture;
  private readonly flyers: Flyer[] = [];
  private readonly decals: Decal[] = [];
  private readonly streaks: Streak[] = [];
  private readonly banners: Banner[] = [];
  private bound: EventBus | null = null;
  private unbind: (() => void)[] = [];
  private clock = 0;
  private aimFor: ItemId | null = null;
  private readonly road = { x: 0, z: 0, yaw: 0 };
  /** QA counters (lifetime). */
  readonly counts = { ember: 0, frost: 0, frozen: 0, hearts: 0, coins: 0, banners: 0, gales: 0, pushed: 0 };

  constructor(game: Game2D) {
    this.game = game;
    const tex = game.tex;
    this.heartTex = heartTexture();
    this.coinTex = coinTexture();
    this.bannerTex = bannerTexture();
    this.aimFill = new Sprite(tex.orb);
    this.aimFill.anchor.set(0.5);
    this.aimFill.alpha = 0.28;
    this.aimRing = new Sprite(tex.wring);
    this.aimRing.anchor.set(0.5);
    this.aimReach = new Sprite(tex.wring);
    this.aimReach.anchor.set(0.5);
    this.aimReach.alpha = 0.35;
    this.aimBanner = new Sprite(this.bannerTex);
    this.aimBanner.anchor.set(24 / 64, 94 / 96);
    this.aimBanner.alpha = 0.8;
    for (const s of [this.aimFill, this.aimRing, this.aimReach]) s.visible = false;
    this.aimBanner.visible = false;
    this.ground.addChild(this.aimFill, this.aimReach, this.aimRing);
    this.top.addChild(this.aimBanner);
    game.layers.groundFx.addChild(this.ground);
    game.layers.fx.addChild(this.top);
    // Hearts and coins fly to the HUD counters: screen space, over the HUD.
    game.app.stage.addChild(this.screen);
  }

  private get ppu(): number {
    return this.game.map.layout.pxPerUnit;
  }

  private get reduced(): boolean {
    return typeof document !== 'undefined' && document.documentElement.classList.contains('pu-reduce-motion');
  }

  private get density(): number {
    return tierDensity(this.game.qualityTier, fxPrefsNow().density);
  }

  // --- aiming --------------------------------------------------------------------------------

  showAim(id: ItemId, x: number, z: number, valid: boolean): { x: number; z: number; ok: boolean } {
    const m = this.game.map;
    const layout = this.game.level.layout2d;
    const on = valid && (!layout || itemOnMap(layout, x, z));
    this.aimFor = id;
    if (id === 'cloudguard') {
      const reach = ITEMS.cloudguard.snapRadius;
      const found = on && this.game.world.soldierSystem.findRoadPoint(x, z, reach, x, z, this.road);
      const at = found ? { x: this.road.x, z: this.road.z } : { x, z };
      this.aimReach.visible = true;
      this.aimReach.position.set(m.pxX(x), m.pxY(z));
      this.aimReach.scale.set((reach * this.ppu * 2) / 128, (reach * this.ppu * 2 * 0.9) / 128);
      this.aimReach.tint = found ? ITEM_AIM_TINT.cloudguard : BAD;
      this.aimBanner.visible = true;
      this.aimBanner.position.set(m.pxX(at.x), m.pxY(at.z));
      this.aimBanner.scale.set((1.25 * this.ppu) / 96);
      this.aimBanner.tint = found ? 0xffffff : 0xd08080;
      this.aimBanner.alpha = found ? 0.85 : 0.5;
      this.aimRing.visible = found;
      this.aimRing.position.copyFrom(this.aimBanner.position);
      this.aimRing.scale.set((0.9 * this.ppu * 2) / 128, (0.9 * this.ppu * 2 * 0.9) / 128);
      this.aimRing.tint = 0xfff2b0;
      this.aimFill.visible = false;
      return { x: at.x, z: at.z, ok: found };
    }
    if (id === 'emberPot' || id === 'frostLantern') {
      const r = ITEMS[id].radius * this.ppu;
      const tint = ITEM_AIM_TINT[id];
      this.aimRing.visible = true;
      this.aimRing.position.set(m.pxX(x), m.pxY(z));
      this.aimRing.scale.set((r * 2) / 128);
      this.aimRing.tint = on ? tint : 0x9a8a80;
      this.aimRing.alpha = on ? 1 : 0.6;
      this.aimFill.visible = on;
      this.aimFill.position.copyFrom(this.aimRing.position);
      this.aimFill.scale.set((r * 2) / 64);
      this.aimFill.tint = tint;
      this.aimReach.visible = false;
      this.aimBanner.visible = false;
      return { x, z, ok: on };
    }
    this.hideAim();
    return { x, z, ok: valid };
  }

  hideAim(): void {
    this.aimFor = null;
    this.aimRing.visible = this.aimFill.visible = this.aimReach.visible = this.aimBanner.visible = false;
  }

  // --- event binding -------------------------------------------------------------------------

  private bind(): void {
    for (const u of this.unbind) u();
    this.clear();
    const ev = (this.bound = this.game.events);
    this.unbind = [
      ev.on('itemCast', (e) => this.cast(e.id, e.x, e.z)),
      ev.on('enemyFrozen', (e) => this.frozen(e.x, e.z, e.slowOnly)),
      ev.on('enemyPushed', (e) => this.pushed(e.fromX, e.fromZ, e.x, e.z)),
    ];
  }

  private cast(id: ItemId, x?: number, z?: number): void {
    switch (id) {
      case 'emberPot':
        if (x !== undefined && z !== undefined) this.ember(x, z);
        break;
      case 'frostLantern':
        if (x !== undefined && z !== undefined) this.frost(x, z);
        break;
      case 'cloudguard':
        if (x !== undefined && z !== undefined) this.banner(x, z);
        break;
      case 'heartstone':
        this.hearts();
        break;
      case 'skyPurse':
        this.coins();
        break;
      case 'galeBell':
        this.gale();
        break;
    }
  }

  private ember(x: number, z: number): void {
    this.counts.ember++;
    const fx = this.game.fx;
    const m = this.game.map;
    const px = m.pxX(x);
    const py = m.pxY(z);
    const r = ITEMS.emberPot.radius * this.ppu;
    const d = this.density;
    fx.spawn('flash', px, py - 8, Math.max(60, r * 0.8), 0, 0, 0.22, FIRE);
    fx.spawn('wring', px, py, r, 0, 0, 0.7, EMBER);
    fx.spawn('crater', px, py, r * 0.55, 0, 0, 1.6);
    fx.burst('shard', px, py - 10, Math.max(3, Math.round(9 * d)), 12, 150, 0.6, CLAY, 360);
    if (!this.reduced) fx.burst('spark', px, py - 6, Math.max(4, Math.round(16 * d)), 10, 120, 0.8, EMBER, -40);
    fx.puffs(px, py - 4, Math.max(2, Math.round(6 * d)), r * 0.45, 0x8a6a52);
  }

  private frost(x: number, z: number): void {
    this.counts.frost++;
    const fx = this.game.fx;
    const m = this.game.map;
    const px = m.pxX(x);
    const py = m.pxY(z);
    const r = ITEMS.frostLantern.radius * this.ppu;
    const d = this.density;
    fx.spawn('flash', px, py - 10, Math.max(50, r * 0.6), 0, 0, 0.25, FROST_WHITE);
    fx.spawn('wring', px, py, r, 0, 0, 0.9, ICE);
    if (!this.reduced) fx.spawn('wring', px, py, r * 0.6, 0, 0, 0.7, FROST_WHITE);
    fx.burst('shard', px, py - 8, Math.max(3, Math.round(10 * d)), 11, 110, 0.7, ICE, 260);
    // A frost patch on the ground that thaws over the freeze.
    const patch = this.decal(this.game.tex.orb, this.ground);
    patch.sprite.position.set(px, py);
    patch.sprite.scale.set((r * 2) / 64, (r * 2 * 0.9) / 64);
    patch.sprite.tint = ICE_DEEP;
    patch.sprite.blendMode = 'add';
    patch.alpha = 0.32;
    patch.pulse = 0;
    patch.life = ITEMS.frostLantern.seconds;
  }

  private frozen(x: number, z: number, slowOnly: boolean): void {
    this.counts.frozen++;
    const fx = this.game.fx;
    const m = this.game.map;
    const px = m.pxX(x);
    const py = m.pxY(z);
    fx.spawn('ring', px, py, 0.7 * this.ppu, 0, 0, 0.45, slowOnly ? ICE : FROST_WHITE);
    if (!slowOnly && this.density > 0.4) fx.burst('shard', px, py - 0.6 * this.ppu, 3, 8, 50, 0.5, FROST_WHITE, 200);
  }

  private pushed(fx0: number, fz0: number, x: number, z: number): void {
    this.counts.pushed++;
    const cap = this.density >= 0.6 ? MAX_STREAKS : 8;
    if (this.streaks.filter((s) => s.active).length >= cap) return;
    let s = this.streaks.find((q) => !q.active);
    if (!s) {
      if (this.streaks.length >= MAX_STREAKS) return;
      const g = new Graphics();
      this.top.addChild(g);
      s = { g, t: 0, life: 0.6, active: false };
      this.streaks.push(s);
    }
    const m = this.game.map;
    const ax = m.pxX(fx0);
    const ay = m.pxY(fz0) - 0.6 * this.ppu;
    const bx = m.pxX(x);
    const by = m.pxY(z) - 0.6 * this.ppu;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const g = s.g;
    g.clear();
    // Two soft wind strokes bowing a little to either side, with a curl at the end.
    for (const [off, w, a] of [[0.12, 5, 0.55], [-0.08, 3, 0.8]] as const) {
      const cx = (ax + bx) / 2 + nx * len * off;
      const cy = (ay + by) / 2 + ny * len * off;
      g.moveTo(ax, ay).quadraticCurveTo(cx, cy, bx, by).stroke({ width: w, color: WIND, alpha: a, cap: 'round' });
    }
    g.circle(bx + nx * 6, by + ny * 6, 6).stroke({ width: 2.5, color: WIND, alpha: 0.7 });
    g.visible = true;
    g.alpha = 1;
    s.t = 0;
    s.life = this.reduced ? 0.35 : 0.6;
    s.active = true;
  }

  private castlePx(): { x: number; y: number } {
    const m = this.game.map;
    const paths = this.game.level.layout2d?.paths ?? [];
    const end = paths[0]?.[paths[0].length - 1];
    return end ? { x: m.pxX(end.x), y: m.pxY(end.z) } : { x: m.layout.imageSize[0] / 2, y: m.layout.imageSize[1] / 2 };
  }

  private gale(): void {
    this.counts.gales++;
    const fx = this.game.fx;
    const c = this.castlePx();
    const r = 2.6 * this.ppu;
    fx.spawn('flash', c.x, c.y - 1.2 * this.ppu, 70, 0, 0, 0.25, WIND);
    fx.spawn('wring', c.x, c.y, r, 0, 0, 0.8, WIND);
    if (!this.reduced) {
      fx.spawn('wring', c.x, c.y, r * 1.7, 0, 0, 1.1, 0xbfe8d8);
      fx.burst('puff', c.x, c.y - 0.4 * this.ppu, Math.max(3, Math.round(8 * this.density)), 18, 160, 0.7, WIND);
    }
  }

  private banner(x: number, z: number): void {
    this.counts.banners++;
    const m = this.game.map;
    let b = this.banners.find((q) => !q.active);
    if (!b) {
      const sprite = new Sprite(this.bannerTex);
      sprite.anchor.set(24 / 64, 94 / 96);
      const ring = new Sprite(this.game.tex.wring);
      ring.anchor.set(0.5);
      ring.tint = 0xbfe0ff;
      this.game.layers.actors.addChild(sprite);
      this.ground.addChild(ring);
      b = { sprite, ring, x: 0, z: 0, t: 0, life: 1, fading: 0, active: false };
      this.banners.push(b);
    }
    b.x = x;
    b.z = z;
    b.t = 0;
    b.life = ITEMS.cloudguard.seconds;
    b.fading = 0;
    b.active = true;
    b.sprite.visible = b.ring.visible = true;
    const px = m.pxX(x);
    const py = m.pxY(z);
    b.sprite.position.set(px, py);
    b.sprite.zIndex = py - 0.5;
    b.ring.position.set(px, py);
    this.game.fx.spawn('wring', px, py, 1.4 * this.ppu, 0, 0, 0.6, GOLD);
    this.game.fx.puffs(px, py - 6, Math.max(2, Math.round(6 * this.density)), 0.8 * this.ppu, 0xeef6ff);
  }

  /** Hearts float from the castle up to the lives counter. */
  private hearts(): void {
    this.counts.hearts++;
    const to = this.counter('lives');
    const c = this.castlePx();
    const m = this.game.map;
    this.fly(this.heartTex, { x: m.screenX(c.x), y: m.screenY(c.y) }, to, flyCount(ITEMS.heartstone.lives, this.density, this.reduced), HEART);
  }

  /** Coins spill from mid-screen into the gold counter. */
  private coins(): void {
    this.counts.coins++;
    const to = this.counter('gold');
    const w = this.game.app.screen.width;
    const h = this.game.app.screen.height;
    this.fly(this.coinTex, { x: w / 2, y: h * 0.55 }, to, flyCount(8, this.density, this.reduced), GOLD);
  }

  private counter(which: 'lives' | 'gold'): { x: number; y: number } {
    const r = this.game.hud.rects();
    const box = r[which] && r[which].w > 0 ? r[which] : r.plaque;
    return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  }

  private fly(tex: Texture, from: { x: number; y: number }, to: { x: number; y: number }, n: number, glow: number): void {
    const size = Math.max(22, Math.min(34, this.game.app.screen.height * 0.035));
    if (n === 0) {
      // Reduced motion: one soft glow and a still icon at the counter, fading.
      const d = this.decal(tex, this.screen);
      d.sprite.position.set(to.x, to.y);
      d.sprite.scale.set((size * 1.3) / tex.width);
      d.sprite.tint = 0xffffff;
      d.sprite.blendMode = 'normal';
      d.alpha = 1;
      d.pulse = 0;
      d.life = 0.8;
      const g = this.decal(this.game.tex.orb, this.screen);
      g.sprite.position.set(to.x, to.y);
      g.sprite.scale.set((size * 3) / 64);
      g.sprite.tint = glow;
      g.sprite.blendMode = 'add';
      g.alpha = 0.6;
      g.pulse = 0;
      g.life = 0.8;
      return;
    }
    for (let i = 0; i < n; i++) {
      let f = this.flyers.find((q) => !q.active);
      if (!f) {
        if (this.flyers.length >= MAX_FLYERS) return;
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5);
        this.screen.addChild(sprite);
        f = { sprite, ax: 0, ay: 0, bx: 0, by: 0, lift: 0, delay: 0, t: 0, life: 1, size, active: false };
        this.flyers.push(f);
      }
      const spread = (i - (n - 1) / 2) * size * 0.7;
      f.sprite.texture = tex;
      f.ax = from.x + spread;
      f.ay = from.y + Math.abs(spread) * 0.2;
      f.bx = to.x;
      f.by = to.y;
      f.lift = 60 + (i % 3) * 22;
      f.delay = i * 0.09;
      f.t = 0;
      f.life = 0.9 + (i % 2) * 0.12;
      f.size = size;
      f.active = true;
      f.sprite.visible = false;
    }
  }

  private decal(tex: Texture, parent: Container): Decal {
    let d = this.decals.find((q) => !q.active && q.sprite.parent === parent);
    if (!d) {
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      parent.addChild(sprite);
      d = { sprite, t: 0, life: 1, alpha: 1, pulse: 0, active: false };
      this.decals.push(d);
    }
    d.sprite.texture = tex;
    d.sprite.visible = true;
    d.t = 0;
    d.active = true;
    return d;
  }

  // --- per frame -----------------------------------------------------------------------------

  frame(dt: number): void {
    if (this.game.events !== this.bound) this.bind();
    const paused = this.game.stepper.paused;
    const simDt = paused ? 0 : dt * this.game.stepper.speed;
    this.clock += dt;
    // Flying hearts / coins run on real time (they are HUD feedback), the rest on sim time.
    for (const f of this.flyers) {
      if (!f.active) continue;
      f.t += dt;
      const k = (f.t - f.delay) / f.life;
      if (k < 0) continue;
      if (k >= 1) {
        f.active = false;
        f.sprite.visible = false;
        continue;
      }
      const ease = 1 - (1 - k) * (1 - k);
      const p = arcPoint({ x: f.ax, y: f.ay }, { x: f.bx, y: f.by }, f.lift, ease);
      f.sprite.visible = true;
      f.sprite.position.set(p.x, p.y);
      const s = (f.size / f.sprite.texture.width) * (k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1.1 - k * 0.35);
      f.sprite.scale.set(s);
      f.sprite.alpha = k > 0.85 ? (1 - k) / 0.15 : 1;
    }
    for (const d of this.decals) {
      if (!d.active) continue;
      d.t += d.sprite.parent === this.screen ? dt : simDt;
      const k = d.t / d.life;
      if (k >= 1) {
        d.active = false;
        d.sprite.visible = false;
        continue;
      }
      d.sprite.alpha = d.alpha * (k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1);
    }
    for (const s of this.streaks) {
      if (!s.active) continue;
      s.t += simDt > 0 ? simDt : dt * 0.25;
      const k = s.t / s.life;
      if (k >= 1) {
        s.active = false;
        s.g.visible = false;
        continue;
      }
      s.g.alpha = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
    }
    this.syncBanners(dt, simDt);
  }

  private syncBanners(dt: number, simDt: number): void {
    const squads = this.game.world.soldierSystem.barracks;
    const ppu = this.ppu;
    const reduced = this.reduced;
    for (const b of this.banners) {
      if (!b.active) continue;
      b.t += simDt;
      // The squad is gone (time up, or all guards fell): the standard fades.
      const held = squads.some((q) => q.towerId < 0 && Math.abs(q.rallyX - b.x) < 0.3 && Math.abs(q.rallyZ - b.z) < 0.3);
      if ((!held && b.t > 0.2) || b.t >= b.life) b.fading += Math.max(simDt, dt * 0.5);
      const fade = Math.max(0, 1 - b.fading / 0.4);
      if (fade <= 0) {
        b.active = false;
        b.sprite.visible = b.ring.visible = false;
        continue;
      }
      const rise = reduced ? 1 : Math.min(1, b.t / RISE);
      const pop = rise < 1 ? rise * (1 + Math.sin(rise * Math.PI) * 0.25) : 1;
      const base = (1.5 * ppu) / 96;
      b.sprite.scale.set(base, base * pop);
      b.sprite.skew.x = reduced ? 0 : Math.sin(this.clock * 2.4 + b.x) * 0.05;
      b.sprite.alpha = fade;
      // The ground ring runs down with the banner's time.
      const left = Math.max(0, 1 - b.t / b.life);
      const r = 1.1 * ppu;
      b.ring.scale.set((r * 2) / 128, (r * 2 * 0.9) / 128);
      b.ring.alpha = 0.35 + 0.4 * left * fade;
    }
  }

  clear(): void {
    this.hideAim();
    for (const f of this.flyers) {
      f.active = false;
      f.sprite.visible = false;
    }
    for (const d of this.decals) {
      d.active = false;
      d.sprite.visible = false;
    }
    for (const s of this.streaks) {
      s.active = false;
      s.g.visible = false;
    }
    for (const b of this.banners) {
      b.active = false;
      b.sprite.visible = b.ring.visible = false;
    }
  }

  debug(): Record<string, unknown> {
    return {
      aiming: this.aimFor,
      aim: this.aimRing.visible || this.aimBanner.visible ? { x: Math.round(this.aimRing.x), y: Math.round(this.aimRing.y), banner: this.aimBanner.visible } : null,
      flyers: this.flyers.filter((f) => f.active).length,
      decals: this.decals.filter((d) => d.active).length,
      streaks: this.streaks.filter((s) => s.active).length,
      banners: this.banners.filter((b) => b.active).length,
      counts: { ...this.counts },
    };
  }
}
