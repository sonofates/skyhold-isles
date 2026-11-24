import { expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/l1c.ts';
import { parseSimReplay, serializeSimReplay, SimReplayPlayer, SimWorld } from '../../src/sim/world.ts';

const entrance = { id: 'road', x: 9, z: 0 };
const goal = { x: -9, z: 0 };
const road = [entrance, goal];
const encounter: LevelDef = {
  ...LEVEL_L1C, id: 'beacon-overlap', startingGold: 1500,
  layout2d: {
    ...LEVEL_L1C.layout2d!, entrances: [entrance], paths: [road], flightPath: road, goal,
    plots: [{ x: 0, z: -1 }, { x: 0, z: -5.6 }, { x: -5.6, z: -1 }],
  },
  waves: Array.from({ length: 3 }, () => ({
    clearBonus: 15, groups: [{ enemyType: 'golem', count: 1, spawnInterval: 1, startDelay: 0 }],
  })),
};

function recordShots(world: SimWorld) {
  const shots: { tick: number; distance: number; previousDistance: number }[] = [];
  world.events.on('towerFired', ({ x, z }) => {
    const golem = world.enemyPool.items[world.enemyPool.getActiveIndex(0)];
    shots.push({
      tick: world.tick,
      distance: Math.hypot(golem.x - x, golem.z - z),
      previousDistance: Math.hypot(golem.prevX - x, golem.prevZ - z),
    });
  });
  return shots;
}

it.each([
  { firstSale: 'tailwind', remainingRange: 7.15, remainingInterval: 29, saleIntervals: [28, 34] },
  { firstSale: 'horizon', remainingRange: 6.05, remainingInterval: 25, saleIntervals: [25, 32] },
] as const)('acquires and reloads under overlapping beacons when $firstSale sells first', scenario => {
  const world = new SimWorld(encounter, new EventBus(), { recordCommands: true });
  const shots = recordShots(world);
  const archer = world.placeTowerOnPlot(0, 'archer')!;
  const supports = [];
  for (const id of [scenario.firstSale, scenario.firstSale === 'tailwind' ? 'horizon' : 'tailwind'] as const) {
    const beacon = world.placeTowerOnPlot(id === 'tailwind' ? 1 : 2, 'beacon')!;
    expect(world.upgradeTower(beacon.id)).toBe(true);
    expect(world.upgradeTower(beacon.id)).toBe(true);
    expect(world.specializeTower(beacon.id, id)).toBe(true);
    expect(world.buyTowerAbility(beacon.id, id === 'tailwind' ? 'fullsail' : 'clearlens')).toBe(true);
    supports.push(beacon.id);
  }
  const ranges = [7.15, scenario.remainingRange, 5.5];
  const intervals = [25, scenario.remainingInterval, 37];
  for (let wave = 0; wave < 3; wave++) {
    const start = shots.length;
    expect(world.startNextWave()).toBe(true);
    while (shots.length < start + 6 && world.tick < 3000 && world.outcome === 'ongoing') world.fixedTick(BALANCE.fixedDt);
    const opening = shots.slice(start);
    expect(opening).toHaveLength(6);
    // The first shot must occur on the tick the approaching golem crosses the range boundary.
    expect(opening[0].previousDistance).toBeGreaterThan(ranges[wave]);
    expect(opening[0].distance).toBeLessThanOrEqual(ranges[wave]);
    for (let i = 1; i < opening.length; i++) expect(opening[i].tick - opening[i - 1].tick).toBe(intervals[wave]);

    if (wave < supports.length) {
      // Ten ticks of this reload have already elapsed when the player sells the beacon.
      for (let i = 0; i < 10; i++) world.fixedTick(BALANCE.fixedDt);
      expect(world.sellTower(supports[wave])).toBeGreaterThan(0);
    }
    while (world.outcome === 'ongoing' && world.waveSystem.state !== 'betweenWaves' && world.tick < 3000) {
      world.fixedTick(BALANCE.fixedDt);
    }
    if (wave < supports.length) {
      expect(shots[start + 6].tick - opening[5].tick).toBe(scenario.saleIntervals[wave]);
    }
  }
  expect(world.outcome).toBe('won');
  expect(archer.shotCount).toBe(shots.length);

  const replay = new SimReplayPlayer(encounter, parseSimReplay(serializeSimReplay(world.exportReplay()))!);
  const replayShots = recordShots(replay.world);
  expect(replay.runToEnd()).toMatchObject({ matchesHash: true, matchesOutcome: true });
  expect(replayShots).toEqual(shots);
  replay.dispose();
  world.dispose();
});

function recordSoldierHits(world: SimWorld) {
  const hits: { tick: number; soldierId: number; enemyId: number; damage: number }[] = [];
  world.events.on('soldierAttack', ({ soldierId, enemyId, damage }) => {
    hits.push({ tick: world.tick, soldierId, enemyId, damage });
  });
  return hits;
}

it.each([
  { action: 'specialize', ticksInContact: 2, newRate: 1.38, ticksToHit: 6 },
  { action: 'buy Full Sail', ticksInContact: 15, newRate: 1.48, ticksToHit: 27 },
  { action: 'sell', ticksInContact: 1, newRate: 1, ticksToHit: 10 },
] as const)('uses the current beacon rate for an engaged guard after $action', scenario => {
  const level = { ...encounter, startingGold: 3000, enemyHpScale: 3, waves: encounter.waves.slice(0, 1) };
  const world = new SimWorld(level, new EventBus(), { recordCommands: true });
  const hits = recordSoldierHits(world);
  const barracks = world.placeTowerOnPlot(0, 'barracks')!;
  const beacon = world.placeTowerOnPlot(1, 'beacon')!;
  for (const tower of [barracks, beacon]) {
    expect(world.upgradeTower(tower.id)).toBe(true);
    expect(world.upgradeTower(tower.id)).toBe(true);
  }
  expect(world.specializeTower(barracks.id, 'gateward')).toBe(true);
  expect(world.buyTowerAbility(barracks.id, 'ironmantle')).toBe(true);
  if (scenario.action !== 'specialize') expect(world.specializeTower(beacon.id, 'tailwind')).toBe(true);
  if (scenario.action === 'sell') expect(world.buyTowerAbility(beacon.id, 'fullsail')).toBe(true);
  expect(world.startNextWave()).toBe(true);

  const guard = world.soldierSystem.getBarracks(barracks.id)!.squad[0];
  while (guard.state !== 'fighting' && world.tick < 900) world.fixedTick(BALANCE.fixedDt);
  expect(guard.state).toBe('fighting');
  // At these points in the swing, one tick at the old rate shifts the next hit by a full tick.
  for (let i = 0; i < scenario.ticksInContact; i++) world.fixedTick(BALANCE.fixedDt);
  const before = guard.attackTimer;
  const commandTick = world.tick;
  if (scenario.action === 'specialize') expect(world.specializeTower(beacon.id, 'tailwind')).toBe(true);
  if (scenario.action === 'buy Full Sail') expect(world.buyTowerAbility(beacon.id, 'fullsail')).toBe(true);
  if (scenario.action === 'sell') expect(world.sellTower(beacon.id)).toBeGreaterThan(0);
  world.fixedTick(BALANCE.fixedDt);
  expect(before - guard.attackTimer).toBeCloseTo(BALANCE.fixedDt * scenario.newRate, 12);
  while (world.outcome === 'ongoing' && world.tick < 3000) world.fixedTick(BALANCE.fixedDt);
  expect(hits.find(hit => hit.soldierId === guard.id && hit.tick > commandTick)?.tick)
    .toBe(commandTick + scenario.ticksToHit);
  expect(world).toMatchObject({ outcome: 'won', enemiesKilledTotal: 1 });
  const replay = new SimReplayPlayer(level, parseSimReplay(serializeSimReplay(world.exportReplay()))!);
  const replayHits = recordSoldierHits(replay.world);
  expect(replay.runToEnd()).toMatchObject({ matchesHash: true, matchesOutcome: true });
  expect(replayHits).toEqual(hits);
  replay.dispose();
  world.dispose();
});

it('uses the current Horizon range for rally orders issued on the same tick as a purchase or sale', () => {
  const world = new SimWorld(encounter, new EventBus());
  let barracks = world.placeTowerOnPlot(0, 'barracks')!;
  const beacon = world.placeTowerOnPlot(2, 'beacon')!;
  expect(world.upgradeTower(beacon.id)).toBe(true);
  expect(world.upgradeTower(beacon.id)).toBe(true);
  function checkRally(range: number) {
    expect(world.setRallyPoint(barracks.id, goal.x, goal.z)).toBe(true);
    const squad = world.soldierSystem.getBarracks(barracks.id)!;
    expect(squad.rallyX).toBeLessThan(barracks.x);
    const distance = Math.hypot(squad.rallyX - barracks.x, squad.rallyZ - barracks.z);
    // The road is sampled at 0.05-unit intervals.
    expect(distance).toBeLessThanOrEqual(range);
    expect(distance).toBeGreaterThan(range - 0.05);
  }
  checkRally(3.2);
  expect(world.specializeTower(beacon.id, 'horizon')).toBe(true);
  checkRally(3.2 * 1.2);
  expect(world.buyTowerAbility(beacon.id, 'clearlens')).toBe(true);
  checkRally(3.2 * 1.3);
  expect(world.sellTower(barracks.id)).toBeGreaterThan(0);
  barracks = world.placeTowerOnPlot(0, 'barracks')!;
  checkRally(3.2 * 1.3);
  expect(world.sellTower(beacon.id)).toBeGreaterThan(0);
  checkRally(3.2);
  world.dispose();
});

it('selling a plain tier-III beacon drops its range aura at once (a rally cannot use the sold reach)', () => {
  const world = new SimWorld(encounter, new EventBus());
  world.gold = 5000;
  const barracks = world.placeTowerOnPlot(0, 'barracks')!;
  const beacon = world.placeTowerOnPlot(1, 'beacon')!;
  for (const id of [barracks.id, barracks.id, beacon.id, beacon.id]) expect(world.upgradeTower(id)).toBe(true);
  world.fixedTick(BALANCE.fixedDt);
  expect(barracks.auraRange).toBeGreaterThan(0);
  expect(world.sellTower(beacon.id)).toBeGreaterThan(0);
  expect(barracks.auraRange).toBe(0);
  expect(barracks.auraRate).toBe(0);
  expect(world.setRallyPoint(barracks.id, 9, 0)).toBe(true);
  const rally = world.soldierSystem.getBarracks(barracks.id)!;
  const reach = Math.hypot(rally.rallyX - barracks.x, rally.rallyZ - barracks.z);
  expect(reach).toBeLessThanOrEqual(world.soldierSystem.getBarracks(barracks.id)!.stats.range + 1e-6);
});

