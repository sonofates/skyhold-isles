// Dev probe: builds a level's full greedy script with unlimited gold, then plays endless (auto-wave).
// Usage: LVL=9 npx tsx scripts/endlessProbe.ts
import { EventBus } from '../src/core/eventBus.ts';
import { BALANCE } from '../src/data/balance.ts';
import { LEVELS } from '../src/data/levels/index.ts';
import { SimWorld } from '../src/sim/world.ts';

const lvl = LEVELS[Number(process.env.LVL ?? 9) - 1];
const ev = new EventBus();
const w = new SimWorld(lvl, ev);
w.gold = 99999;
for (const a of lvl.scriptedBuildOrder ?? []) {
  if (a.action === 'build') w.placeTower(a.col, a.row, a.towerType!, a.targetingMode);
  else {
    const id = w.grid.getTowerIdAt(a.col, a.row);
    if (id >= 0) w.upgradeTower(id);
  }
}
const counts: Record<string, number> = {};
ev.on('enemyKilled', (e) => {
  counts[e.enemyType] = (counts[e.enemyType] ?? 0) + 1;
});
ev.on('waveStarted', (e) => console.log('wave', e.waveIndex + 1, 'endless', e.endless, 'lives', w.lives));
w.waveSystem.skipToWave(lvl.waves.length);
for (let t = 0; t < 60 * 400 && w.outcome === 'ongoing'; t++) w.fixedTick(BALANCE.fixedDt);
console.log('outcome', w.outcome, w.lives);
w.enterEndlessMode();
w.setAutoWave(true);
for (let t = 0; t < 60 * 900 && w.outcome === 'ongoing'; t++) w.fixedTick(BALANCE.fixedDt);
console.log('end', w.outcome, 'wave', w.waveSystem.currentWaveOneBased, JSON.stringify(counts));
