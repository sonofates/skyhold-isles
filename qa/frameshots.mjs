// Letterbox frame shots against `vite preview`: what fills the bands around the fitted map (the
// map blurred + graded behind it, shadow, vignette, painted border — see src/render2d/mapFrame.ts).
// l1c, i06, i12, i16 mid-battle and i24 on its boss wave, at 1920x1080, 2560x1080, 1366x768 and the
// 844x390 phone; plus one `?quality=low` shot. Every shot also runs `__p0.hudCheck()` (0 overlaps).
// Usage: python3 qa/withPreview.py --port=4391 node qa/frameshots.mjs [--ids=l1c,i24] [--sizes=1920x1080]
//        [--quick=1 --ids=<all 25> --out=/tmp/x]   all-biome sweep, one shot per island at load
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'docs/frame-shots';
const IDS = (arg('ids') ?? 'l1c,i06,i12,i16,i24').split(',');
const SIZES = [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1, desktop: 1 },
  { key: '2560x1080', w: 2560, h: 1080, dpr: 1, desktop: 1 },
  { key: '1366x768', w: 1366, h: 768, dpr: 1, desktop: 1 },
  { key: '844x390', w: 844, h: 390, dpr: 2, desktop: 0, touch: true },
].filter((s) => !arg('sizes') || arg('sizes').split(',').includes(s.key));
const LOW = arg('low') !== '0';
// --quick=1: one shot right after load per island (no battle / boss wait) — the all-biome sweep.
const QUICK = arg('quick') === '1';
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
  await page.goto(`${BASE}/2d.html?level=${id}&hero=bran&lang=en&desktop=${size.desktop}&autoplay=1&speed=3${extra}`);
  await page.waitForFunction(() => window.__p0?.hudCheck && !document.getElementById('boot'), null, { timeout: 90000 });
  await sleep(600);
}

async function shot(page, name, wantTier) {
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 86 });
  const c = await page.evaluate(() => window.__p0.hudCheck());
  const f = await page.evaluate(() => window.__p0.mapFrame());
  const bad = [];
  for (const o of c.overlaps) bad.push(`${o.piece} over ${o.kind}#${o.index} (${o.depth})`);
  for (const [p, d] of Object.entries(c.outside)) if (d > 1.5) bad.push(`${p} ${d}px outside its slot`);
  const open = f.bands.some((b) => b > 0.5);
  if (open && f.backdrop !== 'blur') bad.push(`bands open but backdrop ${f.backdrop}`);
  if (open && !f.border) bad.push('bands open but no border');
  if (wantTier === 'low' && (f.shadow || f.vignette)) bad.push('low tier still draws shadow / vignette');
  if (bad.length) problems.push(`${name}: ${bad.join('; ')}`);
  const bands = f.bands.map((b) => Math.round(b)).join('/');
  report.push(`${name.padEnd(26)} ${c.form.padEnd(7)} scale ${String(Math.round(c.fit.shrink * 100)).padStart(3)}%  bands L/T/R/B ${bands.padEnd(16)} frame ${f.backdrop}${f.shadow ? '+shadow' : ''}${f.vignette ? '+vignette' : ''}${f.border ? '+border' : ''} (${f.tier}, backdrop ${f.backdropMs ?? '?'} ms)  overlaps ${c.overlaps.length}`);
}

async function battle(page) {
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    await sleep(1000);
    const s = await page.evaluate(() => window.__p0.state());
    if (s.wave >= 2 && s.enemies >= 5) break;
  }
}

async function boss(page) {
  const label = await page.evaluate(() => window.__p0.hudWave());
  const last = Number(/(\d+)\s*\/\s*(\d+)/.exec(label)?.[2] ?? 14);
  await page.evaluate((n) => {
    window.__p0.skipToWave(n);
    window.__p0.setLives?.(200);
  }, last);
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    await sleep(700);
    const s = await page.evaluate(() => window.__p0.state());
    if ((s.bosses ?? [])[0]) {
      await sleep(4000);
      return true;
    }
    if (s.outcome !== 'ongoing') break;
  }
  return false;
}

for (const size of SIZES) {
  const k = size.key;
  const ctx = await context(size);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${k}: pageerror ${e.message}`));
  for (const id of IDS) {
    try {
      await load(page, id, size, '&quality=high');
      if (QUICK) {
        await shot(page, `${id}-${k}`);
      } else if (id === 'i24') {
        if (!(await boss(page))) problems.push(`${k} i24: no boss seen`);
        await shot(page, `${id}-${k}-boss`);
      } else {
        await battle(page);
        await shot(page, `${id}-${k}`);
      }
    } catch (e) {
      problems.push(`${k} ${id}: ${e.message}`);
    }
  }
  await ctx.close();
}

if (LOW) {
  const size = SIZES.find((s) => s.key === '844x390') ?? SIZES[0];
  const ctx = await context(size);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`low: pageerror ${e.message}`));
  try {
    await load(page, IDS.includes('i24') ? 'i24' : IDS[0], size, '&quality=low');
    await battle(page);
    await shot(page, `low-${IDS.includes('i24') ? 'i24' : IDS[0]}-${size.key}`, 'low');
  } catch (e) {
    problems.push(`low: ${e.message}`);
  }
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/report.txt`, [...report, '', `problems: ${problems.length}`, ...problems].join('\n') + '\n');
console.log(report.join('\n'));
console.log(`problems: ${problems.length}`);
for (const p of problems) console.log(`  ${p}`);
process.exit(problems.length ? 1 : 0);
