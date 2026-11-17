import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicEngine } from '../../src/audio/music/musicEngine.ts';
import { resetMusicPrefsCache, setMusicVolume } from '../../src/audio/musicPrefs.ts';
import { SoundManager } from '../../src/audio/soundManager.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import type { GameSettings } from '../../src/core/types.ts';

const SETTINGS: GameSettings = {
  masterVolume: 0.65,
  muted: false,
  cameraShake: true,
  damageNumbers: true,
  quality: 'high',
} as GameSettings;

/** Web Audio stand-in with enough surface for SoundManager.unlock() + the music engine. */
function fakeContext(): AudioContext {
  const param = () => ({
    value: 0,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
    setTargetAtTime: () => undefined,
  });
  const node = () => ({ connect: () => undefined, disconnect: () => undefined });
  return {
    state: 'running',
    currentTime: 0,
    sampleRate: 8000,
    destination: {},
    resume: () => Promise.resolve(),
    suspend: () => Promise.resolve(),
    close: () => Promise.resolve(),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    createGain: () => ({ ...node(), gain: param() }),
    createDynamicsCompressor: () => ({
      ...node(),
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
    }),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param(), Q: param() }),
    createOscillator: () => ({
      ...node(),
      type: 'sine',
      frequency: param(),
      detune: param(),
      start: () => undefined,
      stop: () => undefined,
    }),
    createBufferSource: () => ({ ...node(), buffer: null, loop: false, start: () => undefined, stop: () => undefined }),
  } as unknown as AudioContext;
}

function engineOf(sm: SoundManager): MusicEngine {
  return (sm as unknown as { music: MusicEngine }).music;
}

describe('sound manager music wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const ctx = fakeContext();
    vi.stubGlobal('window', {
      AudioContext: function () {
        return ctx;
      },
    });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    resetMusicPrefsCache();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetMusicPrefsCache();
  });

  function boot(): { sm: SoundManager; engine: MusicEngine } {
    const sm = new SoundManager({ ...SETTINGS });
    sm.unlock();
    return { sm, engine: engineOf(sm) };
  }

  it('follows the wave / build / boss / end scenes and resets them with each level', () => {
    const { sm, engine } = boot();
    const bus = new EventBus();
    sm.bindEvents(bus);
    sm.setMusicContext('sunlit-meadow', 'build');
    expect(engine.running).toBe(true);
    expect(engine.scene).toBe('build');
    bus.emit('waveStarted', { waveIndex: 0, totalWaves: 5, earlyBonus: 0 });
    expect(engine.scene).toBe('wave');
    bus.emit('enemySpawned', { enemyId: 1, enemyType: 'grunt', flying: false });
    expect(engine.scene).toBe('wave');
    bus.emit('enemySpawned', { enemyId: 2, enemyType: 'boss', flying: false });
    expect(engine.scene).toBe('boss');
    bus.emit('waveCompleted', { waveIndex: 0, bonus: 0 });
    expect(engine.scene).toBe('build');
    bus.emit('waveStarted', { waveIndex: 1, totalWaves: 5, earlyBonus: 0 });
    bus.emit('gameLost', { waveIndex: 1 });
    expect(engine.scene).toBe('end');
    // Quitting mid-boss never emits waveCompleted: the next level load / menu resets the scene.
    bus.emit('enemySpawned', { enemyId: 3, enemyType: 'tempest', flying: false });
    expect(engine.scene).toBe('boss');
    sm.setMusicContext('stormcrown-citadel', 'build');
    expect(engine.scene).toBe('build');
    expect(engine.profile.family).toBe('storm');
    sm.setMusicContext('stormcrown-citadel', 'menu');
    expect(engine.scene).toBe('menu');
  });

  it('is silent (no timer) when muted, master at zero or music at zero, and returns afterwards', () => {
    const { sm, engine } = boot();
    sm.setMusicContext('sunlit-meadow', 'build');
    expect(engine.running).toBe(true);
    sm.updateSettings({ ...SETTINGS, muted: true });
    expect(engine.running).toBe(false);
    sm.updateSettings({ ...SETTINGS, muted: false });
    expect(engine.running).toBe(true);
    sm.updateSettings({ ...SETTINGS, masterVolume: 0 });
    expect(engine.running).toBe(false);
    sm.updateSettings({ ...SETTINGS });
    setMusicVolume(0);
    expect(engine.running).toBe(false);
    setMusicVolume(0.5);
    expect(engine.running).toBe(true);
  });

  it('stops its scheduler in the background and restarts it on return', () => {
    const { sm, engine } = boot();
    sm.setMusicContext('sunlit-meadow', 'build');
    sm.suspendForBackground();
    expect(engine.running).toBe(false);
    sm.resumeFromBackground();
    expect(engine.running).toBe(true);
  });

  it('applies a context chosen before the first gesture once audio unlocks', () => {
    const sm = new SoundManager({ ...SETTINGS });
    sm.setMusicContext('amberstone-mesa', 'menu');
    sm.unlock();
    const engine = engineOf(sm);
    expect(engine.profile.family).toBe('ember');
    expect(engine.scene).toBe('menu');
    expect(engine.running).toBe(true);
  });
});
