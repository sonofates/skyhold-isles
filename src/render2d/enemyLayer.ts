import { Sprite, Texture } from 'pixi.js';
import type { EnemyType } from '../core/types.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import type { EnemyEntity } from '../sim/entities.ts';
import type { ObjectPool } from '../core/pool.ts';
import type { EnemyArtRuntime, LoadedArt } from './assets2d.ts';
import { HEIGHT_TO_SCREEN, type WorldLayers } from './layers.ts';
import { enemyArtFor } from './manifest.ts';
import type { MapView } from './mapView.ts';
import type { ProcTextures } from './procTextures.ts';
import { cheapWalk, createAnimState, createPose, sheetWalk, type AnimState, type WalkPose } from './walkAnim.ts';

/** Anything that walks like an enemy: the sim's EnemyEntity, or the A/B showcase walkers. */
export interface Walker {
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

const BAR_W = 34;
const BAR_H = 5;
const HP_GREEN = 0x7cd34a;
const HP_BG = 0x3a2412;

/** One pooled enemy sprite set (body, soft shadow, hp bar). */
export class EnemyView {
  readonly body = new Sprite(Texture.EMPTY);
  readonly shadow: Sprite;
  readonly barBg = new Sprite(Texture.WHITE);
  readonly barFill = new Sprite(Texture.WHITE);
  readonly anim: AnimState;
  readonly pose: WalkPose = createPose();
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

  setVisible(v: boolean): void {
    this.body.visible = v;
    this.shadow.visible = v;
    if (!v) {
      this.barBg.visible = false;
      this.barFill.visible = false;
    }
  }
}

/**
 * Renders pooled walkers with the manifest's animation mode per art ("cheap" procedural walk or
 * "sheet" walk cycle). Views are indexed by the sim pool index and rebound when the uid changes,
 * so nothing is allocated while a wave is running.
 */
export class EnemyLayer {
  private readonly views: (EnemyView | undefined)[] = [];
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

  private viewFor(index: number): EnemyView {
    let v = this.views[index];
    if (!v) {
      v = new EnemyView(index, this.tex.shadow);
      this.views[index] = v;
      this.layers.shadows.addChild(v.shadow);
      this.layers.bars.addChild(v.barBg, v.barFill);
      v.setVisible(false);
    }
    return v;
  }

  private bind(v: EnemyView, w: Walker, artOverride: string | null): void {
    const entry = artOverride ? { art: artOverride } : enemyArtFor(this.art.manifest, w.type, w.flying);
    const art = this.art.enemies[entry.art] ?? this.art.enemies[this.art.manifest.enemyMap['*'].art];
    v.uid = w.uid;
    v.art = art;
    v.tint = entry.tint ?? 0xffffff;
    v.scale = entry.scale ?? 1;
    v.flying = w.flying;
    v.nominalSpeed = ENEMY_DEFS[w.type]?.speed ?? 2;
    v.fresh = true;
    v.anim.lean = 0;
    v.anim.frameCursor = 0;
    v.anim.seq = 0;
    const anchor = art.mode === 'sheet' ? (art.sheet?.anchor ?? art.spec.anchor) : (art.frameAnchors[0] ?? art.spec.anchor);
    v.body.anchor.set(anchor[0], anchor[1]);
    v.body.texture = Texture.EMPTY;
    const parent = w.flying ? this.layers.air : this.layers.actors;
    if (v.body.parent !== parent) parent.addChild(v.body);
  }

  /** Forget all bindings (new run: sim uids start over). */
  reset(): void {
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      if (v) {
        v.uid = -1;
        v.setVisible(false);
      }
    }
  }

  /** Draws every active enemy of a sim pool. */
  syncPool(pool: ObjectPool<EnemyEntity>, alpha: number, dt: number): void {
    this.frameNo++;
    const n = pool.getActiveCount();
    for (let i = 0; i < n; i++) {
      const idx = pool.getActiveIndex(i);
      this.drawWalker(idx, pool.items[idx], alpha, dt, null);
    }
    this.hideStale();
  }

  /** Begin a manual frame (A/B showcase): call drawWalker per walker, then endFrame(). */
  beginFrame(): void {
    this.frameNo++;
  }

  endFrame(): void {
    this.hideStale();
  }

  private hideStale(): void {
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      if (v && v.seen !== this.frameNo && v.body.visible) {
        v.setVisible(false);
        v.uid = -1;
      }
    }
  }

  drawWalker(index: number, w: Walker, alpha: number, dt: number, artOverride: string | null): void {
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
    const moved = Math.hypot(ix - v.lastX, iz - v.lastZ);
    const speedRatio = dt > 0 ? moved / dt / v.nominalSpeed : 0;
    const dxImg = px - v.lastPx;
    const dyImg = py - v.lastPy;
    v.lastX = ix;
    v.lastZ = iz;
    v.lastPx = px;
    v.lastPy = py;

    const pose = v.pose;
    let tex: Texture;
    const facesRight = art.spec.facing === 'right';
    if (art.mode === 'sheet' && art.sheet) {
      const sheet = art.sheet;
      const seq0 = sheet.seqs[0];
      sheetWalk(v.anim, seq0.length, sheet.fps, art.spec.sheet?.stride, moved, speedRatio, dxImg, dyImg, dt, art.spec.sheet?.facing !== 'left', pose);
      const seq = sheet.seqs[pose.seq] ?? seq0;
      tex = seq[pose.frame % seq.length];
    } else {
      cheapWalk(v.anim, art.spec.cheap, moved, speedRatio, dxImg, dyImg, dt, art.frames.length, facesRight, pose);
      tex = art.frames[pose.frame] ?? art.base;
    }
    if (v.body.texture !== tex) {
      v.body.texture = tex;
      if (art.mode !== 'sheet') {
        const a = art.frameAnchors[pose.frame] ?? art.spec.anchor;
        v.body.anchor.set(a[0], a[1]);
      }
    }

    // Constant px scale per art (from the base sprite / sheet frame) so frames never change size.
    const heightPx = art.spec.height * ppu * v.scale * (w.scaleOverride || 1);
    const s = heightPx / Math.max(1, art.mode === 'sheet' ? tex.height * 0.94 : art.base.height);
    v.body.scale.set(s * pose.scaleX * (pose.flip ? -1 : 1), s * pose.scaleY);
    v.body.rotation = pose.rotation;
    const liftPx = (iy * HEIGHT_TO_SCREEN + pose.lift) * ppu;
    v.body.position.set(px, py - liftPx);
    v.body.zIndex = py;
    // Hit flash: the sim's hitFlashTimer drives a warm tint (no per-sprite filters).
    v.body.tint = w.hitFlashTimer > 0 ? 0xff9c8c : v.tint;
    v.body.alpha = w.burrowed ? 0.25 : 1;
    v.body.visible = true;

    const sh = v.shadow;
    sh.visible = true;
    const shR = art.spec.shadow * ppu * v.scale * (w.flying ? 0.85 : 1);
    sh.position.set(px, py);
    sh.scale.set((shR * 2) / 128, (shR * 0.9) / 128);
    sh.alpha = w.flying ? 0.45 : 0.85 - Math.min(0.3, pose.lift * 2);

    const damaged = w.hp < w.maxHp && w.hp > 0 && !w.burrowed;
    v.barBg.visible = damaged;
    v.barFill.visible = damaged;
    if (damaged) {
      const top = py - liftPx - heightPx - 6;
      v.barBg.position.set(px - BAR_W / 2 - 1.5, top);
      v.barBg.width = BAR_W + 3;
      v.barBg.height = BAR_H + 3;
      v.barFill.position.set(px - BAR_W / 2, top);
      v.barFill.width = Math.max(0.5, (BAR_W * w.hp) / w.maxHp);
      v.barFill.height = BAR_H;
    }
  }
}
