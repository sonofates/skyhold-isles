import { expect, it } from 'vitest';
import { runLevelBalanceSim } from '../../scripts/balanceSim.ts';
import { campaignKit } from '../../scripts/lib/campaignKit.ts';
import { balanceBuildOrder } from '../../scripts/lib/specializationBuilds.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { DIFFICULTIES } from '../../src/data/difficulty.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { I15 } from '../../src/data/levels2d/i15.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/l1c.ts';
import { combineRunModifiers } from '../../src/data/runModifiers.ts';
import { SimReplayPlayer, SimWorld, parseSimReplay, serializeSimReplay } from '../../src/sim/world.ts';

const plot = { x: 6, z: 5 };
const entrances = [{ id: 'near', x: 2, z: 5 }, { id: 'bank', x: 0.2, z: 8.55 }];
const goal = { x: 19, z: 5 };
const paths = entrances.map(e => [e, { x: 16, z: e.z }, goal]);

function encounter(lanes: number): LevelDef {
  return {
    ...LEVEL_L1C, id: 'cloudbreak-range', startingGold: 1400, enemyHpScale: 20,
    layout2d: { ...LEVEL_L1C.layout2d!, plots: [plot], entrances, paths, goal, flightPath: paths[0] },
    waves: [{
      clearBonus: 15, groups: entrances.slice(0, lanes).map((_, lane) => ({
        enemyType: 'brute', lane, count: 1, spawnInterval: 1, startDelay: 0,
      })),
    }],
  };
}

interface Shell {
  tick: number;
  targetLane: number;
  nearRoadX: number;
  hits: { lane: number; damage: number }[];
  impacts: { x: number; z: number; radius: number }[];
}

function traceShells(world: SimWorld) {
  const shells: Shell[] = [];
  world.events.on('towerFired', () => {
    // Only one mortar fires, and its shells land before it finishes reloading.
    const shell = world.projectilePool.items[world.projectilePool.getActiveIndex(0)];
    const target = world.enemyPool.items[shell.targetPoolIndex];
    const near = world.enemyPool.items.find(e => e.active && e.lane === 0);
    shells.push({ tick: world.tick, targetLane: target.lane, nearRoadX: near?.x ?? goal.x, hits: [], impacts: [] });
  });
  world.events.on('enemyHit', ({ enemyId, damage }) => {
    const brute = world.enemyPool.items.find(e => e.active && e.uid === enemyId)!;
    shells.at(-1)!.hits.push({ lane: brute.lane, damage });
  });
  world.events.on('projectileImpact', ({ x, z, radius }) => shells.at(-1)!.impacts.push({ x, z, radius }));
  return shells;
}

function setUp(lanes: number) {
  const level = encounter(lanes);
  const world = new SimWorld(level, new EventBus(), { recordCommands: true });
  const tower = world.placeTowerOnPlot(0, 'mortar', 'first')!;
  expect(world.upgradeTower(tower.id)).toBe(true);
  expect(world.upgradeTower(tower.id)).toBe(true);
  expect(world.specializeTower(tower.id, 'cloudbreak')).toBe(true);
  return { level, world, tower, shells: traceShells(world) };
}

function finishAndReplay(level: LevelDef, world: SimWorld, shells: Shell[]) {
  while (world.outcome === 'ongoing' && world.tick < 1200) world.fixedTick(BALANCE.fixedDt);
  expect(world.outcome).toBe('won');
  const playback = new SimReplayPlayer(level, parseSimReplay(serializeSimReplay(world.exportReplay()))!);
  const replayShells = traceShells(playback.world);
  expect(playback.runToEnd()).toMatchObject({ matchesHash: true, matchesOutcome: true });
  expect(replayShells).toEqual(shells);
  playback.dispose();
}

it('holds a loaded shell until the lone brute crosses the far edge of the blind spot', () => {
  const { level, world, tower, shells } = setUp(1);
  expect(world.startNextWave()).toBe(true);
  while (shells.length < 2 && world.tick < 600) world.fixedTick(BALANCE.fixedDt);
  expect(shells).toHaveLength(2);
  const [first, next] = shells;
  expect(first.nearRoadX).toBeLessThan(plot.x - 2.1);
  expect(next.tick - first.tick).toBeGreaterThan(2 / BALANCE.fixedDt);
  const brute = world.enemyPool.items[world.enemyPool.getActiveIndex(0)];
  const exit = plot.x + 2.1;
  expect(next.nearRoadX - brute.speed * BALANCE.fixedDt).toBeLessThan(exit);
  expect(next.nearRoadX).toBeGreaterThanOrEqual(exit);
  expect(tower.shotCount).toBe(2);
  finishAndReplay(level, world, shells);
  world.dispose();
});

it.each(['before launch', 'in flight', 'never'] as const)('switches roads with Stone Petals bought %s', timing => {
  const { level, world, tower, shells } = setUp(2);
  if (timing === 'before launch') expect(world.buyTowerAbility(tower.id, 'stonepetals')).toBe(true);
  expect(world.startNextWave()).toBe(true);
  while (!shells.length && world.tick < 120) world.fixedTick(BALANCE.fixedDt);
  expect(world.projectilePool.getActiveCount()).toBe(1);
  expect(shells[0].impacts).toHaveLength(0);
  if (timing === 'in flight') expect(world.buyTowerAbility(tower.id, 'stonepetals')).toBe(true);
  finishAndReplay(level, world, shells);

  const [first, second, third, fourth] = shells;
  expect(shells.slice(0, 4).map(s => s.targetLane)).toEqual([0, 1, 1, 0]);
  for (const s of [second, third]) expect(Math.abs(s.nearRoadX - plot.x)).toBeLessThan(2.1);
  expect(fourth.nearRoadX - plot.x).toBeGreaterThan(2.1);

  // The parallel roads are 3.55 units apart. Only fragments can hit across the gap.
  expect(first.hits).toEqual(timing === 'before launch'
    ? [{ lane: 0, damage: 210 }, { lane: 1, damage: 32 }] : [{ lane: 0, damage: 210 }]);
  expect(second.hits).toEqual(timing === 'never'
    ? [{ lane: 1, damage: 210 }] : [{ lane: 1, damage: 210 }, { lane: 0, damage: 30 }]);
  for (const [index, shell] of shells.entries()) {
    const fragments = shell.impacts.filter(p => p.radius === 1.7);
    const upgraded = timing === 'before launch' || (timing === 'in flight' && index > 0);
    expect(fragments).toHaveLength(upgraded ? 3 : 0);
    const craters = shell.impacts.filter(p => p.radius === 3.5);
    expect(craters).toHaveLength(1);
    for (const p of fragments) expect(Math.hypot(p.x - craters[0].x, p.z - craters[0].z)).toBeCloseTo(3, 8);
  }
  expect(tower.totalDamageDealt).toBe(shells.flatMap(s => s.hits).reduce((sum, hit) => sum + hit.damage, 0));
  world.dispose();
});

it.each(['normal', 'hard'] as const)('holds Night Freight and clears Moonwell with Stone Petals on %s', difficulty => {
  const kit = campaignKit(1_000_000, 42);
  const profile = { ...kit, modifiers: combineRunModifiers(kit.modifiers, DIFFICULTIES[difficulty].patch) };
  const result = runLevelBalanceSim(I15, 'greedy', balanceBuildOrder(I15, 'greedy'), profile);
  const nightFreight = I15.waves.findIndex(wave => wave.name === 'Night Freight');
  expect(result.waves[nightFreight]?.livesLost).toBe(0);
  expect(result).toMatchObject({ outcome: 'won', towerPurchases: ['cloudbreak', 'stonepetals'], invalidActions: 0 });
});
