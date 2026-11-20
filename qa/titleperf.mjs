// Title screen frame cost in software GL: average rAF interval with the menu, then with Credits open,
// optionally with an extra stylesheet (--css=...) to compare variants.
// Usage: node qa/titleperf.mjs [--base=..] [--size=2000x991] [--css=".pu-title-ch{text-shadow:none}"]
import { chromium } from 'playwright';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const [W, H] = (arg('size') ?? '2000x991').split('x').map(Number);
const CSS = arg('css') ?? '';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const SEED = JSON.stringify({ ids: IDS, progress: { version: 2, unlockedLevelIndex: 4, bestStars: [3, 2, 3, 1, ...Array(21).fill(0)], clears: [2, 1, 1, 1, ...Array(21).fill(0)] } });
await ctx.addInitScript((s) => {
  if (sessionStorage.getItem('qa-seeded')) return;
  sessionStorage.setItem('qa-seeded', '1');
  localStorage.setItem('skyhold_isles_progress2d_v1', s);
}, SEED);
const page = await ctx.newPage();
await page.goto(`${BASE}/2d.html?title=1&titlemenu=1&lang=tr${arg('q') ?? ''}`);
await page.waitForSelector('[data-testid="title2d-menu"]', { timeout: 60000 });
if (CSS) await page.addStyleTag({ content: CSS });
await page.waitForTimeout(3000);
const frames = () =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const t0 = performance.now();
        let n = 0;
        const step = () => {
          n++;
          if (performance.now() - t0 > 3000) res(Math.round((performance.now() - t0) / n));
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
console.log('menu ms/frame', await frames());
const t = Date.now();
await page.screenshot({ path: '/tmp/n2opus-perf-menu.jpg', type: 'jpeg' });
console.log('menu shot ms', Date.now() - t);
await page.click('[data-testid="title2d-credits"]');
await page.waitForSelector('[data-testid="credits2d"]');
await page.waitForTimeout(1500);
console.log('credits ms/frame', await frames());
const t2 = Date.now();
await page.screenshot({ path: '/tmp/n2opus-perf-credits.jpg', type: 'jpeg', timeout: 120000 });
console.log('credits shot ms', Date.now() - t2);
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
await page.click('[data-testid="title2d-new"]');
await page.waitForSelector('[data-testid="confirm-newgame"]');
await page.waitForTimeout(1500);
console.log('confirm ms/frame', await frames());
const t3 = Date.now();
await page.screenshot({ path: '/tmp/n2opus-perf-confirm.jpg', type: 'jpeg', timeout: 200000 });
console.log('confirm shot ms', Date.now() - t3);
await browser.close();
