import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { getTowerTierStats } from '../../src/data/towers.ts';
import { computeSplashMultiplier } from '../../src/sim/projectileSystem.ts';
import { SimWorld } from '../../src/sim/world.ts';

function makeWorld(): { world: SimWorld; events: EventBus } {
  const events = new EventBus();
  const world = new SimWorld(LEVELS[0], events);
  world.gold = 2000;
  return { world, events };
}

describe('armor', () => {
  it('subtracts flat armor from damage and enforces minimum 1 damage floor', () => {
    const { world } = makeWorld();
    const brute = world.enemySystem.spawnEnemy('brute')!; // armor 6
    const startHp = brute.hp;

    // Above armor
    const hit1 = world.enemySystem.applyDamage(brute, 20);
    expect(hit1.actualDamage).toBe(14);
    expect(brute.hp).toBe(startHp - 14);

    // Equal to armor still deals minArmorDamage (1)
    const hitEqual = world.enemySystem.applyDamage(brute, brute.armor);
    expect(hitEqual.actualDamage).toBe(BALANCE.minArmorDamage);

    // Lower than armor or zero raw damage never falls below minArmorDamage (1)
    const hitLow = world.enemySystem.applyDamage(brute, 2);
    expect(hitLow.actualDamage).toBe(BALANCE.minArmorDamage);

    const hitZero = world.enemySystem.applyDamage(brute, 0);
    expect(hitZero.actualDamage).toBe(BALANCE.minArmorDamage);

    // ignoreArmor bypasses flat reduction
    const preBypass = brute.hp;
    const bypass = world.enemySystem.applyDamage(brute, 10, true);
    expect(bypass.actualDamage).toBe(10);
    expect(brute.hp).toBe(preBypass - 10);
  });

  it('clamps lethal damage to remaining HP and ignores subsequent hits on dead or inactive targets', () => {
    const { world } = makeWorld();
    const boss = world.enemySystem.spawnEnemy('boss')!; // armor 8
    boss.hp = 12;

    const killHit = world.enemySystem.applyDamage(boss, 100);
    expect(killHit).toEqual({ actualDamage: 12, killed: true });
    expect(boss.hp).toBe(0);

    const deadFollowup = world.enemySystem.applyDamage(boss, 50);
    expect(deadFollowup).toEqual({ actualDamage: 0, killed: false });
  });
});

describe('slow stacking cap', () => {
  it('stacks slow hits additively by half subsequent potency up to maxSlowRatio cap', () => {
    const { world } = makeWorld();
    const grunt = world.enemySystem.spawnEnemy('grunt')!;

    world.enemySystem.applySlow(grunt, 0.28, 2.4);
    expect(grunt.slowRatio).toBeCloseTo(0.28, 5);

    world.enemySystem.applySlow(grunt, 0.28, 2.4);
    expect(grunt.slowRatio).toBeCloseTo(0.42, 5);

    world.enemySystem.applySlow(grunt, 0.44, 2.4);
    expect(grunt.slowRatio).toBeLessThanOrEqual(BALANCE.maxSlowRatio);
    expect(grunt.slowRatio).toBeCloseTo(BALANCE.maxSlowRatio, 5);

    // Extreme slow ratio cannot exceed maxSlowRatio
    world.enemySystem.applySlow(grunt, 0.95, 2.4);
    expect(grunt.slowRatio).toBeCloseTo(BALANCE.maxSlowRatio, 5);
  });

  it('preserves stronger existing slow and longer remaining duration, then decays back to full speed on expiry', () => {
    const { world } = makeWorld();
    const grunt = world.enemySystem.spawnEnemy('grunt')!;

    world.enemySystem.applySlow(grunt, 0.44, 3.0);
    world.enemySystem.applySlow(grunt, 0.2, 1.0); // stacks +0.10 -> 0.54, keeps longer 3.0s duration
    expect(grunt.slowRatio).toBeCloseTo(0.54, 5);
    expect(grunt.slowTimer).toBeCloseTo(3.0, 5);

    // Advance 1s under 0.54 slow: movement speed = speed * (1 - 0.54)
    const stepDt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      world.enemySystem.update(
        stepDt,
        () => {},
        () => {},
      );
    }
    expect(grunt.dist).toBeCloseTo(grunt.speed * (1 - 0.54) * 1.0, 2);
    expect(grunt.slowTimer).toBeGreaterThan(1.9);

    // Advance past remaining slowTimer (2.5s more)
    const distAt1s = grunt.dist;
    for (let i = 0; i < 150; i++) {
      world.enemySystem.update(
        stepDt,
        () => {},
        () => {},
      );
    }
    expect(grunt.slowTimer).toBe(0);
    expect(grunt.slowRatio).toBe(0);
    // Remaining 0.5s after 3.0s expiry moves at full un-slowed speed
    const distAfterExpiry = grunt.dist - distAt1s;
    expect(distAfterExpiry).toBeGreaterThan(grunt.speed * (1 - BALANCE.maxSlowRatio) * 2.5);
  });
});

describe('splash falloff', () => {
  it('computes linear multiplier at center, midpoint, edge, and clamped bounds', () => {
    expect(computeSplashMultiplier(0, 2.0, 0.45)).toBeCloseTo(1.0, 6);
    expect(computeSplashMultiplier(1.0, 2.0, 0.45)).toBeCloseTo(0.725, 6);
    expect(computeSplashMultiplier(2.0, 2.0, 0.45)).toBeCloseTo(0.45, 6);
    expect(computeSplashMultiplier(5.0, 2.0, 0.45)).toBeCloseTo(0.45, 6);
    expect(computeSplashMultiplier(-1.0, 2.0, 0.45)).toBeCloseTo(1.0, 6);
    expect(computeSplashMultiplier(1.0, 0, 0.45)).toBe(1);
  });

  it('applies exact splash damage at center, edge, and zero damage outside radius on cannon impact', () => {
    const { world } = makeWorld();
    const cannon = world.placeTower(4, 3, 'cannon')!;
    const stats = getTowerTierStats('cannon', 1); // dmg: 38, splashRadius: 1.9, falloffMin: 0.45

    const atCenter = world.enemySystem.spawnEnemy('grunt')!;
    atCenter.x = cannon.x + 2.0;
    atCenter.z = cannon.z;

    const atEdge = world.enemySystem.spawnEnemy('grunt')!;
    atEdge.x = atCenter.x + stats.splashRadius - 0.001;
    atEdge.z = atCenter.z;

    const outside = world.enemySystem.spawnEnemy('grunt')!;
    outside.x = atCenter.x + stats.splashRadius + 0.08;
    outside.z = atCenter.z;

    world.spatialHash.clear();
    world.spatialHash.insert(atCenter.poolIndex, atCenter.x, atCenter.z);
    world.spatialHash.insert(atEdge.poolIndex, atEdge.x, atEdge.z);
    world.spatialHash.insert(outside.poolIndex, outside.x, outside.z);

    const proj = world.projectileSystem.spawnProjectile(cannon, atCenter, stats.splashFalloffMin)!;
    proj.progress = 0.99;
    world.projectileSystem.update(0.2, [cannon]);

    expect(atCenter.maxHp - atCenter.hp).toBe(stats.damage);
    expect(atEdge.maxHp - atEdge.hp).toBe(Math.round(stats.damage * stats.splashFalloffMin));
    expect(outside.hp).toBe(outside.maxHp);
  });
});

describe('tesla chain count, falloff, and no double-hit', () => {
  it('chains up to tier jump limit with exponential falloff and respects chainRange', () => {
    const { world, events } = makeWorld();
    const tesla = world.placeTower(4, 3, 'tesla')!;
    world.upgradeTower(tesla.id); // T2: chainCount: 4, chainRange: 3.7, chainFalloff: 0.78
    const t2Stats = getTowerTierStats('tesla', 2);
    tesla.cooldownTimer = 0;

    const chain: ReturnType<typeof world.enemySystem.spawnEnemy>[] = [];
    for (let i = 0; i < 4; i++) {
      const g = world.enemySystem.spawnEnemy('grunt')!;
      g.maxHp = 500;
      g.hp = 500;
      g.x = tesla.x + 1.0 + i * 2.0;
      g.z = tesla.z;
      g.dist = 40 - i * 5;
      chain.push(g);
    }
    const outOfChainRange = world.enemySystem.spawnEnemy('grunt')!;
    outOfChainRange.x = chain[3]!.x + t2Stats.chainRange + 0.5;
    outOfChainRange.z = chain[3]!.z;
    outOfChainRange.dist = 1;

    world.spatialHash.clear();
    for (const e of chain) world.spatialHash.insert(e!.poolIndex, e!.x, e!.z);
    world.spatialHash.insert(outOfChainRange.poolIndex, outOfChainRange.x, outOfChainRange.z);

    let arcVertices = 0;
    events.on('lightningChain', (ev) => {
      arcVertices = ev.points.length;
    });

    world.combatSystem.update(BALANCE.fixedDt, world.towers);

    expect(arcVertices).toBe(5); // tower muzzle + 4 enemy hits
    let expectedDmg = t2Stats.damage;
    for (let i = 0; i < 4; i++) {
      expect(chain[i]!.maxHp - chain[i]!.hp).toBe(Math.round(expectedDmg));
      expectedDmg *= t2Stats.chainFalloff;
    }
    expect(outOfChainRange.hp).toBe(outOfChainRange.maxHp);
  });

  it('never double-hits the same enemy within a single chain even with fewer targets than max jumps', () => {
    const { world, events } = makeWorld();
    const tesla = world.placeTower(4, 3, 'tesla')!;
    world.upgradeTower(tesla.id);
    world.upgradeTower(tesla.id); // T3: chainCount: 5
    const t3Stats = getTowerTierStats('tesla', 3);
    tesla.cooldownTimer = 0;

    // Only 2 enemies placed right next to each other
    const a = world.enemySystem.spawnEnemy('brute')!; // armor 6, 260 HP
    const b = world.enemySystem.spawnEnemy('brute')!;
    a.x = tesla.x + 1.5;
    a.z = tesla.z;
    a.dist = 20;
    b.x = a.x + 0.6;
    b.z = a.z;
    b.dist = 10;

    world.spatialHash.clear();
    world.spatialHash.insert(a.poolIndex, a.x, a.z);
    world.spatialHash.insert(b.poolIndex, b.x, b.z);

    let arcPoints = 0;
    events.on('lightningChain', (ev) => {
      arcPoints = ev.points.length;
    });

    world.combatSystem.update(BALANCE.fixedDt, world.towers);

    expect(arcPoints).toBe(3); // Tower + A + B ONLY
    expect(a.maxHp - a.hp).toBe(Math.round(t3Stats.damage) - a.armor);
    expect(b.maxHp - b.hp).toBe(Math.round(t3Stats.damage * t3Stats.chainFalloff) - b.armor);
  });
});

describe('healer not healing above max HP', () => {
  it('heals wounded allies within radius, caps at maxHp, skips out-of-range foes, and avoids empty pulses', () => {
    const { world, events } = makeWorld();
    const healerDef = ENEMY_DEFS.healer;
    const radius = healerDef.healRadius ?? 3.8;
    const healAmount = healerDef.healAmount ?? 22;

    const healer = world.enemySystem.spawnEnemy('healer')!;
    healer.healTimer = 0.01;
    healer.hp = healer.maxHp; // full HP healer

    const nearlyFull = world.enemySystem.spawnEnemy('grunt')!;
    nearlyFull.hp = nearlyFull.maxHp - 5; // Needs only 5 HP (< healAmount)

    const heavilyWounded = world.enemySystem.spawnEnemy('brute')!;
    heavilyWounded.hp = 100;

    const fullHpAlly = world.enemySystem.spawnEnemy('grunt')!;
    fullHpAlly.hp = fullHpAlly.maxHp;

    const outOfRange = world.enemySystem.spawnEnemy('grunt')!;
    outOfRange.hp = 10;

    // Position all relative to groundPath spawn after one update tick by syncing dist
    // Keep them spaced near healer after update(dt) by testing directly with tiny dt where move < 0.05
    nearlyFull.dist = healer.dist + 0.5;
    heavilyWounded.dist = healer.dist + 1.0;
    fullHpAlly.dist = healer.dist + 1.5;
    outOfRange.dist = healer.dist + radius + 1.5;

    let pulseCount = 0;
    events.on('healerPulse', () => {
      pulseCount++;
    });

    // Tick once to trigger healTimer <= 0
    world.enemySystem.update(
      0.02,
      () => {},
      () => {},
    );

    expect(pulseCount).toBe(1);
    expect(nearlyFull.hp).toBe(nearlyFull.maxHp); // Capped strictly at maxHp
    expect(heavilyWounded.hp).toBe(100 + healAmount);
    expect(fullHpAlly.hp).toBe(fullHpAlly.maxHp);
    expect(healer.hp).toBe(healer.maxHp);
    expect(outOfRange.hp).toBe(10); // Untouched outside radius

    // Bring heavilyWounded to full HP and trigger next heal pulse -> no wounded inside radius -> no pulse emitted
    heavilyWounded.hp = heavilyWounded.maxHp;
    healer.healTimer = 0.01;
    world.enemySystem.update(
      0.02,
      () => {},
      () => {},
    );
    expect(pulseCount).toBe(1);
  });
});
