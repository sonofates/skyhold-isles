import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import type { EnemyType } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVELS, type LevelDef } from '../../src/data/levels/index.ts';
import { buildWaveSpawnQueue, computeEarlyCallBonus } from '../../src/sim/waveSystem.ts';
import { computeStarRating, SimWorld } from '../../src/sim/world.ts';

const TEST_LEVEL: LevelDef = {
  id: 'test-level',
  index: 0,
  name: 'Test Isle',
  subtitle: 'Unit test isle',
  difficulty: 'Breezy',
  cols: 6,
  rows: 4,
  layout: [
    '~ . . . . ~',
    'S P P P P G',
    '~ . . . . ~',
    '~ ~ ~ ~ ~ ~',
  ],
  pathWaypoints: [
    { col: 0, row: 1 },
    { col: 5, row: 1 },
  ],
  flightPath: [
    { col: 0, row: 1 },
    { col: 5, row: 1 },
  ],
  decorationSeed: 42,
  startingGold: 300,
  enemyHpScale: 1.2,
  waveHpGrowth: 0.25,
  waves: [
    {
      clearBonus: 40,
      groups: [
        { enemyType: 'grunt', count: 3, spawnInterval: 1.0, startDelay: 0 },
        { enemyType: 'runner', count: 2, spawnInterval: 0.5, startDelay: 0.5 },
      ],
    },
    {
      clearBonus: 60,
      groups: [
        { enemyType: 'grunt', count: 1, spawnInterval: 1.0, startDelay: 0.5 },
        { enemyType: 'brute', count: 1, spawnInterval: 1.0, startDelay: 0.5 },
      ],
    },
  ],
};

describe('early-call bonus', () => {
  it('scales proportionally with remaining countdown timer and caps cleanly', () => {
    const maxSec = BALANCE.interWaveCountdownSec;
    const maxGold = BALANCE.earlyWaveBonusMaxGold;

    expect(computeEarlyCallBonus(maxSec)).toBe(maxGold);
    expect(computeEarlyCallBonus(maxSec * 2)).toBe(maxGold); // capped
    expect(computeEarlyCallBonus(maxSec * 0.75)).toBe(Math.round(0.75 * maxGold));
    expect(computeEarlyCallBonus(maxSec * 0.5)).toBe(Math.round(0.5 * maxGold));
    expect(computeEarlyCallBonus(maxSec * 0.25)).toBe(Math.round(0.25 * maxGold));
    expect(computeEarlyCallBonus(0.01)).toBe(1); // minimum positive 1g while timer > 0
    expect(computeEarlyCallBonus(0)).toBe(0);
    expect(computeEarlyCallBonus(-3)).toBe(0);

    // Calling while clearing current wave awards full early-call max
    expect(computeEarlyCallBonus(0, true)).toBe(maxGold);
  });

  it('awards 0 pre-first-wave, max during clearing, decaying gold between waves, and 0 on auto-start', () => {
    const world = new SimWorld(TEST_LEVEL, new EventBus());
    expect(world.waveSystem.getEarlyCallBonus()).toBe(0);

    const startGold = world.gold;
    expect(world.startNextWave()).toBe(true);
    expect(world.gold).toBe(startGold);
    expect(world.waveSystem.canStartNextWave()).toBe(false);

    // Tick past Wave 1 spawn duration (2.0s) into 'clearing'
    for (let i = 0; i < 130; i++) world.fixedTick(BALANCE.fixedDt);
    expect(world.waveSystem.state).toBe('clearing');
    expect(world.waveSystem.canStartNextWave()).toBe(true);
    expect(world.waveSystem.getEarlyCallBonus()).toBe(BALANCE.earlyWaveBonusMaxGold);

    // Kill remaining Wave 1 enemies -> moves to 'betweenWaves'
    for (let i = world.enemyPool.getActiveCount() - 1; i >= 0; i--) {
      const e = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
      world.enemySystem.applyDamage(e, 9999, true);
    }
    world.fixedTick(BALANCE.fixedDt);
    expect(world.waveSystem.state).toBe('betweenWaves');
    expect(world.gold).toBeGreaterThanOrEqual(startGold + 40);

    // Wait half the countdown (6.0s) -> bonus halves proportionally
    for (let i = 0; i < 360; i++) world.fixedTick(BALANCE.fixedDt);
    const halfBonus = world.waveSystem.getEarlyCallBonus();
    expect(halfBonus).toBeGreaterThanOrEqual(14);
    expect(halfBonus).toBeLessThanOrEqual(16);

    const goldBeforeCall = world.gold;
    expect(world.startNextWave()).toBe(true);
    expect(world.gold).toBe(goldBeforeCall + halfBonus);
  });
});

describe('wave spawn order and timing', () => {
  it('sorts interleaved groups chronologically and breaks exact timestamp ties by groupOrder', () => {
    // Wave 1: grunt @ 0, runner @ 0.5, grunt @ 1.0 & runner @ 1.0 (tie -> grunt first!), runner @ 1.5, grunt @ 2.0
    const q1 = buildWaveSpawnQueue(TEST_LEVEL, 0);
    expect(q1.map((q) => [q.enemyType, Number(q.spawnTime.toFixed(2))])).toEqual([
      ['grunt', 0],
      ['runner', 0.5],
      ['grunt', 1.0],
      ['runner', 1.0],
      ['grunt', 2.0],
    ]);

    // Wave 2 tie at t=0.5 between group 0 grunt & group 1 brute
    const q2 = buildWaveSpawnQueue(TEST_LEVEL, 1);
    expect(q2.map((q) => [q.enemyType, Number(q.spawnTime.toFixed(2))])).toEqual([
      ['grunt', 0.5],
      ['brute', 0.5],
    ]);

    expect(buildWaveSpawnQueue(TEST_LEVEL, -1)).toEqual([]);
    expect(buildWaveSpawnQueue(TEST_LEVEL, 99)).toEqual([]);
  });

  it('spawns enemies at exact elapsed wave timestamps with wave HP scaling and merges preview counts', () => {
    const events = new EventBus();
    const world = new SimWorld(TEST_LEVEL, events);

    expect(world.waveSystem.getNextWavePreview()).toEqual({
      waveOneBased: 1,
      items: [
        { enemyType: 'grunt', count: 3 },
        { enemyType: 'runner', count: 2 },
      ],
    });

    const spawnLog: Array<{ type: EnemyType; t: number; maxHp: number }> = [];
    const origSpawn = world.enemySystem.spawnEnemy.bind(world.enemySystem);
    world.enemySystem.spawnEnemy = (type, hpScale) => {
      const res = origSpawn(type, hpScale);
      if (res) {
        spawnLog.push({
          type,
          t: Number(world.waveSystem.waveElapsed.toFixed(2)),
          maxHp: res.maxHp,
        });
      }
      return res;
    };

    world.startNextWave();
    // Before 0.45s only t=0 grunt has spawned
    for (let i = 0; i < 24; i++) world.fixedTick(BALANCE.fixedDt); // 0.40s
    expect(spawnLog.map((s) => s.type)).toEqual(['grunt']);

    // Finish spawning Wave 1 (up to 2.2s total)
    for (let i = 0; i < 110; i++) world.fixedTick(BALANCE.fixedDt);
    expect(spawnLog.map((s) => s.type)).toEqual(['grunt', 'runner', 'grunt', 'runner', 'grunt']);
    // Wave 1 HP scale = 1.2
    expect(spawnLog[0].maxHp).toBe(Math.round(75 * 1.2));

    // Advance directly to Wave 2 and check Wave 2 HP scale = 1.2 * (1 + 1 * 0.25) = 1.5
    world.debugSkipToWave(2);
    expect(world.waveSystem.getNextWavePreview()).toBeNull();
    spawnLog.length = 0;
    for (let i = 0; i < 36; i++) world.fixedTick(BALANCE.fixedDt); // 0.6s > startDelay 0.5s
    expect(spawnLog.map((s) => s.type)).toEqual(['grunt', 'brute']);
    expect(spawnLog[1].maxHp).toBe(Math.round(260 * 1.5));

    // Kill Wave 2 enemies -> victory
    for (let i = world.enemyPool.getActiveCount() - 1; i >= 0; i--) {
      const e = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
      world.enemySystem.applyDamage(e, 9999, true);
    }
    world.fixedTick(BALANCE.fixedDt);
    world.fixedTick(BALANCE.fixedDt);
    expect(world.outcome).toBe('won');
    expect(computeStarRating(20)).toBe(3);
    expect(computeStarRating(12)).toBe(2);
    expect(computeStarRating(5)).toBe(1);
  });

  it('emits enemySpawned with flying=true when flyers spawn and reports flyer counts in wave preview', () => {
    const flyerLevel: LevelDef = {
      ...TEST_LEVEL,
      waves: [
        {
          clearBonus: 20,
          groups: [
            { enemyType: 'grunt', count: 2, spawnInterval: 0.5, startDelay: 0 },
            { enemyType: 'flyer', count: 4, spawnInterval: 0.4, startDelay: 0.25 },
          ],
        },
      ],
    };
    const events = new EventBus();
    const world = new SimWorld(flyerLevel, events);

    expect(world.waveSystem.getNextWavePreview()).toEqual({
      waveOneBased: 1,
      items: [
        { enemyType: 'grunt', count: 2 },
        { enemyType: 'flyer', count: 4 },
      ],
    });

    const spawned: Array<{ enemyType: EnemyType; flying: boolean }> = [];
    events.on('enemySpawned', (ev) => {
      spawned.push({ enemyType: ev.enemyType, flying: ev.flying });
    });

    world.startNextWave();
    for (let i = 0; i < 40; i++) world.fixedTick(BALANCE.fixedDt);
    expect(spawned.some((s) => s.enemyType === 'flyer' && s.flying)).toBe(true);
    expect(spawned.some((s) => s.enemyType === 'grunt' && !s.flying)).toBe(true);
  });

  it('gives flyers fair traversal time across Twin-Bridge Cay and stops W13 flyers under balanced defense', () => {
    for (const lvl of LEVELS) {
      const world = new SimWorld(lvl, new EventBus());
      const flightSec = world.flightPath.totalLength / ENEMY_DEFS.flyer.speed;
      // No level should allow sub-9s full-map aerial skips at 1x speed
      expect(flightSec).toBeGreaterThanOrEqual(9.5);
    }

    const level2 = LEVELS[1];
    const events = new EventBus();
    const world = new SimWorld(level2, events);
    expect(world.flightPath.totalLength).toBeGreaterThanOrEqual(38);

    // Realistic ~1,100g anti-air + support spend well within Wave 13 economy (~2,100g)
    world.gold = 2130;
    const placements: Array<[number, number, 'archer' | 'frost' | 'tesla' | 'cannon' | 'mortar', 1 | 2 | 3]> = [
      [2, 3, 'archer', 2],
      [4, 3, 'archer', 2],
      [4, 5, 'frost', 2],
      [2, 5, 'cannon', 2],
      [5, 6, 'mortar', 2],
      [9, 5, 'tesla', 2],
      [11, 5, 'cannon', 2],
      [10, 6, 'archer', 3],
      [11, 6, 'frost', 2],
      [3, 8, 'archer', 2],
    ];
    for (const [col, row, type, tier] of placements) {
      const tower = world.placeTower(col, row, type);
      expect(tower).not.toBeNull();
      if (tower && tier >= 2) world.upgradeTower(tower.id);
      if (tower && tier >= 3) world.upgradeTower(tower.id);
    }

    let flyerLeaks = 0;
    events.on('enemyLeaked', (ev) => {
      if (ev.enemyType === 'flyer') flyerLeaks += 1;
    });

    world.debugSkipToWave(13);
    for (let i = 0; i < 60 * 120; i++) {
      world.fixedTick(BALANCE.fixedDt);
      if (world.waveSystem.state !== 'spawning' && world.enemyPool.getActiveCount() === 0) break;
    }

    expect(flyerLeaks).toBe(0);
    expect(world.lives).toBe(20);
  });
});
