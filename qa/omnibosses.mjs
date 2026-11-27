// The two Omni-animated bosses in the 2D zoo (`?zoo=1&types=glacier_warden,eclipse_sovereign`), one
// Chromium, 1280x800: a shot with both bosses walking on screen, then a lethal hit on each (sim probe)
// and the death clip captured as cropped frames: the Glacier Warden crumbles, the Eclipse Sovereign
// (which never dies, it splits) plays its clip as the split. Saves docs/omni-boss-shots/zoo-1280x800.jpg,
// gw-death-1280x800.jpg, es-split-1280x800.jpg and the crop frames under --frames (default
// /tmp/omniboss-qa) for qa/omnibossgif.py; prints the death-clip counters and the art check.
// Run: python3 qa/withPreview.py --port=4473 node qa/omnibosses.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const BASE = arg('base') ?? 'http://127.0.0.1:4473';
const OUT = 'docs/omni-boss-shots';
const FRAMES = arg('frames') ?? '/tmp/omniboss-qa';
const TYPES = ['glacier_warden', 'eclipse_sovereign'];
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
  // Sim probe: remember each boss's ground position; deal a lethal hit to the type in `kill`.
  await page.evaluate(() => {
    const ob = { pos: {}, kill: null, killed: {} };
    window.__ob = ob;
    window.__p0.replay.probe((world) => {
      const pool = world.enemyPool;
      for (let i = 0; i < pool.getActiveCount(); i++) {
        const e = pool.items[pool.getActiveIndex(i)];
        if (!e.active || !(e.type === 'glacier_warden' || e.type === 'eclipse_sovereign')) continue;
        ob.pos[e.type] = { x: e.x, z: e.z };
        if (ob.kill === e.type) {
          ob.killed[e.type] = { x: e.x, z: e.z };
          world.enemySystem.applyDamage(e, 1e9, true);
          ob.kill = null;
        }
      }
    });
  });
  const screenOf = (type, which = 'pos') =>
    page.evaluate(([t, w]) => {
      const p = window.__ob[w][t];
      return p ? window.__p0.hero.toScreen(p.x, p.z) : null;
    }, [type, which]);
  const counters = () =>
    page.evaluate(() => {
      const s = window.__p0.state();
      return { deathClips: s.fx?.deathClips, split: s.fx?.events?.sovereignSplit, foes: s.foes, bosses: s.bosses };
    });
  const onStage = (p) => p && p.x > 120 && p.x < 1160 && p.y > 190 && p.y < 740;

  // 1) both bosses walking on screen (before the Warden's 22 s phase / the 27 s eclipse when possible)
  let shot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 120_000) {
    const [a, b] = [await screenOf(TYPES[0]), await screenOf(TYPES[1])];
    if (onStage(a) && onStage(b)) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/zoo-1280x800.jpg`, type: 'jpeg', quality: 82 });
      console.log('zoo', JSON.stringify({ gw: a, es: b, ...(await counters()) }));
      shot = true;
      break;
    }
    await page.waitForTimeout(250);
  }
  if (!shot) {
    await page.screenshot({ path: `${OUT}/zoo-1280x800.jpg`, type: 'jpeg', quality: 82 });
    problems.push(`both bosses never on stage together: ${JSON.stringify(await counters())}`);
  }

  // 2) lethal hit, then crop frames of the clip around the spot where it fell
  for (const [type, tag, full] of [['glacier_warden', 'gw', 'gw-death'], ['eclipse_sovereign', 'es', 'es-split']]) {
    const before = await counters();
    await page.evaluate((t) => { window.__ob.kill = t; }, type);
    await page.waitForFunction((t) => !!window.__ob.killed[t], type, { timeout: 20_000 }).catch(() => problems.push(`${type}: probe never hit it`));
    const at = await screenOf(type, 'killed');
    if (!at) continue;
    const w = 340, h = 280;
    const clip = { x: Math.max(0, Math.min(1280 - w, at.x - w / 2)), y: Math.max(0, Math.min(800 - h, at.y - 230)), width: w, height: h };
    const tk = Date.now();
    let n = 0;
    let fullDone = false;
    while (Date.now() - tk < 3200) {
      const ms = Date.now() - tk;
      await page.screenshot({ path: `${FRAMES}/${tag}-${String(n).padStart(2, '0')}-${ms}.png`, clip });
      n++;
      if (!fullDone && ms > (type === 'glacier_warden' ? 1300 : 900)) {
        await page.screenshot({ path: `${OUT}/${full}-1280x800.jpg`, type: 'jpeg', quality: 82 });
        fullDone = true;
      }
    }
    const after = await counters();
    console.log(tag, JSON.stringify({ at, frames: n, deathClips: [before.deathClips, after.deathClips], split: [before.split, after.split] }));
    if (!(after.deathClips > before.deathClips)) problems.push(`${type}: no death clip started`);
  }
  const art = await page.evaluate(() => String(window.__p0.artcheck?.() ?? ''));
  for (const line of art.split('\n')) if (/glacier_warden|eclipse_sovereign/.test(line)) console.log('art', line.trim());
} finally {
  await browser.close();
}
console.log(problems.length ? `PROBLEMS\n${problems.join('\n')}` : 'OK');
process.exit(problems.length ? 1 : 0);
