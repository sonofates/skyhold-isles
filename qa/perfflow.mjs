// Flow QA for the 2d.html entry / battle split (docs/handoff-perf.md), ONE Chromium, against the
// production build (`vite preview`): title screen → world map (every chapter page) → Esc menu →
// Settings → a battle on a late island (codex, pause menu) → `?end=won&story=ending` (ending
// beats → credits roll → world map). Fails on any console error / page error.
// At 1920x1080 a fake `window.skyholdDesktop` (desktop/preload.cjs shape) shows the PC-only Quit.
// Usage: python3 qa/withPreview.py --port=4473 node qa/perfflow.mjs [--sizes=932x430,1920x1080]
//   [--island=i45] [--out=docs/perf-shots]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4473';
const OUT = arg('out') ?? 'docs/perf-shots';
const ISLAND = arg('island') ?? 'i45';
const SIZES = (arg('sizes') ?? '932x430,1920x1080').split(',').map((s) => {
  const [w, h] = s.split('x').map(Number);
  return { key: s, w, h, phone: w < 1100 };
});
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
const notes = [];
const check = (ok, msg) => {
  if (!ok) problems.push(msg);
};

const FAKE_SHELL = () => {
  window.__shellCalls = [];
  window.skyholdDesktop = {
    platform: 'linux',
    getWindowMode: () => 'fullscreen',
    setWindowMode: async (m) => m,
    onWindowModeChange: () => () => undefined,
    getVsync: () => true,
    setVsync: async (v) => v,
    quit: () => window.__shellCalls.push(['quit']),
  };
};

async function context(size) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: size.phone ? 2 : 1,
    isMobile: size.phone,
    hasTouch: size.phone,
  });
  if (!size.phone) await ctx.addInitScript(FAKE_SHELL);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${size.key}: pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${size.key}: console.error ${m.text().slice(0, 300)} @ ${page.url()}`);
  });
  page.on('requestfailed', (r) => notes.push(`${size.key}: request failed ${r.url()} ${r.failure()?.errorText ?? ''}`));
  return { ctx, page };
}
/** Click without Playwright's "stable" wait: the title's tap line and the planks pulse forever. */
const tap = (page, sel) => page.click(sel, { force: true, timeout: 30000 });
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 78, timeout: 150000 });
const visible = (page, testid) =>
  page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
  }, testid);
/** JS files the page fetched so far (title/map must not need Pixi or the battle). */
const scripts = (page) => page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.endsWith('.js')).map((n) => n.replace(/^.*\//, '')));

for (const size of SIZES) {
  const k = size.key;
  // 1. Title screen → world map in the same page; then every chapter page, Esc menu, Settings.
  {
    const { ctx, page } = await context(size);
    await page.goto(`${BASE}/2d.html?title=1&lang=en`);
    await page.waitForFunction(() => window.__title?.state().phase === 'tap', null, { timeout: 120000 });
    await page.waitForTimeout(700);
    await shot(page, `title-tap-${k}`);
    await tap(page, '[data-testid="title2d-tap"]');
    await page.waitForFunction(() => window.__title.state().phase === 'menu', null, { timeout: 15000 });
    await page.waitForTimeout(900);
    await shot(page, `title-menu-${k}`);
    check((await visible(page, 'title2d-quit')) === !size.phone, `${k}: title Quit plank ${size.phone ? 'shown in a browser' : 'missing in the shell'}`);
    const titleJs = await scripts(page);
    check(!titleJs.some((n) => /^(pixi|battle2d|game2d)-/.test(n)), `${k}: title fetched battle code: ${titleJs.join(' ')}`);
    await tap(page, '[data-testid="title2d-new"]');
    await page.waitForSelector('[data-testid="worldmap2d"]', { timeout: 60000 });
    await page.waitForFunction(() => !!window.__map?.chapters, null, { timeout: 30000 });
    await page.waitForTimeout(1200);
    const mapJs = await scripts(page);
    notes.push(`${k}: title+map fetched ${mapJs.length} JS files`);
    check(!mapJs.some((n) => /^(pixi|battle2d|game2d)-/.test(n)), `${k}: world map fetched battle code: ${mapJs.join(' ')}`);
    const chapters = await page.evaluate(() => window.__map.chapters().length);
    check(chapters === 5, `${k}: ${chapters} chapter pages`);
    for (let p = 0; p < chapters; p++) {
      await page.evaluate((n) => window.__map.showChapter(n), p);
      await page.waitForTimeout(1500);
      const c = await page.evaluate(() => window.__map.chapter());
      check(c.page === p, `${k}: chapter page ${p} not shown (${JSON.stringify(c)})`);
      await shot(page, `map-ch${p + 1}-${k}`);
    }
    await page.evaluate(() => window.__map.showChapter(0));
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    check(await visible(page, 'game-menu'), `${k}: Esc on the map shows no game menu`);
    check((await visible(page, 'game-menu-quit')) === !size.phone, `${k}: game menu Quit ${size.phone ? 'shown in a browser' : 'missing in the shell'}`);
    await shot(page, `map-escmenu-${k}`);
    await tap(page, '[data-testid="game-menu-settings"]');
    await page.waitForSelector('[data-testid="settings2d"]', { timeout: 15000 });
    await page.waitForTimeout(600);
    await shot(page, `map-settings-${k}`);
    await tap(page, '[data-testid="set2d-tab-graphics"]');
    await page.waitForTimeout(400);
    await shot(page, `map-settings-graphics-${k}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    check(!(await visible(page, 'settings2d')), `${k}: Esc does not close Settings`);
    await ctx.close();
  }
  // 2. A battle on a late island: HUD, codex, pause menu, in-game Settings.
  {
    const { ctx, page } = await context(size);
    await page.goto(`${BASE}/2d.html?level=${ISLAND}&lang=en`);
    await page.waitForFunction(() => !!window.__p0?.state, null, { timeout: 180000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const p = window.__p0;
      p.setGold(4000);
      p.setLives(99);
      const types = ['archer', 'cannon', 'frost', 'tesla', 'mortar', 'barracks'];
      for (let plot = 0; plot < 12; plot++) p.replay.cmd({ k: 'build', plot, type: types[plot % types.length] });
      p.replay.cmd({ k: 'wave' });
    });
    await page.waitForTimeout(6000);
    await shot(page, `battle-${ISLAND}-${k}`);
    const fps = await page.evaluate(() => window.__p0.frameStats?.() ?? null).catch(() => null);
    if (fps) notes.push(`${k}: battle frameStats ${JSON.stringify(fps).slice(0, 200)}`);
    // Codex: the button on the HUD; tiles of foes this island does not load show their file.
    await tap(page, '[data-testid="codex2d-open"]');
    await page.waitForSelector('[data-testid="codex"]', { timeout: 15000 });
    await page.waitForTimeout(1500);
    await shot(page, `battle-codex-${k}`);
    const broken = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="codex"] img')].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).map((i) => i.getAttribute('src')),
    );
    check(broken.length === 0, `${k}: codex images that failed to load: ${broken.join(' ')}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    check(!(await visible(page, 'codex')), `${k}: Esc does not close the codex`);
    if (await page.evaluate(() => window.__p0.state().paused)) await page.keyboard.press(' ');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    check(await page.evaluate(() => window.__p0.state().paused), `${k}: Esc did not pause the battle`);
    check((await visible(page, 'pause2d-quit')) === !size.phone, `${k}: pause Quit ${size.phone ? 'shown in a browser' : 'missing in the shell'}`);
    await shot(page, `battle-pause-${k}`);
    await tap(page, '[data-testid="pause2d-resume"]');
    await page.waitForTimeout(400);
    await ctx.close();
  }
  // 3. Win → the ending (beats → credits roll) → world map.
  {
    const { ctx, page } = await context(size);
    await page.goto(`${BASE}/2d.html?level=${ISLAND}&end=won&story=ending&lang=en`);
    await page.waitForSelector('[data-testid="ending2d"]', { timeout: 180000 });
    await page.waitForTimeout(2500);
    await shot(page, `ending-beat1-${k}`);
    await page.waitForTimeout(6000);
    await shot(page, `ending-later-${k}`);
    await tap(page, '[data-testid="ending2d-skip"]');
    await page.waitForSelector('[data-testid="roll2d"]', { timeout: 15000 });
    await page.waitForTimeout(5000);
    await shot(page, `ending-credits-${k}`);
    await tap(page, '[data-testid="roll2d-skip"]');
    await page.waitForSelector('[data-testid="worldmap2d"]', { timeout: 60000 });
    await page.waitForTimeout(1500);
    check(!page.url().includes('level='), `${k}: ending did not land on the map (${page.url()})`);
    await shot(page, `ending-map-${k}`);
    await ctx.close();
  }
}

await browser.close();
console.log(JSON.stringify({ problems, notes }, null, 1));
process.exit(problems.length ? 1 : 0);
