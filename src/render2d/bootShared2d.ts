import type { GameSettings } from '../core/types.ts';
import { initLocale, t } from '../i18n/index.ts';
import { HUD_FONT } from './hudFont.ts';
import { setGraphicsPrefs } from './renderResolution.ts';
import { graphicsEngineState, type GraphicsEngineState, type GraphicsSettings } from './ui/graphicsSettings.ts';
import { setBootText } from './ui/transition2d.ts';
import { setUserUiScale, userUiScale } from './uiLayout.ts';

/**
 * Boot steps shared by the 2d.html entry (main2d.ts: title screen, world map) and the battle it
 * loads on demand (battle2d.ts). Nothing here may import Pixi or the sim: this is on the first-paint
 * path (docs/handoff-perf.md; tests/render/bundleSplit.test.ts guards it).
 */

/** Query keys that start a game scene; without any of them 2d.html opens the world map. */
export const GAME_PARAMS = ['level', 'hero', 'daily', 'challenge', 'endless', 'ab', 'bench', 'autoplay', 'raider', 'codex', 'artcheck', 'zoo', 'towers', 'melee', 'speed', 'end', 'mapmips'] as const;

export function showError(msg: string): void {
  const el = document.getElementById('boot');
  if (el) el.textContent = msg;
}

/**
 * Language first (before any text is built): `?lang=`, the stored setting, else the browser. The
 * boot line and the page title follow it, and the Turkish letters Fredoka lacks (ğ ş İ, served by
 * the 'Fredoka TR' faces of ui/fredokaTr.css) are fetched up front, so canvas text never falls
 * back to another font for them.
 */
export function bootLocale(): Promise<unknown> {
  initLocale();
  document.title = t('page.title');
  setBootText(t('boot.loading'));
  return Promise.all([
    document.fonts.load(`700 32px ${HUD_FONT}`, 'Aa'), // i18n-ignore (font probe)
    document.fonts.load(`700 32px ${HUD_FONT}`, 'ğşıİçöüĞŞÇÖÜ'),
    document.fonts.load(`600 32px ${HUD_FONT}`, 'ğşıİçöüĞŞÇÖÜ'),
  ]).catch(() => undefined);
}

/**
 * Settings → Graphics into the page: renderer resolution / tier lock (read when a renderer is
 * created), reduced-motion class and interface size. The battle adds its effects density on top
 * (battle2d.ts `applyGraphics`). Returns the engine state for the ticker cap.
 */
export function applyPageGraphics(g: GraphicsSettings, quality: GameSettings['quality'], desktop: boolean): GraphicsEngineState {
  const engine = graphicsEngineState(quality, g, desktop);
  setGraphicsPrefs(engine.prefs);
  document.documentElement.classList.toggle('pu-reduce-motion', g.reducedMotion);
  applyUiScale(g.uiScale);
  return engine;
}

/** Interface size: the CSS unit (`--ui-scale`) and the HUD layout math (uiLayout.ts) together. */
export function applyUiScale(k: number): void {
  if (k === userUiScale() && document.documentElement.style.getPropertyValue('--ui-scale') === String(k)) return;
  const changed = k !== userUiScale();
  setUserUiScale(k);
  document.documentElement.style.setProperty('--ui-scale', String(k));
  // Everything laid out from the screen size (map fit, HUD dock, boards) lays out again.
  if (changed) requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}
