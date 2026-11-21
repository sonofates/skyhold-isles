/**
 * The run's hero on the painted map: its sprite sheets (idle, walk down / up / side with
 * mirroring, attack synced to the sim's attack events with the painted impact frame, death, a
 * fade-in respawn at the castle), a selection ring, an HP bar, the move-order marker and path, the
 * reachable-road highlight while it is selected, the respawn countdown over the castle, aim
 * previews for its skills (drawn for the HUD, ui/heroHud2d.ts), and procedural FX for each hero's
 * two actives in the hero's colours (plus Tobb's gizmo turrets, Hunter's Mark reticles, Overhaul
 * gear rings, Mira's ember wisp and Bran's rally banner).
 *
 * Render only: reads `world.hero` / `world.heroSystem` and the sim's hero events; never writes to
 * the sim. Depth: the body sorts in `layers.actors` by its feet y, like soldiers and enemies.
 */
import { Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { EventBus } from '../core/eventBus.ts';
import type { HeroId } from '../core/types.ts';
import { HERO_DEFS, HERO_RULES } from '../data/heroes.ts';
import type { EnemyEntity, TowerEntity } from '../sim/entities.ts';
import type { HeroEntity } from '../sim/heroSystem.ts';
import type { SimWorld } from '../sim/world.ts';
import type { HeroArtRuntime, HeroSeqRuntime, LoadedArt } from './assets2d.ts';
import type { FxLayer } from './fxLayer.ts';
import {
  createHeroAnimState,
  createHeroPoseOut,
  onHeroAttackImpact,
  onHeroCastAnim,
  onHeroMoveOrdered,
  resetHeroAnimState,
  stepHeroAnim,
} from './heroAnim.ts';
import { paintedText, setText } from './hudText.ts';
import { HEIGHT_TO_SCREEN, type WorldLayers } from './layers.ts';
import type { MapView } from './mapView.ts';
import type { ProcTextures } from './procTextures.ts';

/** Per-hero FX palette: main colour, accent, light. */
export const HERO_COLORS: Readonly<Record<HeroId, { readonly main: number; readonly accent: number; readonly light: number }>> = {
  bran: { main: 0x6f9a3a, accent: 0xc08a3e, light: 0xe8f0b8 },
  wren: { main: 0x5fb4e8, accent: 0xf2e6c2, light: 0xdff4ff },
  mira: { main: 0xff7a2a, accent: 0xffc24a, light: 0xfff0b0 },
  tobb: { main: 0xd9a43b, accent: 0x8a5a2a, light: 0xfff0c8 },
  sela: { main: 0x3fc9c0, accent: 0xf4fbff, light: 0xd8fffb },
};

/** What the HUD is aiming (world units); `valid` false greys the target out. */
export interface HeroAimSpec {
  readonly shape: 'circle' | 'cone' | 'line' | 'towers';
  readonly tx: number;
  readonly tz: number;
  readonly radius: number;
  /** Cast reach around the hero (0 = none drawn). */
  readonly range: number;
  readonly valid: boolean;
  /** `towers`: candidate towers (highlighted) and the one that would be picked. */
  readonly towers?: readonly { readonly x: number; readonly z: number; readonly picked: boolean }[];
}

/** Hover / feedback marker for a move order (world units). */
export interface MovePreview {
  readonly x: number;
  readonly z: number;
  readonly valid: boolean;
}

interface Effect {
  kind: string;
  t: number;
  life: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  r: number;
}

const SEL_RING_R = 0.62;
const BAR_W = 46;
const BAR_H = 6;
const RESPAWN_FADE = 0.8;

const easeOut = (k: number): number => 1 - (1 - k) * (1 - k);

export class HeroLayer {
  readonly root = new Container();
  private readonly map: MapView;
  private readonly layers: WorldLayers;
  private readonly tex: ProcTextures;
  private readonly fx: FxLayer;
  private readonly art: HeroArtRuntime | null;
  private readonly baseUrl: string;
  private readonly body = new Sprite();
  private readonly shadow: Sprite;
  private readonly selRing: Sprite;
  private readonly baseRing: Sprite;
  private readonly road = new Graphics();
  private readonly ground = new Graphics();
  private readonly top = new Graphics();
  private readonly bars = new Graphics();
  private readonly respawnText: Text;
  private readonly wisp: Sprite;
  private readonly iconPop = new Sprite();
  private readonly gizmoViews = new Map<number, Container>();
  private readonly reticles: Sprite[] = [];
  private readonly arrows: { s: Sprite; t: number; delay: number; x0: number; y0: number; x1: number; y1: number; active: boolean }[] = [];
  private readonly effects: Effect[] = [];
  private readonly icons = new Map<string, Texture>();
  private heroId: HeroId | null = null;
  private roadFor: object | null = null;

  // --- animation state ---
  private readonly anim = createHeroAnimState();
  private readonly poseOut = createHeroPoseOut();
  private deathX = 0;
  private deathZ = 0;
  private respawnT = 99;
  private clock = 0;
  private iconT = 99;
  private moveMarker: { x: number; z: number; t: number } | null = null;
  private invalid: { x: number; z: number; t: number } | null = null;
  private hover: MovePreview | null = null;
  private aim: HeroAimSpec | null = null;
  private wispDash: { t: number; x0: number; z0: number; x1: number; z1: number } | null = null;
  private lastHp = -1;
  private lastMax = -1;
  /** Hero is selected (move mode): ring + reachable road. */
  selected = false;
  /** QA counters. */
  readonly stats = { attacksPlayed: 0, prerolled: 0, casts: 0, deaths: 0, respawns: 0, moves: 0, frame: '' };

  constructor(art: LoadedArt, map: MapView, layers: WorldLayers, tex: ProcTextures, fx: FxLayer) {
    this.map = map;
    this.layers = layers;
    this.tex = tex;
    this.fx = fx;
    this.art = art.hero ?? null;
    this.baseUrl = art.baseUrl;
    this.shadow = new Sprite(tex.shadow);
    this.shadow.anchor.set(0.5);
    this.baseRing = new Sprite(tex.wring);
    this.baseRing.anchor.set(0.5);
    this.selRing = new Sprite(tex.wring);
    this.selRing.anchor.set(0.5);
    this.body.anchor.set(0.5, 0.977);
    this.wisp = new Sprite(tex.orb);
    this.wisp.anchor.set(0.5);
    this.wisp.blendMode = 'add';
    this.iconPop.anchor.set(0.5);
    this.respawnText = paintedText(30, 'center');
    layers.groundFx.addChild(this.road, this.ground);
    layers.shadows.addChild(this.shadow, this.baseRing, this.selRing);
    layers.actors.addChild(this.body);
    layers.fx.addChild(this.top, this.wisp);
    layers.bars.addChild(this.bars, this.iconPop, this.respawnText);
    this.hideAll();
  }

  private hideAll(): void {
    for (const d of [this.body, this.shadow, this.baseRing, this.selRing, this.wisp, this.iconPop, this.respawnText]) d.visible = false;
    this.road.clear();
    this.ground.clear();
    this.top.clear();
    this.bars.clear();
  }

  /** Map px per world unit. */
  private get ppu(): number {
    return this.map.layout.pxPerUnit;
  }

  /** Starts a new run (the sim world was rebuilt). */
  reset(): void {
    resetHeroAnimState(this.anim);
    this.respawnT = 99;
    this.effects.length = 0;
    this.moveMarker = null;
    this.invalid = null;
    this.hover = null;
    this.aim = null;
    this.wispDash = null;
    this.selected = false;
    this.lastHp = -1;
    this.roadFor = null;
    for (const v of this.gizmoViews.values()) v.destroy({ children: true });
    this.gizmoViews.clear();
    for (const a of this.arrows) {
      a.active = false;
      a.s.visible = false;
    }
    this.hideAll();
  }

  wire(ev: EventBus): void {
    ev.on('heroAttack', (e) => {
      const seq = this.art?.attack ?? null;
      onHeroAttackImpact(this.anim, e.x, e.targetX, seq);
      if (!seq) return;
      this.stats.attacksPlayed++;
      if (e.crit) {
        const m = this.map;
        this.fx.spawn('flash', m.pxX(e.targetX), m.pxY(e.targetZ) - 0.6 * this.ppu, 34, 0, 0, 0.2, 0xfff2b0);
      }
    });
    ev.on('heroHit', () => {
      // hit flash comes from hitFlashTimer
    });
    ev.on('heroMoved', (e) => {
      const wp = e.waypoints.length > 0 ? e.waypoints[0] : null;
      onHeroMoveOrdered(this.anim, e.x, e.z, wp ? wp.x : e.targetX, wp ? wp.z : e.targetZ);
      this.moveMarker = { x: e.targetX, z: e.targetZ, t: 0 };
      this.stats.moves++;
    });
    ev.on('heroDied', (e) => {
      this.anim.deathT = 0;
      this.deathX = e.x;
      this.deathZ = e.z;
      this.anim.attackT = -1;
      this.anim.impactPending = false;
      this.moveMarker = null;
      this.stats.deaths++;
      const m = this.map;
      this.fx.puffs(m.pxX(e.x), m.pxY(e.z) - 10, 8, 18, 0xd9cbb0);
    });
    ev.on('heroRespawn', (e) => {
      this.anim.deathT = -1;
      this.respawnT = 0;
      this.stats.respawns++;
      const m = this.map;
      const col = this.colors().light;
      this.fx.spawn('wring', m.pxX(e.x), m.pxY(e.z), 1.6 * this.ppu, 0, 0, 0.8, col);
      this.fx.spawn('orb', m.pxX(e.x), m.pxY(e.z) - 0.8 * this.ppu, 70, 0, 0, 0.6, col);
      this.fx.burst('spark', m.pxX(e.x), m.pxY(e.z) - 0.6 * this.ppu, 10, 14, 90, 0.7, col);
    });
    ev.on('heroSkillCast', (e) => this.onCast(e.slot, e.x, e.z, e.targetX, e.targetZ, e.radius, e.duration));
  }

  private colors(): (typeof HERO_COLORS)[HeroId] {
    return HERO_COLORS[this.heroId ?? 'bran'];
  }

  /** Painted skill icon (manifest `heroes.<id>.skills.<key>`), loaded once on demand. */
  private icon(key: string): Texture | null {
    const hit = this.icons.get(key);
    if (hit) return hit;
    const file = this.art?.spec.skills[key];
    if (!file) return null;
    this.icons.set(key, Texture.EMPTY);
    void Assets.load<Texture>({ src: this.baseUrl + file, data: { autoGenerateMipmaps: true } })
      .then((tx) => {
        if (tx) this.icons.set(key, tx);
      })
      .catch(() => undefined);
    return null;
  }

  private onCast(slot: 0 | 1, x: number, z: number, tx: number, tz: number, r: number, dur: number): void {
    const id = this.heroId;
    if (!id) return;
    this.stats.casts++;
    const kind = HERO_DEFS[id].actives[slot].kind;
    onHeroCastAnim(this.anim, x, tx, this.art?.attack ?? null);
    this.iconT = 0;
    const ic = this.icon(kind);
    if (ic && ic !== Texture.EMPTY) this.iconPop.texture = ic;
    const m = this.map;
    const ppu = this.ppu;
    const c = this.colors();
    const life = (k: string): number =>
      k === 'rallyBanner' ? 0.6 : k === 'volley' ? 1.1 : k === 'undertow' ? Math.max(1.2, dur) : k === 'wispBurst' ? 0.75 : k === 'fireRing' ? 0.8 : 0.7;
    this.effects.push({ kind, t: 0, life: life(kind), x, z, tx, tz, r });
    const px = m.pxX(tx);
    const py = m.pxY(tz);
    switch (kind) {
      case 'shieldBash':
        this.fx.puffs(m.pxX(x + (tx - x) * 0.5), m.pxY(z + (tz - z) * 0.5), 8, r * ppu * 0.4, 0xd8c8a0);
        this.fx.spawn('flash', m.pxX(x), m.pxY(z) - 0.7 * ppu, 60, 0, 0, 0.18, c.light);
        break;
      case 'rallyBanner':
        this.fx.spawn('wring', m.pxX(x), m.pxY(z), r * ppu, 0, 0, 0.9, c.main);
        this.fx.burst('spark', m.pxX(x), m.pxY(z) - 1.2 * ppu, 12, 14, 80, 0.8, c.accent);
        break;
      case 'volley':
        this.launchVolley(tx, tz, r);
        break;
      case 'huntersMark':
        this.fx.spawn('wring', px, py, r * ppu * 0.6, 0, 0, 0.5, 0xff5a3a);
        break;
      case 'fireRing':
        this.fx.spawn('flash', px, py - 10, r * ppu * 1.1, 0, 0, 0.3, c.accent);
        this.fx.burst('spark', px, py - 8, 16, 16, 160, 0.7, c.main);
        break;
      case 'wispBurst': {
        const dx = tx - x;
        const dz = tz - z;
        const d = Math.hypot(dx, dz) || 1;
        this.wispDash = { t: 0, x0: x, z0: z, x1: x + (dx / d) * r, z1: z + (dz / d) * r };
        break;
      }
      case 'deployGizmo':
        this.fx.puffs(px, py, 8, 20, 0xe9d8b4);
        this.fx.burst('spark', px, py - 14, 8, 10, 90, 0.5, c.main);
        break;
      case 'overhaul':
        this.fx.spawn('wring', px, py, r * ppu, 0, 0, 0.6, c.main);
        break;
      case 'undertow':
        this.fx.spawn('wring', px, py, r * ppu, 0, 0, 0.7, c.main);
        this.fx.burst('orb', px, py - 6, 10, 10, 110, 0.6, c.light);
        break;
      case 'thunderCall':
        this.fx.spawn('flash', m.pxX(x), m.pxY(z) - 1.3 * ppu, 70, 0, 0, 0.22, c.light);
        this.fx.spawn('flash', px, py - 0.6 * ppu, 90, 0, 0, 0.25, 0xe6f6ff);
        break;
      default:
        break;
    }
  }

  private launchVolley(tx: number, tz: number, r: number): void {
    const m = this.map;
    const ppu = this.ppu;
    const n = 16;
    let made = 0;
    for (let i = 0; i < this.arrows.length + n && made < n; i++) {
      let a = this.arrows[i];
      if (!a) {
        const s = new Sprite(this.tex.arrow);
        s.anchor.set(0.9, 0.5);
        s.visible = false;
        this.layers.projectiles.addChild(s);
        a = { s, t: 0, delay: 0, x0: 0, y0: 0, x1: 0, y1: 0, active: false };
        this.arrows.push(a);
      }
      if (a.active) continue;
      const ang = this.fx.random() * Math.PI * 2;
      const rr = Math.sqrt(this.fx.random()) * r * 0.95;
      a.x1 = m.pxX(tx + Math.cos(ang) * rr);
      a.y1 = m.pxY(tz + Math.sin(ang) * rr);
      a.x0 = a.x1 - 2.2 * ppu;
      a.y0 = a.y1 - 5.5 * ppu;
      a.delay = made * 0.035 + this.fx.random() * 0.05;
      a.t = 0;
      a.active = true;
      made++;
    }
  }

  /** Move-order preview under the pointer (null hides it). */
  setHover(p: MovePreview | null): void {
    this.hover = p;
  }

  /** A tap the hero cannot walk to: brief red cross at the point. */
  flashInvalid(x: number, z: number): void {
    this.invalid = { x, z, t: 0 };
  }

  /** Skill aim preview from the HUD (null hides it). */
  showAim(spec: HeroAimSpec | null): void {
    this.aim = spec;
  }

  /** Hero body box in map px (tap target), or null while it has none (dead / no hero). */
  bodyRect(): { x: number; y: number; w: number; h: number } | null {
    if (!this.body.visible || this.anim.deathT >= 0) return null;
    const hgt = (this.art?.spec.height ?? 1.4) * this.ppu;
    const w = hgt * 0.62;
    return { x: this.body.x - w / 2, y: this.body.y - hgt, w, h: hgt };
  }

  /** Feet point of the drawn hero in map px (null without a hero). */
  feet(): { x: number; y: number } | null {
    return this.heroId ? { x: this.body.x, y: this.body.y } : null;
  }

  /** Per-frame sync. `simDt` = sim seconds this frame (0 while paused), `dt` = real seconds. */
  sync(world: SimWorld, alpha: number, simDt: number, dt: number): void {
    const h = world.hero;
    this.clock += dt;
    if (!h) {
      if (this.heroId) this.hideAll();
      this.heroId = null;
      return;
    }
    this.heroId = h.heroId;
    if (this.roadFor !== world.heroSystem) this.drawRoad(world);
    this.road.visible = this.selected && h.state !== 'dead';
    if (this.road.visible) this.road.alpha = 0.75 + 0.25 * Math.sin(this.clock * 3);

    const m = this.map;
    const ppu = this.ppu;
    const art = this.art;
    const c = this.colors();
    const dead = h.state === 'dead';
    let ix = h.prevX + (h.x - h.prevX) * alpha;
    let iz = h.prevZ + (h.z - h.prevZ) * alpha;
    if (dead) {
      ix = this.deathX;
      iz = this.deathZ;
    }
    const px = m.pxX(ix);
    const py = m.pxY(iz);
    const heightPx = (art?.spec.height ?? 1.4) * ppu;

    let alphaBody = 1;
    if (art) {
      const atk = art.attack;
      let expectsAttack = false;
      let targetX: number | null = null;
      if (!dead && atk && this.anim.attackT < 0 && simDt > 0) {
        const lead = (atk.impact ?? 2) / atk.fps;
        if (h.attackTimer > 0 && h.attackTimer <= lead) {
          if (h.stats.attackMode === 'melee') {
            if (h.state === 'fighting') {
              expectsAttack = true;
              const tgt = this.targetOf(world, h);
              if (tgt) targetX = tgt.x;
            }
          } else {
            const tgt = this.targetOf(world, h);
            if (tgt) {
              expectsAttack = true;
              targetX = tgt.x;
            }
          }
        }
      }

      const wp = h.waypoints.length > 0 ? h.waypoints[0] : null;
      const pose = this.poseOut;
      stepHeroAnim(
        this.anim,
        art,
        {
          heroState: h.state,
          x: h.x,
          z: h.z,
          prevX: h.prevX,
          prevZ: h.prevZ,
          yaw: h.yaw,
          moveSpeed: h.stats.moveSpeed,
          attackTimer: h.attackTimer,
          expectsAttack,
          targetX,
          nextWaypointX: wp ? wp.x : null,
          nextWaypointZ: wp ? wp.z : null,
          simDt,
          dt,
        },
        pose,
      );
      if (pose.prerolled) this.stats.prerolled++;
      alphaBody = pose.alphaBody;
      const seq: HeroSeqRuntime =
        pose.kind === 'attack' && atk
          ? atk
          : pose.kind === 'death' && art.death
            ? art.death
            : pose.kind === 'down' || pose.kind === 'up' || pose.kind === 'side'
              ? art[pose.kind]
              : art.idle;
      const frame = pose.frame;
      const flip = pose.flip;
      const tex = seq.frames[frame] ?? seq.frames[0];
      if (this.body.texture !== tex) this.body.texture = tex;
      this.body.anchor.set(seq.anchor[0], seq.anchor[1]);
      const sc = heightPx / Math.max(1, art.figurePx);
      // Respawn fade-in at the castle.
      if (this.respawnT < RESPAWN_FADE) {
        this.respawnT += simDt > 0 ? simDt : dt * 0.25;
        alphaBody = Math.min(alphaBody, easeOut(Math.min(1, this.respawnT / RESPAWN_FADE)));
      }
      const pop = this.respawnT < RESPAWN_FADE ? 0.85 + 0.15 * (this.respawnT / RESPAWN_FADE) : 1;
      this.body.scale.set(sc * (flip ? -1 : 1) * pop, sc * pop);
      this.stats.frame = `${pose.kind}:${frame}`;
    } else {
      this.body.texture = this.tex.ball;
      this.body.width = this.body.height = 0.6 * ppu;
    }
    this.body.visible = alphaBody > 0.01;
    this.body.alpha = alphaBody;
    this.body.position.set(px, py);
    this.body.zIndex = py;
    this.body.tint = !dead && h.hitFlashTimer > 0 ? 0xff9c8c : 0xffffff;

    const sh = this.shadow;
    sh.visible = this.body.visible;
    sh.position.set(px, py);
    sh.scale.set((0.5 * ppu * 2) / 128, (0.5 * ppu * 0.9) / 128);
    sh.alpha = 0.8 * alphaBody;

    // Hero base ring (always, faint, the hero's colour) + selection ring (gold, pulsing).
    const rr = SEL_RING_R * ppu;
    this.baseRing.visible = !dead && this.body.visible;
    this.baseRing.position.set(px, py);
    this.baseRing.scale.set((rr * 2) / 128, (rr * 0.9) / 128);
    this.baseRing.tint = c.main;
    this.baseRing.alpha = 0.55 * alphaBody;
    this.selRing.visible = this.selected && !dead;
    if (this.selRing.visible) {
      const pulse = 1 + 0.08 * Math.sin(this.clock * 6);
      this.selRing.position.set(px, py);
      this.selRing.scale.set((rr * 2.5 * pulse) / 128, (rr * 1.15 * pulse) / 128);
      this.selRing.tint = 0xffd84a;
      this.selRing.alpha = 0.95;
    }

    this.syncWisp(h, px, py, heightPx, simDt, dt, dead);
    this.drawBars(h, px, py, heightPx, alphaBody, dead, world);
    this.syncIconPop(px, py, heightPx, simDt, dt);
    this.drawGround(world, h, ix, iz, simDt, dt);
    this.drawTop(world, h, simDt, dt);
    this.syncGizmos(world, dt);
    this.syncReticles(world, alpha);
    this.syncArrows(simDt > 0 ? simDt : 0);
  }

  private targetOf(world: SimWorld, h: HeroEntity): EnemyEntity | null {
    if (h.stats.attackMode === 'melee' && h.targetPoolIndex >= 0) {
      const e = world.enemyPool.items[h.targetPoolIndex];
      if (e && e.active && e.uid === h.targetUid) return e;
    }
    const pool = world.enemyPool;
    const r = h.stats.attackMode === 'melee' ? h.stats.range + 0.6 : h.stats.range;
    const rSq = r * r;
    let best: EnemyEntity | null = null;
    let bestD = Infinity;
    for (let i = 0; i < pool.getActiveCount(); i++) {
      const e = pool.items[pool.getActiveIndex(i)];
      if (!e.active || e.hp <= 0 || e.burrowed || (e.flying && !h.stats.hitsFlyers)) continue;
      const d = (e.x - h.x) ** 2 + (e.z - h.z) ** 2;
      if (d <= rSq && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private syncWisp(h: HeroEntity, px: number, py: number, heightPx: number, simDt: number, dt: number, dead: boolean): void {
    const w = this.wisp;
    if (h.heroId !== 'mira') {
      w.visible = false;
      return;
    }
    const m = this.map;
    const c = HERO_COLORS.mira;
    w.tint = c.accent;
    if (this.wispDash) {
      const d = this.wispDash;
      d.t += simDt > 0 ? simDt : dt * 0.25;
      const k = Math.min(1, d.t / 0.35);
      const back = d.t > 0.45 ? Math.min(1, (d.t - 0.45) / 0.3) : 0;
      const ex = d.x0 + (d.x1 - d.x0) * easeOut(k);
      const ez = d.z0 + (d.z1 - d.z0) * easeOut(k);
      const wx = m.pxX(ex) + (px + heightPx * 0.32 - m.pxX(ex)) * back;
      const wy = m.pxY(ez) - 0.7 * this.ppu + (py - heightPx * 0.8 - (m.pxY(ez) - 0.7 * this.ppu)) * back;
      w.position.set(wx, wy);
      w.scale.set((back > 0 ? 34 : 64) / 64);
      if (k < 1) {
        this.fx.spawn('spark', wx, wy, 18, 0, -20, 0.45, c.main);
        if (this.fx.random() < 0.5) this.fx.spawn('glow', wx, wy, 26, 0, 0, 0.35, c.accent);
      }
      if (d.t > 0.8) this.wispDash = null;
      w.visible = true;
      return;
    }
    w.visible = !dead && this.body.visible;
    const bob = Math.sin(this.clock * 2.6) * heightPx * 0.05;
    const orbit = Math.sin(this.clock * 1.3) * heightPx * 0.08;
    w.position.set(px + this.anim.facing * heightPx * 0.3 + orbit, py - heightPx * 0.82 + bob);
    w.scale.set((30 + 4 * Math.sin(this.clock * 9)) / 64);
    w.alpha = this.body.alpha;
  }

  private drawBars(h: HeroEntity, px: number, py: number, heightPx: number, a: number, dead: boolean, world: SimWorld): void {
    const g = this.bars;
    const hp = Math.ceil(h.hp);
    const needs = hp !== this.lastHp || h.maxHp !== this.lastMax || dead || this.respawnT < RESPAWN_FADE;
    const t = this.respawnText;
    if (dead) {
      // Respawn countdown over the castle (spawn point), with a ring that fills up.
      const sx = this.map.pxX(h.spawnX);
      const sy = this.map.pxY(h.spawnZ) - 1.7 * this.ppu;
      const left = Math.max(0, h.respawnTimer);
      const frac = h.stats.respawnSec > 0 ? 1 - left / h.stats.respawnSec : 1;
      g.clear();
      g.position.set(0, 0);
      g.alpha = 1;
      g.visible = true;
      g.circle(sx, sy, 24).fill({ color: 0x2a1a0c, alpha: 0.72 });
      g.circle(sx, sy, 24).stroke({ width: 3, color: 0x3a2412, alpha: 0.9 });
      g.moveTo(sx, sy - 21).arc(sx, sy, 21, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac).stroke({ width: 5, color: this.colors().main, alpha: 0.95, cap: 'round' });
      t.visible = true;
      setText(t, String(Math.ceil(left)));
      t.position.set(sx, sy + 1);
      this.lastHp = -1;
      return;
    }
    t.visible = false;
    if (!needs && g.visible) {
      g.position.set(0, 0);
      this.barAt(px, py, heightPx);
      return;
    }
    this.lastHp = hp;
    this.lastMax = h.maxHp;
    g.clear();
    const frac = Math.max(0, Math.min(1, h.hp / Math.max(1, h.maxHp)));
    const col = frac > 0.55 ? 0x7bd04a : frac > 0.28 ? 0xf2c23a : 0xe0503a;
    g.roundRect(-BAR_W / 2 - 2, -2, BAR_W + 4, BAR_H + 4, 3).fill({ color: 0x2a1a0c, alpha: 0.85 });
    g.roundRect(-BAR_W / 2, 0, BAR_W * frac, BAR_H, 2).fill({ color: col });
    g.roundRect(-BAR_W / 2, 0, BAR_W * frac, BAR_H * 0.4, 1).fill({ color: 0xffffff, alpha: 0.25 });
    // Hero tag: a small diamond in the hero's colour at the bar's left end.
    g.poly([-BAR_W / 2 - 8, BAR_H / 2, -BAR_W / 2 - 3, BAR_H / 2 - 5, -BAR_W / 2 + 2, BAR_H / 2, -BAR_W / 2 - 3, BAR_H / 2 + 5]).fill({ color: this.colors().main }).stroke({ width: 1.5, color: 0x3a2412 });
    g.alpha = a;
    g.visible = true;
    void world;
    this.barAt(px, py, heightPx);
  }

  private barAt(px: number, py: number, heightPx: number): void {
    this.bars.position.set(px, py - heightPx - 10);
  }

  private syncIconPop(px: number, py: number, heightPx: number, simDt: number, dt: number): void {
    const s = this.iconPop;
    this.iconT += simDt > 0 ? simDt : dt * 0.25;
    const life = 0.9;
    if (this.iconT >= life || s.texture === Texture.EMPTY || !this.body.visible) {
      s.visible = false;
      return;
    }
    const k = this.iconT / life;
    s.visible = true;
    const d = 40 * (k < 0.2 ? easeOut(k / 0.2) * 1.15 : 1.15 - 0.15 * Math.min(1, (k - 0.2) / 0.2));
    s.scale.set(d / Math.max(1, s.texture.width));
    s.position.set(px, py - heightPx - 34 - 18 * k);
    s.alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
  }

  /** Reachable road for move orders: every ground lane (+ junction links) at the hero's reach. */
  private drawRoad(world: SimWorld): void {
    this.roadFor = world.heroSystem;
    const g = this.road;
    g.clear();
    const nodes = world.heroSystem.groundGraph.nodes;
    const m = this.map;
    const ppu = this.ppu;
    const width = HERO_RULES.maxOffRoadDist * 2 * ppu;
    const seg = (w: number, color: number, alpha: number): void => {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        for (const e of n.edges) {
          if (e.to < i) continue;
          const o = nodes[e.to];
          g.moveTo(m.pxX(n.x), m.pxY(n.z)).lineTo(m.pxX(o.x), m.pxY(o.z));
        }
      }
      g.stroke({ width: w, color, alpha, cap: 'round', join: 'round' });
    };
    seg(width, 0xffe7a0, 0.16);
    seg(width * 0.12, 0xfff3c8, 0.45);
  }

  /** Ground-level shapes: aim previews, move marker, path, skill rings, passive auras. */
  private drawGround(world: SimWorld, h: HeroEntity, ix: number, iz: number, simDt: number, dt: number): void {
    const g = this.ground;
    g.clear();
    const m = this.map;
    const ppu = this.ppu;
    const c = this.colors();
    const hx = m.pxX(ix);
    const hy = m.pxY(iz);
    const step = simDt > 0 ? simDt : dt * 0.25;
    const dead = h.state === 'dead';

    // Passive aura reach while selected (Tinker / Calm Waters).
    const pas = h.stats.passive;
    if (this.selected && !dead && pas.radius > 0) {
      g.circle(hx, hy, pas.radius * ppu).fill({ color: c.main, alpha: 0.07 }).stroke({ width: 2, color: c.main, alpha: 0.45 });
    }

    // Move path + target marker.
    if (this.moveMarker && !dead) {
      const mm = this.moveMarker;
      mm.t += dt;
      const moving = h.state === 'moving';
      if (!moving) mm.t = Math.max(mm.t, 10);
      const fade = moving ? 1 : Math.max(0, 1 - (mm.t - 10) / 0.4);
      if (fade <= 0) this.moveMarker = null;
      else {
        if (moving && h.waypoints.length > 0) {
          let lx = hx;
          let ly = hy;
          for (const wp of h.waypoints) {
            const nx = m.pxX(wp.x);
            const ny = m.pxY(wp.z);
            this.dotted(g, lx, ly, nx, ny, 0xfff0b0, 0.8 * fade);
            lx = nx;
            ly = ny;
          }
        }
        const tx = m.pxX(mm.x);
        const ty = m.pxY(mm.z);
        const p = 1 + 0.12 * Math.sin(this.clock * 8);
        g.ellipse(tx, ty, 0.42 * ppu * p, 0.2 * ppu * p).stroke({ width: 3, color: 0xffd84a, alpha: fade });
        g.ellipse(tx, ty, 0.16 * ppu, 0.08 * ppu).fill({ color: 0xffd84a, alpha: 0.8 * fade });
        // A small pennant on the target.
        g.moveTo(tx, ty).lineTo(tx, ty - 0.7 * ppu).stroke({ width: 2.5, color: 0x5a3a1a, alpha: fade });
        g.poly([tx, ty - 0.7 * ppu, tx + 0.36 * ppu, ty - 0.58 * ppu, tx, ty - 0.46 * ppu]).fill({ color: c.main, alpha: fade }).stroke({ width: 1.5, color: 0x3a2412, alpha: fade });
      }
    }

    // Hover preview of a move order (desktop) / invalid tap cross.
    if (this.hover && this.selected && !dead && !this.aim) {
      const hp = this.hover;
      const x = m.pxX(hp.x);
      const y = m.pxY(hp.z);
      if (hp.valid) {
        g.ellipse(x, y, 0.38 * ppu, 0.18 * ppu).stroke({ width: 2.5, color: 0xfff3c8, alpha: 0.9 });
        this.dotted(g, hx, hy, x, y, 0xfff3c8, 0.45);
      } else this.cross(g, x, y, 0.3 * ppu, 0.6);
    }
    if (this.invalid) {
      this.invalid.t += dt;
      const k = this.invalid.t / 0.6;
      if (k >= 1) this.invalid = null;
      else this.cross(g, m.pxX(this.invalid.x), m.pxY(this.invalid.z), 0.34 * ppu * (1 + 0.2 * k), 1 - k);
    }

    // Skill aim preview.
    const aim = this.aim;
    if (aim && !dead) {
      const col = aim.valid ? c.main : 0x9a8f86;
      const edge = aim.valid ? 0xfff3c8 : 0xc8beb4;
      if (aim.range > 0) {
        const rp = aim.range * ppu;
        g.circle(hx, hy, rp).fill({ color: col, alpha: 0.05 });
        this.dashedCircle(g, hx, hy, rp, edge, 0.75);
      }
      const tx = m.pxX(aim.tx);
      const ty = m.pxY(aim.tz);
      if (aim.shape === 'circle') {
        const p = 1 + 0.04 * Math.sin(this.clock * 7);
        g.circle(tx, ty, aim.radius * ppu * p).fill({ color: aim.valid ? 0xfff3c8 : col, alpha: 0.26 }).stroke({ width: 3, color: edge, alpha: 0.95 });
        g.circle(tx, ty, 4).fill({ color: edge, alpha: 0.95 });
      } else if (aim.shape === 'cone') {
        const ang = Math.atan2(ty - hy, tx - hx);
        const half = (72 * Math.PI) / 180;
        const rp = (aim.radius + 0.45) * ppu;
        g.moveTo(hx, hy).arc(hx, hy, rp, ang - half, ang + half).lineTo(hx, hy).fill({ color: aim.valid ? 0xfff3c8 : col, alpha: 0.3 }).stroke({ width: 3, color: edge, alpha: 0.95 });
      } else if (aim.shape === 'line') {
        const ang = Math.atan2(ty - hy, tx - hx);
        const len = aim.radius * ppu;
        const half = 0.8 * ppu;
        const cx = Math.cos(ang);
        const sy = Math.sin(ang);
        const ex = hx + cx * len;
        const ey = hy + sy * len;
        g.poly([hx - sy * half, hy + cx * half, ex - sy * half, ey + cx * half, ex + cx * half * 0.8, ey + sy * half * 0.8, ex + sy * half, ey - cx * half, hx + sy * half, hy - cx * half])
          .fill({ color: aim.valid ? 0xfff3c8 : col, alpha: 0.28 })
          .stroke({ width: 3, color: edge, alpha: 0.95 });
      } else if (aim.shape === 'towers') {
        g.circle(tx, ty, aim.radius * ppu).stroke({ width: 2, color: edge, alpha: 0.6 });
        for (const tw of aim.towers ?? []) {
          const x = m.pxX(tw.x);
          const y = m.pxY(tw.z);
          g.ellipse(x, y, 0.95 * ppu, 0.5 * ppu).stroke({ width: tw.picked ? 4 : 2, color: tw.picked ? 0xffd84a : edge, alpha: tw.picked ? 1 : 0.6 });
        }
      }
    }

    // Rally banner aura (Bran) while it lasts.
    if (h.rallyBannerTimer > 0 && !dead) {
      const r = h.stats.actives[1].radius * ppu;
      const p = 0.9 + 0.1 * Math.sin(this.clock * 5);
      g.circle(hx, hy, r).fill({ color: c.main, alpha: 0.08 }).stroke({ width: 3, color: c.main, alpha: 0.55 * p });
    }

    // Overhaul gear rings under boosted towers.
    for (const t of world.towers as readonly TowerEntity[]) {
      if (!(t.overhaulTimer && t.overhaulTimer > 0)) continue;
      const x = m.pxX(t.x);
      const y = m.pxY(t.z);
      this.gearRing(g, x, y, 0.95 * ppu, this.clock * 2, HERO_COLORS.tobb.main, 0.9);
      if (this.fx.random() < step * 6) this.fx.spawn('spark', x + (this.fx.random() - 0.5) * ppu, y - (0.8 + this.fx.random() * 1.6) * ppu, 14, 0, -40, 0.5, HERO_COLORS.tobb.light);
    }

    // Persistent fire rings: flame tongues around the rim (the scorch is fxLayer's zone).
    for (const fr of world.heroSystem.fireRings) {
      if (fr.remainingSec <= 0) continue;
      const x = m.pxX(fr.x);
      const y = m.pxY(fr.z);
      const r = fr.radius * ppu;
      g.ellipse(x, y, r, r * 0.57).stroke({ width: 5, color: HERO_COLORS.mira.main, alpha: 0.5 + 0.2 * Math.sin(this.clock * 10) });
      if (this.fx.random() < step * 18) {
        const a = this.fx.random() * Math.PI * 2;
        this.fx.spawn('spark', x + Math.cos(a) * r, y + Math.sin(a) * r * 0.57 - 6, 20, 0, -50, 0.5, this.fx.random() < 0.5 ? HERO_COLORS.mira.main : HERO_COLORS.mira.accent);
      }
    }

    // Skill effects on the ground.
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.t += step;
      const k = e.t / e.life;
      if (k >= 1) {
        this.effects.splice(i, 1);
        continue;
      }
      const ex = m.pxX(e.x);
      const ey = m.pxY(e.z);
      const tx = m.pxX(e.tx);
      const ty = m.pxY(e.tz);
      switch (e.kind) {
        case 'shieldBash': {
          const ang = Math.atan2(ty - ey, tx - ex);
          const half = (72 * Math.PI) / 180;
          const rp = (e.r + 0.45) * ppu * easeOut(Math.min(1, k * 1.6));
          g.moveTo(ex, ey).arc(ex, ey, rp, ang - half, ang + half).lineTo(ex, ey).fill({ color: c.accent, alpha: 0.35 * (1 - k) });
          g.arc(ex, ey, rp, ang - half, ang + half).stroke({ width: 5, color: c.light, alpha: 0.9 * (1 - k) });
          break;
        }
        case 'volley': {
          const r = e.r * ppu;
          g.circle(tx, ty, r).fill({ color: c.main, alpha: 0.12 * (1 - k) }).stroke({ width: 2, color: c.light, alpha: 0.6 * (1 - k) });
          break;
        }
        case 'fireRing': {
          const r = e.r * ppu * (0.6 + 0.4 * easeOut(Math.min(1, k * 2)));
          g.circle(tx, ty, r).stroke({ width: 8 * (1 - k) + 2, color: c.accent, alpha: 0.85 * (1 - k) });
          break;
        }
        case 'wispBurst': {
          const ang = Math.atan2(ty - ey, tx - ex);
          const len = e.r * ppu * easeOut(Math.min(1, k * 2.2));
          const cx = Math.cos(ang);
          const sy = Math.sin(ang);
          g.moveTo(ex, ey).lineTo(ex + cx * len, ey + sy * len).stroke({ width: 1.4 * ppu * (1 - k), color: c.main, alpha: 0.45 * (1 - k), cap: 'round' });
          g.moveTo(ex, ey).lineTo(ex + cx * len, ey + sy * len).stroke({ width: 0.4 * ppu * (1 - k), color: c.light, alpha: 0.8 * (1 - k), cap: 'round' });
          break;
        }
        case 'undertow': {
          const r = e.r * ppu;
          const fade = k < 0.15 ? k / 0.15 : k > 0.75 ? (1 - k) / 0.25 : 1;
          g.circle(tx, ty, r).fill({ color: 0x2a8fa0, alpha: 0.22 * fade });
          for (let s = 0; s < 3; s++) {
            const a0 = this.clock * (2.2 + s * 0.6) + s * 2.1;
            const rr = r * (0.35 + s * 0.25);
            g.arc(tx, ty, rr, a0, a0 + Math.PI * 1.1).stroke({ width: 3, color: s === 1 ? c.accent : c.main, alpha: 0.75 * fade });
          }
          if (this.fx.random() < step * 10 * fade) {
            const a = this.fx.random() * Math.PI * 2;
            const rr = this.fx.random() * r;
            this.fx.spawn('orb', tx + Math.cos(a) * rr, ty + Math.sin(a) * rr, 12, 0, -30, 0.5, c.light);
          }
          break;
        }
        case 'overhaul': {
          this.gearRing(g, tx, ty, e.r * ppu * (0.5 + 0.5 * k), k * 4, c.main, 1 - k);
          break;
        }
        case 'huntersMark': {
          const r = e.r * ppu * (1.2 - 0.6 * k);
          g.circle(tx, ty, r).stroke({ width: 3, color: 0xff5a3a, alpha: 1 - k });
          break;
        }
        default:
          break;
      }
    }
  }

  /** Above the actors: rally banner, lightning crown for Thunder Call. */
  private drawTop(world: SimWorld, h: HeroEntity, simDt: number, dt: number): void {
    const g = this.top;
    g.clear();
    void world;
    void simDt;
    void dt;
    if (h.state === 'dead' || !this.body.visible) return;
    const m = this.map;
    const ppu = this.ppu;
    if (h.rallyBannerTimer > 0) {
      // Ironoak standard planted beside Bran: pole, green pennant with a bronze oak disc.
      const bx = this.body.x - this.anim.facing * 0.55 * ppu;
      const by = this.body.y;
      const top = by - 2.1 * ppu;
      const wave = Math.sin(this.clock * 5) * 0.08 * ppu;
      const c = HERO_COLORS.bran;
      g.moveTo(bx, by).lineTo(bx, top).stroke({ width: 3.5, color: 0x5a3a1a });
      g.circle(bx, top, 3).fill({ color: c.accent });
      g.poly([bx, top + 4, bx + 0.8 * ppu, top + 4 + wave, bx + 0.72 * ppu, top + 0.62 * ppu + wave, bx + 0.4 * ppu, top + 0.5 * ppu, bx, top + 0.7 * ppu])
        .fill({ color: c.main })
        .stroke({ width: 2, color: 0x3a2412 });
      g.circle(bx + 0.38 * ppu, top + 0.32 * ppu + wave * 0.5, 0.13 * ppu).fill({ color: c.accent }).stroke({ width: 1.5, color: 0x3a2412 });
    }
    void m;
  }

  private syncGizmos(world: SimWorld, dt: number): void {
    const m = this.map;
    const ppu = this.ppu;
    const seen = new Set<number>();
    for (const gz of world.heroSystem.gizmos) {
      seen.add(gz.id);
      let v = this.gizmoViews.get(gz.id);
      if (!v) {
        v = this.makeGizmo();
        this.layers.actors.addChild(v);
        this.gizmoViews.set(gz.id, v);
      }
      const x = m.pxX(gz.x);
      const y = m.pxY(gz.z);
      v.position.set(x, y);
      v.zIndex = y;
      v.scale.set(ppu / 64);
      const barrel = v.getChildByLabel('barrel');
      if (barrel) {
        const sx = Math.sin(gz.yaw);
        const sz = Math.cos(gz.yaw);
        barrel.rotation = Math.atan2(sz * 0.6, sx);
      }
      const timer = v.getChildByLabel('timer') as Graphics | null;
      if (timer) {
        const total = Math.max(gz.remainingSec, 0.01);
        timer.clear();
        const frac = Math.min(1, total / 12);
        timer.arc(0, 4, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac).stroke({ width: 4, color: gz.boostTimer > 0 ? 0x9ff0ff : HERO_COLORS.tobb.main, alpha: 0.8 });
      }
      v.alpha = gz.remainingSec < 0.6 ? Math.max(0, gz.remainingSec / 0.6) : 1;
    }
    for (const [id, v] of this.gizmoViews) {
      if (seen.has(id)) continue;
      this.fx.puffs(v.x, v.y - 10, 6, 14, 0xe9d8b4);
      v.destroy({ children: true });
      this.gizmoViews.delete(id);
    }
    void dt;
  }

  /** Tobb's little brass auto-turret (procedural; 64 px = 1 world unit). */
  private makeGizmo(): Container {
    const c = new Container();
    const brass = HERO_COLORS.tobb.main;
    const timer = new Graphics();
    timer.label = 'timer';
    const base = new Graphics()
      .ellipse(0, 4, 26, 12)
      .fill({ color: 0x2a1a0c, alpha: 0.35 })
      .moveTo(-16, 2)
      .lineTo(-22, 12)
      .moveTo(16, 2)
      .lineTo(22, 12)
      .moveTo(0, 2)
      .lineTo(0, 14)
      .stroke({ width: 4, color: 0x5a3a1a, cap: 'round' })
      .roundRect(-16, -22, 32, 24, 7)
      .fill({ color: brass })
      .stroke({ width: 3, color: 0x3a2412 })
      .circle(0, -10, 6)
      .fill({ color: 0x9ff0ff })
      .stroke({ width: 2, color: 0x3a2412 });
    const barrel = new Graphics().roundRect(0, -5, 26, 10, 4).fill({ color: 0x8a5a2a }).stroke({ width: 2.5, color: 0x3a2412 });
    barrel.label = 'barrel';
    barrel.position.set(0, -14);
    c.addChild(timer, base, barrel);
    return c;
  }

  /** Hunter's Mark reticles over marked foes. */
  private syncReticles(world: SimWorld, alpha: number): void {
    const pool = world.enemyPool;
    const m = this.map;
    const ppu = this.ppu;
    let n = 0;
    for (let i = 0; i < pool.getActiveCount(); i++) {
      const e = pool.items[pool.getActiveIndex(i)];
      if (!e.active || e.hp <= 0 || !(e.markTimer > 0)) continue;
      let s = this.reticles[n];
      if (!s) {
        s = new Sprite(this.tex.wring);
        s.anchor.set(0.5);
        s.tint = 0xff5a3a;
        this.layers.bars.addChild(s);
        this.reticles[n] = s;
      }
      n++;
      const ex = e.prevX + (e.x - e.prevX) * alpha;
      const ez = e.prevZ + (e.z - e.prevZ) * alpha;
      const y = m.pxY(ez) - (e.y + e.height * 0.55) * HEIGHT_TO_SCREEN * ppu;
      s.visible = true;
      s.position.set(m.pxX(ex), y);
      const p = 1 + 0.1 * Math.sin(this.clock * 8);
      s.scale.set(((0.5 + e.radius) * ppu * 2 * p) / 128);
      s.rotation = this.clock * 1.5;
      s.alpha = Math.min(1, e.markTimer * 2);
    }
    for (let i = n; i < this.reticles.length; i++) this.reticles[i].visible = false;
  }

  private syncArrows(simDt: number): void {
    for (const a of this.arrows) {
      if (!a.active) continue;
      a.t += simDt;
      const k = (a.t - a.delay) / 0.32;
      if (k < 0) {
        a.s.visible = false;
        continue;
      }
      if (k >= 1) {
        a.active = false;
        a.s.visible = false;
        this.fx.spawn('puff', a.x1, a.y1, 10, 0, -6, 0.3, 0xe9d8b4);
        continue;
      }
      a.s.visible = true;
      a.s.position.set(a.x0 + (a.x1 - a.x0) * k, a.y0 + (a.y1 - a.y0) * k);
      a.s.rotation = Math.atan2(a.y1 - a.y0, a.x1 - a.x0);
      a.s.scale.set(0.7);
      a.s.tint = HERO_COLORS.wren.accent;
    }
  }

  private dotted(g: Graphics, x0: number, y0: number, x1: number, y1: number, color: number, alpha: number): void {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.floor(d / 12);
    for (let i = 1; i <= n; i++) {
      const k = i / (n + 1);
      g.circle(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, 2.4);
    }
    if (n > 0) g.fill({ color, alpha });
  }

  private dashedCircle(g: Graphics, x: number, y: number, r: number, color: number, alpha: number): void {
    const n = Math.max(12, Math.round((r * Math.PI * 2) / 16));
    for (let i = 0; i < n; i += 1) {
      const a0 = (i / n) * Math.PI * 2 + this.clock * 0.3;
      g.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r).arc(x, y, r, a0, a0 + (Math.PI * 2) / n / 1.8);
    }
    g.stroke({ width: 2.5, color, alpha });
  }

  private cross(g: Graphics, x: number, y: number, s: number, alpha: number): void {
    g.moveTo(x - s, y - s * 0.6).lineTo(x + s, y + s * 0.6).moveTo(x + s, y - s * 0.6).lineTo(x - s, y + s * 0.6).stroke({ width: 7, color: 0x3a2412, alpha, cap: 'round' });
    g.moveTo(x - s, y - s * 0.6).lineTo(x + s, y + s * 0.6).moveTo(x + s, y - s * 0.6).lineTo(x - s, y + s * 0.6).stroke({ width: 4, color: 0xe0503a, alpha, cap: 'round' });
  }

  private gearRing(g: Graphics, x: number, y: number, r: number, rot: number, color: number, alpha: number): void {
    g.ellipse(x, y, r, r * 0.52).stroke({ width: 3, color, alpha: alpha * 0.85 });
    const teeth = 12;
    for (let i = 0; i < teeth; i++) {
      const a = rot + (i / teeth) * Math.PI * 2;
      const cx = x + Math.cos(a) * r;
      const cy = y + Math.sin(a) * r * 0.52;
      g.circle(cx, cy, 3.2);
    }
    g.fill({ color, alpha });
  }

  /** QA snapshot. */
  debug(): Record<string, unknown> {
    const r = this.bodyRect();
    return {
      art: this.art ? this.art.id : null,
      visible: this.body.visible,
      alpha: Math.round(this.body.alpha * 100) / 100,
      selected: this.selected,
      feet: this.heroId ? { x: Math.round(this.body.x), y: Math.round(this.body.y) } : null,
      body: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) } : null,
      effects: this.effects.map((e) => e.kind),
      gizmos: this.gizmoViews.size,
      aim: this.aim ? this.aim.shape : null,
      hover: this.hover,
      ...this.stats,
    };
  }
}
