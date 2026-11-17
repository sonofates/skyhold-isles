import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runLevelBalanceSim } from '../../scripts/balanceSim.ts';
import { CI_STEPS, EXTRA_QA_STEPS, parseCiCliArgs } from '../../scripts/ci.ts';
import {
  BENCH_SCENARIOS,
  parseSimBenchCliArgs,
  pickBenchLevel,
  runSimBenchScenario,
} from '../../scripts/simBench.ts';
import { LEVELS, type LevelDef } from '../../src/data/levels/index.ts';

describe('QA scripts smoke verification', () => {
  it('verifies CI_STEPS and EXTRA_QA_STEPS reference valid package.json scripts', () => {
    const pkgRaw = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};

    for (const step of [...CI_STEPS, ...EXTRA_QA_STEPS]) {
      if (step.command === 'npm' && step.args[0] === 'run') {
        const scriptName = step.args[1];
        expect(scripts[scriptName], `Missing npm script "${scriptName}"`).toBeTypeOf('string');
      } else if (step.command === 'npm' && step.args[0] === 'test') {
        expect(scripts.test).toBeTypeOf('string');
      }
    }

    expect(CI_STEPS.map((s) => s.name)).toEqual([
      'typecheck',
      'lint',
      'test',
      'sim:balance',
      'build',
    ]);
    expect(EXTRA_QA_STEPS.map((s) => s.name)).toEqual(['sim:fuzz', 'sim:bench']);
  });

  it('executes runSimBenchScenario cleanly across all enemy & tower archetypes', () => {
    const level = pickBenchLevel();
    const res = runSimBenchScenario(
      level,
      { enemyCount: 60, towerCount: 15, softBudgetTicksPerSec: 180 },
      1,
      20,
    );

    expect(res.enemyCount).toBe(60);
    expect(res.towerCount).toBe(15);
    expect(res.totalTicks).toBe(20);
    expect(res.ticksPerSec).toBeGreaterThan(180);
    expect(Number.isFinite(res.msPerTick)).toBe(true);
    expect(Number.isFinite(res.simMsAt3xFrame)).toBe(true);
    expect(res.peakProjectiles).toBeGreaterThanOrEqual(0);
  });

  it('runs balanceSim exported runLevelBalanceSim cleanly on Level 1 greedy order', () => {
    const lvl1 = LEVELS[0];
    const res = runLevelBalanceSim(lvl1, 'greedy', lvl1.scriptedBuildOrder ?? []);
    expect(res.outcome).toBe('won');
    expect(res.invalidActions).toBe(0);
    expect(res.finalLives).toBeGreaterThanOrEqual(18);
    expect(res.stars).toBe(3);
    expect(res.startingGold + res.goldEarned - res.goldSpent).toBe(res.finalGold);
  });

  it('tracks invalid actions, targeting changes, gold conservation, and losses in runLevelBalanceSim and validates BENCH_SCENARIOS', () => {
    expect(BENCH_SCENARIOS.map((s) => s.enemyCount)).toEqual([100, 250, 360]);
    for (const s of BENCH_SCENARIOS) {
      expect(s.towerCount).toBe(40);
      expect(s.softBudgetTicksPerSec).toBeGreaterThanOrEqual(180);
    }

    const customLevel: LevelDef = {
      ...LEVELS[0],
      id: 'qa-smoke-loss',
      startingGold: 60,
      waves: [
        {
          clearBonus: 10,
          groups: [{ enemyType: 'boss', count: 5, spawnInterval: 0.2, startDelay: 0 }],
        },
      ],
    };
    const res = runLevelBalanceSim(customLevel, 'weak', [
      { waveIndex: 0, action: 'build', col: 4, row: 2, towerType: 'archer', targetingMode: 'strongest' },
      { waveIndex: 0, action: 'build', col: 0, row: 0, towerType: 'archer' }, // invalid void tile
      { waveIndex: 0, action: 'build', col: 4, row: 3 }, // invalid build missing towerType
      { waveIndex: 0, action: 'upgrade', col: 4, row: 3 }, // invalid missing tower
      { waveIndex: 0, action: 'upgrade', col: 4, row: 2 }, // unaffordable at 10g
    ]);

    expect(res.outcome).toBe('lost');
    expect(res.finalLives).toBe(0);
    expect(res.stars).toBe(0);
    expect(res.towersBuilt).toBe(1);
    expect(res.targetingChanges).toBe(1);
    expect(res.invalidActions).toBe(3);
    expect(res.unspentScriptActions).toBe(1);
    expect(res.waves).toHaveLength(1);
    expect(res.waves[0].livesLost).toBeGreaterThan(0);
    expect(res.waves[0].leaksByType.boss).toBeGreaterThan(0);
    expect(res.startingGold + res.goldEarned - res.goldSpent).toBe(res.finalGold);

    // Verify full T1 -> T2 -> T3 upgrades + T4 over-upgrade rejection & hoard % tracking
    const richLevel: LevelDef = {
      ...LEVELS[0],
      id: 'qa-smoke-t3',
      startingGold: 500,
      waves: [
        {
          clearBonus: 20,
          groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 0.5, startDelay: 0 }],
        },
      ],
    };
    const t3Res = runLevelBalanceSim(richLevel, 'greedy', [
      { waveIndex: 0, action: 'build', col: 4, row: 2, towerType: 'archer' },
      { waveIndex: 0, action: 'upgrade', col: 4, row: 2 },
      { waveIndex: 0, action: 'upgrade', col: 4, row: 2 },
      { waveIndex: 0, action: 'upgrade', col: 4, row: 2 }, // invalid T4 attempt
    ]);
    expect(t3Res.outcome).toBe('won');
    expect(t3Res.goldSpent).toBe(50 + 55 + 95);
    expect(t3Res.invalidActions).toBe(1);
    expect(Number.isFinite(t3Res.endGoldPctOfEarned)).toBe(true);
    expect(Number.isFinite(t3Res.lastWaveHoardPct)).toBe(true);
    expect(t3Res.startingGold + t3Res.goldEarned - t3Res.goldSpent).toBe(t3Res.finalGold);
  });

  it('validates CI and simBench CLI arguments strictly and rejects under-sized bench levels', () => {
    expect(parseCiCliArgs([])).toEqual({ help: false, failFast: false, full: false });
    expect(parseCiCliArgs(['--fail-fast', '--full'])).toEqual({
      help: false,
      failFast: true,
      full: true,
    });
    expect(parseCiCliArgs(['-h'])).toEqual({ help: true, failFast: false, full: false });
    expect(parseCiCliArgs(['--help'])).toEqual({ help: true, failFast: false, full: false });
    expect(() => parseCiCliArgs(['--fial-fast'])).toThrow(/Unknown CI argument/);
    expect(() => parseCiCliArgs(['extra'])).toThrow(/Unknown CI argument/);

    expect(parseSimBenchCliArgs([])).toEqual({ help: false, strict: false, json: false });
    expect(parseSimBenchCliArgs(['--strict', '--json'])).toEqual({
      help: false,
      strict: true,
      json: true,
    });
    expect(parseSimBenchCliArgs(['--help'])).toEqual({ help: true, strict: false, json: false });
    expect(parseSimBenchCliArgs(['-h'])).toEqual({ help: true, strict: false, json: false });
    expect(() => parseSimBenchCliArgs(['--strct'])).toThrow(/Unknown sim:bench argument/);
    expect(() => parseSimBenchCliArgs(['extra'])).toThrow(/Unknown sim:bench argument/);

    const tinyLevel: LevelDef = {
      ...LEVELS[0],
      cols: 4,
      rows: 3,
      layout: [
        '~ . . ~',
        'S P P G',
        '~ ~ ~ ~',
      ],
      pathWaypoints: [
        { col: 0, row: 1 },
        { col: 3, row: 1 },
      ],
      flightPath: [
        { col: 0, row: 1 },
        { col: 3, row: 1 },
      ],
    };
    expect(() =>
      runSimBenchScenario(tinyLevel, { enemyCount: 10, towerCount: 5, softBudgetTicksPerSec: 180 }, 1, 5),
    ).toThrow(/placed only 2\/5 towers/);
  });

  const tsxBin = resolve(process.cwd(), 'node_modules/.bin/tsx');
  const runTsx = (args: readonly string[]) =>
    spawnSync(tsxBin, [...args], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });

  it('executes CI, simBench, and fuzzPlay CLI --help/-h and rejects unknown flags', { timeout: 30_000 }, () => {
    const ciHelp = runTsx(['scripts/ci.ts', '--help']);
    expect(ciHelp.status).toBe(0);
    expect(ciHelp.stdout).toContain('Usage: npm run ci');

    const benchHelp = runTsx(['scripts/simBench.ts', '-h']);
    expect(benchHelp.status).toBe(0);
    expect(benchHelp.stdout).toContain('Usage: npm run sim:bench');

    const fuzzHelp = runTsx(['scripts/fuzzPlay.ts', '--help']);
    expect(fuzzHelp.status).toBe(0);
    expect(fuzzHelp.stdout).toContain('Usage: npm run sim:fuzz');

    const ciBad = runTsx(['scripts/ci.ts', '--unknown-flag']);
    expect(ciBad.status).not.toBe(0);

    const benchBad = runTsx(['scripts/simBench.ts', '--unknown-flag']);
    expect(benchBad.status).not.toBe(0);

    const fuzzBad = runTsx(['scripts/fuzzPlay.ts', '--unknown-flag']);
    expect(fuzzBad.status).not.toBe(0);
  });

  it('executes fuzzPlay CLI --json across repro, campaign, profile, and --endless-only modes', { timeout: 30_000 }, () => {
    const fuzzRepro = runTsx([
      'scripts/fuzzPlay.ts',
      '--level',
      '1',
      '--seed',
      '1',
      '--profile',
      'tactical',
      '--endless-waves',
      '1',
      '--json',
    ]);
    expect(fuzzRepro.status, fuzzRepro.stderr).toBe(0);
    const reproJson = JSON.parse(fuzzRepro.stdout) as {
      mode: string;
      passed: boolean;
      deterministic: boolean;
      digest: { levelId: string; seed: number; profile: string; stateHash: number };
    };
    expect(reproJson.mode).toBe('repro');
    expect(reproJson.passed).toBe(true);
    expect(reproJson.deterministic).toBe(true);
    expect(reproJson.digest.levelId).toBe(LEVELS[0].id);
    expect(reproJson.digest.seed).toBe(1);
    expect(reproJson.digest.profile).toBe('tactical');
    expect(reproJson.digest.stateHash).toBeGreaterThan(0);

    const fuzzCampaign = runTsx([
      'scripts/fuzzPlay.ts',
      '--level',
      '1',
      '--seeds',
      '1',
      '--endless-waves',
      '1',
      '--json',
    ]);
    expect(fuzzCampaign.status, fuzzCampaign.stderr).toBe(0);
    const campaignJson = JSON.parse(fuzzCampaign.stdout) as {
      mode: string;
      passed: boolean;
      totalRuns: number;
      passedRuns: number;
      endlessChecks: number;
      coverage: {
        enemyTypesSpawned: string[];
        enemyTypesKilled: string[];
        splitterSplits: number;
        healerPulses: number;
        bossPulses: number;
        bossSummons: number;
        cleansedTowers: number;
      };
      failures: unknown[];
    };
    expect(campaignJson.mode).toBe('campaign');
    expect(campaignJson.passed).toBe(true);
    expect(campaignJson.totalRuns).toBe(1);
    expect(campaignJson.passedRuns).toBe(1);
    expect(campaignJson.endlessChecks).toBe(1);
    expect(campaignJson.coverage.enemyTypesSpawned.length).toBeGreaterThan(0);
    expect(campaignJson.coverage.enemyTypesKilled.length).toBeGreaterThan(0);
    expect(campaignJson.coverage.splitterSplits).toBeGreaterThanOrEqual(0);
    expect(campaignJson.coverage.healerPulses).toBeGreaterThanOrEqual(0);
    expect(campaignJson.coverage.bossPulses).toBeGreaterThanOrEqual(0);
    expect(campaignJson.coverage.bossSummons).toBeGreaterThanOrEqual(0);
    expect(campaignJson.coverage.cleansedTowers).toBeGreaterThanOrEqual(0);
    expect(campaignJson.failures).toEqual([]);

    const fuzzEndlessOnly = runTsx([
      'scripts/fuzzPlay.ts',
      '--seed',
      '1',
      '--level',
      '1',
      '--endless-waves',
      '1',
      '--endless-only',
      '--json',
    ]);
    expect(fuzzEndlessOnly.status, fuzzEndlessOnly.stderr).toBe(0);
    const endlessOnlyJson = JSON.parse(fuzzEndlessOnly.stdout) as {
      mode: string;
      endlessOnly: boolean;
      passed: boolean;
      deterministic: boolean;
      digest: { endlessWavesCompleted: number; profile: string };
    };
    expect(endlessOnlyJson.mode).toBe('repro');
    expect(endlessOnlyJson.endlessOnly).toBe(true);
    expect(endlessOnlyJson.passed).toBe(true);
    expect(endlessOnlyJson.deterministic).toBe(true);
    expect(endlessOnlyJson.digest.profile).toBe('competent');
    expect(endlessOnlyJson.digest.endlessWavesCompleted).toBe(1);
  });

  it('executes simBench --strict --json CLI entrypoint cleanly', { timeout: 30_000 }, () => {
    const benchJsonProc = runTsx(['scripts/simBench.ts', '--strict', '--json']);
    expect(benchJsonProc.status, benchJsonProc.stderr).toBe(0);
    const benchJson = JSON.parse(benchJsonProc.stdout) as {
      levelId: string;
      hardFloorTicksPerSec: number;
      passed: boolean;
      results: Array<{ enemyCount: number; towerCount: number; ticksPerSec: number }>;
    };
    expect(benchJson.hardFloorTicksPerSec).toBe(180);
    expect(benchJson.passed).toBe(true);
    expect(benchJson.results.map((r) => r.enemyCount)).toEqual([100, 250, 360]);
    expect(benchJson.results.every((r) => r.towerCount === 40 && r.ticksPerSec > 180)).toBe(true);
  });
});
