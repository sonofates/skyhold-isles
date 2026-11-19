// Probe: phone briefing heights with and without the difficulty selector (layout budget).
// Usage: node qa/diffprobe.mjs --base=http://127.0.0.1:4417
import { chromium } from 'playwright';

const BASE = process.argv.find((a) => a.startsWith('--base='))?.slice(7) ?? 'http://127.0.0.1:4173';
const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const pad = (a, v) => [...a, ...Array(Math.max(0, IDS.length - a.length)).fill(v)];
const SEED = JSON.stringify({ ids: IDS, progress: { version: 2, unlockedLevelIndex: 9, bestStars: pad([3, 3, 2, 3, 1, 2, 3, 2, 3], 0), bestEndlessWaves: pad([], 0), bestLives: pad([18, 18, 16, 18, 14, 16, 18, 16, 18], 0), clears: pad([4, 4, 3, 4, 2, 3, 4, 3, 4], 0), workshop: {}, challengeClears: pad([], []), daily: { lastDay: -1, streak: 0, bestStreak: 0, total: 0 } } });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [w, h] of [[844, 390], [740, 360], [932, 430], [667, 375]]) {
  for (const island of [3, 9]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addInitScript((s) => {
      localStorage.setItem('skyhold_isles_progress2d_v1', s);
    }, SEED);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/2d.html?screen=brief&island=${island}`);
    await page.waitForTimeout(900);
    const m = await page.evaluate(() => {
      const r = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width) };
      };
      const out = { sheet: r('.pu-sheet'), body: r('.pu-sheet-body'), main: r('.pu-brief-body'), actions: r('.pu-brief-actions'), diff: r('.pu-diff'), play: r('[data-testid="brief2d-play"]') };
      document.querySelector('.pu-diff')?.remove();
      out.playWithout = r('[data-testid="brief2d-play"]');
      return out;
    });
    console.log(`${w}x${h} island ${island}: ${JSON.stringify(m)}`);
    await ctx.close();
  }
}
await browser.close();
