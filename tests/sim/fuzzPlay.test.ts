import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/data/levels/index.ts';
import {
  digestsEqual,
  FUZZ_PROFILES,
  parseFuzzCliArgs,
  runEndlessFuzz,
  runFuzzCampaign,
  runFuzzPlaythrough,
} from '../../scripts/fuzzPlay.ts';

describe('headless fuzz playthrough harness', () => {
  it('verifies all invariants across every island for seeded random-but-legal runs and endless mode', { timeout: 45_000 }, () => {
    const summary = runFuzzCampaign({
      seedsPerLevel: 5,
      baseSeed: 1336,
      endlessWaves: 2,
    });

    expect(summary.failures).toEqual([]);
    expect(summary.totalRuns).toBe(LEVELS.length * 5);
    expect(summary.passedRuns).toBe(summary.totalRuns);
    expect(summary.endlessChecks).toBe(LEVELS.length);
    expect(summary.determinismChecks).toBe(LEVELS.length);
    expect(summary.storyWins).toBeGreaterThan(0);
    expect(summary.storyLosses).toBeGreaterThan(0);
    expect(summary.endlessWavesCompletedTotal).toBeGreaterThan(0);
  });

  it('produces identical final state digests when replaying the same seed across levels', { timeout: 45_000 }, () => {
    for (const level of LEVELS) {
      const seed = 4242 + level.index * 101;
      const runA = runFuzzPlaythrough(level, seed, { endlessWaves: 1 });
      const runB = runFuzzPlaythrough(level, seed, { endlessWaves: 1 });

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

  it('exercises every fuzz profile cleanly and parses CLI args including --profile and invalid flags', () => {
    for (let i = 0; i < FUZZ_PROFILES.length; i++) {
      const profile = FUZZ_PROFILES[i];
      const seed = 700 + i;
      const runA = runFuzzPlaythrough(LEVELS[0], seed, { endlessWaves: 1, profile });
      const runB = runFuzzPlaythrough(LEVELS[0], seed, { endlessWaves: 1, profile });
      expect(runA.ok, runA.failure).toBe(true);
      expect(runA.digest.profile).toBe(profile);
      expect(runA.digest.stateHash).toBeGreaterThan(0);
      expect(digestsEqual(runA.digest, runB.digest)).toBe(true);
      expect(digestsEqual(runA.digest, { ...runB.digest, stateHash: runB.digest.stateHash ^ 1 })).toBe(false);
    }

    expect(parseFuzzCliArgs([])).toEqual({
      seedsPerLevel: 8,
      singleSeedMode: false,
      endlessOnly: false,
      baseSeed: 1336,
      endlessWaves: 5,
      levelIndices: undefined,
      profile: undefined,
    });

    expect(
      parseFuzzCliArgs([
        '--seed',
        '42',
        '--level',
        '2',
        '--profile',
        'tactical',
        '--endless-waves=3',
        '--endless-only',
      ]),
    ).toEqual({
      seedsPerLevel: 1,
      singleSeedMode: true,
      endlessOnly: true,
      baseSeed: 42,
      endlessWaves: 3,
      levelIndices: [1],
      profile: 'tactical',
    });

    expect(parseFuzzCliArgs(['--seeds=4', '--levels=1,3', '--profile=chaotic'])).toEqual({
      seedsPerLevel: 4,
      singleSeedMode: false,
      endlessOnly: false,
      baseSeed: 1336,
      endlessWaves: 5,
      levelIndices: [0, 2],
      profile: 'chaotic',
    });

    expect(() => parseFuzzCliArgs(['--profile', 'unknown'])).toThrow(/Invalid --profile/);
    expect(() => parseFuzzCliArgs(['--seed', 'abc'])).toThrow(/Invalid --seed/);
    expect(() => parseFuzzCliArgs(['--seed', ''])).toThrow(/Invalid --seed/);
    expect(() => parseFuzzCliArgs(['--seeds', '0'])).toThrow(/Invalid --seeds/);
    expect(() => parseFuzzCliArgs(['--seeds', 'abc'])).toThrow(/Invalid --seeds/);
    expect(() => parseFuzzCliArgs(['--endless-waves', 'xyz'])).toThrow(/Invalid --endless-waves/);
    expect(() => parseFuzzCliArgs(['--endless-waves', '-1'])).toThrow(/Invalid --endless-waves/);
    expect(() => parseFuzzCliArgs(['--level', '999'])).toThrow(/No valid levels/);
    expect(() => parseFuzzCliArgs(['--level', '1,999'])).toThrow(/No valid levels/);
    expect(() => parseFuzzCliArgs(['--unknown-flag'])).toThrow(/Unknown flag/);
    expect(() => parseFuzzCliArgs(['positional'])).toThrow(/Unexpected positional/);
  });
});
