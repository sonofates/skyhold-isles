import { Sprite, Texture } from 'pixi.js';
import type { EventBus } from '../core/eventBus.ts';
import { SOLDIER_RULES } from '../data/soldiers.ts';
import type { BarracksState, SoldierEntity, SoldierSystem } from '../sim/soldierSystem.ts';
import type { EnemyArtRuntime, LoadedArt, TowerArtRuntime } from './assets2d.ts';
import type { FxLayer } from './fxLayer.ts';
import { HEIGHT_TO_SCREEN, type WorldLayers } from './layers.ts';
import type { CheapWalkSpec, TowerArt } from './manifest.ts';
import type { MapView } from './mapView.ts';
import type { ProcTextures } from './procTextures.ts';
import { cheapWalk, createAnimState, createPose, sheetSequence, sheetWalk, type AnimState, type WalkPose } from './walkAnim.ts';

/**
 * Barracks soldiers in the 2D renderer: walking soldiers (procedural "cheap" walk, or a walk
 * sheet once one exists), melee lunges with slash FX, small friendly HP bars, falls on death, and
 * one rally flag per barracks.
 *
 * Art comes from public/art2d/manifest.json when present, with painted-look procedural
 * placeholders until then (nothing else needs to change when the files land):
 *   towers.barracks  { "tiers": ["tower-barracks.png", "tower-barracks-t2.png", "tower-barracks-t3.png"], ... }
 *   enemies.soldier  { "file": "unit-soldier.png", "mode": "sheet",
 *                      "sheet": { "down": "anim/soldier-front.json", "up": "anim/soldier-back.json", "facing": "right" }, ... }
 * (`enemies.soldier` needs no enemyMap entry.) `withBarracksArt` fills the gaps and puts the
 * barracks in the build ring when the manifest does not list it.
 */

const SOLDIER_HEIGHT = 1.3;
const SOLDIER_SHADOW = 0.38;
const SOLDIER_CHEAP: CheapWalkSpec = { bob: 0.06, squash: 0.05, lean: 0.12, stride: 0.75, rock: 0.07 };
const BAR_W = 28;
const BAR_H = 4;
const HP_FRIEND = 0x6cc8ff;
const HP_BG = 0x3a2412;
const MAX_SLASHES = 24;
const MAX_FALLEN = 12;

// ---------------------------------------------------------------------------------------------
// Procedural placeholder art (drawn once on a canvas; same outline weight / palette as the kit).

const INK = '#2a1a10';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return [c, ctx];
}

function blob(ctx: CanvasRenderingContext2D, fill: string | CanvasGradient, line = 5, draw: () => void): void {
  ctx.beginPath();
  draw();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/** Soldier facing right, feet on y = 150 of a 128x160 canvas. `step`: -1 / 0 / +1 leg pose. */
function drawSoldier(step: number): HTMLCanvasElement {
  const [c, ctx] = canvas(128, 160);
  const lx = step * 9;
  // Spear behind the body.
  ctx.lineWidth = 9;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(84, 128);
  ctx.lineTo(102, 14);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#a8743c';
  ctx.beginPath();
  ctx.moveTo(84, 128);
  ctx.lineTo(102, 14);
  ctx.stroke();
  blob(ctx, '#e8edf2', 4, () => {
    ctx.moveTo(103, 2);
    ctx.lineTo(110, 22);
    ctx.lineTo(96, 20);
    ctx.closePath();
  });
  // Legs + boots.
  blob(ctx, '#5a3a22', 5, () => ctx.roundRect(46 - lx, 112, 15, 36, 6));
  blob(ctx, '#5a3a22', 5, () => ctx.roundRect(66 + lx, 112, 15, 36, 6));
  blob(ctx, '#3a2414', 4, () => ctx.roundRect(42 - lx, 140, 22, 11, 5));
  blob(ctx, '#3a2414', 4, () => ctx.roundRect(64 + lx, 140, 22, 11, 5));
  // Tunic.
  const tunic = ctx.createLinearGradient(40, 60, 90, 120);
  tunic.addColorStop(0, '#5b8ef0');
  tunic.addColorStop(1, '#2f57b0');
  blob(ctx, tunic, 5, () => {
    ctx.moveTo(42, 70);
    ctx.quadraticCurveTo(64, 56, 88, 70);
    ctx.lineTo(92, 120);
    ctx.quadraticCurveTo(64, 128, 36, 120);
    ctx.closePath();
  });
  blob(ctx, '#f2c14e', 3, () => ctx.roundRect(38, 100, 54, 8, 3));
  // Arm holding the spear.
  blob(ctx, '#f0c9a0', 4, () => ctx.ellipse(86, 96, 8, 8, 0, 0, Math.PI * 2));
  // Head + helmet + plume.
  blob(ctx, '#f0c9a0', 5, () => ctx.ellipse(64, 50, 17, 17, 0, 0, Math.PI * 2));
  blob(ctx, '#d64a3a', 4, () => {
    ctx.moveTo(56, 24);
    ctx.quadraticCurveTo(70, 6, 86, 18);
    ctx.quadraticCurveTo(72, 18, 66, 30);
    ctx.closePath();
  });
  const steel = ctx.createLinearGradient(44, 26, 84, 52);
  steel.addColorStop(0, '#eef2f6');
  steel.addColorStop(1, '#8e9aa8');
  blob(ctx, steel, 5, () => {
    ctx.moveTo(44, 50);
    ctx.quadraticCurveTo(46, 24, 64, 24);
    ctx.quadraticCurveTo(84, 24, 84, 50);
    ctx.lineTo(76, 46);
    ctx.lineTo(50, 46);
    ctx.closePath();
  });
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(71, 54, 2.6, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Round shield in front.
  const wood = ctx.createRadialGradient(44, 88, 4, 48, 92, 26);
  wood.addColorStop(0, '#d9a25a');
  wood.addColorStop(1, '#8f5a2c');
  blob(ctx, wood, 5, () => ctx.ellipse(46, 92, 22, 24, 0, 0, Math.PI * 2));
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#f2c14e';
  ctx.beginPath();
  ctx.ellipse(46, 92, 16, 18, 0, 0, Math.PI * 2);
  ctx.stroke();
  blob(ctx, '#fff4dc', 3, () => {
    ctx.moveTo(46, 80);
    ctx.lineTo(54, 92);
    ctx.lineTo(46, 104);
    ctx.lineTo(38, 92);
    ctx.closePath();
  });
  return c;
}

/** Rally flag: pole foot at (12, 92) of a 64x96 canvas. */
function drawFlag(): HTMLCanvasElement {
  const [c, ctx] = canvas(64, 96);
  blob(ctx, '#8f5a2c', 4, () => ctx.roundRect(9, 6, 7, 86, 3));
  blob(ctx, '#f2c14e', 3, () => ctx.ellipse(12.5, 6, 6, 6, 0, 0, Math.PI * 2));
  const cloth = ctx.createLinearGradient(16, 10, 60, 40);
  cloth.addColorStop(0, '#5b8ef0');
  cloth.addColorStop(1, '#2f57b0');
  blob(ctx, cloth, 4, () => {
    ctx.moveTo(16, 12);
    ctx.quadraticCurveTo(38, 6, 60, 16);
    ctx.lineTo(48, 28);
    ctx.lineTo(60, 42);
    ctx.quadraticCurveTo(38, 34, 16, 42);
    ctx.closePath();
  });
  blob(ctx, '#f2c14e', 3, () => {
    ctx.moveTo(30, 18);
    ctx.lineTo(36, 27);
    ctx.lineTo(30, 36);
    ctx.lineTo(24, 27);
    ctx.closePath();
  });
  blob(ctx, 'rgba(58,36,18,0.35)', 0.01, () => ctx.ellipse(12.5, 92, 10, 3.5, 0, 0, Math.PI * 2));
  return c;
}

/** Barracks placeholder per tier, base centre at (128, 236) of a 256x256 canvas. */
function drawBarracks(tier: number): HTMLCanvasElement {
  const [c, ctx] = canvas(256, 256);
  // Stone plinth.
  const stone = ctx.createLinearGradient(40, 196, 216, 246);
  stone.addColorStop(0, '#c9bfae');
  stone.addColorStop(1, '#857a6a');
  blob(ctx, stone, 6, () => ctx.ellipse(128, 222, 92, 26, 0, 0, Math.PI * 2));
  // Walls.
  const wallTop = tier >= 3 ? 104 : 118;
  const wall = ctx.createLinearGradient(56, wallTop, 200, 220);
  if (tier >= 3) {
    wall.addColorStop(0, '#d8d0c2');
    wall.addColorStop(1, '#998e7c');
  } else {
    wall.addColorStop(0, '#e4c38c');
    wall.addColorStop(1, '#a87a44');
  }
  blob(ctx, wall, 6, () => ctx.roundRect(58, wallTop, 140, 226 - wallTop, 8));
  if (tier < 3) {
    // Timber frame.
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#6b4424';
    ctx.beginPath();
    ctx.moveTo(58, wallTop + 30);
    ctx.lineTo(198, wallTop + 30);
    ctx.moveTo(92, wallTop);
    ctx.lineTo(92, 222);
    ctx.moveTo(164, wallTop);
    ctx.lineTo(164, 222);
    ctx.stroke();
  } else {
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(42,26,16,0.45)';
    for (let y = wallTop + 22; y < 220; y += 22) {
      ctx.beginPath();
      ctx.moveTo(60, y);
      ctx.lineTo(196, y);
      ctx.stroke();
    }
  }
  // Door.
  blob(ctx, '#5a3a22', 5, () => {
    ctx.moveTo(108, 224);
    ctx.lineTo(108, 182);
    ctx.quadraticCurveTo(128, 162, 148, 182);
    ctx.lineTo(148, 224);
    ctx.closePath();
  });
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.ellipse(141, 202, 3, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  // Roof.
  const roofCol = tier === 1 ? ['#e8c25e', '#b0842c'] : tier === 2 ? ['#e0664e', '#9a3426'] : ['#5b8ef0', '#2f57b0'];
  const roof = ctx.createLinearGradient(40, 40, 216, wallTop + 10);
  roof.addColorStop(0, roofCol[0]);
  roof.addColorStop(1, roofCol[1]);
  const peak = tier >= 3 ? 34 : 50;
  blob(ctx, roof, 6, () => {
    ctx.moveTo(40, wallTop + 10);
    ctx.lineTo(128, peak);
    ctx.lineTo(216, wallTop + 10);
    ctx.closePath();
  });
  if (tier >= 2) {
    // Crossed spears over the door.
    ctx.lineWidth = 6;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(84, 150);
    ctx.lineTo(172, 126);
    ctx.moveTo(84, 126);
    ctx.lineTo(172, 150);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#d9a25a';
    ctx.stroke();
  }
  // Banner pole on top.
  blob(ctx, '#8f5a2c', 4, () => ctx.roundRect(124, peak - 34, 7, 38, 3));
  const pennant = tier >= 3 ? '#f2c14e' : '#5b8ef0';
  blob(ctx, pennant, 4, () => {
    ctx.moveTo(131, peak - 32);
    ctx.lineTo(166, peak - 24);
    ctx.lineTo(131, peak - 14);
    ctx.closePath();
  });
  // Shield emblem.
  const shield = ctx.createRadialGradient(128, wallTop + 44, 4, 128, wallTop + 48, 22);
  shield.addColorStop(0, '#fff4dc');
  shield.addColorStop(1, '#c9b48a');
  blob(ctx, shield, 4, () => {
    ctx.moveTo(110, wallTop + 30);
    ctx.lineTo(146, wallTop + 30);
    ctx.lineTo(146, wallTop + 48);
    ctx.quadraticCurveTo(128, wallTop + 70, 110, wallTop + 48);
    ctx.closePath();
  });
  if (tier >= 3) {
    // Corner towers.
    for (const x of [58, 198]) {
      blob(ctx, stone, 5, () => ctx.roundRect(x - 18, wallTop - 26, 36, 252 - wallTop - 26 - 4, 6));
      blob(ctx, '#2f57b0', 5, () => {
        ctx.moveTo(x - 24, wallTop - 22);
        ctx.lineTo(x, wallTop - 54);
        ctx.lineTo(x + 24, wallTop - 22);
        ctx.closePath();
      });
    }
  }
  return c;
}

/** White crescent swoosh (tinted / additive at draw time). */
function drawSlash(): HTMLCanvasElement {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createLinearGradient(0, 0, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,240,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(32, 32, 28, -Math.PI * 0.85, Math.PI * 0.15);
  ctx.arc(28, 36, 20, Math.PI * 0.15, -Math.PI * 0.85, true);
  ctx.closePath();
  ctx.fill();
  return c;
}

let _placeholders: {
  soldier: Texture[];
  flag: Texture;
  barracks: Texture[];
  slash: Texture;
} | null = null;

function placeholders(): NonNullable<typeof _placeholders> {
  if (!_placeholders) {
    _placeholders = {
      soldier: [drawSoldier(0), drawSoldier(1), drawSoldier(-1)].map((cv) => Texture.from(cv)),
      flag: Texture.from(drawFlag()),
      barracks: [1, 2, 3].map((t) => Texture.from(drawBarracks(t))),
      slash: Texture.from(drawSlash()),
    };
  }
  return _placeholders;
}

const PLACEHOLDER_BARRACKS_SPEC: TowerArt = {
  tiers: [],
  height: 2.7,
  anchor: [0.5, 236 / 256],
  flipToTarget: false,
  muzzle: 1.2,
  facing: 'left',
  ring: [],
  ringScale: 1,
  muzzleFrac: 0.5,
  attack: [null, null, null],
  idle: [null, null, null],
};

/**
 * Art with the barracks filled in: manifest tower art when it loaded (any tier), otherwise the
 * placeholder, and the barracks appended to the build ring when the manifest leaves it out.
 */
export function withBarracksArt(art: LoadedArt): LoadedArt {
  const loaded = art.towers.barracks;
  const ok = loaded && loaded.tiers.length > 0 && loaded.tiers[0] !== Texture.WHITE;
  // Placeholder textures always go with the placeholder spec (a manifest anchor/height is for its own PNGs).
  const barracks: TowerArtRuntime = ok ? loaded : { spec: PLACEHOLDER_BARRACKS_SPEC, tiers: placeholders().barracks, tierFiles: [null, null, null], tint: 0xffffff, fallbackOf: null, rings: [null, null, null], attack: [null, null, null], idle: [null, null, null] };
  const ring = art.manifest.buildRing.includes('barracks') ? art.manifest.buildRing : [...art.manifest.buildRing, 'barracks' as const];
  return {
    ...art,
    towers: { ...art.towers, barracks },
    manifest: { ...art.manifest, buildRing: ring },
  };
}

// ---------------------------------------------------------------------------------------------

interface SoldierArt {
  readonly mode: 'cheap' | 'sheet';
  readonly frames: readonly Texture[];
  readonly base: Texture;
  readonly anchors: readonly (readonly [number, number])[];
  readonly sheet: EnemyArtRuntime['sheet'];
  readonly cheap: CheapWalkSpec;
  readonly facesRight: boolean;
  readonly height: number;
  readonly shadow: number;
  readonly sheetFacing: { readonly down: boolean; readonly up: boolean };
  readonly stride: number | undefined;
}

function soldierArt(art: LoadedArt): SoldierArt {
  const m = art.enemies.soldier;
  if (m && m.base !== Texture.WHITE) {
    const spec = m.spec.sheet;
    return {
      mode: m.mode,
      frames: m.frames,
      base: m.base,
      anchors: m.frameAnchors,
      sheet: m.sheet,
      cheap: m.spec.cheap,
      facesRight: m.spec.facing === 'right',
      height: m.spec.height,
      shadow: m.spec.shadow,
      sheetFacing: { down: (spec?.facing ?? 'right') !== 'left', up: (spec?.facingUp ?? spec?.facing ?? 'right') !== 'left' },
      stride: spec?.stride,
    };
  }
  const p = placeholders();
  const frames = [p.soldier[0], p.soldier[1], p.soldier[0], p.soldier[2]];
  return {
    mode: 'cheap',
    frames,
    base: p.soldier[0],
    anchors: frames.map(() => [0.5, 150 / 160] as const),
    sheet: null,
    cheap: SOLDIER_CHEAP,
    facesRight: true,
    height: SOLDIER_HEIGHT,
    shadow: SOLDIER_SHADOW,
    sheetFacing: { down: true, up: true },
    stride: undefined,
  };
}

interface SoldierView {
  readonly body: Sprite;
  readonly shadow: Sprite;
  readonly barBg: Sprite;
  readonly barFill: Sprite;
  readonly anim: AnimState;
  readonly pose: WalkPose;
  /** 1 → 0 after a swing. */
  lunge: number;
  lastX: number;
  lastZ: number;
  lastPx: number;
  lastPy: number;
  fresh: boolean;
  seen: number;
}

interface Fallen {
  readonly sprite: Sprite;
  t: number;
  dir: number;
  active: boolean;
}

interface Slash {
  readonly sprite: Sprite;
  t: number;
  life: number;
  active: boolean;
}

interface FlagView {
  readonly flag: Sprite;
  readonly ring: Sprite;
  pop: number;
  seen: number;
}

export class SoldierLayer {
  private readonly art: LoadedArt;
  private readonly map: MapView;
  private readonly layers: WorldLayers;
  private readonly tex: ProcTextures;
  private readonly fx: FxLayer;
  private readonly look: SoldierArt;
  private readonly views = new Map<number, SoldierView>();
  private readonly flags = new Map<number, FlagView>();
  private readonly fallen: Fallen[] = [];
  private readonly slashes: Slash[] = [];
  private frameNo = 0;
  private clock = 0;
  private unsubscribe: (() => void)[] = [];
  /** Rally flag texture (also the build-ring "Rally" token icon). */
  readonly flagTexture: Texture;
  /** QA counters. */
  swings = 0;
  falls = 0;

  constructor(art: LoadedArt, map: MapView, layers: WorldLayers, tex: ProcTextures, fx: FxLayer) {
    this.art = art;
    this.map = map;
    this.layers = layers;
    this.tex = tex;
    this.fx = fx;
    this.look = soldierArt(art);
    this.flagTexture = placeholders().flag;
    for (let i = 0; i < MAX_FALLEN; i++) {
      const sprite = new Sprite(Texture.EMPTY);
      sprite.visible = false;
      layers.actors.addChild(sprite);
      this.fallen.push({ sprite, t: 0, dir: 1, active: false });
    }
    for (let i = 0; i < MAX_SLASHES; i++) {
      const sprite = new Sprite(placeholders().slash);
      sprite.anchor.set(0.5);
      sprite.visible = false;
      sprite.blendMode = 'add';
      layers.fx.addChild(sprite);
      this.slashes.push({ sprite, t: 0, life: 0.16, active: false });
    }
  }

  /** Subscribes to the run's sim events (call once per run, after `reset`). */
  wire(events: EventBus): void {
    for (const off of this.unsubscribe) off();
    const m = this.map;
    const ppu = m.layout.pxPerUnit;
    this.unsubscribe = [
      events.on('soldierAttack', (e) => {
        this.swings++;
        const v = this.views.get(e.soldierId);
        if (v) {
          v.lunge = 1;
          const dx = e.targetX - e.x;
          if (Math.abs(dx) > 0.05) v.anim.facing = dx > 0 ? 1 : -1;
        }
        const sx = m.pxX(e.x);
        const sy = m.pxY(e.z);
        const tx = m.pxX(e.targetX);
        const ty = m.pxY(e.targetZ);
        const hx = sx + (tx - sx) * 0.7;
        const hy = sy + (ty - sy) * 0.7 - 0.55 * ppu * HEIGHT_TO_SCREEN;
        this.slash(hx, hy, Math.atan2(ty - sy, tx - sx), e.cleave);
        this.fx.spawn('spark', hx, hy, e.cleave ? 7 : 9, 0, 0, 0.14, e.cleave ? 0xffd27a : 0xffffff);
      }),
      events.on('soldierDied', (e) => {
        this.falls++;
        const v = this.views.get(e.soldierId);
        this.fall(e.x, e.z, v);
        this.fx.puffs(m.pxX(e.x), m.pxY(e.z) - 10, 5, 10, 0xe9d8b4);
      }),
      events.on('soldierRemoved', (e) => this.fx.puffs(m.pxX(e.x), m.pxY(e.z) - 10, 4, 10, 0xe9d8b4)),
      events.on('soldierSpawned', (e) => this.fx.puffs(m.pxX(e.x), m.pxY(e.z) - 4, 3, 12, 0xe9d8b4)),
      events.on('rallyMoved', (e) => {
        const f = this.flags.get(e.towerId);
        if (f) f.pop = 1;
        this.fx.spawn('ring', m.pxX(e.x), m.pxY(e.z), 22, 0, 0, 0.4, 0xbfe0ff);
      }),
      events.on('enemyBlocked', (e) => this.fx.spawn('flash', m.pxX(e.x), m.pxY(e.z) - 0.6 * ppu, 14, 0, 0, 0.14)),
    ];
  }

  /** New run: forget every view (sim ids start over). */
  reset(): void {
    for (const v of this.views.values()) this.destroyView(v);
    this.views.clear();
    for (const f of this.flags.values()) {
      f.flag.destroy();
      f.ring.destroy();
    }
    this.flags.clear();
    for (const f of this.fallen) {
      f.active = false;
      f.sprite.visible = false;
    }
    for (const s of this.slashes) {
      s.active = false;
      s.sprite.visible = false;
    }
  }

  private destroyView(v: SoldierView): void {
    v.body.destroy();
    v.shadow.destroy();
    v.barBg.destroy();
    v.barFill.destroy();
  }

  private viewFor(s: SoldierEntity): SoldierView {
    let v = this.views.get(s.id);
    if (!v) {
      const body = new Sprite(this.look.base);
      const shadow = new Sprite(this.tex.shadow);
      shadow.anchor.set(0.5);
      const barBg = new Sprite(Texture.WHITE);
      const barFill = new Sprite(Texture.WHITE);
      barBg.tint = HP_BG;
      barFill.tint = HP_FRIEND;
      barBg.anchor.set(0, 0.5);
      barFill.anchor.set(0, 0.5);
      this.layers.actors.addChild(body);
      this.layers.shadows.addChild(shadow);
      this.layers.bars.addChild(barBg, barFill);
      v = {
        body,
        shadow,
        barBg,
        barFill,
        anim: createAnimState(s.id * 2.11),
        pose: createPose(),
        lunge: 0,
        lastX: s.x,
        lastZ: s.z,
        lastPx: 0,
        lastPy: 0,
        fresh: true,
        seen: 0,
      };
      this.views.set(s.id, v);
    }
    return v;
  }

  private slash(px: number, py: number, angle: number, cleave: boolean): void {
    const s = this.slashes.find((x) => !x.active);
    if (!s) return;
    s.active = true;
    s.t = 0;
    s.life = cleave ? 0.14 : 0.17;
    s.sprite.visible = true;
    s.sprite.position.set(px, py);
    s.sprite.rotation = angle + Math.PI / 4;
    s.sprite.tint = cleave ? 0xffd27a : 0xffffff;
    s.sprite.scale.set((cleave ? 26 : 34) / 64);
  }

  private fall(x: number, z: number, v: SoldierView | undefined): void {
    const f = this.fallen.find((k) => !k.active);
    if (!f) return;
    f.active = true;
    f.t = 0;
    f.dir = v ? (v.pose.flip ? 1 : -1) * (this.look.facesRight ? 1 : -1) : 1;
    const sp = f.sprite;
    sp.texture = v ? v.body.texture : this.look.base;
    sp.anchor.set(0.5, 0.94);
    sp.scale.copyFrom(v ? v.body.scale : { x: 1, y: 1 });
    sp.position.set(this.map.pxX(x), this.map.pxY(z));
    sp.zIndex = sp.y;
    sp.rotation = 0;
    sp.alpha = 1;
    sp.tint = 0xffffff;
    sp.visible = true;
  }

  /**
   * Per-frame sync. `simDt` = sim seconds this frame (0 while paused), `dt` = real seconds.
   * `selectedTower` highlights that barracks' flag; `rallyTower` pulses it (placing a rally point).
   */
  sync(system: SoldierSystem, alpha: number, simDt: number, dt: number, selectedTower: number, rallyTower: number): void {
    this.frameNo++;
    this.clock += dt;
    const map = this.map;
    const ppu = map.layout.pxPerUnit;
    const look = this.look;

    for (let i = 0; i < system.soldiers.length; i++) {
      const s = system.soldiers[i];
      const v = this.viewFor(s);
      v.seen = this.frameNo;
      const alive = s.state !== 'dead';
      v.body.visible = alive;
      v.shadow.visible = alive;
      if (!alive) {
        v.barBg.visible = false;
        v.barFill.visible = false;
        v.fresh = true;
        continue;
      }
      const ix = s.prevX + (s.x - s.prevX) * alpha;
      const iz = s.prevZ + (s.z - s.prevZ) * alpha;
      const px = map.pxX(ix);
      const py = map.pxY(iz);
      if (v.fresh) {
        v.lastX = ix;
        v.lastZ = iz;
        v.lastPx = px;
        v.lastPy = py;
        v.fresh = false;
      }
      const moved = Math.hypot(ix - v.lastX, iz - v.lastZ);
      const speedRatio = simDt > 0 ? moved / simDt / SOLDIER_RULES.speed : 0;
      const dxImg = px - v.lastPx;
      const dyImg = py - v.lastPy;
      v.lastX = ix;
      v.lastZ = iz;
      v.lastPx = px;
      v.lastPy = py;

      const pose = v.pose;
      let tex: Texture;
      let anchor: readonly [number, number];
      if (look.mode === 'sheet' && look.sheet) {
        const seqIdx = sheetSequence(v.anim.seq, dxImg, dyImg);
        const seq = look.sheet.seqs[seqIdx] ?? look.sheet.seqs[0];
        const facesRight = seqIdx === 1 ? look.sheetFacing.up : look.sheetFacing.down;
        sheetWalk(v.anim, seq.length, look.sheet.fps, look.stride, moved, speedRatio, dxImg, dyImg, simDt, facesRight, pose);
        tex = seq[pose.frame % seq.length];
        anchor = look.sheet.anchor ?? look.anchors[0] ?? [0.5, 0.94];
      } else {
        cheapWalk(v.anim, look.cheap, moved, speedRatio, dxImg, dyImg, simDt, look.frames.length, look.facesRight, pose);
        tex = look.frames[pose.frame] ?? look.base;
        anchor = look.anchors[pose.frame] ?? [0.5, 0.94];
      }
      // Standing in a fight: face the foe.
      if (s.state === 'fighting' && speedRatio < 0.05) {
        const fx = Math.sin(s.yaw);
        if (Math.abs(fx) > 0.15) v.anim.facing = fx > 0 ? 1 : -1;
        pose.flip = (v.anim.facing > 0) !== look.facesRight;
      }
      if (v.body.texture !== tex) v.body.texture = tex;
      v.body.anchor.set(anchor[0], anchor[1]);

      const heightPx = look.height * ppu;
      const sc = heightPx / Math.max(1, look.mode === 'sheet' ? tex.height * 0.94 : look.base.height);
      v.lunge = Math.max(0, v.lunge - simDt * 6);
      const l = Math.sin(v.lunge * Math.PI); // out and back
      const face = v.anim.facing;
      v.body.scale.set(sc * pose.scaleX * (pose.flip ? -1 : 1) * (1 + l * 0.05), sc * pose.scaleY * (1 - l * 0.04));
      v.body.rotation = pose.rotation + face * l * 0.16;
      const liftPx = pose.lift * HEIGHT_TO_SCREEN * ppu;
      v.body.position.set(px + face * l * 7, py - liftPx);
      v.body.zIndex = py;
      v.body.tint = s.hitFlashTimer > 0 ? 0xff9c8c : 0xffffff;

      const sh = v.shadow;
      const shR = look.shadow * ppu;
      sh.position.set(px, py);
      sh.scale.set((shR * 2) / 128, (shR * 0.9) / 128);
      sh.alpha = 0.85;

      const damaged = s.hp < s.maxHp;
      v.barBg.visible = damaged;
      v.barFill.visible = damaged;
      if (damaged) {
        const top = py - liftPx - heightPx - 5;
        v.barBg.position.set(px - BAR_W / 2 - 1.5, top);
        v.barBg.width = BAR_W + 3;
        v.barBg.height = BAR_H + 3;
        v.barFill.position.set(px - BAR_W / 2, top);
        v.barFill.width = Math.max(0.5, (BAR_W * s.hp) / s.maxHp);
        v.barFill.height = BAR_H;
      }
    }
    for (const [id, v] of this.views) {
      if (v.seen !== this.frameNo) {
        this.destroyView(v);
        this.views.delete(id);
      }
    }

    for (let i = 0; i < system.barracks.length; i++) this.syncFlag(system.barracks[i], dt, selectedTower, rallyTower);
    for (const [id, f] of this.flags) {
      if (f.seen !== this.frameNo) {
        f.flag.destroy();
        f.ring.destroy();
        this.flags.delete(id);
      }
    }

    const fxDt = simDt > 0 ? simDt : dt * 0.25;
    for (const f of this.fallen) {
      if (!f.active) continue;
      f.t += fxDt;
      const k = Math.min(1, f.t / 0.7);
      f.sprite.rotation = f.dir * Math.min(1, k * 2.2) * (Math.PI / 2) * 0.9;
      f.sprite.alpha = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
      if (k >= 1) {
        f.active = false;
        f.sprite.visible = false;
      }
    }
    for (const s of this.slashes) {
      if (!s.active) continue;
      s.t += fxDt;
      const k = s.t / s.life;
      if (k >= 1) {
        s.active = false;
        s.sprite.visible = false;
        continue;
      }
      s.sprite.alpha = 1 - k;
      s.sprite.rotation += fxDt * 9;
    }
  }

  private syncFlag(b: BarracksState, dt: number, selectedTower: number, rallyTower: number): void {
    let f = this.flags.get(b.towerId);
    if (!f) {
      const flag = new Sprite(this.flagTexture);
      flag.anchor.set(12.5 / 64, 92 / 96);
      const ring = new Sprite(this.tex.ring);
      ring.anchor.set(0.5);
      ring.tint = 0xbfe0ff;
      this.layers.actors.addChild(flag);
      this.layers.groundFx.addChild(ring);
      f = { flag, ring, pop: 1, seen: 0 };
      this.flags.set(b.towerId, f);
    }
    f.seen = this.frameNo;
    const px = this.map.pxX(b.rallyX);
    const py = this.map.pxY(b.rallyZ);
    const ppu = this.map.layout.pxPerUnit;
    const focus = b.towerId === rallyTower ? 2 : b.towerId === selectedTower ? 1 : 0;
    f.pop = Math.max(0, f.pop - dt * 3);
    const base = ((focus > 0 ? 1.35 : 1.05) * ppu) / 96;
    const pop = 1 + Math.sin(f.pop * Math.PI) * 0.35;
    f.flag.scale.set(base * pop);
    f.flag.position.set(px, py);
    f.flag.zIndex = py - 0.5;
    f.flag.skew.x = Math.sin(this.clock * 3 + b.towerId) * 0.05;
    f.flag.alpha = focus > 0 ? 1 : 0.85;
    f.ring.visible = focus > 0;
    if (focus > 0) {
      const k = (this.clock * (focus === 2 ? 1.6 : 0.9)) % 1;
      const r = SOLDIER_RULES.engageRadius * ppu * (focus === 2 ? 0.6 + k * 0.5 : 1);
      f.ring.position.set(px, py);
      f.ring.scale.set((r * 2) / 128, (r * 0.9) / 128);
      f.ring.alpha = focus === 2 ? 1 - k : 0.55;
    }
  }

  /** QA snapshot. */
  debug(system: SoldierSystem): Record<string, unknown> {
    let alive = 0;
    let fighting = 0;
    for (const s of system.soldiers) {
      if (s.state !== 'dead') alive++;
      if (s.state === 'fighting') fighting++;
    }
    return {
      soldiers: system.soldiers.length,
      alive,
      fighting,
      blocked: system.blockedCount,
      swings: this.swings,
      falls: this.falls,
      art: this.art.enemies.soldier && this.art.enemies.soldier.base !== Texture.WHITE ? 'manifest' : 'placeholder',
      rallies: system.barracks.map((b) => ({ towerId: b.towerId, x: b.rallyX, z: b.rallyZ })),
    };
  }
}
