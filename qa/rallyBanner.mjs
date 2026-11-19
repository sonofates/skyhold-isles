// Rally banner wording check (desktop "Click the road" / touch "Tap the road"), against vite preview.
// Usage: node qa/rallyBanner.mjs [--base=http://127.0.0.1:4381] [--out=qa-out]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'qa-out';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
for (const [lang, desktop] of [
  ['en', 1],
  ['tr', 1],
  ['tr', 0],
]) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(() => localStorage.setItem('skyhold2d_coach_v1', 'done'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${lang}: pageerror ${e.message}`));
  await page.goto(`${BASE}/2d.html?level=l1c&hero=bran&lang=${lang}&desktop=${desktop}`);
  await page.waitForFunction(() => window.__p0?.lives && !document.getElementById('boot'), null, { timeout: 60000 });
  await page.evaluate(() => {
    window.__p0.setGold(900);
    window.__p0.replay.cmd({ k: 'build', plot: 6, type: 'barracks' });
  });
  const pl = await page.evaluate(() => window.__p0.plotScreen(6));
  await page.mouse.click(pl.x, pl.y - 30);
  await page.waitForFunction(() => window.__p0.state().ring.open, null, { timeout: 5000 }).catch(() => problems.push(`${lang}: ring did not open`));
  const toks = await page.evaluate(() => window.__p0.state().ring.tokens);
  if (toks?.[1]) await page.mouse.click(toks[1].x, toks[1].y);
  await page.waitForTimeout(600);
  const banner = await page.evaluate(() => window.__p0.state().hud?.banner ?? window.__p0.state().banner ?? null);
  console.log(lang, desktop, 'banner id:', banner);
  await page.screenshot({ path: `${OUT}/rally-${lang}-${desktop ? 'desktop' : 'touch'}.jpg`, type: 'jpeg', quality: 80 });
  await ctx.close();
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'no problems');
