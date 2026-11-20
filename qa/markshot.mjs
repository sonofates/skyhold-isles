// Foe kind marks on the next-wave card: finds a wave whose chips carry marks and shoots the card.
// Usage: node qa/markshot.mjs [--base=..] [--out=docs/overnight2/opus-shots/marks.jpg] [--size=1920x1080]
import { chromium } from 'playwright';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? '/tmp/marks.jpg';
const [W, H] = (arg('size') ?? '1920x1080').split('x').map(Number);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
await page.addInitScript(() => {
  localStorage.setItem('skyhold_isles_coach2d_v1', '1');
  localStorage.setItem('skyhold2d_coach_v1', 'done');
});
let found = null;
const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
for (const isl of IDS) {
  await page.goto(`${BASE}/2d.html?level=${isl}&hero=bran&lang=en&desktop=1`);
  await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const marks = await page.evaluate(() => [...document.querySelectorAll('.pu-wave-chip .pu-foe-marks')].map((m) => m.dataset.marks));
  if (marks.length >= 1) {
    found = { isl, marks };
    break;
  }
}
console.log('found', JSON.stringify(found));
if (found) {
  await page.evaluate(() => window.__p0.freeze(true));
  const r = await page.evaluate(() => {
    const c = document.querySelector('.pu-wave-chips').closest('.pu').getBoundingClientRect();
    return { x: Math.max(0, c.x - 10), y: Math.max(0, c.y - 10), width: c.width + 20, height: c.height + 20 };
  });
  await page.screenshot({ path: OUT, clip: r, type: 'jpeg', quality: 85 });
}
await browser.close();
