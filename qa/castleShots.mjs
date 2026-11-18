// Native device-pixel crops against a local 2D build. IDS can select a subset of the campaign.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.BASE ?? 'http://127.0.0.1:4173';
const out = process.env.OUT ?? 'docs/castle-shots';
const ids = process.env.IDS?.split(',') ?? ['l1c', ...Array.from({ length: 16 }, (_, i) => 'i' + String(i + 1).padStart(2, '0'))];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
function clip(x, y, w, h, viewport) {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  return { x: left, y: top, width: Math.min(viewport.width, Math.ceil(x + w)) - left,
    height: Math.min(viewport.height, Math.ceil(y + h)) - top };
}
async function capture(id, viewport, dpr, phone) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: phone, hasTouch: phone });
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
    const name = phone ? 'phone-844x390-dpr3' : '1920x1080-dpr2';
    const expectedScale = phone ? 1.5 : 3;
    await page.goto(base + '/2d.html?level=' + id + '&lang=en&quality=high');
    await page.waitForFunction(s => window.__p0?.state().mapInfo.texelScale === s, expectedScale, { timeout: 90000 });
    const state = await page.evaluate(() => window.__p0.state());
    const layout = JSON.parse(readFileSync('src/data/levels2d/' + id + '.json'));
    assert.equal(state.mapInfo.gateFronts, layout.entrances.length + 1);
    if (!phone) assert.deepEqual(state.render.canvasPx, [viewport.width * dpr, viewport.height * dpr]);
    const [x, y, w, h] = layout.goalGate.front.rect;
    const { offsetX, offsetY, scale } = state.fit;
    const pad = 55;
    const castle = clip(offsetX + (x-pad)*scale, offsetY + (y-pad)*scale, (w+2*pad)*scale, (h+2*pad)*scale, viewport);
    await page.screenshot({ path: out + '/' + id + '-' + name + '.jpg', clip: castle, quality: 91 });
    if (id === 'l1c') {
      const hud = state.hud.plaque;
      await page.screenshot({ path: out + '/gold-' + name + '.png', clip: clip(hud.x-4,hud.y-4,hud.w+8,hud.h+8,viewport) });
      const plot = await page.evaluate(() => window.__p0.plotScreen(4));
      await page.mouse.click(plot.x, plot.y);
      await page.waitForFunction(() => (window.__p0.state().ring.layout?.animT ?? 0) >= 0.99);
      const { tokens, layout: ring } = await page.evaluate(() => window.__p0.state().ring);
      await page.mouse.click(tokens[0].x, tokens[0].y);
      await page.waitForFunction(() => !!window.__p0.state().ring.layout?.tooltip);
      await page.waitForTimeout(250);
      const tip = await page.evaluate(() => window.__p0.state().ring.layout.tooltip);
      const left = Math.min(ring.box.x, tip.x), top = Math.min(ring.box.y, tip.y);
      const right = Math.max(ring.box.x + ring.box.w, tip.x + tip.w);
      const bottom = Math.max(ring.box.y + ring.box.h, tip.y + tip.h);
      await page.screenshot({ path: out + '/cost-' + name + '.jpg', clip: clip(left-5,top-5,right-left+10,bottom-top+10,viewport), quality: 91 });
    }
    if (id === 'i08' && !phone) {
      // The eastern plot is next to the diagonal gate and the bridge.
      const n = layout.plots.findIndex(([px, py]) => px === 976 && py === 372);
      assert.notEqual(n, -1);
      const plot = await page.evaluate(i => window.__p0.plotScreen(i), n);
      await page.mouse.click(plot.x, plot.y);
      await page.waitForFunction(() => window.__p0.state().ring.layout?.animT >= 1);
      const token = await page.evaluate(() => window.__p0.state().ring.tokens.find(t => t.enabled));
      await page.mouse.click(token.x, token.y);
      await page.mouse.click(token.x, token.y);
      await page.waitForFunction(() => window.__p0.state().towers.length > 0);
      await page.waitForTimeout(1000); // Let the construction dust clear the plot ring.
      const right = Math.max(castle.x + castle.width, plot.x + 60*scale);
      await page.screenshot({ path: out + '/i08-built-plot-' + name + '.jpg',
        clip: clip(castle.x, castle.y, right-castle.x, castle.height, viewport), quality: 91 });
    }
    assert.deepEqual(errors, []);
    console.log(id, name, state.mapInfo.key, state.render.canvasPx);
  } finally {
    await ctx.close();
  }
}
try {
  for (const id of ids) {
    await capture(id, { width: 1920, height: 1080 }, 2, false);
    await capture(id, { width: 844, height: 390 }, 3, true);
  }
} finally {
  await browser.close();
}
