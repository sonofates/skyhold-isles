/**
 * Builds the tiny placeholder walk sheets (public/art2d/anim/placeholder-walk-{down,up}.png/.json)
 * that exercise the 2D renderer's "sheet" animation path until the Veo walk cycles arrive.
 * Frames are the raider sprite, downscaled, with a per-frame hop and a leg-region shear; the "up"
 * sequence is darkened as a stand-in for a back view. Run: npx tsx scripts/makePlaceholderSheet.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePng, encodePng, type RawImage } from './lib/png.ts';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = resolve(ROOT, 'public/art2d/enemy-raider.png');
const OUT = resolve(ROOT, 'public/art2d/anim');
const FRAME = 128;
const COUNT = 6;

function sample(img: RawImage, x: number, y: number, c: number): number {
  const xi = Math.max(0, Math.min(img.width - 1, Math.floor(x)));
  const yi = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
  return img.data[(yi * img.width + xi) * 4 + c];
}

function makeSheet(src: RawImage, darken: number): RawImage {
  const out: RawImage = { width: FRAME * COUNT, height: FRAME, data: new Uint8Array(FRAME * COUNT * FRAME * 4) };
  const scale = Math.max(src.width, src.height) / (FRAME - 8);
  for (let f = 0; f < COUNT; f++) {
    const t = (f / COUNT) * Math.PI * 2;
    const hop = Math.abs(Math.sin(t)) * 5;
    const shear = Math.sin(t) * 0.18;
    for (let y = 0; y < FRAME; y++) {
      for (let x = 0; x < FRAME; x++) {
        // Lower 40 % of the body (legs) shears back and forth with the step.
        const legW = Math.max(0, (y - FRAME * 0.6) / (FRAME * 0.4));
        const sx = (x - FRAME / 2 - shear * legW * (y - FRAME * 0.6)) * scale + src.width / 2;
        const sy = (y - (FRAME - 4 - src.height / scale) + hop) * scale;
        const o = (y * out.width + f * FRAME + x) * 4;
        const a = sx < 0 || sy < 0 || sx >= src.width || sy >= src.height ? 0 : sample(src, sx, sy, 3);
        out.data[o] = sample(src, sx, sy, 0) * darken;
        out.data[o + 1] = sample(src, sx, sy, 1) * darken;
        out.data[o + 2] = sample(src, sx, sy, 2) * darken;
        out.data[o + 3] = a;
      }
    }
  }
  return out;
}

const src = decodePng(readFileSync(SRC));
for (const [name, darken] of [['down', 1], ['up', 0.62]] as const) {
  const file = `placeholder-walk-${name}`;
  writeFileSync(resolve(OUT, `${file}.png`), encodePng(makeSheet(src, darken)));
  const json = { image: `${file}.png`, frameW: FRAME, frameH: FRAME, count: COUNT, cols: COUNT, fps: 10, anchor: [0.5, 0.97] };
  writeFileSync(resolve(OUT, `${file}.json`), JSON.stringify(json, null, 2) + '\n');
  console.log(`wrote anim/${file}.png/.json`);
}
