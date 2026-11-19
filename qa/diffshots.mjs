// Difficulty QA (Easy / Normal / Hard): screenshots of the briefing selector, the in-run HUD badge,
// the end board's difficulty tag + notes, the world map's Hard ribbons and the Logbook, at 1920x1080
// and phone landscape (844x390, touch), in English and Turkish. Also checks what it can measure:
// the selector's flow (pick Hard → Play URL carries &diff=hard, the choice is remembered, Easy turns
// challenges off, Endless dims the selector), the HUD badge inside the banner slot (hudCheck:
// outside = 0, no plot / cave / castle covered), the end board's stars / tag / note, overflowing or
// off-screen painted elements, and console errors.
// Usage: node qa/diffshots.mjs [only-substring] [--base=http://127.0.0.1:4173] [--out=docs/difficulty-shots] [--lang=en|tr|both]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4173';
const OUT = arg('out') ?? 'docs/difficulty-shots';
const LANGS = (arg('lang') ?? 'both') === 'both' ? ['en', 'tr'] : [arg('lang')];
const only = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const SIZES = [
  { key: '1920', w: 1920, h: 1080, dpr: 1, touch: false },
  { key: 'phone', w: 844, h: 390, dpr: 2, touch: true },
];

const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const N = IDS.length;
const pad = (a, v) => [...a, ...Array(Math.max(0, N - a.length)).fill(v)];
/** A 2D save; `dw` = per-difficulty best stars ({ easy, normal, hard } arrays), omitted = legacy save. */
const save = (stars, unlocked, dw, badges = []) =>
  JSON.stringify({
    ids: IDS,
    progress: {
      version: 2,
      unlockedLevelIndex: unlocked,
      bestStars: pad(stars, 0),
      bestEndlessWaves: pad([], 0),
      bestLives: pad(stars.map((s) => (s ? 12 + s * 2 : 0)), 0),
      clears: pad(stars.map((s) => (s > 0 ? 1 + s : 0)), 0),
      workshop: { treasury: 1 },
      challengeClears: Array.from({ length: N }, (_, i) => badges[i] ?? []),
      daily: { lastDay: -1, streak: 0, bestStreak: 0, total: 0 },
      ...(dw ? { difficultyWins: { easy: pad(dw.easy, 0), normal: pad(dw.normal, 0), hard: pad(dw.hard, 0) } } : {}),
    },
  });
// Nine isles won: three on Hard (ribbons), one only on Easy (1 star, no lives record), the rest Normal.
const SEED = save([3, 3, 2, 3, 1, 2, 3, 2, 3], 9, {
  easy: [1, 0, 0, 0, 1, 0, 0, 0, 0],
  normal: [3, 3, 2, 2, 0, 2, 3, 2, 3],
  hard: [2, 0, 0, 3, 0, 0, 2, 0, 0],
}, [['bowless'], [], [], ['quietGuns']]);
const LEGACY = save([3, 2], 2, null);
const STORY_SEEN = JSON.stringify(IDS.flatMap((id) => [`${id}:intro`, `${id}:outro`]));

// [name, query, seed, wait ms, action, pref (remembered difficulty)]
const SHOTS = [
  ['brief-normal', '?screen=brief&island=1', SEED, 900, null, null],
  ['brief-hard', '?screen=brief&island=3', SEED, 900, null, 'hard'],
  ['brief-easy', '?screen=brief&island=4', SEED, 900, null, 'easy'],
  ['brief-first', '?screen=brief&island=9', SEED, 900, 'pickHard', null],
  ['brief-endless', '?screen=brief&island=0&pick=endless', SEED, 900, null, 'hard'],
  ['map-ribbons', '', SEED, 1100, 'mapStart', null],
  ['logbook', '?screen=logbook', SEED, 900, null, null],
  ['hud-hard', '?level=i02&diff=hard', SEED, 3500, 'hud', null],
  ['hud-easy', '?level=i02&diff=easy', SEED, 3500, 'hud', null],
  ['end-hard-won', '?level=i02&diff=hard', SEED, 2500, 'win', null],
  ['end-easy-won', '?level=i02&diff=easy', SEED, 2500, 'win', null],
  ['end-hard-lost', '?level=i02&diff=hard', SEED, 2500, 'lose', null],
];

const problems = [];
const notes = [];

async function domCheck(page, name) {
  const bad = await page.evaluate(() => {
    const out = [];
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (const e of document.querySelectorAll('.pu-diff-opt, .pu-diff-desc, .pu-plank, .pu-diff-badge, .pu-sheet')) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || getComputedStyle(e).display === 'none') continue;
      const scroller = e.closest('.pu-sheet-body');
      if (scroller && scroller !== e) {
        const sr = scroller.getBoundingClientRect();
        if (r.bottom < sr.top || r.top > sr.bottom) continue;
      }
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(`outside viewport: ${e.className} ${r.left.toFixed(0)},${r.top.toFixed(0)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
    }
    for (const e of document.querySelectorAll('.pu-diff-opt, .pu-plank, .pu-diff-badge')) {
      if (e.getBoundingClientRect().width === 0) continue;
      if (e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0) out.push(`overflowing text: "${e.textContent?.trim().slice(0, 40)}"`);
    }
    const desc = document.querySelector('.pu-diff-desc');
    if (desc && desc.getBoundingClientRect().height > parseFloat(getComputedStyle(desc).fontSize) * 2.6) out.push(`description wraps to 3+ lines: "${desc.textContent}"`);
    // The briefing must fit without scrolling its body (Play visible).
    const play = document.querySelector('[data-testid="brief2d-play"]');
    if (play) {
      const r = play.getBoundingClientRect();
      if (r.bottom > H + 1) out.push(`Play below the screen (${r.bottom.toFixed(0)} > ${H})`);
    }
    return out;
  });
  for (const b of bad) problems.push(`${name}: ${b}`);
}

const browser = await chromium.launch({ args: ARGS });
for (const lang of LANGS) {
  for (const size of SIZES) {
    for (const [name, query, seed, wait, action, pref] of SHOTS) {
      const key = `${name}-${size.key}-${lang}`;
      if (only && !key.includes(only)) continue;
      const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: size.touch, hasTouch: size.touch, locale: lang === 'tr' ? 'tr-TR' : 'en-US' });
      await ctx.addInitScript(
        ([s, seen, l, p]) => {
          try {
            if (sessionStorage.getItem('qa-seeded')) return;
            sessionStorage.setItem('qa-seeded', '1');
            localStorage.clear();
            localStorage.setItem('skyhold_isles_language_v1', l);
            localStorage.setItem('skyhold_isles_settings_v1', JSON.stringify({ language: l }));
            if (s) localStorage.setItem('skyhold_isles_progress2d_v1', s);
            localStorage.setItem('skyhold_isles_story2d_seen_v1', seen);
            localStorage.setItem('skyhold_isles_coach2d_v1', '1');
            if (p) localStorage.setItem('skyhold_isles_difficulty2d_v1', p);
          } catch {
            /* ignore */
          }
        },
        [seed, STORY_SEEN, lang, pref],
      );
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`${key}: page error ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/404|Failed to load resource|navigator.vibrate/.test(m.text())) problems.push(`${key}: console ${m.text()}`);
      });
      await page.goto(`${BASE}/2d.html${query}`);
      const inGame = /level=/.test(query);
      if (inGame) await page.waitForFunction(() => window.__p0, null, { timeout: 20000 }).catch(() => problems.push(`${key}: game did not start`));
      await page.waitForTimeout(wait);
      if (action === 'mapStart') {
        // The Hard-won isles are at the start of the route: scroll the sea back to them.
        await page.evaluate(() => {
          const sc = document.querySelector('.pu-map-scroll');
          if (sc) sc.scrollLeft = 0;
        });
        await page.waitForTimeout(500);
        const n = await page.evaluate(() => document.querySelectorAll('.pu-node .pu-hard-ribbon').length);
        notes.push(`${key}: ${n} Hard ribbons on the map`);
        if (n !== 3) problems.push(`${key}: ${n} Hard ribbons (want 3)`);
      } else if (action === 'pickHard') {
        await page.click('[data-testid="brief2d-diff-hard"]');
        await page.waitForTimeout(300);
      } else if (action === 'hud') {
        const r = await page.evaluate(() => ({ badge: window.__p0.diffBadge(), hud: window.__p0.hudCheck() }));
        if (!r.badge?.shown) problems.push(`${key}: HUD badge not shown`);
        const out = r.hud.outside.diffBadge;
        if (out === undefined) problems.push(`${key}: hudCheck does not see the badge`);
        else if (out > 1) problems.push(`${key}: badge sticks ${out}px out of the banner slot`);
        for (const o of r.hud.overlaps) problems.push(`${key}: HUD piece ${o.piece} covers ${o.kind} ${o.index}`);
        notes.push(`${key}: badge "${r.badge?.text}" ${Math.round(r.badge?.w)}x${Math.round(r.badge?.h)} at ${Math.round(r.badge?.x)},${Math.round(r.badge?.y)}; banner ${JSON.stringify(r.hud.pieces.banner)}; overlaps ${r.hud.overlaps.length}`);
      } else if (action === 'win' || action === 'lose') {
        await page.evaluate((o) => window.__p0.forceEnd(o), action === 'win' ? 'won' : 'lost');
        await page.waitForTimeout(2400);
        const r = await page.evaluate(() => ({ tag: window.__p0.endDiff(), end: window.__p0.state().end, badge: window.__p0.diffBadge() }));
        if (!r.tag) problems.push(`${key}: end board has no difficulty tag`);
        if (r.badge?.shown) problems.push(`${key}: HUD badge still shown over the end board`);
        notes.push(`${key}: tag "${r.tag?.text}" stars ${r.end?.stars} note ${JSON.stringify(r.end?.note ?? null)}`);
        if (name === 'end-easy-won' && r.end?.stars !== 1) problems.push(`${key}: Easy win shows ${r.end?.stars} stars`);
      }
      await domCheck(page, key);
      await page.screenshot({ path: `${OUT}/${key}.jpg`, type: 'jpeg', quality: 84 });
      console.log('shot', key);
      await ctx.close();
    }
  }
}

// --- flow checks (desktop, English) -------------------------------------------------------------------
if (!only || 'flow'.includes(only)) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(
    ([s]) => {
      if (sessionStorage.getItem('qa-seeded')) return;
      sessionStorage.setItem('qa-seeded', '1');
      localStorage.clear();
      localStorage.setItem('skyhold_isles_language_v1', 'en');
      localStorage.setItem('skyhold_isles_progress2d_v1', s);
    },
    [SEED],
  );
  const page = await ctx.newPage();
  const checked = () => page.evaluate(() => [...document.querySelectorAll('.pu-diff-opt')].filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.dataset.testid));
  await page.goto(`${BASE}/2d.html?screen=brief&island=0`);
  await page.waitForTimeout(800);
  const first = await checked();
  if (first.join() !== 'brief2d-diff-normal') problems.push(`flow: default selection is ${first} (want Normal)`);
  // Easy turns a picked challenge off; picking a challenge moves Easy back to Normal.
  await page.click('[data-testid="brief2d-ch-bowless"]');
  await page.click('[data-testid="brief2d-diff-easy"]');
  const chOn = await page.getAttribute('[data-testid="brief2d-ch-bowless"]', 'aria-checked');
  if (chOn !== 'false') problems.push('flow: Easy did not clear the challenge');
  await page.click('[data-testid="brief2d-ch-bowless"]');
  if ((await checked()).join() !== 'brief2d-diff-normal') problems.push('flow: a challenge on Easy did not move the choice to Normal');
  // Endless dims the selector and shows Normal.
  await page.click('[data-testid="brief2d-endless"]');
  const muted = await page.evaluate(() => document.querySelector('[data-testid="brief2d-diff"]').classList.contains('muted'));
  if (!muted || (await checked()).join() !== 'brief2d-diff-normal') problems.push('flow: Endless did not dim the selector on Normal');
  // Keyboard: arrows move along the radio group.
  await page.click('[data-testid="brief2d-diff-normal"]');
  await page.keyboard.press('ArrowRight');
  if ((await checked()).join() !== 'brief2d-diff-hard') problems.push('flow: ArrowRight did not pick Hard');
  const desc = await page.textContent('[data-testid="brief2d-diff-desc"]');
  notes.push(`flow: Hard description "${desc}"`);
  // A challenge on Hard is allowed: play it, the URL carries both and the choice is remembered.
  await page.click('[data-testid="brief2d-ch-bowless"]');
  await page.click('[data-testid="brief2d-play"]');
  await page.waitForURL(/level=/, { timeout: 10000 }).catch(() => problems.push('flow: Play did not start a run'));
  const url = page.url();
  notes.push(`flow: Play → ${url.replace(BASE, '')}`);
  if (!/[?&]diff=hard\b/.test(url) || !/[?&]challenge=bowless\b/.test(url)) problems.push(`flow: run URL lacks diff=hard + challenge (${url})`);
  const prefStored = await page.evaluate(() => localStorage.getItem('skyhold_isles_difficulty2d_v1'));
  if (prefStored !== 'hard') problems.push(`flow: remembered choice is ${prefStored}`);
  await page.waitForFunction(() => window.__p0, null, { timeout: 20000 });
  const lives = await page.evaluate(() => window.__p0.state());
  notes.push(`flow: Hard run state lives=${lives.lives ?? '?'} gold=${lives.gold ?? '?'}`);
  await page.goto(`${BASE}/2d.html?screen=brief&island=1`);
  await page.waitForTimeout(800);
  if ((await checked()).join() !== 'brief2d-diff-hard') problems.push('flow: the next briefing did not start on the remembered Hard');
  await ctx.close();

  // A legacy save (no difficulty record): its wins show as Normal results, no ribbons.
  const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx2.addInitScript(
    ([s]) => {
      if (sessionStorage.getItem('qa-seeded')) return;
      sessionStorage.setItem('qa-seeded', '1');
      localStorage.clear();
      localStorage.setItem('skyhold_isles_progress2d_v1', s);
    },
    [LEGACY],
  );
  const p2 = await ctx2.newPage();
  await p2.goto(`${BASE}/2d.html?screen=brief&island=0`);
  await p2.waitForTimeout(800);
  const legacy = await p2.evaluate(() => ({
    normalBest: !!document.querySelector('[data-testid="brief2d-diff-normal"] .pu-diff-stars'),
    hardBest: !!document.querySelector('[data-testid="brief2d-diff-hard"] .pu-diff-best'),
    ribbons: document.querySelectorAll('.pu-hard-ribbon').length,
  }));
  if (!legacy.normalBest || legacy.hardBest || legacy.ribbons) problems.push(`flow: legacy save shows ${JSON.stringify(legacy)}`);
  notes.push(`flow: legacy save ${JSON.stringify(legacy)}`);
  await ctx2.close();
}

await browser.close();
for (const n of notes) console.log('note', n);
console.log(problems.length ? `problems ${problems.length}:\n${problems.join('\n')}` : 'problems 0');
process.exit(problems.length ? 1 : 0);
