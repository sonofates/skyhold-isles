import { describe, expect, it } from 'vitest';
import { QualityGovernor } from '../../src/render/qualityGovernor.ts';

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
    const ch = feed(g, 45 + 90 * 2, 26, 4);
    expect(ch).toEqual(['medium']);
    // keeps being slow -> next step down after another two windows
    expect(feed(g, 45 + 90 * 2, 26, 4)).toEqual(['low']);
    expect(feed(g, 2000, 26, 4)).toEqual([]);
    expect(g.tier).toBe('low');
  });

  it('steps down immediately on a very slow window', () => {
    const g = new QualityGovernor('high');
    expect(feed(g, 45 + 90, 55, 6)).toEqual(['medium']);
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
    const ch = feed(g, 45 + 90 * 16, 16.7);
    expect(ch).toEqual(['medium']);
  });

  it('locks out a tier after a bounce (up then back down within the window)', () => {
    const g = new QualityGovernor('medium');
    expect(feed(g, 45 + 90 * 16, 16.7)).toEqual(['high']);
    // high is too heavy: slow again right away
    expect(feed(g, 45 + 90 * 2, 28, 4)).toEqual(['medium']);
    expect(g.maxTier).toBe('medium');
    // long smooth stretch must never climb back to high
    expect(feed(g, 20000, 16.7)).toEqual([]);
    expect(g.tier).toBe('medium');
  });

  it('only climbs while below the ceiling and limits retry attempts', () => {
    const g = new QualityGovernor('low', { maxUpAttempts: 1 });
    expect(feed(g, 45 + 90 * 16, 16.7)).toEqual(['medium']);
    expect(feed(g, 20000, 16.7)).toEqual([]);
  });

  it('is inert while inactive (fixed quality setting)', () => {
    const g = new QualityGovernor('high');
    g.setActive(false);
    expect(feed(g, 3000, 60)).toEqual([]);
    g.setActive(true);
    expect(feed(g, 45 + 90, 60)).toEqual(['medium']);
  });

  it('reset() re-arms the warm-up so a resume hitch is ignored', () => {
    const g = new QualityGovernor('high');
    feed(g, 45 + 80, 16.7);
    g.reset();
    expect(feed(g, 40, 90)).toEqual([]);
  });
});
