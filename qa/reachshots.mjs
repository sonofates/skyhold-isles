// Plot reach QA (2026-11-21): can a plot hidden under the HUD be panned clear and tapped?
// Per case: the default view, then the pan pushed to each edge / corner (wheel); at each spot the
// hudCheck overlaps of the target plot, the map bands (> 0 = past the painting) and a tap on the
// plot (does the build ring open on it?). Shots of the default view and the best spot.
// Usage: node qa/reachshots.mjs --out=docs/anim-shots/reach/after [--base=...] [--cases=i16@844x390#14,...]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4317';
const OUT = arg('out') ?? 'docs/anim-shots/reach/after';
const CASES = (arg('cases') ?? 'i16@844x390#14,i09@844x390#19,i03@844x390#6,i18@844x390#15,i13@800x600#8,i16@1280x720#11').split(',').map((c) => {
  const [id, rest] = c.split('@');
  const [size, plot] = rest.split('#');
  const [w, h] = size.split('x').map(Number);
  return { id, w, h, plot: Number(plot), key: `${id}-${size}-p${plot}` };
});
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const SPOTS = [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];

for (const c of CASES) {
  const touch = c.h < 500;
  const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${BASE}/2d.html?level=${c.id}&lang=en&quality=high`);
  await page.waitForFunction(() => !!window.__p0?.state, null, { timeout: 90000 });
  await page.waitForTimeout(900);
  const results = [];
  for (const [sx, sy] of SPOTS) {
    // Back to the default view, then push the pan to this edge / corner.
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(250);
    await page.mouse.move(c.w / 2, c.h / 2);
    for (let i = 0; i < 6 && (sx || sy); i++) await page.mouse.wheel(sx * 400, sy * 400);
    await page.waitForTimeout(350);
    const info = await page.evaluate((plot) => {
      const p = window.__p0;
      const st = p.state();
      const hc = p.hudCheck();
      const ring = st.plots.rings[plot];
      const f = st.fit;
      const tap = ring ? { x: f.offsetX + ring.cx * f.scale, y: f.offsetY + (ring.bottom - ring.width * 0.33) * f.scale } : null;
      return { pan: st.pan, bands: p.mapFrame().bands.map((b) => Math.round(b)), frame: p.mapFrame(), over: hc.overlaps.filter((o) => o.kind === 'plot' && o.index === plot).map((o) => o.piece), tap };
    }, c.plot);
    let opened = false;
    // Tap only a plot no piece covers (a covered one would press the HUD button over it).
    if (info.over.length === 0 && info.tap && info.tap.x > 0 && info.tap.y > 0 && info.tap.x < c.w && info.tap.y < c.h) {
      await page.mouse.click(info.tap.x, info.tap.y);
      await page.waitForTimeout(250);
      opened = await page.evaluate((plot) => {
        const r = window.__p0.state().ring;
        return r.open && r.plot === plot;
      }, c.plot);
      // Escape closes the ring; with no ring open it would pause the game instead.
      if (opened) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
      }
    }
    results.push({ spot: `${sx},${sy}`, ...info, opened });
    if (sx === 0 && sy === 0) await page.screenshot({ path: `${OUT}/${c.key}-default.jpg`, type: 'jpeg', quality: 82 });
  }
  const best = results.find((r) => r.opened && r.over.length === 0) ?? results.find((r) => r.over.length === 0) ?? null;
  for (const r of results) {
    console.log(`${c.key} spot=${r.spot} pan=${r.pan.x},${r.pan.y} range=${JSON.stringify(r.pan.range)} bands=${r.bands.join('/')} backdrop=${r.frame.backdrop} border=${r.frame.border} covered=${r.over.join('+') || 'none'} tapOpens=${r.opened}`);
  }
  console.log(`${c.key} => ${best ? `REACHABLE at ${best.spot} (tap opens ring: ${best.opened})` : 'UNREACHABLE'}`);
  if (best) {
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(250);
    const [sx, sy] = best.spot.split(',').map(Number);
    for (let i = 0; i < 6 && (sx || sy); i++) await page.mouse.wheel(sx * 400, sy * 400);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${c.key}-best.jpg`, type: 'jpeg', quality: 82 });
  }
  await ctx.close();
}
await browser.close();
