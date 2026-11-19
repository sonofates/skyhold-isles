/**
 * What each corner piece costs: average map coverage per screen with the full dock, and with one
 * piece moved off screen (so it blocks nothing).
 *   npx tsx scripts/fullbleedCost.ts 1440 900
 */
import { LEVELS_2D } from '../src/data/levels2d/index.ts';
import { fullBleedFit, hardShapes } from '../src/render2d/fullBleed.ts';
import { hudDock, type HudDock } from '../src/render2d/hudDock.ts';
import { KIT_PLAQUE_SLOTS, NO_INSETS } from '../src/render2d/uiLayout.ts';

const w = Number(process.argv[2] ?? 1920);
const h = Number(process.argv[3] ?? 1080);
const home = hudDock(w, h, NO_INSETS, { plaqueAspect: 1024 / 294, plaqueSlots: KIT_PLAQUE_SLOTS, bannerAspect: 512 / 152, hero: true });
const away = { x: -9999, y: -9999, w: 1, h: 1 };
const variants: Record<string, HudDock> = {
  full: home,
  noButtons: { ...home, buttons: away },
  noInfo: { ...home, info: away, infoRange: [-9999, -9999] },
  noPlaque: { ...home, plaque: { ...home.plaque, ...away } },
  noBanner: { ...home, banner: away },
  noHorn: { ...home, hornBox: away, hornAlt: null },
  noTray: { ...home, tray: away, trayRange: [-9999, -9999] },
};
// Horn variants: radius r2, label column above (not left of) the horn, spots.
{
  const b = home.banner;
  const r = home.horn.r;
  const tw = home.hornTextW;
  const boxL = (x: number, y: number, rr: number): { horn: { x: number; y: number; r: number }; hornBox: { x: number; y: number; w: number; h: number } } => ({ horn: { x, y, r: rr }, hornBox: { x: x - rr * 1.2 - tw, y: y - rr * 1.2, w: rr * 2.4 + tw, h: rr * 2.4 } });
  // Text above: a strip ~0.9 r tall over the ring.
  const boxT = (x: number, y: number, rr: number): { horn: { x: number; y: number; r: number }; hornBox: { x: number; y: number; w: number; h: number } } => ({ horn: { x, y, r: rr }, hornBox: { x: x - Math.max(rr * 1.2, tw / 2), y: y - rr * 1.2 - rr * 0.9, w: Math.max(rr * 2.4, tw), h: rr * 2.4 + rr * 0.9 } });
  const bottom = b.y + b.h;
  const g = home.gap;
  // V-overlap: horn standing on the banner's left end (overlapping the rope), text left.
  const ov = boxL(b.x + r * 0.6, bottom - r * 1.2, r);
  variants.hornOnBannerLeft = { ...home, ...ov, hornAlt: null };
  const r2 = Math.max(26, r * 0.8);
  const above2 = boxL(b.x + b.w - r2 * 1.2, b.y - g * 0.4 - r2 * 1.2, r2);
  const left2 = boxL(b.x - g * 0.5 - r2 * 1.2, bottom - r2 * 1.2, r2);
  variants.hornSmall = { ...home, ...above2, hornAlt: left2 };
  const aboveT = boxT(b.x + b.w - r * 1.2, b.y - g * 0.4 - r * 1.2, r);
  const leftT = boxT(b.x - g * 0.5 - r * 1.2, bottom - r * 1.2, r);
  variants.hornTextTop = { ...home, ...aboveT, hornAlt: leftT };
  // Horn left of the banner first (bottom line), above as the alternative.
  variants.hornLeftFirst = { ...home, horn: home.hornAlt!.horn, hornBox: home.hornAlt!.hornBox, hornAlt: { horn: home.horn, hornBox: home.hornBox } };
  // Horn above the banner's middle.
  const mid = boxL(b.x + b.w / 2 + tw / 2, b.y - g * 0.4 - r * 1.2, r);
  variants.hornAboveMid = { ...home, ...mid, hornAlt: home.hornAlt };
}
for (const [name, dock] of Object.entries(variants)) {
  let sum = 0;
  const low: string[] = [];
  for (const l of LEVELS_2D) {
    const L = l.layout2d!;
    const r = fullBleedFit(w, h, L, dock, hardShapes(L));
    sum += r.fit.coverage;
    if (r.fit.coverage < 0.97) low.push(`${l.id}:${Math.round(r.fit.coverage * 100)}`);
  }
  console.log(`${w}x${h} ${name.padEnd(10)} avg ${(Math.round((sum / LEVELS_2D.length) * 1000) / 10).toFixed(1)}  <97: ${low.join(' ')}`);
}
