// Retry after a level-up plays at the new hero level; replaying the finished run keeps the level it
// was recorded with. Needs the vite DEV server (it imports /src modules to bank hero XP):
//   node node_modules/vite/bin/vite.js --port 4471 & node qa/retryHeroLevel.mjs --base=http://127.0.0.1:4471
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv.find((a) => a.startsWith('--base='))?.slice(7) ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const heroLevel = () => page.evaluate(() => window.__p0.state().hero?.level ?? null);
const tapEnd = async (action) => {
  await page.waitForTimeout(3000); // the board animates in
  const btn = await page.evaluate((a) => window.__p0.state().end?.buttons.find((b) => b.action === a) ?? null, action);
  if (!btn) throw new Error(`no ${action} button`);
  await page.mouse.click(btn.x, btn.y);
};
try {
  await page.goto(`${base}/2d.html?level=l1c&hero=bran&title=0`);
  await page.waitForFunction(() => window.__p0?.state && !document.querySelector('#boot'), null, { timeout: 120_000 });
  const before = await heroLevel();
  // Bank enough hero XP for several levels, as a long run would, then end this run.
  await page.evaluate(async () => {
    const p2d = await import('/src/render2d/ui/progress2d.ts');
    const h = await import('/src/render2d/heroes2d.ts');
    const p = p2d.loadProgress2D();
    p.heroes = h.applyHeroXp(p, 'bran', 4000).progress.heroes;
    p2d.saveProgress2D(p);
  });
  await page.evaluate(() => window.__p0.forceEnd('lost'));
  await page.waitForFunction(() => window.__p0.state().end?.buttons?.length > 0, null, { timeout: 30_000 });
  await tapEnd('retry');
  await page.waitForFunction(() => window.__p0.state().outcome === 'ongoing');
  const afterRetry = await heroLevel();
  await page.evaluate(() => window.__p0.forceEnd('lost'));
  await page.waitForFunction(() => window.__p0.state().end?.buttons?.length > 0, null, { timeout: 30_000 });
  await tapEnd('replay');
  await page.waitForFunction(() => window.__p0.state().replay.playing);
  const inReplay = await heroLevel();
  console.log(JSON.stringify({ before, afterRetry, inReplay, errors }));
  if (!(afterRetry > before) || inReplay !== afterRetry || errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
