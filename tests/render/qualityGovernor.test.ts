import { describe, expect, it } from 'vitest';
import { DEFAULT_GOVERNOR_OPTIONS, QualityGovernor } from '../../src/render/qualityGovernor.ts';

const W = DEFAULT_GOVERNOR_OPTIONS.windowFrames;
const WARM = DEFAULT_GOVERNOR_OPTIONS.warmupFrames;

/** Feed `n` frames of `ms` each; returns the tier changes seen (in order). */
function feed(g: QualityGovernor, n: number, ms: number, jitter = 0): string[] {
  const changes: string[] = [];
  for (let i = 0; i < n; i++) {
    const wobble = jitter > 0 ? (i % 2 === 0 ? jitter : -jitter) : 0;
    const t = g.sample(ms + wobble);
    if (t) changes.push(t);
  }
  return changes;
}

describe('QualityGovernor', () => {
  it('ignores warm-up frames', () => {
    const g = new QualityGovernor('high');
    expect(feed(g, 40, 80)).toEqual([]);
    expect(g.tier).toBe('high');
  });

  it('steps down after two consecutive slow windows, one tier at a time', () => {
    const g = new QualityGovernor('high');
    // warmup 45 + 2 windows of 90 frames at 26 ms
    const ch = feed(g, WARM + W * 2, 26, 4);
    expect(ch).toEqual(['medium']);
    // keeps being slow -> next step down after another two windows
    expect(feed(g, WARM + W * 2, 26, 4)).toEqual(['low']);
    expect(feed(g, 2000, 26, 4)).toEqual([]);
    expect(g.tier).toBe('low');
  });

  it('steps down immediately on a very slow window', () => {
    const g = new QualityGovernor('high');
    expect(feed(g, WARM + W, 55, 6)).toEqual(['medium']);
  });

  it('does not react to isolated spikes', () => {
    const g = new QualityGovernor('high');
    let changes: string[] = [];
    for (let w = 0; w < 10; w++) {
      changes = changes.concat(feed(g, 89, 16.7));
      changes = changes.concat(feed(g, 1, 400));
    }
    expect(changes).toEqual([]);
  });

  it('does not treat a steady 30 Hz refresh cap as a load problem', () => {
    const g = new QualityGovernor('high');
    expect(feed(g, 2000, 33.3, 0.4)).toEqual([]);
    expect(g.tier).toBe('high');
  });

  it('steps up after sustained smooth play', () => {
    const g = new QualityGovernor('low');
    // 20 s of 16.7 ms frames = 1200 frames (+ warmup + window rounding)
    const ch = feed(g, WARM + W * 24, 16.7);
    expect(ch).toEqual(['medium']);
  });

  it('locks out a tier after a bounce (up then back down within the window)', () => {
    const g = new QualityGovernor('medium');
    expect(feed(g, WARM + W * 24, 16.7)).toEqual(['high']);
    // high is too heavy: slow again right away
    expect(feed(g, WARM + W * 2, 28, 4)).toEqual(['medium']);
    expect(g.maxTier).toBe('medium');
    // long smooth stretch must never climb back to high
    expect(feed(g, 20000, 16.7)).toEqual([]);
    expect(g.tier).toBe('medium');
  });

  it('only climbs while below the ceiling and limits retry attempts', () => {
    const g = new QualityGovernor('low', { maxUpAttempts: 1 });
    expect(feed(g, WARM + W * 24, 16.7)).toEqual(['medium']);
    expect(feed(g, 20000, 16.7)).toEqual([]);
  });

  it('is inert while inactive (fixed quality setting)', () => {
    const g = new QualityGovernor('high');
    g.setActive(false);
    expect(feed(g, 3000, 60)).toEqual([]);
    g.setActive(true);
    expect(feed(g, WARM + W, 60)).toEqual(['medium']);
  });

  it('reset() re-arms the warm-up so a resume hitch is ignored', () => {
    const g = new QualityGovernor('high');
    feed(g, WARM + 50, 16.7);
    g.reset();
    expect(feed(g, 40, 90)).toEqual([]);
  });
});

describe('QualityGovernor frame pacing (missed vsync)', () => {
  /** 120 Hz display where `missEvery`-th frames take two refreshes. */
  function feedPaced(g: QualityGovernor, n: number, interval: number, missShare: number): string[] {
    const changes: string[] = [];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += missShare;
      const miss = acc >= 1;
      if (miss) acc -= 1;
      const t = g.sample(miss ? interval * 2 : interval);
      if (t) changes.push(t);
    }
    return changes;
  }

  it('steps down when a 120 Hz display misses vsync on ~40% of frames (mean still ~12 ms)', () => {
    const g = new QualityGovernor('high');
    expect(feedPaced(g, WARM + W * 2, 8.33, 0.4)).toEqual(['medium']);
  });

  it('keeps a steady 120 Hz or 60 Hz tier', () => {
    const g120 = new QualityGovernor('high');
    expect(feedPaced(g120, WARM + W * 6, 8.33, 0)).toEqual([]);
    const g60 = new QualityGovernor('high');
    expect(feedPaced(g60, WARM + W * 6, 16.7, 0.03)).toEqual([]);
  });

  it('steps down on a 60 Hz display that keeps dropping to 30 fps frames', () => {
    const g = new QualityGovernor('high');
    expect(feedPaced(g, WARM + W * 2, 16.7, 0.25)).toEqual(['medium']);
  });

  it('a juddering window never counts toward stepping up', () => {
    const g = new QualityGovernor('medium');
    // 20% misses at 120 Hz: mean ~10 ms (would be "smooth" by mean alone) but too many misses
    const ch = feedPaced(g, WARM + Math.ceil((25 * 1000) / 10 / W) * W, 8.33, 0.2);
    expect(ch).not.toContain('high');
  });
});
