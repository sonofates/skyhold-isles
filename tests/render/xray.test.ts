import { describe, expect, it } from 'vitest';
import { occludes, rectsOverlap, shrinkRect } from '../../src/render/xray.ts';

const tile = { minX: 100, maxX: 160, minY: 100, maxY: 150 };

describe('xray', () => {
  it('overlap test', () => {
    expect(rectsOverlap(tile, { minX: 150, maxX: 200, minY: 120, maxY: 220 })).toBe(true);
    expect(rectsOverlap(tile, { minX: 170, maxX: 200, minY: 120, maxY: 220 })).toBe(false);
  });

  it('fades only occluders that are nearer to the camera than the tile', () => {
    const tower = { minX: 120, maxX: 170, minY: 60, maxY: 160 };
    expect(occludes(tower, 4, tile, 6)).toBe(true);
    expect(occludes(tower, 8, tile, 6)).toBe(false); // behind the tile
    expect(occludes(tower, 5.9, tile, 6)).toBe(false); // same depth: neighbour, not occluder
  });

  it('shrinkRect keeps the middle', () => {
    const r = shrinkRect(tile, 0.25);
    expect(r).toEqual({ minX: 115, maxX: 145, minY: 112.5, maxY: 137.5 });
  });
});
