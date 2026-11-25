// Chapter-four foes in the 2D zoo (`?zoo=1&types=rimebeetle,sledguard,glacier_warden`), one
// Chromium, 1280x800. Waits until all three are on the road (placeholder art is fine), a Rime
// Beetle frost patch is on the ground and the Glacier Warden has frozen a tower, then saves
// docs/ch4-shots/zoo-1280x800.jpg (+ a second frame a little later) and prints the debug counters.
// Run: python3 qa/withPreview.py --port=4467 node qa/ch4zoo.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const BASE = arg('base') ?? 'http://127.0.0.1:4467';
const OUT = 'docs/ch4-shots';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const problems = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console ${m.text().slice(0, 160)}`);
  });
  await page.goto(`${BASE}/2d.html?zoo=1&types=rimebeetle,sledguard,glacier_warden&lang=en&quality=high`);
  await page.waitForFunction(() => !!window.__p0?.state, null, { timeout: 90_000 });
  const snap = () =>
    page.evaluate(() => {
      const s = window.__p0.state();
      return { foes: s.foes, bosses: s.bosses, frost: s.fx?.frostPatches, markers: s.fx?.markers, events: s.fx?.events, towers: s.towers.length, slowed: s.towers.filter((t) => t.frostSlow > 0).length, frozenNow: s.towers.filter((t) => t.frozen > 0).length };
    });
  let s = await snap();
  let shot = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 240_000) {
    s = await snap();
    const all = ['rimebeetle', 'sledguard', 'glacier_warden'].every((t) => (s.foes?.[t] ?? 0) > 0);
    const frost = (s.frost ?? 0) > 0;
    const frozen = (s.frozenNow ?? 0) > 0;
    // First frame: all three on the road and a frost patch down; second: a tower frozen solid.
    if (all && frost && shot === 0) {
      await page.screenshot({ path: `${OUT}/zoo-1280x800.jpg`, type: 'jpeg', quality: 82 });
      console.log('shot 1', JSON.stringify(s));
      shot = 1;
    }
    if (shot === 1 && frozen && all) {
      await page.screenshot({ path: `${OUT}/zoo-1280x800-freeze.jpg`, type: 'jpeg', quality: 82 });
      console.log('shot 2', JSON.stringify(s));
      shot = 2;
      break;
    }
    await page.waitForTimeout(250);
  }
  if (shot === 0) {
    await page.screenshot({ path: `${OUT}/zoo-1280x800.jpg`, type: 'jpeg', quality: 82 });
    problems.push(`timed out before all three foes + a frost patch were on screen: ${JSON.stringify(s)}`);
  } else if (shot === 1) problems.push(`no freeze frame: ${JSON.stringify(s)}`);
  const art = await page.evaluate(() => String(window.__p0.artcheck?.() ?? ''));
  for (const line of art.split('\n')) if (/rimebeetle|sledguard|glacier_warden/.test(line)) console.log('art', line.trim());
} finally {
  await browser.close();
}
console.log(problems.length ? `PROBLEMS\n${problems.join('\n')}` : 'OK');
process.exit(problems.length ? 1 : 0);
