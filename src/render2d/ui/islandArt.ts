/**
 * Island vignettes for the world map, briefing and story panels: the island's own painted map
 * (smallest resolution variant), cropped by CSS. Islands without a painted map get null and the
 * UI draws a grass mound instead.
 */
import type { LevelDef } from '../../data/levels/types.ts';

export interface MapsManifest {
  readonly maps: Readonly<Record<string, string>>;
}

/** Smallest bake of the island's map (`<key>@1x` when present), as a URL; null without art. */
export function islandMapUrl(manifest: MapsManifest | null, level: Pick<LevelDef, 'layout2d'>, baseUrl = '/art2d/'): string | null {
  const key = level.layout2d?.image;
  if (!key || !manifest) return null;
  const file = manifest.maps[`${key}@1x`] ?? manifest.maps[key];
  return file ? baseUrl + file : null;
}

let cached: Promise<MapsManifest | null> | null = null;

/** The art manifest (maps only are needed here); null when it cannot be fetched. */
export function fetchMapsManifest(url = '/art2d/manifest.json'): Promise<MapsManifest | null> {
  cached ??= fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<MapsManifest>) : null))
    .catch(() => null);
  return cached;
}

/**
 * CSS background for a vignette of the map centred on `focus` (fractions of the image), zoomed so
 * the panel shows about `zoom` of the map's height.
 */
export function vignetteStyle(imageSize: readonly [number, number], focus: readonly [number, number], boxW: number, boxH: number, zoom = 0.62): { size: string; position: string } {
  const [iw, ih] = imageSize;
  // Scale so the box covers `zoom` of the map height, but never leaves gaps.
  const scale = Math.max(boxH / (ih * zoom), boxW / iw, boxH / ih);
  const w = iw * scale;
  const h = ih * scale;
  const x = Math.max(boxW - w, Math.min(0, boxW / 2 - focus[0] * w));
  const y = Math.max(boxH - h, Math.min(0, boxH / 2 - focus[1] * h));
  return { size: `${w.toFixed(0)}px ${h.toFixed(0)}px`, position: `${x.toFixed(0)}px ${y.toFixed(0)}px` };
}
