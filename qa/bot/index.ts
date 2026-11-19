import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { InvariantKind } from './invariants.ts';
import { runBotScenario, type ScenarioResult } from './runner.ts';
import { buildBotScenarios, type StrategyFamily } from './strategies.ts';

export interface QaBotRunSummary {
  readonly totalScenarios: number;
  readonly passedScenarios: number;
  readonly failedScenarios: number;
  readonly totalTicks: number;
  readonly determinismReplays: number;
  readonly elapsedSec: number;
  readonly byFamily: Readonly<Record<StrategyFamily, { total: number; passed: number; failed: number }>>;
  readonly violationsByKind: Readonly<Partial<Record<InvariantKind, number>>>;
  readonly failedResults: readonly ScenarioResult[];
}

export interface QaBotOptions {
  readonly quick?: boolean;
  readonly levelIds?: readonly string[] | null;
  readonly jobs?: number;
}

async function runWithChildWorkers(opts: QaBotOptions, jobs: number): Promise<ScenarioResult[]> {
  const workerPath = fileURLToPath(new URL('./worker.ts', import.meta.url));
  const tsxCli = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url));
  const promises: Promise<ScenarioResult[]>[] = [];

  for (let w = 0; w < jobs; w++) {
    promises.push(
      new Promise<ScenarioResult[]>((resolve, reject) => {
        const arg = JSON.stringify({
          quick: opts.quick,
          levelIds: opts.levelIds ?? null,
          startIdx: w,
          step: jobs,
        });
        const child = spawn(process.execPath, [tsxCli, workerPath, arg], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const chunks: Buffer[] = [];
        const errChunks: Buffer[] = [];
        child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));
        child.once('error', reject);
        child.once('close', (code) => {
          if (code !== 0) {
            reject(
              new Error(
                `QA worker ${w} exited with ${code}: ${Buffer.concat(errChunks).toString('utf8')}`,
              ),
            );
            return;
          }
          try {
            const text = Buffer.concat(chunks).toString('utf8').trim();
            resolve(JSON.parse(text) as ScenarioResult[]);
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      }),
    );
  }
  const batches = await Promise.all(promises);
  return batches.flat();
}

export async function runQaBotSuite(opts: QaBotOptions = {}): Promise<QaBotRunSummary> {
  const t0 = performance.now();
  const levelFilter = opts.levelIds ? new Set(opts.levelIds) : null;
  const scenarios = buildBotScenarios({ quick: opts.quick, levelFilter });
  const requestedJobs = opts.jobs ?? Math.min(6, Math.max(1, availableParallelism()));
  const jobs = Math.min(requestedJobs, Math.max(1, scenarios.length));

  let results: ScenarioResult[];
  if (jobs <= 1) {
    results = scenarios.map((sc) => runBotScenario(sc));
  } else {
    try {
      results = await runWithChildWorkers(opts, jobs);
    } catch {
      results = scenarios.map((sc) => runBotScenario(sc));
    }
  }

  const order = new Map<string, number>();
  for (let i = 0; i < scenarios.length; i++) order.set(scenarios[i].id, i);
  results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const families: readonly StrategyFamily[] = [
    'greedy',
    'weak',
    'abilities',
    'hero',
    'challenge',
    'daily',
    'endless',
  ];
  const byFamily = Object.fromEntries(
    families.map((f) => [f, { total: 0, passed: 0, failed: 0 }]),
  ) as Record<StrategyFamily, { total: number; passed: number; failed: number }>;

  const violationsByKind: Partial<Record<InvariantKind, number>> = {};
  const failedResults: ScenarioResult[] = [];
  let totalTicks = 0;
  let passedScenarios = 0;
  let determinismReplays = 0;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    totalTicks += r.ticks;
    if (r.determinismVerified) determinismReplays++;
    const fam = byFamily[r.family];
    fam.total++;
    if (r.violations.length === 0) {
      passedScenarios++;
      fam.passed++;
    } else {
      fam.failed++;
      failedResults.push(r);
      for (let v = 0; v < r.violations.length; v++) {
        const k = r.violations[v].kind;
        violationsByKind[k] = (violationsByKind[k] ?? 0) + 1;
      }
    }
  }

  return {
    totalScenarios: results.length,
    passedScenarios,
    failedScenarios: failedResults.length,
    totalTicks,
    determinismReplays,
    elapsedSec: (performance.now() - t0) / 1000,
    byFamily,
    violationsByKind,
    failedResults,
  };
}

function parseCliArgs(argv: readonly string[]): QaBotOptions & { json: boolean; verbose: boolean } {
  const quick = argv.includes('--quick');
  const json = argv.includes('--json');
  const verbose = argv.includes('--verbose');
  const islandsRaw = argv.find((a) => a.startsWith('--islands='))?.slice('--islands='.length);
  const jobsRaw = argv.find((a) => a.startsWith('--jobs='))?.slice('--jobs='.length);
  const levelIds = islandsRaw
    ? islandsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
  const parsedJobs = jobsRaw ? Number(jobsRaw) : undefined;
  const jobs = parsedJobs !== undefined && Number.isFinite(parsedJobs) && parsedJobs >= 1 ? Math.floor(parsedJobs) : undefined;
  return { quick, levelIds, jobs, json, verbose };
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const summary = await runQaBotSuite(args);

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failedScenarios > 0) process.exit(1);
    return;
  }

  console.log('=== Skyhold Isles Headless QA Bot ===');
  console.log(
    `Scenarios: ${summary.passedScenarios}/${summary.totalScenarios} passed | ` +
      `Sim ticks: ${summary.totalTicks.toLocaleString('en-US')} | ` +
      `Determinism replays: ${summary.determinismReplays} | ` +
      `Time: ${summary.elapsedSec.toFixed(2)}s`,
  );
  console.log('By strategy:');
  for (const [fam, counts] of Object.entries(summary.byFamily)) {
    if (counts.total === 0) continue;
    const status = counts.failed === 0 ? 'OK  ' : 'FAIL';
    console.log(
      `  [${status}] ${fam.padEnd(10)} ${String(counts.passed).padStart(3)}/${String(counts.total).padStart(3)}`,
    );
  }

  if (summary.failedScenarios > 0) {
    console.error(`\nInvariant violations by kind: ${JSON.stringify(summary.violationsByKind)}`);
    const limit = args.verbose ? summary.failedResults.length : Math.min(20, summary.failedResults.length);
    for (let i = 0; i < limit; i++) {
      const f = summary.failedResults[i];
      const v0 = f.violations[0];
      console.error(`  - ${f.id} [tick ${v0.tick}, ${v0.kind}]: ${v0.message}`);
      if (args.verbose) {
        for (let k = 1; k < f.violations.length; k++) {
          const vk = f.violations[k];
          console.error(`      [tick ${vk.tick}, ${vk.kind}]: ${vk.message}`);
        }
      }
    }
    if (summary.failedResults.length > limit) {
      console.error(`  ... and ${summary.failedResults.length - limit} more failed scenarios (pass --verbose)`);
    }
    process.exit(1);
  }

  console.log('QA bot PASSED: 0 invariant violations across all islands and strategies.');
}

if (process.argv[1]?.endsWith('qa/bot/index.ts') || process.argv[1]?.endsWith('qa\\bot\\index.ts')) {
  void main();
}
