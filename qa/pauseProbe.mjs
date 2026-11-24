// Probe: opens the pause menu (Esc) on desktop and samples the planks' border-image over time.
// Usage: node qa/pauseProbe.mjs [--base=...] [--out=qa-out/wp/pause] [--w=1440] [--h=900]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'qa-out/wp/pause';
const W = Number(arg('w') ?? 1440);
const H = Number(arg('h') ?? 900);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
await ctx.addInitScript(() => {
  if (sessionStorage.getItem('s')) return;
  sessionStorage.setItem('s', '1');
  localStorage.setItem('skyhold_isles_coach2d_v1', '1');
  localStorage.setItem('skyhold2d_coach_v1', 'done');
  localStorage.setItem('skyhold_isles_story2d_seen_v1', JSON.stringify(['i02:intro']));
});
const page = await ctx.newPage();
await page.goto(`${BASE}/2d.html?level=i02&hero=bran&lang=en&desktop=1`);
await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'), null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.keyboard.press('Escape');
for (const ms of [300, 1500, 4000]) {
  await page.waitForTimeout(ms === 300 ? 300 : ms === 1500 ? 1200 : 2500);
  const st = await page.evaluate(() =>
    [...document.querySelectorAll('.pu-pause-menu .pu-plank')].map((b) => {
      const cs = getComputedStyle(b);
      return { t: b.textContent, bis: cs.borderImageSource.slice(-30), bw: cs.borderTopWidth, bs: cs.borderTopStyle, cls: b.className, w: b.offsetWidth, h: b.offsetHeight };
    }),
  );
  console.log(ms, JSON.stringify(st));
  await page.screenshot({ path: `${OUT}/pause-${W}-${ms}.jpg`, type: 'jpeg', quality: 70 });
}
await browser.close();
