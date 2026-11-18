import { describe, expect, it } from 'vitest';
import { AdaptiveQuality, qualityOverride, renderResolution } from '../../src/render2d/renderResolution.ts';

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

describe('adaptive quality', () => {
  it('requires consecutive slow windows and clears pressure across hidden tabs', () => {
    const auto = new AdaptiveQuality(null);
    const frames = (n: number, ms: number) => {
      for (let i = 0; i < n; i++) auto.observe(ms, true);
    };
    frames(40, 25);
    auto.observe(1000, false);
    frames(40, 25);
    expect(auto.tier).toBe('high');
    frames(60, 1000 / 60 + 0.001);
    frames(40, 25);
    expect(auto.tier).toBe('high');
    frames(40, 25);
    expect(auto.tier).toBe('med');
    frames(80, 25);
    expect(auto.tier).toBe('low');
    frames(80, 25);
    expect(auto.resolutionScale).toBe(1);
    frames(50, 40);
    expect(auto.resolutionScale).toBeCloseTo(0.65 / 0.8);
  });

  it('locks explicit tiers and preserves high canvas density', () => {
    const high = new AdaptiveQuality(qualityOverride('high'));
    for (let i = 0; i < 200; i++) high.observe(50, true);
    expect(high.tier).toBe('high');
    expect(qualityOverride('oops')).toBeNull();
    expect(renderResolution(915, 412, 2.6, undefined, 'high')).toBe(2.6);
    expect(renderResolution(915, 412, 2.6, undefined, 'med')).toBe(1.5);
    expect(renderResolution(915, 412, 2.6, undefined, 'low')).toBe(0.8);
  });
});
