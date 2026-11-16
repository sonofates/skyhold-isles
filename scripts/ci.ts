import { spawnSync } from 'node:child_process';

export interface CiStep {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
}

export interface CiStepResult {
  readonly name: string;
  readonly displayCmd: string;
  readonly passed: boolean;
  readonly exitCode: number;
  readonly durationSec: number;
}

export const CI_STEPS: readonly CiStep[] = [
  { name: 'typecheck', command: 'npx', args: ['tsc', '--noEmit'] },
  { name: 'lint', command: 'npm', args: ['run', 'lint'] },
  { name: 'test', command: 'npm', args: ['test'] },
  { name: 'sim:balance', command: 'npm', args: ['run', 'sim:balance'] },
  { name: 'build', command: 'npm', args: ['run', 'build'] },
];

function runStep(step: CiStep): CiStepResult {
  const displayCmd = `${step.command} ${step.args.join(' ')}`;
  const startMs = performance.now();
  const proc = spawnSync(step.command, [...step.args], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const durationSec = (performance.now() - startMs) / 1000;
  const exitCode = proc.status ?? 1;
  const passed = proc.error === undefined && exitCode === 0;
  if (proc.error) {
    console.error(`[ci] Failed to launch "${displayCmd}": ${proc.error.message}`);
  }
  return { name: step.name, displayCmd, passed, exitCode, durationSec };
}

function main(): void {
  const failFast = process.argv.includes('--fail-fast');
  const results: CiStepResult[] = [];
  const totalStartMs = performance.now();

  console.log('=== Skyhold Isles CI ===\n');

  for (let i = 0; i < CI_STEPS.length; i++) {
    const step = CI_STEPS[i];
    const displayCmd = `${step.command} ${step.args.join(' ')}`;
    console.log(`\n>>> [${i + 1}/${CI_STEPS.length}] ${step.name}: ${displayCmd}`);
    const res = runStep(step);
    results.push(res);
    if (!res.passed && failFast) {
      console.error(`\n[ci] Stopping early (--fail-fast) after "${step.name}" failed (exit ${res.exitCode}).`);
      break;
    }
  }

  const totalSec = (performance.now() - totalStartMs) / 1000;
  const passedCount = results.filter((r) => r.passed).length;
  const allPassed = passedCount === results.length && results.length === CI_STEPS.length;

  console.log('\n=== Skyhold Isles CI Summary ===');
  for (const r of results) {
    const badge = r.passed ? 'PASS' : 'FAIL';
    const timeStr = `${r.durationSec.toFixed(2)}s`.padStart(6);
    const exitNote = r.passed ? '' : ` (exit ${r.exitCode})`;
    console.log(`[${badge}] ${r.name.padEnd(12)} ${timeStr}  ${r.displayCmd}${exitNote}`);
  }
  console.log(
    `Result: ${allPassed ? 'PASSED' : 'FAILED'} (${passedCount}/${results.length} steps ran, ${totalSec.toFixed(2)}s total)`,
  );

  if (!allPassed) {
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('ci.ts')) {
  main();
}
