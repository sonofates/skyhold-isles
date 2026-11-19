// HUD dock play-check against `vite preview`: every HUD piece as really drawn (canvas HUD, DOM
// buttons + captions, hero / ability tray, next-wave card, foe card) vs the island's roads (with
// their width), plot circles and cave / castle rects under the live map fit (`__p0.hudCheck()`).
//   --part=check  all 25 islands at 1920x1080, 2560x1080, 1366x768, 1600x900 (desktop) and 844x390,
//                 932x430 (phone, touch, DPR 2): at the start (next-wave card up), then in wave 2 with
//                 a foe tapped (foe card up). Exits 1 on any overlap or a piece outside its slot.
//   --part=shots  i24 boss wave, i12, l1c, i16 at 1920x1080 and 844x390 into docs/hud-shots/.
// Usage: python3 qa/withPreview.py node qa/hudplace.mjs --part=check [--ids=l1c,i24] [--sizes=1920x1080]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'docs/hud-shots';
const PART = arg('part') ?? 'check';
const ALL = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const IDS = (arg('ids') ?? ALL.join(',')).split(',');
const SIZES = [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1, desktop: 1 },
  { key: '2560x1080', w: 2560, h: 1080, dpr: 1, desktop: 1 },
  { key: '1366x768', w: 1366, h: 768, dpr: 1, desktop: 1 },
  { key: '1600x900', w: 1600, h: 900, dpr: 1, desktop: 1 },
  { key: '844x390', w: 844, h: 390, dpr: 2, desktop: 0, touch: true },
  { key: '932x430', w: 932, h: 430, dpr: 2, desktop: 0, touch: true },
].filter((s) => !arg('sizes') || arg('sizes').split(',').includes(s.key));
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const problems = [];
const report = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

async function context(size) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('skyhold2d_coach_v1', 'done');
    } catch {
      // ignore
    }
  });
  return ctx;
}

async function load(page, id, size, extra = '') {
  await page.goto(`${BASE}/2d.html?level=${id}&hero=bran&lang=en&desktop=${size.desktop}${extra}`);
  await page.waitForFunction(() => window.__p0?.hudCheck && !document.getElementById('boot'), null, { timeout: 90000 });
  await sleep(600);
}

function judge(tag, c) {
  const bad = [];
  for (const o of c.overlaps) bad.push(`${o.piece} over ${o.kind}#${o.index} (${o.depth})`);
  for (const [p, d] of Object.entries(c.outside)) if (d > 1.5) bad.push(`${p} ${d}px outside its slot`);
  if (bad.length) problems.push(`${tag}: ${bad.join('; ')}`);
  return bad.length;
}

async function check() {
  const rows = [];
  for (const size of SIZES) {
    const ctx = await context(size);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${size.key}: pageerror ${e.message}`));
    for (const id of IDS) {
      const tag = `${size.key} ${id}`;
      try {
        await load(page, id, size);
        await page.waitForFunction(() => window.__p0.waveCard()?.shown, null, { timeout: 8000 }).catch(() => undefined);
        const a = await page.evaluate(() => window.__p0.hudCheck());
        const wave = await page.evaluate(() => window.__p0.waveCard());
        if (!wave?.shown) problems.push(`${tag}: next-wave card not shown at the start`);
        judge(`${tag} start`, a);
        // Wave 2 walking: tap a foe, the foe card takes the info slot.
        await page.evaluate(() => {
          window.__p0.replay.cmd({ k: 'wave' });
          window.__p0.replay.step(50);
        });
        await page.evaluate(() => window.__p0.freeze(true));
        const at = await page.evaluate(() => window.__p0.foeAt());
        let foe = null;
        if (at) {
          await page.evaluate(([x, y]) => window.__p0.hero.tap(x, y), [at.x, at.y]);
          await page.evaluate(() => window.__p0.freeze(false));
          await page.waitForFunction(() => window.__p0.foe()?.shown, null, { timeout: 5000 }).catch(() => undefined);
          await page.evaluate(() => window.__p0.freeze(true));
          foe = await page.evaluate(() => window.__p0.foe());
        }
        const b = await page.evaluate(() => window.__p0.hudCheck());
        await page.evaluate(() => window.__p0.freeze(false));
        if (!foe?.shown) report.push(`${tag}: (no foe card: ${at ? 'tap missed' : 'no foe on screen'})`);
        judge(`${tag} wave`, b);
        const pieces = Object.keys(b.pieces).length;
        rows.push(`${tag.padEnd(16)} ${a.form.padEnd(7)} scale ${String(Math.round(a.fit.shrink * 100)).padStart(3)}%  pieces ${Object.keys(a.pieces).length}/${pieces}  overlaps ${a.overlaps.length + b.overlaps.length}  wave-card ${wave?.shown ? `k=${wave.scale.toFixed(2)}` : '-'}  foe-card ${foe?.shown ? `k=${foe.scale.toFixed(2)}` : '-'}`);
      } catch (e) {
        problems.push(`${tag}: ${e.message}`);
      }
    }
    await ctx.close();
  }
  report.push(...rows);
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 84 });
  const c = await page.evaluate(() => window.__p0.hudCheck());
  judge(name, c);
  report.push(`${name}: ${c.form} scale ${Math.round(c.fit.shrink * 100)}% overlaps ${c.overlaps.length}`);
}

async function shots() {
  for (const size of SIZES.filter((s) => s.key === '1920x1080' || s.key === '844x390')) {
    const k = size.touch ? 'phone' : 'desk';
    const ctx = await context(size);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${k}: pageerror ${e.message}`));
    try {
      for (const id of ['i12', 'l1c', 'i16']) {
        await load(page, id, size, '&autoplay=1&speed=3');
        await page.waitForFunction(() => window.__p0.waveCard()?.shown, null, { timeout: 8000 }).catch(() => undefined);
        await shot(page, `${id}-${k}-start`);
        // Mid-battle with foes on the roads, a foe card open.
        const t0 = Date.now();
        while (Date.now() - t0 < 60000) {
          await sleep(1000);
          const s = await page.evaluate(() => window.__p0.state());
          if (s.wave >= 3 && s.enemies >= 6) break;
        }
        await page.evaluate(() => window.__p0.freeze(true));
        const at = await page.evaluate(() => window.__p0.foeAt());
        if (at) {
          await page.evaluate(([x, y]) => window.__p0.hero.tap(x, y), [at.x, at.y]);
          await page.evaluate(() => window.__p0.freeze(false));
          await page.waitForFunction(() => window.__p0.foe()?.shown, null, { timeout: 4000 }).catch(() => undefined);
          await page.evaluate(() => window.__p0.freeze(true));
        }
        await shot(page, `${id}-${k}-battle`);
        await page.evaluate(() => window.__p0.freeze(false));
      }
      // i24: skip to the boss wave and let the Colossus walk the north road.
      await load(page, 'i24', size, '&autoplay=1&speed=3');
      const label = await page.evaluate(() => window.__p0.hudWave());
      const last = Number(/(\d+)\s*\/\s*(\d+)/.exec(label)?.[2] ?? 14);
      await page.evaluate((n) => {
        window.__p0.skipToWave(n);
        window.__p0.setLives?.(200);
      }, last);
      const t0 = Date.now();
      let shotSpawn = false;
      while (Date.now() - t0 < 240000) {
        await sleep(700);
        const s = await page.evaluate(() => window.__p0.state());
        const b = (s.bosses ?? [])[0];
        if (b && !shotSpawn) {
          await sleep(4000);
          await shot(page, `i24-${k}-boss`);
          shotSpawn = true;
        }
        if (b && b.phase >= 1) {
          await shot(page, `i24-${k}-boss-stormwall`);
          break;
        }
        if (s.outcome !== 'ongoing') break;
      }
      if (!shotSpawn) problems.push(`${k} i24: no boss seen`);
    } catch (e) {
      problems.push(`${k}: ${e.message}`);
    }
    await ctx.close();
  }
}

if (PART === 'check') await check();
else await shots();
await browser.close();
writeFileSync(`${OUT}/report-${PART}.txt`, [...report, '', `problems: ${problems.length}`, ...problems].join('\n') + '\n');
console.log(report.join('\n'));
console.log(`problems: ${problems.length}`);
for (const p of problems) console.log(`  ${p}`);
process.exit(problems.length ? 1 : 0);
