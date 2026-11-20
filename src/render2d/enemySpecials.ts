import { Container, Graphics, GraphicsContext, Sprite, Texture } from 'pixi.js';
import { CHAPTER_ENEMY_DEFS } from '../data/enemies.ts';
import { mixTint } from './artResolve.ts';
import type { EnemyArtRuntime } from './assets2d.ts';
import type { FxLayer } from './fxLayer.ts';
import type { ProcTextures } from './procTextures.ts';

/** Per-enemy state the specials read (all optional so the A/B showcase walkers stay valid). */
export interface SpecialState {
  readonly type: string;
  readonly flying: boolean;
  readonly yaw?: number;
  readonly hitFlashTimer: number;
  readonly burrowed: boolean;
  readonly elite?: boolean;
  readonly shield?: number;
  readonly shieldMax?: number;
  readonly slowTimer?: number;
  readonly slowRatio?: number;
  readonly armorBreakTimer?: number;
  readonly abilityTimer?: number;
  readonly hexTargetId?: number;
  readonly bossPhase?: number;
  readonly channelTimer?: number;
  readonly isSplitChild?: boolean;
}

export type ExtraSlot = 'glow' | 'bubble' | 'crack' | 'ring' | 'crown' | 'shieldBg' | 'shieldFill' | 'mound';

type ChapterCue = 'refrain' | 'note' | 'wake';

/** Geometry is shared by every instance. The refrain arcs sit on the cleanse radius. */
function drawChapterCue(cue: ChapterCue): GraphicsContext {
  const g = new GraphicsContext();
  if (cue === 'refrain') {
    for (const [width, color] of [[2.4, 0x434528], [1.35, 0xffe993]]) {
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const start = i * Math.PI / 3;
        g.moveTo(100 * Math.cos(start), 100 * Math.sin(start)).arc(0, 0, 100, start, start + 0.79);
      }
      g.stroke({ width, color, cap: 'round' });
    }
  } else if (cue === 'note') {
    // A joined pair of quavers, with a dark edge that survives bright grass and frost.
    g.poly([-5, 4, -5, -9, 9, -13, 9, 1, 6, 1, 6, -7, -2, -5, -2, 4])
      .fill(0xffeb9b).stroke({ width: 1.5, color: 0x4d4226, join: 'round' });
    g.ellipse(-6.4, 4, 4.1, 2.9).fill(0xffeb9b).stroke({ width: 1.4, color: 0x4d4226 });
    g.ellipse(4.6, 1, 4.1, 2.9).fill(0xffeb9b).stroke({ width: 1.4, color: 0x4d4226 });
  } else {
    // Two tapered wingtip trails in a local frame pointing right.
    g.moveTo(-9, -7).bezierCurveTo(-32, -20, -51, -2, -83, -9)
      .bezierCurveTo(-55, 5, -33, -10, -15, -3).closePath()
      .fill(0xd9faf1).stroke({ width: 1.8, color: 0x2c525c, join: 'round' });
    g.moveTo(-15, 6).bezierCurveTo(-33, 1, -41, 15, -65, 10)
      .bezierCurveTo(-45, 22, -31, 10, -19, 11).closePath()
      .fill(0xafe9e1).stroke({ width: 1.6, color: 0x2c525c, join: 'round' });
  }
  return g;
}

/** Inked fissures in the 240 × 184 Kilnback sheet's local pixels, relative to its central plate. */
function kilnbackFissures(stage: number): GraphicsContext {
  const g = new GraphicsContext();
  if (stage === 3) {
    g.poly([-9, -6, 0, -10, 8, -4, 5, 4, -3, 9, -8, 3])
      .fill(0x623422).stroke({ color: 0xffcf81, width: 2.8, join: 'round' });
  }
  for (const [width, color] of [[6, 0x532c21], [2.6, 0xffdc98]]) {
    g.beginPath().moveTo(-4, -4).lineTo(-13, -8).lineTo(-16, -16).lineTo(-25, -20);
    if (stage >= 2) g.moveTo(-3, 2).lineTo(-11, 9).lineTo(-20, 9).lineTo(-27, 18);
    if (stage === 3) {
      g.moveTo(7, -2).lineTo(17, -9).lineTo(26, -7).lineTo(34, -14);
      g.moveTo(1, 8).lineTo(6, 15).lineTo(4, 21);
    }
    g.stroke({ width, color, cap: 'round', join: 'round' });
  }
  return g;
}

const shellShapes: GraphicsContext[] = [];

/** Keep the painted body and its fissures together in ground depth order, including on a blocked lane. */
export class KilnbackShell extends Container {
  private readonly fissures = new Graphics();

  constructor() {
    super();
    this.fissures.visible = false;
    this.fissures.zIndex = 1;
    this.addChild(this.fissures);
  }

  pose(body: Sprite, armor: number, baseArmor: number, sideView: boolean): void {
    const mark = this.fissures;
    mark.visible = body.visible && armor < baseArmor;
    if (!mark.visible) return;
    const stage = armor === 0 ? 3 : baseArmor - armor <= CHAPTER_ENEMY_DEFS.kilnback.ability.chip ? 1 : 2;
    mark.context = shellShapes[stage] ??= kilnbackFissures(stage);
    // In the side walk the shell sits lower on the frame, behind the extended neck.
    mark.pivot.set(body.texture.width * body.anchor.x - (sideView ? 114 : 119),
      body.texture.height * body.anchor.y - (sideView ? 76 : 61));
    mark.position.copyFrom(body.position);
    mark.scale.copyFrom(body.scale);
    mark.rotation = body.rotation;
    mark.alpha = body.alpha;
  }
}

/** Lazily created pooled overlays of one enemy view. */
export interface EnemyExtras extends Record<ChapterCue, Graphics | null> {
  glow: Sprite | null;
  bubble: Sprite | null;
  crack: Sprite | null;
  ring: Sprite | null;
  crown: Sprite | null;
  shieldBg: Sprite | null;
  shieldFill: Sprite | null;
  mound: Sprite | null;
}

export function createExtras(): EnemyExtras {
  return { glow: null, bubble: null, crack: null, ring: null, crown: null, shieldBg: null, shieldFill: null, mound: null, refrain: null, note: null, wake: null };
}

/** Seconds before a blink at which the rift starts to glow (matches the 3D telegraph). */
export const BLINK_TELEGRAPH_SEC = 0.55;
/** Seconds the burrower takes to sink into / rise out of the ground. */
export const BURROW_EASE_SEC = 0.22;

const FROST = 0xa8d8ff;
const GOLD = 0xffd45a;
const AQUA = 0x3fe0d0;
const HEX = 0xd45cff;
const HEALER_GREEN = 0x8fe070;
const STORM = 0x9fdcff;
const ENRAGE = 0xff8a3a;
const SPLIT_PINK = 0xff9ac0;
const DIRT = 0xb08256;

export interface SpecialLayout {
  readonly px: number;
  readonly py: number;
  /** Body centre y (screen), accounting for lift. */
  readonly cy: number;
  readonly heightPx: number;
  readonly shadowR: number;
  readonly uiScale: number;
  readonly pxPerUnit: number;
  readonly facing: number;
}

export interface SpecialOut {
  tint: number;
  /** Extra vertical squash while sinking (burrow). */
  squashY: number;
  bodyAlpha: number;
  bodyVisible: boolean;
  shadowAlpha: number;
}

/** Mutable per-view animation state for the specials (kept on the EnemyView). */
export interface SpecialAnim {
  burrowK: number;
  dustT: number;
}

export function createSpecialAnim(): SpecialAnim {
  return { burrowK: 0, dustT: 0 };
}

/**
 * Draws the state-driven enemy specials from pooled sprites: shield bubble + shield bar (warden,
 * Stormwall), elite ring + crown, healer aura, frost tint, golem cracked shell, burrower mound,
 * blinker charge glow, hexer channel glow, boss phase auras. Event bursts live in specialFx.ts.
 */
export class EnemySpecials {
  private readonly overlays: Container;
  private readonly ground: Container;
  private readonly actors: Container;
  private readonly bars: Container;
  private readonly tex: ProcTextures;
  private readonly fx: FxLayer | null;
  private readonly cueShapes: Partial<Record<ChapterCue, GraphicsContext>> = {};
  time = 0;
  /** Lifetime counters (QA): extra overlay sprites created. */
  extrasCreated = 0;

  constructor(parents: { overlays: Container; ground: Container; actors: Container; bars: Container }, tex: ProcTextures, fx: FxLayer | null) {
    this.overlays = parents.overlays;
    this.ground = parents.ground;
    this.actors = parents.actors;
    this.bars = parents.bars;
    this.tex = tex;
    this.fx = fx;
  }

  private create(slot: ExtraSlot, art: EnemyArtRuntime): Sprite {
    const t = this.tex;
    this.extrasCreated++;
    let s: Sprite;
    switch (slot) {
      case 'glow':
        s = new Sprite(t.orb);
        s.blendMode = 'add';
        this.overlays.addChild(s);
        break;
      case 'bubble':
        s = new Sprite(t.bubble);
        this.overlays.addChild(s);
        break;
      case 'crack':
        s = new Sprite(t.crack);
        this.overlays.addChild(s);
        break;
      case 'crown':
        s = new Sprite(t.crown);
        this.overlays.addChild(s);
        break;
      case 'ring':
        s = new Sprite(t.wring);
        this.ground.addChild(s);
        break;
      case 'shieldBg':
      case 'shieldFill':
        s = new Sprite(Texture.WHITE);
        s.tint = slot === 'shieldBg' ? 0x16324a : 0x6cc8ff;
        s.anchor.set(0, 0.5);
        this.bars.addChild(s);
        break;
      case 'mound':
        s = new Sprite(art.mound ?? t.mound);
        s.anchor.set(0.5, 0.82);
        this.actors.addChild(s);
        break;
    }
    if (slot !== 'shieldBg' && slot !== 'shieldFill' && slot !== 'mound') s.anchor.set(0.5);
    s.visible = false;
    return s;
  }

  private show(ex: EnemyExtras, slot: ExtraSlot, on: boolean, art: EnemyArtRuntime): Sprite | null {
    let s = ex[slot];
    if (!on) {
      if (s) s.visible = false;
      return null;
    }
    if (!s) {
      s = this.create(slot, art);
      ex[slot] = s;
    } else if (slot === 'mound' && art.mound && s.texture !== art.mound) {
      s.texture = art.mound;
    }
    s.visible = true;
    return s;
  }

  private showCue(ex: EnemyExtras, cue: ChapterCue, active: boolean): Graphics | null {
    let g = ex[cue];
    if (!active) {
      if (g) g.visible = false;
      return null;
    }
    if (!g) {
      g = new Graphics(this.cueShapes[cue] ??= drawChapterCue(cue));
      const parent = cue === 'refrain' ? this.ground : this.overlays;
      parent.addChild(g);
      ex[cue] = g;
      this.extrasCreated++;
    }
    g.visible = true;
    return g;
  }

  hideAll(ex: EnemyExtras): void {
    for (const k of Object.keys(ex) as (keyof EnemyExtras)[]) {
      const s = ex[k];
      if (s) s.visible = false;
    }
  }

  /** Called once per enemy per frame after the body pose is known. `out.tint` holds the base tint. */
  apply(
    ex: EnemyExtras,
    anim: SpecialAnim,
    art: EnemyArtRuntime,
    w: SpecialState,
    L: SpecialLayout,
    dt: number,
    out: SpecialOut,
  ): void {
    const time = this.time;
    const ui = L.uiScale;
    let tint = out.tint;
    const type = w.type;

    // ---- frost slow / cracked shell ------------------------------------------------------------
    const slowed = (w.slowTimer ?? 0) > 0;
    if (slowed) tint = mixTint(tint, FROST, 0.3 + 0.35 * Math.min(1, w.slowRatio ?? 0.3));
    const cracked = (w.armorBreakTimer ?? 0) > 0;
    const ceramic = type === 'kilnback';
    if (cracked) tint = mixTint(tint, ceramic ? 0xffce92 : 0xdff3ff, 0.32);
    const crack = this.show(ex, 'crack', cracked && !ceramic && !w.burrowed, art);
    if (crack) {
      const d = L.heightPx * 0.95;
      crack.position.set(L.px, L.cy);
      crack.scale.set(d / 128);
      crack.alpha = Math.min(1, (w.armorBreakTimer ?? 0) / 0.6) * (0.85 + 0.15 * Math.sin(time * 14));
      crack.zIndex = L.py + 0.4;
    }

    // ---- elite ---------------------------------------------------------------------------------
    const elite = w.elite === true;
    if (elite) tint = mixTint(tint, GOLD, 0.18);
    if (w.isSplitChild) tint = mixTint(tint, SPLIT_PINK, 0.3);

    // ---- shield bubble + bar (warden barrier, tempest Stormwall) -------------------------------
    const shield = w.shield ?? 0;
    const shielded = shield > 0 && !w.burrowed;
    const fill = shielded && (w.shieldMax ?? 0) > 0 ? Math.min(1, shield / (w.shieldMax as number)) : 0;
    const bubble = this.show(ex, 'bubble', shielded, art);
    if (bubble) {
      const d = Math.max(L.heightPx * 1.05, L.shadowR * 2.1) * (0.84 + fill * 0.16) * (1 + 0.025 * Math.sin(time * 5 + L.px * 0.1));
      bubble.position.set(L.px, L.cy);
      bubble.scale.set(d / 128, (d * 1.04) / 128);
      bubble.alpha = 0.55 + 0.4 * fill;
      bubble.rotation = Math.sin(time * 0.8 + L.px * 0.05) * 0.12;
      bubble.zIndex = L.py + 0.5;
    }
    const barW = 34 * ui;
    const sBg = this.show(ex, 'shieldBg', shielded, art);
    const sFill = this.show(ex, 'shieldFill', shielded, art);
    if (sBg && sFill) {
      const top = L.cy - L.heightPx * 0.5 - 15 * ui;
      sBg.position.set(L.px - barW / 2 - 1.5, top);
      sBg.width = barW + 3;
      sBg.height = 5 * ui;
      sFill.position.set(L.px - barW / 2, top);
      sFill.width = Math.max(0.5, barW * fill);
      sFill.height = 3 * ui;
    }

    // ---- glows (blinker charge, hexer channel, tempest channel / enrage, healer breath) --------
    let glowColor = 0;
    let glowA = 0;
    let glowScale = 1.3;
    if (type === 'blinker' && !w.burrowed && (w.abilityTimer ?? 9) < BLINK_TELEGRAPH_SEC) {
      const k = 1 - (w.abilityTimer ?? 0) / BLINK_TELEGRAPH_SEC;
      const fl = 0.55 + 0.45 * Math.abs(Math.sin(time * 30));
      glowColor = AQUA;
      glowA = k * fl;
      glowScale = 1.1 + k * 0.9;
      tint = mixTint(tint, 0xbafff6, k * fl * 0.7);
    } else if (type === 'bellrunner') {
      const run = (w.abilityTimer ?? 0) / CHAPTER_ENEMY_DEFS.bellrunner.ability.runUpSec;
      const beat = 0.5 + 0.5 * Math.sin(time * 17);
      glowColor = 0xffcf68;
      glowA = Math.max(0, run - 0.5) * (0.24 + 0.48 * beat);
      glowScale = 0.96;
    } else if (type === 'hexer' && (w.hexTargetId ?? -1) >= 0) {
      const p = 0.5 + 0.5 * Math.abs(Math.sin(time * 14));
      glowColor = HEX;
      glowA = 0.55 + 0.35 * p;
      glowScale = 1.4;
      tint = mixTint(tint, 0xf0b4ff, 0.45 * p);
    } else if (type === 'tempest' && (w.channelTimer ?? 0) > 0) {
      const p = 0.5 + 0.5 * Math.abs(Math.sin(time * 9));
      glowColor = STORM;
      glowA = 0.5 + 0.4 * p;
      glowScale = 1.6;
    } else if ((type === 'tempest' || type === 'boss') && (w.bossPhase ?? 0) >= 2) {
      const p = 0.5 + 0.5 * Math.sin(time * 11);
      glowColor = ENRAGE;
      glowA = 0.32 + 0.22 * p;
      glowScale = 1.5;
      tint = mixTint(tint, 0xffb08a, 0.22 + 0.12 * p);
    } else if (elite) {
      glowColor = GOLD;
      glowA = 0.16 + 0.1 * Math.sin(time * 3.4 + L.px * 0.07);
      glowScale = 1.25;
    }
    const glow = this.show(ex, 'glow', glowA > 0.02 && !w.burrowed, art);
    if (glow) {
      glow.tint = glowColor;
      glow.alpha = Math.min(1, glowA);
      const d = L.heightPx * glowScale;
      glow.position.set(L.px, L.cy);
      glow.scale.set(d / 64, d / 64);
      glow.zIndex = L.py + 0.3;
    }

    if (type === 'draftwing') {
      const strength = (w.abilityTimer ?? 0) / CHAPTER_ENEMY_DEFS.draftwing.ability.coastSec;
      const wake = this.showCue(ex, 'wake', strength > 0);
      if (wake) {
        // The thorax sits below the centre of the frame even at the top of the wingbeat.
        wake.position.set(L.px, L.cy + L.heightPx * 0.20);
        // Path yaw is measured from +z. In map space +z is down the screen.
        wake.rotation = Math.PI / 2 - (w.yaw ?? Math.PI / 2);
        wake.scale.set(L.heightPx / 74 * (0.55 + 0.45 * strength), L.heightPx / 64);
        wake.alpha = 0.85 * strength;
        wake.zIndex = L.py - 0.1;
      }
    } else if (type === 'reedpiper') {
      const ability = CHAPTER_ENEMY_DEFS.reedpiper.ability;
      const remaining = w.channelTimer ?? 0;
      const phrase = 1 - remaining / ability.channelSec;
      const refrain = this.showCue(ex, 'refrain', remaining > 0);
      const note = this.showCue(ex, 'note', remaining > 0);
      if (refrain && note) {
        refrain.position.set(L.px, L.py);
        refrain.scale.set(ability.radius * L.pxPerUnit / 100);
        refrain.alpha = 0.28 + 0.50 * phrase;
        // Lift the notes above the health bars of the larger ground troops around the piper.
        note.position.set(
          L.px + L.facing * L.heightPx * (0.42 + 0.25 * phrase),
          L.cy - L.heightPx * (0.78 + 0.55 * phrase),
        );
        note.scale.set(L.heightPx / 48);
        note.rotation = -0.16 + 0.13 * phrase;
        note.zIndex = L.py + 0.65;
      }
    }

    // ---- ground ring: elite, healer breath, boss aura ------------------------------------------
    let ringColor = 0;
    let ringA = 0;
    let ringR = L.shadowR;
    if (elite) {
      ringColor = GOLD;
      ringA = 0.62 + 0.28 * Math.sin(time * 3.4 + L.px * 0.07);
      ringR = L.shadowR * (1.55 + 0.06 * Math.sin(time * 3.4));
    } else if (type === 'healer') {
      const p = 0.5 + 0.5 * Math.sin(time * 2.4 + L.px * 0.05);
      ringColor = HEALER_GREEN;
      ringA = 0.28 + 0.22 * p;
      ringR = L.shadowR * (1.7 + 0.25 * p);
    } else if (type === 'tempest' || type === 'boss') {
      ringColor = (w.bossPhase ?? 0) >= 2 ? ENRAGE : type === 'tempest' ? STORM : 0xb49cff;
      ringA = 0.4 + 0.15 * Math.sin(time * 4);
      ringR = L.shadowR * 1.6;
    }
    const ring = this.show(ex, 'ring', ringA > 0.02 && !w.burrowed, art);
    if (ring) {
      ring.tint = ringColor;
      ring.alpha = Math.min(1, ringA);
      ring.position.set(L.px, L.py + 2);
      ring.scale.set((ringR * 2) / 128, (ringR * 0.95) / 128);
    }

    // ---- elite crown ---------------------------------------------------------------------------
    const crown = this.show(ex, 'crown', elite && !w.burrowed, art);
    if (crown) {
      const cw = 20 * ui;
      crown.position.set(L.px, L.cy - L.heightPx * 0.5 - 22 * ui + Math.sin(time * 4 + L.px * 0.1) * 1.2);
      crown.scale.set(cw / 48);
      crown.zIndex = L.py + 0.6;
    }

    // ---- burrower: sink into a moving dirt mound -------------------------------------------------
    const target = w.burrowed ? 1 : 0;
    if (anim.burrowK !== target) {
      const step = dt / BURROW_EASE_SEC;
      anim.burrowK = target > anim.burrowK ? Math.min(target, anim.burrowK + step) : Math.max(target, anim.burrowK - step);
      if (dt === 0) anim.burrowK = target; // paused / first frame: no easing
    }
    const bk = type === 'burrower' ? anim.burrowK : 0;
    const mound = this.show(ex, 'mound', bk > 0.01, art);
    if (mound) {
      const ease = bk * bk * (3 - 2 * bk);
      const mw = L.shadowR * 3.2 * (0.55 + 0.45 * ease);
      const wob = 1 + 0.05 * Math.sin(time * 13);
      mound.position.set(L.px, L.py + 3 + Math.sin(time * 19) * 0.8);
      mound.scale.set((mw / Math.max(1, mound.texture.width)) * wob, (mw / Math.max(1, mound.texture.width)) * (0.8 + 0.2 * ease) / wob);
      mound.alpha = Math.min(1, bk * 1.6);
      mound.zIndex = L.py - 0.2;
      // Dust trail while it ploughs along underground.
      anim.dustT -= dt;
      if (this.fx && w.burrowed && anim.dustT <= 0 && dt > 0) {
        anim.dustT = 0.075;
        const jx = (this.fx.random() - 0.5) * L.shadowR * 1.6;
        this.fx.spawn('puff', L.px + jx, L.py - 2, 8 + this.fx.random() * 6, jx * 0.6, -16 - this.fx.random() * 12, 0.42, DIRT);
      }
    }
    if (bk > 0) {
      out.bodyAlpha = 1 - Math.min(1, bk * 1.25);
      out.squashY = 1 - 0.8 * bk;
      out.bodyVisible = bk < 0.97;
      out.shadowAlpha = 1 - bk;
    }

    out.tint = tint;
  }
}
