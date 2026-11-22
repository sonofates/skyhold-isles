// Visual QA & changed-pixel measurement for Group B islands (i09–i16).
// Runs against `vite preview` (via qa/withPreview.py --port=4398 node tools/map-life/qa_shots_b.mjs).
// For each island:
//   - Captures desktop (2000x991) screenshot (JPG) into docs/anim-shots/maplife/<id>/desktop.jpg
//   - Measures fraction of pixels with sum|dRGB| > 30 (and > 15) over a 1.5 s interval:
//       * before (map life frozen / off; mapAnim video + ambientFx advancing 1.5 s)
//       * after  (map life live on high quality, advancing 1.5 s)
//   - Verifies pause freezes mapLife.time, reducedMotion disables mapLife, low quality keeps it unbuilt,
//     and zero pageerror / console.error occur.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let playwrightMod;
try {
  playwrightMod = await import('playwright');
} catch {
  playwrightMod = await import('/tmp/anim-i02-pw/node_modules/playwright/index.mjs');
}
const { chromium } = playwrightMod;

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4398';
const ISLANDS = (arg('islands') ?? 'i09,i10,i11,i12,i13,i14,i15,i16').split(',').filter(Boolean);
const WIND_ISLANDS = new Set(['i09', 'i10', 'i11', 'i12', 'i15']);
const TMP_ROOT = '/tmp/sky-mlife-b-qa';

rmSync(TMP_ROOT, { recursive: true, force: true });
mkdirSync(TMP_ROOT, { recursive: true });

async function setReducedMotion(page, on) {
  await page.evaluate((value) => {
    const key = 'skyhold_isles_settings_v1';
    const settings = JSON.parse(localStorage.getItem(key) || '{}');
    settings.graphics = { ...settings.graphics, reducedMotion: value };
    localStorage.setItem(key, JSON.stringify(settings));
    window.dispatchEvent(new Event('skyhold:graphics'));
  }, on);
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const allResults = [];

try {
  for (const island of ISLANDS) {
    const outDir = join('docs/anim-shots/maplife', island);
    const tmpDir = join(TMP_ROOT, island);
    mkdirSync(outDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });

    const hasWind = WIND_ISLANDS.has(island);
    const ctx = await browser.newContext({
      viewport: { width: 2000, height: 991 },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript(() => {
      localStorage.setItem('skyhold2d_coach_v1', 'done');
    });

    await page.goto(`${BASE}/2d.html?level=${island}&quality=high&hero=none&lang=en`);
    await page.waitForFunction(() => !!window.__p0?.state, undefined, { timeout: 60000 });
    if (hasWind) {
      await page.waitForFunction(() => window.__p0?.mapLife?.()?.swayReady === true, undefined, { timeout: 25000 });
    } else {
      await page.waitForFunction(() => window.__p0?.mapLife?.()?.built === true, undefined, { timeout: 25000 });
    }
    await page.waitForTimeout(1000);

    // 1. Measure BEFORE (mapLife off/disabled via reducedMotion=false? No: freeze ticker & step only ambient+video over 1.5s,
    //    AND wait: with mapLife disabled via freeze + no stepMapLife, mapLife contributes 0 delta while video loops & ambientFx advance 1.5s).
    await page.evaluate(() => window.__p0.freeze(true));
    await page.evaluate(() => window.__p0.stepAmbient(0.05));
    const b0 = join(tmpDir, 'before-t0.png');
    const b1 = join(tmpDir, 'before-t15.png');
    await page.screenshot({ path: b0, scale: 'css' });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      for (let i = 0; i < 15; i++) window.__p0.stepAmbient(0.1);
    });
    await page.screenshot({ path: b1, scale: 'css' });

    // 2. Unfreeze and measure AFTER (live 1.5 s with mapLife + ambient + video all running).
    await page.evaluate(() => window.__p0.freeze(false));
    await page.waitForTimeout(600);
    // Advance slightly so birds (if configured) are also likely active in the shot.
    const a0 = join(tmpDir, 'after-t0.png');
    const a1 = join(tmpDir, 'after-t15.png');
    await page.screenshot({ path: a0, scale: 'css' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: a1, scale: 'css' });

    const liveLife = await page.evaluate(() => window.__p0.mapLife());
    const liveAmbient = await page.evaluate(() => window.__p0.ambient());

    // Capture a clean desktop JPG screenshot (step birds slightly into view if configured so screenshot shows life).
    await page.evaluate(() => window.__p0.freeze(true));
    await page.evaluate(() => {
      const st = window.__p0.mapLife();
      if (st && st.flocksSpawned === 0) {
        for (let i = 0; i < 12; i++) {
          window.__p0.stepMapLife(0.5);
          if (window.__p0.mapLife()?.activeBirds > 0) break;
        }
        if (window.__p0.mapLife()?.activeBirds > 0) {
          window.__p0.stepMapLife(4.5);
        }
      }
    });
    await page.screenshot({ path: join(outDir, 'desktop.jpg'), type: 'jpeg', quality: 88, scale: 'css' });
    const shotLife = await page.evaluate(() => window.__p0.mapLife());
    await page.evaluate(() => window.__p0.freeze(false));

    // 3. Pause check: Space freezes mapLife.time.
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__p0.state().paused === true, undefined, { timeout: 5000 });
    const tPaused = await page.evaluate(() => window.__p0.mapLife().time);
    await page.waitForTimeout(350);
    const tPausedLater = await page.evaluate(() => window.__p0.mapLife().time);
    assert.equal(tPausedLater, tPaused, `${island}: mapLife time must freeze while paused`);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__p0.state().paused === false, undefined, { timeout: 5000 });

    // 4. Reduced motion disables mapLife cleanly.
    await setReducedMotion(page, true);
    await page.waitForTimeout(250);
    const reducedState = await page.evaluate(() => window.__p0.mapLife());
    assert.equal(reducedState.enabled, false, `${island}: reducedMotion must disable mapLife`);
    assert.equal(reducedState.built, false, `${island}: reducedMotion must tear down mapLife`);
    assert.deepEqual(errors, [], `${island} desktop errors: ${errors.join('; ')}`);
    await ctx.close();

    // 5. Low quality check on first and last island (or all islands quickly).
    {
      const lctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
      const lpage = await lctx.newPage();
      const lerr = [];
      lpage.on('pageerror', (e) => lerr.push(e.message));
      await lpage.addInitScript(() => {
        localStorage.setItem('skyhold2d_coach_v1', 'done');
      });
      await lpage.goto(`${BASE}/2d.html?level=${island}&quality=low&hero=none&lang=en`);
      await lpage.waitForFunction(() => !!window.__p0?.state, undefined, { timeout: 60000 });
      await lpage.waitForTimeout(400);
      const lowLife = await lpage.evaluate(() => window.__p0.mapLife());
      assert.equal(lowLife.built, false, `${island}: low tier must not build mapLife`);
      assert.equal(lowLife.enabled, false, `${island}: low tier must disable mapLife`);
      assert.deepEqual(lerr, [], `${island} low-tier errors: ${lerr.join('; ')}`);
      await lctx.close();
    }

    // 6. Compute changed-pixel metrics & save 4x amplified diff heatmap JPG.
    const pyDiff = `
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

tmp_dir = Path(sys.argv[1])
out_dir = Path(sys.argv[2])
res = {}
for phase in ['before', 'after']:
    a = np.asarray(Image.open(tmp_dir / f'{phase}-t0.png').convert('RGB'), dtype=np.int16)
    b = np.asarray(Image.open(tmp_dir / f'{phase}-t15.png').convert('RGB'), dtype=np.int16)
    d = np.abs(a - b).sum(axis=2)
    res[phase] = {
        'shape': list(a.shape[:2]),
        'pct_gt30': round(float((d > 30).mean() * 100.0), 3),
        'pct_gt15': round(float((d > 15).mean() * 100.0), 3),
        'mean_drgb': round(float(d.mean()), 2),
    }
    if phase == 'after':
        heat = np.clip(np.abs(a - b) * 4, 0, 255).astype(np.uint8)
        Image.fromarray(heat).save(out_dir / 'diff-desktop-4x.jpg', quality=85)
print(json.dumps(res))
`;
    const pixelDiff = JSON.parse(execFileSync('python3', ['-c', pyDiff, tmpDir, outDir], { encoding: 'utf8' }));
    const islandReport = {
      island,
      hasWind,
      liveLife,
      shotLife,
      liveAmbient,
      pixelDiff,
      reducedDisabled: !reducedState.enabled && !reducedState.built,
      lowDisabled: true,
      errors,
    };
    writeFileSync(join(outDir, 'measurements.json'), JSON.stringify(islandReport, null, 2) + '\n');
    allResults.push(islandReport);
    console.log(
      `${island}: before=${pixelDiff.before.pct_gt30}% -> after=${pixelDiff.after.pct_gt30}% (gt15: ${pixelDiff.before.pct_gt15}% -> ${pixelDiff.after.pct_gt15}%, swayReady=${liveLife.swayReady}, clouds=${liveLife.activeClouds}, birds=${shotLife.activeBirds}, butterflies=${liveLife.activeButterflies})`,
    );
  }
} finally {
  await browser.close();
  rmSync(TMP_ROOT, { recursive: true, force: true });
}

writeFileSync('/tmp/sky-mlife-b-summary.json', JSON.stringify(allResults, null, 2) + '\n');
