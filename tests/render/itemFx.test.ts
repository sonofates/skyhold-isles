import { describe, expect, it } from 'vitest';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { arcPoint, flyCount, itemOnMap, tierDensity } from '../../src/render2d/itemFx.ts';

describe('item FX helpers', () => {
  it('itemOnMap matches the sim rule: inside the painting only', () => {
    const L = LEVELS_2D[0].layout2d!;
    const hx = L.imageSize[0] / (2 * L.pxPerUnit);
    const hz = L.imageSize[1] / (2 * L.pxPerUnit);
    expect(itemOnMap(L, 0, 0)).toBe(true);
    expect(itemOnMap(L, hx, hz)).toBe(true);
    expect(itemOnMap(L, hx + 0.01, 0)).toBe(false);
    expect(itemOnMap(L, 0, -hz - 0.01)).toBe(false);
    expect(itemOnMap(L, NaN, 0)).toBe(false);
  });

  it('flyCount thins with the effects density, keeps at least two, and is zero under Reduced motion', () => {
    expect(flyCount(5, 1, false)).toBe(5);
    expect(flyCount(8, tierDensity('low', 1), false)).toBeLessThan(flyCount(8, tierDensity('high', 1), false));
    expect(flyCount(8, 0, false)).toBe(2);
    expect(flyCount(8, 2, false)).toBe(8);
    expect(flyCount(5, 1, true)).toBe(0);
  });

  it('tierDensity orders the quality tiers and follows the Settings multiplier', () => {
    expect(tierDensity('high', 1)).toBe(1);
    expect(tierDensity('med', 1)).toBeLessThan(1);
    expect(tierDensity('low', 1)).toBeLessThan(tierDensity('med', 1));
    expect(tierDensity('high', 0.5)).toBe(0.5);
  });

  it('arcPoint starts and ends on its points and bulges upward in between', () => {
    const a = { x: 0, y: 100 };
    const b = { x: 200, y: 20 };
    expect(arcPoint(a, b, 50, 0)).toEqual(a);
    expect(arcPoint(a, b, 50, 1)).toEqual(b);
    expect(arcPoint(a, b, 50, 0.5).y).toBeLessThan(Math.min(a.y, b.y));
    expect(arcPoint(a, b, 50, 2)).toEqual(b);
  });
});
