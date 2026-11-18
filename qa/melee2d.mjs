// Melee animation QA (hermes, Playwright Docker image, against `vite preview` on :4173), 1600x900.
// `?melee=1&manual=1` builds one barracks and walks a rotating mix of melee enemies into its rally
// point; the page only advances through window.__meleeScene.step(frames), so every capture is
// frame-exact. Per scene: warm up, then a burst of consecutive frames (every 2 sim frames) as close
// crops around the rally point (+ a few full frames), marking the frames where a blow landed.
// Writes qa-out/melee/<scene>/*.png + qa-out/melee/report.json.   Usage: node qa/melee2d.mjs [scene]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const OUT = 'qa-out/melee';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const only = process.argv[2] ?? '';
const report = { errors: [], scenes: {} };

const SCENES = [
  { key: 'mix-t3', query: '&tier=3&types=grunt,brute,golem,mite', warm: 9, burst: 48 },
  { key: 'heavy', query: '&tier=3&types=boss,tempest&crowd=1', warm: 10, burst: 60 },
  { key: 'die', query: '&tier=1&types=golem,brute&die=1&crowd=2', warm: 6, burst: 60, every: 4 },
  { key: 'roster-t2', query: '&tier=2&types=runner,healer,warden,splitter,burrower,blinker,hexer&crowd=3', warm: 10, burst: 36 },
];

async function scene(browser, sc) {
  const dir = `${OUT}/${sc.key}`;
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) report.errors.push(`[${sc.key}] ${m.text()}`);
  });
  page.on('pageerror', (e) => report.errors.push(`[${sc.key}] pageerror ${e.message}`));
  const rec = { frames: [], stats: null, rally: null };
  report.scenes[sc.key] = rec;
  try {
    await page.goto(`${BASE}/2d.html?melee=1&manual=1${sc.query}`);
    await page.waitForFunction(() => !!window.__meleeScene, null, { timeout: 30000 });
    for (let s = 0; s < sc.warm; s++) await page.evaluate(() => window.__meleeScene.step(60));
    const rally = await page.evaluate(() => {
      const m = window.__meleeScene;
      return m.rally ? m.toScreen(m.rally.x, m.rally.z) : null;
    });
    rec.rally = rally;
    const W = 520;
    const H = 320;
    const clip = rally
      ? { x: Math.max(0, Math.min(1600 - W, rally.x - W / 2)), y: Math.max(0, Math.min(900 - H, rally.y - H * 0.62)), width: W, height: H }
      : { x: 540, y: 290, width: W, height: H };
    await page.screenshot({ path: `${dir}/full-start.png` });
    let hits = await page.evaluate(() => window.__meleeScene.stats().hits);
    const every = sc.every ?? 2;
    for (let i = 0; i < sc.burst; i++) {
      await page.evaluate((n) => window.__meleeScene.step(n), every);
      // Let the ticker render the frozen frame.
      await page.waitForTimeout(40);
      const st = await page.evaluate(() => window.__meleeScene.stats());
      const landed = st.hits - hits;
      hits = st.hits;
      const name = `f${String(i).padStart(3, '0')}${landed > 0 ? '-hit' : ''}.png`;
      await page.screenshot({ path: `${dir}/${name}`, clip });
      if (i % 16 === 8) await page.screenshot({ path: `${dir}/full-${String(i).padStart(3, '0')}.png` });
      rec.frames.push({ i, landed, fighting: st.fighting, alive: st.alive, falls: st.falls });
    }
    rec.stats = await page.evaluate(() => window.__meleeScene.stats());
  } catch (e) {
    report.errors.push(`[${sc.key}] ${e.message}`);
  }
  await ctx.close();
}

const browser = await chromium.launch({ args: ARGS });
for (const sc of SCENES) if (!only || sc.key === only) await scene(browser, sc);
await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
for (const [k, v] of Object.entries(report.scenes)) console.log(k, JSON.stringify(v.stats));
console.log('errors', report.errors.length, report.errors.slice(0, 5));
