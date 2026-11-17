import { describe, expect, it } from 'vitest';
import type { QualityTier } from '../../src/core/types.ts';
import { QualityController } from '../../src/platform/qualityController.ts';
import { effectivePixelRatio, initialTier, TIER_SPECS } from '../../src/render/qualityTiers.ts';

function make(touch: boolean): { c: QualityController; applied: QualityTier[] } {
  const applied: QualityTier[] = [];
  return { c: new QualityController((t) => applied.push(t), () => touch), applied };
}

describe('QualityController', () => {
  it('fixed settings apply directly and ignore frame times', () => {
    const { c, applied } = make(true);
    c.setSetting('high');
    for (let i = 0; i < 3000; i++) c.frame(80);
    expect(applied).toEqual(['high']);
  });

  it('auto starts at medium on touch and high on desktop', () => {
    const t = make(true);
    t.c.setSetting('auto');
    expect(t.applied).toEqual(['medium']);
    const d = make(false);
    d.c.setSetting('auto');
    expect(d.applied).toEqual(['high']);
  });

  it('auto walks down under sustained slow frames', () => {
    const { c, applied } = make(false);
    c.setSetting('auto');
    for (let i = 0; i < 1000; i++) c.frame(30 + (i % 2) * 6);
    expect(applied).toEqual(['high', 'medium', 'low']);
  });

  it('re-applying the same setting keeps what the governor learned', () => {
    const { c, applied } = make(false);
    c.setSetting('auto');
    for (let i = 0; i < 400; i++) c.frame(40);
    const before = applied.length;
    c.setSetting('auto');
    expect(applied.length).toBe(before);
    expect(c.tier).toBe(applied[applied.length - 1]);
  });

  it('switching from auto to a fixed tier stops adapting', () => {
    const { c, applied } = make(true);
    c.setSetting('auto');
    c.setSetting('low');
    for (let i = 0; i < 3000; i++) c.frame(16.7);
    expect(applied).toEqual(['medium', 'low']);
  });
});

describe('tier specs', () => {
  it('desktop high keeps the original look (dpr cap 2, shadows, full composer)', () => {
    expect(TIER_SPECS.high).toMatchObject({ dprCap: 2, shadows: true, composer: 'high', fxScale: 1 });
    expect(effectivePixelRatio('high', 3)).toBe(2);
    expect(effectivePixelRatio('high', 1)).toBe(1);
  });

  it('lower tiers cap the pixel ratio harder and never go below 1', () => {
    expect(effectivePixelRatio('medium', 3)).toBe(1.5);
    expect(effectivePixelRatio('low', 3)).toBe(1);
    expect(effectivePixelRatio('low', 0)).toBe(1);
  });

  it('initialTier passes fixed settings through', () => {
    expect(initialTier('low', false)).toBe('low');
    expect(initialTier('auto', true)).toBe('medium');
  });
});
