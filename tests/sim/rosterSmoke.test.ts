import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { TOWER_DEFS, TOWER_TYPES } from '../../src/data/towers.ts';
import { SimWorld } from '../../src/sim/world.ts';

describe('full tower roster', () => {
  it('maxed roster survives 3 minutes of real waves without NaNs; shooters deal damage, beacon does not', () => {
    const world = new SimWorld(LEVELS[1], new EventBus());
    world.gold = 100000;
    const spots: Array<{ col: number; row: number }> = [];
    for (let r = 0; r < LEVELS[1].rows; r++) {
      for (let c = 0; c < LEVELS[1].cols; c++) {
        if (world.grid.canPlaceTower(c, r)) spots.push({ col: c, row: r });
      }
    }
    // Contiguous run of free tiles so the beacon has neighbours.
    const mid = Math.floor(spots.length / 2);
    const picks = spots.slice(mid, mid + TOWER_TYPES.length);
    TOWER_TYPES.forEach((type, i) => {
      const t = world.placeTower(picks[i].col, picks[i].row, type);
      expect(t).not.toBeNull();
      world.upgradeTower(t!.id);
      world.upgradeTower(t!.id);
    });
    world.startNextWave();
    for (let i = 0; i < 60 * 180 && world.outcome === 'ongoing'; i++) world.fixedTick(BALANCE.fixedDt);

    for (const t of world.towers) {
      expect(Number.isFinite(t.cooldownTimer)).toBe(true);
      expect(Number.isFinite(t.yaw)).toBe(true);
      expect(Number.isFinite(t.totalDamageDealt)).toBe(true);
      if (TOWER_DEFS[t.type].role === 'support') expect(t.totalDamageDealt).toBe(0);
    }
    const dealt = world.towers.filter((t) => t.totalDamageDealt > 0).length;
    expect(dealt).toBeGreaterThanOrEqual(3);
  });
});
