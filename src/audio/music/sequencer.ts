import { chordMidi, degreeMidi, midiToHz, type MusicProfile } from './musicProfiles.ts';

/**
 * Pure note scheduler for the procedural soundtrack (no WebAudio here, so it is unit-tested). The engine calls
 * `advance(now, until, out)` on a short timer; the sequencer appends every note whose step starts before `until`.
 * A step is an eighth note, 8 steps per bar. Layers are chosen by the current scene.
 */

export type MusicScene = 'menu' | 'build' | 'wave' | 'boss' | 'end';

export type MusicVoice = 'pad' | 'bass' | 'lead' | 'kick' | 'hat' | 'drone' | 'stinger';

export interface MusicEvent {
  /** AudioContext time in seconds. */
  t: number;
  voice: MusicVoice;
  /** Hz (0 for the noise-based hat and the kick, which sweep their own pitch). */
  freq: number;
  dur: number;
  /** 0..1 relative loudness; the engine scales it. */
  vel: number;
}

export const STEPS_PER_BAR = 8;
/** If the cursor fell this far behind the clock (tab throttled, long GC), jump ahead instead of playing a backlog. */
export const MAX_LAG_SEC = 0.25;

/** Small deterministic PRNG so the lead lines are reproducible in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function stepDuration(profile: MusicProfile): number {
  return 60 / profile.bpm / 2;
}

export function barDuration(profile: MusicProfile): number {
  return stepDuration(profile) * STEPS_PER_BAR;
}

export class MusicSequencer {
  scene: MusicScene = 'build';
  private profile: MusicProfile;
  private readonly rng: () => number;
  private nextTime = Number.NaN;
  /** Absolute step counter; bar = floor(step / 8). */
  private step = 0;
  /** Last lead scale degree, so melodies move by step more than by leap. */
  private leadDeg = 9;

  constructor(profile: MusicProfile, seed = 1) {
    this.profile = profile;
    this.rng = mulberry32(seed);
  }

  get currentProfile(): MusicProfile {
    return this.profile;
  }

  /** Switch island music: the new tune starts on a fresh bar at the next `advance`. */
  setProfile(profile: MusicProfile): void {
    if (profile === this.profile) return;
    this.profile = profile;
    this.step = 0;
    this.leadDeg = 9;
    this.nextTime = Number.NaN;
  }

  /** Forget the cursor (after a suspend / resume): the next `advance` re-anchors to its `now`. */
  reanchor(): void {
    this.nextTime = Number.NaN;
  }

  advance(now: number, until: number, out: MusicEvent[]): void {
    const dur = stepDuration(this.profile);
    if (Number.isNaN(this.nextTime) || this.nextTime < now - MAX_LAG_SEC) {
      // Realign to a bar start so the pad chord is never skipped mid-bar.
      this.step = Math.ceil(this.step / STEPS_PER_BAR) * STEPS_PER_BAR;
      this.nextTime = now + 0.06;
    }
    while (this.nextTime < until) {
      this.emitStep(this.nextTime, this.step, out);
      this.nextTime += dur;
      this.step++;
    }
  }

  private emitStep(t: number, step: number, out: MusicEvent[]): void {
    const p = this.profile;
    const scene = this.scene;
    const inBar = step % STEPS_PER_BAR;
    const bar = Math.floor(step / STEPS_PER_BAR);
    const chordDeg = p.progression[bar % p.progression.length];
    const dur = stepDuration(p);
    const barDur = dur * STEPS_PER_BAR;
    const intense = scene === 'wave' || scene === 'boss';
    const boss = scene === 'boss';

    if (inBar === 0) {
      const chord = chordMidi(p, chordDeg);
      const padVel = scene === 'menu' ? 0.5 : intense ? 0.34 : scene === 'end' ? 0.4 : 0.46;
      const padNotes = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[0] + 24];
      for (let i = 0; i < padNotes.length; i++) {
        out.push({ t, voice: 'pad', freq: midiToHz(padNotes[i]), dur: barDur * 1.1, vel: padVel * (i === 3 ? 0.5 : 1) });
      }
      if (boss) out.push({ t, voice: 'drone', freq: midiToHz(chord[0]), dur: barDur * 1.05, vel: 0.5 });
    }

    if (scene === 'end') return;

    // Bass + drums: only while a wave is on.
    if (intense) {
      const root = midiToHz(degreeMidi(p, chordDeg));
      const fifth = midiToHz(degreeMidi(p, chordDeg + 4));
      if (boss) {
        out.push({ t, voice: 'bass', freq: inBar % 4 === 3 ? fifth : root, dur: dur * 0.9, vel: 0.9 });
      } else if (inBar === 0 || inBar === 3 || inBar === 4) {
        out.push({ t, voice: 'bass', freq: inBar === 4 ? fifth : root, dur: dur * 1.6, vel: inBar === 0 ? 0.85 : 0.6 });
      }
      if (inBar === 0 || inBar === 4 || (boss && (inBar === 2 || inBar === 6))) {
        out.push({ t, voice: 'kick', freq: 0, dur: 0.16, vel: inBar % 4 === 0 ? 0.9 : 0.6 });
      }
      if (boss || inBar % 2 === 1) {
        out.push({ t, voice: 'hat', freq: 0, dur: 0.05, vel: boss ? 0.5 : 0.32 });
      }
    }

    // Lead: sparse in the calm scenes, running eighths in waves.
    const leadChance = scene === 'menu' ? 0.28 : scene === 'build' ? 0.34 : boss ? 0.8 : 0.62;
    const strongBeat = inBar % 2 === 0;
    if ((intense || strongBeat) && this.rng() < leadChance) {
      let deg: number;
      if (strongBeat && this.rng() < 0.55) {
        // Land on a chord tone (root / third / fifth of this bar's chord, one octave up).
        deg = chordDeg + Math.floor(this.rng() * 3) * 2 + 7;
      } else {
        deg = this.leadDeg + Math.floor(this.rng() * 5) - 2;
      }
      deg = Math.max(chordDeg + 3, Math.min(chordDeg + 11, deg));
      this.leadDeg = deg;
      const len = intense ? dur * 1.5 : dur * (2 + Math.floor(this.rng() * 3));
      out.push({
        t,
        voice: 'lead',
        freq: midiToHz(degreeMidi(p, deg) + (boss ? -12 : 0)),
        dur: len,
        vel: (intense ? 0.55 : 0.5) * (strongBeat ? 1 : 0.75),
      });
    }
  }

  /** One-shot low horn hit when a boss steps on to the road (not tied to the step grid). */
  bossStinger(t: number, out: MusicEvent[]): void {
    const root = degreeMidi(this.profile, 0) - 12;
    const notes = [root, root + 3, root + 7, root + 12];
    for (let i = 0; i < notes.length; i++) {
      out.push({ t: t + i * 0.09, voice: 'stinger', freq: midiToHz(notes[i]), dur: 1.3 - i * 0.12, vel: 0.9 - i * 0.1 });
    }
    out.push({ t, voice: 'kick', freq: 0, dur: 0.3, vel: 1 });
  }
}
