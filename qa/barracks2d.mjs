// Barracks QA for the 2D slice (hermes, inside the Playwright Docker image, against `vite preview`
// on :4173). 1) ?autoplay=1&speed=3 on L1c until soldiers hold enemies → full-frame and close-up
// screenshots (desktop 1600x900 + phone 915x412). 2) Manual flow by real taps: build a barracks
// from the ring, open its panel, tap Rally, tap the road → the flag and squad move.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const OUT = 'qa-out/barracks';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const report = { errors: [], runs: {} };
const PPU = 50;
const IMG = [1846, 852];

const VIEWS = {
  desktop: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
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
const toScreen = (s, x, z) => ({
  x: s.fit.offsetX + (x * PPU + IMG[0] / 2) * s.fit.scale,
  y: s.fit.offsetY + (z * PPU + IMG[1] / 2) * s.fit.scale,
});

async function tapAt(page, view, x, y) {
  if (view === 'phone') await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await page.waitForTimeout(300);
}

async function blockingShots(browser, view) {
  const { ctx, page } = await open(browser, view, '?autoplay=1&speed=3');
  const t0 = Date.now();
  const log = [];
  report.runs[`${view}-blocking`] = { log };
  await page.waitForFunction(() => (window.__p0.state().barracks?.blocked ?? 0) > 0, null, { timeout: 420000, polling: 100 });
  report.runs[`${view}-blocking`].secondsToFirstBlock = Math.round((Date.now() - t0) / 1000);
  for (let k = 0; k < 4; k++) {
    const s = await state(page);
    log.push({ k, wave: s.wave, lives: s.lives, enemies: s.enemies, barracks: s.barracks });
    await page.screenshot({ path: `${OUT}/${view}-blocking-${k}.png` });
    if (k === 0 && s.barracks.rallies.length > 0) {
      const r = s.barracks.rallies[0];
      const c = toScreen(s, r.x, r.z);
      const vw = VIEWS[view].viewport;
      const w = Math.min(560, vw.width);
      const h = Math.min(360, vw.height);
      const x = Math.max(0, Math.min(vw.width - w, c.x - w / 2));
      const y = Math.max(0, Math.min(vw.height - h, c.y - h / 2));
      await page.screenshot({ path: `${OUT}/${view}-blocking-closeup.png`, clip: { x, y, width: w, height: h } });
    }
    await page.waitForTimeout(450);
  }
  await ctx.close();
}

async function rallyFlow(browser, view) {
  const { ctx, page } = await open(browser, view, '');
  const log = [];
  report.runs[`${view}-rally`] = { log };
  const plot = (i) => page.evaluate((n) => window.__p0.plotScreen(n), i);
  // Build ring on plot 14: the barracks is the last token.
  let p = await plot(14);
  await tapAt(page, view, p.x, p.y);
  let s = await state(page);
  log.push({ step: 'ring on plot 14', ring: s.ring });
  await page.screenshot({ path: `${OUT}/${view}-ring-barracks.png` });
  const tok = s.ring.tokens[s.ring.tokens.length - 1];
  await tapAt(page, view, tok.x, tok.y);
  s = await state(page);
  log.push({ step: 'built', towers: s.towers, gold: s.gold, barracks: s.barracks });
  // Top-row plot: the build ring must stay inside the viewport (HUD topBand fix).
  {
    const top = await plot(1);
    await tapAt(page, view, top.x, top.y);
    const st = await state(page);
    const vw = VIEWS[view].viewport;
    const inside = st.ring.tokens.every((t) => t.x > 0 && t.x < vw.width && t.y > 0 && t.y < vw.height);
    log.push({ step: 'ring on top-row plot 1', open: st.ring.open, tokens: st.ring.tokens.length, inside });
    await page.screenshot({ path: `${OUT}/${view}-ring-top-row.png` });
    await tapAt(page, view, top.x, top.y);
  }
  // Let the squad reach its posts.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${view}-squad-posted.png` });
  // Tower panel: upgrade / Rally / sell.
  p = await plot(14);
  await tapAt(page, view, p.x, p.y);
  s = await state(page);
  log.push({ step: 'panel', ring: s.ring });
  await page.screenshot({ path: `${OUT}/${view}-panel-rally.png` });
  const rallyTok = s.ring.tokens[1];
  await tapAt(page, view, rallyTok.x, rallyTok.y);
  s = await state(page);
  log.push({ step: 'rally mode', rallyMode: s.barracks.rallyMode });
  await page.screenshot({ path: `${OUT}/${view}-rally-mode.png` });
  // Tap the road 2 units further along from the current rally (clamped by the sim if needed).
  const before = s.barracks.rallies[0];
  const target = toScreen(s, before.x + 2, before.z);
  await tapAt(page, view, target.x, target.y);
  s = await state(page);
  const after = s.barracks.rallies[0];
  log.push({ step: 'rally moved', before, after, rallyMode: s.barracks.rallyMode });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${view}-rally-moved.png` });
  report.runs[`${view}-rally`].moved = Math.hypot(after.x - before.x, after.z - before.z);
  // Only the barracks stands: call wave 1 and watch the squad hold raiders while the rest stream past.
  await tapAt(page, view, s.horn.x, s.horn.y);
  await page.waitForFunction(() => (window.__p0.state().barracks?.fighting ?? 0) >= 2, null, { timeout: 120000, polling: 100 });
  await page.waitForTimeout(700);
  s = await state(page);
  log.push({ step: 'wave 1 vs lone barracks', lives: s.lives, enemies: s.enemies, barracks: s.barracks });
  await page.screenshot({ path: `${OUT}/${view}-lone-barracks-holding.png` });
  {
    const r = s.barracks.rallies[0];
    const c = toScreen(s, r.x, r.z);
    const vw = VIEWS[view].viewport;
    const w = Math.min(520, vw.width);
    const h = Math.min(340, vw.height);
    const x = Math.max(0, Math.min(vw.width - w, c.x - w / 2));
    const y = Math.max(0, Math.min(vw.height - h, c.y - h * 0.6));
    await page.screenshot({ path: `${OUT}/${view}-lone-barracks-closeup.png`, clip: { x, y, width: w, height: h } });
  }
  await page.waitForTimeout(6000);
  s = await state(page);
  log.push({ step: '6 s later', lives: s.lives, enemies: s.enemies, barracks: s.barracks });
  await page.screenshot({ path: `${OUT}/${view}-lone-barracks-later.png` });
  // Upgrade to T2 mid-fight: refreshed squad, third soldier steps out.
  p = await plot(14);
  await tapAt(page, view, p.x, p.y);
  s = await state(page);
  await tapAt(page, view, s.ring.tokens[0].x, s.ring.tokens[0].y);
  await page.waitForTimeout(1200);
  s = await state(page);
  log.push({ step: 'upgraded', towers: s.towers, gold: s.gold, barracks: s.barracks });
  await page.screenshot({ path: `${OUT}/${view}-lone-barracks-t2.png` });
  await ctx.close();
}

const browser = await chromium.launch({ args: ARGS });
try {
  for (const [fn, view] of [
    [rallyFlow, 'desktop'],
    [blockingShots, 'desktop'],
    [rallyFlow, 'phone'],
    [blockingShots, 'phone'],
  ]) {
    if (process.env.ONLY && !fn.name.toLowerCase().includes(process.env.ONLY)) continue;
    try {
      await fn(browser, view);
    } catch (err) {
      report.errors.push(`${fn.name} ${view}: ${err?.stack ?? err}`);
    }
  }
} finally {
  await browser.close();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2).slice(0, 6000));
}
