// Next-wave card + horn countdown QA against `vite preview` (default http://127.0.0.1:4381).
// For every island (l1c, i01…i24; missing ones are skipped): the card before wave 1 and between
// waves 1 and 2 (countdown ring), checking the card stays on screen and does not cover a plot
// centre, the horn, the plaque or the wave banner.
// Usage: node qa/waveshots.mjs [--ids=l1c,i05] [--lang=en,tr] [--size=1920x1080,844x390] [--shots=0]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'docs/overnight/opus-shots';
const LANGS = (arg('lang') ?? 'en').split(',');
const SHOTS = arg('shots') !== '0';
const IDS = (arg('ids') ?? ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)].join(',')).split(',');
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const ALL_SIZES = [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1, desktop: true },
  { key: '1366x768', w: 1366, h: 768, dpr: 1, desktop: true },
  { key: '844x390', w: 844, h: 390, dpr: 2, touch: true },
];
const SIZES = ALL_SIZES.filter((s) => (arg('size') ?? '1920x1080,844x390').split(',').includes(s.key));
const problems = [];
const inter = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

async function check(page, tag, label) {
  const card = await page.evaluate(() => window.__p0.waveCard());
  if (!card?.shown || !card.rect) {
    problems.push(`${tag} ${label}: card not shown`);
    return;
  }
  const r = card.rect;
  const st = await page.evaluate(() => {
    const s = window.__p0.state();
    const plots = [];
    for (let i = 0; i < s.plots.count; i++) plots.push(window.__p0.plotScreen(i));
    return { plots, hud: s.hud, vw: innerWidth, vh: innerHeight };
  });
  if (r.x < 0 || r.y < 0 || r.x + r.w > st.vw || r.y + r.h > st.vh) problems.push(`${tag} ${label}: card off screen ${JSON.stringify(r)}`);
  const covered = st.plots.filter((p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h).length;
  if (covered) problems.push(`${tag} ${label}: card covers ${covered} plot centre(s)`);
  for (const k of ['horn', 'plaque', 'banner', 'pause', 'speed']) if (st.hud[k] && inter(r, st.hud[k])) problems.push(`${tag} ${label}: card overlaps ${k}`);
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    for (const id of IDS) {
      const tag = `${size.key} ${lang} ${id}`;
      const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/2d.html?level=${id}&hero=bran&lang=${lang}&desktop=${size.desktop ? 1 : 0}`);
      const ok = await page.waitForFunction(() => (window.__p0?.waveCard && !document.getElementById('boot')) || /nknown|ilinmeyen/.test(document.getElementById('boot')?.textContent ?? ''), null, { timeout: 60000 }).then(() => page.evaluate(() => !!window.__p0?.waveCard)).catch(() => false);
      if (!ok) {
        await ctx.close();
        continue;
      }
      await page.waitForTimeout(600);
      await check(page, tag, 'pre');
      if (SHOTS) await page.screenshot({ path: `${OUT}/${lang}-${size.key}-wave-${id}-pre.jpg`, type: 'jpeg', quality: 80 });
      // Wave 1, then fast-forward until the between-waves countdown runs.
      await page.evaluate(() => {
        const p = window.__p0;
        p.replay.cmd({ k: 'build', plot: 0, type: 'archer' });
        p.replay.cmd({ k: 'build', plot: 1, type: 'archer' });
        p.setGold(5000);
        for (let i = 0; i < 6; i++) p.replay.cmd({ k: 'build', plot: 2 + i, type: i % 2 ? 'cannon' : 'archer' });
        p.replay.cmd({ k: 'wave' });
        for (let i = 0; i < 600 && p.state().waveState !== 'betweenWaves' && p.state().outcome === 'ongoing'; i++) p.replay.step(5);
        p.replay.step(10);
      });
      await page.waitForTimeout(500);
      const ws = await page.evaluate(() => window.__p0.state().waveState);
      if (ws === 'betweenWaves') {
        await check(page, tag, 'between');
        if (SHOTS) await page.screenshot({ path: `${OUT}/${lang}-${size.key}-wave-${id}-between.jpg`, type: 'jpeg', quality: 80 });
      } else problems.push(`${tag}: never reached betweenWaves (${ws})`);
      await ctx.close();
      console.log(`${tag}: done`);
    }
  }
}
await browser.close();
if (problems.length) {
  console.log(`PROBLEMS (${problems.length}):\n  ` + problems.join('\n  '));
  process.exitCode = 1;
} else console.log('no problems');
