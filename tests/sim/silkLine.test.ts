import { expect, it } from 'vitest';
import { runLevelBalanceSim } from '../../scripts/balanceSim.ts';
import { campaignKit } from '../../scripts/lib/campaignKit.ts';
import { balanceBuildOrder } from '../../scripts/lib/specializationBuilds.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { I16 } from '../../src/data/levels2d/i16.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/l1c.ts';
import { parseSimReplay, serializeSimReplay, SimReplayPlayer, SimWorld } from '../../src/sim/world.ts';

// The golems march west at equal speed. Both spawn order and left-to-right grid traversal
// encounter distant targets before the ones nearest the primary.
function loomEncounter(offsets: number[]): LevelDef {
  const goal = { x: 0, z: 5 };
  const entrances = offsets.map(offset => ({ id: String(offset), x: 19 - offset, z: 5 }));
  return {
    ...LEVEL_L1C, id: 'laneweaver-loom', startingGold: 1200, enemyHpScale: 0.9,
    layout2d: {
      ...LEVEL_L1C.layout2d!, entrances, goal, paths: entrances.map(e => [e, goal]),
      plots: [{ x: 22, z: 5 }],
    },
    waves: [{ clearBonus: 15, groups: entrances.map((_, lane) => ({
      enemyType: 'golem' as const, lane, elite: lane % 2 === 1, count: 1, startDelay: 0, spawnInterval: 1,
    })).reverse() }],
  };
}

function traceBolts(world: SimWorld) {
  const launches: number[] = [];
  type Hit = { lane: number; damage: number };
  const impacts: { tick: number; reach: number | undefined; hits: Hit[] }[] = [];
  let hits: Hit[] = [];
  world.events.on('towerFired', () => launches.push(world.tick));
  world.events.on('enemyHit', e => {
    const enemy = world.enemyPool.items.find(enemy => enemy.active && enemy.uid === e.enemyId)!;
    hits.push({ lane: enemy.lane, damage: e.damage });
  });
  world.events.on('projectileImpact', e => {
    impacts.push({ tick: world.tick, reach: e.pierce?.length, hits });
    hits = [];
  });
  return { launches, impacts };
}

it.each([
  {
    formation: 'six secondary targets in reach',
    offsets: [0, 1, 2, 3, 4, 5, 6],
    baseHits: [[0, 160], [1, 119], [2, 120], [3, 119], [4, 120]],
    silkHits: [[0, 146], [1, 159], [2, 160], [3, 159], [4, 160]],
  },
  {
    formation: 'targets straddling both range limits',
    offsets: [0, 6.39, 6.41, 7.99, 8.01],
    baseHits: [[0, 160], [1, 119]],
    silkHits: [[0, 146], [1, 159], [2, 160], [3, 159]],
  },
])('buys Silk Line in flight with $formation', ({ offsets, baseHits, silkHits }) => {
  const level = loomEncounter(offsets);
  const world = new SimWorld(level, new EventBus(), { recordCommands: true });
  const trace = traceBolts(world);
  const tower = world.placeTowerOnPlot(0, 'ballista', 'closest')!;
  expect(world.upgradeTower(tower.id)).toBe(true);
  expect(world.upgradeTower(tower.id)).toBe(true);
  expect(world.specializeTower(tower.id, 'loom')).toBe(true);
  expect(world.startNextWave()).toBe(true);

  while (!trace.launches.length && world.tick < 60) world.fixedTick(BALANCE.fixedDt);
  expect(trace.launches).toHaveLength(1);
  expect(trace.impacts).toHaveLength(0);
  expect(world.buyTowerAbility(tower.id, 'silkline')).toBe(true);

  while (trace.impacts.length < 2 && world.tick < 240) world.fixedTick(BALANCE.fixedDt);
  expect(trace.impacts.map(p => p.reach)).toEqual([6.4, 8]);
  expect(trace.impacts.map(p => p.hits.map(h => [h.lane, h.damage]))).toEqual([baseHits, silkHits]);
  expect(tower.kills).toBe(1);
  expect(tower.totalDamageDealt).toBe([...baseHits, ...silkHits].reduce((total, [, damage]) => total + damage, 0));
  expect(world.sellTower(tower.id)).toBeGreaterThan(0);

  while (world.outcome === 'ongoing' && world.tick < 1200) world.fixedTick(BALANCE.fixedDt);
  expect(world.outcome).toBe('won');
  const player = new SimReplayPlayer(level, parseSimReplay(serializeSimReplay(world.exportReplay()))!);
  const replay = traceBolts(player.world);
  expect(player.runToEnd()).toMatchObject({ matchesOutcome: true, matchesHash: true });
  expect(replay).toEqual(trace);
  player.dispose();
  world.dispose();
});

it('affords both upgraded branches in the Normal Emberglass Sanctum build', () => {
  const kit = campaignKit(1_000_000, 44);
  const result = runLevelBalanceSim(I16, 'greedy', balanceBuildOrder(I16, 'greedy'), kit);
  expect(result).toMatchObject({
    outcome: 'won', towerPurchases: ['rimeglass', 'coldfracture', 'loom', 'silkline'], invalidActions: 0,
  });
});
