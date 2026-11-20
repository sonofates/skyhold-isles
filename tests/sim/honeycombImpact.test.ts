import { expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/l1c.ts';
import { parseSimReplay, serializeSimReplay, SimReplayPlayer, SimWorld } from '../../src/sim/world.ts';

// Four golems march east at the same speed. At the first impact their lanes put them
// at the crater, near one charge's center, just inside two charges, and outside both.
const entrances = [
  { id: 'crater', x: 0, z: 0 },
  { id: 'charge', x: -1.87, z: 1.69 },
  { id: 'overlap', x: -0.58, z: 2.66 },
  { id: 'outside', x: -0.61, z: 2.84 },
];
const goal = { x: 16, z: 0 };
const paths = entrances.map(e => [e, { x: 11, z: e.z }, goal]);
const encounter: LevelDef = {
  ...LEVEL_L1C, id: 'honeycomb-impact', startingGold: 2000, enemyHpScale: 0.65,
  layout2d: { ...LEVEL_L1C.layout2d!, entrances, paths, goal, flightPath: paths[0], plots: [{ x: 1.5, z: -2 }] },
  waves: [{
    groups: entrances.map((_, lane) => ({ enemyType: 'golem', lane, count: 1, spawnInterval: 1, startDelay: 0 })),
    clearBonus: 15,
  }],
};

function traceShells(world: SimWorld) {
  const shells: { laneHits: number[][]; impactRadii: number[] }[] = [];
  world.events.on('towerFired', () => shells.push({ laneHits: entrances.map(() => []), impactRadii: [] }));
  world.events.on('enemyHit', ({ enemyId, damage }) => {
    const golem = world.enemyPool.items.find(e => e.active && e.uid === enemyId)!;
    shells[shells.length - 1].laneHits[golem.lane].push(damage);
  });
  world.events.on('projectileImpact', ({ radius }) => shells[shells.length - 1].impactRadii.push(radius));
  return shells;
}

it.each(['before launch', 'in flight', 'never'] as const)('resolves Honeycomb shells with Wax Caps bought %s', timing => {
  const world = new SimWorld(encounter, new EventBus(), { recordCommands: true });
  const shells = traceShells(world);
  const tower = world.placeTowerOnPlot(0, 'cannon', 'closest')!;
  expect(world.upgradeTower(tower.id)).toBe(true);
  expect(world.upgradeTower(tower.id)).toBe(true);
  expect(world.specializeTower(tower.id, 'honeycomb')).toBe(true);
  if (timing === 'before launch') expect(world.buyTowerAbility(tower.id, 'waxcaps')).toBe(true);
  expect(world.startNextWave()).toBe(true);
  while (tower.shotCount === 0 && world.tick < 120) world.fixedTick(BALANCE.fixedDt);
  expect(world.projectilePool.getActiveCount()).toBe(1);
  expect(shells[0].impactRadii).toEqual([]);
  if (timing === 'in flight') expect(world.buyTowerAbility(tower.id, 'waxcaps')).toBe(true);
  while (world.outcome === 'ongoing' && world.tick < 1200) world.fixedTick(BALANCE.fixedDt);
  expect(world.outcome).toBe('won');

  // The golems have 12 armor. Both charges in the overlap incur falloff and armor independently.
  expect(shells[0].laneHits).toEqual(timing === 'before launch'
    ? [[80], [39, 34], [14, 13], []]
    : [[80], [39, 20], [6, 6], []]);
  // The ring rotates on the next shot. The last two lanes now each take one charge.
  expect(shells[1].laneHits).toEqual(timing === 'never'
    ? [[80], [39, 18], [9], [8]]
    : [[80], [39, 30], [17], [16]]);
  for (const shell of shells) {
    expect(shell.impactRadii.filter(r => r === 1.65)).toHaveLength(5);
    expect(shell.impactRadii.filter(r => r === 2.55)).toHaveLength(1);
  }
  const creditedDamage = shells.flatMap(shell => shell.laneHits.flat()).reduce((sum, damage) => sum + damage, 0);
  expect(tower.totalDamageDealt).toBe(creditedDamage);
  expect(tower.kills).toBe(2);

  const log = parseSimReplay(serializeSimReplay(world.exportReplay()))!;
  const playback = new SimReplayPlayer(encounter, log);
  const replayShells = traceShells(playback.world);
  expect(playback.runToEnd()).toMatchObject({ matchesHash: true, matchesOutcome: true });
  expect(replayShells).toEqual(shells);
  playback.dispose();
  world.dispose();
});
