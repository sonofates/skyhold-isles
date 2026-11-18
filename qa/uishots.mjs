// Painted UI QA (hermes, Playwright Docker image, against `vite preview` on :4173): radial build
// ring on a top-row / middle / bottom-edge plot, tooltip, unaffordable state, built-tower ring
// (upgrade selected), HUD, victory and defeat panels — at six viewports. Numeric checks: every
// HUD rect and ring token inside the viewport, token spacing >= 44 px, numbers inside the plaque,
// tooltip on screen and clear of the ring. Writes PNGs + report.json to qa-out/ui.
// Usage: node qa/uishots.mjs [sizeKey]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const OUT = 'qa-out/ui';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const SIZES = [
  ['2000x1035', 2000, 1035, 1, false],
  ['1600x900', 1600, 900, 1, false],
  ['1280x720', 1280, 720, 1, false],
  ['2560x1080', 2560, 1080, 1, false],
  ['915x412', 915, 412, 2.6, true],
  ['844x390', 844, 390, 3, true],
];
const only = process.argv[2] ?? '';
const report = { errors: [], sizes: {} };
const err = (m) => {
  report.errors.push(m);
  console.log('ERR', m);
};

const state = (page) => page.evaluate(() => window.__p0.state());
const inside = (r, w, h, tol = 0.5) => r.x >= -tol && r.y >= -tol && r.x + r.w <= w + tol && r.y + r.h <= h + tol;
const contains = (o, i, tol = 1) => i.x >= o.x - tol && i.y >= o.y - tol && i.x + i.w <= o.x + o.w + tol && i.y + i.h <= o.y + o.h + tol;
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

async function tap(page, touch, x, y) {
  if (touch) await page.touchscreen.tap(Math.round(x), Math.round(y));
  else await page.mouse.click(Math.round(x), Math.round(y));
}

function checkRing(key, s, w, h) {
  const toks = s.ring.tokens;
  const R = s.ring.layout.tokenR;
  for (const t of toks) {
    if (!inside({ x: t.x - R, y: t.y - R, w: 2 * R, h: 2 * R }, w, h)) err(`${key}: token at ${t.x.toFixed(0)},${t.y.toFixed(0)} leaves the viewport`);
  }
  let minD = Infinity;
  for (let i = 0; i < toks.length; i++) for (let j = i + 1; j < toks.length; j++) minD = Math.min(minD, Math.hypot(toks[i].x - toks[j].x, toks[i].y - toks[j].y));
  if (2 * R < 44) err(`${key}: token diameter ${(2 * R).toFixed(1)} < 44`);
  if (toks.length > 1 && minD < 2 * R) err(`${key}: tokens overlap (centre distance ${minD.toFixed(1)}, diameter ${(2 * R).toFixed(1)})`);
  if (!inside(s.ring.layout.box, w, h, 1)) err(`${key}: ring box leaves the viewport`);
  return { tokens: toks.length, tokenR: R, minCentreDist: Math.round(minD), box: s.ring.layout.box };
}

const browser = await chromium.launch({ args: ARGS });
for (const [key, w, h, dpr, touch] of SIZES) {
  if (only && key !== only) continue;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: touch, hasTouch: touch });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) err(`[${key}] ${m.text()}`);
  });
  page.on('pageerror', (e) => err(`[${key}] pageerror ${e.message}`));
  await page.goto(`${BASE}/2d.html`);
  await page.waitForFunction(() => !!window.__p0, null, { timeout: 30000 });
  await page.waitForTimeout(900);
  const rep = (report.sizes[key] = {});
  const shot = (name) => page.screenshot({ path: `${OUT}/${key}-${name}.png` });

  // HUD
  let s = await state(page);
  rep.insets = s.insets;
  rep.hud = s.hud;
  for (const [k, r] of Object.entries(s.hud)) if (!inside(r, w, h)) err(`${key}: hud.${k} ${JSON.stringify(r)} outside the viewport`);
  if (!contains(s.hud.plaque, s.hud.lives) || !contains(s.hud.plaque, s.hud.gold)) err(`${key}: plaque numbers leave the plaque`);
  if (overlap(s.hud.plaque, s.hud.banner) > 0) err(`${key}: plaque overlaps the wave banner`);
  await page.evaluate(() => window.__p0.setGold(1234));
  await page.waitForTimeout(150);
  s = await state(page);
  if (!contains(s.hud.goldSlot, s.hud.gold, 2)) err(`${key}: 4-digit gold leaves its slot`);
  await page.evaluate(() => window.__p0.setGold(200));
  await page.waitForTimeout(120);
  await shot('hud');

  // Plots: top-row, middle and bottom-edge (by screen position).
  const n = s.plots.count;
  const pts = [];
  for (let i = 0; i < n; i++) pts.push({ i, ...(await page.evaluate((k) => window.__p0.plotScreen(k), i)) });
  const onScreen = pts.filter((p) => p.x > 0 && p.x < w && p.y > 0 && p.y < h);
  const top = onScreen.reduce((a, b) => (b.y < a.y ? b : a));
  const bottom = onScreen.reduce((a, b) => (b.y > a.y ? b : a));
  const mid = onScreen.reduce((a, b) => (Math.hypot(b.x - w / 2, b.y - h / 2) < Math.hypot(a.x - w / 2, a.y - h / 2) ? b : a));
  rep.plots = { top: top.i, mid: mid.i, bottom: bottom.i };

  for (const [name, p] of [
    ['ring-top', top],
    ['ring-bottom', bottom],
  ]) {
    if (name === 'ring-bottom') await page.evaluate(() => window.__p0.setGold(70));
    await tap(page, touch, p.x, p.y);
    await page.waitForTimeout(550);
    s = await state(page);
    if (!s.ring.open) err(`${key}: ${name} did not open`);
    else rep[name] = checkRing(`${key} ${name}`, s, w, h);
    if (name === 'ring-bottom' && s.ring.open) {
      // Select an unaffordable tower: tooltip shows the red "Need N gold".
      const poor = s.ring.tokens.findIndex((t) => !t.enabled);
      if (poor < 0) err(`${key}: no unaffordable token at 70 gold`);
      else {
        await tap(page, touch, s.ring.tokens[poor].x, s.ring.tokens[poor].y);
        await page.waitForTimeout(400);
      }
    }
    await shot(name);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => window.__p0.setGold(400));

  // Middle plot: bloom, hover (desktop), select (tooltip + range preview), build, tower ring.
  await tap(page, touch, mid.x, mid.y);
  await page.waitForTimeout(80);
  await shot('ring-mid-bloom');
  await page.waitForTimeout(500);
  s = await state(page);
  rep['ring-mid'] = checkRing(`${key} ring-mid`, s, w, h);
  await shot('ring-mid');
  const t0 = s.ring.tokens[0];
  if (!touch) {
    await page.mouse.move(s.ring.tokens[2].x, s.ring.tokens[2].y);
    await page.waitForTimeout(350);
    await shot('ring-hover');
  }
  await tap(page, touch, t0.x, t0.y);
  await page.waitForTimeout(450);
  s = await state(page);
  const tip = s.ring.layout.tooltip;
  rep.tooltip = tip;
  if (!tip) err(`${key}: no tooltip after selecting`);
  else {
    if (!inside(tip, w, h)) err(`${key}: tooltip leaves the viewport`);
    const R = s.ring.layout.tokenR;
    for (const t of s.ring.tokens) if (overlap(tip, { x: t.x - R, y: t.y - R, w: 2 * R, h: 2 * R }) > 0) err(`${key}: tooltip covers a token`);
  }
  if (!s.ring.rangeShown) err(`${key}: no range preview for the selected tower`);
  await shot('tooltip');
  await tap(page, touch, t0.x, t0.y);
  await page.waitForTimeout(500);
  s = await state(page);
  if (s.towers.length !== 1) err(`${key}: second tap did not build (${s.towers.length} towers)`);
  await tap(page, touch, mid.x, mid.y - 20);
  await page.waitForTimeout(550);
  s = await state(page);
  if (s.ring.mode !== 'tower') err(`${key}: tower ring did not open (${s.ring.mode})`);
  else {
    rep['tower-ring'] = checkRing(`${key} tower-ring`, s, w, h);
    await shot('tower-ring');
    await tap(page, touch, s.ring.tokens[0].x, s.ring.tokens[0].y);
    await page.waitForTimeout(450);
    await shot('tower-upgrade');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // Barracks on the top-row plot: its ring carries the rally token.
  await page.evaluate(() => window.__p0.setGold(400));
  await tap(page, touch, top.x, top.y);
  await page.waitForTimeout(550);
  s = await state(page);
  const bi = s.ring.tokens.length - 1;
  await tap(page, touch, s.ring.tokens[bi].x, s.ring.tokens[bi].y);
  await page.waitForTimeout(300);
  await tap(page, touch, s.ring.tokens[bi].x, s.ring.tokens[bi].y);
  await page.waitForTimeout(500);
  await tap(page, touch, top.x, top.y - 20);
  await page.waitForTimeout(550);
  s = await state(page);
  if (s.ring.mode !== 'tower' || s.ring.tokens.length !== 3) err(`${key}: barracks ring did not open with 3 tokens`);
  else rep['barracks-ring'] = checkRing(`${key} barracks-ring`, s, w, h);
  await shot('barracks-ring');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  await shot('paused');
  await page.keyboard.press(' ');

  // End panels.
  await page.evaluate(() => window.__p0.forceEnd('won'));
  await page.waitForTimeout(250);
  await shot('victory-pop');
  await page.waitForTimeout(2000);
  s = await state(page);
  rep.victory = s.end;
  if (!s.end) err(`${key}: no victory panel`);
  else {
    if (!inside(s.end.panel, w, h)) err(`${key}: victory panel leaves the viewport`);
    for (const b of s.end.buttons) if (b.r * 2 < 44) err(`${key}: end button ${b.action} < 44 px`);
  }
  await shot('victory');
  const retry = s.end?.buttons.find((b) => b.action === 'retry');
  if (retry) {
    await tap(page, touch, retry.x, retry.y);
    await page.waitForTimeout(500);
    s = await state(page);
    if (s.end || s.outcome !== 'ongoing') err(`${key}: Retry did not restart`);
  }
  await page.evaluate(() => window.__p0.forceEnd('lost'));
  await page.waitForTimeout(2200);
  s = await state(page);
  rep.defeat = s.end;
  if (!s.end) err(`${key}: no defeat panel`);
  await shot('defeat');
  await ctx.close();
  console.log('done', key);
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log('ERRORS', report.errors.length);
for (const e of report.errors) console.log(' -', e);
await browser.close();
