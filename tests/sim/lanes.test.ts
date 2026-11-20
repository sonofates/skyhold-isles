import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import type { GridCoord } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS, parseLevelGrid, type LevelDef } from '../../src/data/levels/index.ts';
import type { EnemyEntity } from '../../src/sim/entities.ts';
import { SimWorld } from '../../src/sim/world.ts';
import { runLevelBalanceSim } from '../../scripts/balanceSim.ts';
import { getTowerTierStats } from '../../src/data/towers.ts';
import { acquireTarget } from '../../src/sim/targeting.ts';

const DT = BALANCE.fixedDt;

/** 9x9 test island: main road west→east on row 4, a northern lane merging at (4,4). */
const TWO_LANE_LEVEL: LevelDef = {
  ...LEVELS[0],
  id: 'test-two-lane',
  cols: 9,
  rows: 9,
  layout: [
    '. . . . S . . . .',
    '. . . . P . . . .',
    '. . . . P . . . .',
    '. . . . P . . . .',
    'S P P P P P P P G',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
  ],
  pathWaypoints: [
    { col: 0, row: 4 },
    { col: 8, row: 4 },
  ],
  extraGroundPaths: [
    [
      { col: 4, row: 0 },
      { col: 4, row: 4 },
      { col: 8, row: 4 },
    ],
  ],
  flightPath: [
    { col: 4, row: 8 },
    { col: 8, row: 4 },
  ],
  waves: [
    {
      clearBonus: 0,
      groups: [
        { enemyType: 'grunt', count: 1, spawnInterval: 1, startDelay: 0 },
        { enemyType: 'grunt', count: 1, spawnInterval: 1, startDelay: 0, lane: 1 },
        { enemyType: 'flyer', count: 1, spawnInterval: 1, startDelay: 0, lane: 1 },
      ],
    },
  ],
};

function active(world: SimWorld): EnemyEntity[] {
  const out: EnemyEntity[] = [];
  for (let i = 0; i < world.enemyPool.getActiveCount(); i++) {
    out.push(world.enemyPool.items[world.enemyPool.getActiveIndex(i)]);
  }
  return out;
}

describe('extra ground lanes', () => {
  it('spawns lane groups on their own road; flyers ignore lanes', () => {
    const world = new SimWorld(TWO_LANE_LEVEL, new EventBus());
    expect(world.enemySystem.groundLaneCount).toBe(2);
    world.startNextWave();
    world.fixedTick(DT);
    const [main, side, flyer] = active(world).sort((a, b) => a.uid - b.uid);
    expect(main.lane).toBe(0);
    expect(side.lane).toBe(1);
    expect(flyer.lane).toBe(0);
    expect(flyer.flying).toBe(true);
    // Main road runs along row 4 (z constant); the side lane starts north, running along x = col 4.
    expect(side.x).toBeCloseTo(world.grid.gridToWorldX(4), 1);
    expect(side.z).toBeLessThan(main.z - 4);
    expect(side.totalDist).toBeCloseTo(world.extraGroundPaths[0].totalLength, 5);
  });

  it('lane enemies follow their lane to the shared goal and leak there', () => {
    const world = new SimWorld(TWO_LANE_LEVEL, new EventBus());
    const e = world.enemySystem.spawnEnemy('runner', 1, false, 1)!;
    const leaks: number[] = [];
    for (let i = 0; i < 60 * 20 && leaks.length === 0; i++) {
      world.enemySystem.update(DT, (l) => leaks.push(l.uid), () => {});
    }
    expect(leaks).toEqual([e.uid]);
    expect(e.x).toBeCloseTo(world.grid.gridToWorldX(8), 1);
  });

  it('out-of-range lanes fall back to the main road; split hatchlings keep the parent lane', () => {
    const world = new SimWorld(TWO_LANE_LEVEL, new EventBus());
    expect(world.enemySystem.spawnEnemy('grunt', 1, false, 7)!.lane).toBe(0);
    const s = world.enemySystem.spawnEnemy('splitter', 1, false, 1)!;
    for (let i = 0; i < 30; i++) world.enemySystem.update(DT, () => {}, () => {});
    world.enemySystem.applyDamage(s, 9999, true);
    world.enemySystem.update(DT, () => {}, () => {});
    const kids = active(world).filter((e) => e.isSplitChild);
    expect(kids).toHaveLength(2);
    for (const k of kids) expect(k.lane).toBe(1);
  });

  it('registers each same-tick hauler drop at the front raider on its nearest road', () => {
    const events = new EventBus();
    const world = new SimWorld(TWO_LANE_LEVEL, events);
    const main = world.enemySystem.spawnEnemy('carrier')!;
    const north = world.enemySystem.spawnEnemy('carrier')!;
    main.x = world.grid.gridToWorldX(2);
    main.z = world.grid.gridToWorldZ(4) + 0.2;
    north.x = world.grid.gridToWorldX(4) + 0.2;
    north.z = world.grid.gridToWorldZ(1);
    // A raider can immediately reuse the wreck's pool slot.
    const mainWreckX = main.x;
    const seen = new Set<number>();
    const lanes: number[] = [];
    events.on('carrierDrop', drop => {
      const pair = active(world).filter(e => e.isDropped && !seen.has(e.uid)).sort((a, b) => b.dist - a.dist);
      expect(pair).toHaveLength(2);
      expect(drop.count).toBe(pair.length);
      const [front, rear] = pair;
      const lane = drop.x === mainWreckX ? 0 : 1;
      lanes.push(lane);
      expect([front.lane, rear.lane]).toEqual([lane, lane]);
      expect([drop.groundX, drop.groundZ]).toEqual([front.x, front.z]);
      expect(front.dist - rear.dist).toBeCloseTo(0.45);
      for (const raider of pair) seen.add(raider.uid);
    });
    world.enemySystem.applyDamage(main, 99999, true);
    world.enemySystem.applyDamage(north, 99999, true);
    world.enemySystem.update(DT, () => {}, () => {});
    expect(lanes.sort()).toEqual([0, 1]);
  });
});

function cellsAlong(wps: readonly GridCoord[]): GridCoord[] {
  const out: GridCoord[] = [wps[0]];
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    const sc = Math.sign(b.col - a.col);
    const sr = Math.sign(b.row - a.row);
    let c = a.col;
    let r = a.row;
    while (c !== b.col || r !== b.row) {
      c += sc;
      r += sr;
      out.push({ col: c, row: r });
    }
  }
  return out;
}

describe('level layouts (all islands)', () => {
  for (const level of LEVELS) {
    it(`${level.name}: every ground lane is axis-aligned, on road tiles, spawn → shared goal`, () => {
      const grid = parseLevelGrid(level);
      expect(grid).toHaveLength(level.rows);
      const lanes = [level.pathWaypoints, ...(level.extraGroundPaths ?? [])];
      const goal = level.pathWaypoints[level.pathWaypoints.length - 1];
      expect(grid[goal.row][goal.col]).toBe('goal');
      for (const lane of lanes) {
        for (let i = 0; i < lane.length - 1; i++) {
          const a = lane[i];
          const b = lane[i + 1];
          expect(a.col === b.col || a.row === b.row).toBe(true);
        }
        const start = lane[0];
        expect(grid[start.row][start.col]).toBe('spawn');
        const end = lane[lane.length - 1];
        expect(end).toEqual(goal);
        for (const cell of cellsAlong(lane)) {
          expect(['path', 'spawn', 'goal']).toContain(grid[cell.row][cell.col]);
        }
      }
      for (const wp of level.flightPath) {
        expect(wp.col).toBeGreaterThanOrEqual(0);
        expect(wp.col).toBeLessThan(level.cols);
        expect(wp.row).toBeGreaterThanOrEqual(0);
        expect(wp.row).toBeLessThan(level.rows);
      }
      // Wave groups only reference lanes that exist.
      for (const wave of level.waves) {
        for (const g of wave.groups) {
          expect(g.lane ?? 0).toBeLessThan(lanes.length);
        }
      }
    });
  }
});

describe('determinism with new archetypes', () => {
  it('replays Confluence Terraces (lanes, wardens, burrowers, mites, elites, boss) identically', { timeout: 20_000 }, () => {
    const level = LEVELS.find((l) => l.id === 'confluence-terraces')!;
    expect(level).toBeDefined();
    const a = runLevelBalanceSim(level, 'greedy', level.scriptedBuildOrder ?? []);
    const b = runLevelBalanceSim(level, 'greedy', level.scriptedBuildOrder ?? []);
    expect(b).toEqual(a);
    expect(a.outcome).toBe('won');
  });
});

describe('targeting across lanes of different length', () => {
  it('"first" prefers the enemy closest to the shared goal, "last" the farthest', () => {
    const level = LEVELS.find((l) => l.id === 'stormcrown-citadel')!;
    const world = new SimWorld(level, new EventBus());
    const main = world.enemySystem.spawnEnemy('grunt', 1, false, 0)!;
    const side = world.enemySystem.spawnEnemy('grunt', 1, false, 1)!;
    expect(Math.abs(main.totalDist - side.totalDist)).toBeGreaterThan(20);
    // Both on the shared final stretch: the side-lane grunt is 5 from the goal, the main one 10.
    main.dist = main.totalDist - 10;
    side.dist = side.totalDist - 5;
    world.enemySystem.update(DT, () => {}, () => {});
    // By raw per-lane fraction the main-lane grunt would look further along.
    expect(main.dist / main.totalDist).toBeGreaterThan(side.dist / side.totalDist);

    world.gold = 1e6;
    let tower = null;
    for (let r = 0; r < level.rows && !tower; r++) {
      for (let c = 0; c < level.cols && !tower; c++) {
        if (!world.grid.canPlaceTower(c, r)) continue;
        const x = world.grid.gridToWorldX(c);
        const z = world.grid.gridToWorldZ(r);
        const reach = (e: { x: number; z: number }): number => Math.hypot(e.x - x, e.z - z);
        if (reach(main) < 5 && reach(side) < 5) tower = world.placeTower(c, r, 'archer', 'first');
      }
    }
    expect(tower).not.toBeNull();
    const stats = getTowerTierStats('archer', 1);
    expect(acquireTarget(tower!, stats, world.enemyPool, world.spatialHash)).toBe(side);
    tower!.targetingMode = 'last';
    expect(acquireTarget(tower!, stats, world.enemyPool, world.spatialHash)).toBe(main);
    // Equal HP: "strongest" breaks the tie toward the goal, lane-aware as well.
    expect(main.hp).toBe(side.hp);
    tower!.targetingMode = 'strongest';
    expect(acquireTarget(tower!, stats, world.enemyPool, world.spatialHash)).toBe(side);
  });
});
