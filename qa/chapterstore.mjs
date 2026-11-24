// Store gate QA for the chapter skeleton: the world map's Chapter 2 page with the "full adventure"
// locks, Chapter 3 fogged with the paid line, and the store card. A browser has no mobile shell
// (and `?iapmock=1` is not wired into the app), so this runs against the vite DEV server, swaps in
// a mobile platform + mock store through the app's own modules and mounts the map again.
// Starts its own dev server (fixed port, refused when taken) and stops it. ONE Chromium.
// Usage: node qa/chapterstore.mjs [--port=4398] [--size=1280x800,932x430]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const PORT = Number(arg('port') ?? 4398);
const OUT = arg('out') ?? 'docs/chapters-shots';
mkdirSync(OUT, { recursive: true });
const SIZES = [
  { key: '1280x800', w: 1280, h: 800, desktop: true },
  { key: '932x430', w: 932, h: 430, touch: true },
].filter((s) => !arg('size') || arg('size').split(',').includes(s.key));

const taken = await new Promise((res) => {
  const s = net.connect(PORT, '127.0.0.1', () => (s.destroy(), res(true)));
  s.on('error', () => res(false));
});
if (taken) {
  console.log(`port ${PORT} is already in use`);
  process.exit(2);
}
const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}`;
const problems = [];
const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const cleared = IDS.indexOf('i10');
const fill = (f) => Array.from({ length: IDS.length }, (_, i) => (i < cleared ? f(i) : 0));
const SAVE = JSON.stringify({
  ids: IDS,
  progress: { version: 2, unlockedLevelIndex: cleared, bestStars: fill((i) => 1 + (i % 3)), bestEndlessWaves: fill(() => 0), bestLives: fill(() => 20), clears: fill(() => 1), workshop: {}, challengeClears: IDS.map(() => []), daily: { lastDay: -1, streak: 0, bestStreak: 0, total: 0 } },
});
let browser;
try {
  for (let i = 0; i < 120; i++) {
    const ok = await fetch(`${BASE}/2d.html`).then((r) => r.ok).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, isMobile: !!size.touch, hasTouch: !!size.touch });
    await ctx.addInitScript((sv) => {
      localStorage.clear();
      localStorage.setItem('skyhold_isles_progress2d_v1', sv);
      localStorage.setItem('skyhold2d_chapter_cards_v1', JSON.stringify({ title: ['ch1', 'ch2', 'ch3'], done: ['ch1', 'ch2', 'ch3'] }));
    }, SAVE);
    const page = await ctx.newPage();
    page.setDefaultTimeout(120000);
    page.on('pageerror', (e) => problems.push(`${size.key}: pageerror ${e.message}`));
    await page.goto(`${BASE}/2d.html?lang=en&desktop=${size.desktop ? 1 : 0}`);
    await page.waitForSelector('[data-testid="worldmap2d"] .pu-node', { timeout: 120000 });
    /** Mobile shell + mock store, then a fresh map on chapter `n` (optionally with the store card for `store`). */
    const remount = (n, store) =>
      page.evaluate(
        async ([chapter, storeFor]) => {
          const plat = await import('/src/platform/index.ts');
          const base = plat.createPlatformAdapter({ bridge: null, mobile: null, storage: null });
          const mobile = { ...base, isMobile: true, mobilePlatform: 'android' };
          plat.setPlatformAdapter(mobile);
          plat.setIapStore(plat.createIapStore({ platform: mobile, mode: 'mock', storage: null }));
          document.querySelector('[data-testid="worldmap2d"]')?.remove();
          document.querySelectorAll('.pu-overlay').forEach((o) => o.remove());
          const { mountWorldMap } = await import('/src/render2d/ui/worldMap.ts');
          await mountWorldMap(new URLSearchParams(`chapter=${chapter}${storeFor ? `&store=${storeFor}` : ''}`));
        },
        [n, store ?? ''],
      );
    for (const [key, n, store] of [
      ['ch2-paid', 2, null],
      ['ch3-locked-paid', 3, null],
      ['store-lock', 2, 'i10'],
    ]) {
      await remount(n, store);
      await page.waitForTimeout(2500);
      const info = await page.evaluate(() => ({
        paid: [...document.querySelectorAll('.pu-node.paid')].map((e) => e.getAttribute('data-testid')),
        veil: document.querySelector('[data-testid="map2d-chapter-veil"]')?.textContent ?? '',
        store: document.querySelector('[data-testid="store2d"] .pu-store-intro')?.textContent ?? null,
      }));
      console.log(`${size.key} ${key}: paid ${info.paid.length} veil "${info.veil}" store "${info.store}"`);
      if (key === 'ch2-paid' && info.paid.length === 0) problems.push(`${size.key} ${key}: no paid lock`);
      if (key === 'ch3-locked-paid' && !/full adventure/.test(info.veil)) problems.push(`${size.key} ${key}: veil lacks the paid line`);
      if (key === 'store-lock' && !/Chapter 2 onward/.test(info.store ?? '')) problems.push(`${size.key} ${key}: store intro lacks "Chapter 2 onward"`);
      await page.screenshot({ path: `${OUT}/${key}-${size.key}.png` });
    }
    await ctx.close();
  }
} finally {
  await browser?.close();
  vite.kill('SIGTERM');
}
console.log(problems.length ? `PROBLEMS (${problems.length}):\n${problems.join('\n')}` : 'no problems');
