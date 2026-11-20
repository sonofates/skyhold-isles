// Codex foe detail with kind marks: opens the in-run Codex and shoots the detail of a boss, a flyer
// and an armoured foe (EN + TR).
// Usage: node qa/codexmarks.mjs [--base=..] [--out=/tmp/n2opus-cxm] [--size=1920x1080]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? '/tmp/n2opus-cxm';
const [W, H] = (arg('size') ?? '1920x1080').split('x').map(Number);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let bad = 0;
for (const lang of ['en', 'tr']) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript(() => {
    localStorage.setItem('skyhold_isles_coach2d_v1', '1');
    localStorage.setItem('skyhold2d_coach_v1', 'done');
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  await page.goto(`${BASE}/2d.html?level=i09&hero=bran&lang=${lang}&desktop=1`);
  await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'));
  await page.waitForTimeout(800);
  await page.click('[data-testid="codex2d-open"]');
  await page.waitForSelector('.pu-overlay');
  for (const id of ['boss', 'flyer', 'brute']) {
    await page.click(`[data-testid="codex-tile-${id}"]`);
    await page.waitForTimeout(400);
    const marks = await page.evaluate(() => document.querySelector('.pu-cx-marks')?.dataset.marks ?? null);
    console.log(lang, id, 'marks:', marks);
    if (!marks) bad++;
    const box = await page.evaluate(() => {
      const r = document.querySelector('.pu-cx-tags').closest('.pu-card, .pu-cx-detail, div').getBoundingClientRect();
      return { x: Math.max(0, r.x - 20), y: Math.max(0, r.y - 140), width: Math.min(900, r.width + 40), height: 260 };
    });
    await page.screenshot({ path: `${OUT}/${lang}-${id}.jpg`, type: 'jpeg', quality: 85, clip: box, timeout: 120000 });
  }
  await ctx.close();
}
await browser.close();
console.log(`codex marks: ${bad} missing`);
process.exit(bad ? 1 : 0);
