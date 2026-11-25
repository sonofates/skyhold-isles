// Chapter four waves batch 2 (docs/handoff-ch4-waves-2.md): i31 Crevasse Span in battle at 932x430
// (phone, DPR 2, touch), one Chromium. Autoplay at 3x with the island's scripted build; gold and lives
// are topped up through __p0 so the bare script reaches the Sledge Warden waves (render QA, not a
// balance check). A tick probe reads every Sledge Warden's shield from the sim; the shot is taken while
// at least one warden on the open road still carries a shield that towers have already cracked.
// Saves docs/ch4-shots/i31-932x430-shield.jpg.
// Run: python3 qa/withPreview.py --port=4471 node qa/ch4shield.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const BASE = arg('base') ?? 'http://127.0.0.1:4471';
const OUT = 'docs/ch4-shots';
mkdirSync(OUT, { recursive: true });
const SEEN = ['grunt', 'runner', 'brute', 'flyer', 'healer', 'splitter', 'warden', 'burrower', 'carrier', 'blinker', 'golem',
  'mite', 'hexer', 'bellrunner', 'kilnback', 'reedpiper', 'draftwing', 'tempest', 'boss', 'rimebeetle'];
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
  await page.goto(`${BASE}/2d.html?level=i31&hero=bran&lang=en&quality=high&desktop=0&autoplay=1&speed=3`);
  await page.waitForFunction(() => !!window.__p0?.state && !document.getElementById('boot'), null, { timeout: 90_000 });
  await page.evaluate(() => {
    window.__guards = [];
    window.__p0.replay.probe((w) => {
      const out = [];
      const pool = w.enemyPool;
      for (let i = 0; i < pool.getActiveCount(); i++) {
        const e = pool.items[pool.getActiveIndex(i)];
        if (e.active && e.type === 'sledguard' && e.hp > 0) {
          out.push({ shield: Math.round(e.shield), max: Math.round(e.shieldMax), hp: Math.round(e.hp), prog: e.totalDist > 0 ? e.dist / e.totalDist : 0 });
        }
      }
      window.__guards = out;
    });
  });
  const prop = () => page.evaluate(() => {
    window.__p0.setGold?.(Math.max(window.__p0.state().gold ?? 0, 3000));
    window.__p0.setLives?.(20);
  });
  await prop();
  const snap = () => page.evaluate(() => {
    const s = window.__p0.state();
    return { wave: s.wave, waveState: s.waveState, outcome: s.outcome, lives: s.lives, guards: window.__guards, towers: s.towers.length };
  });
  let shot = null;
  const t0 = Date.now();
  let s = await snap();
  while (Date.now() - t0 < 300_000 && s.outcome === 'ongoing') {
    s = await snap();
    // On the open road (not still in the gate, not at the fort), shield up but already cracked.
    const good = s.guards.filter((g) => g.shield > 0 && g.shield < g.max && g.prog > 0.18 && g.prog < 0.8);
    if (good.length > 0 && s.towers >= 3) {
      await page.screenshot({ path: `${OUT}/i31-932x430-shield.jpg`, type: 'jpeg', quality: 85, scale: 'css' });
      shot = s;
      if (good.length >= 2 || s.wave >= 4) break;
    }
    if (s.lives < 12 || s.waveState === 'betweenWaves') await prop();
    await page.waitForTimeout(100);
  }
  if (!shot) problems.push(`i31: no frame with a cracked Sledge Warden shield on the road (${JSON.stringify(s)})`);
  else console.log('i31 shield', JSON.stringify(shot));
} finally {
  await browser.close();
}
console.log(problems.length ? `PROBLEMS\n${problems.join('\n')}` : 'OK');
process.exit(problems.length ? 1 : 0);
