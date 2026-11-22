// Visual QA & changed-pixel measurement for procedural water (i10, i15) & desert dust/heat haze (i14).
// Usage: python3 qa/withPreview.py --port=4399 node tools/map-life/qa_waterfx.mjs
//
// For each island (i10, i14, i15):
//   - Captures desktop 2000x991 JPG into docs/anim-shots/maplife/<id>/desktop.jpg
//   - Captures a 6-frame strip over 3.0 s (0.6 s steps) cropped to the water/dust area
//     into docs/anim-shots/maplife/<id>/strip-waterfx.jpg
//   - Measures changed-pixel % (sum|dRGB| > 30 and > 15, two frames 1.5 s apart):
//       * before (mapLife frozen; mapAnim + ambientFx advancing 1.5 s)
//       * after  (full mapLife live on high quality, advancing 1.5 s)
//     plus masked-water/dust-area diff and 4x diff heatmap.
//   - Verifies waterReady/hazeReady/activeDust, med tier, low tier, Space pause freeze,
//     reducedMotion teardown, and zero pageerror / console.error.
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
const BASE = arg('base') ?? 'http://127.0.0.1:4399';
const ISLANDS = (arg('islands') ?? 'i10,i14,i15').split(',').filter(Boolean);
const TMP_ROOT = '/tmp/sky-waterfx-qa';

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

async function measureFrameTimes(page, durationMs = 2000) {
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

    if (island === 'i10' || island === 'i15') {
      await page.waitForFunction(
        () => {
          const ml = window.__p0?.mapLife?.();
          return ml?.swayReady === true && ml?.waterReady === true;
        },
        undefined,
        { timeout: 25000 },
      );
    } else if (island === 'i14') {
      await page.waitForFunction(
        () => {
          const ml = window.__p0?.mapLife?.();
          return ml?.hazeReady === true && (ml?.activeDust ?? 0) > 0;
        },
        undefined,
        { timeout: 25000 },
      );
    }
    await page.waitForTimeout(800);

    // 1. Live frame timing check.
    const perf = await measureFrameTimes(page, 2000);

    // 2. Measure BEFORE (mapLife frozen, advancing only ambientFx + video over 1.5 s).
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

    // 3. Measure AFTER (live 1.5 s with full mapLife + water/dust/haze + ambient + video running).
    await page.evaluate(() => window.__p0.freeze(false));
    await page.waitForTimeout(600);
    const a0 = join(tmpDir, 'after-t0.png');
    const a1 = join(tmpDir, 'after-t15.png');
    await page.screenshot({ path: a0, scale: 'css' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: a1, scale: 'css' });

    const liveLife = await page.evaluate(() => window.__p0.mapLife());
    const liveAmbient = await page.evaluate(() => window.__p0.ambient());

    // 4. Deterministic 6-frame strip over 3.0 s (0.6 s steps) with ticker frozen.
    await page.evaluate(() => window.__p0.freeze(true));
    for (let f = 0; f < 6; f++) {
      if (f > 0) {
        await page.evaluate(() => {
          window.__p0.stepMapLife(0.6);
          window.__p0.stepAmbient(0.1);
        });
      }
      await page.screenshot({ path: join(tmpDir, `strip-f${f}.png`), scale: 'css' });
    }
    await page.screenshot({ path: join(outDir, 'desktop.jpg'), type: 'jpeg', quality: 88, scale: 'css' });
    const shotLife = await page.evaluate(() => window.__p0.mapLife());
    await page.evaluate(() => window.__p0.freeze(false));

    // 5. Pause check: Space freezes mapLife.time.
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__p0.state().paused === true, undefined, { timeout: 5000 });
    const tPaused = await page.evaluate(() => window.__p0.mapLife().time);
    await page.waitForTimeout(350);
    const tPausedLater = await page.evaluate(() => window.__p0.mapLife().time);
    assert.equal(tPausedLater, tPaused, `${island}: mapLife time must freeze while paused`);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__p0.state().paused === false, undefined, { timeout: 5000 });

    // 6. Reduced motion disables and tears down mapLife cleanly.
    await setReducedMotion(page, true);
    await page.waitForTimeout(250);
    const reducedState = await page.evaluate(() => window.__p0.mapLife());
    assert.equal(reducedState.enabled, false, `${island}: reducedMotion must disable mapLife`);
    assert.equal(reducedState.built, false, `${island}: reducedMotion must tear down mapLife`);
    assert.deepEqual(errors, [], `${island} desktop errors: ${errors.join('; ')}`);
    await ctx.close();

    // 7. Medium tier check.
    let medLife;
    {
      const mctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      const mpage = await mctx.newPage();
      const merr = [];
      mpage.on('pageerror', (e) => merr.push(e.message));
      await mpage.addInitScript(() => {
        localStorage.setItem('skyhold2d_coach_v1', 'done');
      });
      await mpage.goto(`${BASE}/2d.html?level=${island}&quality=med&hero=none&lang=en`);
      await mpage.waitForFunction(() => !!window.__p0?.state, undefined, { timeout: 60000 });
      await mpage.waitForTimeout(600);
      medLife = await mpage.evaluate(() => window.__p0.mapLife());
      assert.equal(medLife.enabled, true, `${island}: med tier must enable mapLife`);
      if (island === 'i14') {
        assert.equal(medLife.activeDust, 6, 'i14 med tier must trim dust wisps');
      }
      assert.deepEqual(merr, [], `${island} med-tier errors: ${merr.join('; ')}`);
      await mctx.close();
    }

    // 8. Low quality check.
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

    // 9. Compute pixel diffs + assemble cropped 6-frame 3 s strip + 4x diff heatmap.
    const pyPost = `
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

island = sys.argv[1]
tmp_dir = Path(sys.argv[2])
out_dir = Path(sys.argv[3])

# Desktop 2000x991 crop regions focusing on the water / dust features + adjacent banks/bridges/roads/plots.
CROPS = {
    'i10': (640, 290, 1180, 985),     # mid-river chute, bridges, lower stream & weir waterfall
    'i14': (220, 180, 1180, 800),     # courtyard dust, open terracotta dunes, road & plots
    'i15': (0, 130, 1450, 820),       # west moonlit cove, moon-well & south lily pond (composite below)
}

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
        Image.fromarray(heat).save(out_dir / 'diff-desktop-4x.jpg', quality=86)

# Also measure cropped water/dust region diff on the deterministic 1.2s pair (f0 vs f2) and live 1.5s pair.
a_live = np.asarray(Image.open(tmp_dir / 'after-t0.png').convert('RGB'), dtype=np.int16)
b_live = np.asarray(Image.open(tmp_dir / 'after-t15.png').convert('RGB'), dtype=np.int16)
x0, y0, x1, y1 = CROPS[island]
dc = np.abs(a_live[y0:y1, x0:x1] - b_live[y0:y1, x0:x1]).sum(axis=2)
res['crop_after'] = {
    'box': [x0, y0, x1, y1],
    'pct_gt30': round(float((dc > 30).mean() * 100.0), 3),
    'pct_gt15': round(float((dc > 15).mean() * 100.0), 3),
    'mean_drgb': round(float(dc.mean()), 2),
}

# Build 3x2 labeled 6-frame strip over 3.0 s (0.6 s steps) cropped to the water/dust area.
frames = [Image.open(tmp_dir / f'strip-f{i}.png').convert('RGB') for i in range(6)]
cropped = []
for fr in frames:
    if island == 'i15':
        # Side-by-side detail of west moonlit cove (0..380, 140..660) + moon-well & south lily pond (660..1460, 440..840)
        cove = fr.crop((0, 140, 380, 660))
        pond = fr.crop((660, 440, 1460, 840)).resize((620, 310), Image.Resampling.LANCZOS)
        cove_r = cove.resize((226, 310), Image.Resampling.LANCZOS)
        tile = Image.new('RGB', (226 + 4 + 620, 310), (16, 18, 28))
        tile.paste(cove_r, (0, 0))
        tile.paste(pond, (230, 0))
        cropped.append(tile)
    else:
        cr = fr.crop((x0, y0, x1, y1))
        tw = 540 if island == 'i10' else 640
        th = round(tw * cr.height / cr.width)
        cropped.append(cr.resize((tw, th), Image.Resampling.LANCZOS))

tw, th = cropped[0].size
strip = Image.new('RGB', (tw * 3 + 16, th * 2 + 12), (18, 16, 14))
draw = ImageDraw.Draw(strip)
for i, tile in enumerate(cropped):
    col, row = i % 3, i // 3
    px, py = 4 + col * (tw + 4), 4 + row * (th + 4)
    strip.paste(tile, (px, py))
    draw.rectangle((px + 6, py + 6, px + 96, py + 26), fill=(18, 16, 14))
    draw.text((px + 12, py + 10), f't = +{i * 0.6:.1f}s', fill=(255, 240, 200))
strip.save(out_dir / 'strip-waterfx.jpg', quality=88)

# Also save a zoomed 6x diff of the cropped water/dust area between f0 and f3 (1.8 s apart) to inspect edge stability!
f0_arr = np.asarray(cropped[0], dtype=np.int16)
f3_arr = np.asarray(cropped[3], dtype=np.int16)
crop_heat = np.clip(np.abs(f0_arr - f3_arr) * 6, 0, 255).astype(np.uint8)
Image.fromarray(crop_heat).save(out_dir / 'diff-crop-6x.jpg', quality=88)

print(json.dumps(res))
`;
    const pixelDiff = JSON.parse(execFileSync('python3', ['-c', pyPost, island, tmpDir, outDir], { encoding: 'utf8' }));
    const islandReport = {
      island,
      perf,
      liveLife,
      shotLife,
      medLife,
      liveAmbient,
      pixelDiff,
      reducedDisabled: !reducedState.enabled && !reducedState.built,
      lowDisabled: true,
      errors,
    };
    writeFileSync(join(outDir, 'measurements.json'), JSON.stringify(islandReport, null, 2) + '\n');
    allResults.push(islandReport);
    console.log(
      `${island}: before=${pixelDiff.before.pct_gt30}% -> after=${pixelDiff.after.pct_gt30}% (gt15: ${pixelDiff.before.pct_gt15}% -> ${pixelDiff.after.pct_gt15}%, crop_gt15=${pixelDiff.crop_after.pct_gt15}%, sway=${liveLife.swayReady}, water=${liveLife.waterReady}, haze=${liveLife.hazeReady}, dust=${liveLife.activeDust}, p50=${perf.p50Ms}ms)`,
    );
  }
} finally {
  await browser.close();
  rmSync(TMP_ROOT, { recursive: true, force: true });
}

writeFileSync('/tmp/sky-waterfx-summary.json', JSON.stringify(allResults, null, 2) + '\n');
