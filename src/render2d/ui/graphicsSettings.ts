/**
 * Settings → Graphics for the painted isles: what the player picked, stored with the shared settings.
 *
 * - The Quality preset IS the shared `GameSettings.quality` field ('auto' | 'low' | 'medium' |
 *   'high', src/platform/storage.ts), so nothing new is needed for it.
 * - Everything else (render resolution, effects density, frame-rate cap, FPS counter, reduced
 *   motion) lives in a `graphics` object. storage.ts may not be edited here and its
 *   `saveSettings()` drops fields it does not know, so — like the language (i18n/localeSetting.ts)
 *   — the object is written into the same settings JSON (ignored by older code: backward
 *   compatible) and mirrored to its own key; `reapplyGraphicsSettings()` puts it back after such a
 *   save. Missing / broken values fall back to the defaults, so old saves load unchanged.
 *
 * `graphicsEngineState()` turns the choices into what the renderer takes (renderResolution.ts
 * `setGraphicsPrefs`, fxLayer.ts `setFxPrefs`, the ticker's max FPS).
 */
import type { QualityLevel } from '../../core/types.ts';
import type { GraphicsPrefs, QualityTier } from '../renderResolution.ts';

export type EffectsDensity = 'low' | 'normal' | 'high';
export type FpsCap = 30 | 60 | 120 | 144 | 0;

/** The caps Settings → Graphics offers (0 = unlimited: the display's refresh rate, i.e. vsync). */
export const FPS_CAPS: readonly FpsCap[] = [30, 60, 120, 144, 0];

export interface GraphicsSettings {
  /** Canvas resolution 0.5..1, or null = Auto (full resolution, the game may trim it on phones). */
  renderScale: number | null;
  effects: EffectsDensity;
  /** Frame-rate cap: 30, 60, 120, 144, or 0 = unlimited (the display's own refresh rate). */
  fpsCap: FpsCap;
  showFps: boolean;
  /** No screen shake, no large flashes, calmer UI pulses. */
  reducedMotion: boolean;
  /** Interface size (menus, boards, the battle HUD): 0.9..1.3, steps of 0.05; 1 = as designed. */
  uiScale: number;
}

export const UI_SCALE_MIN = 0.9;
export const UI_SCALE_MAX = 1.3;

/** A stored / slider interface size, clamped to 90–130 % in 5 % steps. */
export function clampUiScale(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1;
  return Math.round(Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, v)) * 20) / 20;
}

const SETTINGS_KEY = 'skyhold_isles_settings_v1';
export const GRAPHICS_KEY = 'skyhold_isles_graphics_v1';
/** Window event fired after the player changes a graphics option (the running game re-applies). */
export const GRAPHICS_EVENT = 'skyhold:graphics';

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; // i18n-ignore (media query)
  } catch {
    return false;
  }
}

export function defaultGraphics(reduced = prefersReducedMotion(), uiScale = shellDefaultUiScale()): GraphicsSettings {
  // Unlimited (= the display's refresh rate) is what the game always did, so it stays the default.
  return { renderScale: null, effects: 'normal', fpsCap: 0, showFps: false, reducedMotion: reduced, uiScale };
}

/**
 * Default interface size for a screen `screenH` CSS px tall: the painted UI is sized for 1080p (its
 * unit stops growing there), so taller PC screens start larger — 1200p → 110 %, 1440p and up → 130 %
 * — and keep the same share of the screen. Players change it in Settings → General.
 */
export function autoUiScale(screenH: number): number {
  return Number.isFinite(screenH) && screenH > 1080 ? clampUiScale(Math.floor((screenH / 1080) * 20) / 20) : 1;
}

/** The PC build (Electron shell) picks the default from the display; the browser / phones keep 100 %. */
function shellDefaultUiScale(): number {
  try {
    return typeof window !== 'undefined' && window.skyholdDesktop && typeof screen !== 'undefined' ? autoUiScale(screen.height) : 1;
  } catch {
    return 1;
  }
}

/** Clamps / repairs a stored object (anything unknown → the default). */
export function parseGraphics(raw: unknown, defaults: GraphicsSettings = defaultGraphics()): GraphicsSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const scale = o.renderScale;
  return {
    renderScale: typeof scale === 'number' && Number.isFinite(scale) ? Math.round(Math.max(0.5, Math.min(1, scale)) * 20) / 20 : null,
    effects: o.effects === 'low' || o.effects === 'normal' || o.effects === 'high' ? o.effects : defaults.effects,
    fpsCap: (FPS_CAPS as readonly unknown[]).includes(o.fpsCap) ? (o.fpsCap as FpsCap) : defaults.fpsCap,
    showFps: typeof o.showFps === 'boolean' ? o.showFps : defaults.showFps,
    reducedMotion: typeof o.reducedMotion === 'boolean' ? o.reducedMotion : defaults.reducedMotion,
    uiScale: o.uiScale === undefined ? defaults.uiScale : clampUiScale(o.uiScale),
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadGraphics(): GraphicsSettings {
  const ls = storage();
  if (!ls) return defaultGraphics();
  try {
    const raw = ls.getItem(SETTINGS_KEY);
    const inShared = raw ? (JSON.parse(raw) as { graphics?: unknown }).graphics : undefined;
    if (inShared && typeof inShared === 'object') return parseGraphics(inShared);
  } catch {
    /* a broken settings blob is storage.ts's business */
  }
  try {
    const side = ls.getItem(GRAPHICS_KEY);
    return side ? parseGraphics(JSON.parse(side)) : defaultGraphics();
  } catch {
    return defaultGraphics();
  }
}

export function saveGraphics(g: GraphicsSettings): void {
  const ls = storage();
  if (!ls) return;
  try {
    const clean = parseGraphics(g);
    ls.setItem(GRAPHICS_KEY, JSON.stringify(clean));
    const raw = ls.getItem(SETTINGS_KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    obj.graphics = clean;
    ls.setItem(SETTINGS_KEY, JSON.stringify(obj));
  } catch {
    /* quota / private mode */
  }
}

/** After `saveSettings()` (which drops unknown fields): write the graphics object back into the JSON. */
export function reapplyGraphicsSettings(): void {
  const side = storage()?.getItem(GRAPHICS_KEY);
  if (!side) return;
  try {
    saveGraphics(parseGraphics(JSON.parse(side)));
  } catch {
    /* ignore */
  }
}

/** Shared Quality preset → the locked render tier (null = Auto). */
export function qualityLock(level: QualityLevel | undefined): QualityTier | null {
  return level === 'low' ? 'low' : level === 'medium' ? 'med' : level === 'high' ? 'high' : null;
}

export const EFFECTS_DENSITY: Readonly<Record<EffectsDensity, number>> = { low: 0.5, normal: 1, high: 1.35 };

export interface GraphicsEngineState {
  readonly prefs: GraphicsPrefs;
  readonly fx: { readonly density: number; readonly reduceFlashes: boolean };
  /** Pixi ticker `maxFPS` (0 = no cap). */
  readonly maxFps: number;
}

/**
 * What the renderer takes for these choices. `desktop` = the render-resolution slider is shown
 * (desktops only); on phones the canvas resolution stays with the quality tier / governor.
 */
export function graphicsEngineState(quality: QualityLevel | undefined, g: GraphicsSettings, desktop: boolean): GraphicsEngineState {
  return {
    prefs: { lock: qualityLock(quality), renderScale: desktop && g.renderScale !== null ? g.renderScale : 1, fpsCap: g.fpsCap },
    fx: { density: EFFECTS_DENSITY[g.effects], reduceFlashes: g.reducedMotion },
    maxFps: g.fpsCap,
  };
}

/** Tells the running game (main2d.ts) to re-apply the graphics settings now. */
export function announceGraphicsChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(GRAPHICS_EVENT));
}
