// How long a screenshot of a screen takes in software GL (a slow one hints at a costly paint).
// Usage: node qa/shottime.mjs [--base=..] [--size=2000x991] [--css=...] query1 query2 ...
import { chromium } from 'playwright';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const [W, H] = (arg('size') ?? '2000x991').split('x').map(Number);
const CSS = arg('css') ?? '';
const queries = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const pad = (a, v) => [...a, ...Array(Math.max(0, 25 - a.length)).fill(v)];
const SEED = JSON.stringify({ ids: IDS, progress: { version: 2, unlockedLevelIndex: 9, bestStars: pad([3, 3, 2, 3, 1, 2, 3, 2, 3], 0), clears: pad([2, 1, 1, 1, 1, 1, 1, 1, 1], 0) } });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const q of queries) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript((s) => localStorage.setItem('skyhold_isles_progress2d_v1', s), SEED);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/2d.html${q}&lang=en&desktop=1`);
  await page.waitForSelector('[data-testid="worldmap2d"]', { timeout: 90000 });
  await page.waitForTimeout(3000);
  if (CSS) await page.addStyleTag({ content: CSS });
  const times = [];
  for (let k = 0; k < 2; k++) {
    const t = Date.now();
    await page.screenshot({ path: '/tmp/n2opus-shottime.jpg', type: 'jpeg', timeout: 180000 });
    times.push(Date.now() - t);
  }
  const anims = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => `${a.animationName ?? '?'}@${a.effect?.target?.className?.toString().slice(0, 30)}`));
  console.log(q, 'shot ms', times.join(' / '), 'running anims', anims.length, JSON.stringify(anims.slice(0, 12)));
  await ctx.close();
}
await browser.close();
