import { Assets, Text, TextStyle, Texture } from 'pixi.js';
import type { LoadedArt } from './assets2d.ts';
import { HUD_FONT } from './hudText.ts';
import type { Insets, Rect } from './uiLayout.ts';

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

let probe: HTMLDivElement | null = null;

/** Device safe-area insets (css px) from `env(safe-area-inset-*)`; zeros outside notched devices / tests. */
export function readSafeInsets(): Insets {
  if (typeof document === 'undefined' || !document.body) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  const n = (v: string): number => Math.max(0, parseFloat(v) || 0);
  return { top: n(cs.paddingTop), right: n(cs.paddingRight), bottom: n(cs.paddingBottom), left: n(cs.paddingLeft) };
}

type KeepOutSource = () => Rect | null;
const keepOutSources = new Set<KeepOutSource>();

/**
 * DOM pieces drawn over the Pixi canvas (the in-game Guide button and its caption) report their
 * screen box here, so canvas UI that pops up under them (the build ring, its tooltip) can stay
 * clear. Returns an unregister function.
 */
export function addHudKeepOut(source: KeepOutSource): () => void {
  keepOutSources.add(source);
  return () => keepOutSources.delete(source);
}

/** Current boxes of the DOM HUD pieces (hidden ones report null and are skipped). */
export function hudKeepOuts(): Rect[] {
  const out: Rect[] = [];
  for (const src of keepOutSources) {
    const r = src();
    if (r && r.w > 0 && r.h > 0) out.push(r);
  }
  return out;
}
