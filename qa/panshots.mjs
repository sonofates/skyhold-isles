// MacBook layout + map pan QA (owner report 2026-11-21): play screens of l1c, i10 and a chapter-two
// island at the owner's window and the usual laptop / desktop / phone sizes, with the HUD text
// sizes, the info card's box, the map's bands and hudCheck overlaps printed per shot.
// Usage: node qa/panshots.mjs [--out=docs/feedback/2026-11-21/after] [--base=...] [--ids=l1c,i10,i14]
//        [--sizes=2000x1150,...] [--lang=tr] [--pan] (also: the drag-pans / tap-builds check)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4317';
const OUT = arg('out') ?? 'docs/feedback/2026-11-21/after';
const IDS = (arg('ids') ?? 'l1c,i10,i14').split(',');
const LANG = arg('lang') ?? 'tr';
const SIZES = (arg('sizes') ?? '2000x1150,1440x900,1512x982,1920x1080,2560x1080,1366x768,844x390,1024x768').split(',').map((s) => {
  const [w, h] = s.split('x').map(Number);
  return { key: s, w, h, touch: h < 500 };
});
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });

async function open(s, query) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, isMobile: !!s.touch, hasTouch: !!s.touch });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${BASE}/2d.html?${query}`);
  await page.waitForFunction(() => !!window.__p0?.state, null, { timeout: 90000 });
  await page.waitForTimeout(900);
  return { ctx, page };
}

const r0 = (r) => (r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}` : '-');
let fails = 0;
for (const id of IDS) {
  for (const s of SIZES) {
    const { ctx, page } = await open(s, `level=${id}&lang=${LANG}&quality=high`);
    const info = await page.evaluate(() => {
      const p = window.__p0;
      const st = p.state();
      const hc = p.hudCheck();
      const card = document.querySelector('[data-testid="wave2d-card"]');
      const cb = card && !card.hidden ? card.getBoundingClientRect() : null;
      return {
        fit: st.fit,
        frame: p.mapFrame(),
        texts: p.textAudit(),
        wave: st.hud.waveText,
        lives: st.hud.lives,
        gold: st.hud.gold,
        overlaps: hc.overlaps,
        outside: Object.entries(hc.outside).filter(([, v]) => v > 1),
        card: cb ? { x: cb.x, y: cb.y, w: cb.width, h: cb.height } : null,
        pan: st.pan ?? null,
      };
    });
    const bands = info.frame.bands.map((b) => Math.round(b));
    const bad = info.overlaps.length > 0 || info.wave.h < 12 || bands.some((b) => b > 0);
    if (bad) fails++;
    console.log(
      `${id} ${s.key}: scale=${info.fit.scale.toFixed(3)} off=${Math.round(info.fit.offsetX)},${Math.round(info.fit.offsetY)} bands=${bands.join('/')} ` +
        `waveText=${r0(info.wave)} lives=${r0(info.lives)} gold=${r0(info.gold)} card=${r0(info.card)} ` +
        `overlaps=${info.overlaps.map((o) => `${o.piece}:${o.kind}#${o.index}`).join(',') || 'none'} outside=${JSON.stringify(info.outside)} texts=${info.texts.length}` +
        (info.pan ? ` pan=${JSON.stringify(info.pan)}` : '') + (bad ? '  <-- CHECK' : ''),
    );
    await page.screenshot({ path: `${OUT}/${id}-${s.key}.jpg`, type: 'jpeg', quality: 80 });
    await ctx.close();
  }
}

if (process.argv.includes('--pan')) {
  // A drag on empty ground pans the map (the HUD stays), and a plain tap on a free plot still opens the build ring.
  const s = { key: '1512x982', w: 1512, h: 982 };
  const { ctx, page } = await open(s, `level=l1c&lang=en&quality=high`);
  const before = await page.evaluate(() => window.__p0.state().fit);
  const hudBefore = await page.evaluate(() => window.__p0.state().hud.plaque);
  // Drag from the screen centre-ish (empty ground or not, a drag never taps).
  await page.mouse.move(756, 500);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(756 - i * 6, 500 - i * 4);
  await page.mouse.up();
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => window.__p0.state().fit);
  const hudAfter = await page.evaluate(() => window.__p0.state().hud.plaque);
  const ringAfterDrag = await page.evaluate(() => window.__p0.state().ring.open);
  const moved = Math.hypot(after.offsetX - before.offsetX, after.offsetY - before.offsetY);
  console.log(`pan drag: offset ${Math.round(before.offsetX)},${Math.round(before.offsetY)} -> ${Math.round(after.offsetX)},${Math.round(after.offsetY)} (moved ${moved.toFixed(1)} px), hud plaque still ${r0(hudBefore) === r0(hudAfter)}, ring opened by drag: ${ringAfterDrag}`);
  await page.screenshot({ path: `${OUT}/pan-after-drag-l1c-1512x982.jpg`, type: 'jpeg', quality: 80 });
  // Wheel / two-finger scroll.
  await page.mouse.move(756, 500);
  await page.mouse.wheel(40, 30);
  await page.waitForTimeout(600);
  const afterWheel = await page.evaluate(() => window.__p0.state().fit);
  console.log(`pan wheel: ${Math.round(after.offsetX)},${Math.round(after.offsetY)} -> ${Math.round(afterWheel.offsetX)},${Math.round(afterWheel.offsetY)}`);
  // Keyboard: Shift + arrows.
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(600);
  const afterKey = await page.evaluate(() => window.__p0.state().fit);
  console.log(`pan keys: ${Math.round(afterWheel.offsetX)},${Math.round(afterWheel.offsetY)} -> ${Math.round(afterKey.offsetX)},${Math.round(afterKey.offsetY)}`);
  // Tap a free plot: the build ring opens.
  // A free plot well inside the screen after the pan (not under a corner piece).
  const plot = await page.evaluate(([W, H]) => {
    const p0 = window.__p0;
    let best = null;
    for (let i = 0; i < 60; i++) {
      let q = null;
      try {
        q = p0.plotScreen?.(i);
      } catch {
        break;
      }
      if (!q || !Number.isFinite(q.x)) break;
      const d = Math.hypot(q.x - W / 2, q.y - H / 2);
      if (!best || d < best.d) best = { i, x: q.x, y: q.y, d };
    }
    return best;
  }, [s.w, s.h]);
  if (plot) {
    await page.mouse.click(plot.x, plot.y);
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => window.__p0.state().ring);
    console.log(`tap plot ${plot.i} at ${Math.round(plot.x)},${Math.round(plot.y)} after panning: ring open=${st.open} mode=${st.mode} plot=${st.plot}`);
    await page.screenshot({ path: `${OUT}/pan-tap-builds-l1c-1512x982.jpg`, type: 'jpeg', quality: 80 });
  } else console.log('no __p0.plotScreen hook');
  await ctx.close();
}
if (process.argv.includes('--settings')) {
  // Settings -> Controls lists the pan (Shift + arrows, drag, two-finger scroll; touch: one finger).
  for (const s of [{ key: '1440x900', w: 1440, h: 900 }, { key: '844x390', w: 844, h: 390, touch: true }]) {
    const { ctx, page } = await open(s, `level=l1c&lang=${LANG}&settings=1&settab=controls`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/settings-controls-${s.key}.jpg`, type: 'jpeg', quality: 80 });
    await ctx.close();
  }
}
await browser.close();
console.log(`done, ${fails} shots to check`);
