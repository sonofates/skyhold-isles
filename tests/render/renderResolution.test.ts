import { describe, expect, it } from 'vitest';
import { renderResolution } from '../../src/render2d/renderResolution.ts';

describe('renderResolution', () => {
  it('phones render at full density', () => {
    expect(renderResolution(915, 412, 2.625)).toBeCloseTo(2.625);
    expect(renderResolution(844, 390, 3)).toBe(3);
  });
  it('desktops stay at 2x', () => {
    expect(renderResolution(1600, 900, 2)).toBe(2);
    expect(renderResolution(2560, 1440, 3)).toBe(2);
  });
  it('low-density screens keep their own density', () => {
    expect(renderResolution(1600, 900, 1)).toBe(1);
    expect(renderResolution(1280, 720, 1.25)).toBe(1.25);
  });
  it('honours a manual override', () => {
    expect(renderResolution(1600, 900, 2, 1)).toBe(1);
  });
});
