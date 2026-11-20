// Map top bar: the gaps between the round buttons' captions (Kahramanlar / Atölye…) at several sizes,
// EN / TR, 100 % and 130 % interface size. A gap under 5 px (or an overlap) is a problem; so is a
// caption or the tally plaque leaving the screen or running into the title banner.
// Usage: node qa/capgap.mjs [--base=..] [--out=/tmp/n2opus-capgap]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? '/tmp/n2opus-capgap';
mkdirSync(OUT, { recursive: true });
const SIZES = [
  [2000, 991, false],
  [1366, 768, false],
  [1024, 768, false],
  [932, 430, true],
  [844, 390, true],
  [667, 375, true],
];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let bad = 0;
for (const lang of ['en', 'tr']) {
  for (const scale of [1, 1.3]) {
    for (const [W, H, touch] of SIZES) {
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch });
      await ctx.addInitScript(
        ([sc, l]) => {
          localStorage.setItem('skyhold_isles_coach2d_v1', '1');
          localStorage.setItem('skyhold2d_coach_v1', 'done');
          localStorage.setItem('skyhold_isles_settings_v1', JSON.stringify({ language: l, graphics: { uiScale: sc } }));
          localStorage.setItem('skyhold_isles_graphics_v1', JSON.stringify({ uiScale: sc }));
        },
        [scale, lang],
      );
      const page = await ctx.newPage();
      await page.goto(`${BASE}/2d.html?lang=${lang}${touch ? '' : '&desktop=1'}`);
      await page.waitForSelector('[data-testid="map2d-logbook"]');
      await page.waitForTimeout(2200);
      const r = await page.evaluate(() => {
        const row = document.querySelector('.pu-topbar-right');
        const caps = [...row.querySelectorAll(':scope > * > .pu-round-label')].map((l) => {
          const b = l.getBoundingClientRect();
          return { t: l.textContent, l: Math.round(b.left), r: Math.round(b.right) };
        });
        const gaps = caps.slice(1).map((c, i) => c.l - caps[i].r);
        const banner = document.querySelector('.pu-title-banner')?.getBoundingClientRect();
        const tally = document.querySelector('.pu-tally')?.getBoundingClientRect();
        return { caps, gaps, right: caps.at(-1)?.r ?? 0, bannerRight: Math.round(banner?.right ?? 0), tallyLeft: Math.round(tally?.left ?? 0), margins: [...row.children].map((c) => c.style.marginLeft || '0') };
      });
      const tag = `${lang} ${W}x${H} ui${scale}`;
      const probs = [];
      if (r.gaps.some((g) => g < 5)) probs.push(`gap ${Math.min(...r.gaps)}`);
      if (r.right > W) probs.push(`caption off screen (${r.right} > ${W})`);
      if (r.tallyLeft < r.bannerRight) probs.push(`tally ${r.tallyLeft} under banner ${r.bannerRight}`);
      console.log(tag, 'gaps', r.gaps.join(','), 'margins', r.margins.join(','), probs.length ? 'PROBLEM ' + probs.join('; ') : 'ok');
      bad += probs.length;
      if (scale === 1 && (W === 2000 || W === 844)) await page.screenshot({ path: `${OUT}/${lang}-${W}x${H}-topbar.png`, clip: { x: W * 0.45, y: 0, width: W * 0.55, height: Math.min(H, 140) } });
      await ctx.close();
    }
  }
}
await browser.close();
console.log(bad ? `${bad} problem(s)` : '0 problems');
process.exit(bad ? 1 : 0);
