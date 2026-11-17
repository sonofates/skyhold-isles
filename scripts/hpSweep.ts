/**
 * Sweeps `enemyHpScale` (and optionally `waveHpGrowth`) for one level and prints greedy / weak outcomes, to find
 * the scale that lands in the difficulty window and how steep the cliff around it is.
 *
 *   npx tsx scripts/hpSweep.ts --level=14 --scales=2.2,2.3,2.4 [--growth=0.06,0.08]
 *
 * Tip: a low `waveHpGrowth` (0.06-0.08) with a high scale removes the "everything dies on the last wave" cliff.
 */
import { LEVELS, type LevelDef } from '../src/data/levels/index.ts';
import { runLevelBalanceSim } from './balanceSim.ts';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const level = LEVELS[Number(arg('level')) - 1];
if (!level) {
  console.error('usage: tsx scripts/hpSweep.ts --level=<n> --scales=a,b,c [--growth=x,y]');
  process.exit(1);
}
const scales = (arg('scales') ?? '1,1.5,2').split(',').map(Number);
const growths = (arg('growth') ?? String(level.waveHpGrowth ?? 0.2)).split(',').map(Number);

for (const g of growths) {
  for (const k of scales) {
    const l: LevelDef = { ...level, enemyHpScale: k, waveHpGrowth: g };
    const a = runLevelBalanceSim(l, 'greedy', l.scriptedBuildOrder ?? []);
    const b = runLevelBalanceSim(l, 'weak', l.weakBuildOrder ?? []);
    console.log(
      `hp ${k} g ${g}: greedy ${a.outcome} lives ${a.finalLives} reached ${a.waves.length}/${l.waves.length} ` +
        `hoard ${a.lastWaveHoardPct.toFixed(0)}% | weak ${b.outcome} lives ${b.finalLives} reached ${b.waves.length}`,
    );
  }
}
