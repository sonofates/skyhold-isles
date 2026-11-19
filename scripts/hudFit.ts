/**
 * Full-bleed map + corner HUD, every 2D island at the QA screen sizes: how much of the screen the
 * map covers (100 = full bleed), which pieces had to move off their corner home, and any hard
 * overlap left (must be none). Pure math, the same functions the game uses.
 *
 *   npx tsx scripts/hudFit.ts            # table
 *   npx tsx scripts/hudFit.ts --verbose  # per island: coverage, shrink, moved pieces
 *   npx tsx scripts/hudFit.ts --hero --out=docs/fullbleed-shots/report-fit.txt
 */
import { writeFileSync } from 'node:fs';
import { LEVELS_2D } from '../src/data/levels2d/index.ts';
import { fullBleedFit, hardOverlaps, hardShapes } from '../src/render2d/fullBleed.ts';
import { dockPieces, hudDock } from '../src/render2d/hudDock.ts';
import { KIT_PLAQUE_SLOTS, NO_INSETS } from '../src/render2d/uiLayout.ts';

export const QA_SIZES: readonly (readonly [number, number])[] = [
  [1920, 1080],
  [2000, 991],
  [2560, 1080],
  [1366, 768],
  [1600, 900],
  [1440, 900],
  [1680, 1050],
  [844, 390],
  [932, 430],
];

const verbose = !!process.env.VERBOSE || process.argv.includes('--verbose');
const heroOnly = process.argv.includes('--hero');
const outFile = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
const lines: string[] = [];
const log = (t: string): void => {
  lines.push(t);
  console.log(t);
};
const t0 = performance.now();
let fails = 0;
for (const hero of heroOnly ? [true] : [true, false]) {
  for (const [w, h] of QA_SIZES) {
    const home = hudDock(w, h, NO_INSETS, { plaqueAspect: 1024 / 294, plaqueSlots: KIT_PLAQUE_SLOTS, bannerAspect: 512 / 152, hero });
    const line: string[] = [];
    let sum = 0;
    let worst = 1;
    let moved = 0;
    for (const l of LEVELS_2D) {
      const L = l.layout2d!;
      const shapes = hardShapes(L);
      const { fit, dock } = fullBleedFit(w, h, L, home, shapes);
      let ov = 0;
      for (const p of Object.values(dockPieces(dock))) ov += hardOverlaps(shapes, fit, p).length;
      if (ov || !fit.clear) fails++;
      worst = Math.min(worst, fit.coverage);
      sum += fit.coverage;
      const mv: string[] = [];
      if (Math.abs(dock.tray.x - home.tray.x) > 0.5) mv.push(`tray${Math.round(dock.tray.x - home.tray.x)}`);
      if (Math.abs(dock.info.x - home.info.x) > 0.5) mv.push(`info+${Math.round(dock.info.x - home.info.x)}`);
      if (dock.horn.x !== home.horn.x) mv.push('hornL');
      if (mv.length) moved++;
      line.push(`${l.id}:${Math.round(fit.coverage * 100)}${fit.shrink < 0.999 ? `(s${Math.round(fit.shrink * 100)})` : ''}${mv.length && verbose ? `[${mv.join(',')}]` : ''}${ov ? `!${ov}` : ''}${fit.clear ? '' : 'X'}`);
    }
    const r = (q: { w: number; h: number }): string => `${Math.round(q.w)}x${Math.round(q.h)}`;
    log(`${w}x${h}${hero ? ' hero' : ''} d=${home.d} tray=${r(home.tray)} info=${r(home.info)} plaque=${r(home.plaque)} banner=${r(home.banner)} cover avg=${Math.round((sum / LEVELS_2D.length) * 1000) / 10} worst=${Math.round(worst * 1000) / 10} moved=${moved}`);
    log(`  ${line.join(' ')}`);
  }
}
log(`${fails} with overlap / not clear, ${Math.round(performance.now() - t0)} ms`);
if (outFile) writeFileSync(outFile, lines.join('\n') + '\n');
