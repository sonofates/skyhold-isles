import { Container, Sprite, Texture, type Text } from 'pixi.js';
import type { TowerType } from '../core/types.ts';
import type { LoadedArt } from './assets2d.ts';
import { MIN_TOUCH } from './hud.ts';
import { paintedText, setFontSize, setText } from './hudText.ts';
import { layoutRing, type RingPoint } from './ringLayout.ts';

export type RingAction =
  | { readonly kind: 'build'; readonly type: TowerType }
  | { readonly kind: 'upgrade' }
  | { readonly kind: 'sell' };

interface Token {
  readonly root: Container;
  readonly bg: Sprite;
  readonly icon: Sprite;
  readonly label: Text;
  action: RingAction | null;
  enabled: boolean;
}

export interface TowerPanelInfo {
  readonly type: TowerType;
  readonly tier: number;
  /** Cost of the next tier, or null at max tier. */
  readonly upgradeCost: number | null;
  readonly refund: number;
}

const MAX_TOKENS = 4;

/**
 * Screen-space build ring (free plot: one token per buildable tower with its cost, greyed when
 * unaffordable) and tower panel (built plot: upgrade with cost / MAX, sell with refund). Tokens
 * are pooled; touch targets are at least MIN_TOUCH px.
 */
export class BuildRing {
  readonly root = new Container();
  private readonly tokens: Token[] = [];
  private readonly points: RingPoint[] = [];
  private readonly art: LoadedArt;
  private tokenR = 32;
  private count = 0;
  /** What the ring is open on: plot index, or -1. */
  plot = -1;
  mode: 'build' | 'tower' | null = null;

  constructor(art: LoadedArt) {
    this.art = art;
    for (let i = 0; i < MAX_TOKENS; i++) {
      const root = new Container();
      const bg = new Sprite(art.ui.button);
      bg.anchor.set(0.5);
      const icon = new Sprite(Texture.EMPTY);
      icon.anchor.set(0.5, 0.62);
      const label = paintedText(18, 'center');
      root.addChild(bg, icon, label);
      root.visible = false;
      this.root.addChild(root);
      this.tokens.push({ root, bg, icon, label, action: null, enabled: false });
    }
    this.root.visible = false;
  }

  get isOpen(): boolean {
    return this.mode !== null;
  }

  close(): void {
    this.mode = null;
    this.plot = -1;
    this.root.visible = false;
  }

  private sizeFor(w: number, h: number): void {
    const u = Math.max(0.5, Math.min(1.15, Math.min(w / 1400, h / 760)));
    this.tokenR = Math.max(MIN_TOUCH / 2 + 2, 42 * u);
  }

  private setToken(i: number, tex: Texture, iconH: number, label: string, action: RingAction, enabled: boolean): void {
    const t = this.tokens[i];
    const r = this.tokenR;
    t.root.visible = true;
    t.bg.width = r * 2;
    t.bg.height = r * 2;
    if (t.icon.texture !== tex) t.icon.texture = tex;
    const s = (r * iconH) / Math.max(1, tex.height);
    t.icon.scale.set(s);
    t.icon.position.set(0, r * 0.05);
    setFontSize(t.label, Math.round(Math.max(14, r * 0.5)));
    setText(t.label, label);
    t.label.position.set(0, r * 1.02);
    t.action = action;
    t.enabled = enabled;
    t.root.alpha = enabled ? 1 : 0.62;
    const tint = enabled ? 0xffffff : 0x8a8a8a;
    t.bg.tint = tint;
    t.icon.tint = tint;
    t.label.style.fill = enabled ? '#fff4dc' : '#d9a59a';
  }

  private place(cx: number, cy: number, w: number, h: number, topBand: number): void {
    layoutRing(cx, cy, this.count, this.tokenR, w, h, topBand, this.points);
    for (let i = 0; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      if (i < this.count) t.root.position.set(this.points[i].x, this.points[i].y);
      else t.root.visible = false;
    }
    this.root.visible = true;
  }

  openBuild(plot: number, cx: number, cy: number, gold: number, costs: ReadonlyMap<TowerType, number>, w: number, h: number, topBand: number): void {
    this.sizeFor(w, h);
    this.mode = 'build';
    this.plot = plot;
    const ring = this.art.manifest.buildRing;
    this.count = Math.min(MAX_TOKENS, ring.length);
    for (let i = 0; i < this.count; i++) {
      const type = ring[i];
      const cost = costs.get(type) ?? 0;
      const tex = this.art.towers[type]?.tiers[0] ?? Texture.WHITE;
      this.setToken(i, tex, 1.45, String(cost), { kind: 'build', type }, gold >= cost);
    }
    this.place(cx, cy, w, h, topBand);
  }

  openTower(plot: number, cx: number, cy: number, info: TowerPanelInfo, gold: number, w: number, h: number, topBand: number): void {
    this.sizeFor(w, h);
    this.mode = 'tower';
    this.plot = plot;
    this.count = 2;
    const art = this.art.towers[info.type];
    const nextTier = Math.min(3, info.tier + 1);
    const upTex = art?.tiers[nextTier - 1] ?? Texture.WHITE;
    if (info.upgradeCost === null) {
      this.setToken(0, upTex, 1.45, 'MAX', { kind: 'upgrade' }, false);
    } else {
      this.setToken(0, upTex, 1.45, `▲ ${info.upgradeCost}`, { kind: 'upgrade' }, gold >= info.upgradeCost);
    }
    this.setToken(1, this.art.ui.gold, 0.95, `+${info.refund}`, { kind: 'sell' }, true);
    this.place(cx, cy, w, h, topBand);
  }

  /** Token under a screen point: its action (null if disabled), or undefined if no token was hit. */
  hit(x: number, y: number): RingAction | null | undefined {
    if (!this.isOpen) return undefined;
    const r = this.tokenR * 1.08;
    for (let i = 0; i < this.count; i++) {
      const t = this.tokens[i];
      const dx = x - t.root.x;
      const dy = y - t.root.y;
      if (dx * dx + dy * dy <= r * r) return t.enabled ? t.action : null;
    }
    return undefined;
  }

  /** Screen positions of the open tokens (QA hooks). */
  tokenPositions(): { x: number; y: number; enabled: boolean }[] {
    const out: { x: number; y: number; enabled: boolean }[] = [];
    for (let i = 0; i < this.count && this.isOpen; i++) {
      const t = this.tokens[i];
      out.push({ x: t.root.x, y: t.root.y, enabled: t.enabled });
    }
    return out;
  }
}
