import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSettings, saveSettings } from '../../src/platform/storage.ts';

const KEY = 'skyhold_isles_settings_v1';
const store = new Map<string, string>();
const g = globalThis as unknown as { localStorage: Storage; window?: unknown };
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};

function asTouchDevice(on: boolean): void {
  if (on) g.window = { ontouchstart: null, matchMedia: () => ({ matches: true }) };
  else delete g.window;
}

const legacy = { masterVolume: 0.4, muted: true, cameraShake: false, damageNumbers: true };

describe('settings load / migration', () => {
  beforeEach(() => store.clear());
  afterEach(() => asTouchDevice(false));

  it('keeps every existing field of a v1 save', () => {
    store.set(KEY, JSON.stringify({ ...legacy, quality: 'high' }));
    const s = loadSettings();
    expect(s.masterVolume).toBe(0.4);
    expect(s.muted).toBe(true);
    expect(s.cameraShake).toBe(false);
    expect(s.quality).toBe('auto'); // the old desktop default 'high' moves to Auto (v3)
    expect(s.haptics).toBe(true);
  });

  it('moves the old touch default (unversioned "low") to auto', () => {
    asTouchDevice(true);
    store.set(KEY, JSON.stringify({ ...legacy, quality: 'low' }));
    expect(loadSettings().quality).toBe('auto');
  });

  it('keeps an unversioned "low" on desktop', () => {
    store.set(KEY, JSON.stringify({ ...legacy, quality: 'low' }));
    expect(loadSettings().quality).toBe('low');
  });

  it('keeps a deliberate "low" in a v2 save even on touch devices', () => {
    asTouchDevice(true);
    saveSettings({ ...loadSettings(), quality: 'low' });
    expect(JSON.parse(store.get(KEY) as string).v).toBe(3);
    expect(loadSettings().quality).toBe('low');
  });

  it('accepts medium/auto and rejects junk quality values', () => {
    store.set(KEY, JSON.stringify({ ...legacy, quality: 'medium', v: 2 }));
    expect(loadSettings().quality).toBe('medium');
    store.set(KEY, JSON.stringify({ ...legacy, quality: 'ultra', v: 2 }));
    expect(loadSettings().quality).toBe('auto');
  });

  it('keeps a deliberate desktop "high" saved by v3', () => {
    saveSettings({ ...loadSettings(), quality: 'high' });
    expect(loadSettings().quality).toBe('high');
  });

  it('moves a v2 desktop "high" (the old fixed default) to auto', () => {
    store.set(KEY, JSON.stringify({ ...legacy, quality: 'high', v: 2 }));
    expect(loadSettings().quality).toBe('auto');
  });

  it('defaults to auto on touch and on desktop', () => {
    expect(loadSettings().quality).toBe('auto');
    asTouchDevice(true);
    expect(loadSettings().quality).toBe('auto');
  });
});
