// UI round 6 QA shots, against `vite preview` (default http://127.0.0.1:4361):
//  - abilities: the ability bar on l1c (autoplay builds towers and calls waves) — idle/ready,
//    tooltip (desktop), aiming Meteor, Meteor falling + impact, recharge, aiming Overcharge,
//    Overcharge aura, at 1920x1080 (desktop) and 844x390 (phone, touch), EN + TR,
//  - settings: every Settings section (General / Audio / Graphics / Controls) over a run, EN + TR,
//    both sizes, plus a check that a graphics change re-applies live (FPS chip, tier lock).
// Writes JPEGs to docs/ui6-shots/ and prints a summary (bar box, states, FX counters).
// Usage: node qa/ui6shots.mjs [abilities|settings|all] [--base=...] [--out=docs/ui6-shots] [--lang=en,tr]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4361';
const OUT = arg('out') ?? 'docs/ui6-shots';
const LANGS = (arg('lang') ?? 'en,tr').split(',');
const what = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'all';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const SIZES = [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1, desktop: true },
  { key: '844x390', w: 844, h: 390, dpr: 2, touch: true },
];
const problems = [];

async function open(size, query) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: size.dpr,
    isMobile: !!size.touch,
    hasTouch: !!size.touch,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${size.key} ${query}: pageerror ${e.message}`));
  await page.goto(`${BASE}/2d.html?${query}&desktop=${size.desktop ? 1 : 0}`);
  await page.waitForFunction(() => !!window.__p0?.state, null, { timeout: 90000 });
  await page.waitForTimeout(500);
  return { ctx, page };
}
const ab = (page) => page.evaluate(() => window.__p0.abilities());
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 84 });
const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Screen point of the busiest ground enemy (or the map centre). */
async function enemyPoint(page) {
  return page.evaluate(() => {
    const st = window.__p0.state();
    const f = st.fit;
    const e = st.enemyPx.sort((a, b) => b.dist - a.dist)[Math.min(2, Math.max(0, st.enemyPx.length - 1))];
    if (!e) return { x: innerWidth / 2, y: innerHeight * 0.45 };
    return { x: f.offsetX + e.px * f.scale, y: f.offsetY + e.py * f.scale };
  });
}

async function towerPoint(page) {
  return page.evaluate(() => {
    const st = window.__p0.state();
    const t = st.towers[0];
    return t ? window.__p0.plotScreen(t.plot) : null;
  });
}

/** Freezes the ticker on the first frame where the meteor is falling ('fall', ~40% of the way) or has hit ('impact'). */
async function pauseWhen(page, phase) {
  await page.evaluate(
    (ph) =>
      new Promise((resolve) => {
        const t0 = performance.now();
        const tick = () => {
          const fx = window.__p0.abilities().fx;
          const hit = ph === 'impact' ? fx.impacts > 0 : fx.falling > 0 && performance.now() - t0 > 60;
          if (hit || performance.now() - t0 > 6000) {
            window.__p0.freeze(true);
            resolve();
          } else requestAnimationFrame(tick);
        };
        tick();
      }),
    phase,
  );
  await page.waitForTimeout(120);
}

async function tapAt(page, size, p) {
  if (size.touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

if (what === 'abilities' || what === 'all') {
  for (const lang of LANGS) {
    for (const s of SIZES) {
      const tag = `${lang}-${s.key}`;
      const { ctx, page } = await open(s, `level=l1c&autoplay=1&lang=${lang}`);
      // Before the first wave: dimmed, "ready once the first wave sails in".
      let a = await ab(page);
      console.log(`${tag} prewave: ${JSON.stringify(a.buttons)} bar=${JSON.stringify(a.bar)}`);
      await shot(page, `ab-${tag}-0-prewave`);
      await page.waitForFunction(() => window.__p0.state().waveState !== 'preFirstWave' && window.__p0.state().towers.length >= 2 && window.__p0.state().enemies >= 3, null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      a = await ab(page);
      console.log(`${tag} idle: ${JSON.stringify(a.buttons)}`);
      if (a.buttons.meteor.state !== 'ready' || a.buttons.overcharge.state !== 'ready') problems.push(`${tag}: not ready in wave ${JSON.stringify(a.buttons)}`);
      await shot(page, `ab-${tag}-1-idle`);
      const bm = centre(a.buttons.meteor);
      if (!s.touch) {
        await page.mouse.move(bm.x, bm.y);
        await page.waitForTimeout(250);
        await shot(page, `ab-${tag}-2-tooltip`);
        console.log(`${tag} tooltip: ${(await ab(page)).tip}`);
      }
      // Aim Meteor (button tap), point at the enemies.
      await tapAt(page, s, bm);
      await page.waitForTimeout(150);
      const target = await enemyPoint(page);
      if (!s.touch) await page.mouse.move(target.x, target.y, { steps: 4 });
      await page.waitForTimeout(200);
      a = await ab(page);
      console.log(`${tag} aim meteor: aiming=${a.aiming} hint=${a.hint} fx=${JSON.stringify(a.fx)}`);
      if (a.aiming !== 'meteor' || !a.fx.aim) problems.push(`${tag}: meteor aim not shown`);
      await shot(page, `ab-${tag}-3-aim-meteor`);
      // Cast, then freeze (the game's own Space pause) with the meteor in the air, then right after the impact.
      await tapAt(page, s, target);
      await pauseWhen(page, 'fall');
      await shot(page, `ab-${tag}-4-meteor-fall`);
      await page.evaluate(() => window.__p0.freeze(false));
      await pauseWhen(page, 'impact');
      await shot(page, `ab-${tag}-5-meteor-impact`);
      await page.evaluate(() => window.__p0.freeze(false));
      await page.waitForTimeout(900);
      a = await ab(page);
      console.log(`${tag} after meteor: ${JSON.stringify(a.buttons.meteor)} fx=${JSON.stringify(a.fx)}`);
      if (a.buttons.meteor.state !== 'cooldown') problems.push(`${tag}: meteor not recharging`);
      await shot(page, `ab-${tag}-6-cooldown`);
      // Aim Overcharge (key on desktop), hover a tower.
      if (s.touch) await tapAt(page, s, centre(a.buttons.overcharge));
      else await page.keyboard.press('w');
      await page.waitForTimeout(120);
      const tp = await towerPoint(page);
      if (tp && !s.touch) await page.mouse.move(tp.x, tp.y - 10, { steps: 3 });
      await page.waitForTimeout(200);
      a = await ab(page);
      console.log(`${tag} aim overcharge: aiming=${a.aiming} hint=${a.hint} fx=${JSON.stringify(a.fx)}`);
      if (a.aiming !== 'overcharge' || a.fx.highlights < 1) problems.push(`${tag}: overcharge aim not shown`);
      await shot(page, `ab-${tag}-7-aim-overcharge`);
      if (tp) await tapAt(page, s, { x: tp.x, y: tp.y - 10 });
      await page.waitForTimeout(500);
      a = await ab(page);
      console.log(`${tag} overcharge: ${JSON.stringify(a.buttons.overcharge)} fx=${JSON.stringify(a.fx)}`);
      if (a.fx.auras < 1) problems.push(`${tag}: no overcharge aura`);
      await shot(page, `ab-${tag}-8-overcharge-fx`);
      // Esc / right click / second tap cancel.
      await page.evaluate(() => window.__p0.aimAbility(null));
      await ctx.close();
    }
  }
}

if (what === 'settings' || what === 'all') {
  for (const lang of LANGS) {
    for (const s of SIZES) {
      const tag = `${lang}-${s.key}`;
      for (const tab of ['general', 'audio', 'graphics', 'controls']) {
        const { ctx, page } = await open(s, `level=l1c&lang=${lang}&settings=1&settab=${tab}`);
        await page.waitForSelector('[data-testid="settings2d"]');
        await page.waitForTimeout(450);
        await shot(page, `set-${tag}-${tab}`);
        const overflow = await page.evaluate(() => {
          const b = document.querySelector('[data-testid="settings2d"] .pu-sheet-body');
          const rows = [...b.querySelectorAll('.pu-set-row')].filter((r) => r.scrollWidth > r.clientWidth + 2).length;
          return { scroll: b.scrollHeight > b.clientHeight + 2, wideRows: rows };
        });
        console.log(`settings ${tag} ${tab}: ${JSON.stringify(overflow)}`);
        if (overflow.wideRows) problems.push(`settings ${tag} ${tab}: ${overflow.wideRows} rows overflow`);
        if (tab === 'graphics' && lang === LANGS[0]) {
          // Live apply: Low quality locks the tier, FPS chip appears.
          await page.click('[data-testid="set2d-quality-low"]');
          await page.click('[data-testid="set2d-fps"]');
          await page.waitForTimeout(400);
          const st = await page.evaluate(() => ({ q: window.__p0.state().quality, fps: getComputedStyle(document.querySelector('[data-testid="fps2d"]')).display }));
          console.log(`settings ${tag} live: ${JSON.stringify(st)}`);
          if (st.q !== 'low' || st.fps === 'none') problems.push(`settings ${tag}: graphics not live (${JSON.stringify(st)})`);
          if (overflow.scroll) {
            await page.evaluate(() => {
              const b = document.querySelector('[data-testid="settings2d"] .pu-sheet-body');
              b.scrollTop = b.scrollHeight;
            });
            await page.waitForTimeout(150);
            await shot(page, `set-${tag}-${tab}-scrolled`);
          }
        }
        await ctx.close();
      }
    }
  }
}

if (what === 'spots' || what === 'all') {
  // Where the bar lands on every island (score 0 = clear of plots, towers' room and roads).
  const ids = ['l1c', ...Array.from({ length: 16 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
  for (const s of SIZES) {
    for (const id of ids) {
      const { ctx, page } = await open(s, `level=${id}&lang=en`);
      const a = await ab(page);
      console.log(`spot ${s.key} ${id}: ${JSON.stringify(a.spot)}`);
      if (a.spot.score >= 1000) problems.push(`spot ${s.key} ${id}: covers a plot (${JSON.stringify(a.spot)})`);
      if (id === 'i05' || id === 'i12' || id === 'i16') await shot(page, `spot-${id}-${s.key}`);
      await ctx.close();
    }
  }
  // The world map's Settings (General has the progress row there).
  for (const s of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.dpr, isMobile: !!s.touch, hasTouch: !!s.touch });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`map settings ${s.key}: pageerror ${e.message}`));
    await page.goto(`${BASE}/2d.html?screen=settings&lang=en&desktop=${s.desktop ? 1 : 0}`);
    await page.waitForSelector('[data-testid="settings2d"]', { timeout: 60000 });
    await page.waitForTimeout(500);
    await shot(page, `set-map-en-${s.key}-general`);
    await ctx.close();
  }
}

await browser.close();
console.log(problems.length ? `PROBLEMS:\n  ${problems.join('\n  ')}` : 'no problems');
