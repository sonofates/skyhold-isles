// Hero UI QA shots against `vite preview` (default http://127.0.0.1:4371):
//   map      world map top row (Heroes button) + briefing hero row
//   select   "Choose your hero" (unlocked + locked hero)
//   tree     skill tree fresh / with points spent (+ node detail)
//   game     in-game: idle, selected (move mode), walking, attacking, skill aim, skill cast,
//            dead + respawn timer, respawn fade-in, HUD tooltip (desktop)
//   end      end panel with the run's XP and a level-up (recorded plain run)
//   casts    every hero's two skills mid-cast (EN, desktop only)
// Writes JPEGs to docs/heroes-ui-shots/ as <lang>-<size>-<shot>.jpg and prints problems found.
// Usage: node qa/heroshots.mjs [all|map|select|tree|game|end|casts] [--base=] [--out=] [--lang=en,tr] [--size=1920x1080,844x390]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4371';
const OUT = arg('out') ?? 'docs/heroes-ui-shots';
const LANGS = (arg('lang') ?? 'en,tr').split(',');
const what = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'all';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const ALL_SIZES = [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1, desktop: true },
  { key: '844x390', w: 844, h: 390, dpr: 2, touch: true },
];
const SIZES = ALL_SIZES.filter((s) => !arg('size') || arg('size').split(',').includes(s.key));
const problems = [];
const IDS = ['l1c', 'i01', 'i02', 'i03', 'i04', 'i05', 'i06', 'i07', 'i08', 'i09', 'i10', 'i11', 'i12', 'i13', 'i14', 'i15', 'i16'];

/** A 2D save with `cleared` islands won (3 stars) and the given hero roster. */
function save(cleared, roster, selected = 'bran') {
  const n = IDS.length;
  const fill = (v) => Array.from({ length: n }, (_, i) => (i < cleared ? v : 0));
  return JSON.stringify({
    ids: IDS,
    progress: {
      version: 2,
      unlockedLevelIndex: Math.min(n - 1, cleared),
      bestStars: fill(3),
      bestEndlessWaves: fill(0),
      bestLives: fill(20),
      clears: fill(1),
      workshop: {},
      challengeClears: Array.from({ length: n }, () => []),
      daily: { lastDay: -1, streak: 0, bestStreak: 0, total: 0 },
      heroes: { selectedHero: selected, roster },
    },
  });
}
const BRAN_SPENT = ['bran_oak_1', 'bran_oak_2', 'bran_oak_3', 'bran_iron_1', 'bran_iron_2', 'bran_van_1'];
const SAVES = {
  fresh: save(5, { bran: { xp: 3200, skills: [] }, wren: { xp: 600, skills: [] }, mira: { xp: 0, skills: [] } }),
  spent: save(5, { bran: { xp: 3200, skills: BRAN_SPENT }, wren: { xp: 600, skills: [] }, mira: { xp: 0, skills: [] } }),
  // Just short of level 5 (785 XP): a won run levels up.
  levelup: save(5, { bran: { xp: 730, skills: [] } }),
};

async function open(size, lang, query, saveKey = 'fresh') {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: size.dpr,
    isMobile: !!size.touch,
    hasTouch: !!size.touch,
  });
  await ctx.addInitScript(([k, v]) => {
    if (!sessionStorage.getItem('qa-seeded')) {
      localStorage.setItem('skyhold_isles_progress2d_v1', v);
      sessionStorage.setItem('qa-seeded', '1');
    }
    void k;
  }, ['seed', SAVES[saveKey]]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${size.key} ${lang} ${query}: pageerror ${e.message}`));
  await page.goto(`${BASE}/2d.html?${query}&lang=${lang}&desktop=${size.desktop ? 1 : 0}`);
  return { ctx, page };
}
const shot = (page, size, lang, name) => page.screenshot({ path: `${OUT}/${lang}-${size.key}-${name}.jpg`, type: 'jpeg', quality: 84 });

/** Checks no element in `sel` overflows the viewport or its sheet horizontally. */
async function checkOverflow(page, label) {
  const bad = await page.evaluate(() => {
    const out = [];
    for (const e of document.querySelectorAll('.pu-sheet *')) {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && (r.right > innerWidth + 1 || r.left < -1)) out.push(`${e.className} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    return out.slice(0, 5);
  });
  if (bad.length) problems.push(`${label}: overflow ${bad.join('; ')}`);
}

async function mapShots(size, lang) {
  const { ctx, page } = await open(size, lang, 'screen=brief&island=5');
  await page.waitForSelector('[data-testid=brief2d-hero]', { timeout: 60000 });
  await page.waitForTimeout(900);
  await shot(page, size, lang, 'map-briefing');
  await checkOverflow(page, `${size.key} ${lang} briefing`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await shot(page, size, lang, 'map-topbar');
  await ctx.close();
}

async function selectShots(size, lang) {
  for (const h of ['bran', 'tobb']) {
    const { ctx, page } = await open(size, lang, `screen=herosel&focus=${h}`);
    await page.waitForSelector('[data-testid=hero2d-select]', { timeout: 60000 });
    await page.waitForTimeout(1200);
    await shot(page, size, lang, `select-${h === 'bran' ? 'unlocked' : 'locked'}`);
    await checkOverflow(page, `${size.key} ${lang} select ${h}`);
    await ctx.close();
  }
}

async function treeShots(size, lang) {
  for (const [key, node] of [['fresh', 'bran_oak_1'], ['spent', 'bran_iron_3']]) {
    const { ctx, page } = await open(size, lang, 'screen=heroes&focus=bran', key);
    await page.waitForSelector('[data-testid=hero2d-tree]', { timeout: 60000 });
    await page.waitForTimeout(1000);
    await shot(page, size, lang, `tree-${key}`);
    await page.click(`[data-testid=tree2d-node-${node}]`);
    await page.waitForTimeout(400);
    await shot(page, size, lang, `tree-${key}-detail`);
    await checkOverflow(page, `${size.key} ${lang} tree ${key}`);
    if (key === 'fresh') {
      // Learn it: the node turns owned, points drop.
      const before = await page.textContent('[data-testid=hero-points]');
      await page.click('[data-testid=tree2d-learn]');
      await page.waitForTimeout(300);
      const after = await page.textContent('[data-testid=hero-points]');
      if (before === after) problems.push(`${size.key} ${lang}: Learn did not spend a point (${before})`);
      const st = await page.getAttribute(`[data-testid=tree2d-node-${node}]`, 'data-status');
      if (st !== 'unlocked') problems.push(`${size.key} ${lang}: learned node status ${st}`);
    }
    await ctx.close();
  }
}

/** Waits (in page) until `cond` on the hero state holds, then freezes the ticker. */
async function freezeWhen(page, cond, timeout = 15000) {
  const ok = await page.evaluate(
    ([src, ms]) =>
      new Promise((resolve) => {
        const f = new Function('s', `return (${src})(s)`);
        const t0 = performance.now();
        const tick = () => {
          const s = window.__p0.hero.state();
          if (f(s)) {
            window.__p0.freeze(true);
            resolve(true);
          } else if (performance.now() - t0 > ms) resolve(false);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    [cond.toString(), timeout],
  );
  return ok;
}
const unfreeze = (page) => page.evaluate(() => window.__p0.freeze(false));

async function gameShots(size, lang, hero = 'bran') {
  const { ctx, page } = await open(size, lang, `level=l1c&hero=${hero}&herolevel=12&autoplay=1&speed=2`);
  await page.waitForFunction(() => !!window.__p0?.hero, null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  await shot(page, size, lang, 'game-idle');
  // HUD tooltip on the portrait (desktop hover).
  if (size.desktop) {
    const st = await page.evaluate(() => window.__p0.hero.state());
    const p = st.hud.portrait;
    await page.mouse.move(p.x + p.w / 2, p.y + p.h / 2);
    await page.waitForTimeout(300);
    await shot(page, size, lang, 'hud-tooltip-hero');
    const s0 = st.hud.skills[0];
    await page.mouse.move(s0.x + s0.w / 2, s0.y + s0.h / 2);
    await page.waitForTimeout(300);
    await shot(page, size, lang, 'hud-tooltip-skill');
    await page.mouse.move(size.w / 2, size.h / 2);
  }
  // Select by tapping the portrait (as a player would), then a road tap.
  const st0 = await page.evaluate(() => window.__p0.hero.state());
  const pp = st0.hud.portrait;
  if (size.touch) await page.touchscreen.tap(pp.x + pp.w / 2, pp.y + pp.h / 2);
  else await page.mouse.click(pp.x + pp.w / 2, pp.y + pp.h / 2);
  await page.waitForTimeout(300);
  const sel = await page.evaluate(() => window.__p0.hero.state().selected);
  if (!sel) problems.push(`${size.key} ${lang}: portrait tap did not select the hero`);
  const target = await page.evaluate(() => window.__p0.hero.toScreen(0, 0));
  if (size.desktop) await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(300);
  await shot(page, size, lang, 'game-selected');
  if (size.touch) await page.touchscreen.tap(target.x, target.y);
  else await page.mouse.click(target.x, target.y);
  const walked = await freezeWhen(page, (s) => s.sim.state === 'moving' && /^(down|up|side)/.test(s.view.frame));
  if (!walked) problems.push(`${size.key} ${lang}: no walking frame`);
  await shot(page, size, lang, 'game-walking');
  await unfreeze(page);
  const attacked = await freezeWhen(page, (s) => /^attack:(1|2)/.test(s.view.frame) && s.view.casts === 0, 40000);
  if (!attacked) problems.push(`${size.key} ${lang}: no attack frame`);
  await shot(page, size, lang, 'game-attacking');
  await unfreeze(page);
  // Skill aim + cast (slot 0, at the busiest enemy near the hero).
  await page.evaluate(() => window.__p0.hero.aim(0));
  const aimAt = await page.evaluate(() => {
    const e = window.__p0.hero.nearestEnemy();
    const h = window.__p0.state().hero;
    return window.__p0.hero.toScreen(e ? e.x : h.x + 1.5, e ? e.z : h.z);
  });
  if (size.desktop) {
    await page.mouse.move(aimAt.x, aimAt.y);
    await page.waitForTimeout(300);
    await shot(page, size, lang, 'game-skill-aim');
    await page.mouse.click(aimAt.x, aimAt.y);
  } else {
    // Touch: finger down shows the preview, release casts.
    await page.evaluate(() => window.__p0.freeze(false));
    await shot(page, size, lang, 'game-skill-aim');
    await page.touchscreen.tap(aimAt.x, aimAt.y);
  }
  const cast = await freezeWhen(page, (s) => s.view.effects.length > 0 || s.view.casts > 0, 4000);
  if (!cast) problems.push(`${size.key} ${lang}: skill did not cast`);
  await page.evaluate(() => window.__p0.freeze(false));
  await page.waitForTimeout(120);
  await page.evaluate(() => window.__p0.freeze(true));
  await shot(page, size, lang, 'game-skill-cast');
  await unfreeze(page);
  // Second skill (self / targeted) via the key / aim API.
  await page.evaluate(() => window.__p0.hero.cast(1));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__p0.freeze(true));
  await shot(page, size, lang, 'game-skill2-cast');
  await unfreeze(page);
  // Down: fallen pose, then the respawn timer over the castle.
  await page.evaluate(() => window.__p0.hero.kill());
  await freezeWhen(page, (s) => /^death:[23]/.test(s.view.frame), 5000);
  await shot(page, size, lang, 'game-dead');
  await unfreeze(page);
  await freezeWhen(page, (s) => s.view.alpha === 0 && s.sim.respawnRemaining > 1, 8000);
  await shot(page, size, lang, 'game-respawn-timer');
  const hud = await page.evaluate(() => window.__p0.hero.state().hud);
  if (!hud.portrait.dead || !hud.portrait.timer) problems.push(`${size.key} ${lang}: portrait not showing the respawn timer`);
  await unfreeze(page);
  await freezeWhen(page, (s) => s.view.respawns > 0 && s.view.alpha > 0.2 && s.view.alpha < 0.95, 20000);
  await shot(page, size, lang, 'game-respawn-fadein');
  await unfreeze(page);
  await ctx.close();
}

async function endShots(size, lang) {
  const { ctx, page } = await open(size, lang, 'level=l1c&hero=bran', 'levelup');
  await page.waitForFunction(() => !!window.__p0?.hero, null, { timeout: 90000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.__p0.skipToWave(3);
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__p0.forceEnd('won'));
  // The island's after-battle story opens over the board on a first win: skip it.
  await page.waitForSelector('[data-testid=story2d-skip]', { timeout: 8000 }).then((b) => b.click()).catch(() => undefined);
  await page.waitForTimeout(3600);
  await shot(page, size, lang, 'end-xp');
  const end = await page.evaluate(() => window.__p0.state().end);
  if (!end) problems.push(`${size.key} ${lang}: no end panel`);
  await ctx.close();
}

async function castShots(hero) {
  const size = ALL_SIZES[0];
  const { ctx, page } = await open(size, 'en', `level=l1c&hero=${hero}&herolevel=20&autoplay=1&speed=2`);
  await page.waitForFunction(() => !!window.__p0?.hero, null, { timeout: 90000 });
  await page.evaluate(() => window.__p0.hero.move(-1.5, 0.2));
  await page.waitForTimeout(14000);
  for (const slot of [0, 1]) {
    const ok = await page.evaluate((sl) => {
      const e = window.__p0.hero.nearestEnemy();
      const h = window.__p0.state().hero;
      return window.__p0.hero.cast(sl, e ? e.x : h.x + 1.8, e ? e.z : h.z + 0.4);
    }, slot);
    await page.waitForTimeout(260);
    await page.evaluate(() => window.__p0.freeze(true));
    await shot(page, size, 'en', `cast-${hero}-${slot}${ok ? '' : '-refused'}`);
    if (!ok) problems.push(`cast ${hero} ${slot}: refused by the sim (no target?)`);
    await unfreeze(page);
    await page.waitForTimeout(1500);
  }
  await ctx.close();
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    if (what === 'all' || what === 'map') await mapShots(size, lang);
    if (what === 'all' || what === 'select') await selectShots(size, lang);
    if (what === 'all' || what === 'tree') await treeShots(size, lang);
    if (what === 'all' || what === 'game') await gameShots(size, lang);
    if (what === 'all' || what === 'end') await endShots(size, lang);
  }
}
if (what === 'all' || what === 'casts') for (const h of ['bran', 'wren', 'mira', 'tobb', 'sela']) await castShots(h);
await browser.close();
console.log(problems.length ? `PROBLEMS:\n  ${problems.join('\n  ')}` : 'no problems');
