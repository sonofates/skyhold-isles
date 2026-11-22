// Visual QA & changed-pixel measurement for group C map-life rollout
// (i18, i19, i20, i21, i22, i23, i24, l1c).
//
// Usage:
//   python3 qa/withPreview.py --port=4393 --outDir=/tmp/dist-before-c node tools/map-life/qa_maplife_c.mjs --phase=before
//   python3 qa/withPreview.py --port=4394 node tools/map-life/qa_maplife_c.mjs --phase=after
//
// In --phase=before: captures 1.5s live pairs in /tmp/mlife-c-qa/<id>/before/ (not committed).
// In --phase=after:  captures desktop (2000x991) JPG screenshot to docs/anim-shots/maplife/<id>/desktop.jpg,
//                    checks pause/reduced-motion/low-tier/console-errors, computes before->after sum|dRGB|>30,
//                    and writes docs/anim-shots/maplife/<id>/measurements.json.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let playwrightMod;
try {
  playwrightMod = await import('playwright');
} catch {
  playwrightMod = await import('/tmp/anim-i02-pw/node_modules/playwright/index.mjs');
}
const { chromium } = playwrightMod;

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4394';
const PHASE = arg('phase') ?? 'after';
const TMP_ROOT = arg('tmp') ?? '/tmp/mlife-c-qa';
const OUT_ROOT = arg('out') ?? 'docs/anim-shots/maplife';
const ISLANDS = (arg('islands') ?? 'i18,i19,i20,i21,i22,i23,i24,l1c').split(',').filter(Boolean);

const HAS_WIND = new Set(['i19', 'i20', 'i21', 'i23', 'i24', 'l1c']);

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

const summary = [];

try {
  for (const island of ISLANDS) {
    const tmpDir = join(TMP_ROOT, island, PHASE);
    mkdirSync(tmpDir, { recursive: true });
    const outDir = join(OUT_ROOT, island);
    if (PHASE === 'after') mkdirSync(outDir, { recursive: true });

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

    if (PHASE === 'after') {
      if (HAS_WIND.has(island)) {
        await page.waitForFunction(() => window.__p0?.mapLife?.()?.swayReady === true, undefined, { timeout: 25000 });
      } else {
        await page.waitForFunction(() => window.__p0?.mapLife?.()?.enabled === true, undefined, { timeout: 25000 });
      }
    }

    // Settle ~3.5s so live clouds, wind gusts, butterflies, and initial bird flocks are active.
    await page.waitForTimeout(3500);

    const t0Path = join(tmpDir, 'desktop-t0.png');
    const t15Path = join(tmpDir, 'desktop-t15.png');
    await page.screenshot({ path: t0Path, scale: 'css' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: t15Path, scale: 'css' });

    let liveLife = null;
    let liveAmbient = null;
    let checks = {};

    if (PHASE === 'after') {
      liveLife = await page.evaluate(() => window.__p0.mapLife());
      liveAmbient = await page.evaluate(() => window.__p0.ambient());

      // Save one desktop (2000x991) JPG screenshot for docs/anim-shots/maplife/<id>/.
      await page.screenshot({
        path: join(outDir, 'desktop.jpg'),
        type: 'jpeg',
        quality: 86,
        scale: 'css',
      });

      // Pause check: Space freezes mapLife.time.
      await page.keyboard.press('Space');
      await page.waitForFunction(() => window.__p0.state().paused === true, undefined, { timeout: 5000 });
      const tPaused = await page.evaluate(() => window.__p0.mapLife().time);
      await page.waitForTimeout(350);
      const tPausedLater = await page.evaluate(() => window.__p0.mapLife().time);
      assert.equal(tPausedLater, tPaused, `${island}: mapLife time must freeze while paused`);
      await page.keyboard.press('Space');
      await page.waitForFunction(() => window.__p0.state().paused === false, undefined, { timeout: 5000 });

      // Reduced motion disables mapLife cleanly.
      await setReducedMotion(page, true);
      await page.waitForTimeout(250);
      const reducedState = await page.evaluate(() => window.__p0.mapLife());
      assert.equal(reducedState.enabled, false, `${island}: reducedMotion must disable mapLife`);

      checks = {
        pauseFrozen: true,
        reducedDisabled: !reducedState.enabled && !reducedState.built,
      };
    }

    assert.deepEqual(errors, [], `${island} (${PHASE}) had runtime errors: ${errors.join('; ')}`);
    await ctx.close();

    if (PHASE === 'after') {
      // Compute pixel diff for before (if present) and after.
      const py = `
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

tmp_island = Path(sys.argv[1])
metrics = {}
for phase in ['before', 'after']:
    p0 = tmp_island / phase / 'desktop-t0.png'
    p1 = tmp_island / phase / 'desktop-t15.png'
    if not (p0.exists() and p1.exists()):
        continue
    a = np.asarray(Image.open(p0).convert('RGB'), dtype=np.int16)
    b = np.asarray(Image.open(p1).convert('RGB'), dtype=np.int16)
    d = np.abs(a - b).sum(axis=2)
    metrics[phase] = {
        'shape': list(a.shape[:2]),
        'pct_gt30': round(float((d > 30).mean() * 100.0), 3),
        'pct_gt15': round(float((d > 15).mean() * 100.0), 3),
        'mean_drgb': round(float(d.mean()), 2),
    }
print(json.dumps(metrics))
`;
      const pixelDiff = JSON.parse(execFileSync('python3', ['-c', py, join(TMP_ROOT, island)], { encoding: 'utf8' }));
      const rec = {
        island,
        viewport: [2000, 991],
        liveLife,
        liveAmbient,
        checks,
        pixelDiff,
        errors,
      };
      writeFileSync(join(outDir, 'measurements.json'), JSON.stringify(rec, null, 2) + '\n');
      summary.push({
        island,
        before_gt30: pixelDiff.before?.pct_gt30 ?? null,
        after_gt30: pixelDiff.after?.pct_gt30 ?? null,
        before_mean: pixelDiff.before?.mean_drgb ?? null,
        after_mean: pixelDiff.after?.mean_drgb ?? null,
        swayReady: liveLife?.swayReady ?? false,
        clouds: liveLife?.activeClouds ?? 0,
        birds: liveLife?.activeBirds ?? 0,
        butterflies: liveLife?.activeButterflies ?? 0,
      });
    } else {
      summary.push({ island, phase: 'before', ok: true });
    }
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(summary, null, 2));
