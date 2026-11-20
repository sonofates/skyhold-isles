import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { NEUTRAL_RUN_MODIFIERS } from '../../src/data/runModifiers.ts';
import { getLevelById, LEVEL_L1C, LEVELS_2D } from '../../src/data/levels2d/index.ts';
import l1cJson from '../../src/data/levels2d/l1c.json';
import {
  DEFAULT_PX_PER_UNIT,
  Level2DError,
  parseLevel2D,
  worldToImagePx,
  type Level2DJson,
} from '../../src/data/levels2d/loader.ts';
import type { EnemyEntity } from '../../src/sim/entities.ts';
import { acquireTarget } from '../../src/sim/targeting.ts';
import { getTowerTierStats } from '../../src/data/towers.ts';
import { SimWorld } from '../../src/sim/world.ts';
import { evaluateBalance, runLevelBalanceSim } from '../../scripts/balanceSim.ts';

const DT = BALANCE.fixedDt;

/** Small hand-made plot map: 1000x500 px, two entrances whose roads merge at (500, 250). */
const MINI_JSON: Level2DJson = {
  id: 'mini',
  image: 'mini',
  imageSize: [1000, 500],
  safeArea: [100, 0, 800, 500],
  entrances: [
    { id: 'A', x: 100, y: 100 },
    { id: 'B', x: 100, y: 400 },
  ],
  goal: [900, 250],
  paths: [
    [
      [100, 100],
      [500, 100],
      [500, 250],
      [900, 250],
    ],
    [
      [100, 400],
      [300, 250],
      [500, 250],
      [900, 250],
    ],
  ],
  plots: [
    [300, 180],
    [600, 330],
    [700, 180],
  ],
};

function miniLevel(): LevelDef {
  return {
    ...LEVEL_L1C,
    id: 'mini',
    layout2d: parseLevel2D(MINI_JSON),
    waves: [
      {
        clearBonus: 0,
        groups: [
          { enemyType: 'grunt', count: 1, spawnInterval: 1, startDelay: 0, lane: 0 },
          { enemyType: 'grunt', count: 1, spawnInterval: 1, startDelay: 0, lane: 1 },
        ],
      },
    ],
  };
}

function active(world: SimWorld): EnemyEntity[] {
  const out: EnemyEntity[] = [];
  for (let i = 0; i < world.enemyPool.getActiveCount(); i++) {
    out.push(world.enemyPool.items[world.enemyPool.getActiveIndex(i)]);
  }
  return out;
}

describe('balance report on the defeat tick', () => {
  it('counts both simultaneous crossings and attributes the last life to the first arrival', () => {
    const road = [MINI_JSON.paths[0][0], MINI_JSON.goal];
    const level: LevelDef = {
      ...miniLevel(),
      layout2d: parseLevel2D({ ...MINI_JSON, paths: [road, MINI_JSON.paths[1]], flightPath: road }),
      waves: [{ clearBonus: 0, groups: [
        { enemyType: 'grunt', count: 1, spawnInterval: 1, startDelay: 0 },
        { enemyType: 'flyer', count: 1, spawnInterval: 1, startDelay: 0 },
      ] }],
    };
    const run = runLevelBalanceSim(level, 'weak', [], { ...NEUTRAL_RUN_MODIFIERS, maxLives: 1 });
    expect(run.outcome).toBe('lost');
    expect(run.waves[0]).toMatchObject({
      livesLost: 1, leaksByType: { grunt: 1, flyer: 1 }, livesByType: { grunt: 1, flyer: 0 },
    });
  });

  it('charges a two-life hauler only the one life left after the preceding wave', () => {
    const level: LevelDef = {
      ...miniLevel(),
      waves: [
        { clearBonus: 0, groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 1, startDelay: 0 }] },
        { clearBonus: 0, groups: [{ enemyType: 'carrier', count: 1, spawnInterval: 1, startDelay: 0 }] },
      ],
    };
    const run = runLevelBalanceSim(level, 'weak', [], { ...NEUTRAL_RUN_MODIFIERS, maxLives: 2 });
    expect(run.finalLives).toBe(0);
    expect(run.waves).toMatchObject([
      { livesStart: 2, livesLost: 1, leaksByType: { grunt: 1 }, livesByType: { grunt: 1 } },
      { livesStart: 1, livesLost: 1, leaksByType: { carrier: 1 }, livesByType: { carrier: 1 } },
    ]);
  });
});

describe('balance report at story victory', () => {
  it('keeps every story figure when the final clear bonus funds purchases in Endless', () => {
    const level: LevelDef = {
      ...miniLevel(),
      startingGold: 200,
      waves: [{
        clearBonus: 400,
        groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 1, startDelay: 0 }],
      }],
    };
    const script = [
      { waveIndex: 0, action: 'build', col: 0, row: 0, towerType: 'archer' },
      { waveIndex: 0, action: 'upgrade', col: 0, row: 0 },
      { waveIndex: 0, action: 'upgrade', col: 0, row: 0 },
      { action: 'specialize', col: 0, row: 0, id: 'farwatch' },
      { action: 'buyAbility', col: 0, row: 0, id: 'throughshot' },
      { waveIndex: 0, action: 'build', col: 1, row: 0, towerType: 'cannon', targetingMode: 'strongest' },
      { waveIndex: 0, action: 'build', col: 1, row: 0, towerType: 'cannon' },
    ] as const;
    const story = runLevelBalanceSim(level, 'greedy', script);
    expect(story).toMatchObject({
      outcome: 'won', towersBuilt: 1, goldSpent: 200, unspentScriptActions: 4, towerPurchases: [],
    });
    const continued = runLevelBalanceSim(level, 'greedy', script, NEUTRAL_RUN_MODIFIERS, 2);
    expect(continued.endlessOutcome).toBe('lost');
    expect(continued.endlessReachedWave).toBeGreaterThan(level.waves.length);
    expect(continued.endlessPeakEnemies).toBeGreaterThan(0);
    expect(continued).toEqual({
      ...story,
      endlessReachedWave: continued.endlessReachedWave,
      endlessPeakEnemies: continued.endlessPeakEnemies,
      endlessOutcome: 'lost',
    });
  });
});

describe('2D level loader (px → world)', () => {
  it('maps image px to world units around the image centre', () => {
    const layout = parseLevel2D(MINI_JSON);
    expect(layout.pxPerUnit).toBe(DEFAULT_PX_PER_UNIT);
    // (100, 100) px → ((100 - 500) / 50, (100 - 250) / 50)
    expect(layout.entrances[0]).toMatchObject({ id: 'A', x: -8, z: -3 });
    expect(layout.goal).toEqual({ x: 8, z: 0 });
    expect(layout.plots[1]).toEqual({ x: 2, z: 1.6 });
    const back = worldToImagePx(layout, layout.plots[2].x, layout.plots[2].z);
    expect(back.px).toBeCloseTo(700, 9);
    expect(back.py).toBeCloseTo(180, 9);
  });

  it('honours a custom pxPerUnit and derives a flight path from entrance A to the goal', () => {
    const layout = parseLevel2D({ ...MINI_JSON, pxPerUnit: 100 });
    expect(layout.goal).toEqual({ x: 4, z: 0 });
    const fp = layout.flightPath;
    expect(fp[0]).toEqual(layout.paths[0][0]);
    expect(fp[fp.length - 1].x).toBeCloseTo(4, 9);
    expect(fp[fp.length - 1].z).toBeCloseTo(0, 9);
  });

  it('rejects gameplay outside the safe area and paths that miss the goal', () => {
    expect(() => parseLevel2D({ ...MINI_JSON, plots: [[50, 100]] })).toThrow(Level2DError);
    expect(() =>
      parseLevel2D({
        ...MINI_JSON,
        paths: [MINI_JSON.paths[0], [[100, 400], [800, 400]]],
      }),
    ).toThrow(/does not end at the goal/);
  });

  it('loads the shipped L1c trace (any image size) with everything inside its safe area', () => {
    const json = l1cJson as Level2DJson;
    const layout = LEVEL_L1C.layout2d!;
    expect(layout.imageSize).toEqual([json.imageSize[0], json.imageSize[1]]);
    expect(layout.plots).toHaveLength(json.plots.length);
    expect(layout.paths).toHaveLength(json.entrances.length);
    const [sx, sy, sw, sh] = layout.safeArea;
    for (const p of [...layout.plots, ...layout.paths.flat(), ...layout.flightPath]) {
      const { px, py } = worldToImagePx(layout, p.x, p.z);
      expect(px).toBeGreaterThanOrEqual(sx - 0.5);
      expect(px).toBeLessThanOrEqual(sx + sw + 0.5);
      expect(py).toBeGreaterThanOrEqual(sy - 0.5);
      expect(py).toBeLessThanOrEqual(sy + sh + 0.5);
    }
  });

  it('registers l1c by id without touching the campaign list', () => {
    expect(getLevelById('l1c')).toBe(LEVEL_L1C);
    expect(getLevelById(LEVELS[0].id)).toBe(LEVELS[0]);
    expect(LEVELS).toHaveLength(16);
    expect(LEVELS.some((l) => l.id === 'l1c')).toBe(false);
    expect(LEVELS_2D).toContain(LEVEL_L1C);
  });
});

describe('plot placement', () => {
  it('builds only on free plots, one tower per plot; selling frees the plot', () => {
    const world = new SimWorld(miniLevel(), new EventBus());
    world.gold = 10000;
    expect(world.grid.isPlotMode).toBe(true);
    expect(world.grid.plotCount).toBe(3);
    // Grid sites do not exist on plot maps.
    expect(world.placeTower(2, 3, 'archer')).toBeNull();
    expect(world.placeTowerOnPlot(3, 'archer')).toBeNull();
    expect(world.placeTowerOnPlot(-1, 'archer')).toBeNull();

    const t = world.placeTowerOnPlot(1, 'cannon')!;
    expect(t).not.toBeNull();
    expect(t.x).toBeCloseTo(2, 9);
    expect(t.z).toBeCloseTo(1.6, 9);
    expect(world.grid.getTowerIdAt(1, 0)).toBe(t.id);
    expect(world.grid.canPlaceTower(1, 0)).toBe(false);
    expect(world.placeTowerOnPlot(1, 'archer')).toBeNull();

    world.sellTower(t.id);
    expect(world.grid.getTowerIdAt(1, 0)).toBe(-1);
    expect(world.placeTowerOnPlot(1, 'archer')).not.toBeNull();
  });

  it('finds the plot under a tap within the plot radius', () => {
    const world = new SimWorld(miniLevel(), new EventBus());
    const p = world.level.layout2d!.plots[2];
    expect(world.grid.findPlotAt(p.x + 0.3, p.z - 0.2)).toBe(2);
    expect(world.grid.findPlotAt(0, -4)).toBe(-1);
  });

  it('still charges gold and refuses when broke', () => {
    const world = new SimWorld(miniLevel(), new EventBus());
    world.gold = getTowerTierStats('archer', 1).upgradeCost - 1;
    expect(world.placeTowerOnPlot(0, 'archer')).toBeNull();
    world.gold += 1;
    expect(world.placeTowerOnPlot(0, 'archer')).not.toBeNull();
    expect(world.gold).toBe(0);
  });
});

describe('polyline path following', () => {
  it('lane i spawns at entrance i and both lanes merge into the shared road to the goal', () => {
    const world = new SimWorld(miniLevel(), new EventBus());
    world.startNextWave();
    world.fixedTick(DT);
    const [a, b] = active(world).sort((x, y) => x.lane - y.lane);
    expect(a.lane).toBe(0);
    expect(b.lane).toBe(1);
    expect(a.x).toBeCloseTo(-8, 1);
    expect(a.z).toBeCloseTo(-3, 1);
    expect(b.x).toBeCloseTo(-8, 1);
    expect(b.z).toBeCloseTo(3, 1);

    // Run until both are past the merge point (500, 250) px = (0, 0) world: they then share the road.
    let mergedSeen = false;
    for (let i = 0; i < 60 * 30 && world.enemyPool.getActiveCount() === 2; i++) {
      world.fixedTick(DT);
      const [ea, eb] = active(world).sort((x, y) => x.lane - y.lane);
      if (ea && eb && ea.x > 1.5 && eb.x > 1.5) {
        expect(ea.z).toBeCloseTo(0, 1);
        expect(eb.z).toBeCloseTo(0, 1);
        mergedSeen = true;
      }
    }
    expect(mergedSeen).toBe(true);
    // Both reach the goal and leak.
    for (let i = 0; i < 60 * 30 && world.enemyPool.getActiveCount() > 0; i++) world.fixedTick(DT);
    expect(world.lives).toBe(BALANCE.startingLives - 2);
  });

  it('ranks enemies on different lanes by distance left to the goal ("first" targeting)', () => {
    const world = new SimWorld(miniLevel(), new EventBus());
    world.gold = 10000;
    const tower = world.placeTowerOnPlot(1, 'archer')!;
    const a = world.enemySystem.spawnEnemy('grunt', 1, false, 0)!;
    const b = world.enemySystem.spawnEnemy('grunt', 1, false, 1)!;
    const laneA = world.enemySystem.getPath(false, 0);
    const laneB = world.enemySystem.getPath(false, 1);
    // Put A 1.0 unit past the merge, B 1.5 units past it: B is closer to the goal.
    a.dist = laneA.nearestDist(0, 0) + 1.0;
    b.dist = laneB.nearestDist(0, 0) + 1.5;
    world.fixedTick(DT);
    const leftA = a.totalDist - a.dist;
    const leftB = b.totalDist - b.dist;
    expect(leftB).toBeLessThan(leftA);
    expect(a.dist + a.laneProgressOffset).toBeLessThan(b.dist + b.laneProgressOffset);
    const stats = getTowerTierStats('archer', 1);
    expect(acquireTarget(tower, stats, world.enemyPool, world.spatialHash)).toBe(b);
    tower.targetingMode = 'last';
    expect(acquireTarget(tower, stats, world.enemyPool, world.spatialHash)).toBe(a);
  });

  it('flyers take the flight path from entrance A to the goal', () => {
    const world = new SimWorld(miniLevel(), new EventBus());
    const f = world.enemySystem.spawnEnemy('flyer', 1, false, 1)!;
    expect(f.lane).toBe(0);
    world.fixedTick(DT);
    expect(f.x).toBeCloseTo(-8, 0);
    expect(f.y).toBeCloseTo(BALANCE.flyerHeight, 5);
    expect(f.totalDist).toBeGreaterThanOrEqual(Math.hypot(16, 3) - 1e-6);
  });
});

describe('l1c determinism and balance', () => {
  function run(): string {
    const world = new SimWorld(LEVEL_L1C, new EventBus());
    world.gold = 100000;
    const types = ['archer', 'cannon', 'tesla'] as const;
    for (let p = 0; p < world.grid.plotCount; p++) {
      const t = world.placeTowerOnPlot(p, types[p % 3])!;
      if (p % 2 === 0) world.upgradeTower(t.id);
    }
    world.startNextWave();
    for (let i = 0; i < 60 * 120 && world.outcome === 'ongoing'; i++) {
      if (world.waveSystem.state === 'betweenWaves') world.startNextWave();
      world.fixedTick(DT);
    }
    return JSON.stringify({
      gold: world.gold,
      lives: world.lives,
      wave: world.waveSystem.currentWaveIndex,
      towers: world.towers.map((t) => [t.id, t.kills, Math.round(t.totalDamageDealt * 1000), t.shotCount]),
    });
  }

  it('two runs produce identical results', () => {
    expect(run()).toBe(run());
  });

  it('greedy and weak scripts meet the balance windows', () => {
    const { summary, failures } = evaluateBalance(new Set(['l1c']), !!process.env.L1C_VERBOSE);
    if (process.env.L1C_VERBOSE) console.log(summary.join('\n'));
    expect(summary).toHaveLength(1);
    expect(failures).toEqual([]);
  });
});
