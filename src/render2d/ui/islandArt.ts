/**
 * Island vignettes for the world map, briefing and story panels: the island's own painted map
 * (smallest resolution variant), cropped by CSS. Islands without a painted map get null and the
 * UI draws a grass mound instead.
 */
import type { UiArt } from '../manifest.ts';
import { MASTER_SCALE, pickMapVariant } from '../mapVariant.ts';
import { graphicsPrefs, isDesktopClient, renderResolution } from '../renderResolution.ts';
import type { LevelDef } from '../../data/levels/types.ts';

export interface MapsManifest {
  readonly overlays?: Readonly<Record<string, string>>;
  readonly plot?: { readonly file: string } | null;
  readonly ui?: UiArt;
  readonly paintedUi?: Readonly<Record<string, string>>;
  readonly maps: Readonly<Record<string, string>>;
}

/** Smallest bake of the island's map (`<key>@1x` when present), as a URL; null without art. */
export function islandMapUrl(manifest: MapsManifest | null, level: Pick<LevelDef, 'layout2d'>, baseUrl = '/art2d/'): string | null {
  const key = level.layout2d?.image;
  if (!key || !manifest) return null;
  const file = manifest.maps[`${key}@1x`] ?? manifest.maps[key];
  return file ? baseUrl + file : null;
}

const prefetched = new Set<string>();

/** Warm the next document's HTTP cache while its unlocked island briefing is on screen. */
export function prefetchLevelArt(manifest: MapsManifest | null, level: LevelDef): void {
  const layout = level.layout2d;
  if (!manifest || !layout) return;
  const tier = isDesktopClient() ? 'high' : graphicsPrefs().lock ?? 'high';
  const resolution = renderResolution(innerWidth, innerHeight, devicePixelRatio, undefined, tier);
  const need = Math.max(innerWidth / layout.imageSize[0], innerHeight / layout.imageSize[1]) * resolution;
  const key = pickMapVariant(manifest.maps, layout.image, need, MASTER_SCALE);
  const files = [
    key && manifest.maps[key], manifest.plot?.file, ...Object.values(manifest.ui ?? {}),
    ...(layout.gates ?? []).map(g => g.front && manifest.overlays?.[g.front.art]),
  ];
  for (const file of files) {
    if (!file || prefetched.has(file)) continue;
    prefetched.add(file);
    // Consume the response to fill the HTTP cache without decoding a second Pixi texture here.
    void fetch('/art2d/' + file, { priority: 'low' }).then(async response => {
      if (response.ok) await response.blob();
      else prefetched.delete(file);
    }).catch(() => prefetched.delete(file));
  }
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
