import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS, type LevelDef } from '../../src/data/levels/index.ts';
import { WaveSystem } from '../../src/sim/waveSystem.ts';
import { computeStarRating, SimWorld } from '../../src/sim/world.ts';

describe('WaveSystem & SimWorld boundary edge cases', () => {
  it('handles skipToWave clamping, empty-wave guards, and endless unbounded skips', () => {
    const emptyLevel: LevelDef = { ...LEVELS[0], waves: [] };
    const emptyWs = new WaveSystem(emptyLevel, new EventBus());
    expect(emptyWs.skipToWave(1)).toBe(false);

    const world = new SimWorld(LEVELS[0], new EventBus());
    expect(world.debugSkipToWave(0)).toBe(true);
    expect(world.waveSystem.currentWaveOneBased).toBe(1);
    expect(world.debugSkipToWave(-10)).toBe(true);
    expect(world.waveSystem.currentWaveOneBased).toBe(1);

    // Story mode clamps above waves.length
    expect(world.debugSkipToWave(500)).toBe(true);
    expect(world.waveSystem.currentWaveOneBased).toBe(LEVELS[0].waves.length);

    // Endless mode allows jumping far beyond story wave count
    world.debugForceWin();
    expect(world.enterEndlessMode()).toBe(true);
    expect(world.debugSkipToWave(25)).toBe(true);
    expect(world.waveSystem.currentWaveOneBased).toBe(25);
    expect(world.waveSystem.totalWaves).toBe(25);
  });

  it('auto-starts next wave with zero early bonus when betweenWaves countdown expires', () => {
    const events = new EventBus();
    const world = new SimWorld(LEVELS[0], events);
    const startedWaves: Array<{ waveIndex: number; earlyBonus: number }> = [];
    events.on('waveStarted', (ev) => {
      startedWaves.push({ waveIndex: ev.waveIndex, earlyBonus: ev.earlyBonus });
    });

    world.waveSystem.state = 'betweenWaves';
    world.waveSystem.currentWaveIndex = 0;
    world.waveSystem.interWaveTimer = 0.05;
    const goldBefore = world.gold;

    world.fixedTick(0.05);
    expect(world.waveSystem.state).toBe('spawning');
    expect(world.waveSystem.currentWaveOneBased).toBe(2);
    expect(startedWaves).toEqual([{ waveIndex: 1, earlyBonus: 0 }]);
    expect(world.gold).toBe(goldBefore);
  });

  it('ignores applyDamage and applySlow on inactive enemies and clears slow on exact slowTimer expiry', () => {
    const world = new SimWorld(LEVELS[0], new EventBus());
    const grunt = world.enemySystem.spawnEnemy('grunt')!;
    world.enemyPool.releaseAtActivePos(0);
    expect(grunt.active).toBe(false);

    expect(world.enemySystem.applyDamage(grunt, 50, true)).toEqual({
      actualDamage: 0,
      killed: false,
    });
    world.enemySystem.applySlow(grunt, 0.4, 2.0);
    expect(grunt.slowRatio).toBe(0);
    expect(grunt.slowTimer).toBe(0);

    // Exact boundary slowTimer === dt clears slowRatio immediately on that update tick
    const runner = world.enemySystem.spawnEnemy('runner')!;
    world.enemySystem.applySlow(runner, 0.3, 0.1);
    expect(runner.slowRatio).toBeCloseTo(0.3, 5);
    world.enemySystem.update(0.1, () => {}, () => {});
    expect(runner.slowTimer).toBe(0);
    expect(runner.slowRatio).toBe(0);
  });

  it('clamps non-positive CombatSystem fireRateMultiplier and gates startNextWave after outcome', () => {
    const world = new SimWorld(LEVELS[0], new EventBus());
    world.gold = 1000;
    const archer = world.placeTower(4, 2, 'archer')!;
    archer.cooldownTimer = 1.0;

    // Clamps multiplier <= 0 to 0.01 instead of producing negative/NaN cooldown
    world.combatSystem.update(0.5, [archer], -3);
    expect(archer.cooldownTimer).toBeCloseTo(1.0 - 0.5 * 0.01, 6);

    world.debugForceWin();
    expect(world.startNextWave()).toBe(false);
    world.debugSkipToWave(1);
    world.debugForceLose();
    expect(world.startNextWave()).toBe(false);
  });

  it('evaluates computeStarRating strictly at BALANCE thresholds', () => {
    const t3 = BALANCE.starThresholds.threeStarsMinLives;
    const t2 = BALANCE.starThresholds.twoStarsMinLives;
    expect(computeStarRating(BALANCE.startingLives)).toBe(3);
    expect(computeStarRating(t3)).toBe(3);
    expect(computeStarRating(t3 - 1)).toBe(2);
    expect(computeStarRating(t2)).toBe(2);
    expect(computeStarRating(t2 - 1)).toBe(1);
    expect(computeStarRating(1)).toBe(1);
    expect(computeStarRating(0)).toBe(1);
  });
});
