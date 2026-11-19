// Early-call gold pop: between waves, call the next wave early and check a "+N" rises from the horn.
// Usage: node qa/earlyPop.mjs [--base=http://127.0.0.1:4381] [--out=docs/overnight/opus-shots]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'docs/overnight/opus-shots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript(() => localStorage.setItem('skyhold2d_coach_v1', 'done'));
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
await page.goto(`${BASE}/2d.html?level=l1c&hero=bran&lang=en&desktop=1&quality=high`);
await page.waitForFunction(() => window.__p0?.goldPops && !document.getElementById('boot'), null, { timeout: 60000 });
await page.evaluate(() => {
  const p = window.__p0;
  p.replay.cmd({ k: 'wave' });
  for (let i = 0; i < 3000 && p.state().waveState !== 'betweenWaves'; i++) p.replay.step(3);
});
const before = await page.evaluate(() => ({ pops: window.__p0.goldPops().spawned, bonus: window.__p0.state().hud?.earlyBonus ?? null }));
await page.evaluate(() => {
  window.__p0.replay.cmd({ k: 'wave' });
  window.__p0.replay.step(1);
});
await page.waitForTimeout(350);
await page.evaluate(() => window.__p0.freeze(true));
const after = await page.evaluate(() => window.__p0.goldPops().spawned);
console.log('pops before', before.pops, 'after', after);
if (!(after > before.pops)) problems.push('no gold pop on the early call');
await page.screenshot({ path: `${OUT}/en-1920x1080-early-call-pop.jpg`, type: 'jpeg', quality: 82 });
await browser.close();
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no problems');
process.exitCode = problems.length ? 1 : 0;
