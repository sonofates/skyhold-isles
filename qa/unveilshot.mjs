// World map unveil of a newly reached island: freezes the unveil animations at a few moments and
// shoots the island, then reloads and checks the unveil does not play again.
// Usage: node qa/unveilshot.mjs [--base=..] [--out=/tmp/n2opus-unveil] [--size=1920x1080]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? '/tmp/n2opus-unveil';
const [W, H] = (arg('size') ?? '1920x1080').split('x').map(Number);
mkdirSync(OUT, { recursive: true });
const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const pad = (a, v) => [...a, ...Array(Math.max(0, 25 - a.length)).fill(v)];
const SEED = JSON.stringify({ ids: IDS, progress: { version: 2, unlockedLevelIndex: 4, bestStars: pad([3, 2, 3, 1], 0), clears: pad([2, 1, 1, 1], 0) } });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
await ctx.addInitScript((s) => {
  if (sessionStorage.getItem('qa-seeded')) return;
  sessionStorage.setItem('qa-seeded', '1');
  localStorage.setItem('skyhold_isles_progress2d_v1', s);
  localStorage.setItem('skyhold2d_map_unlock_seen_v1', '3');
}, SEED);
const page = await ctx.newPage();
page.setDefaultTimeout(90000);
let bad = 0;
await page.goto(`${BASE}/2d.html?lang=en`);
await page.waitForSelector('[data-testid="map2d-island-i04"]');
const has = await page.evaluate(() => {
  const b = document.querySelector('[data-testid="map2d-island-i04"]');
  const anims = document.getAnimations().filter((a) => b.contains(a.effect?.target));
  for (const a of anims) a.pause();
  return { unveil: b.classList.contains('unveil'), anims: anims.length };
});
console.log('first visit', JSON.stringify(has));
if (!has.unveil) bad++;
const clip = await page.evaluate(() => {
  const r = document.querySelector('[data-testid="map2d-island-i04"]').getBoundingClientRect();
  return { x: Math.max(0, r.x - r.width * 0.4), y: Math.max(0, r.y - r.height * 0.45), width: r.width * 1.8, height: r.height * 1.9 };
});
for (const ms of [500, 1100, 1700, 2100, 2350, 2700, 3200]) {
  await page.evaluate((t) => {
    const b = document.querySelector('[data-testid="map2d-island-i04"]');
    for (const a of document.getAnimations()) {
      if (!b.contains(a.effect?.target)) continue;
      a.pause();
      a.currentTime = t;
    }
  }, ms);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/unveil-${ms}.png`, clip, timeout: 120000 });
}
// Second visit: nothing new, no unveil.
await page.reload();
await page.waitForSelector('[data-testid="map2d-island-i04"]');
const again = await page.evaluate(() => document.querySelector('[data-testid="map2d-island-i04"]').classList.contains('unveil'));
console.log('second visit unveil', again);
if (again) bad++;
await browser.close();
console.log(`unveil: ${bad} problems`);
process.exit(bad ? 1 : 0);
