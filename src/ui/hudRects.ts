import type { PxRect } from '../render/occlusionFit.ts';

/**
 * Controls that sit on top of the island and hide tiles. The `.hud-top` container itself spans the
 * whole screen, so only its visible children are measured.
 */
const HUD_OCCLUDER_SELECTOR = [
  '.hud-top .gx',
  '.hud-top button',
  '.build-bar',
  '.ability-bar .ability-card',
  '.pause-toggles',
].join(',');

/** Rects (CSS px, relative to the viewport) of every visible HUD control. Layout-reading: call sparingly. */
export function collectHudRects(root: ParentNode = document): PxRect[] {
  const out: PxRect[] = [];
  const els = root.querySelectorAll<HTMLElement>(HUD_OCCLUDER_SELECTOR);
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    // Skip anything wrapping the whole screen (defensive; containers are not selected above).
    if (r.width >= window.innerWidth * 0.98 && r.height >= window.innerHeight * 0.9) continue;
    out.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
  }
  return mergeContained(out);
}

/** Drops rects fully inside another one (a button inside its plate) to keep the list short. */
export function mergeContained(rects: PxRect[]): PxRect[] {
  const keep: PxRect[] = [];
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    let inside = false;
    for (let j = 0; j < rects.length; j++) {
      if (i === j) continue;
      const b = rects[j];
      const contained = a.x0 >= b.x0 - 1 && a.y0 >= b.y0 - 1 && a.x1 <= b.x1 + 1 && a.y1 <= b.y1 + 1;
      // Identical rects: keep only the first.
      const identical = a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
      if (contained && (!identical || j < i)) {
        inside = true;
        break;
      }
    }
    if (!inside) keep.push(a);
  }
  return keep;
}
