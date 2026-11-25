import { Assets, Text, TextStyle, Texture } from 'pixi.js';
import type { LoadedArt } from './assets2d.ts';
import { HUD_FONT } from './hudText.ts';

/** Keys of the painted UI kit (manifest `uiKit`). */
export type KitKey =
  | 'medallion'
  | 'medallionHi'
  | 'priceTag'
  | 'tooltip'
  | 'iconConfirm'
  | 'iconUpgrade'
  | 'iconSell'
  | 'iconRally'
  | 'iconTarget'
  | 'star'
  | 'starEmpty'
  | 'endPanel'
  | 'endPanelDefeat'
  | 'hudPlaque'
  | 'buttonRound';

/** A kit texture, or `fallback` when the kit piece is not in the manifest / failed to load. */
export function kit(art: LoadedArt, key: KitKey, fallback: Texture): Texture {
  return art.uiKit?.[key] ?? fallback;
}

export function hasKit(art: LoadedArt, key: KitKey): boolean {
  return !!art.uiKit?.[key];
}

/**
 * A piece of the DOM painted set (manifest `paintedUi`, e.g. `icon-play`, `pip-filled`) as a Pixi
 * texture, loaded on demand with mipmaps (they are drawn well below their painted size). Resolves
 * null when the piece fails to load; callers keep their Graphics stand-in then.
 */
export function paintedUiTexture(art: Pick<LoadedArt, 'manifest' | 'baseUrl'>, key: string): Promise<Texture | null> {
  const painted = (art.manifest as { paintedUi?: Readonly<Record<string, string>> } | undefined)?.paintedUi;
  // The parsed art manifest (manifest.ts) keeps only the keys the game layers read and drops
  // `paintedUi`, so fall back to that index's own naming (`ui/<key>.webp`).
  const file = painted?.[key] ?? `ui/${key}.webp`;
  return Assets.load<Texture>({ src: `${art.baseUrl}${file}`, data: { autoGenerateMipmaps: true } })
    .then((tex) => (tex && tex !== Texture.EMPTY ? tex : null))
    .catch(() => null);
}

export const INK = '#4a2a12';
export const INK_SOFT = '#7a5532';
export const PRICE_RED = '#c8341f';

/** Dark-brown lettering for parchment surfaces (cream text would vanish on cream). */
export function inkText(size: number, align: 'left' | 'center' | 'right' = 'left', fill = INK, weight: '600' | '700' = '700'): Text {
  const t = new Text({
    text: '',
    style: new TextStyle({ fontFamily: HUD_FONT, fontWeight: weight, fontSize: size, fill, align }),
  });
  t.anchor.set(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0.5);
  t.resolution = 2;
  return t;
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = Math.max(0, Math.min(1, t)) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

export function easeOutCubic(t: number): number {
  const x = 1 - Math.max(0, Math.min(1, t));
  return 1 - x * x * x;
}

/** Font size for ink (stroke-less) text. */
export function setInkSize(t: Text, size: number): void {
  if (t.style.fontSize !== size) t.style.fontSize = size;
}

/** Scales a text down (never up) so it fits `maxW` css px. */
export function fitWidth(t: Text, maxW: number): void {
  t.scale.set(1);
  const w = t.width;
  if (w > maxW && w > 0) t.scale.set(maxW / w);
}

// Safe-area insets and HUD keep-outs live in safeInsets.ts (no Pixi, so the world map can use
// them without loading the renderer); re-exported here for the canvas UI.
export { addHudKeepOut, hudKeepOuts, hudKeepOutsVersion, invalidateSafeInsets, readSafeInsets } from './safeInsets.ts';
