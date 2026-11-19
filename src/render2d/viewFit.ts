/**
 * Map fit for the 2D renderer (pure math, no Pixi).
 *
 * Rule: "cover" the screen with the map image, but never crop the safe area. The scale is the
 * cover scale clamped to the largest scale at which the whole safe area is still visible. When the
 * clamp kicks in, the image no longer covers the screen on one axis and the renderer fills the
 * letterbox from the map's own edges (see MapView). The view is centred on the safe area and then
 * clamped so the image covers as much of the screen as it can.
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

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface HudFit extends MapFit {
  /** Scale relative to the plain fit (1 = no shrink). */
  readonly shrink: number;
  /** False only if no scale down to `minShrink` keeps the boxes off the HUD (the best try is returned). */
  readonly clear: boolean;
}

/** Offsets (one axis) that keep the safe area on screen at `scale`, and the plain fit's choice. */
function axisRange(screen: number, image: number, safeStart: number, safeLen: number, scale: number): [number, number, number] {
  const pref = placeAxis(screen, image, safeStart, safeLen, scale);
  const lo = screen - (safeStart + safeLen) * scale;
  const hi = -safeStart * scale;
  return lo <= hi ? [lo, hi, Math.min(hi, Math.max(lo, pref))] : [pref, pref, pref];
}

/**
 * Offset at `scale` where no playfield box (image px) touches a HUD rect (screen px), nearest the
 * plain fit's offset; null when there is none. The free offsets are sampled on a grid (≤ 2 px).
 */
function clearOffset(screenW: number, screenH: number, imageW: number, imageH: number, safe: SafeRect, boxes: readonly Box[], hud: readonly Box[], s: number): { x: number; y: number } | null {
  const [sx, sy, sw, sh] = safe;
  const [xl, xh, px] = axisRange(screenW, imageW, sx, sw, s);
  const [yl, yh, py] = axisRange(screenH, imageH, sy, sh, s);
  const hits = (ox: number, oy: number): boolean => {
    for (const r of hud) {
      for (const b of boxes) {
        if (ox + s * b.x < r.x + r.w && ox + s * (b.x + b.w) > r.x && oy + s * b.y < r.y + r.h && oy + s * (b.y + b.h) > r.y) return true;
      }
    }
    return false;
  };
  if (!hits(px, py)) return { x: px, y: py };
  const nx = xh - xl > 1e-6 ? Math.min(240, Math.ceil((xh - xl) / 2)) + 1 : 1;
  const ny = yh - yl > 1e-6 ? Math.min(240, Math.ceil((yh - yl) / 2)) + 1 : 1;
  const dx = nx > 1 ? (xh - xl) / (nx - 1) : 1;
  const dy = ny > 1 ? (yh - yl) / (ny - 1) : 1;
  const ox = (i: number): number => xl + dx * i;
  const oy = (j: number): number => yl + dy * j;
  /** Sample indices strictly inside the open interval (a, b). */
  const span = (a: number, b: number, lo: number, d: number, n: number): [number, number] => {
    let i0 = Math.max(0, Math.floor((a - lo) / d) + 1);
    let i1 = Math.min(n - 1, Math.ceil((b - lo) / d) - 1);
    // Float edges: re-check the end samples.
    while (i0 <= i1 && lo + d * i0 <= a) i0++;
    while (i1 >= i0 && lo + d * i1 >= b) i1--;
    return [i0, i1];
  };
  const blocked = new Uint8Array(nx * ny);
  // Each (box, rect) pair forbids an open rectangle of offsets: paint it onto the grid.
  for (const r of hud) {
    for (const b of boxes) {
      const [i0, i1] = span(r.x - s * (b.x + b.w), r.x + r.w - s * b.x, xl, dx, nx);
      if (i0 > i1) continue;
      const [j0, j1] = span(r.y - s * (b.y + b.h), r.y + r.h - s * b.y, yl, dy, ny);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) blocked[i * ny + j] = 1;
    }
  }
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      if (blocked[i * ny + j]) continue;
      const d = Math.hypot(ox(i) - px, oy(j) - py);
      if (d < bestD) {
        bestD = d;
        best = { x: ox(i), y: oy(j) };
      }
    }
  }
  return best;
}

function fitAt(screenW: number, screenH: number, imageW: number, imageH: number, scale: number, offsetX: number, offsetY: number): MapFit {
  return {
    scale,
    offsetX,
    offsetY,
    bandLeft: band(offsetX),
    bandRight: band(screenW - (offsetX + imageW * scale)),
    bandTop: band(offsetY),
    bandBottom: band(screenH - (offsetY + imageH * scale)),
  };
}

/**
 * The plain fit (computeMapFit), shrunk and shifted only as much as needed so that no playfield
 * box (roads, plots, caves / castle with the headroom of what stands on them, image px) falls
 * under a HUD rect (screen px). The largest scale wins (1 % steps, then refined); at that scale the
 * offset nearest the plain fit's. Letterbox bands this opens are filled by MapView like any other.
 */
export function fitAroundHud(
  screenW: number,
  screenH: number,
  imageW: number,
  imageH: number,
  safe: SafeRect,
  boxes: readonly Box[],
  hud: readonly Box[],
  minShrink = 0.45,
): HudFit {
  const base = computeMapFit(screenW, screenH, imageW, imageH, safe);
  if (hud.length === 0 || boxes.length === 0) return { ...base, shrink: 1, clear: true };
  const s0 = base.scale;
  const at = (k: number): { x: number; y: number } | null => clearOffset(screenW, screenH, imageW, imageH, safe, boxes, hud, s0 * k);
  const first = at(1);
  if (first) return { ...fitAt(screenW, screenH, imageW, imageH, s0, first.x, first.y), shrink: 1, clear: true };
  let ok = -1;
  let okOff: { x: number; y: number } | null = null;
  for (let k = 0.99; k >= minShrink - 1e-9; k -= 0.01) {
    const o = at(k);
    if (o) {
      ok = k;
      okOff = o;
      break;
    }
  }
  if (ok < 0 || !okOff) {
    const s = s0 * minShrink;
    return { ...fitAt(screenW, screenH, imageW, imageH, s, placeAxis(screenW, imageW, safe[0], safe[2], s), placeAxis(screenH, imageH, safe[1], safe[3], s)), shrink: minShrink, clear: false };
  }
  // Refine between the last blocked step and the first clear one.
  let lo = ok;
  let hi = Math.min(1, ok + 0.01);
  for (let i = 0; i < 5; i++) {
    const mid = (lo + hi) / 2;
    const o = at(mid);
    if (o) {
      lo = mid;
      okOff = o;
    } else hi = mid;
  }
  return { ...fitAt(screenW, screenH, imageW, imageH, s0 * lo, okOff.x, okOff.y), shrink: lo, clear: true };
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
