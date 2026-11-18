/**
 * Map resolution variants (pure, no Pixi). A painted map is baked at several sizes; the manifest's
 * `maps` lists them as `<key>` (the master, the largest bake) and `<key>@<scale>x` (texture width =
 * scale x the layout width, e.g. `map-L1c-layered@1x`). The renderer loads the smallest variant
 * that still has at least one texel per device pixel at the current fit, so the GPU never has to
 * minify much (no mip blur, no shimmer, less memory on phones) and never has to magnify a smaller
 * bake on a big / high-DPI screen. The map texture is drawn without mipmaps.
 */
export interface MapVariant {
  readonly key: string;
  /** Texels per layout px; null for the master (unknown, treated as the largest). */
  readonly scale: number | null;
}

const VARIANT = /^(.*)@(\d+(?:\.\d+)?)x$/;

/** All bakes of `key` in the manifest's maps, smallest first, the master last. */
export function mapVariants(maps: Readonly<Record<string, string>>, key: string): MapVariant[] {
  const out: MapVariant[] = [];
  for (const k of Object.keys(maps)) {
    const m = VARIANT.exec(k);
    if (m && m[1] === key) out.push({ key: k, scale: Number(m[2]) });
  }
  out.sort((a, b) => (a.scale ?? 0) - (b.scale ?? 0));
  if (maps[key] !== undefined) out.push({ key, scale: null });
  return out;
}

/** Up to this much magnification of a variant is accepted before a bigger one is picked. */
export const VARIANT_SLACK = 1.02;

/**
 * The variant to load for `need` device px per layout px (fit scale x renderer resolution): the
 * smallest whose scale covers it, else the master (or the largest variant when there is no master).
 */
export function pickMapVariant(maps: Readonly<Record<string, string>>, key: string, need: number): string | null {
  const vs = mapVariants(maps, key);
  if (vs.length === 0) return null;
  for (const v of vs) {
    if (v.scale !== null && v.scale * VARIANT_SLACK >= need) return v.key;
  }
  return vs[vs.length - 1].key;
}

/** Texels per layout px of a loaded map texture. */
export function texelsPerLayoutPx(textureWidth: number, imageWidth: number): number {
  return imageWidth > 0 ? textureWidth / imageWidth : 1;
}
