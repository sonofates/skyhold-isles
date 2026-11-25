// Ending QA (docs/handoff-ending.md): the ending's first story beat, the credits roll mid-scroll and
// the "Campaign complete" card, at 1280x800 (desktop) and 932x430 (phone landscape, pu-phone).
// ONE Chromium, one page at a time. Checks from the DOM: page errors, every board inside the
// viewport with its buttons on screen and nothing cut, the roll moves on its own and a tap skips it,
// the campaign card shows once on the map after the campaign (not again on the next visit), and
// Settings offers "Watch ending" only after the campaign.
// Usage (dev server, no build needed): python3 /tmp/skyend_dev.py node qa/endingshots.mjs [--lang=tr] [--suffix=-tr]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import 'tsx/esm';

const { PLAYABLE_ISLAND_IDS: IDS } = await import('../src/data/chapters.ts');

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4637';
const OUT = arg('out') ?? 'docs/ending-shots';
const LANG = arg('lang') ?? 'en';
const SUFFIX = arg('suffix') ?? '';
const SHOTS = arg('shots') !== '0';
mkdirSync(OUT, { recursive: true });
const SIZES = [
  { key: '1280x800', w: 1280, h: 800, desktop: true },
  { key: '932x430', w: 932, h: 430, touch: true },
].filter((s) => !arg('size') || arg('size').split(',').includes(s.key));

/** A 2D save with every published island won (varied stars, a few Hard wins), campaign flag optional. */
function save(complete) {
  const n = IDS.length;
  const fill = (f) => Array.from({ length: n }, (_, i) => f(i));
  const stars = fill((i) => 1 + ((i * 7) % 3));
  return JSON.stringify({
    ids: IDS,
    progress: {
      version: 2,
      unlockedLevelIndex: n - 1,
      bestStars: stars,
      bestEndlessWaves: fill((i) => (i === 4 ? 23 : 0)),
      bestLives: fill(() => 20),
      clears: fill(() => 1),
      workshop: {},
      challengeClears: fill(() => []),
      daily: { lastDay: -1, streak: 0, bestStreak: 0, total: 0 },
      difficultyWins: { easy: fill(() => 0), normal: stars, hard: fill((i) => (i % 9 === 0 ? stars[i] : 0)) },
      heroes: { selectedHero: 'bran', roster: { bran: { xp: 900, skills: [] } } },
      ...(complete ? { campaignComplete: true } : {}),
    },
  });
}
const ALL_SEEN = JSON.stringify({ title: ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'], done: ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'] });
const BEFORE_CARD = JSON.stringify({ title: ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'], done: ['ch1', 'ch2', 'ch3', 'ch4'] });

const problems = [];
/** The board (`.pu-sheet`) of `testid` inside the viewport, its buttons on screen, its body not cut. */
async function fits(page, testid, tag) {
  const r = await page.evaluate((id) => {
    const ov = document.querySelector(`[data-testid="${id}"]`);
    const sh = ov?.querySelector('.pu-sheet');
    if (!sh) return null;
    const box = (e) => {
      const b = e.getBoundingClientRect();
      return { x: b.x, y: b.y, r: b.right, b: b.bottom };
    };
    const body = sh.querySelector('.pu-sheet-body');
    return {
      sheet: box(sh),
      buttons: [...sh.querySelectorAll('button')].map((b) => ({ t: b.getAttribute('data-testid'), ...box(b) })),
      cut: body ? body.scrollHeight - body.clientHeight : 0,
      cutX: body ? body.scrollWidth - body.clientWidth : 0,
      vw: innerWidth,
      vh: innerHeight,
    };
  }, testid);
  if (!r) return problems.push(`${tag}: ${testid} not shown`);
  const out = (b) => b.x < -1 || b.y < -1 || b.r > r.vw + 1 || b.b > r.vh + 1;
  if (out(r.sheet)) problems.push(`${tag}: ${testid} board off screen ${JSON.stringify(r.sheet)}`);
  for (const b of r.buttons) if (out(b)) problems.push(`${tag}: button ${b.t} off screen`);
  if (r.cut > 2 && testid !== 'roll2d') problems.push(`${tag}: ${testid} body cut by ${r.cut}px`);
  if (r.cutX > 2) problems.push(`${tag}: ${testid} body cut sideways by ${r.cutX}px`);
  return r;
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, isMobile: !!size.touch, hasTouch: !!size.touch });
    const open = async (key, q, sv, seen) => {
      const page = await ctx.newPage();
      await page.addInitScript(
        ([s, c]) => {
          if (sessionStorage.getItem('qa-seeded')) return;
          sessionStorage.setItem('qa-seeded', '1');
          localStorage.clear();
          localStorage.setItem('skyhold_isles_progress2d_v1', s);
          localStorage.setItem('skyhold2d_chapter_cards_v1', c);
        },
        [sv, seen],
      );
      page.on('pageerror', (e) => problems.push(`${size.key} ${key}: pageerror ${e.message}`));
      await page.goto(`${BASE}/2d.html?lang=${LANG}&desktop=${size.desktop ? 1 : 0}${q}`);
      await page.waitForSelector('[data-testid="worldmap2d"]', { timeout: 30000 });
      return page;
    };
    const tag = (k) => `${size.key} ${k}`;

    // 1. Ending, beat 1.
    {
      const page = await open('ending', '&screen=ending', save(true), ALL_SEEN);
      await page.waitForSelector('[data-testid="ending2d"]', { timeout: 15000 });
      await page.waitForTimeout(900);
      await fits(page, 'ending2d', tag('ending'));
      const revealed = await page.evaluate(() => document.querySelectorAll('[data-testid="ending2d"] .pu-panel:not(.pending)').length);
      if (revealed !== 1) problems.push(`${tag('ending')}: ${revealed} panels revealed (want 1)`);
      if (SHOTS) await page.screenshot({ path: `${OUT}/ending-beat1-${size.key}${SUFFIX}.png` });
      // Skip → the credits roll.
      await page.click('[data-testid="ending2d-skip"]');
      await page.waitForSelector('[data-testid="roll2d"]', { timeout: 5000 });
      await page.waitForTimeout(1600);
      const p = await page.evaluate(() => window.__roll?.progress() ?? -1);
      if (!(p > 0)) problems.push(`${tag('ending')}: roll does not move (${p})`);
      // A tap / click anywhere skips it, and the sequence ends.
      await page.mouse.click(size.w / 2, size.h / 2);
      await page.waitForTimeout(500);
      const left = await page.evaluate(() => ({ roll: !!document.querySelector('[data-testid="roll2d"]:not(.closing)'), phase: window.__ending?.phase() }));
      if (left.roll || left.phase !== 'done') problems.push(`${tag('ending')}: tap did not skip the roll ${JSON.stringify(left)}`);
      console.log(`${tag('ending')}: ok, roll moved to ${p.toFixed(3)} in 1.6 s`);
      await page.close();
    }

    // 2. Credits roll mid-scroll (paused there).
    {
      const page = await open('credits', '&screen=endcredits&at=0.42', save(true), ALL_SEEN);
      await page.waitForSelector('[data-testid="roll2d"]', { timeout: 15000 });
      await page.waitForTimeout(900);
      await fits(page, 'roll2d', tag('credits'));
      const info = await page.evaluate(() => {
        const w = document.querySelector('[data-testid="roll2d-window"]').getBoundingClientRect();
        const lines = [...document.querySelectorAll('[data-testid="roll2d-col"] > *')].filter((e) => {
          const b = e.getBoundingClientRect();
          return b.bottom > w.top && b.top < w.bottom;
        });
        return { visible: lines.length, p: window.__roll?.progress() };
      });
      if (!info.visible) problems.push(`${tag('credits')}: nothing visible in the roll window`);
      console.log(`${tag('credits')}: progress ${info.p} blocks in window ${info.visible}`);
      if (SHOTS) await page.screenshot({ path: `${OUT}/credits-mid-${size.key}${SUFFIX}.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      if (await page.locator('[data-testid="roll2d"]:not(.closing)').count()) problems.push(`${tag('credits')}: Esc did not skip`);
      await page.close();
    }

    // 3. Campaign-complete card: due on the map visit after the campaign, then never again.
    {
      const page = await open('campaign', '', save(true), BEFORE_CARD);
      await page.waitForSelector('[data-testid="campaign2d"]', { timeout: 15000 });
      await page.waitForTimeout(900);
      await fits(page, 'campaign2d', tag('campaign'));
      const chapterDone = await page.locator('[data-testid="chapter2d-done"]').count();
      if (chapterDone) problems.push(`${tag('campaign')}: chapter-complete card shown too`);
      const txt = await page.evaluate(() => ({
        stars: document.querySelector('[data-testid="campaign2d-stars"]')?.textContent,
        mastered: document.querySelector('[data-testid="campaign2d-mastered"]')?.textContent,
        nudges: [...document.querySelectorAll('[data-testid="campaign2d-nudges"] li')].map((l) => l.textContent),
      }));
      console.log(`${tag('campaign')}: ${JSON.stringify(txt)}`);
      if (SHOTS) await page.screenshot({ path: `${OUT}/campaign-card-${size.key}${SUFFIX}.png` });
      await page.click('[data-testid="campaign2d-go"]');
      await page.waitForTimeout(400);
      await page.reload();
      await page.waitForSelector('[data-testid="worldmap2d"]', { timeout: 30000 });
      await page.waitForTimeout(1800);
      if (await page.locator('[data-testid="campaign2d"]').count()) problems.push(`${tag('campaign')}: card shown again on the next visit`);
      await page.close();
    }

    // 4. Settings: "Watch ending" only after the campaign.
    for (const complete of [true, false]) {
      const page = await open('settings', '&screen=settings', save(complete), ALL_SEEN);
      await page.waitForSelector('[data-testid="settings2d"]', { timeout: 15000 });
      await page.waitForTimeout(500);
      const has = await page.locator('[data-testid="set2d-ending"]').count();
      if (!!has !== complete) problems.push(`${tag('settings')}: Watch ending ${has ? 'shown' : 'missing'} with campaignComplete=${complete}`);
      if (complete && has) {
        await page.click('[data-testid="set2d-ending"]');
        await page.waitForSelector('[data-testid="ending2d"]', { timeout: 5000 }).catch(() => problems.push(`${tag('settings')}: Watch ending did not open the ending`));
      }
      await page.close();
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `PROBLEMS (${problems.length}):\n${problems.join('\n')}` : 'no problems');
