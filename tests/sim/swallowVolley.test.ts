import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { defaultLevel20Skills } from '../../src/data/heroes.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/l1c.ts';
import { SimWorld } from '../../src/sim/world.ts';

function roostEncounter(withTobb = false) {
  const level = {
    ...LEVEL_L1C, startingGold: 2500,
    layout2d: { ...LEVEL_L1C.layout2d!, plots: [{ x: 0, z: 0 }, { x: -2, z: 0 }] },
  };
  const world = new SimWorld(level, new EventBus(), withTobb
    ? { heroId: 'tobb', heroLevel: 20, heroSkills: defaultLevel20Skills('tobb') }
    : {});
  const tower = world.placeTowerOnPlot(0, 'archer', 'strongest')!;
  world.upgradeTower(tower.id);
  world.upgradeTower(tower.id);
  expect(world.specializeTower(tower.id, 'swallow')).toBe(true);

  function foe(x: number, z: number, type: 'grunt' | 'flyer' = 'grunt', hp = 500) {
    const e = world.enemySystem.spawnEnemy(type)!;
    e.x = x;
    e.z = z;
    e.hp = e.maxHp = hp;
    world.spatialHash.insert(e.poolIndex, x, z);
    return e;
  }

  function fire() {
    tower.cooldownTimer = 0;
    world.combatSystem.update(BALANCE.fixedDt, world.towers);
    const arrows = world.projectilePool.items.filter(p => p.active).map(p => p.targetUid);
    for (let i = 0; i < 120 && world.projectilePool.getActiveCount(); i++) {
      world.projectileSystem.update(BALANCE.fixedDt, world.towers);
    }
    expect(world.projectilePool.getActiveCount()).toBe(0);
    return arrows;
  }
  return { world, tower, foe, fire };
}

describe('Swallow Roost volley', () => {
  it('adds two arrows every third shot, then four after buying Gathering Flock mid-cycle', () => {
    const { world, tower, foe, fire } = roostEncounter();
    const lead = foe(4, 0, 'grunt', 1000);
    const others = [2.5, 1.5, 0.5, 2, 1].map(z => foe(4, z));
    foe(4, 0.2).burrowed = true;
    expect(fire()).toEqual([lead.uid]);
    expect(fire()).toEqual([lead.uid]);
    expect(fire()).toHaveLength(3);
    expect(others.map(e => e.maxHp - e.hp)).toEqual([0, 0, 19, 0, 19]);
    expect(fire()).toEqual([lead.uid]);
    expect(world.buyTowerAbility(tower.id, 'flock')).toBe(true);
    expect(fire()).toEqual([lead.uid]);
    expect(fire()).toHaveLength(5);
    expect(others.map(e => e.maxHp - e.hp)).toEqual([0, 19, 38, 19, 38]);
    expect(lead.maxHp - lead.hp).toBe(6 * 38);
    expect(tower.totalDamageDealt).toBe(6 * 38 + 6 * 19);
    world.dispose();
  });

  it('returns spare arrows to the primary when the only other foe is outside the volley circle', () => {
    const { world, tower, foe, fire } = roostEncounter();
    const lead = foe(4, 0, 'grunt', 1000);
    const flank = foe(1.5, 2.5); // Inside the queried square, 3.54 units from the primary.
    expect(world.buyTowerAbility(tower.id, 'flock')).toBe(true);
    tower.shotCount = 2;
    expect(fire()).toEqual(Array(5).fill(lead.uid));
    expect(lead.maxHp - lead.hp).toBe(114);
    expect(flank.hp).toBe(flank.maxHp);

    const flyer = foe(4, 3.2, 'flyer');
    tower.shotCount = 5;
    expect(fire().sort()).toEqual([lead.uid, lead.uid, lead.uid, lead.uid, flyer.uid].sort());
    expect(flyer.maxHp - flyer.hp).toBe(19);
    expect(lead.maxHp - lead.hp).toBe(114 + 95);
    expect(flank.hp).toBe(flank.maxHp);
    world.dispose();
  });

  it.each([
    { tobb: false, beacon: false }, { tobb: true, beacon: false },
    { tobb: false, beacon: true }, { tobb: true, beacon: true },
  ])('uses the same range edge for primary and secondary arrows (Tobb $tobb, beacon $beacon)', ({ tobb, beacon }) => {
    const { world, tower, foe, fire } = roostEncounter(tobb);
    if (beacon) {
      const lantern = world.placeTowerOnPlot(1, 'beacon')!;
      world.upgradeTower(lantern.id);
      world.upgradeTower(lantern.id);
      expect(world.specializeTower(lantern.id, 'horizon')).toBe(true);
      expect(world.buyTowerAbility(lantern.id, 'clearlens')).toBe(true);
    }
    if (tobb) {
      const hero = world.hero!;
      hero.x = hero.postX = tower.x;
      hero.z = hero.postZ = tower.z;
      world.heroSystem.update(BALANCE.fixedDt, world.towers);
    }
    expect(world.buyTowerAbility(tower.id, 'flock')).toBe(true);
    const range = 6.9 * (1 + (beacon ? 0.30 : 0) + (tobb ? 0.08 : 0));
    const lead = foe(range - 0.01, 0, 'grunt', 1000);
    const edge = foe(range, 0, 'flyer');
    const outside = foe(range + 0.01, 0, 'grunt', 1500); // Would win 'strongest' if eligible.
    tower.shotCount = 2;
    fire();
    expect(lead.maxHp - lead.hp).toBe(95);
    expect(edge.maxHp - edge.hp).toBe(19);
    expect(outside.hp).toBe(outside.maxHp);
    world.dispose();
  });
});
