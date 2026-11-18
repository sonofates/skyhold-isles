/** Map and gate front tiers are expressed in texels per layout pixel. */
export const MASTER_SCALE = 2;

export interface MapVariant {
  readonly key: string;
  /** Texels per layout px; the unqualified map key denotes the 2x master. */
  readonly scale: number;
}

const VARIANT = /^(.*)@(\d+(?:\.\d+)?)x$/;

/** All bakes of `key` in the manifest's maps, smallest first. */
export function mapVariants(maps: Readonly<Record<string, string>>, key: string): MapVariant[] {
  const out: MapVariant[] = [];
  for (const k of Object.keys(maps)) {
    const m = VARIANT.exec(k);
    if (m && m[1] === key) out.push({ key: k, scale: Number(m[2]) });
  }
  if (maps[key] !== undefined) out.push({ key, scale: MASTER_SCALE });
  return out.sort((a, b) => a.scale - b.scale);
}

/** Small bakes tolerate a 2% fit overshoot. The desktop upgrade starts strictly above 2x. */
const VARIANT_SLACK = 1.02;

/**
 * The variant to load for `need` device px per layout px (fit scale x renderer resolution): the
 * smallest eligible tier that covers it, or the largest eligible tier at very high resolutions.
 */
export function pickMapVariant(maps: Readonly<Record<string, string>>, key: string, need: number, maxScale = Infinity): string | null {
  const vs = mapVariants(maps, key).filter((v) => v.scale <= maxScale);
  if (vs.length === 0) return null;
  for (const v of vs) {
    const coverage = v.scale < MASTER_SCALE ? v.scale * VARIANT_SLACK : v.scale;
    if (coverage >= need) return v.key;
  }
  return vs[vs.length - 1].key;
}

/** A touch client stays within the old tier range even with a large viewport or a DPR override. */
export function maxMapScale(desktop: boolean, maxTextureSize: number, imageSize: readonly number[]): number {
  return Math.min(desktop ? Infinity : MASTER_SCALE, maxTextureSize / Math.max(...imageSize));
}

/** Texels per layout px of a loaded map texture. */
export function texelsPerLayoutPx(textureWidth: number, imageWidth: number): number {
  return imageWidth > 0 ? textureWidth / imageWidth : 1;
}
