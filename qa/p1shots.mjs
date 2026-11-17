// P1 roster QA (hermes, inside the Playwright Docker image, against `vite preview` on :4173):
// ?artcheck=1, ?zoo=1 (all 15 enemy types, specials), ?towers=1&tier=1|2|3 (every tower firing),
// the 7-token build ring and the codex, at 1600x900 and 915x412 (DPR 2.6). It waits on the
// renderer's own counters (window.__p0.state().fx) instead of wall-clock sleeps.
// Usage: node qa/p1shots.mjs [only]   (only = artcheck | zoo | towers | ring | codex)
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const OUT = 'qa-out/p1';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const only = process.argv[2] ?? '';
const report = { errors: [], notes: {} };

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
  await page.waitForTimeout(500);
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

async function artcheck(browser) {
  for (const view of Object.keys(VIEWS)) {
    const { ctx, page } = await open(browser, view, '?artcheck=1');
    await page.screenshot({ path: `${OUT}/${view}-artcheck.png` });
    const sum = await page.evaluate(() => {
      const s = window.__p0.artcheck();
      return { present: s.filesPresent, missing: s.filesMissing, rows: s.rows.map((r) => `${r.id}:${r.effective}`) };
    });
    report.notes[`artcheck-${view}`] = sum;
    await ctx.close();
  }
}

async function zoo(browser) {
  for (const view of Object.keys(VIEWS)) {
    const { ctx, page } = await open(browser, view, '?zoo=1');
    // Early shot: the whole parade walking out of both gates.
    await waitFor(page, () => window.__p0.state().enemies >= 12, 'zoo enemies >= 12');
    await page.screenshot({ path: `${OUT}/${view}-zoo-0.png` });
    // Specials: wait for the interesting events, shooting after each group.
    const stages = [
      ['wardPulse', () => window.__p0.state().fx.events.wardPulse >= 1],
      ['healerPulse', () => window.__p0.state().fx.events.healerPulse >= 1],
      ['burrow', () => window.__p0.state().fx.events.burrow >= 2],
      ['blink', () => window.__p0.state().fx.events.blink >= 1],
      ['hexCharge', () => window.__p0.state().fx.events.hexCharge >= 1],
      ['armorCracked', () => window.__p0.state().fx.events.armorCracked >= 1],
      ['bossPhase1', () => window.__p0.state().fx.events.bossPhase >= 1],
      ['bossPhase2', () => window.__p0.state().fx.events.bossPhase >= 2],
      ['carrierDrop', () => window.__p0.state().fx.events.carrierDrop >= 1],
      ['split', () => window.__p0.state().fx.events.split >= 1],
    ];
    let n = 1;
    for (const [name, pred] of stages) {
      const ok = await waitFor(page, pred, `${view} zoo ${name}`, 70000);
      await page.waitForTimeout(120);
      await page.screenshot({ path: `${OUT}/${view}-zoo-${n++}-${name}${ok ? '' : '-TIMEOUT'}.png` });
    }
    const s = await state(page);
    report.notes[`zoo-${view}`] = { fx: s.fx, enemies: s.enemies, notes: s.artNotes };
    await ctx.close();
  }
}

async function towers(browser) {
  for (const view of Object.keys(VIEWS)) {
    for (const tier of [1, 2, 3]) {
      const { ctx, page } = await open(browser, view, `?towers=1&tier=${tier}`);
      await waitFor(page, () => window.__p0.state().fx.towerFired >= 30, `${view} tier ${tier} towerFired`);
      await page.screenshot({ path: `${OUT}/${view}-towers-t${tier}-a.png` });
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}/${view}-towers-t${tier}-b.png` });
      const s = await state(page);
      report.notes[`towers-${view}-t${tier}`] = { towers: s.towers.map((t) => `${t.type}${t.tier}`), fx: s.fx };
      await ctx.close();
    }
  }
}

async function ring(browser) {
  for (const view of Object.keys(VIEWS)) {
    const { ctx, page } = await open(browser, view, '');
    const tap = async (x, y) => {
      if (view === 'phone') await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await page.waitForTimeout(250);
    };
    for (const plot of [11, 3]) {
      const p = await page.evaluate((i) => window.__p0.plotScreen(i), plot);
      await tap(p.x, p.y);
      const s = await state(page);
      report.notes[`ring-${view}-plot${plot}`] = s.ring;
      await page.screenshot({ path: `${OUT}/${view}-ring-plot${plot}.png` });
      await tap(p.x, p.y);
    }
    await ctx.close();
  }
}

async function codex(browser) {
  for (const view of Object.keys(VIEWS)) {
    const { ctx, page } = await open(browser, view, '?codex=1');
    await page.waitForSelector('[data-testid="codex"]:not(.hidden)', { timeout: 15000 }).catch(() => report.errors.push('codex did not open'));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${view}-codex-foes.png` });
    await page.click('[data-testid="codex-tab-towers"]').catch(() => undefined);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${view}-codex-towers.png` });
    await page.click('[data-testid="codex-tile-frost"]').catch(() => undefined);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${view}-codex-tower-detail.png` });
    await ctx.close();
  }
}

const browser = await chromium.launch({ args: ARGS });
const steps = { artcheck, zoo, towers, ring, codex };
for (const [name, fn] of Object.entries(steps)) {
  if (only && !only.split(',').includes(name)) continue;
  await fn(browser);
}
await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2).slice(0, 6000));
