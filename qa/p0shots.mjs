// P0 2D slice QA (hermes, inside the Playwright Docker image, against `vite preview` on :4173):
// plays L1c via real taps on desktop (mouse) and phone (touch), screenshots ring / panel / play,
// the ?ab=1 showcase and ?bench=150 (plus a 4x CPU-throttled phone bench printing window.__bench).
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const OUT = 'qa-out/p0';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const report = { errors: [], runs: {} };

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

async function tapAt(page, view, x, y) {
  if (view === 'phone') await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await page.waitForTimeout(250);
}

const state = (page) => page.evaluate(() => window.__p0.state());

async function playFlow(browser, view) {
  const { ctx, page } = await open(browser, view, '');
  const log = [];
  const plot = (i) => page.evaluate((n) => window.__p0.plotScreen(n), i);
  // Build: plot 11 archer, plot 13 cannon (token 1), plot 6 tesla if affordable.
  let p = await plot(11);
  await tapAt(page, view, p.x, p.y);
  let s = await state(page);
  log.push({ step: 'ring on plot 11', ring: s.ring });
  await page.screenshot({ path: `${OUT}/${view}-ring.png` });
  await tapAt(page, view, s.ring.tokens[0].x, s.ring.tokens[0].y);
  p = await plot(13);
  await tapAt(page, view, p.x, p.y);
  s = await state(page);
  await tapAt(page, view, s.ring.tokens[1].x, s.ring.tokens[1].y);
  s = await state(page);
  log.push({ step: 'built', towers: s.towers, gold: s.gold });
  // Horn → wave 1.
  await tapAt(page, view, s.horn.x, s.horn.y);
  await page.waitForTimeout(8000);
  s = await state(page);
  log.push({ step: 'after 8 s', wave: s.wave, enemies: s.enemies, lives: s.lives, gold: s.gold });
  await page.screenshot({ path: `${OUT}/${view}-play.png` });
  // Tap the archer → panel, upgrade, then sell.
  p = await plot(11);
  await tapAt(page, view, p.x, p.y);
  s = await state(page);
  log.push({ step: 'panel', ring: s.ring });
  await page.screenshot({ path: `${OUT}/${view}-panel.png` });
  const upgradeTok = s.ring.tokens[0];
  if (upgradeTok?.enabled) await tapAt(page, view, upgradeTok.x, upgradeTok.y);
  s = await state(page);
  log.push({ step: 'after upgrade', towers: s.towers, gold: s.gold });
  // Pause + speed buttons via keyboard-free taps: open panel again and sell.
  p = await plot(11);
  await tapAt(page, view, p.x, p.y);
  s = await state(page);
  await tapAt(page, view, s.ring.tokens[1].x, s.ring.tokens[1].y);
  s = await state(page);
  log.push({ step: 'after sell', towers: s.towers, gold: s.gold });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/${view}-play2.png` });
  report.runs[`${view}-play`] = log;
  await ctx.close();
}

async function autoplay(browser, view) {
  const { ctx, page } = await open(browser, view, '?autoplay=1');
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${OUT}/${view}-autoplay-early.png` });
  await page.waitForTimeout(13000);
  await page.screenshot({ path: `${OUT}/${view}-autoplay.png` });
  report.runs[`${view}-autoplay`] = await state(page);
  await ctx.close();
}

async function ab(browser, view) {
  const { ctx, page } = await open(browser, view, '?ab=1');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${view}-ab.png` });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${OUT}/${view}-ab2.png` });
  report.runs[`${view}-ab`] = await state(page);
  await ctx.close();
}

async function bench(browser, view, throttle) {
  const { ctx, page } = await open(browser, view, '?bench=150');
  if (throttle) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/${view}-bench${throttle ? '-cpu' + throttle : ''}.png` });
  await page.waitForTimeout(6000);
  const b = await page.evaluate(() => window.__bench);
  report.runs[`${view}-bench${throttle ? '-cpu' + throttle : ''}`] = b;
  console.log(`bench ${view}${throttle ? ' cpu x' + throttle : ''}:`, JSON.stringify(b));
  await ctx.close();
}

const browser = await chromium.launch({ args: ARGS });
try {
  for (const view of ['desktop', 'phone']) {
    await playFlow(browser, view);
    await ab(browser, view);
    await autoplay(browser, view);
  }
  await bench(browser, 'desktop', 0);
  await bench(browser, 'phone', 0);
  await bench(browser, 'phone', 4);
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1).slice(0, 6000));
