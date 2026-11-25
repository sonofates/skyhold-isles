import { beforeEach, describe, expect, it } from 'vitest';
import { getSfxVolume, resetMusicPrefsCache, setSfxVolume, SFX_PREFS_KEY } from '../../src/audio/musicPrefs.ts';
import { isSteamOverlayHotkey, shouldPauseOnBlur, type BlurPauseInput } from '../../src/render2d/pausePolicy.ts';
import { ABILITY_KEYS } from '../../src/render2d/ui/abilities2d.ts';
import { autoUiScale, FPS_CAPS, GRAPHICS_KEY, loadGraphics, parseGraphics, saveGraphics } from '../../src/render2d/ui/graphicsSettings.ts';
import { HERO_KEYS } from '../../src/render2d/ui/heroKeys.ts';
import {
  actionForKey,
  badgeLabel,
  codeKey,
  DEFAULT_KEY_BINDINGS,
  domKeyFor,
  eventKey,
  forgetKeyBindingsCache,
  KEY_ACTIONS,
  KEY_BINDINGS_KEY,
  keyFor,
  loadKeyBindings,
  matchesAction,
  normalizeKey,
  parseKeyBindings,
  rebind,
  resetKeyBindings,
  saveKeyBindings,
} from '../../src/render2d/ui/keyBindings.ts';
import { beltKeyIndex, itemKeys } from '../../src/render2d/ui/marketModel.ts';
import { padKey } from '../../src/render2d/ui/padCursor.ts';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  };
  forgetKeyBindingsCache();
  resetMusicPrefsCache();
});

describe('key bindings (Settings → Controls)', () => {
  it('defaults match the keys the HUD always used, one key per action', () => {
    expect(DEFAULT_KEY_BINDINGS).toEqual({
      pause: 'SPACE',
      speed1: '1',
      speed2: '2',
      speed3: '3',
      wave: 'N',
      meteor: 'Q',
      overcharge: 'W',
      heroSelect: 'H',
      heroSkill0: 'E',
      heroSkill1: 'R',
      item0: 'Z',
      item1: 'X',
      item2: 'C',
    });
    expect(new Set(Object.values(DEFAULT_KEY_BINDINGS)).size).toBe(KEY_ACTIONS.length);
    expect(loadKeyBindings()).toEqual(DEFAULT_KEY_BINDINGS);
  });

  it('normalises key presses: letters / digits / space bind, layout code is the fallback', () => {
    expect(normalizeKey('q')).toBe('Q');
    expect(normalizeKey('7')).toBe('7');
    expect(normalizeKey(' ')).toBe('SPACE');
    for (const k of ['Escape', 'Enter', 'Tab', 'ArrowUp', 'F11', 'Shift', 'ş', '!']) expect(normalizeKey(k)).toBeNull();
    expect(codeKey('KeyQ')).toBe('Q');
    expect(codeKey('Digit3')).toBe('3');
    expect(codeKey('Numpad2')).toBe('2');
    expect(codeKey('Space')).toBe('SPACE');
    expect(codeKey('F5')).toBeNull();
    // Shift+1 types '!' but is still the 1 key; a Cyrillic letter falls back to its key position.
    expect(eventKey({ key: '!', code: 'Digit1' })).toBe('1');
    expect(eventKey({ key: 'й', code: 'KeyQ' })).toBe('Q');
    // AZERTY: the character wins over the position (A on the KeyQ position is A, not Q).
    expect(eventKey({ key: 'a', code: 'KeyQ' })).toBe('A');
  });

  it('rebinding swaps with the action that held the key, and persists', () => {
    let b = rebind(DEFAULT_KEY_BINDINGS, 'meteor', 'W');
    expect(b.meteor).toBe('W');
    expect(b.overcharge).toBe('Q');
    b = rebind(b, 'pause', 'P');
    expect(b.pause).toBe('P');
    expect(rebind(b, 'pause', 'Escape')).toBe(b); // not bindable: unchanged
    saveKeyBindings(b);
    expect(JSON.parse(store.get(KEY_BINDINGS_KEY)!)).toMatchObject({ meteor: 'W', overcharge: 'Q', pause: 'P' });
    forgetKeyBindingsCache();
    expect(loadKeyBindings()).toEqual(b);
    // The live constants the HUD reads follow the bindings.
    expect(ABILITY_KEYS.meteor).toBe('W');
    expect(ABILITY_KEYS).toEqual({ meteor: 'W', overcharge: 'Q' });
    expect(keyFor('pause')).toBe('P');
    resetKeyBindings();
    expect(loadKeyBindings()).toEqual(DEFAULT_KEY_BINDINGS);
    expect(HERO_KEYS.select).toBe('H');
  });

  it('repairs broken storage: bad entries take the default, a clash resets everything', () => {
    expect(parseKeyBindings(null)).toEqual(DEFAULT_KEY_BINDINGS);
    expect(parseKeyBindings({ meteor: 'Escape', wave: 'b' })).toEqual(DEFAULT_KEY_BINDINGS); // lower-case is not a stored label
    expect(parseKeyBindings({ wave: 'B' }).wave).toBe('B');
    expect(parseKeyBindings({ wave: 'Q' })).toEqual(DEFAULT_KEY_BINDINGS); // Q is Meteor's: clash
    store.set(KEY_BINDINGS_KEY, '{not json');
    forgetKeyBindingsCache();
    expect(loadKeyBindings()).toEqual(DEFAULT_KEY_BINDINGS);
  });

  it('maps presses to actions; the belt, the pad and the HUD badges use the live keys', () => {
    expect(actionForKey(DEFAULT_KEY_BINDINGS, { key: ' ' })).toBe('pause');
    expect(actionForKey(DEFAULT_KEY_BINDINGS, { key: 'n' })).toBe('wave');
    expect(actionForKey(DEFAULT_KEY_BINDINGS, { key: 'Escape' })).toBeNull();
    expect(matchesAction({ key: '2' }, 'speed2')).toBe(true);
    saveKeyBindings(rebind(rebind(DEFAULT_KEY_BINDINGS, 'item0', 'V'), 'pause', 'P'));
    expect(itemKeys()).toEqual(['V', 'X', 'C']);
    expect(beltKeyIndex('v', 3)).toBe(0);
    expect(beltKeyIndex('z', 3)).toBe(-1);
    expect(padKey('start')).toBe('P');
    saveKeyBindings(rebind(loadKeyBindings(), 'heroSelect', 'SPACE'));
    expect(padKey('y')).toBe(' ');
    expect(domKeyFor('SPACE')).toBe(' ');
    expect(badgeLabel('SPACE')).toBe('␣');
    expect(badgeLabel('Q')).toBe('Q');
  });
});

describe('PC settings persistence', () => {
  it('frame-rate caps include 120 / 144 and survive a reload; unknown caps fall back', () => {
    expect(FPS_CAPS).toEqual([30, 60, 120, 144, 0]);
    const g = loadGraphics();
    saveGraphics({ ...g, fpsCap: 144, uiScale: 1.2, reducedMotion: true });
    expect(JSON.parse(store.get(GRAPHICS_KEY)!)).toMatchObject({ fpsCap: 144, uiScale: 1.2, reducedMotion: true });
    expect(loadGraphics()).toMatchObject({ fpsCap: 144, uiScale: 1.2, reducedMotion: true });
    expect(parseGraphics({ fpsCap: 75 }).fpsCap).toBe(0);
    expect(parseGraphics({ fpsCap: 120 }).fpsCap).toBe(120);
  });

  it('the PC build starts with a larger interface on screens taller than 1080p', () => {
    expect(autoUiScale(720)).toBe(1);
    expect(autoUiScale(1080)).toBe(1);
    expect(autoUiScale(1200)).toBe(1.1);
    expect(autoUiScale(1440)).toBe(1.3);
    expect(autoUiScale(2160)).toBe(1.3);
    expect(autoUiScale(NaN)).toBe(1);
    // Outside the shell (no window.skyholdDesktop) the default stays 100 %.
    expect(loadGraphics().uiScale).toBe(1);
  });

  it('the effects (SFX) volume is its own setting, clamped and persisted', () => {
    expect(getSfxVolume()).toBe(1);
    setSfxVolume(0.35);
    expect(JSON.parse(store.get(SFX_PREFS_KEY)!)).toEqual({ v: 1, volume: 0.35 });
    resetMusicPrefsCache();
    expect(getSfxVolume()).toBe(0.35);
    setSfxVolume(7);
    expect(getSfxVolume()).toBe(1);
    store.set(SFX_PREFS_KEY, '{"v":1,"volume":"loud"}');
    resetMusicPrefsCache();
    expect(getSfxVolume()).toBe(1);
  });
});

describe('pause on focus loss / Steam overlay', () => {
  const base: BlurPauseInput = { touch: false, desktopShell: false, simActive: true, paused: false, endless: false, sheetOpen: false };

  it('a desktop run pauses when the window loses focus', () => {
    expect(shouldPauseOnBlur(base)).toBe(true);
    expect(shouldPauseOnBlur({ ...base, paused: true })).toBe(false);
    expect(shouldPauseOnBlur({ ...base, simActive: false })).toBe(false);
    expect(shouldPauseOnBlur({ ...base, sheetOpen: true })).toBe(false);
    expect(shouldPauseOnBlur({ ...base, endless: true })).toBe(false);
  });

  it('touch devices pause on visibility instead, except a touchscreen PC in the desktop shell', () => {
    expect(shouldPauseOnBlur({ ...base, touch: true })).toBe(false);
    expect(shouldPauseOnBlur({ ...base, touch: true, desktopShell: true })).toBe(true);
  });

  it('Shift+Tab pauses only while Steam is running', () => {
    const ev = { key: 'Tab', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false };
    expect(isSteamOverlayHotkey(ev, true)).toBe(true);
    expect(isSteamOverlayHotkey(ev, false)).toBe(false);
    expect(isSteamOverlayHotkey({ ...ev, shiftKey: false }, true)).toBe(false);
    expect(isSteamOverlayHotkey({ ...ev, ctrlKey: true }, true)).toBe(false);
  });
});
