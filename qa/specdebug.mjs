// Debug: the comparison card's body / note geometry at one size (default 932x430, TR).
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const [W, H] = (arg('size') ?? '932x430').split('x').map(Number);
const LANG = arg('lang') ?? 'tr';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript((l) => {
  try {
    localStorage.setItem('skyhold2d_coach_v1', 'done');
    localStorage.setItem('skyhold_isles_language_v1', l);
  } catch {
    /* */
  }
}, LANG);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.stack));
await page.goto(`${BASE}/2d.html?level=i02&hero=bran&lang=${LANG}&desktop=0`);
await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'), null, { timeout: 60000 });
const id = await page.evaluate(() => {
  const p = window.__p0;
  p.setGold(5000);
  p.replay.cmd({ k: 'build', plot: 2, type: 'archer' });
  const t = p.spec().towers[0].id;
  p.replay.cmd({ k: 'upgrade', id: t });
  p.replay.cmd({ k: 'upgrade', id: t });
  return t;
});
await page.waitForTimeout(600);
const top = await page.evaluate((t) => window.__p0.towerTop(t), id);
await page.touchscreen.tap(top.x, top.y + 30);
await page.waitForTimeout(600);
const tk = await page.evaluate(() => window.__p0.state().ring.tokens[0]);
await page.touchscreen.tap(tk.x, tk.y);
await page.waitForTimeout(400);
await page.touchscreen.tap(tk.x, tk.y);
await page.waitForSelector('[data-testid="spec-card"]');
await page.waitForTimeout(1200);
console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const b = document.querySelector('[data-testid="spec-card"] .pu-sheet-body');
      const n = document.querySelector('.pu-spec-note');
      const sh = document.querySelector('[data-testid="spec-card"] .pu-sheet');
      const r = (e) => e.getBoundingClientRect().toJSON();
      return { body: r(b), scroll: [b.scrollTop, b.scrollHeight, b.clientHeight], note: r(n), sheet: r(sh), cls: b.className };
    }),
  ),
);
await page.screenshot({ path: '/tmp/specui-debug-card.png' });
await browser.close();
