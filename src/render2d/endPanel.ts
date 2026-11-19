import { Assets, Container, Graphics, Sprite, Texture, type Text } from 'pixi.js';
import { t, type MsgKey } from '../i18n/index.ts';
import type { LoadedArt } from './assets2d.ts';
import { paintedText, setFontSize, setText } from './hudText.ts';
import { easeOutBack, easeOutCubic, fitWidth, INK_SOFT, inkText, kit, paintedUiTexture, setInkSize } from './uiKit.ts';
import { END_FRAME, endLayout, NO_INSETS, type EndLayout, type Insets, type Rect } from './uiLayout.ts';
import type { EndModeNote } from './ui/modeBits.ts';
import type { DifficultyId } from '../data/difficulty.ts';
import { DIFFICULTY_EMBLEMS } from './ui/difficultyEmblems.ts';
import type { QaTextItem } from './qaText.ts';

export { endStars } from './uiLayout.ts';

/** `menu` = back to the world map; `replay` = watch the run just played. */
export type EndAction = 'retry' | 'replay' | 'next' | 'menu';

const END_LABELS: Readonly<Record<EndAction, MsgKey>> = { retry: 'end.retry', replay: 'end.replay', next: 'end.next', menu: 'end.menu' };

/** Everything the board shows, to put it back after a replay. */
export interface EndSnapshot {
  readonly summary: EndSummary;
  readonly hero: EndHeroXp | null;
  readonly note: EndModeNote | null;
}

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
  /** Show the Watch replay button (the run was recorded). */
  readonly hasReplay?: boolean;
  /** Victory: lives lost and the island's 3- / 2-star limits (the "why" under the stars). */
  readonly starRule?: { readonly lost: number; readonly three: number; readonly two: number };
  /** The run's difficulty: a small seal + name tag under the ribbon (absent = no tag). */
  readonly difficulty?: DifficultyId;
}

const DIFF_KEYS: Readonly<Record<DifficultyId, MsgKey>> = { easy: 'diff.easy', normal: 'diff.normal', hard: 'diff.hard' };
/** Wax colours of the difficulty seals (same as difficulty2d.css). */
const DIFF_WAX: Readonly<Record<DifficultyId, readonly [string, string, string]>> = {
  easy: ['#4f9a46', '#a8dd8a', '#2f6a2c'],
  normal: ['#3d78b8', '#9cc8ef', '#234f80'],
  hard: ['#c3311f', '#f08a6c', '#7e1a0e'],
};
const diffSealCache = new Map<DifficultyId, Promise<Texture | null>>();

/** A difficulty wax seal (emblem SVG on a round wax disc) drawn once into a canvas texture. */
function diffSealTexture(id: DifficultyId): Promise<Texture | null> {
  let p = diffSealCache.get(id);
  if (p) return p;
  p = new Promise<Texture | null>((resolve) => {
    if (typeof document === 'undefined') return resolve(null);
    const px = 96;
    const img = new Image();
    img.onload = (): void => {
      const c = document.createElement('canvas');
      c.width = c.height = px;
      const g = c.getContext('2d');
      if (!g) return resolve(null);
      const [wax, hi, lo] = DIFF_WAX[id];
      const r = px / 2 - 4;
      const grad = g.createRadialGradient(px * 0.4, px * 0.36, 2, px / 2, px / 2, r);
      grad.addColorStop(0, hi);
      grad.addColorStop(0.45, wax);
      grad.addColorStop(1, lo);
      g.beginPath();
      g.arc(px / 2, px / 2, r, 0, Math.PI * 2);
      g.fillStyle = grad;
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = '#3a2412';
      g.stroke();
      const e = px * 0.76;
      g.drawImage(img, (px - e) / 2, (px - e) / 2, e, e);
      resolve(Texture.from(c));
    };
    img.onerror = (): void => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(DIFFICULTY_EMBLEMS[id].replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" '))}`;
  });
  diffSealCache.set(id, p);
  return p;
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

/** The run's hero on the board: XP gained this run and any level-ups (filled after the stars). */
export interface EndHeroXp {
  readonly heroId: string;
  readonly name: string;
  readonly xpGained: number;
  /** XP-bar fill before / after the run (0..1 of the level), and the levels. */
  readonly fromFrac: number;
  readonly toFrac: number;
  readonly fromLevel: number;
  readonly toLevel: number;
  readonly skillPoints: number;
  /** False when the run is not recorded (QA / debug scenes): no bar, just the run's XP. */
  readonly recorded: boolean;
}

/**
 * Makes room for the hero XP row: smaller stars lifted a little, the summary closer under them and
 * the buttons a touch lower (fractions of the parchment's inner height `innerFrac` × panel h).
 */
function heroRoom(L: EndLayout, innerFrac: number): EndLayout {
  const inner = L.panel.h * innerFrac;
  const starR = L.starR * 0.8;
  const lift = inner * 0.05;
  return {
    ...L,
    starR,
    stars: L.stars.map((p, i) => ({ x: L.panel.x + L.panel.w / 2 + (i - 1) * starR * 2.4, y: p.y - lift - (L.starR - starR) * 0.6 })),
    summary: { x: L.summary.x, y: L.summary.y - inner * 0.1 },
    buttons: L.buttons.map((p) => ({ x: p.x, y: p.y + inner * 0.035 })),
    buttonR: L.buttonR * 0.94,
  };
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
  /** Victory: lives lost against the island's star limits (small, under the caption). */
  private readonly rule = inkText(15, 'center', '#8a6a48', '600');
  /** Difficulty tag under the ribbon: parchment pill, wax seal, name. */
  private readonly diffTag = new Container();
  private readonly diffPill = new Graphics();
  private readonly diffSeal = new Sprite(Texture.EMPTY);
  private readonly diffText = inkText(18, 'left', '#4a2a12', '700');
  private readonly buttons: Btn[] = [];
  private readonly art: LoadedArt;
  private lay: EndLayout | null = null;
  private summary: EndSummary | null = null;
  private note: EndModeNote | null = null;
  private hero: EndHeroXp | null = null;
  private readonly heroRow = new Container();
  private readonly heroPort = new Sprite(Texture.EMPTY);
  private readonly heroRing = new Graphics();
  private readonly heroBar = new Graphics();
  private readonly heroText = inkText(18, 'left');
  private readonly heroLvl = inkText(18, 'left', '#9a3b18', '700');
  private heroBarW = 100;
  private heroBarH = 8;
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
    this.board.addChild(this.panelFallback, this.panel, this.title, this.heart, this.coin, this.line1, this.line2, this.caption, this.rule);
    this.diffSeal.anchor.set(0.5);
    this.diffText.anchor.set(0, 0.5);
    this.diffTag.addChild(this.diffPill, this.diffSeal, this.diffText);
    this.diffTag.visible = false;
    this.board.addChild(this.diffTag);
    for (let i = 0; i < 3; i++) {
      const empty = new Sprite(kit(art, 'starEmpty', Texture.EMPTY));
      const full = new Sprite(kit(art, 'star', Texture.EMPTY));
      empty.anchor.set(0.5);
      full.anchor.set(0.5);
      this.stars.push({ empty, full });
      this.board.addChild(empty, full);
    }
    for (const action of ['retry', 'replay', 'next', 'menu'] as const) {
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
    this.heroPort.anchor.set(0.5);
    this.heroText.anchor.set(0, 0.5);
    this.heroLvl.anchor.set(0, 0.5);
    this.heroRow.addChild(this.heroRing, this.heroPort, this.heroBar, this.heroText, this.heroLvl);
    this.heroRow.visible = false;
    this.board.addChild(this.heroRow);
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

  /** Hero XP row (null hides it). Call after `show`. */
  setHero(h: EndHeroXp | null): void {
    this.hero = h;
    this.heroRow.visible = !!h && this.root.visible;
    if (!h) return;
    const file = this.art.manifest.heroes?.[h.heroId]?.portrait;
    if (file) {
      void Assets.load<Texture>({ src: this.art.baseUrl + file, data: { autoGenerateMipmaps: true } })
        .then((tex) => {
          if (tex && this.hero === h) {
            this.heroPort.texture = tex;
            this.layout(this.w, this.h);
          }
        })
        .catch(() => undefined);
    }
    setText(this.heroText, t('end.heroXp', { name: h.name, n: h.xpGained }));
    const up = h.toLevel > h.fromLevel;
    // Rust accent for a level-up; a plain "Level n" in soft ink (red read like a warning).
    this.heroLvl.style.fill = up ? '#9a3b18' : INK_SOFT;
    setText(this.heroLvl, up ? t('end.heroLevelUp', { n: h.toLevel }) + (h.skillPoints > 0 ? t('common.sep') + t('end.heroPoints', { n: h.skillPoints }) : '') : h.recorded ? t('end.heroLevel', { n: h.toLevel }) : '');
    this.layout(this.w, this.h);
  }

  /** QA: the hero row. */
  get heroInfo(): EndHeroXp | null {
    return this.heroRow.visible ? this.hero : null;
  }

  show(s: EndSummary): void {
    this.summary = s;
    this.note = null;
    this.hero = null;
    this.heroRow.visible = false;
    this.t = 0;
    this.root.visible = true;
    this.panel.texture = kit(this.art, s.won ? 'endPanel' : 'endPanelDefeat', kit(this.art, 'endPanel', Texture.EMPTY));
    setText(this.title, s.won ? t('end.victory') : t('end.defeat'));
    this.title.style.fill = s.won ? '#fff4dc' : '#ffd9c8';
    if (s.won) {
      setText(this.line1, `${s.lives}/${s.startLives}`);
      setText(this.line2, String(s.gold));
      setText(this.caption, s.stars === 3 ? t('end.flawless') : s.stars === 2 ? t('end.well') : t('end.holds'));
      const r = s.starRule;
      setText(this.rule, r ? t('end.starRule', { n: r.lost, a: r.three, b: r.two }) : '');
    } else {
      setText(this.rule, '');
      setText(this.line1, t('end.waveOf', { n: Math.max(1, s.wave), total: s.totalWaves }));
      setText(this.line2, String(s.gold));
      setText(this.caption, t('end.brokeThrough'));
    }
    this.styleCaption(false);
    const d = s.difficulty;
    this.diffTag.visible = !!d;
    if (d) {
      setText(this.diffText, t(DIFF_KEYS[d]));
      this.diffText.style.fill = d === 'hard' ? '#8f2a14' : d === 'easy' ? '#2f6a2c' : '#4a2a12';
      this.diffSeal.texture = Texture.EMPTY;
      void diffSealTexture(d).then((tex) => {
        if (tex && this.summary?.difficulty === d) {
          this.diffSeal.texture = tex;
          this.layout(this.w, this.h);
        }
      });
    }
    this.layout(this.w, this.h);
    this.update(0);
  }

  /** QA: the difficulty tag's text and screen box (null when not shown). */
  get difficultyTag(): { text: string; x: number; y: number; w: number; h: number } | null {
    if (!this.root.visible || !this.diffTag.visible) return null;
    const b = this.diffTag.getBounds();
    return { text: this.diffText.text, x: b.x, y: b.y, w: b.width, h: b.height };
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

  /** The board as shown (null when hidden). */
  snapshot(): EndSnapshot | null {
    if (!this.root.visible || !this.summary) return null;
    return { summary: this.summary, hero: this.hero, note: this.note };
  }

  /** Shows a saved board again (the stars pop in again). */
  restore(snap: EndSnapshot): void {
    this.show(snap.summary);
    if (snap.hero) this.setHero(snap.hero);
    if (snap.note) this.annotate(snap.note);
  }

  layout(w: number, h: number, insets: Insets = this.insets): void {
    this.w = w;
    this.h = h;
    this.insets = insets;
    const tex = this.panel.texture;
    const hasArt = tex !== Texture.EMPTY;
    const aspect = hasArt ? tex.width / Math.max(1, tex.height) : 1.45;
    const L = this.hero ? heroRoom(endLayout(w, h, insets, aspect, END_FRAME), END_FRAME.innerBottom - END_FRAME.innerTop) : endLayout(w, h, insets, aspect, END_FRAME);
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
    this.rule.visible = won && this.rule.text !== '' && !this.note;
    setInkSize(this.rule, Math.round(f * 0.68));
    this.rule.position.set(L.summary.x, this.caption.y + f * 0.95);
    fitWidth(this.rule, P.w * 0.74);
    // Small boards (phones) with the hero row: no room for the extra line.
    if (this.rule.visible && this.hero) {
      const room = L.buttons[0].y - L.buttonR - (this.rule.y + this.rule.height / 2);
      if (room < f * 2.6) this.rule.visible = false;
    }
    this.layoutHero(L, f);
    this.layoutDiffTag(L);
    // Buttons: Retry / Next Isle / World Map (Next hidden when there is no open next island).
    const hasNext = this.summary?.hasNext ?? false;
    const hasReplay = this.summary?.hasReplay ?? false;
    const shown = this.buttons.filter((b) => (b.action !== 'next' || hasNext) && (b.action !== 'replay' || hasReplay));
    for (const b of this.buttons) b.root.visible = shown.includes(b);
    // Four buttons: a little smaller and closer so they stay on the parchment.
    const four = shown.length >= 4;
    const step = four ? 3.05 : 3.4;
    shown.forEach((b, i) => {
      const k = i - (shown.length - 1) / 2;
      const r = four ? L.buttonR * 0.9 : L.buttonR;
      b.r = r;
      b.root.position.set(L.summary.x + k * r * step, L.buttons[0].y);
      b.bg.width = r * 2;
      b.bg.height = r * 2;
      setInkSize(b.label, Math.round(Math.max(13, r * 0.42)));
      setText(b.label, t(END_LABELS[b.action]));
      fitWidth(b.label, r * (step - 0.12));
      b.label.position.set(0, r * 1.38);
      this.drawGlyph(b);
    });
    // One size for the row: a long label ("Sonraki Ada") no longer reads smaller than its neighbours.
    const minScale = Math.min(1, ...shown.map((b) => b.label.scale.x));
    for (const b of shown) b.label.scale.set(minScale);
  }

  /** Difficulty tag: a small parchment pill on the board's top edge, just under the ribbon. */
  private layoutDiffTag(L: EndLayout): void {
    if (!this.diffTag.visible) return;
    const P = L.panel;
    const fs = Math.max(12, Math.round(L.fontBody * 0.8));
    setInkSize(this.diffText, fs);
    const d = fs * 1.55;
    const padX = fs * 0.55;
    const hasSeal = this.diffSeal.texture !== Texture.EMPTY;
    const w = (hasSeal ? d * 0.82 + fs * 0.3 : 0) + this.diffText.width + padX * 2;
    const h = fs * 1.6;
    const cx = P.x + P.w / 2;
    // Between the ribbon and the parchment's inner top (END_FRAME.ribbonMid .. innerTop).
    const cy = P.y + P.h * (END_FRAME.ribbonMid + (END_FRAME.innerTop - END_FRAME.ribbonMid) * 0.64);
    const x0 = cx - w / 2;
    this.diffPill
      .clear()
      .roundRect(x0, cy - h / 2, w, h, h / 2)
      .fill({ color: 0xf6e7c4 })
      .stroke({ color: 0x3a2412, width: Math.max(1.5, fs * 0.12) })
      .roundRect(x0 + fs * 0.14, cy - h / 2 + fs * 0.14, w - fs * 0.28, h - fs * 0.28, (h - fs * 0.28) / 2)
      .stroke({ color: 0xf2b33d, width: Math.max(1, fs * 0.1) });
    this.diffSeal.visible = hasSeal;
    let x = x0 + padX;
    if (hasSeal) {
      this.diffSeal.scale.set(d / Math.max(1, this.diffSeal.texture.width));
      this.diffSeal.position.set(x + d * 0.3, cy);
      x += d * 0.82 + fs * 0.3 - d * 0.1;
    }
    this.diffText.position.set(x, cy);
  }

  /** Hero row between the caption and the buttons: portrait, "Bran +86 XP", level-up line, XP bar. */
  private layoutHero(L: EndLayout, f: number): void {
    const h = this.hero;
    this.heroRow.visible = !!h && this.root.visible;
    if (!h) return;
    const P = L.panel;
    const capBottom = this.rule.visible ? this.rule.y + this.rule.height / 2 : this.caption.y + this.caption.height / 2;
    const btnTop = L.buttons[0].y - L.buttonR;
    const yMid = (capBottom + btnTop) / 2 - f * 0.05;
    const fs = Math.round(f * 0.8);
    setInkSize(this.heroText, fs);
    setInkSize(this.heroLvl, fs);
    const d = fs * 2.3;
    this.heroBarH = Math.max(5, fs * 0.42);
    this.heroBarW = Math.max(this.heroText.width, P.w * 0.3);
    const lvlW = this.heroLvl.text ? this.heroLvl.width + fs * 0.6 : 0;
    const total = d + fs * 0.5 + Math.max(this.heroBarW, this.heroText.width + lvlW);
    const x0 = P.x + P.w / 2 - total / 2;
    const tex = this.heroPort.texture;
    this.heroPort.visible = tex !== Texture.EMPTY;
    this.heroPort.scale.set(d / Math.max(1, tex.width));
    this.heroPort.position.set(x0 + d / 2, yMid);
    this.heroRing.clear();
    if (!this.heroPort.visible) this.heroRing.circle(x0 + d / 2, yMid, d / 2).fill({ color: 0xc89a52 }).stroke({ color: 0x3a2412, width: 2 });
    const tx = x0 + d + fs * 0.5;
    const showBar = h.recorded;
    const textY = showBar ? yMid - this.heroBarH * 0.9 : yMid;
    this.heroText.position.set(tx, textY);
    this.heroLvl.position.set(tx + this.heroText.width + fs * 0.6, textY);
    this.heroBar.position.set(tx, yMid + fs * 0.45);
    this.heroBar.visible = showBar;
    this.drawHeroBar(1);
  }

  /** XP bar at animation progress k (0..1): from the old fill to the new one (wrapping on level-ups). */
  private drawHeroBar(k: number): void {
    const h = this.hero;
    const g = this.heroBar;
    g.clear();
    if (!h || !h.recorded) return;
    const w = this.heroBarW;
    const bh = this.heroBarH;
    const ups = Math.max(0, h.toLevel - h.fromLevel);
    const span = ups + h.toFrac - h.fromFrac;
    const pos = h.fromFrac + span * Math.max(0, Math.min(1, k));
    const frac = k >= 1 ? h.toFrac : pos - Math.floor(pos);
    g.roundRect(-2, -2, w + 4, bh + 4, (bh + 4) / 2).fill({ color: 0x3a2412, alpha: 0.85 });
    g.roundRect(0, 0, Math.max(0, w * Math.min(1, frac)), bh, bh / 2).fill({ color: 0x6fc0f0 });
    g.roundRect(0, 0, Math.max(0, w * Math.min(1, frac)), bh * 0.4, bh / 4).fill({ color: 0xffffff, alpha: 0.3 });
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
    } else if (b.action === 'replay') {
      // Watch: a little picture frame on a stand with a play triangle in it.
      g.roundRect(-r * 0.42, -r * 0.32, r * 0.84, r * 0.58, r * 0.09).fill({ color: 0xfff4dc }).stroke(line);
      g.moveTo(-r * 0.14, r * 0.26).lineTo(-r * 0.22, r * 0.42).moveTo(r * 0.14, r * 0.26).lineTo(r * 0.22, r * 0.42);
      g.stroke({ color: 0x3a2412, width: Math.max(2, r * 0.08), cap: 'round' });
      g.moveTo(-r * 0.1, -r * 0.17).lineTo(r * 0.17, -r * 0.03).lineTo(-r * 0.1, r * 0.11).closePath();
      g.fill({ color: 0xc8341f }).stroke({ color: 0x3a2412, width: Math.max(1.5, r * 0.05) });
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
    if (this.heroRow.visible) {
      const k = (t - STAR_DELAY - 3 * STAR_STEP) / 1.1;
      this.drawHeroBar(easeOutCubic(Math.max(0, Math.min(1, k))));
      this.heroLvl.alpha = Math.max(0, Math.min(1, (k - 0.7) / 0.3));
    }
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

  /** QA (qaText.ts): the title on the ribbon's front band, every other line on the parchment. */
  qaTexts(): QaTextItem[] {
    if (!this.root.visible || !this.lay || this.t < 0.6) return [];
    const P = this.lay.panel;
    const ribbon: Rect = { x: P.x + P.w * 0.2, y: P.y, w: P.w * 0.6, h: P.h * END_FRAME.innerTop };
    const parchment: Rect = { x: P.x + P.w * 0.09, y: P.y + P.h * (END_FRAME.innerTop - 0.03), w: P.w * 0.82, h: P.h * (END_FRAME.innerBottom - END_FRAME.innerTop + 0.05) };
    const body = [this.line1, this.line2, this.caption, this.rule, this.heroText, this.heroLvl, ...this.buttons.map((b) => b.label)];
    return [{ name: 'end.title', text: this.title, box: ribbon }, ...body.map((text, i) => ({ name: `end.text${i}`, text, box: parchment }))];
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
