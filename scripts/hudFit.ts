/**
 * HUD dock vs playfield, every 2D island at the QA screen sizes: how much each map shrinks to keep
 * its roads / plots / caves / castle out from under the HUD (100 = not at all), and any exact
 * overlap left (must be none). Pure math, the same functions the game uses.
 *
 *   npx tsx scripts/hudFit.ts            # table
 *   WUP=1.5 TUP=2.6 npx tsx scripts/hudFit.ts   # other walker / tower headroom (fit only)
 */
import { LEVELS_2D } from '../src/data/levels2d/index.ts';
import { hudDock } from '../src/render2d/hudDock.ts';
import { playfieldBoxes, playfieldShapes, PLAYFIELD_HEADROOM, shapesOverlap } from '../src/render2d/playfield.ts';
import { KIT_PLAQUE_SLOTS, NO_INSETS } from '../src/render2d/uiLayout.ts';
import { fitAroundHud } from '../src/render2d/viewFit.ts';

export const QA_SIZES: readonly (readonly [number, number])[] = [
  [1920, 1080],
  [2560, 1080],
  [1366, 768],
  [1600, 900],
  [844, 390],
  [932, 430],
];

const walkerUp = Number(process.env.WUP ?? PLAYFIELD_HEADROOM.walkerUp);
const towerUp = Number(process.env.TUP ?? PLAYFIELD_HEADROOM.towerUp);
const t0 = performance.now();
let worst = 1;
let fails = 0;
for (const hero of [true, false]) {
  for (const [w, h] of QA_SIZES) {
    const dock = hudDock(w, h, NO_INSETS, { plaqueAspect: 1024 / 294, plaqueSlots: KIT_PLAQUE_SLOTS, bannerAspect: 512 / 152, hero });
    const line: string[] = [];
    let sum = 0;
    for (const l of LEVELS_2D) {
      const L = l.layout2d!;
      const shapes = playfieldShapes(L);
      const only = process.env.PIECES?.split(',').map(Number);
      const reserved = only ? dock.reserved.filter((_, i) => only.includes(i)) : dock.reserved;
      const fit = fitAroundHud(w, h, L.imageSize[0], L.imageSize[1], L.safeArea, playfieldBoxes(shapes, { walkerUp, towerUp }), reserved);
      let ov = 0;
      for (const p of [dock.buttons, dock.info, dock.plaque, dock.banner, dock.hornBox, dock.tray]) ov += shapesOverlap(shapes, fit, p).length;
      if (ov || !fit.clear) fails++;
      worst = Math.min(worst, fit.shrink);
      sum += fit.shrink;
      line.push(`${l.id}:${Math.round(fit.shrink * 100)}${ov ? `!${ov}` : ''}`);
    }
    const r = (q: { w: number; h: number }): string => `${Math.round(q.w)}x${Math.round(q.h)}`;
    console.log(`${w}x${h}${hero ? ' hero' : ''} d=${dock.d} tray=${r(dock.tray)} info=${r(dock.info)} avg=${Math.round((sum / LEVELS_2D.length) * 100)}`);
    console.log(`  ${line.join(' ')}`);
  }
}
console.log(`walkerUp ${walkerUp} towerUp ${towerUp}: worst ${Math.round(worst * 100)} %, ${fails} with overlap, ${Math.round(performance.now() - t0)} ms`);
