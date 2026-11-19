// Restart / Replay / pause-menu QA against `vite preview` (default http://127.0.0.1:4381).
// Plays a short real run on l1c through the recorded command layer (fast-forwarded with
// __p0.replay.step), then: end panel with Watch replay, the replay player (1×, 4×, paused), leaving
// it, watching it to the end (must reproduce the run: replay.matched === true), the pause menu,
// the Restart and Leave confirm boards.
// Writes JPEGs to docs/overnight/opus-shots/ as <lang>-<size>-<shot>.jpg and prints problems.
// Usage: node qa/replayshots.mjs [--base=] [--lang=en,tr] [--size=1920x1080,844x390]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'docs/overnight/opus-shots';
const LANGS = (arg('lang') ?? 'en,tr').split(',');
const LEVEL = arg('level') ?? 'l1c';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const ALL_SIZES = [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1, desktop: true },
  { key: '1920x1080@2', w: 1920, h: 1080, dpr: 2, desktop: true },
  { key: '844x390', w: 844, h: 390, dpr: 2, touch: true },
];
const SIZES = ALL_SIZES.filter((s) => !arg('size') || arg('size').split(',').includes(s.key));
const problems = [];
const ok = (cond, msg) => {
  if (!cond) problems.push(msg);
};

async function open(size, lang, query) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: size.dpr,
    isMobile: !!size.touch,
    hasTouch: !!size.touch,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${size.key} ${lang}: pageerror ${e.message}`));
  await page.goto(`${BASE}/2d.html?${query}&lang=${lang}&desktop=${size.desktop ? 1 : 0}`);
  await page.waitForFunction(() => window.__p0?.replay && !document.getElementById('boot'), null, { timeout: 60000 });
  await page.waitForTimeout(400);
  return { ctx, page };
}
const shot = (page, size, lang, name) => page.screenshot({ path: `${OUT}/${lang}-${size.key}-${name}.jpg`, type: 'jpeg', quality: 84 });
const st = (page) => page.evaluate(() => window.__p0.state());
const press = async (page, size, x, y) => {
  if (size.touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
};
/** Taps an end-board button until `done(state)` (SwiftShader frames are slow: the board's 0.4 s tap guard needs a few). */
async function pressEnd(page, size, action, done) {
  for (let i = 0; i < 8; i++) {
    const s = await st(page);
    const b = s.end?.buttons.find((x) => x.action === action);
    if (b) await press(page, size, b.x, b.y);
    await page.waitForTimeout(400);
    if (done(await st(page))) return true;
  }
  return false;
}

/** A short real run: a few towers, the hero walks, waves called early, until it ends. */
async function playRun(page) {
  return page.evaluate(() => {
    const p = window.__p0;
    const r = p.replay;
    const w0 = p.state();
    r.cmd({ k: 'build', plot: 0, type: 'archer' });
    r.cmd({ k: 'build', plot: 1, type: 'cannon' });
    r.cmd({ k: 'speed', s: 3 });
    for (let i = 0; i < 400; i++) {
      const s = p.state();
      if (s.outcome !== 'ongoing') break;
      if (i % 3 === 0) r.cmd({ k: 'wave' });
      if (i === 5 && s.hero) r.cmd({ k: 'heroMove', x: s.hero.x + 2, z: s.hero.z - 3 });
      if (i === 12 && s.towers.length > 0) r.cmd({ k: 'upgrade', id: s.towers[0].id });
      if (i === 14) r.cmd({ k: 'build', plot: 2, type: 'archer' });
      r.step(30);
    }
    return { start: w0.ticks, end: p.state() };
  });
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    const tag = `${size.key} ${lang}`;
    const { ctx, page } = await open(size, lang, `level=${LEVEL}&hero=bran&herolevel=8`);
    const run = await playRun(page);
    ok(run.end.outcome !== 'ongoing', `${tag}: run did not end (${run.end.outcome}, wave ${run.end.wave})`);
    await page.waitForTimeout(1400);
    let s = await st(page);
    ok(s.replay.last && s.replay.last.commands >= 5, `${tag}: replay not recorded (${JSON.stringify(s.replay)})`);
    const btn = s.end?.buttons.find((b) => b.action === 'replay');
    ok(!!btn, `${tag}: end panel has no replay button (${JSON.stringify(s.end?.buttons)})`);
    await shot(page, size, lang, 'end-with-replay');
    if (!btn) {
      await ctx.close();
      continue;
    }
    // Watch replay.
    await pressEnd(page, size, 'replay', (x) => x.replay.playing && !x.end);
    s = await st(page);
    ok(s.replay.playing && s.ticks < 200, `${tag}: replay did not start (${JSON.stringify(s.replay)} ticks ${s.ticks})`);
    await page.evaluate(() => window.__p0.replay.step(60));
    await page.waitForTimeout(300);
    await shot(page, size, lang, 'replay-1x');
    await page.locator('[data-testid="replay2d-speed-4"]').click();
    await page.evaluate(() => window.__p0.replay.step(80));
    await page.waitForTimeout(300);
    s = await st(page);
    ok(s.speed === 4, `${tag}: 4× chip did not set speed (${s.speed})`);
    await shot(page, size, lang, 'replay-4x');
    await page.locator('[data-testid="replay2d-play"]').click();
    await page.waitForTimeout(300);
    s = await st(page);
    ok(s.paused, `${tag}: replay pause button did not pause`);
    await shot(page, size, lang, 'replay-paused');
    // Leave: the recorded board comes back.
    await page.locator('[data-testid="replay2d-exit"]').click();
    await page.waitForTimeout(900);
    s = await st(page);
    ok(!!s.end && (await page.locator('[data-testid="replay2d-bar"]').isHidden()), `${tag}: leaving the replay did not show the end board`);
    await shot(page, size, lang, 'replay-left');
    // Watch again, to the end: it must reproduce the run.
    ok(await pressEnd(page, size, 'replay', (x) => x.replay.playing && !x.end), `${tag}: watch again did not start`);
    await page.evaluate(() => {
      const p = window.__p0;
      for (let i = 0; i < 2000 && p.state().outcome === 'ongoing'; i++) p.replay.step(20);
    });
    await page.waitForTimeout(900);
    s = await st(page);
    ok(s.replay.matched === true, `${tag}: replay did not reproduce the run (${JSON.stringify(s.replay)})`);
    ok(!!s.end, `${tag}: no end board after the replay`);
    await shot(page, size, lang, 'replay-ended');
    // Retry → live run, pause menu.
    await pressEnd(page, size, 'retry', (x) => !x.replay.playing && !x.end);
    s = await st(page);
    ok(!s.replay.playing && s.ticks < 300 && s.towers.length === 0, `${tag}: retry did not start a fresh live run`);
    await page.evaluate(() => {
      window.__p0.replay.cmd({ k: 'build', plot: 0, type: 'archer' });
      window.__p0.replay.cmd({ k: 'wave' });
      window.__p0.replay.step(40);
    });
    const pause = s.buttons.pause;
    await press(page, size, pause.x, pause.y);
    await page.waitForTimeout(500);
    ok(await page.locator('[data-testid="pause2d-menu"]').isVisible(), `${tag}: pause menu not shown`);
    await shot(page, size, lang, 'pause-menu');
    await page.locator('[data-testid="pause2d-restart"]').click();
    await page.waitForTimeout(400);
    ok(await page.locator('[data-testid="confirm-restart"]').isVisible(), `${tag}: restart confirm not shown`);
    await shot(page, size, lang, 'confirm-restart');
    await page.locator('[data-testid="confirm-restart-no"]').click();
    await page.waitForTimeout(300);
    s = await st(page);
    ok(s.paused && s.towers.length === 1, `${tag}: cancel changed the run`);
    await page.locator('[data-testid="pause2d-map"]').click();
    await page.waitForTimeout(400);
    await shot(page, size, lang, 'confirm-leave');
    await page.locator('[data-testid="confirm-leave-no"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="pause2d-restart"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="confirm-restart-yes"]').click();
    await page.waitForTimeout(500);
    s = await st(page);
    ok(!s.paused && s.towers.length === 0 && s.wave <= 1 && s.ticks < 200, `${tag}: restart did not restart (${s.towers.length} towers, wave ${s.wave}, ticks ${s.ticks})`);
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
    await ctx.close();
    console.log(`${tag}: done`);
  }
}
await browser.close();
if (problems.length) {
  console.log(`PROBLEMS (${problems.length}):\n  ` + problems.join('\n  '));
  process.exitCode = 1;
} else console.log('no problems');
