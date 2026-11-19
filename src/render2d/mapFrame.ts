import { CanvasSource, Texture } from 'pixi.js';

/**
 * The frame around a fitted map: what fills the letterbox bands once the map shrinks to clear the
 * HUD dock (see MapView).
 *
 * - **Backdrop**: the map itself, downsampled, heavily blurred, desaturated and darkened, built
 *   ONCE per map on a small canvas (no per-frame filter) and drawn behind the map scaled up around
 *   the map's centre until it covers the screen. Colours carry on from the map's own edges into the
 *   bands; no streaks, no recognisable mirrored castle / cave.
 * - **Shadow**: a soft dark falloff outside the map's edges (the island board lifted off the table).
 * - **Vignette**: the screen corners darkened a touch more.
 * - **Border**: a thin painted wood moulding hugging the map's edge, outside the image.
 *
 * The pure pixel helpers (box blur, grade) are exported for tests.
 */

/** Width (px) of the backdrop's working canvas: blur and grade run at this size. */
export const BACKDROP_W = 160;
/** Box-blur radius (backdrop px) and passes: three passes ≈ a Gaussian of σ ≈ 5 % of the width. */
export const BACKDROP_BLUR_R = 8;
export const BACKDROP_BLUR_PASSES = 3;
/** Grade: keep this share of the colour (rest goes to grey), then scale the brightness. */
export const BACKDROP_SATURATION = 0.6;
export const BACKDROP_BRIGHTNESS = 0.6;

/**
 * Separable box blur of an RGBA buffer in place (edges clamped), `passes` times per axis. Alpha is
 * left alone (maps are opaque).
 */
export function boxBlurRGBA(data: Uint8ClampedArray, w: number, h: number, r: number, passes: number): void {
  if (r <= 0 || w <= 0 || h <= 0) return;
  const n = Math.max(w, h);
  const line = new Float32Array(n * 3);
  const out = new Float32Array(n * 3);
  const run = (len: number, at: (i: number) => number): void => {
    for (let i = 0; i < len; i++) {
      const o = at(i);
      line[i * 3] = data[o];
      line[i * 3 + 1] = data[o + 1];
      line[i * 3 + 2] = data[o + 2];
    }
    for (let p = 0; p < passes; p++) {
      const span = 2 * r + 1;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += line[Math.min(len - 1, Math.max(0, k)) * 3 + c];
        for (let i = 0; i < len; i++) {
          out[i * 3 + c] = sum / span;
          const add = Math.min(len - 1, i + r + 1);
          const drop = Math.max(0, i - r);
          sum += line[add * 3 + c] - line[drop * 3 + c];
        }
      }
      line.set(out.subarray(0, len * 3));
    }
    for (let i = 0; i < len; i++) {
      const o = at(i);
      data[o] = line[i * 3];
      data[o + 1] = line[i * 3 + 1];
      data[o + 2] = line[i * 3 + 2];
    }
  };
  for (let y = 0; y < h; y++) run(w, (x) => (y * w + x) * 4);
  for (let x = 0; x < w; x++) run(h, (y) => (y * w + x) * 4);
}

/** Desaturates (`saturation` 1 = unchanged, 0 = grey) and scales the brightness of an RGBA buffer. */
export function gradeRGBA(data: Uint8ClampedArray, saturation: number, brightness: number): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    data[i] = (luma + (r - luma) * saturation) * brightness;
    data[i + 1] = (luma + (g - luma) * saturation) * brightness;
    data[i + 2] = (luma + (b - luma) * saturation) * brightness;
  }
}

/** A linear-filtered texture over a canvas (not routed through Pixi's resource cache). */
function canvasTexture(c: HTMLCanvasElement): Texture {
  return new Texture({ source: new CanvasSource({ resource: c, scaleMode: 'linear' }) });
}

function canvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/**
 * The blurred, graded backdrop of a map texture, or null (no DOM, unreadable source). The source
 * is halved step by step down to the working size (a single big downscale aliases in some
 * browsers), then blurred and graded on the CPU — a few hundred µs, once per map.
 */
export function buildBackdropTexture(map: Texture): Texture | null {
  const src = map.source.resource as CanvasImageSource | undefined;
  const sw = map.source.pixelWidth;
  const sh = map.source.pixelHeight;
  if (!src || sw < 2 || sh < 2) return null;
  try {
    let w = sw;
    let h = sh;
    let from: CanvasImageSource = src;
    while (w / 2 >= BACKDROP_W * 2) {
      const c = canvas(w / 2, h / 2);
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(from, 0, 0, w, h, 0, 0, c.width, c.height);
      from = c;
      w = c.width;
      h = c.height;
    }
    const out = canvas(BACKDROP_W, (BACKDROP_W * sh) / sw);
    const ctx = out?.getContext('2d', { willReadFrequently: true });
    if (!out || !ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(from, 0, 0, w, h, 0, 0, out.width, out.height);
    const img = ctx.getImageData(0, 0, out.width, out.height);
    boxBlurRGBA(img.data, out.width, out.height, BACKDROP_BLUR_R, BACKDROP_BLUR_PASSES);
    gradeRGBA(img.data, BACKDROP_SATURATION, BACKDROP_BRIGHTNESS);
    ctx.putImageData(img, 0, 0);
    return canvasTexture(out);
  } catch {
    // tainted / closed bitmap: no backdrop, MapView falls back to a flat dark fill
    return null;
  }
}

/** Shadow falloff length in texels of the edge / corner textures. */
export const SHADOW_TEX = 64;

/**
 * Drop-shadow pieces: `edge` is a 1 × SHADOW_TEX strip, darkest at y = 0 (against the map) fading
 * to clear; `corner` is SHADOW_TEX², darkest at (0, 0). Rotated / flipped per side by MapView.
 */
export function buildShadowTextures(): { edge: Texture; corner: Texture } | null {
  const e = canvas(4, SHADOW_TEX);
  const c = canvas(SHADOW_TEX, SHADOW_TEX);
  const ectx = e?.getContext('2d');
  const cctx = c?.getContext('2d');
  if (!e || !c || !ectx || !cctx) return null;
  const falloff = (t: number): number => (1 - t) * (1 - t) * (1 - t);
  const stops = (g: CanvasGradient): void => {
    for (let i = 0; i <= 8; i++) g.addColorStop(i / 8, `rgba(0,0,0,${falloff(i / 8).toFixed(3)})`);
  };
  const lg = ectx.createLinearGradient(0, 0, 0, SHADOW_TEX);
  stops(lg);
  ectx.fillStyle = lg;
  ectx.fillRect(0, 0, e.width, e.height);
  const rg = cctx.createRadialGradient(0, 0, 0, 0, 0, SHADOW_TEX);
  stops(rg);
  cctx.fillStyle = rg;
  cctx.fillRect(0, 0, SHADOW_TEX, SHADOW_TEX);
  return { edge: canvasTexture(e), corner: canvasTexture(c) };
}

/** Screen vignette: clear in the middle, dark toward the corners (stretched over the screen). */
export function buildVignetteTexture(): Texture | null {
  const size = 256;
  const c = canvas(size, size);
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.32, size / 2, size / 2, size * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvasTexture(c);
}

/** Border width (css px) for a screen: ~8 px at 1080 p, never under 4. */
export function borderWidth(screenW: number, screenH: number): number {
  return Math.max(4, Math.round(Math.min(screenW, screenH) * 0.0072));
}

/** Shadow reach (css px) for a screen. */
export function shadowReach(screenW: number, screenH: number): number {
  return Math.max(14, Math.round(Math.min(screenW, screenH) * 0.045));
}

/**
 * The scale + offset (screen px) that draws a backdrop of `iw × ih` image px around the map fit
 * so it covers the screen (plus `overscan` px each side for camera shake): same centre as the map,
 * never smaller than the map itself.
 */
export function backdropPlacement(
  screenW: number, screenH: number, iw: number, ih: number,
  fit: { scale: number; offsetX: number; offsetY: number }, overscan: number,
): { scale: number; x: number; y: number } {
  const cx = fit.offsetX + (iw * fit.scale) / 2;
  const cy = fit.offsetY + (ih * fit.scale) / 2;
  // Half-extent needed on each axis to reach the farther screen edge from the map's centre.
  const needX = Math.max(cx + overscan, screenW - cx + overscan);
  const needY = Math.max(cy + overscan, screenH - cy + overscan);
  const scale = Math.max(fit.scale, (2 * needX) / iw, (2 * needY) / ih);
  return { scale, x: cx - (iw * scale) / 2, y: cy - (ih * scale) / 2 };
}
