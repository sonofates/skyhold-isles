import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVELS, type LevelDef } from '../../src/data/levels/index.ts';
import { getTowerTierStats } from '../../src/data/towers.ts';
import { CompiledPath } from '../../src/sim/path.ts';
import { SimWorld } from '../../src/sim/world.ts';

function makeWorld(): { world: SimWorld; events: EventBus } {
  const events = new EventBus();
  const world = new SimWorld(LEVELS[0], events);
  world.gold = 4000;
  return { world, events };
}

describe('projectile lifecycle and pool-recycling edge cases', () => {
  it('tracks moving targets for linear projectiles and ignores recycled pool slots with a different uid', () => {
    const { world, events } = makeWorld();
    const archer = world.placeTower(4, 2, 'archer')!;

    const original = world.enemySystem.spawnEnemy('grunt')!;
    original.x = archer.x + 4.0;
    original.z = archer.z;
    const savedPoolIdx = original.poolIndex;
    const originalUid = original.uid;

    const proj = world.projectileSystem.spawnProjectile(archer, original, 1)!;
    proj.duration = 0.5;
    expect(proj.parabolic).toBe(false);

    // Move original target and step projectile -> homing updates endX/endZ
    original.x = archer.x + 5.0;
    original.z = archer.z + 1.5;
    world.projectileSystem.update(0.1, [archer]);
    expect(proj.endX).toBeCloseTo(original.x, 5);
    expect(proj.endZ).toBeCloseTo(original.z, 5);

    // Kill/release original slot and recycle the exact poolIndex for a new enemy with a new uid
    const pos = (() => {
      for (let i = 0; i < world.enemyPool.getActiveCount(); i++) {
        if (world.enemyPool.getActiveIndex(i) === savedPoolIdx) return i;
      }
      return -1;
    })();
    expect(pos).toBeGreaterThanOrEqual(0);
    world.enemyPool.releaseAtActivePos(pos);

    const replacement = world.enemySystem.spawnEnemy('brute')!;
    expect(replacement.poolIndex).toBe(savedPoolIdx);
    expect(replacement.uid).not.toBe(originalUid);
    replacement.x = archer.x + 1.0;
    replacement.z = archer.z - 2.0;
    const replacementStartHp = replacement.hp;

    // Step projectile to impact: must NOT redirect to replacement and must NOT damage replacement
    let impacts = 0;
    events.on('projectileImpact', () => impacts++);
    for (let i = 0; i < 6; i++) {
      world.projectileSystem.update(0.1, [archer]);
    }
    expect(proj.active).toBe(false);
    expect(proj.endX).toBeCloseTo(archer.x + 5.0, 5);
    expect(replacement.hp).toBe(replacementStartHp);
    expect(impacts).toBe(1);
    expect(archer.totalDamageDealt).toBe(0);
  });

  it('resolves impact damage, slow, and events even after source tower is sold mid-flight', () => {
    const { world, events } = makeWorld();
    const frost = world.placeTower(4, 2, 'frost')!;
    const stats = getTowerTierStats('frost', 1);

    const grunt = world.enemySystem.spawnEnemy('grunt')!;
    grunt.x = frost.x + 2.0;
    grunt.z = frost.z;
    world.spatialHash.clear();
    world.spatialHash.insert(grunt.poolIndex, grunt.x, grunt.z);

    const proj = world.projectileSystem.spawnProjectile(frost, grunt, stats.splashFalloffMin)!;
    proj.duration = 0.2;

    // Sell the tower while projectile is in mid-air
    const refund = world.sellTower(frost.id);
    expect(refund).toBeGreaterThan(0);
    expect(world.getTowerById(frost.id)).toBeNull();

    let impactBossHit: boolean | null = null;
    events.on('projectileImpact', (ev) => {
      impactBossHit = ev.isBossHit;
    });

    world.projectileSystem.update(0.25, world.towers);
    expect(proj.active).toBe(false);
    expect(grunt.hp).toBe(grunt.maxHp - stats.damage);
    expect(grunt.slowRatio).toBeCloseTo(stats.slowRatio, 5);
    expect(impactBossHit).toBe(false);
  });

  it('follows parabolic arc peak at t=0.5 and reports isBossHit accurately on splash impact', () => {
    const { world, events } = makeWorld();
    const cannon = world.placeTower(4, 3, 'cannon')!;
    const stats = getTowerTierStats('cannon', 1);

    const boss = world.enemySystem.spawnEnemy('boss')!;
    boss.speed = 0;
    boss.x = cannon.x + 2.5;
    boss.z = cannon.z;
    world.spatialHash.clear();
    world.spatialHash.insert(boss.poolIndex, boss.x, boss.z);

    const proj = world.projectileSystem.spawnProjectile(cannon, boss, stats.splashFalloffMin)!;
    expect(proj.parabolic).toBe(true);
    proj.duration = 1.0;

    // Advance exactly to t = 0.5 -> y = midpoint(startY, endY) + arcHeight
    world.projectileSystem.update(0.5, world.towers);
    const expectedMidY = (proj.startY + proj.endY) * 0.5 + proj.arcHeight;
    expect(proj.y).toBeCloseTo(expectedMidY, 5);

    const bossFlags: boolean[] = [];
    events.on('projectileImpact', (ev) => bossFlags.push(ev.isBossHit));

    world.projectileSystem.update(0.55, world.towers);
    expect(bossFlags).toEqual([true]);

    // Move boss outside splash radius -> isBossHit must be false
    boss.x = cannon.x + 12.0;
    world.spatialHash.clear();
    world.spatialHash.insert(boss.poolIndex, boss.x, boss.z);
    const missProj = world.projectileSystem.spawnProjectile(cannon, boss, stats.splashFalloffMin)!;
    missProj.endX = cannon.x + 2.5; // explode away from boss
    missProj.progress = 0.95;
    world.projectileSystem.update(0.2, world.towers);
    expect(bossFlags).toEqual([true, false]);
  });
});

describe('combat system rotation, timers, stun recovery, and chain kills', () => {
  it('takes the shortest angular path across +-PI, sweeps when idle, and decays recoil/popAnimTimer', () => {
    const { world } = makeWorld();
    const archer = world.placeTower(4, 2, 'archer')!;
    archer.recoil = 1.0;
    archer.popAnimTimer = 0.2;
    const yaw0 = archer.yaw;

    // No target in range -> gentle idle sweep + recoil/pop decay
    world.combatSystem.update(0.1, [archer]);
    expect(archer.yaw).toBeCloseTo(yaw0 + 0.1 * 0.35, 6);
    expect(archer.recoil).toBeCloseTo(0.5, 6);
    expect(archer.popAnimTimer).toBeCloseTo(0.1, 6);

    // Target slightly past -PI relative to tower (+PI - 0.1 -> -PI + 0.1 = +0.2 rad across wrap)
    archer.yaw = Math.PI - 0.1;
    const foe = world.enemySystem.spawnEnemy('grunt')!;
    foe.x = archer.x - 0.1 * 2; // small negative X, negative Z => atan2(dx, dz) near -PI
    foe.z = archer.z - 2.0;
    world.spatialHash.clear();
    world.spatialHash.insert(foe.poolIndex, foe.x, foe.z);

    world.combatSystem.update(0.01, [archer]);
    // Partial turn (maxStep = 0.12 < ~0.2 diff) must rotate positively past PI - 0.1 rather than swinging backwards toward 0
    expect(archer.yaw).toBeCloseTo(Math.PI - 0.1 + 0.12, 5);

    // Following step snaps cleanly onto targetYaw near -PI
    world.combatSystem.update(0.02, [archer]);
    expect(archer.yaw).toBeCloseTo(archer.targetYaw, 6);
  });

  it('resumes firing on the exact tick stunTimer hits 0 and stays silent while stunTimer remains > 0', () => {
    const { world, events } = makeWorld();
    const archer = world.placeTower(4, 2, 'archer')!;
    archer.cooldownTimer = 0;
    archer.stunTimer = 0.25;

    const grunt = world.enemySystem.spawnEnemy('grunt')!;
    grunt.x = archer.x + 2.0;
    grunt.z = archer.z;
    world.spatialHash.clear();
    world.spatialHash.insert(grunt.poolIndex, grunt.x, grunt.z);

    let fired = 0;
    events.on('towerFired', () => fired++);

    // 0.1s elapsed -> stunTimer = 0.15 > 0 -> remains stunned
    world.combatSystem.update(0.1, [archer]);
    expect(fired).toBe(0);
    expect(archer.stunTimer).toBeCloseTo(0.15, 6);

    // 0.2s elapsed -> stunTimer hits 0 -> wakes up and fires immediately
    world.combatSystem.update(0.2, [archer]);
    expect(archer.stunTimer).toBe(0);
    expect(fired).toBe(1);
  });

  it('credits tesla chain kills without overkill inflation and halts chain outside chainRange', () => {
    const { world, events } = makeWorld();
    const tesla = world.placeTower(4, 2, 'tesla')!;
    const stats = getTowerTierStats('tesla', 1); // damage 28, chainCount 3, chainRange 3.3
    tesla.cooldownTimer = 0;

    const low1 = world.enemySystem.spawnEnemy('runner')!;
    low1.hp = 10;
    low1.x = tesla.x + 1.5;
    low1.z = tesla.z;
    low1.dist = 30;

    const low2 = world.enemySystem.spawnEnemy('runner')!;
    low2.hp = 5;
    low2.x = low1.x + 1.5;
    low2.z = tesla.z;
    low2.dist = 20;

    // 3rd enemy outside chainRange (3.3) from low2
    const tooFar = world.enemySystem.spawnEnemy('runner')!;
    tooFar.hp = 40;
    tooFar.x = low2.x + stats.chainRange + 0.5;
    tooFar.z = tesla.z;
    tooFar.dist = 10;

    world.spatialHash.clear();
    world.spatialHash.insert(low1.poolIndex, low1.x, low1.z);
    world.spatialHash.insert(low2.poolIndex, low2.x, low2.z);
    world.spatialHash.insert(tooFar.poolIndex, tooFar.x, tooFar.z);

    let chainVertices = 0;
    events.on('lightningChain', (ev) => {
      chainVertices = ev.points.length;
    });

    world.combatSystem.update(BALANCE.fixedDt, [tesla]);
    expect(chainVertices).toBe(3); // muzzle + low1 + low2
    expect(tesla.kills).toBe(2);
    expect(tesla.totalDamageDealt).toBe(15); // capped at actual 10 + 5 HP removed
    expect(tooFar.hp).toBe(40);
  });
});

describe('wave preview, empty wave, leak clamping, and beveled path edge cases', () => {
  it('handles empty-group waves, story-to-endless wave previews, and boss leak lives clamping', () => {
    const emptyWaveLevel: LevelDef = {
      ...LEVELS[0],
      waves: [
        { clearBonus: 25, groups: [] },
        {
          clearBonus: 35,
          groups: [{ enemyType: 'boss', count: 1, spawnInterval: 1.0, startDelay: 0 }],
        },
      ],
    };

    const events = new EventBus();
    const world = new SimWorld(emptyWaveLevel, events);
    const ws = world.waveSystem;

    expect(ws.totalWaves).toBe(2);
    expect(ws.getNextWavePreview()).toEqual({ waveOneBased: 1, items: [] });

    // Start empty wave 1 -> 1 fixedTick finishes spawning -> clearing -> betweenWaves with 25g bonus
    const startGold = world.gold;
    expect(world.startNextWave()).toBe(true);
    world.fixedTick(BALANCE.fixedDt);
    expect(ws.state).toBe('betweenWaves');
    expect(world.gold).toBe(startGold + 25);

    // Next preview now shows wave 2 boss
    expect(ws.getNextWavePreview()).toEqual({
      waveOneBased: 2,
      items: [{ enemyType: 'boss', count: 1 }],
    });

    // Skip to wave 2 -> final story wave has null preview
    world.startNextWave();
    expect(ws.getNextWavePreview()).toBeNull();

    // Clear wave 2 -> win -> finished preview is null
    world.fixedTick(BALANCE.fixedDt);
    for (let i = world.enemyPool.getActiveCount() - 1; i >= 0; i--) {
      const e = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
      world.enemySystem.applyDamage(e, 99999, true);
    }
    world.fixedTick(BALANCE.fixedDt);
    expect(world.outcome).toBe('won');
    expect(ws.state).toBe('finished');
    expect(ws.getNextWavePreview()).toBeNull();

    // Enter endless mode -> wave previews resume and wave 7 (offset 4, 5th endless wave) previews boss
    expect(world.enterEndlessMode()).toBe(true);
    expect(ws.totalWaves).toBe(2);
    expect(ws.getNextWavePreview()?.waveOneBased).toBe(3);

    world.debugSkipToWave(6);
    expect(ws.totalWaves).toBe(6);
    const wave7Preview = ws.getNextWavePreview();
    expect(wave7Preview?.waveOneBased).toBe(7);
    expect(wave7Preview?.items.some((it) => it.enemyType === 'boss' && it.count === 1)).toBe(true);

    // Boss (5 livesCost) + brute (2 livesCost) leaking at 2 lives remaining clamps lives to 0 and fires gameLost once
    const lostEvents: Array<{ waveIndex: number; endless?: boolean }> = [];
    events.on('gameLost', (ev) => lostEvents.push(ev));

    world.lives = 2;
    const bossLeaker = world.enemySystem.spawnEnemy('boss')!;
    bossLeaker.dist = bossLeaker.totalDist - 0.001;
    const bruteLeaker = world.enemySystem.spawnEnemy('brute')!;
    bruteLeaker.dist = bruteLeaker.totalDist - 0.001;

    world.fixedTick(BALANCE.fixedDt);
    expect(world.lives).toBe(0);
    expect(world.outcome).toBe('lost');
    expect(lostEvents).toHaveLength(1);
    expect(lostEvents[0].endless).toBe(true);

    // Subsequent ticks after loss are complete no-ops
    world.fixedTick(BALANCE.fixedDt);
    expect(lostEvents).toHaveLength(1);
    expect(world.lives).toBe(0);
  });

  it('preserves 2-point paths un-beveled and maintains monotonic cumDist on tight 1-tile corners', () => {
    const straight = new CompiledPath(
      [
        { col: 0, row: 0 },
        { col: 4, row: 0 },
      ],
      5,
      5,
      0,
      true,
    );
    expect(straight.points).toHaveLength(2);
    expect(straight.totalLength).toBeCloseTo(4 * BALANCE.tileSize, 5);

    const tightZigZag = new CompiledPath(
      [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 1, row: 1 },
        { col: 2, row: 1 },
      ],
      5,
      5,
      0,
      true,
    );
    expect(tightZigZag.points.length).toBe(8);
    for (let i = 1; i < tightZigZag.points.length; i++) {
      expect(tightZigZag.points[i].cumDist).toBeGreaterThan(tightZigZag.points[i - 1].cumDist);
    }
  });
});

describe('overlapping waves, dead-target projectiles, boss tie-break, and healer/splitter interactions', () => {
  it('accumulates clearBonus across waves when early-calling during clearing', () => {
    const twoWaveLevel: LevelDef = {
      ...LEVELS[0],
      waves: [
        {
          clearBonus: 30,
          groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 0.5, startDelay: 0 }],
        },
        {
          clearBonus: 45,
          groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 0.5, startDelay: 0 }],
        },
        {
          clearBonus: 50,
          groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 0.5, startDelay: 0 }],
        },
      ],
    };

    const events = new EventBus();
    const world = new SimWorld(twoWaveLevel, events);
    const completed: Array<{ waveIndex: number; bonus: number }> = [];
    events.on('waveCompleted', (ev) => completed.push(ev));

    const startGold = world.gold;
    world.startNextWave();
    // Tick once -> wave 1 spawns 1 grunt and transitions to 'clearing' with pendingClearBonus = 30
    world.fixedTick(BALANCE.fixedDt);
    expect(world.waveSystem.state).toBe('clearing');
    expect(world.waveSystem.pendingClearBonus).toBe(30);

    // Early-call wave 2 while wave 1 grunt is still alive -> awards early bonus (30g)
    const earlyBonus = world.waveSystem.getEarlyCallBonus();
    expect(earlyBonus).toBe(BALANCE.earlyWaveBonusMaxGold);
    expect(world.startNextWave()).toBe(true);
    world.fixedTick(BALANCE.fixedDt); // wave 2 spawns and transitions to 'clearing'
    expect(world.waveSystem.pendingClearBonus).toBe(75); // 30 + 45

    // Kill both active grunts -> awards combined 75g clear bonus + their kill gold
    let killRewards = 0;
    for (let i = world.enemyPool.getActiveCount() - 1; i >= 0; i--) {
      const e = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
      killRewards += e.reward;
      world.enemySystem.applyDamage(e, 9999, true);
    }
    world.fixedTick(BALANCE.fixedDt);
    expect(world.waveSystem.pendingClearBonus).toBe(0);
    expect(completed).toEqual([{ waveIndex: 1, bonus: 75 }]);
    expect(world.gold).toBe(startGold + earlyBonus + killRewards + 75);
  });

  it('still splashes neighbors if splash target dies mid-flight, while single-target arrows fizzle', () => {
    const { world } = makeWorld();
    const cannon = world.placeTower(4, 3, 'cannon')!;
    const archer = world.placeTower(4, 2, 'archer')!;
    const cannonStats = getTowerTierStats('cannon', 1);

    const deadTarget = world.enemySystem.spawnEnemy('grunt')!;
    deadTarget.x = cannon.x + 2.0;
    deadTarget.z = cannon.z;

    const bystander = world.enemySystem.spawnEnemy('grunt')!;
    bystander.x = deadTarget.x + 0.5;
    bystander.z = deadTarget.z;
    const bystanderHpBefore = bystander.hp;

    const shell = world.projectileSystem.spawnProjectile(cannon, deadTarget, cannonStats.splashFalloffMin)!;
    shell.progress = 0.99;

    const arrow = world.projectileSystem.spawnProjectile(archer, deadTarget, 1)!;
    arrow.progress = 0.99;

    // Kill primary target before impact tick
    deadTarget.hp = 0;
    world.spatialHash.clear();
    world.spatialHash.insert(bystander.poolIndex, bystander.x, bystander.z);

    world.projectileSystem.update(0.1, [cannon, archer]);
    expect(bystander.hp).toBeLessThan(bystanderHpBefore);
    expect(archer.totalDamageDealt).toBe(0);
    expect(cannon.totalDamageDealt).toBeGreaterThan(0);
  });

  it('breaks equidistant boss pulse ties by lowest tower id, clamps spawn escorts >= 0, heals wounded healer/flyer, and clears slow on split children', () => {
    const { world, events } = makeWorld();

    // Boss at dist = 0.25 with <= 50% HP clamps escort dist >= 0 and breaks equidistant tower ties by lower id
    const boss = world.enemySystem.spawnEnemy('boss')!;
    boss.dist = 0.25;
    boss.hp = Math.floor(boss.maxHp * 0.45);
    boss.bossPulseTimer = 0.01;

    const t1 = world.placeTower(4, 2, 'archer')!;
    const t2 = world.placeTower(4, 3, 'archer')!;
    const t3 = world.placeTower(5, 5, 'archer')!;

    // Update once to sync boss.x/z on path, then freeze boss & park all 3 towers at identical distance 3.0
    world.enemySystem.update(BALANCE.fixedDt, () => {}, () => {}, undefined, 1);
    boss.speed = 0;
    (t1 as { x: number; z: number }).x = boss.x + 3.0;
    (t1 as { x: number; z: number }).z = boss.z;
    (t2 as { x: number; z: number }).x = boss.x - 3.0;
    (t2 as { x: number; z: number }).z = boss.z;
    (t3 as { x: number; z: number }).x = boss.x;
    (t3 as { x: number; z: number }).z = boss.z + 3.0;

    // Escorts spawned clamped to dist >= 0
    for (let i = 0; i < world.enemyPool.getActiveCount(); i++) {
      const e = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
      expect(e.dist).toBeGreaterThanOrEqual(0);
    }

    const pulseIds: number[][] = [];
    events.on('bossPulse', (ev) => pulseIds.push([...ev.stunnedTowerIds]));
    boss.bossPulseTimer = 0.01;
    world.enemySystem.update(0.02, () => {}, () => {}, [t3, t2, t1], 1);
    // Even though t3 appeared first in array, tie-breaker picks lowest IDs (t1.id, t2.id)
    expect(pulseIds).toEqual([[t1.id, t2.id]]);

    // Healer self-heal when wounded (and unaffected flyer outside radius vs healed within radius when stationary)
    world.enemyPool.clear();
    const healer = world.enemySystem.spawnEnemy('healer')!;
    healer.hp = 50;
    healer.healTimer = 0.01;
    const flyer = world.enemySystem.spawnEnemy('flyer')!;
    flyer.hp = 10;
    // Level 1 ground spawn (0, 2) and flight spawn (0, 2) start at the exact same XZ tile
    healer.speed = 0;
    flyer.speed = 0;
    const healerHpBefore = healer.hp;
    const flyerHpBefore = flyer.hp;
    world.enemySystem.update(0.02, () => {}, () => {});
    const healAmt = ENEMY_DEFS.healer.healAmount ?? 22;
    expect(healer.hp).toBe(Math.min(healer.maxHp, healerHpBefore + healAmt));
    expect(flyer.hp).toBe(Math.min(flyer.maxHp, flyerHpBefore + healAmt));

    // Slowed splitter produces un-slowed split children
    world.enemyPool.clear();
    const splitter = world.enemySystem.spawnEnemy('splitter')!;
    splitter.dist = 5;
    world.enemySystem.applySlow(splitter, 0.4, 2.0);
    expect(splitter.slowRatio).toBeCloseTo(0.4, 5);
    world.enemySystem.applyDamage(splitter, 9999, true);
    world.enemySystem.update(BALANCE.fixedDt, () => {}, () => {});
    expect(world.enemyPool.getActiveCount()).toBe(2);
    for (let i = 0; i < 2; i++) {
      const child = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
      expect(child.slowRatio).toBe(0);
      expect(child.slowTimer).toBe(0);
    }
  });

  it('leaks splitters without splitting, deduplicates same-tick overkill kills, and resolves overlapping meteors cleanly', () => {
    const { world, events } = makeWorld();

    // 1. Splitter leaking at goal deducts 1 life and emits zero enemySplit
    let splitEvents = 0;
    let killEvents = 0;
    let leakEvents = 0;
    events.on('enemySplit', () => splitEvents++);
    events.on('enemyKilled', () => killEvents++);
    events.on('enemyLeaked', () => leakEvents++);

    const leaker = world.enemySystem.spawnEnemy('splitter')!;
    leaker.dist = leaker.totalDist - 0.001;
    const livesBefore = world.lives;
    world.fixedTick(BALANCE.fixedDt);
    expect(world.lives).toBe(livesBefore - 1);
    expect(leakEvents).toBe(1);
    expect(splitEvents).toBe(0);
    expect(world.enemyPool.getActiveCount()).toBe(0);

    // 2. Two lethal arrows hitting the exact same splitter in one tick award only 1 kill & 1 split
    const t1 = world.placeTower(4, 2, 'archer')!;
    const t2 = world.placeTower(4, 3, 'archer')!;
    const victim = world.enemySystem.spawnEnemy('splitter')!;
    victim.dist = 10;
    victim.hp = 5;
    const p1 = world.projectileSystem.spawnProjectile(t1, victim, 1)!;
    const p2 = world.projectileSystem.spawnProjectile(t2, victim, 1)!;
    p1.progress = 0.99;
    p2.progress = 0.99;

    const goldBefore = world.gold;
    world.projectileSystem.update(0.1, world.towers);
    expect(t1.kills + t2.kills).toBe(1);
    expect(t1.totalDamageDealt + t2.totalDamageDealt).toBe(5);
    world.enemySystem.update(BALANCE.fixedDt, () => {}, (k) => {
      world.gold += k.reward;
    });
    expect(killEvents).toBe(1);
    expect(splitEvents).toBe(1);
    expect(world.gold).toBe(goldBefore + ENEMY_DEFS.splitter.reward);
    expect(world.enemyPool.getActiveCount()).toBe(2);

    // 3. Double meteor hitting a target killed by the first meteor does not emit a second enemyHit or negative HP,
    // and pending meteor resolves during betweenWaves while cooldown remains frozen
    world.enemyPool.clear();
    const hitEvents: number[] = [];
    events.on('enemyHit', (ev) => hitEvents.push(ev.damage));

    const grunt = world.enemySystem.spawnEnemy('grunt')!;
    grunt.x = 0;
    grunt.z = 0;
    world.spatialHash.clear();
    world.spatialHash.insert(grunt.poolIndex, grunt.x, grunt.z);

    world.abilitySystem.castMeteor(0, 0, 1);
    // Bypass cooldown to schedule a second overlapping meteor in the same window
    (world.abilitySystem as unknown as { cooldowns: { meteor: number } }).cooldowns.meteor = 0;
    world.abilitySystem.castMeteor(0, 0, 1);

    const cdBefore = world.abilitySystem.getCooldown('meteor');
    // Resolve while isCombatActive = false -> cooldown stays frozen, grunt hit once for remaining HP
    world.abilitySystem.update(0.35, false, world.enemyPool, world.spatialHash, world.enemySystem);
    expect(world.abilitySystem.getCooldown('meteor')).toBe(cdBefore);
    expect(grunt.hp).toBe(0);
    expect(hitEvents).toEqual([grunt.maxHp]);
  });
});
