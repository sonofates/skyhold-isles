import { runBotScenario, type ScenarioResult } from './runner.ts';
import { buildBotScenarios } from './strategies.ts';

interface WorkerPayload {
  readonly quick?: boolean;
  readonly levelIds?: readonly string[] | null;
  readonly startIdx: number;
  readonly step: number;
}

const raw = process.argv[2];
if (!raw) process.exit(2);
const payload = JSON.parse(raw) as WorkerPayload;
const scenarios = buildBotScenarios({
  quick: payload.quick,
  levelFilter: payload.levelIds ? new Set(payload.levelIds) : null,
});

const results: ScenarioResult[] = [];
for (let i = payload.startIdx; i < scenarios.length; i += payload.step) {
  results.push(runBotScenario(scenarios[i]));
}

process.stdout.write(JSON.stringify(results) + '\n');
