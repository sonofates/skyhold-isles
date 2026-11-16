import { describe, expect, it } from 'vitest';
import {
  GOVERNOR_THRESHOLDS,
  PerfGovernor,
  QUALITY_PRESETS,
  RollingFrameMetrics,
  computeP95,
  computeTargetDpr,
} from '../../src/render/perfGovernor.ts';

function feedFrames(
  gov: PerfGovernor,
  count: number,
  frameMs: number,
  options?: { throttled?: boolean; hidden?: boolean },
): ReturnType<PerfGovernor['recordFrame']>[] {
  const transitions: ReturnType<PerfGovernor['recordFrame']>[] = [];
  for (let i = 0; i < count; i++) {
    const tr = gov.recordFrame(frameMs, options);
    if (tr) transitions.push(tr);
  }
  return transitions;
}

describe('computeTargetDpr', () => {
  it('caps touch devices at <= 2.0 and scales down across tiers', () => {
    const dpr5 = computeTargetDpr(3, 5, true, 'auto');
    const dpr4 = computeTargetDpr(3, 4, true, 'auto');
    const dpr3 = computeTargetDpr(3, 3, true, 'auto');
    const dpr2 = computeTargetDpr(3, 2, true, 'auto');
    const dpr1 = computeTargetDpr(3, 1, true, 'auto');
    const dpr0 = computeTargetDpr(3, 0, true, 'auto');

    expect(dpr5).toBeLessThanOrEqual(2);
    expect(dpr4).toBe(1.5);
    expect(dpr3).toBe(1.35);
    expect(dpr2).toBe(1.15);
    expect(dpr1).toBe(1.0);
    expect(dpr0).toBe(0.85);
    expect(dpr4).toBeGreaterThan(dpr3);
    expect(dpr3).toBeGreaterThan(dpr2);
    expect(dpr2).toBeGreaterThan(dpr1);
    expect(dpr1).toBeGreaterThan(dpr0);
  });

  it('preserves full native DPR up to 2.0 for desktop Tier 5', () => {
    expect(computeTargetDpr(1, 5, false, 'auto')).toBe(1);
    expect(computeTargetDpr(2, 5, false, 'auto')).toBe(2);
    expect(computeTargetDpr(3, 5, false, 'auto')).toBe(2);
  });

  it('honors explicit high and low quality modes and guards invalid DPR inputs', () => {
    expect(computeTargetDpr(3, 0, true, 'high')).toBe(2);
    expect(computeTargetDpr(3, 5, false, 'low')).toBe(1);
    expect(computeTargetDpr(NaN, 4, true, 'auto')).toBe(1);
    expect(computeTargetDpr(0, 4, false, 'auto')).toBe(1);
  });
});

describe('computeP95 and RollingFrameMetrics', () => {
  it('computes accurate p95 without mutating the source buffer', () => {
    const src = new Float64Array([50, 10, 20, 30, 40, 15, 25, 35, 45, 100]);
    const copy = new Float64Array(src);
    const scratch = new Float64Array(20);
    // Sorted: 10,15,20,25,30,35,40,45,50,100 -> ceil(10*0.95)-1 = 9 -> 100
    expect(computeP95(src, 10, scratch)).toBe(100);
    expect(src).toEqual(copy);

    const metrics = new RollingFrameMetrics(20);
    for (let i = 1; i <= 20; i++) {
      metrics.record(i);
    }
    const snap = metrics.getSnapshot();
    expect(snap.sampleCount).toBe(20);
    expect(snap.avgMs).toBeCloseTo(10.5, 4);
    expect(snap.p95Ms).toBe(19);
    expect(snap.fps).toBeCloseTo(1000 / 10.5, 2);
  });
});

describe('PerfGovernor', () => {
  it('starts desktop at Tier 5 and touch at Tier 4 in auto mode', () => {
    const desktop = new PerfGovernor({ mode: 'auto', isTouch: false });
    const touch = new PerfGovernor({ mode: 'auto', isTouch: true });

    expect(desktop.getTier()).toBe(5);
    expect(desktop.getPreset()).toBe(QUALITY_PRESETS[5]);
    expect(touch.getTier()).toBe(4);
    expect(touch.getPreset().n8ao).toBe('half');
  });

  it('stays at Tier 5 on healthy 60Hz desktop frames', () => {
    const gov = new PerfGovernor({ mode: 'auto', isTouch: false });
    const transitions = feedFrames(gov, 600, 16.67);
    expect(transitions).toHaveLength(0);
    expect(gov.getTier()).toBe(5);
  });

  it('ignores throttled, hidden, and oversized outlier frames', () => {
    const gov = new PerfGovernor({ mode: 'auto', isTouch: false });
    expect(feedFrames(gov, 300, 66.7, { throttled: true })).toHaveLength(0);
    expect(feedFrames(gov, 300, 66.7, { hidden: true })).toHaveLength(0);
    expect(feedFrames(gov, 300, 400)).toHaveLength(0);
    expect(gov.getTier()).toBe(5);
  });

  it('ignores brief spikes during warmup or short transient bursts', () => {
    const gov = new PerfGovernor({ mode: 'auto', isTouch: false });
    // Warmup frames (< 1.2s) even if slow do not trigger downgrade
    expect(feedFrames(gov, 25, 40)).toHaveLength(0);
    expect(gov.getTier()).toBe(5);

    // 400ms burst followed by healthy 60fps recovers without dropping
    expect(feedFrames(gov, 12, 35)).toHaveLength(0);
    expect(feedFrames(gov, 180, 16.5)).toHaveLength(0);
    expect(gov.getTier()).toBe(5);
  });

  it('steps down under sustained slow frames and steps down faster when severely slow', () => {
    const mildGov = new PerfGovernor({ mode: 'auto', isTouch: false });
    const mildTransitions = feedFrames(mildGov, 260, 24);
    expect(mildTransitions.length).toBeGreaterThanOrEqual(1);
    expect(mildTransitions[0].direction).toBe('down');
    expect(mildTransitions[0].fromTier).toBe(5);
    expect(mildTransitions[0].toTier).toBe(4);

    const severeGov = new PerfGovernor({ mode: 'auto', isTouch: false });
    const severeTransitions = feedFrames(severeGov, 140, 40);
    expect(severeTransitions.length).toBeGreaterThanOrEqual(1);
    expect(severeTransitions[0].direction).toBe('down');
    expect(severeTransitions[0].fromTier).toBe(5);
    expect(severeTransitions[0].toTier).toBe(3); // double-step under >=36ms severe load
  });

  it('requires strong headroom and hold duration to upgrade and locks ceiling on bounce', () => {
    const gov = new PerfGovernor({ mode: 'auto', isTouch: false });

    // Trigger downgrade 5 -> 4 (GPU struggles at Tier 5: 25ms)
    const down0 = feedFrames(gov, 160, 25);
    expect(down0.some((t) => t.direction === 'down' && t.toTier === 4)).toBe(true);
    expect(gov.getTier()).toBe(4);
    gov.resetWarmup();

    // Borderline 19ms (~52fps) frames at Tier 4 fall in hysteresis deadzone: no upgrade, no downgrade
    expect(feedFrames(gov, 900, 19.0)).toHaveLength(0);
    expect(gov.getTier()).toBe(4);

    // Sustained fast 16.5ms frames for > 12s + warmup -> upgrade 4 -> 5
    const up1 = feedFrames(gov, 950, 16.5);
    expect(up1.some((t) => t.direction === 'up' && t.toTier === 5)).toBe(true);
    expect(gov.getTier()).toBe(5);

    // Immediately struggles again at Tier 5 -> bounce #1 back to 4, hold doubles to 24s
    const down1 = feedFrames(gov, 160, 25);
    expect(down1.some((t) => t.direction === 'down' && t.toTier === 4)).toBe(true);
    expect(gov.getTier()).toBe(4);
    gov.resetWarmup();

    // At 14s of fast frames it must NOT upgrade yet because hold doubled to 24s
    expect(feedFrames(gov, 850, 16.5)).toHaveLength(0);
    expect(gov.getTier()).toBe(4);

    // After > 25s of fast frames, try upgrade #2 -> 5
    const up2 = feedFrames(gov, 900, 16.5);
    expect(up2.some((t) => t.direction === 'up' && t.toTier === 5)).toBe(true);
    expect(gov.getTier()).toBe(5);

    // Fails again within bounce window -> bounce #2 permanently locks ceiling at Tier 4
    const down2 = feedFrames(gov, 160, 25);
    expect(down2.some((t) => t.direction === 'down' && t.toTier === 4)).toBe(true);
    expect(gov.getTier()).toBe(4);
    expect(gov.getLockedCeilingTier()).toBe(4);

    // Even 3000 fast frames will never flip-flop back to Tier 5
    expect(feedFrames(gov, 3000, 12)).toHaveLength(0);
    expect(gov.getTier()).toBe(4);
  });

  it('locks to Tier 5 on explicit high and Tier 0 on explicit low', () => {
    const gov = new PerfGovernor({ mode: 'high', isTouch: true });
    expect(gov.getTier()).toBe(5);
    expect(feedFrames(gov, 300, 50)).toHaveLength(0);
    expect(gov.getTier()).toBe(5);

    gov.setMode('low');
    expect(gov.getTier()).toBe(0);
    expect(feedFrames(gov, 1500, 8)).toHaveLength(0);
    expect(gov.getTier()).toBe(0);
  });

  it('stays strictly within expected threshold bounds', () => {
    expect(GOVERNOR_THRESHOLDS.upgradeMaxAvgMs).toBeLessThan(GOVERNOR_THRESHOLDS.mildDowngradeAvgMs);
    expect(GOVERNOR_THRESHOLDS.upgradeMaxP95Ms).toBeLessThan(GOVERNOR_THRESHOLDS.mildDowngradeP95Ms);
    expect(GOVERNOR_THRESHOLDS.baseUpgradeHoldSec).toBeGreaterThan(
      GOVERNOR_THRESHOLDS.mildDowngradeHoldSec,
    );
  });
});
