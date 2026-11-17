import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { SeededRng } from '../../src/core/rng.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { gridToWorldX, gridToWorldZ, MapGrid, worldToGridCoord } from '../../src/sim/grid.ts';
import { CompiledPath } from '../../src/sim/path.ts';
import { SpatialHashGrid } from '../../src/sim/spatialHash.ts';

describe('SeededRng', () => {
  it('is deterministic for a given seed and respects range, int, chance, and pick bounds', () => {
    const a = new SeededRng(123456);
    const b = new SeededRng(123456);
    for (let i = 0; i < 50; i++) {
      const va = a.next();
      const vb = b.next();
      expect(va).toBe(vb);
      expect(va).toBeGreaterThanOrEqual(0);
      expect(va).toBeLessThan(1);
    }

    for (let i = 0; i < 100; i++) {
      const r = a.range(-5, 10);
      expect(r).toBeGreaterThanOrEqual(-5);
      expect(r).toBeLessThan(10);

      const k = a.int(2, 6);
      expect(Number.isInteger(k)).toBe(true);
      expect(k).toBeGreaterThanOrEqual(2);
      expect(k).toBeLessThanOrEqual(6);
    }

    expect(a.chance(0)).toBe(false);
    expect(a.chance(1)).toBe(true);
    expect(['x', 'y', 'z']).toContain(a.pick(['x', 'y', 'z']));
  });

  it('stays deterministic and bounded for boundary seeds 0 and -1', () => {
    for (const seed of [0, -1]) {
      const r1 = new SeededRng(seed);
      const r2 = new SeededRng(seed);
      for (let i = 0; i < 20; i++) {
        const v1 = r1.next();
        const v2 = r2.next();
        expect(v1).toBe(v2);
        expect(v1).toBeGreaterThanOrEqual(0);
        expect(v1).toBeLessThan(1);

        const i1 = r1.int(-2, 4);
        const i2 = r2.int(-2, 4);
        expect(i1).toBe(i2);
        expect(i1).toBeGreaterThanOrEqual(-2);
        expect(i1).toBeLessThanOrEqual(4);
      }
      expect(r1.chance(0)).toBe(false);
      expect(r1.chance(1)).toBe(true);
    }

    expect(new SeededRng(0).next()).not.toBe(new SeededRng(-1).next());
  });
});

describe('EventBus', () => {
  it('subscribes, unsubscribes individual listeners, and clears all listeners', () => {
    const bus = new EventBus();
    const log: number[] = [];

    const unsub1 = bus.on('economyChanged', (ev) => log.push(ev.gold));
    const listener2 = (ev: { gold: number; lives: number }) => log.push(ev.gold * 10);
    bus.on('economyChanged', listener2);

    bus.emit('economyChanged', { gold: 5, lives: 20 });
    expect(log).toEqual([5, 50]);

    unsub1();
    unsub1(); // calling unsub twice must be a safe no-op and must not remove listener2
    bus.emit('economyChanged', { gold: 3, lives: 20 });
    expect(log).toEqual([5, 50, 30]);

    bus.clear();
    bus.emit('economyChanged', { gold: 9, lives: 20 });
    expect(log).toEqual([5, 50, 30]);
  });

  it('handles zero-listener emits and idempotent unsubscribe calls safely', () => {
    const bus = new EventBus();
    expect(() => bus.emit('waveCompleted', { waveIndex: 0 })).not.toThrow();

    const hits: number[] = [];
    const unsubA = bus.on('waveCompleted', (ev) => hits.push(ev.waveIndex));
    bus.on('waveCompleted', (ev) => hits.push(ev.waveIndex + 10));

    unsubA();
    // Second unsubscribe call must be a no-op and leave the remaining listener intact
    unsubA();

    bus.emit('waveCompleted', { waveIndex: 3 });
    expect(hits).toEqual([13]);

    bus.clear();
    bus.clear();
    bus.emit('waveCompleted', { waveIndex: 4 });
    expect(hits).toEqual([13]);
  });
});

describe('MapGrid and coordinate helpers', () => {
  it('maps grid <-> world coordinates symmetrically and guards out-of-bounds reads and writes', () => {
    const lvl = LEVELS[0];
    const grid = new MapGrid(lvl);

    for (let r = 0; r < lvl.rows; r++) {
      for (let c = 0; c < lvl.cols; c++) {
        const wx = gridToWorldX(c, lvl.cols);
        const wz = gridToWorldZ(r, lvl.rows);
        expect(worldToGridCoord(wx, wz, lvl.cols, lvl.rows)).toEqual({ col: c, row: r });
        expect(grid.worldToGrid(wx, wz)).toEqual({ col: c, row: r });
      }
    }

    expect(worldToGridCoord(-999, 0, lvl.cols, lvl.rows)).toBeNull();
    expect(worldToGridCoord(0, 999, lvl.cols, lvl.rows)).toBeNull();
    expect(grid.getTile(-1, 0)).toBe('empty');
    expect(grid.getTile(lvl.cols, 0)).toBe('empty');
    expect(grid.getTowerIdAt(-1, -1)).toBe(-1);
    expect(grid.canPlaceTower(-1, 0)).toBe(false);

    // Out-of-bounds setTowerAt/clearTowerAt are safe no-ops
    expect(() => grid.setTowerAt(-1, 0, 99)).not.toThrow();
    expect(() => grid.clearTowerAt(lvl.cols, lvl.rows)).not.toThrow();

    // resetOccupancy restores buildable grass occupancy
    grid.setTowerAt(4, 2, 10);
    expect(grid.getTowerIdAt(4, 2)).toBe(10);
    expect(grid.canPlaceTower(4, 2)).toBe(false);
    grid.resetOccupancy();
    expect(grid.getTowerIdAt(4, 2)).toBe(-1);
    expect(grid.canPlaceTower(4, 2)).toBe(true);
  });
});

describe('CompiledPath edge cases', () => {
  it('handles empty, single-point, clamped endpoints, and beveled corner sampling', () => {
    const out = { x: 0, y: 0, z: 0 };

    const empty = new CompiledPath([], 5, 5, 0, false);
    expect(empty.totalLength).toBe(0);
    expect(empty.sample(1, out)).toBe(0);
    expect(out).toEqual({ x: 0, y: 0, z: 0 });

    const single = new CompiledPath([{ col: 2, row: 2 }], 5, 5, 1.5, true);
    expect(single.totalLength).toBe(0);
    expect(single.sample(0, out)).toBe(0);
    expect(out).toEqual({ x: 0, y: 1.5, z: 0 });

    const bent = new CompiledPath(
      [
        { col: 0, row: 0 },
        { col: 2, row: 0 },
        { col: 2, row: 2 },
      ],
      5,
      5,
      BALANCE.tilePathTopY,
      true,
    );
    expect(bent.points.length).toBe(5); // start + 3 bevel points + end
    bent.sample(-5, out);
    expect(out.x).toBeCloseTo(bent.points[0].x, 6);
    expect(out.z).toBeCloseTo(bent.points[0].z, 6);

    const endYaw = bent.sample(999, out);
    const last = bent.points[bent.points.length - 1];
    expect(out.x).toBeCloseTo(last.x, 6);
    expect(out.z).toBeCloseTo(last.z, 6);
    expect(endYaw).toBeCloseTo(0, 5); // heading +Z down col 2
  });
});

describe('SpatialHashGrid', () => {
  it('queries local entities, clamps extreme coordinates safely, and clears cleanly', () => {
    const hash = new SpatialHashGrid(20, 20, 16);
    const out: number[] = [999];

    hash.insert(0, 0, 0);
    hash.insert(1, 0.5, 0.5);
    hash.insert(2, 12, 12);
    // Extreme coordinates outside nominal island bounds clamp into edge cells instead of throwing
    hash.insert(3, -500, -500);
    hash.insert(4, 500, 500);

    hash.query(0, 0, 1.5, out);
    expect(out.sort()).toEqual([0, 1]);

    hash.query(-500, -500, 0, out);
    expect(out).toEqual([3]);

    hash.query(500, 500, 0, out);
    expect(out).toEqual([4]);

    hash.clear();
    hash.query(0, 0, 50, out);
    expect(out).toEqual([]);

    // Re-inserting same indices after clear must not leave stale linked-list cycles
    hash.insert(0, 2, 2);
    hash.insert(1, 2, 2);
    hash.query(2, 2, 1, out);
    expect(out.sort()).toEqual([0, 1]);
  });

  it('clamps non-positive world dimensions to at least a 4x4 grid and handles negative query radii cleanly', () => {
    const zeroHash = new SpatialHashGrid(0, -10, 4);
    zeroHash.insert(0, -1e5, -1e5);
    zeroHash.insert(1, 0, 0);
    zeroHash.insert(2, 1e5, 1e5);

    const out: number[] = [42, 99];
    // Wide query gathers every clamped entity; negative radius never loops or leaks prior results
    zeroHash.query(0, 0, 1e6, out);
    expect(out.sort()).toEqual([0, 1, 2]);

    expect(() => zeroHash.query(0, 0, -5, out)).not.toThrow();
    expect(out).toEqual([]);

    // Small negative radius inside a single cell either returns the local bucket or empty cleanly
    expect(() => zeroHash.query(0, 0, -0.1, out)).not.toThrow();
    expect(out.every((idx) => idx >= 0 && idx < 4)).toBe(true);
  });
});
