/**
 * HUD-occlusion aware framing (pure math, no three / DOM).
 *
 * The legacy fit (cameraFit.ts) frames the island inside generic HUD insets. This module refines
 * it with the *measured* HUD rectangles: it picks the largest zoom (never above the legacy one)
 * at which enough playable tiles stay on screen and clear of every HUD control, and the target
 * that achieves it. Corner HUD clusters (landscape ability buttons, portrait speed/start gems)
 * therefore push the island away instead of covering tiles.
 */

/** Screen rectangle in CSS px (origin top-left). */
export interface PxRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Playable-tile samples projected into the camera plane (world units, target at origin). */
export interface PlanePoints {
  r: Float32Array;
  u: Float32Array;
  w: Float32Array;
}

/** Projects xyz triples with per-point weights onto the camera plane for the given yaw / tilt. */
export function projectPlanePoints(
  xyz: ArrayLike<number>,
  weights: ArrayLike<number>,
  yaw: number,
  tilt: number,
): PlanePoints {
  const n = Math.floor(xyz.length / 3);
  const r = new Float32Array(n);
  const u = new Float32Array(n);
  const w = new Float32Array(n);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const st = Math.sin(tilt);
  const ct = Math.cos(tilt);
  for (let i = 0; i < n; i++) {
    const x = xyz[i * 3];
    const y = xyz[i * 3 + 1];
    const z = xyz[i * 3 + 2];
    r[i] = x * cy - z * sy;
    u[i] = -x * sy * st + y * ct - z * cy * st;
    w[i] = weights[i] ?? 1;
  }
  return { r, u, w };
}

export interface OcclusionFitOptions {
  viewportW: number;
  viewportH: number;
  /** Orthographic frustum half-height at zoom 1 (world units). */
  halfHeight: number;
  /** World size of one tile; sets the margin kept around HUD rects and viewport edges. */
  tileWorld: number;
  hudRects: readonly PxRect[];
  /** Largest zoom the fit may pick (the legacy fill zoom). */
  zoomCeil: number;
  /** Smallest zoom (whole island visible). */
  zoomFloor: number;
  /** Required fraction (by weight) of playable tiles that must be visible and unobstructed. */
  coverage: number;
  /** Preferred target in camera-plane coords (tie-break: stay near the legacy framing). */
  prefR: number;
  prefU: number;
}

export interface OcclusionFitResult {
  zoom: number;
  /** Camera-plane target (right / up components of the ground target). */
  targetR: number;
  targetU: number;
  coverage: number;
}

function ppuAt(o: OcclusionFitOptions, zoom: number): number {
  return (o.viewportH / 2 / o.halfHeight) * zoom;
}

/** Margin (px) around a tile centre that must stay clear: ~0.3 of the tile's on-screen size. */
function tileMarginPx(o: OcclusionFitOptions, zoom: number): number {
  return Math.max(6, o.tileWorld * ppuAt(o, zoom) * 0.3);
}

/** Points with at least this weight (spawn / goal) must be visible, not merely counted. */
export const KEY_POINT_WEIGHT = 5;

/**
 * Weighted fraction of points visible (inside the viewport, outside every HUD rect). A hidden key
 * point (spawn / goal) subtracts 0.5, which makes that framing infeasible for any sane coverage target.
 */
export function visibleFraction(
  pts: PlanePoints,
  zoom: number,
  tr: number,
  tu: number,
  o: OcclusionFitOptions,
): number {
  const ppu = ppuAt(o, zoom);
  const m = tileMarginPx(o, zoom);
  const W = o.viewportW;
  const H = o.viewportH;
  const rects = o.hudRects;
  let seen = 0;
  let total = 0;
  let keyHidden = false;
  for (let i = 0; i < pts.r.length; i++) {
    const wgt = pts.w[i];
    total += wgt;
    const px = W / 2 + (pts.r[i] - tr) * ppu;
    const py = H / 2 - (pts.u[i] - tu) * ppu;
    // Key tiles (spawn / goal) get a roomier margin so they never hug the screen edge.
    const mm = wgt >= KEY_POINT_WEIGHT ? m * 1.8 : m;
    if (px < mm || px > W - mm || py < mm || py > H - mm) {
      if (wgt >= KEY_POINT_WEIGHT) keyHidden = true;
      continue;
    }
    let blocked = false;
    for (let k = 0; k < rects.length; k++) {
      const rc = rects[k];
      if (px > rc.x0 - mm && px < rc.x1 + mm && py > rc.y0 - mm && py < rc.y1 + mm) {
        blocked = true;
        break;
      }
    }
    if (!blocked) seen += wgt;
    else if (wgt >= KEY_POINT_WEIGHT) keyHidden = true;
  }
  const frac = total > 0 ? seen / total : 1;
  return keyHidden ? frac - 0.5 : frac;
}

interface Box {
  rMin: number;
  rMax: number;
  uMin: number;
  uMax: number;
}

/** Best target for one zoom: coarse grid, then one refinement pass around the winner. */
function bestTargetAt(
  pts: PlanePoints,
  zoom: number,
  o: OcclusionFitOptions,
  box: Box,
): { r: number; u: number; cov: number } {
  const ppu = ppuAt(o, zoom);
  const halfViewR = o.viewportW / 2 / ppu;
  const halfViewU = o.viewportH / 2 / ppu;
  const rc = (box.rMin + box.rMax) / 2;
  const uc = (box.uMin + box.uMax) / 2;
  const rSpan = Math.max(0.2 * halfViewR, (box.rMax - box.rMin) / 2 + 0.25 * halfViewR);
  const uSpan = Math.max(0.2 * halfViewU, (box.uMax - box.uMin) / 2 + 0.25 * halfViewU);
  let dr = (2 * rSpan) / 16;
  let du = (2 * uSpan) / 16;
  let bestR = o.prefR;
  let bestU = o.prefU;
  let bestCov = -1;
  let bestScore = -Infinity;
  const consider = (r: number, u: number): void => {
    const cov = visibleFraction(pts, zoom, r, u, o);
    // Tie-break toward the legacy centred framing (distance in view widths, tiny weight).
    const dist = Math.hypot((r - o.prefR) / (2 * halfViewR), (u - o.prefU) / (2 * halfViewU));
    const score = cov - 0.02 * dist;
    if (score > bestScore) {
      bestScore = score;
      bestR = r;
      bestU = u;
      bestCov = cov;
    }
  };
  consider(o.prefR, o.prefU);
  for (let i = 0; i <= 16; i++) {
    for (let j = 0; j <= 16; j++) consider(rc - rSpan + i * dr, uc - uSpan + j * du);
  }
  const r0 = bestR - dr;
  const u0 = bestU - du;
  dr = (2 * dr) / 8;
  du = (2 * du) / 8;
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) consider(r0 + i * dr, u0 + j * du);
  }
  return { r: bestR, u: bestU, cov: bestCov };
}

/**
 * Picks the largest zoom (up to `zoomCeil`) at which at least `coverage` of the playable tiles can
 * be shown clear of the HUD, together with the best target for it. Falls back to `zoomFloor`
 * (whole island) when even that cannot be met.
 */
export function computeOcclusionFit(pts: PlanePoints, o: OcclusionFitOptions): OcclusionFitResult {
  const n = pts.r.length;
  if (n === 0) return { zoom: o.zoomCeil, targetR: o.prefR, targetU: o.prefU, coverage: 1 };
  const box: Box = { rMin: Infinity, rMax: -Infinity, uMin: Infinity, uMax: -Infinity };
  for (let i = 0; i < n; i++) {
    box.rMin = Math.min(box.rMin, pts.r[i]);
    box.rMax = Math.max(box.rMax, pts.r[i]);
    box.uMin = Math.min(box.uMin, pts.u[i]);
    box.uMax = Math.max(box.uMax, pts.u[i]);
  }
  const hi = Math.max(o.zoomFloor, o.zoomCeil);
  const top = bestTargetAt(pts, hi, o, box);
  if (top.cov >= o.coverage) return { zoom: hi, targetR: top.r, targetU: top.u, coverage: top.cov };

  let lo = o.zoomFloor;
  let loBest = bestTargetAt(pts, lo, o, box);
  if (loBest.cov < o.coverage) {
    return { zoom: lo, targetR: loBest.r, targetU: loBest.u, coverage: loBest.cov };
  }
  let hiZ = hi;
  for (let it = 0; it < 9; it++) {
    const mid = Math.sqrt(lo * hiZ);
    const b = bestTargetAt(pts, mid, o, box);
    if (b.cov >= o.coverage) {
      lo = mid;
      loBest = b;
    } else {
      hiZ = mid;
    }
  }
  return { zoom: lo, targetR: loBest.r, targetU: loBest.u, coverage: loBest.cov };
}

/** Converts a camera-plane target (right / up components) back to a ground (x, z) target. */
export function planeTargetToGround(
  tr: number,
  tu: number,
  yaw: number,
  tilt: number,
): { x: number; z: number } {
  const b = -tu / Math.sin(tilt);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  return { x: tr * cy + b * sy, z: -tr * sy + b * cy };
}
