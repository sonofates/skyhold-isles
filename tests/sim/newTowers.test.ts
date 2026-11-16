import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { getTowerTierStats, TOWER_DEFS, TOWER_TYPES } from '../../src/data/towers.ts';
import type { EnemyEntity } from '../../src/sim/entities.ts';
import { acquireTarget } from '../../src/sim/targeting.ts';
import { SimWorld } from '../../src/sim/world.ts';

function makeWorld(): { world: SimWorld; events: EventBus } {
  const events = new EventBus();
  const world = new SimWorld(LEVELS[0], events);
  world.gold = 5000;
  return { world, events };
}

function place(world: SimWorld, e: EnemyEntity, x: number, z: number): void {
  e.x = x;
  e.z = z;
  e.prevX = x;
  e.prevZ = z;
  world.spatialHash.insert(e.poolIndex, x, z);
}

function flyBolt(world: SimWorld): void {
  for (let i = 0; i < 240 && world.projectilePool.getActiveCount() > 0; i++) {
    world.projectileSystem.update(BALANCE.fixedDt, world.towers);
  }
}

describe('tower data', () => {
  it('registers ballista and beacon with sequential hotkeys and monotonic tiers', () => {
    expect(TOWER_TYPES).toContain('ballista');
    expect(TOWER_TYPES).toContain('beacon');
    TOWER_TYPES.forEach((type, i) => {
      expect(TOWER_DEFS[type].hotkey).toBe(i + 1);
      const [a, b, c] = TOWER_DEFS[type].tiers;
      expect(b.range).toBeGreaterThanOrEqual(a.range);
      expect(c.range).toBeGreaterThanOrEqual(b.range);
      expect(c.damage).toBeGreaterThanOrEqual(a.damage);
    });
    expect(TOWER_DEFS.beacon.role).toBe('support');
    expect(TOWER_DEFS.ballista.role).toBe('attack');
  });
});

describe('ballista', () => {
  it('pierces armor: brute takes full damage', () => {
    const { world } = makeWorld();
    const tower = world.placeTower(4, 3, 'ballista')!;
    const stats = getTowerTierStats('ballista', 1);
    const brute = world.enemySystem.spawnEnemy('brute')!; // armor 6
    brute.hp = brute.maxHp = 1000;
    place(world, brute, tower.x + 6, tower.z);

    expect(acquireTarget(tower, stats, world.enemyPool, world.spatialHash)?.uid).toBe(brute.uid);
    world.projectileSystem.spawnProjectile(tower, brute, 1);
    flyBolt(world);
    expect(brute.hp).toBe(1000 - stats.damage);
  });

  it('only partly pierces armor above its pierce value', () => {
    const { world } = makeWorld();
    const tower = world.placeTower(4, 3, 'ballista')!;
    const boss = world.enemySystem.spawnEnemy('boss')!; // armor 8, ballista T1 pierce 6
    boss.hp = boss.maxHp = 5000;
    place(world, boss, tower.x + 5, tower.z);
    world.projectileSystem.spawnProjectile(tower, boss, 1);
    flyBolt(world);
    expect(boss.hp).toBe(5000 - (66 - 2));
  });

  it('T2 bolts pierce an enemy lined up behind the target but not one off to the side', () => {
    const { world } = makeWorld();
    const tower = world.placeTower(4, 3, 'ballista')!;
    world.upgradeTower(tower.id);
    const stats = getTowerTierStats('ballista', 2);

    const front = world.enemySystem.spawnEnemy('grunt')!;
    const behind = world.enemySystem.spawnEnemy('grunt')!;
    const aside = world.enemySystem.spawnEnemy('grunt')!;
    for (const e of [front, behind, aside]) e.hp = e.maxHp = 1000;
    place(world, front, tower.x + 5, tower.z);
    place(world, behind, tower.x + 6.8, tower.z + 0.2);
    place(world, aside, tower.x + 6.0, tower.z + 2.4);

    world.projectileSystem.spawnProjectile(tower, front, 1);
    flyBolt(world);
    expect(front.hp).toBe(1000 - stats.damage);
    expect(behind.hp).toBe(1000 - Math.round(stats.damage * (stats.pierceFalloff ?? 1)));
    expect(aside.hp).toBe(1000);
  });

  it('pierce count caps the number of extra victims', () => {
    const { world } = makeWorld();
    const tower = world.placeTower(4, 3, 'ballista')!;
    world.upgradeTower(tower.id); // T2: pierceCount 1
    const front = world.enemySystem.spawnEnemy('grunt')!;
    const b1 = world.enemySystem.spawnEnemy('grunt')!;
    const b2 = world.enemySystem.spawnEnemy('grunt')!;
    for (const e of [front, b1, b2]) e.hp = e.maxHp = 1000;
    place(world, front, tower.x + 5, tower.z);
    place(world, b1, tower.x + 6, tower.z);
    place(world, b2, tower.x + 7, tower.z);
    world.projectileSystem.spawnProjectile(tower, front, 1);
    flyBolt(world);
    expect(b1.hp).toBeLessThan(1000);
    expect(b2.hp).toBe(1000);
  });

  it('outranges a T3 archer and hits flyers', () => {
    expect(getTowerTierStats('ballista', 1).range).toBeGreaterThan(getTowerTierStats('archer', 3).range);
    expect(TOWER_DEFS.ballista.hitsFlyers).toBe(true);
  });
});

describe('beacon', () => {
  it('grants fire-rate aura to towers in range; best bonus wins (no stacking, beacons not buffed)', () => {
    const { world } = makeWorld();
    const archer = world.placeTower(4, 2, 'archer')!;
    const far = world.placeTower(12, 9, 'archer')!;
    const b1 = world.placeTower(5, 2, 'beacon')!; // adjacent tile: 2.0 away
    const b2 = world.placeTower(4, 1, 'beacon')!;
    world.upgradeTower(b2.id);
    world.upgradeTower(b2.id);

    world.combatSystem.update(BALANCE.fixedDt, world.towers);
    expect(archer.auraRate).toBeCloseTo(getTowerTierStats('beacon', 3).auraRate!, 6);
    expect(archer.auraRange).toBeCloseTo(getTowerTierStats('beacon', 3).auraRange!, 6);
    expect(far.auraRate).toBe(0);
    expect(b1.auraRate).toBe(0);
  });

  it('jammed beacon stops buffing; buff speeds cooldown recovery', () => {
    const { world } = makeWorld();
    const archer = world.placeTower(4, 2, 'archer')!;
    const beacon = world.placeTower(5, 2, 'beacon')!;
    beacon.stunTimer = 1;
    world.combatSystem.update(BALANCE.fixedDt, world.towers);
    expect(archer.auraRate).toBe(0);
    beacon.stunTimer = 0;

    archer.cooldownTimer = 1;
    world.combatSystem.update(0.5, world.towers);
    const rate = getTowerTierStats('beacon', 1).auraRate!;
    expect(archer.cooldownTimer).toBeCloseTo(1 - 0.5 * (1 + rate), 6);
  });

  it('range aura lets a tower acquire targets beyond its base range', () => {
    const { world } = makeWorld();
    const tower = world.placeTower(4, 2, 'archer')!;
    world.upgradeTower(tower.id);
    world.upgradeTower(tower.id);
    const beacon = world.placeTower(5, 2, 'beacon')!;
    world.upgradeTower(beacon.id);
    world.upgradeTower(beacon.id);
    const stats = getTowerTierStats('archer', 3);
    const g = world.enemySystem.spawnEnemy('grunt')!;
    place(world, g, tower.x + stats.range * 1.05, tower.z);
    expect(acquireTarget(tower, stats, world.enemyPool, world.spatialHash)).toBeNull();
    world.combatSystem.update(BALANCE.fixedDt, world.towers);
    expect(acquireTarget(tower, stats, world.enemyPool, world.spatialHash)?.uid).toBe(g.uid);
  });

  it('emits beaconPulse events and never towerFired', () => {
    const { world, events } = makeWorld();
    world.placeTower(5, 2, 'beacon');
    let pulses = 0;
    let fired = 0;
    events.on('beaconPulse', () => pulses++);
    events.on('towerFired', () => fired++);
    for (let i = 0; i < 60 * 6; i++) world.combatSystem.update(BALANCE.fixedDt, world.towers);
    expect(pulses).toBeGreaterThanOrEqual(2);
    expect(fired).toBe(0);
  });
});
