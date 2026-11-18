// Owner feedback 2026-11-18 probe: logs the chosen map variant, renderer resolution, quality tier,
// canvas and map texture size at desktop / phone sizes, at boot and after some seconds of play.
// Usage: node qa/fbprobe.mjs [--base=http://127.0.0.1:4317] [--query=level=l1c] [--hold=6000] [--only=1920]
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4317';
const QUERY = arg('query') ?? 'level=l1c';
const HOLD = Number(arg('hold') ?? 6000);
const ONLY = arg('only') ?? '';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const SIZES = [
  { key: '1920x1080@1', w: 1920, h: 1080, dpr: 1 },
  { key: '1920x1080@2', w: 1920, h: 1080, dpr: 2 },
  { key: '2560x1440@1', w: 2560, h: 1440, dpr: 1 },
  { key: '2560x1440@2', w: 2560, h: 1440, dpr: 2 },
  { key: '2000x1034@1', w: 2000, h: 1034, dpr: 1 },
  { key: '844x390@3 phone', w: 844, h: 390, dpr: 3, touch: true },
].filter((s) => s.key.includes(ONLY));

const browser = await chromium.launch({ args: ARGS });
for (const s of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: s.dpr,
    isMobile: !!s.touch,
    hasTouch: !!s.touch,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/2d.html?${QUERY}`);
  await page.waitForFunction(() => !!window.__p0?.state, null, { timeout: 60000 });
  const read = () =>
    page.evaluate(() => {
      const st = window.__p0.state();
      return { tier: st.quality, map: st.mapInfo, render: st.render, fit: st.fit.scale, wave: st.waveState };
    });
  const fmt = (r) =>
    `tier=${r.tier} res=${r.render.resolution.toFixed(3)} rscale=${r.render.resolutionScale.toFixed(3)} ` +
    `canvas=${r.render.canvasPx.join('x')} map=${r.map.texturePx.join('x')} texel=${r.map.texelScale.toFixed(2)} ` +
    `need=${(r.fit * r.render.resolution).toFixed(2)} desktop=${r.render.desktop}`;
  console.log(`${s.key.padEnd(16)} boot : ${fmt(await read())}`);
  // Start wave 1 so the sample includes combat load.
  await page.evaluate(() => window.__p0.skipToWave?.(1));
  await page.waitForTimeout(HOLD);
  console.log(`${''.padEnd(16)} +${HOLD / 1000}s: ${fmt(await read())}`);
  await ctx.close();
}
await browser.close();
