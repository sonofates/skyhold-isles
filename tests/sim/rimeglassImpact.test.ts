import { expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/l1c.ts';
import { parseSimReplay, serializeSimReplay, SimReplayPlayer, SimWorld } from '../../src/sim/world.ts';

const entrance = { id: 'road', x: 0, z: 0 };
const goal = { x: 16, z: 0 };
const path = [entrance, goal];
const encounter: LevelDef = {
  ...LEVEL_L1C, id: 'rimeglass-impact', startingGold: 1200, enemyHpScale: 0.55,
  layout2d: { ...LEVEL_L1C.layout2d!, entrances: [entrance], paths: [path], goal, flightPath: path, plots: [{ x: 0, z: -2 }] },
  waves: [{ clearBonus: 15, groups: [
    { enemyType: 'golem', count: 1, spawnInterval: 1, startDelay: 0 },
    { enemyType: 'golem', count: 1, spawnInterval: 1, startDelay: 0.5, elite: true },
  ] }],
};

function traceShards(world: SimWorld) {
  const hits: { lead: boolean; shot: number; damage: number; armor: number; slow: number }[] = [];
  const armorCracks: { lead: boolean; shot: number }[] = [];
  const bonuses: number[][] = [];
  const golem = (id: number) => world.enemyPool.items.find(e => e.active && e.uid === id)!;
  world.events.on('towerFired', () => bonuses.push([]));
  world.events.on('enemyHit', ({ enemyId, damage }) => {
    const e = golem(enemyId);
    hits.push({ lead: !e.elite, shot: bonuses.length, damage, armor: e.armor, slow: e.slowRatio });
  });
  world.events.on('armorCracked', ({ enemyId }) => armorCracks.push({ lead: !golem(enemyId).elite, shot: bonuses.length }));
  world.events.on('brittleCrack', ({ bonus }) => bonuses[bonuses.length - 1].push(bonus));
  return { hits, armorCracks, bonuses };
}

it.each(['before combat', 'during the second shot', 'never'] as const)(
  'resolves fresh and chilled golems in one splash with Cold Fracture purchased %s',
  timing => {
    const world = new SimWorld(encounter, new EventBus(), { recordCommands: true });
    const trace = traceShards(world);
    const tower = world.placeTowerOnPlot(0, 'frost', 'first')!;
    expect(world.upgradeTower(tower.id)).toBe(true);
    expect(world.upgradeTower(tower.id)).toBe(true);
    expect(world.specializeTower(tower.id, 'rimeglass')).toBe(true);
    if (timing === 'before combat') expect(world.buyTowerAbility(tower.id, 'coldfracture')).toBe(true);
    expect(world.startNextWave()).toBe(true);
    while (tower.shotCount < 2 && world.tick < 120) world.fixedTick(BALANCE.fixedDt);
    expect(world.projectilePool.getActiveCount()).toBe(1);
    expect(trace.hits).toHaveLength(1);
    if (timing === 'during the second shot') expect(world.buyTowerAbility(tower.id, 'coldfracture')).toBe(true);
    while (world.outcome === 'ongoing' && world.tick < 1200) world.fixedTick(BALANCE.fixedDt);
    expect(world.outcome).toBe('won');

    const early = timing === 'before combat';
    const upgraded = timing !== 'never';
    // The lead takes full splash. On shot two, 42% chill adds 71.4% before armor.
    expect(trace.hits.filter(h => h.lead).slice(0, 3)).toEqual([
      { lead: true, shot: 1, damage: early ? 36 : 24, armor: 12, slow: 0 },
      { lead: true, shot: 2, damage: early ? 62 : 59, armor: 3, slow: 0.42 },
      { lead: true, shot: 3, damage: upgraded ? 70 : 67, armor: 3, slow: 0.55 },
    ]);
    // Falloff leaves 34 base damage on the fresh elite. Even upgraded, it retains one armor.
    expect(trace.hits.filter(h => !h.lead).slice(0, 2)).toEqual([
      { lead: false, shot: 2, damage: early ? 33 : 21, armor: 13, slow: 0 },
      { lead: false, shot: 3, damage: upgraded ? 60 : 57, armor: 3, slow: 0.42 },
    ]);
    expect(trace.armorCracks).toEqual([{ lead: true, shot: 1 }, { lead: false, shot: 2 }]);
    expect(trace.bonuses.slice(0, 2)).toEqual([[], [0.714]]);
    expect([...trace.bonuses[2]].sort((a, b) => a - b)).toEqual([0.714, 0.935]);
    expect(tower.totalDamageDealt).toBe(514);
    expect(tower.kills).toBe(2);

    const playback = new SimReplayPlayer(encounter, parseSimReplay(serializeSimReplay(world.exportReplay()))!);
    const replayTrace = traceShards(playback.world);
    expect(playback.runToEnd()).toMatchObject({ matchesHash: true, matchesOutcome: true });
    expect(replayTrace).toEqual(trace);
    playback.dispose();
    world.dispose();
  },
);
