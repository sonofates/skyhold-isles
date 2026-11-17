import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ENEMY_DEFS, ENEMY_TYPES } from '../../src/data/enemies.ts';
import { LEVELS, type LevelDef } from '../../src/data/levels/index.ts';
import { CompiledPath } from '../../src/sim/path.ts';
import { buildEndlessWaveDef, WaveSystem } from '../../src/sim/waveSystem.ts';
import { computeSellRefund, computeStarRating, SimWorld } from '../../src/sim/world.ts';

describe('WaveSystem & SimWorld boundary edge cases', () => {
  it('handles skipToWave clamping, empty-wave guards, and endless unbounded skips', () => {
    const emptyLevel: LevelDef = { ...LEVELS[0], waves: [] };
    const emptyWs = new WaveSystem(emptyLevel, new EventBus());
    expect(emptyWs.skipToWave(1)).toBe(false);

    const world = new SimWorld(LEVELS[0], new EventBus());
    expect(world.debugSkipToWave(0)).toBe(true);
    expect(world.waveSystem.currentWaveOneBased).toBe(1);
    expect(world.debugSkipToWave(-10)).toBe(true);
    expect(world.waveSystem.currentWaveOneBased).toBe(1);

    // Story mode clamps above waves.length
    expect(world.debugSkipToWave(500)).toBe(true);
    expect(world.waveSystem.currentWaveOneBased).toBe(LEVELS[0].waves.length);

    // Endless mode allows jumping far beyond story wave count
    world.debugForceWin();
    expect(world.enterEndlessMode()).toBe(true);
    expect(world.debugSkipToWave(25)).toBe(true);
    expect(world.waveSystem.currentWaveOneBased).toBe(25);
    expect(world.waveSystem.totalWaves).toBe(25);
  });

  it('auto-starts next wave with zero early bonus when betweenWaves countdown expires', () => {
    const events = new EventBus();
    const world = new SimWorld(LEVELS[0], events);
    const startedWaves: Array<{ waveIndex: number; earlyBonus: number }> = [];
    events.on('waveStarted', (ev) => {
      startedWaves.push({ waveIndex: ev.waveIndex, earlyBonus: ev.earlyBonus });
    });

    world.waveSystem.state = 'betweenWaves';
    world.waveSystem.currentWaveIndex = 0;
    world.waveSystem.interWaveTimer = 0.05;
    const goldBefore = world.gold;

    world.fixedTick(0.05);
    expect(world.waveSystem.state).toBe('spawning');
    expect(world.waveSystem.currentWaveOneBased).toBe(2);
    expect(startedWaves).toEqual([{ waveIndex: 1, earlyBonus: 0 }]);
    expect(world.gold).toBe(goldBefore);
  });

  it('ignores applyDamage and applySlow on inactive enemies and clears slow on exact slowTimer expiry', () => {
    const world = new SimWorld(LEVELS[0], new EventBus());
    const grunt = world.enemySystem.spawnEnemy('grunt')!;
    world.enemyPool.releaseAtActivePos(0);
    expect(grunt.active).toBe(false);

    expect(world.enemySystem.applyDamage(grunt, 50, true)).toEqual({
      actualDamage: 0,
      killed: false,
    });
    world.enemySystem.applySlow(grunt, 0.4, 2.0);
    expect(grunt.slowRatio).toBe(0);
    expect(grunt.slowTimer).toBe(0);

    // Exact boundary slowTimer === dt clears slowRatio immediately on that update tick
    const runner = world.enemySystem.spawnEnemy('runner')!;
    world.enemySystem.applySlow(runner, 0.3, 0.1);
    expect(runner.slowRatio).toBeCloseTo(0.3, 5);
    world.enemySystem.update(0.1, () => {}, () => {});
    expect(runner.slowTimer).toBe(0);
    expect(runner.slowRatio).toBe(0);
  });

  it('clamps non-positive CombatSystem fireRateMultiplier and gates startNextWave after outcome', () => {
    const world = new SimWorld(LEVELS[0], new EventBus());
    world.gold = 1000;
    const archer = world.placeTower(4, 2, 'archer')!;
    archer.cooldownTimer = 1.0;

    // Clamps multiplier <= 0 to 0.01 instead of producing negative/NaN cooldown
    world.combatSystem.update(0.5, [archer], -3);
    expect(archer.cooldownTimer).toBeCloseTo(1.0 - 0.5 * 0.01, 6);

    world.debugForceWin();
    expect(world.startNextWave()).toBe(false);
    world.debugSkipToWave(1);
    world.debugForceLose();
    expect(world.startNextWave()).toBe(false);
  });

  it('evaluates computeStarRating strictly at BALANCE thresholds', () => {
    const t3 = BALANCE.starThresholds.threeStarsMinLives;
    const t2 = BALANCE.starThresholds.twoStarsMinLives;
    expect(computeStarRating(BALANCE.startingLives)).toBe(3);
    expect(computeStarRating(t3)).toBe(3);
    expect(computeStarRating(t3 - 1)).toBe(2);
    expect(computeStarRating(t2)).toBe(2);
    expect(computeStarRating(t2 - 1)).toBe(1);
    expect(computeStarRating(1)).toBe(1);
    expect(computeStarRating(0)).toBe(1);
  });

  it('resolves close-range projectiles in a single tick and clamps parabolic lead at path end', () => {
    const events = new EventBus();
    const world = new SimWorld(LEVELS[0], events);
    world.gold = 2000;

    const archer = world.placeTower(4, 2, 'archer')!;
    const mortar = world.placeTower(7, 5, 'mortar')!;

    // Close target -> duration clamped to min 0.06s; one 0.1s update impacts & frees immediately
    const runner = world.enemySystem.spawnEnemy('runner')!;
    runner.x = archer.x + 0.1;
    runner.z = archer.z;
    const arrow = world.projectileSystem.spawnProjectile(archer, runner, 1)!;
    expect(arrow.duration).toBeCloseTo(0.06, 6);
    world.projectileSystem.update(0.1, world.towers);
    expect(arrow.active).toBe(false);
    expect(archer.totalDamageDealt).toBeGreaterThan(0);

    // Enemy near end of path: parabolic lead clamps along path without NaN or overshooting
    const nearEnd = world.enemySystem.spawnEnemy('grunt')!;
    nearEnd.dist = nearEnd.totalDist - 0.05;
    const endPos = { x: 0, y: 0, z: 0 };
    world.groundPath.sample(nearEnd.dist, endPos);
    nearEnd.x = endPos.x;
    nearEnd.z = endPos.z;
    const shell = world.projectileSystem.spawnProjectile(mortar, nearEnd, 0.45)!;
    expect(Number.isFinite(shell.endX)).toBe(true);
    expect(Number.isFinite(shell.endZ)).toBe(true);
    const goalPos = { x: 0, y: 0, z: 0 };
    world.groundPath.sample(nearEnd.totalDist, goalPos);
    expect(Math.hypot(shell.endX - goalPos.x, shell.endZ - goalPos.z)).toBeLessThan(0.5);
  });

  it('keeps longer slow duration when hit by a weaker-duration slow and handles boss retry->hit transition', () => {
    const events = new EventBus();
    const world = new SimWorld(LEVELS[0], events);
    world.gold = 2000;

    const grunt = world.enemySystem.spawnEnemy('grunt')!;
    world.enemySystem.applySlow(grunt, 0.35, 3.0);
    world.enemySystem.applySlow(grunt, 0.2, 0.5);
    expect(grunt.slowTimer).toBeCloseTo(3.0, 5);
    expect(grunt.slowRatio).toBeCloseTo(0.45, 5); // max(0.35, 0.35 + 0.2*0.5)

    // Boss with no towers in range retries every 0.75s, then stuns as soon as a tower enters range
    const boss = world.enemySystem.spawnEnemy('boss')!;
    boss.bossPulseTimer = 0.01;
    const t = world.placeTower(4, 2, 'archer')!;
    (t as { x: number; z: number }).x = boss.x + 20;
    (t as { x: number; z: number }).z = boss.z;

    let pulses = 0;
    events.on('bossPulse', () => pulses++);

    world.enemySystem.update(0.02, () => {}, () => {}, [t], 1);
    expect(pulses).toBe(0);
    expect(boss.bossPulseTimer).toBeCloseTo(0.75, 5);

    (t as { x: number; z: number }).x = boss.x + 2.0;
    boss.bossPulseTimer = 0.01;
    world.enemySystem.update(0.02, () => {}, () => {}, [t], 1);
    expect(pulses).toBe(1);
    expect(t.stunTimer).toBeCloseTo(2.65, 5);
  });

  it('preserves short remaining countdown on setAutoWave(true), restores 5s endless countdown, and handles duplicate waypoints & deep endless bosses', () => {
    const world = new SimWorld(LEVELS[0], new EventBus());
    const ws = world.waveSystem;
    ws.state = 'betweenWaves';
    ws.currentWaveIndex = 0;
    ws.interWaveTimer = 0.3;

    // Turning autoWave on when < 0.75s left must NOT lengthen the countdown
    world.setAutoWave(true);
    expect(ws.interWaveTimer).toBeCloseTo(0.3, 6);
    world.setAutoWave(false);
    expect(ws.interWaveTimer).toBeCloseTo(0.3, 6);

    // Entering endless with autoWave enabled starts at 0.8s, disabling autoWave restores full 5.0s
    world.setAutoWave(true);
    world.debugForceWin();
    expect(world.enterEndlessMode()).toBe(true);
    expect(ws.interWaveTimer).toBeCloseTo(0.8, 6);
    world.setAutoWave(false);
    expect(ws.interWaveTimer).toBeCloseTo(5.0, 6);

    // Deep endless offset +14 (waveIndex = waves.length + 14) -> 3 bosses & 1.22^15 scaling
    const wave15 = buildEndlessWaveDef(LEVELS[0].waves.length + 14, LEVELS[0]);
    const bossGroup = wave15.groups.find((g) => g.enemyType === 'boss');
    expect(bossGroup?.count).toBe(3);

    world.debugSkipToWave(LEVELS[0].waves.length);
    const lastStoryScale = ws.getCurrentWaveHpScale();
    world.debugSkipToWave(LEVELS[0].waves.length + 15);
    expect(ws.getCurrentWaveHpScale()).toBeCloseTo(lastStoryScale * Math.pow(1.22, 15), 4);

    // Duplicate consecutive waypoints in CompiledPath produce finite length and valid sampling
    const dupPath = new CompiledPath(
      [
        { col: 1, row: 1 },
        { col: 1, row: 1 },
        { col: 4, row: 1 },
      ],
      6,
      4,
      0,
      true,
    );
    const out = { x: 0, y: 0, z: 0 };
    expect(Number.isFinite(dupPath.totalLength)).toBe(true);
    expect(dupPath.totalLength).toBeCloseTo(3 * BALANCE.tileSize, 5);
    const yaw = dupPath.sample(dupPath.totalLength * 0.5, out);
    expect(Number.isFinite(yaw)).toBe(true);
    expect(Number.isFinite(out.x) && Number.isFinite(out.z)).toBe(true);
  });

  it('supports early-call from allSpawned in Endless Mode with bonus accumulation, exact upgrade boundary, and preFirstWave HP scale', () => {
    const events = new EventBus();
    const world = new SimWorld(LEVELS[0], events);
    // Pre-first-wave (currentWaveIndex = -1) clamps w >= 0 to base scale
    expect(world.waveSystem.getCurrentWaveHpScale()).toBeCloseTo(LEVELS[0].enemyHpScale ?? 1, 8);

    // Exact affordability boundary on build & upgrade
    const archerCost = 50;
    const t2Cost = 55;
    world.gold = archerCost - 1;
    expect(world.placeTower(4, 2, 'archer')).toBeNull();
    world.gold = archerCost;
    const tower = world.placeTower(4, 2, 'archer')!;
    expect(tower).not.toBeNull();
    expect(world.gold).toBe(0);

    world.gold = t2Cost - 1;
    expect(world.upgradeTower(tower.id)).toBe(false);
    world.gold = t2Cost;
    expect(world.upgradeTower(tower.id)).toBe(true);
    expect(world.gold).toBe(0);

    // Enter endless mode and advance wave N+1 until all its spawns enter 'allSpawned'
    world.debugForceWin();
    expect(world.enterEndlessMode()).toBe(true);
    expect(world.startNextWave()).toBe(true);
    for (let i = 0; i < 60 * 30 && world.waveSystem.state === 'spawning'; i++) {
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(world.waveSystem.state).toBe('allSpawned');
    expect(world.enemyPool.getActiveCount()).toBeGreaterThan(0);
    expect(world.waveSystem.canStartNextWave()).toBe(true);
    expect(world.waveSystem.getEarlyCallBonus()).toBe(BALANCE.earlyWaveBonusMaxGold);

    const w1ClearBonus = buildEndlessWaveDef(LEVELS[0].waves.length, LEVELS[0]).clearBonus;
    const w2ClearBonus = buildEndlessWaveDef(LEVELS[0].waves.length + 1, LEVELS[0]).clearBonus;
    expect(world.waveSystem.pendingClearBonus).toBe(w1ClearBonus);

    const goldBeforeEarly = world.gold;
    expect(world.startNextWave()).toBe(true);
    expect(world.gold).toBe(goldBeforeEarly + BALANCE.earlyWaveBonusMaxGold);
    expect(world.waveSystem.totalWaves).toBe(LEVELS[0].waves.length + 2);

    // Finish spawning wave N+2 -> state returns to 'allSpawned' with combined pendingClearBonus
    for (let i = 0; i < 60 * 30 && world.waveSystem.state === 'spawning'; i++) {
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(world.waveSystem.pendingClearBonus).toBe(w1ClearBonus + w2ClearBonus);

    const completedBonuses: number[] = [];
    events.on('waveCompleted', (ev) => completedBonuses.push(ev.bonus));
    world.enemyPool.clear();
    world.fixedTick(BALANCE.fixedDt);

    expect(completedBonuses).toEqual([w1ClearBonus + w2ClearBonus]);
    expect(world.waveSystem.state).toBe('betweenWaves');
    expect(world.waveSystem.pendingClearBonus).toBe(0);
  });

  it('merges duplicate enemyType groups in getNextWavePreview preserving first-seen order and defaults omitted HP scaling', () => {
    const levelWithDupGroups: LevelDef = {
      ...LEVELS[0],
      enemyHpScale: undefined,
      waveHpGrowth: undefined,
      waves: [
        {
          clearBonus: 30,
          groups: [
            { enemyType: 'runner', count: 3, spawnInterval: 0.5, startDelay: 0 },
            { enemyType: 'grunt', count: 4, spawnInterval: 0.5, startDelay: 0.5 },
            { enemyType: 'runner', count: 5, spawnInterval: 0.4, startDelay: 2.0 },
            { enemyType: 'flyer', count: 2, spawnInterval: 0.8, startDelay: 3.0 },
            { enemyType: 'grunt', count: 2, spawnInterval: 0.5, startDelay: 4.0 },
          ],
        },
      ],
    };

    const world = new SimWorld(levelWithDupGroups, new EventBus());
    expect(world.waveSystem.getCurrentWaveHpScale()).toBe(1);
    expect(world.waveSystem.getNextWavePreview()).toEqual({
      waveOneBased: 1,
      items: [
        { enemyType: 'runner', count: 8 },
        { enemyType: 'grunt', count: 6 },
        { enemyType: 'flyer', count: 2 },
      ],
    });

    // Endless skipToWave with waveOneBased <= 0 clamps cleanly to wave 1
    world.debugForceWin();
    expect(world.enterEndlessMode()).toBe(true);
    expect(world.debugSkipToWave(0)).toBe(true);
    expect(world.waveSystem.currentWaveOneBased).toBe(1);
    expect(world.waveSystem.getCurrentWaveHpScale()).toBe(1);
  });

  it('defers final-wave victory until meteor-killed splitter hatchlings resolve, handles multi-leak clamping, and enforces minArmorDamage', () => {
    const events = new EventBus();
    const singleSplitterLevel: LevelDef = {
      ...LEVELS[0],
      waves: [
        {
          clearBonus: 40,
          groups: [{ enemyType: 'splitter', count: 1, spawnInterval: 0.5, startDelay: 0 }],
        },
      ],
    };
    const world = new SimWorld(singleSplitterLevel, events);
    let wonCount = 0;
    let splitCount = 0;
    events.on('gameWon', () => wonCount++);
    events.on('enemySplit', () => splitCount++);

    world.startNextWave();
    world.fixedTick(BALANCE.fixedDt); // spawns splitter and transitions to allSpawned
    expect(world.waveSystem.state).toBe('allSpawned');
    expect(world.enemyPool.getActiveCount()).toBe(1);

    const parent = world.enemyPool.items[world.enemyPool.getActiveIndex(0)];
    expect(world.castMeteor(parent.x, parent.z)).toBe(true);
    // Advance until meteor impacts (~0.32s) -> kills splitter, spawns 2 hatchlings -> NOT won yet!
    for (let i = 0; i < 25; i++) {
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(splitCount).toBe(1);
    expect(world.enemyPool.getActiveCount()).toBe(2);
    expect(wonCount).toBe(0);
    expect(world.outcome).toBe('ongoing');

    // Defeat both hatchlings -> gameWon emits cleanly on the completion tick
    for (let i = 0; i < 2; i++) {
      const child = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
      world.enemySystem.applyDamage(child, 999, true);
    }
    world.fixedTick(BALANCE.fixedDt);
    expect(wonCount).toBe(1);
    expect(world.outcome).toBe('won');

    // Same-tick multi-enemy leak when lives === 1 emits gameLost once, clamps lives to 0, and emits both enemyLeaked events
    const leakEvents = new EventBus();
    const leakWorld = new SimWorld(LEVELS[0], leakEvents);
    let lostCount = 0;
    let leakedCount = 0;
    leakEvents.on('gameLost', () => lostCount++);
    leakEvents.on('enemyLeaked', () => leakedCount++);

    leakWorld.lives = 1;
    const b1 = leakWorld.enemySystem.spawnEnemy('brute')!;
    const b2 = leakWorld.enemySystem.spawnEnemy('brute')!;
    b1.dist = b1.totalDist - 0.001;
    b2.dist = b2.totalDist - 0.001;
    leakWorld.fixedTick(BALANCE.fixedDt);
    expect(leakWorld.lives).toBe(0);
    expect(leakWorld.outcome).toBe('lost');
    expect(lostCount).toBe(1);
    expect(leakedCount).toBe(2);

    // Armor exceeding raw damage still deals BALANCE.minArmorDamage (1)
    const boss = leakWorld.enemySystem.spawnEnemy('boss')!;
    const hpBefore = boss.hp;
    const dmgRes = leakWorld.enemySystem.applyDamage(boss, 3, false); // 3 - 8 armor -> clamped to 1
    expect(dmgRes).toEqual({ actualDamage: BALANCE.minArmorDamage, killed: false });
    expect(boss.hp).toBe(hpBefore - BALANCE.minArmorDamage);

    // Zero raw damage ignoring armor deals 0 and fractional damage rounds cleanly
    const grunt = leakWorld.enemySystem.spawnEnemy('grunt')!;
    expect(leakWorld.enemySystem.applyDamage(grunt, 0, true)).toEqual({
      actualDamage: 0,
      killed: false,
    });
    expect(leakWorld.enemySystem.applyDamage(grunt, 10.6, true)).toEqual({
      actualDamage: 11,
      killed: false,
    });

    // Deep endless fixedTick clamps scaled enemy kill reward to >= 1 across all archetypes
    const deepWorld = new SimWorld(LEVELS[0], new EventBus());
    deepWorld.debugForceWin();
    expect(deepWorld.enterEndlessMode()).toBe(true);
    expect(deepWorld.debugSkipToWave(LEVELS[0].waves.length + 50)).toBe(true);
    expect(deepWorld.waveSystem.getRewardMultiplier()).toBe(0.32);
    deepWorld.fixedTick(BALANCE.fixedDt);
    expect(deepWorld.enemyPool.getActiveCount()).toBeGreaterThan(0);
    for (let i = 0; i < deepWorld.enemyPool.getActiveCount(); i++) {
      const e = deepWorld.enemyPool.items[deepWorld.enemyPool.getActiveIndex(i)];
      expect(e.reward).toBeGreaterThanOrEqual(1);
      expect(e.reward).toBeLessThanOrEqual(ENEMY_DEFS[e.type].reward);
    }

    // All EnemyTypes spawn cleanly with positive rounded maxHp at high hpScale
    for (const type of ENEMY_TYPES) {
      const spawned = leakWorld.enemySystem.spawnEnemy(type, 12.34)!;
      expect(spawned).not.toBeNull();
      expect(spawned.maxHp).toBe(Math.round(ENEMY_DEFS[type].maxHp * 12.34));
    }

    // Non-positive dt in AbilitySystem.update is a complete no-op (preserves cooldown, overcharge, and pending meteors)
    const abWorld = new SimWorld(LEVELS[0], new EventBus());
    abWorld.startNextWave();
    expect(abWorld.castOvercharge()).toBe(true);
    expect(abWorld.castMeteor(0, 0)).toBe(true);
    const overBefore = abWorld.abilitySystem.getOverchargeRemaining();
    const meteorCdBefore = abWorld.abilitySystem.getCooldown('meteor');
    abWorld.abilitySystem.update(0, true, abWorld.enemyPool, abWorld.spatialHash, abWorld.enemySystem);
    abWorld.abilitySystem.update(-0.5, true, abWorld.enemyPool, abWorld.spatialHash, abWorld.enemySystem);
    expect(abWorld.abilitySystem.getOverchargeRemaining()).toBe(overBefore);
    expect(abWorld.abilitySystem.getCooldown('meteor')).toBe(meteorCdBefore);

    // debugSkipToWave preserves positive lives (> 0) and post-outcome abilities stay blocked
    abWorld.lives = 12;
    expect(abWorld.debugSkipToWave(2)).toBe(true);
    expect(abWorld.lives).toBe(12);
    abWorld.debugForceWin();
    expect(abWorld.castOvercharge()).toBe(false);
    expect(abWorld.castMeteor(0, 0)).toBe(false);
    abWorld.debugSkipToWave(1);
    abWorld.debugForceLose();
    expect(abWorld.castOvercharge()).toBe(false);
    expect(abWorld.castMeteor(0, 0)).toBe(false);
  });

  it('survives 360/360 enemy pool saturation during WaveSystem spawning without stalling wave completion', () => {
    const satLevel: LevelDef = {
      ...LEVELS[0],
      id: 'qa-pool-saturation',
      waves: [
        {
          groups: [{ enemyType: 'grunt', count: 3, spawnInterval: 0.25, startDelay: 0.05 }],
          clearBonus: 40,
        },
      ],
    };
    const bus = new EventBus();
    let spawnedEvents = 0;
    let wonEvents = 0;
    bus.on('enemySpawned', () => {
      spawnedEvents++;
    });
    bus.on('gameWon', () => {
      wonEvents++;
    });

    const world = new SimWorld(satLevel, bus);
    world.lives = 1000;

    // Fill every enemy pool slot before starting wave 1
    for (let i = 0; i < BALANCE.pools.maxEnemies; i++) {
      expect(world.enemySystem.spawnEnemy('grunt')).not.toBeNull();
    }
    expect(world.enemyPool.getActiveCount()).toBe(BALANCE.pools.maxEnemies);
    expect(world.enemySystem.spawnEnemy('grunt')).toBeNull();
    const goldBeforeWave = world.gold;
    const spawnsBeforeWave = spawnedEvents;

    expect(world.startNextWave()).toBe(true);

    // Step past all 3 scheduled wave spawns while pool remains 360/360 saturated:
    // onSpawn receives null, cursor advances cleanly to 'allSpawned'
    for (let t = 0; t < 40; t++) {
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(world.waveSystem.state).toBe('allSpawned');
    expect(spawnedEvents).toBe(spawnsBeforeWave);
    expect(world.enemyPool.getActiveCount()).toBe(BALANCE.pools.maxEnemies);

    // Let active enemies walk off the path; wave still drains to victory
    let guard = 0;
    while (world.outcome === 'ongoing' && guard < 10_000) {
      world.fixedTick(BALANCE.fixedDt);
      guard++;
    }
    expect(world.outcome).toBe('won');
    expect(wonEvents).toBe(1);
    expect(world.enemyPool.getActiveCount()).toBe(0);
    expect(world.lives).toBe(1000 - BALANCE.pools.maxEnemies);
    expect(world.gold).toBe(goldBeforeWave + 40);
  });

  it('orders final-wave last-enemy leak races between 1-star victory (lives=2) and defeat (lives=1)', () => {
    const lastWaveLevel: LevelDef = {
      ...LEVELS[0],
      id: 'qa-final-leak-race',
      waves: [
        {
          groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 0.2, startDelay: 0.05 }],
          clearBonus: 35,
        },
      ],
    };

    const runLeakScenario = (startingLives: number) => {
      const bus = new EventBus();
      const order: string[] = [];
      bus.on('enemyLeaked', () => order.push('enemyLeaked'));
      bus.on('waveCompleted', () => order.push('waveCompleted'));
      bus.on('gameWon', (ev) => order.push(`gameWon:${ev.stars}:${ev.livesRemaining}`));
      bus.on('gameLost', () => order.push('gameLost'));

      const world = new SimWorld(lastWaveLevel, bus);
      world.lives = startingLives;
      const startGold = world.gold;
      expect(world.startNextWave()).toBe(true);

      let ticks = 0;
      while (world.outcome === 'ongoing' && ticks < 10_000) {
        world.fixedTick(BALANCE.fixedDt);
        ticks++;
      }
      return { world, order, startGold };
    };

    const winCase = runLeakScenario(2);
    expect(winCase.world.outcome).toBe('won');
    expect(winCase.world.lives).toBe(1);
    expect(winCase.world.gold).toBe(winCase.startGold + 35);
    expect(winCase.order).toEqual(['enemyLeaked', 'waveCompleted', 'gameWon:1:1']);

    const lossCase = runLeakScenario(1);
    expect(lossCase.world.outcome).toBe('lost');
    expect(lossCase.world.lives).toBe(0);
    expect(lossCase.world.gold).toBe(lossCase.startGold);
    // onLeak callback runs before enemyLeaked emits, so gameLost fires first and waveCompleted/gameWon stay suppressed
    expect(lossCase.order).toEqual(['gameLost', 'enemyLeaked']);
  });

  it('resolves frost linear-homing splash at last position when primary target dies and pool slot recycles', () => {
    const bus = new EventBus();
    const impacts: Array<{ x: number; y: number; z: number; radius: number }> = [];
    bus.on('projectileImpact', (ev) => {
      impacts.push({ x: ev.x, y: ev.y, z: ev.z, radius: ev.radius });
    });

    const world = new SimWorld(LEVELS[0], bus);
    world.gold = 500;

    // Pick a buildable tile with comfortable flight time (~3..4.5 units) from the mid-map crossover
    const groundPath = world.enemySystem.getPath(false);
    const flightPath = world.enemySystem.getPath(true);
    const gProbe = { x: 0, y: 0, z: 0 };
    const fProbe = { x: 0, y: 0, z: 0 };
    let targetGroundDist = 0;
    let targetFlightDist = 0;
    for (let fd = 6; fd < flightPath.totalLength - 4; fd += 0.25) {
      flightPath.sample(fd, fProbe);
      for (let gd = 12; gd < groundPath.totalLength - 4; gd += 0.25) {
        groundPath.sample(gd, gProbe);
        if (Math.hypot(gProbe.x - fProbe.x, gProbe.z - fProbe.z) < 0.9) {
          targetGroundDist = gd;
          targetFlightDist = fd;
          break;
        }
      }
      if (targetGroundDist > 0) break;
    }
    expect(targetGroundDist).toBeGreaterThan(12);
    groundPath.sample(targetGroundDist, gProbe);

    let bestTile: { col: number; row: number } | null = null;
    for (let r = 0; r < world.grid.rows; r++) {
      for (let c = 0; c < world.grid.cols; c++) {
        if (!world.grid.canPlaceTower(c, r)) continue;
        const px = world.grid.gridToWorldX(c);
        const pz = world.grid.gridToWorldZ(r);
        const d = Math.hypot(px - gProbe.x, pz - gProbe.z);
        if (d >= 3.0 && d <= 4.5) {
          bestTile = { col: c, row: r };
          break;
        }
      }
      if (bestTile) break;
    }
    expect(bestTile).not.toBeNull();
    const frostTower = world.placeTower(bestTile!.col, bestTile!.row, 'frost')!;
    expect(frostTower).not.toBeNull();

    // Advance primary grunt + bystander grunt together along groundPath, launching flyer to converge cleanly
    const noop = () => {};
    const targetA = world.enemySystem.spawnEnemy('grunt')!;
    const bystanderGround = world.enemySystem.spawnEnemy('grunt')!;
    const flyerLaunchDist = targetGroundDist - targetFlightDist;
    expect(flyerLaunchDist).toBeGreaterThan(2);

    while (targetA.dist < flyerLaunchDist) {
      world.enemySystem.update(BALANCE.fixedDt, noop, noop, world.towers, 1);
    }
    const bystanderFlyer = world.enemySystem.spawnEnemy('flyer')!;
    while (targetA.dist < targetGroundDist) {
      world.enemySystem.update(BALANCE.fixedDt, noop, noop, world.towers, 1);
    }
    expect(Math.hypot(bystanderFlyer.x - targetA.x, bystanderFlyer.z - targetA.z)).toBeLessThan(1.2);
    expect(Math.hypot(bystanderGround.x - targetA.x, bystanderGround.z - targetA.z)).toBeLessThan(0.2);

    const origPoolIndex = targetA.poolIndex;
    const origUid = targetA.uid;
    const bolt = world.projectileSystem.spawnProjectile(frostTower, targetA, 0.45)!;
    expect(bolt).not.toBeNull();
    expect(bolt.parabolic).toBe(false);
    expect(bolt.splashRadius).toBeGreaterThan(0);

    // One tick of homing records live coordinates before primary dies
    world.projectileSystem.update(BALANCE.fixedDt, world.towers);
    expect(world.projectilePool.getActiveCount()).toBe(1);
    const lastX = bolt.endX;
    const lastZ = bolt.endZ;

    // Kill targetA and settle death so its exact pool slot releases, then recycle into decoyC at path start
    const kills: number[] = [];
    world.enemySystem.applyDamage(targetA, targetA.maxHp + 100, true);
    world.enemySystem.update(BALANCE.fixedDt, noop, (killed) => kills.push(killed.uid), world.towers, 1);
    expect(kills).toEqual([origUid]);
    expect(targetA.active).toBe(false);

    const decoyC = world.enemySystem.spawnEnemy('grunt')!;
    expect(decoyC.poolIndex).toBe(origPoolIndex);
    expect(decoyC.uid).not.toBe(origUid);
    // Keep enemy spatialHash synced with bystanders at their current positions while decoyC sits at path start
    world.enemySystem.update(0.001, noop, noop, world.towers, 1);
    expect(Math.hypot(decoyC.x - lastX, decoyC.z - lastZ)).toBeGreaterThan(bolt.splashRadius + 1);

    const decoyHpBefore = decoyC.hp;
    const groundHpBefore = bystanderGround.hp;
    const flyerHpBefore = bystanderFlyer.hp;

    // Let bolt finish flight without further enemy homing
    for (let i = 0; i < 60 && world.projectilePool.getActiveCount() > 0; i++) {
      world.projectileSystem.update(BALANCE.fixedDt, world.towers);
    }
    expect(world.projectilePool.getActiveCount()).toBe(0);
    expect(impacts.length).toBe(1);
    expect(Math.hypot(impacts[0].x - lastX, impacts[0].z - lastZ)).toBeLessThan(1e-5);

    // Recycled pool slot is untouched (uid guard stopped homing), while ground & flyer bystanders took splash + slow
    expect(decoyC.hp).toBe(decoyHpBefore);
    expect(decoyC.slowTimer).toBe(0);
    expect(bystanderGround.hp).toBeLessThan(groundHpBefore);
    expect(bystanderGround.slowTimer).toBeGreaterThan(0);
    expect(bystanderFlyer.hp).toBeLessThan(flyerHpBefore);
    expect(bystanderFlyer.slowTimer).toBeGreaterThan(0);
    expect(frostTower.totalDamageDealt).toBeGreaterThan(0);
  });

  it('keeps tower IDs strictly monotonic across sell/rebuild cycles and resets countdown/pools on debugSkipToWave', () => {
    const bus = new EventBus();
    const refunds: number[] = [];
    const started: Array<{ waveIndex: number; earlyBonus: number }> = [];
    bus.on('towerSold', (ev) => refunds.push(ev.refund));
    bus.on('waveStarted', (ev) => started.push({ waveIndex: ev.waveIndex, earlyBonus: ev.earlyBonus }));

    const world = new SimWorld(LEVELS[0], bus);
    world.gold = 1000;

    // Build, sell, rebuild on the same cell across multiple cycles
    const t1 = world.placeTower(4, 2, 'archer');
    expect(t1).not.toBeNull();
    expect(world.sellTower(t1!.id)).toBe(computeSellRefund(t1!.totalInvested));
    expect(world.getTowerById(t1!.id)).toBeNull();
    expect(world.grid.getTowerIdAt(4, 2)).toBe(-1);

    const t2 = world.placeTower(4, 2, 'mortar');
    expect(t2).not.toBeNull();
    expect(t2!.id).toBeGreaterThan(t1!.id);
    expect(world.sellTower(t2!.id)).toBe(computeSellRefund(t2!.totalInvested));

    const t3 = world.placeTower(4, 2, 'tesla');
    expect(t3).not.toBeNull();
    expect(t3!.id).toBeGreaterThan(t2!.id);
    expect(world.grid.getTowerIdAt(4, 2)).toBe(t3!.id);
    expect(refunds).toEqual([computeSellRefund(t1!.totalInvested), computeSellRefund(t2!.totalInvested)]);

    // Start wave 1 so enemies spawn, then skip from an active countdown with auto-wave enabled
    expect(world.startNextWave()).toBe(true);
    for (let i = 0; i < 60; i++) world.fixedTick(BALANCE.fixedDt);
    expect(world.enemyPool.getActiveCount()).toBeGreaterThan(0);

    world.setAutoWave(true);
    world.waveSystem.state = 'betweenWaves';
    world.waveSystem.interWaveTimer = 10;
    expect(world.debugSkipToWave(3)).toBe(true);
    expect(world.waveSystem.currentWaveOneBased).toBe(3);
    expect(world.waveSystem.state).toBe('spawning');
    expect(world.waveSystem.interWaveTimer).toBe(0);
    expect(world.enemyPool.getActiveCount()).toBe(0);
    expect(started[started.length - 1]).toEqual({ waveIndex: 2, earlyBonus: 0 });
  });
});
