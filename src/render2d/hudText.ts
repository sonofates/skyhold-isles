import { Text, TextStyle } from 'pixi.js';

export const HUD_FONT = '"Fredoka Variable", "Trebuchet MS", "Arial Rounded MT Bold", sans-serif';

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

export function setFontSize(t: Text, size: number): void {
  if (t.style.fontSize !== size) {
    t.style.fontSize = size;
    t.style.stroke = { color: '#3a2412', width: Math.max(2, size * 0.2), join: 'round' };
  }
}
