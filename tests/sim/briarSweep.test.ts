import { expect, it } from 'vitest';
import { runLevelBalanceSim } from '../../scripts/balanceSim.ts';
import { campaignKit } from '../../scripts/lib/campaignKit.ts';
import { balanceBuildOrder } from '../../scripts/lib/specializationBuilds.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/l1c.ts';
import { parseSimReplay, serializeSimReplay, SimReplayPlayer, SimWorld } from '../../src/sim/world.ts';

const entrance = { id: 'road', x: 1, z: 0 };
const goal = { x: -9, z: 0 };
const road = [entrance, goal];
const encounter: LevelDef = {
  ...LEVEL_L1C, id: 'briar-sweep', startingGold: 1200,
  layout2d: {
    ...LEVEL_L1C.layout2d!, entrances: [entrance], goal, paths: [road], flightPath: road, plots: [{ x: 0, z: -1 }],
  },
  waves: [{ clearBonus: 15, groups: [
    { enemyType: 'grunt', count: 1, startDelay: 0, spawnInterval: 1 },
    { enemyType: 'brute', count: 1, startDelay: 0.1, spawnInterval: 1 },
  ] }],
};

function recordMelee(world: SimWorld) {
  const swings: { tick: number; attackerId: number; targetId: number }[] = [];
  const hits: { tick: number; attackerId: number; targetId: number; damage: number; cleave: boolean; killed: boolean }[] = [];
  const bounties: { id: number; type: string; reward: number }[] = [];
  world.events.on('meleeSwing', ({ attacker, attackerId, targetId }) => {
    if (attacker === 'soldier') swings.push({ tick: world.tick, attackerId, targetId });
  });
  world.events.on('meleeHit', ({ attacker, attackerId, targetId, damage, cleave, killed }) => {
    if (attacker === 'soldier') hits.push({ tick: world.tick, attackerId, targetId, damage, cleave, killed });
  });
  world.events.on('enemyKilled', ({ enemyId, enemyType, reward }) => bounties.push({ id: enemyId, type: enemyType, reward }));
  return { swings, hits, bounties };
}

it.each([
  { buy: false, hpScale: 0.1, gruntHp: 8, bruteHp: 26, sweepDamage: 19 },
  { buy: true, hpScale: 0.1, gruntHp: 8, bruteHp: 26, sweepDamage: 26 },
  { buy: true, hpScale: 0.15, gruntHp: 11, bruteHp: 39, sweepDamage: 29 },
])('resolves a lethal Briar swing beside an armored brute (mid-swing purchase $buy, HP scale $hpScale)', scenario => {
  const level = { ...encounter, enemyHpScale: scenario.hpScale };
  const world = new SimWorld(level, new EventBus(), { recordCommands: true });
  const trace = recordMelee(world);
  const lodge = world.placeTowerOnPlot(0, 'barracks')!;
  expect(world.upgradeTower(lodge.id)).toBe(true);
  expect(world.upgradeTower(lodge.id)).toBe(true);
  expect(world.specializeTower(lodge.id, 'briar')).toBe(true);
  expect(world.startNextWave()).toBe(true);
  while (!trace.swings.length && world.tick < 120) world.fixedTick(BALANCE.fixedDt);
  expect(trace.swings.length).toBeGreaterThan(0);
  const windup = trace.swings[0];
  for (let i = 0; i < 4; i++) world.fixedTick(BALANCE.fixedDt);
  expect(trace.hits).toHaveLength(0);
  if (scenario.buy) expect(world.buyTowerAbility(lodge.id, 'widesweep')).toBe(true);
  const goldBeforeImpact = world.gold;
  while (world.outcome === 'ongoing' && world.tick < 120) world.fixedTick(BALANCE.fixedDt);
  expect(world).toMatchObject({ outcome: 'won', enemiesKilledTotal: 2, gold: goldBeforeImpact + 4 + 7 + 15 });

  const [primary, sweep] = trace.hits;
  expect(primary).toEqual({
    tick: windup.tick + 12, attackerId: windup.attackerId, targetId: windup.targetId,
    damage: scenario.gruntHp, cleave: false, killed: true,
  });
  const doubleKill = scenario.sweepDamage === scenario.bruteHp;
  expect(sweep).toMatchObject({
    tick: primary.tick, attackerId: primary.attackerId, damage: scenario.sweepDamage, cleave: true, killed: doubleKill,
  });
  expect(sweep.targetId).not.toBe(primary.targetId);
  expect(trace.bounties).toEqual([
    { id: primary.targetId, type: 'grunt', reward: 4 }, { id: sweep.targetId, type: 'brute', reward: 7 },
  ]);
  expect(trace.hits).toHaveLength(doubleKill ? 2 : 3);
  if (!doubleKill) {
    expect(trace.hits[2]).toMatchObject({
      tick: primary.tick + 1, targetId: sweep.targetId, cleave: false, killed: true, damage: scenario.bruteHp - scenario.sweepDamage,
    });
    expect(trace.hits[2].attackerId).not.toBe(primary.attackerId);
  }
  expect(lodge).toMatchObject({ kills: 2, totalDamageDealt: scenario.gruntHp + scenario.bruteHp });

  const replay = new SimReplayPlayer(level, parseSimReplay(serializeSimReplay(world.exportReplay()))!);
  const replayTrace = recordMelee(replay.world);
  expect(replay.runToEnd()).toMatchObject({ matchesHash: true, matchesOutcome: true });
  expect(replayTrace).toEqual(trace);
  expect(replay.world.getTowerById(lodge.id)).toMatchObject({ kills: lodge.kills, totalDamageDealt: lodge.totalDamageDealt });
  replay.dispose();
  world.dispose();
});

it('can afford both Briar purchases before Lastlight Head ends while preserving the autoplay order', () => {
  const level = LEVELS_2D.find(island => island.id === 'i24')!;
  const autoplay = [...level.scriptedBuildOrder!];
  const order = balanceBuildOrder(level, 'greedy');
  expect(level.scriptedBuildOrder).toEqual(autoplay);
  expect(order.at(-1)).toBe(autoplay.find(a => a.action === 'upgrade' && a.col === 4 && a.waveIndex === 12));
  const result = runLevelBalanceSim(level, 'greedy', order, campaignKit(1_000_000, 56));
  expect(result).toMatchObject({ outcome: 'won', towerPurchases: ['briar', 'widesweep'], invalidActions: 0 });
});
