// Tier-IV specialization edge cases in the real build:
//  1. short of gold: one branch affordable, one not (ring tokens, tooltip, card: disabled plank + "Need N gold");
//  2. Reduced motion: the specialization flourish still plays (the calm version) and nothing breaks;
//  3. replay: a run with a specialization + an ability bought through the ring replays them (same branch, same ability).
// Usage: node qa/specextra.mjs --base=.. [--out=dir]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? '/tmp/specextra';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const problems = [];
const browser = await chromium.launch({ args: ARGS });

async function open(lang, view, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: view.w, height: view.h }, deviceScaleFactor: view.dpr, isMobile: !!view.touch, hasTouch: !!view.touch });
  await ctx.addInitScript(
    ([l, reduce]) => {
      try {
        if (sessionStorage.getItem('qa-seeded')) return;
        sessionStorage.setItem('qa-seeded', '1');
        localStorage.clear();
        localStorage.setItem('skyhold_isles_language_v1', l);
        localStorage.setItem('skyhold2d_coach_v1', 'done');
        localStorage.setItem('skyhold2d_spechint_v1', 'done');
        if (reduce) localStorage.setItem('skyhold_isles_graphics_v1', JSON.stringify({ reducedMotion: true }));
      } catch {
        /* ignore */
      }
    },
    [lang, !!extra.reduce],
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`page error ${e.message}`));
  await page.goto(`${BASE}/2d.html?level=i02&hero=bran&lang=${lang}&desktop=${view.touch ? 0 : 1}`);
  await page.waitForFunction(() => window.__p0?.spec && !document.getElementById('boot'), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const tap = async (x, y, wait = 350) => {
    if (view.touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await page.waitForTimeout(wait);
  };
  /** Archer on plot 2 at tier III (through the command layer, as the ring would). */
  const archer3 = async () =>
    page.evaluate(() => {
      const p = window.__p0;
      p.setGold(5000);
      p.replay.cmd({ k: 'build', plot: 2, type: 'archer' });
      const id = p.spec().towers[0].id;
      p.replay.cmd({ k: 'upgrade', id });
      p.replay.cmd({ k: 'upgrade', id });
      return id;
    });
  const openRing = async (id) => {
    const top = await page.evaluate((t) => window.__p0.towerTop(t), id);
    await tap(top.x, top.y + 30, 600);
    return page.evaluate(() => window.__p0.state().ring);
  };
  return { ctx, page, tap, archer3, openRing };
}

// 1. Short of gold.
for (const [lang, view, key] of [
  ['en', { w: 2000, h: 991, dpr: 1 }, 'en-desk'],
  ['tr', { w: 844, h: 390, dpr: 2, touch: true }, 'tr-phone'],
]) {
  const { ctx, page, tap, archer3, openRing } = await open(lang, view);
  const id = await archer3();
  // Farwatch 155 (short), Swallow 145 (affordable).
  await page.evaluate(() => window.__p0.setGold(150));
  const r = await openRing(id);
  const en = r.tokens.slice(0, 2).map((t) => t.enabled);
  if (en[0] !== false || en[1] !== true) problems.push(`${key}: token affordability ${JSON.stringify(en)} (want [false,true])`);
  await tap(r.tokens[0].x, r.tokens[0].y, 500);
  await page.screenshot({ path: `${OUT}/${key}-poor-tip.png` });
  await tap(r.tokens[0].x, r.tokens[0].y, 300);
  await page.waitForSelector('[data-testid="spec-card"]', { timeout: 8000 }).catch(() => problems.push(`${key}: poor branch did not open the card`));
  await page.waitForTimeout(900);
  const st = await page.evaluate(() => ({
    fw: document.querySelector('[data-testid="spec-choose-farwatch"]')?.disabled,
    sw: document.querySelector('[data-testid="spec-choose-swallow"]')?.disabled,
    need: document.querySelector('.pu-spec-need')?.textContent ?? null,
    focus: document.activeElement?.dataset?.testid ?? null,
    paused: window.__p0.state().paused,
  }));
  if (st.fw !== true || st.sw !== false || !st.need) problems.push(`${key}: card affordability ${JSON.stringify(st)}`);
  if (st.focus !== 'spec-choose-swallow') problems.push(`${key}: focus should go to the affordable plank, is ${st.focus}`);
  if (!st.paused) problems.push(`${key}: run not paused under the card`);
  await page.screenshot({ path: `${OUT}/${key}-poor-card.png` });
  // Escape / close: the card goes, the run resumes, the tower is unchanged.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ card: !!document.querySelector('[data-testid="spec-card"]:not(.closing)'), paused: window.__p0.state().paused, spec: window.__p0.spec().towers[0].spec }));
  if (after.card || after.paused || after.spec) problems.push(`${key}: after Escape ${JSON.stringify(after)}`);
  console.log(`${key} poor: tokens ${JSON.stringify(en)} card ${JSON.stringify(st)} after ${JSON.stringify(after)}`);
  await ctx.close();
}

// 2. Reduced motion flourish.
{
  const { ctx, page, archer3 } = await open('en', { w: 1600, h: 900, dpr: 1 }, { reduce: true });
  const id = await archer3();
  const rm = await page.evaluate(() => document.documentElement.classList.contains('pu-reduce-motion'));
  if (!rm) problems.push('reduced motion: class not on <html>');
  await page.evaluate((t) => window.__p0.replay.cmd({ k: 'spec', id: t, spec: 'farwatch' }), id);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}/reduced-flourish.png` });
  const f = await page.evaluate(() => window.__p0.spec().flourishes);
  if (f !== 1) problems.push(`reduced motion: flourishes ${f}`);
  console.log(`reduced motion: class ${rm}, flourishes ${f}`);
  await ctx.close();
}

// 3. Replay: the branch and the ability come back.
{
  const { ctx, page, tap, openRing } = await open('en', { w: 1600, h: 900, dpr: 1 });
  // No setGold here (it is not a command, the replay would not have it): the gold is earned in play.
  const id = await page.evaluate(() => {
    const p = window.__p0;
    p.replay.cmd({ k: 'build', plot: 2, type: 'archer' });
    const t = p.spec().towers[0].id;
    p.replay.cmd({ k: 'upgrade', id: t });
    p.replay.cmd({ k: 'upgrade', id: t });
    p.replay.cmd({ k: 'wave' });
    return t;
  });
  for (let i = 0; i < 120 && (await page.evaluate(() => window.__p0.state().gold)) < 260; i++) {
    await page.evaluate(() => {
      window.__p0.replay.step(10);
      if (window.__p0.state().waveSystem?.canCall) window.__p0.replay.cmd({ k: 'wave' });
    });
  }
  const tier = await page.evaluate(() => window.__p0.spec().towers[0].tier);
  console.log(`replay run: gold ${await page.evaluate(() => window.__p0.state().gold)}, archer tier ${tier}`);
  let r = await openRing(id);
  await tap(r.tokens[1].x, r.tokens[1].y);
  await tap(r.tokens[1].x, r.tokens[1].y, 300);
  await page.waitForSelector('[data-testid="spec-choose-swallow"]', { timeout: 8000 });
  await page.waitForTimeout(500);
  await page.click('[data-testid="spec-choose-swallow"]');
  await page.waitForTimeout(800);
  r = await openRing(id);
  await tap(r.tokens[0].x, r.tokens[0].y);
  await tap(r.tokens[0].x, r.tokens[0].y, 400);
  const live = await page.evaluate(() => window.__p0.spec().towers[0]);
  await page.evaluate(() => window.__p0.replay.cmd({ k: 'wave' }));
  await page.evaluate(() => window.__p0.replay.step(40));
  await page.evaluate(() => window.__p0.forceEnd('lost'));
  await page.waitForTimeout(1500);
  const started = await page.evaluate(() => window.__p0.replay.start());
  await page.waitForTimeout(300);
  // Up to 120 s of replay in 2 s hops, until the ability is back (it was bought last).
  for (let i = 0; i < 60; i++) {
    await page.evaluate(() => window.__p0.replay.step(20));
    if (await page.evaluate(() => (window.__p0.spec().towers[0]?.abilities.length ?? 0) > 0)) break;
  }
  const again = await page.evaluate(() => ({ t: window.__p0.spec().towers[0] ?? null, flourishes: window.__p0.spec().flourishes }));
  if (!started || again.t?.spec !== live.spec || JSON.stringify(again.t?.abilities) !== JSON.stringify(live.abilities)) problems.push(`replay: live ${JSON.stringify(live)} replay ${JSON.stringify(again)}`);
  console.log(`replay: live ${live.spec}/${live.abilities} → replay ${again.t?.spec}/${again.t?.abilities}, flourishes in replay ${again.flourishes}`);
  await ctx.close();
}

console.log(`problems ${problems.length}`);
for (const p of problems) console.log('  ' + p);
await browser.close();
process.exit(problems.length ? 1 : 0);
