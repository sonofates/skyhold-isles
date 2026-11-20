// One-off: computed state of the unveil burst at a frozen time.
import { chromium } from 'playwright';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const pad = (a, v) => [...a, ...Array(Math.max(0, 25 - a.length)).fill(v)];
const SEED = JSON.stringify({ ids: IDS, progress: { version: 2, unlockedLevelIndex: 4, bestStars: pad([3, 2, 3, 1], 0), clears: pad([2, 1, 1, 1], 0) } });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript((s) => {
  localStorage.setItem('skyhold_isles_progress2d_v1', s);
  localStorage.setItem('skyhold2d_map_unlock_seen_v1', '3');
}, SEED);
const page = await ctx.newPage();
await page.goto(`${BASE}/2d.html?lang=en`);
await page.waitForSelector('[data-testid="map2d-island-i04"]');
const out = await page.evaluate(() => {
  const b = document.querySelector('[data-testid="map2d-island-i04"]');
  const burst = b.querySelector('.pu-unveil-burst');
  const anims = document.getAnimations().filter((a) => b.contains(a.effect?.target));
  const list = anims.map((a) => ({ name: a.animationName, target: a.effect.target.className, delay: a.effect.getTiming().delay, dur: a.effect.getTiming().duration }));
  for (const a of anims) {
    a.pause();
    a.currentTime = 2300;
  }
  const cs = burst ? getComputedStyle(burst) : null;
  const r = burst?.getBoundingClientRect();
  return { list, ud: getComputedStyle(b).getPropertyValue('--ud'), burst: cs ? { op: cs.opacity, tf: cs.transform, anim: cs.animationName, delay: cs.animationDelay, w: r.width, z: cs.zIndex } : null };
});
console.log(JSON.stringify(out.burst));
console.log(JSON.stringify(await page.evaluate(() => {
  const b = document.querySelector('[data-testid="map2d-island-i04"]');
  const burst = b.querySelector('.pu-unveil-burst');
  const cs = getComputedStyle(burst);
  const r = burst.getBoundingClientRect();
  const nr = b.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + 3, r.y + r.height / 2);
  return { display: cs.display, vis: cs.visibility, border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor, pos: cs.position, r: [r.x, r.y, r.width, r.height].map(Math.round), node: [nr.x, nr.y, nr.width, nr.height].map(Math.round), hit: hit?.className, kids: [...b.children].map((c) => c.className) };
})));
const clip = await page.evaluate(() => {
  const r = document.querySelector('[data-testid="map2d-island-i04"]').getBoundingClientRect();
  return { x: r.x - 60, y: r.y - 60, width: r.width + 120, height: r.height + 120 };
});
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/n2opus-unveil/dbg-paused.png', clip });
await page.addStyleTag({ content: '.pu-unveil-burst{animation:none!important;opacity:1!important;transform:translate(-50%,-50%) scale(1)!important;z-index:9!important;background:rgba(255,0,0,.4)!important}' });
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/n2opus-unveil/dbg-static.png', clip });
await browser.close();
