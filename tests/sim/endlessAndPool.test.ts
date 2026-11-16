import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { ObjectPool } from '../../src/core/pool.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVELS, type LevelDef } from '../../src/data/levels/index.ts';
import { buildEndlessWaveDef, WaveSystem } from '../../src/sim/waveSystem.ts';
import { SimWorld } from '../../src/sim/world.ts';

describe('ObjectPool exhaustion and lifecycle', () => {
  it('acquires lowest indices first, returns null when full, and reuses released slots', () => {
    const pool = new ObjectPool(3, (id) => ({ id, active: false }));

    const a = pool.acquire()!;
    const b = pool.acquire()!;
    const c = pool.acquire()!;
    expect([a.id, b.id, c.id]).toEqual([0, 1, 2]);
    expect(pool.getActiveCount()).toBe(3);
    expect(pool.acquire()).toBeNull();

    // Release middle active slot (swap-remove) and verify remaining active items & re-acquire
    pool.releaseAtActivePos(1);
    expect(b.active).toBe(false);
    expect(pool.getActiveCount()).toBe(2);
    const remainingIds = [
      pool.items[pool.getActiveIndex(0)].id,
      pool.items[pool.getActiveIndex(1)].id,
    ].sort();
    expect(remainingIds).toEqual([0, 2]);

    const reacquired = pool.acquire()!;
    expect(reacquired).toBe(b);
    expect(reacquired.active).toBe(true);
    expect(pool.getActiveCount()).toBe(3);
    expect(pool.acquire()).toBeNull();

    pool.clear();
    expect(pool.getActiveCount()).toBe(0);
    expect(a.active || b.active || c.active).toBe(false);
    expect(pool.acquire()).not.toBeNull();
  });
});

describe('endless wave generation and reward multiplier', () => {
  it('decays getRewardMultiplier monotonically in endless waves and clamps at 0.32', () => {
    const level = LEVELS[0]; // 10 story waves
    const ws = new WaveSystem(level, new EventBus());

    expect(ws.getRewardMultiplier()).toBe(1);
    for (let i = 0; i < level.waves.length; i++) {
      ws.currentWaveIndex = i;
      expect(ws.getRewardMultiplier()).toBe(1);
    }

    // Endless step 1..15: 1 / (1 + step * 0.14)
    ws.currentWaveIndex = level.waves.length; // step 1
    expect(ws.getRewardMultiplier()).toBeCloseTo(1 / 1.14, 6);

    ws.currentWaveIndex = level.waves.length + 4; // step 5
    expect(ws.getRewardMultiplier()).toBeCloseTo(1 / 1.7, 6);

    // Step 16: 1 / (1 + 16 * 0.14) = 1 / 3.24 = 0.3086 -> clamped to 0.32
    ws.currentWaveIndex = level.waves.length + 15;
    expect(ws.getRewardMultiplier()).toBe(0.32);

    ws.currentWaveIndex = level.waves.length + 100;
    expect(ws.getRewardMultiplier()).toBe(0.32);
  });

  it('builds deterministic endless waves with capped counts, min intervals, and every-5th-wave bosses', () => {
    const shortLevel = LEVELS[0]; // 10 waves (scaleFactor = 1)
    const longLevel = LEVELS[8]; // 22 waves (scaleFactor = 1.6)

    const w0a = buildEndlessWaveDef(shortLevel.waves.length, shortLevel);
    const w0b = buildEndlessWaveDef(shortLevel.waves.length, shortLevel);
    expect(w0a).toEqual(w0b);

    // offset 0 -> no boss
    expect(w0a.groups.some((g) => g.enemyType === 'boss')).toBe(false);

    // offset 4 -> 1 boss + +25 bonus
    const boss1 = buildEndlessWaveDef(shortLevel.waves.length + 4, shortLevel);
    const boss1Group = boss1.groups.find((g) => g.enemyType === 'boss');
    expect(boss1Group).toEqual({
      enemyType: 'boss',
      count: 1,
      spawnInterval: 2.4,
      startDelay: 3.2,
    });

    // offset 9 -> 2 bosses with shorter interval
    const boss2 = buildEndlessWaveDef(shortLevel.waves.length + 9, shortLevel);
    const boss2Group = boss2.groups.find((g) => g.enemyType === 'boss');
    expect(boss2Group?.count).toBe(2);
    expect(boss2Group?.spawnInterval).toBeCloseTo(2.15, 5);

    // Long level scales faster than short level
    const longFirst = buildEndlessWaveDef(longLevel.waves.length, longLevel);
    expect(longFirst.groups[0].count).toBeGreaterThan(w0a.groups[0].count);

    // Extreme wave offset obeys all count caps and 0.18s spawnInterval floor
    const extreme = buildEndlessWaveDef(shortLevel.waves.length + 80, shortLevel);
    const byType = new Map(extreme.groups.map((g) => [g.enemyType, g]));
    expect(byType.get('grunt')?.count).toBe(36);
    expect(byType.get('runner')?.count).toBe(36);
    expect(byType.get('splitter')?.count).toBe(24);
    expect(byType.get('flyer')?.count).toBe(34);
    expect(byType.get('brute')?.count).toBe(26);
    expect(byType.get('healer')?.count).toBe(12);
    for (const g of extreme.groups) {
      expect(g.spawnInterval).toBeGreaterThanOrEqual(0.18);
    }

    // Empty-waves edge case falls back to clearBonus base 40 and clamps negative offset to 0
    const emptyWavesLevel: LevelDef = { ...shortLevel, waves: [] };
    const fallbackWave = buildEndlessWaveDef(0, emptyWavesLevel);
    expect(fallbackWave.clearBonus).toBe(40);
  });

  it('gates enterEndlessMode on winning, scales spawned rewards with floor >= 1, and handles endless loss', () => {
    const events = new EventBus();
    const world = new SimWorld(LEVELS[0], events);

    expect(world.enterEndlessMode()).toBe(false);

    const enteredPayloads: Array<{ startingWave: number }> = [];
    let wonCount = 0;
    const lostPayloads: Array<{ waveIndex: number; endless?: boolean }> = [];
    events.on('endlessEntered', (ev) => {
      enteredPayloads.push(ev);
    });
    events.on('gameWon', () => {
      wonCount++;
    });
    events.on('gameLost', (ev) => {
      lostPayloads.push(ev);
    });

    world.debugForceWin();
    expect(wonCount).toBe(1);
    expect(world.enterEndlessMode()).toBe(true);
    expect(enteredPayloads).toEqual([{ startingWave: LEVELS[0].waves.length + 1 }]);
    expect(world.outcome).toBe('ongoing');
    expect(world.waveSystem.isEndless).toBe(true);

    // Jump deep into endless where multiplier = 0.32 -> runner reward 3 * 0.32 = 0.96 -> floored to min 1
    world.debugSkipToWave(LEVELS[0].waves.length + 25);
    expect(world.waveSystem.getRewardMultiplier()).toBe(0.32);

    // Step until at least one runner and one grunt spawn
    for (let i = 0; i < 120; i++) {
      world.fixedTick(BALANCE.fixedDt);
    }
    const active = [];
    for (let i = 0; i < world.enemyPool.getActiveCount(); i++) {
      active.push(world.enemyPool.items[world.enemyPool.getActiveIndex(i)]);
    }
    const runner = active.find((e) => e.type === 'runner');
    const grunt = active.find((e) => e.type === 'grunt');
    expect(runner?.reward).toBe(1);
    expect(grunt?.reward).toBe(Math.max(1, Math.round(ENEMY_DEFS.grunt.reward * 0.32)));

    // Endless waves completing do not fire gameWon again
    world.enemyPool.clear();
    world.waveSystem.state = 'allSpawned';
    world.waveSystem.checkCompletion(
      () => world.enemyPool.getActiveCount(),
      () => {},
      () => {
        throw new Error('onAllClearedWin should never run in endless mode');
      },
    );
    expect(wonCount).toBe(1);
    expect(world.waveSystem.state).toBe('betweenWaves');

    // Losing in endless sets gameLost.endless = true
    world.lives = 1;
    const leaker = world.enemySystem.spawnEnemy('grunt')!;
    leaker.dist = leaker.totalDist - 0.01;
    world.fixedTick(BALANCE.fixedDt);
    expect(world.outcome).toBe('lost');
    expect(lostPayloads).toHaveLength(1);
    expect(lostPayloads[0]?.endless).toBe(true);
  });
});

describe('simulation pool exhaustion safety', () => {
  it('handles full enemyPool gracefully across spawnEnemy, wave spawning, splitters, and boss summons', () => {
    const events = new EventBus();
    const world = new SimWorld(LEVELS[0], events);

    let spawnEvents = 0;
    let summonEvents = 0;
    events.on('enemySpawned', () => spawnEvents++);
    events.on('bossSummon', () => summonEvents++);

    // Fill enemyPool completely (360/360)
    const cap = BALANCE.pools.maxEnemies;
    for (let i = 0; i < cap; i++) {
      expect(world.enemySystem.spawnEnemy('grunt')).not.toBeNull();
    }
    expect(world.enemyPool.getActiveCount()).toBe(cap);
    expect(spawnEvents).toBe(cap);

    // Additional spawn fails cleanly without emitting enemySpawned
    expect(world.enemySystem.spawnEnemy('grunt')).toBeNull();
    expect(spawnEvents).toBe(cap);

    // Boss reaching <=50% HP while pool is truly saturated (360/360) emits no bossSummon
    const slot1 = world.enemyPool.items[world.enemyPool.getActiveIndex(1)];
    slot1.type = 'boss';
    slot1.maxHp = 1000;
    slot1.hp = 400;
    slot1.bossSummonedEscorts = false;

    const summonCounts: number[] = [];
    events.on('bossSummon', (ev) => summonCounts.push(ev.count));
    world.startNextWave();
    expect(() => world.fixedTick(BALANCE.fixedDt)).not.toThrow();
    expect(summonCounts).toEqual([]);
    expect(world.enemyPool.getActiveCount()).toBe(cap);

    // Now make slot 0 a dead splitter and slot 2 a fresh <=50% HP boss:
    // First pass frees 1 slot when releasing dead splitter, so second pass summons 1 escort cleanly
    const slot0 = world.enemyPool.items[world.enemyPool.getActiveIndex(0)];
    slot0.type = 'splitter';
    slot0.hp = 0;
    slot0.isSplitChild = false;

    const slot2 = world.enemyPool.items[world.enemyPool.getActiveIndex(2)];
    slot2.type = 'boss';
    slot2.maxHp = 1000;
    slot2.hp = 400;
    slot2.bossSummonedEscorts = false;

    expect(() => world.fixedTick(BALANCE.fixedDt)).not.toThrow();
    expect(summonCounts).toEqual([1]);
    expect(world.enemyPool.getActiveCount()).toBe(cap);

    // Release 1 slot manually (359/360), then kill a splitter: 1st hatchling acquires the free slot, 2nd returns null cleanly
    world.enemyPool.releaseAtActivePos(0);
    expect(world.enemyPool.getActiveCount()).toBe(cap - 1);
    const nextSplitter = world.enemyPool.items[world.enemyPool.getActiveIndex(0)];
    nextSplitter.type = 'splitter';
    nextSplitter.hp = 0;
    nextSplitter.isSplitChild = false;
    world.enemySystem.update(
      BALANCE.fixedDt,
      () => {},
      () => {},
    );
    expect(world.enemyPool.getActiveCount()).toBe(cap - 1);
  });

  it('handles full projectilePool gracefully in ProjectileSystem and CombatSystem and recovers on impact', () => {
    const events = new EventBus();
    const world = new SimWorld(LEVELS[0], events);
    world.gold = 5000;

    const archer = world.placeTower(4, 2, 'archer')!;
    const target = world.enemySystem.spawnEnemy('brute')!;
    target.x = archer.x + 2;
    target.z = archer.z;

    const cap = BALANCE.pools.maxProjectiles;
    for (let i = 0; i < cap; i++) {
      const p = world.projectileSystem.spawnProjectile(archer, target, 1);
      expect(p).not.toBeNull();
      // Keep active in flight for ~0.5s
      p!.duration = 0.5;
      p!.progress = 0;
    }
    expect(world.projectilePool.getActiveCount()).toBe(cap);
    expect(world.projectileSystem.spawnProjectile(archer, target, 1)).toBeNull();

    // CombatSystem firing while projectile pool is exhausted must not throw
    archer.cooldownTimer = 0;
    world.spatialHash.clear();
    world.spatialHash.insert(target.poolIndex, target.x, target.z);
    expect(() => world.combatSystem.update(BALANCE.fixedDt, world.towers)).not.toThrow();
    expect(world.projectilePool.getActiveCount()).toBe(cap);

    // Advance past 0.5s so pooled projectiles impact & release
    for (let i = 0; i < 40; i++) {
      world.projectileSystem.update(BALANCE.fixedDt, world.towers);
    }
    expect(world.projectilePool.getActiveCount()).toBe(0);
    expect(world.projectileSystem.spawnProjectile(archer, target, 1)).not.toBeNull();
  });
});
