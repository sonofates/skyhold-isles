/**
 * Dev tool: swaps towers in the greedy scripts for the new ones and prints the result, to sanity-check that
 * Ballista / Beacon are viable but do not trivialise any island. Not part of CI.
 *   npx tsx scripts/towerExperiment.ts
 */
import { LEVELS, type ScriptedBuildAction } from '../src/data/levels/index.ts';
import type { TowerType } from '../src/core/types.ts';
import { BALANCE } from '../src/data/balance.ts';
import { EventBus } from '../src/core/eventBus.ts';
import { SimWorld } from '../src/sim/world.ts';
import type { LevelDef } from '../src/data/levels/index.ts';
import { runLevelBalanceSim } from './balanceSim.ts';

/** Adds one Beacon (built mid-script, upgraded twice later) on the free tile covering the most scripted towers. */
function addBeacon(level: LevelDef, script: readonly ScriptedBuildAction[], fraction: number): ScriptedBuildAction[] {
  const grid = new SimWorld(level, new EventBus()).grid;
  const towers = script.filter((a) => a.action === 'build');
  const taken = new Set(towers.map((t) => `${t.col},${t.row}`));
  let best: { col: number; row: number; n: number } | null = null;
  for (let c = 0; c < level.cols; c++) {
    for (let r = 0; r < level.rows; r++) {
      if (!grid.canPlaceTower(c, r) || taken.has(`${c},${r}`)) continue;
      let n = 0;
      for (const t of towers) {
        const d = Math.hypot((t.col - c) * BALANCE.tileSize, (t.row - r) * BALANCE.tileSize);
        if (d <= 4.0) n++;
      }
      if (!best || n > best.n) best = { col: c, row: r, n };
    }
  }
  if (!best) return [...script];
  const at = Math.floor(script.length * fraction);
  const w = script[Math.min(script.length - 1, at)].waveIndex;
  const out = [...script];
  out.splice(at, 0, { waveIndex: w, action: 'build', col: best.col, row: best.row, towerType: 'beacon' });
  out.splice(Math.min(out.length, at + 6), 0, { waveIndex: w, action: 'upgrade', col: best.col, row: best.row });
  out.splice(Math.min(out.length, at + 12), 0, { waveIndex: w, action: 'upgrade', col: best.col, row: best.row });
  return out;
}
let currentLevel: LevelDef = LEVELS[0];

function swapPositions(
  script: readonly ScriptedBuildAction[],
  from: TowerType,
  to: TowerType,
  every: number,
): ScriptedBuildAction[] {
  // Collect positions of `from` builds, choose every Nth, retarget builds (upgrades follow by position).
  const chosen = new Set<string>();
  let n = 0;
  for (const a of script) {
    if (a.action === 'build' && a.towerType === from) {
      if (n % every === every - 1 || every === 1) chosen.add(`${a.col},${a.row}`);
      n++;
    }
  }
  return script.map((a) =>
    a.action === 'build' && chosen.has(`${a.col},${a.row}`) ? { ...a, towerType: to } : a,
  );
}

const variants: { name: string; build: (s: readonly ScriptedBuildAction[]) => ScriptedBuildAction[] }[] = [
  { name: 'baseline', build: (s) => [...s] },
  { name: 'mortar->ballista (all)', build: (s) => swapPositions(s, 'mortar', 'ballista', 1) },
  { name: 'every 3rd archer->ballista', build: (s) => swapPositions(s, 'archer', 'ballista', 3) },
  { name: 'every 2nd cannon->beacon', build: (s) => swapPositions(s, 'cannon', 'beacon', 2) },
  { name: 'every 3rd archer->beacon', build: (s) => swapPositions(s, 'archer', 'beacon', 3) },
  { name: '+1 beacon @40% script', build: (s) => addBeacon(currentLevel, s, 0.4) },
  { name: '+1 beacon @70% script', build: (s) => addBeacon(currentLevel, s, 0.7) },
];

const only = process.env.LEVELS ? new Set(process.env.LEVELS.split(',').map((x) => Number(x) - 1)) : null;
for (const v of variants) {
  const row: string[] = [];
  for (let i = 0; i < LEVELS.length; i++) {
    if (only && !only.has(i)) continue;
    currentLevel = LEVELS[i];
    const r = runLevelBalanceSim(LEVELS[i], 'greedy', v.build(LEVELS[i].scriptedBuildOrder ?? []));
    row.push(`L${i + 1}:${r.outcome === 'won' ? r.finalLives : 'X' + r.waves.length}${r.invalidActions ? '!' + r.invalidActions : ''}`);
  }
  console.log(v.name.padEnd(30), row.join(' '));
}
