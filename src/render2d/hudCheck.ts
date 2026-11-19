/**
 * QA (`window.__p0.hudCheck()`): every HUD piece as it is really drawn — the canvas HUD (plaque,
 * banner, pause / speed, horn with its label and seconds), the DOM buttons with their captions
 * (Codex, Settings), the hero / ability tray and the info cards when shown — and the road, plot,
 * cave and castle shapes each one covers under the current map fit. `overlaps` must be empty.
 */
import type { Game2D } from './game2d.ts';
import { dockPieces } from './hudDock.ts';
import { playfieldShapes, shapesOverlap, type Overlap } from './playfield.ts';
import type { Rect } from './uiLayout.ts';

export interface HudCheck {
  readonly screen: { w: number; h: number };
  readonly form: string;
  readonly fit: { scale: number; offsetX: number; offsetY: number; shrink: number };
  /** Drawn pieces (screen px). */
  readonly pieces: Record<string, Rect>;
  /** The dock's slots (screen px). */
  readonly slots: Record<string, Rect>;
  /** Drawn pieces that stick out of their slot (px; ≤ 1 is rounding). */
  readonly outside: Record<string, number>;
  readonly overlaps: { piece: string; kind: Overlap['kind']; index: number; depth: number }[];
}

const r4 = (r: Rect): Rect => ({ x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.w * 10) / 10, h: Math.round(r.h * 10) / 10 });

function union(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Visible boxes of an element and its descendants (tooltips / hints excluded), unioned. */
function domBox(root: Element | null): Rect | null {
  if (!root || !(root instanceof HTMLElement) || root.hidden || getComputedStyle(root).display === 'none') return null;
  const out: Rect[] = [];
  const walk = (e: Element): void => {
    if (!(e instanceof HTMLElement) && !(e instanceof SVGElement)) return;
    if (e instanceof HTMLElement && (e.hidden || e.getAttribute('role') === 'tooltip')) return;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const b = e.getBoundingClientRect();
    if (b.width > 0 && b.height > 0) out.push({ x: b.x, y: b.y, w: b.width, h: b.height });
    if (e instanceof HTMLElement) for (const c of Array.from(e.children)) walk(c);
  };
  walk(root);
  return union(out);
}

export function hudCheck(game: Game2D): HudCheck {
  const k = game.dock;
  const fit = game.map.fit as typeof game.map.fit & { shrink?: number };
  const shapes = playfieldShapes(game.level.layout2d!);
  const hr = game.hud.rects();
  const pieces: Record<string, Rect> = {
    plaque: hr.plaque,
    banner: hr.banner,
    waveText: hr.waveText,
    pause: hr.pause,
    speed: hr.speed,
    horn: hr.hornBox,
  };
  const dom: [string, string][] = [
    ['tray', '[data-testid="ab2d-bar"]'],
    ['waveCard', '[data-testid="wave2d-card"]'],
    ['foeCard', '[data-testid="foe2d-card"]'],
  ];
  for (const [name, sel] of dom) {
    const b = domBox(document.querySelector(sel));
    if (b) pieces[name] = b;
  }
  // Codex / Settings round buttons and their captions.
  Array.from(document.querySelectorAll('.pu-codex-btn')).forEach((e, i) => {
    const b = domBox(e);
    if (b) pieces[`round${i}`] = b;
  });
  const slots = dockPieces(k) as Record<string, Rect>;
  const slotOf: Record<string, string> = { plaque: 'plaque', banner: 'banner', waveText: 'banner', pause: 'buttons', speed: 'buttons', horn: 'horn', tray: 'tray', waveCard: 'info', foeCard: 'info' };
  const outside: Record<string, number> = {};
  for (const [name, r] of Object.entries(pieces)) {
    const s = slots[slotOf[name] ?? 'buttons'];
    outside[name] = Math.round(Math.max(0, s.x - r.x, r.x + r.w - (s.x + s.w), s.y - r.y, r.y + r.h - (s.y + s.h)) * 10) / 10;
  }
  const overlaps: HudCheck['overlaps'] = [];
  for (const [name, r] of Object.entries(pieces)) {
    for (const o of shapesOverlap(shapes, fit, r)) overlaps.push({ piece: name, ...o });
  }
  return {
    screen: { w: game.app.screen.width, h: game.app.screen.height },
    form: k.form,
    fit: { scale: fit.scale, offsetX: fit.offsetX, offsetY: fit.offsetY, shrink: fit.shrink ?? 1 },
    pieces: Object.fromEntries(Object.entries(pieces).map(([n, r]) => [n, r4(r)])),
    slots: Object.fromEntries(Object.entries(slots).map(([n, r]) => [n, r4(r)])),
    outside,
    overlaps,
  };
}
