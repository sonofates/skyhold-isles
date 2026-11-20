import { expect, it } from 'vitest';
import { runLevelBalanceSim } from '../../scripts/balanceSim.ts';
import { campaignKit } from '../../scripts/lib/campaignKit.ts';
import { balanceBuildOrder } from '../../scripts/lib/specializationBuilds.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { I18 } from '../../src/data/levels2d/i18.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/l1c.ts';
import { SimReplayPlayer, SimWorld, parseSimReplay, serializeSimReplay } from '../../src/sim/world.ts';

const entrance = { id: 'road', x: 0, z: 0 };
const goal = { x: 52, z: 0 };
const path = [entrance, goal];
const encounter: LevelDef = {
  ...LEVEL_L1C, id: 'aftershock', startingGold: 1400, enemyHpScale: 6,
  layout2d: { ...LEVEL_L1C.layout2d!, entrances: [entrance], paths: [path], goal, flightPath: path, plots: [{ x: 22, z: -2 }] },
  waves: [{ clearBonus: 15, groups: [{ enemyType: 'bellrunner', count: 1, spawnInterval: 1, startDelay: 0 }] }],
};

function traceShells(world: SimWorld) {
  const shots: number[] = [];
  const hits: { tick: number; damage: number }[] = [];
  const impacts: { tick: number; momentum: number; slow: number; duration: number }[] = [];
  const leaks: number[] = [];
  world.events.on('towerFired', () => shots.push(world.tick));
  world.events.on('enemyHit', ({ damage }) => hits.push({ tick: world.tick, damage }));
  world.events.on('projectileImpact', () => {
    const hare = world.enemyPool.items[world.enemyPool.getActiveIndex(0)];
    impacts.push({ tick: world.tick, momentum: hare.abilityTimer, slow: hare.slowRatio, duration: hare.slowTimer });
  });
  world.events.on('enemyLeaked', () => leaks.push(world.tick));
  return { shots, hits, impacts, leaks };
}

it.each(['before launch', 'in flight', 'never'] as const)('interrupts a running hare with Aftershock bought %s', timing => {
  const dt = BALANCE.fixedDt;
  const world = new SimWorld(encounter, new EventBus(), { recordCommands: true });
  const trace = traceShells(world);
  const tower = world.placeTowerOnPlot(0, 'cannon')!;
  expect(world.upgradeTower(tower.id)).toBe(true);
  expect(world.upgradeTower(tower.id)).toBe(true);
  expect(world.specializeTower(tower.id, 'bellfoundry')).toBe(true);
  if (timing === 'before launch') expect(world.buyTowerAbility(tower.id, 'aftershock')).toBe(true);
  expect(world.startNextWave()).toBe(true);
  while (!trace.shots.length && world.tick < 600) world.fixedTick(dt);
  expect(world.projectilePool.getActiveCount()).toBe(1);
  expect(trace.impacts).toHaveLength(0);
  const hare = world.enemyPool.items[world.enemyPool.getActiveIndex(0)];
  expect(hare.abilityTimer).toBe(2.4);
  if (timing === 'in flight') expect(world.buyTowerAbility(tower.id, 'aftershock')).toBe(true);
  while (trace.impacts.length < 2 && world.tick < 600) world.fixedTick(dt);
  expect(trace.shots).toHaveLength(2);
  expect(trace.impacts).toHaveLength(2);
  expect(trace.hits.map(h => h.tick)).toEqual(trace.impacts.map(p => p.tick));
  expect(trace.hits.every(h => h.damage > 0)).toBe(true);

  const firstUpgraded = timing === 'before launch';
  const secondUpgraded = timing !== 'never';
  expect(trace.impacts[0]).toMatchObject(firstUpgraded
    ? { momentum: 0, slow: 0.28, duration: 2 }
    : { momentum: 2.4, slow: 0, duration: 0 });
  expect(trace.impacts[1].momentum).toBe(secondUpgraded ? 0 : 2.4);
  expect(trace.impacts[1].duration).toBe(secondUpgraded ? 2 : 0);
  // A second slow before the first expires adds half its strength and refreshes the timer.
  const slow = firstUpgraded ? 0.42 : secondUpgraded ? 0.28 : 0;
  expect(trace.impacts[1].slow).toBeCloseTo(slow);
  expect(world.sellTower(tower.id)).toBeGreaterThan(0);

  const start = hare.dist;
  for (let i = 0; i < 119; i++) world.fixedTick(dt);
  expect(hare.abilityTimer).toBe(secondUpgraded ? 0 : 2.4);
  const speed = hare.speed * (secondUpgraded ? 1 - slow : 1.85);
  expect(hare.dist - start).toBeCloseTo(119 * dt * speed, 8);
  if (secondUpgraded) {
    expect(hare.slowTimer).toBeCloseTo(dt, 8);
    // Allow the fixed-step boundary to round to either adjacent tick.
    for (let i = 0; i < 2 && hare.slowRatio > 0; i++) world.fixedTick(dt);
    expect(hare.slowRatio).toBe(0);
    expect(hare.abilityTimer).toBeCloseTo(dt, 8);
    const restarting = hare.dist;
    world.fixedTick(dt);
    expect(hare.dist - restarting).toBeCloseTo(dt * hare.speed * (1 + 0.85 * (2 * dt) / 2.4), 8);
    for (let i = 0; i < 144; i++) world.fixedTick(dt);
    expect(hare.abilityTimer).toBe(2.4);
  }
  while (world.outcome === 'ongoing' && world.tick < 1200) world.fixedTick(dt);
  expect(trace.leaks).toHaveLength(1);
  expect(world.outcome).toBe('won');

  const playback = new SimReplayPlayer(encounter, parseSimReplay(serializeSimReplay(world.exportReplay()))!);
  const replayTrace = traceShells(playback.world);
  expect(playback.runToEnd()).toMatchObject({ matchesHash: true, matchesOutcome: true });
  expect(replayTrace).toEqual(trace);
  playback.dispose();
  world.dispose();
});

it('affords Aftershock on the first Normal clear of Lantern Glassworks', () => {
  const result = runLevelBalanceSim(I18, 'greedy', balanceBuildOrder(I18, 'greedy'), campaignKit(1_000_000, 47));
  expect(result).toMatchObject({ outcome: 'won', towerPurchases: ['bellfoundry', 'aftershock'], invalidActions: 0 });
});
