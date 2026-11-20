// HUD lettering sizes (owner report 2026-11-21: "every HUD text a sane minimum size"): for each
// screen, the computed font size of every visible text in the in-run DOM HUD (tray key hints,
// round-button captions, next-wave card, difficulty badge) plus the canvas HUD labels, smallest
// first. Usage: node qa/hudfonts.mjs [--base=...] [--min=11]
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4317';
const MIN = Number(arg("min") ?? 10);
const SIZES = [[2000, 1150], [1512, 982], [1440, 900], [1366, 768], [1024, 768], [844, 390], [2560, 1080]];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let small = 0;
for (const [w, h] of SIZES) {
  const touch = h < 500;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/2d.html?level=i10&lang=tr`);
  await page.waitForFunction(() => !!window.__p0?.state, null, { timeout: 90000 });
  await page.waitForTimeout(900);
  const rows = await page.evaluate(() => {
    const roots = ['[data-testid="ab2d-bar"]', '[data-testid="wave2d-card"]', '[data-testid="hud2d-diff"]', '.pu-codex-btn', '[data-testid="hero2d-hud"]'];
    const out = [];
    const seen = new Set();
    for (const sel of roots) {
      for (const root of document.querySelectorAll(sel)) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const txt = n.textContent.trim();
          if (!txt) continue;
          const el = n.parentElement;
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          if (cs.visibility === 'hidden' || cs.display === 'none' || r.width === 0 || el.closest('[hidden]')) continue;
          const key = `${sel}|${el.className}|${txt}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ where: sel, cls: String(el.className).slice(0, 40), txt: txt.slice(0, 24), px: parseFloat(cs.fontSize) });
        }
      }
    }
    const hud = window.__p0.state().hud;
    out.push({ where: 'canvas', cls: 'waveText', txt: 'Dalga', px: hud.waveText.h / 1.25 });
    out.push({ where: 'canvas', cls: 'lives', txt: 'lives', px: hud.lives.h / 1.25 });
    return out.sort((a, b) => a.px - b.px);
  });
  const lows = rows.filter((r) => r.px < MIN);
  small += lows.length;
  console.log(`${w}x${h}: smallest ${rows.slice(0, 4).map((r) => `${r.where}.${r.cls} "${r.txt}" ${r.px.toFixed(1)}px`).join(' | ')}${lows.length ? `  <-- ${lows.length} under ${MIN}px` : ''}`);
  await ctx.close();
}
await browser.close();
console.log(`done, ${small} texts under ${MIN}px`);
