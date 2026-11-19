// First-play coach QA against `vite preview` (default http://127.0.0.1:4381): walks l1c's five tips
// (build → pick → wave → upgrade → hero → meteor → done) through the real command layer, shooting
// each, checking the step advances and the arrow is on screen. Usage: node qa/coachshots.mjs [--lang=en,tr] [--size=...]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'docs/overnight/opus-shots';
const LANGS = (arg('lang') ?? 'en,tr').split(',');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ALL = [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1, desktop: true },
  { key: '844x390', w: 844, h: 390, dpr: 2, touch: true },
];
const SIZES = ALL.filter((s) => !arg('size') || arg('size').split(',').includes(s.key));
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
    await page.goto(`${BASE}/2d.html?level=l1c&hero=bran&coach=1&lang=${lang}&desktop=${size.desktop ? 1 : 0}`);
    await page.waitForFunction(() => window.__p0?.coach && window.__p0.coach() && !document.getElementById('boot'), null, { timeout: 60000 });
    const waitStep = async (want) => page.waitForFunction((w) => window.__p0.coach()?.step === w, want, { timeout: 8000 }).then(() => true).catch(() => false);
    const snap = async (name) => {
      await page.waitForTimeout(450);
      const c = await page.evaluate(() => window.__p0.coach());
      if (c.arrow) ok(c.arrow.x > 0 && c.arrow.x < size.w && c.arrow.y > 20 && c.arrow.y < size.h, `${tag} ${name}: arrow off screen ${JSON.stringify(c.arrow)}`);
      await page.screenshot({ path: `${OUT}/${lang}-${size.key}-coach-${name}.jpg`, type: 'jpeg', quality: 82 });
    };
    ok(await waitStep('build'), `${tag}: not at build`);
    await snap('1-build');
    // Open the ring on the suggested plot (the arrow's plot).
    const at = await page.evaluate(() => window.__p0.coach().arrow);
    await page.evaluate(([x, y]) => window.__p0.hero.tap(x, y), [at.x, at.y]);
    ok(await waitStep('pick'), `${tag}: tap on the plot did not reach pick`);
    await snap('2-pick');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      window.__p0.replay.cmd({ k: 'build', plot: 0, type: 'archer' });
      window.__p0.replay.cmd({ k: 'build', plot: 1, type: 'archer' });
    });
    ok(await waitStep('wave'), `${tag}: not at wave`);
    await snap('3-wave');
    await page.evaluate(() => {
      window.__p0.replay.cmd({ k: 'wave' });
      window.__p0.setGold(400);
    });
    ok(await waitStep('upgrade'), `${tag}: not at upgrade`);
    await snap('4-upgrade');
    await page.evaluate(() => {
      const s = window.__p0.state();
      window.__p0.replay.cmd({ k: 'upgrade', id: s.towers[0].id });
    });
    ok(await waitStep('hero'), `${tag}: not at hero`);
    await snap('5-hero');
    await page.evaluate(() => {
      const h = window.__p0.state().hero;
      window.__p0.replay.cmd({ k: 'heroMove', x: h.x - 2, z: h.z });
      window.__p0.replay.step(30);
    });
    ok(await waitStep('meteor'), `${tag}: not at meteor`);
    await page.waitForFunction(() => window.__p0.coach().shown, null, { timeout: 8000 }).catch(() => problems.push(`${tag}: meteor tip never shown`));
    await snap('6-meteor');
    await page.evaluate(() => {
      const e = window.__p0.hero.nearestEnemy() ?? { x: 0, z: 0 };
      window.__p0.replay.cmd({ k: 'meteor', x: e.x, z: e.z });
    });
    ok(await waitStep('done'), `${tag}: not done after the meteor`);
    ok(await page.evaluate(() => localStorage.getItem('skyhold2d_coach_v1') === 'done'), `${tag}: done not saved`);
    await ctx.close();
    console.log(`${tag}: done`);
  }
}
await browser.close();
if (problems.length) {
  console.log(`PROBLEMS (${problems.length}):\n  ` + problems.join('\n  '));
  process.exitCode = 1;
} else console.log('no problems');
