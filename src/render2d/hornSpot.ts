/**
 * Where the horn stands (pure, no Pixi / DOM): beside the cave the next wave marches out of, so
 * "call the next wave" reads as "they come from here" (owner feedback 2026-11-19: the horn in the
 * bottom-right corner, far from the caves, did not feel right).
 *
 * The horn piece is the horn, its countdown ring, the label ("Start!" / "+25" early-call bonus) and
 * the seconds: above / below the horn, or beside it where a dense island has no room for that.
 * Spots are tried on rings around the cave's mouth (where the road leaves the cave), nearest first,
 * with a small cost for standing in front of the mouth (where the road and the foes go). A spot
 * must keep the whole piece on screen (inside the safe insets), off the dock's other pieces, and
 * follow the hudCheck rules: never over a plot, a cave, the castle, a road inside the safe area or
 * any road's mouth (game2d.ts). When none is clear the horn keeps its dock spot (hudDock.ts),
 * which the map fit always keeps clear.
 */
import type { Seg } from './playfield.ts';
import type { Rect } from './uiLayout.ts';

export interface HornLabelSize {
  /** Label above the horn ("Start!" / "+25"): width and height (css px). */
  readonly labelW: number;
  readonly labelH: number;
  /** Seconds under the horn ("12 s"). */
  readonly secsH: number;
}

/** The label and seconds above / below the horn ('stack'), or beside it on its left / right. */
export type HornShape = 'stack' | 'left' | 'right';

export interface HornPlacement {
  readonly horn: { readonly x: number; readonly y: number; readonly r: number };
  /** The whole piece: ring, label and seconds. */
  readonly hornBox: Rect;
  readonly shape: HornShape;
}

/** The piece's box with the label and the seconds beside the horn (one short block). */
export function hornSideBox(x: number, y: number, r: number, s: HornLabelSize, side: 'left' | 'right'): Rect {
  const ring = r * 1.22;
  const tw = s.labelW + 4;
  return { x: side === 'left' ? x - ring - tw : x - ring, y: y - ring, w: ring * 2 + tw, h: ring * 2 };
}

/** The piece's box for a horn of radius `r` at (x, y), the label above and the seconds below. */
export function hornStackBox(x: number, y: number, r: number, s: HornLabelSize): Rect {
  const ring = r * 1.22;
  const half = Math.max(ring, s.labelW / 2 + 2);
  const top = y - ring - s.labelH;
  return { x: x - half, y: top, w: half * 2, h: ring * 2 + s.labelH + s.secsH };
}

/** Label centre above / seconds centre below the horn (for the Hud's layout). */
export function hornStackText(y: number, r: number, s: HornLabelSize): { labelY: number; secsY: number } {
  const ring = r * 1.22;
  return { labelY: y - ring - s.labelH / 2 + 1, secsY: y + ring + s.secsH / 2 };
}

export interface HornSearch {
  /** The cave mouth (screen px): the next wave's road starts here. */
  readonly mouth: { readonly x: number; readonly y: number };
  /** Direction the road leaves the mouth (screen px, any length). */
  readonly out: { readonly x: number; readonly y: number };
  readonly r: number;
  readonly size: HornLabelSize;
  /** Where the piece may be (the screen inside the safe insets and a margin). */
  readonly bounds: Rect;
  /** True when the piece's box at that spot would cover something it must not. */
  readonly blocked: (box: Rect) => boolean;
}

/** Ring distances (× r) and the number of directions tried on each. */
const RINGS = [1.5, 2, 2.6, 3.3, 4.1, 5, 6, 7.2];
const DIRS = 24;

export function hornNearCave(q: HornSearch): HornPlacement | null {
  const ol = Math.hypot(q.out.x, q.out.y) || 1;
  const ox = q.out.x / ol;
  const oy = q.out.y / ol;
  const cand: { cost: number; x: number; y: number }[] = [];
  for (const k of RINGS) {
    const dist = k * q.r;
    for (let i = 0; i < DIRS; i++) {
      const a = (i / DIRS) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      // In front of the mouth costs a little (the road and the foes go that way); beside or
      // behind it reads as "at the cave".
      const front = Math.max(0, dx * ox + dy * oy);
      cand.push({ cost: dist * (1 + front * 0.35), x: q.mouth.x + dx * dist, y: q.mouth.y + dy * dist });
    }
  }
  cand.sort((a, b) => a.cost - b.cost);
  const B = q.bounds;
  // The label above reads best; where that does not fit, the label beside the horn (the side
  // away from the mouth first).
  for (const c of cand) {
    const away: 'left' | 'right' = c.x < q.mouth.x ? 'left' : 'right';
    const shapes: [HornShape, Rect][] = [
      ['stack', hornStackBox(c.x, c.y, q.r, q.size)],
      [away, hornSideBox(c.x, c.y, q.r, q.size, away)],
      [away === 'left' ? 'right' : 'left', hornSideBox(c.x, c.y, q.r, q.size, away === 'left' ? 'right' : 'left')],
    ];
    for (const [shape, box] of shapes) {
      if (box.x < B.x || box.y < B.y || box.x + box.w > B.x + B.w || box.y + box.h > B.y + B.h) continue;
      if (q.blocked(box)) continue;
      return { horn: { x: c.x, y: c.y, r: q.r }, hornBox: box, shape };
    }
  }
  return null;
}

/** Rect overlap with a margin (px). */
export function rectsTouch(a: Rect, b: Rect, m = 0): boolean {
  return a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
}

/**
 * The first `len` (image px) of every road from its cave: the road's mouth, which the horn must
 * never cover even where it runs outside the safe area (pure).
 */
export function roadMouths(paths: readonly (readonly { readonly x: number; readonly y: number }[])[], len: number): Seg[] {
  const out: Seg[] = [];
  for (const p of paths) {
    let left = len;
    for (let i = 1; i < p.length && left > 0; i++) {
      const a = p[i - 1];
      const b = p[i];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      const k = l > left ? left / l : 1;
      out.push({ ax: a.x, ay: a.y, bx: a.x + (b.x - a.x) * k, by: a.y + (b.y - a.y) * k });
      left -= l;
    }
  }
  return out;
}
