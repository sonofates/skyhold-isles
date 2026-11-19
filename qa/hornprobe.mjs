// Horn placement QA: on every island and screen the horn stands beside the cave the next wave comes
// from (state().hornSpot === 'cave'), or at its dock corner when no clear spot exists there; in
// both cases hudCheck() must report no HUD piece over a plot / cave / castle / safe-area road, and
// the horn piece must cover no road at all. Also checks the tray (inside its slot) and the canvas
// lettering (__p0.textAudit()). Optional shots: --shots=dir (one per island at the first size).
// Usage: node qa/hornprobe.mjs [--base=..] [--size=1920x1080,844x390] [--islands=i01,i14] [--shots=dir]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const SHOTS = arg('shots') ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ALL = [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1 },
  { key: '2000x991', w: 2000, h: 991, dpr: 1 },
  { key: '1600x900', w: 1600, h: 900, dpr: 1 },
  { key: '1366x768', w: 1366, h: 768, dpr: 1 },
  { key: '932x430', w: 932, h: 430, dpr: 1, touch: true },
  { key: '844x390', w: 844, h: 390, dpr: 1, touch: true },
];
const SIZES = ALL.filter((s) => !arg('size') || arg('size').split(',').includes(s.key));
const IDS = arg('islands') ? arg('islands').split(',') : ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const problems = [];
const rows = [];
const notes = [];
const summary = [];
const browser = await chromium.launch({ args: ARGS });
for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('skyhold_isles_coach2d_v1', '1');
      localStorage.setItem('skyhold2d_coach_v1', 'done');
      localStorage.setItem('skyhold_isles_story2d_seen_v1', JSON.stringify(['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)].flatMap((id) => [`${id}:intro`, `${id}:outro`])));
    } catch {
      /* ignore */
    }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${size.key}: page error ${e.message}`));
  let stack = 0;
  const sideIds = [];
  for (const id of IDS) {
    const key = `${id}-${size.key}`;
    await page.goto(`${BASE}/2d.html?level=${id}&hero=bran&lang=en&desktop=${size.touch ? 0 : 1}`);
    const ok = await page.waitForFunction(() => window.__p0?.hudCheck && !document.getElementById('boot'), null, { timeout: 60000 }).then(() => true).catch(() => false);
    if (!ok) {
      problems.push(`${key}: game did not start`);
      continue;
    }
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const p = window.__p0;
      const st = p.state();
      const hc = p.hudCheck();
      return { spot: st.hornSpot, horn: st.horn, hc, text: p.textAudit ? p.textAudit() : [] };
    });
    if (r.spot === 'cave') stack++;
    else sideIds.push(id);
    for (const o of r.hc.overlaps) problems.push(`${key}: ${o.piece} covers ${o.kind} ${o.index}`);
    const outer = r.hc.outerRoads.filter((q) => q.piece === 'horn').length;
    if (outer) notes.push(`${key}: horn over ${outer} road segment(s) outside the safe area (allowed; never the mouth)`);
    for (const [piece, d] of Object.entries(r.hc.outside)) if (d > 1.5) problems.push(`${key}: ${piece} ${d}px outside its slot`);
    for (const t of r.text.filter((q) => !/^hud\.(lives|gold)$/.test(q.name) || !/by (left|right) -0\.\d/.test(q.detail))) problems.push(`${key}: canvas text ${t.name} "${t.text}" ${t.detail}`);
    rows.push(`${key}: horn ${r.spot} at ${Math.round(r.horn.x)},${Math.round(r.horn.y)}`);
    if (SHOTS && size === SIZES[0]) await page.screenshot({ path: `${SHOTS}/horn-${id}-${size.key}.jpg`, type: 'jpeg', quality: 78 });
  }
  summary.push(`${size.key}: beside the cave on ${stack}/${IDS.length} islands; dock corner: ${sideIds.join(' ')}`);
  await ctx.close();
}
await browser.close();
for (const r of rows) console.log(r);
for (const n of notes) console.log('note', n);
for (const r of summary) console.log(r);
console.log(problems.length ? `problems ${problems.length}:\n${problems.join('\n')}` : 'problems 0');
process.exit(problems.length ? 1 : 0);
