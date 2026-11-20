// Debug: page error stack while opening the tier-III ring and tapping a specialization token.
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const ctx = await browser.newContext({ viewport: { width: 2000, height: 991 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('skyhold2d_coach_v1', 'done');
  } catch {
    /* */
  }
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.stack));
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
await page.goto(`${BASE}/2d.html?level=i02&hero=bran&lang=en`);
await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'), null, { timeout: 60000 });
await page.evaluate(() => {
  const p = window.__p0;
  p.setGold(5000);
  p.replay.cmd({ k: 'build', plot: 2, type: 'archer' });
  const id = p.spec().towers[0].id;
  p.replay.cmd({ k: 'upgrade', id });
  p.replay.cmd({ k: 'upgrade', id });
});
await page.waitForTimeout(700);
const top = await page.evaluate(() => window.__p0.towerTop(window.__p0.spec().towers[0].id));
console.log('top', JSON.stringify(top));
await page.mouse.click(top.x, top.y + 30);
await page.waitForTimeout(600);
const ring = await page.evaluate(() => window.__p0.state().ring);
console.log('ring', JSON.stringify(ring.tokens), ring.mode);
await page.mouse.click(ring.tokens[0].x, ring.tokens[0].y);
await page.waitForTimeout(600);
console.log('tip', JSON.stringify(await page.evaluate(() => window.__p0.spec())).slice(0, 400));
await browser.close();
