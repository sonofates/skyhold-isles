/**
 * Music volume lives under its own versioned localStorage key so the main settings record (and its migration)
 * stays untouched. Master volume and Mute from the normal settings still apply on top of it.
 */

export const MUSIC_PREFS_KEY = 'skyhold_isles_music_v1';
export const DEFAULT_MUSIC_VOLUME = 0.6;

type Listener = (volume: number) => void;

let volume: number | null = null;
const listeners = new Set<Listener>();

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_MUSIC_VOLUME;
}

function read(): number {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_MUSIC_VOLUME;
    const raw = localStorage.getItem(MUSIC_PREFS_KEY);
    if (!raw) return DEFAULT_MUSIC_VOLUME;
    const parsed = JSON.parse(raw) as { v?: number; volume?: unknown };
    if (parsed.v !== 1 || typeof parsed.volume !== 'number') return DEFAULT_MUSIC_VOLUME;
    return clamp01(parsed.volume);
  } catch {
    return DEFAULT_MUSIC_VOLUME;
  }
}

export function getMusicVolume(): number {
  if (volume === null) volume = read();
  return volume;
}

export function setMusicVolume(next: number): void {
  volume = clamp01(next);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MUSIC_PREFS_KEY, JSON.stringify({ v: 1, volume }));
    }
  } catch {
    // Private mode / quota: the slider still works for this session.
  }
  for (const l of listeners) l(volume);
}

export function onMusicVolumeChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test hook: forget the cached value so the next read hits storage again. */
export function resetMusicPrefsCache(): void {
  volume = null;
  sfxVolume = null;
}

// --- Sound-effects volume (Settings → Audio "Effects"), same pattern, its own key ------------------

export const SFX_PREFS_KEY = 'skyhold_isles_sfx_v1';
export const DEFAULT_SFX_VOLUME = 1;

let sfxVolume: number | null = null;
const sfxListeners = new Set<Listener>();

function readSfx(): number {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_SFX_VOLUME;
    const raw = localStorage.getItem(SFX_PREFS_KEY);
    if (!raw) return DEFAULT_SFX_VOLUME;
    const parsed = JSON.parse(raw) as { v?: number; volume?: unknown };
    if (parsed.v !== 1 || typeof parsed.volume !== 'number' || !Number.isFinite(parsed.volume)) return DEFAULT_SFX_VOLUME;
    return Math.max(0, Math.min(1, parsed.volume));
  } catch {
    return DEFAULT_SFX_VOLUME;
  }
}

/** Sound-effects level 0..1 on top of the master volume (music has its own slider). */
export function getSfxVolume(): number {
  if (sfxVolume === null) sfxVolume = readSfx();
  return sfxVolume;
}

export function setSfxVolume(next: number): void {
  sfxVolume = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : DEFAULT_SFX_VOLUME;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SFX_PREFS_KEY, JSON.stringify({ v: 1, volume: sfxVolume }));
    }
  } catch {
    // Private mode / quota: the slider still works for this session.
  }
  for (const l of sfxListeners) l(sfxVolume);
}

export function onSfxVolumeChange(listener: Listener): () => void {
  sfxListeners.add(listener);
  return () => sfxListeners.delete(listener);
}
