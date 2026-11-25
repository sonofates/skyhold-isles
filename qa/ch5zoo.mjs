// Chapter-five foes in the 2D zoo (`?zoo=1&types=duskhound,veilcaster,eclipse_sovereign`), one
// Chromium, 1280x800. Waits until the Eclipse Sovereign has eclipsed the sun (screen shade on) and
// split into its two Shadow Halves, with Dusk Hounds on the road and a Veilcaster veil on a tower,
// then saves docs/ch5-shots/zoo-1280x800.jpg and prints the debug counters. Placeholder (tinted
// fallback) art is expected until the painted atlases land.
// Run: python3 qa/withPreview.py --port=4471 node qa/ch5zoo.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const BASE = arg('base') ?? 'http://127.0.0.1:4471';
const OUT = 'docs/ch5-shots';
const TYPES = ['duskhound', 'veilcaster', 'eclipse_sovereign'];
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
  await page.goto(`${BASE}/2d.html?zoo=1&types=${TYPES.join(',')}&lang=en&quality=high`);
  await page.waitForFunction(() => !!window.__p0?.state, null, { timeout: 90_000 });
  const snap = () =>
    page.evaluate(() => {
      const s = window.__p0.state();
      return {
        foes: s.foes,
        bosses: s.bosses,
        eclipse: s.fx?.eclipse,
        markers: s.fx?.markers,
        events: {
          packEnrage: s.fx?.events?.packEnrage,
          towerVeiled: s.fx?.events?.towerVeiled,
          eclipse: s.fx?.events?.eclipse,
          sovereignSplit: s.fx?.events?.sovereignSplit,
          bossPhase: s.fx?.events?.bossPhase,
        },
        veiled: s.towers.filter((t) => t.veil > 0).length,
        rangeCut: s.towers.filter((t) => t.rangeCut > 0).length,
        towers: s.towers.length,
      };
    });
  let s = await snap();
  let shot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 240_000) {
    s = await snap();
    const halves = (s.foes?.eclipse_shade ?? 0) >= 2;
    const dark = (s.eclipse?.shade ?? 0) > 0.25;
    const hounds = (s.foes?.duskhound ?? 0) > 0;
    const caster = (s.foes?.veilcaster ?? 0) > 0;
    const veil = (s.markers?.veiled ?? 0) > 0;
    if (halves && dark && hounds && caster && veil) {
      await page.screenshot({ path: `${OUT}/zoo-1280x800.jpg`, type: 'jpeg', quality: 82 });
      console.log('shot', JSON.stringify(s));
      shot = true;
      break;
    }
    await page.waitForTimeout(200);
  }
  if (!shot) {
    await page.screenshot({ path: `${OUT}/zoo-1280x800.jpg`, type: 'jpeg', quality: 82 });
    problems.push(`timed out before eclipse + halves + hounds + a veiled tower were on screen: ${JSON.stringify(s)}`);
  }
  const art = await page.evaluate(() => String(window.__p0.artcheck?.() ?? ''));
  for (const line of art.split('\n')) if (/duskhound|veilcaster|eclipse_/.test(line)) console.log('art', line.trim());
} finally {
  await browser.close();
}
console.log(problems.length ? `PROBLEMS\n${problems.join('\n')}` : 'OK');
process.exit(problems.length ? 1 : 0);
