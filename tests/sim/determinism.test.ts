import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { TOWER_TYPES } from '../../src/data/towers.ts';
import { SimWorld } from '../../src/sim/world.ts';

function run(): string {
  const world = new SimWorld(LEVELS[1], new EventBus());
  world.gold = 100000;
  const spots: Array<{ col: number; row: number }> = [];
  for (let r = 0; r < LEVELS[1].rows; r++) {
    for (let c = 0; c < LEVELS[1].cols; c++) {
      if (world.grid.canPlaceTower(c, r)) spots.push({ col: c, row: r });
    }
  }
  const mid = Math.floor(spots.length / 2);
  TOWER_TYPES.forEach((type, i) => {
    const t = world.placeTower(spots[mid + i].col, spots[mid + i].row, type);
    world.upgradeTower(t!.id);
    world.upgradeTower(t!.id);
  });
  world.startNextWave();
  for (let i = 0; i < 60 * 90 && world.outcome === 'ongoing'; i++) world.fixedTick(BALANCE.fixedDt);
  return JSON.stringify({
    gold: world.gold,
    lives: world.lives,
    towers: world.towers.map((t) => [t.id, t.kills, Math.round(t.totalDamageDealt * 1000), t.shotCount]),
  });
}

describe('determinism', () => {
  it('two runs of the full 7-tower roster produce identical results', () => {
    expect(run()).toBe(run());
  });
});
