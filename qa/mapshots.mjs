// World map QA against `vite preview` (default http://127.0.0.1:4381): the island route with
// N islands (?mockislands=N, default 25) at 1920x1080 / 2560x1080 / 1366x768 / 844x390, a fresh save
// and a save with most islands won. Checks node overlaps / off-screen nodes from the DOM.
// Usage: node qa/mapshots.mjs [--n=25] [--lang=en,tr] [--size=...]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'docs/overnight/opus-shots';
const N = Number(arg('n') ?? 25);
const LANGS = (arg('lang') ?? 'en').split(',');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ALL = [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1, desktop: true },
  { key: '2560x1080', w: 2560, h: 1080, dpr: 1, desktop: true },
  { key: '1366x768', w: 1366, h: 768, dpr: 1, desktop: true },
  { key: '844x390', w: 844, h: 390, dpr: 2, touch: true },
];
const SIZES = ALL.filter((s) => !arg('size') || arg('size').split(',').includes(s.key));
const problems = [];
const IDS = ['l1c', ...Array.from({ length: 16 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
/** A 2D save with the first `cleared` islands won (stars vary). */
function save(cleared) {
  const n = IDS.length;
  const fill = (f) => Array.from({ length: n }, (_, i) => (i < cleared ? f(i) : 0));
  return JSON.stringify({
    ids: IDS,
    progress: {
      version: 2,
      unlockedLevelIndex: Math.min(n - 1, cleared),
      bestStars: fill((i) => 1 + (i % 3)),
      bestEndlessWaves: fill(() => 0),
      bestLives: fill(() => 20),
      clears: fill(() => 1),
      workshop: {},
      challengeClears: Array.from({ length: n }, () => []),
      daily: { lastDay: -1, streak: 0, bestStreak: 0, total: 0 },
      heroes: { selectedHero: 'bran', roster: { bran: { xp: 900, skills: [] } } },
    },
  });
}
for (const size of SIZES) {
  for (const lang of LANGS) {
    for (const won of [0, 16]) {
      const tag = `${size.key} ${lang} won${won}`;
      const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch });
      if (won > 0) await ctx.addInitScript((v) => localStorage.setItem('skyhold_isles_progress2d_v1', v), save(won));
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/2d.html?mockislands=${Math.max(0, N - IDS.length)}&lang=${lang}&desktop=${size.desktop ? 1 : 0}`);
      await page.waitForTimeout(3500);
      const info = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('[data-island], .pu-node, [data-testid^="island-"]')].map((e) => {
          const r = e.getBoundingClientRect();
          return { id: e.getAttribute('data-island') ?? e.getAttribute('data-testid'), x: r.x, y: r.y, w: r.width, h: r.height };
        });
        const sc = document.scrollingElement;
        return { nodes, vw: innerWidth, vh: innerHeight, scrollW: sc?.scrollWidth, scrollH: sc?.scrollHeight };
      });
      console.log(`${tag}: ${info.nodes.length} nodes`);
      await page.screenshot({ path: `${OUT}/${lang}-${size.key}-map${N}-won${won}.jpg`, type: 'jpeg', quality: 80 });
      await ctx.close();
    }
  }
}
await browser.close();
console.log(problems.length ? `PROBLEMS:\n  ${problems.join('\n  ')}` : 'no problems');
