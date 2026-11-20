import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import type { TowerType } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS, type LevelDef } from '../../src/data/levels/index.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/l1c.ts';
import { ALL_TOWER_TYPES, specializationsFor, towerStats } from '../../src/data/towers.ts';
import { computeSellRefund, parseSimReplay, serializeSimReplay, SimReplayPlayer, SimWorld } from '../../src/sim/world.ts';
import { towerEntry } from '../../src/ui/content/codexData.ts';

const level = { ...LEVEL_L1C, startingGold: 2500 };
function setup(type: TowerType) {
  const world = new SimWorld(level, new EventBus(), { recordCommands: true });
  const tower = world.placeTowerOnPlot(21, type)!;
  expect(world.upgradeTower(tower.id)).toBe(true);
  expect(world.upgradeTower(tower.id)).toBe(true);
  return { world, tower };
}

describe('plot tower specializations', () => {
  const roster = ALL_TOWER_TYPES.flatMap(type => specializationsFor(type).map(branch => ({ type, branch })));

  it('provides two distinct codex branches per family and stable purchase IDs', () => {
    for (const type of ALL_TOWER_TYPES) {
      expect(specializationsFor(type)).toHaveLength(2);
      expect(towerEntry(type).specializations).toEqual(specializationsFor(type));
    }
    const ids = roster.flatMap(({ branch }) => [branch.id, ...branch.abilities.map(a => a.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(roster)('buys and replays $type / $branch.name', ({ type, branch }) => {
    const { world, tower } = setup(type);
    const before = tower.totalInvested;
    const gold = world.gold;
    expect(world.specializeTower(tower.id, branch.id)).toBe(true);
    expect(towerStats(tower)).toMatchObject({ tier: 4, upgradeCost: branch.cost, ...branch.changes });
    world.startNextWave();
    for (let i = 0; i < 200; i++) world.fixedTick(BALANCE.fixedDt);
    const goldBeforeAbilities = world.gold;
    let spent = 0;
    for (const a of branch.abilities) {
      expect(world.buyTowerAbility(tower.id, a.id)).toBe(true);
      expect(world.buyTowerAbility(tower.id, a.id)).toBe(false);
      expect(towerStats(tower)).toMatchObject(a.changes);
      spent += a.cost;
    }
    expect(world.gold).toBe(goldBeforeAbilities - spent);
    expect(tower.totalInvested).toBe(before + branch.cost + spent);
    expect(gold).toBe(level.startingGold - before);
    for (let i = 0; i < 400; i++) world.fixedTick(BALANCE.fixedDt);
    const log = parseSimReplay(serializeSimReplay(world.exportReplay()))!;
    const player = new SimReplayPlayer(level, log);
    expect(player.runToEnd()).toMatchObject({ matchesHash: true, matchesOutcome: true });
    expect(player.world.getTowerById(tower.id)?.specialization).toEqual(tower.specialization);
    expect(world.sellTower(tower.id)).toBe(computeSellRefund(tower.totalInvested));
    player.dispose();
    world.dispose();
  });

  it('rejects early, foreign, duplicate, unaffordable and post-game purchases atomically', () => {
    const { world, tower } = setup('archer');
    const young = world.placeTowerOnPlot(0, 'archer')!;
    const commands = () => world.exportReplay().commands.length;
    const before = commands();
    expect(world.specializeTower(young.id, 'farwatch')).toBe(false);
    expect(world.specializeTower(tower.id, 'horizon')).toBe(false);
    expect(world.buyTowerAbility(tower.id, 'throughshot')).toBe(false);
    world.gold = 154;
    expect(world.specializeTower(tower.id, 'farwatch')).toBe(false);
    expect(world.gold).toBe(154);
    expect(commands()).toBe(before);
    world.gold = 155;
    expect(world.specializeTower(tower.id, 'farwatch')).toBe(true);
    expect(world.gold).toBe(0);
    expect(world.buyTowerAbility(tower.id, 'throughshot')).toBe(false);
    world.gold = 500;
    expect(world.buyTowerAbility(tower.id, 'flock')).toBe(false);
    expect(world.specializeTower(tower.id, 'swallow')).toBe(false);
    expect(world.upgradeTower(tower.id)).toBe(false);
    world.debugForceLose();
    expect(world.buyTowerAbility(tower.id, 'throughshot')).toBe(false);
    expect(world.gold).toBe(500);
    expect(commands()).toBe(before + 1);
  });

  it('keeps grid-map purchases capped at tier three', () => {
    const world = new SimWorld({ ...LEVELS[0], startingGold: 2500 }, new EventBus());
    const tower = world.placeTower(4, 3, 'archer')!;
    world.upgradeTower(tower.id);
    world.upgradeTower(tower.id);
    expect(world.specializeTower(tower.id, 'farwatch')).toBe(false);
    expect(towerStats(tower).tier).toBe(3);
  });

  it('acquires at longbow range and snapshots the ability at launch', () => {
    const { world, tower } = setup('archer');
    const foe = world.enemySystem.spawnEnemy('brute')!;
    foe.x = tower.x + 8;
    foe.z = tower.z;
    world.spatialHash.insert(foe.poolIndex, foe.x, foe.z);
    tower.cooldownTimer = 0;
    const fire = () => world.combatSystem.update(BALANCE.fixedDt, world.towers);
    fire();
    expect(world.projectilePool.getActiveCount()).toBe(0);
    world.specializeTower(tower.id, 'farwatch');
    fire();
    const missiles = world.projectilePool;
    expect(missiles.getActiveCount()).toBe(1);
    const first = missiles.items[missiles.getActiveIndex(0)];
    expect(first).toMatchObject({ damage: 75, armorPierce: 8, pierceCount: 0 });
    world.buyTowerAbility(tower.id, 'throughshot');
    tower.cooldownTimer = 0;
    fire();
    expect(missiles.items[missiles.getActiveIndex(1)]).toMatchObject({ damage: 75, pierceCount: 1 });
    expect(first.pierceCount).toBe(0);
  });

  it.each(['keep', 'sell and rebuild'] as const)('resolves and replays airborne Throughshot arrows when you %s', action => {
    const entrance = { id: 'A', x: -13, z: 0 };
    const goal = { x: 0, z: 0 };
    const lane = [entrance, goal];
    const encounter: LevelDef = {
      ...level,
      id: 'throughshot-impact',
      enemyHpScale: 0.3, // Two 102-HP golems, each with 12 armor.
      layout2d: {
        ...level.layout2d!, entrances: [entrance], goal, paths: [lane], flightPath: lane,
        plots: [{ x: 0, z: 1 }],
      },
      waves: [{ groups: [{ enemyType: 'golem', count: 2, spawnInterval: 1, startDelay: 0 }], clearBonus: 15 }],
    };
    const world = new SimWorld(encounter, new EventBus(), { recordCommands: true });
    const hits: { enemyId: number; damage: number }[] = [];
    world.events.on('enemyHit', ({ enemyId, damage }) => hits.push({ enemyId, damage }));
    const lodge = world.placeTowerOnPlot(0, 'archer', 'closest')!;
    expect(world.upgradeTower(lodge.id)).toBe(true);
    expect(world.upgradeTower(lodge.id)).toBe(true);
    expect(world.specializeTower(lodge.id, 'farwatch')).toBe(true);
    expect(world.buyTowerAbility(lodge.id, 'throughshot')).toBe(true);
    expect(world.startNextWave()).toBe(true);

    while (lodge.shotCount < 2 && world.outcome === 'ongoing' && world.tick < 600) {
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(lodge.shotCount).toBe(2);
    expect(world.projectilePool.getActiveCount()).toBe(1);
    const arrow = world.projectilePool.items[world.projectilePool.getActiveIndex(0)];
    const front = arrow.targetUid;
    expect(hits).toHaveLength(2);
    const rear = hits[1].enemyId;
    expect(rear).not.toBe(front);
    // Direct: 75 minus 4 remaining armor. Throughshot: round(75 × 0.75) minus 4.
    expect(hits).toEqual([{ enemyId: front, damage: 71 }, { enemyId: rear, damage: 52 }]);
    expect(lodge).toMatchObject({ totalDamageDealt: 123, kills: 0 });
    if (action === 'sell and rebuild') {
      expect(world.sellTower(lodge.id)).toBe(computeSellRefund(lodge.totalInvested));
      expect(world.placeTowerOnPlot(0, 'archer')).toBeTruthy();
    }
    const goldBeforeImpact = world.gold;
    while (world.outcome === 'ongoing' && world.tick < 900) world.fixedTick(BALANCE.fixedDt);
    expect(hits.slice(2)).toEqual([{ enemyId: front, damage: 31 }, { enemyId: rear, damage: 50 }]);
    expect(world).toMatchObject({ outcome: 'won', enemiesKilledTotal: 2, gold: goldBeforeImpact + 20 + 15 });
    if (action === 'keep') {
      expect(lodge).toMatchObject({ totalDamageDealt: 204, kills: 2 });
    } else {
      expect(lodge).toMatchObject({ totalDamageDealt: 123, kills: 0 });
      expect(world.towers[0]).toMatchObject({ totalDamageDealt: 0, kills: 0, shotCount: 0 });
    }

    const log = parseSimReplay(serializeSimReplay(world.exportReplay()))!;
    const playback = new SimReplayPlayer(encounter, log);
    const replayHits: typeof hits = [];
    playback.events.on('enemyHit', ({ enemyId, damage }) => replayHits.push({ enemyId, damage }));
    expect(playback.runToEnd()).toMatchObject({ matchesHash: true, matchesOutcome: true });
    expect(replayHits).toEqual(hits);
    playback.dispose();
    world.dispose();
  });

  it.each(['first', 'second'] as const)('awards overlapping ember ticks to Banked Fire when its shell lands %s', order => {
    const entrance = { id: 'A', x: 0, z: 0 };
    const goal = { x: 15, z: 0 };
    const lane = [entrance, goal];
    const encounter: LevelDef = {
      ...level,
      id: 'kiln-overlap',
      enemyHpScale: 0.93, // The armored golem survives both opening shells with 24 HP.
      layout2d: {
        ...level.layout2d!, entrances: [entrance], goal, paths: [lane], flightPath: lane,
        plots: [{ x: 1, z: 5 }, { x: 1, z: -5 }],
      },
      waves: [{ groups: [{ enemyType: 'golem', count: 1, spawnInterval: 1, startDelay: 0 }], clearBonus: 15 }],
    };
    const world = new SimWorld(encounter, new EventBus(), { recordCommands: true });
    const mortars = [0, 1].map(plot => {
      const mortar = world.placeTowerOnPlot(plot, 'mortar')!;
      expect(world.upgradeTower(mortar.id)).toBe(true);
      expect(world.upgradeTower(mortar.id)).toBe(true);
      return mortar;
    });
    const kiln = mortars[order === 'first' ? 0 : 1];
    const standard = mortars[order === 'first' ? 1 : 0];
    expect(world.specializeTower(kiln.id, 'cinderkiln')).toBe(true);
    expect(world.buyTowerAbility(kiln.id, 'bankedfire')).toBe(true);

    const radii: number[] = [];
    const hits: number[] = [];
    world.events.on('groundZone', ({ radius }) => radii.push(radius));
    world.events.on('enemyHit', ({ damage }) => hits.push(damage));
    const gold = world.gold;
    expect(world.startNextWave()).toBe(true);
    while (world.outcome === 'ongoing' && world.tick < 600) world.fixedTick(BALANCE.fixedDt);
    expect(radii).toEqual(order === 'first' ? [2.8, 2] : [2, 2.8]);
    expect(hits).toEqual([146, 146, 16, 8]);
    expect(standard).toMatchObject({ totalDamageDealt: 146, kills: 0, shotCount: 1 });
    expect(kiln).toMatchObject({ totalDamageDealt: 170, kills: 1, shotCount: 1 });
    expect(world).toMatchObject({ outcome: 'won', enemiesKilledTotal: 1, gold: gold + 10 + 15 });

    const log = parseSimReplay(serializeSimReplay(world.exportReplay()))!;
    const playback = new SimReplayPlayer(encounter, log);
    const replayHits: number[] = [];
    playback.events.on('enemyHit', ({ damage }) => replayHits.push(damage));
    expect(playback.runToEnd()).toMatchObject({ matchesHash: true, matchesOutcome: true });
    expect(replayHits).toEqual(hits);
    playback.dispose();
    world.dispose();
  });

  it('chains through seven foes in Relay Grove and an eighth on the sixth discharge', () => {
    const { world, tower } = setup('tesla');
    expect(world.specializeTower(tower.id, 'relay')).toBe(true);
    for (let i = 0; i < 9; i++) {
      const foe = world.enemySystem.spawnEnemy('brute')!;
      foe.hp = foe.maxHp = 1000;
      foe.x = tower.x + 2 + i;
      foe.z = tower.z;
      world.spatialHash.insert(foe.poolIndex, foe.x, foe.z);
    }
    tower.targetingMode = 'closest';
    const hits: number[] = [];
    world.events.on('lightningChain', ({ points }) => hits.push(points.length - 1));
    for (let i = 0; i < 7; i++) {
      tower.cooldownTimer = 0;
      world.combatSystem.update(BALANCE.fixedDt, world.towers);
    }
    expect(hits).toEqual([7, 7, 7, 7, 7, 8, 7]);
    world.dispose();
  });

  it('applies purchased beacon range to neighbors on the next tick', () => {
    const { world, tower } = setup('beacon');
    const plot = level.layout2d!.plots.findIndex((p, i) => i !== tower.col && Math.hypot(p.x - tower.x, p.z - tower.z) < 5.6);
    const archer = world.placeTowerOnPlot(plot, 'archer')!;
    world.specializeTower(tower.id, 'horizon');
    world.buyTowerAbility(tower.id, 'clearlens');
    world.fixedTick(BALANCE.fixedDt);
    expect(archer.auraRange).toBe(0.3);
  });

  it('updates live barracks stats while preserving wounded soldiers and their rally point', () => {
    const { world, tower } = setup('barracks');
    const squad = world.soldierSystem.getBarracks(tower.id)!;
    const soldier = squad.squad[0];
    soldier.hp = 12;
    const rally = [squad.rallyX, squad.rallyZ];
    world.specializeTower(tower.id, 'gateward');
    world.buyTowerAbility(tower.id, 'ironmantle');
    expect(squad.stats.soldierArmor).toBe(14);
    expect(soldier.hp).toBe(12);
    expect([squad.rallyX, squad.rallyZ]).toEqual(rally);
  });
});
