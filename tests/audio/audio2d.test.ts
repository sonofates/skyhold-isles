import { describe, expect, it, vi } from 'vitest';
import { SoundManager } from '../../src/audio/soundManager.ts';
import { VoiceCap } from '../../src/audio/voiceCap.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import { bindAudio2D, screenPan } from '../../src/render2d/audio2d.ts';

describe('painted audio', () => {
  it('routes combat by type and places melee contact at its target', () => {
    const sound = new SoundManager({ muted: false, masterVolume: 1 });
    const bus = new EventBus();
    const pan = vi.spyOn(sound, 'setScreenPan');
    const fire = vi.spyOn(sound, 'playFire');
    const impact = vi.spyOn(sound, 'playImpact');
    const death = vi.spyOn(sound, 'playEnemyDeath');
    const swing = vi.spyOn(sound, 'playMeleeSwing');
    const hit = vi.spyOn(sound, 'playMeleeHit');
    const soldierX = vi.fn(() => 10);
    const stop = bindAudio2D(bus, sound, x => screenPan(x, 40), soldierX);
    const pos = { x: 30, y: 0, z: 5 };
    bus.emit('towerFired', { ...pos, towerId: 1, type: 'archer', tier: 3, yaw: 1, special: true });
    expect(fire).toHaveBeenCalledWith('archer', 3, true);
    expect(pan).toHaveBeenLastCalledWith(0.5);
    bus.emit('projectileImpact', { ...pos, towerType: 'frost', radius: 2, isBossHit: false });
    expect(impact).toHaveBeenCalledWith('frost');
    bus.emit('lightningChain', { points: [pos, { ...pos, x: 60 }] });
    expect(impact).toHaveBeenCalledWith('tesla');
    expect(pan).toHaveBeenLastCalledWith(1);
    bus.emit('enemyKilled', { ...pos, enemyId: 2, enemyType: 'golem', reward: 4 });
    expect(death).toHaveBeenCalledWith('golem');
    bus.emit('meleeSwing', { attacker: 'enemy', attackerId: 2, targetId: 3, impactIn: 0.2, sweep: true });
    expect(soldierX).toHaveBeenCalledWith(3);
    expect(swing).toHaveBeenCalledOnce();
    expect(pan).toHaveBeenLastCalledWith(-0.5);
    bus.emit('meleeHit', { ...pos, attacker: 'enemy', attackerId: 2, targetId: 3, targetX: -1, targetZ: 4,
      damage: 9, struck: 2, cleave: false, killed: false, sweep: true });
    expect(hit).toHaveBeenCalledWith(true);
    expect(pan).toHaveBeenLastCalledWith(-1);
    stop();
    bus.emit('enemyKilled', { ...pos, enemyId: 2, enemyType: 'boss', reward: 5 });
    expect(death).toHaveBeenCalledTimes(1);
    sound.dispose();
  });

  it('maps purchases, refunds, leaks, the horn and both outcomes', () => {
    const sound = new SoundManager({ muted: false, masterVolume: 1 });
    const bus = new EventBus();
    const build = vi.spyOn(sound, 'playTowerBuild');
    const upgrade = vi.spyOn(sound, 'playTowerUpgrade');
    const sell = vi.spyOn(sound, 'playTowerSell');
    const leak = vi.spyOn(sound, 'playEnemyLeak');
    const horn = vi.spyOn(sound, 'playWaveStart');
    const outcome = vi.spyOn(sound, 'playOutcome');
    const pan = vi.spyOn(sound, 'setScreenPan');
    const stop = bindAudio2D(bus, sound, () => 1, () => undefined);
    const tower = { x: 1, z: 1, type: 'barracks' as const, towerId: 2, tier: 3 };
    bus.emit('towerBuilt', tower);
    bus.emit('towerUpgraded', tower);
    bus.emit('towerSold', { ...tower, refund: 80 });
    bus.emit('enemyLeaked', { x: 1, y: 0, z: 2, enemyType: 'runner', livesLost: 1 });
    bus.emit('waveStarted', { waveIndex: 0, totalWaves: 10, earlyBonus: 1 });
    bus.emit('gameWon', { stars: 3, livesRemaining: 20 });
    bus.emit('gameLost', { waveIndex: 2 });
    expect(build).toHaveBeenCalledOnce();
    expect(upgrade).toHaveBeenCalledWith(3);
    expect(sell).toHaveBeenCalledOnce();
    expect(leak).toHaveBeenCalledOnce();
    expect(horn).toHaveBeenCalledOnce();
    expect(outcome.mock.calls).toEqual([[true], [false]]);
    expect(pan).toHaveBeenLastCalledWith(0);
    stop();
    sound.dispose();
  });

  it('caps a burst, admits independent sounds, and reuses only completed slots', () => {
    const voices = new VoiceCap(3);
    const arrows = Array.from({ length: 30 }, () => voices.acquire('arrow'));
    expect(arrows.filter(Boolean)).toHaveLength(3);
    expect(voices.acquire('clash')).toBe(true);
    voices.release('clash');
    expect(voices.acquire('arrow')).toBe(false);
    voices.release('arrow');
    expect(voices.acquire('arrow')).toBe(true);
    expect(voices.acquire('arrow')).toBe(false);
  });
});
