// P6 localisation screenshots: every 2D screen in a language (default Turkish) at phone landscape
// (844x390, touch) and desktop (1600x900), against `vite preview`. The language is set the way a
// player sets it (stored next to the settings), not with ?lang=, so the real start-up path is used.
// Writes JPEGs to docs/l10n-shots/ and prints what it can measure: painted elements outside the
// viewport, overflowing plank / tag / ribbon text, text clipped in its box, English left on screen,
// console errors.
// Usage: node qa/l10nshots.mjs [only-substring] [--base=http://127.0.0.1:4173] [--out=docs/l10n-shots] [--lang=tr]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? process.env.BASE ?? 'http://127.0.0.1:4173';
const OUT = arg('out') ?? process.env.OUT ?? 'docs/l10n-shots';
const LANG = arg('lang') ?? 'tr';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const only = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '';

const SIZES = [
  { key: 'phone-844x390', w: 844, h: 390, dpr: 2, touch: true },
  { key: 'desk-1600x900', w: 1600, h: 900, dpr: 1, touch: false },
];

const IDS = ['l1c', 'i01', 'i02', 'i03', 'i04', 'i05', 'i06', 'i07', 'i08', 'i09', 'i10', 'i11', 'i12', 'i13', 'i14', 'i15', 'i16'];
const ALL_CH = ['bowless', 'glassSanctuary', 'thaw', 'galeForce', 'quietGuns', 'thinPurse', 'silentSkies', 'ironTide'];
const save = (stars, unlocked, extra = {}) => {
  const n = IDS.length;
  const pad = (a, v) => [...a, ...Array(Math.max(0, n - a.length)).fill(v)];
  return JSON.stringify({
    ids: IDS,
    progress: {
      version: 2,
      unlockedLevelIndex: unlocked,
      bestStars: pad(stars, 0),
      bestEndlessWaves: pad(extra.endless ?? [], 0),
      bestLives: pad(stars.map((s) => (s ? 14 + s * 2 : 0)), 0),
      clears: pad(stars.map((s) => (s > 0 ? 1 + s : 0)), 0),
      workshop: extra.workshop ?? {},
      challengeClears: Array.from({ length: n }, (_, i) => extra.badges?.[i] ?? []),
      daily: extra.daily ?? { lastDay: -1, streak: 0, bestStreak: 0, total: 0 },
    },
  });
};
const SEED_ONE = save([2], 1, { workshop: { treasury: 1 }, daily: { lastDay: -1, streak: 0, bestStreak: 3, total: 4 } });
const SEED_MODES = save([3, 3, 2, 1, 3, 2, 1, 2], 9, {
  workshop: { treasury: 2, bastion: 1, fletcher: 1, quickcast: 1 },
  badges: [['bowless'], ALL_CH, [], [], ['thaw']],
  endless: [14, 25, 0, 0],
  daily: { lastDay: -1, streak: 0, bestStreak: 5, total: 7 },
});
const SEED_ALL = save(Array(17).fill(3), 16, { workshop: { treasury: 2, bounty: 2, bastion: 2, quickcast: 2, fletcher: 2, powder: 2, storm: 2 }, badges: Array(17).fill(ALL_CH), endless: Array(17).fill(30) });
const STORY_SEEN = JSON.stringify(IDS.flatMap((id) => [`${id}:intro`, `${id}:outro`]));

// [name, query, seed (null = empty save), wait ms, action]
const SHOTS = [
  ['map-fresh', '', null, 900],
  ['map-one-island', '', SEED_ONE, 900],
  ['map-17', '', SEED_MODES, 1000],
  ['map-all', '', SEED_ALL, 1000],
  ['brief', '?screen=brief&island=1', SEED_ONE, 900],
  ['brief-modes', '?screen=brief&island=0&pick=bowless', SEED_MODES, 900],
  ['brief-endless', '?screen=brief&island=1&pick=endless', SEED_MODES, 900],
  ['brief-first', '?screen=brief&island=9', SEED_MODES, 900],
  ['brief-locked', '?screen=brief&island=12', SEED_MODES, 900],
  ['brief-long', '?screen=brief&island=16&pick=championHost', SEED_ALL, 900],
  ['workshop', '?screen=workshop', SEED_MODES, 900],
  ['workshop-empty', '?screen=workshop', null, 900],
  ['logbook', '?screen=logbook', SEED_MODES, 900],
  ['logbook-feats', '?screen=logbook&tab=feats', SEED_MODES, 900],
  ['daily', '?screen=daily', SEED_ONE, 900],
  ['daily-modes', '?screen=daily', SEED_MODES, 900],
  ['daily-locked', '?screen=daily', null, 900],
  ['settings', '?screen=settings', SEED_ONE, 900],
  ['story-intro', '?level=l1c&story=intro', null, 3500],
  ['story-intro-all', '?level=l1c&story=intro', null, 3500, 'next2'],
  ['story-outro', '?level=l1c&story=outro&end=won', null, 4200],
  ['game-hud', '?level=l1c', null, 3500],
  ['game-paused', '?level=l1c', null, 3500, 'pause'],
  ['game-ring-build', '?level=l1c', null, 3500, 'ring'],
  ['game-ring-poor', '?level=l1c', null, 3500, 'ringPoor'],
  ['game-ring-upgrade', '?level=l1c', null, 3500, 'towerRing'],
  ['game-ring-sell', '?level=l1c', null, 3500, 'towerSell'],
  ['codex-foes', '?level=l1c&codex=1', null, 4000],
  ['codex-towers', '?level=l1c&codex=1', null, 4000, 'codexTowers'],
  ['end-won', '?level=l1c&end=won', null, 4200],
  ['end-lost', '?level=l1c&end=lost', null, 4200],
  ['end-challenge', '?level=l1c&challenge=glassSanctuary', SEED_MODES, 2500, 'win'],
  ['end-daily', '?daily=1', SEED_ONE, 2500, 'win'],
  ['end-endless', '?level=l1c&endless=1', SEED_MODES, 2500, 'endless'],
  ['game-endless-hud', '?level=l1c&endless=1', SEED_MODES, 2500, 'endlessHud'],
];

// English words that must not be on a Turkish screen (UI words; names like "Skyhold" / "Tesla" are fine).
const ENGLISH = /(?<![\p{L}])(Tap|Play|Replay|Retry|Victory|Defeat|Wave|Waves|Workshop|Logbook|Settings|Daily|Squall|Challenge|Challenges|Endless|Badge|Earned|Locked|Next|Skip|Close|Stars?|Upgrade|Sell|Refund|Islands?|Isle|Feats?|Volume|Sound|Language|Reset|Foes?|Towers?|Health|Armor|Bounty|Damage|Range|Speed|Health|Campaign|Set sail|Best|won|lives|gold)(?![\p{L}])/u;

const problems = [];

async function check(page, name) {
  const bad = await page.evaluate(
    ([lang, englishSrc]) => {
      const out = [];
      const W = window.innerWidth;
      const H = window.innerHeight;
      const sel = '.pu-sheet, .pu-plank, .pu-round, .pu-tally, .pu-title-banner, .pu-panel, .pu-toggle, .pu-slider, .pu-tag, .pu-map-hint';
      for (const e of document.querySelectorAll(sel)) {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || getComputedStyle(e).visibility === 'hidden' || e.closest('[hidden]')) continue;
        // Map nodes scroll sideways: they must stay inside the sea (the world), not the viewport.
        const world = e.closest('.pu-map-world');
        if (world) {
          const wr = world.getBoundingClientRect();
          if (r.left < wr.left - 1 || r.right > wr.right + 1 || r.top < -1 || r.bottom > H + 1) out.push(`outside the sea: ${(e.textContent ?? '').trim().slice(0, 30)}`);
          continue;
        }
        const scroller = e.closest('.pu-sheet-body, .pu-map-scroll, .pu-cx-grid, .pu-cx-detail');
        if (scroller && scroller !== e) {
          const sr = scroller.getBoundingClientRect();
          if (r.bottom < sr.top || r.top > sr.bottom || r.right < sr.left || r.left > sr.right) continue;
        }
        if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(`outside viewport: ${e.className} @ ${r.left.toFixed(0)},${r.top.toFixed(0)} ${r.width.toFixed(0)}x${r.height.toFixed(0)} "${(e.textContent ?? '').trim().slice(0, 30)}"`);
      }
      // Text wider than its box (one-line lettering).
      for (const e of document.querySelectorAll('.pu-plank, .pu-tag, .pu-sheet-title, .pu-title-banner, .pu-round-label, .pu-tally, .pu-lb-total, .pu-chip, .pu-mode-state, .pu-modes-head, .pu-cx-name, .pu-gem, .pu-rec')) {
        if (e.closest('[hidden]') || e.getBoundingClientRect().width === 0) continue;
        if (e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0) out.push(`overflowing text: "${e.textContent?.trim().slice(0, 50)}"`);
      }
      // Round-button captions must not run into each other.
      const caps = [...document.querySelectorAll('.pu-round-label')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => ({ r: e.getBoundingClientRect(), t: e.textContent }));
      for (let i = 0; i < caps.length; i++)
        for (let j = i + 1; j < caps.length; j++) {
          const a = caps[i].r;
          const b = caps[j].r;
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`captions overlap: "${caps[i].t}" / "${caps[j].t}"`);
        }
      const nodes = [...document.querySelectorAll('.pu-node')].map((n) => n.getBoundingClientRect());
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) out.push(`nodes ${i} and ${j} overlap`);
        }
      // English left in visible DOM text (Turkish run only).
      if (lang === 'tr') {
        const re = new RegExp(englishSrc, 'u');
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const txt = n.textContent?.trim() ?? '';
          const p = n.parentElement;
          if (!txt || !p || p.closest('script, style, [hidden]') || p.getBoundingClientRect().width === 0) continue;
          if (re.test(txt)) out.push(`english text: "${txt.slice(0, 60)}"`);
        }
        for (const e of document.querySelectorAll('[aria-label], [title]')) {
          for (const a of ['aria-label', 'title']) {
            const v = e.getAttribute(a);
            if (v && re.test(v)) out.push(`english ${a}: "${v.slice(0, 60)}"`);
          }
        }
      }
      return out;
    },
    [LANG, ENGLISH.source],
  );
  for (const b of bad) problems.push(`${name}: ${b}`);
}

async function canvasText(page, name) {
  // Pixi text (HUD, ring tooltip, end panel) is not in the DOM: check the QA hooks instead.
  const s = await page.evaluate(() => {
    const st = window.__p0?.state?.();
    return st ? { end: st.end?.note ?? null, wave: window.__p0.hudWave?.() ?? '' } : null;
  });
  if (!s) return;
  if (LANG === 'tr' && ENGLISH.test(s.wave)) problems.push(`${name}: english HUD wave "${s.wave}"`);
  if (LANG === 'tr' && s.end && ENGLISH.test(JSON.stringify(s.end))) problems.push(`${name}: english end note ${JSON.stringify(s.end)}`);
}

const browser = await chromium.launch({ args: ARGS });
for (const size of SIZES) {
  for (const [name, query, seed, wait, action] of SHOTS) {
    const key = `${name}-${size.key}`;
    if (only && !key.includes(only)) continue;
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: size.touch, hasTouch: size.touch, locale: LANG === 'tr' ? 'tr-TR' : 'en-US' });
    await ctx.addInitScript(
      ([s, seen, lang]) => {
        try {
          if (sessionStorage.getItem('qa-seeded')) return;
          sessionStorage.setItem('qa-seeded', '1');
          localStorage.clear();
          localStorage.setItem('skyhold_isles_language_v1', lang);
          localStorage.setItem('skyhold_isles_settings_v1', JSON.stringify({ language: lang }));
          if (s) localStorage.setItem('skyhold_isles_progress2d_v1', s);
          if (s) localStorage.setItem('skyhold_isles_story2d_seen_v1', seen);
        } catch {
          /* ignore */
        }
      },
      [seed, STORY_SEEN, LANG],
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${key}: page error ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/404|Failed to load resource|navigator.vibrate/.test(m.text())) problems.push(`${key}: console ${m.text()}`);
    });
    await page.goto(`${BASE}/2d.html${query}`);
    if (/level=|daily=/.test(query)) await page.waitForFunction(() => window.__p0, null, { timeout: 20000 }).catch(() => problems.push(`${key}: game did not start`));
    await page.waitForTimeout(wait);
    const tap = async (x, y) => {
      if (size.touch) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await page.waitForTimeout(300);
    };
    const ring = () => page.evaluate(() => window.__p0.state().ring);
    if (action === 'next2') {
      for (let i = 0; i < 2; i++) {
        await page.click('[data-testid="story2d-next"]');
        await page.waitForTimeout(450);
      }
    } else if (action === 'pause') {
      await page.keyboard.press('Space');
      await page.waitForTimeout(500);
    } else if (action === 'ring' || action === 'ringPoor') {
      if (action === 'ringPoor') await page.evaluate(() => window.__p0.setGold(40));
      await page.waitForTimeout(100);
      const p = await page.evaluate(() => window.__p0.plotScreen(3));
      await tap(p.x, p.y);
      const r = await ring();
      const tok = r.tokens[action === 'ring' ? 0 : r.tokens.length - 1];
      if (tok) await tap(tok.x, tok.y);
      await page.waitForTimeout(400);
    } else if (action === 'towerRing' || action === 'towerSell') {
      await page.evaluate(() => window.__p0.setGold(5000));
      const p = await page.evaluate(() => window.__p0.plotScreen(3));
      await tap(p.x, p.y);
      let r = await ring();
      await tap(r.tokens[0].x, r.tokens[0].y);
      await tap(r.tokens[0].x, r.tokens[0].y);
      await page.waitForTimeout(500);
      await tap(p.x, p.y);
      r = await ring();
      const tok = action === 'towerRing' ? r.tokens[0] : r.tokens[r.tokens.length - 1];
      if (tok) await tap(tok.x, tok.y);
      await page.waitForTimeout(400);
    } else if (action === 'codexTowers') {
      await page.click('[data-testid="codex-tab-towers"]');
      await page.waitForTimeout(300);
      await page.click('[data-testid="codex-tile-ballista"]');
      await page.waitForTimeout(400);
    } else if (action === 'win') {
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
    await check(page, key);
    await canvasText(page, key);
    await page.screenshot({ path: `${OUT}/${key}.jpg`, type: 'jpeg', quality: 82 });
    console.log('shot', key);
    await ctx.close();
  }
}
// Flow: Settings → Language switches every screen, survives a reload and a settings save.
if (!only || 'langflow'.includes(only)) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: 'tr-TR' });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('qa-seeded')) return;
    sessionStorage.setItem('qa-seeded', '1');
    localStorage.clear();
  });
  const page = await ctx.newPage();
  const ok = (cond, msg) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
    if (!cond) problems.push(`langflow: ${msg}`);
  };
  await page.goto(`${BASE}/2d.html?screen=settings`);
  await page.waitForSelector('[data-testid="settings2d"]');
  const title = () => page.textContent('[data-testid="settings2d"] .pu-sheet-title');
  ok((await title()) === 'Ayarlar', 'a tr-TR browser starts in Turkish');
  ok((await page.getAttribute('html', 'lang')) === 'tr', '<html lang> follows the locale');
  await Promise.all([page.waitForURL(/screen=settings/), page.click('[data-testid="set2d-lang-en"]')]);
  await page.waitForSelector('[data-testid="settings2d"]');
  ok((await title()) === 'Settings', 'picking English reloads Settings in English');
  await page.click('[data-testid="set2d-shake"]');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('skyhold_isles_settings_v1') ?? '{}'));
  ok(stored.language === 'en' && stored.cameraShake === false, `language kept next to the settings after a save (${JSON.stringify(stored)})`);
  await page.reload();
  await page.waitForSelector('[data-testid="settings2d"]');
  ok((await title()) === 'Settings', 'English survives a reload on a tr-TR browser');
  await Promise.all([page.waitForURL(/screen=settings/), page.click('[data-testid="set2d-lang-tr"]')]);
  await page.waitForSelector('[data-testid="settings2d"]');
  ok((await title()) === 'Ayarlar', 'and back to Turkish');
  await ctx.close();
}

await browser.close();
console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}` : 'no layout problems found');
