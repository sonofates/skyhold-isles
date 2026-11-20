// Skill tree fit probe: opens the Heroes tree at every audit size (EN + TR) and reports whether the
// whole tree (down to the capstone's cost pips) is inside the board body without scrolling, plus
// the layout / zoom the fit picked. Optional shots.
// Usage: node qa/treeprobe.mjs [--base=..] [--shots=dir] [--size=2000x991,...] [--hero=bran]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const SHOTS = arg('shots') ?? null;
const HERO = arg('hero') ?? null;
const ALL = [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1 },
  { key: '2000x991', w: 2000, h: 991, dpr: 1 },
  { key: '1600x900', w: 1600, h: 900, dpr: 1 },
  { key: '1366x768', w: 1366, h: 768, dpr: 1 },
  { key: '1280x720', w: 1280, h: 720, dpr: 1 },
  { key: '1024x768', w: 1024, h: 768, dpr: 1 },
  { key: '932x430', w: 932, h: 430, dpr: 2, touch: true },
  { key: '844x390', w: 844, h: 390, dpr: 2, touch: true },
  { key: '667x375', w: 667, h: 375, dpr: 2, touch: true },
];
const SIZES = ALL.filter((s) => !arg('size') || arg('size').split(',').includes(s.key));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const SEED = JSON.stringify({
  ids: IDS,
  progress: {
    version: 2,
    unlockedLevelIndex: 9,
    bestStars: [3, 3, 2, 3, 1, 2, 3, 2, 3, ...Array(16).fill(0)],
    heroes: { selectedHero: 'bran', roster: { bran: { xp: 3200, skills: [] }, wren: { xp: 600, skills: [] }, mira: { xp: 0, skills: [] } } },
  },
});
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
let bad = 0;
for (const lang of ['en', 'tr']) {
  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch });
    await ctx.addInitScript(([s, l]) => {
      if (sessionStorage.getItem('qa-seeded')) return;
      sessionStorage.setItem('qa-seeded', '1');
      localStorage.clear();
      localStorage.setItem('skyhold_isles_language_v1', l);
      localStorage.setItem('skyhold_isles_settings_v1', JSON.stringify({ language: l }));
      localStorage.setItem('skyhold_isles_progress2d_v1', s);
    }, [SEED, lang]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('page error', e.message));
    await page.goto(`${BASE}/2d.html?screen=heroes&lang=${lang}&desktop=${size.touch ? 0 : 1}`);
    await page.waitForSelector('[data-testid="hero2d-tree"] .pu-hnode.cap', { timeout: 60000 });
    if (HERO) await page.click(`[data-testid="tree2d-tab-${HERO}"]`);
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => {
      const tree = document.querySelector('[data-testid="hero2d-tree"]');
      const body = tree.querySelector('.pu-sheet-body');
      const grid = tree.querySelector('.pu-hero-tree-grid');
      const b = body.getBoundingClientRect();
      const nodes = [...tree.querySelectorAll('.pu-hnode')].map((n) => n.getBoundingClientRect());
      const low = Math.max(...nodes.map((n) => n.bottom));
      const right = Math.max(...nodes.map((n) => n.right));
      const names = [...tree.querySelectorAll('.pu-hnode-name')].map((n) => n.getBoundingClientRect().height);
      return {
        scroll: body.scrollHeight - body.clientHeight,
        lowOver: Math.round(low - b.bottom),
        rightOver: Math.round(right - b.right),
        layout: grid.dataset.layout ?? '-',
        zoom: getComputedStyle(grid).getPropertyValue('--tz').trim() || '-',
        medal: Math.round(tree.querySelector('.pu-hnode-medal').getBoundingClientRect().width),
        nameH: Math.round(Math.max(...names)),
        bodyH: Math.round(b.height),
      };
    });
    const ok = r.scroll <= 2 && r.lowOver <= 0 && r.rightOver <= 0;
    if (!ok) bad++;
    console.log(`${ok ? 'ok ' : 'BAD'} ${lang} ${size.key}: scroll ${r.scroll}, capstone bottom vs body ${r.lowOver}, right ${r.rightOver}, layout ${r.layout}, zoom ${r.zoom}, medal ${r.medal}px, name h ${r.nameH}, body ${r.bodyH}`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/tree-${lang}-${size.key}.jpg`, type: 'jpeg', quality: 72 });
    await ctx.close();
  }
}
await browser.close();
console.log(bad ? `tree probe: ${bad} not fitting` : 'tree probe: all fit');
process.exit(bad ? 1 : 0);
