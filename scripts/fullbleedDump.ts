/**
 * Dumps the full-bleed fit + placed dock + hard shapes (JSON) for islands at a screen size, for a
 * quick PIL overlay (scripts/fullbleed_overlay.py).
 *   npx tsx scripts/fullbleedDump.ts 1920 1080 /tmp/fb i07,i12,l1c
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { LEVELS_2D } from '../src/data/levels2d/index.ts';
import { fullBleedFit, hardShapes } from '../src/render2d/fullBleed.ts';
import { dockPieces, hudDock } from '../src/render2d/hudDock.ts';
import { KIT_PLAQUE_SLOTS, NO_INSETS } from '../src/render2d/uiLayout.ts';

const w = Number(process.argv[2] ?? 1920);
const h = Number(process.argv[3] ?? 1080);
const out = process.argv[4] ?? '/tmp/fb';
const ids = (process.argv[5] ?? '').split(',').filter(Boolean);
mkdirSync(out, { recursive: true });
const home = hudDock(w, h, NO_INSETS, { plaqueAspect: 1024 / 294, plaqueSlots: KIT_PLAQUE_SLOTS, bannerAspect: 512 / 152, hero: true });
for (const l of LEVELS_2D) {
  if (ids.length && !ids.includes(l.id)) continue;
  const L = l.layout2d!;
  const shapes = hardShapes(L);
  const { fit, dock } = fullBleedFit(w, h, L, home, shapes);
  writeFileSync(`${out}/${l.id}-${w}x${h}.json`, JSON.stringify({ id: l.id, image: L.image, imageSize: L.imageSize, w, h, fit, pieces: dockPieces(dock), home: dockPieces(home), shapes }));
}
