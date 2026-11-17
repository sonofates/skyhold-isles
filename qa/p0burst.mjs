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
// Bench close-ups until a lightning bolt and a cannonball are on screen.
const bp = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })).newPage();
await bp.goto(`${BASE}/2d.html?bench=150`);
await bp.waitForFunction(() => !!window.__p0, null, { timeout: 30000 });
await bp.waitForTimeout(3000);
let lastBolts = 0;
let n = 0;
for (let i = 0; i < 200 && n < 4; i++) {
  const s = await bp.evaluate(() => window.__p0.state());
  if (s.fx.boltsDrawn > lastBolts) {
    lastBolts = s.fx.boltsDrawn;
    await bp.screenshot({ path: `${OUT}/bolt-${n}.png` });
    console.log(`bolt-${n}: bolts drawn ${s.fx.boltsDrawn}, particles ${s.fx.particlesSpawned}, projectiles ${s.projectiles}`);
    n++;
  }
  await bp.waitForTimeout(40);
}
await browser.close();
