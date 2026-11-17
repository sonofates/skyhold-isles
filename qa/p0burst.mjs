// Burst screenshots of combat (projectiles / bolts / blasts) on ?autoplay=1 at 2x speed, desktop.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const OUT = 'qa-out/p0';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
await page.goto(`${BASE}/2d.html?autoplay=1`);
await page.waitForFunction(() => !!window.__p0, null, { timeout: 30000 });
await page.keyboard.press('2');
let shots = 0;
for (let i = 0; i < 400 && shots < 6; i++) {
  await page.waitForTimeout(150);
  const s = await page.evaluate(() => window.__p0.state());
  if (s.projectiles > 0 && s.wave >= 3) {
    await page.screenshot({ path: `${OUT}/combat-${shots}.png` });
    console.log(`combat-${shots}: wave ${s.wave} enemies ${s.enemies} projectiles ${s.projectiles} towers ${s.towers.length}`);
    shots++;
    await page.waitForTimeout(400);
  }
}
await browser.close();
