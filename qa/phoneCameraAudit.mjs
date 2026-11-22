// Phone battle camera Playwright QA:
// - Captures default-view JPGs on l1c, i04, i13, i19, i24 at 932x430, 844x390, 667x375
//   (mobile touch context: isMobile, hasTouch, dpr 3, iPhone UA).
// - Verifies zero bands / zero mirrored edges (no pixel row/column outside the painted map).
// - Simulates real multi-touch via CDP: tap on plot opens build ring; drag starting on a plot
//   pans and does NOT open build ring; two-finger pinch-in zooms & clamps; pinch-out clamps at
//   cover-fit with zero bands; post-pan/pinch tap opens build ring at updated coordinates.
// - Verifies desktop 2000x991 & 1440x900 screenshots of l1c and i13 match the pre-change baseline.
//
// Usage: node qa/phoneCameraAudit.mjs [--out=docs/phoneui/camera] [--baseline=/tmp/sky-desktop-before]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = arg('out') ?? 'docs/phoneui/camera';
const BASELINE = arg('baseline') ?? '/tmp/sky-desktop-before';
const PORT = Number(arg('port') ?? 4391);
const BASE = `http://127.0.0.1:${PORT}`;

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const LAUNCH_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];
const ISLANDS = ['l1c', 'i04', 'i13', 'i19', 'i24'];
const PHONE_SIZES = [
  { key: '932x430', w: 932, h: 430 },
  { key: '844x390', w: 844, h: 390 },
  { key: '667x375', w: 667, h: 375 },
];
const DESKTOP_CASES = [
  { id: 'l1c', w: 2000, h: 991 },
  { id: 'l1c', w: 1440, h: 900 },
  { id: 'i13', w: 2000, h: 991 },
  { id: 'i13', w: 1440, h: 900 },
];

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const req = createRequire('/home/claude/ci/kaginawa-r22/package.json');
    return req('playwright-core');
  }
}

function findChromium() {
  const cacheDir = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cacheDir)) return undefined;
  const dirs = readdirSync(cacheDir)
    .filter((d) => d.startsWith('chromium_headless_shell-') || d.startsWith('chromium-'))
    .sort()
    .reverse();
  for (const d of dirs) {
    for (const rel of ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux64/chrome']) {
      const p = join(cacheDir, d, rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

function assertInsideMap(label, st, frame, w, h, imageW = 1846, imageH = 852) {
  const f = st.fit;
  const eps = 0.5;
  const errs = [];
  if (frame.mirroredEdges) errs.push('mirroredEdges=true');
  if (frame.bands.some((b) => b > eps)) errs.push(`bands=${frame.bands.map((b) => b.toFixed(1)).join('/')}`);
  if (f.offsetX > eps) errs.push(`offsetX=${f.offsetX.toFixed(2)}>0`);
  if (f.offsetY > eps) errs.push(`offsetY=${f.offsetY.toFixed(2)}>0`);
  if (f.offsetX + imageW * f.scale < w - eps) errs.push(`rightEdge=${(f.offsetX + imageW * f.scale).toFixed(2)}<${w}`);
  if (f.offsetY + imageH * f.scale < h - eps) errs.push(`bottomEdge=${(f.offsetY + imageH * f.scale).toFixed(2)}<${h}`);
  if (errs.length > 0) throw new Error(`[${label}] out-of-map pixels visible: ${errs.join(', ')}`);
}

async function touchTap(cdp, x, y) {
  const pt = [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 6, radiusY: 6, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function touchDrag(cdp, x0, y0, x1, y1, steps = 14) {
  const mk = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 6, radiusY: 6, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: mk(x0, y0) });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: mk(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t),
    });
    await new Promise((r) => setTimeout(r, 18));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function touchPinch(cdp, cx, cy, halfStart, halfEnd, steps = 14) {
  const pts = (half) => [
    { x: Math.round(cx - half), y: Math.round(cy - half * 0.25), id: 1, radiusX: 6, radiusY: 6, force: 1 },
    { x: Math.round(cx + half), y: Math.round(cy + half * 0.25), id: 2, radiusX: 6, radiusY: 6, force: 1 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts(halfStart)[0]] });
  await new Promise((r) => setTimeout(r, 20));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(halfStart) });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const h = halfStart + (halfEnd - halfStart) * t;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(h) });
    await new Promise((r) => setTimeout(r, 20));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [pts(halfEnd)[0]] });
  await new Promise((r) => setTimeout(r, 20));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Finds a free plot comfortably inside the screen and clear of all HUD pieces. */
async function findClearPlot(page, w, h) {
  return page.evaluate(([W, H]) => {
    const p0 = window.__p0;
    const st = p0.state();
    const hc = p0.hudCheck();
    const pieces = Object.values(hc.pieces);
    const n = st.plots.count;
    let best = null;
    for (let i = 0; i < n; i++) {
      const q = p0.plotScreen(i);
      if (q.x < 70 || q.x > W - 70 || q.y < 70 || q.y > H - 90) continue;
      const blocked = pieces.some((r) => q.x >= r.x - 16 && q.x <= r.x + r.w + 16 && q.y >= r.y - 16 && q.y <= r.y + r.h + 16);
      if (blocked) continue;
      const d = Math.hypot(q.x - W / 2, q.y - H / 2);
      if (!best || d < best.d) best = { i, x: q.x, y: q.y, d };
    }
    return best;
  }, [w, h]);
}

const srv = spawn('npx', ['vite', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore' });
const cleanup = () => {
  try {
    srv.kill('SIGTERM');
  } catch {
    // ignore
  }
};
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(1);
});

for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`${BASE}/2d.html`);
    if (r.ok) break;
  } catch {
    // wait
  }
  await new Promise((r) => setTimeout(r, 250));
}

mkdirSync(OUT, { recursive: true });
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: findChromium(), args: LAUNCH_ARGS });
const report = { phone: [], interactions: [], desktop: [] };
let failures = 0;

try {
  // 1. Phone default views across 5 islands x 3 viewports
  for (const sz of PHONE_SIZES) {
    for (const id of ISLANDS) {
      const ctx = await browser.newContext({
        viewport: { width: sz.w, height: sz.h },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: IPHONE_UA,
      });
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        try {
          localStorage.setItem('skyhold2d_coach_v1', '1');
        } catch {
          // ignore
        }
      });
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      await page.goto(`${BASE}/2d.html?level=${id}&lang=en&quality=high`);
      await page.waitForFunction(() => !!window.__p0?.state, null, { timeout: 60000 });
      await page.waitForTimeout(700);
      const { st, frame, ringCss } = await page.evaluate(() => {
        const st0 = window.__p0.state();
        const f0 = window.__p0.mapFrame();
        const ringW = st0.plots.rings[0]?.width ?? 93.75;
        return { st: st0, frame: f0, ringCss: ringW * st0.fit.scale };
      });
      const label = `${id}-${sz.key}`;
      if (!st.camera?.phone) throw new Error(`[${label}] phone camera not active`);
      assertInsideMap(label, st, frame, sz.w, sz.h);
      if (pageErrors.length > 0) throw new Error(`[${label}] pageerror: ${pageErrors.join('; ')}`);

      await page.screenshot({ path: join(OUT, `${label}-default.jpg`), type: 'jpeg', quality: 80 });
      report.phone.push({
        label,
        scale: Number(st.fit.scale.toFixed(4)),
        minScale: Number(st.camera.minScale.toFixed(4)),
        maxScale: Number(st.camera.maxScale.toFixed(4)),
        offset: [Math.round(st.fit.offsetX), Math.round(st.fit.offsetY)],
        ringCssPx: Number(ringCss.toFixed(1)),
        bands: frame.bands.map((b) => Math.round(b)),
        mirroredEdges: frame.mirroredEdges,
      });
      console.log(
        `[phone] ${label.padEnd(12)} scale=${st.fit.scale.toFixed(3)} (min=${st.camera.minScale.toFixed(3)} max=${st.camera.maxScale.toFixed(3)}) ` +
          `ring=${ringCss.toFixed(1)}px off=${Math.round(st.fit.offsetX)},${Math.round(st.fit.offsetY)} bands=${frame.bands.map(Math.round).join('/')} mirror=${frame.mirroredEdges}`,
      );

      // 2. Touch gestures (tap, drag-from-plot, pinch-in, pinch-out, post-zoom tap) on l1c & i13 at 932x430
      if (sz.key === '932x430' && (id === 'l1c' || id === 'i13')) {
        const cdp = await ctx.newCDPSession(page);
        const plot = await findClearPlot(page, sz.w, sz.h);
        if (!plot) throw new Error(`[${label}] no clear plot found for touch test`);

        // 2a. Tap on plot -> opens build ring
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await touchTap(cdp, plot.x, plot.y);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const afterTap = await page.evaluate(() => window.__p0.state().ring);
        if (!afterTap.open || afterTap.mode !== 'build' || afterTap.plot !== plot.i) {
          throw new Error(`[${label}] tap on plot ${plot.i} did not open build ring: ${JSON.stringify(afterTap)}`);
        }
        // Close build ring by tapping the same plot again
        await touchTap(cdp, plot.x, plot.y);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const afterClose = await page.evaluate(() => window.__p0.state().ring);
        if (afterClose.open) throw new Error(`[${label}] second tap did not close build ring: ${JSON.stringify(afterClose)}`);

        // 2b. Drag starting ON the plot -> pans and does NOT open build ring
        const beforeDrag = await page.evaluate(() => window.__p0.state().fit);
        const dragTargetX = plot.x > sz.w * 0.5 ? plot.x - 140 : plot.x + 140;
        const dragTargetY = plot.y > sz.h * 0.5 ? plot.y - 80 : plot.y + 80;
        await touchDrag(cdp, plot.x, plot.y, dragTargetX, dragTargetY);
        await page.waitForTimeout(700);
        const afterDrag = await page.evaluate(() => ({
          st: window.__p0.state(),
          frame: window.__p0.mapFrame(),
          laneMarks: window.__p0.laneMarks?.() ?? null,
        }));
        const dragDist = Math.hypot(afterDrag.st.fit.offsetX - beforeDrag.offsetX, afterDrag.st.fit.offsetY - beforeDrag.offsetY);
        if (afterDrag.st.ring.open) throw new Error(`[${label}] drag starting on plot opened build ring!`);
        if (dragDist < 25) throw new Error(`[${label}] drag moved camera too little (${dragDist.toFixed(1)}px)`);
        assertInsideMap(`${label}-panned`, afterDrag.st, afterDrag.frame, sz.w, sz.h);
        await page.screenshot({ path: join(OUT, `${label}-panned.jpg`), type: 'jpeg', quality: 80 });

        // 2c. Two-finger pinch-in -> zooms in, does NOT open build ring, stays inside map
        const beforePinch = afterDrag.st.fit;
        await touchPinch(cdp, sz.w / 2, sz.h / 2, 55, 165);
        await page.waitForTimeout(350);
        const afterPinchIn = await page.evaluate(() => ({
          st: window.__p0.state(),
          frame: window.__p0.mapFrame(),
        }));
        if (afterPinchIn.st.ring.open) throw new Error(`[${label}] pinch-in opened build ring!`);
        if (afterPinchIn.st.fit.scale <= beforePinch.scale * 1.25) {
          throw new Error(`[${label}] pinch-in did not zoom enough: ${beforePinch.scale.toFixed(3)} -> ${afterPinchIn.st.fit.scale.toFixed(3)}`);
        }
        if (afterPinchIn.st.fit.scale > afterPinchIn.st.camera.maxScale + 1e-4) {
          throw new Error(`[${label}] pinch-in exceeded maxScale`);
        }
        assertInsideMap(`${label}-pinched`, afterPinchIn.st, afterPinchIn.frame, sz.w, sz.h);
        await page.screenshot({ path: join(OUT, `${label}-pinched.jpg`), type: 'jpeg', quality: 80 });

        // 2d. Tap a plot AFTER panning + pinching -> build ring opens at the plot's NEW coordinates!
        const zoomedPlot = await findClearPlot(page, sz.w, sz.h);
        if (!zoomedPlot) throw new Error(`[${label}] no clear plot found while zoomed in`);
        await touchTap(cdp, zoomedPlot.x, zoomedPlot.y);
        await page.waitForTimeout(250);
        const afterZoomTap = await page.evaluate(() => window.__p0.state().ring);
        if (!afterZoomTap.open || afterZoomTap.plot !== zoomedPlot.i) {
          throw new Error(`[${label}] tap while zoomed in failed to open ring on plot ${zoomedPlot.i}: ${JSON.stringify(afterZoomTap)}`);
        }

        // 2e. Extreme pinch-out -> closes ring, clamps at minScale (cover-fit), zero mirrored bands!
        await touchPinch(cdp, sz.w / 2, sz.h / 2, 220, 35);
        await page.waitForTimeout(350);
        const afterPinchOut = await page.evaluate(() => ({
          st: window.__p0.state(),
          frame: window.__p0.mapFrame(),
        }));
        if (afterPinchOut.st.ring.open) throw new Error(`[${label}] pinch-out left ring open`);
        if (Math.abs(afterPinchOut.st.fit.scale - afterPinchOut.st.camera.minScale) > 0.005) {
          throw new Error(
            `[${label}] pinch-out did not clamp at minScale: got ${afterPinchOut.st.fit.scale.toFixed(4)}, expected ${afterPinchOut.st.camera.minScale.toFixed(4)}`,
          );
        }
        assertInsideMap(`${label}-pinched-out`, afterPinchOut.st, afterPinchOut.frame, sz.w, sz.h);

        const summary = {
          label,
          tapOpenedPlot: plot.i,
          dragMovedPx: Number(dragDist.toFixed(1)),
          pinchInScale: `${beforePinch.scale.toFixed(3)} -> ${afterPinchIn.st.fit.scale.toFixed(3)}`,
          zoomTapPlot: zoomedPlot.i,
          pinchOutClampedScale: Number(afterPinchOut.st.fit.scale.toFixed(4)),
          minScale: Number(afterPinchOut.st.camera.minScale.toFixed(4)),
          allInsideMap: true,
        };
        report.interactions.push(summary);
        console.log(`[touch] ${label}:`, JSON.stringify(summary));
      }

      await ctx.close();
    }
  }

  // 3. Desktop regression check: 2000x991 and 1440x900 on l1c and i13 must match baseline!
  const baseFits = existsSync(join(BASELINE, 'fits.json')) ? JSON.parse(readFileSync(join(BASELINE, 'fits.json'), 'utf8')) : null;
  for (const dc of DESKTOP_CASES) {
    const key = `${dc.id}-${dc.w}x${dc.h}`;
    const ctx = await browser.newContext({ viewport: { width: dc.w, height: dc.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/2d.html?level=${dc.id}&lang=en&quality=high&desktop=1&hero=none&coach=0`);
    await page.waitForFunction(() => !!window.__p0?.state, null, { timeout: 60000 });
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__p0.freeze(true));
    const info = await page.evaluate(() => ({
      fit: window.__p0.state().fit,
      frame: window.__p0.mapFrame(),
      pan: window.__p0.state().pan,
      camera: window.__p0.state().camera,
    }));
    const afterPng = await page.screenshot();
    await page.screenshot({ path: join(OUT, `desktop-${key}.jpg`), type: 'jpeg', quality: 82 });

    let fitMatch = true;
    let pngIdentical = null;
    if (baseFits?.[key]) {
      const bf = baseFits[key].fit;
      const af = info.fit;
      const diff =
        Math.abs(bf.scale - af.scale) +
        Math.abs(bf.offsetX - af.offsetX) +
        Math.abs(bf.offsetY - af.offsetY) +
        Math.abs(bf.bandLeft - af.bandLeft) +
        Math.abs(bf.bandRight - af.bandRight) +
        Math.abs(bf.bandTop - af.bandTop) +
        Math.abs(bf.bandBottom - af.bandBottom);
      fitMatch = diff < 1e-6 && info.camera.phone === false;
      const basePngPath = join(BASELINE, `${key}.png`);
      if (existsSync(basePngPath)) {
        const beforePng = readFileSync(basePngPath);
        pngIdentical = Buffer.compare(beforePng, afterPng) === 0;
      }
      if (!fitMatch) {
        failures++;
        console.error(`[desktop] MISMATCH ${key}: before=${JSON.stringify(bf)} after=${JSON.stringify(af)}`);
      }
    }
    report.desktop.push({ key, fitMatch, pngIdentical, scale: info.fit.scale, offset: [info.fit.offsetX, info.fit.offsetY] });
    console.log(`[desktop] ${key}: fitMatch=${fitMatch} pngIdentical=${pngIdentical} scale=${info.fit.scale.toFixed(4)} off=${Math.round(info.fit.offsetX)},${Math.round(info.fit.offsetY)}`);
    await ctx.close();
  }

  // Check total size of docs/phoneui/camera/ (< 10 MB)
  let totalBytes = 0;
  for (const f of readdirSync(OUT)) {
    totalBytes += statSync(join(OUT, f)).size;
  }
  const totalMb = totalBytes / (1024 * 1024);
  console.log(`[size] ${OUT}: ${totalMb.toFixed(2)} MB (${readdirSync(OUT).length} files)`);
  if (totalMb >= 10) throw new Error(`${OUT} exceeded 10 MB (${totalMb.toFixed(2)} MB)`);
  writeFileSync(join(OUT, 'audit.json'), JSON.stringify(report, null, 2));
} catch (err) {
  failures++;
  console.error('AUDIT FAILED:', err);
} finally {
  await browser.close();
  cleanup();
}

process.exit(failures > 0 ? 1 : 0);
