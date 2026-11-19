// Probe: ability bar box vs HUD rects on one island / size (dev aid for layout bugs).
// Usage: node qa/probe-bar.mjs [--level=l1c] [--size=844x390] [--shot=/tmp/x.jpg]
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const [w, h] = (arg('size') ?? '844x390').split('x').map(Number);
const touch = h <= 560;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch });
await ctx.addInitScript(() => localStorage.setItem('skyhold2d_coach_v1', 'done'));
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${BASE}/2d.html?level=${arg('level') ?? 'l1c'}&hero=bran&lang=${arg('lang') ?? 'en'}&desktop=${touch ? 0 : 1}`);
await page.waitForFunction(() => window.__p0?.abilities && !document.getElementById('boot'), null, { timeout: 60000 });
await page.waitForTimeout(800);
const before = await page.evaluate(() => window.__p0.abilities());
console.log('start', JSON.stringify(before?.box ?? before), JSON.stringify(before?.spot ?? ''));
if (arg('wave')) {
  await page.evaluate((n) => {
    window.__p0.skipToWave(n);
    window.__p0.replay.step(4);
  }, Number(arg('wave')));
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => window.__p0.abilities());
  console.log('after', JSON.stringify(after?.box ?? after), JSON.stringify(after?.spot ?? ''));
}
if (arg('shot')) await page.screenshot({ path: arg('shot'), type: 'jpeg', quality: 80 });
await browser.close();
