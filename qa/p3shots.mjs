// P3 UI screenshots (world map, briefing, story panels, meta screens, codex button, end panel) at
// phone landscape (844x390, touch) and desktop (1600x900; the map also at 2560x1080 21:9), against
// `vite preview`. Writes JPEGs to docs/p3-shots/ and prints layout problems it can measure: any
// visible element of the painted UI outside the viewport, and overlapping island nodes.
// Usage: node qa/p3shots.mjs [only-substring] [--base=http://127.0.0.1:4173] [--out=docs/p3-shots]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? process.env.BASE ?? 'http://127.0.0.1:4173';
const OUT = arg('out') ?? process.env.OUT ?? 'docs/p3-shots';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const only = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '';

const SIZES = [
  { key: 'phone-844x390', w: 844, h: 390, dpr: 2, touch: true },
  { key: 'desk-1600x900', w: 1600, h: 900, dpr: 1, touch: false },
];
const WIDE = { key: 'wide-2560x1080', w: 2560, h: 1080, dpr: 1, touch: false };

const MOCK_IDS = Array.from({ length: 12 }, (_, i) => `mock-${i + 1}`);
const save = (ids, stars, unlocked, extra = {}) => {
  const n = ids.length;
  const clears = stars.map((s) => (s > 0 ? 1 : 0));
  return JSON.stringify({
    ids,
    progress: {
      version: 2,
      unlockedLevelIndex: unlocked,
      bestStars: [...stars, ...Array(n - stars.length).fill(0)],
      bestEndlessWaves: Array(n).fill(0),
      bestLives: [...stars.map((s) => (s ? 14 + s * 2 : 0)), ...Array(n - stars.length).fill(0)],
      clears: [...clears, ...Array(n - clears.length).fill(0)],
      workshop: extra.workshop ?? {},
      challengeClears: Array.from({ length: n }, () => []),
      daily: extra.daily ?? { lastDay: -1, streak: 0, bestStreak: 0, total: 0 },
    },
  });
};
const SEED_ONE = save(['l1c'], [2], 0, { workshop: { treasury: 1 }, daily: { lastDay: -1, streak: 0, bestStreak: 3, total: 4 } });
const SEED_MOCK = save(['l1c', ...MOCK_IDS], [3, 2, 3, 1, 2], 5, { workshop: { treasury: 2, bastion: 1, fletcher: 1 } });

// [name, query, seed (null = empty save), wait ms, action]
const SHOTS = [
  ['map-fresh', '', null, 900],
  ['map-one-island', '', SEED_ONE, 900],
  ['map-route', '?mockislands=12', SEED_MOCK, 1000],
  ['brief', '?screen=brief', SEED_ONE, 900],
  ['brief-locked', '?mockislands=12&screen=brief&island=7', SEED_MOCK, 900],
  ['workshop', '?mockislands=12&screen=workshop', SEED_MOCK, 900],
  ['logbook', '?mockislands=12&screen=logbook', SEED_MOCK, 900],
  ['logbook-feats', '?mockislands=12&screen=logbook&tab=feats', SEED_MOCK, 900],
  ['daily', '?screen=daily', SEED_ONE, 900],
  ['daily-locked', '?screen=daily', null, 900],
  ['settings', '?screen=settings', SEED_ONE, 900],
  ['story-intro', '?level=l1c&story=intro', null, 3500],
  ['story-intro-all', '?level=l1c&story=intro', null, 3500, 'next2'],
  ['story-outro', '?level=l1c&story=outro&end=won', null, 4200],
  ['game-codex-button', '?level=l1c', null, 3500],
  ['end-won', '?level=l1c&end=won', null, 4200],
  ['end-lost', '?level=l1c&end=lost', null, 4200],
];

const problems = [];

async function checkBounds(page, name) {
  const bad = await page.evaluate(() => {
    const out = [];
    const W = window.innerWidth;
    const H = window.innerHeight;
    const sel = '.pu-sheet, .pu-plank, .pu-round, .pu-tally, .pu-title-banner, .pu-panel, .pu-toggle, .pu-slider';
    for (const e of document.querySelectorAll(sel)) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || getComputedStyle(e).visibility === 'hidden') continue;
      // Elements inside a scrolling body may be scrolled out of view; only check the scroll container.
      const scroller = e.closest('.pu-sheet-body, .pu-map-scroll');
      if (scroller && scroller !== e) {
        const sr = scroller.getBoundingClientRect();
        if (r.bottom < sr.top || r.top > sr.bottom || r.right < sr.left || r.left > sr.right) continue;
      }
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(`${e.className} @ ${r.left.toFixed(0)},${r.top.toFixed(0)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
    }
    // Text that overflows its plank / tag horizontally.
    for (const e of document.querySelectorAll('.pu-plank, .pu-tag, .pu-sheet-title')) {
      if (e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0) out.push(`overflowing text: ${e.textContent?.slice(0, 40)}`);
    }
    const nodes = [...document.querySelectorAll('.pu-node')].map((n) => n.getBoundingClientRect());
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) out.push(`nodes ${i} and ${j} overlap`);
      }
    return out;
  });
  for (const b of bad) problems.push(`${name}: ${b}`);
}

const browser = await chromium.launch({ args: ARGS });
for (const size of [...SIZES, WIDE]) {
  for (const [name, query, seed, wait, action] of SHOTS) {
    if (size === WIDE && !name.startsWith('map') && name !== 'workshop' && name !== 'story-intro' && name !== 'end-won') continue;
    const key = `${name}-${size.key}`;
    if (only && !key.includes(only)) continue;
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: size.touch, hasTouch: size.touch });
    await ctx.addInitScript((s) => {
      try {
        localStorage.clear();
        if (s) localStorage.setItem('skyhold_isles_progress2d_v1', s);
      } catch {
        /* ignore */
      }
    }, seed);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${key}: page error ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) problems.push(`${key}: console ${m.text()}`);
    });
    await page.goto(`${BASE}/2d.html${query}`);
    await page.waitForTimeout(wait);
    if (action === 'next2') {
      for (let i = 0; i < 2; i++) {
        await page.click('[data-testid="story2d-next"]');
        await page.waitForTimeout(450);
      }
    }
    await checkBounds(page, key);
    await page.screenshot({ path: `${OUT}/${key}.jpg`, type: 'jpeg', quality: 84 });
    console.log('shot', key);
    await ctx.close();
  }
}
await browser.close();
console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}` : 'no layout problems found');
