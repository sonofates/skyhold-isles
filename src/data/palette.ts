/**
 * Central 10-color palette used consistently across 3D materials, sky, fog, and UI.
 * Pure TypeScript with zero Three.js or DOM imports.
 */
export const PALETTE = {
  grass: '#7ec850',
  foliageDark: '#4d9440',
  dirt: '#9c6b49',
  stone: '#8b95a5',
  sand: '#e6cfa3',
  water: '#4fb3d9',
  cream: '#f8f4e8',
  gold: '#f6bd41',
  coral: '#e85d5d',
  indigo: '#484573',
} as const;

export type PaletteKey = keyof typeof PALETTE;

export const PALETTE_HEX: Record<PaletteKey, number> = {
  grass: 0x7ec850,
  foliageDark: 0x4d9440,
  dirt: 0x9c6b49,
  stone: 0x8b95a5,
  sand: 0xe6cfa3,
  water: 0x4fb3d9,
  cream: 0xf8f4e8,
  gold: 0xf6bd41,
  coral: 0xe85d5d,
  indigo: 0x484573,
};

export function lerpHexColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;

  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/**
 * Harmonious sky and frost hues derived strictly by blending central palette colors.
 */
export const SKY_HORIZON_HEX = lerpHexColor(PALETTE_HEX.water, PALETTE_HEX.cream, 0.76);
export const SKY_ZENITH_HEX = lerpHexColor(PALETTE_HEX.water, PALETTE_HEX.cream, 0.18);
export const FROST_TINT_HEX = lerpHexColor(PALETTE_HEX.water, PALETTE_HEX.cream, 0.55);
