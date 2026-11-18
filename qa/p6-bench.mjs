// Run against the production build. External QA installations can supply Playwright and Chromium.
import { preview } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const seconds = Number(process.env.SECONDS_TO_SAMPLE || 12);
if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Expected a positive SECONDS_TO_SAMPLE');
const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({
    viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true,
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_RATE || 1) });
  await page.addInitScript(({ seconds }) => {
    let last, start, draws = 0;
    const frameTimes = [], drawCounts = [];
    // The public bench snapshot reports a trailing window and a single draw count. Collect every
    // presentation interval and GL submission in the requested window, including long stalls.
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
        const original = proto[name];
        if (original) proto[name] = function (...args) { draws++; return original.apply(this, args); };
      }
    }
    function frame(now) {
      if (start === undefined && window.__bench) {
        if (window.__p0.state().wave !== 20 && !window.__p0.skipToWave(20)) throw new Error('Unable to start wave 20');
        start = now + 6000;
      }
      if (last >= start) {
        frameTimes.push(now - last);
        drawCounts.push(draws);
        if (now - start >= seconds * 1000) {
          const stats = window.__p0.state();
          const quantile = (a, q) => a[Math.ceil(a.length * q) - 1];
          frameTimes.sort((a, b) => a - b);
          drawCounts.sort((a, b) => a - b);
          window.p6Result = {
            samples: frameTimes.length, wave: stats.wave, towers: stats.towers.length, enemies: stats.enemies,
            fps: 1000 * frameTimes.length / frameTimes.reduce((a, b) => a + b, 0),
            frameMs: [quantile(frameTimes, 0.5), quantile(frameTimes, 0.95), frameTimes.at(-1)],
            drawCalls: [quantile(drawCounts, 0.5), quantile(drawCounts, 0.95)],
            tier: stats.quality, canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height],
            particles: stats.fx.pools.particles, trailingWindow: window.__bench,
          };
          return;
        }
      }
      last = now;
      draws = 0;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }, { seconds });
  const url = new URL('/2d.html', server.resolvedUrls.local[0]);
  url.search = process.env.BENCH_QUERY || 'bench=150&level=i16&endless=1&wave=20';
  await page.goto(url.href);
  if (process.env.BENCH_AUDIO === '1') {
    await page.waitForFunction(() => !!window.__p0);
    await page.mouse.click(5, 5);
  }
  await page.waitForFunction(() => window.p6Result, null, { timeout: 90000 + seconds * 1000 });
  const result = await page.evaluate(() => window.p6Result);
  if (errors.length) throw new Error(errors.join('\n'));
  if (result.wave < 20 || !result.towers || !result.drawCalls[0]) throw new Error(JSON.stringify(result));
  console.log(JSON.stringify({ browser: browser.version(), cpuRate: Number(process.env.CPU_RATE || 1), audio: process.env.BENCH_AUDIO === '1', query: url.search, ...result }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
