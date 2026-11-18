// Viewport probe (hermes Playwright): canvas vs window size + a screenshot per viewport.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const OUT = 'qa-out/probe';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const SIZES = [
  ['2000x1035', 2000, 1035, 1],
  ['915x412', 915, 412, 2.6],
];
const browser = await chromium.launch({ args: ARGS });
const rep = {};
for (const [k, w, h, dpr] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: dpr > 1, hasTouch: dpr > 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/2d.html?level=l1c`);
  await page.waitForFunction(() => !!window.__p0, null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  rep[k] = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { inner: [innerWidth, innerHeight], vv: [visualViewport?.width, visualViewport?.height], canvas: [r.x, r.y, r.width, r.height], attr: [c.width, c.height], st: window.__p0.state().buttons };
  });
  await page.screenshot({ path: `${OUT}/${k}.png` });
  await ctx.close();
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(rep, null, 1));
console.log(JSON.stringify(rep));
await browser.close();
