import { describe, expect, it } from 'vitest';
import { RateCap, SlotPool } from '../../src/render2d/slotPool.ts';
import { fireProfile, FIRE_PROFILES } from '../../src/render2d/towerLayer.ts';
import { TOWER_TYPES } from '../../src/data/towers.ts';

describe('SlotPool (FX pooling counters)', () => {
  it('hands out distinct slots, counts spawned / active / peak, and drops when full', () => {
    const p = new SlotPool(3);
    const a = p.acquire();
    const b = p.acquire();
    const c = p.acquire();
    expect(new Set([a, b, c]).size).toBe(3);
    expect(p.acquire()).toBe(-1);
    expect(p.dropped).toBe(1);
    expect(p.active).toBe(3);
    expect(p.peak).toBe(3);
    p.release(b);
    expect(p.active).toBe(2);
    expect(p.acquire()).toBe(b);
    expect(p.spawned).toBe(4);
  });

  it('never double-frees and never allocates past capacity under churn', () => {
    const p = new SlotPool(8);
    const live: number[] = [];
    for (let i = 0; i < 1000; i++) {
      if (i % 3 !== 2) {
        const s = p.acquire();
        if (s >= 0) live.push(s);
      } else if (live.length > 0) {
        const s = live.shift()!;
        p.release(s);
        p.release(s); // second release is a no-op
      }
      expect(p.active).toBe(live.length);
      expect(p.active).toBeLessThanOrEqual(8);
      expect(p.freeCount + p.active).toBe(8);
    }
    expect(p.peak).toBeLessThanOrEqual(8);
    expect(p.spawned + p.dropped).toBeGreaterThan(600);
  });

  it('releaseAll frees everything and keeps the lifetime counters', () => {
    const p = new SlotPool(4);
    p.acquire();
    p.acquire();
    p.releaseAll();
    expect(p.active).toBe(0);
    expect(p.freeCount).toBe(4);
    expect(p.spawned).toBe(2);
  });
});

describe('RateCap (chatty events such as shieldAbsorb)', () => {
  it('allows the burst, then throttles to the rate, on the supplied clock', () => {
    const c = new RateCap(10, 3);
    let ok = 0;
    for (let i = 0; i < 100; i++) if (c.tryTake(0)) ok++; // 100 hits in the same instant
    expect(ok).toBe(3);
    expect(c.skipped).toBe(97);
    ok = 0;
    for (let i = 1; i <= 100; i++) if (c.tryTake(i * 0.01)) ok++; // 100 hits over 1 s
    expect(ok).toBeGreaterThanOrEqual(9);
    expect(ok).toBeLessThanOrEqual(11);
  });

  it('does not accumulate tokens while paused (dt = 0 clock)', () => {
    const c = new RateCap(5, 2);
    expect(c.tryTake(1)).toBe(true);
    expect(c.tryTake(1)).toBe(true);
    expect(c.tryTake(1)).toBe(false);
  });
});

describe('tower attack profiles', () => {
  it('every tower type has an attack animation; unknown types get a default', () => {
    for (const t of TOWER_TYPES) expect(FIRE_PROFILES[t], t).toBeDefined();
    expect(fireProfile('barracks').dur).toBeGreaterThan(0);
  });
});
