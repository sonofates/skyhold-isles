import { describe, expect, it } from 'vitest';
import {
  AdaptiveQuality,
  detectSoftwareWebGL,
  isSoftwareRenderer,
  qualityOverride,
  renderResolution,
} from '../../src/render2d/renderResolution.ts';

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

  it('detects software WebGL renderers and calibrates boot resolution before wave start', () => {
    const fakeGl = (unmasked: string, renderer = 'WebKit WebGL') =>
      ({
        RENDERER: 0x1f01,
        getExtension: (name: string) =>
          name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null,
        getParameter: (p: number) => (p === 0x9246 ? unmasked : renderer),
      }) as unknown as WebGL2RenderingContext;

    expect(isSoftwareRenderer(null)).toBe(false);
    expect(isSoftwareRenderer(fakeGl('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), Google SwiftShader)'))).toBe(true);
    expect(isSoftwareRenderer(fakeGl('Mesa OffScreen (llvmpipe (LLVM 17.0.6, 256 bits))'))).toBe(true);
    expect(isSoftwareRenderer(fakeGl('ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)'))).toBe(false);
    expect(isSoftwareRenderer(fakeGl('Mali-G78 MP14'))).toBe(false);

    // Hardware fast render keeps high.
    const hw = new AdaptiveQuality(null);
    expect(hw.calibrateBoot(4.2, false)).toBe(false);
    expect(hw.tier).toBe('high');

    // Software slow boot render drops straight to low + 0.8125 scale in one pass.
    const sw = new AdaptiveQuality(null);
    expect(sw.calibrateBoot(120, true)).toBe(true);
    expect(sw.tier).toBe('low');
    expect(sw.resolutionScale).toBeCloseTo(0.65 / 0.8);

    // Locked quality never steps down during boot calibration.
    const lockedHigh = new AdaptiveQuality('high');
    expect(lockedHigh.calibrateBoot(250, true)).toBe(false);
    expect(lockedHigh.tier).toBe('high');

    // Software unlocked low boot steps to 0.65/0.8 when active-wave frame exceeds 14.5 ms,
    // while calm pre-first-wave scenes tolerate up to 28 ms at high.
    const swLow = new AdaptiveQuality(null, 'low');
    expect(swLow.tier).toBe('low');
    expect(swLow.isLocked).toBe(false);
    expect(swLow.calibrateBoot(11, true, true)).toBe(false);
    expect(swLow.resolutionScale).toBe(1);
    expect(swLow.calibrateBoot(18, true, true)).toBe(true);
    expect(swLow.resolutionScale).toBeCloseTo(0.65 / 0.8);

    const swCalm = new AdaptiveQuality(null, 'high');
    expect(swCalm.calibrateBoot(20, true, false)).toBe(false);
    expect(swCalm.tier).toBe('high');

    expect(detectSoftwareWebGL()).toBe(false);
  });

  it('fast-drops straight to low on two consecutive severe stalls (> 85 ms)', () => {
    const auto = new AdaptiveQuality(null);
    // Single spike followed by normal frame does not trigger emergency drop.
    expect(auto.observe(120, true)).toBe(false);
    expect(auto.observe(16.7, true)).toBe(false);
    expect(auto.tier).toBe('high');

    // Two consecutive severe stalls jump directly to low without waiting 4+ seconds.
    expect(auto.observe(140, true)).toBe(false);
    expect(auto.observe(130, true)).toBe(true);
    expect(auto.tier).toBe('low');
  });
});
