import { CanvasTextMetrics, Container, Graphics, NineSliceSprite, Sprite, type Text } from 'pixi.js';
import { t, type MsgKey } from '../i18n/index.ts';
import type { LoadedArt } from './assets2d.ts';
import { paintedText, setFontSize, setText } from './hudText.ts';
import { fitWidth, hasKit, inkText, kit, setInkSize } from './uiKit.ts';
import { hudDock, type HudDock, type HudDockOptions } from './hudDock.ts';
import type { QaTextItem } from './qaText.ts';
import { hornStackText, type HornLabelSize, type HornPlacement } from './hornSpot.ts';
import { HUD_MIN_TOUCH, hudButtonsLayout, KIT_PLAQUE_SLOTS, NO_INSETS, plateCentreY, uiScale, type Insets, type PlaqueSlots, type Rect } from './uiLayout.ts';

/**
 * game2d.ts sets `HudState.banner` to these English ids (its protocol, not display text); the HUD
 * shows them in the player's language with their sub line.
 */
const BANNERS: Readonly<Record<string, readonly [MsgKey, MsgKey]>> = {
  Paused: ['hud.paused', 'hud.pausedSub'], // i18n-ignore (banner id)
  'Tap the road': ['hud.tapRoad', 'hud.tapRoadSub'], // i18n-ignore (banner id)
};

/** Vertical middle of the wave banner's cloth body, as a fraction of the banner art's height. */
export const BANNER_CLOTH_MID = 0.6;

/** Minimum touch target edge in css px. */
export const MIN_TOUCH = HUD_MIN_TOUCH;

export type HudAction = 'pause' | 'speed' | 'horn' | null;

export interface HudState {
  readonly lives: number;
  readonly gold: number;
  readonly wave: number;
  readonly totalWaves: number;
  readonly paused: boolean;
  readonly speed: number;
  /** Next wave can be called (horn active). */
  readonly canCall: boolean;
  /** Gold for calling it early (0 = none). */
  readonly earlyBonus: number;
  readonly banner: string;
  /** Lives the run started with (the number turns red when lives run low). */
  readonly startLives?: number;
  /** Seconds until the next wave starts on its own (0 = no countdown running). */
  readonly countdown?: number;
  /** The countdown's remaining fraction 0..1 (drives the ring round the horn). */
  readonly countdownFrac?: number;
}

interface RoundButton {
  readonly root: Container;
  readonly bg: Sprite;
  readonly glyph: Graphics;
  readonly label: Text;
  r: number;
}

/** The legacy plaque (empty board): icons are drawn inside it at these x fractions. */
const OLD_PLAQUE_SLOTS: PlaqueSlots = { lives: [0.215, 0.45], gold: [0.6, 0.92], midY: 0.5 };
const OLD_HEART_X = 0.13;
const OLD_COIN_X = 0.52;

/**
 * Painted in-canvas HUD in screen space (css px): lives/gold plaque (bottom-left, inside the safe
 * area), wave banner (bottom-right), round pause and speed buttons (top-right), the horn that calls
 * the next wave (with early-call bonus), and a parchment plate for "Paused" / "Tap the road".
 * Sizes scale with the viewport but never below MIN_TOUCH.
 */
export class Hud {
  /** Mouse + hover client (game2d sets it): banners say "Click" instead of "Tap". */
  desktop = false;
  /**
   * Screen box the centre plate must not cover (the rally range circle: the road the player has
   * to tap is inside it). game2d sets it; the plate moves to the top or bottom band instead.
   */
  plateAvoid: Rect | null = null;
  private plateAvoidKey = '';

  readonly root = new Container();
  private readonly plaque: Sprite;
  private readonly heart: Sprite;
  private readonly coin: Sprite;
  private readonly kitPlaque: boolean;
  private readonly slots: PlaqueSlots;
  private readonly livesText = paintedText(30, 'center');
  private readonly goldText = paintedText(30, 'center');
  private readonly banner: Sprite;
  private readonly waveText = paintedText(26, 'center');
  private readonly pauseBtn: RoundButton;
  private readonly speedBtn: RoundButton;
  private readonly horn: Sprite;
  private readonly hornLabel = paintedText(20, 'right', '#ffe27a');
  /** Countdown ring round the horn and its seconds under it (between waves). */
  private readonly hornRing = new Graphics();
  private readonly hornSecs = paintedText(18, 'right', '#fff4dc');
  private lastSecs = -1;
  private lastRingFrac = -1;
  private readonly plate: NineSliceSprite | Graphics;
  private readonly centre = inkText(40, 'center');
  private readonly sub = inkText(20, 'center', '#7a5532', '600');
  private livesBox: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private goldBox: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private plateBorder = 1;
  private hornX = 0;
  private hornY = 0;
  private hornR = 40;
  private hornTextW = 60;
  private hornBox: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private hornAtCave = false;
  private dockHorn: { x: number; y: number; r: number; box: Rect; textW: number } = { x: 0, y: 0, r: 40, box: { x: 0, y: 0, w: 0, h: 0 }, textW: 60 };
  private bannerFont = 30;
  private screenW = 1;
  private screenH = 1;
  private t = 0;
  private lastPaused = -1;
  private lastSpeed = -1;
  private lastLives = NaN;
  /** Seconds left of the lives number's "hit" pop, and its fitted scale. */
  private livesHit = 0;
  private livesBaseScale = 1;
  private goldBump = 0;
  private goldBaseScale = 1;
  private goldTint = 0xffffff;
  private lastGold = NaN;
  private lastWave = NaN;
  /** "Wave n" bump when a new wave marches (not on the first fill / a reset). */
  private waveBump = 0;
  private waveBaseScale = 1;
  private prevWaveNum = NaN;
  private endlessAfter: number | null = null;
  private lastHorn = NaN;
  private lastBanner = '\u0000';

  constructor(art: LoadedArt) {
    this.kitPlaque = hasKit(art, 'hudPlaque');
    this.slots = this.kitPlaque ? KIT_PLAQUE_SLOTS : OLD_PLAQUE_SLOTS;
    this.plaque = new Sprite(kit(art, 'hudPlaque', art.ui.plaque));
    this.heart = new Sprite(art.ui.heart);
    this.coin = new Sprite(art.ui.gold);
    this.heart.visible = this.coin.visible = !this.kitPlaque;
    this.banner = new Sprite(art.ui.banner);
    this.horn = new Sprite(art.ui.horn);
    for (const s of [this.heart, this.coin, this.horn]) s.anchor.set(0.5);
    this.banner.anchor.set(0.5, 0);
    this.pauseBtn = this.makeButton(art);
    this.speedBtn = this.makeButton(art);
    const tip = art.uiKit?.tooltip;
    if (tip) {
      this.plateBorder = Math.round(tip.width * 0.11);
      const b = this.plateBorder;
      this.plate = new NineSliceSprite({ texture: tip, leftWidth: b, rightWidth: b, topHeight: b, bottomHeight: b });
    } else this.plate = new Graphics();
    this.plate.visible = false;
    this.root.addChild(
      this.plaque,
      this.heart,
      this.coin,
      this.livesText,
      this.goldText,
      this.banner,
      this.waveText,
      this.pauseBtn.root,
      this.speedBtn.root,
      this.hornRing,
      this.horn,
      this.hornLabel,
      this.hornSecs,
      this.plate,
      this.centre,
      this.sub,
    );
  }

  private makeButton(art: LoadedArt): RoundButton {
    const root = new Container();
    const bg = new Sprite(kit(art, 'buttonRound', art.ui.button));
    bg.anchor.set(0.5);
    const glyph = new Graphics();
    const label = paintedText(22, 'center');
    root.addChild(bg, glyph, label);
    return { root, bg, glyph, label, r: 30 };
  }

  /** What the dock needs to know about this HUD's art (hudDock.ts). */
  dockOptions(hero: boolean): HudDockOptions {
    const p = this.plaque.texture;
    const b = this.banner.texture;
    return { plaqueAspect: p.width / Math.max(1, p.height), plaqueSlots: this.slots, bannerAspect: b.width / Math.max(1, b.height), hero };
  }

  /** Lays out for a screen: every piece at its place in the dock (the same on every island). */
  layout(w: number, h: number, dock: HudDock = hudDock(w, h, NO_INSETS, this.dockOptions(false)), insets: Insets = NO_INSETS): void {
    this.screenW = w;
    this.screenH = h;
    const u = uiScale(w, h);
    const pl = dock.plaque;
    this.plaque.position.set(pl.x, pl.y);
    this.plaque.width = pl.w;
    this.plaque.height = pl.h;
    this.livesBox = pl.livesBox;
    this.goldBox = pl.goldBox;
    if (!this.kitPlaque) {
      const icon = pl.h * 0.6;
      this.heart.position.set(pl.x + pl.w * OLD_HEART_X, pl.y + pl.h / 2);
      this.heart.scale.set(icon / Math.max(1, this.heart.texture.height));
      this.coin.position.set(pl.x + pl.w * OLD_COIN_X, pl.y + pl.h / 2);
      this.coin.scale.set((icon * 1.04) / Math.max(1, this.coin.texture.height));
    }
    for (const [t, b] of [
      [this.livesText, pl.livesBox],
      [this.goldText, pl.goldBox],
    ] as const) {
      setFontSize(t, pl.fontSize);
      t.position.set(b.x + b.w / 2, b.y + b.h / 2);
    }
    this.fitNumbers();

    // Shared with the DOM Codex button (codex2d.ts), so the three stay in one row.
    const hb = hudButtonsLayout(w, h, insets);
    const r = hb.r;
    this.speedBtn.r = r;
    this.pauseBtn.r = r;
    this.speedBtn.root.position.set(hb.speedX, hb.y);
    this.pauseBtn.root.position.set(hb.pauseX, hb.y);
    for (const b of [this.speedBtn, this.pauseBtn]) {
      b.bg.width = r * 2;
      b.bg.height = r * 2;
      setFontSize(b.label, Math.round(r * 0.66));
    }

    // Wave banner bottom-right, mirroring the plaque.
    const bw = dock.banner.w;
    const bh = dock.banner.h;
    const bannerY = dock.banner.y;
    this.banner.position.set(dock.banner.x + bw / 2, bannerY);
    this.banner.width = bw;
    this.banner.height = bh;
    // Optical centre of the red cloth (ui-banner.webp: the rope and knots fill the top third, the
    // solid cloth runs 36-86% of the height, ragged hem below), plus a nudge for the font's
    // descender space so "Wave 1/10" / "Dalga 1/10" sits in the middle of the cloth.
    const waveFont = Math.round(Math.max(15, bh * 0.36));
    setFontSize(this.waveText, waveFont);
    this.waveText.position.set(this.banner.x, bannerY + bh * BANNER_CLOTH_MID + waveFont * 0.05);
    this.bannerFont = bw * 0.68;

    // Horn in the dock (beside the wave banner): the bonus label and the seconds stand on its left,
    // right-aligned against the countdown ring, so the piece stays one short block.
    this.hornR = dock.horn.r;
    this.hornX = dock.horn.x;
    this.hornY = dock.horn.y;
    this.hornTextW = dock.hornTextW;
    this.hornBox = dock.hornBox;
    this.dockHorn = { x: this.hornX, y: this.hornY, r: this.hornR, box: this.hornBox, textW: this.hornTextW };
    setFontSize(this.hornLabel, Math.round(Math.max(17, 22 * u)));
    setFontSize(this.hornSecs, Math.round(Math.max(14, 18 * u)));
    this.placeHornText('side');
    this.lastHorn = NaN;
    this.lastSecs = -1;
    this.lastRingFrac = -1;

    setInkSize(this.centre, Math.round(Math.max(24, 44 * u)));
    setInkSize(this.sub, Math.round(Math.max(14, 20 * u)));
    this.lastPaused = -1;
    this.lastSpeed = -1;
    this.lastBanner = '\u0000';
  }

  /** Numbers never leave their slot in the wood (4-digit gold shrinks instead). */
  private fitNumbers(): void {
    fitWidth(this.livesText, this.livesBox.w);
    fitWidth(this.goldText, this.goldBox.w);
  }

  private drawPauseGlyph(paused: boolean): void {
    const b = this.pauseBtn;
    const g = b.glyph;
    const r = b.r;
    g.clear();
    if (paused) {
      g.moveTo(-r * 0.2, -r * 0.32).lineTo(r * 0.32, 0).lineTo(-r * 0.2, r * 0.32).closePath();
    } else {
      g.roundRect(-r * 0.28, -r * 0.32, r * 0.19, r * 0.64, r * 0.05);
      g.roundRect(r * 0.09, -r * 0.32, r * 0.19, r * 0.64, r * 0.05);
    }
    g.fill({ color: 0xfff4dc }).stroke({ color: 0x3a2412, width: Math.max(2, r * 0.08) });
  }

  private layoutPlate(): void {
    const has = this.centre.text !== '';
    this.plate.visible = has;
    if (!has) return;
    const cx = this.screenW / 2;
    const subOn = this.sub.text !== '';
    const tw = Math.max(this.centre.width, subOn ? this.sub.width : 0);
    const fs = Number(this.centre.style.fontSize);
    const pw = tw + fs * 1.6;
    const ph = fs * (subOn ? 2.5 : 1.75);
    const cy = plateCentreY(this.screenH, { x: cx - pw / 2, w: pw, h: ph }, this.plateAvoid);
    this.centre.position.set(cx, cy - (subOn ? fs * 0.36 : 0));
    this.sub.position.set(cx, cy + fs * 0.62);
    const x = cx - pw / 2;
    const y = cy - ph / 2;
    if (this.plate instanceof NineSliceSprite) {
      const s = Math.min(ph * 0.26, fs * 0.6) / this.plateBorder;
      this.plate.scale.set(s);
      this.plate.width = pw / s;
      this.plate.height = ph / s;
      this.plate.position.set(x, y);
    } else {
      this.plate.clear().roundRect(x, y, pw, ph, 12).fill({ color: 0xf6e7c4 }).stroke({ color: 0x8a5a2b, width: 3 });
    }
  }

  /**
   * Endless run: the banner reads "Wave n/story" through the island's own waves, then
   * "Endless · Wave n" (the sim's totalWaves grows with the wave in Endless). null = normal run.
   */
  /** The wave banner's text (QA). */
  get waveLabel(): string {
    return this.waveText.text;
  }

  setEndless(storyWaves: number | null): void {
    this.endlessAfter = storyWaves;
    this.lastWave = NaN;
  }

  update(s: HudState, dt: number): void {
    const ak = this.plateAvoid ? `${Math.round(this.plateAvoid.x)},${Math.round(this.plateAvoid.y)},${Math.round(this.plateAvoid.w)}` : '';
    if (ak !== this.plateAvoidKey) {
      this.plateAvoidKey = ak;
      this.layoutPlate();
    }
    this.t += dt;
    // Strings are only built when a value changes (no per-frame allocation).
    if (s.lives !== this.lastLives) {
      if (s.lives < this.lastLives) this.livesHit = 0.5;
      this.lastLives = s.lives;
      setText(this.livesText, String(s.lives));
      fitWidth(this.livesText, this.livesBox.w);
      this.livesBaseScale = this.livesText.scale.x;
      const low = s.startLives !== undefined && s.lives > 0 && (s.lives <= 3 || s.lives <= Math.floor(s.startLives * 0.25));
      this.livesText.style.fill = low ? '#ffb4a0' : '#fff4dc';
    }
    if (this.livesHit > 0) {
      this.livesHit = Math.max(0, this.livesHit - dt);
      const k = this.livesHit / 0.5;
      this.livesText.scale.set(this.livesBaseScale * (1 + 0.28 * Math.sin(k * Math.PI)));
      this.livesText.tint = k > 0 ? 0xff8a7a : 0xffffff;
    } else if (this.livesText.tint !== 0xffffff) {
      this.livesText.tint = 0xffffff;
      this.livesText.scale.set(this.livesBaseScale);
    }
    if (s.gold !== this.lastGold) {
      // Earn: a warm gold bump; spend: a short red dip (not on the first fill).
      if (Number.isFinite(this.lastGold)) {
        this.goldBump = 0.3;
        this.goldTint = s.gold > this.lastGold ? 0xffe27a : 0xff9a8a;
      }
      this.lastGold = s.gold;
      setText(this.goldText, String(s.gold));
      fitWidth(this.goldText, this.goldBox.w);
      this.goldBaseScale = this.goldText.scale.x;
    }
    if (this.goldBump > 0) {
      this.goldBump = Math.max(0, this.goldBump - dt);
      const k = this.goldBump / 0.3;
      this.goldText.scale.set(this.goldBaseScale * (1 + 0.14 * Math.sin(k * Math.PI)));
      this.goldText.tint = k > 0.05 ? this.goldTint : 0xffffff;
    } else if (this.goldText.tint !== 0xffffff) {
      this.goldText.tint = 0xffffff;
      this.goldText.scale.set(this.goldBaseScale);
    }
    if (s.wave * 1000 + s.totalWaves !== this.lastWave) {
      this.lastWave = s.wave * 1000 + s.totalWaves;
      const w = Math.max(1, s.wave);
      const story = this.endlessAfter;
      setText(this.waveText, story === null ? t('hud.wave', { n: w, total: s.totalWaves }) : w <= story ? t('hud.wave', { n: w, total: story }) : t('hud.endlessWave', { n: w }));
      fitWidth(this.waveText, this.bannerFont);
      this.waveBaseScale = this.waveText.scale.x;
      if (Number.isFinite(this.prevWaveNum) && s.wave > this.prevWaveNum && s.wave > 1) this.waveBump = 0.5;
      this.prevWaveNum = s.wave;
    }
    if (this.waveBump > 0) {
      this.waveBump = Math.max(0, this.waveBump - dt);
      const k = this.waveBump / 0.5;
      this.waveText.scale.set(this.waveBaseScale * (1 + 0.16 * Math.sin(k * Math.PI)));
      this.waveText.tint = k > 0.05 ? 0xffe9a8 : 0xffffff;
    } else if (this.waveText.tint !== 0xffffff) {
      this.waveText.tint = 0xffffff;
      this.waveText.scale.set(this.waveBaseScale);
    }
    const pausedKey = s.paused ? 1 : 0;
    if (pausedKey !== this.lastPaused) {
      this.lastPaused = pausedKey;
      this.drawPauseGlyph(s.paused);
    }
    if (s.speed !== this.lastSpeed) {
      this.lastSpeed = s.speed;
      setText(this.speedBtn.label, `${s.speed}×`);
    }
    const pulse = s.canCall ? 1 + Math.sin(this.t * 5) * 0.06 : 0.86;
    this.horn.position.set(this.hornX, this.hornY);
    const hs = (this.hornR * 2 * pulse) / Math.max(1, this.horn.texture.width);
    this.horn.scale.set(hs);
    this.horn.alpha = s.canCall ? 1 : 0.5;
    const hornKey = s.canCall ? (s.earlyBonus > 0 ? s.earlyBonus : s.wave === 0 ? -1 : 0) : -2;
    if (hornKey !== this.lastHorn) {
      this.lastHorn = hornKey;
      setText(this.hornLabel, hornKey > 0 ? `+${hornKey}` : hornKey === -1 ? t('hud.start') : '');
      fitWidth(this.hornLabel, this.hornTextW - 6);
    }
    this.drawCountdown(s.countdown ?? 0, s.countdownFrac ?? 0);
    if (s.banner !== this.lastBanner) {
      this.lastBanner = s.banner;
      const known = BANNERS[s.banner];
      // With a mouse the rally banner says "Click the road".
      const head = known && this.desktop && known[0] === 'hud.tapRoad' ? 'hud.clickRoad' : known?.[0];
      setText(this.centre, head ? t(head) : s.banner);
      setText(this.sub, known ? t(known[1]) : '');
      // A long translation never runs off a phone screen.
      fitWidth(this.centre, this.screenW * 0.8);
      fitWidth(this.sub, this.screenW * 0.8);
      this.layoutPlate();
    }
  }

  /**
   * Between waves: a gold ring round the horn runs down with the countdown, the seconds under it
   * (pulsing red in the last 3 s). Redrawn only when the ring moves a visible step.
   */
  private drawCountdown(sec: number, frac: number): void {
    const on = sec > 0 && frac > 0;
    const f = on ? Math.round(frac * 240) / 240 : 0;
    if (f !== this.lastRingFrac) {
      this.lastRingFrac = f;
      const g = this.hornRing;
      g.clear();
      if (on) {
        const r = this.hornR * 1.12;
        const w = Math.max(4, this.hornR * 0.13);
        const a0 = -Math.PI / 2;
        g.circle(this.hornX, this.hornY, r).stroke({ color: 0x2a1808, width: w + 3, alpha: 0.55 });
        // moveTo first: an arc continues the current path (a stray line from the origin otherwise).
        const sx = this.hornX + Math.cos(a0) * r;
        const sy = this.hornY + Math.sin(a0) * r;
        g.moveTo(sx, sy).arc(this.hornX, this.hornY, r, a0, a0 + Math.PI * 2 * f).stroke({ color: 0x3a2412, width: w + 2.5, cap: 'round' });
        g.moveTo(sx, sy).arc(this.hornX, this.hornY, r, a0, a0 + Math.PI * 2 * f).stroke({ color: f < 0.25 ? 0xff9a5a : 0xf2c24a, width: w, cap: 'round' });
      }
    }
    const whole = on ? Math.ceil(sec) : -1;
    if (whole !== this.lastSecs) {
      this.lastSecs = whole;
      setText(this.hornSecs, whole > 0 ? t('ab.secs', { n: whole }) : '');
      this.hornSecs.style.fill = whole > 0 && whole <= 3 ? '#ffb08a' : '#fff4dc';
    }
    this.hornSecs.visible = whole > 0;
    if (whole > 0 && whole <= 3) this.hornSecs.scale.set(1 + 0.12 * Math.max(0, Math.sin(this.t * 9)));
    else this.hornSecs.scale.set(1);
  }

  /** Horn radius (css px), for things anchored to it (next-wave card). */
  get hornRadius(): number {
    return this.hornR;
  }

  hit(x: number, y: number): HudAction {
    const near = (cx: number, cy: number, r: number): boolean => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    if (near(this.pauseBtn.root.x, this.pauseBtn.root.y, this.pauseBtn.r * 1.1)) return 'pause';
    if (near(this.speedBtn.root.x, this.speedBtn.root.y, this.speedBtn.r * 1.1)) return 'speed';
    if (near(this.hornX, this.hornY, this.hornR * 1.15)) return 'horn';
    return null;
  }

  /** Screen rect the HUD occupies at the top (ring placement keeps clear of it). */
  get topBand(): number {
    // The plaque / banner live in the bottom scenery band; only the round buttons sit at the top.
    return Math.max(this.pauseBtn.root.y + this.pauseBtn.r, this.speedBtn.root.y + this.speedBtn.r);
  }

  /** Centres of the round buttons (QA hooks). */
  get buttonPositions(): { pause: { x: number; y: number }; speed: { x: number; y: number } } {
    return {
      pause: { x: this.pauseBtn.root.x, y: this.pauseBtn.root.y },
      speed: { x: this.speedBtn.root.x, y: this.speedBtn.root.y },
    };
  }

  /** Screen rect of the "Paused" plate while the player has paused (the Settings plank sits under it), else null. */
  get pausePlate(): Rect | null {
    if (this.lastBanner !== 'Paused' || !this.plate.visible) return null; // i18n-ignore (banner id)
    const r = this.plate.getBounds();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }

  get hornPosition(): { x: number; y: number } {
    return { x: this.hornX, y: this.hornY };
  }

  /** Sizes of the horn's label (its widest text) and seconds, for a spot beside a cave (hornSpot.ts). */
  hornLabelSize(): HornLabelSize {
    const ls = this.hornLabel.style;
    const widest = Math.max(...[t('hud.start'), '+888'].map((s) => CanvasTextMetrics.measureText(s, ls).width));
    const lf = Number(ls.fontSize);
    const sf = Number(this.hornSecs.style.fontSize);
    // Pixi's bounds include the outline stroke (0.2 × size) and the line's ascent / descent.
    return { labelW: Math.ceil(widest + lf * 0.25), labelH: Math.ceil(lf * 1.5), secsH: Math.ceil(sf * 1.45) };
  }

  /** The horn beside the next wave's cave (null: back to its dock spot). */
  setHornPlacement(p: HornPlacement | null): void {
    this.hornAtCave = !!p;
    if (p) {
      this.hornX = p.horn.x;
      this.hornY = p.horn.y;
      this.hornR = p.horn.r;
      this.hornBox = p.hornBox;
      this.hornTextW = p.shape === 'stack' ? p.hornBox.w : p.hornBox.w - p.horn.r * 2.44;
      this.placeHornText(p.shape === 'stack' ? 'stack' : p.shape === 'left' ? 'side' : 'right');
    } else {
      const d = this.dockHorn;
      this.hornX = d.x;
      this.hornY = d.y;
      this.hornR = d.r;
      this.hornBox = d.box;
      this.hornTextW = d.textW;
      this.placeHornText('side');
    }
    this.lastHorn = NaN;
    this.lastSecs = -1;
    this.lastRingFrac = -1;
  }

  /** Where the horn's label and seconds stand for its current spot. */
  /** 'side': label and seconds left of the horn; 'right': right of it; 'stack': above / below it. */
  private placeHornText(mode: 'side' | 'stack' | 'right'): void {
    if (mode === 'right') {
      const tx = this.hornX + this.hornR * 1.2 + 2;
      for (const tt of [this.hornLabel, this.hornSecs]) {
        tt.anchor.set(0, 0.5);
        tt.style.align = 'left';
      }
      this.hornLabel.position.set(tx + 3, this.hornY - this.hornR * 0.42);
      this.hornSecs.position.set(tx + 3, this.hornY + this.hornR * 0.42);
    } else if (mode === 'side') {
      const tx = this.hornX - this.hornR * 1.2 - 2;
      for (const tt of [this.hornLabel, this.hornSecs]) {
        tt.anchor.set(1, 0.5);
        tt.style.align = 'right';
      }
      this.hornLabel.position.set(tx - 3, this.hornY - this.hornR * 0.42);
      this.hornSecs.position.set(tx - 3, this.hornY + this.hornR * 0.42);
    } else {
      const ys = hornStackText(this.hornY, this.hornR, this.hornLabelSize());
      for (const tt of [this.hornLabel, this.hornSecs]) {
        tt.anchor.set(0.5, 0.5);
        tt.style.align = 'center';
      }
      this.hornLabel.position.set(this.hornX, ys.labelY);
      this.hornSecs.position.set(this.hornX, ys.secsY);
    }
    fitWidth(this.hornLabel, this.hornTextW - 6);
  }

  /** Where the horn stands now: at its dock corner ('dock') or beside the next wave's cave ('cave'). */
  get hornSpot(): 'dock' | 'cave' {
    return this.hornAtCave ? 'cave' : 'dock';
  }

  /**
   * QA (qaText.ts): the numbers in their plaque slots, "Wave n/N" on the banner's cloth (between
   * the rope knots, above the ragged hem), the horn's label and seconds in its piece, the Paused
   * plate's lines on the plate.
   */
  qaTexts(): QaTextItem[] {
    const bn = this.banner.getBounds();
    const cloth = { x: bn.x + bn.width * 0.14, y: bn.y + bn.height * 0.3, w: bn.width * 0.72, h: bn.height * 0.66 };
    const plate = this.plate.getBounds();
    const pb = { x: plate.x, y: plate.y, w: plate.width, h: plate.height };
    return [
      { name: 'hud.lives', text: this.livesText, box: this.livesBox, gap: 0 },
      { name: 'hud.gold', text: this.goldText, box: this.goldBox, gap: 0 },
      { name: 'hud.wave', text: this.waveText, box: cloth },
      { name: 'hud.hornLabel', text: this.hornLabel, box: this.hornBox, gap: 0 },
      { name: 'hud.hornSecs', text: this.hornSecs, box: this.hornBox, gap: 0 },
      { name: 'hud.plate', text: this.centre, box: pb, gap: 4 },
      { name: 'hud.plateSub', text: this.sub, box: pb, gap: 4 },
    ];
  }

  /** Screen rects of every HUD piece (QA: all must sit inside the viewport; numbers inside the plaque). */
  rects(): Record<string, Rect> {
    const b = (o: Container): Rect => {
      const r = o.getBounds();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      plaque: b(this.plaque),
      lives: b(this.livesText),
      gold: b(this.goldText),
      livesSlot: this.livesBox,
      goldSlot: this.goldBox,
      banner: b(this.banner),
      waveText: b(this.waveText),
      pause: b(this.pauseBtn.root),
      speed: b(this.speedBtn.root),
      horn: { x: this.hornX - this.hornR, y: this.hornY - this.hornR, w: this.hornR * 2, h: this.hornR * 2 },
      /** The horn with its countdown ring and the label / seconds beside it (its dock slot). */
      hornBox: this.hornBox,
    };
  }
}
