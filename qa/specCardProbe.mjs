// Probe: opens the tier-IV comparison card from the ring (tap token, then Compare) and samples
// the card's opacity, the ring state and the pause plate over time. Shots: <out>/spec-<size>-<ms>.jpg
// Usage: node qa/specCardProbe.mjs [--base=...] [--out=qa-out/wp/spec] [--size=p932|d1440]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'qa-out/wp/spec';
const SIZE = arg('size') ?? 'p932';
const MODE = arg('mode') ?? 'compare';
const phone = SIZE.startsWith('p');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({
  viewport: phone ? { width: 932, height: 430 } : { width: 1440, height: 900 },
  deviceScaleFactor: phone ? 2 : 1,
  isMobile: phone,
  hasTouch: phone,
});
await ctx.addInitScript(() => {
  if (sessionStorage.getItem('s')) return;
  sessionStorage.setItem('s', '1');
  localStorage.setItem('skyhold_isles_coach2d_v1', '1');
  localStorage.setItem('skyhold2d_coach_v1', 'done');
  localStorage.setItem('skyhold_isles_story2d_seen_v1', JSON.stringify(['i02:intro']));
});
const page = await ctx.newPage();
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('console', m.type(), m.text().slice(0, 200)));
await page.goto(`${BASE}/2d.html?level=i02&hero=bran&lang=en&desktop=${phone ? 0 : 1}`);
await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'), null, { timeout: 60000 });
const tap = (x, y) => (phone ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
await page.evaluate(() => {
  const p = window.__p0;
  p.setGold(5000);
  p.replay.cmd({ k: 'build', plot: 2, type: 'archer' });
  const id = p.spec().towers[0].id;
  p.replay.cmd({ k: 'upgrade', id });
  p.replay.cmd({ k: 'upgrade', id });
});
await page.waitForTimeout(600);
const pl = await page.evaluate(() => window.__p0.plotScreen(2));
await tap(pl.x, pl.y - 12);
await page.waitForFunction(() => window.__p0.state().ring?.open, null, { timeout: 5000 }).catch(() => console.log('ring not open'));
await page.waitForTimeout(500);
const tk = await page.evaluate(() => window.__p0.state().ring.tokens?.[0]);
console.log('token', JSON.stringify(tk));
await tap(tk.x, tk.y);
await page.waitForTimeout(400);
const cmp = await page.evaluate(() => window.__p0.state().ring.compare);
console.log('compare', JSON.stringify(cmp));
if (MODE === 'compare' && cmp) await tap(cmp.x, cmp.y);
const t0 = Date.now();
for (const ms of [100, 400, 800, 1500, 3000]) {
  await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)));
  const st = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="spec-card"]');
    const cs = c ? getComputedStyle(c) : null;
    const ov = c?.closest('.pu-overlay') ?? c?.parentElement;
    return {
      card: c ? { op: cs.opacity, vis: cs.visibility, z: cs.zIndex, ovOp: ov ? getComputedStyle(ov).opacity : null, cls: ov?.className } : null,
      ring: window.__p0.state().ring?.open ?? null,
      spec: window.__p0.spec().cardState,
      paused: window.__p0.state().paused ?? null,
    };
  });
  console.log(ms, JSON.stringify(st));
  await page.screenshot({ path: `${OUT}/spec-${SIZE}-${ms}.jpg`, type: 'jpeg', quality: 70 });
}
await browser.close();
