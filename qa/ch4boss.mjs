// Chapter four final balance (docs/handoff-ch4-final.md): the i36 Frostveil Citadel finale at 932x430
// (phone, DPR 2, touch), one Chromium. Autoplay builds the island's scripted defence with topped-up gold,
// then skips to wave 15 (The Glacier Warden). The shot is taken while the Warden is on the road and one
// of its frozen towers is still locked in ice (render QA, not a balance check).
// Saves docs/ch4-shots/i36-932x430-boss.jpg.
// Run: python3 qa/withPreview.py --port=4473 node qa/ch4boss.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const BASE = arg('base') ?? 'http://127.0.0.1:4473';
const OUT = 'docs/ch4-shots';
mkdirSync(OUT, { recursive: true });
const SEEN = ['grunt', 'runner', 'brute', 'flyer', 'healer', 'splitter', 'warden', 'burrower', 'carrier', 'blinker', 'golem',
  'mite', 'hexer', 'bellrunner', 'kilnback', 'reedpiper', 'draftwing', 'tempest', 'boss', 'rimebeetle', 'sledguard', 'glacier_warden'];
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const problems = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript((seen) => {
    try {
      localStorage.setItem('skyhold2d_coach_v1', 'done');
      localStorage.setItem('skyhold2d_foes_seen_v1', JSON.stringify(seen));
    } catch {
      // ignore
    }
  }, SEEN);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console ${m.text().slice(0, 160)}`);
  });
  await page.goto(`${BASE}/2d.html?level=i36&hero=bran&lang=en&quality=high&desktop=0&autoplay=1&speed=2`);
  await page.waitForFunction(() => !!window.__p0?.state && !document.getElementById('boot'), null, { timeout: 90_000 });
  const prop = () => page.evaluate(() => {
    window.__p0.setGold?.(Math.max(window.__p0.state().gold ?? 0, 20000));
    window.__p0.setLives?.(22);
  });
  // Let autoplay spend the topped-up gold on the whole scripted defence, then jump to the finale.
  for (let i = 0; i < 40; i++) {
    await prop();
    await page.waitForTimeout(250);
    const n = await page.evaluate(() => window.__p0.state().towers.length);
    if (n >= 10 && i > 8) break;
  }
  const skipped = await page.evaluate(() => window.__p0.skipToWave(15));
  if (!skipped) problems.push('skipToWave(15) failed');
  const snap = () => page.evaluate(() => {
    const s = window.__p0.state();
    return { wave: s.wave, outcome: s.outcome, lives: s.lives, bosses: s.bosses, frozen: s.towers.filter((t) => t.frozen > 0).length,
      towers: s.towers.length, freezes: s.fx?.events?.towerFrozen ?? null };
  });
  let shot = null;
  let maxFrozen = 0;
  const t0 = Date.now();
  let s = await snap();
  while (Date.now() - t0 < 240_000 && s.outcome === 'ongoing') {
    s = await snap();
    maxFrozen = Math.max(maxFrozen, s.frozen);
    const warden = s.bosses.find((b) => b.type === 'glacier_warden');
    if (!shot && warden && s.frozen > 0) {
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${OUT}/i36-932x430-boss.jpg`, type: 'jpeg', quality: 85, scale: 'css' });
      shot = await snap();
    }
    if (shot && !warden) break;
    if (s.lives < 12) await prop();
    await page.waitForTimeout(80);
  }
  if (!shot) problems.push(`i36: no frame with the Glacier Warden on the road and a tower frozen (${JSON.stringify(s)})`);
  else console.log('i36 boss', JSON.stringify(shot), 'last', JSON.stringify(s));
} finally {
  await browser.close();
}
console.log(problems.length ? `PROBLEMS\n${problems.join('\n')}` : 'OK');
process.exit(problems.length ? 1 : 0);
