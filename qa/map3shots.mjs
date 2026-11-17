// Layered-map QA (hermes, Playwright Docker image, against `vite preview` on :4173): L1c baked
// background + 24 drawn plots + towers fitted on their plot ring, at 1600x900 and 915x412 DPR 2.6.
// Scenes: normal play (fresh, hover / selected plot, autoplay with towers), ?towers=1&tier=1|2|3,
// ?zoo=1, ?bench (a tower on every plot). Checks the renderer's own ring report (tower ring vs
// plot ring, layout px) and the mip levels; writes PNGs + crops + report.json to qa-out/map3.
// Usage: node qa/map3shots.mjs [only]   (only = play | towers | zoo | bench)
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const OUT = 'qa-out/map3';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const only = process.argv[2] ?? '';
const report = { errors: [], notes: {}, ringFit: {} };

const VIEWS = {
  desktop: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true },
};

async function open(browser, view, query) {
  const ctx = await browser.newContext(VIEWS[view]);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) report.errors.push(`[${view}${query}] ${m.text()}`);
  });
  page.on('pageerror', (e) => report.errors.push(`[${view}${query}] pageerror ${e.message}`));
  await page.goto(`${BASE}/2d.html${query}`);
  await page.waitForFunction(() => !!window.__p0, null, { timeout: 30000 });
  await page.waitForTimeout(600);
  return { ctx, page };
}

const state = (page) => page.evaluate(() => window.__p0.state());

async function waitFor(page, pred, what, timeout = 90000) {
  try {
    await page.waitForFunction(pred, null, { timeout, polling: 250 });
    return true;
  } catch {
    report.errors.push(`timeout waiting for ${what}`);
    return false;
  }
}

/** Pause the sim, let kicks settle, and record how far each tower ring is off its plot ring. */
async function ringCheck(page, key) {
  await page.keyboard.press(' ');
  await page.waitForTimeout(700);
  const s = await state(page);
  const rings = s.plots.towerRings;
  const max = rings.reduce((m, r) => Math.max(m, Math.abs(r.dx), Math.abs(r.dy), Math.abs(r.dw)), 0);
  report.ringFit[key] = { towers: rings.length, maxErrLayoutPx: Math.round(max * 1000) / 1000, plotsVisible: s.plots.visible, mips: s.mips };
  if (max > 1) report.errors.push(`${key}: tower ring off its plot by ${max.toFixed(2)} layout px`);
  return s;
}

/** Crops around towers (screen px) so the fit and crispness can be inspected at full DPR. */
async function crops(page, view, tag, plots) {
  for (const i of plots) {
    const p = await page.evaluate((k) => window.__p0.plotScreen(k), i);
    const s = await state(page);
    const k = s.fit.scale;
    const w = Math.round(150 * k);
    const h = Math.round(250 * k);
    const vw = VIEWS[view].viewport;
    const x = Math.max(0, Math.min(vw.width - w, Math.round(p.x - w / 2)));
    const y = Math.max(0, Math.min(vh(vw) - h, Math.round(p.y - h + 50 * k)));
    await page.screenshot({ path: `${OUT}/${view}-${tag}-plot${i}.png`, clip: { x, y, width: w, height: h } });
  }
}
const vh = (vw) => vw.height;

async function play(browser) {
  for (const view of Object.keys(VIEWS)) {
    const { ctx, page } = await open(browser, view, '');
    await page.screenshot({ path: `${OUT}/${view}-play-fresh.png` });
    const s0 = await state(page);
    report.notes[`play-${view}`] = { plots: s0.plots.count, visible: s0.plots.visible, mips: s0.mips, fit: s0.fit, art: s0.artNotes };
    if (s0.plots.visible !== 24) report.errors.push(`${view}: ${s0.plots.visible} plots visible at start (want 24)`);
    if (view === 'desktop') {
      const p = await page.evaluate(() => window.__p0.plotScreen(9));
      await page.mouse.move(p.x, p.y - 4);
      await page.waitForTimeout(300);
      report.notes.hover = (await state(page)).plots.hover;
      await page.screenshot({ path: `${OUT}/${view}-play-hover.png`, clip: { x: p.x - 160, y: p.y - 120, width: 320, height: 220 } });
    }
    const p2 = await page.evaluate(() => window.__p0.plotScreen(12));
    if (view === 'phone') await page.touchscreen.tap(p2.x, p2.y);
    else await page.mouse.click(p2.x, p2.y);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}/${view}-play-selected.png` });
    report.notes[`ring-${view}`] = (await state(page)).ring;
    await ctx.close();

    const a = await open(browser, view, '?autoplay=1&speed=3');
    await waitFor(a.page, () => window.__p0.state().wave >= 7 && window.__p0.state().towers.length >= 9, `${view} autoplay towers`, 150000);
    await a.page.screenshot({ path: `${OUT}/${view}-play-autoplay.png` });
    const s = await ringCheck(a.page, `autoplay-${view}`);
    await a.page.screenshot({ path: `${OUT}/${view}-play-autoplay-paused.png` });
    await crops(a.page, view, 'autoplay', s.towers.slice(0, 4).map((t) => t.plot));
    report.notes[`autoplay-${view}`] = { towers: s.towers.map((t) => `${t.type}${t.tier}@${t.plot}`), lives: s.lives, wave: s.wave };
    await a.ctx.close();
  }
}

async function towers(browser) {
  for (const view of Object.keys(VIEWS)) {
    for (const tier of [1, 2, 3]) {
      const { ctx, page } = await open(browser, view, `?towers=1&tier=${tier}`);
      await waitFor(page, () => window.__p0.state().fx.towerFired >= 30, `${view} tier ${tier} towerFired`);
      await page.screenshot({ path: `${OUT}/${view}-towers-t${tier}.png` });
      const s = await ringCheck(page, `towers-${view}-t${tier}`);
      await page.screenshot({ path: `${OUT}/${view}-towers-t${tier}-paused.png` });
      if (view === 'phone' || tier === 3) await crops(page, view, `towers-t${tier}`, s.towers.map((t) => t.plot));
      report.notes[`towers-${view}-t${tier}`] = { towers: s.towers.map((t) => `${t.type}${t.tier}@${t.plot}`), fired: s.fx.towerFired, attacks: s.plots.attacksPlayed, prerolled: s.plots.shotsPrerolled, delayed: s.plots.shotsDelayed };
      await ctx.close();
    }
  }
}

async function zoo(browser) {
  for (const view of Object.keys(VIEWS)) {
    const { ctx, page } = await open(browser, view, '?zoo=1');
    await waitFor(page, () => window.__p0.state().enemies >= 12, 'zoo enemies >= 12');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${view}-zoo.png` });
    await ringCheck(page, `zoo-${view}`);
    await ctx.close();
  }
}

async function bench(browser) {
  for (const view of Object.keys(VIEWS)) {
    const { ctx, page } = await open(browser, view, '?bench=40');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/${view}-bench-all-plots.png` });
    await ringCheck(page, `bench-${view}`);
    await ctx.close();
  }
}

const browser = await chromium.launch({ args: ARGS });
const steps = { play, towers, zoo, bench };
for (const [name, fn] of Object.entries(steps)) {
  if (only && !only.split(',').includes(name)) continue;
  try {
    await fn(browser);
  } catch (e) {
    report.errors.push(`${name} crashed: ${e.message}`);
  }
}
await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2).slice(0, 8000));
