import { profileForLevel, type MusicProfile } from './musicProfiles.ts';
import { MusicSequencer, type MusicEvent, type MusicScene } from './sequencer.ts';

/**
 * WebAudio driver for the procedural soundtrack + ambience. Notes come from the pure `MusicSequencer`; this class
 * turns them into short-lived oscillator voices on its own gain bus, so the master volume / mute of the
 * SoundManager apply on top. Cheap by design: a 100 ms scheduler timer, a handful of voices alive at once, one
 * looping noise buffer for the wind/water beds, and no timer at all while silent or in the background.
 */

const TICK_MS = 100;
const LOOKAHEAD_SEC = 0.4;
/** Overall music level before the master gain and the limiter (kept well under the SFX peaks). */
const BUS_GAIN = 0.55;
const DUCK = 0.35;
const END_LEVEL = 0.6;
const MAX_VOICES = 36;

export class MusicEngine {
  private readonly ctx: AudioContext;
  private readonly bus: GainNode;
  private readonly sfxNoise: AudioBuffer | null;
  private readonly sequencer: MusicSequencer;
  private readonly events: MusicEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private volume = 1;
  private ducked = false;
  private active = false;
  private liveVoices = 0;
  private levelId: string | null = null;

  // Ambience beds (built lazily on the first start).
  private ambSource: AudioBufferSourceNode | null = null;
  private windLevel: GainNode | null = null;
  private waterLevel: GainNode | null = null;
  private lfos: OscillatorNode[] = [];
  private ambStopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: AudioContext, destination: AudioNode, sfxNoise: AudioBuffer | null) {
    this.ctx = ctx;
    this.sfxNoise = sfxNoise;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(destination);
    this.sequencer = new MusicSequencer(profileForLevel('sunlit-meadow'), 7);
  }

  get running(): boolean {
    return this.timer !== null;
  }

  get scene(): MusicScene {
    return this.sequencer.scene;
  }

  get profile(): MusicProfile {
    return this.sequencer.currentProfile;
  }

  /** Pick the island tune and the scene (menu / build / wave / boss / end). Safe to call repeatedly. */
  setTarget(levelId: string | null, scene: MusicScene): void {
    if (levelId !== null && levelId !== this.levelId) {
      this.levelId = levelId;
      this.sequencer.setProfile(profileForLevel(levelId));
      this.applyAmbience();
    }
    this.sequencer.scene = scene;
    this.applyBusGain();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyBusGain();
  }

  /** Pause menu / modal open: tuck the music (and bed) under the UI. */
  setDucked(ducked: boolean): void {
    this.ducked = ducked;
    this.applyBusGain();
  }

  /** Start or stop all scheduling. Stopping silences the bus (notes already queued ring out softly). */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.applyBusGain();
    if (active) this.start();
    else this.stop();
  }

  /** The context was suspended / resumed: re-anchor the cursor, never replay a backlog. */
  pause(): void {
    this.stopTimer();
  }

  resume(): void {
    this.sequencer.reanchor();
    if (this.active) this.startTimer();
  }

  stinger(): void {
    if (!this.active || this.ctx.state !== 'running') return;
    const out: MusicEvent[] = [];
    this.sequencer.bossStinger(this.ctx.currentTime + 0.02, out);
    for (let i = 0; i < out.length; i++) this.play(out[i]);
  }

  dispose(): void {
    if (this.ambStopTimer !== null) clearTimeout(this.ambStopTimer);
    this.stopTimer();
    this.stopAmbience();
    this.bus.disconnect();
  }

  // ---- internals ----

  private start(): void {
    if (this.ambStopTimer !== null) {
      clearTimeout(this.ambStopTimer);
      this.ambStopTimer = null;
    }
    this.sequencer.reanchor();
    this.startAmbience();
    this.startTimer();
  }

  private stop(): void {
    this.stopTimer();
    // Let the bus fade out first, then free the noise bed (no click, no idle CPU).
    this.ambStopTimer = setTimeout(() => {
      this.ambStopTimer = null;
      if (!this.active) this.stopAmbience();
    }, 900);
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private applyBusGain(): void {
    const sceneMul = this.sequencer.scene === 'end' ? END_LEVEL : 1;
    const target = this.active ? this.volume * BUS_GAIN * sceneMul * (this.ducked ? DUCK : 1) : 0;
    this.bus.gain.setTargetAtTime(target, this.ctx.currentTime, 0.25);
  }

  private tick(): void {
    if (this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    this.events.length = 0;
    this.sequencer.advance(now, now + LOOKAHEAD_SEC, this.events);
    for (let i = 0; i < this.events.length; i++) this.play(this.events[i]);
    this.ambienceTick(now);
  }

  // ---- voices ----

  private play(ev: MusicEvent): void {
    if (this.liveVoices >= MAX_VOICES && ev.voice !== 'pad' && ev.voice !== 'stinger') return;
    switch (ev.voice) {
      case 'pad':
        this.padVoice(ev);
        break;
      case 'bass':
        this.bassVoice(ev);
        break;
      case 'lead':
        this.leadVoice(ev);
        break;
      case 'kick':
        this.kickVoice(ev);
        break;
      case 'hat':
        this.hatVoice(ev);
        break;
      case 'drone':
        this.droneVoice(ev);
        break;
      case 'stinger':
        this.stingerVoice(ev);
        break;
    }
  }

  private osc(type: OscillatorType, freq: number, t: number, stopAt: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start(t);
    o.stop(stopAt);
    this.liveVoices++;
    o.onended = () => {
      this.liveVoices--;
    };
    return o;
  }

  private padVoice(ev: MusicEvent): void {
    const { t, dur } = ev;
    const o = this.osc(this.profile.padWave, ev.freq, t, t + dur + 0.05);
    o.detune.value = (Math.random() * 2 - 1) * 5;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = this.profile.padCutoff;
    const g = this.ctx.createGain();
    const peak = ev.vel * 0.1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.45);
    g.gain.linearRampToValueAtTime(peak * 0.75, t + dur * 0.75);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.bus);
  }

  private bassVoice(ev: MusicEvent): void {
    const { t, dur } = ev;
    const o = this.osc('triangle', ev.freq, t, t + dur + 0.05);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(ev.vel * 0.22, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.bus);
  }

  private leadVoice(ev: MusicEvent): void {
    const { t } = ev;
    const kind = this.profile.lead;
    const g = this.ctx.createGain();
    g.connect(this.bus);
    if (kind === 'pluck') {
      const dur = ev.dur + 0.2;
      const o = this.osc('triangle', ev.freq, t, t + dur + 0.05);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(ev.vel * 0.13, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
    } else if (kind === 'bell') {
      const dur = ev.dur + 0.7;
      const o = this.osc('sine', ev.freq, t, t + dur + 0.05);
      const o2 = this.osc('sine', ev.freq * 2.76, t, t + dur * 0.5 + 0.05);
      const g2 = this.ctx.createGain();
      g2.gain.value = 0.3;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(ev.vel * 0.12, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      o2.connect(g2);
      g2.connect(g);
    } else if (kind === 'flute') {
      const dur = ev.dur + 0.15;
      const o = this.osc('sine', ev.freq, t, t + dur + 0.05);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(ev.vel * 0.12, t + 0.07);
      g.gain.linearRampToValueAtTime(ev.vel * 0.08, t + dur * 0.6);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
    } else {
      const dur = ev.dur + 0.1;
      const o = this.osc('sawtooth', ev.freq, t, t + dur + 0.05);
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(500, t);
      f.frequency.linearRampToValueAtTime(1500, t + 0.08);
      f.frequency.linearRampToValueAtTime(700, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(ev.vel * 0.075, t + 0.05);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(f);
      f.connect(g);
    }
  }

  private kickVoice(ev: MusicEvent): void {
    const { t, dur } = ev;
    const o = this.osc('sine', 120, t, t + dur + 0.05);
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + dur * 0.8);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(ev.vel * 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.bus);
  }

  private hatVoice(ev: MusicEvent): void {
    if (!this.sfxNoise) return;
    const { t, dur } = ev;
    const src = this.ctx.createBufferSource();
    src.buffer = this.sfxNoise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(ev.vel * 0.07, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.bus);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private droneVoice(ev: MusicEvent): void {
    const { t, dur } = ev;
    const o = this.osc('sawtooth', ev.freq, t, t + dur + 0.05);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(ev.vel * 0.11, t + 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.bus);
  }

  private stingerVoice(ev: MusicEvent): void {
    const { t, dur } = ev;
    const o = this.osc('sawtooth', ev.freq, t, t + dur + 0.05);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(ev.vel * 0.16, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.bus);
  }

  // ---- ambience: wind + water beds (one looping noise source), embers / drips as sparse one-shots ----

  private startAmbience(): void {
    if (this.ambSource) {
      this.applyAmbience();
      return;
    }
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 3);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const windLevel = ctx.createGain();
    windLevel.gain.value = 0;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 480;
    windFilter.Q.value = 0.8;
    const windMod = ctx.createGain();
    windMod.gain.value = 0.6;
    src.connect(windFilter);
    windFilter.connect(windMod);
    windMod.connect(windLevel);
    windLevel.connect(this.bus);
    this.lfos.push(this.lfo(0.07, 220, windFilter.frequency), this.lfo(0.13, 0.35, windMod.gain));

    const waterLevel = ctx.createGain();
    waterLevel.gain.value = 0;
    const waterFilter = ctx.createBiquadFilter();
    waterFilter.type = 'bandpass';
    waterFilter.frequency.value = 1700;
    waterFilter.Q.value = 0.9;
    const waterMod = ctx.createGain();
    waterMod.gain.value = 0.55;
    src.connect(waterFilter);
    waterFilter.connect(waterMod);
    waterMod.connect(waterLevel);
    waterLevel.connect(this.bus);
    this.lfos.push(this.lfo(0.31, 0.25, waterMod.gain), this.lfo(5.3, 0.12, waterMod.gain));

    src.start();
    this.ambSource = src;
    this.windLevel = windLevel;
    this.waterLevel = waterLevel;
    this.applyAmbience();
  }

  private lfo(hz: number, depth: number, target: AudioParam): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.frequency.value = hz;
    const d = this.ctx.createGain();
    d.gain.value = depth;
    o.connect(d);
    d.connect(target);
    o.start();
    return o;
  }

  private applyAmbience(): void {
    if (!this.windLevel || !this.waterLevel) return;
    const mix = this.profile.ambience;
    const now = this.ctx.currentTime;
    this.windLevel.gain.setTargetAtTime(mix.wind * 0.3, now, 0.8);
    this.waterLevel.gain.setTargetAtTime(mix.water * 0.16, now, 0.8);
  }

  private stopAmbience(): void {
    for (const o of this.lfos) {
      try {
        o.stop();
      } catch {
        // already stopped
      }
    }
    this.lfos = [];
    if (this.ambSource) {
      try {
        this.ambSource.stop();
      } catch {
        // already stopped
      }
      this.ambSource.disconnect();
    }
    this.ambSource = null;
    this.windLevel = null;
    this.waterLevel = null;
  }

  private ambienceTick(now: number): void {
    const mix = this.profile.ambience;
    if (mix.embers > 0 && this.sfxNoise && Math.random() < mix.embers * 0.55) {
      const t = now + Math.random() * 0.1;
      const src = this.ctx.createBufferSource();
      src.buffer = this.sfxNoise;
      const f = this.ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 2200 + Math.random() * 2500;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime((0.05 + Math.random() * 0.08) * mix.embers + 0.02, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
      src.connect(f);
      f.connect(g);
      g.connect(this.bus);
      src.start(t);
      src.stop(t + 0.04);
    }
    if (mix.embers > 0 && Math.random() < mix.embers * 0.03) this.ping(now, 2200 + Math.random() * 1400, 0.02);
    if (mix.water > 0 && Math.random() < mix.water * 0.07) this.ping(now, 900 + Math.random() * 1100, 0.03, true);
  }

  /** Tiny decaying sine blip: a spark (embers) or a water drip (falling pitch). */
  private ping(now: number, freq: number, peak: number, drip = false): void {
    if (this.liveVoices >= MAX_VOICES) return;
    const t = now + Math.random() * 0.1;
    const o = this.osc('sine', freq, t, t + 0.2);
    if (drip) {
      o.frequency.setValueAtTime(freq * 1.4, t);
      o.frequency.exponentialRampToValueAtTime(freq, t + 0.08);
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (drip ? 0.14 : 0.1));
    o.connect(g);
    g.connect(this.bus);
  }
}
