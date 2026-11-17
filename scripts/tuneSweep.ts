/**
 * Dev tool: evaluates many TOWER_DEFS override sets in one process and prints one line each
 * (greedy lives per island, failure count). Configs come from a JSON file:
 *   [{"name":"x","o":[{"t":"archer","tier":3,"f":"damage","v":30}]}, ...]
 *   npx tsx scripts/tuneSweep.ts /tmp/configs.json
 */
import { readFileSync } from 'node:fs';
import { LEVELS } from '../src/data/levels/index.ts';
import { TOWER_DEFS, TOWER_TYPES } from '../src/data/towers.ts';
import { evaluateBalance } from './balanceSim.ts';
import { applyOverrides } from './tuneTowers.ts';

const configs = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { name: string; o: never[] }[];
const baseline = TOWER_TYPES.map((t) => JSON.parse(JSON.stringify(TOWER_DEFS[t].tiers)) as Record<string, number>[]);
const only = process.env.LEVELS ? new Set(process.env.LEVELS.split(',').map((x) => Number(x) - 1)) : null;

for (const cfg of configs) {
  TOWER_TYPES.forEach((t, i) => {
    TOWER_DEFS[t].tiers.forEach((tier, k) => {
      const dst = tier as unknown as Record<string, number>;
      for (const key of Object.keys(dst)) delete dst[key];
      Object.assign(dst, baseline[i][k]);
    });
  });
  applyOverrides(cfg.o);
  const { summary, failures } = evaluateBalance(only, false);
  const lives = summary.map((line) => {
    const m = /^(L\d+)\s+\S+\s+greedy ([WL?])\s*(\d+)L/.exec(line);
    return m ? `${m[1]}:${m[2] === 'W' ? m[3] : 'X'}` : '??';
  });
  void LEVELS;
  console.log(`${cfg.name.padEnd(34)} ${lives.join(' ')} | fails=${failures.length}${failures.length ? ' ' + failures.map((f) => f.split(' ').slice(0, 2).join('')).join(',') : ' PASS'}`);
}
