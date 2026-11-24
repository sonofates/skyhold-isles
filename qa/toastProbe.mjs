// Probe: the new-foe toast (fresh foes list, first horn of i09) and a feat toast after a forced win,
// on a phone and a desktop size, EN + TR. Shots: <out>/<lang>-<size>-<what>.jpg
// Usage: node qa/toastProbe.mjs [--base=...] [--out=qa-out/wp/toast]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'qa-out/wp/toast';
mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const SIZES = [
  { key: 'p667', w: 667, h: 375, touch: true },
  { key: 'd1440', w: 1440, h: 900, touch: false },
];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const lang of ['en', 'tr']) {
  for (const s of SIZES) {
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h },
      deviceScaleFactor: s.touch ? 2 : 1,
      isMobile: s.touch,
      hasTouch: s.touch,
      ...(s.touch ? { userAgent: UA } : {}),
    });
    await ctx.addInitScript((l) => {
      if (sessionStorage.getItem('s')) return;
      sessionStorage.setItem('s', '1');
      localStorage.clear();
      localStorage.setItem('skyhold_isles_language_v1', l);
      localStorage.setItem('skyhold_isles_coach2d_v1', '1');
      localStorage.setItem('skyhold2d_coach_v1', 'done');
      localStorage.setItem('skyhold_isles_story2d_seen_v1', JSON.stringify(['i09:intro', 'i09:outro', 'i02:intro', 'i02:outro']));
    }, lang);
    const page = await ctx.newPage();
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('console', m.type(), m.text().slice(0, 200)));
    await page.goto(`${BASE}/2d.html?level=i09&hero=bran&lang=${lang}&desktop=${s.touch ? 0 : 1}`);
    await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'), null, { timeout: 60000 });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__p0.replay.cmd({ k: 'wave' }));
    const shown = await page.waitForFunction(() => window.__p0.newFoe()?.shown, null, { timeout: 8000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(600);
    console.log(lang, s.key, 'newfoe shown', shown, JSON.stringify(await page.evaluate(() => window.__p0.newFoe())).slice(0, 300));
    await page.screenshot({ path: `${OUT}/${lang}-${s.key}-newfoe.jpg`, type: 'jpeg', quality: 72 });
    await page.evaluate(() => window.__p0.forceEnd('won'));
    await page.waitForFunction(() => !!window.__p0.state().end, null, { timeout: 10000 }).catch(() => undefined);
    await page.locator('[data-testid="story2d-skip"]').click({ timeout: 2500 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${lang}-${s.key}-won.jpg`, type: 'jpeg', quality: 72 });
    await ctx.close();
  }
}
await browser.close();
