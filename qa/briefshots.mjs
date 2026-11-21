// Island briefing declutter QA (task 2026-11-21 briefing-ui): the briefing on a first-time island
// (no clears: lock hint, hero, belt) and on a won island (challenges + Endless), TR and EN, at phone
// landscape and laptop / desktop sizes. Logs fit (Play on screen, body scroll overflow, focus on
// Play) and writes PNGs. Runs against the vite DEV server (save setup imports dev modules):
//   python3 /tmp/briefui_dev.py 4433 node qa/briefshots.mjs --out=/tmp/briefui/after [--only=844x390]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4433';
const OUT = arg('out') ?? '/tmp/briefui/shots';
const ONLY = arg('only');
const LANGS = (arg('langs') ?? 'tr,en').split(',');
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const SIZES = [
  { w: 844, h: 390, touch: true },
  { w: 667, h: 375, touch: true },
  { w: 1280, h: 800 },
  { w: 1440, h: 900 },
  { w: 1067, h: 1082 },
];
let fails = 0;
const fail = (m) => {
  fails++;
  console.log('FAIL', m);
};

const IDS = ['l1c', ...Array.from({ length: 40 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const pad = (a, v) => [...a, ...Array(Math.max(0, IDS.length - a.length)).fill(v)];
/** Islands 0..3 won (3 has a few clears), island 4 is the frontier (never won). */
const PROGRESS = JSON.stringify({
  ids: IDS,
  progress: {
    version: 2,
    unlockedLevelIndex: 4,
    bestStars: pad([3, 3, 2, 2], 0),
    bestEndlessWaves: pad([], 0),
    bestLives: pad([18, 18, 16, 14], 0),
    clears: pad([4, 4, 3, 2], 0),
    workshop: {},
    challengeClears: pad([], []),
    daily: { lastDay: -1, streak: 0, bestStreak: 0, total: 0 },
  },
});
const setup = `(async () => {
  localStorage.setItem('skyhold_isles_progress2d_v1', ${JSON.stringify(PROGRESS)});
  const m = await import('/src/render2d/ui/market2d.ts');
  m.deliverPacks2D([{ pack: 'crystals_large', transactionId: 'qa-' + Date.now() }]);
  for (const id of ['emberPot','frostLantern','heartstone','skyPurse','cloudguard','galeBell']) for (let i = 0; i < 4; i++) m.buyItem2D(id);
  m.setLoadout2D(['emberPot', 'heartstone', 'cloudguard']);
  localStorage.setItem('skyhold_market_seen_v1', '1');
})()`;

for (const s of SIZES) {
  const tag = `${s.w}x${s.h}`;
  if (ONLY && !ONLY.split(',').includes(tag)) continue;
  for (const lang of LANGS) {
    for (const [kind, island] of [['first', 4], ['won', 3], ['locked', 6]]) {
      const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, isMobile: !!s.touch, hasTouch: !!s.touch });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.log('pageerror', e.message));
      await page.goto(`${BASE}/2d.html?lang=${lang}&screen=none`);
      await page.waitForTimeout(1500);
      await page.evaluate(setup);
      await page.goto(`${BASE}/2d.html?lang=${lang}&screen=brief&island=${island}`);
      await page.waitForSelector('[data-testid="brief2d-play"]', { timeout: 90000 });
      await page.waitForTimeout(1500);
      const m = await page.evaluate(() => {
        const q = (sel) => document.querySelector(sel);
        const r = (e) => {
          if (!e) return null;
          const b = e.getBoundingClientRect();
          return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right) };
        };
        const body = q('[data-testid="brief2d"] .pu-sheet-body');
        const play = q('[data-testid="brief2d-play"]');
        // Any visible element cut by the viewport / the scrolling body.
        const cut = [];
        const bb = body.getBoundingClientRect();
        for (const e of body.querySelectorAll('button, .pu-brief-row, .pu-diff, .pu-hero-chip, .pu-beltchip, .pu-loadout')) {
          const b = e.getBoundingClientRect();
          if (b.width === 0) continue;
          if (b.bottom > Math.min(innerHeight, bb.bottom) + 1 || b.right > Math.min(innerWidth, bb.right) + 1) cut.push(e.dataset.testid || e.className);
        }
        return {
          play: r(play),
          sheet: r(q('[data-testid="brief2d"] .pu-sheet')),
          overflowY: body.scrollHeight - body.clientHeight,
          overflowX: body.scrollWidth - body.clientWidth,
          focus: document.activeElement?.dataset?.testid ?? document.activeElement?.className,
          cut,
          h: innerHeight,
        };
      });
      const name = `brief-${kind}-${tag}-${lang}`;
      console.log(name, JSON.stringify(m));
      if (m.play.b > m.h) fail(`${name}: Play off screen`);
      if (m.overflowY > 1) fail(`${name}: body scrolls by ${m.overflowY}px`);
      if (m.overflowX > 1) fail(`${name}: body overflows sideways by ${m.overflowX}px`);
      if (m.cut.length) fail(`${name}: cut ${m.cut.join(' ')}`);
      if (kind !== 'locked' && m.focus !== 'brief2d-play') fail(`${name}: focus on ${m.focus}`);
      await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 120000 });

      // Keyboard / pad: from Play, the arrows must reach every control of the card (BFS).
      if (lang === LANGS[0] && kind !== 'locked') {
        const ids = await page.evaluate(() =>
          [...document.querySelectorAll('[data-testid="brief2d"] button')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.dataset.testid ?? b.className),
        );
        const seen = new Set(['brief2d-play']);
        const queue = ['brief2d-play'];
        while (queue.length) {
          const from = queue.shift();
          for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
            await page.evaluate((id) => document.querySelector(`[data-testid="${id}"]`)?.focus(), from);
            await page.keyboard.press(key);
            const to = await page.evaluate(() => document.activeElement?.dataset?.testid);
            if (to && !seen.has(to)) {
              seen.add(to);
              queue.push(to);
            }
          }
        }
        // Radio planks are one stop (the checked one); the others are picked with ← →.
        const missing = ids.filter((id) => !seen.has(id) && !/^brief2d-diff-/.test(id));
        console.log(`${name} nav reached ${seen.size}/${ids.length}${missing.length ? ` missing ${missing.join(' ')}` : ''}`);
        if (missing.length) fail(`${name}: nav misses ${missing.join(' ')}`);
      }

      // Phones / won isle: Hard (rule line shows) and Endless (belt off stamp) must still fit.
      if (kind === 'won') {
        for (const [what, sel] of [['hard', 'brief2d-diff-hard'], ['endless', 'brief2d-endless']]) {
          await page.click(`[data-testid="${sel}"]`);
          await page.waitForTimeout(250);
          const f = await page.evaluate(() => {
            const body = document.querySelector('[data-testid="brief2d"] .pu-sheet-body');
            const play = document.querySelector('[data-testid="brief2d-play"]').getBoundingClientRect();
            return { overflowY: body.scrollHeight - body.clientHeight, playBottom: Math.round(play.bottom), h: innerHeight };
          });
          console.log(`${name}-${what}`, JSON.stringify(f));
          if (f.overflowY > 1 || f.playBottom > f.h) fail(`${name}-${what}: does not fit`);
          await page.screenshot({ path: `${OUT}/${name}-${what}.png`, timeout: 120000 });
        }
      }
      await ctx.close();
    }
  }
}
await browser.close();
console.log(fails ? `${fails} problem(s)` : 'briefshots ok');
process.exit(fails ? 1 : 0);
