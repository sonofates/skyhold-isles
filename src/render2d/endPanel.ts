import { Container, Graphics, Sprite, Texture, type Text } from 'pixi.js';
import { t, type MsgKey } from '../i18n/index.ts';
import type { LoadedArt } from './assets2d.ts';
import { paintedText, setFontSize, setText } from './hudText.ts';
import { easeOutBack, easeOutCubic, fitWidth, inkText, kit, paintedUiTexture, setInkSize } from './uiKit.ts';
import { END_FRAME, endLayout, NO_INSETS, type EndLayout, type Insets, type Rect } from './uiLayout.ts';
import type { EndModeNote } from './ui/modeBits.ts';

export { endStars } from './uiLayout.ts';

/** `menu` = back to the world map. */
export type EndAction = 'retry' | 'next' | 'menu';

const END_LABELS: Readonly<Record<EndAction, MsgKey>> = { retry: 'end.retry', next: 'end.next', menu: 'end.menu' };

export interface EndSummary {
  readonly won: boolean;
  /** 1..3 on a win (from SimWorld.computeStars), 0 on a defeat. */
  readonly stars: number;
  readonly lives: number;
  readonly startLives: number;
  readonly gold: number;
  readonly wave: number;
  readonly totalWaves: number;
  /** Show the Next button (there is a next island). */
  readonly hasNext: boolean;
}

/**
 * Painted action icons (manifest `paintedUi`). Retry has no painted icon in the kit yet and keeps
 * its Graphics glyph; so does any button whose painting has not loaded (or failed to).
 */
const PAINTED_ICON: Partial<Readonly<Record<EndAction, string>>> = { next: 'icon-play', menu: 'icon-map' };

interface Btn {
  readonly root: Container;
  readonly bg: Sprite;
  readonly glyph: Graphics;
  /** Texture-backed glyph (painted icon); invisible until its texture has loaded. */
  readonly icon: Sprite;
  readonly label: Text;
  readonly action: EndAction;
  r: number;
}

const STAR_DELAY = 0.45;
const STAR_STEP = 0.28;

/**
 * Victory / defeat board: the map dims, a painted panel pops in with a title ribbon, 1-3 stars
 * that pop in one by one, a lives / gold (or wave) summary and Retry / Next Isle / World Map buttons.
 */
export class EndPanel {
  readonly root = new Container();
  private readonly dim = new Graphics();
  private readonly board = new Container();
  private readonly panel: Sprite;
  private readonly panelFallback = new Graphics();
  private readonly title = paintedText(48, 'center');
  private readonly stars: { empty: Sprite; full: Sprite }[] = [];
  private readonly heart: Sprite;
  private readonly coin: Sprite;
  private readonly line1 = inkText(22, 'left');
  private readonly line2 = inkText(22, 'left');
  private readonly caption = inkText(20, 'center', '#7a5532', '600');
  private readonly buttons: Btn[] = [];
  private readonly art: LoadedArt;
  private lay: EndLayout | null = null;
  private summary: EndSummary | null = null;
  private note: EndModeNote | null = null;
  private t = 0;
  private w = 1;
  private h = 1;
  insets: Insets = NO_INSETS;

  constructor(art: LoadedArt) {
    this.art = art;
    this.panel = new Sprite(kit(art, 'endPanel', Texture.EMPTY));
    this.heart = new Sprite(art.ui.heart);
    this.coin = new Sprite(art.ui.gold);
    for (const s of [this.heart, this.coin]) s.anchor.set(0.5);
    this.board.addChild(this.panelFallback, this.panel, this.title, this.heart, this.coin, this.line1, this.line2, this.caption);
    for (let i = 0; i < 3; i++) {
      const empty = new Sprite(kit(art, 'starEmpty', Texture.EMPTY));
      const full = new Sprite(kit(art, 'star', Texture.EMPTY));
      empty.anchor.set(0.5);
      full.anchor.set(0.5);
      this.stars.push({ empty, full });
      this.board.addChild(empty, full);
    }
    for (const action of ['retry', 'next', 'menu'] as const) {
      const root = new Container();
      const bg = new Sprite(kit(art, action === 'next' ? 'medallionHi' : 'buttonRound', art.ui.button));
      bg.anchor.set(0.5);
      const glyph = new Graphics();
      const icon = new Sprite(Texture.EMPTY);
      icon.anchor.set(0.5);
      icon.visible = false;
      const label = inkText(18, 'center');
      root.addChild(bg, glyph, icon, label);
      this.board.addChild(root);
      this.buttons.push({ root, bg, glyph, icon, label, action, r: 30 });
    }
    this.root.addChild(this.dim, this.board);
    this.root.visible = false;
    this.loadPaintedIcons();
  }

  /**
   * Loads the painted play / map icons in the background (small 224 px paintings, mipmapped so
   * they stay crisp when drawn at phone sizes). The board is built long before a run can end, so
   * the textures are normally in place when it first shows; until then the Graphics glyph stands in.
   */
  private loadPaintedIcons(): void {
    for (const b of this.buttons) {
      const key = PAINTED_ICON[b.action];
      if (!key) continue;
      void paintedUiTexture(this.art, key).then((tex) => {
        if (!tex) return;
        b.icon.texture = tex;
        this.drawGlyph(b);
      });
    }
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(s: EndSummary): void {
    this.summary = s;
    this.note = null;
    this.t = 0;
    this.root.visible = true;
    this.panel.texture = kit(this.art, s.won ? 'endPanel' : 'endPanelDefeat', kit(this.art, 'endPanel', Texture.EMPTY));
    setText(this.title, s.won ? t('end.victory') : t('end.defeat'));
    this.title.style.fill = s.won ? '#fff4dc' : '#ffd9c8';
    if (s.won) {
      setText(this.line1, `${s.lives}/${s.startLives}`);
      setText(this.line2, String(s.gold));
      setText(this.caption, s.stars === 3 ? t('end.flawless') : s.stars === 2 ? t('end.well') : t('end.holds'));
    } else {
      setText(this.line1, t('end.waveOf', { n: Math.max(1, s.wave), total: s.totalWaves }));
      setText(this.line2, String(s.gold));
      setText(this.caption, t('end.brokeThrough'));
    }
    this.styleCaption(false);
    this.layout(this.w, this.h);
    this.update(0);
  }

  /**
   * Mode results on the open board (after the run was recorded): challenge badges, the Daily
   * Squall, an Endless record. Overrides the title / summary line / caption; null = no change.
   */
  annotate(note: EndModeNote | null): void {
    if (!this.root.visible || !note) return;
    this.note = note;
    if (note.victoryBoard) {
      this.panel.texture = kit(this.art, 'endPanel', Texture.EMPTY);
      this.title.style.fill = '#fff4dc';
    }
    if (note.title) setText(this.title, note.title);
    if (note.line1) setText(this.line1, note.line1);
    setText(this.caption, note.caption);
    this.styleCaption(note.reward ?? false);
    this.layout(this.w, this.h);
  }

  /** The mode note shown (QA). */
  get modeNote(): EndModeNote | null {
    return this.note;
  }

  private styleCaption(reward: boolean): void {
    this.caption.style.fill = reward ? '#9a3b18' : '#7a5532';
    this.caption.style.fontWeight = reward ? '700' : '600';
  }

  hide(): void {
    this.root.visible = false;
    this.summary = null;
  }

  layout(w: number, h: number, insets: Insets = this.insets): void {
    this.w = w;
    this.h = h;
    this.insets = insets;
    const tex = this.panel.texture;
    const hasArt = tex !== Texture.EMPTY;
    const aspect = hasArt ? tex.width / Math.max(1, tex.height) : 1.45;
    const L = endLayout(w, h, insets, aspect, END_FRAME);
    this.lay = L;
    this.dim.clear().rect(0, 0, w, h).fill({ color: 0x1a1006, alpha: 0.55 });
    const P = L.panel;
    // The board scales around its centre for the pop-in.
    this.board.pivot.set(P.x + P.w / 2, P.y + P.h / 2);
    this.board.position.set(P.x + P.w / 2, P.y + P.h / 2);
    this.panel.visible = hasArt;
    this.panel.position.set(P.x, P.y);
    this.panel.width = P.w;
    this.panel.height = P.h;
    this.panelFallback.clear();
    if (!hasArt) this.panelFallback.roundRect(P.x, P.y, P.w, P.h, 18).fill({ color: 0xf6e7c4 }).stroke({ color: 0x8a5a2b, width: 5 });
    setFontSize(this.title, L.fontTitle);
    this.title.position.set(L.title.x, L.title.y);
    fitWidth(this.title, P.w * 0.5);
    const won = this.summary?.won ?? true;
    for (let i = 0; i < 3; i++) {
      const st = this.stars[i];
      for (const sp of [st.empty, st.full]) {
        sp.position.set(L.stars[i].x, L.stars[i].y);
        sp.visible = won;
      }
      const d = L.starR * (i === 1 ? 2.3 : 2);
      st.empty.scale.set(d / Math.max(1, st.empty.texture.width));
    }
    // Summary row: heart + lives (or the wave reached) and coins + gold, centred.
    const f = L.fontBody;
    setInkSize(this.line1, f);
    setInkSize(this.line2, f);
    setInkSize(this.caption, Math.round(f * 0.9));
    const icon = f * 1.5;
    this.heart.scale.set(icon / Math.max(1, this.heart.texture.height));
    this.coin.scale.set(icon / Math.max(1, this.coin.texture.height));
    this.heart.visible = won;
    const gap = f * 0.4;
    const blockA = (won ? icon + gap : 0) + this.line1.width;
    const blockB = icon + gap + this.line2.width;
    const total = blockA + f * 1.6 + blockB;
    let x = L.summary.x - total / 2;
    // An Endless board has no stars: its lines sit lower, between the ribbon and the buttons.
    const y = won ? L.summary.y : this.note?.victoryBoard ? (L.stars[1].y + L.summary.y) / 2 + f * 0.6 : L.stars[1].y + L.starR * 0.4;
    if (won) {
      this.heart.position.set(x + icon / 2, y);
      x += icon + gap;
    }
    this.line1.position.set(x, y);
    x += this.line1.width + f * 1.6;
    this.coin.position.set(x + icon / 2, y);
    x += icon + gap;
    this.line2.position.set(x, y);
    this.caption.position.set(L.summary.x, won ? y + f * 1.3 : y + f * 1.7);
    fitWidth(this.caption, P.w * 0.8);
    // Buttons: Retry / Next Isle / World Map (Next hidden when there is no open next island).
    const hasNext = this.summary?.hasNext ?? false;
    const shown = this.buttons.filter((b) => b.action !== 'next' || hasNext);
    for (const b of this.buttons) b.root.visible = shown.includes(b);
    shown.forEach((b, i) => {
      const k = i - (shown.length - 1) / 2;
      const r = L.buttonR;
      b.r = r;
      b.root.position.set(L.summary.x + k * r * 3.4, L.buttons[0].y);
      b.bg.width = r * 2;
      b.bg.height = r * 2;
      setInkSize(b.label, Math.round(Math.max(13, r * 0.42)));
      setText(b.label, t(END_LABELS[b.action]));
      fitWidth(b.label, r * 3.1);
      b.label.position.set(0, r * 1.38);
      this.drawGlyph(b);
    });
  }

  private drawGlyph(b: Btn): void {
    const g = b.glyph;
    const r = b.r;
    const line = { color: 0x3a2412, width: Math.max(2, r * 0.09) };
    g.clear();
    const tex = b.icon.texture;
    b.icon.visible = tex !== Texture.EMPTY;
    if (b.icon.visible) {
      // Same proportion as the DOM round buttons (glyph at 56 % of the medallion), nudged right
      // for the play triangle so it looks centred.
      const d = r * 1.12;
      b.icon.scale.set(d / Math.max(1, Math.max(tex.width, tex.height)));
      b.icon.position.set(b.action === 'next' ? r * 0.05 : 0, 0);
      return;
    }
    if (b.action === 'retry') {
      g.arc(0, 0, r * 0.34, -Math.PI * 0.15, Math.PI * 1.45).stroke({ color: 0x3a2412, width: r * 0.22, cap: 'round' });
      g.arc(0, 0, r * 0.34, -Math.PI * 0.15, Math.PI * 1.45).stroke({ color: 0xfff4dc, width: r * 0.12, cap: 'round' });
      const ax = Math.cos(-Math.PI * 0.15) * r * 0.34;
      const ay = Math.sin(-Math.PI * 0.15) * r * 0.34;
      g.moveTo(ax - r * 0.2, ay - r * 0.04).lineTo(ax + r * 0.15, ay - r * 0.06).lineTo(ax + r * 0.02, ay + r * 0.26).closePath();
      g.fill({ color: 0xfff4dc }).stroke(line);
    } else if (b.action === 'next') {
      g.moveTo(-r * 0.22, -r * 0.34).lineTo(r * 0.36, 0).lineTo(-r * 0.22, r * 0.34).closePath();
      g.fill({ color: 0xfff4dc }).stroke(line);
    } else {
      // World map: a folded chart (three panels) with a dotted red route.
      const x0 = -r * 0.4;
      const pw = r * 0.27;
      const top = [-r * 0.26, -r * 0.34, -r * 0.26, -r * 0.34];
      const bot = [r * 0.34, r * 0.26, r * 0.34, r * 0.26];
      g.moveTo(x0, top[0]);
      for (let i = 1; i < 4; i++) g.lineTo(x0 + pw * i, top[i]);
      for (let i = 3; i >= 0; i--) g.lineTo(x0 + pw * i, bot[i]);
      g.closePath().fill({ color: 0xfff4dc }).stroke(line);
      for (let i = 1; i < 3; i++) g.moveTo(x0 + pw * i, top[i]).lineTo(x0 + pw * i, bot[i]);
      g.stroke({ color: 0x3a2412, width: Math.max(1.5, r * 0.05) });
      for (let i = 0; i < 4; i++) g.circle(x0 + pw * (0.5 + i * 0.7), r * (0.14 - i * 0.1), Math.max(1.2, r * 0.04));
      g.fill({ color: 0xc8341f });
    }
  }

  update(dt: number): void {
    if (!this.root.visible || !this.lay) return;
    this.t += dt;
    const t = this.t;
    this.dim.alpha = easeOutCubic(t / 0.35);
    const pop = easeOutBack((t - 0.08) / 0.38);
    this.board.scale.set(Math.max(0.001, 0.6 + 0.4 * pop));
    this.board.alpha = Math.min(1, Math.max(0, (t - 0.05) / 0.2));
    const n = this.summary?.stars ?? 0;
    for (let i = 0; i < 3; i++) {
      const st = this.stars[i];
      const base = (this.lay.starR * (i === 1 ? 2.3 : 2)) / Math.max(1, st.full.texture.width);
      const p = (t - STAR_DELAY - i * STAR_STEP) / 0.32;
      st.full.visible = i < n && p > 0 && st.empty.visible;
      if (st.full.visible) {
        const k = easeOutBack(p);
        st.full.scale.set(base * Math.max(0.001, 0.3 + 0.7 * k) * (1 + 0.6 * Math.max(0, 1 - p * 2.5)));
        st.full.rotation = (1 - Math.min(1, p)) * -0.6;
      }
    }
  }

  /** Button under a screen point, or null (taps anywhere else are swallowed while the panel is up). */
  hit(x: number, y: number): EndAction | null {
    if (!this.root.visible || this.t < 0.4) return null;
    for (const b of this.buttons) {
      if (!b.root.visible) continue;
      const dx = x - b.root.x;
      const dy = y - b.root.y;
      if (dx * dx + dy * dy <= (b.r * 1.15) ** 2 || (Math.abs(dx) < b.r && dy > 0 && dy < b.r * 1.7)) return b.action;
    }
    return null;
  }

  /** QA hooks: panel rect, button centres, stars shown. */
  debug(): {
    panel: Rect | null;
    buttons: { action: EndAction; x: number; y: number; r: number }[];
    stars: number;
    note: { title: string; line1: string; caption: string } | null;
    /** Buttons drawn with their painted icon (texture loaded), the rest use the Graphics glyph. */
    painted: EndAction[];
  } | null {
    if (!this.root.visible || !this.lay) return null;
    return {
      panel: this.lay.panel,
      buttons: this.buttons.filter((b) => b.root.visible).map((b) => ({ action: b.action, x: b.root.x, y: b.root.y, r: b.r })),
      stars: this.summary?.stars ?? 0,
      note: this.note ? { title: this.title.text, line1: this.line1.text, caption: this.caption.text } : null,
      painted: this.buttons.filter((b) => b.root.visible && b.icon.visible).map((b) => b.action),
    };
  }
}
