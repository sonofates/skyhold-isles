import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { GameLoop } from '../../src/platform/browserLoop.ts';
import {
  buildAbilityBarState,
  buildHudStateView,
  stepPendingSpawns,
} from '../../src/platform/sessionBridge.ts';
import { SimWorld } from '../../src/sim/world.ts';

describe('SimWorld inspection, MVP, and debug helpers', () => {
  it('picks hovered enemies prioritizing flyers over ground and skipping dead enemies', () => {
    const world = new SimWorld(LEVELS[0], new EventBus());
    const ground = world.enemySystem.spawnEnemy('grunt')!;
    ground.x = 2.0;
    ground.z = 2.0;

    const flyer = world.enemySystem.spawnEnemy('flyer')!;
    flyer.x = 4.0;
    flyer.z = 4.0;

    world.spatialHash.clear();
    world.spatialHash.insert(ground.poolIndex, ground.x, ground.z);
    world.spatialHash.insert(flyer.poolIndex, flyer.x, flyer.z);

    // Flyer hit takes precedence even when groundHit matches a ground enemy
    const bothMatch = world.findHoveredEnemy(2.0, 2.0, 4.1, 4.1);
    expect(bothMatch?.uid).toBe(flyer.uid);

    // Flyer outside hover radius falls back to ground enemy
    const groundOnly = world.findHoveredEnemy(2.1, 2.1, 10.0, 10.0);
    expect(groundOnly?.uid).toBe(ground.uid);

    // Out-of-radius miss returns null
    expect(world.findHoveredEnemy(2.0 + ground.radius + 0.6, 2.0, 10.0, 10.0)).toBeNull();

    // Deactivated enemies are ignored even at exact hit coords
    world.enemyPool.releaseAtActivePos(0);
    expect(world.findHoveredEnemy(ground.x, ground.z, 10.0, 10.0)).toBeNull();
    world.enemyPool.releaseAtActivePos(0);
    expect(world.findHoveredEnemy(ground.x, ground.z, flyer.x, flyer.z)).toBeNull();
  });

  it('computes MVP tower summary breaking damage ties by kills and returning null when empty', () => {
    const world = new SimWorld(LEVELS[0], new EventBus());
    world.gold = 1000;
    expect(world.getMvpTowerSummary()).toBeNull();

    const t1 = world.placeTower(4, 2, 'archer')!;
    const t2 = world.placeTower(4, 3, 'cannon')!;
    t1.totalDamageDealt = 250.4;
    t1.kills = 4;
    t2.totalDamageDealt = 250.4;
    t2.kills = 7;

    expect(world.getMvpTowerSummary()).toEqual({
      name: 'Cannon Bastion',
      type: 'cannon',
      tier: 1,
      damageDealt: 250,
      kills: 7,
    });

    t1.totalDamageDealt = 300.6;
    world.upgradeTower(t1.id);
    expect(world.getMvpTowerSummary()).toEqual({
      name: 'Archer Tower',
      type: 'archer',
      tier: 2,
      damageDealt: 301,
      kills: 4,
    });
  });

  it('resets pools, restores lives on debugSkipToWave, and guards debugForceWin/Lose idempotency', () => {
    const events = new EventBus();
    const world = new SimWorld(LEVELS[0], events);

    let wins = 0;
    let losses = 0;
    events.on('gameWon', () => wins++);
    events.on('gameLost', () => losses++);

    world.enemySystem.spawnEnemy('grunt');
    expect(world.enemyPool.getActiveCount()).toBe(1);

    world.debugForceLose();
    expect(world.outcome).toBe('lost');
    expect(world.lives).toBe(0);
    expect(losses).toBe(1);

    // Subsequent force win/lose calls while already ended do nothing
    world.debugForceWin();
    world.debugForceLose();
    expect(wins).toBe(0);
    expect(losses).toBe(1);

    // debugSkipToWave restores lives and clears pools
    expect(world.debugSkipToWave(3)).toBe(true);
    expect(world.outcome).toBe('ongoing');
    expect(world.lives).toBe(BALANCE.startingLives);
    expect(world.waveSystem.currentWaveOneBased).toBe(3);
    expect(world.enemyPool.getActiveCount()).toBe(0);

    // Clamp overly large wave number in story mode
    expect(world.debugSkipToWave(999)).toBe(true);
    expect(world.waveSystem.currentWaveOneBased).toBe(LEVELS[0].waves.length);

    world.debugForceWin();
    world.debugForceWin();
    expect(wins).toBe(1);
    expect(world.outcome).toBe('won');
  });
});

describe('sessionBridge pure state helpers', () => {
  it('builds HUD/ability state views, preserves cached preview identity, and steps debug spawn queue', () => {
    const world = new SimWorld(LEVELS[0], new EventBus());
    const loop = new GameLoop({ onFixedTick: () => {}, onRender: () => {} });

    const preWaveHud1 = buildHudStateView(world, loop, false);
    const preWaveHud2 = buildHudStateView(world, loop, true);
    expect(preWaveHud1.isPreFirstWave).toBe(true);
    expect(preWaveHud1.canStartWave).toBe(true);
    expect(preWaveHud1.nextPreview).toBe(preWaveHud2.nextPreview);
    expect(preWaveHud2.routesVisible).toBe(true);

    const preAb = buildAbilityBarState(world, null);
    expect(preAb.disabled).toBe(true);

    world.startNextWave();
    const wave1Hud = buildHudStateView(world, loop, false);
    expect(wave1Hud.isPreFirstWave).toBe(false);
    expect(wave1Hud.currentWave).toBe(1);
    expect(wave1Hud.nextPreview).not.toBe(preWaveHud1.nextPreview);

    const activeAb = buildAbilityBarState(world, 'meteor');
    expect(activeAb.disabled).toBe(false);
    expect(activeAb.activeAbility).toBe('meteor');

    const queue = [
      { type: 'grunt' as const, delay: 0.1 },
      { type: 'flyer' as const, delay: 0.3 },
    ];
    stepPendingSpawns(queue, world, 0.15);
    expect(world.enemyPool.getActiveCount()).toBe(1);
    expect(queue).toHaveLength(1);
    stepPendingSpawns(queue, world, 0.2);
    expect(world.enemyPool.getActiveCount()).toBe(2);
    expect(queue).toHaveLength(0);
  });

  it('chooses closest among overlapping same-layer enemies and handles invalid tower lookups/coords', () => {
    const world = new SimWorld(LEVELS[0], new EventBus());
    world.gold = 1000;

    // Two overlapping flyers within hover radius -> closer wins
    const farFlyer = world.enemySystem.spawnEnemy('flyer')!;
    farFlyer.x = 4.6;
    farFlyer.z = 4.0;
    const nearFlyer = world.enemySystem.spawnEnemy('flyer')!;
    nearFlyer.x = 4.15;
    nearFlyer.z = 4.0;

    // Two overlapping ground grunts within hover radius -> closer wins when no flyer matches
    const farGround = world.enemySystem.spawnEnemy('grunt')!;
    farGround.x = 2.45;
    farGround.z = 2.0;
    const nearGround = world.enemySystem.spawnEnemy('grunt')!;
    nearGround.x = 2.08;
    nearGround.z = 2.0;

    world.spatialHash.clear();
    world.spatialHash.insert(farFlyer.poolIndex, farFlyer.x, farFlyer.z);
    world.spatialHash.insert(nearFlyer.poolIndex, nearFlyer.x, nearFlyer.z);
    world.spatialHash.insert(farGround.poolIndex, farGround.x, farGround.z);
    world.spatialHash.insert(nearGround.poolIndex, nearGround.x, nearGround.z);

    expect(world.findHoveredEnemy(2.0, 2.0, 4.0, 4.0)?.uid).toBe(nearFlyer.uid);
    expect(world.findHoveredEnemy(2.0, 2.0, 12.0, 12.0)?.uid).toBe(nearGround.uid);

    // Unknown tower ID & negative/out-of-bounds coordinates
    expect(world.getTowerById(99999)).toBeNull();
    const goldBefore = world.gold;
    expect(world.placeTower(-1, 2, 'archer')).toBeNull();
    expect(world.placeTower(2, -1, 'archer')).toBeNull();
    expect(world.placeTower(world.grid.cols, 0, 'archer')).toBeNull();
    expect(world.placeTower(0, world.grid.rows, 'archer')).toBeNull();
    expect(world.gold).toBe(goldBefore);
    expect(world.towers).toHaveLength(0);
  });

  it('preserves buildHudStateView nextPreview object identity until wave state/endless flips', () => {
    const world = new SimWorld(LEVELS[0], new EventBus());
    const loop = new GameLoop();

    // Advance to final story wave ('spawning'/'allSpawned') where story nextPreview is null
    world.debugSkipToWave(LEVELS[0].waves.length);
    const storyView1 = buildHudStateView(world, loop, false);
    const storyView2 = buildHudStateView(world, loop, true);
    expect(storyView1.isEndless).toBe(false);
    expect(storyView1.nextPreview).toBeNull();
    expect(storyView2.nextPreview).toBe(storyView1.nextPreview);

    // Win story -> enter Endless -> cache invalidates via isEndless=1 and exposes next endless wave
    world.debugForceWin();
    expect(world.enterEndlessMode()).toBe(true);
    const endlessView1 = buildHudStateView(world, loop, false);
    const endlessView2 = buildHudStateView(world, loop, false);
    expect(endlessView1.isEndless).toBe(true);
    expect(endlessView1.nextPreview).not.toBeNull();
    expect(endlessView1.nextPreview?.waveOneBased).toBe(LEVELS[0].waves.length + 1);
    expect(endlessView2.nextPreview).toBe(endlessView1.nextPreview);
  });
});
