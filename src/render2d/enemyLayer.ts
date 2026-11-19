import { Sprite, Texture } from 'pixi.js';
import type { EnemyType } from '../core/types.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import type { EnemyEntity } from '../sim/entities.ts';
import type { ObjectPool } from '../core/pool.ts';
import { mulTint } from './artResolve.ts';
import type { DeathSheetRuntime, EnemyArtRuntime, LoadedArt } from './assets2d.ts';
import {
  createExtras,
  createSpecialAnim,
  DROP_FALL_HEIGHT,
  DROP_FALL_SEC,
  EnemySpecials,
  type EnemyExtras,
  type SpecialAnim,
  type SpecialOut,
  type SpecialState,
} from './enemySpecials.ts';
import type { FxLayer } from './fxLayer.ts';
import { HEIGHT_TO_SCREEN, type WorldLayers } from './layers.ts';
import { enemyArtFor } from './manifest.ts';
import { HIT_FLASH, type FighterState, type MeleeDirector } from './meleeDirector.ts';
import { swingFrame } from './meleeAnim.ts';
import type { MapView } from './mapView.ts';
import type { ProcTextures } from './procTextures.ts';
import { cheapWalk, createAnimState, createPose, sheetSequence, sheetWalk, type AnimState, type WalkPose } from './walkAnim.ts';

/** Anything that walks like an enemy: the sim's EnemyEntity, or the A/B showcase walkers. */
export interface Walker extends SpecialState {
  readonly uid: number;
  readonly type: EnemyType;
  readonly flying: boolean;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly prevX: number;
  readonly prevY: number;
  readonly prevZ: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly hitFlashTimer: number;
  readonly scaleOverride: number;
  readonly burrowed: boolean;
}

type DeathClip = DeathSheetRuntime;
interface DeathView {
  body: Sprite;
  clip: DeathClip | null;
  elapsed: number;
  startY: number;
  groundY: number;
}

const BAR_W = 34;
const BAR_H = 5;
const HP_GREEN = 0x7cd34a;
const HP_BG = 0x3a2412;
/** A one-frame jump this long (world units) is a teleport (blink), not a fast walk. */
const TELEPORT_UNITS = 2.2;

/** One pooled enemy sprite set (body, soft shadow, hp bar, lazily created special overlays). */
export class EnemyView {
  readonly body = new Sprite(Texture.EMPTY);
  /** Additive copy of the body shown for a few frames when a melee blow lands (white hit flash). */
  flash: Sprite | null = null;
  readonly shadow: Sprite;
  readonly barBg = new Sprite(Texture.WHITE);
  readonly barFill = new Sprite(Texture.WHITE);
  readonly anim: AnimState;
  readonly pose: WalkPose = createPose();
  readonly ex: EnemyExtras = createExtras();
  readonly sp: SpecialAnim = createSpecialAnim();
  readonly out: SpecialOut = { tint: 0xffffff, squashY: 1, bodyAlpha: 1, bodyVisible: true, shadowAlpha: 1 };
  uid = -1;
  art: EnemyArtRuntime | null = null;
  tint = 0xffffff;
  scale = 1;
  flying = false;
  nominalSpeed = 1;
  lastX = 0;
  lastZ = 0;
  lastPx = 0;
  lastPy = 0;
  fresh = true;
  seen = -1;

  constructor(index: number, shadowTex: Texture) {
    this.anim = createAnimState(index * 1.37);
    this.shadow = new Sprite(shadowTex);
    this.shadow.anchor.set(0.5);
    this.body.anchor.set(0.5, 0.95);
    this.barBg.tint = HP_BG;
    this.barFill.tint = HP_GREEN;
    this.barBg.anchor.set(0, 0.5);
    this.barFill.anchor.set(0, 0.5);
  }
}

/**
 * Renders pooled walkers with the manifest's animation mode per art ("cheap" procedural walk or
 * "sheet" walk cycle), plus the per-enemy specials (see enemySpecials.ts). Views are indexed by
 * the sim pool index and rebound when the uid changes, so nothing is allocated while a wave runs.
 */
export class EnemyLayer {
  private readonly views: (EnemyView | undefined)[] = [];
  private frameNo = 0;
  private readonly deaths: DeathView[] = [];
  /** QA counters: painted death clips started, and frames drawn from the side walk sequence. */
  deathsPlayed = 0;
  sideFrames = 0;
  private readonly layoutScratch = { px: 0, py: 0, cy: 0, heightPx: 0, shadowR: 0, uiScale: 1, pxPerUnit: 1, facing: 1 };
  private readonly art: LoadedArt;
  private readonly map: MapView;
  private readonly layers: WorldLayers;
  private readonly tex: ProcTextures;
  private readonly hasGoalFront: boolean;
  private readonly fx: FxLayer | null;
  readonly specials: EnemySpecials;
  /** Melee fight state (facing, swings, hit flash); null in scenes without soldiers. */
  private melee: MeleeDirector | null = null;

  constructor(art: LoadedArt, map: MapView, layers: WorldLayers, tex: ProcTextures, fx: FxLayer | null = null) {
    this.art = art;
    this.map = map;
    this.hasGoalFront = map.layout.gates?.some(g => g.role === 'goal' && g.front !== null) ?? false;
    this.layers = layers;
    this.tex = tex;
    this.fx = fx;
    this.specials = new EnemySpecials(
      { overlays: layers.air, ground: layers.shadows, actors: layers.actors, bars: layers.bars },
      tex,
      fx,
    );
  }

  setMelee(melee: MeleeDirector | null): void {
    this.melee = melee;
  }

  /** Pre-allocates pooled enemy views during load so wave spawns allocate no sprites mid-frame. */
  prewarm(count = 160): void {
    for (let i = 0; i < count; i++) {
      this.viewFor(i);
    }
  }

  private viewFor(index: number): EnemyView {
    let v = this.views[index];
    if (!v) {
      v = new EnemyView(index, this.tex.shadow);
      this.views[index] = v;
      this.layers.shadows.addChild(v.shadow);
      this.layers.bars.addChild(v.barBg, v.barFill);
      this.setVisible(v, false);
    }
    return v;
  }

  private setVisible(v: EnemyView, on: boolean): void {
    v.body.visible = on;
    v.shadow.visible = on;
    if (!on) {
      if (v.flash) v.flash.visible = false;
      v.barBg.visible = false;
      v.barFill.visible = false;
      this.specials.hideAll(v.ex);
    }
  }

  private bind(v: EnemyView, w: Walker, artOverride: string | null): void {
    const entry = artOverride ? { art: artOverride } : enemyArtFor(this.art.manifest, w.type, w.flying);
    const art = this.art.enemies[entry.art] ?? this.art.enemies[this.art.manifest.enemyMap['*'].art];
    v.uid = w.uid;
    v.art = art;
    v.tint = mulTint((entry as { tint?: number }).tint ?? 0xffffff, art.tintMul);
    v.scale = ((entry as { scale?: number }).scale ?? 1) * art.scaleMul;
    v.flying = w.flying;
    v.nominalSpeed = ENEMY_DEFS[w.type]?.speed ?? 2;
    v.fresh = true;
    v.anim.lean = 0;
    const moth = ENEMY_DEFS[w.type]?.ability?.kind === 'draft';
    v.anim.frameCursor = moth ? (w.uid * 0.618034 % 1) * (art.sheet?.seqs[0].length ?? 1) : 0;
    v.anim.seq = 0;
    v.sp.burrowK = w.burrowed ? 1 : 0;
    v.sp.dustT = 0;
    v.sp.fallT = w.isDropped ? 0 : DROP_FALL_SEC;
    v.sp.fallDone = !w.isDropped;
    const anchor = art.mode === 'sheet' ? (art.sheet?.anchor ?? art.spec.anchor) : (art.frameAnchors[0] ?? art.spec.anchor);
    v.body.anchor.set(anchor[0], anchor[1]);
    v.body.texture = Texture.EMPTY;
    this.specials.hideAll(v.ex);
    const parent = w.flying ? this.layers.air : this.layers.actors;
    if (v.body.parent !== parent) parent.addChild(v.body);
    if (v.flash) {
      if (v.flash.parent !== parent) parent.addChild(v.flash);
      v.flash.visible = false;
    }
  }

  /** Snapshot the last painted pose before the sim recycles the enemy's pool slot. */
  playDeath(uid: number): void {
    const v = this.views.find(view => view?.uid === uid);
    const art = v?.art ?? null;
    const clip = art?.death;
    if (!v?.body.visible || !art || !clip?.frames.length || !v.body.parent) return;

    let d = this.deaths.find(view => !view.clip);
    if (!d) {
      if (this.deaths.length >= 32) return;
      d = { body: new Sprite(), clip: null, elapsed: 0, startY: 0, groundY: 0 };
      this.deaths.push(d);
    }
    const body = d.body;
    v.body.parent.addChild(body);
    body.texture = clip.frames[0];
    const anchor = clip.anchor ?? art.sheet?.anchor ?? art.spec.anchor;
    body.anchor.set(anchor[0], anchor[1]);
    body.position.copyFrom(v.body.position);
    body.scale.copyFrom(v.body.scale);
    body.zIndex = v.body.zIndex;
    body.tint = v.tint;
    body.alpha = 1;
    body.visible = true;
    d.clip = clip;
    d.elapsed = 0;
    this.deathsPlayed++;
    d.startY = body.y;
    d.groundY = v.flying ? v.shadow.y : body.y;
  }

  private advanceDeaths(dt: number): void {
    for (const d of this.deaths) {
      const clip = d.clip;
      if (!clip) continue;
      d.elapsed += dt;
      const frames = d.elapsed * clip.fps;
      d.body.texture = clip.frames[Math.min(clip.frames.length - 1, Math.floor(frames))];
      const descent = Math.min(1, frames / clip.frames.length);
      d.body.y = d.startY + (d.groundY - d.startY) * descent * descent;
      const fade = Math.max(0, d.elapsed - clip.frames.length / clip.fps);
      d.body.alpha = Math.max(0, 1 - fade / 0.20);
      if (d.body.alpha === 0) {
        d.body.visible = false;
        d.clip = null;
      }
    }
  }

  /** Forget all bindings (new run: sim uids start over). */
  reset(): void {
    for (const d of this.deaths) {
      d.body.visible = false;
      d.clip = null;
    }
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      if (v) {
        v.uid = -1;
        this.setVisible(v, false);
      }
    }
  }

  /** Draws every active enemy of a sim pool. `dt` is sim time (0 while paused). */
  syncPool(pool: ObjectPool<EnemyEntity>, alpha: number, dt: number): void {
    this.frameNo++;
    this.specials.time += dt;
    this.advanceDeaths(dt);
    const n = pool.getActiveCount();
    for (let i = 0; i < n; i++) {
      const idx = pool.getActiveIndex(i);
      const enemy = pool.items[idx];
      // Tall heads and weapons can project above a low lintel. Carry them into the
      // tunnel shadow with the feet, using remaining route distance even on crossing lanes.
      const remainingPx = (enemy.totalDist - enemy.dist) * this.map.layout.pxPerUnit;
      const passage = this.hasGoalFront && !enemy.flying ? Math.max(0, Math.min(1, (remainingPx - 3) / 21)) : 1;
      this.drawWalker(idx, enemy, alpha, dt, null, passage * passage);
    }
    this.hideStale();
  }

  /** Begin a manual frame (A/B showcase): call drawWalker per walker, then endFrame(). */
  beginFrame(dt = 0): void {
    this.frameNo++;
    this.specials.time += dt;
  }

  endFrame(): void {
    this.hideStale();
  }

  private hideStale(): void {
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      if (v && v.seen !== this.frameNo && v.shadow.visible) {
        this.setVisible(v, false);
        v.uid = -1;
      }
    }
  }

  /** Screen position (map px) of a live enemy by sim uid is not tracked; QA counts instead. */
  get viewCount(): number {
    return this.views.length;
  }

  drawWalker(index: number, w: Walker, alpha: number, dt: number, artOverride: string | null, passageAlpha = 1): void {
    const v = this.viewFor(index);
    if (v.uid !== w.uid || v.art === null) this.bind(v, w, artOverride);
    const art = v.art!;
    const map = this.map;
    const ppu = map.layout.pxPerUnit;
    v.seen = this.frameNo;

    const ix = w.prevX + (w.x - w.prevX) * alpha;
    const iz = w.prevZ + (w.z - w.prevZ) * alpha;
    const iy = w.flying ? w.prevY + (w.y - w.prevY) * alpha : 0;
    const px = map.pxX(ix);
    const py = map.pxY(iz);
    if (v.fresh) {
      v.lastX = ix;
      v.lastZ = iz;
      v.lastPx = px;
      v.lastPy = py;
      v.fresh = false;
    }
    let moved = Math.hypot(ix - v.lastX, iz - v.lastZ);
    let dxImg = px - v.lastPx;
    let dyImg = py - v.lastPy;
    if (moved > TELEPORT_UNITS) {
      // Blink: the jump must not spike the stride phase, the lean or the facing.
      moved = 0;
      dxImg = 0;
      dyImg = 0;
    }
    const speedRatio = dt > 0 ? moved / dt / v.nominalSpeed : 0;
    v.lastX = ix;
    v.lastZ = iz;
    v.lastPx = px;
    v.lastPy = py;

    // In a fight: face the soldier (front view), ignore the creep of a partial hold for facing.
    const ms: FighterState | undefined = this.melee && !w.flying ? this.melee.enemy(w.uid) : undefined;
    const fighting = ms !== undefined && ms.engaged && ms.facing !== 0;
    if (fighting) {
      v.anim.facing = ms.facing;
      v.anim.seq = 0;
      dxImg = 0;
      dyImg = 0;
    }

    const ability = ENEMY_DEFS[w.type]?.ability;
    const pose = v.pose;
    let tex: Texture;
    const facesRight = art.spec.facing === 'right';
    let backView = false;
    if (art.mode === 'sheet' && art.sheet) {
      const sheet = art.sheet;
      // Each sequence has its own length and may face its own way (front clips walk down-right,
      // back clips often walk up-left).
      let seqIdx = sheetSequence(v.anim.seq, dxImg, dyImg);
      if (sheet.seqs[2]?.length && !fighting) {
        // A near-diagonal turn keeps its last view until the new direction is clear.
        const ax = Math.abs(dxImg);
        const ay = Math.abs(dyImg);
        if (ax > 0.02 && ax > ay * 1.25) seqIdx = 2;
        else if (ay <= 0.02 || ay < ax * 0.9) seqIdx = v.anim.seq;
      }
      const seq = sheet.seqs[seqIdx] ?? sheet.seqs[0];
      const spec = art.spec.sheet;
      const facing = seqIdx === 1 ? (spec?.facingUp ?? spec?.facing) : spec?.facing;
      const moth = ability?.kind === 'draft';
      // Moths keep beating their wings while slowed. A small height difference lets
      // the eyes and wings of overtaking moths separate within their targeting radius.
      const stride = moth ? undefined : spec?.stride;
      const rate = moth ? 1 + 0.18 * (w.abilityTimer ?? 0) / ability.coastSec : speedRatio;
      sheetWalk(v.anim, seq.length, sheet.fps, stride, moved, rate, dxImg, dyImg, dt, facing !== 'left', pose);
      if (moth) pose.lift = (w.uid % 3 - 1) * 0.22;
      v.anim.seq = seqIdx;
      if (seqIdx === 2) this.sideFrames++;
      tex = seq[pose.frame % seq.length];
    } else {
      cheapWalk(v.anim, art.spec.cheap, moved, speedRatio, dxImg, dyImg, dt, art.frames.length, facesRight, pose);
      // Walking away from the camera shows the back view when the art has one.
      v.anim.seq = sheetSequence(v.anim.seq, dxImg, dyImg);
      backView = v.anim.seq === 1 && art.back !== null;
      tex = backView ? art.back! : (art.frames[pose.frame] ?? art.base);
    }
    // Melee swing: the painted attack sheet when there is one (also its first frame as the
    // fighting stance between blows), else the procedural wind-up / lunge on the walk frame.
    const walkTex = tex;
    let attackFrame = -1;
    const atk = art.attack;
    if (atk && ability?.kind === 'refrain' && (w.channelTimer ?? 0) > 0) {
      const phrase = 1 - (w.channelTimer ?? 0) / ability.channelSec;
      attackFrame = Math.max(0, Math.min(atk.frames.length - 1, Math.floor(phrase * atk.frames.length)));
    } else if (ms && atk) {
      const f = swingFrame(ms.swing, atk.frames.length, atk.fps);
      if (f !== null) attackFrame = f;
      else if (fighting) attackFrame = 0;
    }
    if (atk && attackFrame >= 0) {
      tex = atk.frames[attackFrame];
      // The attack and flute poses face like the walk "down" sheet.
      pose.flip = (v.anim.facing > 0) !== ((art.spec.sheet?.facing ?? art.spec.facing) !== 'left');
      pose.rotation = 0;
      pose.scaleX = 1;
      pose.scaleY = 1;
      pose.lift = 0;
    }
    if (v.body.texture !== tex) {
      v.body.texture = tex;
      if (attackFrame >= 0) {
        const a = atk!.anchor ?? art.sheet?.anchor ?? art.spec.anchor;
        v.body.anchor.set(a[0], a[1]);
      } else if (art.mode !== 'sheet') {
        const a = backView ? art.backAnchor : (art.frameAnchors[pose.frame] ?? art.spec.anchor);
        v.body.anchor.set(a[0], a[1]);
      } else {
        const a = art.sheet?.anchor ?? art.spec.anchor;
        v.body.anchor.set(a[0], a[1]);
      }
    }

    // Dropped raiders fall from the hauler's wreck onto the road.
    let fallLift = 0;
    let fallK = 1;
    if (!v.sp.fallDone) {
      v.sp.fallT += dt;
      fallK = Math.min(1, v.sp.fallT / DROP_FALL_SEC);
      fallLift = DROP_FALL_HEIGHT * (1 - fallK * fallK);
      if (fallK >= 1) {
        v.sp.fallDone = true;
        this.fx?.puffs(px, py, 4, 12, 0xe9d8b4);
      }
    }

    // Constant px scale per art (from the base sprite / sheet frame) so frames never change size.
    const heightPx = art.spec.height * ppu * v.scale * (w.scaleOverride || 1);
    // Attack frames use the walk sheet's px scale (same source framing), so the figure keeps its size.
    const s = (heightPx / Math.max(1, art.mode === 'sheet' ? walkTex.height * 0.94 : art.base.height)) * (attackFrame >= 0 && atk ? atk.figScale : 1);
    const liftPx = (iy * HEIGHT_TO_SCREEN + pose.lift + fallLift) * ppu;
    const shR = art.spec.shadow * ppu * v.scale * (w.flying ? 0.85 : 1);

    // Specials: tints, overlays, burrow sink (they may change tint / alpha / squash / visibility).
    const out = v.out;
    out.tint = v.tint;
    out.squashY = 1;
    out.bodyAlpha = 1;
    out.bodyVisible = true;
    out.shadowAlpha = 1;
    const layout = this.layoutScratch;
    layout.px = px;
    layout.py = py;
    layout.cy = py - liftPx - heightPx * 0.5;
    layout.heightPx = heightPx;
    layout.shadowR = shR;
    layout.pxPerUnit = ppu;
    layout.facing = v.anim.facing;
    this.specials.apply(v.ex, v.sp, art, w, layout, dt, out);
    if (passageAlpha < 1) {
      out.bodyAlpha *= passageAlpha;
      out.shadowAlpha *= passageAlpha;
      this.specials.hideAll(v.ex);
    }
    // Hit flash: the sim's hitFlashTimer drives a warm tint (no per-sprite filters).
    if (w.hitFlashTimer > 0) out.tint = 0xff9c8c;

    // Melee: knockback jolt (render offset), swing pose (procedural, lighter over painted frames), idle bob.
    let bx = px;
    let by = py;
    let sx = 1;
    let sy = 1;
    let rot = 0;
    let lift = 0;
    if (ms) {
      bx += ms.offX * ppu;
      by += ms.offZ * ppu;
      const face = v.anim.facing;
      const p = ms.pose;
      const amt = attackFrame >= 0 ? 0.3 : 1;
      bx += face * p.forward * amt * heightPx * 0.16;
      rot = face * p.tilt * amt * 0.12;
      sx = 1 + (p.scaleX - 1) * amt;
      sy = 1 + (p.scaleY - 1) * amt;
      lift = p.lift * amt * heightPx;
      if (fighting && ms.swing.t < 0) {
        const b = Math.sin(ms.idle * Math.PI * 2 * 1.5);
        sy *= 1 + 0.022 * b;
        sx *= 1 - 0.01 * b;
      }
    }
    v.body.scale.set(s * pose.scaleX * sx * (pose.flip ? -1 : 1), s * pose.scaleY * sy * out.squashY);
    v.body.rotation = pose.rotation + rot;
    v.body.position.set(bx, by - liftPx - lift);
    v.body.zIndex = py;
    v.body.tint = out.tint;
    v.body.alpha = out.bodyAlpha;
    v.body.visible = out.bodyVisible;
    const flashK = ms && out.bodyVisible ? ms.flash / HIT_FLASH : 0;
    if (v.flash) v.flash.visible = flashK > 0;
    if (flashK > 0) {
      const fl = v.flash ??= new Sprite();
      if (!fl.parent) {
        fl.blendMode = 'add';
        v.body.parent!.addChild(fl);
      }
      fl.texture = v.body.texture;
      fl.anchor.copyFrom(v.body.anchor);
      fl.scale.copyFrom(v.body.scale);
      fl.rotation = v.body.rotation;
      fl.position.copyFrom(v.body.position);
      fl.zIndex = py + 0.01;
      fl.alpha = Math.min(1, flashK * 1.2) * out.bodyAlpha;
    }

    const sh = v.shadow;
    sh.visible = true;
    const shK = 0.5 + 0.5 * fallK;
    sh.position.set(bx, by);
    sh.scale.set(((shR * 2) / 128) * shK, ((shR * 0.9) / 128) * shK);
    sh.alpha = (w.flying ? 0.8 : 0.85 - Math.min(0.3, pose.lift * 2)) * out.shadowAlpha * (0.4 + 0.6 * fallK);

    const damaged = w.hp < w.maxHp && w.hp > 0 && !w.burrowed;
    v.barBg.visible = damaged;
    v.barFill.visible = damaged;
    if (damaged) {
      v.barBg.alpha = v.barFill.alpha = passageAlpha;
      const top = by - liftPx - heightPx - 6;
      v.barBg.position.set(bx - BAR_W / 2 - 1.5, top);
      v.barBg.width = BAR_W + 3;
      v.barBg.height = BAR_H + 3;
      v.barFill.position.set(bx - BAR_W / 2, top);
      v.barFill.width = Math.max(0.5, (BAR_W * w.hp) / w.maxHp);
      v.barFill.height = BAR_H;
    }
  }
}
