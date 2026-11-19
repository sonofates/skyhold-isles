// Debug: the caves / castle rects (screen) and the dock slots on one island, to see why the horn
// finds no spot beside the cave. Usage: node qa/horndebug.mjs --island=i02 [--size=1920x1080]
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const [w, h] = (arg('size') ?? '1920x1080').split('x').map(Number);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
await page.goto(`${BASE}/2d.html?level=${arg('island') ?? 'i02'}&hero=bran&lang=en&desktop=1`);
await page.waitForFunction(() => window.__p0?.hudCheck && !document.getElementById('boot'), null, { timeout: 60000 });
await page.waitForTimeout(500);
const r = await page.evaluate(() => {
  const p = window.__p0;
  const hc = p.hudCheck();
  return { gates: p.gates(), slots: hc.slots, horn: p.state().horn, spot: p.state().hornSpot, fit: hc.fit };
});
console.log(JSON.stringify(r, (k, v) => (typeof v === 'number' ? Math.round(v) : v)));
await browser.close();
