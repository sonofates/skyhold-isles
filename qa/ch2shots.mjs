// Chapter two (i17–i24) play-check against `vite preview` (default http://127.0.0.1:4381).
//   --part=battle  each chapter island at 1920x1080 (DPR 1) and 844x390 (DPR 2, touch), autoplay at 3×:
//                  the opening card (with the "New" foe tag) and a mid-battle frame with waves running.
//                  Logs foes on screen, painted death clips started, side-walk frames, art fallbacks.
//   --part=boss    i24 played to its last wave (autoplay, 3×): frames at the Colossus spawn, Stormwall
//                  and enrage, then the end.
//   --part=map     world map + briefing for i17–i24 in EN and TR (desktop + phone), the story intro,
//                  and the bestiary after a chapter battle.
// Usage: python3 qa/withPreview.py node qa/ch2shots.mjs --part=battle [--ids=i17,i18] [--out=docs/ch2-shots]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'docs/ch2-shots';
const PART = arg('part') ?? 'battle';
const CHAPTER = ['i17', 'i18', 'i19', 'i20', 'i21', 'i22', 'i23', 'i24'];
const IDS = (arg('ids') ?? CHAPTER.join(',')).split(',');
const SIZES = [
  { key: 'desk', w: 1920, h: 1080, dpr: 1, desktop: 1 },
  { key: 'phone', w: 844, h: 390, dpr: 2, desktop: 0, touch: true },
].filter((s) => (arg('size') ?? 'desk,phone').split(',').includes(s.key));
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const problems = [];
const report = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ALL = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
/** Save with islands [0, cleared) won (2★) and `unlocked` as the furthest open island. */
const save = (cleared, unlocked) => {
  const n = ALL.length;
  const stars = Array.from({ length: n }, (_, i) => (i < cleared ? 2 : 0));
  return JSON.stringify({
    ids: ALL,
    progress: {
      version: 2,
      unlockedLevelIndex: unlocked,
      bestStars: stars,
      bestEndlessWaves: Array(n).fill(0),
      bestLives: stars.map((s) => (s ? 16 : 0)),
      clears: stars.map((s) => (s ? 1 : 0)),
      workshop: {},
      challengeClears: Array.from({ length: n }, () => []),
      daily: { lastDay: -1, streak: 0, bestStreak: 0, total: 0 },
    },
  });
};
const seenAll = JSON.stringify(ALL.flatMap((id) => [`${id}:intro`, `${id}:outro`]));

async function open(size, lang, query, seed, { storySeen = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch });
  await ctx.addInitScript(
    ([l, s, seen]) => {
      try {
        if (sessionStorage.getItem('__ch2seeded')) return;
        sessionStorage.setItem('__ch2seeded', '1');
        localStorage.setItem('skyhold_isles_language_v1', l);
        localStorage.setItem('skyhold_isles_settings_v1', JSON.stringify({ language: l }));
        if (s) localStorage.setItem('skyhold_isles_progress2d_v1', s);
        if (seen) localStorage.setItem('skyhold_isles_story2d_seen_v1', seen);
      } catch {
        // ignore
      }
    },
    [lang, seed, storySeen ? seenAll : null],
  );
  const page = await ctx.newPage();
  const tag = `${size.key} ${lang} ${query}`;
  page.on('pageerror', (e) => problems.push(`${tag}: pageerror ${e.message}`));
  page.on('console', (m) => {
    const tx = m.text();
    if (m.type() === 'error' && !/favicon|Failed to load resource/.test(tx)) problems.push(`${tag}: console ${tx.slice(0, 200)}`);
    if (/\[art2d\]/.test(tx)) problems.push(`${tag}: ${tx.slice(0, 200)}`);
  });
  await page.goto(`${BASE}/2d.html${query}${query.includes('?') ? '&' : '?'}lang=${lang}&desktop=${size.desktop}`);
  return { ctx, page };
}

const st = (page) => page.evaluate(() => {
  const s = window.__p0.state();
  return { wave: s.wave, waveState: s.waveState, outcome: s.outcome, enemies: s.enemies, lives: s.lives, gold: s.gold, towers: s.towers.length, foes: s.foes, bosses: s.bosses, deathClips: s.fx?.deathClips, sideFrames: s.fx?.sideFrames, speed: s.speed };
});

async function waitGame(page) {
  await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'), null, { timeout: 90000 });
  await sleep(800);
}

async function battle(id, size) {
  const { ctx, page } = await open(size, 'en', `?level=${id}&autoplay=1&speed=3&hero=bran`, save(17, 24));
  const tag = `${size.key} ${id}`;
  try {
    await waitGame(page);
    const art = await page.evaluate(() => String(window.__p0.artcheck?.() ?? ''));
    for (const line of art.split('\n')) if (/bellrunner|kilnback|reedpiper|draftwing/.test(line) && /pending|missing|tinted/.test(line)) problems.push(`${tag}: art ${line.trim()}`);
    await page.screenshot({ path: `${OUT}/${id}-${size.key}-open.jpg`, type: 'jpeg', quality: 82 });
    const t0 = Date.now();
    let s = await st(page);
    let shot = false;
    while (Date.now() - t0 < 150000) {
      await sleep(1000);
      s = await st(page);
      if (s.outcome !== 'ongoing') break;
      if (!shot && s.wave >= 3 && s.enemies >= 8) {
        await page.screenshot({ path: `${OUT}/${id}-${size.key}-battle.jpg`, type: 'jpeg', quality: 82 });
        report.push(`${tag} battle shot: ${JSON.stringify(s)}`);
        shot = true;
      }
      if (shot && s.deathClips > 0 && s.sideFrames > 0) break;
    }
    if (!shot) {
      await page.screenshot({ path: `${OUT}/${id}-${size.key}-battle.jpg`, type: 'jpeg', quality: 82 });
      report.push(`${tag} battle shot (timeout): ${JSON.stringify(s)}`);
    }
    report.push(`${tag} end of check: wave ${s.wave} lives ${s.lives} towers ${s.towers} deathClips ${s.deathClips} sideFrames ${s.sideFrames}`);
    if (!(s.deathClips > 0)) problems.push(`${tag}: no painted death clip played`);
    if (!(s.sideFrames > 0)) problems.push(`${tag}: no side-walk frame drawn`);
  } catch (e) {
    problems.push(`${tag}: ${e.message}`);
  } finally {
    await ctx.close();
  }
}

async function boss(size) {
  const { ctx, page } = await open(size, 'en', '?level=i24&autoplay=1&speed=3&hero=bran', save(24, 24));
  const tag = `${size.key} i24-boss`;
  const seen = new Set();
  try {
    await waitGame(page);
    const t0 = Date.now();
    let s = await st(page);
    while (Date.now() - t0 < 900000) {
      await sleep(700);
      s = await st(page);
      const b = (s.bosses ?? [])[0];
      const step = (name) => {
        if (seen.has(name)) return false;
        seen.add(name);
        report.push(`${tag} ${name}: ${JSON.stringify(s)}`);
        return true;
      };
      if (b && step('spawn')) await page.screenshot({ path: `${OUT}/i24-${size.key}-boss-spawn.jpg`, type: 'jpeg', quality: 82 });
      if (b && b.phase >= 1 && step('stormwall')) await page.screenshot({ path: `${OUT}/i24-${size.key}-boss-stormwall.jpg`, type: 'jpeg', quality: 82 });
      if (b && b.phase >= 2 && step('enrage')) await page.screenshot({ path: `${OUT}/i24-${size.key}-boss-enrage.jpg`, type: 'jpeg', quality: 82 });
      if (s.outcome !== 'ongoing') break;
    }
    await sleep(2500);
    await page.screenshot({ path: `${OUT}/i24-${size.key}-boss-end.jpg`, type: 'jpeg', quality: 82 });
    report.push(`${tag} end: ${JSON.stringify(s)}`);
    for (const k of ['spawn', 'stormwall', 'enrage']) if (!seen.has(k)) problems.push(`${tag}: never saw ${k}`);
  } catch (e) {
    problems.push(`${tag}: ${e.message}`);
  } finally {
    await ctx.close();
  }
}

async function mapShots() {
  for (const size of SIZES) {
    for (const lang of ['en', 'tr']) {
      // Map right after i16: chapter two opens at i17.
      for (const [name, seed] of [['map-after-i16', save(17, 17)], ['map-all-open', save(24, 24)]]) {
        const { ctx, page } = await open(size, lang, '', seed);
        try {
          await page.waitForFunction(() => window.__map?.islands, null, { timeout: 60000 });
          await sleep(1500);
          const isl = await page.evaluate(() => window.__map.islands());
          report.push(`${size.key} ${lang} ${name}: ${isl.length} islands, unlocked ${isl.filter((i) => i.unlocked).map((i) => i.id).join(',')}`);
          if (isl.length !== 25) problems.push(`${size.key} ${lang} ${name}: ${isl.length} islands on the map`);
          await page.screenshot({ path: `${OUT}/${name}-${size.key}-${lang}.jpg`, type: 'jpeg', quality: 82 });
        } catch (e) {
          problems.push(`${size.key} ${lang} ${name}: ${e.message}`);
        } finally {
          await ctx.close();
        }
      }
      for (const id of IDS) {
        const idx = ALL.indexOf(id);
        const { ctx, page } = await open(size, lang, `?screen=brief&island=${idx}`, save(idx, idx));
        try {
          await page.waitForFunction(() => document.querySelector('.pu-sheet'), null, { timeout: 60000 });
          await sleep(1200);
          const text = await page.evaluate(() => document.querySelector('.pu-sheet')?.textContent ?? '');
          report.push(`${size.key} ${lang} brief ${id}: ${text.replace(/\s+/g, ' ').slice(0, 160)}`);
          if (lang === 'tr' && /Cloudbell|Glassworks|Lanternseed|Pennants|Kitewright|Brineglass|Waxlight|Lastlight|Belfry|Kilnback|Piper|Moth/.test(text)) problems.push(`${size.key} tr brief ${id}: English name left: ${text.slice(0, 120)}`);
          await page.screenshot({ path: `${OUT}/brief-${id}-${size.key}-${lang}.jpg`, type: 'jpeg', quality: 82 });
        } catch (e) {
          problems.push(`${size.key} ${lang} brief ${id}: ${e.message}`);
        } finally {
          await ctx.close();
        }
      }
    }
  }
  // Story intro (first play of i17) and the bestiary after meeting the chapter foes.
  for (const lang of ['en', 'tr']) {
    const size = SIZES[0];
    let o = await open(size, lang, '?level=i17&story=intro', save(17, 17), { storySeen: false });
    try {
      await sleep(5000);
      await o.page.screenshot({ path: `${OUT}/story-i17-intro-${size.key}-${lang}.jpg`, type: 'jpeg', quality: 82 });
    } finally {
      await o.ctx.close();
    }
    o = await open(size, lang, '?level=i18&codex=1', save(24, 24));
    try {
      await sleep(5000);
      await o.page.screenshot({ path: `${OUT}/codex-${size.key}-${lang}.jpg`, type: 'jpeg', quality: 82 });
      const names = await o.page.evaluate(() => [...document.querySelectorAll('.pu-cx-name')].map((e) => e.textContent));
      report.push(`${lang} codex tiles: ${names.join(' | ')}`);
    } finally {
      await o.ctx.close();
    }
  }
}

if (PART === 'battle') {
  for (const id of IDS) await Promise.all(SIZES.map((size) => battle(id, size)));
} else if (PART === 'boss') {
  await Promise.all(SIZES.map((size) => boss(size)));
} else if (PART === 'map') {
  await mapShots();
}
await browser.close();
writeFileSync(`${OUT}/report-${PART}.txt`, [...report, '', 'PROBLEMS:', ...problems].join('\n') + '\n');
console.log(report.join('\n'));
console.log(problems.length ? `\nPROBLEMS (${problems.length}):\n${problems.join('\n')}` : '\nno problems');
process.exit(problems.length ? 1 : 0);
