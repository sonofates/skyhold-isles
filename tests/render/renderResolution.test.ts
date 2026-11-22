import { afterEach, describe, expect, it } from 'vitest';
import {
  AdaptiveQuality,
  DESKTOP_EMERGENCY_SCALE,
  detectSoftwareWebGL,
  isDesktopClient,
  isSoftwareRenderer,
  MOBILE_BOOT_GRACE_MS,
  MOBILE_LOW_SCALE,
  MOBILE_MAX_UP_STEPS,
  MOBILE_MAX_WARMUP_MS,
  MOBILE_RESUME_GRACE_MS,
  MOBILE_SCALE_UP_WINDOWS,
  MOBILE_SETTLE_GRACE_MS,
  MOBILE_TIER_UP_WINDOWS,
  NEUTRAL_GRAPHICS_PREFS,
  qualityOverride,
  renderResolution,
  setGraphicsPrefs,
} from '../../src/render2d/renderResolution.ts';

afterEach(() => {
  setGraphicsPrefs(NEUTRAL_GRAPHICS_PREFS);
});

/** Runs `totalMs` of steady frames of `frameMs` each through an AdaptiveQuality governor. */
function runFor(auto: AdaptiveQuality, totalMs: number, frameMs = 1000 / 60): void {
  const count = Math.ceil(totalMs / frameMs);
  for (let i = 0; i < count; i++) auto.observe(frameMs, true);
}

/** Runs `windows` complete 1 s observation windows of `frameMs` each (skipping any active grace). */
function runWindows(auto: AdaptiveQuality, windows: number, frameMs: number): void {
  let elapsed = 0;
  let done = 0;
  for (let i = 0; i < 100_000 && done < windows; i++) {
    const wasInGrace = auto.inGrace;
    auto.observe(frameMs, true);
    if (wasInGrace) {
      elapsed = 0;
      continue;
    }
    elapsed += Math.min(frameMs, 250);
    if (elapsed >= 1000) {
      elapsed = 0;
      done++;
    }
  }
  expect(done).toBe(windows);
}

/** Advances frame-by-frame until any active mobile grace window ends (without spilling into the next window). */
function passGrace(auto: AdaptiveQuality, frameMs = 1000 / 60): void {
  for (let i = 0; i < 2000 && auto.inGrace; i++) auto.observe(frameMs, true);
  expect(auto.inGrace).toBe(false);
}

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
    passGrace(auto);
    frames(40, 25);
    auto.observe(1000, false);
    passGrace(auto);
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
    expect(auto.resolutionScale).toBeCloseTo(MOBILE_LOW_SCALE);
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

  it('desktop keeps full canvas resolution while the tier only trims effects', () => {
    const auto = new AdaptiveQuality(null, 'high', true);
    const frames = (n: number, ms: number) => {
      for (let i = 0; i < n; i++) auto.observe(ms, true);
    };
    expect(auto.isDesktop).toBe(true);
    // Slow boot frames and severe stalls lower the effects tier, never the resolution.
    expect(auto.calibrateBoot(120, true)).toBe(true);
    expect(auto.tier).toBe('low');
    expect(auto.resolutionTier).toBe('high');
    expect(auto.resolutionScale).toBe(1);
    expect(auto.observe(140, true)).toBe(false);
    expect(auto.observe(130, true)).toBe(false);
    expect(auto.resolutionScale).toBe(1);
    // 25 fps for many seconds: still full resolution.
    frames(25 * 10, 40);
    expect(auto.resolutionScale).toBe(1);
    // Under 20 fps for three seconds: still full; the fourth second triggers the emergency scale.
    frames(16 * 3, 1000 / 16);
    expect(auto.resolutionScale).toBe(1);
    frames(16, 1000 / 16);
    expect(auto.resolutionScale).toBe(DESKTOP_EMERGENCY_SCALE);
    // ...and it recovers after five good seconds.
    frames(50 * 4, 20);
    expect(auto.resolutionScale).toBe(DESKTOP_EMERGENCY_SCALE);
    frames(50, 20);
    expect(auto.resolutionScale).toBe(1);
    // Smooth 60 fps for ten seconds climbs the effects tier back up a step.
    frames(60 * 10, 1000 / 60);
    expect(auto.tier).toBe('med');
    expect(renderResolution(1920, 1080, 1, undefined, auto.resolutionTier)).toBe(1);
  });

  it('desktop emergency drops stop recovering after two cycles', () => {
    const auto = new AdaptiveQuality(null, 'low', true);
    const frames = (n: number, ms: number) => {
      for (let i = 0; i < n; i++) auto.observe(ms, true);
    };
    for (let cycle = 0; cycle < 2; cycle++) {
      frames(16 * 4, 1000 / 16);
      expect(auto.resolutionScale).toBe(DESKTOP_EMERGENCY_SCALE);
      frames(50 * 5, 20);
      expect(auto.resolutionScale).toBe(cycle === 0 ? 1 : DESKTOP_EMERGENCY_SCALE);
    }
    // A locked desktop tier is honoured as-is (QA overrides).
    const locked = new AdaptiveQuality('med', 'high', true);
    expect(locked.resolutionTier).toBe('med');
  });

  it('detects desktop clients from the query override', () => {
    expect(isDesktopClient(new URLSearchParams('desktop=1'))).toBe(true);
    expect(isDesktopClient(new URLSearchParams('desktop=0'))).toBe(false);
  });

  it('fast-drops straight to low on two consecutive severe stalls (> 85 ms) after grace', () => {
    const auto = new AdaptiveQuality(null);
    passGrace(auto);
    // Single spike followed by normal frame does not trigger emergency drop.
    expect(auto.observe(120, true)).toBe(false);
    expect(auto.observe(16.7, true)).toBe(false);
    expect(auto.tier).toBe('high');

    // Two consecutive severe stalls jump directly to low without waiting 4+ seconds.
    expect(auto.observe(140, true)).toBe(false);
    expect(auto.observe(130, true)).toBe(true);
    expect(auto.tier).toBe('low');
  });

  it('mobile boot grace ignores boot stalls and upload hitches', () => {
    const auto = new AdaptiveQuality(null);
    expect(auto.inGrace).toBe(true);
    // Back-to-back severe boot stalls (e.g. texture + video uploads, shader compiles) are ignored.
    expect(auto.observe(140, true)).toBe(false);
    expect(auto.observe(130, true)).toBe(false);
    expect(auto.observe(220, true)).toBe(false);
    expect(auto.tier).toBe('high');
    // Sustained slow frames inside the boot grace window do not drop the tier either.
    runFor(auto, 3000, 30);
    expect(auto.tier).toBe('high');
    expect(auto.inGrace).toBe(true);
  });

  it('mobile grace covers resume, tab-visible, resize, level start, and async texture warmup', () => {
    const auto = new AdaptiveQuality(null);
    passGrace(auto);
    expect(auto.inGrace).toBe(false);

    // Tab hidden → visible arms resume grace so wake stalls are ignored.
    auto.observe(16, false);
    expect(auto.inGrace).toBe(true);
    expect(auto.observe(150, true)).toBe(false);
    expect(auto.observe(150, true)).toBe(false);
    expect(auto.tier).toBe('high');

    // Explicit resize / resume grace ignores reallocation hitches.
    passGrace(auto);
    expect(auto.inGrace).toBe(false);
    auto.beginGrace(MOBILE_RESUME_GRACE_MS);
    expect(auto.observe(140, true)).toBe(false);
    expect(auto.observe(140, true)).toBe(false);
    expect(auto.tier).toBe('high');

    // Async texture warmup holds grace past boot grace until onResident, with a hard safety cap.
    const warming = new AdaptiveQuality(null);
    warming.setWarmupPending(true);
    runFor(warming, MOBILE_BOOT_GRACE_MS + 1000, 1000 / 60);
    expect(warming.inGrace).toBe(true);
    expect(warming.observe(140, true)).toBe(false);
    expect(warming.observe(140, true)).toBe(false);
    expect(warming.tier).toBe('high');
    warming.setWarmupPending(false);
    // Settle tail (MOBILE_SETTLE_GRACE_MS) still absorbs immediate post-upload hitches.
    expect(warming.inGrace).toBe(true);
    runFor(warming, MOBILE_SETTLE_GRACE_MS - 400, 1000 / 60);
    expect(warming.inGrace).toBe(true);
    expect(warming.observe(140, true)).toBe(false);
    expect(warming.observe(140, true)).toBe(false);
    expect(warming.tier).toBe('high');
    passGrace(warming);
    expect(warming.inGrace).toBe(false);

    // Stuck warmup cannot disable protection past MOBILE_MAX_WARMUP_MS.
    const stuck = new AdaptiveQuality(null);
    stuck.setWarmupPending(true);
    runFor(stuck, MOBILE_MAX_WARMUP_MS + 200, 1000 / 60);
    expect(stuck.inGrace).toBe(false);
    expect(stuck.observe(140, true)).toBe(false);
    expect(stuck.observe(130, true)).toBe(true);
    expect(stuck.tier).toBe('low');
  });

  it('mobile recovers step-by-step (resolutionScale → low → med → high) with hysteresis', () => {
    const auto = new AdaptiveQuality(null);
    passGrace(auto);

    // Drop all the way to low + reduced resolutionScale via severe stalls.
    auto.observe(140, true);
    auto.observe(130, true);
    expect(auto.tier).toBe('low');
    auto.observe(140, true);
    auto.observe(130, true);
    expect(auto.resolutionScale).toBeCloseTo(MOBILE_LOW_SCALE);

    // 40 fps (25 ms) is outside scale recovery threshold (< 22 ms): stays reduced.
    runWindows(auto, MOBILE_SCALE_UP_WINDOWS + 3, 25);
    expect(auto.resolutionScale).toBeCloseTo(MOBILE_LOW_SCALE);

    // Sustained 59 fps (~16.95 ms) restores resolutionScale after MOBILE_SCALE_UP_WINDOWS.
    const frame59 = 1000 / 59;
    runWindows(auto, MOBILE_SCALE_UP_WINDOWS - 1, frame59);
    expect(auto.resolutionScale).toBeCloseTo(MOBILE_LOW_SCALE);
    runWindows(auto, 1, frame59);
    expect(auto.resolutionScale).toBe(1);
    expect(auto.tier).toBe('low');
    expect(auto.upSteps).toBe(1);

    // Immediate post-step-up resize hitch is absorbed by settle grace.
    expect(auto.inGrace).toBe(true);
    expect(auto.observe(140, true)).toBe(false);
    expect(auto.observe(130, true)).toBe(false);
    expect(auto.resolutionScale).toBe(1);
    passGrace(auto);

    // Deadband hysteresis: ~55 fps (18.2 ms, between 17.5 ms up and 19 ms down) neither climbs nor drops.
    runWindows(auto, MOBILE_TIER_UP_WINDOWS + 4, 18.2);
    expect(auto.tier).toBe('low');

    // Sustained 59 fps climbs low → med after MOBILE_TIER_UP_WINDOWS consecutive smooth seconds.
    runWindows(auto, MOBILE_TIER_UP_WINDOWS - 1, frame59);
    expect(auto.tier).toBe('low');
    runWindows(auto, 1, frame59);
    expect(auto.tier).toBe('med');
    expect(auto.upSteps).toBe(2);

    // After settle grace + another MOBILE_TIER_UP_WINDOWS at 59 fps, climbs med → high.
    passGrace(auto);
    runWindows(auto, MOBILE_TIER_UP_WINDOWS, frame59);
    expect(auto.tier).toBe('high');
    expect(auto.upSteps).toBe(3);
  });

  it('caps mobile upward oscillation per level and resets on new level', () => {
    const auto = new AdaptiveQuality(null);
    passGrace(auto);

    // Simulate a marginal phone: drops high → med at 45 fps (22.2 ms), runs 59 fps at med, repeats.
    for (let cycle = 0; cycle < MOBILE_MAX_UP_STEPS; cycle++) {
      // Sustained 45 fps drops high → med.
      runWindows(auto, 2, 22.2);
      expect(auto.tier).toBe('med');
      // Sustained 59 fps climbs med → high while under cap.
      runWindows(auto, MOBILE_TIER_UP_WINDOWS, 1000 / 59);
      expect(auto.tier).toBe('high');
      passGrace(auto);
    }
    expect(auto.upSteps).toBe(MOBILE_MAX_UP_STEPS);

    // Next drop stays at med permanently for this level even if 59 fps returns.
    runWindows(auto, 2, 22.2);
    expect(auto.tier).toBe('med');
    runWindows(auto, MOBILE_TIER_UP_WINDOWS + 5, 1000 / 59);
    expect(auto.tier).toBe('med');

    // New level resets the oscillation cap and re-arms boot grace.
    auto.resetForLevel();
    expect(auto.upSteps).toBe(0);
    expect(auto.inGrace).toBe(true);
    passGrace(auto);
    runWindows(auto, MOBILE_TIER_UP_WINDOWS, 1000 / 59);
    expect(auto.tier).toBe('high');
  });

  it('keeps genuine protection: a phone that cannot hold ~50 fps steps down and stays down', () => {
    const auto = new AdaptiveQuality(null);
    passGrace(auto);

    // Phone holds ~44 fps (22.5 ms/frame): steps high → med → low and stays at low.
    runFor(auto, 2200, 22.5);
    expect(auto.tier).toBe('med');
    runFor(auto, 2200, 22.5);
    expect(auto.tier).toBe('low');
    // Continues at 44 fps for 20 s: never climbs back up because 22.5 >= 17.5.
    runFor(auto, 20_000, 22.5);
    expect(auto.tier).toBe('low');
    expect(auto.resolutionScale).toBe(1);

    // Even slower phone (~25 fps = 40 ms): drops resolutionScale and stays reduced.
    runFor(auto, 2200, 40);
    expect(auto.resolutionScale).toBeCloseTo(MOBILE_LOW_SCALE);
    runFor(auto, 20_000, 40);
    expect(auto.tier).toBe('low');
    expect(auto.resolutionScale).toBeCloseTo(MOBILE_LOW_SCALE);
  });

  it('respects ?quality= overrides and Settings quality locks during mobile recovery', () => {
    // ?quality=med override never climbs to high even after long 60 fps stretches.
    const urlLocked = new AdaptiveQuality('med', 'high', false);
    passGrace(urlLocked);
    runFor(urlLocked, 30_000, 1000 / 60);
    expect(urlLocked.tier).toBe('med');

    // Settings preset lock ('med') holds med and never climbs to high.
    setGraphicsPrefs({ lock: 'med', renderScale: 1, fpsCap: 0 });
    const prefLocked = new AdaptiveQuality(null, 'high', false);
    expect(prefLocked.tier).toBe('med');
    passGrace(prefLocked);
    runFor(prefLocked, 30_000, 1000 / 60);
    expect(prefLocked.tier).toBe('med');

    // Switching a dropped mobile governor to a Settings lock applies the lock + full resolutionScale.
    setGraphicsPrefs(NEUTRAL_GRAPHICS_PREFS);
    const live = new AdaptiveQuality(null, 'high', false);
    passGrace(live);
    live.observe(140, true);
    live.observe(130, true);
    live.observe(140, true);
    live.observe(130, true);
    expect(live.tier).toBe('low');
    expect(live.resolutionScale).toBeCloseTo(MOBILE_LOW_SCALE);
    setGraphicsPrefs({ lock: 'med', renderScale: 1, fpsCap: 0 });
    expect(live.observe(16, true)).toBe(true);
    expect(live.tier).toBe('med');
    expect(live.resolutionScale).toBe(1);
    runFor(live, 30_000, 1000 / 60);
    expect(live.tier).toBe('med');
  });

  it('preserves software-WebGL mobile behavior (no grace, no upward recovery)', () => {
    const sw = new AdaptiveQuality(null, 'high', false, true);
    expect(sw.isSoftware).toBe(true);
    expect(sw.inGrace).toBe(false);
    // Immediate fast-drop on software WebGL without waiting through boot grace.
    expect(sw.observe(140, true)).toBe(false);
    expect(sw.observe(130, true)).toBe(true);
    expect(sw.tier).toBe('low');
    // Stays at low even if frames later look fast.
    runFor(sw, 25_000, 1000 / 60);
    expect(sw.tier).toBe('low');
  });

  it('simulates a 59 fps phone with a 2-frame boot stall (before vs after)', () => {
    const frame59 = 1000 / 59;

    // Legacy / software-WebGL policy (no boot grace, no mobile recovery):
    // 2-frame boot stall drops straight to 'low' and stays stuck at 'low' forever.
    const before = new AdaptiveQuality(null, 'high', false, true);
    before.observe(140, true);
    before.observe(130, true);
    runFor(before, 30_000, frame59);
    expect(before.tier).toBe('low');

    // Fixed mobile hardware policy (boot grace + bounded recovery):
    // 2-frame boot stall during warm-up is ignored → stays 'high' the entire time.
    const afterBootStall = new AdaptiveQuality(null, 'high', false, false);
    afterBootStall.observe(140, true);
    afterBootStall.observe(130, true);
    runFor(afterBootStall, 30_000, frame59);
    expect(afterBootStall.tier).toBe('high');

    // Even if a 2-frame stall hits *after* boot grace (dropping to 'low'),
    // sustained 59 fps recovers low → med → high.
    const afterLateStall = new AdaptiveQuality(null, 'high', false, false);
    passGrace(afterLateStall);
    afterLateStall.observe(140, true);
    afterLateStall.observe(130, true);
    expect(afterLateStall.tier).toBe('low');
    runFor(afterLateStall, 30_000, frame59);
    expect(afterLateStall.tier).toBe('high');
  });
});
