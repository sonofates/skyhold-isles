// UI overflow / cramp audit: walks every painted screen (world map, briefing variants, Workshop,
// title screen menu (with / without a save) + Credits, Heroes + skill node detail, hero picker, Logbook islands + feats, Daily, Settings 4 tabs, store,
// story book, in-run HUD with the wave card / foe card / coach / tooltip / build ring / tower card /
// pause plate / new-foe toast, end boards won / lost / daily / endless / hard) at several sizes in
// EN and TR and runs qa/uiAuditLib.mjs (DOM) + __p0.textAudit() (canvas text) on each.
// Usage: node qa/uiaudit.mjs [only-substring] [--base=..] [--lang=en,tr] [--size=2000x991,844x390]
//        [--shots=docs/ui-polish-shots] [--shotsize=2000x991,844x390] [--report=docs/ui-polish-shots/report.txt] [--jobs=3]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { auditPage } from './uiAuditLib.mjs';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const LANGS = (arg('lang') ?? 'en,tr').split(',');
const SHOTS = arg('shots') ?? null;
const SHOT_SIZES = (arg('shotsize') ?? '2000x991,844x390').split(',');
const REPORT = arg('report') ?? null;
const JOBS = Number(arg('jobs') ?? 3);
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const ALL_SIZES = [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1 },
  { key: '2000x991', w: 2000, h: 991, dpr: 1 },
  { key: '1600x900', w: 1600, h: 900, dpr: 1 },
  { key: '1366x768', w: 1366, h: 768, dpr: 1 },
  { key: '932x430', w: 932, h: 430, dpr: 2, touch: true },
  { key: '844x390', w: 844, h: 390, dpr: 2, touch: true },
];
const SIZES = ALL_SIZES.filter((s) => !arg('size') || arg('size').split(',').includes(s.key));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const N = IDS.length;
const pad = (a, v) => [...a, ...Array(Math.max(0, N - a.length)).fill(v)];
const save = (stars, unlocked, extra = {}) =>
  JSON.stringify({
    ids: IDS,
    progress: {
      version: 2,
      unlockedLevelIndex: unlocked,
      bestStars: pad(stars, 0),
      bestEndlessWaves: pad([0, 23], 0),
      bestLives: pad(stars.map((s) => (s ? 12 + s * 2 : 0)), 0),
      clears: pad(stars.map((s) => (s > 0 ? 1 + s : 0)), 0),
      workshop: { treasury: 1 },
      challengeClears: Array.from({ length: N }, (_, i) => [['bowless'], [], [], ['quietGuns']][i] ?? []),
      daily: { lastDay: -1, streak: 2, bestStreak: 4, total: 5 },
      difficultyWins: { easy: pad([1], 0), normal: pad([3, 3, 2, 2, 0, 2, 3, 2, 3], 0), hard: pad([2, 0, 0, 3], 0) },
      heroes: { selectedHero: 'bran', roster: { bran: { xp: 3200, skills: [] }, wren: { xp: 600, skills: [] }, mira: { xp: 0, skills: [] } } },
      ...extra,
    },
  });
const SEED = save([3, 3, 2, 3, 1, 2, 3, 2, 3], 9);
const FRESH = save([], 0, { heroes: { selectedHero: 'bran', roster: { bran: { xp: 0, skills: [] } } } });
const STORY_SEEN = JSON.stringify(IDS.flatMap((id) => [`${id}:intro`, `${id}:outro`]));

// [name, query, seed, action, { pref, coach, storySeen }]
const SCREENS = [
  ['map', '', SEED, null],
  ['map-fresh', '', FRESH, null],
  ['title', '?title=1&titlemenu=1', SEED, 'title'],
  ['title-fresh', '?title=1&titlemenu=1', FRESH, 'title'],
  ['credits', '?screen=credits', SEED, null],
  ['brief', '?screen=brief&island=1', SEED, null],
  ['brief-modes', '?screen=brief&island=0&pick=bowless', SEED, null],
  ['brief-endless', '?screen=brief&island=1&pick=endless', SEED, null],
  ['brief-hard', '?screen=brief&island=3&diff=hard', SEED, null],
  ['brief-easy', '?screen=brief&island=2&diff=easy', SEED, null],
  ['brief-frontier', '?screen=brief&island=9', SEED, null],
  ['brief-locked', '?screen=brief&island=12', SEED, null],
  ['workshop', '?screen=workshop', SEED, null],
  ['heroes', '?screen=heroes', SEED, null],
  ['heroes-node', '?screen=heroes', SEED, 'treeNode'],
  ['herosel', '?screen=herosel', SEED, null],
  ['logbook', '?screen=logbook', SEED, null],
  ['logbook-feats', '?screen=logbook&tab=feats', SEED, null],
  ['daily', '?screen=daily', SEED, null],
  ['settings-general', '?screen=settings&settab=general', SEED, null],
  ['settings-audio', '?screen=settings&settab=audio', SEED, null],
  ['settings-graphics', '?screen=settings&settab=graphics', SEED, null],
  ['settings-controls', '?screen=settings&settab=controls', SEED, null],
  ['store', '?screen=store&iapmock=1', SEED, null],
  ['story', '?level=i02&story=intro', SEED, 'story', { storySeen: false }],
  ['hud', '?level=i02&hero=bran', SEED, 'hud'],
  ['hud-coach', '?level=l1c&hero=bran', FRESH, 'coach', { coach: true }],
  ['hud-hard', '?level=i14&hero=bran&diff=hard', SEED, 'hud'],
  ['hud-foe', '?level=i02&hero=bran', SEED, 'foe'],
  ['hud-ring', '?level=i02&hero=bran', SEED, 'ring'],
  ['hud-tower', '?level=i02&hero=bran', SEED, 'tower'],
  ['hud-tip', '?level=i02&hero=bran', SEED, 'tip'],
  ['hud-pause', '?level=i02&hero=bran', SEED, 'pause'],
  ['hud-codex', '?level=i09&hero=bran', SEED, 'codex'],
  ['hud-codex-spec', '?level=i09&hero=bran', SEED, 'codexSpec'],
  ['hud-spec-ring', '?level=i02&hero=bran', SEED, 'specRing'],
  ['hud-spec-card', '?level=i02&hero=bran', SEED, 'specCard'],
  ['hud-spec-tower', '?level=i02&hero=bran', SEED, 'specTower'],
  ['hud-spec-hint', '?level=i02&hero=bran&spechint=1', SEED, 'specHint'],
  ['hud-newfoe', '?level=i09&hero=bran', null, 'newfoe', { foesFresh: true }],
  ['end-won', '?level=i02&hero=bran', SEED, 'win'],
  ['end-lost', '?level=i02&hero=bran', SEED, 'lose'],
  ['end-hard', '?level=i02&hero=bran&diff=hard', SEED, 'win'],
  ['end-daily', '?daily=1', SEED, 'win'],
  ['end-endless', '?level=l1c&endless=1', SEED, 'endless'],
];

const problems = [];
const lines = [];

async function act(page, action, key, size) {
  const p0 = () => page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'), null, { timeout: 60000 });
  switch (action) {
    case 'treeNode': {
      const n = page.locator('[data-testid^="tree2d-node-"]').nth(1);
      await n.click({ timeout: 15000 }).catch(() => problems.push(`${key}: no skill node to click`));
      await page.waitForTimeout(300);
      break;
    }
    case 'title':
      await page.waitForFunction(() => window.__title?.state().phase === 'menu', null, { timeout: 30000 }).catch(() => problems.push(`${key}: title menu not shown`));
      await page.waitForTimeout(900);
      break;
    case 'story':
      await page.waitForSelector('.pu-story', { timeout: 30000 }).catch(() => problems.push(`${key}: no story book`));
      await page.waitForTimeout(1500);
      break;
    case 'hud':
    case 'coach':
      await p0();
      await page.waitForTimeout(action === 'coach' ? 2500 : 1500);
      break;
    case 'foe': {
      await p0();
      await page.evaluate(() => {
        window.__p0.replay.cmd({ k: 'wave' });
        window.__p0.replay.step(90);
      });
      await page.evaluate(() => window.__p0.freeze(true));
      const at = await page.evaluate(() => window.__p0.foeAt());
      if (!at) {
        problems.push(`${key}: no foe to tap`);
        break;
      }
      await page.evaluate(([x, y]) => window.__p0.hero.tap(x, y), [at.x, at.y]);
      await page.evaluate(() => window.__p0.freeze(false));
      await page.waitForFunction(() => window.__p0.foe().shown, null, { timeout: 6000 }).catch(() => problems.push(`${key}: foe card not shown`));
      await page.waitForTimeout(400);
      await page.evaluate(() => window.__p0.freeze(true));
      break;
    }
    case 'ring':
    case 'tower': {
      await p0();
      await page.evaluate((t) => {
        window.__p0.setGold(2000);
        if (t) window.__p0.replay.cmd({ k: 'build', plot: 2, type: 'archer' });
      }, action === 'tower');
      await page.waitForTimeout(400);
      const pl = await page.evaluate(() => window.__p0.plotScreen(2));
      if (size.touch) await page.touchscreen.tap(pl.x, pl.y - (action === 'tower' ? 30 : 0));
      else await page.mouse.click(pl.x, pl.y - (action === 'tower' ? 30 : 0));
      await page.waitForFunction(() => window.__p0.state().ring?.open, null, { timeout: 5000 }).catch(() => problems.push(`${key}: ring did not open`));
      await page.waitForTimeout(700);
      break;
    }
    case 'tip': {
      await p0();
      if (size.touch) break;
      const horn = await page.evaluate(() => window.__p0.state().horn);
      await page.mouse.move(horn.x, horn.y);
      await page.waitForFunction(() => !document.querySelector('[data-testid="hud2d-tip"]')?.hidden, null, { timeout: 5000 }).catch(() => problems.push(`${key}: no horn tooltip`));
      await page.waitForTimeout(300);
      break;
    }
    case 'codex':
      await p0();
      await page.waitForTimeout(500);
      await page.click('[data-testid="codex2d-open"]', { timeout: 15000 }).catch(() => problems.push(`${key}: no Codex button`));
      await page.waitForSelector('.pu-overlay', { timeout: 15000 }).catch(() => problems.push(`${key}: Codex board did not open`));
      await page.waitForTimeout(900);
      break;
    case 'codexSpec':
      await p0();
      await page.waitForTimeout(500);
      await page.click('[data-testid="codex2d-open"]', { timeout: 15000 }).catch(() => problems.push(`${key}: no Codex button`));
      await page.click('[data-testid="codex-tab-towers"]', { timeout: 15000 }).catch(() => problems.push(`${key}: no Towers tab`));
      await page.click('[data-testid="codex-tile-tesla"]', { timeout: 15000 }).catch(() => problems.push(`${key}: no tesla tile`));
      // Scroll the detail card so the branch cards start at its top edge (no line cut in half).
      await page
        .evaluate(() => {
          const d = document.querySelector('[data-testid="codex-detail"]');
          const s = document.querySelector('[data-testid="codex-specs"]');
          const cs = getComputedStyle(d);
          d.scrollTop += s.getBoundingClientRect().top - (d.getBoundingClientRect().top + d.clientTop + parseFloat(cs.paddingTop));
        })
        .catch(() => problems.push(`${key}: no specializations in the codex`));
      await page.waitForTimeout(900);
      break;
    case 'specRing':
    case 'specCard':
    case 'specTower':
    case 'specHint': {
      // An archer on plot 2 at tier III (specTower: Farwatch Lodge), then its ring / the card.
      await p0();
      await page.evaluate((spec) => {
        const p = window.__p0;
        p.setGold(5000);
        p.replay.cmd({ k: 'build', plot: 2, type: 'archer' });
        const id = p.spec().towers[0].id;
        p.replay.cmd({ k: 'upgrade', id });
        p.replay.cmd({ k: 'upgrade', id });
        if (spec) p.replay.cmd({ k: 'spec', id, spec: 'farwatch' });
      }, action === 'specTower');
      await page.waitForTimeout(700);
      if (action === 'specHint') {
        await page.waitForFunction(() => window.__p0.spec().hint?.shown, null, { timeout: 5000 }).catch(() => problems.push(`${key}: no tier-III tip`));
        await page.waitForTimeout(500);
        break;
      }
      const top = await page.evaluate(() => window.__p0.towerTop(window.__p0.spec().towers[0].id));
      const tap = async (x, y) => (size.touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
      await tap(top.x, top.y + 30);
      await page.waitForFunction(() => window.__p0.state().ring?.open, null, { timeout: 5000 }).catch(() => problems.push(`${key}: ring did not open`));
      await page.waitForTimeout(600);
      if (action === 'specTower') break;
      const tk = await page.evaluate(() => window.__p0.state().ring.tokens[0]);
      await tap(tk.x, tk.y);
      await page.waitForTimeout(400);
      if (action === 'specCard') {
        await tap(tk.x, tk.y);
        await page.waitForSelector('[data-testid="spec-card"]', { timeout: 8000 }).catch(() => problems.push(`${key}: comparison card did not open`));
        await page.waitForTimeout(900);
      }
      break;
    }
    case 'pause':
      await p0();
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      break;
    case 'newfoe':
      await p0();
      await page.waitForTimeout(800);
      await page.evaluate(() => window.__p0.replay.cmd({ k: 'wave' }));
      await page.waitForFunction(() => window.__p0.newFoe().shown, null, { timeout: 8000 }).catch(() => problems.push(`${key}: no new-foe toast`));
      await page.waitForTimeout(600);
      await page.evaluate(() => window.__p0.freeze(true));
      break;
    case 'win':
    case 'lose':
      await p0();
      await page.evaluate((o) => window.__p0.forceEnd(o), action === 'win' ? 'won' : 'lost');
      await page.waitForFunction(() => !!window.__p0.state().end, null, { timeout: 10000 }).catch(() => problems.push(`${key}: no end board`));
      await page.locator('[data-testid="story2d-skip"]').click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(2600);
      break;
    case 'endless':
      await p0();
      await page.evaluate(() => window.__p0.skipToWave(17));
      await page.waitForTimeout(400);
      await page.evaluate(() => window.__p0.forceEnd('lost'));
      await page.waitForTimeout(2600);
      break;
    default:
      await page.waitForTimeout(1100);
  }
}

async function runOne(browser, lang, size, [name, query, seed, action, opt = {}]) {
  const key = `${name}-${size.key}-${lang}`;
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch, locale: lang === 'tr' ? 'tr-TR' : 'en-US' });
  await ctx.addInitScript(
    ([s, seen, l, o]) => {
      try {
        if (sessionStorage.getItem('qa-seeded')) return;
        sessionStorage.setItem('qa-seeded', '1');
        localStorage.clear();
        localStorage.setItem('skyhold_isles_language_v1', l);
        localStorage.setItem('skyhold_isles_settings_v1', JSON.stringify({ language: l }));
        if (s) localStorage.setItem('skyhold_isles_progress2d_v1', s);
        if (o.storySeen !== false) localStorage.setItem('skyhold_isles_story2d_seen_v1', seen);
        if (!o.coach) {
          localStorage.setItem('skyhold_isles_coach2d_v1', '1');
          localStorage.setItem('skyhold2d_coach_v1', 'done');
        }
        if (!o.foesFresh) localStorage.setItem('skyhold2d_foes_seen_v1', JSON.stringify(['raider', 'runner', 'brute', 'kite', 'mite', 'healer', 'splitter', 'golem', 'hexer', 'warden', 'tempest', 'blinker', 'carrier', 'burrower', 'boss', 'draftwing', 'kilnback', 'reedpiper', 'bellrunner']));
      } catch {
        /* ignore */
      }
    },
    [seed, STORY_SEEN, lang, opt],
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${key}: page error ${e.message}`));
  const desktop = size.touch ? 0 : 1;
  const q = query ? `${query}&lang=${lang}&desktop=${desktop}` : `?lang=${lang}&desktop=${desktop}`;
  try {
    await page.goto(`${BASE}/2d.html${q}`);
    await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 60000 });
    await act(page, action, key, size);
    // Let one-shot animations (a board's pop-in, a card's fade) finish before measuring.
    await page.evaluate(() => Promise.race([
      Promise.all(document.getAnimations().filter((an) => an.effect?.getComputedTiming().iterations !== Infinity).map((an) => an.finished.catch(() => undefined))),
      new Promise((res) => setTimeout(res, 3000)),
    ]));
    const r = await page.evaluate(auditPage, {});
    const canvas = await page.evaluate(() => (window.__p0?.textAudit ? window.__p0.textAudit() : [])).catch(() => []);
    const list = [...r.problems];
    for (const c of canvas) list.push({ kind: c.kind ?? 'canvas', at: c.name, text: c.text, detail: c.detail });
    for (const p of list) problems.push(`${key}: [${p.kind}] ${p.at} "${p.text}" — ${p.detail}`);
    lines.push(`${key}: texts ${r.stats.texts}, canvas ${canvas.length ? canvas.length + ' issues' : 'ok'}, problems ${list.length}`);
    if (SHOTS && SHOT_SIZES.includes(size.key)) await page.screenshot({ path: `${SHOTS}/${lang}-${size.key}-${name}.jpg`, type: 'jpeg', quality: 72 });
  } catch (e) {
    problems.push(`${key}: run failed ${String(e).slice(0, 160)}`);
  }
  await ctx.close();
  console.log('done', key);
}

const jobs = [];
for (const lang of LANGS) for (const size of SIZES) for (const s of SCREENS) {
  const key = `${s[0]}-${size.key}-${lang}`;
  if (only.length && !only.some((o) => key.includes(o))) continue;
  jobs.push([lang, size, s]);
}
const browser = await chromium.launch({ args: ARGS });
let next = 0;
await Promise.all(
  Array.from({ length: Math.max(1, JOBS) }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      await runOne(browser, ...j);
    }
  }),
);
await browser.close();
const summary = {};
for (const p of problems) {
  const kind = /\[(\w+)\]/.exec(p)?.[1] ?? 'other';
  summary[kind] = (summary[kind] ?? 0) + 1;
}
const text = [
  `UI audit: ${jobs.length} screens (${LANGS.join('+')} x ${SIZES.map((s) => s.key).join(', ')})`,
  `problems ${problems.length} ${JSON.stringify(summary)}`,
  '',
  ...problems.sort(),
  '',
  ...lines.sort(),
].join('\n');
if (REPORT) {
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, text);
}
console.log(text.split('\n').slice(0, 400).join('\n'));
process.exit(problems.length ? 1 : 0);
