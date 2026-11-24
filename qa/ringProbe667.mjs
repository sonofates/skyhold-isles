// Probe: on a small phone (667x375 touch), tap plot N and report the plot's screen point, the ring
// state (centre, tokens) and the camera before/after. Usage: node qa/ringProbe667.mjs [--plot=2] [--w=667] [--h=375]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'qa-out/wp/ring';
const PLOT = Number(arg('plot') ?? 2);
const W = Number(arg('w') ?? 667);
const H = Number(arg('h') ?? 375);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  if (sessionStorage.getItem('s')) return;
  sessionStorage.setItem('s', '1');
  localStorage.setItem('skyhold_isles_coach2d_v1', '1');
  localStorage.setItem('skyhold2d_coach_v1', 'done');
  localStorage.setItem('skyhold_isles_story2d_seen_v1', JSON.stringify(['i02:intro']));
});
const page = await ctx.newPage();
await page.goto(`${BASE}/2d.html?level=${arg('level') ?? 'i02'}&hero=bran&lang=en&desktop=0`);
await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'), null, { timeout: 60000 });
await page.evaluate(() => window.__p0.setGold(2000));
await page.waitForTimeout(500);
const before = await page.evaluate((i) => ({ plot: window.__p0.plotScreen(i), pan: window.__p0.state().pan ?? null, cam: window.__p0.state().camera ?? null }), PLOT);
console.log('before', JSON.stringify(before));
await page.touchscreen.tap(before.plot.x, before.plot.y);
await page.waitForTimeout(900);
const after = await page.evaluate((i) => {
  const s = window.__p0.state();
  return { plot: window.__p0.plotScreen(i), ring: s.ring, pan: s.pan ?? null, cam: s.camera ?? null };
}, PLOT);
console.log('after', JSON.stringify(after).slice(0, 1500));
await page.screenshot({ path: `${OUT}/ring-${W}-plot${PLOT}.jpg`, type: 'jpeg', quality: 70 });
await browser.close();
