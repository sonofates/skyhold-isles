import { Container, Graphics, Sprite, type Text } from 'pixi.js';
import type { LoadedArt } from './assets2d.ts';
import { paintedText, setFontSize, setText } from './hudText.ts';

/** Minimum touch target edge in css px. */
export const MIN_TOUCH = 48;

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

/**
 * Painted in-canvas HUD in screen space (css px): lives/gold plaque, wave banner, round pause and
 * speed buttons, the horn that calls the next wave (with early-call bonus), and a centre banner
 * for pause / victory / defeat. Sizes scale with the viewport but never below MIN_TOUCH.
 */
export class Hud {
  readonly root = new Container();
  private readonly plaque: Sprite;
  private readonly heart: Sprite;
  private readonly coin: Sprite;
  private readonly livesText = paintedText(30);
  private readonly goldText = paintedText(30);
  private readonly banner: Sprite;
  private readonly waveText = paintedText(26, 'center');
  private readonly pauseBtn: RoundButton;
  private readonly speedBtn: RoundButton;
  private readonly horn: Sprite;
  private readonly hornLabel = paintedText(20, 'center', '#ffe27a');
  private readonly centre = paintedText(48, 'center');
  private readonly sub = paintedText(22, 'center');
  private hornX = 0;
  private hornY = 0;
  private hornR = 40;
  private t = 0;
  private lastPaused = -1;
  private lastSpeed = -1;
  private lastLives = NaN;
  private lastGold = NaN;
  private lastWave = NaN;
  private lastHorn = NaN;
  private lastBanner = '\u0000';

  constructor(art: LoadedArt) {
    this.plaque = new Sprite(art.ui.plaque);
    this.heart = new Sprite(art.ui.heart);
    this.coin = new Sprite(art.ui.gold);
    this.banner = new Sprite(art.ui.banner);
    this.horn = new Sprite(art.ui.horn);
    for (const s of [this.heart, this.coin, this.horn]) s.anchor.set(0.5);
    this.banner.anchor.set(0.5, 0);
    this.pauseBtn = this.makeButton(art);
    this.speedBtn = this.makeButton(art);
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
      this.centre,
      this.sub,
    );
  }

  private makeButton(art: LoadedArt): RoundButton {
    const root = new Container();
    const bg = new Sprite(art.ui.button);
    bg.anchor.set(0.5);
    const glyph = new Graphics();
    const label = paintedText(22, 'center');
    root.addChild(bg, glyph, label);
    return { root, bg, glyph, label, r: 30 };
  }

  /** Lays out for a screen; `hornAt` = preferred horn position (screen px, e.g. near the entrances). */
  layout(w: number, h: number, hornAt: { x: number; y: number }): void {
    const u = Math.max(0.5, Math.min(1.15, Math.min(w / 1400, h / 760)));
    const pad = Math.max(8, 14 * u);
    const pw = Math.max(180, 260 * u);
    const ph = (pw * this.plaque.texture.height) / this.plaque.texture.width;
    // Lives/gold plaque bottom-left: painted maps keep gameplay out of the bottom cliff/cloud band,
    // while the top edge carries roads and the entrance gates.
    const py = h - pad - ph;
    this.plaque.position.set(pad, py);
    this.plaque.width = pw;
    this.plaque.height = ph;
    const icon = ph * 0.62;
    const font = Math.round(Math.max(18, ph * 0.42));
    this.heart.position.set(pad + pw * 0.15, py + ph / 2);
    this.heart.height = icon;
    this.heart.scale.x = this.heart.scale.y;
    this.livesText.position.set(pad + pw * 0.24, py + ph / 2);
    setFontSize(this.livesText, font);
    this.coin.position.set(pad + pw * 0.53, py + ph / 2);
    this.coin.height = icon * 1.05;
    this.coin.scale.x = this.coin.scale.y;
    this.goldText.position.set(pad + pw * 0.62, py + ph / 2);
    setFontSize(this.goldText, font);

    const r = Math.max(MIN_TOUCH / 2, 40 * u);
    this.speedBtn.r = r;
    this.pauseBtn.r = r;
    this.speedBtn.root.position.set(w - pad - r, pad + r);
    this.pauseBtn.root.position.set(w - pad - r * 3.2, pad + r);
    for (const b of [this.speedBtn, this.pauseBtn]) {
      b.bg.width = r * 2;
      b.bg.height = r * 2;
      setFontSize(b.label, Math.round(r * 0.72));
    }

    // Wave banner bottom-right, mirroring the plaque (bottom band = scenery only).
    const bw = Math.max(150, 230 * u);
    const bh = (bw * this.banner.texture.height) / this.banner.texture.width;
    const bannerY = h - pad - bh;
    this.banner.position.set(w - pad - bw / 2, bannerY);
    this.banner.width = bw;
    this.banner.height = bh;
    this.waveText.position.set(this.banner.x, bannerY + bh * 0.5);
    setFontSize(this.waveText, Math.round(Math.max(16, bh * 0.4)));

    this.hornR = Math.max(MIN_TOUCH / 2 + 4, 44 * u);
    const minY = pad + this.hornR + 4;
    this.hornX = Math.max(pad + this.hornR, Math.min(w - pad - this.hornR, hornAt.x));
    this.hornY = Math.max(minY, Math.min(h - pad - ph - this.hornR - 30, hornAt.y));
    this.hornLabel.position.set(this.hornX, this.hornY + this.hornR + 10);
    setFontSize(this.hornLabel, Math.round(Math.max(15, 20 * u)));

    this.centre.position.set(w / 2, h * 0.42);
    setFontSize(this.centre, Math.round(Math.max(30, 56 * u)));
    this.sub.position.set(w / 2, h * 0.42 + Math.max(34, 56 * u));
    setFontSize(this.sub, Math.round(Math.max(16, 24 * u)));
    this.lastPaused = -1;
    this.lastSpeed = -1;
  }

  private drawPauseGlyph(paused: boolean): void {
    const b = this.pauseBtn;
    const g = b.glyph;
    const r = b.r;
    g.clear();
    if (paused) {
      g.moveTo(-r * 0.22, -r * 0.34).lineTo(r * 0.34, 0).lineTo(-r * 0.22, r * 0.34).closePath();
    } else {
      g.roundRect(-r * 0.3, -r * 0.34, r * 0.2, r * 0.68, r * 0.05);
      g.roundRect(r * 0.1, -r * 0.34, r * 0.2, r * 0.68, r * 0.05);
    }
    g.fill({ color: 0xfff4dc }).stroke({ color: 0x3a2412, width: Math.max(2, r * 0.08) });
  }

  update(s: HudState, dt: number): void {
    this.t += dt;
    // Strings are only built when a value changes (no per-frame allocation).
    if (s.lives !== this.lastLives) {
      this.lastLives = s.lives;
      setText(this.livesText, String(s.lives));
    }
    if (s.gold !== this.lastGold) {
      this.lastGold = s.gold;
      setText(this.goldText, String(s.gold));
    }
    if (s.wave * 1000 + s.totalWaves !== this.lastWave) {
      this.lastWave = s.wave * 1000 + s.totalWaves;
      setText(this.waveText, `Wave ${Math.max(1, s.wave)}/${s.totalWaves}`);
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
      setText(this.hornLabel, hornKey > 0 ? `+${hornKey}` : hornKey === -1 ? 'Start!' : '');
    }
    if (s.banner !== this.lastBanner) {
      this.lastBanner = s.banner;
      setText(this.centre, s.banner);
      const over = s.banner === 'Victory!' || s.banner === 'Defeat';
      setText(this.sub, s.banner === '' ? '' : over ? 'Tap to play again' : s.paused ? 'Tap ▶ to resume' : '');
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

  get hornPosition(): { x: number; y: number } {
    return { x: this.hornX, y: this.hornY };
  }
}
