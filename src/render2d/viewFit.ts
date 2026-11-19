/**
 * Map fit for the 2D renderer (pure math, no Pixi).
 *
 * The plain fit (no HUD: debug / A-B scenes, and a MapView before its first placed fit): "cover"
 * the screen with the map image, but never crop the safe area. The scale is the cover scale
 * clamped to the largest scale at which the whole safe area is still visible; the view is centred
 * on the safe area and clamped so the image covers as much of the screen as it can. The game's
 * fit is the full-bleed one around the corner HUD (fullBleed.ts).
 */
export interface MapFit {
  /** Image px → screen px. */
  readonly scale: number;
  /** Screen position of image px (0, 0). */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Uncovered screen bands (screen px) on each side; 0 when the image reaches the edge. */
  readonly bandLeft: number;
  readonly bandRight: number;
  readonly bandTop: number;
  readonly bandBottom: number;
}

/** Cover may crop this little (fraction) into the safe area before the clamp kicks in. */
const SAFE_TOLERANCE = 1.005;

export type SafeRect = readonly [number, number, number, number];

function placeAxis(screen: number, image: number, safeStart: number, safeLen: number, scale: number): number {
  const scaledImage = image * scale;
  if (scaledImage <= screen) return (screen - scaledImage) / 2;
  // Centre on the safe area, keep the image covering the screen, keep the safe area visible.
  let off = screen / 2 - (safeStart + safeLen / 2) * scale;
  off = Math.min(0, Math.max(screen - scaledImage, off));
  const lo = screen - (safeStart + safeLen) * scale;
  const hi = -safeStart * scale;
  if (lo <= hi) off = Math.min(hi, Math.max(lo, off));
  return off;
}

function band(v: number): number {
  return v > 1e-6 ? v : 0;
}

export function computeMapFit(
  screenW: number,
  screenH: number,
  imageW: number,
  imageH: number,
  safe: SafeRect,
): MapFit {
  const [sx, sy, sw, sh] = safe;
  const cover = Math.max(screenW / imageW, screenH / imageH);
  const safeContain = Math.min(screenW / sw, screenH / sh);
  // A sub-0.5% overshoot (rounded safe-area sizes) would only open a hairline band: allow it.
  const scale = cover <= safeContain * SAFE_TOLERANCE ? cover : safeContain;
  const offsetX = placeAxis(screenW, imageW, sx, sw, scale);
  const offsetY = placeAxis(screenH, imageH, sy, sh, scale);
  const right = offsetX + imageW * scale;
  const bottom = offsetY + imageH * scale;
  return {
    scale,
    offsetX,
    offsetY,
    bandLeft: band(offsetX),
    bandRight: band(screenW - right),
    bandTop: band(offsetY),
    bandBottom: band(screenH - bottom),
  };
}
