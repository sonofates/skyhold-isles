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
      { enemyCount: 40, towerCount: 15, softBudgetTicksPerSec: 180 },
      1,
      20,
    );

    expect(res.enemyCount).toBe(40);
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
      { waveIndex: 0, action: 'upgrade', col: 4, row: 3 }, // invalid missing tower
      { waveIndex: 0, action: 'upgrade', col: 4, row: 2 }, // unaffordable at 10g
    ]);

    expect(res.outcome).toBe('lost');
    expect(res.finalLives).toBe(0);
    expect(res.stars).toBe(0);
    expect(res.towersBuilt).toBe(1);
    expect(res.targetingChanges).toBe(1);
    expect(res.invalidActions).toBe(2);
    expect(res.unspentScriptActions).toBe(1);
    expect(res.startingGold + res.goldEarned - res.goldSpent).toBe(res.finalGold);
  });

  it('validates CI and simBench CLI arguments strictly and rejects under-sized bench levels', () => {
    expect(parseCiCliArgs([])).toEqual({ help: false, failFast: false, full: false });
    expect(parseCiCliArgs(['--fail-fast', '--full'])).toEqual({
      help: false,
      failFast: true,
      full: true,
    });
    expect(parseCiCliArgs(['-h'])).toEqual({ help: true, failFast: false, full: false });
    expect(() => parseCiCliArgs(['--fial-fast'])).toThrow(/Unknown CI argument/);
    expect(() => parseCiCliArgs(['extra'])).toThrow(/Unknown CI argument/);

    expect(parseSimBenchCliArgs([])).toEqual({ help: false, strict: false, json: false });
    expect(parseSimBenchCliArgs(['--strict', '--json'])).toEqual({
      help: false,
      strict: true,
      json: true,
    });
    expect(parseSimBenchCliArgs(['--help'])).toEqual({ help: true, strict: false, json: false });
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
});
