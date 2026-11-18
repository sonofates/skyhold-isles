import { ColorMatrixFilter, Container, Graphics, NineSliceSprite, Sprite, Texture, type Text } from 'pixi.js';
import type { TargetingMode, TowerType } from '../core/types.ts';
import { TOWER_DEFS } from '../data/towers.ts';
import type { LoadedArt } from './assets2d.ts';
import { MIN_TOUCH } from './hud.ts';
import { paintedText, setFontSize, setText } from './hudText.ts';
import { easeOutBack, easeOutCubic, fitWidth, INK, INK_SOFT, inkText, kit, PRICE_RED, setInkSize } from './uiKit.ts';
import {
  evenAngles,
  layoutRadial,
  NO_INSETS,
  placeTooltip,
  roleLine,
  statRows,
  uiScale,
  type Insets,
  type Pt,
  type Rect,
  type StatRow,
} from './uiLayout.ts';

export type RingAction =
  | { readonly kind: 'build'; readonly type: TowerType }
  | { readonly kind: 'upgrade' }
  | { readonly kind: 'sell' }
  /** Barracks: next tap on the road moves its rally point. */
  | { readonly kind: 'rally' }
  /** Attack towers: cycle the targeting mode. */
  | { readonly kind: 'target' };

export interface TowerPanelInfo {
  readonly type: TowerType;
  readonly tier: number;
  /** Cost of the next tier, or null at max tier. */
  readonly upgradeCost: number | null;
  readonly refund: number;
  /** Barracks: show a "Rally" token with this icon (between upgrade and sell). */
  readonly rallyIcon?: Texture;
  /** Attack towers: current targeting mode (adds a targeting token). */
  readonly targeting?: TargetingMode;
}

/** What the ring is pointing at right now (selected, else hovered): drives the range preview. */
export interface RingPreview {
  readonly type: TowerType;
  readonly tier: 1 | 2 | 3;
}

const SHORT_NAMES: Readonly<Record<string, string>> = {
  archer: 'Archer',
  cannon: 'Cannon',
  frost: 'Frost',
  tesla: 'Tesla',
  mortar: 'Mortar',
  ballista: 'Ballista',
  beacon: 'Beacon',
  barracks: 'Barracks',
};

export function shortTowerName(type: string): string {
  return SHORT_NAMES[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

const TARGET_LABEL: Readonly<Record<TargetingMode, string>> = { first: 'First', last: 'Last', strongest: 'Strongest', closest: 'Closest' };

const MAX_TOKENS = 10;
const OPEN_S = 0.26;
const CLOSE_S = 0.13;
const STAGGER_S = 0.022;
/** Price tag height as a fraction of the medallion radius. */
const TAG_H = 0.62;
/** Transparent margin around the kit medallion art (room for the selected glow), per side. */
const MEDAL_PAD = 0.0694;

interface Token {
  readonly root: Container;
  readonly frame: Sprite;
  readonly face: Sprite;
  readonly badge: Sprite;
  readonly tag: Container;
  readonly tagBg: Sprite;
  readonly tagCoin: Sprite;
  readonly tagText: Text;
  readonly label: Text;
  action: RingAction | null;
  enabled: boolean;
  /** Build cost / upgrade cost checked against live gold (null = always enabled). */
  cost: number | null;
  preview: RingPreview | null;
  tip: TipContent | null;
  /** Needs a confirming second tap (build / upgrade / sell). */
  confirm: boolean;
  tx: number;
  ty: number;
  hoverK: number;
}

interface TipContent {
  title: string;
  role: string;
  rows: StatRow[] | null;
  next: StatRow[] | null;
  hint: string;
  hintBad: string;
}

/** Tower ring radius: clears a tower drawn above its plot (towers are ~2.7 medallion radii tall). */
function r3(tokenR: number): number {
  return tokenR * 3.05;
}

let shadowTex: Texture | null = null;
function ringShadow(): Texture {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  grad.addColorStop(0, 'rgba(30,18,6,0.34)');
  grad.addColorStop(0.62, 'rgba(30,18,6,0.24)');
  grad.addColorStop(1, 'rgba(30,18,6,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  shadowTex = Texture.from(c);
  return shadowTex;
}

/**
 * Painted tooltip next to the ring: tower name, role line, three 0..5 pip rows (with the next
 * tier's gains in green for upgrades) and a hint line. Parchment 9-slice panel, ink lettering.
 */
class RingTooltip {
  readonly root = new Container();
  private readonly bg: NineSliceSprite | Graphics;
  private readonly title = inkText(20);
  private readonly role = inkText(14, 'left', INK_SOFT, '600');
  private readonly labels: Text[] = [];
  private readonly pips = new Graphics();
  private readonly hint = inkText(14, 'left', INK, '600');
  private content: TipContent | null = null;
  w = 220;
  h = 140;

  constructor(art: LoadedArt) {
    const tex = art.uiKit?.tooltip;
    if (tex) {
      const b = Math.round(tex.width * 0.11);
      this.bg = new NineSliceSprite({ texture: tex, leftWidth: b, rightWidth: b, topHeight: b, bottomHeight: b });
    } else {
      this.bg = new Graphics();
    }
    this.root.addChild(this.bg, this.title, this.role, this.pips, this.hint);
    for (let i = 0; i < 3; i++) {
      const l = inkText(14, 'left', INK_SOFT, '600');
      this.labels.push(l);
      this.root.addChild(l);
    }
    this.root.visible = false;
  }

  /** Lays the content out for scale `u`; sets w / h. */
  set(c: TipContent, u: number): void {
    this.content = c;
    const k = Math.max(0.62, Math.min(1.35, u));
    const W = Math.round(236 * k);
    const pad = Math.round(W * 0.085);
    const fTitle = Math.round(Math.max(15, 21 * k));
    const fBody = Math.round(Math.max(12, 14.5 * k));
    setInkSize(this.title, fTitle);
    setText(this.title, c.title);
    setInkSize(this.role, fBody);
    setText(this.role, c.role);
    let y = pad + fTitle * 0.62;
    this.title.position.set(pad, y);
    fitWidth(this.title, W - pad * 2);
    y += fTitle * 0.62 + fBody * 0.75;
    this.role.position.set(pad, y);
    fitWidth(this.role, W - pad * 2);
    y += fBody * 0.6;
    const g = this.pips;
    g.clear();
    const rows = c.rows;
    const rowH = fBody * 1.42;
    const labelW = W * 0.38;
    const pr = Math.max(4, fBody * 0.36);
    for (let i = 0; i < 3; i++) {
      const l = this.labels[i];
      l.visible = !!rows;
      if (!rows) continue;
      y += i === 0 ? rowH * 0.85 : rowH;
      setInkSize(l, fBody);
      setText(l, rows[i].label);
      l.position.set(pad, y);
      fitWidth(l, labelW - 4);
      const have = rows[i].pips;
      const next = c.next ? c.next[i].pips : have;
      for (let p = 0; p < 5; p++) {
        const x = pad + labelW + pr + p * pr * 2.75;
        const filled = p < have;
        const gain = !filled && p < next;
        g.circle(x, y, pr).fill({ color: filled ? 0xe9b53c : gain ? 0x7fc24c : 0xd8c39a }).stroke({
          color: filled || gain ? 0x5a3412 : 0xa88c62,
          width: Math.max(1.2, pr * 0.34),
        });
        if (filled || gain) g.circle(x - pr * 0.3, y - pr * 0.32, pr * 0.32).fill({ color: 0xffffff, alpha: 0.55 });
      }
    }
    const hintText = c.hintBad || c.hint;
    this.hint.visible = hintText !== '';
    if (hintText) {
      setInkSize(this.hint, fBody);
      this.hint.style.fill = c.hintBad ? PRICE_RED : INK;
      setText(this.hint, hintText);
      y += rows ? rowH * 1.08 : fBody * 1.3;
      this.hint.position.set(pad, y);
      fitWidth(this.hint, W - pad * 2);
    }
    const H = Math.round(y + fBody * 0.55 + pad);
    this.w = W;
    this.h = H;
    if (this.bg instanceof NineSliceSprite) {
      // Shrink the slices on small panels so corners never overlap.
      const b = Math.min(Math.round(W * 0.11), Math.round(H * 0.24));
      const tb = Math.round(this.bg.texture.width * 0.11);
      const s = b / tb;
      this.bg.scale.set(s);
      this.bg.width = W / s;
      this.bg.height = H / s;
    } else {
      this.bg.clear().roundRect(0, 0, W, H, 10).fill({ color: 0xf6e7c4 }).stroke({ color: 0x8a5a2b, width: 3 });
    }
  }

  get current(): TipContent | null {
    return this.content;
  }
}

/**
 * Radial ring that blooms around a tapped plot. Free plot: one painted medallion per buildable
 * tower (portrait + price tag; unaffordable = desaturated, red price). First tap selects (tooltip
 * + range preview + a confirm check), second tap builds. Built tower: upgrade (next-tier portrait,
 * cost / MAX), targeting or rally, sell (refund) in the same visual language. The ring is shifted
 * as a whole to stay inside the screen and safe area; touch targets are >= MIN_TOUCH.
 */
export class BuildRing {
  readonly root = new Container();
  private readonly shadow: Sprite;
  private readonly tokenLayer = new Container();
  private readonly tokens: Token[] = [];
  private readonly points: Pt[] = [];
  private readonly tooltip: RingTooltip;
  private readonly art: LoadedArt;
  private readonly gray = new ColorMatrixFilter();
  private box: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private tokenR = 32;
  private count = 0;
  private originX = 0;
  private originY = 0;
  private openT = 0;
  private closing = false;
  private selected = -1;
  private hovered = -1;
  private gold = 0;
  private screenW = 1;
  private screenH = 1;
  private u = 1;
  private shadowBase = 1;
  insets: Insets = NO_INSETS;
  /** What the ring is open on: plot index, or -1. */
  plot = -1;
  mode: 'build' | 'tower' | null = null;

  constructor(art: LoadedArt) {
    this.art = art;
    this.gray.desaturate();
    this.gray.brightness(0.82, true);
    this.shadow = new Sprite(Texture.EMPTY);
    this.shadow.anchor.set(0.5);
    this.tooltip = new RingTooltip(art);
    this.root.addChild(this.shadow, this.tokenLayer, this.tooltip.root);
    const medal = kit(art, 'medallion', art.ui.button);
    const tagTex = kit(art, 'priceTag', Texture.EMPTY);
    for (let i = 0; i < MAX_TOKENS; i++) {
      const root = new Container();
      const frame = new Sprite(medal);
      frame.anchor.set(0.5);
      const face = new Sprite(Texture.EMPTY);
      face.anchor.set(0.5, 0.5);
      const badge = new Sprite(kit(art, 'iconConfirm', Texture.EMPTY));
      badge.anchor.set(0.5);
      badge.visible = false;
      const tag = new Container();
      const tagBg = new Sprite(tagTex);
      tagBg.anchor.set(0.5);
      const tagCoin = new Sprite(art.ui.gold);
      tagCoin.anchor.set(0.5);
      const tagText = inkText(16, 'center');
      tag.addChild(tagBg, tagCoin, tagText);
      const label = paintedText(16, 'center');
      root.addChild(frame, face, badge, tag, label);
      root.visible = false;
      this.tokenLayer.addChild(root);
      this.tokens.push({
        root,
        frame,
        face,
        badge,
        tag,
        tagBg,
        tagCoin,
        tagText,
        label,
        action: null,
        enabled: false,
        cost: null,
        preview: null,
        tip: null,
        confirm: false,
        tx: 0,
        ty: 0,
        hoverK: 0,
      });
    }
    this.root.visible = false;
  }

  get isOpen(): boolean {
    return this.mode !== null;
  }

  close(): void {
    if (this.mode === null) return;
    this.mode = null;
    this.plot = -1;
    this.selected = -1;
    this.hovered = -1;
    this.closing = true;
    this.openT = Math.min(1, this.openT);
    this.tooltip.root.visible = false;
  }

  /** Range preview target: selected token, else hovered token (desktop). */
  get preview(): RingPreview | null {
    if (!this.isOpen) return null;
    const i = this.selected >= 0 ? this.selected : this.hovered;
    return i >= 0 && i < this.count ? this.tokens[i].preview : null;
  }

  private sizeFor(w: number, h: number): void {
    this.screenW = w;
    this.screenH = h;
    this.u = uiScale(w, h);
    this.tokenR = Math.max(MIN_TOUCH / 2 + 1, 36 * this.u);
  }

  private resetToken(i: number): Token {
    const t = this.tokens[i];
    const r = this.tokenR;
    t.root.visible = true;
    t.frame.texture = kit(this.art, 'medallion', this.art.ui.button);
    const fd = this.art.uiKit?.medallion ? (r * 2) / (1 - 2 * MEDAL_PAD) : r * 2;
    t.frame.width = fd;
    t.frame.height = fd;
    t.badge.visible = false;
    const bs = (r * 0.78) / Math.max(1, t.badge.texture.width);
    t.badge.scale.set(bs);
    t.badge.position.set(r * 0.72, -r * 0.62);
    t.face.filters = null;
    t.face.tint = 0xffffff;
    t.frame.tint = 0xffffff;
    t.tag.visible = false;
    t.label.visible = false;
    t.hoverK = 0;
    t.cost = null;
    t.preview = null;
    t.tip = null;
    return t;
  }

  /** Face = tower portrait (fits the medallion face) or a painted icon. */
  private setFace(t: Token, tex: Texture, portrait: boolean, tint = 0xffffff): void {
    const r = this.tokenR;
    if (t.face.texture !== tex) t.face.texture = tex;
    const box = portrait ? r * 1.46 : r * 1.12;
    const s = box / Math.max(1, tex.width, tex.height * (portrait ? 0.92 : 1));
    t.face.scale.set(s);
    t.face.position.set(0, portrait ? r * 0.02 : 0);
    t.face.tint = tint;
  }

  private setTag(t: Token, value: string | null, coin: boolean): void {
    const r = this.tokenR;
    const hasTagArt = t.tagBg.texture !== Texture.EMPTY;
    if (value === null) {
      t.tag.visible = false;
      return;
    }
    if (!coin || !hasTagArt) {
      // Words (Rally, First…) or no tag art: painted label under the medallion.
      t.tag.visible = false;
      t.label.visible = true;
      setFontSize(t.label, Math.round(Math.max(13, r * 0.44)));
      setText(t.label, value);
      t.label.position.set(0, r * 1.12);
      return;
    }
    t.tag.visible = true;
    const tw = r * 1.86;
    const th = r * TAG_H;
    t.tagBg.width = tw;
    t.tagBg.height = (tw * t.tagBg.texture.height) / Math.max(1, t.tagBg.texture.width);
    const realH = t.tagBg.height;
    t.tag.position.set(0, r * 0.98);
    const cs = (realH * 0.62) / Math.max(1, t.tagCoin.texture.height);
    t.tagCoin.scale.set(cs);
    t.tagCoin.position.set(-tw * 0.335, 0);
    setInkSize(t.tagText, Math.round(Math.max(12, th * 0.62)));
    setText(t.tagText, value);
    t.tagText.position.set(tw * 0.1, realH * 0.02);
    fitWidth(t.tagText, tw * 0.56);
  }

  /** Applies enabled / disabled looks (desaturate + red price). */
  private applyEnabled(t: Token): void {
    t.face.filters = t.enabled ? null : [this.gray];
    t.frame.tint = t.enabled ? 0xffffff : 0xa9a39a;
    t.tagText.style.fill = t.enabled ? INK : PRICE_RED;
    t.tagBg.tint = t.enabled ? 0xffffff : 0xd9d2c4;
  }

  private layout(cx: number, cy: number, angles: readonly number[], minRadius = 0): void {
    const r = this.tokenR;
    const lay = layoutRadial(cx, cy, angles, r, r * TAG_H, this.screenW, this.screenH, this.insets, this.points, 6, minRadius);
    this.box = lay.box;
    this.originX = cx;
    this.originY = cy;
    for (let i = 0; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      if (i < this.count) {
        t.tx = this.points[i].x;
        t.ty = this.points[i].y;
      } else t.root.visible = false;
    }
    this.shadow.texture = ringShadow();
    this.shadow.position.set(lay.cx, lay.cy);
    const d = (lay.radius + r * 1.45) * 2;
    this.shadowBase = d / Math.max(1, this.shadow.texture.width);
    this.openT = 0;
    this.closing = false;
    this.selected = -1;
    this.hovered = -1;
    this.tooltip.root.visible = false;
    this.root.visible = true;
    this.applyAnim();
  }

  openBuild(plot: number, cx: number, cy: number, gold: number, costs: ReadonlyMap<TowerType, number>, w: number, h: number, topBand = 0): void {
    this.sizeFor(w, h);
    void topBand; // the ring is drawn over the HUD and hit-tested first; only the safe area bounds it
    this.mode = 'build';
    this.plot = plot;
    this.gold = gold;
    const ring = this.art.manifest.buildRing;
    this.count = Math.min(MAX_TOKENS, ring.length);
    for (let i = 0; i < this.count; i++) {
      const type = ring[i];
      const cost = costs.get(type) ?? 0;
      const art = this.art.towers[type];
      const t = this.resetToken(i);
      this.setFace(t, art?.tiers[0] ?? Texture.WHITE, true, art?.tint ?? 0xffffff);
      this.setTag(t, String(cost), true);
      t.action = { kind: 'build', type };
      t.cost = cost;
      t.enabled = gold >= cost;
      t.confirm = true;
      t.preview = { type, tier: 1 };
      t.tip = { title: TOWER_DEFS[type]?.name ?? shortTowerName(type), role: roleLine(type), rows: statRows(type, 1), next: null, hint: 'Tap again to build', hintBad: '' };
      this.applyEnabled(t);
    }
    this.layout(cx, cy, evenAngles(this.count));
  }

  openTower(plot: number, cx: number, cy: number, info: TowerPanelInfo, gold: number, w: number, h: number, topBand = 0): void {
    this.sizeFor(w, h);
    void topBand;
    this.mode = 'tower';
    this.plot = plot;
    this.gold = gold;
    const art = this.art.towers[info.type];
    const tint = art?.tint ?? 0xffffff;
    const tier = Math.max(1, Math.min(3, info.tier)) as 1 | 2 | 3;
    const nextTier = Math.min(3, tier + 1) as 1 | 2 | 3;
    const name = TOWER_DEFS[info.type]?.name ?? shortTowerName(info.type);
    const roman = ['I', 'II', 'III'];
    let i = 0;
    // Upgrade: next-tier portrait with an upgrade arrow badge.
    {
      const t = this.resetToken(i++);
      this.setFace(t, art?.tiers[nextTier - 1] ?? Texture.WHITE, true, tint);
      const maxed = info.upgradeCost === null;
      t.badge.texture = kit(this.art, 'iconUpgrade', Texture.EMPTY);
      t.badge.visible = !maxed && t.badge.texture !== Texture.EMPTY;
      this.setTag(t, maxed ? 'MAX' : String(info.upgradeCost), !maxed);
      t.action = { kind: 'upgrade' };
      t.cost = maxed ? null : info.upgradeCost;
      t.enabled = !maxed && gold >= (info.upgradeCost ?? Infinity);
      t.confirm = true;
      t.preview = { type: info.type, tier: nextTier };
      t.tip = maxed
        ? { title: `${name} ${roman[tier - 1]}`, role: 'Fully upgraded', rows: statRows(info.type, tier), next: null, hint: '', hintBad: '' }
        : {
            title: `Upgrade to ${roman[nextTier - 1]}`,
            role: nextTier === 3 ? `${TOWER_DEFS[info.type].signature.name}: ${TOWER_DEFS[info.type].signature.desc}` : name,
            rows: statRows(info.type, tier),
            next: statRows(info.type, nextTier),
            hint: 'Tap again to upgrade',
            hintBad: '',
          };
      this.applyEnabled(t);
      if (maxed) {
        t.face.filters = null;
        t.frame.tint = 0xffffff;
      }
    }
    if (info.rallyIcon) {
      const t = this.resetToken(i++);
      this.setFace(t, kit(this.art, 'iconRally', info.rallyIcon), false);
      this.setTag(t, 'Rally', false);
      t.action = { kind: 'rally' };
      t.enabled = true;
      t.confirm = false;
      t.preview = { type: info.type, tier };
      this.applyEnabled(t);
    } else if (info.targeting) {
      const t = this.resetToken(i++);
      this.setFace(t, kit(this.art, 'iconTarget', Texture.EMPTY), false);
      this.setTag(t, TARGET_LABEL[info.targeting], false);
      t.action = { kind: 'target' };
      t.enabled = true;
      t.confirm = false;
      t.preview = { type: info.type, tier };
      this.applyEnabled(t);
    }
    {
      const t = this.resetToken(i++);
      this.setFace(t, kit(this.art, 'iconSell', this.art.ui.gold), false);
      this.setTag(t, `+${info.refund}`, true);
      t.action = { kind: 'sell' };
      t.enabled = true;
      t.confirm = true;
      t.preview = { type: info.type, tier };
      t.tip = { title: `Sell ${name}`, role: `Refund: ${info.refund} gold`, rows: null, next: null, hint: 'Tap again to sell', hintBad: '' };
      this.applyEnabled(t);
    }
    this.count = i;
    const angles = i === 3 ? [-Math.PI / 2, (Math.PI * 5) / 6, Math.PI / 6] : [-Math.PI / 2, Math.PI / 2];
    // Wider than the build ring: the built tower stands in the middle and must stay visible.
    this.layout(cx, cy, angles, r3(this.tokenR));
  }

  /** Refreshes the targeting token's label after the mode changed. */
  setTargetMode(mode: TargetingMode): void {
    for (let i = 0; i < this.count; i++) {
      const t = this.tokens[i];
      if (t.action?.kind === 'target') this.setTag(t, TARGET_LABEL[mode], false);
    }
  }

  private tokenAt(x: number, y: number): number {
    if (!this.isOpen) return -1;
    const r = this.tokenR * 1.08;
    for (let i = 0; i < this.count; i++) {
      const t = this.tokens[i];
      const dx = x - t.tx;
      const dy = y - t.ty;
      if (dx * dx + dy * dy <= r * r) return i;
      // The price tag under the disc counts too.
      if (Math.abs(dx) <= this.tokenR * 0.95 && dy > 0 && dy <= this.tokenR * (1 + TAG_H)) return i;
    }
    return -1;
  }

  /** Desktop hover (mouse): highlight + tooltip / range preview while nothing is selected. */
  hover(x: number, y: number): boolean {
    const i = this.tokenAt(x, y);
    if (i !== this.hovered) {
      this.hovered = i;
      if (this.selected < 0) this.showTip(i);
    }
    return i >= 0;
  }

  private select(i: number): void {
    this.selected = i;
    for (let k = 0; k < this.count; k++) {
      const t = this.tokens[k];
      const on = k === i;
      t.frame.texture = kit(this.art, on ? 'medallionHi' : 'medallion', this.art.ui.button);
      if (t.action?.kind === 'build') t.badge.texture = kit(this.art, 'iconConfirm', Texture.EMPTY);
      if (t.action?.kind === 'build' || t.action?.kind === 'sell') t.badge.visible = on && t.enabled;
    }
    this.showTip(i);
  }

  private showTip(i: number): void {
    const t = i >= 0 ? this.tokens[i] : null;
    if (!t || !t.tip) {
      this.tooltip.root.visible = false;
      return;
    }
    const c = t.tip;
    const poor = t.cost !== null && !t.enabled;
    c.hintBad = poor ? `Need ${t.cost} gold` : '';
    const maxed = t.action?.kind === 'upgrade' && t.cost === null;
    if (maxed) c.hint = '';
    else if (i !== this.selected) c.hint = 'Tap to choose';
    else c.hint = t.action?.kind === 'build' ? 'Tap again to build' : t.action?.kind === 'upgrade' ? 'Tap again to upgrade' : t.action?.kind === 'sell' ? 'Tap again to sell' : '';
    this.tooltip.set(c, this.u);
    const p = placeTooltip(this.box, this.tooltip.w, this.tooltip.h, this.screenW, this.screenH, this.insets);
    this.tooltip.root.position.set(p.x, p.y);
    this.tooltip.root.visible = true;
    this.tooltip.root.alpha = 0;
  }

  /** Token under a screen point: its action (null = consumed / not ready), or undefined if no token was hit. */
  hit(x: number, y: number): RingAction | null | undefined {
    if (!this.isOpen) return undefined;
    const i = this.tokenAt(x, y);
    if (i < 0) {
      const tp = this.tooltip.root;
      if (tp.visible && x >= tp.x && x <= tp.x + this.tooltip.w && y >= tp.y && y <= tp.y + this.tooltip.h) return null;
      return undefined;
    }
    const t = this.tokens[i];
    if (!t.confirm) return t.enabled ? t.action : null;
    if (this.selected !== i) {
      this.select(i);
      return null;
    }
    return t.enabled ? t.action : null;
  }

  /** Per-frame: bloom / close animation, hover easing, live affordability. */
  update(dt: number, gold: number): void {
    if (!this.root.visible) return;
    if (this.isOpen && gold !== this.gold) {
      this.gold = gold;
      for (let i = 0; i < this.count; i++) {
        const t = this.tokens[i];
        if (t.cost === null) continue;
        const en = gold >= t.cost;
        if (en !== t.enabled) {
          t.enabled = en;
          this.applyEnabled(t);
          if (i === this.selected) this.select(i);
        }
      }
    }
    if (this.closing) {
      this.openT -= dt / CLOSE_S;
      if (this.openT <= 0) {
        this.openT = 0;
        this.closing = false;
        this.root.visible = false;
        return;
      }
    } else this.openT = Math.min(1 + this.count * STAGGER_S * (1 / OPEN_S), this.openT + dt / OPEN_S);
    for (let i = 0; i < this.count; i++) {
      const t = this.tokens[i];
      const target = this.isOpen && (i === this.hovered || i === this.selected) ? 1 : 0;
      t.hoverK += (target - t.hoverK) * Math.min(1, dt * 14);
    }
    const tip = this.tooltip.root;
    if (tip.visible) tip.alpha = Math.min(1, tip.alpha + dt * 8);
    this.applyAnim();
  }

  private applyAnim(): void {
    const stag = STAGGER_S / OPEN_S;
    for (let i = 0; i < this.count; i++) {
      const t = this.tokens[i];
      const p = this.closing ? Math.max(0, Math.min(1, this.openT)) : Math.max(0, Math.min(1, this.openT - i * stag));
      const move = easeOutCubic(p);
      const s = (this.closing ? move : easeOutBack(p)) * (1 + 0.08 * t.hoverK);
      t.root.position.set(this.originX + (t.tx - this.originX) * move, this.originY + (t.ty - this.originY) * move);
      t.root.scale.set(Math.max(0.001, s));
      t.root.alpha = Math.min(1, p * 2.2);
    }
    const a = easeOutCubic(Math.max(0, Math.min(1, this.openT)));
    this.shadow.alpha = a;
    this.shadow.scale.set(this.shadowBase * (0.55 + 0.45 * a));
  }

  /** Screen positions of the open tokens (QA hooks): final (settled) positions. */
  tokenPositions(): { x: number; y: number; enabled: boolean }[] {
    const out: { x: number; y: number; enabled: boolean }[] = [];
    for (let i = 0; i < this.count && this.isOpen; i++) {
      const t = this.tokens[i];
      out.push({ x: t.tx, y: t.ty, enabled: t.enabled });
    }
    return out;
  }

  /** Token radius, ring box, tooltip rect and selection (QA hooks). */
  get layoutInfo(): { tokenR: number; grid: boolean; box: Rect; tooltip: Rect | null; selected: number; animT: number } {
    const tp = this.tooltip.root;
    return {
      tokenR: this.tokenR,
      grid: false,
      box: this.box,
      tooltip: tp.visible ? { x: tp.x, y: tp.y, w: this.tooltip.w, h: this.tooltip.h } : null,
      selected: this.selected,
      animT: this.openT,
    };
  }
}
