import { Container, Sprite, Texture } from 'pixi.js';
import { fxPrefsNow, type FxLayer } from './fxLayer.ts';
import type { WorldLayers } from './layers.ts';
import type { MapView } from './mapView.ts';
import type { ProcTextures } from './procTextures.ts';

/**
 * Map-space visuals of the global abilities (all in map px inside the world container, so they
 * follow the fit and the screen shake):
 *  - aiming: Meteor's area circle under the pointer; Overcharge's glow under every tower,
 *  - Meteor: a warning ring on the ground, the meteor streaking in over the sim's impact delay,
 *    then flash, shock rings, rock shards, smoke, embers and a scorch that fades,
 *  - Overcharge: a burst on every tower, then a pulsing aura under each one while it lasts.
 * The screen shake on impact is game2d.ts's (`meteorImpact` → `triggerShake2D`), so it follows
 * the Screen shake / Reduced motion settings. Flashes go through FxLayer, which shrinks big ones
 * under Reduced motion. Everything is procedural until the painted pieces land; `setArt` swaps
 * them in (manifest `abilities.*`, see ABILITY_ART_KEYS).
 */

/** Manifest keys (under `abilities`) this module and the ability bar read when present. */
export const ABILITY_ART_KEYS = ['meteorIcon', 'overchargeIcon', 'meteorRock', 'meteorCrater', 'overchargeAura', 'targetRing'] as const;
export type AbilityArtKey = (typeof ABILITY_ART_KEYS)[number];

export interface AbilityArt {
  /** The falling meteor, head at the bottom-left, tail up-right (drawn along the fall). */
  readonly meteorRock?: Texture;
  /** Ground scorch left by the impact (top-down blob, transparent edges). */
  readonly meteorCrater?: Texture;
  /** Ground ring glowing under an overcharged tower (top-down, tinted nothing). */
  readonly overchargeAura?: Texture;
  /** Meteor's aiming circle (top-down ring, transparent middle). */
  readonly targetRing?: Texture;
}

export interface AbilityFxDeps {
  readonly map: MapView;
  readonly layers: WorldLayers;
  readonly tex: ProcTextures;
  readonly fx: FxLayer;
  /** Map-px box of a tower's drawn body, or null (TowerLayer.spriteRect). */
  towerBox(id: number): { x: number; y: number; w: number; h: number } | null;
}

export interface FxTower {
  readonly id: number;
  readonly x: number;
  readonly z: number;
}

const EMBER = 0xff9a3a;
const FIRE = 0xffc25a;
const SURGE = 0x8fe9ff;
const SURGE_GOLD = 0xffe07a;

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

/** Procedural meteor: a glowing rock at the bottom-left with a flame tail streaming up-right. */
function proceduralRock(): Texture {
  return canvasTexture(160, 160, (ctx) => {
    ctx.save();
    ctx.translate(48, 112);
    ctx.rotate(-Math.PI / 4);
    const tail = ctx.createLinearGradient(0, 0, 0, -150);
    tail.addColorStop(0, 'rgba(255,214,120,0.95)');
    tail.addColorStop(0.35, 'rgba(255,128,40,0.7)');
    tail.addColorStop(1, 'rgba(160,40,10,0)');
    ctx.fillStyle = tail;
    ctx.beginPath();
    ctx.moveTo(-26, 0);
    ctx.quadraticCurveTo(-18, -90, 0, -150);
    ctx.quadraticCurveTo(18, -90, 26, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    const glow = ctx.createRadialGradient(48, 112, 4, 48, 112, 44);
    glow.addColorStop(0, 'rgba(255,240,190,0.9)');
    glow.addColorStop(0.5, 'rgba(255,140,40,0.45)');
    glow.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 60, 100, 100);
    // Lumpy rock with a dark painted outline and a hot rim.
    ctx.beginPath();
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 20 + ((i * 7) % 5) * 1.6;
      const x = 48 + Math.cos(a) * r;
      const y = 112 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const rock = ctx.createRadialGradient(54, 106, 2, 48, 112, 24);
    rock.addColorStop(0, '#ffcf6a');
    rock.addColorStop(0.35, '#c4561c');
    rock.addColorStop(1, '#4a2410');
    ctx.fillStyle = rock;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#2a1408';
    ctx.stroke();
  });
}

/** Procedural aiming ring: a warm painted rim with tick marks, transparent middle. */
function proceduralTargetRing(): Texture {
  return canvasTexture(256, 256, (ctx) => {
    const c = 128;
    const fill = ctx.createRadialGradient(c, c, 60, c, c, 124);
    fill.addColorStop(0, 'rgba(255,150,60,0.04)');
    fill.addColorStop(0.85, 'rgba(255,120,40,0.22)');
    fill.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(c, c, 124, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(58,36,18,0.75)';
    ctx.beginPath();
    ctx.arc(c, c, 116, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,214,120,0.95)';
    ctx.beginPath();
    ctx.arc(c, c, 116, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 5;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * 96, c + Math.sin(a) * 96);
      ctx.lineTo(c + Math.cos(a) * 112, c + Math.sin(a) * 112);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(c, c, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,214,120,0.9)';
    ctx.fill();
  });
}

interface Fall {
  readonly rock: Sprite;
  readonly warn: Sprite;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
  t: number;
  life: number;
  ember: number;
  active: boolean;
}

interface Scorch {
  readonly sprite: Sprite;
  t: number;
  life: number;
  active: boolean;
}

interface Aura {
  readonly root: Container;
  readonly ring: Sprite;
  readonly glow: Sprite;
  spark: number;
  seen: boolean;
}

export class AbilityFx {
  private readonly deps: AbilityFxDeps;
  private readonly ground = new Container();
  private readonly top = new Container();
  private readonly aim: Sprite;
  private readonly aimCore: Sprite;
  private readonly highlights: Sprite[] = [];
  /** A gold ring over each highlight glow (index-matched). */
  private readonly hiRings: Sprite[] = [];
  private readonly falls: Fall[] = [];
  private readonly scorches: Scorch[] = [];
  private readonly auras = new Map<number, Aura>();
  private rockTex: Texture;
  private craterTex: Texture;
  private auraTex: Texture;
  private time = 0;
  private aimRadius = 1;
  /** QA counters. */
  readonly counts = { meteors: 0, impacts: 0, surges: 0 };

  constructor(deps: AbilityFxDeps) {
    this.deps = deps;
    this.rockTex = proceduralRock();
    this.craterTex = deps.tex.crater;
    this.auraTex = deps.tex.wring;
    this.aim = new Sprite(proceduralTargetRing());
    this.aim.anchor.set(0.5);
    this.aim.visible = false;
    this.aimCore = new Sprite(deps.tex.orb);
    this.aimCore.anchor.set(0.5);
    this.aimCore.tint = 0xff7a2a;
    this.aimCore.blendMode = 'add';
    this.aimCore.visible = false;
    this.ground.addChild(this.aimCore, this.aim);
    deps.layers.groundFx.addChild(this.ground);
    deps.layers.fx.addChild(this.top);
  }

  /** Painted pieces (manifest `abilities.*`) replace the procedural stand-ins as they arrive. */
  setArt(art: AbilityArt): void {
    if (art.meteorRock) {
      this.rockTex = art.meteorRock;
      for (const f of this.falls) f.rock.texture = art.meteorRock;
    }
    if (art.meteorCrater) this.craterTex = art.meteorCrater;
    if (art.overchargeAura) {
      this.auraTex = art.overchargeAura;
      for (const a of this.auras.values()) {
        a.ring.texture = art.overchargeAura;
        a.ring.blendMode = 'normal';
        a.ring.tint = 0xffffff;
      }
    }
    if (art.targetRing) this.aim.texture = art.targetRing;
  }

  private get ppu(): number {
    return this.deps.map.layout.pxPerUnit;
  }

  // --- aiming --------------------------------------------------------------------------------

  /** Meteor aim circle at a ground point (world units); `valid` = inside the island. */
  showMeteorAim(x: number, z: number, radius: number, valid: boolean): void {
    const m = this.deps.map;
    this.aimRadius = radius * this.ppu;
    this.aim.position.set(m.pxX(x), m.pxY(z));
    this.aimCore.position.copyFrom(this.aim.position);
    this.aim.visible = true;
    this.aimCore.visible = valid;
    this.aim.tint = valid ? 0xffffff : 0x9a8a80;
  }

  hideAim(): void {
    this.aim.visible = false;
    this.aimCore.visible = false;
  }

  /** Overcharge aim: a glow under every tower, the one under the pointer (`hoverId`) brighter. */
  showTowerHighlights(towers: readonly FxTower[], hoverId: number): void {
    const m = this.deps.map;
    for (let i = 0; i < towers.length; i++) {
      let s = this.highlights[i];
      if (!s) {
        s = new Sprite(this.deps.tex.orb);
        s.anchor.set(0.5);
        s.blendMode = 'add';
        const ring = new Sprite(this.deps.tex.wring);
        ring.anchor.set(0.5);
        this.ground.addChild(s, ring);
        this.highlights[i] = s;
        this.hiRings[i] = ring;
      }
      const t = towers[i];
      const ring = this.hiRings[i];
      s.position.set(m.pxX(t.x), m.pxY(t.z));
      ring.position.copyFrom(s.position);
      s.visible = ring.visible = true;
      s.tint = t.id === hoverId ? SURGE_GOLD : SURGE;
      ring.tint = t.id === hoverId ? 0xfff2b0 : SURGE_GOLD;
      s.label = t.id === hoverId ? 'hover' : '';
    }
    for (let i = towers.length; i < this.highlights.length; i++) this.highlights[i].visible = this.hiRings[i].visible = false;
  }

  hideHighlights(): void {
    for (const s of this.highlights) s.visible = false;
    for (const s of this.hiRings) s.visible = false;
  }

  // --- casts ---------------------------------------------------------------------------------

  /** `abilityTargeted` (meteor): warning ring + the meteor coming in over `delay` sim seconds. */
  meteorCast(x: number, z: number, radius: number, delay: number): void {
    const m = this.deps.map;
    let f = this.falls.find((q) => !q.active);
    if (!f) {
      const rock = new Sprite(this.rockTex);
      rock.anchor.set(0.3, 0.7);
      const warn = new Sprite(this.deps.tex.wring);
      warn.anchor.set(0.5);
      warn.tint = 0xff6a2a;
      this.ground.addChild(warn);
      this.top.addChild(rock);
      f = { rock, warn, x0: 0, y0: 0, x1: 0, y1: 0, r: 1, t: 0, life: 0.3, ember: 0, active: false };
      this.falls.push(f);
    }
    f.x1 = m.pxX(x);
    f.y1 = m.pxY(z);
    f.r = radius * this.ppu;
    // Comes in from high up-right, steeply, so it reads as falling onto the painted ground.
    // A target near the top edge gets a flatter run in, so the meteor never starts off the map.
    const reach = Math.max(220, f.r * 3);
    const up = Math.min(reach * 1.25, Math.max(60, f.y1 - 20));
    f.x0 = f.x1 + Math.max(reach * 0.55, (reach * 1.25 - up) * 0.9);
    f.y0 = f.y1 - up;
    f.t = 0;
    f.life = Math.max(0.12, delay);
    f.ember = 0;
    f.active = true;
    f.rock.visible = true;
    f.warn.visible = true;
    f.rock.texture = this.rockTex;
    const size = Math.max(130, f.r * 1.6);
    f.rock.scale.set(size / Math.max(1, this.rockTex.width));
    this.counts.meteors++;
    this.placeFall(f);
  }

  /** `meteorImpact`: flash, shock rings, shards, smoke, embers, and a scorch that fades. */
  meteorImpact(x: number, z: number, radius: number): void {
    const m = this.deps.map;
    const fx = this.deps.fx;
    const px = m.pxX(x);
    const py = m.pxY(z);
    const r = radius * this.ppu;
    this.counts.impacts++;
    fx.spawn('flash', px, py - r * 0.15, r * 0.75, 0, 0, 0.28, 0xffd890);
    fx.spawn('glow', px, py, r * 0.7, 0, 0, 0.55, 0xff7a2a);
    fx.spawn('wring', px, py, r * 1.05, 0, 0, 0.5, FIRE);
    fx.spawn('ring', px, py, r * 0.7, 0, 0, 0.42, 0xfff0c0);
    fx.burst('shard', px, py - 6, 12, 20, r * 1.6, 0.8, 0x6a4024, 520);
    fx.burst('spark', px, py - 10, 16, 12, r * 2.2, 0.6, EMBER, 180);
    fx.puffs(px, py, 14, r * 0.7, 0x8a7360);
    let s = this.scorches.find((q) => !q.active);
    if (!s) {
      const sprite = new Sprite(this.craterTex);
      sprite.anchor.set(0.5);
      this.ground.addChildAt(sprite, 0);
      s = { sprite, t: 0, life: 2.6, active: false };
      this.scorches.push(s);
    }
    s.sprite.texture = this.craterTex;
    s.sprite.position.set(px, py);
    const w = (r * 1.15) / Math.max(1, this.craterTex.width);
    s.sprite.scale.set(w, w * 0.62);
    s.sprite.visible = true;
    s.sprite.alpha = 0.6;
    s.t = 0;
    s.active = true;
  }

  /** `overchargeActivated`: a burst on every tower (the tapped one gets the biggest). */
  overchargeCast(towers: readonly FxTower[], originId: number): void {
    const m = this.deps.map;
    const fx = this.deps.fx;
    this.counts.surges++;
    for (const t of towers) {
      const px = m.pxX(t.x);
      const py = m.pxY(t.z);
      const box = this.deps.towerBox(t.id);
      const top = box ? box.y + box.h * 0.35 : py - 60;
      const big = t.id === originId ? 1.5 : 1;
      fx.spawn('wring', px, py, 70 * big, 0, 0, 0.55, SURGE);
      fx.spawn('flash', px, top, 46 * big, 0, 0, 0.25, SURGE_GOLD);
      fx.burst('spark', px, top, 8, 10, 120 * big, 0.5, SURGE, -40);
    }
  }

  // --- per frame -----------------------------------------------------------------------------

  /**
   * `realDt` drives the aim pulse; `simDt` (0 while paused) the casts. `surgeLeft` = seconds of
   * Overcharge left (0 = none); `towers` = the built towers (auras follow them).
   */
  update(realDt: number, simDt: number, surgeLeft: number, towers: readonly FxTower[]): void {
    this.time += realDt;
    if (this.aim.visible) {
      const pulse = 1 + Math.sin(this.time * 6) * 0.03;
      this.aim.scale.set((this.aimRadius * 2 * pulse) / Math.max(1, this.aim.texture.width));
      this.aim.rotation = this.time * 0.4;
      this.aimCore.scale.set((this.aimRadius * 1.4) / Math.max(1, this.aimCore.texture.width));
      this.aimCore.alpha = 0.22 + Math.sin(this.time * 6) * 0.06;
    }
    for (let i = 0; i < this.highlights.length; i++) {
      const s = this.highlights[i];
      if (!s.visible) continue;
      const hover = s.label === 'hover';
      const size = (hover ? 170 : 140) * (1 + Math.sin(this.time * 5 + i) * 0.06);
      s.scale.set(size / Math.max(1, s.texture.width), (size * 0.55) / Math.max(1, s.texture.width));
      s.alpha = hover ? 1 : 0.85;
      const ring = this.hiRings[i];
      const rs = (size * 0.82) / Math.max(1, ring.texture.width);
      ring.scale.set(rs, rs * 0.55);
      ring.alpha = hover ? 1 : 0.55 + Math.sin(this.time * 5 + i) * 0.2;
    }
    for (const f of this.falls) {
      if (!f.active) continue;
      f.t += simDt;
      if (f.t >= f.life) {
        f.active = false;
        f.rock.visible = false;
        f.warn.visible = false;
        continue;
      }
      if (simDt > 0) {
        f.ember -= simDt;
        if (f.ember <= 0) {
          f.ember = 0.03 / Math.max(0.3, fxPrefsNow().density);
          const fx = this.deps.fx;
          fx.spawn('spark', f.rock.x + (fx.random() - 0.5) * 16, f.rock.y + (fx.random() - 0.5) * 16, 10 + fx.random() * 8, 40, -60, 0.35, EMBER);
          fx.spawn('puff', f.rock.x, f.rock.y, 14 + fx.random() * 10, 20, -30, 0.5, 0x7a6658);
        }
      }
      this.placeFall(f);
    }
    for (const s of this.scorches) {
      if (!s.active) continue;
      s.t += simDt;
      if (s.t >= s.life) {
        s.active = false;
        s.sprite.visible = false;
        continue;
      }
      const k = s.t / s.life;
      s.sprite.alpha = 0.6 * (k < 0.6 ? 1 : (1 - k) / 0.4);
    }
    this.syncAuras(surgeLeft, towers, simDt);
  }

  private placeFall(f: Fall): void {
    const k = Math.min(1, f.t / f.life);
    const e = k * (0.55 + 0.45 * k); // visible from the first frame, speeding up into the ground
    f.rock.position.set(f.x0 + (f.x1 - f.x0) * e, f.y0 + (f.y1 - f.y0) * e);
    f.rock.alpha = Math.min(1, k * 4 + 0.2);
    const ws = (f.r * 2 * (1.25 - 0.25 * k)) / Math.max(1, f.warn.texture.width);
    f.warn.scale.set(ws, ws * 0.62);
    f.warn.position.set(f.x1, f.y1);
    f.warn.alpha = 0.35 + 0.55 * k;
  }

  private syncAuras(surgeLeft: number, towers: readonly FxTower[], simDt: number): void {
    if (surgeLeft <= 0) {
      if (this.auras.size > 0) for (const a of this.auras.values()) a.root.visible = false;
      return;
    }
    const m = this.deps.map;
    for (const a of this.auras.values()) a.seen = false;
    const fade = Math.min(1, surgeLeft / 0.6);
    for (const t of towers) {
      let a = this.auras.get(t.id);
      if (!a) {
        const root = new Container();
        const glow = new Sprite(this.deps.tex.orb);
        glow.anchor.set(0.5);
        glow.blendMode = 'add';
        glow.tint = SURGE;
        const ring = new Sprite(this.auraTex);
        ring.anchor.set(0.5);
        // The procedural white ring glows (additive, tinted); painted art is drawn as painted.
        const painted = this.auraTex !== this.deps.tex.wring;
        ring.blendMode = painted ? 'normal' : 'add';
        ring.tint = painted ? 0xffffff : SURGE_GOLD;
        root.addChild(glow, ring);
        this.ground.addChild(root);
        a = { root, ring, glow, spark: 0, seen: true };
        this.auras.set(t.id, a);
      }
      a.seen = true;
      a.root.visible = true;
      const px = m.pxX(t.x);
      const py = m.pxY(t.z);
      a.root.position.set(px, py);
      const pulse = 1 + Math.sin(this.time * 7 + t.id) * 0.08;
      const rw = (120 * pulse) / Math.max(1, a.ring.texture.width);
      a.ring.scale.set(rw, rw * 0.55);
      a.ring.rotation = 0;
      a.ring.alpha = 0.85 * fade;
      const gw = 150 / Math.max(1, a.glow.texture.width);
      a.glow.scale.set(gw, gw * 0.6);
      a.glow.alpha = (0.45 + Math.sin(this.time * 9 + t.id) * 0.12) * fade;
      if (simDt > 0) {
        a.spark -= simDt;
        if (a.spark <= 0) {
          a.spark = 0.16 / Math.max(0.3, fxPrefsNow().density);
          const box = this.deps.towerBox(t.id);
          const fx = this.deps.fx;
          const w = box ? box.w * 0.8 : 50;
          const sx = px + (fx.random() - 0.5) * w;
          const sy = (box ? box.y + box.h * (0.3 + fx.random() * 0.6) : py - 40) as number;
          fx.spawn('spark', sx, sy, 9 + fx.random() * 6, 0, -70 - fx.random() * 40, 0.5, fx.random() < 0.5 ? SURGE : SURGE_GOLD);
        }
      }
    }
    for (const [id, a] of this.auras) {
      if (a.seen) continue;
      a.root.destroy({ children: true });
      this.auras.delete(id);
    }
  }

  /** New run: nothing in flight. */
  clear(): void {
    this.hideAim();
    this.hideHighlights();
    for (const f of this.falls) {
      f.active = false;
      f.rock.visible = false;
      f.warn.visible = false;
    }
    for (const s of this.scorches) {
      s.active = false;
      s.sprite.visible = false;
    }
    for (const a of this.auras.values()) a.root.destroy({ children: true });
    this.auras.clear();
  }

  /** QA snapshot. */
  debug(): Record<string, unknown> {
    return {
      ...this.counts,
      aim: this.aim.visible,
      highlights: this.highlights.filter((s) => s.visible).length,
      falling: this.falls.filter((f) => f.active).length,
      scorches: this.scorches.filter((s) => s.active).length,
      auras: [...this.auras.values()].filter((a) => a.root.visible).length,
    };
  }
}
