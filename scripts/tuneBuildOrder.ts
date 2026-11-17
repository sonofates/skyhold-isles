/**
 * Authoring aid for a new island: hill-climbs the level's greedy build script against the balance sim and can
 * write the result back (plus a derived "weak player" script) into `src/data/levels/level<N>.ts`.
 *
 *   npx tsx scripts/tuneBuildOrder.ts --level=15 --hp=2.5 --iters=400 [--seed=7] [--write]
 *
 * - Fitness = mean greedy lives over enemy HP x{0.985, 1, 1.015} (a lost run scores by how far it got), so the
 *   script is optimised for robustness, not for one lucky HP value.
 * - Start from `node scripts/levelTool.ts`-generated orders (or any working script); `--hp` should be a bit above
 *   the HP scale you finally want, so the optimised script has headroom. Afterwards sweep with `hpSweep.ts` and
 *   pick the scale that lands in the difficulty window.
 * - `--write` rewrites scriptedBuildOrder/weakBuildOrder at the end of the level file. Weak = ~70% of the tower
 *   sites (earliest first), default targeting, half the upgrades, one wave late.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { TowerType } from '../src/core/types.ts';
import { LEVELS, parseLevelGrid, type LevelDef } from '../src/data/levels/index.ts';
import type { ScriptedBuildAction } from '../src/data/levels/types.ts';
import { runLevelBalanceSim } from './balanceSim.ts';
import { formatOrder, rankSites } from './levelTool.ts';

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const levelNo = Number(arg('level'));
const hp = Number(arg('hp'));
const iters = Number(arg('iters', '300'));
const write = process.argv.includes('--write');
let seed = Number(arg('seed', '12345')) >>> 0;
if (!Number.isFinite(levelNo) || !Number.isFinite(hp)) {
  console.error('usage: tsx scripts/tuneBuildOrder.ts --level=<n> --hp=<scale> [--iters=300] [--seed=n] [--write]');
  process.exit(1);
}

const rnd = (): number => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];

const base = LEVELS[levelNo - 1];
const grid = parseLevelGrid(base);
const sites = rankSites({ ...base, scriptedBuildOrder: [] }, 40, 3.4);
const TYPES: TowerType[] = ['archer', 'archer', 'cannon', 'cannon', 'frost', 'tesla', 'tesla', 'mortar', 'ballista', 'beacon'];

function evaluate(order: readonly ScriptedBuildAction[]): number {
  let total = 0;
  for (const k of [0.985, 1, 1.015]) {
    const lvl: LevelDef = { ...base, enemyHpScale: hp * k };
    const r = runLevelBalanceSim(lvl, 'greedy', order);
    total += r.outcome === 'won' ? r.finalLives + 20 : (r.waves.length / base.waves.length) * 20;
    total -= r.invalidActions * 50;
  }
  return total / 3;
}

function mutate(order: readonly ScriptedBuildAction[]): ScriptedBuildAction[] {
  const o = order.map((a) => ({ ...a }));
  const builds = o.filter((a) => a.action === 'build');
  const m = Math.floor(rnd() * 5);
  if (m === 0) {
    const b = pick(builds);
    b.towerType = pick(TYPES);
    b.targetingMode = b.towerType === 'mortar' || b.towerType === 'ballista' ? 'strongest' : 'first';
  } else if (m === 1) {
    const b = pick(builds);
    const used = new Set(builds.map((a) => `${a.col},${a.row}`));
    const free = sites.filter((s) => !used.has(`${s.col},${s.row}`) && grid[s.row][s.col] === 'grass');
    if (free.length === 0) return o;
    const to = pick(free);
    const { col, row } = b;
    for (const a of o) {
      if (a.col === col && a.row === row) {
        a.col = to.col;
        a.row = to.row;
      }
    }
  } else if (m === 2) {
    const a = pick(o);
    a.waveIndex = Math.max(0, Math.min(base.waves.length - 1, a.waveIndex + (rnd() < 0.5 ? -1 : 1)));
  } else if (m === 3) {
    const i = Math.floor(rnd() * (o.length - 1));
    [o[i], o[i + 1]] = [o[i + 1], o[i]];
  } else {
    const b1 = pick(builds);
    const b2 = pick(builds);
    const t = b1.towerType;
    b1.towerType = b2.towerType;
    b2.towerType = t;
  }
  // Keep the script causal: stable order by wave, and no upgrade before its tile's build.
  o.sort((x, y) => x.waveIndex - y.waveIndex);
  const built = new Set<string>();
  return o.filter((a) => {
    const key = `${a.col},${a.row}`;
    if (a.action === 'build') {
      built.add(key);
      return true;
    }
    return built.has(key);
  });
}

function deriveWeak(greedy: readonly ScriptedBuildAction[]): ScriptedBuildAction[] {
  const builds = greedy.filter((a) => a.action === 'build');
  const keep = new Set(builds.slice(0, Math.round(builds.length * 0.7)).map((b) => `${b.col},${b.row}`));
  const weak: ScriptedBuildAction[] = [];
  let upgrades = 0;
  for (const a of greedy) {
    if (!keep.has(`${a.col},${a.row}`)) continue;
    if (a.action === 'build') {
      weak.push({ waveIndex: a.waveIndex, action: 'build', col: a.col, row: a.row, towerType: a.towerType });
    } else if (++upgrades % 2 === 1) {
      weak.push({ waveIndex: a.waveIndex + 1, action: 'upgrade', col: a.col, row: a.row });
    }
  }
  return weak.sort((x, y) => x.waveIndex - y.waveIndex);
}

let best = [...(base.scriptedBuildOrder ?? [])];
let bestScore = evaluate(best);
console.log(`start ${bestScore.toFixed(2)} (${best.length} actions)`);
for (let it = 0; it < iters; it++) {
  const cand = mutate(best);
  const score = evaluate(cand);
  if (score >= bestScore) {
    if (score > bestScore) console.log(`it ${it}: ${score.toFixed(2)}`);
    best = cand;
    bestScore = score;
  }
}
console.log(`final ${bestScore.toFixed(2)}`);

if (write) {
  const file = `src/data/levels/level${levelNo}.ts`;
  const src = readFileSync(file, 'utf8');
  const start = src.indexOf('  scriptedBuildOrder: [');
  if (start < 0) throw new Error(`no scriptedBuildOrder in ${file}`);
  const weak = deriveWeak(best);
  writeFileSync(
    file,
    `${src.slice(0, start)}  scriptedBuildOrder: [\n${formatOrder(best)}\n  ],\n  weakBuildOrder: [\n${formatOrder(weak)}\n  ],\n};\n`,
  );
  console.log(`wrote ${file}: greedy ${best.length} actions, weak ${weak.length} actions`);
}
