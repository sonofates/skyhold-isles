// Ending flow from a run (docs/handoff-ending.md): `?end=won&story=ending` on an island plays the
// ending over the won board (beats → credits roll), and skipping both lands on the world map.
// ONE Chromium, one page. Usage: python3 /tmp/skyend_dev.py node qa/endingflow.mjs
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4637';
const problems = [];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  await page.goto(`${BASE}/2d.html?level=l1c&end=won&story=ending&desktop=1&lang=en`);
  await page.waitForSelector('[data-testid="ending2d"]', { timeout: 60000 });
  await page.waitForTimeout(600);
  await page.click('[data-testid="ending2d-skip"]');
  await page.waitForSelector('[data-testid="roll2d"]', { timeout: 5000 });
  await page.waitForTimeout(800);
  await page.click('[data-testid="roll2d-skip"]');
  await page.waitForSelector('[data-testid="worldmap2d"]', { timeout: 30000 });
  const url = page.url();
  if (url.includes('level=')) problems.push(`still on the island: ${url}`);
  console.log(`landed on ${url}`);
} catch (e) {
  problems.push(String(e));
} finally {
  await browser.close();
}
console.log(problems.length ? `PROBLEMS (${problems.length}):\n${problems.join('\n')}` : 'no problems');
