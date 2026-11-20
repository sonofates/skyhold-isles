// Settings → Controls: shoots the tab at the top and scrolled to the bottom (EN / TR), and reports
// the two column heights so a lopsided layout shows up in numbers too.
// Usage: node qa/ctlshot.mjs [--base=..] [--out=docs/overnight2/opus-shots] [--size=2000x991] [--touch=1]
import { chromium } from 'playwright';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? '/tmp/n2opus-ctl';
const SIZE = arg('size') ?? '2000x991';
const [W, H] = SIZE.split('x').map(Number);
const touch = arg('touch') === '1';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const lang of ['en', 'tr']) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/2d.html?screen=settings&settab=controls&lang=${lang}`);
  await page.waitForSelector('.pu-key-grid', { timeout: 60000 });
  await page.waitForTimeout(900);
  const info = await page.evaluate(() => {
    const grid = document.querySelector('.pu-key-grid');
    const secs = [...grid.querySelectorAll('.pu-key-section')].map((s) => {
      const r = s.getBoundingClientRect();
      return { x: Math.round(r.x), top: Math.round(r.top), bottom: Math.round(r.bottom), title: s.querySelector('h3').textContent };
    });
    let sc = grid.parentElement;
    while (sc && sc.scrollHeight <= sc.clientHeight + 1) sc = sc.parentElement;
    return { secs, scroll: sc ? { h: sc.scrollHeight, c: sc.clientHeight } : null };
  });
  console.log(lang, SIZE, JSON.stringify(info));
  await page.screenshot({ path: `${OUT}/${lang}-${SIZE}-controls-top.jpg`, type: 'jpeg', quality: 85 });
  await page.evaluate(() => {
    let sc = document.querySelector('.pu-key-grid').parentElement;
    while (sc && sc.scrollHeight <= sc.clientHeight + 1) sc = sc.parentElement;
    if (sc) sc.scrollTop = sc.scrollHeight;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${lang}-${SIZE}-controls-end.jpg`, type: 'jpeg', quality: 85 });
  await ctx.close();
}
await browser.close();
