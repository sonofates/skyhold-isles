// Battle loading screen: shoots the boot screen (island name + tip card) while a level loads, EN/TR.
// Usage: node qa/bootshot.mjs [--base=..] [--out=/tmp/n2opus-boot] [--size=2000x991] [--touch=1]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? '/tmp/n2opus-boot';
const SIZE = arg('size') ?? '2000x991';
const [W, H] = SIZE.split('x').map(Number);
const touch = arg('touch') === '1';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let bad = 0;
for (const lang of ['en', 'tr']) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  // Hold the battle's map painting back so the boot screen stays up long enough to shoot.
  await page.route(/\/art2d\/maps\//, async (route) => {
    await new Promise((r) => setTimeout(r, 8000));
    await route.continue().catch(() => undefined);
  });
  await page.goto(`${BASE}/2d.html?level=i06&hero=bran&lang=${lang}`, { waitUntil: 'domcontentloaded' });
  const got = await page.waitForSelector('#boot .boot-tip', { timeout: 30000 }).then(() => true).catch(() => false);
  const info = await page.evaluate(() => ({ line: document.querySelector('#boot .boot-text')?.textContent, tip: document.querySelector('#boot .boot-tip')?.textContent }));
  console.log(lang, SIZE, got ? 'tip shown' : 'NO TIP', JSON.stringify(info));
  if (!got) bad++;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${lang}-${SIZE}-boot.jpg`, type: 'jpeg', quality: 85, timeout: 120000 });
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
