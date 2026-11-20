import { expect, it } from 'vitest';
import { runLevelBalanceSim } from '../../scripts/balanceSim.ts';
import { campaignKit } from '../../scripts/lib/campaignKit.ts';
import { balanceBuildOrder } from '../../scripts/lib/specializationBuilds.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { HERO_LEVEL_XP } from '../../src/data/heroes.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { I14 } from '../../src/data/levels2d/i14.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/l1c.ts';
import { parseSimReplay, serializeSimReplay, SimReplayPlayer, SimWorld } from '../../src/sim/world.ts';

// Skimmers and grunts both travel at 2.3 units/s. The first flurry meets them abreast.
const entrances = [0, 2.94, 3.39, 3.41].map(z => ({ id: String(z), x: 0, z }));
const goal = { x: 30, z: 0 };
const track = (start: { x: number; z: number }) => [start, { x: 24, z: start.z }, goal];
const encounter: LevelDef = {
  ...LEVEL_L1C, id: 'snowbell-boundary', startingGold: 1200, enemyHpScale: 4,
  layout2d: {
    ...LEVEL_L1C.layout2d!, entrances, goal, paths: entrances.map(track),
    flightPath: track({ x: 0, z: 2.96 }), plots: [{ x: 0, z: -2 }],
  },
  waves: [{ clearBonus: 15, groups: [
    ...entrances.map((_, lane) => ({ enemyType: 'grunt' as const, lane, count: 1, startDelay: 0, spawnInterval: 1 })),
    { enemyType: 'flyer', count: 1, startDelay: 0, spawnInterval: 1 },
  ] }],
};

interface FlurryImpact {
  tick: number;
  radius: number;
  hits: string[];
  pack: { name: string; slow: number; timer: number }[];
}

function traceFlurries(world: SimWorld) {
  const launches: number[] = [];
  const impacts: FlurryImpact[] = [];
  const name = (enemy: { flying: boolean; lane: number }) => enemy.flying ? 'flyer' : entrances[enemy.lane].id;
  let hits: string[] = [];
  world.events.on('towerFired', () => launches.push(world.tick));
  world.events.on('enemyHit', ({ enemyId }) => {
    const enemy = world.enemyPool.items.find(e => e.active && e.uid === enemyId)!;
    hits.push(name(enemy));
  });
  world.events.on('projectileImpact', e => {
    impacts.push({
      tick: world.tick, radius: e.radius, hits: hits.sort(),
      pack: world.enemyPool.items.filter(e => e.active).map(e => ({ name: name(e), slow: e.slowRatio, timer: e.slowTimer })),
    });
    hits = [];
  });
  return { launches, impacts };
}

function expectFlurry(impact: FlurryImpact, radius: number, strength: number, chilled: string[]) {
  expect(impact.radius).toBe(radius);
  expect(impact.hits).toEqual(chilled);
  expect(impact.pack).toHaveLength(5);
  for (const foe of impact.pack) {
    const hit = chilled.includes(foe.name);
    expect(foe.slow, foe.name).toBe(hit ? strength : 0);
    expect(foe.timer, foe.name).toBe(hit ? 4 : 0);
  }
}

const inner = ['0', '2.94'];
const wide = [...inner, '3.39', 'flyer'];
it.each([
  { timing: 'before launch', firstHits: wide, secondHits: wide },
  // The untouched grunt at 3.39 pulls ahead of the primary before the second flurry.
  { timing: 'in flight', firstHits: inner, secondHits: [...inner, 'flyer'] },
  { timing: 'never', firstHits: inner, secondHits: inner },
])('resolves a mixed pack with Deep Drifts bought $timing', ({ timing, firstHits, secondHits }) => {
  const world = new SimWorld(encounter, new EventBus(), { recordCommands: true });
  const trace = traceFlurries(world);
  const tower = world.placeTowerOnPlot(0, 'frost', 'closest')!;
  expect(world.upgradeTower(tower.id)).toBe(true);
  expect(world.upgradeTower(tower.id)).toBe(true);
  expect(world.specializeTower(tower.id, 'snowbell')).toBe(true);
  const early = timing === 'before launch';
  if (early) expect(world.buyTowerAbility(tower.id, 'drifts')).toBe(true);
  expect(world.startNextWave()).toBe(true);
  while (!trace.launches.length && world.tick < 60) world.fixedTick(BALANCE.fixedDt);
  expect(world.projectilePool.getActiveCount()).toBe(1);
  expect(trace.impacts).toHaveLength(0);
  if (timing === 'in flight') expect(world.buyTowerAbility(tower.id, 'drifts')).toBe(true);
  while (trace.impacts.length < 2 && world.tick < 180) world.fixedTick(BALANCE.fixedDt);
  expect(trace.launches).toHaveLength(2);
  expect(trace.impacts).toHaveLength(2);

  const [first, second] = trace.impacts;
  expectFlurry(first, early ? 3.4 : 2.95, early ? 0.55 : 0.48, firstHits);
  // Repeated base flurries also reach the slow cap and restart the four-second timer.
  expectFlurry(second, timing === 'never' ? 2.95 : 3.4, 0.55, secondHits);
  expect(world.sellTower(tower.id)).toBeGreaterThan(0);
  const primary = world.enemyPool.items.find(e => e.active && !e.flying && e.lane === 0)!;
  const initial = primary.dist;
  const dt = BALANCE.fixedDt;
  for (let i = 0; i < 239; i++) world.fixedTick(dt);
  expect(primary.slowTimer).toBeCloseTo(dt, 8);
  expect(primary.dist - initial).toBeCloseTo(239 * dt * primary.speed * 0.45, 8);
  for (let i = 0; i < 2; i++) world.fixedTick(dt);
  expect(primary.slowRatio).toBe(0);
  const recovered = primary.dist;
  world.fixedTick(dt);
  expect(primary.dist - recovered).toBeCloseTo(dt * primary.speed, 8);

  while (world.outcome === 'ongoing' && world.tick < 1800) world.fixedTick(dt);
  expect(world.outcome).toBe('won');
  const player = new SimReplayPlayer(encounter, parseSimReplay(serializeSimReplay(world.exportReplay()))!);
  const replay = traceFlurries(player.world);
  expect(player.runToEnd()).toMatchObject({ matchesOutcome: true, matchesHash: true });
  expect(replay).toEqual(trace);
  player.dispose();
  world.dispose();
});

it('affords Deep Drifts on the first Normal clear of Amberstone Mesa', () => {
  const kit = campaignKit(HERO_LEVEL_XP[18], 40); // Bran reaches the mesa at level 19.
  const result = runLevelBalanceSim(I14, 'greedy', balanceBuildOrder(I14, 'greedy'), kit);
  expect(result).toMatchObject({ outcome: 'won', towerPurchases: ['snowbell', 'drifts'], invalidActions: 0 });
});
