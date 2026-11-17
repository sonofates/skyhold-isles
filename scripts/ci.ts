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

export const EXTRA_QA_STEPS: readonly CiStep[] = [
  { name: 'sim:fuzz', command: 'npm', args: ['run', 'sim:fuzz'] },
  { name: 'sim:bench', command: 'npm', args: ['run', 'sim:bench'] },
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

export interface ParsedCiCliArgs {
  readonly help: boolean;
  readonly failFast: boolean;
  readonly full: boolean;
}

const CI_FLAGS = new Set(['--fail-fast', '--full', '--help', '-h']);

export function parseCiCliArgs(argv: readonly string[]): ParsedCiCliArgs {
  let help = false;
  let failFast = false;
  let full = false;

  for (const arg of argv) {
    if (!CI_FLAGS.has(arg)) {
      throw new Error(`Unknown CI argument "${arg}". Run with --help for usage.`);
    }
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--fail-fast') failFast = true;
    else if (arg === '--full') full = true;
  }

  return { help, failFast, full };
}

export interface CiSuiteSummary {
  readonly results: readonly CiStepResult[];
  readonly totalSteps: number;
  readonly passedCount: number;
  readonly allPassed: boolean;
  readonly totalSec: number;
}

/** Format human-readable summary lines for a completed CI run. */
export function formatCiSummaryLines(summary: CiSuiteSummary): string[] {
  const lines: string[] = ['\n=== Skyhold Isles CI Summary ==='];
  for (const r of summary.results) {
    const badge = r.passed ? 'PASS' : 'FAIL';
    const timeStr = `${r.durationSec.toFixed(2)}s`.padStart(6);
    const exitNote = r.passed ? '' : ` (exit ${r.exitCode})`;
    lines.push(`[${badge}] ${r.name.padEnd(12)} ${timeStr}  ${r.displayCmd}${exitNote}`);
  }
  lines.push(
    `Result: ${summary.allPassed ? 'PASSED' : 'FAILED'} (${summary.passedCount}/${summary.results.length} steps ran, ${summary.totalSec.toFixed(2)}s total)`,
  );
  return lines;
}

/** Execute a sequence of CI steps, honoring fail-fast early exit on failures. */
export function executeCiSuite(
  steps: readonly CiStep[],
  failFast: boolean,
  stepRunner: (step: CiStep) => CiStepResult = runStep,
  logger: { log: (msg: string) => void; error: (msg: string) => void } = console,
): CiSuiteSummary {
  const results: CiStepResult[] = [];
  const totalStartMs = performance.now();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const displayCmd = `${step.command} ${step.args.join(' ')}`;
    logger.log(`\n>>> [${i + 1}/${steps.length}] ${step.name}: ${displayCmd}`);
    const res = stepRunner(step);
    results.push(res);
    if (!res.passed && failFast) {
      logger.error(
        `\n[ci] Stopping early (--fail-fast) after "${step.name}" failed (exit ${res.exitCode}).`,
      );
      break;
    }
  }

  const totalSec = (performance.now() - totalStartMs) / 1000;
  const passedCount = results.filter((r) => r.passed).length;
  const allPassed = passedCount === results.length && results.length === steps.length;

  return {
    results,
    totalSteps: steps.length,
    passedCount,
    allPassed,
    totalSec,
  };
}

function main(): void {
  const parsed = parseCiCliArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log('Usage: npm run ci [-- --fail-fast] [--full]');
    console.log('  --fail-fast  Stop immediately after the first failed step');
    console.log('  --full       Also run sim:fuzz and sim:bench after build');
    return;
  }

  const { failFast, full } = parsed;
  const steps = full ? [...CI_STEPS, ...EXTRA_QA_STEPS] : CI_STEPS;

  console.log(`=== Skyhold Isles CI${full ? ' (full QA pass)' : ''} ===\n`);
  const summary = executeCiSuite(steps, failFast);

  for (const line of formatCiSummaryLines(summary)) {
    console.log(line);
  }

  if (!summary.allPassed) {
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('ci.ts')) {
  main();
}
