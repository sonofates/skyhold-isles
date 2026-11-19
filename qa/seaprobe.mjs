// Probe: which animations run on the world map, and the layer / paint picture (debug helper).
// Usage: python3 qa/withPreview.py --port=4393 node qa/seaprobe.mjs [--desktop=1] [--w=1920 --h=1080 --dpr=1]
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const touch = arg('touch') === '1';
const ctx = await browser.newContext({ viewport: { width: Number(arg('w') ?? 1920), height: Number(arg('h') ?? 1080) }, deviceScaleFactor: Number(arg('dpr') ?? 1), isMobile: touch, hasTouch: touch });
const page = await ctx.newPage();
await page.goto(`${BASE}/2d.html?lang=en&desktop=${arg('desktop') ?? 1}${arg('extra') ?? ''}`);
await page.waitForFunction(() => !!window.__map && !document.getElementById('boot'), null, { timeout: 60000 });
await page.waitForTimeout(4000);
const anims = await page.evaluate(() =>
  document.getAnimations().map((a) => {
    const t = a.effect?.target;
    return `${a.animationName ?? a.constructor.name} ${a.playState} on ${t?.tagName}.${String(t?.className?.baseVal ?? t?.className ?? '').slice(0, 40)}`;
  }),
);
console.log(anims.length, 'animations');
console.log(anims.slice(0, 40).join('\n'));
const sea = await page.evaluate(() => window.__sea?.stats?.() ?? null);
console.log('sea', JSON.stringify(sea));
await browser.close();
