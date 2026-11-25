import { describe, expect, it } from 'vitest';
import { activeLifeCells, lifeCellGeometry, type MaskPixels } from '../../src/render2d/mapLifeLayer.ts';

/** RGBA mask with the given texels set (R = value). */
function mask(w: number, h: number, set: readonly [number, number, number][]): MaskPixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (const [x, y, v] of set) data[(y * w + x) * 4] = v;
  return { data, width: w, height: h };
}

/** WebGL-style bilinear sample (texel centres at (i + 0.5) / w, clamp to edge). */
function bilinear(m: MaskPixels, u: number, v: number): number {
  const fx = u * m.width - 0.5;
  const fy = v * m.height - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x: number, y: number): number => {
    const cx = Math.min(m.width - 1, Math.max(0, x));
    const cy = Math.min(m.height - 1, Math.max(0, y));
    return m.data[(cy * m.width + cx) * 4] / 255;
  };
  return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
}

describe('map-life surface cells', () => {
  it('marks only the cells a texel can reach', () => {
    const cells = activeLifeCells([mask(64, 32, [[36, 20, 200]])], 8, 4);
    const on = [...cells].map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
    // Texel 36,20 → cell (4, 2); its 2-texel margin stays inside that cell.
    expect(on).toEqual([2 * 8 + 4]);
    // Near a cell edge the margin reaches the neighbours.
    const edge = activeLifeCells([mask(64, 32, [[33, 17, 1]])], 8, 4);
    expect([...edge].map((c, i) => (c ? i : -1)).filter((i) => i >= 0)).toEqual([11, 12, 19, 20]);
    expect([...activeLifeCells([mask(64, 32, [])], 8, 4)].every((c) => c === 0)).toBe(true);
  });

  it('is conservative: every point a shader could sample above zero lies in an active cell', () => {
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let trial = 0; trial < 6; trial++) {
      const w = 40 + Math.floor(rnd() * 50);
      const h = 20 + Math.floor(rnd() * 30);
      const set: [number, number, number][] = [];
      for (let k = 0; k < 6; k++) set.push([Math.floor(rnd() * w), Math.floor(rnd() * h), 1 + Math.floor(rnd() * 254)]);
      const m = mask(w, h, set);
      const cols = 12;
      const rows = 5;
      const cells = activeLifeCells([m], cols, rows);
      for (let sy = 0; sy < h * 6; sy++) {
        for (let sx = 0; sx < w * 6; sx++) {
          const u = (sx + 0.5) / (w * 6);
          const v = (sy + 0.5) / (h * 6);
          if (bilinear(m, u, v) <= 0) continue;
          const cell = Math.min(rows - 1, Math.floor(v * rows)) * cols + Math.min(cols - 1, Math.floor(u * cols));
          expect(cells[cell], `trial ${trial} uv ${u.toFixed(3)},${v.toFixed(3)}`).toBe(1);
        }
      }
    }
  });

  it('builds a crack-free mesh on the full quad map; null when every cell is active', () => {
    const active = new Uint8Array([1, 0, 0, 1, 1, 0]);
    const geo = lifeCellGeometry(active, 3, 2, 300, 100)!;
    expect(geo.indices.length).toBe(3 * 6);
    for (let i = 0; i < geo.positions.length; i += 2) {
      expect(geo.positions[i]).toBeCloseTo(geo.uvs[i] * 300, 4);
      expect(geo.positions[i + 1]).toBeCloseTo(geo.uvs[i + 1] * 100, 4);
    }
    // Neighbouring cells share vertex indices (no duplicated edges).
    expect(new Set(geo.indices).size).toBeLessThan(geo.indices.length);
    expect(lifeCellGeometry(new Uint8Array([1, 1, 1, 1]), 2, 2, 10, 10)).toBeNull();
  });
});
