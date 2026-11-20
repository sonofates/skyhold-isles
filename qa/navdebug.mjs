// One-off nav debugging: rects of the map's islands / page buttons and where → from island N lands.
// Usage: node qa/navdebug.mjs [--base=..] [--size=844x390] [--q=?screen=brief&island=3&diff=hard] [--from=testid] [--keys=ArrowRight,ArrowRight]
import { chromium } from 'playwright';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const [W, H] = (arg('size') ?? '844x390').split('x').map(Number);
const Q = arg('q') ?? '';
const FROM = arg('from') ?? 'map2d-island-i10';
const KEYS = (arg('keys') ?? 'ArrowRight').split(',');
const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const pad = (a, v) => [...a, ...Array(Math.max(0, 25 - a.length)).fill(v)];
const SEED = JSON.stringify({ ids: IDS, progress: { version: 2, unlockedLevelIndex: 9, bestStars: pad([3, 3, 2, 3, 1, 2, 3, 2, 3], 0), clears: pad([2, 1, 1, 1, 1, 1, 1, 1, 1], 0), heroes: { selectedHero: 'bran', roster: { bran: { xp: 3200, skills: [] } } } } });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
await ctx.addInitScript((s) => {
  if (sessionStorage.getItem('qa-seeded')) return;
  sessionStorage.setItem('qa-seeded', '1');
  localStorage.setItem('skyhold_isles_progress2d_v1', s);
}, SEED);
const page = await ctx.newPage();
page.setDefaultTimeout(90000);
await page.goto(`${BASE}/2d.html${Q || '?'}${Q ? '&' : ''}lang=tr&desktop=1`);
await page.waitForSelector('[data-testid="worldmap2d"] .pu-node');
await page.waitForTimeout(2500);
const dump = () =>
  page.evaluate(() => {
    const overlays = document.querySelectorAll('.pu-overlay:not(.closing)');
    const scope = overlays.length ? overlays[overlays.length - 1] : document.querySelector('.pu-map');
    return Array.from(scope.querySelectorAll('button, [role="slider"], [tabindex]:not([tabindex="-1"])')).map((e) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return `${(e.dataset.testid || e.className).slice(0, 34).padEnd(34)} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} vis=${cs.visibility} pe=${cs.pointerEvents} op=${cs.opacity} dis=${e.disabled} hid=${!!e.closest('[hidden],[inert],[aria-hidden="true"]')}`;
    });
  });
console.log((await dump()).join('\n'));
await page.evaluate((id) => document.querySelector(`[data-testid="${id}"]`)?.focus(), FROM);
for (const k of KEYS) {
  await page.keyboard.press(k);
  await page.waitForTimeout(500);
  console.log(k, '->', await page.evaluate(() => document.activeElement?.dataset?.testid ?? document.activeElement?.className));
}
await browser.close();
