// Behaviour checks for the living sea on the world map (seaLife.ts), against `vite preview`:
// reduced motion = still (no loop, no CSS motion), hidden tab = stopped, low tier = 30 fps and a
// smaller water canvas, a live Settings change applies, an open sheet idles the sea at <= 20 fps,
// panning to either end keeps the viewport covered by the water layer, no page errors.
// Usage: python3 qa/withPreview.py --port=4393 node qa/seacheck.mjs
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
const report = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GRAPHICS_KEY = 'skyhold_isles_graphics_v1';

async function open(name, { w = 1920, h = 1080, dpr = 1, touch = false, query = '&quality=high', graphics = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: touch, hasTouch: touch });
  if (graphics) await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [GRAPHICS_KEY, JSON.stringify(graphics)]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${name}: pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${name}: console ${m.text()}`);
  });
  await page.goto(`${BASE}/2d.html?lang=en&desktop=${touch ? 0 : 1}${query}`);
  await page.waitForFunction(() => !!window.__sea && !document.getElementById('boot'), null, { timeout: 60000 });
  await sleep(2000);
  return { ctx, page };
}

const stats = (page) => page.evaluate(() => window.__sea.stats());
const framesOver = async (page, ms) => {
  const a = (await stats(page)).frames;
  await sleep(ms);
  return (await stats(page)).frames - a;
};
const motionAnims = (page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === 'running' && /pu-(medal-bob|ripple|ship-bob|pennant|sail)/.test(a.animationName ?? ''))
      .map((a) => a.animationName),
  );
function expect(name, ok, detail) {
  report.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) problems.push(`${name}: ${detail}`);
}

// 1. normal, high: animated, GL on, CSS motion running
{
  const { ctx, page } = await open('high');
  const s = await stats(page);
  const n = await framesOver(page, 2000);
  const anims = await motionAnims(page);
  expect('high: WebGL water live', s.gl && (await page.evaluate(() => document.querySelector('.pu-map').classList.contains('sea-live'))), JSON.stringify(s.waterPx));
  expect('high: sea loop draws', n > 20, `${n} frames / 2 s`);
  expect('high: islands bob, ship rocks, ripple ring', ['pu-medal-bob', 'pu-ship-bob', 'pu-pennant', 'pu-ripple'].every((k) => anims.includes(k)), [...new Set(anims)].join(','));
  // hidden tab
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden = await framesOver(page, 1500);
  expect('hidden tab: loop stopped', hidden === 0, `${hidden} frames / 1.5 s`);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const back = await framesOver(page, 1500);
  expect('visible again: loop resumes', back > 10, `${back} frames / 1.5 s`);
  // sheet open → idles at <= 20 fps
  await page.click('[data-testid="map2d-settings"]');
  await sleep(600);
  const sheet = await framesOver(page, 3000);
  expect('sheet open: sea idles <= 20 fps', sheet <= 66, `${(sheet / 3).toFixed(1)} fps`);
  // live setting: reduced motion on → still
  await page.evaluate((k) => {
    localStorage.setItem(k, JSON.stringify({ reducedMotion: true }));
    window.dispatchEvent(new Event('skyhold:graphics'));
  }, GRAPHICS_KEY);
  await sleep(400);
  const still = await framesOver(page, 1500);
  const s2 = await stats(page);
  expect('live reduced motion: still', s2.still && still <= 1, `${still} frames / 1.5 s`);
  await ctx.close();
}

// 2. reduced motion from the start: one still frame, no CSS motion
{
  const { ctx, page } = await open('reduced', { graphics: { reducedMotion: true } });
  const s = await stats(page);
  const n = await framesOver(page, 2000);
  const anims = await motionAnims(page);
  expect('reduced motion: still', s.still && s.frames >= 1 && n <= 1, `frames ${s.frames}, +${n} in 2 s`);
  expect('reduced motion: no bob / ship / ripple animation', anims.length === 0, anims.join(','));
  // panning a still sea still covers the view
  await page.evaluate(() => (document.querySelector('.pu-map-scroll').scrollLeft = 1e6));
  await sleep(500);
  const cover = await page.evaluate(() => {
    const sc = document.querySelector('.pu-map-scroll');
    const r = document.querySelector('.pu-sea').getBoundingClientRect();
    return { left: r.left, right: r.right, vw: sc.clientWidth };
  });
  expect('reduced motion: panned to the end, water covers the view', cover.left <= 0.5 && cover.right >= cover.vw - 0.5, JSON.stringify(cover));
  await ctx.close();
}

// 3. low tier on a phone: 30 fps, smaller canvas, only the frontier bobs
{
  const { ctx, page } = await open('low phone', { w: 844, h: 390, dpr: 3, touch: true, query: '&quality=low' });
  const s = await stats(page);
  const n = await framesOver(page, 3000);
  const bobs = await page.evaluate(() => document.getAnimations().filter((a) => a.animationName === 'pu-medal-bob').length);
  expect('low: tier low', s.tier === 'low', s.tier);
  expect('low: water canvas <= 0.75 px / css px', s.waterPx[1] <= 390 * 0.75 + 1, JSON.stringify(s.waterPx));
  expect('low: ~30 fps', n / 3 <= 33 && n / 3 >= 15, `${(n / 3).toFixed(1)} fps`);
  expect('low: only the frontier island bobs', bobs === 1, `${bobs} bobbing`);
  await ctx.close();
}

// 4. panning (animated): the water layer follows and always covers the viewport
{
  const { ctx, page } = await open('pan', { w: 844, h: 390, dpr: 2, touch: true, query: '&quality=med' });
  for (const to of [0, 0.25, 0.5, 0.75, 1]) {
    await page.evaluate((f) => {
      const sc = document.querySelector('.pu-map-scroll');
      sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) * f;
    }, to);
    await sleep(250);
    const c = await page.evaluate(() => {
      const sc = document.querySelector('.pu-map-scroll');
      const r = document.querySelector('.pu-sea').getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), vw: sc.clientWidth };
    });
    expect(`pan ${to * 100}%: water covers the view`, c.left <= 0 && c.right >= c.vw, JSON.stringify(c));
  }
  await ctx.close();
}

await browser.close();
console.log(report.join('\n'));
console.log(problems.length ? `PROBLEMS ${problems.length}\n${problems.join('\n')}` : 'problems 0');
process.exit(problems.length ? 1 : 0);
