import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/data/levels/index.ts';
import {
  digestsEqual,
  runEndlessFuzz,
  runFuzzCampaign,
  runFuzzPlaythrough,
} from '../../scripts/fuzzPlay.ts';

describe('headless fuzz playthrough harness', () => {
  it('verifies all invariants across every island for seeded random-but-legal runs and endless mode', { timeout: 25_000 }, () => {
    const summary = runFuzzCampaign({
      seedsPerLevel: 4,
      baseSeed: 1336,
      endlessWaves: 3,
    });

    expect(summary.failures).toEqual([]);
    expect(summary.totalRuns).toBe(LEVELS.length * 4);
    expect(summary.passedRuns).toBe(summary.totalRuns);
    expect(summary.endlessChecks).toBe(LEVELS.length);
    expect(summary.determinismChecks).toBe(LEVELS.length);
    expect(summary.storyWins).toBeGreaterThan(0);
    expect(summary.storyLosses).toBeGreaterThan(0);
    expect(summary.endlessWavesCompletedTotal).toBeGreaterThan(0);
  });

  it('produces identical final state digests when replaying the same seed across levels', { timeout: 25_000 }, () => {
    for (const level of LEVELS) {
      const seed = 4242 + level.index * 101;
      const runA = runFuzzPlaythrough(level, seed, { endlessWaves: 2 });
      const runB = runFuzzPlaythrough(level, seed, { endlessWaves: 2 });

      expect(runA.ok, runA.failure).toBe(true);
      expect(runB.ok, runB.failure).toBe(true);
      expect(digestsEqual(runA.digest, runB.digest)).toBe(true);

      const endlessA = runEndlessFuzz(level, seed + 17, 2);
      const endlessB = runEndlessFuzz(level, seed + 17, 2);
      expect(endlessA.ok, endlessA.failure).toBe(true);
      expect(endlessB.ok, endlessB.failure).toBe(true);
      expect(digestsEqual(endlessA.digest, endlessB.digest)).toBe(true);
    }
  });
});
