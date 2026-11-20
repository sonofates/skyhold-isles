/**
 * Headless low-end performance benchmark for `i16` and `i24` Boss at Hard with L20 heroes +
 * continuous global ability & hero skill spam.
 *
 * Runs against the production Vite bundle (`dist/`) using Chromium SwiftShader
 * (`915 × 412` @ DPR `2.6`, WebAudio unlocked and playing, configurable `CPU_RATE=1` or `4`).
 */
import { preview } from 'vite';

interface BenchScenario {
  readonly name: string;
  readonly query: string;
  readonly targetWave: number;
}

interface LowEndResult {
  readonly samples: number;
  readonly wave: number;
  readonly towers: number;
  readonly peakEnemiesSeen: number;
  readonly fps: number;
  readonly frameMs: readonly [number, number, number];
  readonly drawCalls: readonly [number, number];
  readonly tier: string;
  readonly canvas: readonly [number, number];
  readonly casts: {
    readonly meteor: number;
    readonly overcharge: number;
    readonly hero0: number;
    readonly hero1: number;
    readonly moves: number;
  };
}

interface PlaywrightModule {
  readonly chromium: {
    launch(opts: { executablePath?: string; args?: string[] }): Promise<{
      version(): string;
      newContext(opts: Record<string, unknown>): Promise<{
        newPage(): Promise<{
          on(event: 'pageerror', cb: (err: Error) => void): void;
          addInitScript(script: string): Promise<void>;
          goto(url: string): Promise<unknown>;
          waitForFunction(
            expr: string,
            arg?: unknown,
            opts?: { timeout?: number },
          ): Promise<unknown>;
          mouse: { click(x: number, y: number): Promise<void> };
          evaluate<R>(expr: string): Promise<R>;
        }>;
        newCDPSession(page: unknown): Promise<{
          send(method: string, params: Record<string, unknown>): Promise<unknown>;
        }>;
        close(): Promise<void>;
      }>;
      close(): Promise<void>;
    }>;
  };
}

const SCENARIOS: readonly BenchScenario[] = [
  {
    name: 'i16-boss-hard-mira20-spam',
    query: 'level=i16&diff=hard&autoplay=1&wave=16&hero=mira&herolevel=20',
    targetWave: 16,
  },
  {
    name: 'i16-boss-hard-bran20-spam',
    query: 'level=i16&diff=hard&autoplay=1&wave=16&hero=bran&herolevel=20',
    targetWave: 16,
  },
  {
    name: 'i24-boss-hard-sela20-spam',
    query: 'level=i24&diff=hard&autoplay=1&wave=14&hero=sela&herolevel=20',
    targetWave: 14,
  },
  {
    name: 'i24-boss-hard-tobb20-spam',
    query: 'level=i24&diff=hard&autoplay=1&wave=14&hero=tobb&herolevel=20',
    targetWave: 14,
  },
];

function buildBrowserProbeScript(sampleSeconds: number, targetWave: number): string {
  return `(() => {
    const sampleSeconds = ${JSON.stringify(sampleSeconds)};
    const targetWave = ${JSON.stringify(targetWave)};
    let draws = 0;
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
        const original = proto[name];
        if (original) {
          proto[name] = function (...args) {
            draws++;
            return original.apply(this, args);
          };
        }
      }
    }

    let initialized = false;
    let sampleStart;
    let last;
    let lastSkipAt = 0;
    let frameIdx = 0;
    let castsMeteor = 0;
    let castsOvercharge = 0;
    let castsHero0 = 0;
    let castsHero1 = 0;
    let heroMoves = 0;
    let maxEnemies = 0;
    const frameTimes = [];
    const drawCounts = [];

    function step(now) {
      const p0 = window.__p0;
      if (!initialized && p0 && !document.getElementById('boot')) {
        const st = p0.state();
        if (st && st.wave >= 1) {
          initialized = true;
          // Fund the island's realistic endgame scripted build order (autoplay=1) without over-building 24×T3.
          p0.setGold(2600);
          p0.setLives(999);
          p0.skipToWave(targetWave);
          p0.hero.move(0, 0);
          lastSkipAt = now;
          // Let Wave 1 + post-boot lazy HUD/icon imports settle for 5.0 s before sampling combat frames.
          sampleStart = now + 5000;
        }
      }

      if (initialized && p0) {
        if (frameIdx % 20 === 0) {
          const st = p0.state();
          if (st.enemies > maxEnemies) maxEnemies = st.enemies;
          if (st.lives < 200) p0.setLives(999);
          // Re-trigger boss wave only if the entire wave cleared after >= 18 s.
          if (now - lastSkipAt > 18000 && st.enemies <= 1) {
            p0.skipToWave(targetWave);
            lastSkipAt = now;
          }
        }
        if (frameIdx % 6 === 0) {
          const foe = p0.hero.nearestEnemy();
          if (foe) {
            if (p0.replay.cmd({ k: 'meteor', x: foe.x, z: foe.z })) castsMeteor++;
            if (p0.replay.cmd({ k: 'overcharge' })) castsOvercharge++;
            if (p0.hero.cast(0, foe.x, foe.z)) castsHero0++;
            if (p0.hero.cast(1, foe.x, foe.z)) castsHero1++;
            if (frameIdx % 90 === 0 && p0.hero.move(foe.x, foe.z)) heroMoves++;
          }
        }
        frameIdx++;
      }

      if (sampleStart !== undefined && last !== undefined && last >= sampleStart && p0) {
        frameTimes.push(now - last);
        drawCounts.push(draws);
        if (now - sampleStart >= sampleSeconds * 1000) {
          const st = p0.state();
          const quantile = (a, q) => a[Math.max(0, Math.ceil(a.length * q) - 1)] || 0;
          const sortedFrames = [...frameTimes].sort((a, b) => a - b);
          const sortedDraws = [...drawCounts].sort((a, b) => a - b);
          const r1 = (v) => Math.round(v * 10) / 10;
          const canvasEl = document.querySelector('canvas');
          window.__lowEndResult = {
            samples: sortedFrames.length,
            wave: st.wave,
            towers: st.towers.length,
            peakEnemiesSeen: Math.max(maxEnemies, st.enemies),
            fps: r1((1000 * sortedFrames.length) / sortedFrames.reduce((a, b) => a + b, 0)),
            frameMs: [
              r1(quantile(sortedFrames, 0.5)),
              r1(quantile(sortedFrames, 0.95)),
              r1(sortedFrames[sortedFrames.length - 1] || 0),
            ],
            drawCalls: [quantile(sortedDraws, 0.5), quantile(sortedDraws, 0.95)],
            tier: st.quality,
            canvas: [canvasEl ? canvasEl.width : 0, canvasEl ? canvasEl.height : 0],
            casts: {
              meteor: castsMeteor,
              overcharge: castsOvercharge,
              hero0: castsHero0,
              hero1: castsHero1,
              moves: heroMoves,
            },
          };
          return;
        }
      }

      last = now;
      draws = 0;
      requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  })();`;
}

async function main(): Promise<void> {
  const pwModulePath = process.env.PLAYWRIGHT_MODULE ?? 'playwright';
  const { chromium } = (await import(pwModulePath)) as PlaywrightModule;
  const seconds = Number(process.env.SECONDS_TO_SAMPLE ?? 16);
  const cpuRate = Number(process.env.CPU_RATE ?? 1);
  const enableAudio = process.env.BENCH_AUDIO === '1';
  const maxFrameBudgetMs = Number(process.env.MAX_FRAME_MS ?? 100);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('Expected a positive SECONDS_TO_SAMPLE');
  }

  const filter = process.env.BENCH_FILTER ?? '';
  const activeScenarios = filter
    ? SCENARIOS.filter((s) => s.name.includes(filter))
    : SCENARIOS;

  const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
  let browser: Awaited<ReturnType<PlaywrightModule['chromium']['launch']>> | undefined;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROME_BIN || undefined,
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-dev-shm-usage',
      ],
    });

    for (const sc of activeScenarios) {
      const context = await browser.newContext({
        viewport: { width: 915, height: 412 },
        deviceScaleFactor: 2.6,
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });

      await page.addInitScript(buildBrowserProbeScript(seconds, sc.targetWave));

      const baseUrl = server.resolvedUrls?.local[0];
      if (!baseUrl) throw new Error('Vite preview server missing local URL');
      const url = new URL('/2d.html', baseUrl);
      url.search = sc.query;
      await page.goto(url.href);
      await page.waitForFunction('Boolean(window.__p0) && !document.getElementById("boot")');
      if (enableAudio) {
        await page.mouse.click(450, 200);
      }

      await page.waitForFunction('Boolean(window.__lowEndResult)', null, {
        timeout: 90_000 + seconds * 1000,
      });
      const res = await page.evaluate<LowEndResult>('window.__lowEndResult');
      await context.close();

      if (errors.length > 0) {
        throw new Error(`${sc.name} pageerror: ${errors.join('\n')}`);
      }
      if (
        res.casts.meteor < 1 ||
        res.casts.overcharge < 1 ||
        res.casts.hero0 + res.casts.hero1 < 2
      ) {
        throw new Error(
          `${sc.name} expected Meteor + Overcharge + Hero skill spam casts, got ${JSON.stringify(res.casts)}`,
        );
      }
      if (res.frameMs[2] > maxFrameBudgetMs) {
        throw new Error(
          `${sc.name} exceeded ${maxFrameBudgetMs} ms max frame budget after Wave 1: max=${res.frameMs[2]} ms (${JSON.stringify(res)})`,
        );
      }

      console.log(
        JSON.stringify({
          scenario: sc.name,
          browser: browser.version(),
          cpuRate,
          query: url.search,
          ...res,
        }),
      );
    }
  } finally {
    await browser?.close();
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  }
}

void main();
