// The interface-size slider moved while the world map is open: the map lays out again at once
// (caption gaps, the islands' band under the bigger top bar), no window resize needed.
// Usage: node qa/capgaplive.mjs [--base=..] [--size=2000x991] [--touch=1]
import { chromium } from 'playwright';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const [W, H] = (arg('size') ?? '2000x991').split('x').map(Number);
const touch = arg('touch') === '1';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch });
await ctx.addInitScript(() => {
  localStorage.setItem('skyhold_isles_coach2d_v1', '1');
  localStorage.setItem('skyhold2d_coach_v1', 'done');
});
const page = await ctx.newPage();
await page.goto(`${BASE}/2d.html?lang=tr${touch ? '' : '&desktop=1'}`);
await page.waitForSelector('[data-testid="map2d-settings"]');
await page.waitForTimeout(1800);
const measure = () =>
  page.evaluate(() => {
    const row = document.querySelector('.pu-topbar-right');
    const caps = [...row.querySelectorAll(':scope > * > .pu-round-label')].map((l) => l.getBoundingClientRect());
    const gaps = caps.slice(1).map((c, i) => Math.round(c.left - caps[i].right));
    const bar = document.querySelector('.pu-topbar').getBoundingClientRect();
    const capBottom = Math.max(...caps.map((c) => c.bottom));
    const top = Math.min(...window.__map.islands().filter((_, i) => i < 6).map((n) => n.y));
    const d = window.__map.layout().nodeD;
    return { k: document.documentElement.style.getPropertyValue('--ui-scale'), gaps, barBottom: Math.round(Math.max(bar.bottom, capBottom)), islandTop: Math.round(top - d / 2), nodeD: Math.round(d) };
  });
const before = await measure();
await page.click('[data-testid="map2d-settings"]');
await page.waitForSelector('[data-testid="set2d-uiscale"]');
// Slider all the way right (130 %).
const box = await page.locator('[data-testid="set2d-uiscale"]').boundingBox();
await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
await page.waitForTimeout(1200);
const after = await measure();
console.log('before', JSON.stringify(before));
console.log('after ', JSON.stringify(after));
const probs = [];
if (after.k === before.k) probs.push('ui scale did not change');
if (after.gaps.some((g) => g < 9)) probs.push(`caption gap ${Math.min(...after.gaps)}`);
if (after.islandTop === before.islandTop) probs.push('map did not lay out again (islands kept their band)');
console.log(probs.length ? 'PROBLEM ' + probs.join('; ') : '0 problems');
await browser.close();
process.exit(probs.length ? 1 : 0);
