// UI3 probe: opens the build ring (and the tower ring) on every plot of an island at several
// screen sizes and checks the ring (medallions + price tags + tooltip) never overlaps the in-game
// HUD buttons: the Guide (Codex) button and its caption, pause and speed. Prints the overlaps.
// Usage: node qa/ringprobe.mjs [--base=http://127.0.0.1:4173] [--level=l1c,i01] [--lang=tr] [--shots=dir] [--plot=3,4]
// (--shots saves a shot of every overlap, and of the plots listed in --plot)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4173';
const LEVELS = (arg('level') ?? 'l1c').split(',');
const LANG = arg('lang') ?? 'tr';
const SHOTS = arg('shots');
const SHOT_PLOTS = (arg('plot') ?? '').split(',').filter(Boolean).map(Number);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const SIZES = [
  { key: '1366x768', w: 1366, h: 768, dpr: 1, touch: false },
  { key: '1600x900', w: 1600, h: 900, dpr: 1, touch: false },
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1, touch: false },
  { key: '2560x1080', w: 2560, h: 1080, dpr: 1, touch: false },
  { key: 'phone-844x390', w: 844, h: 390, dpr: 2, touch: true },
];

const problems = [];
let checks = 0;
const browser = await chromium.launch({ args: ARGS });
for (const level of LEVELS) {
  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: size.touch, hasTouch: size.touch, locale: LANG === 'tr' ? 'tr-TR' : 'en-US' });
    await ctx.addInitScript((lang) => {
      try {
        if (sessionStorage.getItem('qa-seeded')) return;
        sessionStorage.setItem('qa-seeded', '1');
        localStorage.clear();
        localStorage.setItem('skyhold_isles_language_v1', lang);
      } catch {
        /* ignore */
      }
    }, LANG);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${size.key}: page error ${e.message}`));
    await page.goto(`${BASE}/2d.html?level=${level}`);
    await page.waitForFunction(() => window.__p0, null, { timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__p0.setGold(5000));
    const n = await page.evaluate(() => window.__p0.state().plots.count);
    const tap = async (x, y) => {
      if (size.touch) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await page.waitForTimeout(260);
    };
    const measure = async (label) => {
      const res = await page.evaluate(() => {
        const ring = window.__p0.state().ring;
        const btn = document.querySelector('[data-testid="codex2d-open"]');
        const rects = [];
        if (btn && getComputedStyle(btn).display !== 'none') {
          rects.push(['guide', btn.getBoundingClientRect().toJSON()]);
          const cap = btn.querySelector('.pu-round-label');
          if (cap) rects.push(['guide caption', cap.getBoundingClientRect().toJSON()]);
        }
        const hud = window.__p0.state().hud;
        rects.push(['pause', hud.pause], ['speed', hud.speed]);
        return { ring, rects };
      });
      const ring = res.ring;
      if (!ring?.open) return;
      checks++;
      const boxes = [ring.layout.box];
      if (ring.layout.tooltip) boxes.push(ring.layout.tooltip);
      for (const [name, r] of res.rects) {
        const R = { x: r.x ?? r.left, y: r.y ?? r.top, w: r.width ?? r.w, h: r.height ?? r.h };
        for (const b of boxes) {
          if (b.x < R.x + R.w && b.x + b.w > R.x && b.y < R.y + R.h && b.y + b.h > R.y) {
            problems.push(`${level} ${size.key} ${label}: ring overlaps ${name}`);
            return true;
          }
        }
      }
      return false;
    };
    for (let i = 0; i < n; i++) {
      const p = await page.evaluate((k) => window.__p0.plotScreen(k), i);
      if (!p) break;
      await tap(p.x, p.y);
      const bad = await measure(`plot ${i} build`);
      if ((bad || SHOT_PLOTS.includes(i)) && SHOTS) await page.screenshot({ path: `${SHOTS}/${level}-${size.key}-plot${i}.jpg`, type: 'jpeg', quality: 70 });
      // Hover / select the first medallion so the tooltip shows, then measure again.
      const r = await page.evaluate(() => window.__p0.state().ring);
      if (r?.open && r.tokens[0]) {
        await tap(r.tokens[0].x, r.tokens[0].y);
        await measure(`plot ${i} build+tip`);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
    }
    await ctx.close();
  }
}
await browser.close();
console.log(`${checks} ring checks`);
console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}` : 'no ring / HUD button overlaps');
process.exitCode = problems.length ? 1 : 0;
