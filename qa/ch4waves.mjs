// Chapter four waves (docs/handoff-ch4-waves-1.md): i29 and i30 in battle at 932x430 (phone, DPR 2,
// touch), one Chromium. Autoplay at 3x with each island's scripted build; gold and lives are topped
// up through __p0 so the bare script reaches the beetle waves (render QA, not a balance check). The
// foes-seen save holds every older foe (plus the beetle on i30), like a player arriving in campaign
// order, so the wave card's "New" tag on i29 can only be the Rime Beetle. Saves into docs/ch4-shots/:
//   i29-932x430-newtag.jpg  the wave-2 card before the beetle's first wave (New tag)
//   i29-932x430-frost.jpg   wave 2 in play with frost patches down
//   i30-932x430-frost.jpg   a beetle wave on i30 with frost patches down
// Run: python3 qa/withPreview.py --port=4468 node qa/ch4waves.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const BASE = arg('base') ?? 'http://127.0.0.1:4468';
const OUT = 'docs/ch4-shots';
mkdirSync(OUT, { recursive: true });
const OLDER = ['grunt', 'runner', 'brute', 'flyer', 'healer', 'splitter', 'warden', 'burrower', 'carrier', 'blinker', 'golem',
  'mite', 'hexer', 'bellrunner', 'kilnback', 'reedpiper', 'draftwing', 'tempest', 'boss'];
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const problems = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript((older) => {
    try {
      localStorage.setItem('skyhold2d_coach_v1', 'done');
      // Arriving at i30 the player has met the beetle on i29.
      const seen = /level=i30/.test(location.search) ? [...older, 'rimebeetle'] : older;
      localStorage.setItem('skyhold2d_foes_seen_v1', JSON.stringify(seen));
    } catch {
      // ignore
    }
  }, OLDER);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console ${m.text().slice(0, 160)}`);
  });
  const snap = () =>
    page.evaluate(() => {
      const s = window.__p0.state();
      const card = document.querySelector('[data-testid="wave2d-card"]');
      const chips = card ? [...card.querySelectorAll('.pu-wave-new')].length : 0;
      return {
        wave: s.wave, waveState: s.waveState, outcome: s.outcome, lives: s.lives, beetles: s.foes?.rimebeetle ?? 0,
        frost: s.fx?.frostPatches ?? 0, slowed: s.towers.filter((t) => t.frostSlow > 0).length, towers: s.towers.length,
        cardShown: !!card && getComputedStyle(card).display !== 'none' && card.getBoundingClientRect().width > 0, newChips: chips,
      };
    });

  async function island(id, { newTagWave, frostWaves }) {
    await page.goto(`${BASE}/2d.html?level=${id}&hero=bran&lang=en&quality=high&desktop=0&autoplay=1&speed=3`);
    await page.waitForFunction(() => !!window.__p0?.state && !document.getElementById('boot'), null, { timeout: 90_000 });
    // The bare autoplay script has no hero levels or Workshop, so it would fall on wave 2–3. For the
    // shots only: fund the whole scripted build and keep lives topped up (render QA, not balance).
    const prop = () => page.evaluate(() => {
      window.__p0.setGold?.(Math.max(window.__p0.state().gold ?? 0, 3000));
      window.__p0.setLives?.(20);
    });
    await prop();
    let tagged = !newTagWave;
    let best = null;
    const t0 = Date.now();
    let s = await snap();
    while (Date.now() - t0 < 300_000 && s.outcome === 'ongoing') {
      s = await snap();
      if (!tagged && s.waveState === 'betweenWaves' && s.wave === newTagWave - 1 && s.cardShown && s.newChips > 0) {
        await page.screenshot({ path: `${OUT}/${id}-932x430-newtag.jpg`, type: 'jpeg', quality: 85, scale: 'css' });
        console.log(`${id} new tag`, JSON.stringify(s));
        tagged = true;
      }
      if (frostWaves.includes(s.wave) && s.frost >= 2 && s.beetles >= 1 && (!best || s.frost > best.frost)) {
        await page.screenshot({ path: `${OUT}/${id}-932x430-frost.jpg`, type: 'jpeg', quality: 85, scale: 'css' });
        best = s;
        if (s.frost >= 3 && s.slowed >= 1) break;
      }
      if (best && !frostWaves.includes(s.wave)) break;
      if (s.lives < 12 || s.waveState === 'betweenWaves') await prop();
      await page.waitForTimeout(120);
    }
    if (!tagged) problems.push(`${id}: no "New" tag caught on the wave-${newTagWave} card (${JSON.stringify(s)})`);
    if (!best) problems.push(`${id}: no frame with frost patches during waves ${frostWaves.join(',')} (${JSON.stringify(s)})`);
    else console.log(`${id} frost`, JSON.stringify(best));
  }

  await island('i29', { newTagWave: 2, frostWaves: [2, 6] });
  await island('i30', { frostWaves: [3, 4, 6] });
} finally {
  await browser.close();
}
console.log(problems.length ? `PROBLEMS\n${problems.join('\n')}` : 'OK');
process.exit(problems.length ? 1 : 0);
