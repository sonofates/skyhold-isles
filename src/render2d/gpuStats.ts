import type { Application, TextureSource } from 'pixi.js';

/** GPU-side texture residency as Pixi tracks it (QA: `__p0.gpu()`, qa/perfBattle.mjs). */
export interface GpuTextureStats {
  /** Texture sources uploaded to the GPU right now. */
  readonly textures: number;
  /** Estimated bytes of those uploads (RGBA8, +1/3 when mipmapped), in MB. */
  readonly textureMB: number;
  /** The biggest uploads (label or resource url, MB; five unless asked) — names a regression. */
  readonly top: readonly { readonly label: string; readonly mb: number }[];
  /** Canvas backbuffer size in device px and its MB (color only). */
  readonly canvas: readonly [number, number];
  readonly canvasMB: number;
}

function bytesOf(src: TextureSource): number {
  const w = Math.max(1, src.pixelWidth);
  const h = Math.max(1, src.pixelHeight);
  const base = w * h * 4;
  return src.mipLevelCount > 1 || src.autoGenerateMipmaps ? Math.round(base * (4 / 3)) : base;
}

function labelOf(src: TextureSource): string {
  const res = (src as unknown as { resource?: { src?: unknown; currentSrc?: unknown } }).resource;
  const url = typeof res?.currentSrc === 'string' && res.currentSrc ? res.currentSrc : typeof res?.src === 'string' ? res.src : '';
  const name = url ? url.replace(/^.*\/art2d\//, '').replace(/[?#].*$/, '') : '';
  return name || src.label || `${src.pixelWidth}x${src.pixelHeight}`;
}

const MB = 1024 * 1024;
const round = (v: number): number => Math.round(v * 10) / 10;

export function gpuTextureStats(app: Application, topN = 5): GpuTextureStats {
  const sys = (app.renderer as unknown as { texture?: { managedTextures?: readonly TextureSource[] } }).texture;
  // Pixi's managed list keeps null holes for released entries.
  const sources = (sys?.managedTextures ?? []).filter((s): s is TextureSource => !!s);
  let total = 0;
  const sized = sources.map((s) => {
    const b = bytesOf(s);
    total += b;
    return { s, b };
  });
  sized.sort((a, b) => b.b - a.b);
  const canvas = app.canvas as HTMLCanvasElement;
  return {
    textures: sources.length,
    textureMB: round(total / MB),
    top: sized.slice(0, topN).map(({ s, b }) => ({ label: labelOf(s), mb: round(b / MB) })),
    canvas: [canvas.width, canvas.height],
    canvasMB: round((canvas.width * canvas.height * 4) / MB),
  };
}
