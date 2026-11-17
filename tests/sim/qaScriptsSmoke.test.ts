import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runLevelBalanceSim } from '../../scripts/balanceSim.ts';
import { CI_STEPS, EXTRA_QA_STEPS } from '../../scripts/ci.ts';
import { pickBenchLevel, runSimBenchScenario } from '../../scripts/simBench.ts';
import { LEVELS } from '../../src/data/levels/index.ts';

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
  });
});
