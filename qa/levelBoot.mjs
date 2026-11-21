// Start vite preview first. One cache-priming navigation, then three new documents in that context.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
  for (let i = 0; i <= 3; i++) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => performance.setResourceTimingBufferSize(2000));
    await page.goto(base + '/2d.html?level=i07&lang=tr&boottrace=1', { waitUntil: 'commit' });
    await page.waitForFunction(() => window.__p0?.state() && !document.querySelector('#boot'));
    const result = await page.evaluate(() => {
      const phases = Object.fromEntries(performance.getEntriesByType('measure')
        .filter(e => e.name.startsWith('boot:')).map(e => [e.name.slice(5), Math.round(e.duration)]));
      const ready = performance.getEntriesByName('boot:interactive', 'mark')[0].startTime;
      const resources = performance.getEntriesByType('resource').filter(e => e.responseEnd <= ready);
      return { ready: Math.round(ready), requests: resources.length, cached: resources.filter(e => e.transferSize === 0).length,
        lastResponse: Math.round(Math.max(...resources.map(e => e.responseEnd))), phases };
    });
    // Use the actual canvas input path. Include the next paint opportunity in the observation.
    const plot = await page.evaluate(() => window.__p0.plotScreen(5));
    await page.mouse.click(plot.x, plot.y);
    await page.waitForFunction(() => window.__p0.state().ring.open);
    result.plotOpen = await page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => resolve(Math.round(performance.now())));
    }));
    await page.waitForFunction(() => window.__p0.textureWarmup()?.allResidentAt != null, null, { timeout: 300_000 });
    result.textures = await page.evaluate(() => {
      const { total, pending, uploaded, gpuConfirmed, worstSliceMs } = window.__p0.textureWarmup();
      const phase = performance.getEntriesByName('boot:all-textures-resident', 'measure')[0];
      return { total, pending, uploaded, gpuConfirmed, worstSliceMs, afterInteractive: Math.round(phase.duration),
        sinceNavigation: Math.round(phase.startTime + phase.duration) };
    });
    if (result.textures.pending || !result.textures.gpuConfirmed) throw new Error(JSON.stringify(result.textures));
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(i ? 'warm' : 'prime', JSON.stringify(result));
    await page.close();
  }
  // Separate document so GL instrumentation and immediate combat do not affect the boot medians.
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(probeWave);
  await page.goto(base + '/2d.html?level=i07&lang=tr&speed=4&boottrace=1', { waitUntil: 'commit' });
  await page.waitForFunction(() => window.waveReport, null, { timeout: 90_000 });
  const wave = await page.evaluate(() => window.waveReport);
  if (wave.error) throw new Error(wave.error);
  // A busy GPU can take longer than the observation window to drain the catalog.
  await page.waitForFunction(() => window.__p0.textureWarmup().allResidentAt != null, null, { timeout: 300_000 });
  wave.completed = await page.evaluate(() => window.__p0.textureWarmup());
  console.log('wave', JSON.stringify(wave));
  if (errors.length) throw new Error(errors.join('\n'));
  if (!wave.pendingAtStart || !wave.sawEnemies || !wave.sawProjectiles || !wave.completed.gpuConfirmed) {
    throw new Error('Incomplete wave probe');
  }
  if (wave.framesWith50msOfUploads) throw new Error('Texture calls occupied >50 ms in a wave frame');
} finally {
  await browser.close();
}

// Bracket the game's ticker with successive rAF callbacks. Count synchronous GL time inside the
// interval that actually contained the call, including on-demand draws, the warmer and HUD updates.
function probeWave() {
  const frames = [];
  let started = 0;
  let previous = 0;
  let calls = 0;
  let mipmaps = 0;
  let worstCall = null;
  let uploadMs = 0;
  let videoMs = 0;
  let sawEnemies = false;
  let sawProjectiles = false;
  let pendingAtStart = 0;
  function observe() {
    const p = window.__p0;
    if (!started && p?.textureWarmup && !document.querySelector('#boot')) {
      previous = started = performance.now();
      pendingAtStart = p.textureWarmup().pending;
      const gl = document.querySelector('#stage canvas').getContext('webgl2');
      if (!gl) {
        window.waveReport = { error: 'Expected WebGL2 for texture attribution' };
        return;
      }
      for (const key of ['texImage2D', 'texSubImage2D', 'texStorage2D', 'compressedTexImage2D',
        'compressedTexSubImage2D', 'generateMipmap']) {
        const original = gl[key];
        gl[key] = function (...args) {
          const t = performance.now();
          try {
            return original.apply(this, args);
          } finally {
            const ms = performance.now() - t;
            uploadMs += ms;
            if (args.at(-1) instanceof HTMLVideoElement) videoMs += ms;
            if (!worstCall || ms > worstCall.ms) {
              const image = args.at(-1);
              worstCall = { op: key, ms: +ms.toFixed(1), kind: image?.constructor.name,
                width: image?.videoWidth || image?.width, height: image?.videoHeight || image?.height };
            }
            calls++;
            if (key === 'generateMipmap') mipmaps++;
          }
        };
      }
      const built = [[4, 'archer'], [2, 'frost']].every(([plot, type]) => p.replay.cmd({ k: 'build', plot, type }));
      if (!built || !p.replay.cmd({ k: 'wave' }) || p.state().speed !== 4 || p.state().wave !== 1) {
        window.waveReport = { error: 'Failed to start wave 1 at 4× with both towers' };
        return;
      }
    } else if (started) {
      const now = performance.now();
      frames.push({ at: previous - started, ms: now - previous, calls, mipmaps, uploadMs, videoMs, worstCall });
      worstCall = null;
      previous = now;
      uploadMs = videoMs = calls = mipmaps = 0;
      // Check combat coverage occasionally to keep debug snapshots off the hot path.
      if (frames.length % 10 === 1 && !(sawEnemies && sawProjectiles)) {
        const state = p.state();
        sawEnemies ||= state.enemies > 0;
        sawProjectiles ||= state.projectiles > 0;
      }
      if (now - started >= 20_000) {
        const slow = frames.filter(f => f.ms > 50);
        const crossings = slow.filter(f => f.ms - f.uploadMs <= 50);
        const byFrame = (a, b) => b.ms - a.ms;
        const top = list => list.slice(0, 5).map(f => ({ ...f, at: Math.round(f.at),
          ms: +f.ms.toFixed(1), uploadMs: +f.uploadMs.toFixed(1), videoMs: +f.videoMs.toFixed(1) }));
        window.waveReport = {
          durationMs: Math.round(now - started), frames: frames.length, over50ms: slow.length,
          slowFramesWithUploads: slow.filter(f => f.calls).length,
          crossed50msWithUploadTime: crossings.length,
          worstCrossings: top(crossings.sort(byFrame)),
          framesWith50msOfVideo: frames.filter(f => f.videoMs > 50).length,
          framesWith50msOfUploads: frames.filter(f => f.uploadMs > 50).length,
          pendingAtStart, sawEnemies, sawProjectiles, textures: p.textureWarmup(),
          worstFrames: top(frames.sort(byFrame)),
          worstUploadFrames: top(frames.filter(f => f.calls).sort((a, b) => b.uploadMs - a.uploadMs)),
        };
        return;
      }
    }
    requestAnimationFrame(observe);
  }
  requestAnimationFrame(observe);
}
