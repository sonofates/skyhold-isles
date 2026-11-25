// Chapter five waves (docs/handoff-ch5-waves-1.md): i38 in battle at 932x430 (phone, DPR 2, touch), one
// Chromium. Autoplay at 2x with the island's scripted build; gold and lives are topped up through __p0 so
// the bare script reaches the hound waves (render QA, not a balance check). The foes-seen save holds every
// older foe, like a player arriving in campaign order. A replay probe counts enraged Dusk Hounds every
// sim tick; the shot keeps the hound-wave frame with the most enraged hounds (violet tint) on the road
// (at least three). Saves docs/ch5-shots/i38-932x430-packs.jpg.
// Run: python3 qa/withPreview.py --port=4475 node qa/ch5waves.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const BASE = arg('base') ?? 'http://127.0.0.1:4475';
const OUT = 'docs/ch5-shots';
mkdirSync(OUT, { recursive: true });
const OLDER = ['grunt', 'runner', 'brute', 'flyer', 'healer', 'splitter', 'warden', 'burrower', 'carrier', 'blinker', 'golem',
  'mite', 'hexer', 'bellrunner', 'kilnback', 'reedpiper', 'draftwing', 'tempest', 'boss', 'rimebeetle', 'sledguard', 'glacier_warden'];
const HOUND_WAVES = [2, 6, 9, 12];
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const problems = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript((older) => {
    try {
      localStorage.setItem('skyhold2d_coach_v1', 'done');
      localStorage.setItem('skyhold2d_foes_seen_v1', JSON.stringify(older));
    } catch {
      // ignore
    }
  }, OLDER);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console ${m.text().slice(0, 160)}`);
  });
  await page.goto(`${BASE}/2d.html?level=i38&hero=bran&lang=en&quality=high&desktop=0&autoplay=1&speed=2`);
  await page.waitForFunction(() => !!window.__p0?.state && !document.getElementById('boot'), null, { timeout: 90_000 });
  await page.evaluate(() => {
    window.__rage = { hounds: 0, one: 0, two: 0, maxTwo: 0 };
    window.__p0.replay.probe((world) => {
      const pool = world.enemyPool;
      let hounds = 0, one = 0, two = 0;
      for (let i = 0; i < pool.getActiveCount(); i++) {
        const e = pool.items[pool.getActiveIndex(i)];
        if (!e.active || e.type !== 'duskhound') continue;
        hounds++;
        if (e.enrageStacks === 1) one++;
        if (e.enrageStacks >= 2) two++;
      }
      window.__rage = { hounds, one, two, maxTwo: Math.max(window.__rage.maxTwo, two) };
    });
  });
  const prop = () => page.evaluate(() => {
    window.__p0.setGold?.(Math.max(window.__p0.state().gold ?? 0, 3000));
    window.__p0.setLives?.(20);
  });
  await prop();
  const snap = () => page.evaluate(() => {
    const s = window.__p0.state();
    return { wave: s.wave, waveState: s.waveState, outcome: s.outcome, lives: s.lives, howls: s.fx?.events?.packEnrage ?? 0, ...window.__rage };
  });
  let shot = null;
  const t0 = Date.now();
  let s = await snap();
  while (Date.now() - t0 < 300_000 && s.outcome === 'ongoing') {
    s = await snap();
    // Keep the frame with the most enraged hounds (a second stack counts double); stop once two
    // hounds or more run at two stacks inside a pack that is still four strong.
    const score = s.one + 2 * s.two;
    if (HOUND_WAVES.includes(s.wave) && s.one + s.two >= 3 && (!shot || score > shot.one + 2 * shot.two)) {
      await page.screenshot({ path: `${OUT}/i38-932x430-packs.jpg`, type: 'jpeg', quality: 85, scale: 'css' });
      shot = s;
      if (s.two >= 2 && s.hounds >= 4) break;
    }
    if (s.wave > HOUND_WAVES.at(-1) || (shot && !HOUND_WAVES.includes(s.wave))) break;
    if (s.lives < 12 || s.waveState === 'betweenWaves') await prop();
    await page.waitForTimeout(60);
  }
  if (!shot) problems.push(`i38: no frame with three enraged hounds during waves ${HOUND_WAVES.join(',')} (${JSON.stringify(s)})`);
  else console.log('i38 packs', JSON.stringify(shot));
  await page.evaluate(() => window.__p0.replay.probe(null));
} finally {
  await browser.close();
}
console.log(problems.length ? `PROBLEMS\n${problems.join('\n')}` : 'OK');
process.exit(problems.length ? 1 : 0);
