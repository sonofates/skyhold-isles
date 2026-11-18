import { Container, Graphics, NineSliceSprite, Sprite, type Text } from 'pixi.js';
import { t, type MsgKey } from '../i18n/index.ts';
import type { LoadedArt } from './assets2d.ts';
import { paintedText, setFontSize, setText } from './hudText.ts';
import { fitWidth, hasKit, inkText, kit, setInkSize } from './uiKit.ts';
import { HUD_MIN_TOUCH, hudButtonsLayout, KIT_PLAQUE_SLOTS, NO_INSETS, plaqueLayout, uiScale, type Insets, type PlaqueSlots, type Rect } from './uiLayout.ts';

/**
 * game2d.ts sets `HudState.banner` to these English ids (its protocol, not display text); the HUD
 * shows them in the player's language with their sub line.
 */
const BANNERS: Readonly<Record<string, readonly [MsgKey, MsgKey]>> = {
  Paused: ['hud.paused', 'hud.pausedSub'], // i18n-ignore (banner id)
  'Tap the road': ['hud.tapRoad', 'hud.tapRoadSub'], // i18n-ignore (banner id)
};

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
  private readonly hornLabel = paintedText(20, 'center', '#ffe27a');
  private readonly plate: NineSliceSprite | Graphics;
  private readonly centre = inkText(40, 'center');
  private readonly sub = inkText(20, 'center', '#7a5532', '600');
  private livesBox: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private goldBox: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private plateBorder = 1;
  private hornX = 0;
  private hornY = 0;
  private hornR = 40;
  private bannerFont = 30;
  private screenW = 1;
  private screenH = 1;
  private t = 0;
  private lastPaused = -1;
  private lastSpeed = -1;
  private lastLives = NaN;
  private lastGold = NaN;
  private lastWave = NaN;
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
      this.horn,
      this.hornLabel,
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

  /** Lays out for a screen; `hornAt` = preferred horn position (screen px, e.g. near the entrances). */
  layout(w: number, h: number, hornAt: { x: number; y: number }, insets: Insets = NO_INSETS): void {
    this.screenW = w;
    this.screenH = h;
    const u = uiScale(w, h);
    const pad = Math.max(8, 14 * u);
    const tex = this.plaque.texture;
    const pl = plaqueLayout(w, h, insets, tex.width / Math.max(1, tex.height), this.slots);
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

    // Wave banner bottom-right, mirroring the plaque (bottom band = scenery only).
    const bw = Math.max(150, Math.min(230 * u, (w - insets.left - insets.right) * 0.3));
    const bh = (bw * this.banner.texture.height) / this.banner.texture.width;
    const bannerY = h - insets.bottom - pad - bh;
    this.banner.position.set(w - insets.right - pad - bw / 2, bannerY);
    this.banner.width = bw;
    this.banner.height = bh;
    this.waveText.position.set(this.banner.x, bannerY + bh * 0.47);
    setFontSize(this.waveText, Math.round(Math.max(15, bh * 0.38)));
    this.bannerFont = bw * 0.68;

    this.hornR = Math.max(MIN_TOUCH / 2 + 4, 44 * u);
    const minY = insets.top + pad + this.hornR + 4;
    this.hornX = Math.max(insets.left + pad + this.hornR, Math.min(w - insets.right - pad - this.hornR, hornAt.x));
    this.hornY = Math.max(minY, Math.min(pl.y - this.hornR - 30, hornAt.y));
    this.hornLabel.position.set(this.hornX, this.hornY - this.hornR - 12);
    setFontSize(this.hornLabel, Math.round(Math.max(15, 20 * u)));

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
    const cy = this.screenH * 0.42;
    const subOn = this.sub.text !== '';
    const tw = Math.max(this.centre.width, subOn ? this.sub.width : 0);
    const fs = Number(this.centre.style.fontSize);
    const pw = tw + fs * 1.6;
    const ph = fs * (subOn ? 2.5 : 1.75);
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
    this.t += dt;
    // Strings are only built when a value changes (no per-frame allocation).
    if (s.lives !== this.lastLives) {
      this.lastLives = s.lives;
      setText(this.livesText, String(s.lives));
      fitWidth(this.livesText, this.livesBox.w);
    }
    if (s.gold !== this.lastGold) {
      this.lastGold = s.gold;
      setText(this.goldText, String(s.gold));
      fitWidth(this.goldText, this.goldBox.w);
    }
    if (s.wave * 1000 + s.totalWaves !== this.lastWave) {
      this.lastWave = s.wave * 1000 + s.totalWaves;
      const w = Math.max(1, s.wave);
      const story = this.endlessAfter;
      setText(this.waveText, story === null ? t('hud.wave', { n: w, total: s.totalWaves }) : w <= story ? t('hud.wave', { n: w, total: story }) : t('hud.endlessWave', { n: w }));
      fitWidth(this.waveText, this.bannerFont);
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
    }
    if (s.banner !== this.lastBanner) {
      this.lastBanner = s.banner;
      const known = BANNERS[s.banner];
      setText(this.centre, known ? t(known[0]) : s.banner);
      setText(this.sub, known ? t(known[1]) : '');
      // A long translation never runs off a phone screen.
      fitWidth(this.centre, this.screenW * 0.8);
      fitWidth(this.sub, this.screenW * 0.8);
      this.layoutPlate();
    }
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
    };
  }
}
