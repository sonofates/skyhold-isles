import { Container, Graphics, Sprite, Texture, type Text } from 'pixi.js';
import type { LoadedArt } from './assets2d.ts';
import { paintedText, setFontSize, setText } from './hudText.ts';
import { easeOutBack, easeOutCubic, fitWidth, inkText, kit, setInkSize } from './uiKit.ts';
import { END_FRAME, endLayout, NO_INSETS, type EndLayout, type Insets, type Rect } from './uiLayout.ts';

export { endStars } from './uiLayout.ts';

export type EndAction = 'retry' | 'next' | 'menu';

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

interface Btn {
  readonly root: Container;
  readonly bg: Sprite;
  readonly glyph: Graphics;
  readonly label: Text;
  readonly action: EndAction;
  r: number;
}

const STAR_DELAY = 0.45;
const STAR_STEP = 0.28;

/**
 * Victory / defeat board: the map dims, a painted panel pops in with a title ribbon, 1-3 stars
 * that pop in one by one, a lives / gold (or wave) summary and Retry / Next / Menu buttons.
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
      const label = inkText(18, 'center');
      root.addChild(bg, glyph, label);
      this.board.addChild(root);
      this.buttons.push({ root, bg, glyph, label, action, r: 30 });
    }
    this.root.addChild(this.dim, this.board);
    this.root.visible = false;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(s: EndSummary): void {
    this.summary = s;
    this.t = 0;
    this.root.visible = true;
    this.panel.texture = kit(this.art, s.won ? 'endPanel' : 'endPanelDefeat', kit(this.art, 'endPanel', Texture.EMPTY));
    setText(this.title, s.won ? 'Victory!' : 'Defeat');
    this.title.style.fill = s.won ? '#fff4dc' : '#ffd9c8';
    if (s.won) {
      setText(this.line1, `${s.lives}/${s.startLives}`);
      setText(this.line2, String(s.gold));
      setText(this.caption, s.stars === 3 ? 'Flawless defence!' : s.stars === 2 ? 'Well defended!' : 'The isle holds!');
    } else {
      setText(this.line1, `Wave ${Math.max(1, s.wave)}/${s.totalWaves}`);
      setText(this.line2, String(s.gold));
      setText(this.caption, 'The raiders broke through');
    }
    this.layout(this.w, this.h);
    this.update(0);
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
    // Summary row: heart + lives (or the wave reached) and pouch + gold, centred.
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
    const y = won ? L.summary.y : L.stars[1].y + L.starR * 0.4;
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
    // Buttons: Retry / Next / Menu (Next hidden when there is no next island).
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
      setText(b.label, b.action === 'retry' ? 'Retry' : b.action === 'next' ? 'Next' : 'Menu');
      b.label.position.set(0, r * 1.38);
      this.drawGlyph(b);
    });
  }

  private drawGlyph(b: Btn): void {
    const g = b.glyph;
    const r = b.r;
    const line = { color: 0x3a2412, width: Math.max(2, r * 0.09) };
    g.clear();
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
      for (let i = -1; i <= 1; i++) g.roundRect(-r * 0.32, i * r * 0.22 - r * 0.06, r * 0.64, r * 0.12, r * 0.05);
      g.fill({ color: 0xfff4dc }).stroke(line);
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
  debug(): { panel: Rect | null; buttons: { action: EndAction; x: number; y: number; r: number }[]; stars: number } | null {
    if (!this.root.visible || !this.lay) return null;
    return {
      panel: this.lay.panel,
      buttons: this.buttons.filter((b) => b.root.visible).map((b) => ({ action: b.action, x: b.root.x, y: b.root.y, r: b.r })),
      stars: this.summary?.stars ?? 0,
    };
  }
}
