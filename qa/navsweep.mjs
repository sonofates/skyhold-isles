// Keyboard reachability sweep: on every board (and the map / title), walks the arrow-key focus graph
// breadth-first (focus a control, press each arrow, see where the focus lands) and lists controls no
// arrow path reaches from the scope's default. Also checks Esc closes the board.
// Usage: node qa/navsweep.mjs [--base=..] [--size=1920x1080] [--lang=en] [only-substring...]
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const [W, H] = (arg('size') ?? '1920x1080').split('x').map(Number);
const LANG = arg('lang') ?? 'en';
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const pad = (a, v) => [...a, ...Array(Math.max(0, 25 - a.length)).fill(v)];
const SEED = JSON.stringify({
  ids: IDS,
  progress: {
    version: 2,
    unlockedLevelIndex: 9,
    bestStars: pad([3, 3, 2, 3, 1, 2, 3, 2, 3], 0),
    clears: pad([2, 1, 1, 1, 1, 1, 1, 1, 1], 0),
    workshop: { treasury: 1 },
    daily: { lastDay: -1, streak: 2, bestStreak: 4, total: 5 },
    heroes: { selectedHero: 'bran', roster: { bran: { xp: 3200, skills: [] }, wren: { xp: 600, skills: [] }, mira: { xp: 0, skills: [] } } },
  },
});
// [name, query, closes with Esc]
const SCREENS = [
  ['map', '', false],
  ['title', '?title=1&titlemenu=1', false],
  ['credits', '?screen=credits', true],
  ['brief', '?screen=brief&island=1', true],
  ['brief-hard', '?screen=brief&island=3&diff=hard', true],
  ['workshop', '?screen=workshop', true],
  ['heroes', '?screen=heroes', true],
  ['herosel', '?screen=herosel', true],
  ['logbook', '?screen=logbook', true],
  ['logbook-feats', '?screen=logbook&tab=feats', true],
  ['daily', '?screen=daily', true],
  ['settings-general', '?screen=settings&settab=general', true],
  ['settings-audio', '?screen=settings&settab=audio', true],
  ['settings-graphics', '?screen=settings&settab=graphics', true],
  ['settings-controls', '?screen=settings&settab=controls', true],
  ['store', '?screen=store&iapmock=1', true],
  ['market', '?screen=market', true],
  // In a run: the story book before the battle, the Codex board from the HUD.
  ['story', '?level=i02&story=intro', false, { wait: '.pu-story', storyFresh: true }],
  ['codex', '?level=i02&hero=bran', true, { wait: '[data-testid="codex2d-open"]', click: '[data-testid="codex2d-open"]' }],
].filter(([n]) => only.length === 0 || only.some((o) => n.includes(o)));

const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const problems = [];

// Tags every focusable the way navFocus sees them (same selector + visibility rules) with data-qa-nav.
const tagCandidates = () =>
  new Function(`
    const FOCUSABLE = 'button, [role="slider"], [role="switch"], [tabindex]:not([tabindex="-1"])';
    const scrollParent = (e) => { for (let p = e.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY) && (p.scrollWidth > p.clientWidth + 1 || p.scrollHeight > p.clientHeight + 1)) return p; } return null; };
    const visible = (e) => { if (e.disabled) return false; if (e.closest('[hidden], [inert], [aria-hidden="true"]')) return false; const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) { if (!scrollParent(e)) return false; } const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none' && Number(cs.opacity) > 0.05; };
    const overlays = document.querySelectorAll('.pu-overlay:not(.closing)');
    const scope = overlays.length ? overlays[overlays.length - 1] : document.querySelector('.pu-title:not(.leaving)') || document.querySelector('.pu-map');
    if (!scope) return [];
    const list = Array.from(scope.querySelectorAll(FOCUSABLE)).filter((e) => e.dataset.navSkip === undefined && visible(e));
    return list.map((e, i) => { e.dataset.qaNav = String(i); return { id: i, label: (e.dataset.testid || e.getAttribute('aria-label') || e.textContent || e.className).trim().replace(/\\s+/g, ' ').slice(0, 40), side: e.getAttribute('role') === 'slider' || e.dataset.navKeep !== undefined, group: e.dataset.navKeep !== undefined ? list.indexOf(e.parentElement.querySelector('[data-nav-keep]')) : -1 }; });
  `)();

const focusedId = (page) => page.evaluate(() => document.activeElement?.dataset?.qaNav ?? null);

for (const [name, query, closes, opts = {}] of SCREENS) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript(([s, l, fresh, ids]) => {
    if (sessionStorage.getItem('qa-seeded')) return;
    sessionStorage.setItem('qa-seeded', '1');
    localStorage.clear();
    localStorage.setItem('skyhold_isles_language_v1', l);
    localStorage.setItem('skyhold_isles_progress2d_v1', s);
    localStorage.setItem('skyhold_isles_coach2d_v1', '1');
    localStorage.setItem('skyhold2d_coach_v1', 'done');
    if (!fresh) localStorage.setItem('skyhold_isles_story2d_seen_v1', JSON.stringify(ids.flatMap((id) => [`${id}:intro`, `${id}:outro`])));
  }, [SEED, LANG, !!opts.storyFresh, IDS]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  page.on('pageerror', (e) => problems.push(`${name}: page error ${e.message}`));
  const sep = query ? '&' : '?';
  await page.goto(`${BASE}/2d.html${query}${sep}lang=${LANG}&desktop=1`);
  await page.waitForSelector(opts.wait ?? (name === 'title' ? '[data-testid="title2d-menu"]' : '[data-testid="worldmap2d"]'), { timeout: 90000 });
  if (opts.click) {
    await page.waitForTimeout(1500);
    await page.click(opts.click);
    await page.waitForSelector('.pu-overlay', { timeout: 30000 });
  }
  if (name === 'map') await page.waitForSelector('[data-testid="worldmap2d"] .pu-node', { timeout: 90000 });
  await page.waitForTimeout(2200);
  const list = await page.evaluate(tagCandidates);
  // The first arrow lands on the scope's default.
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  const start = await focusedId(page);
  if (start === null) {
    problems.push(`${name}: the first arrow focused nothing (${list.length} controls)`);
    await ctx.close();
    continue;
  }
  const seen = new Set([start]);
  const queue = [start];
  let presses = 0;
  while (queue.length > 0 && presses < 600) {
    const id = queue.shift();
    const node = list[Number(id)];
    const dirs = node?.side ? ['ArrowUp', 'ArrowDown'] : ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    for (const key of dirs) {
      await page.evaluate((i) => document.querySelector(`[data-qa-nav="${i}"]`)?.focus({ preventScroll: true }), id);
      await page.keyboard.press(key);
      presses++;
      await page.waitForTimeout(60);
      const to = await focusedId(page);
      if (to !== null && !seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  // A ← → radio row (data-nav-keep, the briefing difficulty) is one stop: ← → pick inside it.
  const groupsSeen = new Set(list.filter((c) => c.group >= 0 && seen.has(String(c.id))).map((c) => c.group));
  const missed = list.filter((c) => !seen.has(String(c.id)) && !(c.group >= 0 && groupsSeen.has(c.group)));
  console.log(`${name}: ${list.length} controls, reached ${seen.size} (${presses} presses)${missed.length ? ` — MISSED ${missed.map((m) => `"${m.label}"`).join(', ')}` : ''}`);
  for (const m of missed) problems.push(`${name}: "${m.label}" not reachable with the arrows`);
  // Long boards: holding ↓ from the default must bring the end of the scroller into view.
  const scrollerState = () =>
    page.evaluate(() => {
      const overlays = document.querySelectorAll('.pu-overlay:not(.closing)');
      const scope = overlays.length ? overlays[overlays.length - 1] : null;
      if (!scope) return null;
      let best = null;
      for (const e of [scope, ...scope.querySelectorAll('*')]) {
        if (e.scrollHeight <= e.clientHeight + 1 || e.clientHeight < 40) continue;
        if (!/(auto|scroll)/.test(getComputedStyle(e).overflowY)) continue;
        if (!best || e.clientHeight > best.clientHeight) best = e;
      }
      return best ? { top: Math.round(best.scrollTop), max: best.scrollHeight - best.clientHeight } : null;
    });
  const sc0 = await scrollerState();
  if (sc0) {
    await page.evaluate((i) => document.querySelector(`[data-qa-nav="${i}"]`)?.focus({ preventScroll: true }), start);
    for (let k = 0; k < 45; k++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(70);
    }
    await page.waitForTimeout(600);
    const sc1 = await scrollerState();
    const ok = sc1 && sc1.top >= sc1.max - 2;
    console.log(`${name}: scroller ${sc0.max}px, after ↓ ×45 at ${sc1?.top} ${ok ? 'ok' : 'NOT AT THE END'}`);
    if (!ok) problems.push(`${name}: ↓ does not scroll the board to its end (${sc1?.top}/${sc1?.max})`);
  }
  if (closes) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    const open = await page.evaluate(() => document.querySelectorAll('.pu-overlay:not(.closing)').length);
    if (open > 0) problems.push(`${name}: Esc did not close the board`);
  }
  await ctx.close();
}
await browser.close();
console.log(`nav sweep: ${problems.length} problems`);
for (const p of problems) console.log(`  ${p}`);
process.exit(problems.length ? 1 : 0);
