import type { ScriptedBuildAction } from '../src/data/levels/types.ts';
import { L1C_SCRIPTS_NO_BARRACKS, LEVEL_L1C } from '../src/data/levels2d/l1c.ts';
import { runLevelBalanceSim, type SimRunResult } from './balanceSim.ts';

/**
 * Barracks on/off on L1c (informational): the shipped scripts (barracks on plots 14 and 12) vs
 * the same scripts with the pre-barracks towers (cannon 14, archer 12). Greedy is already at
 * 20/20 lives either way, so it also prints per-wave peak road progress (how close the nearest
 * foe got to the gate) and a lives sweep over enemy HP x0.94..x1.06.
 *
 *   npx tsx scripts/barracksCompare.ts
 */
type Kind = 'greedy' | 'weak';

function line(tag: string, r: SimRunResult): string {
  const leaks = r.waves.map((w) => w.livesLost).join('');
  const peaks = r.waves.map((w) => String(Math.round(w.peakGroundProgress * 100)).padStart(3)).join('');
  return `${tag.padEnd(14)} ${r.outcome === 'won' ? 'W' : 'L'} ${String(r.finalLives).padStart(2)}L ${r.stars}*  leaks/wave ${leaks}  peak%/wave${peaks}`;
}

function sweep(kind: Kind, script: readonly ScriptedBuildAction[]): string {
  const cells: string[] = [];
  for (const k of [0.94, 0.97, 1.0, 1.03, 1.06]) {
    const level = { ...LEVEL_L1C, enemyHpScale: (LEVEL_L1C.enemyHpScale ?? 1) * k };
    const r = runLevelBalanceSim(level, kind, script);
    cells.push(`x${k.toFixed(2)}:${r.outcome === 'won' ? r.finalLives : 'LOST'}`);
  }
  return cells.join(' ');
}

function main(): void {
  console.log('=== L1c barracks on/off (lives left out of 20) ===');
  const on = { greedy: LEVEL_L1C.scriptedBuildOrder ?? [], weak: LEVEL_L1C.weakBuildOrder ?? [] };
  for (const kind of ['greedy', 'weak'] as const) {
    const rOn = runLevelBalanceSim(LEVEL_L1C, kind, on[kind]);
    const rOff = runLevelBalanceSim(LEVEL_L1C, kind, L1C_SCRIPTS_NO_BARRACKS[kind]);
    console.log(line(`${kind} on`, rOn));
    console.log(line(`${kind} off`, rOff));
    console.log(`${''.padEnd(14)} HP sweep on : ${sweep(kind, on[kind])}`);
    console.log(`${''.padEnd(14)} HP sweep off: ${sweep(kind, L1C_SCRIPTS_NO_BARRACKS[kind])}`);
  }
}

if (process.argv[1]?.endsWith('barracksCompare.ts')) main();
