// Aimable-turret QA (hermes, Playwright Docker image, against `vite preview` on :4173), 1600x900.
// For archer / cannon / ballista at T1-T3: `?towers=aim&type=T&tier=N` puts one tower on the plot
// with the widest compass coverage and hops one immortal target between sectors around it. At every
// hop it waits for the turret to settle, then checks the drawn sector against the sim's aim
// (targetYaw → nearest screen sector) and saves a full frame + a crop around the tower (the overlay
// draws the sim's aim in red and the drawn muzzle in yellow). Also: ?towers=1&tier=3 and autoplay.
// Writes qa-out/turret/*.png + report.json.   Usage: node qa/turretshots.mjs [type]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const OUT = 'qa-out/turret';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const only = process.argv[2] ?? '';
const SECTORS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
const report = { errors: [], aim: {}, scenes: {} };

const sectorOf = (a) => {
  const STEP = Math.PI / 4;
  let w = a % (2 * Math.PI);
  if (w > Math.PI) w -= 2 * Math.PI;
  if (w <= -Math.PI) w += 2 * Math.PI;
  return ((Math.round(w / STEP) % 8) + 8) % 8;
};
const yawToScreen = (yaw) => Math.atan2(Math.cos(yaw), Math.sin(yaw));

async function open(browser, query) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) report.errors.push(`[${query}] ${m.text()}`);
  });
  page.on('pageerror', (e) => report.errors.push(`[${query}] pageerror ${e.message}`));
  await page.goto(`${BASE}/2d.html${query}`);
  await page.waitForFunction(() => !!window.__p0, null, { timeout: 30000 });
  return { ctx, page };
}

async function aimRun(browser, type, tier) {
  const key = `${type}-t${tier}`;
  const { ctx, page } = await open(browser, `?towers=aim&type=${type}&tier=${tier}&hold=3.5`);
  const rec = { plot: -1, sectors: [], samples: [], shots: 0, mismatches: 0 };
  report.aim[key] = rec;
  try {
    await page.waitForFunction(() => (window.__aim?.sectors.length ?? 0) > 0 && window.__aim.current >= 0, null, { timeout: 30000 });
    const aim0 = await page.evaluate(() => ({ ...window.__aim }));
    rec.plot = aim0.plot;
    rec.sectors = aim0.sectors.map((s) => SECTORS[s]);
    const plot = await page.evaluate((i) => window.__p0.plotScreen(i), aim0.plot);
    let last = -2;
    for (let n = 0; n < aim0.sectors.length; n++) {
      // Next hop, then let the tower acquire, turn and shoot (≈0.9 s of sim).
      await page.waitForFunction((l) => window.__aim.current !== l, last, { timeout: 30000 });
      const cur = await page.evaluate(() => window.__aim.current);
      last = cur;
      await page.waitForFunction(() => window.__p0.state().turrets.views.length > 0 && Date.now() > 0, null, { timeout: 10000 });
      await page.waitForTimeout(1400);
      // Freeze the frame so the state, the overlay and the screenshot agree.
      await page.keyboard.press(' ');
      await page.waitForTimeout(250);
      const s = await page.evaluate(() => window.__p0.state());
      const v = s.turrets.views[0];
      if (!v) {
        report.errors.push(`${key}: no turret view`);
        continue;
      }
      const simA = yawToScreen(v.targetYaw);
      const expect = sectorOf(simA);
      // Hysteresis: a turret may hold its sector up to 8° past the border (no flicker).
      let off = Math.abs(simA - v.sector * (Math.PI / 4)) % (2 * Math.PI);
      if (off > Math.PI) off = 2 * Math.PI - off;
      const held = expect !== v.sector && off <= Math.PI / 8 + (8 * Math.PI) / 180 + 1e-6;
      const ok = expect === v.sector || held;
      if (!ok) rec.mismatches++;
      if (held) rec.held = (rec.held ?? 0) + 1;
      rec.shots = s.turrets.shots;
      rec.samples.push({ target: SECTORS[cur], simAim: SECTORS[expect], simDeg: Math.round((simA * 180) / Math.PI), drawn: SECTORS[v.sector], frame: v.frame, mirror: v.mirror, ok, held, muzzle: v.muzzle && [Math.round(v.muzzle.x), Math.round(v.muzzle.y)] });
      const name = `${OUT}/${key}-${n}-${SECTORS[v.sector]}`;
      await page.screenshot({ path: `${name}.png` });
      const cx = Math.round(plot.x);
      const cy = Math.round(plot.y);
      await page.screenshot({ path: `${name}-crop.png`, clip: { x: Math.max(0, cx - 200), y: Math.max(0, cy - 260), width: 400, height: 360 } });
      await page.keyboard.press(' ');
    }
    const distinct = new Set(rec.samples.map((x) => x.drawn));
    if (distinct.size < 3) report.errors.push(`${key}: only ${distinct.size} distinct directions drawn`);
    if (rec.mismatches > 0) report.errors.push(`${key}: ${rec.mismatches} samples where the drawn sector is outside the sim's aim sector (+ hysteresis)`);
    if (rec.shots === 0) report.errors.push(`${key}: no turret shots seen`);
  } catch (e) {
    report.errors.push(`${key}: ${e.message}`);
  }
  await ctx.close();
}

async function scene(browser, key, query, waitMs) {
  const { ctx, page } = await open(browser, query);
  await page.waitForTimeout(waitMs);
  const s = await page.evaluate(() => window.__p0.state());
  report.scenes[key] = { turrets: s.turrets.views.map((v) => `${v.type}${v.tier}:${SECTORS[v.sector]}`), shots: s.turrets.shots, fired: s.fx.towerFired, trails: s.fx.trails };
  await page.screenshot({ path: `${OUT}/${key}.png` });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${OUT}/${key}-b.png` });
  await ctx.close();
}

const browser = await chromium.launch({ args: ARGS });
for (const type of ['archer', 'cannon', 'ballista']) {
  if (only && only !== type && only !== 'aim') continue;
  for (const tier of [1, 2, 3]) await aimRun(browser, type, tier);
}
if (!only || only === 'scenes') {
  await scene(browser, 'towers-t3', '?towers=1&tier=3', 9000);
  await scene(browser, 'towers-t1', '?towers=1&tier=1', 9000);
  await scene(browser, 'autoplay', '?autoplay=1&speed=3', 40000);
}
await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ errors: report.errors, aim: Object.fromEntries(Object.entries(report.aim).map(([k, r]) => [k, `${r.samples.map((x) => x.drawn + (x.held ? '~' : x.ok ? '' : '!')).join(' ')} shots=${r.shots}`])), scenes: report.scenes }, null, 1));
