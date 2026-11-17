import { describe, expect, it, vi } from 'vitest';
import { SoundManager } from '../../src/audio/soundManager.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import type { GameSettings } from '../../src/core/types.ts';

const SETTINGS: GameSettings = {
  masterVolume: 0.65,
  muted: false,
  cameraShake: true,
  damageNumbers: true,
  quality: 'high',
};

/** Minimal Web Audio stand-in that counts the voices a cue starts. */
function fakeAudio(): { ctx: unknown; started: () => number } {
  let started = 0;
  const param = () => ({
    value: 0,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
  });
  const node = () => ({ connect: () => undefined });
  const ctx = {
    state: 'running',
    currentTime: 0,
    createOscillator: () => ({
      ...node(),
      type: 'sine',
      frequency: param(),
      start: () => {
        started++;
      },
      stop: () => undefined,
    }),
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param() }),
    createBufferSource: () => ({
      ...node(),
      buffer: null,
      start: () => {
        started++;
      },
      stop: () => undefined,
    }),
  };
  return { ctx, started: () => started };
}

function withFakeAudio(sm: SoundManager): () => number {
  const { ctx, started } = fakeAudio();
  const priv = sm as unknown as { ctx: unknown; masterGain: unknown; noiseBuffer: unknown };
  priv.ctx = ctx;
  priv.masterGain = { connect: () => undefined, gain: { setValueAtTime: () => undefined } };
  priv.noiseBuffer = {};
  return started;
}

const P = { x: 0, y: 0, z: 0 };

describe('enemy archetype sound cues', () => {
  it('binds every new enemy event to its cue', () => {
    const sm = new SoundManager(SETTINGS);
    const bus = new EventBus();
    const spies = {
      ward: vi.spyOn(sm, 'playWardPulse'),
      broken: vi.spyOn(sm, 'playShieldBroken'),
      burrow: vi.spyOn(sm, 'playBurrow'),
      blink: vi.spyOn(sm, 'playBlink'),
      drop: vi.spyOn(sm, 'playCarrierDrop'),
      crack: vi.spyOn(sm, 'playArmorCracked'),
      phase: vi.spyOn(sm, 'playBossPhase'),
      charge: vi.spyOn(sm, 'playHexCharge'),
      hexed: vi.spyOn(sm, 'playTowerHexed'),
    };
    const unbind = sm.bindEvents(bus);
    bus.emit('wardPulse', { ...P, radius: 3.4, shieldedCount: 2 });
    bus.emit('shieldBroken', { ...P, enemyId: 1 });
    bus.emit('enemyBurrow', { ...P, enemyId: 1, burrowed: false });
    bus.emit('enemyBlink', { enemyId: 1, fromX: 0, fromY: 0, fromZ: 0, toX: 1, toY: 0, toZ: 1 });
    bus.emit('carrierDrop', { ...P, groundX: 0, groundY: 0, groundZ: 0, count: 2 });
    bus.emit('armorCracked', { ...P, enemyId: 1 });
    bus.emit('bossPhase', { ...P, enemyId: 1, enemyType: 'tempest', phase: 2, radius: 5 });
    bus.emit('hexCharge', { ...P, enemyId: 1, towerId: 3, towerX: 1, towerZ: 1 });
    bus.emit('towerHexed', { ...P, enemyId: 1, towerId: 3, towerX: 1, towerZ: 1, duration: 2.4 });
    for (const spy of Object.values(spies)) expect(spy).toHaveBeenCalledTimes(1);
    expect(spies.burrow).toHaveBeenCalledWith(false);
    expect(spies.phase).toHaveBeenCalledWith(2);

    unbind();
    bus.emit('hexCharge', { ...P, enemyId: 1, towerId: 3, towerX: 1, towerZ: 1 });
    expect(spies.charge).toHaveBeenCalledTimes(1);
  });

  it('is silent (and does not throw) before audio is unlocked', () => {
    const sm = new SoundManager(SETTINGS);
    expect(() => {
      sm.playWardPulse();
      sm.playBurrow(true);
      sm.playBossPhase(1);
      sm.playTowerHexed();
    }).not.toThrow();
  });

  it('every cue starts voices once audio runs, and repeats inside the throttle window are dropped', () => {
    const now = vi.spyOn(performance, 'now');
    try {
      now.mockReturnValue(10_000);
      const sm = new SoundManager(SETTINGS);
      const started = withFakeAudio(sm);
      const cues: Array<() => void> = [
        () => sm.playWardPulse(),
        () => sm.playShieldBroken(),
        () => sm.playBurrow(true),
        () => sm.playBurrow(false),
        () => sm.playBlink(),
        () => sm.playCarrierDrop(),
        () => sm.playArmorCracked(),
        () => sm.playBossPhase(1),
        // Same instant as phase 1: one burst tick can cross both Tempest thresholds; the enrage roar must play.
        () => sm.playBossPhase(2),
        () => sm.playHexCharge(),
        () => sm.playTowerHexed(),
      ];
      for (const cue of cues) {
        const before = started();
        cue();
        expect(started()).toBeGreaterThan(before);
      }
      // Same instant again: every cue is throttled.
      const afterFirst = started();
      for (const cue of cues) cue();
      expect(started()).toBe(afterFirst);
      // Well past every throttle window: they play again.
      now.mockReturnValue(20_000);
      for (const cue of cues) cue();
      expect(started()).toBeGreaterThan(afterFirst);
    } finally {
      now.mockRestore();
    }
  });

  it('mute silences the enemy cues', () => {
    const sm = new SoundManager({ ...SETTINGS, muted: true });
    const started = withFakeAudio(sm);
    sm.playHexCharge();
    sm.playBossPhase(2);
    expect(started()).toBe(0);
  });
});
