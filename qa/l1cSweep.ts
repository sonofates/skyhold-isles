// Dev helper: sweep l1c HP scale/growth (npx tsx qa/l1cSweep.ts). Not part of the gate.
import { LEVEL_L1C } from '../src/data/levels2d/index.ts';
import { runLevelBalanceSim } from '../scripts/balanceSim.ts';

const hps = (process.env.HPS ?? '1.2,1.4,1.6,1.8,2.0').split(',').map(Number);
const gs = (process.env.GS ?? '0.1,0.14,0.18').split(',').map(Number);
for (const hp of hps) {
  for (const g of gs) {
    const lvl = { ...LEVEL_L1C, enemyHpScale: hp, waveHpGrowth: g };
    const gr = runLevelBalanceSim(lvl, 'greedy', lvl.scriptedBuildOrder ?? []);
    const wk = runLevelBalanceSim(lvl, 'weak', lvl.weakBuildOrder ?? []);
    const peaks = gr.waves.map((w) => Math.round(w.peakGroundProgress * 100)).join(' ');
    console.log(
      `hp ${hp} g ${g}: greedy ${gr.outcome} ${gr.finalLives} hoard ${gr.lastWaveHoardPct.toFixed(0)}% rem ${gr.unspentScriptActions} | ` +
        `weak ${wk.outcome} ${wk.finalLives} @${wk.waves.length} | peaks ${peaks}`,
    );
  }
}
