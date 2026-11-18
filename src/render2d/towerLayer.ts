import { Sprite, Texture } from 'pixi.js';
import type { EventBus, GameEventMap } from '../core/eventBus.ts';
import type { TowerType } from '../core/types.ts';
import type { TowerEntity } from '../sim/entities.ts';
import { mixTint } from './artResolve.ts';
import type { LoadedArt, TowerArtRuntime, TowerSheetRuntime, TurretRuntime } from './assets2d.ts';
import type { FxLayer } from './fxLayer.ts';
import { HEIGHT_TO_SCREEN, type WorldLayers } from './layers.ts';
import type { MapView } from './mapView.ts';
import type { PlotGeometry } from './plotLayer.ts';
import type { ProcTextures } from './procTextures.ts';
import { attackFrame, attackPlan, idleFrame, onShot, PREROLL_GRACE, prerollStart, shotEta, shouldPreroll, type AttackPlan } from './towerAnim.ts';
import { fitOnRing, ringMuzzle, type RingPlacement, type RingSpec, type SpriteFit } from './towerFit.ts';
import {
  aimedSpriteMuzzle,
  bodyAimPose,
  DEFAULT_SECTOR,
  frameFor,
  mountPoint,
  pickSector,
  recoilCurve,
  recoilOffset,
  sectorVector,
  spriteMuzzle,
  turretMuzzle,
  turretScale,
  yawToScreenAngle,
} from './turret.ts';

/** Directional shooters that aim via whole-sprite mirror + tilt until 5-direction turret art lands. */
const BODY_AIM_TOWERS: ReadonlySet<TowerType> = new Set(['mortar']);

/** Turret recoil per tower type: duration (s) and push-back as a share of the turret frame height. */
export const TURRET_RECOIL: Readonly<Partial<Record<TowerType, { readonly dur: number; readonly frac: number }>>> = {
  cannon: { dur: 0.16, frac: 0.07 },
  ballista: { dur: 0.14, frac: 0.05 },
  archer: { dur: 0.1, frac: 0.025 },
};
const DEFAULT_RECOIL = { dur: 0.12, frac: 0.04 };

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

export interface TurretReportRow {
  readonly id: number;
  readonly type: string;
  readonly tier: number;
  readonly sector: number;
  readonly aimed: boolean;
  readonly targetYaw: number;
  readonly mirror: boolean;
  readonly frame: number;
  readonly muzzle: { x: number; y: number } | null;
  readonly mount: { x: number; y: number };
  /** Plot centre (map px). */
  readonly px: number;
  readonly py: number;
}

const JAM_TINT = 0xb9a0d8;
/**
 * Ring-convention art without an attack sheet keeps only a gentle vertical squash of the kick
 * (anchored at the ring bottom, so the ring stays on the plot): this share of the profile's squash.
 */
const RING_SQUASH = 0.35;

interface TowerView {
  readonly sprite: Sprite;
  /** Aimable turret piece (created on first use), drawn right above the body. */
  turret: Sprite | null;
  /** The sim tower this view draws (latest), for the aim on shots. */
  entity: TowerEntity;
  /** Turret direction (index into turret.ts SECTORS) and whether it ever had a target. */
  sector: number;
  aimed: boolean;
  /** Mirror / tilt state for directional shooters without a separate turret strip (mortar). */
  bodyMirror: boolean;
  bodyRot: number;
  /** Sim seconds since the last shot (turret recoil), -1 = at rest. */
  recoilT: number;
  /** Turret drawn this frame: its spec, foot point on the platform (map px) and scale. */
  turretArt: TurretRuntime | null;
  mount: { x: number; y: number };
  turretScale: number;
  /** Where shots leave as drawn now (map px, recoil excluded), or null (height-only muzzle). */
  muzzlePt: { x: number; y: number } | null;
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
  /** Painted attack playback: sim seconds since the shot (-1 = not playing). */
  attackT: number;
  attackSheet: TowerSheetRuntime | null;
  attackPlan: AttackPlan | null;
  /** Muzzle FX waiting for the release frame. */
  pending: GameEventMap['towerFired'] | null;
  /** The sheet was pre-rolled for the upcoming shot. */
  armed: boolean;
  /** Projectile delay (sim s after spawn) of the latest shot. */
  shotDelay: number;
  /** Observed cooldown drain (cooldown s per sim s) and the last cooldown seen. */
  drain: number;
  prevCd: number;
  /** Muzzle height (world units) of the art currently drawn. */
  muzzle: number;
  /** Top / middle of the drawn tower (map px), for markers. */
  topY: number;
  midY: number;
  /** Ring as drawn this frame (ring-convention art), for QA. */
  ring: RingPlacement | null;
  readonly ringScratch: { cx: number; bottom: number; width: number };
  readonly fitStatic: { scale: number; anchorX: number; anchorY: number; x: number; y: number };
  readonly fitFrame: { scale: number; anchorX: number; anchorY: number; x: number; y: number };
  cachedSheetPlan: AttackPlan | null;
  cachedPlanSheet: TowerSheetRuntime | null;
}

/**
 * Tower sprites on plots. Ring-convention art (manifest `ring`) is fitted onto its plot by
 * towerFit.ts: ring width = plot ring width, ring bottom-centre on the plot ring's bottom-centre,
 * with no recoil / flip / wobble / tier growth (which would lift the ring off the plot); a painted
 * attack sheet plays once per shot (projectile and muzzle FX wait for its release frame), an idle
 * sheet loops. Legacy art keeps the old height + anchor placement and procedural kick. Also: aim
 * flip (legacy), build / upgrade pop, the jammed-tower marker and the Beacon buff glow. Views are
 * created lazily per tower id and removed when the tower is sold.
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
  private readonly plots: PlotGeometry | null;
  private readonly hasTarget: (t: TowerEntity) => boolean;
  /** Lifetime counters (QA). */
  firedSeen = 0;
  specialSeen = 0;
  attacksPlayed = 0;
  /** QA: shots drawn by an aimable turret (muzzle FX at its measured muzzle). */
  turretShots = 0;
  /** QA: shots whose sheet was pre-rolled (release on the shot) vs started on the shot (delayed). */
  shotsPrerolled = 0;
  shotsDelayed = 0;

  /**
   * `hasTarget(t)`: the tower has something to shoot right now (drives the attack-sheet pre-roll;
   * render-side estimate, the sim is not asked).
   */
  constructor(
    art: LoadedArt,
    map: MapView,
    layers: WorldLayers,
    tex: ProcTextures,
    fx: FxLayer | null = null,
    plots: PlotGeometry | null = null,
    hasTarget: (t: TowerEntity) => boolean = () => false,
  ) {
    this.art = art;
    this.map = map;
    this.layers = layers;
    this.tex = tex;
    this.fx = fx;
    this.plots = plots;
    this.hasTarget = hasTarget;
  }

  /** Wires the tower events this layer animates. */
  bind(ev: EventBus): void {
    ev.on('towerFired', (e) => this.onFired(e));
    ev.on('beaconPulse', (e) => {
      const v = this.views.get(e.towerId);
      if (v) {
        v.kick = 1;
        v.prof = fireProfile('beacon');
        this.playDecorative(v, 'beacon', e.tier, true);
      }
    });
    // Barracks: the gate sheet plays as a soldier steps out (once per burst, not per soldier).
    ev.on('soldierSpawned', (e) => {
      const v = this.views.get(e.towerId);
      if (v) this.playDecorative(v, 'barracks', v.tier, false);
    });
  }

  /** Non-shooting towers (beacon pulse, barracks gate): play the attack sheet from frame 0, no shot. */
  private playDecorative(v: TowerView, type: TowerType, tier: number, restart: boolean): void {
    const sheet = this.attackOf(type, tier);
    if (!sheet) return;
    if (!restart && v.attackT >= 0 && v.attackSheet === sheet) return;
    v.attackSheet = sheet;
    v.attackPlan = attackPlan({ count: sheet.frames.length, fps: sheet.fps, release: null });
    v.attackT = 0;
    v.armed = false;
    v.pending = null;
    this.attacksPlayed++;
  }

  /** Stone ring (texture px) of the tier art a tower draws, or null for legacy art. */
  ringOf(type: TowerType, tier: number): RingSpec | null {
    return this.art.towers[type]?.rings[Math.max(1, Math.min(3, tier)) - 1] ?? null;
  }

  /** Painted attack sheet of a tower tier, or null. */
  private attackOf(type: TowerType, tier: number): TowerSheetRuntime | null {
    return this.art.towers[type]?.attack[Math.max(1, Math.min(3, tier)) - 1] ?? null;
  }

  /** Sim seconds from the start of a tier's attack sheet to its release frame (0 = no sheet / release). */
  releaseDelay(type: TowerType, tier: number): number {
    const s = this.attackOf(type, tier);
    return s ? attackPlan({ count: s.frames.length, fps: s.fps, release: s.release }).releaseDelay : 0;
  }

  /** Projectile delay (sim s after its spawn) for a tower's latest shot. */
  shotDelayOf(towerId: number): number {
    return this.views.get(towerId)?.shotDelay ?? 0;
  }

  /**
   * Delay a shot fired NOW would get (tesla bolts: the chain event comes just before towerFired):
   * what is left of a pre-rolled sheet, else the full release delay.
   */
  predictShotDelay(towerId: number, type: TowerType, tier: number): number {
    const full = this.releaseDelay(type, tier);
    const v = this.views.get(towerId);
    if (!v || full <= 0) return full;
    return onShot(v.armed && v.attackT >= 0, v.attackT, full).shotDelay;
  }

  /** Tower fired (event): painted attack / procedural kick, muzzle flash and the tier flourish. */
  onFired(e: GameEventMap['towerFired']): void {
    const v = this.views.get(e.towerId);
    if (!v) return;
    this.firedSeen++;
    const prof = fireProfile(e.type);
    v.kick = 1;
    v.prof = prof;
    const dx = Math.sin(e.yaw);
    v.dirX = Math.abs(dx) > 0.05 ? Math.sign(dx) : v.dirX;
    if (Math.abs(dx) > 0.15) v.aim = dx > 0 ? 1 : -1;
    if (v.turretArt) {
      // Face the target the sim just shot at (targetYaw is exact; the sim's turning yaw may lag).
      v.sector = pickSector(yawToScreenAngle(v.entity.targetYaw), v.aimed ? v.sector : -1);
      v.aimed = true;
      v.recoilT = 0;
      v.muzzlePt = turretMuzzle(v.turretArt.spec, v.sector, v.mount, v.turretScale);
    } else if (BODY_AIM_TOWERS.has(e.type)) {
      const pose = bodyAimPose(yawToScreenAngle(v.entity.targetYaw), v.aimed ? v.sector : -1, v.bodyMirror);
      v.sector = pose.sector;
      v.bodyMirror = pose.mirror;
      v.bodyRot = pose.rotation;
      v.aimed = true;
      const tierIdx = Math.max(1, Math.min(3, e.tier)) - 1;
      const target = this.plots?.rings[v.entity.col];
      const ring = v.art?.rings[tierIdx];
      const tip = v.art?.spec.muzzlePx[tierIdx];
      if (v.art && target && ring && tip) {
        const stat = v.art.tiers[tierIdx];
        const fit = fitOnRing(target, ring, stat.width, stat.height, v.art.spec.ringScale);
        v.muzzlePt = aimedSpriteMuzzle(fit, ring, tip, v.bodyMirror, v.bodyRot);
      }
    }
    const sheet = this.attackOf(e.type, e.tier);
    v.shotDelay = 0;
    if (sheet) {
      // Pre-rolled for this shot: keep playing (release lands now); otherwise restart from frame 0.
      const plan = attackPlan({ count: sheet.frames.length, fps: sheet.fps, release: sheet.release });
      const kept = v.armed && v.attackSheet === sheet && v.attackT >= 0;
      const r = onShot(kept, v.attackT, plan.releaseDelay);
      if (!kept || r.elapsed === 0) this.attacksPlayed++;
      if (kept && r.elapsed > 0) this.shotsPrerolled++;
      else this.shotsDelayed++;
      v.attackSheet = sheet;
      v.attackPlan = plan;
      v.attackT = r.elapsed;
      v.shotDelay = r.shotDelay;
      v.armed = false;
      if (r.shotDelay > 0) {
        v.pending = e;
        return;
      }
    }
    this.muzzleFx(v, e);
  }

  private muzzleFx(v: TowerView, e: GameEventMap['towerFired']): void {
    const fx = this.fx;
    if (!fx) return;
    const prof = fireProfile(e.type);
    const big = e.tier >= 3 ? 1.3 : e.tier === 2 ? 1.12 : 1;
    if (v.turretArt && v.muzzlePt) {
      this.turretShots++;
      if (e.type !== 'mortar') {
        this.turretFx(v, e, prof, big);
        return;
      }
      // Mortars use their rising smoke plume at the painted muzzle below.
    }
    const dx = Math.sin(e.yaw);
    const dy = Math.cos(e.yaw);
    const ppu = this.map.layout.pxPerUnit;
    const mx = v.muzzlePt ? v.muzzlePt.x : v.px + dx * 12;
    const my = v.muzzlePt ? v.muzzlePt.y : v.py - v.muzzle * HEIGHT_TO_SCREEN * ppu + dy * 6;
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
        for (let i = 0; i < 4; i++) {
          fx.spawn('puff', mx + (i - 1.5) * 4, my, (11 + i * 2) * big, (i - 1.5) * 8 + dx * 16, -58 - i * 12 + dy * 8, 0.5 + i * 0.07, 0xa89c8e);
        }
        fx.spawn('wring', v.px, v.py + 2, 24 * big, 0, 0, 0.32, 0xd9c29a);
        break;
      case 'bolt':
        fx.spawn('spark', mx, my, 14 * big, 0, 0, 0.16, 0xffe9b0);
        fx.beam(mx - dx * 16, my - dy * 8, mx + dx * 22, my + dy * 11, 0xffe9b0, 2.6, 0.14);
        break;
      default:
        break;
    }
    this.flourish(v, e, prof, mx, my);
  }

  /** Tier signature flourish (archer volley, tesla overload) / the plain T3 ring. */
  private flourish(v: TowerView, e: GameEventMap['towerFired'], prof: FireProfile, mx: number, my: number): void {
    const fx = this.fx;
    if (!fx) return;
    if (e.special) {
      // Ring + sparks in the tower's accent colour.
      this.specialSeen++;
      fx.spawn('wring', v.px, v.py, 38, 0, 0, 0.5, prof.accent);
      fx.spawn('orb', mx, my, 52, 0, 0, 0.3, prof.accent);
      fx.burst('spark', mx, my, 7, 10, 80, 0.5, prof.accent);
    } else if (e.tier >= 3 && prof.flash !== 'none') {
      fx.spawn('wring', v.px, v.py, 20, 0, 0, 0.24, prof.accent);
    }
  }

  /**
   * Muzzle FX of an aimable turret at its measured muzzle, along the direction it faces: cannon
   * flash + smoke, ballista dust + a string-twang streak, archer a small glint.
   */
  private turretFx(v: TowerView, e: GameEventMap['towerFired'], prof: FireProfile, big: number): void {
    const fx = this.fx;
    const m = v.muzzlePt;
    if (!fx || !m) return;
    const d = sectorVector(v.sector);
    const k = v.turretScale * (v.turretArt?.spec.frameH ?? 200);
    switch (e.type) {
      case 'cannon':
        fx.spawn('flash', m.x + d.x * 4, m.y + d.y * 3, 30 * big, 0, 0, 0.12, 0xffc070);
        fx.spawn('glow', m.x, m.y, 22 * big, 0, 0, 0.16, 0xffa24a);
        for (let i = 0; i < 3; i++) {
          fx.spawn('puff', m.x + d.x * (4 + i * 5), m.y + d.y * (3 + i * 4), (8 + i * 3) * big, d.x * (46 + i * 20), d.y * (34 + i * 14) - 12, 0.38 + i * 0.08, 0xb9b0a2);
        }
        break;
      case 'ballista': {
        fx.spawn('spark', m.x, m.y, 12 * big, d.x * 30, d.y * 20, 0.14, 0xffe9b0);
        // The string snaps forward: a short streak across the bow, perpendicular to the aim.
        const px = -d.y;
        const py = d.x * 0.7;
        const c = { x: v.mount.x + (m.x - v.mount.x) * 0.45, y: v.mount.y + (m.y - v.mount.y) * 0.45 };
        const half = k * 0.22;
        fx.beam(c.x - px * half, c.y - py * half, c.x + px * half, c.y + py * half, 0xfff4d8, 2.2, 0.1);
        for (let i = 0; i < 2; i++) fx.spawn('puff', v.mount.x + (i - 0.5) * k * 0.3, v.mount.y, 7 * big, (i - 0.5) * 30, -10, 0.32, 0xd9c29a);
        break;
      }
      case 'archer':
        fx.spawn('spark', m.x, m.y, 9 * big, d.x * 16, d.y * 12, 0.12, 0xfff2c4);
        break;
      default:
        fx.spawn('spark', m.x, m.y, 10 * big, 0, 0, 0.14, prof.accent);
        break;
    }
    this.flourish(v, e, prof, m.x, m.y);
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
      turret: null,
      entity: t,
      sector: DEFAULT_SECTOR,
      aimed: false,
      bodyMirror: false,
      bodyRot: 0,
      recoilT: -1,
      turretArt: null,
      mount: { x: 0, y: 0 },
      turretScale: 1,
      muzzlePt: null,
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
      attackT: -1,
      attackSheet: null,
      attackPlan: null,
      pending: null,
      armed: false,
      shotDelay: 0,
      drain: 1,
      prevCd: t.cooldownTimer,
      muzzle: art ? art.spec.muzzle : 2,
      topY: 0,
      midY: 0,
      ring: null,
      ringScratch: { cx: 0, bottom: 0, width: 0 },
      fitStatic: { scale: 1, anchorX: 0.5, anchorY: 1, x: 0, y: 0 },
      fitFrame: { scale: 1, anchorX: 0.5, anchorY: 1, x: 0, y: 0 },
      cachedSheetPlan: null,
      cachedPlanSheet: null,
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

  /** Places a ring-convention tower; returns false when it cannot (no plot geometry). */
  private syncRing(v: TowerView, t: TowerEntity, tierRing: RingSpec, art: TowerArtRuntime, simDt: number, py: number): boolean {
    const target = this.plots?.rings[t.col];
    if (!target) return false;
    const ppu = this.map.layout.pxPerUnit;
    const tierIdx = Math.max(1, Math.min(3, t.tier)) - 1;
    // A turret tier draws its body (own ring) under the turret instead of the full-tower picture.
    const turret = art.turrets?.[tierIdx] ?? null;
    const ring = turret ? turret.ring : tierRing;
    // Pre-roll the attack sheet so its release frame lands on the coming shot (towerAnim.ts).
    const sheetNow = art.attack[tierIdx];
    if (simDt > 0) {
      const d = v.prevCd - t.cooldownTimer;
      if (d > 0) v.drain = v.drain * 0.6 + (d / simDt) * 0.4;
    }
    v.prevCd = t.cooldownTimer;
    if (sheetNow) {
      if (v.cachedPlanSheet !== sheetNow || !v.cachedSheetPlan) {
        v.cachedPlanSheet = sheetNow;
        v.cachedSheetPlan = attackPlan({ count: sheetNow.frames.length, fps: sheetNow.fps, release: sheetNow.release });
      }
      const plan = v.cachedSheetPlan;
      if (v.armed && v.attackT > plan.releaseDelay + PREROLL_GRACE) v.armed = false;
      const busy = v.attackT >= 0 && v.attackPlan !== null && v.attackT < v.attackPlan.releaseDelay;
      if (
        !busy &&
        shouldPreroll({
          hasTarget: t.stunTimer <= 0 && this.hasTarget(t),
          eta: shotEta(t.cooldownTimer, v.drain),
          releaseDelay: plan.releaseDelay,
          armed: v.armed,
        })
      ) {
        v.attackSheet = sheetNow;
        v.attackPlan = plan;
        v.attackT = prerollStart(plan.releaseDelay, shotEta(t.cooldownTimer, v.drain), simDt);
        v.armed = true;
      }
    }
    const stat = turret ? turret.body : art.tiers[tierIdx];
    // Static fit (also the muzzle reference, so shots leave the same spot with or without sheets).
    const fit = v.fitStatic;
    fit.scale = (target.width * (art.spec.ringScale ?? 1)) / Math.max(1e-6, ring.ringWidthPx);
    fit.anchorX = ring.ringCenterXPx / Math.max(1, stat.width);
    fit.anchorY = ring.ringBottomPx / Math.max(1, stat.height);
    fit.x = target.cx;
    fit.y = target.bottom;
    v.muzzle = ringMuzzle(fit, ring, py, art.spec.muzzleFrac, HEIGHT_TO_SCREEN * ppu);
    v.turretArt = turret;
    const bodyAim = !turret && BODY_AIM_TOWERS.has(t.type);
    if (bodyAim && t.stunTimer <= 0 && this.hasTarget(t)) {
      const pose = bodyAimPose(yawToScreenAngle(t.targetYaw), v.aimed ? v.sector : -1, v.bodyMirror);
      v.sector = pose.sector;
      v.bodyMirror = pose.mirror;
      v.bodyRot = pose.rotation;
      v.aimed = true;
    }
    const tip = turret ? null : art.spec.muzzlePx[tierIdx];
    v.muzzlePt = tip
      ? bodyAim && v.aimed
        ? aimedSpriteMuzzle(fit, ring, tip, v.bodyMirror, v.bodyRot)
        : spriteMuzzle(fit, ring, tip)
      : null;
    let tex: Texture = stat;
    let texRing = ring;
    let texW = stat.width;
    let texH = stat.height;
    let painted = false;
    if (v.attackT >= 0 && v.attackSheet && v.attackPlan) {
      const sheet = v.attackSheet;
      v.attackT += simDt;
      if (v.pending && v.attackT >= v.attackPlan.releaseDelay) {
        this.muzzleFx(v, v.pending);
        v.pending = null;
      }
      const f = attackFrame(v.attackPlan, { count: sheet.frames.length, fps: sheet.fps, release: sheet.release }, v.attackT);
      if (f === null) {
        v.attackT = -1;
      } else {
        tex = sheet.frames[f];
        texRing = sheet.ring;
        texW = sheet.frameW;
        texH = sheet.frameH;
        painted = true;
      }
    }
    const idle = art.idle[tierIdx];
    if (!painted && idle) {
      tex = idle.frames[idleFrame(idle.frames.length, idle.fps, this.time + t.id * 0.37)];
      texRing = idle.ring;
      texW = idle.frameW;
      texH = idle.frameH;
      painted = true;
    }
    let f2: SpriteFit = fit;
    if (tex !== stat) {
      const ff = v.fitFrame;
      ff.scale = (target.width * (art.spec.ringScale ?? 1)) / Math.max(1e-6, texRing.ringWidthPx);
      ff.anchorX = texRing.ringCenterXPx / Math.max(1, texW);
      ff.anchorY = texRing.ringBottomPx / Math.max(1, texH);
      ff.x = target.cx;
      ff.y = target.bottom;
      f2 = ff;
    }
    if (v.sprite.texture !== tex) v.sprite.texture = tex;
    v.sprite.anchor.set(f2.anchorX, f2.anchorY);
    const pop = t.popAnimTimer > 0 ? Math.sin((t.popAnimTimer / 0.32) * Math.PI) * 0.1 : 0;
    // Painted sheets carry their own motion; a static sprite keeps a gentle squash on the ring bottom
    // (a turret tower's body stays still: only its turret recoils).
    const squash = painted || v.attackSheet || turret ? 0 : v.prof.squashY * RING_SQUASH * v.kick;
    const pulse = painted || turret ? 0 : v.prof.pulse * 0.5 * Math.sin(v.kick * Math.PI);
    const mirrorSign = bodyAim && v.aimed && v.bodyMirror ? -1 : 1;
    v.sprite.scale.set(f2.scale * (1 + pop * 0.5 + pulse) * mirrorSign, f2.scale * (1 + pop - squash + pulse));
    v.sprite.rotation = bodyAim && v.aimed ? v.bodyRot : 0;
    v.sprite.position.set(f2.x, f2.y);
    v.sprite.zIndex = f2.y;
    v.ringScratch.cx = f2.x;
    v.ringScratch.bottom = f2.y;
    v.ringScratch.width = texRing.ringWidthPx * f2.scale;
    v.ring = v.ringScratch;
    const h = ring.ringBottomPx * fit.scale;
    v.topY = fit.y - h;
    v.midY = fit.y - h * 0.55;
    if (turret) this.syncTurret(v, t, turret, fit, ring, 1 + pop * 0.5, 1 + pop, simDt);
    else if (v.turret) v.turret.visible = false;
    if (bodyAim) {
      v.mount.x = fit.x;
      v.mount.y = fit.y;
    }
    if (v.muzzlePt) v.muzzle = Math.max(0.2, (py - v.muzzlePt.y) / (HEIGHT_TO_SCREEN * ppu));
    // The plot layer draws the contact shadow under every plot (covered or not).
    v.shadow.visible = false;
    return true;
  }

  /**
   * Aim + draw the turret piece on the body's platform: direction from the screen angle to the
   * sim's current target (hysteresis at sector borders; idle keeps the last one, SE before the
   * first target), mirrored for W / SW / NW, recoil after a shot.
   */
  private syncTurret(v: TowerView, t: TowerEntity, tur: TurretRuntime, fit: SpriteFit, ring: RingSpec, popX: number, popY: number, simDt: number): void {
    if (t.stunTimer <= 0 && this.hasTarget(t)) {
      v.sector = pickSector(yawToScreenAngle(t.targetYaw), v.aimed ? v.sector : -1);
      v.aimed = true;
    }
    const spec = tur.spec;
    const mount = mountPoint(fit, ring, spec.bodyMount, fit.scale * popX, fit.scale * popY);
    const ts = turretScale(fit.scale, spec);
    v.mount = mount;
    v.turretScale = ts;
    v.muzzlePt = turretMuzzle(spec, v.sector, mount, ts);
    let s = v.turret;
    if (!s) {
      s = new Sprite(tur.frames[0]);
      this.layers.actors.addChild(s);
      v.turret = s;
    }
    const { frame, mirror } = frameFor(v.sector);
    const tex = tur.frames[frame];
    if (s.texture !== tex) s.texture = tex;
    s.anchor.set(spec.pivot[0] / spec.frameW, spec.pivot[1] / spec.frameH);
    const rc = TURRET_RECOIL[t.type] ?? DEFAULT_RECOIL;
    if (v.recoilT >= 0) {
      v.recoilT += simDt;
      if (v.recoilT >= rc.dur) v.recoilT = -1;
    }
    const kick = v.recoilT >= 0 ? recoilCurve(v.recoilT, rc.dur) : 0;
    const off = recoilOffset(v.sector, kick * rc.frac * spec.frameH * ts);
    s.visible = true;
    s.position.set(mount.x + off.x, mount.y + off.y);
    s.scale.set(ts * popX * (mirror ? -1 : 1), ts * popY);
    s.rotation = 0;
    // Right above its own body (bodies sort by ring bottom y).
    s.zIndex = fit.y + 0.01;
    v.topY = Math.min(v.topY, mount.y - spec.pivot[1] * ts);
  }

  /** `dt`: real seconds (idle effects); `simDt`: sim seconds (attack playback, in step with shots). */
  sync(towers: readonly TowerEntity[], dt: number, simDt = dt): void {
    this.frameNo++;
    this.time += dt;
    const time = this.time;
    const ppu = this.map.layout.pxPerUnit;
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      const v = this.views.get(t.id) ?? this.create(t);
      v.seen = this.frameNo;
      v.entity = t;
      const art = v.art;
      if (v.tier !== t.tier && art) {
        v.tier = t.tier;
        v.sprite.texture = art.tiers[Math.min(art.tiers.length, t.tier) - 1];
        v.attackT = -1;
        v.attackSheet = null;
        v.pending = null;
        v.armed = false;
      }
      const px = this.map.pxX(t.x);
      const py = this.map.pxY(t.z);
      v.px = px;
      v.py = py;
      v.kick = Math.max(0, v.kick - dt / v.prof.dur);
      const ring = art ? art.rings[Math.max(1, Math.min(3, t.tier)) - 1] : null;
      const jammed = t.stunTimer > 0;
      const buffed = t.auraRate > 0 || t.auraRange > 0;
      if (!(art && ring && this.syncRing(v, t, ring, art, simDt, py))) {
        // Legacy art: height + anchor placement and the full procedural kick.
        v.ring = null;
        v.turretArt = null;
        v.muzzlePt = null;
        if (v.turret) v.turret.visible = false;
        const height = (art ? art.spec.height : 3) * ppu * (1 + (t.tier - 1) * 0.04);
        const base = height / Math.max(1, v.sprite.texture.height);
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
        const flip = art && art.spec.flipToTarget ? (art.spec.facing === 'left' ? v.aim > 0 : v.aim < 0) : false;
        if (art) v.sprite.anchor.set(art.spec.anchor[0], art.spec.anchor[1]);
        v.sprite.scale.set(base * (sx + pop * 0.5) * (flip ? -1 : 1), base * (sy + pop));
        if (jammed) rot += Math.sin(time * 31) * 0.02;
        v.sprite.rotation = rot;
        v.sprite.position.set(px + recoil, py + press);
        v.sprite.zIndex = py;
        v.shadow.visible = true;
        v.shadow.position.set(px, py + 4);
        v.shadow.scale.set((ppu * 2.2) / 128, (ppu * 1.0) / 128);
        v.shadow.alpha = 0.5;
        v.muzzle = art ? art.spec.muzzle : 2;
        v.topY = py - height * 0.98;
        v.midY = py - height * 0.55;
        if (v.pending) {
          this.muzzleFx(v, v.pending);
          v.pending = null;
        }
      } else if (jammed) {
        v.sprite.rotation += Math.sin(time * 31) * 0.012;
      }
      let tint = art ? art.tint : 0xffffff;
      if (jammed) tint = mixTint(tint, JAM_TINT, 0.45 + 0.1 * Math.sin(time * 12));
      v.sprite.tint = tint;
      if (v.turret) v.turret.tint = tint;

      // Jam marker: a spinning magenta ring with a bolt over the silenced tower.
      const jam = this.overlay(v, 'jam', jammed);
      if (jam) {
        const fade = Math.min(1, t.stunTimer / 0.4);
        jam.position.set(px, v.topY - 16 + Math.sin(time * 5) * 2);
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
        star.position.set(px + Math.cos(a) * ppu * 0.55, v.midY + Math.sin(a * 1.3) * ppu * 0.3);
        star.scale.set((9 + 4 * Math.sin(time * 7 + t.id)) / 32);
        star.alpha = 0.8;
        star.zIndex = py + 1;
      }
    }
    for (const [id, v] of this.views) {
      if (v.seen !== this.frameNo) {
        v.sprite.destroy();
        v.turret?.destroy();
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
    const v = this.views.get(t.id);
    if (v) return v.topY;
    const art = this.art.towers[t.type];
    return this.map.pxY(t.z) - (art ? art.spec.height : 3) * this.map.layout.pxPerUnit * 0.9;
  }

  /** Muzzle height (world units) of a tower type's T1 art (projectiles without a known tower). */
  muzzleHeight(type: TowerEntity['type']): number {
    for (const v of this.views.values()) if (v.art && v.art.spec === this.art.towers[type]?.spec) return v.muzzle;
    return this.art.towers[type]?.spec.muzzle ?? 2;
  }

  /** Where a specific tower's shots leave as drawn now (map px), or null (height-only muzzle). */
  muzzlePointOf(towerId: number): { x: number; y: number } | null {
    return this.views.get(towerId)?.muzzlePt ?? null;
  }

  /** QA: aimable turrets as drawn (sector = index into turret.ts SECTORS, the sim's targetYaw, muzzle). */
  turretReport(): TurretReportRow[] {
    const out: TurretReportRow[] = [];
    for (const [id, v] of this.views) {
      if (v.turretArt && v.turret?.visible) {
        const f = frameFor(v.sector);
        out.push({ id, type: v.entity.type, tier: v.entity.tier, sector: v.sector, aimed: v.aimed, targetYaw: v.entity.targetYaw, mirror: f.mirror, frame: f.frame, muzzle: v.muzzlePt, mount: v.mount, px: v.px, py: v.py });
      } else if (BODY_AIM_TOWERS.has(v.entity.type)) {
        const f = frameFor(v.sector);
        out.push({ id, type: v.entity.type, tier: v.entity.tier, sector: v.sector, aimed: v.aimed, targetYaw: v.entity.targetYaw, mirror: v.bodyMirror, frame: f.frame, muzzle: v.muzzlePt, mount: v.mount, px: v.px, py: v.py });
      }
    }
    return out;
  }

  /** Muzzle height (world units) of a specific tower as drawn now. */
  muzzleOf(towerId: number, type: TowerEntity['type']): number {
    return this.views.get(towerId)?.muzzle ?? this.muzzleHeight(type);
  }

  /** Plot index of a built tower whose drawn sprite (ring up to its top) contains a map-px point, or -1. */
  plotAtSprite(x: number, y: number, towers: readonly TowerEntity[]): number {
    let best = -1;
    let bestY = -Infinity;
    for (const t of towers) {
      const v = this.views.get(t.id);
      if (!v) continue;
      const half = v.ring ? v.ring.width * 0.42 : this.map.layout.pxPerUnit * 0.9;
      const bottom = v.ring ? v.ring.bottom : v.py + 10;
      // Front-most (largest ground y) wins where sprites overlap.
      if (Math.abs(x - v.px) <= half && y >= v.topY && y <= bottom && v.py > bestY) {
        best = t.col;
        bestY = v.py;
      }
    }
    return best;
  }

  /** Map-px box of a tower's drawn body (same box as plotAtSprite), or null. */
  spriteRect(towerId: number): { x: number; y: number; w: number; h: number } | null {
    const v = this.views.get(towerId);
    if (!v) return null;
    const half = v.ring ? v.ring.width * 0.42 : this.map.layout.pxPerUnit * 0.9;
    const bottom = v.ring ? v.ring.bottom : v.py + 10;
    return { x: v.px - half, y: v.topY, w: half * 2, h: bottom - v.topY };
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

  /** QA: ring-convention towers' drawn ring vs their plot ring (layout px), by tower id. */
  ringReport(towers: readonly TowerEntity[]): { id: number; plot: number; type: string; tier: number; dx: number; dy: number; dw: number }[] {
    const out: { id: number; plot: number; type: string; tier: number; dx: number; dy: number; dw: number }[] = [];
    for (const t of towers) {
      const v = this.views.get(t.id);
      const target = this.plots?.rings[t.col];
      if (!v?.ring || !target) continue;
      out.push({
        id: t.id,
        plot: t.col,
        type: t.type,
        tier: t.tier,
        dx: v.ring.cx - target.cx,
        dy: v.ring.bottom - target.bottom,
        dw: v.ring.width - target.width,
      });
    }
    return out;
  }
}
