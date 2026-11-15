import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { getTowerTierStats } from '../../src/data/towers.ts';
import { computeSellRefund, SimWorld } from '../../src/sim/world.ts';

function makeWorld(): { world: SimWorld; events: EventBus } {
  const events = new EventBus();
  const world = new SimWorld(LEVELS[0], events);
  world.gold = 2000;
  return { world, events };
}

describe('sell refund across tiers', () => {
  it('refunds 70% of cumulative gold invested across Tier 1, Tier 2, and Tier 3 upgrades', () => {
    expect(computeSellRefund(0)).toBe(0);
    expect(computeSellRefund(50)).toBe(35);

    const towerCases: Array<{ type: 'archer' | 'cannon' | 'frost' | 'tesla' | 'mortar'; col: number; row: number }> = [
      { type: 'archer', col: 4, row: 2 },
      { type: 'cannon', col: 4, row: 3 },
      { type: 'frost', col: 7, row: 5 },
      { type: 'tesla', col: 8, row: 5 },
      { type: 'mortar', col: 5, row: 5 },
    ];

    for (const c of towerCases) {
      for (const targetTier of [1, 2, 3] as const) {
        const { world, events } = makeWorld();
        const t = world.placeTower(c.col, c.row, c.type)!;
        expect(t).not.toBeNull();
        expect(world.grid.canPlaceTower(c.col, c.row)).toBe(false);

        let expectedInvested = getTowerTierStats(c.type, 1).upgradeCost;
        if (targetTier >= 2) {
          expect(world.upgradeTower(t.id)).toBe(true);
          expectedInvested += getTowerTierStats(c.type, 2).upgradeCost;
        }
        if (targetTier >= 3) {
          expect(world.upgradeTower(t.id)).toBe(true);
          expectedInvested += getTowerTierStats(c.type, 3).upgradeCost;
        }
        expect(t.tier).toBe(targetTier);
        expect(t.totalInvested).toBe(expectedInvested);

        let emittedRefund = -1;
        events.on('towerSold', (ev) => {
          emittedRefund = ev.refund;
        });

        const goldBefore = world.gold;
        const refund = world.sellTower(t.id);
        const expectedRefund = Math.round(expectedInvested * 0.7);
        expect(refund).toBe(expectedRefund);
        expect(emittedRefund).toBe(expectedRefund);
        expect(world.gold).toBe(goldBefore + expectedRefund);
        expect(world.grid.canPlaceTower(c.col, c.row)).toBe(true);
        expect(world.getTowerById(t.id)).toBeNull();
      }
    }
  });

  it('rejects invalid placement, insufficient gold, over-tier upgrades, and ended-game sells', () => {
    const { world } = makeWorld();
    expect(world.placeTower(0, 2, 'archer')).toBeNull(); // spawn
    expect(world.placeTower(1, 2, 'archer')).toBeNull(); // path
    expect(world.placeTower(0, 1, 'archer')).toBeNull(); // decor
    expect(world.placeTower(0, 0, 'archer')).toBeNull(); // water/empty

    world.gold = 40;
    expect(world.placeTower(4, 3, 'archer')).toBeNull(); // 50g required

    world.gold = 200;
    const t = world.placeTower(4, 3, 'archer')!;
    expect(world.placeTower(4, 3, 'frost')).toBeNull(); // occupied tile
    expect(world.upgradeTower(t.id)).toBe(true);
    expect(world.upgradeTower(t.id)).toBe(true);
    expect(world.upgradeTower(t.id)).toBe(false); // already T3
    expect(world.sellTower(99999)).toBe(0); // missing tower

    world.debugForceWin();
    expect(world.sellTower(t.id)).toBe(0);
    expect(world.placeTower(4, 2, 'archer')).toBeNull();
    expect(world.upgradeTower(t.id)).toBe(false);
  });
});
