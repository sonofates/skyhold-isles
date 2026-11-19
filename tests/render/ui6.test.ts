import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { ABILITY_DEFS, computeMeteorDamage } from '../../src/data/abilities.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/index.ts';
import { NEUTRAL_RUN_MODIFIERS } from '../../src/data/runModifiers.ts';
import { setLocale } from '../../src/i18n/index.ts';
import { getDefaultSettings, loadSettings, saveSettings } from '../../src/platform/storage.ts';
import { SimWorld } from '../../src/sim/world.ts';
import { fxPrefsNow, setFxPrefs } from '../../src/render2d/fxLayer.ts';
import { AdaptiveQuality, graphicsPrefs, NEUTRAL_GRAPHICS_PREFS, renderResolution, setGraphicsPrefs } from '../../src/render2d/renderResolution.ts';
import {
  ABILITY_KEYS,
  abilityDesc,
  abilityGate,
  abilitySlotView,
  castMeteor2D,
  castOvercharge2D,
  slotStatus,
} from '../../src/render2d/ui/abilities2d.ts';
import {
  defaultGraphics,
  GRAPHICS_KEY,
  graphicsEngineState,
  loadGraphics,
  parseGraphics,
  qualityLock,
  reapplyGraphicsSettings,
  saveGraphics,
} from '../../src/render2d/ui/graphicsSettings.ts';

function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };
  vi.stubGlobal('localStorage', mock);
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setGraphicsPrefs(NEUTRAL_GRAPHICS_PREFS);
  setFxPrefs({ density: 1, reduceFlashes: false });
  setLocale('en');
});

function world(mods = NEUTRAL_RUN_MODIFIERS): { w: SimWorld; events: EventBus } {
  const events = new EventBus();
  return { w: new SimWorld(LEVEL_L1C, events, mods), events };
}

describe('global abilities in 2D (UI round 6)', () => {
  it('wait for the first wave, then Meteor casts on a plot map through the sim ability system', () => {
    const { w, events } = world();
    expect(abilityGate(w)).toBe('waiting');
    expect(abilitySlotView(w, 'meteor').state).toBe('waiting');
    expect(castMeteor2D(w, 0, 0)).toBe(false);
    w.startNextWave();
    expect(abilityGate(w)).toBe('ok');
    expect(abilitySlotView(w, 'meteor').state).toBe('ready');
    const targeted: number[] = [];
    let impacts = 0;
    events.on('abilityTargeted', (e) => targeted.push(e.radius));
    events.on('meteorImpact', () => impacts++);
    expect(castMeteor2D(w, 1, 2)).toBe(true);
    expect(targeted).toEqual([ABILITY_DEFS.meteor.radius]);
    const v = abilitySlotView(w, 'meteor');
    expect(v.state).toBe('cooldown');
    expect(v.cooldown).toBeCloseTo(ABILITY_DEFS.meteor.cooldownSec);
    expect(v.cooldownFrac).toBeCloseTo(1);
    // A second cast during the recharge does nothing.
    expect(castMeteor2D(w, 1, 2)).toBe(false);
    for (let i = 0; i < 30; i++) w.fixedTick(1 / 60);
    expect(impacts).toBe(1);
    expect(abilitySlotView(w, 'meteor').cooldownFrac).toBeLessThan(1);
  });

  it('Overcharge needs a tower, then surges every tower for its duration', () => {
    const { w } = world();
    w.startNextWave();
    expect(abilitySlotView(w, 'overcharge').state).toBe('noTargets');
    expect(castOvercharge2D(w)).toBe(false);
    w.gold = 999;
    expect(w.placeTowerOnPlot(0, 'archer')).not.toBeNull();
    expect(abilitySlotView(w, 'overcharge').state).toBe('ready');
    expect(castOvercharge2D(w)).toBe(true);
    const v = abilitySlotView(w, 'overcharge');
    expect(v.active).toBeCloseTo(ABILITY_DEFS.overcharge.durationSec);
    expect(v.activeFrac).toBeCloseTo(1);
    expect(w.abilitySystem.getFireRateMultiplier()).toBe(ABILITY_DEFS.overcharge.fireRateMultiplier);
    expect(slotStatus(v)).toBe('Active · 7s');
  });

  it('rules that forbid abilities disable both buttons', () => {
    const { w } = world({ ...NEUTRAL_RUN_MODIFIERS, abilitiesDisabled: true });
    w.startNextWave();
    expect(abilityGate(w)).toBe('disabled');
    expect(abilitySlotView(w, 'meteor').state).toBe('disabled');
    expect(abilitySlotView(w, 'overcharge').state).toBe('disabled');
    expect(castMeteor2D(w, 0, 0)).toBe(false);
  });

  it('a finished run closes the bar', () => {
    const { w } = world();
    w.startNextWave();
    w.debugForceLose();
    expect(abilityGate(w)).toBe('over');
    expect(castMeteor2D(w, 0, 0)).toBe(false);
  });

  it('tooltips read their numbers from the data, in both languages', () => {
    const dmg = computeMeteorDamage(3);
    expect(abilityDesc('meteor', 3)).toContain(String(dmg));
    expect(abilityDesc('meteor', 3)).toContain('38%');
    expect(abilityDesc('overcharge', 1)).toContain('65%');
    setLocale('tr');
    expect(abilityDesc('meteor', 3)).toContain(String(dmg));
    expect(abilityDesc('meteor', 3)).toContain('%38');
    expect(abilityDesc('meteor', 3)).toContain('1,6 sn');
    expect(abilityDesc('overcharge', 1)).toContain('%65');
    expect(ABILITY_KEYS).toEqual({ meteor: 'Q', overcharge: 'W' });
  });
});

describe('graphics settings (UI round 6)', () => {
  it('parses junk to the defaults and clamps the render scale', () => {
    const d = defaultGraphics(false);
    expect(parseGraphics(null, d)).toEqual(d);
    expect(parseGraphics({ renderScale: 0.1, effects: 'ultra', fpsCap: 45, showFps: 'yes', reducedMotion: true }, d)).toEqual({ ...d, renderScale: 0.5, reducedMotion: true });
    expect(parseGraphics({ renderScale: 0.73, effects: 'high', fpsCap: 30 }, d)).toEqual({ ...d, renderScale: 0.75, effects: 'high', fpsCap: 30 });
    // The game always ran uncapped: an old save keeps that.
    expect(d.fpsCap).toBe(0);
  });

  it('persists next to the shared settings and survives a saveSettings() that drops unknown fields', () => {
    const store = stubStorage();
    saveSettings({ ...getDefaultSettings(), quality: 'medium' });
    expect(loadGraphics()).toEqual(defaultGraphics());
    const g = { ...defaultGraphics(), effects: 'low' as const, showFps: true, renderScale: 0.8 };
    saveGraphics(g);
    expect(JSON.parse(store.get('skyhold_isles_settings_v1')!).graphics).toEqual(g);
    expect(loadSettings().quality).toBe('medium');
    // Older code saves the settings without the `graphics` object …
    saveSettings(loadSettings());
    expect(JSON.parse(store.get('skyhold_isles_settings_v1')!).graphics).toBeUndefined();
    // … the side key still has it, and reapply puts it back.
    expect(loadGraphics()).toEqual(g);
    reapplyGraphicsSettings();
    expect(JSON.parse(store.get('skyhold_isles_settings_v1')!).graphics).toEqual(g);
    expect(JSON.parse(store.get(GRAPHICS_KEY)!)).toEqual(g);
  });

  it('maps the choices to the renderer (render scale on desktops only)', () => {
    expect(qualityLock('auto')).toBeNull();
    expect(qualityLock('medium')).toBe('med');
    const g = { ...defaultGraphics(false), renderScale: 0.6, effects: 'high' as const, fpsCap: 30 as const, reducedMotion: true };
    const desk = graphicsEngineState('low', g, true);
    expect(desk.prefs).toEqual({ lock: 'low', renderScale: 0.6, fpsCap: 30 });
    expect(desk.fx).toEqual({ density: 1.35, reduceFlashes: true });
    expect(desk.maxFps).toBe(30);
    expect(graphicsEngineState('auto', g, false).prefs.renderScale).toBe(1);
  });
});

describe('graphics prefs in the renderer (UI round 6)', () => {
  it('scales the canvas resolution and clamps it', () => {
    setGraphicsPrefs({ lock: null, renderScale: 0.5, fpsCap: 0 });
    expect(renderResolution(1600, 900, 2)).toBe(1);
    setGraphicsPrefs({ lock: null, renderScale: 0.2, fpsCap: 0 });
    expect(graphicsPrefs().renderScale).toBe(0.5);
  });

  it('a Quality preset locks the tier live, and Auto hands it back to the governor', () => {
    const q = new AdaptiveQuality(null, 'high', true);
    expect(q.isLocked).toBe(false);
    setGraphicsPrefs({ lock: 'low', renderScale: 1, fpsCap: 0 });
    expect(q.observe(16, true)).toBe(true);
    expect(q.tier).toBe('low');
    expect(q.isLocked).toBe(true);
    // Locked: slow frames change nothing.
    for (let i = 0; i < 300; i++) expect(q.observe(60, true)).toBe(false);
    setGraphicsPrefs({ lock: null, renderScale: 1, fpsCap: 0 });
    expect(q.observe(16, true)).toBe(true);
    expect(q.tier).toBe('high');
    expect(q.isLocked).toBe(false);
    // A new governor starts at the player's tier.
    setGraphicsPrefs({ lock: 'med', renderScale: 1, fpsCap: 0 });
    expect(new AdaptiveQuality(null, 'high', false).tier).toBe('med');
    // `?quality=` still wins over the preset.
    expect(new AdaptiveQuality('low', 'high', false).tier).toBe('low');
  });

  it('a 30 fps cap is not mistaken for a slow device', () => {
    setGraphicsPrefs({ lock: null, renderScale: 1, fpsCap: 30 });
    const q = new AdaptiveQuality(null, 'high', true);
    q.observe(33, true);
    for (let i = 0; i < 30 * 12; i++) q.observe(1000 / 30, true);
    expect(q.tier).toBe('high');
    // Without the cap the same frames step the effects tier down.
    setGraphicsPrefs(NEUTRAL_GRAPHICS_PREFS);
    q.observe(33, true);
    for (let i = 0; i < 30 * 12; i++) q.observe(1000 / 30, true);
    expect(q.tier).not.toBe('high');
  });

  it('effects density and calm flashes are clamped module prefs', () => {
    setFxPrefs({ density: 9, reduceFlashes: true });
    expect(fxPrefsNow()).toEqual({ density: 1.5, reduceFlashes: true });
  });
});
