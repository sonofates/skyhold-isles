import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { SimWorld } from '../../src/sim/world.ts';

describe('Node isolation & SimWorld headless execution', () => {
  it('imports SimWorld in plain Node and ticks 1000 times without DOM or Three.js', () => {
    const events = new EventBus();
    const world = new SimWorld(LEVELS[0], events);

    const spawned = world.enemySystem.spawnEnemy('grunt');
    expect(spawned).not.toBeNull();

    for (let i = 0; i < 1000; i++) {
      world.fixedTick(1 / 60);
    }

    // Grunt moves ~2.3 units/sec * 16.67s = ~38.3 units along 50-unit path, still active
    expect(world.enemyPool.getActiveCount()).toBe(1);
    expect(spawned!.dist).toBeGreaterThan(30);
    expect(world.lives).toBe(20);
  });
});
