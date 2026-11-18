// Against a local Vite preview. Hold the optional 3x requests so both captures use the same
// island, fit and framebuffer. Each PNG contains native device pixels from the game canvas.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.BASE ?? 'http://127.0.0.1:4173';
const out = process.env.OUT ?? 'docs/3x-shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function capture(viewport, dpr, id) {
  const { width, height } = viewport;
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr });
  const page = await context.newPage();
  const layout = JSON.parse(readFileSync(`src/data/levels2d/${id}.json`, 'utf8'));
  const fronts = [...layout.entrances.map((e) => e.gate.front), layout.goalGate.front];
  const [px, py] = layout.plots[3];
  const regions = [
    ['cave', fronts[0].rect, 10],
    ['castle', layout.goalGate.front.rect, 10],
    ['plot', [px - 74, py - 65, 148, 130], 0],
  ];
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  try {
    await page.route('**/*@3x.webp', async (route) => { await hold; await route.continue(); });
    await page.goto(`${base}/2d.html?level=${id}&quality=high&lang=en`);
    for (const [stage, scale] of [['before', 2], ['after', 3]]) {
      if (stage === 'after') release();
      await page.waitForFunction((s) => window.__p0?.state().mapInfo.texelScale === s, scale, { timeout: 90000 });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const { mapInfo, fit, render } = await page.evaluate(() => window.__p0.state());
      assert.deepEqual(render.canvasPx, [width * dpr, height * dpr]);
      assert.equal(mapInfo.gateFronts, fronts.length);
      fronts.forEach((f, i) => assert.ok(Math.abs(mapInfo.gateTextureWidths[i] - scale * f.rect[2]) <= 0.5));
      console.log(id, width, height, dpr, stage, mapInfo.key, mapInfo.texturePx, mapInfo.gateTextureWidths);
      for (const [name, [left, top, w, h], pad] of regions) {
        const x = Math.max(0, Math.floor(fit.offsetX + (left - pad) * fit.scale));
        const y = Math.max(0, Math.floor(fit.offsetY + (top - pad) * fit.scale));
        const right = Math.min(width, Math.ceil(fit.offsetX + (left + w + pad) * fit.scale));
        const bottom = Math.min(height, Math.ceil(fit.offsetY + (top + h + pad) * fit.scale));
        await page.screenshot({
          path: `${out}/${id}-${width}x${height}-dpr${dpr}-${name}-${stage}.png`,
          clip: { x, y, width: right - x, height: bottom - y },
        });
      }
    }
  } finally {
    release();
    await context.close();
  }
}

try {
  for (const [w, h, dpr] of [[3840, 2160, 1], [1920, 1080, 2]]) {
    for (const id of ['l1c', 'i16']) await capture({ width: w, height: h }, dpr, id);
  }
} finally {
  await browser.close();
}
