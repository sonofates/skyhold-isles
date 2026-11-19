import { describe, expect, it, vi } from 'vitest';
import type { EnemyType } from '../../src/core/types.ts';
import type { EnemyEntity } from '../../src/sim/entities.ts';
import { evaluateBalance, evaluateWorkshopMax } from '../../scripts/balanceSim.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { CHAPTER_ENEMY_DEFS, type ChapterEnemyType } from '../../src/data/enemies.ts';
import { I16 } from '../../src/data/levels2d/i16.ts';
import { SimWorld } from '../../src/sim/world.ts';

// Exercise real IDs, spawn, movement, hit resolution and pool reuse while shared registration is pending.
vi.mock(import('../../src/data/enemies.ts'), async (original) => {
  const data = await original();
  return { ...data, ENEMY_DEFS: { ...data.ENEMY_DEFS, ...data.CHAPTER_ENEMY_DEFS } };
});
vi.mock(import('../../src/data/soldiers.ts'), async (original) => {
  const data = await original();
  const { CHAPTER_ENEMY_MELEE } = await import('../../src/data/enemies.ts');
  return { ...data, ENEMY_MELEE: { ...data.ENEMY_MELEE, ...CHAPTER_ENEMY_MELEE } };
});

const dt = BALANCE.fixedDt;
const noop = () => {};
function fixture() {
  const world = new SimWorld(I16, new EventBus());
  const sim = world.enemySystem;
  const tick = (frames = 1) => {
    for (let i = 0; i < frames; i++) sim.update(dt, noop, noop);
  };
  // The test roster above extends the public spawn signature for this isolated world.
  const spawn = sim.spawnEnemy.bind(sim) as (
    type: EnemyType | ChapterEnemyType, hpScale?: number, elite?: boolean, lane?: number,
  ) => EnemyEntity;
  return { sim, tick, spawn };
}

describe('chapter two enemy decisions', () => {
  it('a hare accelerates only on an open road and keeps the run speed modifier', () => {
    const { sim, tick, spawn } = fixture();
    sim.speedMul = 1.2;
    const hare = spawn('bellrunner');
    const ability = CHAPTER_ENEMY_DEFS.bellrunner.ability;
    tick(160);
    const full = hare.dist;
    tick();
    expect((hare.dist - full) / dt).toBeCloseTo(hare.speed * (1 + ability.speedBonus));
    for (const blocker of ['blockers', 'heroBlockers'] as const) {
      hare[blocker] = 1;
      const held = hare.dist;
      tick();
      expect(hare.dist).toBe(held);
      expect(hare.abilityTimer).toBe(0);
      hare[blocker] = 0;
      tick();
      expect((hare.dist - held) / dt).toBeLessThan(hare.speed * 1.02);
      tick(30);
    }
    sim.applySlow(hare, 0.45, 1);
    tick(30);
    expect(hare.abilityTimer).toBe(0);
    tick(40);
    expect(hare.abilityTimer).toBeGreaterThan(0);
    expect(hare.abilityTimer).toBeLessThan(0.25);
  });

  it('a shell chips after the strike, ignores shield-only hits and restores elite and challenge armor', () => {
    const { sim, tick, spawn } = fixture();
    sim.armorBonus = 2;
    const shell = spawn('kilnback', 2, true);
    const initial = shell.baseArmor;
    shell.shield = 50;
    expect(sim.applyDamage(shell, 20).actualDamage).toBe(0);
    expect(shell.armor).toBe(initial);
    shell.shield = 0;
    expect(sim.applyDamage(shell, 20).actualDamage).toBe(20 - initial);
    expect(sim.applyDamage(shell, 20).actualDamage).toBe(20 - initial + 3);
    tick(65);
    sim.applyDamage(shell, 14, true);
    tick(40);
    expect(shell.armor).toBe(initial - 9);
    for (let i = 0; i < 4; i++) sim.applyDamage(shell, 20);
    expect(shell.armor).toBe(0);
    tick(90);
    expect(shell.armor).toBe(initial);
    expect(shell.armorBreakTimer).toBe(0);
  });

  it('the last flute note clears only slowed ground units in range', () => {
    const { sim, tick, spawn } = fixture();
    const piper = spawn('reedpiper');
    const grunt = spawn('grunt');
    const far = spawn('grunt', 1, false, 1);
    const air = spawn('flyer');
    for (const foe of [piper, grunt, far, air]) sim.applySlow(foe, 0.6, 20);
    piper.abilityTimer = dt;
    tick();
    const start = piper.dist;
    tick(48);
    expect(piper.dist).toBe(start);
    expect(grunt.slowTimer).toBeGreaterThan(0);
    tick(5);
    expect(piper.dist).toBeGreaterThan(start);
    expect(piper.slowTimer).toBe(0);
    expect(grunt.slowRatio).toBe(0);
    expect(far.slowTimer).toBeGreaterThan(0);
    expect(air.slowTimer).toBeGreaterThan(0);
  });

  it('stun or death during a phrase prevents the cleanse and a reused slot has no pending note', () => {
    const { sim, tick, spawn } = fixture();
    const piper = spawn('reedpiper');
    const grunt = spawn('grunt');
    sim.applySlow(grunt, 0.5, 12);
    piper.abilityTimer = dt;
    tick(20);
    sim.applyStun(piper, 0.6);
    expect(piper.channelTimer).toBe(0);
    tick(80);
    expect(piper.abilityTimer).toBeGreaterThan(2);
    expect(grunt.slowRatio).toBeGreaterThan(0);
    piper.abilityTimer = dt;
    tick();
    expect(piper.channelTimer).toBeGreaterThan(0);
    sim.applyDamage(piper, 1000, true);
    tick();
    const next = spawn('kilnback');
    expect(next.poolIndex).toBe(piper.poolIndex);
    expect(next.channelTimer).toBe(0);
    tick(60);
    expect(grunt.slowRatio).toBeGreaterThan(0);
  });

  it('moths trade the lead along the sky lane, then coast back to cruise when separated', () => {
    function fly(reverse: boolean) {
      const { sim, tick, spawn } = fixture();
      const first = spawn('draftwing');
      const second = spawn('draftwing');
      const [leader, follower] = reverse ? [second, first] : [first, second];
      leader.dist = 2.2;
      tick();
      expect(leader.abilityTimer).toBe(0);
      expect(follower.abilityTimer).toBeGreaterThan(0);
      tick(150);
      expect(leader.abilityTimer).toBeGreaterThan(0);
      const distances = [leader.dist, follower.dist];
      // Neither an ordinary flyer nor a dead moth supplies a wake.
      const flyer = spawn('flyer');
      flyer.dist = leader.dist + 1;
      sim.applyDamage(follower, 500);
      tick(90);
      expect(leader.abilityTimer).toBe(0);
      const before = leader.dist;
      tick();
      expect(leader.dist - before).toBeCloseTo(leader.speed * dt);
      return distances;
    }
    expect(fly(false)).toEqual(fly(true));
  });

  it('a moth outside the wake or abreast of its partner cruises at normal speed', () => {
    const { tick, spawn } = fixture();
    const a = spawn('draftwing');
    const b = spawn('draftwing');
    tick(4);
    expect(a.abilityTimer + b.abilityTimer).toBe(0);
    b.dist += 4;
    tick(20);
    expect(a.abilityTimer + b.abilityTimer).toBe(0);
  });
});

describe('chapter two balance', () => {
  it.each(['i17', 'i18', 'i19', 'i20'])('%s meets the release simulator targets with the staged roster and a maxed Workshop', id => {
    const ids = new Set([id]);
    const base = evaluateBalance(ids, false);
    expect(base.summary).toHaveLength(ids.size);
    expect(base.failures).toEqual([]);
    expect(evaluateWorkshopMax(ids).failures).toEqual([]);
  });
});
