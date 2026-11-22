import { describe, expect, it } from 'vitest';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { coveredPlotIndices, fullBleedFitItems, hardShapes, panRange, REACH_MAX, type PanRange } from '../../src/render2d/fullBleed.ts';
import { dockPieces, hudDock, type HudDock, type HudDockOptions } from '../../src/render2d/hudDock.ts';
import type { Circle } from '../../src/render2d/playfield.ts';
import { KIT_PLAQUE_SLOTS, NO_INSETS, type Rect } from '../../src/render2d/uiLayout.ts';

/** The reach task's screens: desktops, small windows, phone landscape and portrait. */
const SIZES: readonly [number, number][] = [[2000, 991], [1920, 1080], [1440, 900], [1366, 768], [1280, 720], [800, 600], [844, 390], [932, 430], [390, 844]];
const OPTS: HudDockOptions = { plaqueAspect: 1024 / 294, plaqueSlots: KIT_PLAQUE_SLOTS, bannerAspect: 512 / 152, hero: true };

function circleHits(cx: number, cy: number, r: number, b: Rect): boolean {
  const nx = Math.max(b.x, Math.min(cx, b.x + b.w));
  const ny = Math.max(b.y, Math.min(cy, b.y + b.h));
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
}

/**
 * Brute force, independent of reachRange's search: is there an offset in the range (1 px grid
 * plus the bounds) where the plot's tap circle — its part painted on the map — lies on screen and
 * under no dock piece? Returns the pieces that block it at every offset, or null when reachable.
 */
function blockers(c: Circle, pan: PanRange, pieces: Record<string, Rect>, scale: number, w: number, h: number, iw: number, ih: number): string[] | null {
  const axis = (lo: number, hi: number): number[] => {
    const out: number[] = [];
    for (let v = lo; v < hi; v += 1) out.push(v);
    out.push(hi);
    return out;
  };
  const xs = axis(pan.minX, pan.maxX);
  const ys = axis(pan.minY, pan.maxY);
  const seen = new Set<string>();
  const R = c.r * scale;
  for (const ox of xs) {
    for (const oy of ys) {
      const cx = ox + c.x * scale;
      const cy = oy + c.y * scale;
      const on = ox + Math.max(0, c.x - c.r) * scale >= 0 && oy + Math.max(0, c.y - c.r) * scale >= 0 && ox + Math.min(iw, c.x + c.r) * scale <= w && oy + Math.min(ih, c.y + c.r) * scale <= h;
      let hit = false;
      for (const [n, b] of Object.entries(pieces)) {
        if (circleHits(cx, cy, R, b)) {
          hit = true;
          seen.add(n);
        }
      }
      if (!on) seen.add('off-screen');
      if (on && !hit) return null;
    }
  }
  return [...seen];
}

const CASES = (() => {
  const out: { tag: string; w: number; h: number; iw: number; ih: number; plots: readonly Circle[]; dock: HudDock; scale: number; pan: PanRange; art: PanRange; fitX: number; fitY: number }[] = [];
  for (const items of [0, 3]) {
    for (const [w, h] of SIZES) {
      for (const level of LEVELS_2D) {
        const L = level.layout2d!;
        const [iw, ih] = L.imageSize;
        const shapes = hardShapes(L);
        const r = fullBleedFitItems(w, h, L, (itemMode) => hudDock(w, h, NO_INSETS, { ...OPTS, items, itemMode }), shapes);
        out.push({
          tag: `${level.id} ${w}x${h} items=${items}`, w, h, iw, ih, plots: shapes.plots, dock: r.dock, scale: r.fit.scale, pan: r.pan,
          art: panRange(w, h, iw, ih, r.fit.scale), fitX: r.fit.offsetX, fitY: r.fit.offsetY,
        });
      }
    }
  }
  return out;
})();

describe('every tower plot can be panned clear of the HUD (fullBleed.ts reachRange)', () => {
  it('each plot has a pan offset where its tap area is on screen and under no HUD piece', () => {
    const bad: string[] = [];
    for (const k of CASES) {
      const pieces = dockPieces(k.dock);
      k.plots.forEach((c, i) => {
        const b = blockers(c, k.pan, pieces, k.scale, k.w, k.h, k.iw, k.ih);
        if (b) bad.push(`${k.tag} plot ${i}: ${b.join('+')}`);
      });
    }
    expect(bad).toEqual([]);
  }, 300_000);

  it('no plot is covered by any HUD piece at the default view across all 25 islands and viewports', () => {
    const bad: string[] = [];
    for (const k of CASES) {
      const hit = coveredPlotIndices(k.plots, { scale: k.scale, offsetX: k.fitX, offsetY: k.fitY }, Object.values(dockPieces(k.dock)));
      if (hit.length > 0) bad.push(`${k.tag}: plots [${hit.join(',')}]`);
    }
    expect(bad).toEqual([]);
  });

  it('coveredPlotIndices accurately detects circle-vs-rect hits and respects safety margin', () => {
    const plots: Circle[] = [
      { x: 100, y: 100, r: 20 },
      { x: 300, y: 100, r: 20 },
    ];
    const fit = { scale: 1, offsetX: 0, offsetY: 0 };
    expect(coveredPlotIndices(plots, fit, [{ x: 125, y: 90, w: 50, h: 20 }], 0)).toEqual([]);
    expect(coveredPlotIndices(plots, fit, [{ x: 125, y: 90, w: 50, h: 20 }], 6)).toEqual([0]);
    expect(coveredPlotIndices(plots, fit, [{ x: 290, y: 95, w: 20, h: 10 }], 0)).toEqual([1]);
  });

  it('the reach past the painting stays bounded and always contains the default view', () => {
    for (const k of CASES) {
      const { pan, art, tag } = k;
      expect(pan.minX, tag).toBeLessThanOrEqual(art.minX + 1e-6);
      expect(pan.maxX, tag).toBeGreaterThanOrEqual(art.maxX - 1e-6);
      expect(pan.minY, tag).toBeLessThanOrEqual(art.minY + 1e-6);
      expect(pan.maxY, tag).toBeGreaterThanOrEqual(art.maxY - 1e-6);
      const capX = k.w * REACH_MAX + 2;
      const capY = k.h * REACH_MAX + 2;
      const mirrorX = k.iw * k.scale >= k.w * 0.68;
      const mirrorY = k.ih * k.scale >= k.h * 0.68;
      expect(art.minX - pan.minX + pan.maxX - art.maxX, tag).toBeLessThanOrEqual(mirrorX ? 2 * capX : 1);
      expect(art.minY - pan.minY + pan.maxY - art.maxY, tag).toBeLessThanOrEqual(mirrorY ? 2 * capY : 1);
      // Default view is always inside the legal pan range.
      expect(k.fitX, tag).toBeGreaterThanOrEqual(pan.minX - 1e-6);
      expect(k.fitX, tag).toBeLessThanOrEqual(pan.maxX + 1e-6);
      expect(k.fitY, tag).toBeGreaterThanOrEqual(pan.minY - 1e-6);
      expect(k.fitY, tag).toBeLessThanOrEqual(pan.maxY + 1e-6);
    }
  });
});
