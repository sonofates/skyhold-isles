// Whole-game UI pass sweep: every screen / moment on desktop (2000x991, 1440x900) and phone
// (932x430, 844x390, 667x375 touch, dpr 3, iPhone UA) in EN and TR. Saves a JPG per run, collects
// console errors / warnings, page errors, failed requests and the layout problems of uiAuditLib.
//
// Usage: node qa/wholePass.mjs [filter...] [--base=http://127.0.0.1:4381] [--out=qa-out/wp/before]
//   [--lang=en,tr] [--size=d2000,d1440,p932,p844,p667] [--jobs=4]
// Writes <out>/report.json and <out>/report.txt; shots <out>/<lang>-<size>-<screen>.jpg
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { auditPage } from './uiAuditLib.mjs';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'qa-out/wp/before';
const LANGS = (arg('lang') ?? 'en,tr').split(',');
const JOBS = Number(arg('jobs') ?? 4);
// --notch: emulate an iPhone landscape safe area (59 px sides, 21 px bottom) on phone sizes — the
// app's --safe-* vars and its env() inset probes (uiKit.ts readSafeInsets, platform/safeArea.ts).
const NOTCH = process.argv.includes('--notch');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ALL_SIZES = [
  { key: 'd2000', w: 2000, h: 991, dpr: 1, touch: false },
  { key: 'd1440', w: 1440, h: 900, dpr: 1, touch: false },
  { key: 'p932', w: 932, h: 430, dpr: 3, touch: true },
  { key: 'p844', w: 844, h: 390, dpr: 3, touch: true },
  { key: 'p667', w: 667, h: 375, dpr: 3, touch: true },
];
const SIZES = ALL_SIZES.filter((s) => !arg('size') || arg('size').split(',').includes(s.key));

const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const N = IDS.length;
const pad = (a, v) => [...a, ...Array(Math.max(0, N - a.length)).fill(v)];
const makeSave = (stars, unlocked, extra = {}) =>
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
      heroes: {
        selectedHero: 'bran',
        roster: { bran: { xp: 3200, skills: [] }, wren: { xp: 600, skills: [] }, mira: { xp: 0, skills: [] } },
      },
      market: {
        crystals: 120,
        inventory: { emberPot: 3, frostLantern: 2, skyPurse: 2, heartstone: 1, cloudguard: 1, galeBell: 1 },
        loadout: ['emberPot', 'frostLantern', 'skyPurse'],
      },
      ...extra,
    },
  });
const SEED = makeSave([3, 3, 2, 3, 1, 2, 3, 2, 3], 9);
const LATE = makeSave(Array(24).fill(3), 24);
const FRESH = makeSave([], 0, {
  challengeClears: Array.from({ length: N }, () => []),
  difficultyWins: { easy: pad([], 0), normal: pad([], 0), hard: pad([], 0) },
  heroes: { selectedHero: 'bran', roster: { bran: { xp: 0, skills: [] } } },
  market: { crystals: 28, inventory: {}, loadout: [] },
});
const STORY_SEEN = JSON.stringify(IDS.flatMap((id) => [`${id}:intro`, `${id}:outro`]));

// [name, query, seed, action, opts]
const SCREENS = [
  ['title', '?title=1&titlemenu=1', SEED, 'title'],
  ['map', '', SEED, null],
  ['map-fresh', '', FRESH, null],
  ['map-late', '', LATE, 'mapEnd'],
  ['brief', '?screen=brief&island=1', SEED, null],
  ['brief-fresh', '?screen=brief&island=0', FRESH, null],
  ['brief-hard', '?screen=brief&island=1&diff=hard', SEED, null],
  ['brief-modes', '?screen=brief&island=0&pick=bowless', SEED, null],
  ['brief-endless', '?screen=brief&island=1&pick=endless', SEED, null],
  ['brief-locked', '?screen=brief&island=12', SEED, null],
  ['beltpick', '?screen=brief&island=1', SEED, 'beltpick'],
  ['workshop', '?screen=workshop', SEED, null],
  ['herosel', '?screen=herosel', SEED, null],
  ['heroes', '?screen=heroes', SEED, null],
  ['heroes-node', '?screen=heroes', SEED, 'treeNode'],
  ['logbook', '?screen=logbook', SEED, null],
  ['logbook-feats', '?screen=logbook&tab=feats', SEED, null],
  ['daily', '?screen=daily', SEED, null],
  ['market', '?screen=market', SEED, null],
  ['market-fresh', '?screen=market', FRESH, null],
  ['settings-general', '?screen=settings&settab=general', SEED, null],
  ['settings-audio', '?screen=settings&settab=audio', SEED, null],
  ['settings-graphics', '?screen=settings&settab=graphics', SEED, null],
  ['settings-controls', '?screen=settings&settab=controls', SEED, null],
  ['credits', '?screen=credits', SEED, null],
  ['story', '?level=i02&story=intro', SEED, 'story', { storySeen: false }],
  ['story-3beat', '?level=l1c&story=intro', SEED, 'story', { storySeen: false }],
  ['hud', '?level=i02&hero=bran', SEED, 'hud'],
  ['hud-wave', '?level=i02&hero=bran', SEED, 'wave'],
  ['hud-belt', '?level=i02&hero=bran', SEED, 'belt'],
  ['hud-belt-reserve', '?level=i02&hero=bran', SEED, 'beltReserve'],
  ['hud-hard', '?level=i02&hero=bran&diff=hard', SEED, 'wave'],
  ['hud-endless', '?level=i02&hero=bran&endless=1', SEED, 'wave'],
  ['hud-challenge', '?level=l1c&hero=bran&challenge=bowless', SEED, 'belt'],
  ['hud-ring', '?level=i02&hero=bran', SEED, 'ring'],
  ['hud-tower', '?level=i02&hero=bran', SEED, 'tower'],
  ['hud-spec-card', '?level=i02&hero=bran', SEED, 'specCard'],
  ['hud-spec-hint', '?level=i02&hero=bran&spechint=1', SEED, 'specHint'],
  ['hud-foe', '?level=i02&hero=bran', SEED, 'foe'],
  ['hud-coach', '?level=l1c&hero=bran', FRESH, 'coach', { coach: true }],
  ['hud-newfoe', '?level=i09&hero=bran', SEED, 'newfoe', { foesFresh: true }],
  ['hud-codex', '?level=i09&hero=bran', SEED, 'codex'],
  ['hud-codex-spec', '?level=i09&hero=bran', SEED, 'codexSpec'],
  ['hud-pause', '?level=i02&hero=bran', SEED, 'pause'],
  ['hud-confirm', '?level=i02&hero=bran', SEED, 'confirm'],
  ['hud-settings', '?level=i02&hero=bran&settings=1', SEED, 'hud'],
  ['hud-lowlives', '?level=i02&hero=bran', SEED, 'lowLives'],
  ['end-won', '?level=i02&hero=bran', SEED, 'win'],
  ['end-lost', '?level=i02&hero=bran', SEED, 'lose'],
  ['end-endless', '?level=i02&hero=bran&endless=1', SEED, 'lose'],
];

async function act(page, action, size) {
  const p0 = () => page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'), null, { timeout: 60000 });
  const tap = async (x, y) => (size.touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  switch (action) {
    case 'mapEnd':
      await page.keyboard.press('End').catch(() => undefined);
      for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight').catch(() => undefined);
      await page.waitForTimeout(1500);
      break;
    case 'treeNode':
      await page.locator('[data-testid^="tree2d-node-"]').nth(1).click({ timeout: 15000 }).catch(() => undefined);
      await page.waitForTimeout(350);
      break;
    case 'beltpick':
      await page.locator('[data-testid="brief2d-belt-slot-0"]').first().click({ timeout: 15000 }).catch(() => undefined);
      await page.waitForSelector('.pu-beltpick', { timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      break;
    case 'title':
      await page.waitForFunction(() => window.__title?.state().phase === 'menu', null, { timeout: 30000 }).catch(() => undefined);
      await page.waitForTimeout(900);
      break;
    case 'story':
      await page.waitForSelector('.pu-story', { timeout: 30000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      break;
    case 'hud':
    case 'coach':
      await p0();
      await page.waitForTimeout(action === 'coach' ? 2200 : 1200);
      break;
    case 'wave':
      await p0();
      await page.evaluate(() => {
        window.__p0.replay.cmd({ k: 'wave' });
        window.__p0.replay.step(120);
      });
      await page.waitForTimeout(900);
      break;
    case 'lowLives':
      await p0();
      await page.evaluate(() => {
        window.__p0.replay.cmd({ k: 'wave' });
        window.__p0.replay.step(40);
        window.__p0.setLives(3);
      });
      await page.waitForTimeout(1200);
      break;
    case 'belt':
    case 'beltReserve': {
      await p0();
      await page.evaluate((reserve) => {
        const p = window.__p0;
        p.replay.cmd({ k: 'wave' });
        p.replay.step(60);
        if (reserve) {
          p.itemPress('skyPurse');
          p.replay.step(5);
          p.setLives(Math.max(1, p.state().lives - 2));
        }
      }, action === 'beltReserve');
      await page.waitForTimeout(500);
      const pouch = page.locator('[data-testid="item2d-pouch"]');
      if (await pouch.isVisible().catch(() => false)) {
        const b = await pouch.boundingBox();
        if (b) await tap(b.x + b.width / 2, b.y + b.height / 2);
        await page.waitForTimeout(400);
      }
      const target = action === 'beltReserve' ? 'emberPot' : 'frostLantern';
      const slot = page.locator(`[data-testid="item2d-${target}"]`);
      if (size.touch) {
        // a tap on a locked slot shows its tooltip (nope)
        const b = await slot.boundingBox().catch(() => null);
        if (b && action === 'beltReserve') await tap(b.x + b.width / 2, b.y + b.height / 2);
        else await slot.focus().catch(() => undefined);
      } else await slot.hover().catch(() => undefined);
      await page.waitForTimeout(500);
      await page.evaluate(() => window.__p0.freeze(true));
      break;
    }
    case 'foe': {
      await p0();
      await page.evaluate(() => {
        window.__p0.replay.cmd({ k: 'wave' });
        window.__p0.replay.step(90);
      });
      await page.evaluate(() => window.__p0.freeze(true));
      const at = await page.evaluate(() => window.__p0.foeAt());
      if (at) {
        await page.evaluate(([x, y]) => window.__p0.hero.tap(x, y), [at.x, at.y]);
        await page.evaluate(() => window.__p0.freeze(false));
        await page.waitForFunction(() => window.__p0.foe().shown, null, { timeout: 6000 }).catch(() => undefined);
        await page.waitForTimeout(350);
        await page.evaluate(() => window.__p0.freeze(true));
      }
      break;
    }
    case 'ring':
    case 'tower': {
      await p0();
      await page.evaluate((t) => {
        window.__p0.setGold(2000);
        if (t) window.__p0.replay.cmd({ k: 'build', plot: 2, type: 'archer' });
      }, action === 'tower');
      await page.waitForTimeout(350);
      const pl = await page.evaluate(() => window.__p0.plotScreen(2));
      await tap(pl.x, pl.y - (action === 'tower' ? 30 : 0));
      await page.waitForFunction(() => window.__p0.state().ring?.open, null, { timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(600);
      break;
    }
    case 'specCard':
    case 'specHint': {
      await p0();
      await page.evaluate(() => {
        const p = window.__p0;
        p.setGold(5000);
        p.replay.cmd({ k: 'build', plot: 2, type: 'archer' });
        const id = p.spec().towers[0].id;
        p.replay.cmd({ k: 'upgrade', id });
        p.replay.cmd({ k: 'upgrade', id });
      });
      await page.waitForTimeout(600);
      if (action === 'specHint') {
        await page.waitForFunction(() => window.__p0.spec().hint?.shown, null, { timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(450);
        break;
      }
      const pl = await page.evaluate(() => window.__p0.plotScreen(2));
      await tap(pl.x, pl.y - 12);
      const opened = await page.waitForFunction(() => window.__p0.state().ring?.open, null, { timeout: 3000 }).then(() => true).catch(() => false);
      if (!opened) {
        const top = await page.evaluate(() => window.__p0.towerTop(window.__p0.spec().towers[0].id));
        await tap(top.x, top.y + 20);
        await page.waitForFunction(() => window.__p0.state().ring?.open, null, { timeout: 5000 }).catch(() => undefined);
      }
      await page.waitForTimeout(500);
      const tk = await page.evaluate(() => window.__p0.state().ring.tokens?.[0]);
      if (tk) {
        await tap(tk.x, tk.y);
        await page.waitForTimeout(400);
        const cmp = await page.evaluate(() => window.__p0.state().ring.compare);
        if (cmp) await tap(cmp.x, cmp.y);
      }
      await page.waitForSelector('[data-testid="spec-card"]', { timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(700);
      break;
    }
    case 'codex':
    case 'codexSpec':
      await p0();
      await page.waitForTimeout(450);
      await page.click('[data-testid="codex2d-open"]', { timeout: 15000 }).catch(() => undefined);
      await page.waitForSelector('.pu-overlay', { timeout: 15000 }).catch(() => undefined);
      if (action === 'codexSpec') {
        await page.click('[data-testid="codex-tab-towers"]', { timeout: 15000 }).catch(() => undefined);
        await page.click('[data-testid="codex-tile-tesla"]', { timeout: 15000 }).catch(() => undefined);
      }
      await page.waitForTimeout(700);
      break;
    case 'pause':
    case 'confirm':
      await p0();
      await page.waitForTimeout(450);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(450);
      if (action === 'confirm') {
        await page.click('[data-testid="pause2d-restart"]', { timeout: 10000 }).catch(() => undefined);
        await page.waitForSelector('.pu-confirm', { timeout: 10000 }).catch(() => undefined);
        await page.waitForTimeout(500);
      }
      break;
    case 'newfoe':
      await p0();
      await page.waitForTimeout(600);
      await page.evaluate(() => window.__p0.replay.cmd({ k: 'wave' }));
      await page.waitForFunction(() => window.__p0.newFoe().shown, null, { timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      await page.evaluate(() => window.__p0.freeze(true));
      break;
    case 'win':
    case 'lose':
      await p0();
      await page.evaluate((o) => window.__p0.forceEnd(o), action === 'win' ? 'won' : 'lost');
      await page.waitForFunction(() => !!window.__p0.state().end, null, { timeout: 10000 }).catch(() => undefined);
      await page.locator('[data-testid="story2d-skip"]').click({ timeout: 2500 }).catch(() => undefined);
      await page.waitForTimeout(2400);
      break;
    default:
      await page.waitForTimeout(1200);
  }
}

async function seedContext(ctx, seed, lang, opt = {}) {
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
        if (!o.foesFresh) {
          localStorage.setItem(
            'skyhold2d_foes_seen_v1',
            JSON.stringify(['raider', 'runner', 'brute', 'kite', 'mite', 'healer', 'splitter', 'golem', 'hexer', 'warden', 'tempest', 'blinker', 'carrier', 'burrower', 'boss', 'draftwing', 'kilnback', 'reedpiper', 'bellrunner']),
          );
        }
      } catch {
        // ignore
      }
    },
    [seed, STORY_SEEN, lang, opt],
  );
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
mkdirSync(OUT, { recursive: true });
const jobs = [];
for (const lang of LANGS)
  for (const size of SIZES)
    for (const s of SCREENS) {
      const key = `${lang}-${size.key}-${s[0]}`;
      if (only.length && !only.some((o) => key.includes(o))) continue;
      jobs.push([lang, size, s, key]);
    }

const results = [];
async function runOne(lang, size, [name, query, seed, action, opt = {}], key) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: size.dpr,
    isMobile: size.touch,
    hasTouch: size.touch,
    ...(size.touch ? { userAgent: IPHONE_UA } : {}),
    locale: lang === 'tr' ? 'tr-TR' : 'en-US',
  });
  await seedContext(ctx, seed, lang, opt);
  if (NOTCH && size.touch) {
    await ctx.addInitScript(() => {
      const st = document.createElement('style');
      st.textContent =
        ':root, .pu { --safe-t: 0px !important; --safe-r: 59px !important; --safe-b: 21px !important; --safe-l: 59px !important; }' +
        ' div[style*="safe-area-inset"] { padding: 0px 59px 21px 59px !important; }';
      const add = () => {
        if (!document.documentElement) return false;
        document.documentElement.appendChild(st);
        return true;
      };
      if (!add()) {
        const mo = new MutationObserver(() => {
          if (add()) mo.disconnect();
        });
        mo.observe(document, { childList: true, subtree: true });
      }
    });
  }
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 300)}`));
  page.on('requestfailed', (r) => logs.push(`requestfailed: ${r.url().replace(BASE, '')} ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => {
    if (r.status() >= 400) logs.push(`http ${r.status()}: ${r.url().replace(BASE, '')}`);
  });
  const sep = query ? '&' : '?';
  const q = `${query}${sep}lang=${lang}&desktop=${size.touch ? 0 : 1}`;
  let problems = [];
  let err = null;
  try {
    await page.goto(`${BASE}/2d.html${q}`);
    await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 60000 });
    await act(page, action, size);
    const base = await page.evaluate(auditPage, {});
    problems = base.problems ?? [];
    const canvas = await page.evaluate(() => (window.__p0?.textAudit ? window.__p0.textAudit() : [])).catch(() => []);
    for (const c of canvas) problems.push({ kind: `canvas:${c.kind ?? 'text'}`, at: c.name, text: c.text ?? '', detail: c.detail ?? '' });
    await page.screenshot({ path: `${OUT}/${key}.jpg`, type: 'jpeg', quality: 72, scale: 'css', timeout: 60000 });
  } catch (e) {
    err = String(e).slice(0, 300);
  }
  await ctx.close();
  results.push({ key, name, lang, size: size.key, logs, problems, err });
  process.stdout.write(`done ${key} logs=${logs.length} problems=${problems.length}${err ? ' ERR' : ''}\n`);
}

let next = 0;
await Promise.all(
  Array.from({ length: Math.max(1, JOBS) }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      await runOne(...j);
    }
  }),
);
await browser.close();
results.sort((a, b) => a.key.localeCompare(b.key));
writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 1));
const lines = [];
for (const r of results) {
  if (!r.logs.length && !r.problems.length && !r.err) continue;
  lines.push(`== ${r.key}${r.err ? ` ERROR ${r.err}` : ''}`);
  for (const l of [...new Set(r.logs)]) lines.push(`  log ${l}`);
  for (const p of r.problems) lines.push(`  [${p.kind}] ${p.at} "${String(p.text ?? '').slice(0, 60)}" ${p.detail ?? ''}`);
}
writeFileSync(`${OUT}/report.txt`, lines.join('\n'));
console.log(`${results.length} runs; ${results.filter((r) => r.logs.length).length} with console logs; ${results.filter((r) => r.problems.length).length} with layout problems; ${results.filter((r) => r.err).length} errors`);
