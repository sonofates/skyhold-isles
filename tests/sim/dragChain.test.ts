import { expect, it } from 'vitest';
import { runLevelBalanceSim } from '../../scripts/balanceSim.ts';
import { campaignKit } from '../../scripts/lib/campaignKit.ts';
import { balanceBuildOrder } from '../../scripts/lib/specializationBuilds.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import type { EnemyType } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { I23 } from '../../src/data/levels2d/i23.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/l1c.ts';
import { SimReplayPlayer, SimWorld, parseSimReplay, serializeSimReplay } from '../../src/sim/world.ts';

const entrance = { id: 'road', x: 2, z: 5 };
const goal = { x: 21, z: 5 };
const path = [entrance, goal];
const encounter: LevelDef = {
  ...LEVEL_L1C, id: 'anchor-winch', startingGold: 1400, enemyHpScale: 10,
  layout2d: { ...LEVEL_L1C.layout2d!, plots: [{ x: 1, z: 5 }], entrances: [entrance], paths: [path], flightPath: path, goal },
  waves: [{ clearBonus: 15, groups: [
    { enemyType: 'golem', count: 1, spawnInterval: 1, startDelay: 0 },
    { enemyType: 'flyer', count: 1, spawnInterval: 1, startDelay: 0 },
  ] }],
};

function traceShots(world: SimWorld) {
  const launches: { tick: number; tier: number }[] = [];
  const hits: { tick: number; type: EnemyType; damage: number }[] = [];
  const impacts: { tick: number; pierceLength: number }[] = [];
  const cracks: number[] = [];
  world.events.on('towerFired', ({ tier }) => launches.push({ tick: world.tick, tier }));
  world.events.on('enemyHit', ({ enemyType, damage }) => hits.push({ tick: world.tick, type: enemyType, damage }));
  world.events.on('projectileImpact', ({ pierce }) => impacts.push({ tick: world.tick, pierceLength: pierce?.length ?? 0 }));
  world.events.on('armorCracked', () => cracks.push(world.tick));
  return { launches, hits, impacts, cracks };
}

function advanceUntil(world: SimWorld, condition: () => boolean) {
  while (!condition() && world.tick < 1500 && world.outcome === 'ongoing') world.fixedTick(BALANCE.fixedDt);
  expect(condition()).toBe(true);
}

it.each(['before launch', 'in flight'] as const)('resolves harpoons with Drag Chain bought %s against a golem and a flyer', timing => {
  const world = new SimWorld(encounter, new EventBus(), { recordCommands: true });
  const trace = traceShots(world);
  const tower = world.placeTowerOnPlot(0, 'ballista', 'strongest')!;
  expect(world.upgradeTower(tower.id)).toBe(true);
  expect(world.upgradeTower(tower.id)).toBe(true);
  expect(world.startNextWave()).toBe(true);

  // Both enemies follow the same line away from the ballista. The faster flyer is behind the golem from the gunner's view.
  advanceUntil(world, () => trace.launches.length === 1);
  expect(trace.impacts).toHaveLength(0);
  expect(world.specializeTower(tower.id, 'anchor')).toBe(true);
  advanceUntil(world, () => trace.impacts.length === 1);
  expect(trace.hits.map(h => [h.type, h.damage])).toEqual([['golem', 148], ['flyer', 98]]);
  expect(trace.impacts[0].pierceLength).toBe(4.4);

  const golem = world.enemyPool.items.find(e => e.active && e.type === 'golem')!;
  const flyer = world.enemyPool.items.find(e => e.active && e.type === 'flyer')!;
  expect(golem.armor).toBe(12);
  const early = timing === 'before launch';
  if (early) expect(world.buyTowerAbility(tower.id, 'dragchain')).toBe(true);
  advanceUntil(world, () => trace.launches.length === 2);
  expect(trace.impacts).toHaveLength(1);
  if (!early) expect(world.buyTowerAbility(tower.id, 'dragchain')).toBe(true);
  advanceUntil(world, () => trace.impacts.length === 2);
  expect(trace.hits.slice(2)).toEqual([{ tick: trace.impacts[1].tick, type: 'golem', damage: 230 }]);
  expect(trace.cracks).toEqual(early ? [trace.impacts[1].tick] : []);
  expect(golem).toMatchObject({
    armor: early ? 3 : 12, armorBreakTimer: early ? 2.6 : 0,
    slowRatio: early ? 0.45 : 0, slowTimer: early ? 2 : 0,
  });
  expect(flyer.slowRatio).toBe(0);

  expect(world.setTowerTargeting(tower.id, 'first')).toBe(true);
  advanceUntil(world, () => trace.launches.length === 3);
  expect(trace.impacts).toHaveLength(2);
  expect(world.sellTower(tower.id)).toBeGreaterThan(0);
  advanceUntil(world, () => trace.impacts.length === 3);
  expect(trace.launches.map(shot => shot.tier)).toEqual([3, 4, 4]);
  expect(trace.impacts.slice(1).map(p => p.pierceLength)).toEqual([0, 0]);
  expect(trace.hits.slice(3)).toEqual([{ tick: trace.impacts[2].tick, type: 'flyer', damage: 230 }]);
  expect(flyer).toMatchObject({ slowRatio: 0.45, slowTimer: 2 });

  const start = flyer.dist;
  for (let i = 0; i < 119; i++) world.fixedTick(BALANCE.fixedDt);
  expect(flyer.dist - start).toBeCloseTo(119 * BALANCE.fixedDt * flyer.speed * 0.55, 8);
  expect(flyer.slowTimer).toBeCloseTo(BALANCE.fixedDt, 8);
  advanceUntil(world, () => flyer.slowRatio === 0);
  expect(world.tick - trace.impacts[2].tick).toBeLessThanOrEqual(121);
  const released = flyer.dist;
  world.fixedTick(BALANCE.fixedDt);
  expect(flyer.dist - released).toBeCloseTo(BALANCE.fixedDt * flyer.speed, 8);
  expect(golem).toMatchObject({ armor: 12, slowRatio: 0 });
  advanceUntil(world, () => world.outcome === 'won');

  const player = new SimReplayPlayer(encounter, parseSimReplay(serializeSimReplay(world.exportReplay()))!);
  const replay = traceShots(player.world);
  expect(player.runToEnd()).toMatchObject({ matchesOutcome: true, matchesHash: true });
  expect(replay).toEqual(trace);
  player.dispose();
  world.dispose();
});

it('affords Anchor Winch and Drag Chain on the first Normal clear of Waxlight Orchard', () => {
  const result = runLevelBalanceSim(I23, 'greedy', balanceBuildOrder(I23, 'greedy'), campaignKit(1_000_000, 56));
  expect(result).toMatchObject({ outcome: 'won', towerPurchases: ['anchor', 'dragchain'], invalidActions: 0 });
});
