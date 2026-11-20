import { ColorMatrixFilter, Container, Graphics, NineSliceSprite, Sprite, Texture, type Text } from 'pixi.js';
import type { TargetingMode, TowerType } from '../core/types.ts';
import type { TowerSpecializationDef, TowerTierStats } from '../data/towers.ts';
import { abilityDesc, abilityName, signatureDesc, signatureName, specDesc, specName, specRole, towerName, towerShortName } from '../i18n/data.ts';
import { loadSpecPortrait, specPortrait } from './specArt.ts';
import { branchById, branchStats } from './ui/specInfo.ts';
import { t as msg, type MsgKey } from '../i18n/index.ts';
import type { LoadedArt } from './assets2d.ts';
import { MIN_TOUCH } from './hud.ts';
import type { QaTextItem } from './qaText.ts';
import { paintedText, setFontSize, setText } from './hudText.ts';
import { easeOutBack, easeOutCubic, fitWidth, hudKeepOuts, INK, INK_SOFT, inkText, kit, paintedUiTexture, PRICE_RED, setInkSize } from './uiKit.ts';
import {
  evenAngles,
  hudButtonsKeepOut,
  layoutRadial,
  NO_INSETS,
  placeTooltip,
  ringRadius,
  roleLine,
  statRows,
  statRowsFor,
  towerRingAngles,
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
  | { readonly kind: 'target' }
  /** Tier III: open the comparison card of the two specializations (this one focused). */
  | { readonly kind: 'compare'; readonly id: string }
  /** Specialized tower: buy this ability. */
  | { readonly kind: 'ability'; readonly id: string };

export interface TowerPanelInfo {
  readonly type: TowerType;
  readonly tier: number;
  /** Tier III, not yet specialized: the family's two branches replace the upgrade token. */
  readonly branches?: readonly TowerSpecializationDef[];
  /** Specialized: the chosen branch and its bought abilities (ring shows the abilities to buy). */
  readonly specialization?: { readonly id: string; readonly abilities: readonly string[] };
  /** Effective stats (`towerStats`): the specialized tower's info card. */
  readonly stats?: TowerTierStats;
  /** Cost of the next tier, or null at max tier. */
  readonly upgradeCost: number | null;
  readonly refund: number;
  /** Barracks: show a "Rally" token with this icon (between upgrade and sell). */
  readonly rallyIcon?: Texture;
  /** Attack towers: current targeting mode (adds a targeting token). */
  readonly targeting?: TargetingMode;
  /** Screen box of the built tower: the ring arranges itself to stay off it. */
  readonly keepOut?: Rect;
  /** This tower's battle record (shown in the targeting / rally / sell tooltips). */
  readonly record?: { readonly kills: number; readonly damage: number };
}

const TARGET_NEXT: Readonly<Record<TargetingMode, TargetingMode>> = { first: 'last', last: 'strongest', strongest: 'closest', closest: 'first' };

/** What the ring is pointing at right now (selected, else hovered): drives the range preview. */
export interface RingPreview {
  readonly type: TowerType;
  readonly tier: 1 | 2 | 3;
  /** Base range to preview instead of the tier's (a specialization's own reach). */
  readonly range?: number;
}

/** Targeting token tooltip: the current mode, the tower's record, what a tap / click switches to. */
function targetTip(mode: TargetingMode, record: string, desktop: boolean): TipContent {
  return { title: msg('ring.targetTitle', { mode: msg(TARGET_LABEL[mode]) }), role: record, rows: null, next: null, hint: msg(desktop ? 'ring.targetHintClick' : 'ring.targetHint', { mode: msg(TARGET_LABEL[TARGET_NEXT[mode]]) }), hintBad: '', fixedHint: true };
}

/** "Tap …" on touch, "Click …" with a mouse. */
const ACTION_HINT: Readonly<Record<'build' | 'upgrade' | 'sell' | 'choose' | 'compare' | 'ability', readonly [MsgKey, MsgKey]>> = {
  build: ['ring.tapBuild', 'ring.clickBuild'],
  upgrade: ['ring.tapUpgrade', 'ring.clickUpgrade'],
  sell: ['ring.tapSell', 'ring.clickSell'],
  choose: ['ring.tapChoose', 'ring.clickChoose'],
  compare: ['ring.tapCompare', 'ring.clickCompare'],
  ability: ['ring.tapBuy', 'ring.clickBuy'],
};

/** Short tower name (localised; see src/i18n/data.ts). */
export function shortTowerName(type: string): string {
  return towerShortName(type);
}

const TARGET_LABEL: Readonly<Record<TargetingMode, MsgKey>> = {
  first: 'ring.target.first',
  last: 'ring.target.last',
  strongest: 'ring.target.strongest',
  closest: 'ring.target.closest',
};

const MAX_TOKENS = 10;
/** Ability level pips per token (each ability has one level today). */
const MAX_PIPS = 3;
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
  /** Ability level pips over the medallion (owned = filled). */
  readonly pips: Sprite[];
  action: RingAction | null;
  enabled: boolean;
  /** Acts on the confirming tap even when unaffordable (the comparison card shows the price). */
  actsWhenPoor: boolean;
  banned: boolean;
  /** Build cost / upgrade cost checked against live gold (null = always enabled / banned). */
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
  cost?: number | null;
  title: string;
  role: string;
  /** Wrapped paragraph under the role line (a branch's or ability's effect, owned abilities). */
  desc?: string;
  rows: StatRow[] | null;
  next: StatRow[] | null;
  hint: string;
  hintBad: string;
  /** Acts on the first tap (targeting / rally): keep this hint, never "tap to choose". */
  fixedHint?: boolean;
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
  private readonly cost = inkText(14);
  private readonly coin: Sprite;
  private readonly role = inkText(14, 'left', INK_SOFT, '600');
  private readonly desc = inkText(14, 'left', INK, '600');
  private readonly labels: Text[] = [];
  private readonly pips = new Graphics();
  /** Painted rank pips (3 rows x 5); used once `pip-empty` / `pip-filled` have loaded. */
  private readonly pipSprites: Sprite[] = [];
  private pipTex: { empty: Texture; filled: Texture } | null = null;
  private readonly hint = inkText(14, 'left', INK, '600');
  private content: TipContent | null = null;
  private lastU = 1;
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
    this.coin = new Sprite(art.ui.gold);
    this.coin.anchor.set(0, 0.5);
    this.desc.anchor.set(0, 0);
    this.desc.style.wordWrap = true;
    this.desc.style.breakWords = true;
    this.root.addChild(this.bg, this.title, this.role, this.desc, this.pips, this.hint, this.coin, this.cost);
    for (let i = 0; i < 15; i++) {
      const p = new Sprite(Texture.EMPTY);
      p.anchor.set(0.5);
      p.visible = false;
      this.pipSprites.push(p);
      this.root.addChild(p);
    }
    for (let i = 0; i < 3; i++) {
      const l = inkText(14, 'left', INK_SOFT, '600');
      this.labels.push(l);
      this.root.addChild(l);
    }
    this.root.visible = false;
    void Promise.all([paintedUiTexture(art, 'pip-empty'), paintedUiTexture(art, 'pip-filled')]).then(([empty, filled]) => {
      if (!empty || !filled) return;
      this.pipTex = { empty, filled };
      if (this.content) this.set(this.content, this.lastU);
    });
  }

  /** Lays the content out for scale `u`; sets w / h. */
  set(c: TipContent, u: number): void {
    this.content = c;
    this.lastU = u;
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
    const titleY = y;
    y += fTitle * 0.62 + fBody * 0.75;
    this.role.position.set(pad, y);
    this.cost.visible = this.coin.visible = c.cost != null;
    let costWidth = 0;
    // With a paragraph (specializations, abilities) the price rides on the title line, so the
    // role line keeps its full width (it would shrink beside the price on a phone).
    let costOnTitle = false;
    if (c.cost != null && c.desc) {
      setInkSize(this.cost, fBody);
      setText(this.cost, String(c.cost));
      this.title.scale.set(1);
      const need = this.cost.width + (this.coin.texture.width * fBody) / this.coin.texture.height + 8;
      costOnTitle = this.title.width + need <= W - pad * 2;
    }
    if (c.cost != null) {
      const cy = costOnTitle ? titleY : y;
      setInkSize(this.cost, fBody);
      setText(this.cost, String(c.cost));
      this.coin.scale.set(fBody / this.coin.texture.height);
      this.cost.position.set(W - pad - this.cost.width, cy);
      this.coin.position.set(this.cost.x - this.coin.width - 3, cy);
      costWidth = W - pad - this.coin.x + 5;
    }
    fitWidth(this.title, W - pad * 2 - (costOnTitle ? costWidth : 0));
    fitWidth(this.role, W - pad * 2 - (costOnTitle ? 0 : costWidth));
    // No role line (a fresh tower's targeting / rally tip): the hint moves up into its place.
    const noRole = !c.role && c.cost == null && !c.rows;
    this.role.visible = !noRole;
    y += noRole ? -fBody * 1.3 : fBody * 0.6;
    this.desc.visible = !!c.desc;
    if (c.desc) {
      const fDesc = Math.round(Math.max(12, 13.5 * k));
      setInkSize(this.desc, fDesc);
      this.desc.style.wordWrapWidth = W - pad * 2;
      this.desc.style.lineHeight = Math.round(fDesc * 1.22);
      setText(this.desc, c.desc);
      this.desc.position.set(pad, y + fBody * 0.15);
      y += fBody * 0.15 + this.desc.height;
      // The rows / hint below step down from the text's last line (their anchors are mid-line).
      y -= fBody * 0.35;
    }
    const g = this.pips;
    g.clear();
    const painted = this.pipTex;
    for (const s of this.pipSprites) s.visible = false;
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
        if (painted) {
          // Painted diamonds: gold when held, green-tinted gold for the next tier's gain.
          const s = this.pipSprites[i * 5 + p];
          s.texture = filled || gain ? painted.filled : painted.empty;
          s.tint = gain ? 0x8fe070 : 0xffffff;
          s.position.set(x, y);
          s.scale.set((pr * 2.9) / Math.max(1, s.texture.width));
          s.visible = true;
          continue;
        }
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

  /** QA (qaText.ts): every line inside the parchment, clear of the gold frame. */
  qaTexts(): QaTextItem[] {
    if (!this.root.visible) return [];
    const b = this.bg.getBounds();
    const f = Math.min(this.w * 0.05, this.h * 0.1);
    const box = { x: b.x + f, y: b.y + f * 0.6, w: b.width - f * 2, h: b.height - f * 1.2 };
    return [this.title, this.role, this.cost, this.hint, ...this.labels, this.desc].map((text, i) => ({ name: `ring.tip${i}`, text, box }));
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
  private avoid: Rect[] = [];
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
  private pipTex: { empty: Texture; filled: Texture } | null = null;
  /** Shown while no token is hovered / selected (a specialized tower's card: branch, stats, abilities). */
  private infoTip: TipContent | null = null;
  /** Bumped on every open: a portrait arriving for an older ring is dropped. */
  private openSeq = 0;
  insets: Insets = NO_INSETS;
  /** What the ring is open on: plot index, or -1. */
  plot = -1;
  mode: 'build' | 'tower' | null = null;

  /** Mouse + hover client: hints say "Click" instead of "Tap" (game2d sets it). */
  desktop = false;

  private hint(what: keyof typeof ACTION_HINT): string {
    return msg(ACTION_HINT[what][this.desktop ? 1 : 0]);
  }

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
      const pips: Sprite[] = [];
      for (let p = 0; p < MAX_PIPS; p++) {
        const s = new Sprite(Texture.EMPTY);
        s.anchor.set(0.5);
        s.visible = false;
        pips.push(s);
      }
      root.addChild(frame, face, badge, tag, label, ...pips);
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
        pips,
        action: null,
        enabled: false,
        actsWhenPoor: false,
        banned: false,
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
    void Promise.all([paintedUiTexture(art, 'pip-empty'), paintedUiTexture(art, 'pip-filled')]).then(([empty, filled]) => {
      if (empty && filled) this.pipTex = { empty, filled };
    });
  }

  /** QA (qaText.ts): the tooltip's lines. */
  qaTexts(): QaTextItem[] {
    return this.root.visible ? this.tooltip.qaTexts() : [];
  }

  get isOpen(): boolean {
    return this.mode !== null;
  }

  close(): void {
    if (this.mode === null) return;
    this.mode = null;
    this.plot = -1;
    this.infoTip = null;
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
    t.banned = false;
    t.actsWhenPoor = false;
    t.cost = null;
    t.preview = null;
    t.tip = null;
    for (const p of t.pips) p.visible = false;
    return t;
  }

  /** `n` level pips in an arc over the medallion, the first `owned` filled (painted diamonds once loaded). */
  private setPips(t: Token, n: number, owned: number): void {
    const r = this.tokenR;
    const tex = this.pipTex;
    const size = Math.max(9, r * 0.36);
    const gap = size * 1.05;
    for (let p = 0; p < t.pips.length; p++) {
      const s = t.pips[p];
      s.visible = p < n;
      if (!s.visible) continue;
      s.texture = tex ? (p < owned ? tex.filled : tex.empty) : Texture.WHITE;
      if (!tex) s.tint = p < owned ? 0xe9b53c : 0xd8c39a;
      else s.tint = 0xffffff;
      s.scale.set(size / Math.max(1, s.texture.width));
      s.position.set((p - (n - 1) / 2) * gap, -r * 1.02);
    }
  }

  /** Swaps a token's face to the branch portrait once it has loaded (the ring may have moved on). */
  private portraitFace(t: Token, id: string): void {
    const tex = specPortrait(id);
    if (tex) {
      this.setFace(t, tex, true);
      return;
    }
    const seq = this.openSeq;
    void loadSpecPortrait(this.art, id).then((loaded) => {
      if (!loaded || seq !== this.openSeq || !this.isOpen) return;
      const a = t.action;
      if ((a?.kind === 'compare' || a?.kind === 'ability') && t.root.visible) {
        this.setFace(t, loaded, true);
        if (!t.enabled) t.face.filters = [this.gray];
      }
    });
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

  /**
   * Screen areas the ring and its tooltip keep clear of: the top-right HUD row (speed, pause, the
   * Guide button and its caption). The ring is hit-tested before the canvas HUD, but the Guide
   * button is DOM on top of the canvas, so a medallion under it could be neither seen nor tapped.
   */
  private avoidRects(): Rect[] {
    return [hudButtonsKeepOut(this.screenW, this.screenH, this.insets), ...hudKeepOuts()];
  }

  private layout(cx: number, cy: number, angles: readonly number[], minRadius = 0): void {
    const r = this.tokenR;
    this.avoid = this.avoidRects();
    const lay = layoutRadial(cx, cy, angles, r, r * TAG_H, this.screenW, this.screenH, this.insets, this.points, 6, minRadius, this.avoid);
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

  openBuild(
    plot: number,
    cx: number,
    cy: number,
    gold: number,
    costs: ReadonlyMap<TowerType, number>,
    w: number,
    h: number,
    topBand = 0,
    bannedTowers: readonly TowerType[] = [],
  ): void {
    this.sizeFor(w, h);
    void topBand; // the ring is drawn over the HUD and hit-tested first; only the safe area bounds it
    this.mode = 'build';
    this.plot = plot;
    this.gold = gold;
    this.openSeq++;
    this.infoTip = null;
    const ring = this.art.manifest.buildRing;
    this.count = Math.min(MAX_TOKENS, ring.length);
    for (let i = 0; i < this.count; i++) {
      const type = ring[i];
      const cost = costs.get(type) ?? 0;
      const banned = bannedTowers.includes(type);
      const art = this.art.towers[type];
      const t = this.resetToken(i);
      this.setFace(t, art?.tiers[0] ?? Texture.WHITE, true, art?.tint ?? 0xffffff);
      this.setTag(t, String(cost), true);
      t.action = { kind: 'build', type };
      t.banned = banned;
      t.cost = banned ? null : cost;
      t.enabled = !banned && gold >= cost;
      t.confirm = true;
      t.preview = { type, tier: 1 };
      t.tip = { title: towerName(type), role: roleLine(type), rows: statRows(type, 1), next: null, hint: this.hint('build'), hintBad: '' };
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
    const name = towerName(info.type);
    const roman = ['I', 'II', 'III'];
    // The battle record once the tower has done something (a fresh tower's "0 · 0" is noise).
    const record = info.record && (info.record.kills > 0 || info.record.damage >= 1) ? msg('ring.record', { n: info.record.kills, d: Math.round(info.record.damage) }) : '';
    let i = 0;
    this.openSeq++;
    this.infoTip = null;
    const spec = info.specialization ? branchById(info.type, info.specialization.id) : null;
    if (spec && info.specialization) {
      // Specialized: one token per ability (branch portrait, upgrade badge, level pips, price / owned).
      const owned = info.specialization.abilities;
      const stats = info.stats ?? branchStats(info.type, spec);
      const range = stats.range;
      const ownedNames = owned.map((id) => abilityName(id));
      this.infoTip = {
        title: specName(spec.id),
        role: msg('ring.specOf', { name: towerShortName(info.type) }),
        desc: ownedNames.length ? msg('ring.abilities', { list: ownedNames.join(msg('common.sep')) }) : msg('ring.noAbilities'),
        rows: statRowsFor(info.type, stats),
        next: null,
        hint: '',
        hintBad: '',
        fixedHint: true,
      };
      for (const a of spec.abilities) {
        const t = this.resetToken(i++);
        const have = owned.includes(a.id);
        this.portraitFace(t, spec.id);
        t.badge.texture = kit(this.art, 'iconUpgrade', Texture.EMPTY);
        t.badge.visible = !have && t.badge.texture !== Texture.EMPTY;
        this.setTag(t, have ? msg('ring.owned') : String(a.cost), !have);
        this.setPips(t, 1, have ? 1 : 0);
        t.action = { kind: 'ability', id: a.id };
        t.cost = have ? null : a.cost;
        t.enabled = !have && gold >= a.cost;
        t.confirm = true;
        t.preview = { type: info.type, tier, range };
        t.tip = {
          title: abilityName(a.id),
          role: have ? msg('ring.owned') : msg('ring.abilityOf', { name: specName(spec.id) }),
          desc: abilityDesc(a.id),
          rows: null,
          next: null,
          hint: this.hint('ability'),
          hintBad: '',
        };
        this.applyEnabled(t);
        if (have) {
          t.face.filters = null;
          t.frame.tint = 0xffffff;
        }
      }
    } else if (tier === 3 && info.branches && info.branches.length > 0) {
      // Tier III: the two specializations (portrait, price) instead of "upgrade". The second tap
      // opens the comparison card, also when gold is short (it shows what is missing).
      for (const b of info.branches) {
        const t = this.resetToken(i++);
        this.setFace(t, art?.tiers[2] ?? Texture.WHITE, true, tint);
        this.portraitFace(t, b.id);
        t.badge.texture = kit(this.art, 'iconUpgrade', Texture.EMPTY);
        t.badge.visible = t.badge.texture !== Texture.EMPTY;
        this.setTag(t, String(b.cost), true);
        t.action = { kind: 'compare', id: b.id };
        t.cost = b.cost;
        t.enabled = gold >= b.cost;
        t.actsWhenPoor = true;
        t.confirm = true;
        const bs = branchStats(info.type, b);
        t.preview = { type: info.type, tier: 3, range: bs.range };
        t.tip = {
          title: specName(b.id),
          role: specRole(b.id),
          desc: specDesc(b.id),
          rows: statRows(info.type, 3),
          next: statRowsFor(info.type, bs),
          hint: this.hint('compare'),
          hintBad: '',
        };
        this.applyEnabled(t);
      }
    } else {
      // Upgrade: next-tier portrait with an upgrade arrow badge.
      const t = this.resetToken(i++);
      this.setFace(t, art?.tiers[nextTier - 1] ?? Texture.WHITE, true, tint);
      const maxed = info.upgradeCost === null;
      t.badge.texture = kit(this.art, 'iconUpgrade', Texture.EMPTY);
      t.badge.visible = !maxed && t.badge.texture !== Texture.EMPTY;
      this.setTag(t, maxed ? msg('ring.max') : String(info.upgradeCost), !maxed);
      t.action = { kind: 'upgrade' };
      t.cost = maxed ? null : info.upgradeCost;
      t.enabled = !maxed && gold >= (info.upgradeCost ?? Infinity);
      t.confirm = true;
      t.preview = { type: info.type, tier: nextTier };
      t.tip = maxed
        ? { title: msg('ring.tierName', { name, tier: roman[tier - 1] }), role: msg('ring.fullyUpgraded'), rows: statRows(info.type, tier), next: null, hint: '', hintBad: '' }
        : {
            title: msg('ring.upgradeTo', { tier: roman[nextTier - 1] }),
            role: nextTier === 3 ? msg('ring.signature', { name: signatureName(info.type), desc: signatureDesc(info.type) }) : name,
            rows: statRows(info.type, tier),
            next: statRows(info.type, nextTier),
            hint: this.hint('upgrade'),
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
      this.setTag(t, msg('ring.rally'), false);
      t.action = { kind: 'rally' };
      t.enabled = true;
      t.confirm = false;
      t.preview = { type: info.type, tier };
      t.tip = { title: msg('ring.rallyTitle'), role: record, rows: null, next: null, hint: msg(this.desktop ? 'ring.rallyHintClick' : 'ring.rallyHint'), hintBad: '', fixedHint: true };
      this.applyEnabled(t);
    } else if (info.targeting) {
      const t = this.resetToken(i++);
      this.setFace(t, kit(this.art, 'iconTarget', Texture.EMPTY), false);
      this.setTag(t, msg(TARGET_LABEL[info.targeting]), false);
      t.action = { kind: 'target' };
      t.enabled = true;
      t.confirm = false;
      t.preview = { type: info.type, tier };
      t.tip = targetTip(info.targeting, record, this.desktop);
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
      t.tip = { title: msg('ring.sell', { name }), role: record ? `${msg('ring.refund', { n: info.refund })} · ${record}` : msg('ring.refund', { n: info.refund }), rows: null, next: null, hint: this.hint('sell'), hintBad: '' };
      this.applyEnabled(t);
    }
    this.count = i;
    // Wider than the build ring: the built tower stands in the middle and must stay visible.
    const r = this.tokenR;
    const k = info.keepOut ?? null;
    const minR = Math.max(r3(r), k ? k.h * 0.55 + r * 1.5 + 4 : 0);
    const radius = Math.max(minR, ringRadius(evenAngles(i), r, r * TAG_H));
    const angles = towerRingAngles(i, cx, cy, r, r * TAG_H, radius, this.screenW, this.screenH, this.insets, k, 6, this.avoidRects());
    this.layout(cx, cy, angles, radius);
    if (this.infoTip) this.showTip(-1);
  }

  /** Refreshes the targeting token's label after the mode changed. */
  setTargetMode(mode: TargetingMode): void {
    for (let i = 0; i < this.count; i++) {
      const t = this.tokens[i];
      if (t.action?.kind === 'target') {
        this.setTag(t, msg(TARGET_LABEL[mode]), false);
        t.tip = targetTip(mode, t.tip?.role ?? '', this.desktop);
        if (this.tooltip.root.visible) this.showTip(i);
      }
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
      // Nothing pointed at: the tower's own card when it has one (a specialized tower).
      if (this.infoTip && this.isOpen) this.placeTip(this.infoTip);
      else this.tooltip.root.visible = false;
      return;
    }
    const c = t.tip;
    const poor = t.cost !== null && !t.enabled;
    c.cost = t.cost;
    c.hintBad = t.banned ? msg('ring.banned') : poor ? msg('ring.needGold', { n: t.cost ?? 0 }) : '';
    const kind = t.action?.kind;
    const maxed = (kind === 'upgrade' || kind === 'ability') && t.cost === null;
    if (c.fixedHint) {
      // targeting / rally: the hint was written with the tip
    } else if (maxed || t.banned) c.hint = '';
    else if (i !== this.selected) c.hint = this.hint('choose');
    else
      c.hint =
        kind === 'build' || kind === 'upgrade' || kind === 'sell' || kind === 'compare' || kind === 'ability' ? this.hint(kind) : '';
    this.placeTip(c);
  }

  private placeTip(c: TipContent): void {
    this.tooltip.set(c, this.u);
    const p = placeTooltip(this.box, this.tooltip.w, this.tooltip.h, this.screenW, this.screenH, this.insets, 10, 6, this.avoid);
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
    return t.enabled || t.actsWhenPoor ? t.action : null;
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
