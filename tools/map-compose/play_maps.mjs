// Capture full device-pixel frames from the built game. Run npm run build first.
// NODE_PATH=<playwright modules> node tools/map-compose/play_maps.mjs <output dir> [island ...]
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { preview } from 'vite';

const { chromium } = createRequire(import.meta.url)('playwright');
const [output, ...ids] = process.argv.slice(2);
if (!output) throw new Error('Expected an output directory and optional island IDs');
if (!ids.length) ids.push('l1c', ...Array.from({ length: 16 }, (_, i) => 'i' + String(i + 1).padStart(2, '0')));
await mkdir(output, { recursive: true });

const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
try {
  const base = 'http://127.0.0.1:' + server.httpServer.address().port;
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    for (const [width, height, dpr] of [[1920, 1080, 1], [1920, 1080, 2], [844, 390, 3]]) {
      for (const id of ids) {
        const context = await browser.newContext({
          viewport: { width, height }, deviceScaleFactor: dpr,
          isMobile: width === 844, hasTouch: width === 844, serviceWorkers: 'block',
        });
        try {
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          page.on('response', res => { if (res.status() >= 400) errors.push(res.status() + ' ' + res.url()); });
          const layout = JSON.parse(await readFile('src/data/levels2d/' + id + '.json', 'utf8'));
          await page.goto(base + '/2d.html?level=' + encodeURIComponent(id) + '&towers=1&tier=1&lang=en&quality=high');
          await page.waitForFunction(() => {
            const state = window.__p0?.state();
            return state?.towers.length > 0 && state.enemyPx.length >= 3;
          }, null, { timeout: 90000 });
          const state = await page.evaluate(() => {
            window.__p0.freeze(true);
            return window.__p0.state();
          });
          assert.equal(state.mapInfo.key.split('@')[0], layout.image);
          assert.equal(state.mapInfo.gateFronts, layout.entrances.length + 1);
          assert.deepEqual(state.render.canvasPx, [width * dpr, height * dpr]);
          assert.deepEqual(errors, []);
          await page.screenshot({ path: path.join(output, id + '-' + width + '-dpr' + dpr + '.jpg'), quality: 90 });
          console.log(id, width, height, dpr, state.mapInfo.key, state.enemyPx.length, state.towers.length);
        } finally {
          // Release the WebGL context and its large textures before opening the next island.
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
