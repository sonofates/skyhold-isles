// Capture live wave-one walkers through the fixed gate on each island, at device resolution.
// Uses the Vite development entry so CDP can find the running Game2D by its module prototype.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const { chromium } = createRequire(import.meta.url)('playwright');
const output = process.env.OUT ?? 'docs/castle-v3-shots';
const ids = process.env.IDS?.split(',') ?? ['l1c', ...Array.from({ length: 16 }, (_, i) => 'i' + String(i + 1).padStart(2, '0'))];
const views = [
  { name: '1920x1080-dpr2', width: 1920, height: 1080, dpr: 2, texels: 3 },
  { name: 'phone-844x390-dpr3', width: 844, height: 390, dpr: 3, texels: 1.5 },
];
mkdirSync(output, { recursive: true });

async function liveGame(context, page) {
  const cdp = await context.newCDPSession(page);
  try {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: "import('/src/render2d/game2d.ts').then(m => m.Game2D.prototype)",
      awaitPromise: true,
    });
    const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: result.objectId });
    const handle = await cdp.send('Runtime.callFunctionOn', {
      objectId: objects.objectId,
      functionDeclaration: 'function() { if (this.length !== 1) throw Error("Expected one game"); window.castleCaptureGame = this[0]; }',
    });
    assert.ok(!handle.exceptionDetails, handle.exceptionDetails?.exception?.description);
  } finally {
    await cdp.detach();
  }
}

async function capture(browser, base, id, view) {
  const viewport = { width: view.width, height: view.height };
  const mobile = view.dpr === 3;
  const context = await browser.newContext({ viewport, deviceScaleFactor: view.dpr, isMobile: mobile, hasTouch: mobile });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
    await page.goto(base + '/2d.html?level=' + id + '&hero=none&lang=en&quality=high');
    await page.waitForFunction(s => window.__p0?.state().mapInfo.texelScale === s, view.texels, { timeout: 90000 });
    const state = await page.evaluate(() => window.__p0.state());
    const layout = JSON.parse(readFileSync('src/data/levels2d/' + id + '.json'));
    assert.equal(state.mapInfo.gateFronts, layout.entrances.length + 1);
    assert.deepEqual(state.render.canvasPx, [view.width * view.dpr, view.height * view.dpr]);
    const [x, y, w, h] = layout.goalGate.front.rect;
    const [gx, gy] = layout.goal;
    const { offsetX, offsetY, scale } = state.fit;
    const left = Math.max(0, Math.floor(offsetX + (Math.min(x, gx-120)-22)*scale));
    const right = Math.min(view.width, Math.ceil(offsetX + (Math.max(x+w, gx+120)+22)*scale));
    const top = Math.max(0, Math.floor(offsetY + (Math.min(y, gy-95)-15)*scale));
    const bottom = Math.min(view.height, Math.ceil(offsetY + (Math.max(y+h, gy+70)+15)*scale));
    const clip = { x: left, y: top, width: right-left, height: bottom-top };

    await liveGame(context, page);
    await page.evaluate(() => window.__p0.freeze(true));
    await page.keyboard.press('n');
    const sequence = ['i06', 'i08', 'i10', 'l1c'].includes(id)
      ? [['approach', 49], ['threshold', 21], ['inside', 5]]
      : [['threshold', 21]];
    for (const [phase, distance] of sequence) {
      const walker = await page.evaluate(({ distance, unit }) => {
        const game = window.castleCaptureGame;
        // Advance the normal frame method. Units spawn, walk and leak through the same sim and
        // renderer as the interactive game. Keep the ticker stopped for the device-pixel crop.
        for (let n = 0; n < 20000; n++) {
          game.frame(1/60);
          const first = game.debugState().enemyPx.find(e => e.toGoal*unit <= distance);
          if (first) {
            game.app.render();
            return first;
          }
        }
        throw Error('No ground walker reached the gate');
      }, { distance, unit: layout.pxPerUnit ?? 50 });
      await page.screenshot({ path: output + '/' + id + '-' + view.name + '-' + phase + '.jpg', clip, quality: 94 });
      console.log(id, view.name, phase, walker.type, walker.toGoal, walker.px, walker.py);
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null, hmr: false } });
try {
  await server.listen();
  const base = 'http://127.0.0.1:' + server.httpServer.address().port;
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    for (const id of ids) for (const view of views) await capture(browser, base, id, view);
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
