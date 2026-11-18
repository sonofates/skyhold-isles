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
// The 2D isles as of this round (l1c + i01..i08); i09..i16 are stood in for by ?mockislands=8.
const REAL_IDS = ['l1c', 'i01', 'i02', 'i03', 'i04', 'i05', 'i06', 'i07', 'i08'];
const MOCK8_IDS = MOCK_IDS.slice(0, 8);
const ALL_CH = ['bowless', 'glassSanctuary', 'thaw', 'galeForce', 'quietGuns', 'thinPurse', 'silentSkies', 'ironTide'];
const save = (ids, stars, unlocked, extra = {}) => {
  const n = ids.length;
  const clears = stars.map((s) => (s > 0 ? 1 : 0));
  const pad = (a, v) => [...a, ...Array(Math.max(0, n - a.length)).fill(v)];
  return JSON.stringify({
    ids,
    progress: {
      version: 2,
      unlockedLevelIndex: unlocked,
      bestStars: pad(stars, 0),
      bestEndlessWaves: pad(extra.endless ?? [], 0),
      bestLives: pad(stars.map((s) => (s ? 14 + s * 2 : 0)), 0),
      clears: pad(clears, 0),
      workshop: extra.workshop ?? {},
      challengeClears: Array.from({ length: n }, (_, i) => extra.badges?.[i] ?? []),
      daily: extra.daily ?? { lastDay: -1, streak: 0, bestStreak: 0, total: 0 },
    },
  });
};
const SEED_ONE = save(['l1c'], [2], 0, { workshop: { treasury: 1 }, daily: { lastDay: -1, streak: 0, bestStreak: 3, total: 4 } });
const SEED_MOCK = save(['l1c', ...MOCK_IDS], [3, 2, 3, 1, 2], 5, { workshop: { treasury: 2, bastion: 1, fletcher: 1 } });
// Modes: l1c won with one badge and a bronze Endless record, i01 mastered-ish, i02 won, i03 open.
const SEED_MODES = save([...REAL_IDS, ...MOCK8_IDS], [3, 3, 2, 1], 4, {
  workshop: { treasury: 1 },
  badges: [['bowless'], ALL_CH, [], []],
  endless: [14, 25, 0, 0],
  daily: { lastDay: -1, streak: 0, bestStreak: 5, total: 7 },
});
const STORY_SEEN = JSON.stringify([...REAL_IDS, ...MOCK_IDS].flatMap((id) => [`${id}:intro`, `${id}:outro`]));

// [name, query, seed (null = empty save), wait ms, action]
const SHOTS = [
  ['map-fresh', '', null, 900],
  ['map-one-island', '', SEED_ONE, 900],
  ['map-route', '?mockislands=12', SEED_MOCK, 1000],
  ['map-17', '?mockislands=8', SEED_MODES, 1000],
  ['brief', '?screen=brief', SEED_ONE, 900],
  ['brief-modes', '?mockislands=8&screen=brief&island=0&pick=bowless', SEED_MODES, 900],
  ['brief-endless', '?mockislands=8&screen=brief&island=1&pick=endless', SEED_MODES, 900],
  ['brief-first', '?mockislands=8&screen=brief&island=4', SEED_MODES, 900],
  ['brief-locked', '?mockislands=12&screen=brief&island=7', SEED_MOCK, 900],
  ['workshop', '?mockislands=12&screen=workshop', SEED_MOCK, 900],
  ['logbook', '?mockislands=8&screen=logbook', SEED_MODES, 900],
  ['logbook-feats', '?mockislands=12&screen=logbook&tab=feats', SEED_MOCK, 900],
  ['daily', '?screen=daily', SEED_ONE, 900],
  ['daily-modes', '?mockislands=8&screen=daily', SEED_MODES, 900],
  ['daily-locked', '?screen=daily', null, 900],
  ['settings', '?screen=settings', SEED_ONE, 900],
  ['story-intro', '?level=l1c&story=intro', null, 3500],
  ['story-intro-all', '?level=l1c&story=intro', null, 3500, 'next2'],
  ['story-outro', '?level=l1c&story=outro&end=won', null, 4200],
  ['game-codex-button', '?level=l1c', null, 3500],
  ['end-won', '?level=l1c&end=won', null, 4200],
  ['end-lost', '?level=l1c&end=lost', null, 4200],
  // Real recording paths (plain play, the result goes through progress2d), then the board.
  ['end-challenge', '?level=l1c&challenge=glassSanctuary', SEED_MODES, 2500, 'win'],
  ['end-daily', '?daily=1', SEED_ONE, 2500, 'win'],
  ['end-endless', '?level=l1c&endless=1', SEED_MODES, 2500, 'endless'],
  ['game-endless-hud', '?level=l1c&endless=1', SEED_MODES, 2500, 'endlessHud'],
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
    const key = `${name}-${size.key}`;
    if (only && !key.includes(only)) continue;
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: size.touch, hasTouch: size.touch });
    await ctx.addInitScript(
      ([s, seen]) => {
        try {
          // Seed once per context (a reload after a recorded run keeps the result).
          if (sessionStorage.getItem('qa-seeded')) return;
          sessionStorage.setItem('qa-seeded', '1');
          localStorage.clear();
          if (s) localStorage.setItem('skyhold_isles_progress2d_v1', s);
          if (s) localStorage.setItem('skyhold_isles_story2d_seen_v1', seen);
        } catch {
          /* ignore */
        }
      },
      [seed, STORY_SEEN],
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${key}: page error ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/404|Failed to load resource|navigator.vibrate/.test(m.text())) problems.push(`${key}: console ${m.text()}`);
    });
    await page.goto(`${BASE}/2d.html${query}`);
    await page.waitForTimeout(wait);
    if (action === 'next2') {
      for (let i = 0; i < 2; i++) {
        await page.click('[data-testid="story2d-next"]');
        await page.waitForTimeout(450);
      }
    }
    if (action === 'win') {
      await page.evaluate(() => window.__p0.forceEnd('won'));
      await page.waitForTimeout(2200);
    } else if (action === 'endless' || action === 'endlessHud') {
      await page.evaluate(() => window.__p0.skipToWave(17));
      await page.waitForTimeout(action === 'endless' ? 400 : 1200);
      if (action === 'endless') {
        await page.evaluate(() => window.__p0.forceEnd('lost'));
        await page.waitForTimeout(2200);
      }
    }
    if (action === 'win' || action === 'endless') {
      const note = await page.evaluate(() => window.__p0.state().end?.note ?? null);
      console.log(`  ${key} note:`, JSON.stringify(note));
      if (!note) problems.push(`${key}: no mode note on the end panel`);
    }
    await checkBounds(page, key);
    await page.screenshot({ path: `${OUT}/${key}.jpg`, type: 'jpeg', quality: 84 });
    console.log('shot', key);
    await ctx.close();
  }
}
await browser.close();
console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}` : 'no layout problems found');
