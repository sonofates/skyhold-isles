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
