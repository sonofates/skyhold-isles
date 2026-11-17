/**
 * The one place that decides where a plot sprite and a tower sprite sit (pure math, no Pixi).
 *
 * Convention (art v2/v3): every tower stands on the SAME round stone ring as the empty plot
 * (public/art2d/plot-base.webp). Each file draws that ring at its own pixel size, and parts of a
 * tower (ballista arms, mortar barrels, banners) may be wider than the ring, so the ring is
 * measured per file (tools/map-compose/ringfit.py → manifest `ring`, or `measureRing` below) as
 * {ringWidthPx, ringBottomPx, ringCenterXPx} in the file's own px.
 *
 * Plot sprite: drawn 2 * plotRadiusPx wide (layout px), centred on the plot point; height follows
 * the texture's aspect. The same footprint is used by the map compositor.
 * Tower: scaled so its ring is exactly as wide as the plot sprite's ring, with its ring
 * bottom-centre on the plot ring's bottom-centre. So the rings overlap pixel for pixel, and the
 * plot sprite can be hidden while a tower stands on it.
 */
export interface RingSpec {
  readonly ringWidthPx: number;
  readonly ringBottomPx: number;
  readonly ringCenterXPx: number;
}

export interface PlotRect {
  /** Top-left of the plot sprite, layout px. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The plot's stone ring in layout px. */
export interface RingPlacement {
  readonly cx: number;
  readonly bottom: number;
  readonly width: number;
}

export interface SpriteFit {
  /** Uniform sprite scale (texture px → layout px). */
  readonly scale: number;
  /** Sprite anchor (normalised) = the ring bottom-centre in the texture. */
  readonly anchorX: number;
  readonly anchorY: number;
  /** Where the anchor goes, layout px. */
  readonly x: number;
  readonly y: number;
}

/** Plot sprite rect for a plot centre (layout px). */
export function plotSpriteRect(px: number, py: number, plotRadiusPx: number, texW: number, texH: number): PlotRect {
  const w = plotRadiusPx * 2;
  const h = (w * texH) / Math.max(1, texW);
  return { x: px - w / 2, y: py - h / 2, w, h };
}

/** The plot sprite's ring in layout px (`ring` in plot-texture px; null = the whole sprite). */
export function plotRing(rect: PlotRect, texW: number, texH: number, ring: RingSpec | null): RingPlacement {
  const r = ring ?? { ringWidthPx: texW, ringBottomPx: texH, ringCenterXPx: texW / 2 };
  const k = rect.w / Math.max(1, texW);
  return { cx: rect.x + r.ringCenterXPx * k, bottom: rect.y + r.ringBottomPx * k, width: r.ringWidthPx * k };
}

/**
 * Fit of a ring-convention sprite (tower tier or animation frame of size texW x texH whose ring is
 * `ring`) onto a plot ring. `ringScale` is an optional per-tower tweak (manifest), default 1.
 */
export function fitOnRing(target: RingPlacement, ring: RingSpec, texW: number, texH: number, ringScale = 1): SpriteFit {
  return {
    scale: (target.width * ringScale) / Math.max(1e-6, ring.ringWidthPx),
    anchorX: ring.ringCenterXPx / Math.max(1, texW),
    anchorY: ring.ringBottomPx / Math.max(1, texH),
    x: target.cx,
    y: target.bottom,
  };
}

/** The tower's ring as drawn by a fit (layout px), for QA: should equal the plot ring. */
export function drawnRing(fit: SpriteFit, ring: RingSpec): RingPlacement {
  return { cx: fit.x, bottom: fit.y, width: ring.ringWidthPx * fit.scale };
}

const ALPHA = 128;
/** plot-base ring height / width (incl. the stone thickness). */
const RING_ASPECT = 0.666;

/**
 * Measures the stone ring from RGBA pixels (same algorithm as tools/map-compose/ringfit.py): below
 * its equator the silhouette IS the ring (the tower body is narrower), so the ring width is the
 * widest opaque run within the bottom half of the ring's height; that height is not known up front
 * (width * aspect), so it iterates from the bottom 22 %. Null for an empty image.
 */
export function measureRing(rgba: ArrayLike<number>, w: number, h: number): RingSpec | null {
  const run = (y: number): [number, number] | null => {
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > ALPHA) {
        if (lo < 0) lo = x;
        hi = x;
      }
    }
    return lo < 0 ? null : [lo, hi];
  };
  let bottom = -1;
  for (let y = h - 1; y >= 0 && bottom < 0; y--) if (run(y)) bottom = y;
  if (bottom < 0) return null;
  let band = h * 0.22;
  let best: [number, number] = [0, 0];
  for (let iter = 0; iter < 6; iter++) {
    let bw = -1;
    for (let y = Math.max(0, Math.floor(bottom - band)); y <= bottom; y++) {
      const r = run(y);
      if (r && r[1] - r[0] > bw) {
        bw = r[1] - r[0];
        best = r;
      }
    }
    const nb = (best[1] - best[0] + 1) * RING_ASPECT * 0.5;
    if (Math.abs(nb - band) < 1) break;
    band = nb;
  }
  return { ringWidthPx: best[1] - best[0] + 1, ringBottomPx: bottom + 1, ringCenterXPx: (best[0] + best[1] + 1) / 2 };
}

/**
 * Muzzle height (world units, the sim's height axis) of a ring-fitted tower: `muzzleFrac` of the
 * drawn height above the ring bottom, relative to the plot centre the sim uses as the tower point.
 */
export function ringMuzzle(fit: SpriteFit, ring: RingSpec, plotCentreY: number, muzzleFrac: number, heightToScreenPx: number): number {
  const above = ring.ringBottomPx * fit.scale * muzzleFrac - (fit.y - plotCentreY);
  return Math.max(0.2, above / Math.max(1e-6, heightToScreenPx));
}
