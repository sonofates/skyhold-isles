import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { bindHaptics, HAPTIC_PATTERNS, Haptics } from '../../src/platform/haptics.ts';

function rig(): { h: Haptics; calls: Array<number | number[]>; clock: { t: number } } {
  const calls: Array<number | number[]> = [];
  const clock = { t: 1000 };
  const h = new Haptics((p) => {
    calls.push(p);
    return true;
  }, () => clock.t);
  return { h, calls, clock };
}

describe('Haptics', () => {
  it('vibrates with the pattern of the kind', () => {
    const { h, calls } = rig();
    expect(h.pulse('place')).toBe(true);
    expect(calls).toEqual([HAPTIC_PATTERNS.place]);
  });

  it('is silent when disabled or unsupported', () => {
    const { h, calls } = rig();
    h.setEnabled(false);
    expect(h.pulse('place')).toBe(false);
    expect(calls).toEqual([]);
    const none = new Haptics(null);
    expect(none.supported).toBe(false);
    expect(none.pulse('place')).toBe(false);
  });

  it('rate-limits repeated pulses of one kind but not different kinds', () => {
    const { h, calls, clock } = rig();
    expect(h.pulse('leak')).toBe(true);
    clock.t += 100;
    expect(h.pulse('leak')).toBe(false);
    expect(h.pulse('place')).toBe(true);
    clock.t += 500;
    expect(h.pulse('leak')).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('survives a throwing vibrate implementation', () => {
    const h = new Haptics(() => {
      throw new Error('blocked');
    });
    expect(h.pulse('tap')).toBe(false);
  });

  it('survives NaN and rolled-back clock values without breaking rate limiting', () => {
    const { h, calls, clock } = rig();
    clock.t = NaN;
    expect(h.pulse('leak')).toBe(true);
    // Same effective 0ms timestamp is rate-limited instead of poisoned by NaN.
    expect(h.pulse('leak')).toBe(false);

    clock.t = 5000;
    expect(h.pulse('leak')).toBe(true);
    // Clock rollback (e.g. context reset) still allows a fresh pulse instead of muting for 5000ms.
    clock.t = 100;
    expect(h.pulse('leak')).toBe(true);
    expect(clock.t += 100).toBe(200);
    expect(h.pulse('leak')).toBe(false);
    expect(calls).toHaveLength(3);
  });
});

describe('bindHaptics', () => {
  it('buzzes for build / upgrade / sell / leak and stops after unsubscribe', () => {
    const { h, calls, clock } = rig();
    const bus = new EventBus();
    const off = bindHaptics(bus, h);
    bus.emit('towerBuilt', { towerId: 1, type: 'archer', tier: 1, x: 0, z: 0 });
    clock.t += 1000;
    bus.emit('towerUpgraded', { towerId: 1, type: 'archer', tier: 2, x: 0, z: 0 });
    clock.t += 1000;
    bus.emit('towerSold', { towerId: 1, type: 'archer', tier: 2, refund: 10, x: 0, z: 0 });
    expect(calls).toEqual([HAPTIC_PATTERNS.place, HAPTIC_PATTERNS.upgrade, HAPTIC_PATTERNS.sell]);
    off();
    clock.t += 1000;
    bus.emit('towerBuilt', { towerId: 2, type: 'archer', tier: 1, x: 0, z: 0 });
    expect(calls).toHaveLength(3);
  });
});
