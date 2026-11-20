// HUD tray key badges with the keyboard and in pad mode (html.pu-pad): shoots the hero/ability tray.
// Usage: node qa/padbadgeshot.mjs [--base=..] [--out=/tmp/n2opus-badge] [--size=1920x1080]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? '/tmp/n2opus-badge';
const [W, H] = (arg('size') ?? '1920x1080').split('x').map(Number);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
page.setDefaultTimeout(90000);
await page.goto(`${BASE}/2d.html?level=i02&hero=bran&lang=en&desktop=1`);
await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'));
await page.waitForTimeout(1500);
await page.evaluate(() => window.__p0.freeze?.(true));
const clip = await page.evaluate(() => {
  const els = [...document.querySelectorAll('.pu-ab-key')].map((e) => e.closest('.pu-ab, .pu-hero-port, [class*="port"]') ?? e);
  const rs = els.map((e) => e.getBoundingClientRect());
  const x0 = Math.min(...rs.map((r) => r.left)) - 20;
  const y0 = Math.min(...rs.map((r) => r.top)) - 20;
  const x1 = Math.max(...rs.map((r) => r.right)) + 20;
  const y1 = Math.max(...rs.map((r) => r.bottom)) + 20;
  return { x: Math.max(0, x0), y: Math.max(0, y0), width: x1 - x0, height: y1 - y0 };
});
await page.screenshot({ path: `${OUT}/keys.png`, clip });
await page.evaluate(() => document.documentElement.classList.add('pu-pad'));
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/pad.png`, clip });
await browser.close();
