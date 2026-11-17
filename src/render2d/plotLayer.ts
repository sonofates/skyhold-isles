import { Container, Sprite, Texture } from 'pixi.js';
import type { Level2DLayout } from '../data/levels/types.ts';
import type { PlotArtRuntime } from './assets2d.ts';
import type { ProcTextures } from './procTextures.ts';
import { plotRing, plotSpriteRect, type PlotRect, type RingPlacement } from './towerFit.ts';

/** Plot sprite aspect when the plot art is missing (plot-base.png is 512 x 343). */
const FALLBACK_ASPECT = 343 / 512;
const HOVER_TINT = 0xffe7a8;
const SELECT_TINT = 0xfff0c8;
const DIM_TINT = 0x8f8f8f;

/** Plot sprite + ring placement of every plot of a layout (layout px). */
export interface PlotGeometry {
  readonly rects: readonly PlotRect[];
  readonly rings: readonly RingPlacement[];
}

export function plotGeometry(layout: Level2DLayout, plot: PlotArtRuntime | null): PlotGeometry {
  const texW = plot ? plot.texture.width : 512;
  const texH = plot ? plot.texture.height : 512 * FALLBACK_ASPECT;
  const r = layout.plotRadius * layout.pxPerUnit;
  const rects = layout.plots.map((p) =>
    plotSpriteRect(p.x * layout.pxPerUnit + layout.imageSize[0] / 2, p.z * layout.pxPerUnit + layout.imageSize[1] / 2, r, texW, texH),
  );
  return { rects, rings: rects.map((rect) => plotRing(rect, texW, texH, plot ? plot.ring : null)) };
}

export type PlotState = 'free' | 'covered' | 'legacy';

interface PlotView {
  readonly sprite: Sprite;
  readonly shadow: Sprite;
  readonly halo: Sprite;
  readonly hi: Sprite;
}

/**
 * The empty build plots, drawn by the game (the baked map has none): a plot-base sprite on every
 * free plot with a soft contact shadow; hover and selected states glow (a warm halo behind the
 * ring plus an additive lift of the ring itself); every free plot dims while no tower is
 * affordable. A plot under ring-convention tower art is hidden (the tower's own ring replaces it);
 * under legacy art (its own base) the plot stays visible beneath it.
 */
export class PlotLayer {
  readonly root = new Container();
  readonly geometry: PlotGeometry;
  private readonly views: PlotView[] = [];
  private time = 0;
  /** QA: plots currently drawn. */
  visibleCount = 0;

  constructor(layout: Level2DLayout, plot: PlotArtRuntime | null, tex: ProcTextures) {
    this.geometry = plotGeometry(layout, plot);
    const shadows = new Container();
    const halos = new Container();
    const sprites = new Container();
    this.root.addChild(shadows, halos, sprites);
    this.geometry.rects.forEach((rect, i) => {
      const ring = this.geometry.rings[i];
      const shadow = new Sprite(tex.shadow);
      shadow.anchor.set(0.5);
      shadow.position.set(ring.cx, ring.bottom - ring.width * 0.3);
      shadow.width = ring.width * 1.14;
      shadow.height = ring.width * 0.56;
      shadow.alpha = 0.42;
      const halo = new Sprite(tex.orb);
      halo.anchor.set(0.5);
      halo.blendMode = 'add';
      halo.position.set(ring.cx, ring.bottom - ring.width * 0.33);
      halo.visible = false;
      const sprite = new Sprite(plot ? plot.texture : Texture.EMPTY);
      sprite.position.set(rect.x, rect.y);
      sprite.width = rect.w;
      sprite.height = rect.h;
      const hi = new Sprite(plot ? plot.texture : Texture.EMPTY);
      hi.position.set(rect.x, rect.y);
      hi.width = rect.w;
      hi.height = rect.h;
      hi.blendMode = 'add';
      hi.visible = false;
      shadows.addChild(shadow);
      halos.addChild(halo);
      sprites.addChild(sprite, hi);
      this.views.push({ sprite, shadow, halo, hi });
    });
  }

  /**
   * `state(i)`: what stands on plot i. `hover` / `selected`: plot index or -1. `dim`: nothing is
   * affordable (free plots grey out).
   */
  sync(state: (i: number) => PlotState, hover: number, selected: number, dim: boolean, dt: number): void {
    this.time += dt;
    let visible = 0;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4.2);
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      const st = state(i);
      const show = st !== 'covered';
      v.sprite.visible = show;
      v.shadow.visible = show;
      if (show) visible++;
      const free = st === 'free';
      const sel = i === selected;
      const hov = !sel && i === hover && free;
      v.sprite.tint = free && dim && !sel ? DIM_TINT : 0xffffff;
      const glow = show && (sel || hov);
      v.halo.visible = glow;
      v.hi.visible = glow;
      if (glow) {
        const w = this.geometry.rings[i].width;
        const k = sel ? 1.55 + 0.06 * pulse : 1.4;
        v.halo.width = w * k;
        v.halo.height = w * k * 0.62;
        v.halo.tint = sel ? SELECT_TINT : HOVER_TINT;
        v.halo.alpha = sel ? 0.5 + 0.15 * pulse : 0.38;
        v.hi.alpha = sel ? 0.2 + 0.08 * pulse : 0.14;
      }
    }
    this.visibleCount = visible;
  }

  /** Plot index whose sprite contains a map-px point (ellipse test), or -1. */
  plotAtPx(x: number, y: number): number {
    let best = -1;
    let bestD = 1;
    for (let i = 0; i < this.geometry.rings.length; i++) {
      const r = this.geometry.rings[i];
      const rx = r.width / 2;
      const ry = r.width * 0.36;
      const dx = (x - r.cx) / rx;
      const dy = (y - (r.bottom - r.width * 0.33)) / ry;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
}
