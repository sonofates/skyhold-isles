// Measures average damage per shot of lobbed-shell towers against a single moving enemy.
// Usage: npx tsx scripts/splashProbe.ts
import { EventBus } from '../src/core/eventBus.ts';
import type { EnemyType, TowerType } from '../src/core/types.ts';
import { BALANCE } from '../src/data/balance.ts';
import { LEVELS } from '../src/data/levels/index.ts';
import { getTowerTierStats } from '../src/data/towers.ts';
import { SimWorld } from '../src/sim/world.ts';

interface PathLike {
  readonly totalLength: number;
  sample(d: number, out: { x: number; y: number; z: number }): number;
}

function probe(levelIdx: number, towerType: TowerType, enemyType: EnemyType): { avg: number; shots: number } {
  const level = LEVELS[levelIdx];
  const events = new EventBus();
  const world = new SimWorld(level, events);
  world.gold = 100000;
  const stats = getTowerTierStats(towerType, 3);

  // Choose the placeable tile with the longest stretch of path inside the firing annulus.
  const gp = (world.enemySystem as unknown as { groundPath: PathLike }).groundPath;
  const samples: Array<{ x: number; z: number }> = [];
  const v = { x: 0, y: 0, z: 0 };
  for (let d = 0; d < gp.totalLength; d += 0.5) {
    gp.sample(d, v);
    samples.push({ x: v.x, z: v.z });
  }
  let best = { col: -1, row: -1, n: -1 };
  for (let r = 0; r < level.rows; r++) {
    for (let c = 0; c < level.cols; c++) {
      if (!world.grid.canPlaceTower(c, r)) continue;
      const x = world.grid.gridToWorldX(c);
      const z = world.grid.gridToWorldZ(r);
      let n = 0;
      for (const s of samples) {
        const dd = Math.hypot(s.x - x, s.z - z);
        if (dd <= stats.range && dd >= stats.minRange) n++;
      }
      if (n > best.n) best = { col: c, row: r, n };
    }
  }
  const tower = world.placeTower(best.col, best.row, towerType, 'first');
  if (!tower) throw new Error('place failed');
  world.upgradeTower(tower.id);
  world.upgradeTower(tower.id);

  let shots = 0;
  events.on('towerFired', () => shots++);
  world.enemySystem.spawnEnemy(enemyType, 5000);
  for (let i = 0; i < 60 * 120 && world.lives === BALANCE.startingLives; i++) world.fixedTick(BALANCE.fixedDt);
  return { avg: shots > 0 ? tower.totalDamageDealt / shots : 0, shots };
}

for (const t of ['mortar', 'cannon'] as const) {
  const nominal = getTowerTierStats(t, 3).damage;
  for (const e of ['runner', 'grunt'] as const) {
    const rows: string[] = [];
    for (const li of [0, 2, 5]) {
      const r = probe(li, t, e);
      rows.push(`L${li + 1}:${r.avg.toFixed(1)} (${r.shots} shots)`);
    }
    console.log(`T3 ${t} vs ${e}: nominal ${nominal} | avg dmg/shot ${rows.join(' | ')}`);
  }
}
