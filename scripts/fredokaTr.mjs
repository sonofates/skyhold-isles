/* global process, console, Buffer */
// Builds the Turkish letters Fredoka lacks (ş Ş ğ Ğ İ) from Fredoka's own parts and writes small
// static fonts that join the 'Fredoka Variable' family by unicode-range (src/render2d/ui/fredokaTr.css):
//   ş Ş = s S + the cedilla of ç Ç (same depth and offset as in ç Ç),
//   ğ Ğ = g G + a breve drawn in Fredoka's stroke (a rounded smile at the height of ü / Ü's dots),
//   İ   = I + one dot of Ö.
// Fredoka's variable font is sampled at each weight the UI uses (fontkit) and written as CFF OpenType
// (opentype.js). Dev-only deps: `npm install --no-save fontkit opentype.js`.
// Usage: node scripts/fredokaTr.mjs [--inspect]
import { writeFileSync, mkdirSync } from 'node:fs';
import * as fontkit from 'fontkit';
import opentype from 'opentype.js';

const SRC = 'node_modules/@fontsource-variable/fredoka/files/fredoka-latin-wght-normal.woff2';
const OUT = 'public/fonts';
const WEIGHTS = [400, 500, 600, 700];
const inspect = process.argv.includes('--inspect');

/** fontkit path → contours (arrays of commands, each starting with moveTo). */
function contours(path) {
  const out = [];
  let cur = null;
  for (const c of path.commands) {
    if (c.command === 'moveTo') {
      cur = [c];
      out.push(cur);
    } else if (cur) cur.push(c);
  }
  return out;
}

function bbox(cs) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of cs) {
    for (let i = 0; i < c.args.length; i += 2) {
      x0 = Math.min(x0, c.args[i]);
      x1 = Math.max(x1, c.args[i]);
      y0 = Math.min(y0, c.args[i + 1]);
      y1 = Math.max(y1, c.args[i + 1]);
    }
  }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

const shift = (cs, dx, dy) => cs.map((c) => ({ command: c.command, args: c.args.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) }));
const sameContour = (a, b) => a.length === b.length && a.every((c, i) => c.command === b[i].command && c.args.every((v, j) => Math.abs(v - b[i].args[j]) < 0.5));

/** Contours of `withMark` that are not in `base` (the mark), e.g. ç minus c = the cedilla. */
function markOf(base, withMark) {
  const b = contours(base.path);
  return contours(withMark.path).filter((c) => !b.some((q) => sameContour(q, c))).flat();
}

/**
 * A breve: a rounded "smile" stroke from angle 200° to 340° on an ellipse, stroke `t`, round caps,
 * as one closed contour of cubic béziers (outer arc, cap, inner arc back, cap).
 */
function breve(cx, cy, w, t) {
  const rx = (w - t) / 2;
  const ry = rx * 0.78;
  const a0 = (200 * Math.PI) / 180;
  const a1 = (340 * Math.PI) / 180;
  const n = 6;
  const pts = (rOff) => {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      out.push([cx + Math.cos(a) * (rx + rOff), cy + ry + Math.sin(a) * (ry + rOff)]);
    }
    return out;
  };
  const outer = pts(t / 2);
  const inner = pts(-t / 2).reverse();
  const cmds = [{ command: 'moveTo', args: outer[0] }];
  // Smooth polyline through the arc points (Catmull-Rom → cubic).
  const spline = (p) => {
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[Math.max(0, i - 1)];
      const p1 = p[i];
      const p2 = p[i + 1];
      const p3 = p[Math.min(p.length - 1, i + 2)];
      cmds.push({ command: 'bezierCurveTo', args: [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]] });
    }
  };
  const cap = (from, to) => {
    // Half circle from `from` to `to` bulging outward (away from the arc's middle).
    const mx = (from[0] + to[0]) / 2;
    const my = (from[1] + to[1]) / 2;
    const r = Math.hypot(to[0] - from[0], to[1] - from[1]) / 2;
    const ux = (from[0] - mx) / r;
    const uy = (from[1] - my) / r;
    // Outward normal: perpendicular, pointing away from the arc centre.
    let nx = -uy;
    let ny = ux;
    if ((mx - cx) * nx + (my - (cy + ry)) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const k = 0.5523 * r;
    const top = [mx + nx * r, my + ny * r];
    cmds.push({ command: 'bezierCurveTo', args: [from[0] + nx * k, from[1] + ny * k, top[0] + ux * k, top[1] + uy * k, top[0], top[1]] });
    cmds.push({ command: 'bezierCurveTo', args: [top[0] - ux * k, top[1] - uy * k, to[0] + nx * k, to[1] + ny * k, to[0], to[1]] });
  };
  spline(outer);
  cap(outer[outer.length - 1], inner[0]);
  spline(inner);
  cap(inner[inner.length - 1], outer[0]);
  cmds.push({ command: 'closePath', args: [] });
  return cmds;
}

function toPath(cmds) {
  const p = new opentype.Path();
  for (const c of cmds) {
    const a = c.args.map((v) => Math.round(v * 10) / 10);
    if (c.command === 'moveTo') p.moveTo(a[0], a[1]);
    else if (c.command === 'lineTo') p.lineTo(a[0], a[1]);
    else if (c.command === 'quadraticCurveTo') p.quadraticCurveTo(a[0], a[1], a[2], a[3]);
    else if (c.command === 'bezierCurveTo') p.bezierCurveTo(a[0], a[1], a[2], a[3], a[4], a[5]);
    else if (c.command === 'closePath') p.close();
  }
  return p;
}

const base = fontkit.openSync(SRC);
mkdirSync(OUT, { recursive: true });
for (const wt of WEIGHTS) {
  const f = base.getVariation({ wght: wt });
  const g = (ch) => f.glyphForCodePoint(ch.codePointAt(0));
  const P = (ch) => g(ch).path.commands;
  // Marks from Fredoka's own accented letters.
  const cedL = markOf(g('c'), g('ç'));
  const cedU = markOf(g('C'), g('Ç'));
  const dotsL = markOf(g('u'), g('ü'));
  const dotsU = markOf(g('O'), g('Ö'));
  const dotU = contours({ commands: dotsU }).sort((a, b) => bbox(a).x0 - bbox(b).x0)[0];
  const cL = bbox(P('c'));
  const cU = bbox(P('C'));
  const bCedL = bbox(cedL);
  const bCedU = bbox(cedU);
  const bDotsL = bbox(dotsL);
  const bDotsU = bbox(dotsU);
  const bDot = bbox(dotU);
  const t = bDot.h * 0.8;
  if (inspect) {
    console.log(wt, { upm: f.unitsPerEm, cL, bCedL, cU, bCedU, bDotsL, bDotsU, bDot, cedLn: contours({ commands: cedL }).length });
  }
  // The cedilla keeps its offset from the letter's horizontal centre in ç / Ç.
  const ced = (letter, cedC, bc, bLetterRef) => {
    const b = bbox(P(letter));
    return shift(cedC, b.cx - bLetterRef.cx, 0);
  };
  const glyphs = [new opentype.Glyph({ name: '.notdef', unicode: undefined, advanceWidth: Math.round(g('s').advanceWidth), path: new opentype.Path() })];
  const add = (name, cp, from, extra) => {
    const src = g(from);
    glyphs.push(new opentype.Glyph({ name, unicode: cp, advanceWidth: Math.round(src.advanceWidth), path: toPath([...src.path.commands, ...extra]) }));
  };
  add('scedilla', 0x15f, 's', ced('s', cedL, bCedL, cL));
  add('Scedilla', 0x15e, 'S', ced('S', cedU, bCedU, cU));
  const gb = bbox(P('g'));
  const Gb = bbox(P('G'));
  // Breve: as wide as the diaeresis pair, its low point where the dots' bottom is.
  add('gbreve', 0x11f, 'g', breve(gb.cx, bDotsL.y0 + t / 2, bDotsL.w * 0.92, t));
  add('Gbreve', 0x11e, 'G', breve(Gb.cx, bDotsU.y0 + t / 2, bDotsU.w * 0.92, t));
  const Ib = bbox(P('I'));
  add('Idotaccent', 0x130, 'I', shift(dotU, Ib.cx - bDot.cx, 0));
  const font = new opentype.Font({
    familyName: 'Fredoka TR',
    styleName: String(wt),
    unitsPerEm: f.unitsPerEm,
    ascender: f.ascent,
    descender: f.descent,
    weightClass: wt,
    glyphs,
  });
  const buf = Buffer.from(font.toArrayBuffer());
  writeFileSync(`${OUT}/fredoka-tr-${wt}.otf`, buf);
  console.log(`${OUT}/fredoka-tr-${wt}.otf`, buf.length, 'bytes');
}
