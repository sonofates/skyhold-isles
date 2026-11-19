// Endless lane marks: on a multi-cave island in Endless, past the story waves, the next-wave card
// and the cave marks still show (generated waves deal groups across every cave).
// Usage: node qa/endlessLanes.mjs [--level=i14] [--base=http://127.0.0.1:4381] [--out=qa-out]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'qa-out';
const LEVEL = arg('level') ?? 'i14';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript(() => localStorage.setItem('skyhold2d_coach_v1', 'done'));
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
await page.goto(`${BASE}/2d.html?level=${LEVEL}&hero=bran&endless=1&lang=en&desktop=1`);
await page.waitForFunction(() => window.__p0?.laneMarks && !document.getElementById('boot'), null, { timeout: 60000 });
const total = await page.evaluate(() => Number(String(window.__p0.hudWave()).split('/')[1]) || 20);
// Jump past the story waves, then let the wave clear so the card (and marks) show.
await page.evaluate((n) => {
  window.__p0.skipToWave(n + 2);
  window.__p0.setLives(999);
}, total);
await page.evaluate(() => {
  const p = window.__p0;
  for (let i = 0; i < 2000 && !['betweenWaves'].includes(p.state().waveState); i++) p.replay.step(4);
});
await page.waitForTimeout(800);
const lm = await page.evaluate(() => window.__p0.laneMarks());
const wave = await page.evaluate(() => window.__p0.hudWave());
console.log('wave', wave, 'marks', JSON.stringify(lm));
if (!lm || lm.shown < 1) problems.push(`no lane marks in Endless (${wave})`);
await page.screenshot({ path: `${OUT}/endless-lanes-${LEVEL}.jpg`, type: 'jpeg', quality: 80 });
await browser.close();
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no problems');
process.exitCode = problems.length ? 1 : 0;
