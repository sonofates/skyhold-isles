// P3 UI flow check against `vite preview`: world map → island → briefing → Play (first play adds
// &intro=1) → story panels → game; a win (forced through window.__p0) records stars in the 2D save,
// shows the after-battle story once, and the end panel's World Map button returns to the map, which
// then shows the stars. Also: deep link ?level= skips the map; debug params still default to l1c.
// Usage: node qa/p3flow.mjs [--base=http://127.0.0.1:4173]
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? process.env.BASE ?? 'http://127.0.0.1:4173';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const fails = [];
const check = (ok, msg) => {
  console.log(ok ? 'ok  ' : 'FAIL', msg);
  if (!ok) fails.push(msg);
};

const browser = await chromium.launch({ args: ARGS });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e.message}`));

await page.goto(`${BASE}/2d.html`);
await page.waitForSelector('[data-testid="worldmap2d"]');
check(await page.isVisible('[data-testid="map2d-island-l1c"]'), 'map shows the first island');
await page.click('[data-testid="map2d-island-l1c"]');
await page.waitForSelector('[data-testid="brief2d"]');
check((await page.textContent('[data-testid="brief2d-play"]'))?.includes('Play'), 'briefing offers Play on a fresh save');
await Promise.all([page.waitForURL(/level=l1c&intro=1/), page.click('[data-testid="brief2d-play"]')]);
await page.waitForSelector('[data-testid="story2d"]', { timeout: 15000 });
check(true, 'intro story shows before the first play');
const paused = await page.evaluate(() => window.__p0?.state().paused);
check(paused === true, 'game is paused behind the story');
await page.click('[data-testid="story2d-skip"]');
await page.waitForTimeout(300);
check(!(await page.isVisible('[data-testid="story2d"]')), 'Skip closes the story');
check((await page.evaluate(() => window.__p0?.state().paused)) === false, 'game resumes after the story');

await page.evaluate(() => window.__p0?.forceEnd?.('won'));
await page.waitForSelector('[data-testid="story2d"]', { timeout: 15000 });
check(true, 'after-battle story shows on the first win');
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('skyhold_isles_progress2d_v1') ?? 'null'));
check(saved?.progress?.clears?.[0] === 1 && saved.progress.bestStars[0] >= 1, `win recorded in the 2D save (${JSON.stringify(saved?.progress?.bestStars)})`);
await page.click('[data-testid="story2d-next"]');
await page.click('[data-testid="story2d-next"]');
await page.waitForTimeout(300);
check(!(await page.isVisible('[data-testid="story2d"]')), 'story closes after the last panel');
const end = await page.evaluate(() => window.__p0?.state().end);
check(end?.buttons?.some((b) => b.action === 'menu'), 'end panel has World Map');
const menu = end.buttons.find((b) => b.action === 'menu');
await page.waitForTimeout(500);
await Promise.all([page.waitForURL((u) => !u.search.includes('level')), page.mouse.click(menu.x, menu.y)]);
await page.waitForSelector('[data-testid="worldmap2d"]');
const label = await page.getAttribute('[data-testid="map2d-island-l1c"]', 'aria-label');
check(/[123] of 3 stars/.test(label ?? '') && !/0 of 3/.test(label ?? ''), `map shows the earned stars (${label})`);

// Second play: no intro (already won), replay label.
await page.click('[data-testid="map2d-island-l1c"]');
check((await page.textContent('[data-testid="brief2d-play"]'))?.includes('Replay'), 'briefing says Replay after a win');
await Promise.all([page.waitForURL((u) => u.search === '?level=l1c'), page.click('[data-testid="brief2d-play"]')]);
await page.waitForTimeout(2500);
check(!(await page.isVisible('[data-testid="story2d"]')), 'no intro on a replay');
check(await page.isVisible('[data-testid="codex2d-open"]'), 'painted Codex button is shown in game');

// Debug params without ?level still start l1c.
await page.goto(`${BASE}/2d.html?speed=2`);
await page.waitForFunction(() => window.__p0?.mode === 'play', null, { timeout: 15000 });
check(!(await page.isVisible('[data-testid="worldmap2d"]')), '?speed=2 (no level) still opens the game');

// Meta screens open and close from the map.
await page.goto(`${BASE}/2d.html`);
await page.waitForSelector('[data-testid="worldmap2d"]');
for (const [btn, sheet] of [
  ['map2d-workshop', 'workshop2d'],
  ['map2d-logbook', 'logbook2d'],
  ['map2d-daily', 'daily2d'],
  ['map2d-settings', 'settings2d'],
]) {
  await page.click(`[data-testid="${btn}"]`);
  await page.waitForSelector(`[data-testid="${sheet}"]`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check(!(await page.isVisible(`[data-testid="${sheet}"]`)), `${sheet} opens from the map and closes with Escape`);
}
// Workshop purchase spends a star from the 2D wallet.
await page.click('[data-testid="map2d-workshop"]');
const before = await page.textContent('[data-testid="pu-wallet"] b');
await page.click('[data-testid="ws2d-buy-treasury"]');
const after = await page.textContent('[data-testid="pu-wallet"] b');
check(Number(after) === Number(before) - 1, `workshop buy spends a star (${before} → ${after})`);

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall flow checks passed');
process.exit(fails.length ? 1 : 0);
