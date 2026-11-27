// The five Omni-animated chapter-4/5 regular foes in the 2D zoo
// (`?zoo=1&types=rimebeetle,sledguard,duskhound,veilcaster,eclipse_shade&quality=high`), one Chromium,
// 1280x800: a shot with the foes walking on screen, then a lethal hit on one foe of each type (sim
// probe) and its death clip captured as cropped frames. Saves docs/omni-unit-shots/zoo-1280x800.jpg,
// deaths-1280x800.jpg and the crop frames under --frames (default /tmp/omniunit-qa) for
// qa/omniunitgif.py; prints the death-clip counters and the art check.
// Run: python3 qa/withPreview.py --port=4474 node qa/omniunits.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const BASE = arg('base') ?? 'http://127.0.0.1:4474';
const OUT = 'docs/omni-unit-shots';
const FRAMES = arg('frames') ?? '/tmp/omniunit-qa';
const TYPES = ['rimebeetle', 'sledguard', 'duskhound', 'veilcaster', 'eclipse_shade'];
const TAG = { rimebeetle: 'rb', sledguard: 'sg', duskhound: 'dh', veilcaster: 'vc', eclipse_shade: 'es5' };
mkdirSync(OUT, { recursive: true });
mkdirSync(FRAMES, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const problems = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console ${m.text().slice(0, 160)}`);
  });
  await page.goto(`${BASE}/2d.html?zoo=1&types=${TYPES.join(',')}&lang=en&quality=high`);
  await page.waitForFunction(() => !!window.__p0?.state && !!window.__p0?.replay?.probe, null, { timeout: 90_000 });
  // Sim probe: remember each type's foremost on-stage ground position (one uid per type); deal a
  // lethal hit to the tracked foe of the type in `kill`.
  await page.evaluate((types) => {
    const ob = { pos: {}, uid: {}, kill: null, killed: {} };
    window.__ou = ob;
    window.__p0.replay.probe((world) => {
      const pool = world.enemyPool;
      const alive = {};
      const first = {};
      for (let i = 0; i < pool.getActiveCount(); i++) {
        const e = pool.items[pool.getActiveIndex(i)];
        if (!e.active || !types.includes(e.type)) continue;
        if (e.uid === ob.uid[e.type]) alive[e.type] = true;
        first[e.type] ??= e.uid;
      }
      // keep following the same foe; when it is gone, follow another of its type
      for (const t of types) if (!alive[t]) { ob.uid[t] = first[t]; delete ob.pos[t]; }
      for (let i = 0; i < pool.getActiveCount(); i++) {
        const e = pool.items[pool.getActiveIndex(i)];
        if (!e.active || e.uid !== ob.uid[e.type]) continue;
        ob.pos[e.type] = { x: e.x, z: e.z };
        if (ob.kill === e.type) {
          ob.killed[e.type] = { x: e.x, z: e.z };
          world.enemySystem.applyDamage(e, 1e9, true);
          ob.kill = null;
        }
      }
    });
  }, TYPES);
  const screenOf = (type, which = 'pos') =>
    page.evaluate(([t, w]) => {
      const p = window.__ou[w][t];
      return p ? window.__p0.hero.toScreen(p.x, p.z) : null;
    }, [type, which]);
  const counters = () =>
    page.evaluate(() => {
      const s = window.__p0.state();
      return { deathClips: s.fx?.deathClips, foes: s.foes };
    });
  const onStage = (p) => p && p.x > 120 && p.x < 1160 && p.y > 190 && p.y < 740;

  // 1) as many of the five on screen as possible (best over ~60 s)
  let best = -1;
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000 && best < TYPES.length) {
    const pts = await Promise.all(TYPES.map((t) => screenOf(t)));
    const n = pts.filter(onStage).length;
    if (n > best) {
      best = n;
      await page.screenshot({ path: `${OUT}/zoo-1280x800.jpg`, type: 'jpeg', quality: 82 });
      console.log('zoo', n, JSON.stringify(Object.fromEntries(TYPES.map((t, i) => [t, pts[i] && { x: Math.round(pts[i].x), y: Math.round(pts[i].y) }]))));
    }
    await page.waitForTimeout(400);
  }
  if (best < 3) problems.push(`only ${best} of the five on stage together`);

  // 2) per type: wait until the tracked foe is on stage, lethal hit, crop frames around where it fell
  let fullDone = false;
  for (const type of TYPES) {
    const tag = TAG[type];
    const tw = Date.now();
    while (Date.now() - tw < 40_000 && !onStage(await screenOf(type))) await page.waitForTimeout(250);
    if (!onStage(await screenOf(type))) {
      problems.push(`${type}: never on stage for the death shot`);
      continue;
    }
    const before = await counters();
    await page.evaluate((t) => { window.__ou.kill = t; }, type);
    await page.waitForFunction((t) => !!window.__ou.killed[t], type, { timeout: 20_000 }).catch(() => problems.push(`${type}: probe never hit it`));
    const at = await screenOf(type, 'killed');
    if (!at) continue;
    const w = 240, h = 200;
    const clip = { x: Math.max(0, Math.min(1280 - w, at.x - w / 2)), y: Math.max(0, Math.min(800 - h, at.y - 150)), width: w, height: h };
    const tk = Date.now();
    let n = 0;
    while (Date.now() - tk < 2400) {
      const ms = Date.now() - tk;
      await page.screenshot({ path: `${FRAMES}/${tag}-${String(n).padStart(2, '0')}-${ms}.png`, clip });
      n++;
      if (!fullDone && type === 'sledguard' && ms > 600) {
        await page.screenshot({ path: `${OUT}/deaths-1280x800.jpg`, type: 'jpeg', quality: 82 });
        fullDone = true;
      }
    }
    const after = await counters();
    console.log(tag, JSON.stringify({ at, frames: n, deathClips: [before.deathClips, after.deathClips] }));
    if (!(after.deathClips > before.deathClips)) problems.push(`${type}: no death clip started`);
  }
  const art = await page.evaluate(() => String(window.__p0.artcheck?.() ?? ''));
  for (const line of art.split('\n')) if (TYPES.some((t) => line.includes(t))) console.log('art', line.trim());
} finally {
  await browser.close();
}
console.log(problems.length ? `PROBLEMS\n${problems.join('\n')}` : 'OK');
process.exit(problems.length ? 1 : 0);
