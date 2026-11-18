import { chromium } from 'playwright';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const b = await chromium.launch({ args: ARGS });
for (const [tag, vp, dsf] of [['d', { width: 1600, height: 900 }, 1], ['p', { width: 915, height: 412 }, 2.6], ['w', { width: 2000, height: 1035 }, 1]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: dsf, hasTouch: tag === 'p', isMobile: tag === 'p' });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto('http://127.0.0.1:4173/2d.html'); await sleep(7000);
  await page.screenshot({ path: `qa-out/hud-${tag}.png` });
  console.log(tag, 'errs', errs.length, errs.slice(0, 2).join('|'));
  await ctx.close();
}
await b.close();
