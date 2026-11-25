import { Text, TextStyle } from 'pixi.js';
import { HUD_FONT } from './hudFont.ts';

export { HUD_FONT };

/** Cream lettering with a thick dark-brown outline (matches the painted UI kit). */
export function paintedText(size: number, align: 'left' | 'center' | 'right' = 'left', fill = '#fff4dc'): Text {
  const t = new Text({
    text: '',
    style: new TextStyle({
      fontFamily: HUD_FONT,
      fontWeight: '700',
      fontSize: size,
      fill,
      stroke: { color: '#3a2412', width: Math.max(2, size * 0.2), join: 'round' },
      align,
    }),
  });
  t.anchor.set(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0.5);
  t.resolution = 2;
  return t;
}

/** Updates a Text only when the string changes (Text re-rasterises on every change). */
export function setText(t: Text, value: string): void {
  if (t.text !== value) t.text = value;
}

/**
 * Sizes a painted label to fit `maxW` css px: its own font size (`size`) when it fits, else a
 * smaller FONT (re-rasterised crisp, outline in proportion) — never under `min`; only a text still
 * too wide at `min` is scaled down to fit. The scale is 1 otherwise, so a label can't stay
 * shrunk from an earlier layout (owner report 2026-11-21: "Dalga 1/20" a few px tall on a MacBook
 * while the banner was full size). Returns the scale (the base for a bump animation).
 */
export function fitFont(t: Text, size: number, maxW: number, min: number): number {
  const lo = Math.min(size, Math.max(1, min));
  setFontSize(t, size);
  t.scale.set(1);
  if (maxW <= 0 || t.text === '') return 1;
  const w = t.width;
  if (w <= maxW) return 1;
  const fit = Math.max(lo, Math.floor((size * maxW) / w));
  setFontSize(t, fit);
  const w2 = t.width;
  if (w2 > maxW && w2 > 0) t.scale.set(maxW / w2);
  return t.scale.x;
}

export function setFontSize(t: Text, size: number): void {
  if (t.style.fontSize !== size) {
    t.style.fontSize = size;
    t.style.stroke = { color: '#3a2412', width: Math.max(2, size * 0.2), join: 'round' };
  }
}
