// Visual QA & changed-pixel measurement for group A islands (i01..i08).
// Usage:
//   python3 qa/withPreview.py --port=4391 node tools/map-life/qa_shots_a.mjs --mode=before
//   python3 qa/withPreview.py --port=4391 node tools/map-life/qa_shots_a.mjs --mode=after
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let playwrightMod;
try {
  playwrightMod = await import('playwright');
} catch {
  playwrightMod = await import('/tmp/anim-i02-pw/node_modules/playwright/index.mjs');
}
const { chromium } = playwrightMod;

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4391';
const MODE = arg('mode') ?? 'after'; // 'before' | 'after'
const ISLANDS = (arg('islands') ?? 'i01,i02,i03,i04,i05,i06,i07,i08').split(',').filter(Boolean);
const OUT_ROOT = 'docs/anim-shots/maplife';

const pyMeasure = `
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

p0, p1, out_jpg = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
a = np.asarray(Image.open(p0).convert('RGB'), dtype=np.int16)
b = np.asarray(Image.open(p1).convert('RGB'), dtype=np.int16)
d = np.abs(a - b).sum(axis=2)
res = {
    'shape': list(a.shape[:2]),
    'pct_gt30': round(float((d > 30).mean() * 100.0), 3),
    'pct_gt15': round(float((d > 15).mean() * 100.0), 3),
    'mean_drgb': round(float(d.mean()), 2),
}
if out_jpg:
    Image.open(p1).convert('RGB').save(out_jpg, quality=88)
print(json.dumps(res))
`;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const summaryPath = join(OUT_ROOT, 'a-measurements.json');
const existing = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : { islands: {} };

try {
  for (const island of ISLANDS) {
    const outDir = join(OUT_ROOT, island);
    mkdirSync(outDir, { recursive: true });
    const tmpDir = join('/tmp', `sky-mlife-a-${MODE}-${island}`);
    mkdirSync(tmpDir, { recursive: true });

    const cfgPath = join('src/data/mapLife', `${island}.json`);
    const hasConfig = existsSync(cfgPath);
    const cfgJson = hasConfig ? JSON.parse(readFileSync(cfgPath, 'utf8')) : null;
    const expectsWind = Boolean(cfgJson?.wind);

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
    if (MODE === 'after' && expectsWind) {
      await page.waitForFunction(() => window.__p0?.mapLife?.()?.swayReady === true, undefined, { timeout: 20000 });
    }
    await page.waitForTimeout(1200);

    // Measure live 1.5 s pair (mapLife off in 'before', on in 'after').
    const t0Path = join(tmpDir, 'desktop-t0.png');
    const t15Path = join(tmpDir, 'desktop-t15.png');
    await page.screenshot({ path: t0Path, scale: 'css' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: t15Path, scale: 'css' });

    const liveLife = await page.evaluate(() => window.__p0.mapLife());
    const shotJpg = MODE === 'after' ? join(outDir, `${island}-desktop.jpg`) : '';
    const diffJson = JSON.parse(execFileSync('python3', ['-c', pyMeasure, t0Path, t15Path, shotJpg], { encoding: 'utf8' }));

    // In 'after' mode, also verify pause freezes time, reduced motion disables mapLife, and birds can spawn via stepMapLife.
    let checks = null;
    if (MODE === 'after') {
      assert.ok(liveLife, `${island}: window.__p0.mapLife() must be non-null`);
      assert.equal(liveLife.enabled, true, `${island}: mapLife must be enabled on high`);
      assert.equal(liveLife.swayReady, expectsWind, `${island}: swayReady mismatch`);

      // Freeze & step to verify birds spawn cleanly when configured.
      await page.evaluate(() => window.__p0.freeze(true));
      const stepped = await page.evaluate(() => {
        for (let i = 0; i < 6; i++) window.__p0.stepMapLife(1.0);
        return window.__p0.mapLife();
      });
      await page.evaluate(() => window.__p0.freeze(false));

      // Pause check.
      await page.keyboard.press('Space');
      await page.waitForFunction(() => window.__p0.state().paused === true, undefined, { timeout: 5000 });
      const tPaused = await page.evaluate(() => window.__p0.mapLife().time);
      await page.waitForTimeout(350);
      const tPaused2 = await page.evaluate(() => window.__p0.mapLife().time);
      assert.equal(tPaused2, tPaused, `${island}: mapLife time must freeze on pause`);
      await page.keyboard.press('Space');
      await page.waitForFunction(() => window.__p0.state().paused === false, undefined, { timeout: 5000 });

      // Reduced motion check.
      await page.evaluate(() => {
        const key = 'skyhold_isles_settings_v1';
        const settings = JSON.parse(localStorage.getItem(key) || '{}');
        settings.graphics = { ...settings.graphics, reducedMotion: true };
        localStorage.setItem(key, JSON.stringify(settings));
        window.dispatchEvent(new Event('skyhold:graphics'));
      });
      await page.waitForFunction(() => window.__p0.mapLife()?.enabled === false, undefined, { timeout: 5000 });
      const reduced = await page.evaluate(() => window.__p0.mapLife());
      assert.equal(reduced.enabled, false, `${island}: reducedMotion must disable mapLife`);

      checks = {
        pauseFroze: tPaused2 === tPaused,
        reducedDisabled: !reduced.enabled && !reduced.built,
        flocksAfterStep: stepped.flocksSpawned,
        activeBirdsAfterStep: stepped.activeBirds,
      };
    }

    assert.deepEqual(errors, [], `${island} (${MODE}) had console/page errors: ${errors.join('; ')}`);

    existing.islands[island] = existing.islands[island] ?? {};
    existing.islands[island][MODE] = {
      diff: diffJson,
      liveLife,
      checks,
      errors,
    };

    await ctx.close();
    rmSync(tmpDir, { recursive: true, force: true });
    console.log(`${island} [${MODE}]: pct_gt30=${diffJson.pct_gt30}% mean_drgb=${diffJson.mean_drgb}`);
  }
} finally {
  await browser.close();
}

existing.browser = browser.version();
writeFileSync(summaryPath, JSON.stringify(existing, null, 2) + '\n');
console.log('Saved measurements to', summaryPath);
