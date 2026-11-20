/**
 * QA (`window.__p0.hudCheck()`): every HUD piece as it is really drawn — the canvas HUD (plaque,
 * banner, pause / speed, horn with its label and seconds), the DOM buttons with their captions
 * (Codex, Settings), the hero / ability tray and the info cards when shown (next wave, tapped foe,
 * new-foe heads-up) — and what each one covers under the current map fit.
 *
 * Rules (fullBleed.ts): a piece may lie over the map's decorative art, and over a road only where
 * it runs outside the safe area (`outerRoads`, allowed, reported). Over a plot, a cave or the castle
 * (`overlaps`) only where the island leaves no room at the map's default view (`fit.clear` false;
 * the player pans to see it, mapPan.ts) — the QA screens run at the default view, where an overlap
 * is a regression unless `fit.clear` says the island can't clear at that screen.
 */
import type { Game2D } from './game2d.ts';
import { hardOverlaps, hardShapes, type HardKind } from './fullBleed.ts';
import { dockPieces } from './hudDock.ts';
import { playfieldShapes, shapesOverlap } from './playfield.ts';
import type { Rect } from './uiLayout.ts';

export interface HudCheck {
  readonly screen: { w: number; h: number };
  readonly form: string;
  readonly fit: { scale: number; offsetX: number; offsetY: number; shrink: number; coverage: number; clear: boolean; clearButInfo: boolean };
  /** The pan: the view's offset now vs the default view's, and the range (screen px). */
  readonly pan: { atDefault: boolean; x: number; y: number; range: { minX: number; maxX: number; minY: number; maxY: number } };
  /** Drawn pieces (screen px). */
  readonly pieces: Record<string, Rect>;
  /** The dock's slots (screen px). */
  readonly slots: Record<string, Rect>;
  /** Drawn pieces that stick out of their slot (px; ≤ 1 is rounding). */
  readonly outside: Record<string, number>;
  /** Hard: a piece over a plot, cave, castle or a road inside the safe area. */
  readonly overlaps: { piece: string; kind: HardKind; index: number; depth: number }[];
  /** Allowed: a piece over a road where it runs outside the safe area. */
  readonly outerRoads: { piece: string; index: number }[];
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

function intersect(a: Rect, b: Rect | null): Rect | null {
  if (!b) return a;
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * Visible boxes of an element and its descendants (tooltips / hints excluded), unioned. A child
 * inside an `overflow: hidden / clip` parent (a portrait cropped by its round frame) counts only
 * where it shows.
 */
function domBox(root: Element | null): Rect | null {
  if (!root || !(root instanceof HTMLElement) || root.hidden || getComputedStyle(root).display === 'none') return null;
  const out: Rect[] = [];
  const walk = (e: Element, clip: Rect | null): void => {
    if (!(e instanceof HTMLElement) && !(e instanceof SVGElement)) return;
    if (e instanceof HTMLElement && (e.hidden || e.getAttribute('role') === 'tooltip')) return;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const b = e.getBoundingClientRect();
    const own = b.width > 0 && b.height > 0 ? intersect({ x: b.x, y: b.y, w: b.width, h: b.height }, clip) : null;
    if (own) out.push(own);
    const clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
    if (clips && !own) return;
    if (e instanceof HTMLElement) for (const c of Array.from(e.children)) walk(c, clips ? own : clip);
  };
  walk(root, null);
  return union(out);
}

export function hudCheck(game: Game2D): HudCheck {
  const k = game.dock;
  const fit = game.map.fit;
  const fb = game.fullBleed;
  const hard = hardShapes(game.level.layout2d!);
  const all = playfieldShapes(game.level.layout2d!);
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
    ['newFoe', '[data-testid="newfoe2d"]'],
    ['diffBadge', '[data-testid="hud2d-diff"]'],
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
  const slotOf: Record<string, string> = { plaque: 'plaque', banner: 'banner', waveText: 'banner', pause: 'buttons', speed: 'buttons', horn: 'horn', tray: 'tray', waveCard: 'info', foeCard: 'info', newFoe: 'info', diffBadge: 'banner' };
  const outside: Record<string, number> = {};
  for (const [name, r] of Object.entries(pieces)) {
    const s = slots[slotOf[name] ?? 'buttons'];
    outside[name] = Math.round(Math.max(0, s.x - r.x, r.x + r.w - (s.x + s.w), s.y - r.y, r.y + r.h - (s.y + s.h)) * 10) / 10;
  }
  const overlaps: HudCheck['overlaps'] = [];
  const outerRoads: HudCheck['outerRoads'] = [];
  for (const [name, r] of Object.entries(pieces)) {
    const h = hardOverlaps(hard, fit, r);
    for (const o of h) overlaps.push({ piece: name, ...o });
    for (const o of shapesOverlap(all, fit, r)) {
      if (o.kind === 'road' && !h.some((q) => q.kind === 'road' && q.index === o.index)) outerRoads.push({ piece: name, index: o.index });
    }
  }
  return {
    screen: { w: game.app.screen.width, h: game.app.screen.height },
    form: k.form,
    fit: { scale: fit.scale, offsetX: fit.offsetX, offsetY: fit.offsetY, shrink: fb?.shrink ?? 1, coverage: fb?.coverage ?? 1, clear: fb?.clear ?? true, clearButInfo: fb?.clearButInfo ?? true },
    pan: { atDefault: !fb || (Math.abs(fit.offsetX - fb.offsetX) < 0.5 && Math.abs(fit.offsetY - fb.offsetY) < 0.5), x: fit.offsetX, y: fit.offsetY, range: game.pan.range },
    pieces: Object.fromEntries(Object.entries(pieces).map(([n, r]) => [n, r4(r)])),
    slots: Object.fromEntries(Object.entries(slots).map(([n, r]) => [n, r4(r)])),
    outside,
    overlaps,
    outerRoads,
  };
}
