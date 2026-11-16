/**
 * Dev tool: applies runtime overrides to TOWER_DEFS and prints greedy/weak results for every island, to hunt for
 * tower stat tweaks that keep every balance window green. Not part of CI.
 *
 *   OVERRIDES='[{"t":"archer","tier":3,"f":"damage","v":30}]' npx tsx scripts/tuneTowers.ts
 *   OVERRIDES='[{"t":"archer","tier":3,"f":"damage","m":0.9}]' ...     (m = multiply)
 */
import type { TowerType } from '../src/core/types.ts';
import { TOWER_DEFS } from '../src/data/towers.ts';
import { evaluateBalance } from './balanceSim.ts';

interface Override {
  t: TowerType;
  tier: 1 | 2 | 3;
  f: string;
  v?: number;
  m?: number;
}

export function applyOverrides(list: readonly Override[]): void {
  for (const o of list) {
    const stats = TOWER_DEFS[o.t].tiers[o.tier - 1] as unknown as Record<string, number>;
    if (o.v !== undefined) stats[o.f] = o.v;
    else if (o.m !== undefined) stats[o.f] = (stats[o.f] ?? 0) * o.m;
  }
}

if (process.argv[1]?.endsWith('tuneTowers.ts')) {
  const overrides: Override[] = process.env.OVERRIDES ? (JSON.parse(process.env.OVERRIDES) as Override[]) : [];
  applyOverrides(overrides);
  const only = process.env.LEVELS ? new Set(process.env.LEVELS.split(',').map((x) => Number(x) - 1)) : null;
  const t0 = Date.now();
  const { summary, failures } = evaluateBalance(only, false);
  for (const line of summary) console.log(line);
  console.log(failures.length === 0 ? 'PASS' : `FAIL (${failures.length}):\n - ${failures.join('\n - ')}`);
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
