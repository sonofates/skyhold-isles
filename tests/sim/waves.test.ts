import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import type { EnemyType } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVELS, parseLevelGrid, type LevelDef } from '../../src/data/levels/index.ts';
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

  it('keeps linear HP scaling through wave 6 (w <= 5), compounds from wave 7+ (w >= 6), and continues seamlessly into endless mode', () => {
    const tenWaveLevel: LevelDef = {
      ...TEST_LEVEL,
      waves: Array.from({ length: 10 }, () => TEST_LEVEL.waves[0]),
    };
    const world = new SimWorld(tenWaveLevel, new EventBus());
    const base = tenWaveLevel.enemyHpScale ?? 1;
    const growth = tenWaveLevel.waveHpGrowth ?? 0;

    // Waves 1..6 (0-based indices 0..5) match exact linear formula
    for (let w = 0; w <= 5; w++) {
      world.debugSkipToWave(w + 1);
      expect(world.waveSystem.getCurrentWaveHpScale()).toBeCloseTo(base * (1 + w * growth), 8);
    }

    // Waves 7..10 (0-based indices 6..9) apply nonlinear late-wave compounding
    for (let w = 6; w < 10; w++) {
      world.debugSkipToWave(w + 1);
      expect(world.waveSystem.getCurrentWaveHpScale()).toBeCloseTo(
        base * (1 + w * growth) * Math.pow(1.032, w - 5),
        8,
      );
    }

    const finalStoryScale = world.waveSystem.getCurrentWaveHpScale();
    world.debugForceWin();
    expect(world.enterEndlessMode()).toBe(true);
    expect(world.startNextWave()).toBe(true);
    expect(world.waveSystem.getCurrentWaveHpScale()).toBeCloseTo(finalStoryScale * 1.22, 8);
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

    // Realistic anti-air + ground defense within Wave 13 economy (~2,100g)
    world.gold = 2130;
    const placements: Array<[number, number, 'archer' | 'frost' | 'tesla' | 'cannon' | 'mortar', 1 | 2 | 3]> = [
      [2, 3, 'archer', 2],
      [4, 3, 'archer', 2],
      [4, 5, 'frost', 2],
      [2, 5, 'cannon', 2],
      [5, 6, 'mortar', 3],
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

  it('validates grid dimensions, orthogonal non-overlapping paths, and build coords across all levels', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(9);
    const seenIds = new Set<string>();

    LEVELS.forEach((lvl, idx) => {
      expect(lvl.index).toBe(idx);
      expect(seenIds.has(lvl.id)).toBe(false);
      seenIds.add(lvl.id);

      expect(lvl.layout.length).toBe(lvl.rows);
      for (const rowStr of lvl.layout) {
        expect(rowStr.trim().split(/\s+/).length).toBe(lvl.cols);
      }

      const grid = parseLevelGrid(lvl);
      const spawns: Array<{ col: number; row: number }> = [];
      const goals: Array<{ col: number; row: number }> = [];
      const roadTiles = new Set<string>();

      for (let r = 0; r < lvl.rows; r++) {
        for (let c = 0; c < lvl.cols; c++) {
          const tile = grid[r][c];
          if (tile === 'spawn') spawns.push({ col: c, row: r });
          if (tile === 'goal') goals.push({ col: c, row: r });
          if (tile === 'path' || tile === 'spawn' || tile === 'goal') {
            roadTiles.add(`${c},${r}`);
          }
        }
      }

      // Main road plus optional extra spawn lanes that merge into it and share its goal.
      const lanes = [lvl.pathWaypoints, ...(lvl.extraGroundPaths ?? [])];
      const laneStart = (wps: typeof lvl.pathWaypoints): string => `${wps[0].col},${wps[0].row}`;
      expect(spawns.map((p) => `${p.col},${p.row}`).sort()).toEqual(lanes.map(laneStart).sort());
      expect(goals).toEqual([lvl.pathWaypoints[lvl.pathWaypoints.length - 1]]);

      const walked = new Set<string>();
      for (let li = 0; li < lanes.length; li++) {
        const wps = lanes[li];
        // A lane never revisits its own tiles; extra lanes may run on tiles of earlier lanes (merge).
        const laneWalked = new Set<string>();
        for (let i = 0; i < wps.length - 1; i++) {
          const a = wps[i];
          const b = wps[i + 1];
          const isOrtho = (a.col === b.col) !== (a.row === b.row);
          expect(isOrtho).toBe(true);

          const dc = Math.sign(b.col - a.col);
          const dr = Math.sign(b.row - a.row);
          let c = a.col;
          let r = a.row;
          while (true) {
            const key = `${c},${r}`;
            const isSegmentJoin = i > 0 && c === a.col && r === a.row;
            if (!isSegmentJoin) {
              expect(laneWalked.has(key)).toBe(false);
              laneWalked.add(key);
              walked.add(key);
            }
            const tile = grid[r]?.[c];
            if (i === 0 && c === a.col && r === a.row) {
              expect(tile).toBe('spawn');
            } else if (i === wps.length - 2 && c === b.col && r === b.row) {
              expect(tile).toBe('goal');
            } else {
              expect(tile).toBe('path');
            }
            if (c === b.col && r === b.row) break;
            c += dc;
            r += dr;
          }
        }
      }

      expect(walked.size).toBe(roadTiles.size);

      for (const order of [lvl.scriptedBuildOrder ?? [], lvl.weakBuildOrder ?? []]) {
        for (const step of order) {
          expect(grid[step.row]?.[step.col]).toBe('grass');
        }
      }
    });
  });
});

describe('auto-wave toggle', () => {
  function worldBetweenWaves(): SimWorld {
    const world = new SimWorld(LEVELS[0], new EventBus());
    const ws = world.waveSystem;
    ws.state = 'betweenWaves';
    ws.currentWaveIndex = 0;
    ws.interWaveTimer = BALANCE.interWaveCountdownSec;
    return world;
  }

  it('restores the manual countdown and early-call bonus when auto-wave is turned off', () => {
    const world = worldBetweenWaves();
    const ws = world.waveSystem;
    const fullBonus = ws.getEarlyCallBonus();

    world.setAutoWave(true);
    expect(ws.interWaveTimer).toBeCloseTo(0.75, 5);
    world.setAutoWave(false);
    expect(ws.interWaveTimer).toBeCloseTo(BALANCE.interWaveCountdownSec, 5);
    expect(ws.getEarlyCallBonus()).toBe(fullBonus);
  });

  it('accounts for time elapsed while auto-wave was on', () => {
    const world = worldBetweenWaves();
    const ws = world.waveSystem;
    world.setAutoWave(true);
    ws.interWaveTimer -= 0.25; // countdown ticked while auto was enabled
    world.setAutoWave(false);
    expect(ws.interWaveTimer).toBeCloseTo(BALANCE.interWaveCountdownSec - 0.25, 5);
  });

  it('gives a full manual countdown when auto is disabled after a wave cleared under auto', () => {
    const world = new SimWorld(LEVELS[0], new EventBus());
    const ws = world.waveSystem;
    world.setAutoWave(true);
    ws.state = 'clearing';
    ws.currentWaveIndex = 0;
    ws.checkCompletion(
      () => 0,
      () => {},
      () => {},
    );
    expect(ws.state).toBe('betweenWaves');
    expect(ws.interWaveTimer).toBeCloseTo(0.75, 5);
    world.setAutoWave(false);
    expect(ws.interWaveTimer).toBeCloseTo(BALANCE.interWaveCountdownSec, 5);
  });

  it('repeated toggles do not shorten the countdown permanently', () => {
    const world = worldBetweenWaves();
    const ws = world.waveSystem;
    for (let i = 0; i < 5; i++) {
      world.setAutoWave(true);
      world.setAutoWave(false);
    }
    expect(ws.interWaveTimer).toBeCloseTo(BALANCE.interWaveCountdownSec, 5);
  });
});
