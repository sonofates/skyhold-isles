/**
 * Pure math for framing the island inside the free part of the viewport (the viewport minus HUD
 * insets). Kept free of three.js / DOM so it can be unit-tested.
 *
 * Conventions: the camera looks at a ground target from yaw `yaw` (angle around Y, measured like
 * CameraController) at isometric elevation `tilt`. Screen-plane coordinates of a world point `p`
 * relative to the target are  sx = p . right,  sy = p . up  with
 *   right = (cos yaw, 0, -sin yaw)
 *   up    = (-sin yaw * sin tilt, cos tilt, -cos yaw * sin tilt)
 */

export interface ScreenExtents {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface FitInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FitOptions {
  viewportW: number;
  viewportH: number;
  insets: FitInsets;
  /** Orthographic frustum half-height at zoom 1 (world units). */
  halfHeight: number;
  yaw: number;
  tilt: number;
  /** Fraction of the free rect the island may fill (0..1). */
  fill: number;
  minZoom: number;
  maxZoom: number;
}

export interface FitResult {
  zoom: number;
  /** Ground target (y = 0) that centres the island in the free rect. */
  targetX: number;
  targetZ: number;
}

/** Screen-plane extents of a flat xyz triple list at the given yaw / tilt (target at origin). */
export function projectExtents(
  points: ArrayLike<number>,
  yaw: number,
  tilt: number,
): ScreenExtents | null {
  if (points.length < 3) return null;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const st = Math.sin(tilt);
  const ct = Math.cos(tilt);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 2 < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    const z = points[i + 2];
    const sx = x * cy - z * sy;
    const sv = -x * sy * st + y * ct - z * cy * st;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sv < minY) minY = sv;
    if (sv > maxY) maxY = sv;
  }
  return { minX, maxX, minY, maxY };
}

export function computeFit(ext: ScreenExtents, o: FitOptions): FitResult {
  const { viewportW: W, viewportH: H, insets } = o;
  const freeW = Math.max(40, W - insets.left - insets.right);
  const freeH = Math.max(40, H - insets.top - insets.bottom);
  const spanX = Math.max(1e-3, ext.maxX - ext.minX);
  const spanY = Math.max(1e-3, ext.maxY - ext.minY);

  // px per world unit at zoom z = (H / 2) / halfHeight * z
  const pxPerUnitAt1 = H / 2 / o.halfHeight;
  const zFit = Math.min((freeW * o.fill) / (spanX * pxPerUnitAt1), (freeH * o.fill) / (spanY * pxPerUnitAt1));
  const zoom = Math.max(o.minZoom, Math.min(o.maxZoom, zFit));
  const ppu = pxPerUnitAt1 * zoom;

  // Offset (px) of the free-rect centre from the screen centre. y grows downwards.
  const ox = (insets.left + (W - insets.right)) / 2 - W / 2;
  const oy = (insets.top + (H - insets.bottom)) / 2 - H / 2;

  const midX = (ext.minX + ext.maxX) / 2;
  const midY = (ext.minY + ext.maxY) / 2;

  // Want (mid - t) * ppu == offset  => t.right = midX - ox/ppu ; t.up = midY + oy/ppu
  const a = midX - ox / ppu;
  const upWanted = midY + oy / ppu;
  const st = Math.sin(o.tilt);
  // t lies on the ground: t.up = -sin(tilt) * (t . (sin yaw, cos yaw))
  const b = -upWanted / st;
  const sy = Math.sin(o.yaw);
  const cy = Math.cos(o.yaw);
  return {
    zoom,
    targetX: a * cy + b * sy,
    targetZ: -a * sy + b * cy,
  };
}

export interface FitProfile {
  insets: FitInsets;
  fill: number;
  /** Lower bound used while fitting (desktop keeps its historical floor). */
  minFitZoom: number;
  kind: 'portrait' | 'landscape-phone' | 'desktop';
}

/**
 * Chooses HUD insets (CSS px) for the viewport. Numbers follow the mobile UI spec: top plate
 * ~70px, bottom gems ~110px in portrait, much less in landscape where the HUD hugs the corners.
 */
export function pickFitProfile(w: number, h: number, safe: FitInsets): FitProfile {
  const coarseish = Math.min(w, h) <= 560;
  if (!coarseish) {
    return {
      kind: 'desktop',
      fill: 0.86,
      minFitZoom: 0.72,
      insets: { top: 64 + safe.top, bottom: 118 + safe.bottom, left: 18 + safe.left, right: 18 + safe.right },
    };
  }
  if (h > w) {
    return {
      kind: 'portrait',
      fill: 0.97,
      minFitZoom: 0.2,
      insets: { top: 76 + safe.top, bottom: 112 + safe.bottom, left: 6 + safe.left, right: 6 + safe.right },
    };
  }
  return {
    kind: 'landscape-phone',
    fill: 0.97,
    minFitZoom: 0.2,
    insets: { top: 50 + safe.top, bottom: 22 + safe.bottom, left: 10 + safe.left, right: 10 + safe.right },
  };
}

export interface PlayableFitOptions extends Omit<FitOptions, 'fill' | 'minZoom' | 'maxZoom'> {
  kind: FitProfile['kind'];
  /** Zoom ceiling relative to the default zoom. */
  maxZoomFactor: number;
}

export interface PlayableFitResult extends FitResult {
  /** Zoom at which the whole island fits (pinch-out limit). */
  minZoom: number;
  maxZoom: number;
}

/**
 * Default framing: the *playable* area (path + buildable tiles) fills the free rect —
 * portrait: ~130% of the free width, landscape: ~115% of the free height (players pan), desktop: both. The whole island
 * (incl. decor) fitting is the pinch-out limit; max zoom is a multiple of the default.
 */
export function computePlayableFit(
  play: ScreenExtents,
  all: ScreenExtents,
  o: PlayableFitOptions,
): PlayableFitResult {
  const { viewportW: W, viewportH: H, insets } = o;
  const freeW = Math.max(40, W - insets.left - insets.right);
  const freeH = Math.max(40, H - insets.top - insets.bottom);
  const ppu1 = H / 2 / o.halfHeight;
  const whole = computeFit(all, { ...o, fill: 0.98, minZoom: 0.05, maxZoom: 6 }).zoom;
  const spanX = Math.max(1e-3, play.maxX - play.minX);
  const spanY = Math.max(1e-3, play.maxY - play.minY);
  let zPlay: number;
  if (o.kind === 'portrait') zPlay = (freeW * 1.3) / (spanX * ppu1);
  else if (o.kind === 'landscape-phone') zPlay = (freeH * 1.15) / (spanY * ppu1);
  else zPlay = Math.min((freeW * 1.0) / (spanX * ppu1), (freeH * 1.0) / (spanY * ppu1));
  const zoom = Math.max(whole, zPlay);
  const placed = computeFit(play, { ...o, fill: 1, minZoom: zoom, maxZoom: zoom });
  return { ...placed, zoom, minZoom: whole, maxZoom: zoom * o.maxZoomFactor };
}
