// Ability / hero bar placement sweep against `vite preview` (default http://127.0.0.1:4381): every
// island (l1c, i01…i24; missing ones skipped) at 1920x1080, 2560x1080, 1366x768 and 844x390, with
// a hero (the bar is longest then). Prints each spot (score 0 = clear, vertical, button size) and
// checks the bar's box against plots (+ tower room), the castle / caves, the HUD; writes one JPEG
// per island/size to /tmp/barshots (contact sheets are built by qa/contact.py).
// Usage: node qa/barshots.mjs [--ids=l1c,i12] [--size=1920x1080,...] [--out=/tmp/barshots]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? '/tmp/barshots';
const IDS = (arg('ids') ?? ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)].join(',')).split(',');
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const ALL = [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1, desktop: true },
  { key: '2560x1080', w: 2560, h: 1080, dpr: 1, desktop: true },
  { key: '1366x768', w: 1366, h: 768, dpr: 1, desktop: true },
  { key: '844x390', w: 844, h: 390, dpr: 2, touch: true },
];
const SIZES = ALL.filter((s) => !arg('size') || arg('size').split(',').includes(s.key));
const problems = [];
const rows = [];
for (const size of SIZES) {
  for (const id of IDS) {
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${size.key} ${id}: pageerror ${e.message}`));
    await page.goto(`${BASE}/2d.html?level=${id}&hero=bran&lang=en&desktop=${size.desktop ? 1 : 0}`);
    const ok = await page
      .waitForFunction(() => (window.__p0?.abilities && !document.getElementById('boot')) || /nknown/.test(document.getElementById('boot')?.textContent ?? ''), null, { timeout: 60000 })
      .then(() => page.evaluate(() => !!window.__p0?.abilities))
      .catch(() => false);
    if (!ok) {
      await ctx.close();
      continue;
    }
    await page.waitForTimeout(700);
    const a = await page.evaluate(() => window.__p0.abilities());
    const spot = a.spot ?? {};
    rows.push({ size: size.key, id, score: spot.score, vertical: spot.vertical, d: a.d ?? a.size ?? null, box: a.box });
    console.log(`${size.key} ${id}: score ${spot.score} ${spot.layout} d=${a.d ?? '?'} box=${JSON.stringify(a.box)}`);
    if (spot.score >= 1000) problems.push(`${size.key} ${id}: bar covers a plot / castle / HUD (score ${spot.score})`);
    await page.screenshot({ path: `${OUT}/${size.key}-${id}.jpg`, type: 'jpeg', quality: 70 });
    await ctx.close();
  }
}
await browser.close();
const vert = rows.filter((r) => r.vertical).map((r) => `${r.size} ${r.id}`);
console.log(`vertical: ${vert.length ? vert.join(', ') : 'none'}`);
if (problems.length) {
  console.log(`PROBLEMS (${problems.length}):\n  ` + problems.join('\n  '));
  process.exitCode = 1;
} else console.log('no problems');
