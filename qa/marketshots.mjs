// Market + item belt QA (task 2026-11-21 market-ui): the Market screen (desktop / phone, mobile
// crystal packs on via the dev-only ?iapqa mock and off), the briefing's belt row + picker, the HUD
// belt on l1c / i18 (desktop + phone), each item's FX mid-cast and the victory board's crystals.
// Runs against the vite DEV server (the ?iapqa mock and `import('/src/…')` save setup exist only
// there): python3 /tmp/mktui_dev.py 4417 node qa/marketshots.mjs [--only=market,brief,hud,fx,end,map]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4417';
const OUT = arg('out') ?? 'docs/feedback/2026-11-21/market';
const ONLY = (arg('only') ?? 'map,market,brief,hud,fx,end').split(',');
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const SIZES = { desk: { w: 1512, h: 982 }, hd: { w: 1920, h: 1080 }, phone: { w: 844, h: 390, touch: true } };
const log = (...a) => console.log(...a);
let fails = 0;
const fail = (m) => {
  fails++;
  log('FAIL', m);
};

/** A fresh context; `setup` runs in the page (dev modules) before the real navigation. */
async function open(size, query, setup) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, isMobile: !!size.touch, hasTouch: !!size.touch });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('pageerror', e.message));
  if (setup) {
    await page.goto(`${BASE}/2d.html?lang=${query.includes('lang=en') ? 'en' : 'tr'}&screen=none`);
    await page.waitForTimeout(1500);
    await page.evaluate(setup);
  }
  await page.goto(`${BASE}/2d.html?${query}`);
  return { ctx, page };
}

/** Rich wallet + loadout (dev modules): credits a QA pack, buys stock, sets the belt. */
const richSave = (loadout) => `(async () => {
  const m = await import('/src/render2d/ui/market2d.ts');
  m.deliverPacks2D([{ pack: 'crystals_large', transactionId: 'qa-' + Date.now() }]);
  for (const id of ['emberPot','frostLantern','heartstone','skyPurse','cloudguard','galeBell']) for (let i = 0; i < 4; i++) m.buyItem2D(id);
  m.setLoadout2D(${JSON.stringify(loadout)});
  localStorage.setItem('skyhold_market_seen_v1', '1');
})()`;

const shot = async (page, name, opts = {}) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 120000, ...opts });
  log('shot', name);
};

// --- world map button ------------------------------------------------------------------------------
if (ONLY.includes('map')) {
  for (const [k, s] of [['desk', SIZES.desk], ['phone', SIZES.phone]]) {
    const { ctx, page } = await open(s, 'lang=tr');
    await page.waitForSelector('[data-testid="map2d-market"]', { timeout: 90000 });
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => ({ count: document.querySelector('[data-testid="map2d-crystals"]')?.textContent, isNew: !!document.querySelector('[data-testid="map2d-market-new"]') }));
    log('map', k, JSON.stringify(info));
    if (!info.isNew) fail('map: no New badge on a fresh save');
    await shot(page, `map-button-new-${k}`, { clip: { x: s.w * 0.4, y: 0, width: s.w * 0.6, height: Math.min(s.h, 180) } });
    await ctx.close();
  }
}

// --- Market screen ------------------------------------------------------------------------------------
if (ONLY.includes('market')) {
  for (const [k, s] of Object.entries(SIZES)) {
    for (const iap of [false, true]) {
      for (const lang of k === 'desk' ? ['tr', 'en'] : ['tr']) {
        const { ctx, page } = await open(s, `lang=${lang}&screen=market${iap ? '&iapqa=1' : ''}`);
        await page.waitForSelector('[data-testid="market2d"]', { timeout: 90000 });
        await page.waitForTimeout(1600);
        const has = await page.evaluate(() => !!document.querySelector('[data-testid="market2d-packbox"]'));
        if (has !== iap) fail(`market ${k} iap=${iap}: packs section present=${has}`);
        const over = await page.evaluate(() => {
          const sh = document.querySelector('[data-testid="market2d"] .pu-sheet').getBoundingClientRect();
          return { sheet: [Math.round(sh.x), Math.round(sh.y), Math.round(sh.width), Math.round(sh.height)], fits: sh.bottom <= innerHeight + 1 && sh.right <= innerWidth + 1 && sh.x >= -1 && sh.y >= -1 };
        });
        if (!over.fits) fail(`market ${k}: sheet off screen ${over.sheet}`);
        const tag = `market-${k}-${s.w}x${s.h}-${lang}${iap ? '-iap' : ''}`;
        await shot(page, tag);
        if (iap) {
          await page.evaluate(() => document.querySelector('[data-testid="market2d-packbox"]').scrollIntoView({ block: 'end' }));
          await page.waitForTimeout(400);
          await page.click('[data-testid="market2d-pack-buy-crystals_medium"]');
          await page.waitForTimeout(120);
          await shot(page, `${tag}-pack-pending`);
          await page.waitForTimeout(900);
          const st = await page.evaluate(() => ({ status: document.querySelector('[data-testid="market2d-pack-status"]').textContent, crystals: document.querySelector('[data-testid="market2d-crystals"]').textContent }));
          log('pack', k, JSON.stringify(st));
          await shot(page, `${tag}-pack-done`);
        } else if (k === 'desk') {
          // Purchase feedback: Buy an Ember Pot (28 → 16), then the disabled state.
          await page.click('[data-testid="market2d-buy-emberPot"]');
          await page.waitForTimeout(260);
          await shot(page, `${tag}-bought`);
          await page.click('[data-testid="market2d-equip-skyPurse"]');
          await page.waitForTimeout(200);
          const belt = await page.evaluate(() => document.querySelector('[data-testid="market2d-belt"]').textContent);
          log('belt full note', belt);
          await shot(page, `${tag}-beltfull`);
        }
        await ctx.close();
      }
    }
  }
  // Pending delivery + error states (desktop).
  for (const mode of ['pending', 'cancel']) {
    const { ctx, page } = await open(SIZES.desk, `lang=tr&screen=market&iapqa=${mode}`);
    await page.waitForSelector('[data-testid="market2d-pack-buy-crystals_small"]', { timeout: 90000 });
    await page.evaluate(() => document.querySelector('[data-testid="market2d-packbox"]').scrollIntoView({ block: 'end' }));
    await page.click('[data-testid="market2d-pack-buy-crystals_small"]');
    await page.waitForTimeout(1200);
    await shot(page, `market-desk-iap-${mode}`);
    await ctx.close();
  }
}

// --- briefing belt row + picker ------------------------------------------------------------------
if (ONLY.includes('brief')) {
  for (const [k, s] of [['desk', SIZES.desk], ['phone', SIZES.phone]]) {
    const { ctx, page } = await open(s, 'lang=tr&screen=brief', richSave(['emberPot', 'heartstone', 'cloudguard']));
    await page.waitForSelector('[data-testid="brief2d-belt"]', { timeout: 90000 });
    await page.waitForTimeout(1200);
    const fit = await page.evaluate(() => {
      const sh = document.querySelector('[data-testid="brief2d"] .pu-sheet').getBoundingClientRect();
      const play = document.querySelector('[data-testid="brief2d-play"]').getBoundingClientRect();
      return { sheetBottom: Math.round(sh.bottom), playBottom: Math.round(play.bottom), h: innerHeight };
    });
    log('brief', k, JSON.stringify(fit));
    if (fit.playBottom > fit.h) fail(`brief ${k}: Play off screen`);
    await shot(page, `brief-belt-${k}`);
    await page.click('[data-testid="brief2d-diff-hard"]');
    await page.waitForTimeout(200);
    await shot(page, `brief-belt-${k}-hard`);
    await page.click('[data-testid="brief2d-belt-slot-0"]');
    await page.waitForSelector('[data-testid="beltpick2d"]');
    await page.waitForTimeout(500);
    await shot(page, `brief-beltpick-${k}`);
    await ctx.close();
  }
}

/** Starts a run with a loadout, calls the first wave and waits for foes on the field. */
async function run(size, level, loadout, extra = '') {
  const r = await open(size, `level=${level}&lang=tr&quality=high${extra}`, richSave(loadout));
  const { page } = r;
  await page.waitForFunction(() => !!window.__p0?.items?.(), null, { timeout: 90000 });
  await page.waitForTimeout(800);
  return r;
}

const callWave = async (page, steps = 60) => {
  await page.evaluate((n) => {
    window.__p0.replay.cmd({ k: 'wave' });
    window.__p0.replay.step(n);
  }, steps);
  await page.waitForTimeout(300);
};

// --- HUD belt --------------------------------------------------------------------------------------
if (ONLY.includes('hud')) {
  for (const level of ['l1c', 'i18']) {
    for (const [k, s] of [['desk', SIZES.desk], ['phone', SIZES.phone]]) {
      const { ctx, page } = await run(s, level, ['emberPot', 'frostLantern', 'heartstone']);
      const pre = await page.evaluate(() => window.__p0.items());
      await shot(page, `hud-belt-${level}-${k}-prewave`);
      await callWave(page, 40);
      const hc = await page.evaluate(() => window.__p0.hudCheck());
      const it = await page.evaluate(() => window.__p0.items());
      log('hud', level, k, 'mode', it.mode, 'slots', JSON.stringify(it.slots.map((q) => [q.id, q.state, q.uses, q.owned])), 'pre', JSON.stringify(pre.slots.map((q) => q.state)));
      log('  tray outside', hc.outside.tray, 'overlaps', JSON.stringify(hc.overlaps), 'clear', hc.fit.clear);
      if (hc.outside.tray > 1.5) fail(`hud ${level} ${k}: tray sticks out of its slot by ${hc.outside.tray}`);
      await shot(page, `hud-belt-${level}-${k}`);
      if (it.mode === 'pouch') {
        await page.click('[data-testid="item2d-pouch"]');
        await page.waitForTimeout(300);
        await shot(page, `hud-belt-${level}-${k}-pouch-open`);
      }
      if (k === 'desk') {
        const b = await page.locator('[data-testid="item2d-frostLantern"]').boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.waitForTimeout(300);
        await shot(page, `hud-belt-${level}-${k}-tooltip`);
      }
      await ctx.close();
    }
  }
  // Items off (challenge run): greyed with the reason.
  const { ctx, page } = await run(SIZES.desk, 'l1c', ['emberPot', 'frostLantern', 'heartstone'], '&challenge=bowless');
  const it = await page.evaluate(() => window.__p0.items());
  log('hud challenge', JSON.stringify(it.slots.map((q) => q.state)));
  const b = await page.locator('[data-testid="item2d-emberPot"]').boundingBox().catch(() => null);
  if (b) {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(300);
  }
  await shot(page, 'hud-belt-l1c-desk-challenge-off');
  await ctx.close();
}

// --- FX mid-cast ------------------------------------------------------------------------------------
if (ONLY.includes('fx')) {
  const S = SIZES.desk;
  const castAtFoe = async (page, id, name) => {
    const foe = await page.evaluate(() => {
      const e = window.__p0.hero.nearestEnemy();
      if (!e) return null;
      const p = window.__p0.hero.toScreen(e.x, e.z);
      return { x: p.x, y: p.y, h: 0 };
    });
    if (!foe) return fail(`fx ${id}: no foe on the field`);
    await page.evaluate((i) => window.__p0.itemPress(i), id);
    await page.mouse.move(foe.x, foe.y - foe.h * 0.3);
    await page.waitForTimeout(250);
    await shot(page, `fx-${name}-aim`);
    const ok = await page.evaluate(([x, y]) => window.__p0.itemCastAt(x, y), [foe.x, foe.y - foe.h * 0.3]);
    if (!ok) fail(`fx ${id}: cast refused`);
    await page.waitForTimeout(id === 'cloudguard' ? 700 : 300);
    await page.evaluate(() => window.__p0.freeze(true));
    await shot(page, `fx-${name}`);
    log('fx', id, JSON.stringify((await page.evaluate(() => window.__p0.items())).fx));
    await page.evaluate(() => window.__p0.freeze(false));
  };
  {
    const { ctx, page } = await run(S, 'l1c', ['emberPot', 'frostLantern', 'cloudguard']);
    await callWave(page, 160);
    await castAtFoe(page, 'frostLantern', 'frostLantern');
    await page.waitForTimeout(500);
    await castAtFoe(page, 'emberPot', 'emberPot');
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__p0.replay.step(40));
    await castAtFoe(page, 'cloudguard', 'cloudguard');
    await ctx.close();
  }
  {
    const { ctx, page } = await run(S, 'l1c', ['heartstone', 'skyPurse', 'galeBell']);
    await callWave(page, 40);
    // Let foes leak (no towers) so Heartstone has lives to restore.
    for (let i = 0; i < 12; i++) {
      const lv = await page.evaluate(() => {
        window.__p0.replay.step(50);
        return window.__p0.items().slots.find((q) => q.id === 'heartstone').state;
      });
      if (lv === 'ready') break;
    }
    for (const id of ['heartstone', 'skyPurse', 'galeBell']) {
      if (id === 'galeBell') {
        await page.evaluate(() => {
          window.__p0.replay.cmd({ k: 'wave' });
          window.__p0.replay.step(40);
        });
      }
      const ok = await page.evaluate((i) => {
        window.__p0.itemPress(i);
        return window.__p0.items().slots.find((q) => q.id === i).uses;
      }, id);
      await page.waitForTimeout(id === 'galeBell' ? 250 : 450);
      await page.evaluate(() => window.__p0.freeze(true));
      await shot(page, `fx-${id}`);
      const it = await page.evaluate(() => window.__p0.items());
      log('fx', id, 'uses after', ok, JSON.stringify(it.fx));
      await page.evaluate(() => window.__p0.freeze(false));
      await page.waitForTimeout(600);
    }
    await ctx.close();
  }
}

// --- victory board ----------------------------------------------------------------------------------
if (ONLY.includes('end')) {
  for (const [k, s] of [['desk', SIZES.desk], ['phone', SIZES.phone]]) {
    const { ctx, page } = await open(s, 'level=l1c&lang=tr&end=won&crystals=42');
    await page.waitForFunction(() => !!window.__p0?.state, null, { timeout: 90000 });
    await page.waitForTimeout(3500);
    const n = await page.evaluate(() => window.__p0.endCrystals?.() ?? -1);
    log('end crystals', k, n);
    if (n !== 42) fail(`end ${k}: crystals shown ${n}`);
    await shot(page, `end-victory-crystals-${k}`);
    await ctx.close();
  }
}

await browser.close();
log(fails ? `${fails} FAIL` : 'all ok');
process.exit(fails ? 1 : 0);
