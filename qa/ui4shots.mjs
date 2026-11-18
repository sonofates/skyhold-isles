// UI round 4 screenshots + checks (painted art hooked up), against `vite preview`:
//  - world map: painted route dashes + anchors (sailed / ahead), also panned to the far east,
//  - briefing (difficulty jewel, painted challenge + Endless seals), Workshop (rank pips),
//  - Logbook (islands: challenge seals; feats: feat seals), Daily (rule seals), Settings (toggles),
//  - story: l1c intro (3 paintings, Pell portrait), i05 generic intro, i12 generic outro,
//  - end panel won / lost (painted play / map icons), the store card (price tag), Codex tower notes,
//  - the build ring's tooltip (painted stat pips),
// in English and Turkish at 844x390 (phone, DPR 2), 1600x900 and 2560x1080.
// Writes JPEGs to docs/ui4-shots/ and prints layout problems + painted-art checks.
// Usage: node qa/ui4shots.mjs [only-substring] [--base=http://127.0.0.1:4173] [--out=docs/ui4-shots] [--lang=en,tr]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? process.env.BASE ?? 'http://127.0.0.1:4173';
const OUT = arg('out') ?? 'docs/ui4-shots';
const LANGS = (arg('lang') ?? 'en,tr').split(',');
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const only = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '';

const SIZES = [
  { key: '844x390', w: 844, h: 390, dpr: 2, touch: true },
  { key: '1600x900', w: 1600, h: 900, dpr: 1, touch: false },
  { key: '2560x1080', w: 2560, h: 1080, dpr: 1, touch: false },
];

const IDS = ['l1c', 'i01', 'i02', 'i03', 'i04', 'i05', 'i06', 'i07', 'i08', 'i09', 'i10', 'i11', 'i12', 'i13', 'i14', 'i15', 'i16'];
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
      daily: extra.daily ?? { lastDay: -1, streak: 2, bestStreak: 5, total: 7 },
    },
  });
};
// Seven islands won (route sailed up to island 8), some workshop ranks, badges and an Endless medal.
const SEED = save([3, 3, 2, 3, 2, 1, 2], 7, {
  workshop: { treasury: 2, bastion: 1, fletcher: 3, bounty: 1 },
  badges: [['bowless', 'thaw'], ['quietGuns'], [], ['galeForce', 'ironTide']],
  endless: [16, 26],
});
const STORY_SEEN = JSON.stringify(IDS.flatMap((id) => [`${id}:intro`, `${id}:outro`]));

// [name, query, wait ms, action]
const SHOTS = [
  ['map', '', 1100],
  ['map-east', '', 1100, 'panEast'],
  ['brief', '?screen=brief&island=0&pick=bowless', 900],
  ['brief-endless', '?screen=brief&island=1&pick=endless', 900],
  ['workshop', '?screen=workshop', 900],
  ['logbook', '?screen=logbook', 900],
  ['logbook-feats', '?screen=logbook&tab=feats', 900],
  ['daily', '?screen=daily', 900],
  ['settings', '?screen=settings', 900],
  ['settings-off', '?screen=settings', 900, 'toggleOff'],
  ['store', '?screen=store&iapmock=1', 1300],
  ['story-l1c', '?level=l1c&story=intro', 3500, 'next2'],
  ['story-i05', '?level=i05&story=intro', 3500, 'next1'],
  ['story-i12-outro', '?level=i12&story=outro&end=won', 4600],
  ['end-won', '?level=l1c&end=won', 4200],
  ['end-lost', '?level=l1c&end=lost', 4200],
  ['codex-towers', '?level=l1c', 3000, 'codexTowers'],
  ['ring-tooltip', '?level=l1c', 3000, 'ring'],
];

// English words that must not be on a Turkish screen (UI words; the mock store titles are skipped).
const ENGLISH = /(?<![\p{L}])(Next stop|Warden|Play|Buy|Restore|Owned|Store|Music|Volume|Sound|Settings|Language|Reset|Locked|Close|Islands?|Isle|Guide|Wave|Workshop|Logbook|Skip)(?![\p{L}])/u;

const problems = [];

async function check(page, name, lang) {
  const bad = await page.evaluate(
    ([lang, englishSrc]) => {
      const out = [];
      const W = window.innerWidth;
      const H = window.innerHeight;
      const sel = '.pu-sheet, .pu-plank, .pu-round, .pu-tally, .pu-title-banner, .pu-toggle, .pu-slider, .pu-tag, .pu-store-item, .pu-store-price, .pu-panel, .pu-portrait';
      for (const e of document.querySelectorAll(sel)) {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || getComputedStyle(e).visibility === 'hidden' || e.closest('[hidden]')) continue;
        if (e.closest('.pu-map-world')) continue;
        const scroller = e.closest('.pu-sheet-body, .pu-map-scroll');
        if (scroller && scroller !== e) {
          const sr = scroller.getBoundingClientRect();
          if (r.bottom < sr.top || r.top > sr.bottom || r.right < sr.left || r.left > sr.right) continue;
        }
        if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(`outside viewport: ${e.className} @ ${r.left.toFixed(0)},${r.top.toFixed(0)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
      }
      for (const e of document.querySelectorAll('.pu-plank, .pu-tag, .pu-sheet-title, .pu-title-banner, .pu-tally, .pu-store-price, .pu-gem')) {
        if (e.closest('[hidden]') || e.getBoundingClientRect().width === 0) continue;
        if (e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0) out.push(`overflowing text: "${e.textContent?.trim().slice(0, 50)}"`);
      }
      // Painted images must load and never be drawn much larger than their pixels (blurry).
      const dpr = window.devicePixelRatio || 1;
      for (const im of document.querySelectorAll('img')) {
        const r = im.getBoundingClientRect();
        if (r.width === 0 || im.closest('[hidden]')) continue;
        if (!im.complete || im.naturalWidth === 0) {
          out.push(`image not loaded: ${im.getAttribute('src')}`);
          continue;
        }
        const k = (Math.max(r.width, r.height) * dpr) / Math.max(im.naturalWidth, im.naturalHeight);
        if (k > 1.35) out.push(`upscaled x${k.toFixed(2)}: ${im.getAttribute('src')} at ${r.width.toFixed(0)}px`);
      }
      // Seals / pips / toggles / gems are paintings now (no CSS diamond or glyph-on-button left).
      if (document.querySelector('.pu-gem::before')) out.push('css gem still drawn');
      for (const e of document.querySelectorAll('.pu-pip')) if (e.tagName !== 'IMG') out.push('css pip left');
      for (const e of document.querySelectorAll('.pu-toggle')) if (e.querySelectorAll('img').length !== 2) out.push('toggle without both paintings');
      for (const e of document.querySelectorAll('.pu-lb-total .pu-round, .pu-feat .pu-round, .pu-rule:not(.pu-cx-note.warn) .pu-round, .pu-ledger-badges .pu-round, .pu-mode-seal > .pu-round'))
        if (!e.classList.contains('pu-seal')) out.push(`seal not painted: ${e.parentElement?.className}`);
      // Route marks on the map.
      const route = document.querySelector('.pu-route');
      if (route) {
        const dashes = route.querySelectorAll('image[href*="route-dash"]').length;
        const anchors = route.querySelectorAll('image[href*="route-anchor"]').length;
        if (dashes < 30) out.push(`route has only ${dashes} dashes`);
        if (anchors < 1) out.push('route has no anchors');
      }
      if (lang === 'tr') {
        const re = new RegExp(englishSrc, 'u');
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const txt = n.textContent?.trim() ?? '';
          const p = n.parentElement;
          if (!txt || !p || p.closest('script, style, [hidden], .pu-store-name') || p.getBoundingClientRect().width === 0) continue;
          if (p.closest('.pu-store-blurb') && p.closest('.pu-store-item:not(.main)')) continue; // adapter text
          if (re.test(txt)) out.push(`english text: "${txt.slice(0, 60)}"`);
        }
      }
      return out;
    },
    [lang, ENGLISH.source],
  );
  for (const b of bad) problems.push(`${name}: ${b}`);
}

const browser = await chromium.launch({ args: ARGS });
for (const lang of LANGS) {
  for (const size of SIZES) {
    for (const [name, query, wait, action] of SHOTS) {
      const key = `${name}-${lang}-${size.key}`;
      if (only && !key.includes(only)) continue;
      const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: size.touch, hasTouch: size.touch, locale: lang === 'tr' ? 'tr-TR' : 'en-US' });
      await ctx.addInitScript(
        ([s, seen, lang]) => {
          try {
            if (sessionStorage.getItem('qa-seeded')) return;
            sessionStorage.setItem('qa-seeded', '1');
            localStorage.clear();
            localStorage.setItem('skyhold_isles_language_v1', lang);
            localStorage.setItem('skyhold_isles_settings_v1', JSON.stringify({ language: lang }));
            localStorage.setItem('skyhold_isles_progress2d_v1', s);
            localStorage.setItem('skyhold_isles_story2d_seen_v1', seen);
          } catch {
            /* ignore */
          }
        },
        [SEED, STORY_SEEN, lang],
      );
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`${key}: page error ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/navigator.vibrate/.test(m.text())) problems.push(`${key}: console ${m.text()}`);
      });
      page.on('response', (r) => {
        if (r.status() >= 400) problems.push(`${key}: HTTP ${r.status()} ${r.url()}`);
      });
      await page.goto(`${BASE}/2d.html${query}`);
      if (/level=/.test(query)) await page.waitForFunction(() => window.__p0, null, { timeout: 20000 }).catch(() => problems.push(`${key}: game did not start`));
      await page.waitForTimeout(wait);
      if (action === 'panEast') {
        await page.evaluate(() => {
          const s = document.querySelector('.pu-map-scroll');
          s.scrollLeft = s.scrollWidth;
        });
        await page.waitForTimeout(400);
      } else if (action === 'toggleOff') {
        for (const id of ['set2d-sound', 'set2d-shake']) await page.click(`[data-testid="${id}"]`);
        await page.waitForTimeout(400);
        const a = await page.getAttribute('[data-testid="set2d-sound"]', 'aria-checked');
        const label = await page.getAttribute('[data-testid="set2d-sound"]', 'aria-label');
        if (a !== 'false' || !label) problems.push(`${key}: sound toggle did not switch off or lost its name`);
      } else if (action === 'next1' || action === 'next2') {
        for (let i = 0; i < (action === 'next2' ? 2 : 0); i++) {
          await page.click('[data-testid="story2d-next"]');
          await page.waitForTimeout(450);
        }
        await page.waitForTimeout(400);
      } else if (action === 'ring') {
        const tap = async (x, y) => {
          if (size.touch) await page.touchscreen.tap(x, y);
          else await page.mouse.click(x, y);
          await page.waitForTimeout(350);
        };
        const p = await page.evaluate(() => window.__p0.plotScreen(7));
        await tap(p.x, p.y);
        const r = await page.evaluate(() => window.__p0.state().ring);
        if (r.tokens[0]) await tap(r.tokens[0].x, r.tokens[0].y);
        await page.waitForTimeout(500);
        if (!(await page.evaluate(() => window.__p0.state().ring.open))) problems.push(`${key}: ring did not open`);
      } else if (action === 'codexTowers') {
        await page.click('[data-testid="codex2d-open"]');
        await page.waitForSelector('[data-testid="codex-tab-towers"]');
        await page.click('[data-testid="codex-tab-towers"]');
        await page.waitForTimeout(600);
      }
      if (/^end-/.test(name) || /outro/.test(name)) {
        const icons = await page.evaluate(() => window.__p0?.state().end ?? null);
        if (/^end-/.test(name) && !icons) problems.push(`${key}: end panel not shown`);
        else if (/^end-/.test(name) && !(icons.painted?.includes('menu') && (icons.buttons.every((b) => b.action !== 'next') || icons.painted.includes('next'))))
          problems.push(`${key}: end panel icons not painted (${JSON.stringify(icons.painted)})`);
      }
      if (/^story-/.test(name)) {
        const st = await page.evaluate(() => ({
          art: [...document.querySelectorAll('.pu-vignette')].map((v) => v.style.backgroundImage || v.style.background),
          portrait: document.querySelectorAll('.pu-panel:not(.pending) .pu-portrait').length,
        }));
        if (!st.art.length || !st.art.every((a) => /story-/.test(a))) problems.push(`${key}: story panel without its painting (${st.art.join(' | ')})`);
        if (st.portrait < 1) problems.push(`${key}: no Pell portrait in the caption`);
      }
      await check(page, key, lang);
      await page.screenshot({ path: `${OUT}/${key}.jpg`, type: 'jpeg', quality: 78 });
      console.log('shot', key);
      await ctx.close();
    }
  }
}
await browser.close();
console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}` : 'no problems found');
