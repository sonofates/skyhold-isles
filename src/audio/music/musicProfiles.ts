/**
 * Per-island music identity: a mode, tempo, chord loop, lead timbre and ambience mix. Pure data, no WebAudio
 * (the sequencer and the engine read it). Keyed by `LevelDef.id`; unknown ids hash into one of the families so
 * islands added later still get music.
 */

export type MusicFamily = 'meadow' | 'coast' | 'highland' | 'sky' | 'storm' | 'deep' | 'lantern' | 'ember';

export type LeadTimbre = 'pluck' | 'bell' | 'flute' | 'horn';

export interface AmbienceMix {
  /** Each 0..1: loudness of the layer. */
  readonly wind: number;
  readonly water: number;
  /** Crackling embers (also drives the occasional spark ping). */
  readonly embers: number;
}

export interface MusicProfile {
  readonly family: MusicFamily;
  readonly bpm: number;
  /** MIDI note of the tonic (bass register). */
  readonly rootMidi: number;
  /** Seven semitone offsets from the tonic. */
  readonly mode: readonly number[];
  /** Zero-based scale degrees of the chord roots, one per bar, looped. */
  readonly progression: readonly number[];
  readonly lead: LeadTimbre;
  readonly padWave: 'triangle' | 'sine' | 'sawtooth';
  /** Pad low-pass cutoff in Hz (darker families sit lower). */
  readonly padCutoff: number;
  readonly ambience: AmbienceMix;
}

const IONIAN = [0, 2, 4, 5, 7, 9, 11] as const;
const LYDIAN = [0, 2, 4, 6, 7, 9, 11] as const;
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10] as const;
const DORIAN = [0, 2, 3, 5, 7, 9, 10] as const;
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10] as const;
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10] as const;

const FAMILIES: Readonly<Record<MusicFamily, MusicProfile>> = {
  meadow: {
    family: 'meadow',
    bpm: 88,
    rootMidi: 48,
    mode: IONIAN,
    progression: [0, 4, 5, 3],
    lead: 'pluck',
    padWave: 'triangle',
    padCutoff: 1500,
    ambience: { wind: 0.3, water: 0, embers: 0 },
  },
  coast: {
    family: 'coast',
    bpm: 80,
    rootMidi: 43,
    mode: MIXOLYDIAN,
    progression: [0, 3, 0, 4],
    lead: 'bell',
    padWave: 'sine',
    padCutoff: 1300,
    ambience: { wind: 0.15, water: 0.55, embers: 0 },
  },
  highland: {
    family: 'highland',
    bpm: 96,
    rootMidi: 45,
    mode: DORIAN,
    progression: [0, 3, 6, 4],
    lead: 'horn',
    padWave: 'triangle',
    padCutoff: 1100,
    ambience: { wind: 0.4, water: 0, embers: 0 },
  },
  sky: {
    family: 'sky',
    bpm: 76,
    rootMidi: 40,
    mode: LYDIAN,
    progression: [0, 1, 0, 4],
    lead: 'flute',
    padWave: 'sine',
    padCutoff: 1700,
    ambience: { wind: 0.7, water: 0, embers: 0 },
  },
  storm: {
    family: 'storm',
    bpm: 104,
    rootMidi: 37,
    mode: DORIAN,
    progression: [0, 6, 5, 6],
    lead: 'horn',
    padWave: 'sawtooth',
    padCutoff: 700,
    ambience: { wind: 0.85, water: 0, embers: 0.1 },
  },
  deep: {
    family: 'deep',
    bpm: 70,
    rootMidi: 38,
    mode: AEOLIAN,
    progression: [0, 5, 6, 4],
    lead: 'bell',
    padWave: 'sine',
    padCutoff: 900,
    ambience: { wind: 0.1, water: 0.65, embers: 0 },
  },
  lantern: {
    family: 'lantern',
    bpm: 72,
    rootMidi: 41,
    mode: IONIAN,
    progression: [0, 2, 3, 4],
    lead: 'bell',
    padWave: 'triangle',
    padCutoff: 1200,
    ambience: { wind: 0.2, water: 0, embers: 0.25 },
  },
  ember: {
    family: 'ember',
    bpm: 100,
    rootMidi: 40,
    mode: PHRYGIAN,
    progression: [0, 1, 0, 6],
    lead: 'horn',
    padWave: 'sawtooth',
    padCutoff: 800,
    ambience: { wind: 0.2, water: 0, embers: 0.7 },
  },
};

interface LevelMusic {
  readonly family: MusicFamily;
  /** Semitones added to the family tonic so neighbouring islands of one family do not sound identical. */
  readonly transpose: number;
}

const LEVEL_MUSIC: Readonly<Record<string, LevelMusic>> = {
  'sunlit-meadow': { family: 'meadow', transpose: 0 },
  'twin-bridge-cay': { family: 'coast', transpose: 0 },
  'highland-citadel': { family: 'highland', transpose: 0 },
  'emerald-stepping-stones': { family: 'meadow', transpose: 2 },
  'windmill-switchback': { family: 'meadow', transpose: 5 },
  'crescent-lagoon': { family: 'coast', transpose: 4 },
  'skybridge-gauntlet': { family: 'sky', transpose: 0 },
  'sunken-bastion': { family: 'deep', transpose: 0 },
  'grand-skyhold': { family: 'highland', transpose: 3 },
  'confluence-terraces': { family: 'coast', transpose: -2 },
  'galewatch-spires': { family: 'sky', transpose: 3 },
  'lanternfall-hollow': { family: 'lantern', transpose: 0 },
  'stormcrown-citadel': { family: 'storm', transpose: 0 },
  'amberstone-mesa': { family: 'ember', transpose: 0 },
  'moonwell-crossing': { family: 'lantern', transpose: 5 },
  'emberglass-sanctum': { family: 'ember', transpose: 3 },
};

const FAMILY_ORDER: readonly MusicFamily[] = ['meadow', 'coast', 'highland', 'sky', 'storm', 'deep', 'lantern', 'ember'];

function hashString(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const profileCache = new Map<string, MusicProfile>();

export function profileForLevel(levelId: string): MusicProfile {
  let p = profileCache.get(levelId);
  if (p) return p;
  const authored = LEVEL_MUSIC[levelId];
  const h = hashString(levelId);
  const entry = authored ?? { family: FAMILY_ORDER[h % FAMILY_ORDER.length], transpose: (h >>> 8) % 6 };
  const base = FAMILIES[entry.family];
  p = { ...base, rootMidi: base.rootMidi + entry.transpose };
  profileCache.set(levelId, p);
  return p;
}

export function hasAuthoredMusic(levelId: string): boolean {
  return levelId in LEVEL_MUSIC;
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** MIDI note of scale degree `degree` (may be negative or above 6: wraps through octaves) of the profile. */
export function degreeMidi(profile: MusicProfile, degree: number): number {
  const len = profile.mode.length;
  const oct = Math.floor(degree / len);
  const idx = degree - oct * len;
  return profile.rootMidi + profile.mode[idx] + oct * 12;
}

/** Chord tones (root, third, fifth) as MIDI notes for a chord rooted on `degree`. */
export function chordMidi(profile: MusicProfile, degree: number): [number, number, number] {
  return [degreeMidi(profile, degree), degreeMidi(profile, degree + 2), degreeMidi(profile, degree + 4)];
}
