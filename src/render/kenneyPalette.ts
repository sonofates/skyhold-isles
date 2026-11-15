import * as THREE from 'three';
import { PALETTE_HEX } from '../data/palette.ts';

interface SwatchTint {
  cx: number;
  cy: number;
  lightHex: number;
  darkHex: number;
  mix: number;
}

export const WHITE_SWATCH_UV: readonly [number, number] = [7.5 / 8, 0.5 / 4];

/**
 * Target palette shifts per 8x4 Kenney colormap cell (origin top-left, flipY=false).
 * Preserves Kenney gradient contrast while aligning grass, sandstone, coral, indigo, and stone
 * to Skyhold Isles' palette in src/data/palette.ts.
 */
const SWATCH_TINTS: readonly SwatchTint[] = [
  // (3, 2): Grass & tree foliage -> sunny spring grass + crisp emerald shadow gradient
  { cx: 3, cy: 2, lightHex: 0x72cf4b, darkHex: 0x3b8e3e, mix: 0.46 },
  // (7, 3): Road dirt & timber -> warm sandstone & cocoa earth
  { cx: 7, cy: 3, lightHex: PALETTE_HEX.sand, darkHex: PALETTE_HEX.dirt, mix: 0.52 },
  // (1, 2): Tan wood / catapult frame -> soft sand-tan
  { cx: 1, cy: 2, lightHex: PALETTE_HEX.sand, darkHex: 0xc29368, mix: 0.34 },
  // (6, 2): Roof red -> Skyhold coral
  { cx: 6, cy: 2, lightHex: PALETTE_HEX.coral, darkHex: 0xc64444, mix: 0.48 },
  // (1, 1): Purple square-tower accent -> Skyhold slate indigo
  { cx: 1, cy: 1, lightHex: 0x67639f, darkHex: PALETTE_HEX.indigo, mix: 0.58 },
  // (5, 3): Light masonry stone -> cool stone highlights
  { cx: 5, cy: 3, lightHex: 0xb2bac8, darkHex: PALETTE_HEX.stone, mix: 0.25 },
  // (3, 3): Mid masonry stone
  { cx: 3, cy: 3, lightHex: PALETTE_HEX.stone, darkHex: 0x636b7c, mix: 0.28 },
];

function blendChannel(src: number, target: number, t: number): number {
  return Math.max(0, Math.min(255, Math.round(src + (target - src) * t)));
}

/**
 * Creates a palette-harmonized GPU texture from Kenney's raw Textures/colormap.png.
 */
export function createHarmonizedColormapTexture(
  source: HTMLImageElement | HTMLCanvasElement,
): THREE.CanvasTexture {
  const width = source.width || 512;
  const height = source.height || 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create 2D canvas context for Kenney colormap recoloring');
  }
  ctx.drawImage(source, 0, 0, width, height);

  const cellW = Math.floor(width / 8);
  const cellH = Math.floor(height / 4);
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  for (let i = 0; i < SWATCH_TINTS.length; i++) {
    const sw = SWATCH_TINTS[i];
    const x0 = sw.cx * cellW;
    const y0 = sw.cy * cellH;
    const lr = (sw.lightHex >> 16) & 0xff;
    const lg = (sw.lightHex >> 8) & 0xff;
    const lb = sw.lightHex & 0xff;
    const dr = (sw.darkHex >> 16) & 0xff;
    const dg = (sw.darkHex >> 8) & 0xff;
    const db = sw.darkHex & 0xff;

    for (let y = y0; y < y0 + cellH; y++) {
      // Preserve vertical gradient brightness top-to-bottom within each cell
      const vFrac = (y - y0) / Math.max(1, cellH - 1);
      const tr = lr + (dr - lr) * vFrac;
      const tg = lg + (dg - lg) * vFrac;
      const tb = lb + (db - lb) * vFrac;

      for (let x = x0; x < x0 + cellW; x++) {
        const idx = (y * width + x) * 4;
        // Slight darkening bias in right sub-column of Kenney swatches
        const colBias = x - x0 >= cellW * 0.5 ? 0.92 : 1.02;
        data[idx] = blendChannel(data[idx], tr * colBias, sw.mix);
        data[idx + 1] = blendChannel(data[idx + 1], tg * colBias, sw.mix);
        data[idx + 2] = blendChannel(data[idx + 2], tb * colBias, sw.mix);
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  // Reserve unused top-right swatch cell (7, 0) as solid pure white so procedural accents
  // merged into Kenney geometries evaluate strictly from vertex colors.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(7 * cellW, 0, cellW, cellH);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  // LinearFilter without mipmaps eliminates 8x4 swatch bleed across cell boundaries
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Remaps all UVs falling inside Kenney cell (fromCx, fromCy) into (toCx, toCy)
 * while keeping local within-cell gradient offset intact.
 */
export function remapUvCell(
  geometry: THREE.BufferGeometry,
  fromCell: readonly [number, number],
  toCell: readonly [number, number],
): THREE.BufferGeometry {
  const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uvAttr) return geometry;
  const du = (toCell[0] - fromCell[0]) / 8;
  const dv = (toCell[1] - fromCell[1]) / 4;
  for (let i = 0; i < uvAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    const cx = Math.min(7, Math.max(0, Math.floor(u * 8)));
    const cy = Math.min(3, Math.max(0, Math.floor(v * 4)));
    if (cx === fromCell[0] && cy === fromCell[1]) {
      uvAttr.setXY(i, u + du, v + dv);
    }
  }
  uvAttr.needsUpdate = true;
  return geometry;
}

/**
 * Multiplies vertex colors on a geometry (optionally restricted to one Kenney UV cell).
 */
export function multiplyVertexTint(
  geometry: THREE.BufferGeometry,
  colorHex: number,
  onlyCell?: readonly [number, number],
): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position');
  let col = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!col) {
    const buf = new Float32Array(pos.count * 3);
    buf.fill(1);
    col = new THREE.BufferAttribute(buf, 3);
    geometry.setAttribute('color', col);
  }
  const uv = onlyCell ? (geometry.getAttribute('uv') as THREE.BufferAttribute | undefined) : undefined;
  const c = new THREE.Color(colorHex);
  for (let i = 0; i < pos.count; i++) {
    if (onlyCell && uv) {
      const cx = Math.min(7, Math.max(0, Math.floor(uv.getX(i) * 8)));
      const cy = Math.min(3, Math.max(0, Math.floor(uv.getY(i) * 4)));
      if (cx !== onlyCell[0] || cy !== onlyCell[1]) continue;
    }
    col.setXYZ(i, col.getX(i) * c.r, col.getY(i) * c.g, col.getZ(i) * c.b);
  }
  col.needsUpdate = true;
  return geometry;
}
