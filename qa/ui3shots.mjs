// UI round 3 screenshots + checks, against `vite preview`:
//  - the build ring next to the Guide button (plot 3 of l1c, ring + tooltip),
//  - Settings (sound is live: Sound / Volume / Music; the store row on mobile scope),
//  - the world map with the free-version scope (?iapmock=1: the "full adventure" lock),
//  - the store card (from a paid island, after a purchase, and a deep link into a paid island),
// in Turkish and English at 1366x768, 1600x900, 1920x1080, 2560x1080 and phone 844x390.
// Writes JPEGs to docs/ui3-shots/ and prints layout problems (same checks as qa/l10nshots.mjs)
// plus flow checks (buy, restore, web / Steam hide the store, the audio controls save).
// Usage: node qa/ui3shots.mjs [only-substring] [--base=http://127.0.0.1:4173] [--out=docs/ui3-shots] [--lang=tr,en]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? process.env.BASE ?? 'http://127.0.0.1:4173';
const OUT = arg('out') ?? 'docs/ui3-shots';
const LANGS = (arg('lang') ?? 'tr,en').split(',');
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const only = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '';

const SIZES = [
  { key: '1366x768', w: 1366, h: 768, dpr: 1, touch: false },
  { key: '1600x900', w: 1600, h: 900, dpr: 1, touch: false },
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1, touch: false },
  { key: '2560x1080', w: 2560, h: 1080, dpr: 1, touch: false },
  { key: 'phone-844x390', w: 844, h: 390, dpr: 2, touch: true },
];

const IDS = ['l1c', 'i01', 'i02', 'i03', 'i04', 'i05', 'i06', 'i07', 'i08', 'i09', 'i10', 'i11', 'i12', 'i13', 'i14', 'i15', 'i16'];
const save = (stars, unlocked) => {
  const n = IDS.length;
  const pad = (a, v) => [...a, ...Array(Math.max(0, n - a.length)).fill(v)];
  return JSON.stringify({
    ids: IDS,
    progress: {
      version: 2,
      unlockedLevelIndex: unlocked,
      bestStars: pad(stars, 0),
      bestEndlessWaves: pad([], 0),
      bestLives: pad(stars.map((s) => (s ? 14 + s * 2 : 0)), 0),
      clears: pad(stars.map((s) => (s > 0 ? 1 + s : 0)), 0),
      workshop: {},
      challengeClears: Array.from({ length: n }, () => []),
      daily: { lastDay: -1, streak: 0, bestStreak: 0, total: 0 },
    },
  });
};
// Seven islands won: the route reaches island 8, past the six free ones.
const SEED_PAST_FREE = save([3, 3, 2, 3, 2, 1, 2], 7);
const STORY_SEEN = JSON.stringify(IDS.flatMap((id) => [`${id}:intro`, `${id}:outro`]));
const OWNED = JSON.stringify({ version: 1, entitlements: ['full_unlock'], updatedAt: 1 });

// [name, query, seed, wait ms, action, extra storage]
const SHOTS = [
  ['ring-guide', '?level=l1c', null, 2500, 'ring'],
  ['settings', '?screen=settings', SEED_PAST_FREE, 900],
  ['settings-muted', '?screen=settings', SEED_PAST_FREE, 900, 'mute'],
  ['settings-store', '?screen=settings&iapmock=1', SEED_PAST_FREE, 900],
  ['map-web', '', SEED_PAST_FREE, 1000],
  ['map-scope', '?iapmock=1', SEED_PAST_FREE, 1000, 'scrollPaid'],
  ['store', '?iapmock=1', SEED_PAST_FREE, 1000, 'tapPaid'],
  ['store-bought', '?iapmock=1', SEED_PAST_FREE, 1000, 'buy'],
  ['store-deeplink', '?level=i09&iapmock=1', SEED_PAST_FREE, 1600],
  ['map-owned', '?iapmock=1', SEED_PAST_FREE, 1000, 'scrollPaid', OWNED],
];

// English words that must not be on a Turkish screen (UI words). The mock store's own product
// titles / descriptions are placeholder English from the adapter (`[Mock] …`) and are skipped.
const ENGLISH = /(?<![\p{L}])(Tap|Play|Buy|Restore|Owned|Store|Purchases?|Full adventure|Music|Volume|Sound|Settings|Language|Reset|Locked|Close|Islands?|Isle|Guide|Wave)(?![\p{L}])/u;

const problems = [];

async function check(page, name, lang) {
  const bad = await page.evaluate(
    ([lang, englishSrc]) => {
      const out = [];
      const W = window.innerWidth;
      const H = window.innerHeight;
      const sel = '.pu-sheet, .pu-plank, .pu-round, .pu-tally, .pu-title-banner, .pu-toggle, .pu-slider, .pu-tag, .pu-map-hint, .pu-store-item, .pu-node-ribbon';
      for (const e of document.querySelectorAll(sel)) {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || getComputedStyle(e).visibility === 'hidden' || e.closest('[hidden]')) continue;
        const world = e.closest('.pu-map-world');
        if (world) {
          const wr = world.getBoundingClientRect();
          if (r.left < wr.left - 1 || r.right > wr.right + 1 || r.top < -1 || r.bottom > H + 1) out.push(`outside the sea: ${(e.textContent ?? '').trim().slice(0, 30)}`);
          continue;
        }
        const scroller = e.closest('.pu-sheet-body, .pu-map-scroll');
        if (scroller && scroller !== e) {
          const sr = scroller.getBoundingClientRect();
          if (r.bottom < sr.top || r.top > sr.bottom || r.right < sr.left || r.left > sr.right) continue;
        }
        if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(`outside viewport: ${e.className} @ ${r.left.toFixed(0)},${r.top.toFixed(0)} ${r.width.toFixed(0)}x${r.height.toFixed(0)} "${(e.textContent ?? '').trim().slice(0, 30)}"`);
      }
      for (const e of document.querySelectorAll('.pu-plank, .pu-tag, .pu-sheet-title, .pu-title-banner, .pu-round-label, .pu-tally, .pu-store-price, .pu-store-owned, .pu-node-ribbon')) {
        if (e.closest('[hidden]') || e.getBoundingClientRect().width === 0) continue;
        if (e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0) out.push(`overflowing text: "${e.textContent?.trim().slice(0, 50)}"`);
      }
      // Settings rows: the label column must not run under the control.
      for (const row of document.querySelectorAll('.pu-set-row')) {
        const [label, ctl] = row.children;
        if (!label || !ctl) continue;
        const a = label.getBoundingClientRect();
        const b = ctl.getBoundingClientRect();
        if (a.right > b.left + 1 && a.bottom > b.top && b.bottom > a.top) out.push(`settings row overlaps: "${label.textContent?.trim().slice(0, 30)}"`);
      }
      // Store cards must not overlap each other.
      const cards = [...document.querySelectorAll('.pu-store-item')].map((e) => e.getBoundingClientRect());
      for (let i = 0; i < cards.length; i++)
        for (let j = i + 1; j < cards.length; j++) {
          const a = cards[i];
          const b = cards[j];
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`store cards ${i} and ${j} overlap`);
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

/** Guide button (and caption) vs the open ring + its tooltip. */
async function ringCheck(page, name) {
  const res = await page.evaluate(() => {
    const ring = window.__p0.state().ring;
    const btn = document.querySelector('[data-testid="codex2d-open"]');
    const cap = btn?.querySelector('.pu-round-label');
    return { ring, rects: [btn, cap].filter(Boolean).map((e) => e.getBoundingClientRect().toJSON()), hud: window.__p0.state().hud };
  });
  if (!res.ring.open) {
    problems.push(`${name}: ring did not open`);
    return;
  }
  const boxes = [res.ring.layout.box, res.ring.layout.tooltip].filter(Boolean);
  const others = [...res.rects.map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })), res.hud.pause, res.hud.speed];
  for (const b of boxes)
    for (const r of others)
      if (b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y) {
        problems.push(`${name}: ring overlaps a HUD button`);
        return;
      }
}

const browser = await chromium.launch({ args: ARGS });
for (const lang of LANGS) {
  for (const size of SIZES) {
    for (const [name, query, seed, wait, action, owned] of SHOTS) {
      const key = `${name}-${lang}-${size.key}`;
      if (only && !key.includes(only)) continue;
      const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: size.touch, hasTouch: size.touch, locale: lang === 'tr' ? 'tr-TR' : 'en-US' });
      await ctx.addInitScript(
        ([s, seen, lang, owned]) => {
          try {
            if (sessionStorage.getItem('qa-seeded')) return;
            sessionStorage.setItem('qa-seeded', '1');
            localStorage.clear();
            localStorage.setItem('skyhold_isles_language_v1', lang);
            localStorage.setItem('skyhold_isles_settings_v1', JSON.stringify({ language: lang }));
            if (s) localStorage.setItem('skyhold_isles_progress2d_v1', s);
            localStorage.setItem('skyhold_isles_story2d_seen_v1', seen);
            if (owned) {
              localStorage.setItem('skyhold_isles_entitlements_v1', owned);
              localStorage.setItem('skyhold_isles_iap_mock_ledger_v1', owned);
            }
          } catch {
            /* ignore */
          }
        },
        [seed, STORY_SEEN, lang, owned ?? null],
      );
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`${key}: page error ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/404|Failed to load resource|navigator.vibrate/.test(m.text())) problems.push(`${key}: console ${m.text()}`);
      });
      await page.goto(`${BASE}/2d.html${query}`);
      if (/level=l1c/.test(query)) await page.waitForFunction(() => window.__p0, null, { timeout: 20000 }).catch(() => problems.push(`${key}: game did not start`));
      await page.waitForTimeout(wait);
      const tap = async (x, y) => {
        if (size.touch) await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
        await page.waitForTimeout(300);
      };
      const firstPaid = async () => (await page.evaluate(() => window.__map.islands().find((i) => i.paid)?.id)) ?? null;
      if (action === 'ring') {
        const p = await page.evaluate(() => window.__p0.plotScreen(3));
        await tap(p.x, p.y);
        const r = await page.evaluate(() => window.__p0.state().ring);
        if (r.tokens[0]) await tap(r.tokens[0].x, r.tokens[0].y);
        await page.waitForTimeout(350);
        await ringCheck(page, key);
      } else if (action === 'mute') {
        await page.click('[data-testid="set2d-sound"]');
        await page.waitForTimeout(250);
      } else if (action === 'scrollPaid' || action === 'tapPaid' || action === 'buy') {
        const id = (await firstPaid()) ?? 'i07';
        await page.evaluate((id) => document.querySelector(`[data-testid="map2d-island-${id}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' }), id);
        await page.waitForTimeout(400);
        if (action !== 'scrollPaid') {
          await page.click(`[data-testid="map2d-island-${id}"]`);
          await page.waitForSelector('[data-testid="store2d-buy-full_unlock"]', { timeout: 5000 }).catch(() => problems.push(`${key}: store card has no Buy for full_unlock`));
          await page.waitForTimeout(400);
        }
        if (action === 'buy') {
          await page.click('[data-testid="store2d-buy-full_unlock"]');
          await page.waitForSelector('[data-testid="store2d-owned-full_unlock"]', { timeout: 5000 }).catch(() => problems.push(`${key}: full_unlock not owned after Buy`));
          await page.waitForTimeout(300);
        }
      }
      await check(page, key, lang);
      await page.screenshot({ path: `${OUT}/${key}.jpg`, type: 'jpeg', quality: 72 });
      console.log('shot', key);
      await ctx.close();
    }
  }
}

// Flows (desktop 1366x768 + phone, English).
if (!only || 'flow'.includes(only)) {
  const ok = (cond, msg) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
    if (!cond) problems.push(`flow: ${msg}`);
  };
  const fresh = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-US', ...opts });
    await ctx.addInitScript((seed) => {
      if (sessionStorage.getItem('qa-seeded')) return;
      sessionStorage.setItem('qa-seeded', '1');
      localStorage.clear();
      localStorage.setItem('skyhold_isles_progress2d_v1', seed);
    }, SEED_PAST_FREE);
    return ctx;
  };
  // 1. Web (no iapmock): no store anywhere, every island the route reached is playable.
  {
    const ctx = await fresh();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/2d.html?screen=settings`);
    await page.waitForSelector('[data-testid="settings2d"]');
    ok((await page.$('[data-testid="set2d-store"]')) === null, 'web: Settings has no store row');
    ok((await page.evaluate(() => window.__map.islands().filter((i) => i.paid).length)) === 0, 'web: no island wears the full-adventure lock');
    ok((await page.$$('.pu-node-ribbon')).length === 0, 'web: no ribbon on the map');
    await page.goto(`${BASE}/2d.html?level=i07`);
    await page.waitForFunction(() => window.__p0, null, { timeout: 20000 }).catch(() => undefined);
    ok(/level=i07/.test(page.url()) && (await page.evaluate(() => !!window.__p0)), 'web: a paid island (i07) still plays');
    // Sound controls.
    await page.goto(`${BASE}/2d.html?screen=settings`);
    await page.waitForSelector('[data-testid="settings2d"]');
    ok((await page.$('[data-testid="set2d-quiet"]')) === null, 'settings: no "no sound yet" rows');
    const text = await page.textContent('[data-testid="settings2d"]');
    ok(!/No sound|Kept for when/.test(text ?? ''), 'settings: copy no longer says there is no sound');
    await page.click('[data-testid="set2d-sound"]');
    let st = await page.evaluate(() => JSON.parse(localStorage.getItem('skyhold_isles_settings_v1') ?? '{}'));
    ok(st.muted === true, 'settings: Sound off saves muted');
    ok((await page.$$('.pu-set-row.off')).length === 2, 'settings: Volume and Music dim while muted');
    await page.click('[data-testid="set2d-sound"]');
    st = await page.evaluate(() => JSON.parse(localStorage.getItem('skyhold_isles_settings_v1') ?? '{}'));
    ok(st.muted === false, 'settings: Sound on saves unmuted');
    await page.focus('[data-testid="set2d-volume"]');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    st = await page.evaluate(() => JSON.parse(localStorage.getItem('skyhold_isles_settings_v1') ?? '{}'));
    ok(Math.abs(st.masterVolume - 0.5) < 0.011, `settings: Volume keys save the master volume (${st.masterVolume})`);
    await page.focus('[data-testid="set2d-music"]');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    const music = await page.evaluate(() => JSON.parse(localStorage.getItem('skyhold_isles_music_v1') ?? '{}'));
    ok(Math.abs((music.volume ?? -1) - 0.4) < 0.011, `settings: Music keys save the music volume (${music.volume})`);
    await page.reload();
    await page.waitForSelector('[data-testid="settings2d"]');
    const vals = await page.$$eval('.pu-slider-val', (e) => e.map((x) => x.textContent));
    ok(vals[0] === '50%' && vals[1] === '40%', `settings: volumes survive a reload (${vals.join(', ')})`);
    // The live mixer follows the settings in a run.
    await page.goto(`${BASE}/2d.html?level=l1c`);
    await page.waitForFunction(() => window.__p0, null, { timeout: 20000 });
    const audio = await page.evaluate(() => window.__p0.state().settings.audio);
    ok(Math.abs(audio.masterVolume - 0.5) < 0.011 && Math.abs(audio.musicVolume - 0.4) < 0.011, `run: the mixer reads the saved volumes (${JSON.stringify(audio)})`);
    await ctx.close();
  }
  // 2. Mobile scope (mock store): lock, store, buy, restore, deep link.
  for (const phone of [false, true]) {
    const tag = phone ? 'phone' : 'desk';
    const ctx = await fresh(phone ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {});
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`flow ${tag}: page error ${e.message}`));
    await page.goto(`${BASE}/2d.html?iapmock=1`);
    await page.waitForSelector('[data-testid="worldmap2d"]');
    await page.waitForTimeout(500);
    const isl = await page.evaluate(() => window.__map.islands());
    const paidIds = isl.filter((i) => i.paid).map((i) => i.id);
    ok(paidIds.length === isl.length - 6 && !paidIds.includes('i05') && paidIds[0] === 'i06', `${tag}: islands past the first six wear the lock (${paidIds.length})`);
    ok((await page.$$('.pu-node.paid .pu-node-lock')).length === 0, `${tag}: the paid lock is not the progress padlock`);
    await page.click('[data-testid="map2d-island-i06"]');
    await page.waitForSelector('[data-testid="store2d"]');
    ok((await page.$('[data-testid="brief2d"]')) === null, `${tag}: a paid island opens the store, not the briefing`);
    await page.waitForSelector('[data-testid="store2d-buy-full_unlock"]');
    const prices = await page.$$eval('.pu-store-price', (e) => e.map((x) => x.textContent));
    ok(prices.length === 3 && prices.every((p) => p === 'MOCK'), `${tag}: three catalogue products with the adapter's prices (${prices.join(',')})`);
    ok((await page.$('[data-testid="store2d-restore"]')) !== null, `${tag}: Restore purchases is there`);
    await page.click('[data-testid="store2d-buy-full_unlock"]');
    await page.waitForSelector('[data-testid="store2d-owned-full_unlock"]');
    ok(/Every isle is open/.test((await page.textContent('[data-testid="store2d-status"]')) ?? ''), `${tag}: thanks line after the purchase`);
    ok((await page.evaluate(() => window.__map.islands().filter((i) => i.paid).length)) === 0, `${tag}: the map drops every lock after the purchase`);
    await page.keyboard.press('Escape');
    // Restore: wipe the local entitlement cache (the mock store ledger keeps the receipt).
    await page.evaluate(() => localStorage.removeItem('skyhold_isles_entitlements_v1'));
    await page.reload();
    await page.waitForSelector('[data-testid="worldmap2d"]');
    await page.waitForTimeout(400);
    ok((await page.evaluate(() => window.__map.islands().filter((i) => i.paid).length)) > 0, `${tag}: without the cache the locks are back`);
    await page.goto(`${BASE}/2d.html?iapmock=1&screen=settings`);
    await page.waitForSelector('[data-testid="set2d-store"]');
    await page.click('[data-testid="set2d-store"]');
    await page.waitForSelector('[data-testid="store2d-buy-full_unlock"]');
    await page.click('[data-testid="store2d-restore"]');
    await page.waitForSelector('[data-testid="store2d-owned-full_unlock"]', { timeout: 5000 }).catch(() => undefined);
    ok(/restored/.test((await page.textContent('[data-testid="store2d-status"]')) ?? ''), `${tag}: Restore purchases brings the unlock back`);
    // Deep link into a paid island (fresh, nothing owned) lands on the map with the store open.
    await page.evaluate(() => {
      localStorage.removeItem('skyhold_isles_entitlements_v1');
      localStorage.removeItem('skyhold_isles_iap_mock_ledger_v1');
    });
    await page.goto(`${BASE}/2d.html?level=i09&iapmock=1`);
    await page.waitForSelector('[data-testid="store2d"]', { timeout: 15000 }).catch(() => undefined);
    ok(/store=i09/.test(page.url()) && (await page.$('[data-testid="store2d"]')) !== null, `${tag}: ?level=i09 on the free version opens the store (${page.url().replace(BASE, '')})`);
    await page.goto(`${BASE}/2d.html?level=i03&iapmock=1`);
    await page.waitForFunction(() => window.__p0, null, { timeout: 20000 }).catch(() => undefined);
    ok(/level=i03/.test(page.url()) && (await page.evaluate(() => !!window.__p0)), `${tag}: a free island (i03) plays`);
    await ctx.close();
  }
}

await browser.close();
console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}` : 'no problems found');
process.exitCode = problems.length ? 1 : 0;
