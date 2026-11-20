// New feats in the Logbook: a fresh save wins l1c (First Landing, Starcatcher…), goes back to the map:
// the Logbook button has a red dot, the Logbook opens on the Feats tab with "New" tags, and after
// closing it the dot is gone (reopening shows no tags).
// Usage: node qa/featseenshot.mjs [--base=..] [--out=/tmp/n2opus-featseen] [--size=2000x991] [--touch=1]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? '/tmp/n2opus-featseen';
const SIZE = arg('size') ?? '2000x991';
const [W, H] = SIZE.split('x').map(Number);
const touch = arg('touch') === '1';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let bad = 0;
const fail = (m) => {
  bad++;
  console.log('PROBLEM', m);
};
for (const lang of ['en', 'tr']) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('qa-seeded')) return;
    sessionStorage.setItem('qa-seeded', '1');
    localStorage.clear();
    localStorage.setItem('skyhold_isles_coach2d_v1', '1');
    localStorage.setItem('skyhold2d_coach_v1', 'done');
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  const q = `lang=${lang}${touch ? '' : '&desktop=1'}`;
  // A first map visit sets the baseline: no dot.
  await page.goto(`${BASE}/2d.html?${q}`);
  await page.waitForSelector('[data-testid="map2d-logbook"]');
  if (await page.locator('[data-testid="map2d-logbook"] .pu-dot').count()) fail(`${lang}: dot on a fresh save`);
  await page.goto(`${BASE}/2d.html?level=l1c&hero=bran&${q}`);
  await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__p0.forceEnd('won'));
  await page.waitForFunction(() => !!window.__p0.state().end);
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/2d.html?${q}`);
  await page.waitForSelector('[data-testid="map2d-logbook"]');
  await page.waitForTimeout(2500);
  const n = await page.getAttribute('[data-testid="map2d-logbook"]', 'data-new-feats');
  const dot = await page.locator('[data-testid="map2d-logbook"] .pu-dot').count();
  console.log(lang, SIZE, 'map: new feats', n, 'dot', dot);
  if (!dot || !(Number(n) >= 2)) fail(`${lang}: no dot after a winning run`);
  await page.screenshot({ path: `${OUT}/${lang}-${SIZE}-map-dot.jpg`, type: 'jpeg', quality: 85, clip: { x: W / 2, y: 0, width: W / 2, height: Math.min(H, 200) } });
  await page.click('[data-testid="map2d-logbook"]');
  await page.waitForSelector('[data-testid="logbook2d"]');
  await page.waitForTimeout(900);
  const tags = await page.evaluate(() => [...document.querySelectorAll('.pu-feat.new')].map((e) => e.dataset.testid));
  const selected = await page.getAttribute('[data-testid="lb2d-tab-feats"]', 'aria-selected');
  console.log(lang, 'logbook: feats tab selected', selected, 'new rows', JSON.stringify(tags));
  if (selected !== 'true') fail(`${lang}: Logbook did not open on Feats`);
  if (!tags.includes('lb2d-feat-firstLanding')) fail(`${lang}: First Landing not tagged New`);
  await page.screenshot({ path: `${OUT}/${lang}-${SIZE}-logbook-new.jpg`, type: 'jpeg', quality: 85 });
  await page.click('[data-testid="logbook2d-close"]');
  await page.waitForTimeout(600);
  const after = await page.locator('[data-testid="map2d-logbook"] .pu-dot').count();
  if (after) fail(`${lang}: dot still there after the Logbook was seen`);
  await page.click('[data-testid="map2d-logbook"]');
  await page.waitForSelector('[data-testid="logbook2d"]');
  await page.waitForTimeout(500);
  const again = await page.evaluate(() => ({ newRows: document.querySelectorAll('.pu-feat.new').length, feats: document.querySelector('[data-testid="lb2d-tab-feats"]')?.getAttribute('aria-selected') }));
  console.log(lang, 'reopen', JSON.stringify(again));
  if (again.newRows || again.feats === 'true') fail(`${lang}: reopen still shows new feats / opens on Feats`);
  await ctx.close();
}
await browser.close();
console.log(bad ? `${bad} problem(s)` : '0 problems');
process.exit(bad ? 1 : 0);
