import { describe, expect, it } from 'vitest';
import { ALL_TOWER_TYPES } from '../../src/data/towers.ts';
import { computeStarRating } from '../../src/sim/world.ts';
import {
  END_FRAME,
  endLayout,
  endStars,
  KIT_PLAQUE_SLOTS,
  evenAngles,
  layoutRadial,
  NO_INSETS,
  placeTooltip,
  plaqueLayout,
  ringRadius,
  statRows,
  tokenRect,
  towerRingAngles,
  type Insets,
  type Pt,
  type Rect,
} from '../../src/render2d/uiLayout.ts';

const inside = (r: Rect, w: number, h: number, ins: Insets = NO_INSETS, tol = 1e-6): boolean =>
  r.x >= ins.left - tol && r.y >= ins.top - tol && r.x + r.w <= w - ins.right + tol && r.y + r.h <= h - ins.bottom + tol;
const overlap = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** The six viewports the UI is QA'd at (css px), plus a notched phone in landscape. */
const VIEWS: readonly [string, number, number, Insets][] = [
  ['2000x1035', 2000, 1035, NO_INSETS],
  ['1600x900', 1600, 900, NO_INSETS],
  ['1280x720', 1280, 720, NO_INSETS],
  ['2560x1080', 2560, 1080, NO_INSETS],
  ['915x412', 915, 412, NO_INSETS],
  ['844x390', 844, 390, NO_INSETS],
  ['844x390 notch', 844, 390, { top: 0, right: 47, bottom: 21, left: 47 }],
];

/** Medallion radius the ring uses for a viewport (mirrors BuildRing.sizeFor). */
const tokenRFor = (w: number, h: number): number => Math.max(25, 36 * Math.max(0.5, Math.min(1.4, Math.min(w / 1400, h / 760))));

describe('radial ring placement', () => {
  it('spaces 8 medallions (with price tags) without overlap and keeps touch targets >= 44 px', () => {
    for (const r of [25, 36, 43]) {
      const angles = evenAngles(8);
      const R = ringRadius(angles, r, r * 0.62);
      const chord = 2 * R * Math.sin(Math.PI / 8);
      expect(chord).toBeGreaterThanOrEqual(2 * r + 8);
      expect(2 * r).toBeGreaterThanOrEqual(44);
    }
  });

  it('starts at the top and goes clockwise', () => {
    const a = evenAngles(4);
    expect(a[0]).toBeCloseTo(-Math.PI / 2, 9);
    expect(a[1]).toBeCloseTo(0, 9); // right
    expect(a[2]).toBeCloseTo(Math.PI / 2, 9); // bottom
  });

  it('stays on screen (and inside the safe area) wherever the plot is, without squashing', () => {
    for (const [, w, h, ins] of VIEWS) {
      const r = tokenRFor(w, h);
      const tag = r * 0.62;
      const angles = evenAngles(8);
      const R = ringRadius(angles, r, tag);
      for (let cy = 0; cy <= h; cy += h / 9) {
        for (let cx = 0; cx <= w; cx += w / 13) {
          const out: Pt[] = [];
          const lay = layoutRadial(cx, cy, angles, r, tag, w, h, ins, out);
          expect(out).toHaveLength(8);
          expect(lay.radius).toBeCloseTo(R, 9);
          for (const p of out) {
            expect(inside({ x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r + tag * 0.75 }, w, h, ins)).toBe(true);
            expect(Math.hypot(p.x - lay.cx, p.y - lay.cy)).toBeCloseTo(R, 6);
          }
        }
      }
    }
  });

  it('only shifts as much as needed: a centred plot keeps its ring centred on it', () => {
    const out: Pt[] = [];
    const lay = layoutRadial(800, 450, evenAngles(8), 40, 25, 1600, 900, NO_INSETS, out);
    expect(lay.cx).toBe(800);
    expect(lay.cy).toBe(450);
  });

  it('a top-row plot on a phone pushes the ring down; a bottom-edge plot pushes it up', () => {
    const out: Pt[] = [];
    const r = tokenRFor(844, 390);
    const topLay = layoutRadial(400, 20, evenAngles(8), r, r * 0.62, 844, 390, NO_INSETS, out);
    expect(topLay.cy).toBeGreaterThan(20);
    const botLay = layoutRadial(400, 385, evenAngles(8), r, r * 0.62, 844, 390, NO_INSETS, out);
    expect(botLay.cy).toBeLessThan(385);
  });

  it('honours a minimum radius (tower ring clears the built tower)', () => {
    const out: Pt[] = [];
    const lay = layoutRadial(800, 450, [-Math.PI / 2, (5 * Math.PI) / 6, Math.PI / 6], 40, 25, 1600, 900, NO_INSETS, out, 6, 122);
    expect(lay.radius).toBe(122);
    expect(out[0].y).toBeCloseTo(450 - 122, 6);
  });
});

describe('ring tooltip placement', () => {
  it('sits beside the ring, fully on screen and clear of the ring, at every QA viewport', () => {
    for (const [name, w, h, ins] of VIEWS) {
      const r = tokenRFor(w, h);
      const tipW = Math.round(236 * Math.max(0.62, Math.min(1.35, Math.min(w / 1400, h / 760))));
      const tipH = Math.round(tipW * 0.55);
      for (const fx of [0.08, 0.3, 0.5, 0.7, 0.92]) {
        for (const fy of [0.05, 0.5, 0.95]) {
          const out: Pt[] = [];
          const lay = layoutRadial(w * fx, h * fy, evenAngles(8), r, r * 0.62, w, h, ins, out);
          const tip = placeTooltip(lay.box, tipW, tipH, w, h, ins);
          expect(inside(tip, w, h, ins), `${name} ${fx},${fy}`).toBe(true);
          expect(overlap(tip, lay.box), `${name} ${fx},${fy} covers the ring`).toBe(0);
        }
      }
    }
  });

  it('prefers the right side, then the left', () => {
    const ring = { x: 600, y: 300, w: 300, h: 300 };
    expect(placeTooltip(ring, 220, 120, 1600, 900, NO_INSETS).side).toBe('right');
    expect(placeTooltip({ ...ring, x: 1250 }, 220, 120, 1600, 900, NO_INSETS).side).toBe('left');
  });

  it('falls back to the least-covering on-screen spot when nothing fits', () => {
    const tip = placeTooltip({ x: 10, y: 10, w: 380, h: 280 }, 200, 120, 400, 300, NO_INSETS);
    expect(tip.side).toBe('clamped');
    expect(inside(tip, 400, 300)).toBe(true);
  });
});

describe('lives + gold plaque', () => {
  const aspect = 1024 / 294;
  it('never clips at any QA aspect ratio and stays inside the safe area', () => {
    for (const [name, w, h, ins] of VIEWS) {
      const p = plaqueLayout(w, h, ins, aspect, KIT_PLAQUE_SLOTS);
      expect(inside(p, w, h, ins), name).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(ins.left + 8);
      expect(p.w).toBeLessThanOrEqual((w - ins.left - ins.right) * 0.4 + 1e-6);
      // Number slots inside the plaque, readable font.
      for (const b of [p.livesBox, p.goldBox]) expect(inside(b, p.x + p.w, p.y + p.h)).toBe(true);
      expect(p.livesBox.x).toBeGreaterThanOrEqual(p.x);
      expect(p.fontSize).toBeGreaterThanOrEqual(15);
    }
  });

  it('moves with the notch: left inset shifts the plaque right, bottom inset lifts it', () => {
    const a = plaqueLayout(844, 390, NO_INSETS, aspect, KIT_PLAQUE_SLOTS);
    const b = plaqueLayout(844, 390, { top: 0, right: 47, bottom: 21, left: 47 }, aspect, KIT_PLAQUE_SLOTS);
    expect(b.x - a.x).toBeCloseTo(47, 6);
    expect(a.y - b.y).toBeCloseTo(21, 6);
  });

  it('keeps the gold slot wide enough for 4 digits', () => {
    for (const [, w, h, ins] of VIEWS) {
      const p = plaqueLayout(w, h, ins, aspect, KIT_PLAQUE_SLOTS);
      // A bold rounded digit is ~0.62 em wide: 4 digits at >= 60% scale must fit.
      expect(p.goldBox.w).toBeGreaterThanOrEqual(4 * 0.62 * p.fontSize * 0.6);
    }
  });
});

describe('end panel', () => {
  const frame = END_FRAME;
  it('fits inside the safe area with >= 44 px buttons and the stars inside the parchment', () => {
    for (const [name, w, h, ins] of VIEWS) {
      const L = endLayout(w, h, ins, 1024 / 674, frame);
      expect(inside(L.panel, w, h, ins), name).toBe(true);
      expect(L.buttonR * 2).toBeGreaterThanOrEqual(44);
      const top = L.panel.y + L.panel.h * frame.innerTop;
      const bottom = L.panel.y + L.panel.h * frame.innerBottom;
      for (const s of L.stars) {
        expect(s.y - L.starR * 1.15).toBeGreaterThanOrEqual(top - 1e-6);
      }
      for (const b of L.buttons) expect(b.y + L.buttonR * 1.38 + L.fontBody * 0.5).toBeLessThanOrEqual(bottom + L.panel.h * 0.06);
    }
  });
});

describe('stars on the end panel', () => {
  it('uses the sim rating on a win and none on a defeat', () => {
    expect(endStars(true, computeStarRating(20, 'Breezy', 20))).toBe(3);
    expect(endStars(true, computeStarRating(18, 'Breezy', 20))).toBe(3);
    expect(endStars(true, computeStarRating(17, 'Breezy', 20))).toBe(2);
    expect(endStars(true, computeStarRating(10, 'Breezy', 20))).toBe(2);
    expect(endStars(true, computeStarRating(9, 'Breezy', 20))).toBe(1);
    expect(endStars(true, computeStarRating(1, 'Breezy', 20))).toBe(1);
    expect(endStars(false, 3)).toBe(0);
  });
});

describe('tooltip stat pips', () => {
  it('gives every tower three 0..5 rows that never drop when upgrading', () => {
    for (const type of ALL_TOWER_TYPES) {
      for (const tier of [1, 2] as const) {
        const a = statRows(type, tier);
        const b = statRows(type, (tier + 1) as 2 | 3);
        expect(a).toHaveLength(3);
        for (let i = 0; i < 3; i++) {
          expect(a[i].pips).toBeGreaterThanOrEqual(0);
          expect(a[i].pips).toBeLessThanOrEqual(5);
          expect(b[i].pips).toBeGreaterThanOrEqual(a[i].pips);
        }
      }
    }
  });

  it('ranks the obvious extremes', () => {
    expect(statRows('mortar', 1)[1].pips).toBeGreaterThan(statRows('frost', 1)[1].pips); // range
    expect(statRows('archer', 1)[2].pips).toBeGreaterThan(statRows('mortar', 1)[2].pips); // speed
    expect(statRows('ballista', 1)[0].pips).toBeGreaterThan(statRows('frost', 1)[0].pips); // damage
  });
});

describe('tower ring (built tower in the middle)', () => {
  const towerBox = (px: number, py: number, r: number): Rect => ({ x: px - 1.1 * r, y: py - 2.7 * r, w: 2.2 * r, h: 2.9 * r });
  const hits = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  it('never covers the tower and stays on screen, wherever the plot is (incl. top row, bottom edge, corners)', () => {
    for (const [name, w, h, ins] of VIEWS) {
      const r = tokenRFor(w, h);
      const tag = r * 0.62;
      for (const count of [2, 3]) {
        for (let px = w * 0.04; px <= w * 0.96; px += w / 17) {
          for (let py = 2.8 * r; py <= h - 4; py += h / 11) {
            const k = towerBox(px, py, r);
            const cy = k.y + k.h * 0.55;
            const radius = Math.max(r * 3.05, k.h * 0.55 + r * 1.5 + 4);
            const angles = towerRingAngles(count, px, cy, r, tag, radius, w, h, ins, k);
            const out: Pt[] = [];
            layoutRadial(px, cy, angles, r, tag, w, h, ins, out, 6, radius);
            for (const p of out) {
              const tr = tokenRect(p.x, p.y, r, tag);
              expect(inside(tr, w, h, ins, 0.01), `${name} ${count} @${px.toFixed(0)},${py.toFixed(0)} off screen`).toBe(true);
              expect(hits(tr, k), `${name} ${count} @${px.toFixed(0)},${py.toFixed(0)} covers the tower`).toBe(false);
            }
          }
        }
      }
    }
  });

  it('keeps upgrade on top for a mid-screen tower and flips it below on a top-row plot', () => {
    const r = 40;
    const mid = towerBox(800, 500, r);
    const a = towerRingAngles(3, 800, mid.y + mid.h * 0.55, r, 25, 125, 1600, 900, NO_INSETS, mid);
    expect(a[0]).toBeCloseTo(-Math.PI / 2, 6);
    const top = towerBox(800, 120, r);
    const b = towerRingAngles(3, 800, top.y + top.h * 0.55, r, 25, 125, 1600, 900, NO_INSETS, top);
    expect(Math.sin(b[0])).toBeGreaterThan(0.5); // upgrade below the tower
    expect(Math.abs(Math.sin(b[1])) + Math.abs(Math.sin(b[2]))).toBeLessThan(1e-9); // the others beside it
  });
});
