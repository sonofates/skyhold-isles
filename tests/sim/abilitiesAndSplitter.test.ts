import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ABILITY_DEFS, ABILITY_IDS, computeMeteorDamage } from '../../src/data/abilities.ts';
import { ENEMY_DEFS, ENEMY_TYPES } from '../../src/data/enemies.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { getTowerTierStats } from '../../src/data/towers.ts';
import { AbilitySystem } from '../../src/sim/abilitySystem.ts';
import { SimWorld } from '../../src/sim/world.ts';

function makeHarness(): { world: SimWorld; events: EventBus; abilities: AbilitySystem } {
  const events = new EventBus();
  const world = new SimWorld(LEVELS[0], events);
  world.gold = 3000;
  const abilities = new AbilitySystem(events);
  return { world, events, abilities };
}

describe('splitter enemy', () => {
  it('registers splitter stats and spawns two swift non-splitting hatchlings on death', () => {
    expect(ENEMY_TYPES).toContain('splitter');
    expect(ENEMY_DEFS.splitter).toMatchObject({
      type: 'splitter',
      name: 'Cinder Splitling',
      maxHp: 118,
      speed: 2.0,
      armor: 1,
      reward: 5,
      livesCost: 1,
      flying: false,
    });

    const { world, events } = makeHarness();
    const splitter = world.enemySystem.spawnEnemy('splitter')!;
    expect(splitter.scaleOverride).toBe(1);
    expect(splitter.isSplitChild).toBe(false);

    // Advance splitter along path so both behind/ahead split offsets are distinct
    for (let i = 0; i < 60; i++) {
      world.enemySystem.update(
        BALANCE.fixedDt,
        () => {},
        () => {},
      );
    }
    const parentDistBeforeDeath = splitter.dist;
    const parentMaxHp = splitter.maxHp;
    const parentSpeed = splitter.speed;
    const parentUid = splitter.uid;

    const splitEvents: Array<{ parentUid: number; count: number }> = [];
    const killEvents: Array<{ enemyId: number; enemyType: string; reward: number }> = [];
    events.on('enemySplit', (ev) => splitEvents.push({ parentUid: ev.parentUid, count: ev.count }));
    events.on('enemyKilled', (ev) =>
      killEvents.push({ enemyId: ev.enemyId, enemyType: ev.enemyType, reward: ev.reward }),
    );

    const kills: Array<{ uid: number; reward: number }> = [];
    world.enemySystem.applyDamage(splitter, 999, true);
    expect(splitter.hp).toBe(0);

    world.enemySystem.update(
      BALANCE.fixedDt,
      () => {},
      (killed) => kills.push({ uid: killed.uid, reward: killed.reward }),
    );

    expect(kills).toEqual([{ uid: parentUid, reward: 5 }]);
    expect(killEvents).toEqual([{ enemyId: parentUid, enemyType: 'splitter', reward: 5 }]);
    expect(splitEvents).toEqual([{ parentUid, count: 2 }]);
    expect(world.enemyPool.getActiveCount()).toBe(2);

    const children = [
      world.enemyPool.items[world.enemyPool.getActiveIndex(0)],
      world.enemyPool.items[world.enemyPool.getActiveIndex(1)],
    ].sort((a, b) => a.dist - b.dist);

    const expectedChildHp = Math.max(18, Math.round(parentMaxHp * 0.34));
    for (const child of children) {
      expect(child.type).toBe('runner');
      expect(child.isSplitChild).toBe(true);
      expect(child.scaleOverride).toBe(0.72);
      expect(child.maxHp).toBe(expectedChildHp);
      expect(child.hp).toBe(expectedChildHp);
      expect(child.speed).toBeCloseTo(parentSpeed * 1.45, 5);
      expect(child.reward).toBe(1);
      expect(child.livesCost).toBe(1);
    }
    expect(children[0].dist).toBeGreaterThanOrEqual(parentDistBeforeDeath - 0.35);
    expect(children[1].dist).toBeGreaterThan(children[0].dist);

    // Killing split children must NOT trigger recursive splitting
    for (const child of children) {
      world.enemySystem.applyDamage(child, 999, true);
    }
    world.enemySystem.update(
      BALANCE.fixedDt,
      () => {},
      (killed) => kills.push({ uid: killed.uid, reward: killed.reward }),
    );

    expect(splitEvents.length).toBe(1);
    expect(world.enemyPool.getActiveCount()).toBe(0);
    expect(kills.length).toBe(3);
    expect(kills[1].reward).toBe(1);
    expect(kills[2].reward).toBe(1);
  });

  it('enforces minimum 18 HP floor for low-scale splitter children', () => {
    const { world } = makeHarness();
    const tinySplitter = world.enemySystem.spawnEnemy('splitter', 0.25)!; // maxHp ~30, 34% = 10 -> clamped to 18
    world.enemySystem.applyDamage(tinySplitter, 999, true);
    world.enemySystem.update(
      BALANCE.fixedDt,
      () => {},
      () => {},
    );
    expect(world.enemyPool.getActiveCount()).toBe(2);
    const child = world.enemyPool.items[world.enemyPool.getActiveIndex(0)];
    expect(child.maxHp).toBe(18);
  });
});

describe('meteor strike ability', () => {
  it('defines deterministic ability constants and scales meteor damage by wave', () => {
    expect(ABILITY_IDS).toEqual(['meteor', 'overcharge']);
    expect(ABILITY_DEFS.meteor.hotkey).toBe('F');
    expect(ABILITY_DEFS.meteor.cooldownSec).toBe(30);
    expect(ABILITY_DEFS.meteor.impactDelaySec).toBe(0.32);
    expect(ABILITY_DEFS.meteor.radius).toBe(3.4);
    expect(ABILITY_DEFS.overcharge.hotkey).toBe('G');
    expect(ABILITY_DEFS.overcharge.cooldownSec).toBe(36);
    expect(ABILITY_DEFS.overcharge.durationSec).toBe(7.0);
    expect(ABILITY_DEFS.overcharge.fireRateMultiplier).toBe(1.65);

    expect(computeMeteorDamage(1)).toBe(185);
    expect(computeMeteorDamage(3)).toBe(Math.round(185 * (1 + 2 * 0.16)));
  });

  it('hits ground and flying enemies ignoring armor, slows survivors, and triggers normal splitter/kill credit', () => {
    const { world, events, abilities } = makeHarness();
    const targetX = 0;
    const targetZ = 0;

    // Ground brute (armor 6) inside radius -> takes full 185 damage ignoring armor + slow
    const brute = world.enemySystem.spawnEnemy('brute')!;
    brute.x = 1.2;
    brute.z = 0;

    // Flyer inside XZ radius -> hit cleanly despite being airborne
    const flyer = world.enemySystem.spawnEnemy('flyer')!;
    flyer.x = -1.5;
    flyer.z = 1.0;

    // Splitter inside radius -> killed and splits cleanly on EnemySystem.update
    const splitter = world.enemySystem.spawnEnemy('splitter')!;
    splitter.dist = 6;
    splitter.x = 0.5;
    splitter.z = -1.0;

    // Grunt just outside radius (3.4) -> untouched
    const outsideGrunt = world.enemySystem.spawnEnemy('grunt')!;
    outsideGrunt.x = 3.55;
    outsideGrunt.z = 0;

    world.spatialHash.clear();
    world.spatialHash.insert(brute.poolIndex, brute.x, brute.z);
    world.spatialHash.insert(flyer.poolIndex, flyer.x, flyer.z);
    world.spatialHash.insert(splitter.poolIndex, splitter.x, splitter.z);
    world.spatialHash.insert(outsideGrunt.poolIndex, outsideGrunt.x, outsideGrunt.z);

    let targetedEvents = 0;
    let impactEvents = 0;
    let splitEvents = 0;
    events.on('abilityTargeted', (ev) => {
      if (ev.abilityId === 'meteor' && ev.radius === 3.4) targetedEvents++;
    });
    events.on('meteorImpact', (ev) => {
      if (ev.x === targetX && ev.y === 0.25 && ev.z === targetZ && ev.radius === 3.4) {
        impactEvents++;
      }
    });
    events.on('enemySplit', () => splitEvents++);

    expect(abilities.canCast('meteor')).toBe(true);
    expect(abilities.castMeteor(targetX, targetZ, 1)).toBe(true);
    expect(abilities.canCast('meteor')).toBe(false);
    expect(abilities.getCooldown('meteor')).toBe(30);
    expect(abilities.castMeteor(targetX, targetZ, 1)).toBe(false);
    expect(targetedEvents).toBe(1);

    // Cooldown must NOT decay when combat is inactive, yet pending meteor delay MUST still resolve
    abilities.update(0.16, false, world.enemyPool, world.spatialHash, world.enemySystem);
    expect(abilities.getCooldown('meteor')).toBe(30);
    expect(impactEvents).toBe(0);
    expect(brute.hp).toBe(brute.maxHp);

    // Resolve impact at 0.32s total (still with isCombatActive = false)
    abilities.update(0.16, false, world.enemyPool, world.spatialHash, world.enemySystem);
    expect(impactEvents).toBe(1);
    expect(abilities.getCooldown('meteor')).toBe(30);

    // Brute took full 185 ignoring armor=6 and received 0.38 slow for 1.6s
    expect(brute.hp).toBe(ENEMY_DEFS.brute.maxHp - 185);
    expect(brute.slowRatio).toBeCloseTo(0.38, 5);
    expect(brute.slowTimer).toBeCloseTo(1.6, 5);

    // Flyer and Splitter were reduced to 0 HP; outside grunt untouched
    expect(flyer.hp).toBe(0);
    expect(splitter.hp).toBe(0);
    expect(outsideGrunt.hp).toBe(outsideGrunt.maxHp);

    // Standard EnemySystem.update awards kill gold exactly once and triggers splitter hatchlings
    let goldEarned = 0;
    const killedTypes: string[] = [];
    world.enemySystem.update(
      BALANCE.fixedDt,
      () => {},
      (killed) => {
        goldEarned += killed.reward;
        killedTypes.push(killed.type);
      },
    );

    expect(killedTypes.sort()).toEqual(['flyer', 'splitter']);
    expect(goldEarned).toBe(ENEMY_DEFS.flyer.reward + ENEMY_DEFS.splitter.reward);
    expect(splitEvents).toBe(1);
    // Remaining: brute + outsideGrunt + 2 split children = 4
    expect(world.enemyPool.getActiveCount()).toBe(4);

    // Cooldown ticks down ONLY during active combat
    abilities.update(10, true, world.enemyPool, world.spatialHash, world.enemySystem);
    expect(abilities.getCooldown('meteor')).toBe(20);
  });
});

describe('boss abilities, tower stun, and overcharge cleanse', () => {
  it('summons 2 runner escorts once at <=50% HP and jams up to 2 nearest towers prioritizing unstunned ones', () => {
    const { world, events, abilities } = makeHarness();

    const boss = world.enemySystem.spawnEnemy('boss', 1.0)!;
    expect(boss.bossPulseTimer).toBeCloseTo(4.2, 5);
    expect(boss.bossSummonedEscorts).toBe(false);

    // Move boss a few units down the path so escort offsets (dist - 0.8, dist - 1.5) are positive
    for (let i = 0; i < 180; i++) {
      world.enemySystem.update(
        BALANCE.fixedDt,
        () => {},
        () => {},
      );
    }
    const bossDist = boss.dist;
    expect(bossDist).toBeGreaterThan(2.5);

    // Place 3 towers near boss and 1 far outside 7.6 range (valid grass tiles on LEVEL_1)
    const tNear = world.placeTower(1, 1, 'archer')!;
    const tMid = world.placeTower(2, 1, 'archer')!;
    const tThird = world.placeTower(3, 1, 'archer')!;
    const tFar = world.placeTower(4, 1, 'archer')!;

    // Position boss explicitly relative to towers via world coords isn't kept across path.sample,
    // so place towers directly near boss's current world position for exact distance assertions
    (tNear as { x: number; z: number }).x = boss.x + 1.5;
    (tNear as { x: number; z: number }).z = boss.z;
    (tMid as { x: number; z: number }).x = boss.x + 3.2;
    (tMid as { x: number; z: number }).z = boss.z;
    (tThird as { x: number; z: number }).x = boss.x + 5.8;
    (tThird as { x: number; z: number }).z = boss.z;
    (tFar as { x: number; z: number }).x = boss.x + 9.0;
    (tFar as { x: number; z: number }).z = boss.z;

    let summonCount = 0;
    const pulsePayloads: Array<{ stunnedTowerIds: readonly number[] }> = [];
    events.on('bossSummon', (ev) => {
      summonCount += ev.count;
    });
    events.on('bossPulse', (ev) => {
      pulsePayloads.push({ stunnedTowerIds: ev.stunnedTowerIds });
    });

    // Drop boss HP to 50% -> summons 2 runners once
    boss.hp = Math.floor(boss.maxHp * 0.5);
    world.enemySystem.update(
      BALANCE.fixedDt,
      () => {},
      () => {},
      world.towers,
      2.0, // currentHpScale = 2.0 -> escort HP scale = 1.5
    );

    expect(boss.bossSummonedEscorts).toBe(true);
    expect(summonCount).toBe(2);
    expect(world.enemyPool.getActiveCount()).toBe(3); // boss + 2 escorts

    const escorts = [
      world.enemyPool.items[world.enemyPool.getActiveIndex(1)],
      world.enemyPool.items[world.enemyPool.getActiveIndex(2)],
    ].sort((a, b) => b.dist - a.dist);
    for (const esc of escorts) {
      expect(esc.type).toBe('runner');
      expect(esc.reward).toBe(2);
      expect(esc.maxHp).toBe(Math.round(ENEMY_DEFS.runner.maxHp * 1.5));
    }
    expect(escorts[0].dist).toBeCloseTo(bossDist + boss.speed * BALANCE.fixedDt - 0.8, 2);
    expect(escorts[1].dist).toBeCloseTo(bossDist + boss.speed * BALANCE.fixedDt - 1.5, 2);

    // Damage further below 50% -> must NOT summon again
    boss.hp = Math.floor(boss.maxHp * 0.25);
    world.enemySystem.update(
      BALANCE.fixedDt,
      () => {},
      () => {},
      world.towers,
      2.0,
    );
    expect(summonCount).toBe(2);

    // Advance bossPulseTimer to <= 0 -> jams 2 nearest towers (tNear, tMid) for 2.65s
    boss.bossPulseTimer = 0.01;
    world.enemySystem.update(
      0.02,
      () => {},
      () => {},
      world.towers,
      2.0,
    );
    expect(pulsePayloads.length).toBe(1);
    expect(pulsePayloads[0].stunnedTowerIds).toEqual([tNear.id, tMid.id]);
    expect(tNear.stunTimer).toBeCloseTo(2.65, 5);
    expect(tMid.stunTimer).toBeCloseTo(2.65, 5);
    expect(tThird.stunTimer).toBe(0);
    expect(tFar.stunTimer).toBe(0);
    expect(boss.bossPulseTimer).toBeCloseTo(7.0, 5);

    // Verify stunned tower cannot fire, acquire target, decrement cooldown, or idle sweep
    tNear.cooldownTimer = 0;
    const yawBefore = tNear.yaw;
    let firedByNear = 0;
    events.on('towerFired', (ev) => {
      if (ev.towerId === tNear.id) firedByNear++;
    });

    world.combatSystem.update(BALANCE.fixedDt, [tNear], abilities.getFireRateMultiplier());
    expect(firedByNear).toBe(0);
    expect(tNear.yaw).toBe(yawBefore);
    expect(tNear.stunTimer).toBeLessThan(2.65);

    // If tNear is still stunned and tMid recovered, next pulse prioritizes non-stunned (tMid, tThird) over stunned tNear
    tMid.stunTimer = 0;
    boss.bossPulseTimer = 0.01;
    world.enemySystem.update(
      0.02,
      () => {},
      () => {},
      world.towers,
      2.0,
    );
    expect(pulsePayloads.length).toBe(2);
    expect(pulsePayloads[1].stunnedTowerIds).toEqual([tMid.id, tThird.id]);

    // Overcharge immediately cleanses all stunned towers and enables firing + 1.65x fireRate
    let cleansed: readonly number[] = [];
    events.on('overchargeActivated', (ev) => {
      cleansed = ev.cleansedTowerIds;
    });
    expect(abilities.castOvercharge(world.towers)).toBe(true);
    expect(cleansed).toEqual([tNear.id, tMid.id, tThird.id]);
    expect(tNear.stunTimer).toBe(0);
    expect(tMid.stunTimer).toBe(0);
    expect(tThird.stunTimer).toBe(0);
    expect(abilities.isOverchargeActive()).toBe(true);
    expect(abilities.getFireRateMultiplier()).toBe(1.65);

    // Cleansed tNear immediately fires on next CombatSystem tick
    tNear.cooldownTimer = 0;
    world.combatSystem.update(BALANCE.fixedDt, [tNear], abilities.getFireRateMultiplier());
    expect(firedByNear).toBe(1);
  });

  it('retries boss pulse in 0.75s when no tower is within 7.6 units and verifies 1.65x fire rate boost', () => {
    const { world, events, abilities } = makeHarness();
    const boss = world.enemySystem.spawnEnemy('boss')!;
    const farTower = world.placeTower(4, 1, 'archer')!;
    (farTower as { x: number; z: number }).x = boss.x + 12;
    (farTower as { x: number; z: number }).z = boss.z;

    let pulses = 0;
    events.on('bossPulse', () => pulses++);

    boss.bossPulseTimer = 0.01;
    world.enemySystem.update(
      0.02,
      () => {},
      () => {},
      [farTower],
      1,
    );
    expect(pulses).toBe(0);
    expect(boss.bossPulseTimer).toBeCloseTo(0.75, 5);

    // Verify 1.65x fireRate multiplier accelerates cooldown recovery deterministically
    const archerStats = getTowerTierStats('archer', 1); // fireRate 1.65 => base period 1/1.65 s
    const baseCooldown = 1 / archerStats.fireRate;
    farTower.cooldownTimer = baseCooldown;

    abilities.castOvercharge([farTower]);
    const step = 0.1;
    world.combatSystem.update(step, [farTower], abilities.getFireRateMultiplier());
    expect(farTower.cooldownTimer).toBeCloseTo(baseCooldown - step * 1.65, 5);

    // Overcharge expires after 7.0s and multiplier returns to 1
    abilities.update(7.0, true, world.enemyPool, world.spatialHash, world.enemySystem);
    expect(abilities.isOverchargeActive()).toBe(false);
    expect(abilities.getFireRateMultiplier()).toBe(1);

    // Reset clears cooldowns and active state
    abilities.reset();
    expect(abilities.canCast('meteor')).toBe(true);
    expect(abilities.canCast('overcharge')).toBe(true);
    expect(abilities.getCooldown('overcharge')).toBe(0);
  });
});

describe('splitter near the goal', () => {
  it('never spawns hatchlings ahead of the parent, so a kill at the goal leaks no lives', () => {
    const { world } = makeHarness();
    const splitter = world.enemySystem.spawnEnemy('splitter')!;
    // Park the splitter just short of the goal, where the old +0.35 offset pushed a hatchling ahead.
    splitter.dist = splitter.totalDist - 0.7;
    const parentDist = splitter.dist;
    world.enemySystem.applyDamage(splitter, 9999, true);

    const leaks: number[] = [];
    world.enemySystem.update(
      BALANCE.fixedDt,
      (leaked) => leaks.push(leaked.uid),
      () => {},
    );

    expect(leaks).toEqual([]);
    expect(world.enemyPool.getActiveCount()).toBe(2);
    for (let i = 0; i < 2; i++) {
      const child = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
      expect(child.isSplitChild).toBe(true);
      // Children may advance by one tick of movement, but start at or behind the parent.
      expect(child.dist).toBeLessThanOrEqual(parentDist + child.speed * BALANCE.fixedDt + 1e-6);
      expect(child.dist).toBeLessThan(child.totalDist);
    }
  });

  it('clamps hatchlings to dist >= 0 when the parent dies at the spawn', () => {
    const { world } = makeHarness();
    const splitter = world.enemySystem.spawnEnemy('splitter')!;
    splitter.dist = 0.1;
    world.enemySystem.applyDamage(splitter, 9999, true);
    world.enemySystem.update(
      BALANCE.fixedDt,
      () => {},
      () => {},
    );
    expect(world.enemyPool.getActiveCount()).toBe(2);
    for (let i = 0; i < 2; i++) {
      const child = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
      expect(child.dist).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('ability guard outside combat', () => {
  it('rejects meteor and overcharge at sim level before the first wave starts', () => {
    const { world } = makeHarness();
    expect(world.waveSystem.state).toBe('preFirstWave');
    expect(world.castMeteor(0, 0)).toBe(false);
    expect(world.castOvercharge()).toBe(false);
    world.startNextWave();
    expect(world.castOvercharge()).toBe(true);
  });
});
