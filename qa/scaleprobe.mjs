// Interface size probe (Settings → General → Interface size, 90–130 %): for each scale, the world
// map + Settings, the hero tree, and a run's HUD (hudCheck: overlaps / pieces outside their slot;
// the canvas text audit) at a few sizes, EN + TR, with the DOM UI audit. Optional shots.
// Usage: node qa/scaleprobe.mjs [--base=..] [--scales=0.9,1.3] [--size=2000x991,844x390] [--islands=i02,i09,l1c] [--shots=dir]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { auditPage } from './uiAuditLib.mjs';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const SHOTS = arg('shots') ?? null;
const SCALES = (arg('scales') ?? '0.9,1.3').split(',').map(Number);
const LANGS = (arg('lang') ?? 'en,tr').split(',');
const ISLANDS = (arg('islands') ?? 'i02,i09,l1c').split(',');
const ALL = [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1 },
  { key: '2000x991', w: 2000, h: 991, dpr: 1 },
  { key: '1366x768', w: 1366, h: 768, dpr: 1 },
  { key: '932x430', w: 932, h: 430, dpr: 2, touch: true },
  { key: '844x390', w: 844, h: 390, dpr: 2, touch: true },
];
const SIZES = ALL.filter((s) => (arg('size') ?? '2000x991,1366x768,844x390').split(',').includes(s.key));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const problems = [];

async function open(size, lang, scale, path) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch });
  await ctx.addInitScript(([l, k]) => {
    if (sessionStorage.getItem('qa-seeded')) return;
    sessionStorage.setItem('qa-seeded', '1');
    localStorage.clear();
    localStorage.setItem('skyhold_isles_language_v1', l);
    localStorage.setItem('skyhold_isles_settings_v1', JSON.stringify({ language: l, graphics: { uiScale: k } }));
    localStorage.setItem('skyhold_isles_graphics_v1', JSON.stringify({ uiScale: k }));
    localStorage.setItem('skyhold_isles_coach2d_v1', '1');
    localStorage.setItem('skyhold2d_coach_v1', 'done');
  }, [lang, scale]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`page error ${e.message}`));
  await page.goto(`${BASE}/2d.html${path}${path.includes('?') ? '&' : '?'}lang=${lang}&desktop=${size.touch ? 0 : 1}`);
  return { ctx, page };
}

async function domAudit(page, key) {
  await page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter((an) => an.effect?.getComputedTiming().iterations !== Infinity).map((an) => an.finished.catch(() => undefined))),
    new Promise((res) => setTimeout(res, 2500)),
  ]));
  const r = await page.evaluate(auditPage, {});
  for (const p of r.problems) problems.push(`${key}: [${p.kind}] ${p.at} "${p.text}" — ${p.detail}`);
  return r.problems.length;
}

for (const scale of SCALES) {
  for (const lang of LANGS) {
    for (const size of SIZES) {
      const tag = `${Math.round(scale * 100)}%-${lang}-${size.key}`;
      // Map + Settings (General, where the slider lives).
      {
        const { ctx, page } = await open(size, lang, scale, '?screen=settings');
        await page.waitForSelector('[data-testid="settings2d"]', { timeout: 30000 });
        const unit = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pu')).getPropertyValue('--s')) || getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
        const n = await domAudit(page, `${tag} settings`);
        if (SHOTS && lang === 'tr') await page.screenshot({ path: `${SHOTS}/scale-${tag}-settings.jpg`, type: 'jpeg', quality: 72 });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        const m = await domAudit(page, `${tag} map`);
        if (SHOTS && lang === 'tr') await page.screenshot({ path: `${SHOTS}/scale-${tag}-map.jpg`, type: 'jpeg', quality: 72 });
        console.log(`${tag}: --ui-scale ${unit}; settings ${n}, map ${m}`);
        await ctx.close();
      }
      {
        const { ctx, page } = await open(size, lang, scale, '?screen=heroes');
        await page.waitForSelector('[data-testid="hero2d-tree"] .pu-hnode.cap', { timeout: 30000 });
        await page.waitForTimeout(800);
        const fit = await page.evaluate(() => {
          const b = document.querySelector('[data-testid="hero2d-tree"] .pu-sheet-body');
          return { scroll: b.scrollHeight - b.clientHeight, layout: document.querySelector('.pu-hero-tree-grid').dataset.layout };
        });
        const n = await domAudit(page, `${tag} heroes`);
        if (fit.scroll > 2) problems.push(`${tag} heroes: tree scrolls ${fit.scroll}px (${fit.layout})`);
        console.log(`${tag}: tree ${fit.layout} scroll ${fit.scroll}, audit ${n}`);
        await ctx.close();
      }
      // Runs: the HUD at this size.
      for (const isl of ISLANDS) {
        const { ctx, page } = await open(size, lang, scale, `?level=${isl}&hero=bran`);
        await page.waitForFunction(() => window.__p0?.hudCheck && !document.getElementById('boot'), null, { timeout: 60000 });
        await page.waitForTimeout(1500);
        const hc = await page.evaluate(() => window.__p0.hudCheck());
        const text = await page.evaluate(() => window.__p0.textAudit?.() ?? []);
        const outside = Object.entries(hc.outside).filter(([, v]) => v > 1);
        for (const o of hc.overlaps) problems.push(`${tag} ${isl}: HUD ${o.piece} over ${o.kind} ${o.index} (${o.depth.toFixed(1)}px)`);
        for (const [k, v] of outside) problems.push(`${tag} ${isl}: HUD ${k} ${v.toFixed(1)}px outside its slot`);
        for (const c of text) problems.push(`${tag} ${isl}: canvas text ${c.name} "${c.text}" ${c.detail ?? ''}`);
        const n = await domAudit(page, `${tag} ${isl}`);
        console.log(`${tag} ${isl}: map scale ${hc.fit.scale.toFixed(3)} cover ${hc.fit.coverage?.toFixed?.(2)}, overlaps ${hc.overlaps.length}, outside ${outside.length}, canvas text ${text.length}, dom ${n}`);
        if (SHOTS && lang === 'tr' && isl === ISLANDS[0]) await page.screenshot({ path: `${SHOTS}/scale-${tag}-${isl}.jpg`, type: 'jpeg', quality: 72 });
        await ctx.close();
      }
    }
  }
}
await browser.close();
console.log(problems.length ? `scale probe: ${problems.length} problems\n  ${problems.slice(0, 60).join('\n  ')}` : 'scale probe: 0 problems');
process.exit(problems.length ? 1 : 0);
