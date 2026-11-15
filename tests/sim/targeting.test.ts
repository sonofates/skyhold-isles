import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { getTowerTierStats } from '../../src/data/towers.ts';
import { acquireTarget } from '../../src/sim/targeting.ts';
import { SimWorld } from '../../src/sim/world.ts';

function makeWorld(): SimWorld {
  const world = new SimWorld(LEVELS[0], new EventBus());
  world.gold = 2000;
  return world;
}

describe('targeting modes', () => {
  it('selects first, last, strongest, and closest targets accurately', () => {
    const world = makeWorld();
    const tower = world.placeTower(4, 3, 'archer')!;
    const stats = getTowerTierStats('archer', 1);

    const eFirst = world.enemySystem.spawnEnemy('grunt')!;
    eFirst.x = tower.x + 3.0;
    eFirst.z = tower.z;
    eFirst.dist = 32;
    eFirst.hp = 50;

    const eStrong = world.enemySystem.spawnEnemy('grunt')!;
    eStrong.x = tower.x + 2.2;
    eStrong.z = tower.z;
    eStrong.dist = 18;
    eStrong.hp = 140;

    const eCloseLast = world.enemySystem.spawnEnemy('grunt')!;
    eCloseLast.x = tower.x + 0.9;
    eCloseLast.z = tower.z;
    eCloseLast.dist = 5;
    eCloseLast.hp = 40;

    world.spatialHash.clear();
    world.spatialHash.insert(eFirst.poolIndex, eFirst.x, eFirst.z);
    world.spatialHash.insert(eStrong.poolIndex, eStrong.x, eStrong.z);
    world.spatialHash.insert(eCloseLast.poolIndex, eCloseLast.x, eCloseLast.z);

    tower.targetingMode = 'first';
    expect(acquireTarget(tower, stats, world.enemyPool, world.spatialHash)?.uid).toBe(eFirst.uid);

    tower.targetingMode = 'last';
    expect(acquireTarget(tower, stats, world.enemyPool, world.spatialHash)?.uid).toBe(eCloseLast.uid);

    tower.targetingMode = 'strongest';
    expect(acquireTarget(tower, stats, world.enemyPool, world.spatialHash)?.uid).toBe(eStrong.uid);

    tower.targetingMode = 'closest';
    expect(acquireTarget(tower, stats, world.enemyPool, world.spatialHash)?.uid).toBe(eCloseLast.uid);
  });

  it('breaks strongest HP ties in favor of higher path distance regardless of insertion order', () => {
    const world = makeWorld();
    const tower = world.placeTower(4, 3, 'archer')!;
    const stats = getTowerTierStats('archer', 1);
    tower.targetingMode = 'strongest';

    const behind = world.enemySystem.spawnEnemy('brute')!;
    behind.x = tower.x + 1.0;
    behind.z = tower.z;
    behind.hp = 200;
    behind.dist = 12;

    const ahead = world.enemySystem.spawnEnemy('brute')!;
    ahead.x = tower.x + 2.0;
    ahead.z = tower.z;
    ahead.hp = 200;
    ahead.dist = 24;

    // Order A: behind inserted first
    world.spatialHash.clear();
    world.spatialHash.insert(behind.poolIndex, behind.x, behind.z);
    world.spatialHash.insert(ahead.poolIndex, ahead.x, ahead.z);
    expect(acquireTarget(tower, stats, world.enemyPool, world.spatialHash)?.uid).toBe(ahead.uid);

    // Order B: ahead inserted first
    world.spatialHash.clear();
    world.spatialHash.insert(ahead.poolIndex, ahead.x, ahead.z);
    world.spatialHash.insert(behind.poolIndex, behind.x, behind.z);
    expect(acquireTarget(tower, stats, world.enemyPool, world.spatialHash)?.uid).toBe(ahead.uid);
  });

  it('compares normalized path progress across ground vs flight lanes and ignores dead or out-of-range foes', () => {
    const world = makeWorld();
    const tower = world.placeTower(7, 5, 'archer')!;
    const stats = getTowerTierStats('archer', 1);

    const flyer = world.enemySystem.spawnEnemy('flyer')!;
    flyer.x = tower.x + 1.2;
    flyer.z = tower.z;
    flyer.dist = flyer.totalDist * 0.8; // 80% progress on shorter air lane

    const ground = world.enemySystem.spawnEnemy('grunt')!;
    ground.x = tower.x + 1.5;
    ground.z = tower.z;
    ground.dist = ground.totalDist * 0.5; // 50% progress on longer ground lane (higher raw dist)

    const deadInFront = world.enemySystem.spawnEnemy('grunt')!;
    deadInFront.x = tower.x + 0.5;
    deadInFront.z = tower.z;
    deadInFront.hp = 0;
    deadInFront.dist = deadInFront.totalDist * 0.99;

    const outOfRange = world.enemySystem.spawnEnemy('grunt')!;
    outOfRange.x = tower.x + stats.range + 0.05;
    outOfRange.z = tower.z;
    outOfRange.dist = outOfRange.totalDist * 0.95;

    world.spatialHash.clear();
    world.spatialHash.insert(flyer.poolIndex, flyer.x, flyer.z);
    world.spatialHash.insert(ground.poolIndex, ground.x, ground.z);
    world.spatialHash.insert(deadInFront.poolIndex, deadInFront.x, deadInFront.z);
    world.spatialHash.insert(outOfRange.poolIndex, outOfRange.x, outOfRange.z);

    tower.targetingMode = 'first';
    expect(acquireTarget(tower, stats, world.enemyPool, world.spatialHash)?.uid).toBe(flyer.uid);

    tower.targetingMode = 'last';
    expect(acquireTarget(tower, stats, world.enemyPool, world.spatialHash)?.uid).toBe(ground.uid);
  });

  it('keeps deterministic selection when all candidates share identical progress or distance', () => {
    const world = makeWorld();
    const tower = world.placeTower(4, 3, 'archer')!;
    const stats = getTowerTierStats('archer', 1);

    const e1 = world.enemySystem.spawnEnemy('grunt')!;
    const e2 = world.enemySystem.spawnEnemy('grunt')!;
    e1.x = tower.x + 2.0;
    e1.z = tower.z;
    e1.dist = 10;
    e2.x = tower.x - 2.0;
    e2.z = tower.z;
    e2.dist = 10;

    world.spatialHash.clear();
    world.spatialHash.insert(e1.poolIndex, e1.x, e1.z);
    world.spatialHash.insert(e2.poolIndex, e2.x, e2.z);

    for (const mode of ['first', 'last', 'strongest', 'closest'] as const) {
      tower.targetingMode = mode;
      const target = acquireTarget(tower, stats, world.enemyPool, world.spatialHash);
      expect(target).not.toBeNull();
      expect([e1.uid, e2.uid]).toContain(target!.uid);
    }
  });
});

describe('mortar min range', () => {
  it('excludes targets inside minimum blindspot and accepts boundary and outer ring targets', () => {
    const world = makeWorld();
    const mortar = world.placeTower(7, 5, 'mortar')!;
    const statsT1 = getTowerTierStats('mortar', 1); // minRange: 3.4, maxRange: 10.6

    const onTile = world.enemySystem.spawnEnemy('grunt')!;
    onTile.x = mortar.x;
    onTile.z = mortar.z;
    onTile.dist = 50;

    const justInsideMin = world.enemySystem.spawnEnemy('grunt')!;
    justInsideMin.x = mortar.x + statsT1.minRange - 0.05;
    justInsideMin.z = mortar.z;
    justInsideMin.dist = 45;

    world.spatialHash.clear();
    world.spatialHash.insert(onTile.poolIndex, onTile.x, onTile.z);
    world.spatialHash.insert(justInsideMin.poolIndex, justInsideMin.x, justInsideMin.z);

    expect(acquireTarget(mortar, statsT1, world.enemyPool, world.spatialHash)).toBeNull();

    // Enemy right at minRange boundary becomes valid
    const atBoundary = world.enemySystem.spawnEnemy('grunt')!;
    atBoundary.x = mortar.x + statsT1.minRange + 0.001;
    atBoundary.z = mortar.z;
    atBoundary.dist = 20;
    world.spatialHash.insert(atBoundary.poolIndex, atBoundary.x, atBoundary.z);

    expect(acquireTarget(mortar, statsT1, world.enemyPool, world.spatialHash)?.uid).toBe(atBoundary.uid);
  });

  it('shrinks minimum blindspot from 3.4 to 3.2 at Tier 3 and respects max range', () => {
    const world = makeWorld();
    const mortar = world.placeTower(7, 5, 'mortar')!;
    const t1 = getTowerTierStats('mortar', 1);
    const t3 = getTowerTierStats('mortar', 3);
    const midSpot = world.enemySystem.spawnEnemy('grunt')!;
    midSpot.x = mortar.x + 3.3; // Between 3.2 (T3) and 3.4 (T1)
    midSpot.z = mortar.z;
    midSpot.dist = 30;

    const tooFar = world.enemySystem.spawnEnemy('grunt')!;
    tooFar.x = mortar.x + t3.range + 0.5;
    tooFar.z = mortar.z;
    tooFar.dist = 40;

    world.spatialHash.clear();
    world.spatialHash.insert(midSpot.poolIndex, midSpot.x, midSpot.z);
    world.spatialHash.insert(tooFar.poolIndex, tooFar.x, tooFar.z);

    expect(acquireTarget(mortar, t1, world.enemyPool, world.spatialHash)).toBeNull();

    expect(world.upgradeTower(mortar.id)).toBe(true);
    expect(world.upgradeTower(mortar.id)).toBe(true);
    expect(acquireTarget(mortar, t3, world.enemyPool, world.spatialHash)?.uid).toBe(midSpot.uid);
  });
});

describe('flyers ignored by ground-only towers', () => {
  it('ignores flying enemies in cannon and mortar targeting while hitting flyers with anti-air towers', () => {
    const world = makeWorld();
    const cannon = world.placeTower(4, 3, 'cannon')!;
    const mortar = world.placeTower(7, 5, 'mortar')!;
    const archer = world.placeTower(8, 5, 'archer')!;
    const frost = world.placeTower(4, 2, 'frost')!;
    const tesla = world.placeTower(5, 5, 'tesla')!;

    const flyer = world.enemySystem.spawnEnemy('flyer')!;
    flyer.x = mortar.x + 4.5;
    flyer.z = mortar.z;
    flyer.y = BALANCE.flyerHeight;
    flyer.dist = 35;

    const flyerNearCannon = world.enemySystem.spawnEnemy('flyer')!;
    flyerNearCannon.x = cannon.x + 1.5;
    flyerNearCannon.z = cannon.z;
    flyerNearCannon.y = BALANCE.flyerHeight;
    flyerNearCannon.dist = 30;

    world.spatialHash.clear();
    world.spatialHash.insert(flyer.poolIndex, flyer.x, flyer.z);
    world.spatialHash.insert(flyerNearCannon.poolIndex, flyerNearCannon.x, flyerNearCannon.z);

    expect(acquireTarget(cannon, getTowerTierStats('cannon', 1), world.enemyPool, world.spatialHash)).toBeNull();
    expect(acquireTarget(mortar, getTowerTierStats('mortar', 1), world.enemyPool, world.spatialHash)).toBeNull();
    expect(acquireTarget(archer, getTowerTierStats('archer', 1), world.enemyPool, world.spatialHash)).not.toBeNull();
    expect(acquireTarget(frost, getTowerTierStats('frost', 1), world.enemyPool, world.spatialHash)).not.toBeNull();
    expect(acquireTarget(tesla, getTowerTierStats('tesla', 1), world.enemyPool, world.spatialHash)).not.toBeNull();

    // Adding a trailing ground enemy makes cannon ignore closer flyer and lock ground target
    const ground = world.enemySystem.spawnEnemy('grunt')!;
    ground.x = cannon.x + 3.0;
    ground.z = cannon.z;
    ground.dist = 5;
    world.spatialHash.insert(ground.poolIndex, ground.x, ground.z);

    expect(acquireTarget(cannon, getTowerTierStats('cannon', 1), world.enemyPool, world.spatialHash)?.uid).toBe(
      ground.uid,
    );
  });

  it('never damages hovering flyers with cannon or mortar splash even directly overhead', () => {
    const world = makeWorld();
    const cannon = world.placeTower(4, 3, 'cannon')!;
    const groundTarget = world.enemySystem.spawnEnemy('grunt')!;
    groundTarget.x = cannon.x + 2.0;
    groundTarget.z = cannon.z;

    const overheadFlyer = world.enemySystem.spawnEnemy('flyer')!;
    overheadFlyer.x = groundTarget.x;
    overheadFlyer.z = groundTarget.z;
    const flyerStartHp = overheadFlyer.hp;

    world.spatialHash.clear();
    world.spatialHash.insert(groundTarget.poolIndex, groundTarget.x, groundTarget.z);
    world.spatialHash.insert(overheadFlyer.poolIndex, overheadFlyer.x, overheadFlyer.z);

    const proj = world.projectileSystem.spawnProjectile(cannon, groundTarget, 0.45)!;
    proj.progress = 0.99;
    world.projectileSystem.update(0.2, [cannon]);

    expect(groundTarget.hp).toBeLessThan(groundTarget.maxHp);
    expect(overheadFlyer.hp).toBe(flyerStartHp);

    // By contrast, frost tower (hitsFlyers: true) splash damages and slows the flyer
    const frost = world.placeTower(4, 2, 'frost')!;
    const frostProj = world.projectileSystem.spawnProjectile(frost, overheadFlyer, 0.65)!;
    frostProj.progress = 0.99;
    world.projectileSystem.update(0.2, [cannon, frost]);

    expect(overheadFlyer.hp).toBeLessThan(flyerStartHp);
    expect(overheadFlyer.slowRatio).toBeGreaterThan(0);
  });
});
