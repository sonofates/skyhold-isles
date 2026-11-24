// QA script (Bug 1): checks all 28 islands (l1c, i01-i27) across desktop (2000x991), MacBook
// (1440x900) and phone landscape (844x390, 932x430) at the default view. For every tower plot
// (plot circle using plotLayer's plotRadius and plot centre), verifies whether it sits under any
// visible HUD element's DOM rect or canvas HUD rect, prints per-island/per-viewport covered counts,
// and exits 1 if any plot is covered.
//
// Usage:
//   python3 qa/withPreview.py --port=4395 node qa/plotCoverCheck.mjs [--shots=docs/qa/bugs1] [--prefix=after-bug1]
// Add --new-islands for six battle screenshots and plot checks on i25–i27 only.
import { mkdirSync } from 'node:fs';

let playwrightMod;
try {
  playwrightMod = await import('playwright');
} catch {
  playwrightMod = await import('/tmp/anim-i02-pw/node_modules/playwright/index.mjs');
}
const { chromium } = playwrightMod;

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4395';
const SHOTS = arg('shots');
const PREFIX = arg('prefix') ?? 'after-bug1';
const SHOT_ISLANDS = new Set((arg('shotIslands') ?? 'i13,i08,i03').split(','));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const newIslands = process.argv.includes('--new-islands');
const battleDir = 'docs/new-islands-shots';
if (newIslands) mkdirSync(battleDir, { recursive: true });

const ALL_ISLANDS = ['l1c', ...Array.from({ length: 27 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const IDS = newIslands ? ['i25', 'i26', 'i27'] : (arg('ids') ?? ALL_ISLANDS.join(',')).split(',');
const VIEWPORTS = newIslands ? [
  { key: '1280x800', w: 1280, h: 800, dpr: 1, desktop: 1, touch: false },
  { key: '932x430', w: 932, h: 430, dpr: 2, desktop: 0, touch: true },
] : [
  { key: '2000x991', w: 2000, h: 991, dpr: 1, desktop: 1, touch: false },
  { key: '1440x900', w: 1440, h: 900, dpr: 1, desktop: 1, touch: false },
  { key: '844x390', w: 844, h: 390, dpr: 2, desktop: 0, touch: true },
  { key: '932x430', w: 932, h: 430, dpr: 2, desktop: 0, touch: true },
].filter((v) => !arg('sizes') || arg('sizes').split(',').includes(v.key));

const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS, executablePath: process.env.CHROMIUM_PATH || undefined });

let totalCovered = 0;
const summary = [];

async function checkViewport(vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.touch,
    hasTouch: vp.touch,
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('skyhold2d_coach_v1', 'done');
    } catch {
      // ignore
    }
  });
  const page = await ctx.newPage();
  let vpCovered = 0;
  let vpBadIslands = 0;
  const rows = [];

  for (const id of IDS) {
    const url = `${BASE}/2d.html?level=${id}&hero=bran&lang=en&quality=high&desktop=${vp.desktop}`;
    await page.goto(url);
    await page.waitForFunction(() => window.__p0?.hudCheck && !document.getElementById('boot'), null, { timeout: 60000 });
    await page.waitForTimeout(300);

    const res = await page.evaluate(() => {
      const hc = window.__p0.hudCheck();
      const items = window.__p0.items?.() ?? null;
      const plotHits = hc.overlaps.filter((o) => o.kind === 'plot');
      const unique = [...new Set(plotHits.map((o) => o.index))];
      const byPiece = {};
      for (const o of plotHits) (byPiece[o.piece] ??= []).push(o.index);
      return {
        covered: unique.length,
        byPiece,
        mode: items?.mode ?? null,
        shrink: Math.round(hc.fit.shrink * 1000) / 1000,
      };
    });

    if (res.covered > 0) {
      vpBadIslands++;
      vpCovered += res.covered;
      totalCovered += res.covered;
    }
    const detail = res.covered > 0 ? ` [${Object.entries(res.byPiece).map(([p, xs]) => `${p}:${xs.join(',')}`).join('; ')}]` : '';
    rows.push(`  ${vp.key} ${id.padEnd(3)} covered=${res.covered} mode=${res.mode ?? '-'} shrink=${res.shrink.toFixed(3)}${detail}`);

    if (newIslands) {
      await page.goto(`${url}&autoplay=1&speed=3`);
      await page.waitForFunction(() => {
        const state = window.__p0?.state?.();
        return state?.outcome === 'ongoing' && state.wave >= 2 && state.enemies >= 5 && state.towers.length >= 2;
      }, null, { timeout: 150000 });
      await page.screenshot({ path: `${battleDir}/${id}-${vp.key}.jpg`, type: 'jpeg', quality: 90, scale: 'css' });
    }

    if (SHOTS && SHOT_ISLANDS.has(id) && ((vp.key === '2000x991' && id === 'i13') || (vp.key === '1440x900' && id === 'i13') || (vp.key === '844x390' && id === 'i08') || (vp.key === '932x430' && id === 'i03'))) {
      await page.screenshot({ path: `${SHOTS}/${PREFIX}-${vp.key}-${id}.jpg`, type: 'jpeg', quality: 88 });
    }
  }

  console.log(`\n=== Viewport ${vp.key}: ${vpBadIslands}/${IDS.length} islands with covered plots, total covered=${vpCovered} ===`);
  for (const r of rows) console.log(r);
  summary.push({ vp: vp.key, badIslands: vpBadIslands, total: vpCovered });
  await ctx.close();
}

try {
  for (const vp of VIEWPORTS) await checkViewport(vp);
} finally {
  await browser.close();
}
console.log('\n=== SUMMARY ===');
for (const s of summary) console.log(`${s.vp}: ${s.badIslands}/${IDS.length} islands covered, ${s.total} covered plots`);
process.exit(totalCovered > 0 ? 1 : 0);
