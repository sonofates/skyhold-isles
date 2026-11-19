/**
 * Puts an info card (next-wave card, tapped-foe card) into the HUD dock's info slot (hudDock.ts):
 * top-left, never outside the slot. The card keeps its natural width up to `maxW` (and the slot's
 * width); if it is still taller than the slot it is scaled down as a whole (transform), widened
 * by the same factor so the text re-wraps into the slot's shape. Optional parts (`drop`, least
 * important first) are hidden before the card would shrink below `minScale`.
 */
import type { Rect } from '../uiLayout.ts';

export interface DockedCard {
  /** Screen box the card takes (inside the slot). */
  readonly box: Rect;
  readonly scale: number;
  /** How many of the optional parts were hidden. */
  readonly dropped: number;
}

export function dockCard(card: HTMLElement, slot: Rect, maxW: number, drop: readonly HTMLElement[] = [], minScale = 0.8): DockedCard {
  card.style.left = `${Math.round(slot.x)}px`;
  card.style.top = `${Math.round(slot.y)}px`;
  card.style.right = 'auto';
  card.style.bottom = 'auto';
  card.style.transformOrigin = '0 0';
  card.style.boxSizing = 'border-box';
  for (const e of drop) e.classList.remove('pu-dock-drop');
  const width = Math.max(40, Math.floor(Math.min(maxW, slot.w)));
  const at = (w: number): number => {
    card.style.maxWidth = `${w}px`;
    card.style.width = `${w}px`;
    return card.offsetHeight;
  };
  const fit = (): { k: number; w: number; h: number } => {
    card.style.transform = 'none';
    card.style.width = '';
    card.style.maxWidth = `${width}px`;
    // Natural width (capped), then the height at that width.
    const w0 = Math.min(width, Math.ceil(card.offsetWidth));
    const h0 = at(w0);
    if (h0 <= slot.h + 0.5) return { k: 1, w: w0, h: h0 };
    // Scaled by k the card may be width / k wide (unscaled px): the largest k whose height fits.
    let lo = Math.min(1, slot.h / Math.max(1, h0));
    let hi = 1;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      if (at(Math.floor(width / mid)) * mid <= slot.h) lo = mid;
      else hi = mid;
    }
    const w = Math.floor(width / lo);
    return { k: lo, w, h: at(w) };
  };
  let r = fit();
  let dropped = 0;
  while (r.k < minScale && dropped < drop.length) {
    drop[dropped].classList.add('pu-dock-drop');
    dropped++;
    r = fit();
  }
  card.style.transform = r.k < 0.999 ? `scale(${r.k.toFixed(4)})` : 'none'; // i18n-ignore (css)
  return { box: { x: slot.x, y: slot.y, w: r.w * r.k, h: r.h * r.k }, scale: r.k, dropped };
}
