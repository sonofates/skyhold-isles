import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { bindEnemyArchetypeFx } from '../../src/render/enemyFx.ts';
import type { EffectsRenderer } from '../../src/render/effectsRenderer.ts';

function stubFx(): { fx: EffectsRenderer; calls: string[] } {
  const calls: string[] = [];
  const rec =
    (name: string) =>
    (): void => {
      calls.push(name);
    };
  const fx = {
    spawnPulseRing: rec('ring'),
    spawnParticles: rec('particles'),
    spawnDeathShards: rec('shards'),
    spawnStunSparks: rec('sparks'),
  } as unknown as EffectsRenderer;
  return { fx, calls };
}

describe('enemy archetype FX bindings', () => {
  it('reacts to every new-archetype event and unsubscribes cleanly', () => {
    const events = new EventBus();
    const { fx, calls } = stubFx();
    const shakes: number[] = [];
    const unsubs = bindEnemyArchetypeFx(events, fx, (s) => shakes.push(s));
    const p = { x: 1, y: 0, z: 2 };

    events.emit('wardPulse', { ...p, radius: 3, shieldedCount: 2 });
    events.emit('shieldBroken', { enemyId: 1, ...p });
    events.emit('enemyBurrow', { enemyId: 1, burrowed: true, ...p });
    events.emit('enemyBurrow', { enemyId: 1, burrowed: false, ...p });
    events.emit('enemyBlink', { enemyId: 1, fromX: 0, fromY: 0, fromZ: 0, toX: 4, toY: 0, toZ: 0 });
    events.emit('carrierDrop', { ...p, groundX: 1, groundY: 0, groundZ: 2, count: 2 });
    events.emit('armorCracked', { enemyId: 1, ...p });
    events.emit('bossPhase', { enemyId: 1, enemyType: 'tempest', phase: 1, ...p, radius: 5 });
    events.emit('bossPhase', { enemyId: 1, enemyType: 'tempest', phase: 2, ...p, radius: 7 });
    events.emit('enemyKilled', { enemyId: 1, enemyType: 'tempest', reward: 50, ...p });
    events.emit('enemyKilled', { enemyId: 2, enemyType: 'grunt', reward: 4, ...p });

    expect(calls.length).toBeGreaterThanOrEqual(20);
    expect(calls).toContain('sparks');
    expect(calls.filter((c) => c === 'shards').length).toBe(3); // golem crack + 2 for tempest death
    expect(shakes).toEqual([0.6, 0.6, 1.2]);

    for (const u of unsubs) u();
    const before = calls.length;
    events.emit('wardPulse', { ...p, radius: 3, shieldedCount: 2 });
    events.emit('enemyKilled', { enemyId: 3, enemyType: 'tempest', reward: 50, ...p });
    expect(calls.length).toBe(before);
  });
});
