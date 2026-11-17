import { describe, expect, it } from 'vitest';
import {
  computeOcclusionFit,
  planeTargetToGround,
  projectPlanePoints,
  visibleFraction,
  type OcclusionFitOptions,
  type PxRect,
} from '../../src/render/occlusionFit.ts';

const TILT = (50 * Math.PI) / 180;
const YAW = Math.PI / 4;

/** 10x10 tile island (tile size 2) as xyz triples at y = 0.5. */
function islandXyz(n = 10, tile = 2): { xyz: number[]; w: number[] } {
  const xyz: number[] = [];
  const w: number[] = [];
  for (let c = 0; c < n; c++) {
    for (let r = 0; r < n; r++) {
      xyz.push((c - (n - 1) / 2) * tile, 0.5, (r - (n - 1) / 2) * tile);
      w.push(1);
    }
  }
  return { xyz, w };
}

function opts(over: Partial<OcclusionFitOptions> = {}): OcclusionFitOptions {
  return {
    viewportW: 844,
    viewportH: 390,
    halfHeight: 13,
    tileWorld: 2,
    hudRects: [],
    zoomCeil: 1.4,
    zoomFloor: 0.8,
    coverage: 0.88,
    prefR: 0,
    prefU: 0,
    ...over,
  };
}

describe('projectPlanePoints / planeTargetToGround', () => {
  it('round-trips a ground target through camera-plane coordinates', () => {
    const tx = 3.2;
    const tz = -4.1;
    const p = projectPlanePoints([tx, 0, tz], [1], YAW, TILT);
    const g = planeTargetToGround(p.r[0], p.u[0], YAW, TILT);
    expect(g.x).toBeCloseTo(tx, 5);
    expect(g.z).toBeCloseTo(tz, 5);
  });
});

describe('computeOcclusionFit', () => {
  const { xyz, w } = islandXyz();
  const pts = projectPlanePoints(xyz, w, YAW, TILT);

  it('keeps the legacy zoom when nothing needs to move', () => {
    const o = opts({ zoomCeil: 0.9, zoomFloor: 0.5 });
    const fit = computeOcclusionFit(pts, o);
    expect(fit.zoom).toBeCloseTo(0.9, 5);
    expect(fit.coverage).toBeGreaterThanOrEqual(0.88);
  });

  it('never exceeds the ceiling nor drops below the floor', () => {
    const hud: PxRect[] = [{ x0: 0, y0: 0, x1: 844, y1: 390 }];
    const fit = computeOcclusionFit(pts, opts({ hudRects: hud }));
    expect(fit.zoom).toBeGreaterThanOrEqual(0.8 - 1e-9);
    expect(fit.zoom).toBeLessThanOrEqual(1.4 + 1e-9);
  });

  it('keeps tiles out from under a corner HUD cluster', () => {
    const hud: PxRect[] = [{ x0: 520, y0: 290, x1: 844, y1: 390 }];
    const o = opts({ hudRects: hud, zoomCeil: 1.0, zoomFloor: 0.4 });
    const fit = computeOcclusionFit(pts, o);
    const cov = visibleFraction(pts, fit.zoom, fit.targetR, fit.targetU, o);
    expect(cov).toBeGreaterThanOrEqual(0.88);
    // Same zoom, naive centred target: the cluster hides a noticeable share of tiles.
    const naive = visibleFraction(pts, fit.zoom, 0, 0, o);
    expect(cov).toBeGreaterThanOrEqual(naive);
  });

  it('prefers the legacy target when several targets are equally good', () => {
    const o = opts({ zoomCeil: 0.7, zoomFloor: 0.3, prefR: 0.4, prefU: -0.2 });
    const fit = computeOcclusionFit(pts, o);
    expect(fit.targetR).toBeCloseTo(0.4, 1);
    expect(fit.targetU).toBeCloseTo(-0.2, 1);
  });

  it('falls back to the whole-island zoom when the HUD makes coverage impossible', () => {
    const hud: PxRect[] = [
      { x0: 0, y0: 0, x1: 844, y1: 200 },
      { x0: 0, y0: 200, x1: 844, y1: 390 },
    ];
    const fit = computeOcclusionFit(pts, opts({ hudRects: hud }));
    expect(fit.zoom).toBeCloseTo(0.8, 5);
  });

  it('keeps a whole tile (not just its centre) clear of a HUD control', () => {
    // A rect 0.4 tile from the tile centre leaves the centre clear but overlaps the tile itself.
    const one = projectPlanePoints([0, 0.5, 0], [1], YAW, TILT);
    const o = opts({ viewportW: 400, viewportH: 400, zoomCeil: 1, zoomFloor: 1 });
    const ppu = (400 / 2 / 13) * 1;
    const tilePx = 2 * ppu;
    const cx = 200;
    const near: PxRect = { x0: cx + 0.4 * tilePx, y0: 0, x1: 400, y1: 400 };
    const far: PxRect = { x0: cx + 0.7 * tilePx, y0: 0, x1: 400, y1: 400 };
    expect(visibleFraction(one, 1, 0, 0, { ...o, hudRects: [near] })).toBe(0);
    expect(visibleFraction(one, 1, 0, 0, { ...o, hudRects: [far] })).toBe(1);
  });

  it('centres the island when several targets reach the coverage target', () => {
    // A small control in one corner: the target must not drift toward the opposite side.
    const hud: PxRect[] = [{ x0: 800, y0: 0, x1: 844, y1: 40 }];
    const o = opts({ hudRects: hud, zoomCeil: 0.8, zoomFloor: 0.3, prefR: 0, prefU: 0 });
    const fit = computeOcclusionFit(pts, o);
    const halfViewR = o.viewportW / 2 / ((o.viewportH / 2 / o.halfHeight) * fit.zoom);
    expect(Math.abs(fit.targetR)).toBeLessThan(0.1 * halfViewR);
  });

  it('is deterministic', () => {
    const hud: PxRect[] = [{ x0: 600, y0: 250, x1: 844, y1: 390 }];
    const a = computeOcclusionFit(pts, opts({ hudRects: hud }));
    const b = computeOcclusionFit(pts, opts({ hudRects: hud }));
    expect(a).toEqual(b);
  });
});
