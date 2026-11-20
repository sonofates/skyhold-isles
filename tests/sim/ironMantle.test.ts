import { expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/l1c.ts';
import { parseSimReplay, serializeSimReplay, SimReplayPlayer, SimWorld } from '../../src/sim/world.ts';

function encounter(enemyType: 'brute' | 'golem', enemyHpScale: number): LevelDef {
  const entrance = { id: 'road', x: 1, z: 0 };
  const goal = { x: -9, z: 0 };
  return {
    ...LEVEL_L1C, id: 'gateward-melee', startingGold: 1200, enemyHpScale,
    layout2d: {
      ...LEVEL_L1C.layout2d!, entrances: [entrance], goal, paths: [[entrance, goal]], plots: [{ x: 0, z: -1 }],
    },
    waves: [{ clearBonus: 15, groups: [{ enemyType, count: 3, startDelay: 0, spawnInterval: 0.25 }] }],
  };
}

function traceMelee(world: SimWorld) {
  type Strike = { tick: number; enemy: number; guard: number };
  const swings: Strike[] = [];
  const hits: (Strike & { damage: number })[] = [];
  const deaths: { tick: number; guard: number; delay: number }[] = [];
  const spawns: { tick: number; guard: number; x: number; z: number }[] = [];
  world.events.on('meleeSwing', e => {
    if (e.attacker === 'enemy') swings.push({ tick: world.tick, enemy: e.attackerId, guard: e.targetId });
  });
  world.events.on('soldierHurt', e => hits.push({ tick: world.tick, enemy: e.enemyId, guard: e.soldierId, damage: e.damage }));
  world.events.on('soldierDied', e => deaths.push({ tick: world.tick, guard: e.soldierId, delay: e.respawnSec }));
  world.events.on('soldierSpawned', e => spawns.push({ tick: world.tick, guard: e.soldierId, x: e.x, z: e.z }));
  return { swings, hits, deaths, spawns };
}

function deploy(level: LevelDef) {
  const world = new SimWorld(level, new EventBus(), { recordCommands: true });
  const hall = world.placeTowerOnPlot(0, 'barracks')!;
  expect(world.upgradeTower(hall.id)).toBe(true);
  expect(world.upgradeTower(hall.id)).toBe(true);
  return { world, trace: traceMelee(world), hall };
}

function advanceUntil(world: SimWorld, condition: () => boolean) {
  while (!condition() && world.outcome === 'ongoing' && world.tick < 4000) world.fixedTick(BALANCE.fixedDt);
  expect(condition()).toBe(true);
}

function finishAndReplay(world: SimWorld, trace: ReturnType<typeof traceMelee>) {
  advanceUntil(world, () => world.outcome === 'won');
  const player = new SimReplayPlayer(world.level, parseSimReplay(serializeSimReplay(world.exportReplay()))!);
  const replayTrace = traceMelee(player.world);
  expect(player.runToEnd()).toMatchObject({ matchesOutcome: true, matchesHash: true });
  expect(replayTrace).toEqual(trace);
  player.dispose();
  world.dispose();
}

it.each([true, false])('resolves a brute’s pending blow with the guard’s current armor (buy Iron Mantle: %s)', buy => {
  const { world, trace, hall } = deploy(encounter('brute', 0.55));
  expect(world.specializeTower(hall.id, 'gateward')).toBe(true);
  expect(world.startNextWave()).toBe(true);
  advanceUntil(world, () => trace.hits.length > 0);
  const first = trace.hits[0];
  expect(first.damage).toBe(4);
  expect(trace.swings.at(-1)).toEqual({ tick: first.tick, enemy: first.enemy, guard: first.guard });

  // The brute has armed its next blow against this same wounded guard.
  advanceUntil(world, () => world.tick >= first.tick + 4);
  const guard = world.soldierSystem.soldiers.find(s => s.id === first.guard)!;
  const hp = guard.hp;
  expect(hp).toBe(guard.maxHp - 4);
  if (buy) expect(world.buyTowerAbility(hall.id, 'ironmantle')).toBe(true);
  expect(guard.hp).toBe(hp);
  const hitAgain = () => trace.hits.find(hit => hit.enemy === first.enemy && hit.tick > first.tick);
  advanceUntil(world, () => !!hitAgain());
  const damage = buy ? 1 : 4;
  expect(hitAgain()).toEqual({ ...first, tick: first.tick + 75, damage });
  expect(guard.hp).toBe(hp - damage);
  finishAndReplay(world, trace);
});

it.each([
  { tierAtDeath: 'III', delay: 7, damage: 54 },
  { tierAtDeath: 'Gateward', delay: 5, damage: 49 },
])('keeps the $tierAtDeath return timer when buying Iron Mantle with a guard down', ({ tierAtDeath, delay, damage }) => {
  const { world, trace, hall } = deploy(encounter('golem', 5));
  if (tierAtDeath === 'Gateward') expect(world.specializeTower(hall.id, 'gateward')).toBe(true);
  expect(world.startNextWave()).toBe(true);
  advanceUntil(world, () => trace.deaths.length > 0);
  const death = trace.deaths[0];
  const guard = world.soldierSystem.soldiers.find(s => s.id === death.guard)!;
  expect(death.delay).toBe(delay);
  expect(trace.hits.at(-1)).toMatchObject({ tick: death.tick, guard: guard.id, damage });

  advanceUntil(world, () => world.tick >= death.tick + 60);
  const remaining = guard.respawnTimer;
  expect(remaining).toBeCloseTo(delay - 1, 8);
  if (tierAtDeath === 'III') expect(world.specializeTower(hall.id, 'gateward')).toBe(true);
  expect(world.buyTowerAbility(hall.id, 'ironmantle')).toBe(true);
  expect(guard).toMatchObject({ state: 'dead', hp: 0, respawnTimer: remaining });

  const returned = () => trace.spawns.find(s => s.guard === guard.id && s.tick > death.tick);
  advanceUntil(world, () => !!returned());
  const returnTicks = world.tick - death.tick;
  expect(returnTicks).toBeGreaterThanOrEqual(delay / BALANCE.fixedDt);
  expect(returnTicks).toBeLessThanOrEqual(delay / BALANCE.fixedDt + 1);
  expect(returned()).toMatchObject({ x: hall.x, z: hall.z });
  expect(guard).toMatchObject({ hp: guard.maxHp, respawnTimer: 0 });
  const nextHit = () => trace.hits.find(hit => hit.guard === guard.id && hit.tick > death.tick);
  advanceUntil(world, () => !!nextHit());
  expect(nextHit()!.damage).toBe(44);
  expect(guard.hp).toBe(guard.maxHp - 44);
  const nextDeath = () => trace.deaths.find(d => d.guard === guard.id && d.tick > death.tick);
  advanceUntil(world, () => !!nextDeath());
  expect(nextDeath()!.delay).toBe(5);
  expect(guard.respawnTimer).toBe(5);
  finishAndReplay(world, trace);
});
