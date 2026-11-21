import { describe, expect, it } from 'vitest';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import {
  clampPan,
  fitAt,
  fullBleedFitItems,
  hardShapes,
  MAX_REACH_ZOOM,
  PAN_ZOOM,
  PLOT_REACH_FRAC,
  plotReachSpot,
  unreachablePlots,
} from '../../src/render2d/fullBleed.ts';
import { dockPieces, hudDock, type HudDockOptions } from '../../src/render2d/hudDock.ts';
import { KIT_PLAQUE_SLOTS, NO_INSETS, type Insets, type Rect } from '../../src/render2d/uiLayout.ts';

/** Viewports required by the plot-reachability contract (desktop, laptop, small window, phone landscape/portrait). */
const REACH_VIEWPORTS: readonly [string, number, number, Insets, boolean][] = [
  // name, w, h, insets, expectCover (no bands at any pan offset)
  ['1920x1080', 1920, 1080, NO_INSETS, true],
  ['1366x768', 1366, 768, NO_INSETS, true],
  ['1280x720', 1280, 720, NO_INSETS, true],
  ['800x600', 800, 600, NO_INSETS, true],
  ['844x390', 844, 390, NO_INSETS, true],
  ['390x844', 390, 844, NO_INSETS, false],
  ['844x390-notch', 844, 390, { top: 0, right: 47, bottom: 21, left: 47 }, true],
  ['390x844-notch', 390, 844, { top: 47, right: 0, bottom: 34, left: 0 }, false],
];

const BASE_OPTS: HudDockOptions = {
  plaqueAspect: 1024 / 294,
  plaqueSlots: KIT_PLAQUE_SLOTS,
  bannerAspect: 512 / 152,
  hero: true,
};

function circleHitsRect(cx: number, cy: number, r: number, rect: Rect): boolean {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
}

describe('plot reachability under clamped map pan', () => {
  it('every plot on every 2D island can be panned clear of all HUD pieces with zero empty bands', () => {
    const failures: string[] = [];
    for (const [vname, w, h, ins, expectCover] of REACH_VIEWPORTS) {
      for (const items of [0, 3] as const) {
        for (const hero of [true, false] as const) {
          // Focus hero=false on the primary 6 viewports without duplicating notch variants.
          if (!hero && vname.includes('notch')) continue;
          for (const level of LEVELS_2D) {
            const layout = level.layout2d!;
            const [iw, ih] = layout.imageSize;
            const shapes = hardShapes(layout);
            const placed = fullBleedFitItems(
              w,
              h,
              layout,
              (itemMode) => hudDock(w, h, ins, { ...BASE_OPTS, hero, items, itemMode }),
              shapes,
            );
            const { fit, pan, dock } = placed;
            const pieces = Object.values(dockPieces(dock));
            const tag = `${level.id} ${vname} hero=${hero} items=${items}`;

            const bad = unreachablePlots(shapes, iw, ih, w, h, fit.scale, pan, dock);
            if (bad.length > 0) {
              failures.push(`${tag}: unreachable plots [${bad.join(', ')}]`);
              continue;
            }

            if (expectCover) {
              expect(fit.shrink, tag).toBeLessThanOrEqual(MAX_REACH_ZOOM + 1e-9);
              if (h >= 600) expect(fit.shrink, tag).toBeLessThanOrEqual(PAN_ZOOM + 1e-9);
            }

            // Spot-check every plot's actual reachable pan offset: inside pan range, zero bands on
            // covered screens, and the plot's clear tap disc avoids every HUD piece.
            for (let i = 0; i < shapes.plots.length; i++) {
              const p = shapes.plots[i];
              const spot = plotReachSpot(p, iw, ih, w, h, fit.scale, pan, pieces);
              if (!spot) {
                failures.push(`${tag} plot#${i}: no reach spot`);
                continue;
              }
              const clamped = clampPan(pan, spot.x, spot.y);
              expect(spot.x, `${tag} plot#${i} panX`).toBeCloseTo(clamped.x, 5);
              expect(spot.y, `${tag} plot#${i} panY`).toBeCloseTo(clamped.y, 5);
              if (expectCover) {
                const f = fitAt(w, h, iw, ih, fit.scale, spot.x, spot.y);
                expect([f.bandLeft, f.bandTop, f.bandRight, f.bandBottom], `${tag} plot#${i} bands`).toEqual([0, 0, 0, 0]);
              }
              const cx = spot.x + p.x * fit.scale;
              const cy = spot.y + p.y * fit.scale;
              const clearR = p.r * fit.scale * PLOT_REACH_FRAC - 0.1;
              expect(cx, `${tag} plot#${i} cx`).toBeGreaterThanOrEqual(-0.5);
              expect(cx, `${tag} plot#${i} cx`).toBeLessThanOrEqual(w + 0.5);
              expect(cy, `${tag} plot#${i} cy`).toBeGreaterThanOrEqual(-0.5);
              expect(cy, `${tag} plot#${i} cy`).toBeLessThanOrEqual(h + 0.5);
              for (const rc of pieces) {
                if (circleHitsRect(cx, cy, Math.max(0, clearR), rc)) {
                  failures.push(`${tag} plot#${i}: spot overlaps HUD rect`);
                  break;
                }
              }
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
  }, 30_000);

  it('plotReachSpot detects when a HUD rect permanently traps a plot across the entire pan range', () => {
    const plot = { x: 500, y: 400, r: 40 };
    const pan = { minX: -40, maxX: 0, minY: -20, maxY: 0 };
    // A wide HUD bar covering x=350..650, y=340..460 traps the plot (reachable x=460..500, y=380..400).
    const trap: Rect = { x: 350, y: 340, w: 300, h: 120 };
    expect(plotReachSpot(plot, 1000, 500, 960, 480, 1, pan, [trap])).toBeNull();
    // Moving the HUD bar aside lets the plot clear it.
    const clear: Rect = { x: 0, y: 340, w: 300, h: 120 };
    const spot = plotReachSpot(plot, 1000, 500, 960, 480, 1, pan, [clear]);
    expect(spot).not.toBeNull();
  });
});
