// End board level-up fanfare: Bran a few XP short of a level, a forced win, frames over the burst.
// Usage: node qa/lvlupshot.mjs [--base=..] [--shots=dir] [--size=1920x1080] [--motion=reduced]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const SHOTS = arg('shots') ?? '/tmp/lvlup';
const [W, H] = (arg('size') ?? '1920x1080').split('x').map(Number);
const REDUCED = arg('motion') === 'reduced';
mkdirSync(SHOTS, { recursive: true });
const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const pad = (a, v) => [...a, ...Array(Math.max(0, 25 - a.length)).fill(v)];
const SEED = JSON.stringify({ ids: IDS, progress: { version: 2, unlockedLevelIndex: 4, bestStars: pad([3, 2, 3], 0), clears: pad([2, 1, 1], 0), heroes: { selectedHero: 'bran', roster: { bran: { xp: Number(arg('xp') ?? 3880), skills: [] } } } } });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
await ctx.addInitScript(([s, red]) => {
  if (sessionStorage.getItem('qa-seeded')) return;
  sessionStorage.setItem('qa-seeded', '1');
  localStorage.clear();
  localStorage.setItem('skyhold_isles_progress2d_v1', s);
  localStorage.setItem('skyhold_isles_coach2d_v1', '1');
  localStorage.setItem('skyhold2d_coach_v1', 'done');
  localStorage.setItem('skyhold_isles_story2d_seen_v1', JSON.stringify(['i02:intro', 'i02:outro']));
  if (red) localStorage.setItem('skyhold_isles_graphics_v1', JSON.stringify({ reducedMotion: true }));
}, [SEED, REDUCED]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('page error', e.message));
await page.goto(`${BASE}/2d.html?level=i02&hero=bran&lang=en&desktop=1`);
await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'), null, { timeout: 60000 });
await page.waitForTimeout(1200);
await page.evaluate(() => window.__p0.forceEnd('won'));
await page.waitForFunction(() => !!window.__p0.state().end, null, { timeout: 10000 });
const t0 = Date.now();
for (const at of [1600, 2000, 2300, 2700, 3400]) {
  await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
  await page.screenshot({ path: `${SHOTS}/lvlup-${at}.jpg`, type: 'jpeg', quality: 80 });
}
const end = await page.evaluate(() => window.__p0.state().end);
console.log('end', JSON.stringify(end?.note ?? null), 'hero', JSON.stringify(await page.evaluate(() => window.__p0.state().end)).slice(0, 300));
await browser.close();
