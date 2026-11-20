import { expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/l1c.ts';
import { parseSimReplay, serializeSimReplay, SimReplayPlayer, SimWorld } from '../../src/sim/world.ts';

// The flyer bridges the gap between the lead grunt and the other seven ground lanes.
// All march south at the same speed. Spawn in reverse lane order to exercise nearest-first hops.
function relayEncounter(flightX: number): LevelDef {
  const entrances = [0, 6, 7, 8, 9, 10, 11, 12].map(x => ({ id: String(x), x, z: 0 }));
  const goal = { x: 0, z: 22 };
  const lane = (x: number) => [{ x, z: 0 }, { x, z: 16 }, goal];
  return {
    ...LEVEL_L1C, id: 'relay-chain', startingGold: 1200, enemyHpScale: 4,
    layout2d: {
      ...LEVEL_L1C.layout2d!, entrances, goal, paths: entrances.map(e => lane(e.x)),
      flightPath: lane(flightX), plots: [{ x: -1, z: 5 }],
    },
    waves: [{ clearBonus: 15, groups: [
      ...entrances.map((_, i) => ({
        enemyType: 'grunt' as const, lane: i, elite: i === 1, count: 1, startDelay: 0, spawnInterval: 1,
      })).reverse(),
      { enemyType: 'flyer', count: 1, startDelay: 0, spawnInterval: 1 },
    ] }],
  };
}

function traceChains(world: SimWorld) {
  type Hit = { id: number; x: number; type: string; damage: number };
  const shots: { tick: number; overload: boolean; hits: Hit[] }[] = [];
  let hits: Hit[] = [];
  world.events.on('enemyHit', e => hits.push({ id: e.enemyId, x: e.x, type: e.enemyType, damage: e.damage }));
  world.events.on('lightningChain', e => {
    shots.push({ tick: world.tick, overload: e.overload ?? false, hits });
    hits = [];
  });
  return shots;
}

it.each([
  { gap: 4.8, buyLiveWire: true },
  { gap: 4.8, buyLiveWire: false },
  { gap: 4.81, buyLiveWire: true },
])('resolves a $gap-unit Relay Grove jump with a mid-wave Live Wire purchase set to $buyLiveWire', ({ gap, buyLiveWire }) => {
  const level = relayEncounter(gap);
  const world = new SimWorld(level, new EventBus(), { recordCommands: true });
  const shots = traceChains(world);
  const tower = world.placeTowerOnPlot(0, 'tesla', 'closest')!;
  expect(world.upgradeTower(tower.id)).toBe(true);
  expect(world.upgradeTower(tower.id)).toBe(true);
  expect(world.specializeTower(tower.id, 'relay')).toBe(true);
  expect(world.startNextWave()).toBe(true);
  while (shots.length < 5 && world.tick < 360) world.fixedTick(BALANCE.fixedDt);
  expect(shots).toHaveLength(5);
  if (buyLiveWire) expect(world.buyTowerAbility(tower.id, 'livewire')).toBe(true);
  while (world.outcome === 'ongoing' && world.tick < 1200) world.fixedTick(BALANCE.fixedDt);
  expect(world.outcome).toBe('won');
  expect(shots).toHaveLength(6);
  expect(shots[5].overload).toBe(true);
  const reachesFlyer = gap === 4.8;
  const xs = reachesFlyer ? [0, gap, 6, 7, 8, 9, 10] : [0];
  for (const shot of shots.slice(0, 5)) {
    expect(shot.overload).toBe(false);
    expect(shot.hits.map(h => h.x)).toEqual(xs);
    expect(shot.hits.map(h => h.damage)).toEqual(reachesFlyer ? [47, 39, 32, 28, 23, 20, 17] : [47]);
  }
  const overload = shots[5].hits;
  expect(overload.map(h => h.x)).toEqual(reachesFlyer ? [...xs, 11] : xs);
  // The lead has 65 HP left and the flyer has 21. The following elite grunt's one armor
  // applies to its own hit. Each jump uses the unrounded damage before armor and the HP cap.
  const chainDamage = buyLiveWire ? [65, 21, 74, 70, 66, 62, 58, 55] : [65, 21, 59, 50, 42, 35, 30, 25];
  expect(overload.map(h => h.damage)).toEqual(reachesFlyer ? chainDamage : [65]);
  if (reachesFlyer) expect(overload[1].type).toBe('flyer');
  expect(tower.kills).toBe(reachesFlyer ? 2 : 1);
  expect(tower.totalDamageDealt).toBe(shots.flatMap(s => s.hits).reduce((sum, h) => sum + h.damage, 0));

  const playback = new SimReplayPlayer(level, parseSimReplay(serializeSimReplay(world.exportReplay()))!);
  const replayShots = traceChains(playback.world);
  expect(playback.runToEnd()).toMatchObject({ matchesHash: true, matchesOutcome: true });
  expect(replayShots).toEqual(shots);
  playback.dispose();
  world.dispose();
});

function traceKills(world: SimWorld) {
  const kills: { tick: number; id: number; reward: number }[] = [];
  world.events.on('enemyKilled', e => kills.push({ tick: world.tick, id: e.enemyId, reward: e.reward }));
  return kills;
}

function stormheartEncounter(enemyHpScale: number): LevelDef {
  // The six parallel lanes keep spare targets in reach even after a lethal overload.
  const entrances = Array.from({ length: 6 }, (_, x) => ({ id: String(x), x, z: 0 }));
  const goal = { x: 0, z: 19 };
  return {
    ...LEVEL_L1C, id: 'stormheart-chain', startingGold: 1200, enemyHpScale,
    layout2d: {
      ...LEVEL_L1C.layout2d!, entrances, goal,
      paths: entrances.map(({ x }) => [{ x, z: 0 }, { x, z: 15 }, goal]),
      plots: [{ x: -1, z: 5 }],
    },
    waves: [{ clearBonus: 15, groups: entrances.map((_, lane) => ({
      enemyType: 'brute', count: 1, startDelay: 0, spawnInterval: 1, lane,
    })) }],
  };
}

it.each([
  { branchAfter: 1, abilityAfter: 2, hpScale: 3, overloads: [3, 6, 9], lethalDamage: 106 },
  { branchAfter: 3, abilityAfter: 8, hpScale: 2.5, overloads: [4, 8, 9], lethalDamage: 32 },
  { branchAfter: 6, abilityAfter: 7, hpScale: 2, overloads: [6, 9], lethalDamage: 98 },
])('carries the Tesla firing cycle through Stormheart after shot $branchAfter and Thunderbeat after shot $abilityAfter', ({
  branchAfter, abilityAfter, hpScale, overloads, lethalDamage,
}) => {
  const level = stormheartEncounter(hpScale);
  const world = new SimWorld(level, new EventBus(), { recordCommands: true });
  const shots = traceChains(world);
  const kills = traceKills(world);
  const tower = world.placeTowerOnPlot(0, 'tesla', 'closest')!;
  expect(world.upgradeTower(tower.id)).toBe(true);
  expect(world.upgradeTower(tower.id)).toBe(true);
  expect(world.startNextWave()).toBe(true);
  function advanceToShot(count: number) {
    while (shots.length < count && world.tick < 600) world.fixedTick(BALANCE.fixedDt);
    expect(shots).toHaveLength(count);
  }
  advanceToShot(branchAfter);
  expect(world.specializeTower(tower.id, 'stormheart')).toBe(true);
  advanceToShot(abilityAfter);
  expect(world.buyTowerAbility(tower.id, 'thunderbeat')).toBe(true);
  advanceToShot(9);

  expect(shots.flatMap((s, i) => s.overload ? [i + 1] : [])).toEqual(overloads);
  for (const [i, shot] of shots.entries()) {
    const isBranch = i >= branchAfter;
    const expectedLanes = isBranch ? [0, 1, 2] : shot.overload ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4];
    expect(shot.hits.map(h => h.x)).toEqual(expectedLanes);
    if (isBranch) {
      const primary = i === 8 ? lethalDamage : shot.overload ? 144 : 69;
      expect(shot.hits.map(h => h.damage)).toEqual(shot.overload ? [primary, 111, 85] : [primary, 53, 40]);
    }
  }
  world.fixedTick(BALANCE.fixedDt);
  expect(kills).toEqual([{ tick: shots[8].tick + 1, id: shots[0].hits[0].id, reward: 7 }]);
  expect(tower.kills).toBe(1);
  expect(tower.totalDamageDealt).toBe(shots.flatMap(s => s.hits).reduce((sum, h) => sum + h.damage, 0));

  while (world.outcome === 'ongoing' && world.tick < 1500) world.fixedTick(BALANCE.fixedDt);
  expect(world.outcome).toBe('won');
  const playback = new SimReplayPlayer(level, parseSimReplay(serializeSimReplay(world.exportReplay()))!);
  const replayShots = traceChains(playback.world);
  const replayKills = traceKills(playback.world);
  expect(playback.runToEnd()).toMatchObject({ matchesHash: true, matchesOutcome: true });
  expect(replayShots).toEqual(shots);
  expect(replayKills).toEqual(kills);
  playback.dispose();
  world.dispose();
});
