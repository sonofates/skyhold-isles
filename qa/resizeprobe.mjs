// HUD text after a window resize (owner report 2026-11-21: "Dalga 1/20" a few px tall on a MacBook).
// Loads at one size, resizes the viewport, prints the HUD text boxes before / after.
// Usage: node qa/resizeprobe.mjs [--base=...] [--out=/tmp/x]
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4317';
const OUT = arg('out');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const r0 = (r) => `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}`;
const CASES = [
  [[700, 420], [2000, 1150], 2],
  [[2000, 1150], [1200, 700], 2],
  [[1512, 982], [2000, 1150], 2],
  [[2000, 1150], [2000, 1150], 2],
];
let bad = 0;
for (const [a, b, dpr] of CASES) {
  const ctx = await browser.newContext({ viewport: { width: a[0], height: a[1] }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/2d.html?level=i14&lang=tr`);
  await page.waitForFunction(() => !!window.__p0?.state, null, { timeout: 90000 });
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => window.__p0.state().hud);
  await page.setViewportSize({ width: b[0], height: b[1] });
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({ hud: window.__p0.state().hud, texts: window.__p0.textAudit() }));
  const h = after.hud;
  const tiny = h.waveText.h < 0.22 * h.banner.h || h.lives.h < 0.4 * h.plaque.h;
  if (tiny) bad++;
  console.log(`${a.join('x')} -> ${b.join('x')} @${dpr}: wave ${r0(before.waveText)} -> ${r0(h.waveText)} (banner ${r0(h.banner)}), lives ${r0(before.lives)} -> ${r0(h.lives)}, gold -> ${r0(h.gold)} textAudit=${after.texts.length}${tiny ? '  <-- TINY' : ''}`);
  if (OUT) await page.screenshot({ path: `${OUT}/resize-${a.join('x')}-${b.join('x')}.jpg`, type: 'jpeg', quality: 80 });
  await ctx.close();
}
await browser.close();
console.log(`done, ${bad} tiny`);
