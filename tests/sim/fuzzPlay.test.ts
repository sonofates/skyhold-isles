import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { FixedTimestepStepper } from '../../src/core/gameLoop.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ENEMY_TYPES } from '../../src/data/enemies.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { TOWER_TYPES } from '../../src/data/towers.ts';
import { SimWorld } from '../../src/sim/world.ts';
import {
  digestsEqual,
  FUZZ_PROFILES,
  parseFuzzCliArgs,
  runEndlessFuzz,
  runFuzzCampaign,
  runFuzzPlaythrough,
} from '../../scripts/fuzzPlay.ts';

describe('headless fuzz playthrough harness', () => {
  it('verifies all invariants across every island for seeded random-but-legal runs and endless mode', { timeout: 60_000 }, () => {
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
    expect([...summary.coverage.towerTypesBuilt].sort()).toEqual([...TOWER_TYPES].sort());
    expect(summary.coverage.maxTierReached).toBe(3);
    expect(summary.coverage.towersSold).toBeGreaterThan(0);
    expect(summary.coverage.meteorCasts).toBeGreaterThan(0);
    expect(summary.coverage.overchargeCasts).toBeGreaterThan(0);
    expect([...summary.coverage.targetingModesUsed].sort()).toEqual(['closest', 'first', 'last', 'strongest']);
    expect([...summary.coverage.enemyTypesSpawned].sort()).toEqual([...ENEMY_TYPES].sort());
    expect([...summary.coverage.enemyTypesKilled].sort()).toEqual([...ENEMY_TYPES].sort());
    expect(summary.coverage.splitterSplits).toBeGreaterThan(0);
    expect(summary.coverage.healerPulses).toBeGreaterThan(0);
    expect(summary.coverage.bossPulses).toBeGreaterThan(0);
    expect(summary.coverage.bossSummons).toBeGreaterThan(0);
    expect(summary.coverage.cleansedTowers).toBeGreaterThan(0);
  });

  it('produces identical final state digests when replaying the same seed across levels', { timeout: 60_000 }, () => {
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
      json: false,
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
        '--json',
      ]),
    ).toEqual({
      seedsPerLevel: 1,
      singleSeedMode: true,
      endlessOnly: true,
      json: true,
      baseSeed: 42,
      endlessWaves: 3,
      levelIndices: [1],
      profile: 'tactical',
    });

    expect(parseFuzzCliArgs(['--seeds=4', '--levels=1,3', '--profile=chaotic'])).toEqual({
      seedsPerLevel: 4,
      singleSeedMode: false,
      endlessOnly: false,
      json: false,
      baseSeed: 1336,
      endlessWaves: 5,
      levelIndices: [0, 2],
      profile: 'chaotic',
    });

    // Endless-only campaign & custom profile in runEndlessFuzz
    const endlessCampaign = runFuzzCampaign({
      seedsPerLevel: 1,
      baseSeed: 2025,
      endlessWaves: 2,
      levelIndices: [0],
      profile: 'tactical',
      endlessOnly: true,
    });
    expect(endlessCampaign.failures).toEqual([]);
    expect(endlessCampaign.totalRuns).toBe(0);
    expect(endlessCampaign.endlessChecks).toBe(1);
    expect(endlessCampaign.endlessWavesCompletedTotal).toBe(2);
    expect(endlessCampaign.determinismChecks).toBe(1);

    // Omitting profile in multi-seed endlessOnly campaign rotates profiles deterministically (s=0 -> competent)
    const rotatedEndless = runFuzzCampaign({
      seedsPerLevel: 2,
      baseSeed: 2025,
      endlessWaves: 1,
      levelIndices: [0],
      endlessOnly: true,
    });
    expect(rotatedEndless.failures).toEqual([]);
    expect(rotatedEndless.endlessChecks).toBe(2);
    expect(rotatedEndless.endlessWavesCompletedTotal).toBe(2);
    expect(rotatedEndless.determinismChecks).toBe(1);

    const competentEndless = runEndlessFuzz(LEVELS[0], 2025 + 42 + 0 * 97, 1, 'competent');
    const balancedEndless = runEndlessFuzz(LEVELS[0], 2025 + 42 + 1 * 97, 1, 'balanced');
    expect(competentEndless.ok, competentEndless.failure).toBe(true);
    expect(balancedEndless.ok, balancedEndless.failure).toBe(true);
    expect(competentEndless.digest.profile).toBe('competent');
    expect(balancedEndless.digest.profile).toBe('balanced');

    const tacticalEndless = runEndlessFuzz(LEVELS[0], 42, 2, 'tactical');
    expect(tacticalEndless.ok, tacticalEndless.failure).toBe(true);
    expect(tacticalEndless.digest.profile).toBe('tactical');

    // Timeout failure reporting includes failureDetail + exact reproducible CLI command
    const timedOut = runFuzzPlaythrough(LEVELS[0], 777, { maxStoryTicks: 5, profile: 'balanced', endlessWaves: 3 });
    expect(timedOut.ok).toBe(false);
    expect(timedOut.digest.storyOutcome).toBe('timeout');
    expect(timedOut.failureDetail).toMatchObject({
      levelId: LEVELS[0].id,
      levelIndex: 0,
      seed: 777,
    });
    expect(timedOut.failureDetail?.reproCmd).toBe(
      'npx tsx scripts/fuzzPlay.ts --level 1 --seed 777 --profile balanced --endless-waves 3',
    );

    expect(parseFuzzCliArgs(['--seed=0', '--endless-waves=0']).baseSeed).toBe(0);
    expect(parseFuzzCliArgs(['--seed=-5']).baseSeed).toBe(-5);
    expect(parseFuzzCliArgs(['--levels=1,1,3']).levelIndices).toEqual([0, 2]);
    expect(() => parseFuzzCliArgs(['--level='])).toThrow(/No valid levels matched/);
    expect(parseFuzzCliArgs(['--seed', '42'])).toEqual({
      seedsPerLevel: 1,
      singleSeedMode: true,
      endlessOnly: false,
      json: false,
      baseSeed: 42,
      endlessWaves: 5,
      levelIndices: undefined,
      profile: undefined,
    });

    // Endless fuzz without scriptedBuildOrder exercises fallback tile builder + endless loss immutability
    const brutalEndlessLevel = {
      ...LEVELS[0],
      id: 'qa-brutal-endless',
      enemyHpScale: 1000,
      scriptedBuildOrder: undefined,
      weakBuildOrder: undefined,
      waves: [
        {
          clearBonus: 10,
          groups: [{ enemyType: 'grunt' as const, count: 1, spawnInterval: 0.5, startDelay: 0 }],
        },
      ],
    };
    const endlessLoss = runEndlessFuzz(brutalEndlessLevel, 99, 5, 'minimal');
    expect(endlessLoss.ok, endlessLoss.failure).toBe(true);
    expect(endlessLoss.digest.finalOutcome).toBe('lost');
    expect(endlessLoss.digest.lives).toBe(0);

    // Story fuzz loss path on custom minimal level (5 bosses > 20 starting lives)
    const storyLossLevel = {
      ...brutalEndlessLevel,
      id: 'qa-brutal-story',
      waves: [
        {
          clearBonus: 10,
          groups: [{ enemyType: 'boss' as const, count: 5, spawnInterval: 0.25, startDelay: 0 }],
        },
      ],
    };
    const storyLoss = runFuzzPlaythrough(storyLossLevel, 101, {
      endlessWaves: 2,
      profile: 'minimal',
    });
    expect(storyLoss.ok, storyLoss.failure).toBe(true);
    expect(storyLoss.digest.storyOutcome).toBe('lost');
    expect(storyLoss.digest.finalOutcome).toBe('lost');

    // endlessWaves: 0 stops cleanly at story victory without entering Endless Mode
    const quickStoryWinLevel = {
      ...brutalEndlessLevel,
      id: 'qa-quick-story-win',
      enemyHpScale: 0.25,
      startingGold: 500,
      waves: [
        {
          clearBonus: 15,
          groups: [{ enemyType: 'grunt' as const, count: 2, spawnInterval: 0.3, startDelay: 0 }],
        },
      ],
    };
    const storyOnlyWin = runFuzzPlaythrough(quickStoryWinLevel, 202, {
      endlessWaves: 0,
      profile: 'tactical',
    });
    expect(storyOnlyWin.ok, storyOnlyWin.failure).toBe(true);
    expect(storyOnlyWin.digest.storyOutcome).toBe('won');
    expect(storyOnlyWin.digest.finalOutcome).toBe('won');
    expect(storyOnlyWin.digest.waveState).toBe('finished');
    expect(storyOnlyWin.digest.endlessWavesCompleted).toBe(0);

    // runEndlessFuzz with wavesTarget = 0 settles immediately in betweenWaves without spawning a wave
    const zeroEndless = runEndlessFuzz(LEVELS[0], 42, 0, 'competent');
    expect(zeroEndless.ok, zeroEndless.failure).toBe(true);
    expect(zeroEndless.digest.waveState).toBe('betweenWaves');
    expect(zeroEndless.digest.endlessWavesCompleted).toBe(0);
    expect(zeroEndless.digest.ticks).toBe(0);

    // runFuzzCampaign with endlessWaves = 0 skips dedicated endless checks cleanly
    const noEndlessCampaign = runFuzzCampaign({
      seedsPerLevel: 1,
      baseSeed: 909,
      endlessWaves: 0,
      levelIndices: [0],
      profile: 'minimal',
    });
    expect(noEndlessCampaign.failures).toEqual([]);
    expect(noEndlessCampaign.totalRuns).toBe(1);
    expect(noEndlessCampaign.endlessChecks).toBe(0);
    expect(noEndlessCampaign.endlessWavesCompletedTotal).toBe(0);

    expect(() => parseFuzzCliArgs(['--profile', 'unknown'])).toThrow(/Invalid --profile/);
    expect(() => parseFuzzCliArgs(['--seed'])).toThrow(/requires a value/);
    expect(() => parseFuzzCliArgs(['--seed', 'abc'])).toThrow(/Invalid --seed/);
    expect(() => parseFuzzCliArgs(['--seed', ''])).toThrow(/Invalid --seed/);
    expect(() => parseFuzzCliArgs(['--seeds', '0'])).toThrow(/Invalid --seeds/);
    expect(() => parseFuzzCliArgs(['--seeds', '-2'])).toThrow(/Invalid --seeds/);
    expect(() => parseFuzzCliArgs(['--seeds', 'abc'])).toThrow(/Invalid --seeds/);
    expect(() => parseFuzzCliArgs(['--endless-waves', 'xyz'])).toThrow(/Invalid --endless-waves/);
    expect(() => parseFuzzCliArgs(['--endless-waves', '-1'])).toThrow(/Invalid --endless-waves/);
    expect(() => parseFuzzCliArgs(['--level', '0'])).toThrow(/No valid levels/);
    expect(() => parseFuzzCliArgs(['--level', '999'])).toThrow(/No valid levels/);
    expect(() => parseFuzzCliArgs(['--level', '1,999'])).toThrow(/No valid levels/);
    expect(() => parseFuzzCliArgs(['--json=true'])).toThrow(/does not take a value/);
    expect(() => parseFuzzCliArgs(['--unknown-flag'])).toThrow(/Unknown flag/);
    expect(() => parseFuzzCliArgs(['positional'])).toThrow(/Unexpected positional/);
  });

  it('produces bit-identical simulation state across different FixedTimestepStepper frame rates, speeds, and pauses', () => {
    const runWithCadence = (
      mode: 'steady60_1x' | 'mixed_speeds_and_pauses',
    ) => {
      const world = new SimWorld(LEVELS[1], new EventBus());
      const stepper = new FixedTimestepStepper();
      stepper.simActive = true;

      const t1 = world.placeTower(2, 3, 'archer', 'first')!;
      const t2 = world.placeTower(4, 5, 'frost', 'strongest')!;
      world.startNextWave();

      const totalTicks = 1500;
      let executedTicks = 0;

      const onTick = (fixedDt: number): void => {
        if (executedTicks >= totalTicks) return;
        executedTicks++;
        world.fixedTick(fixedDt);
        if (executedTicks === 180) {
          world.upgradeTower(t1.id);
        } else if (executedTicks === 420) {
          world.castOvercharge();
        } else if (executedTicks === 720) {
          world.castMeteor(0, 0);
        } else if (executedTicks === 960) {
          world.setTowerTargeting(t2.id, 'closest');
        }
      };

      if (mode === 'steady60_1x') {
        stepper.speed = 1;
        while (executedTicks < totalTicks) {
          stepper.step(BALANCE.fixedDt, onTick);
        }
      } else {
        const framePattern = [0.004, 1 / 30, 1 / 15, 0.008, 0.05, 0.25];
        let stepIdx = 0;
        while (executedTicks < totalTicks) {
          stepper.speed = stepIdx % 3 === 0 ? 3 : stepIdx % 2 === 0 ? 2 : 1;
          if (stepIdx % 11 === 5) {
            stepper.paused = true;
            stepper.step(0.05, onTick);
            stepper.paused = false;
          }
          if (stepIdx % 29 === 13) {
            stepper.resetAccumulator();
          }
          stepper.step(framePattern[stepIdx % framePattern.length], onTick);
          stepIdx++;
        }
      }

      const activeSnapshot: Array<{ uid: number; hp: number; x: number; z: number; dist: number }> = [];
      for (let i = 0; i < world.enemyPool.getActiveCount(); i++) {
        const e = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
        activeSnapshot.push({ uid: e.uid, hp: e.hp, x: e.x, z: e.z, dist: e.dist });
      }

      return {
        gold: world.gold,
        lives: world.lives,
        kills: world.enemiesKilledTotal,
        wave: world.waveSystem.currentWaveOneBased,
        waveState: world.waveSystem.state,
        towers: world.towers.map((t) => ({
          id: t.id,
          tier: t.tier,
          dmg: t.totalDamageDealt,
          kills: t.kills,
          yaw: t.yaw,
        })),
        activeSnapshot,
      };
    };

    const baseline = runWithCadence('steady60_1x');
    const varied = runWithCadence('mixed_speeds_and_pauses');
    expect(varied).toEqual(baseline);
  });
});
