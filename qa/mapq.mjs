// Map quality QA (hermes, Playwright Docker image, against `vite preview` on :4173): L1c full-map
// shots at 1600x900 + 2560x1440 (DPR 1) and 915x412 (DPR 2.6), 100% crops of the ground / road
// edge / caves / castle, and close-ups of an enemy mid-exit from each cave and one entering the
// castle gate (paused). Writes PNGs + report.json to qa-out/mapq/<tag>.
// Usage: node qa/mapq.mjs <tag> [only]   (only = full | enemies)
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const TAG = process.argv[2] ?? 'after';
const only = process.argv[3] ?? '';
const OUT = `qa-out/mapq/${TAG}`;
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const report = { errors: [], notes: {} };

const VIEWS = {
  d1600: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 },
  d2560: { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true },
};

// Layout-px regions (L1c, 1846x852) for the 100% crops.
const REGIONS = {
  caveA: [130, 0, 520, 250],
  caveB: [120, 300, 520, 520],
  castle: [1290, 360, 1720, 660],
  grass: [930, 560, 1180, 700],
  road: [480, 60, 760, 230],
  windmill: [1380, 0, 1846, 330],
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
  await page.waitForTimeout(800);
  return { ctx, page };
}

const state = (page) => page.evaluate(() => window.__p0.state());

function clipOf(view, fit, r) {
  const vw = VIEWS[view].viewport;
  const x0 = Math.max(0, fit.offsetX + r[0] * fit.scale);
  const y0 = Math.max(0, fit.offsetY + r[1] * fit.scale);
  const x1 = Math.min(vw.width, fit.offsetX + r[2] * fit.scale);
  const y1 = Math.min(vw.height, fit.offsetY + r[3] * fit.scale);
  return { x: Math.round(x0), y: Math.round(y0), width: Math.max(1, Math.round(x1 - x0)), height: Math.max(1, Math.round(y1 - y0)) };
}

async function full(browser) {
  for (const view of Object.keys(VIEWS)) {
    const { ctx, page } = await open(browser, view, '');
    await page.keyboard.press(' ');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${view}-full.png` });
    const s = await state(page);
    report.notes[view] = { fit: s.fit, mips: s.mips, map: s.mapInfo ?? null };
    for (const [k, r] of Object.entries(REGIONS)) {
      await page.screenshot({ path: `${OUT}/${view}-crop-${k}.png`, clip: clipOf(view, s.fit, r) });
    }
    await ctx.close();
  }
}

/** Waits until an enemy of `lane` is `lo..hi` world units along its path (or near the goal), pauses, crops. */
async function enemyShot(page, view, name, pred, region) {
  try {
    await page.waitForFunction(pred, null, { timeout: 120000, polling: 30 });
  } catch {
    report.errors.push(`${view}: timeout waiting for ${name}`);
    return;
  }
  await page.keyboard.press(' ');
  await page.waitForTimeout(250);
  const s = await state(page);
  report.notes[`${view}-${name}`] = s.enemyPx ?? null;
  await page.screenshot({ path: `${OUT}/${view}-${name}.png`, clip: clipOf(view, s.fit, region) });
  await page.keyboard.press(' ');
}

async function enemies(browser) {
  for (const view of ['d1600', 'phone']) {
    // wave 2: lane 0 first, lane 1 three seconds later
    const { ctx, page } = await open(browser, view, '');
    await page.keyboard.press('n');
    await page.waitForTimeout(100);
    await enemyShot(page, view, 'caveA-exit', () => (window.__p0.state().enemyPx ?? (window.__p0.state().enemies >= 1 ? [{ lane: 0, dist: 0.4 }] : [])).some((e) => e.lane === 0 && e.dist > 0.25 && e.dist < 0.6), REGIONS.caveA);
    await enemyShot(page, view, 'caveA-out', () => (window.__p0.state().enemyPx ?? []).some((e) => e.lane === 0 && e.dist > 0.9 && e.dist < 1.3), REGIONS.caveA);
    await page.keyboard.press('3');
    await enemyShot(page, view, 'castle-enter', () => (window.__p0.state().enemyPx ?? []).some((e) => e.toGoal < 0.5), REGIONS.castle);
    await ctx.close();
    const b = await open(browser, view, '');
    b.page.on('dialog', (d) => d.dismiss());
    await b.page.keyboard.press('n');
    await b.page.waitForTimeout(200);
    await b.page.keyboard.press('n');
    await enemyShot(b.page, view, 'caveB-exit', () => (window.__p0.state().enemyPx ?? []).some((e) => e.lane === 1 && e.dist > 0.25 && e.dist < 0.6), REGIONS.caveB);
    await enemyShot(b.page, view, 'caveB-out', () => (window.__p0.state().enemyPx ?? []).some((e) => e.lane === 1 && e.dist > 0.9 && e.dist < 1.3), REGIONS.caveB);
    await b.ctx.close();
  }
}

const browser = await chromium.launch({ args: ARGS });
for (const [name, fn] of Object.entries({ full, enemies })) {
  if (only && !only.split(',').includes(name)) continue;
  try {
    await fn(browser);
  } catch (e) {
    report.errors.push(`${name}: ${e.message}`);
  }
}
await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1).slice(0, 3000));
