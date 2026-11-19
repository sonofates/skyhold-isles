// Juice QA against `vite preview` (default http://127.0.0.1:4381): frozen frames right after a
// build, an upgrade, and during kills (gold "+N" pops), 1920x1080 and 844x390.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4381';
const OUT = 'docs/overnight/opus-shots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
for (const size of [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1, desktop: true },
  { key: '844x390', w: 844, h: 390, dpr: 2, touch: true },
]) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch });
  await ctx.addInitScript(() => localStorage.setItem('skyhold2d_coach_v1', 'done'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${size.key}: pageerror ${e.message}`));
  await page.goto(`${BASE}/2d.html?level=l1c&hero=none&lang=en&desktop=${size.desktop ? 1 : 0}`);
  await page.waitForFunction(() => window.__p0?.replay && !document.getElementById('boot'), null, { timeout: 60000 });
  await page.waitForTimeout(500);
  // Build: freeze a few frames after.
  await page.evaluate(() => {
    const p = window.__p0;
    p.setGold(2000);
    p.replay.cmd({ k: 'build', plot: 2, type: 'archer' });
    p.replay.step(2);
    p.freeze(true);
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/en-${size.key}-juice-build.jpg`, type: 'jpeg', quality: 84 });
  await page.evaluate(() => {
    const p = window.__p0;
    p.freeze(false);
    p.replay.step(10);
    const s = p.state();
    p.replay.cmd({ k: 'upgrade', id: s.towers[0].id });
    p.replay.step(2);
    p.freeze(true);
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/en-${size.key}-juice-upgrade.jpg`, type: 'jpeg', quality: 84 });
  // Kills: towers along the first road, wave called, run until kills happen, freeze.
  await page.evaluate(() => {
    const p = window.__p0;
    p.freeze(false);
    for (let i = 0; i < 6; i++) p.replay.cmd({ k: 'build', plot: i, type: i % 2 ? 'cannon' : 'archer' });
    p.replay.cmd({ k: 'wave' });
  });
  const got = await page.evaluate(() => {
    const p = window.__p0;
    for (let i = 0; i < 400; i++) {
      p.replay.step(1);
      const g = p.goldPops?.();
      if (g && g.active > 0) {
        p.freeze(true);
        return g;
      }
    }
    p.freeze(true);
    return null;
  });
  if (!got) problems.push(`${size.key}: no gold pop seen`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/en-${size.key}-juice-kills.jpg`, type: 'jpeg', quality: 84 });
  await ctx.close();
  console.log(`${size.key}: done ${JSON.stringify(got)}`);
}
await browser.close();
console.log(problems.length ? `PROBLEMS:\n  ${problems.join('\n  ')}` : 'no problems');
