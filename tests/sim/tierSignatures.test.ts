import { describe, expect, it } from 'vitest';
import { EventBus, type GameEventMap } from '../../src/core/eventBus.ts';
import type { TowerType } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { getTowerTierStats } from '../../src/data/towers.ts';
import type { EnemyEntity, TowerEntity } from '../../src/sim/entities.ts';
import { BURN_TICK_INTERVAL, computeSplashMultiplier } from '../../src/sim/projectileSystem.ts';
import { SimWorld } from '../../src/sim/world.ts';

function makeWorld(): { world: SimWorld; events: EventBus } {
  const events = new EventBus();
  const world = new SimWorld(LEVELS[0], events);
  world.gold = 9000;
  return { world, events };
}

function maxed(world: SimWorld, col: number, row: number, type: TowerType): TowerEntity {
  const t = world.placeTower(col, row, type)!;
  world.upgradeTower(t.id);
  world.upgradeTower(t.id);
  expect(t.tier).toBe(3);
  return t;
}

function put(world: SimWorld, type: 'grunt' | 'brute' | 'flyer', x: number, z: number, hp = 10000): EnemyEntity {
  const e = world.enemySystem.spawnEnemy(type)!;
  e.hp = e.maxHp = hp;
  e.x = x;
  e.z = z;
  e.prevX = x;
  e.prevZ = z;
  e.speed = 0; // keep it parked for the test
  world.spatialHash.insert(e.poolIndex, x, z);
  return e;
}

function runUntilProjectilesLand(world: SimWorld, maxTicks = 600): void {
  for (let i = 0; i < maxTicks && world.projectilePool.getActiveCount() > 0; i++) {
    world.projectileSystem.update(BALANCE.fixedDt, world.towers);
  }
}

describe('archer T3 volley', () => {
  it('every Nth shot looses extra arrows, other shots stay single', () => {
    const { world, events } = makeWorld();
    const tower = maxed(world, 4, 2, 'archer');
    const stats = getTowerTierStats('archer', 3);
    expect(stats.volleyEvery).toBeGreaterThan(0);
    const e1 = put(world, 'grunt', tower.x + 4, tower.z);
    put(world, 'grunt', tower.x + 4.8, tower.z + 0.6);
    put(world, 'grunt', tower.x + 4.4, tower.z - 0.8);
    const specials: boolean[] = [];
    events.on('towerFired', (ev) => specials.push(ev.special === true));

    const counts: number[] = [];
    for (let shot = 1; shot <= stats.volleyEvery! * 2; shot++) {
      tower.cooldownTimer = 0;
      world.projectilePool.clear();
      world.combatSystem.update(BALANCE.fixedDt, world.towers);
      counts.push(world.projectilePool.getActiveCount());
      void e1;
    }
    const expected = Array.from({ length: stats.volleyEvery! * 2 }, (_, i) =>
      (i + 1) % stats.volleyEvery! === 0 ? 1 + stats.volleyExtra! : 1,
    );
    expect(counts).toEqual(expected);
    expect(specials.filter(Boolean)).toHaveLength(2);
  });

  it('extra arrows deal reduced damage and prefer other nearby enemies', () => {
    const { world } = makeWorld();
    const tower = maxed(world, 4, 2, 'archer');
    const stats = getTowerTierStats('archer', 3);
    const a = put(world, 'grunt', tower.x + 4, tower.z);
    const b = put(world, 'grunt', tower.x + 4.6, tower.z + 1.0);
    const c = put(world, 'grunt', tower.x + 4.2, tower.z - 1.2);
    tower.targetingMode = 'closest';
    tower.shotCount = stats.volleyEvery! - 1;
    tower.cooldownTimer = 0;
    world.combatSystem.update(BALANCE.fixedDt, world.towers);
    runUntilProjectilesLand(world);
    expect(a.hp).toBeLessThan(a.maxHp);
    // With volleyExtra >= 1 the closest other enemy takes a reduced volley hit; with >= 2 both do.
    const others = [b, c].filter((e) => e.hp < e.maxHp);
    expect(others.length).toBeGreaterThanOrEqual(Math.min(2, stats.volleyExtra!));
    for (const o of others) {
      const dmg = o.maxHp - o.hp;
      expect(dmg).toBeLessThan(stats.damage);
      expect(dmg).toBeGreaterThan(0);
    }
  });
});

describe('tesla T3 overload', () => {
  it('every Nth discharge hits harder and jumps further', () => {
    const { world, events } = makeWorld();
    const tower = maxed(world, 4, 2, 'tesla');
    const stats = getTowerTierStats('tesla', 3);
    expect(stats.overloadEvery).toBeGreaterThan(0);
    // A long line of enemies, each within chain range of the next.
    const line: EnemyEntity[] = [];
    for (let i = 0; i < 10; i++) line.push(put(world, 'grunt', tower.x + 2.5 + i * 0.9, tower.z));
    const chains: GameEventMap['lightningChain'][] = [];
    events.on('lightningChain', (ev) => chains.push(ev));

    tower.targetingMode = 'closest';
    tower.shotCount = stats.overloadEvery! - 1;
    tower.cooldownTimer = 0;
    world.combatSystem.update(BALANCE.fixedDt, world.towers);
    tower.cooldownTimer = 0;
    world.combatSystem.update(BALANCE.fixedDt, world.towers);

    expect(chains).toHaveLength(2);
    expect(chains[0].overload).toBe(true);
    expect(chains[1].overload).toBe(false);
    // origin point + one point per jump
    expect(chains[0].points.length - 1).toBe(stats.chainCount + stats.overloadChain!);
    expect(chains[1].points.length - 1).toBe(stats.chainCount);
    const first = line[0];
    expect(first.maxHp - first.hp).toBe(
      Math.round(stats.damage * stats.overloadDamage!) + Math.round(stats.damage),
    );
  });
});

describe('cannon T3 cluster shells', () => {
  it('bomblets splash enemies outside the main blast and emit extra impact events', () => {
    const { world, events } = makeWorld();
    const tower = maxed(world, 4, 2, 'cannon');
    const stats = getTowerTierStats('cannon', 3);
    expect(stats.clusterCount).toBeGreaterThan(0);

    const centre = put(world, 'grunt', tower.x + 4.5, tower.z);
    // Ring of enemies at the bomblet offset, outside the main splash radius.
    const ring: EnemyEntity[] = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      ring.push(
        put(world, 'grunt', centre.x + Math.cos(a) * stats.clusterOffset!, centre.z + Math.sin(a) * stats.clusterOffset!),
      );
    }
    const impacts: GameEventMap['projectileImpact'][] = [];
    events.on('projectileImpact', (ev) => impacts.push(ev));

    // Shell lands exactly on `centre`.
    const p = world.projectilePool.acquire()!;
    p.towerType = 'cannon';
    p.towerId = tower.id;
    p.targetPoolIndex = -1;
    p.damage = stats.damage;
    p.splashRadius = stats.splashRadius;
    p.splashFalloffMin = stats.splashFalloffMin;
    p.clusterCount = stats.clusterCount!;
    p.clusterDamage = stats.clusterDamage!;
    p.clusterRadius = stats.clusterRadius!;
    p.clusterOffset = stats.clusterOffset!;
    p.clusterSeed = 3;
    p.endX = centre.x;
    p.endZ = centre.z;
    p.endY = 0.5;
    p.progress = 1;
    p.duration = 1;
    world.projectileSystem.update(0, world.towers);

    expect(impacts).toHaveLength(1 + stats.clusterCount!);
    // Everything at the main blast edge got hit by the main shell; ring enemies beyond splash got bomblet damage.
    const mainDmg = Math.round(stats.damage * computeSplashMultiplier(0, stats.splashRadius, stats.splashFalloffMin));
    expect(centre.maxHp - centre.hp).toBe(mainDmg);
    const bombletHits = ring.filter((e) => e.hp < e.maxHp);
    expect(bombletHits.length).toBeGreaterThan(0);
    for (const e of bombletHits) {
      expect(e.maxHp - e.hp).toBeLessThanOrEqual(Math.round(stats.damage * stats.clusterDamage!));
    }
  });
});

describe('frost T3 brittle', () => {
  it('deals extra damage to already-chilled targets', () => {
    const { world } = makeWorld();
    const tower = maxed(world, 4, 2, 'frost');
    const stats = getTowerTierStats('frost', 3);
    expect(stats.brittle).toBeGreaterThan(0);
    const fresh = put(world, 'grunt', tower.x + 3, tower.z);
    const chilled = put(world, 'grunt', tower.x + 3, tower.z + 6);
    chilled.slowRatio = 0.5;
    chilled.slowTimer = 5;
    world.projectileSystem.spawnProjectile(tower, fresh, stats.splashFalloffMin);
    world.projectileSystem.spawnProjectile(tower, chilled, stats.splashFalloffMin);
    runUntilProjectilesLand(world);
    const freshDmg = fresh.maxHp - fresh.hp;
    const chilledDmg = chilled.maxHp - chilled.hp;
    expect(freshDmg).toBeGreaterThan(0);
    expect(chilledDmg).toBeGreaterThan(freshDmg * (1 + stats.brittle! * 0.5) * 0.9);
  });
});

describe('mortar T3 incendiary', () => {
  function lobShell(world: SimWorld, tower: TowerEntity, x: number, z: number): void {
    const stats = getTowerTierStats('mortar', 3);
    const p = world.projectilePool.acquire()!;
    p.towerType = 'mortar';
    p.towerId = tower.id;
    p.targetPoolIndex = -1;
    p.damage = stats.damage;
    p.splashRadius = stats.splashRadius;
    p.splashFalloffMin = stats.splashFalloffMin;
    p.burnDamage = stats.burnDamage ?? 0;
    p.burnRadius = stats.burnRadius ?? 0;
    p.burnDuration = stats.burnDuration ?? 0;
    p.endX = x;
    p.endZ = z;
    p.endY = 0.5;
    p.progress = 1;
    p.duration = 1;
    world.projectileSystem.update(0, world.towers);
  }

  it('leaves a patch that burns ground enemies (ignoring armor) on a fixed tick, then expires', () => {
    const { world, events } = makeWorld();
    const tower = maxed(world, 4, 2, 'mortar');
    const stats = getTowerTierStats('mortar', 3);
    expect(stats.burnDamage).toBeGreaterThan(0);
    const zones: GameEventMap['groundZone'][] = [];
    events.on('groundZone', (ev) => zones.push(ev));

    const brute = put(world, 'brute', tower.x + 6, tower.z);
    const flyer = put(world, 'flyer', tower.x + 6, tower.z);
    const outsider = put(world, 'grunt', tower.x + 6 + stats.burnRadius! + 1, tower.z);
    lobShell(world, tower, brute.x, brute.z);
    expect(zones).toHaveLength(1);
    expect(world.projectileSystem.getActiveBurnZoneCount()).toBe(1);

    const hpAfterBlast = brute.hp;
    const flyerHp = flyer.hp;
    const outsiderHp = outsider.hp;
    const steps = Math.round(BURN_TICK_INTERVAL / BALANCE.fixedDt) + 1;
    for (let i = 0; i < steps; i++) world.projectileSystem.update(BALANCE.fixedDt, world.towers);
    expect(hpAfterBlast - brute.hp).toBe(stats.burnDamage); // full damage despite brute armor
    expect(flyer.hp).toBe(flyerHp);
    expect(outsider.hp).toBe(outsiderHp);

    const totalTicks = Math.floor(stats.burnDuration! / BURN_TICK_INTERVAL);
    for (let i = 0; i < Math.round((stats.burnDuration! + 1) / BALANCE.fixedDt); i++) {
      world.projectileSystem.update(BALANCE.fixedDt, world.towers);
    }
    expect(world.projectileSystem.getActiveBurnZoneCount()).toBe(0);
    expect(hpAfterBlast - brute.hp).toBeLessThanOrEqual(stats.burnDamage! * (totalTicks + 1));
    expect(hpAfterBlast - brute.hp).toBeGreaterThanOrEqual(stats.burnDamage! * (totalTicks - 1));
  });

  it('overlapping patches never double-hit an enemy within one tick', () => {
    const { world } = makeWorld();
    const tower = maxed(world, 4, 2, 'mortar');
    const stats = getTowerTierStats('mortar', 3);
    const g = put(world, 'grunt', tower.x + 6, tower.z);
    lobShell(world, tower, g.x, g.z);
    lobShell(world, tower, g.x + 0.3, g.z);
    expect(world.projectileSystem.getActiveBurnZoneCount()).toBe(2);
    const before = g.hp;
    const steps = Math.round(BURN_TICK_INTERVAL / BALANCE.fixedDt) + 1;
    for (let i = 0; i < steps; i++) world.projectileSystem.update(BALANCE.fixedDt, world.towers);
    expect(before - g.hp).toBe(stats.burnDamage);
  });
});
