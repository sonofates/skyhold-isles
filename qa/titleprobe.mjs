// Title screen QA: loading → tap → menu → Credits → Continue (map) / New game (confirm), at several
// sizes, EN + TR, with the UI audit (uiAuditLib) on the menu, Credits and the confirm board.
// Usage: node qa/titleprobe.mjs [--base=..] [--shots=dir] [--size=2000x991,844x390] [--lang=en,tr]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { auditPage } from './uiAuditLib.mjs';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const SHOTS = arg('shots') ?? null;
const LANGS = (arg('lang') ?? 'en,tr').split(',');
const ALL = [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1 },
  { key: '2000x991', w: 2000, h: 991, dpr: 1 },
  { key: '1366x768', w: 1366, h: 768, dpr: 1 },
  { key: '932x430', w: 932, h: 430, dpr: 2, touch: true },
  { key: '844x390', w: 844, h: 390, dpr: 2, touch: true },
];
const SIZES = ALL.filter((s) => !arg('size') || arg('size').split(',').includes(s.key));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const pad = (a, v) => [...a, ...Array(Math.max(0, 25 - a.length)).fill(v)];
const SEED = JSON.stringify({ ids: IDS, progress: { version: 2, unlockedLevelIndex: 4, bestStars: pad([3, 2, 3, 1], 0), clears: pad([2, 1, 1, 1], 0) } });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const problems = [];

async function audit(page, key) {
  await page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter((an) => an.effect?.getComputedTiming().iterations !== Infinity).map((an) => an.finished.catch(() => undefined))),
    new Promise((res) => setTimeout(res, 2500)),
  ]));
  const r = await page.evaluate(auditPage, {});
  for (const p of r.problems) problems.push(`${key}: [${p.kind}] ${p.at} "${p.text}" — ${p.detail}`);
  return r.problems.length;
}

const shot = (page, name) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 74, timeout: 150000 }) : Promise.resolve());

for (const lang of LANGS) {
  for (const size of SIZES) {
    for (const seeded of [true, false]) {
      const key = `${lang}-${size.key}-${seeded ? 'save' : 'fresh'}`;
      const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch });
      await ctx.addInitScript(([s, l]) => {
        if (sessionStorage.getItem('qa-seeded')) return;
        sessionStorage.setItem('qa-seeded', '1');
        localStorage.clear();
        localStorage.setItem('skyhold_isles_language_v1', l);
        localStorage.setItem('skyhold_isles_settings_v1', JSON.stringify({ language: l }));
        if (s) localStorage.setItem('skyhold_isles_progress2d_v1', s);
      }, [seeded ? SEED : null, lang]);
      const page = await ctx.newPage();
      page.setDefaultTimeout(120000); // software GL on a busy machine: clicks that navigate can take a while
      page.on('pageerror', (e) => problems.push(`${key}: page error ${e.message}`));
      await page.goto(`${BASE}/2d.html?title=1&lang=${lang}&desktop=${size.touch ? 0 : 1}`);
      await page.waitForSelector('[data-testid="title2d"]', { timeout: 30000 });
      const early = await page.evaluate(() => window.__title?.state());
      if (seeded) await shot(page, `title-${lang}-${size.key}-loading`);
      await page.waitForFunction(() => window.__title?.state().phase === 'tap', null, { timeout: 30000 }).catch(() => problems.push(`${key}: never reached tap`));
      await page.waitForTimeout(700);
      if (seeded) await shot(page, `title-${lang}-${size.key}-tap`);
      if (size.touch) await page.touchscreen.tap(size.w / 2, size.h * 0.6);
      else await page.keyboard.press('Space');
      await page.waitForFunction(() => window.__title?.state().phase === 'menu', null, { timeout: 5000 }).catch(() => problems.push(`${key}: tap did not open the menu`));
      await page.waitForTimeout(700);
      const st = await page.evaluate(() => window.__title.state());
      const n = await audit(page, `${key} menu`);
      await shot(page, `title-${lang}-${size.key}-menu-${seeded ? 'save' : 'fresh'}`);
      // The whole menu must be on screen.
      const off = await page.evaluate(() => [...document.querySelectorAll('[data-testid="title2d-menu"] button')].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth;
      }).length);
      if (off) problems.push(`${key}: ${off} menu buttons off screen`);
      // Logo and menu must not overlap.
      const overlap = await page.evaluate(() => {
        const a = document.querySelector('.pu-title-logo').getBoundingClientRect();
        const b = document.querySelector('[data-testid="title2d-menu"]').getBoundingClientRect();
        return Math.max(0, a.bottom - b.top);
      });
      if (overlap > 0) problems.push(`${key}: logo overlaps the menu by ${Math.round(overlap)} px`);
      let extra = '';
      if (seeded) {
        await page.click('[data-testid="title2d-credits"]');
        await page.waitForSelector('[data-testid="credits2d"]');
        await page.waitForTimeout(500);
        const c = await audit(page, `${key} credits`);
        await shot(page, `title-${lang}-${size.key}-credits`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await page.click('[data-testid="title2d-new"]');
        await page.waitForSelector('[data-testid="confirm-newgame"]');
        await page.waitForTimeout(500);
        const cf = await audit(page, `${key} confirm`);
        await shot(page, `title-${lang}-${size.key}-confirm`);
        await page.click('[data-testid="confirm-newgame-no"]');
        await page.waitForTimeout(300);
        await page.click('[data-testid="title2d-continue"]');
        extra = `credits ${c}, confirm ${cf}`;
      } else {
        await page.click('[data-testid="title2d-new"]');
      }
      await page.waitForSelector('[data-testid="worldmap2d"]', { timeout: 20000 }).catch(() => problems.push(`${key}: no map after the menu`));
      await page.waitForFunction(() => !document.querySelector('[data-testid="title2d"]'), null, { timeout: 5000 }).catch(() => problems.push(`${key}: title did not leave`));
      const seen = await page.evaluate(() => sessionStorage.getItem('skyhold2d_title_seen_v1'));
      if (seen !== '1') problems.push(`${key}: title not marked seen`);
      console.log(`${key}: early ${early?.phase} ${early ? early.progress.toFixed(2) : '-'}, menu [${st.buttons.join(' ')}], audit ${n}${extra ? ', ' + extra : ''}`);
      await ctx.close();
    }
  }
}
await browser.close();
console.log(problems.length ? `title probe: ${problems.length} problems\n  ${problems.join('\n  ')}` : 'title probe: 0 problems');
process.exit(problems.length ? 1 : 0);
