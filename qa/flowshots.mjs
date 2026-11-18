// Small game-flow QA against `vite preview` (default http://127.0.0.1:4381): low-lives warning,
// pause on window blur (desktop), Settings → Controls (3× + replay keys), 3× speed key.
// Usage: node qa/flowshots.mjs [--lang=en,tr] [--size=1920x1080,844x390]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'docs/overnight/opus-shots';
const LANGS = (arg('lang') ?? 'en,tr').split(',');
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const ALL_SIZES = [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1, desktop: true },
  { key: '844x390', w: 844, h: 390, dpr: 2, touch: true },
];
const SIZES = ALL_SIZES.filter((s) => !arg('size') || arg('size').split(',').includes(s.key));
const problems = [];
const ok = (c, m) => {
  if (!c) problems.push(m);
};

for (const size of SIZES) {
  for (const lang of LANGS) {
    const tag = `${size.key} ${lang}`;
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${tag}: pageerror ${e.message}`));
    await page.goto(`${BASE}/2d.html?level=l1c&hero=bran&lang=${lang}&desktop=${size.desktop ? 1 : 0}`);
    await page.waitForFunction(() => window.__p0?.lives && !document.getElementById('boot'), null, { timeout: 60000 });
    await page.waitForTimeout(500);
    // Foe info card: call wave 1, let foes walk out, tap one.
    await page.evaluate(() => {
      window.__p0.replay.cmd({ k: 'wave' });
      window.__p0.replay.step(40);
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__p0.freeze(true));
    const at = await page.evaluate(() => window.__p0.foeAt());
    if (!at) problems.push(`${tag}: no foe to tap`);
    else {
      await page.evaluate(([x, y]) => window.__p0.hero.tap(x, y), [at.x, at.y]);
      await page.evaluate(() => window.__p0.freeze(false));
      await page.waitForTimeout(400);
      await page.evaluate(() => window.__p0.freeze(true));
      const fc = await page.evaluate(() => window.__p0.foe());
      ok(fc?.shown && fc.type, `${tag}: foe card not shown ${JSON.stringify(fc)}`);
      await page.screenshot({ path: `${OUT}/${lang}-${size.key}-foe-card.jpg`, type: 'jpeg', quality: 84 });
      await page.evaluate(() => window.__p0.freeze(false));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      ok(!(await page.evaluate(() => window.__p0.foe().shown)), `${tag}: Esc did not close the foe card`);
    }
    // Low lives: drop to 4 of 20 (a hit flash, then the slow pulse).
    await page.evaluate(() => window.__p0.setLives(4));
    await page.waitForFunction(() => window.__p0.lives().low, null, { timeout: 5000 }).catch(() => undefined);
    let lv = await page.evaluate(() => window.__p0.lives());
    ok(lv.low && lv.flashes >= 1, `${tag}: low lives not flagged ${JSON.stringify(lv)}`);
    await page.screenshot({ path: `${OUT}/${lang}-${size.key}-lives-hit.jpg`, type: 'jpeg', quality: 82 });
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `${OUT}/${lang}-${size.key}-lives-low.jpg`, type: 'jpeg', quality: 82 });
    // Speed key 3 (desktop).
    if (size.desktop) {
      await page.keyboard.press('3');
      await page.waitForTimeout(150);
      ok((await page.evaluate(() => window.__p0.state().speed)) === 3, `${tag}: key 3 did not set 3×`);
      // Window blur pauses the run.
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.waitForTimeout(200);
      ok(await page.evaluate(() => window.__p0.state().paused), `${tag}: blur did not pause`);
    }
    await ctx.close();
    // Controls page.
    const ctx2 = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch });
    const p2 = await ctx2.newPage();
    await p2.goto(`${BASE}/2d.html?level=l1c&lang=${lang}&settings=1&settab=controls&desktop=${size.desktop ? 1 : 0}`);
    await p2.waitForSelector(".pu-settings", { timeout: 30000 }).catch(() => undefined);
    await p2.waitForTimeout(4000);
    await p2.screenshot({ path: `${OUT}/${lang}-${size.key}-controls.jpg`, type: 'jpeg', quality: 82 });
    await ctx2.close();
    console.log(`${tag}: done`);
  }
}
await browser.close();
if (problems.length) {
  console.log(`PROBLEMS (${problems.length}):\n  ` + problems.join('\n  '));
  process.exitCode = 1;
} else console.log('no problems');
