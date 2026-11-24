// Chapter skeleton QA (docs/handoff-chapters-skeleton.md): the world map's chapter pages, the
// chapter cards and the store lock, at 1280x800 (desktop) and 932x430 (phone landscape, pu-phone).
// ONE Chromium, one page at a time. Checks from the DOM: page errors, the chapter bar never covers
// an island node or its name plank, nodes stay on screen vertically, keys / arrows turn pages.
// Usage: python3 qa/withPreview.py --port=4397 node qa/chaptershots.mjs [--size=1280x800,932x430] [--only=ch2,...]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'docs/chapters-shots';
const ONLY = arg('only')?.split(',');
/** Extra query for every page (e.g. `--extra=&quality=high` to see the WebGL water in SwiftShader). */
const EXTRA = arg('extra') ?? '';
const SUFFIX = arg('suffix') ?? '';
const LANG = arg('lang') ?? 'en';
mkdirSync(OUT, { recursive: true });
const SIZES = [
  { key: '1280x800', w: 1280, h: 800, desktop: true },
  { key: '932x430', w: 932, h: 430, touch: true },
].filter((s) => !arg('size') || arg('size').split(',').includes(s.key));

const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
/** A 2D save with every island before `upTo` won (stars vary). */
function save(upTo) {
  const n = IDS.length;
  const cleared = upTo === 'all' ? n : IDS.indexOf(upTo);
  const fill = (f) => Array.from({ length: n }, (_, i) => (i < cleared ? f(i) : 0));
  return JSON.stringify({
    ids: IDS,
    progress: {
      version: 2,
      unlockedLevelIndex: Math.min(n - 1, cleared),
      bestStars: fill((i) => 1 + ((i * 7) % 3)),
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
/** Cards already seen (so a shot is not covered by a due card), unless a case wants them. */
const SEEN_ALL = JSON.stringify({ title: ['ch1', 'ch2', 'ch3'], done: ['ch1', 'ch2', 'ch3'] });

const CASES = [
  { key: 'ch1', save: 'i06', q: '' },
  { key: 'ch2', save: 'i13', q: '' },
  { key: 'ch3', save: 'i21', q: '' },
  { key: 'ch3-locked', save: 'i06', q: '&chapter=3' },
  { key: 'ch4-soon', save: 'i13', q: '&chapter=4' },
  { key: 'card-title', save: 'i13', q: '&chapter=2&screen=chaptertitle', card: 'chapter2d-title' },
  { key: 'card-done', save: 'i13', q: '&chapter=1&screen=chapterdone', card: 'chapter2d-done' },
  // The natural flow: Chapter 1's finale just won, no card seen yet → "Chapter complete" first.
  { key: 'card-due', save: 'i10', q: '', seen: JSON.stringify({ title: ['ch1'], done: [] }), card: 'chapter2d-done' },
  // The store gate (paid locks, the store card) needs a mobile shell: qa/chapterstore.mjs.
].filter((c) => !ONLY || ONLY.includes(c.key));

const problems = [];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, isMobile: !!size.touch, hasTouch: !!size.touch });
    for (const c of CASES) {
      const tag = `${size.key} ${c.key}`;
      const page = await ctx.newPage();
      await page.addInitScript(
        ([sv, seen]) => {
          localStorage.clear();
          localStorage.setItem('skyhold_isles_progress2d_v1', sv);
          localStorage.setItem('skyhold2d_chapter_cards_v1', seen);
        },
        [save(c.save), c.seen ?? SEEN_ALL],
      );
      page.on('pageerror', (e) => problems.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/2d.html?lang=${LANG}&desktop=${size.desktop ? 1 : 0}${c.q}${EXTRA}`);
      await page.waitForSelector('[data-testid="worldmap2d"]', { timeout: 20000 });
      await page.waitForTimeout(2200);
      if (c.card) {
        const ok = await page.locator(`[data-testid="${c.card}"]`).count();
        if (!ok) problems.push(`${tag}: card ${c.card} not shown`);
        await page.waitForTimeout(500);
      }
      const info = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="map2d-chapters"]')?.getBoundingClientRect();
        const nodes = [...document.querySelectorAll('.pu-node')].map((e) => {
          const r = e.getBoundingClientRect();
          const name = e.querySelector('.pu-node-name')?.getBoundingClientRect();
          return { id: e.getAttribute('data-testid'), r: { x: r.x, y: r.y, w: r.width, h: r.height }, name: name ? { x: name.x, y: name.y, w: name.width, h: name.height } : null };
        });
        return { bar: bar && { x: bar.x, y: bar.y, w: bar.width, h: bar.height }, nodes, vh: innerHeight, vw: innerWidth, chapter: window.__map?.chapter(), gl: window.__sea?.stats().gl, paid: document.querySelectorAll('.pu-node.paid').length, label: document.querySelector('[data-testid="map2d-chapter-label"]')?.textContent };
      });
      const hit = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      for (const n of info.nodes) {
        if (hit(n.r, info.bar) || hit(n.name, info.bar)) problems.push(`${tag}: chapter bar covers ${n.id}`);
        if (n.r.y < 0 || (n.name && n.name.y + n.name.h > info.vh)) problems.push(`${tag}: ${n.id} off screen vertically`);
      }
      console.log(`${tag}: page ${info.chapter?.page} ${info.chapter?.id} "${info.label}" nodes ${info.nodes.length} paid ${info.paid} gl ${info.gl} bar ${Math.round(info.bar?.w ?? 0)}x${Math.round(info.bar?.h ?? 0)}`);
      await page.screenshot({ path: `${OUT}/${c.key}-${size.key}${SUFFIX}.png` });
      if (c.key === 'ch2') {
        // Keys / arrows turn the chapter pages.
        await page.keyboard.press(']');
        await page.waitForTimeout(300);
        const p1 = await page.evaluate(() => window.__map?.chapter().page);
        await page.click('[data-testid="map2d-chapter-prev"]');
        await page.waitForTimeout(300);
        const p2 = await page.evaluate(() => window.__map?.chapter().page);
        await page.click('[data-testid="map2d-chapter-tab-1"]');
        await page.waitForTimeout(300);
        const p3 = await page.evaluate(() => window.__map?.chapter().page);
        if (p1 !== 2 || p2 !== 1 || p3 !== 0) problems.push(`${tag}: page turns ${p1},${p2},${p3} (want 2,1,0)`);
      }
      await page.close();
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `PROBLEMS (${problems.length}):\n${problems.join('\n')}` : 'no problems');
