// Visual QA & changed-pixel measurement for procedural map-life layer (i17 pilot).
// Captures after screenshots (desktop 2000x991 and phone 844x390), a 6-frame ~3 s strip,
// checks low quality / reduced motion / pause / console errors, and prints frame-time stats.
// Usage: python3 qa/withPreview.py --port=4397 node qa/mapLifeShots.mjs [--out=docs/anim-shots/maplife/i17]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let playwrightMod;
try {
  playwrightMod = await import('playwright');
} catch {
  playwrightMod = await import('/tmp/anim-i02-pw/node_modules/playwright/index.mjs');
}
const { chromium } = playwrightMod;

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4397';
const OUT = arg('out') ?? 'docs/anim-shots/maplife/i17';
const ISLAND = arg('island') ?? 'i17';

mkdirSync(join(OUT, 'after'), { recursive: true });
mkdirSync(join(OUT, 'strip'), { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const report = { island: ISLAND, browser: browser.version(), cases: [] };

async function measureRpm(page, durationMs = 2500) {
  return page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const deltas = [];
        let start;
        let prev;
        function tick(t) {
          if (start === undefined) start = t;
          if (prev !== undefined) deltas.push(t - prev);
          prev = t;
          if (t - start < ms) return requestAnimationFrame(tick);
          deltas.sort((a, b) => a - b);
          const q = (p) => +(deltas[Math.round((deltas.length - 1) * p)] ?? 0).toFixed(2);
          resolve({
            frames: deltas.length,
            meanMs: +((t - start) / Math.max(1, deltas.length)).toFixed(2),
            p50Ms: q(0.5),
            p95Ms: q(0.95),
          });
        }
        requestAnimationFrame(tick);
      }),
    durationMs,
  );
}

async function setReducedMotion(page, on) {
  await page.evaluate((value) => {
    const key = 'skyhold_isles_settings_v1';
    const settings = JSON.parse(localStorage.getItem(key) || '{}');
    settings.graphics = { ...settings.graphics, reducedMotion: value };
    localStorage.setItem(key, JSON.stringify(settings));
    window.dispatchEvent(new Event('skyhold:graphics'));
  }, on);
}

try {
  // 1. Desktop (2000x991) and Phone (844x390, dpr 2) on High quality.
  for (const cfg of [
    { name: 'desktop', width: 2000, height: 991, dpr: 1, mobile: false },
    { name: 'phone', width: 844, height: 390, dpr: 2, mobile: true },
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: cfg.width, height: cfg.height },
      deviceScaleFactor: cfg.dpr,
      isMobile: cfg.mobile,
      hasTouch: cfg.mobile,
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

    await page.goto(`${BASE}/2d.html?level=${ISLAND}&quality=high&hero=none&lang=en`);
    await page.waitForFunction(() => !!window.__p0?.state, undefined, { timeout: 60000 });
    await page.waitForFunction(() => window.__p0?.mapLife?.()?.swayReady === true, undefined, { timeout: 20000 });
    await page.waitForTimeout(1200);

    // Measure live performance before freezing.
    const perf = await measureRpm(page, 2500);

    // Live 1.5 s pair for real-time changed-pixel measurement (matching before capture).
    await page.screenshot({ path: join(OUT, 'after', `${cfg.name}-t0.png`), scale: 'css' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, 'after', `${cfg.name}-t15.png`), scale: 'css' });

    const liveLife = await page.evaluate(() => window.__p0.mapLife());
    const liveAmbient = await page.evaluate(() => window.__p0.ambient());

    // Deterministic 6-frame strip over 3.0 s (0.6 s steps) with ticker frozen (no Pause plate).
    await page.evaluate(() => window.__p0.freeze(true));
    // Advance until a fresh bird flock spawns and glides into the middle of the sunny meadow.
    await page.evaluate(() => {
      const startFlocks = window.__p0.mapLife()?.flocksSpawned ?? 0;
      for (let i = 0; i < 60; i++) {
        const st = window.__p0.mapLife();
        if (st && st.flocksSpawned > startFlocks && st.activeBirds > 0) break;
        window.__p0.stepMapLife(1.0);
      }
      // Advance 6.0 s so the flock is squarely over the central meadow during the 3 s strip.
      window.__p0.stepMapLife(6.0);
    });
    for (let f = 0; f < 6; f++) {
      if (f > 0) {
        await page.evaluate(() => {
          window.__p0.stepMapLife(0.6);
          window.__p0.stepAmbient(0.1);
        });
      }
      await page.screenshot({
        path: join(OUT, 'strip', `${cfg.name}-f${f}.png`),
        scale: 'css',
      });
    }
    const stripState = await page.evaluate(() => window.__p0.mapLife());
    await page.evaluate(() => window.__p0.freeze(false));

    // Pause check: Space freezes mapLife.time.
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__p0.state().paused === true, undefined, { timeout: 5000 });
    const tPaused = await page.evaluate(() => window.__p0.mapLife().time);
    await page.waitForTimeout(450);
    const tPausedLater = await page.evaluate(() => window.__p0.mapLife().time);
    assert.equal(tPausedLater, tPaused, `${cfg.name}: mapLife time must freeze while paused`);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__p0.state().paused === false, undefined, { timeout: 5000 });

    // Reduced motion turns mapLife off cleanly.
    await setReducedMotion(page, true);
    await page.waitForTimeout(300);
    const reducedState = await page.evaluate(() => window.__p0.mapLife());
    assert.equal(reducedState.enabled, false, `${cfg.name}: reducedMotion must disable mapLife`);

    report.cases.push({
      name: cfg.name,
      viewport: [cfg.width, cfg.height],
      dpr: cfg.dpr,
      perf,
      liveLife,
      liveAmbient,
      stripState,
      reducedDisabled: !reducedState.enabled && !reducedState.built,
      errors,
    });
    assert.deepEqual(errors, [], `${cfg.name} had runtime errors: ${errors.join('; ')}`);
    await ctx.close();
  }

  // 2. Low quality check: mapLife stays unbuilt & disabled.
  {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('skyhold2d_coach_v1', 'done');
    });
    await page.goto(`${BASE}/2d.html?level=${ISLAND}&quality=low&hero=none&lang=en`);
    await page.waitForFunction(() => !!window.__p0?.state, undefined, { timeout: 60000 });
    await page.waitForTimeout(800);
    const lowLife = await page.evaluate(() => window.__p0.mapLife());
    assert.equal(lowLife.built, false, 'low tier must not build mapLife');
    assert.equal(lowLife.enabled, false, 'low tier must keep mapLife disabled');
    assert.deepEqual(errors, []);
    report.cases.push({ name: 'phone-low', lowLife, errors });
    await ctx.close();
  }

  // 3. Medium quality check: fewer clouds, no butterflies.
  {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('skyhold2d_coach_v1', 'done');
    });
    await page.goto(`${BASE}/2d.html?level=${ISLAND}&quality=med&hero=none&lang=en`);
    await page.waitForFunction(() => !!window.__p0?.state, undefined, { timeout: 60000 });
    await page.waitForFunction(() => window.__p0?.mapLife?.()?.swayReady === true, undefined, { timeout: 20000 });
    await page.waitForTimeout(600);
    const medLife = await page.evaluate(() => window.__p0.mapLife());
    assert.equal(medLife.enabled, true, 'med tier enables mapLife');
    assert.equal(medLife.activeClouds, 2, 'med tier trims clouds');
    assert.equal(medLife.activeButterflies, 0, 'med tier disables butterflies');
    assert.deepEqual(errors, []);
    report.cases.push({ name: 'phone-med', medLife, errors });
    await ctx.close();
  }
} finally {
  await browser.close();
}

// Compute pixel-change metrics and assemble 6-frame contact strips + diff heatmaps.
const pyPost = `
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

out = Path(sys.argv[1])
metrics = {}
for name in ['desktop', 'phone']:
    for phase in ['before', 'after']:
        p0 = out / phase / f'{name}-t0.png'
        p1 = out / phase / f'{name}-t15.png'
        if not (p0.exists() and p1.exists()):
            continue
        a = np.asarray(Image.open(p0).convert('RGB'), dtype=np.int16)
        b = np.asarray(Image.open(p1).convert('RGB'), dtype=np.int16)
        d = np.abs(a - b).sum(axis=2)
        metrics[f'{phase}_{name}'] = {
            'shape': list(a.shape[:2]),
            'pct_gt30': round(float((d > 30).mean() * 100.0), 3),
            'pct_gt15': round(float((d > 15).mean() * 100.0), 3),
            'mean_drgb': round(float(d.mean()), 2),
        }
        if phase == 'after':
            # Save an amplified 4x diff heatmap so motion areas are immediately inspectable.
            heat = np.clip(np.abs(a - b) * 4, 0, 255).astype(np.uint8)
            Image.fromarray(heat).save(out / f'diff-{name}-4x.jpg', quality=88)

    # Assemble 3x2 labeled 6-frame strip (~3.0 s, 0.6 s per frame).
    frames = [Image.open(out / 'strip' / f'{name}-f{i}.png').convert('RGB') for i in range(6)]
    tw = 960 if name == 'desktop' else 422
    th = round(tw * frames[0].height / frames[0].width)
    strip = Image.new('RGB', (tw * 3 + 16, th * 2 + 12), (18, 16, 14))
    draw = ImageDraw.Draw(strip)
    for i, fr in enumerate(frames):
        col, row = i % 3, i // 3
        x, y = 4 + col * (tw + 4), 4 + row * (th + 4)
        strip.paste(fr.resize((tw, th), Image.Resampling.LANCZOS), (x, y))
        draw.rectangle((x + 6, y + 6, x + 98, y + 28), fill=(18, 16, 14))
        draw.text((x + 12, y + 11), f't = +{i * 0.6:.1f}s', fill=(255, 240, 200))
    strip.save(out / f'strip-{name}.jpg', quality=88)

print(json.dumps(metrics, indent=2))
`;
const metricsOut = execFileSync('python3', ['-c', pyPost, OUT], { encoding: 'utf8' });
report.pixelDiff = JSON.parse(metricsOut);
writeFileSync(join(OUT, 'measurements.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
