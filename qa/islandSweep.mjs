// Whole-game sweep: autoplays every island at 4x in the real renderer and reports page errors,
// console errors, the outcome and how long the run took. Usage (with a preview or dev server):
//   python3 qa/withPreview.py --port=4467 node qa/islandSweep.mjs [--islands=i01,i02] [--jobs=4] [--extra=&hero=none]
// --final: start on the island's last wave with 300k gold (bosses, finale formations, the win board).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const base = arg('base', 'http://127.0.0.1:4173');
const jobs = Number(arg('jobs', '4'));
const extra = arg('extra', '');
const limitSec = Number(arg('limit', '900'));
const final = process.argv.includes('--final');
const ids = arg('islands', ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)].join(',')).split(',');

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const results = [];
async function runOne(id) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const t0 = Date.now();
  let last = null;
  try {
    await page.goto(`${base}/2d.html?level=${id}&autoplay=1&speed=4&quality=low${extra}`, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.__p0?.state && !document.querySelector('#boot'), null, { timeout: 120_000 });
    if (final) {
      // Last wave with a full treasury: the boss / finale formations and the win flow in the renderer.
      await page.evaluate(() => { window.__p0.setGold(300000); window.__p0.skipToWave(999); });
    }
    let maxEnemies = 0;
    for (;;) {
      last = await page.evaluate(() => {
        const s = window.__p0.state();
        return { outcome: s.outcome, wave: s.wave, waveState: s.waveState, lives: s.lives, gold: s.gold, enemies: s.enemies, ticks: s.ticks, paused: s.paused, speed: s.speed };
      });
      maxEnemies = Math.max(maxEnemies, last.enemies);
      if (last.outcome !== 'ongoing') break;
      if ((Date.now() - t0) / 1000 > limitSec) { errors.push('timeout'); break; }
      await page.waitForTimeout(2000);
    }
    last.maxEnemies = maxEnemies;
    await page.waitForTimeout(2500);
    last.endShown = await page.evaluate(() => !!window.__p0.state().end);
  } catch (e) {
    errors.push('driver: ' + e.message.split('\n')[0]);
  }
  const r = { id, sec: Math.round((Date.now() - t0) / 1000), last, errors: [...new Set(errors)].slice(0, 8) };
  results.push(r);
  console.log(JSON.stringify(r));
  await context.close();
}
const queue = [...ids];
await Promise.all(Array.from({ length: jobs }, async () => {
  while (queue.length) await runOne(queue.shift());
}));
await browser.close();
const bad = results.filter((r) => r.errors.length);
console.log(`SWEEP ${results.length} islands, ${bad.length} with errors: ${bad.map((r) => r.id).join(',')}`);
