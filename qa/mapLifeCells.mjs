// Map-life surface cells: pixel-equality check (docs/handoff-perf.md). ONE Chromium:
//   python3 qa/withPreview.py --port=4396 node qa/mapLifeCells.mjs [--islands=i01,i36,i42] [--out=dir]
// The surface pass (wind / water / haze) now draws only the grid cells its masks touch instead of
// a full-map quad whose masked-out fragments were discarded. On a frozen frame this renders the
// same island both ways (`__p0.mapLifeFullQuad`) and requires identical pixels.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const base = arg('base', 'http://127.0.0.1:4381');
const islands = arg('islands', 'i01,i36,i42').split(',');
const out = arg('out', '');
if (out) mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const results = [];
let bad = 0;
try {
  const page = await browser.newPage({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 2 });
  for (const id of islands) {
    await page.goto(`${base}/2d.html?level=${id}&quality=high`);
    await page.waitForFunction(() => {
      const m = window.__p0?.mapLife?.();
      return m && (m.swayReady || m.waterReady || m.hazeReady);
    }, null, { timeout: 180000 });
    await page.waitForTimeout(1500);
    const cells = await page.evaluate(() => {
      window.__p0.freeze(true);
      window.__p0.stepMapLife(0.05);
      return window.__p0.mapLife().surfaceCells;
    });
    // Read the WebGL canvas in the same task as its render (DOM overlays and CSS animations are
    // not part of it, and the drawing buffer is still valid).
    const grab = (full) => page.evaluate((f) => {
      window.__p0.mapLifeFullQuad(f);
      return document.querySelector('canvas').toDataURL('image/png');
    }, full).then((u) => Buffer.from(u.split(',')[1], 'base64'));
    const a = await grab(false);
    const b = await grab(true);
    const c = await grab(false);
    const same = Buffer.compare(a, b) === 0;
    const stable = Buffer.compare(a, c) === 0;
    if (out) {
      writeFileSync(`${out}/${id}-cells.png`, a);
      if (!same) writeFileSync(`${out}/${id}-quad.png`, b);
    }
    if (!same || !stable) bad++;
    results.push({ id, cells, identical: same, stable });
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ results, bad }));
process.exit(bad ? 1 : 0);
