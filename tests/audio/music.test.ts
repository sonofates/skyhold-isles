import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicEngine } from '../../src/audio/music/musicEngine.ts';
import { hasAuthoredMusic, profileForLevel, midiToHz, degreeMidi } from '../../src/audio/music/musicProfiles.ts';
import {
  MusicSequencer,
  barDuration,
  stepDuration,
  STEPS_PER_BAR,
  type MusicEvent,
  type MusicScene,
} from '../../src/audio/music/sequencer.ts';
import {
  DEFAULT_MUSIC_VOLUME,
  MUSIC_PREFS_KEY,
  getMusicVolume,
  onMusicVolumeChange,
  resetMusicPrefsCache,
  setMusicVolume,
} from '../../src/audio/musicPrefs.ts';
import { LEVELS } from '../../src/data/levels/index.ts';

function run(scene: MusicScene, seconds: number, levelId = 'sunlit-meadow', seed = 3): MusicEvent[] {
  const seq = new MusicSequencer(profileForLevel(levelId), seed);
  seq.scene = scene;
  const out: MusicEvent[] = [];
  // Drive it the way the engine does: 100 ms ticks, 0.4 s lookahead.
  for (let now = 0; now < seconds; now += 0.1) seq.advance(now, now + 0.4, out);
  return out.filter((e) => e.t < seconds);
}

const voices = (evs: MusicEvent[]): Set<string> => new Set(evs.map((e) => e.voice));

describe('music profiles', () => {
  it('gives every shipped island its own authored profile', () => {
    for (const level of LEVELS) expect(hasAuthoredMusic(level.id), level.id).toBe(true);
  });

  it('falls back deterministically for unknown ids', () => {
    const a = profileForLevel('brand-new-island');
    const b = profileForLevel('brand-new-island');
    expect(a).toBe(b);
    expect(a.bpm).toBeGreaterThan(60);
    expect(a.mode).toHaveLength(7);
    expect(hasAuthoredMusic('brand-new-island')).toBe(false);
  });

  it('keeps every progression degree inside the mode and the tempo playable', () => {
    for (const level of LEVELS) {
      const p = profileForLevel(level.id);
      expect(p.bpm).toBeGreaterThanOrEqual(60);
      expect(p.bpm).toBeLessThanOrEqual(120);
      for (const d of p.progression) {
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(7);
      }
      expect(p.ambience.wind + p.ambience.water + p.ambience.embers).toBeGreaterThan(0);
    }
  });

  it('wraps degrees through octaves', () => {
    const p = profileForLevel('sunlit-meadow');
    expect(degreeMidi(p, 7)).toBe(degreeMidi(p, 0) + 12);
    expect(degreeMidi(p, -1)).toBe(degreeMidi(p, 6) - 12);
    expect(midiToHz(69)).toBeCloseTo(440, 5);
  });

  it('spreads the 16 islands over several families', () => {
    const fams = new Set(LEVELS.map((l) => profileForLevel(l.id).family));
    expect(fams.size).toBeGreaterThanOrEqual(6);
  });
});

describe('music sequencer', () => {
  it('is deterministic for a given seed and differs across seeds', () => {
    const a = run('wave', 20, 'highland-citadel', 5);
    const b = run('wave', 20, 'highland-citadel', 5);
    expect(b).toEqual(a);
    const c = run('wave', 20, 'highland-citadel', 6);
    expect(c).not.toEqual(a);
  });

  it('adds layers as the scene intensifies', () => {
    const calm = voices(run('build', 30));
    const wave = voices(run('wave', 30));
    const boss = voices(run('boss', 30));
    expect(calm.has('pad')).toBe(true);
    expect(calm.has('kick')).toBe(false);
    expect(calm.has('bass')).toBe(false);
    expect(calm.has('hat')).toBe(false);
    for (const v of ['pad', 'bass', 'kick', 'hat', 'lead']) expect(wave.has(v), v).toBe(true);
    expect(wave.has('drone')).toBe(false);
    expect(boss.has('drone')).toBe(true);
    expect(run('boss', 30).filter((e) => e.voice === 'kick').length).toBeGreaterThan(
      run('wave', 30).filter((e) => e.voice === 'kick').length,
    );
  });

  it('plays only the pad on the end screen and has no beat in the menu', () => {
    expect([...voices(run('end', 30))]).toEqual(['pad']);
    const menu = voices(run('menu', 30));
    expect(menu.has('kick')).toBe(false);
    expect(menu.has('bass')).toBe(false);
  });

  it('times notes on the tempo grid with one chord per bar', () => {
    const p = profileForLevel('sunlit-meadow');
    const evs = run('wave', 12);
    const pads = evs.filter((e) => e.voice === 'pad' && e.vel > 0.3);
    const starts = [...new Set(pads.map((e) => e.t))];
    expect(starts.length).toBeGreaterThan(3);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeCloseTo(barDuration(p), 6);
    expect(barDuration(p)).toBeCloseTo(stepDuration(p) * STEPS_PER_BAR, 9);
    // Every kick lands on a step boundary relative to the first pad.
    for (const k of evs.filter((e) => e.voice === 'kick')) {
      const steps = (k.t - starts[0]) / stepDuration(p);
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
    }
  });

  it('never emits the same note twice across overlapping advance windows', () => {
    const out = run('wave', 8);
    const keys = out.map((e) => `${e.voice}@${e.t.toFixed(5)}@${e.freq.toFixed(2)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps event density bounded (cheap on phones)', () => {
    for (const scene of ['menu', 'build', 'wave', 'boss'] as const) {
      const evs = run(scene, 30);
      expect(evs.length / 30, scene).toBeLessThan(scene === 'boss' ? 14 : 11);
    }
    expect(run('build', 30).length / 30).toBeLessThan(4);
  });

  it('keeps lead notes in a singable range', () => {
    for (const level of LEVELS) {
      const p = profileForLevel(level.id);
      const leads = run('wave', 40, level.id).filter((e) => e.voice === 'lead');
      expect(leads.length).toBeGreaterThan(10);
      for (const e of leads) {
        expect(e.freq).toBeGreaterThan(midiToHz(p.rootMidi));
        expect(e.freq).toBeLessThan(midiToHz(p.rootMidi + 12 * 3));
      }
    }
  });

  it('re-anchors instead of replaying a backlog after a long stall', () => {
    const seq = new MusicSequencer(profileForLevel('sunlit-meadow'), 1);
    seq.scene = 'wave';
    const out: MusicEvent[] = [];
    seq.advance(0, 0.4, out);
    out.length = 0;
    // The tab slept for a minute (ctx time jumped): no flood of old steps.
    seq.advance(60, 60.4, out);
    expect(out.length).toBeLessThan(25);
    expect(Math.min(...out.map((e) => e.t))).toBeGreaterThanOrEqual(60);
    // And the new run starts on a bar line (a pad chord first).
    expect(out[0].voice).toBe('pad');
  });

  it('starts the new island tune on a fresh bar when the profile changes', () => {
    const seq = new MusicSequencer(profileForLevel('sunlit-meadow'), 1);
    const out: MusicEvent[] = [];
    seq.advance(0, 3, out);
    out.length = 0;
    seq.setProfile(profileForLevel('sunken-bastion'));
    seq.advance(3, 3.4, out);
    expect(out[0].voice).toBe('pad');
    expect(out[0].t).toBeGreaterThanOrEqual(3);
  });

  it('boss stinger is a short low chord plus a kick', () => {
    const seq = new MusicSequencer(profileForLevel('stormcrown-citadel'), 1);
    const out: MusicEvent[] = [];
    seq.bossStinger(10, out);
    expect(out.filter((e) => e.voice === 'stinger')).toHaveLength(4);
    expect(out.some((e) => e.voice === 'kick')).toBe(true);
    expect(Math.max(...out.map((e) => e.t))).toBeLessThan(10.5);
    for (const e of out.filter((x) => x.voice === 'stinger')) expect(e.freq).toBeLessThan(400);
  });
});

describe('music volume prefs', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    resetMusicPrefsCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetMusicPrefsCache();
  });

  it('defaults, persists under its own key and clamps', () => {
    expect(getMusicVolume()).toBe(DEFAULT_MUSIC_VOLUME);
    setMusicVolume(0.25);
    expect(JSON.parse(localStorage.getItem(MUSIC_PREFS_KEY) ?? '{}')).toEqual({ v: 1, volume: 0.25 });
    resetMusicPrefsCache();
    expect(getMusicVolume()).toBe(0.25);
    setMusicVolume(7);
    expect(getMusicVolume()).toBe(1);
    setMusicVolume(-2);
    expect(getMusicVolume()).toBe(0);
  });

  it('survives corrupt storage and notifies listeners', () => {
    localStorage.setItem(MUSIC_PREFS_KEY, '{nope');
    resetMusicPrefsCache();
    expect(getMusicVolume()).toBe(DEFAULT_MUSIC_VOLUME);
    const seen: number[] = [];
    const off = onMusicVolumeChange((v) => seen.push(v));
    setMusicVolume(0.4);
    off();
    setMusicVolume(0.5);
    expect(seen).toEqual([0.4]);
  });
});

/** Minimal Web Audio stand-in: counts started voices and lets the test move the clock / state. */
function fakeCtx() {
  const param = () => ({
    value: 0,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
    setTargetAtTime: () => undefined,
  });
  const node = () => ({ connect: () => undefined, disconnect: () => undefined });
  let gains = 0;
  const state = { started: 0, ctxState: 'running', time: 0, gainTargets: [] as number[] };
  const ctx = {
    get state() {
      return state.ctxState;
    },
    get currentTime() {
      return state.time;
    },
    sampleRate: 8000,
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    createGain: () => {
      const g = { ...node(), gain: param() };
      // The engine creates its bus first: only that gain's targets are recorded.
      if (gains++ === 0) g.gain.setTargetAtTime = ((v: number) => void state.gainTargets.push(v)) as never;
      return g;
    },
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param(), Q: param() }),
    createOscillator: () => ({
      ...node(),
      type: 'sine',
      frequency: param(),
      detune: param(),
      onended: null as null | (() => void),
      start: () => void state.started++,
      stop: () => undefined,
    }),
    createBufferSource: () => ({
      ...node(),
      buffer: null,
      loop: false,
      start: () => void state.started++,
      stop: () => undefined,
    }),
  };
  return { ctx: ctx as unknown as AudioContext, state };
}

describe('music engine scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make() {
    const { ctx, state } = fakeCtx();
    const engine = new MusicEngine(ctx, { connect: () => undefined } as unknown as AudioNode, null);
    return { engine, state };
  }

  it('does nothing until activated, then ticks, then stops completely', () => {
    const { engine, state } = make();
    engine.setTarget('sunlit-meadow', 'build');
    vi.advanceTimersByTime(1000);
    expect(state.started).toBe(0);
    expect(engine.running).toBe(false);

    engine.setActive(true);
    expect(engine.running).toBe(true);
    state.time = 0.1;
    vi.advanceTimersByTime(300);
    const after = state.started;
    expect(after).toBeGreaterThan(0);

    engine.setActive(false);
    expect(engine.running).toBe(false);
    const frozen = state.started;
    state.time = 5;
    vi.advanceTimersByTime(5000);
    expect(state.started).toBe(frozen);
  });

  it('schedules nothing while the context is suspended and re-anchors on resume', () => {
    const { engine, state } = make();
    engine.setTarget('galewatch-spires', 'wave');
    engine.setActive(true);
    state.ctxState = 'suspended';
    state.time = 1;
    const before = state.started;
    vi.advanceTimersByTime(1000);
    expect(state.started).toBe(before);

    engine.pause();
    expect(engine.running).toBe(false);
    state.ctxState = 'running';
    state.time = 90;
    engine.resume();
    expect(engine.running).toBe(true);
    vi.advanceTimersByTime(300);
    expect(state.started).toBeGreaterThan(before);
  });

  it('ducks and unducks the bus, and fades to zero when deactivated', () => {
    const { engine, state } = make();
    engine.setVolume(1);
    engine.setActive(true);
    const full = state.gainTargets[state.gainTargets.length - 1];
    engine.setDucked(true);
    const ducked = state.gainTargets[state.gainTargets.length - 1];
    expect(ducked).toBeLessThan(full);
    engine.setDucked(false);
    expect(state.gainTargets[state.gainTargets.length - 1]).toBeCloseTo(full, 9);
    engine.setActive(false);
    expect(state.gainTargets[state.gainTargets.length - 1]).toBe(0);
  });

  it('boss stinger only sounds while active', () => {
    const { engine, state } = make();
    engine.stinger();
    expect(state.started).toBe(0);
    engine.setActive(true);
    const before = state.started;
    engine.stinger();
    expect(state.started).toBeGreaterThan(before);
    engine.dispose();
  });
});
