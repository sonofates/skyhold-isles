// Directional specializations in every facing: the turret-aim scene (?towers=aim, one stationary
// target visited in each 45° sector) with the tower bought into each branch through the command
// layer. Saves one crop of the tower per sector (after the turret has turned) and reports the drawn
// sector / frame / mirror vs the sim's aim. Usage: node qa/specaim.mjs --base=.. --out=dir
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? '/tmp/specaim';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const BRANCHES = { archer: ['farwatch', 'swallow'], cannon: ['honeycomb', 'bellfoundry'], ballista: ['loom', 'anchor'], mortar: ['cinderkiln', 'cloudbreak'] };
// --baseline=1: the same walk on the plain tier-III tower (no purchase) for comparison.
if (arg('baseline')) for (const k of Object.keys(BRANCHES)) BRANCHES[k] = ['t3'];
const problems = [];
const report = {};
const browser = await chromium.launch({ args: ARGS });
for (const [type, ids] of Object.entries(BRANCHES)) {
  for (const id of ids) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${id}: page error ${e.message}`));
    await page.goto(`${BASE}/2d.html?towers=aim&type=${type}&tier=3&hold=1.4&overlay=0&lang=en&quality=high`);
    await page.waitForFunction(() => window.__p0?.spec && window.__aim?.plot >= 0, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    const ok = id === 't3' || await page.evaluate((spec) => {
      const t = window.__p0.spec().towers[0];
      return window.__p0.replay.cmd({ k: 'spec', id: t.id, spec });
    }, id);
    if (!ok) problems.push(`${id}: purchase refused`);
    if (id !== 't3') await page.waitForFunction(() => window.__p0.spec().art[0]?.specialization, null, { timeout: 15000 }).catch(() => problems.push(`${id}: branch art not drawn`));
    const sectors = await page.evaluate(() => window.__aim.sectors);
    const seen = {};
    const tid = await page.evaluate(() => window.__p0.spec().towers[0].id);
    // Freeze the ticker and step by hand: one hold = 1.4 s = 14 steps of 0.1 s.
    await page.evaluate(() => window.__p0.freeze(true));
    for (let i = 0; i < sectors.length * 14 + 14; i++) {
      await page.evaluate(() => window.__p0.replay.step(1));
      const s = await page.evaluate(() => ({ aim: { ...window.__aim }, tr: window.__p0.spec().turrets[0] }));
      const k = s.aim.current;
      if (!s.tr || seen[k]) continue;
      // Shot after the turret has settled on its sector for most of the hold.
      if (i % 14 === 11) {
        seen[k] = { drawn: s.tr.sector, frame: s.tr.frame, mirror: s.tr.mirror, specialization: s.tr.specialization };
        if (s.tr.sector !== k) problems.push(`${id}: target sector ${k}, turret drawn at ${s.tr.sector}`);
        if (id !== 't3' && s.tr.specialization !== id) problems.push(`${id}: sector ${k} drawn without the branch art (${s.tr.specialization})`);
        const top = await page.evaluate((t) => window.__p0.towerTop(t), tid);
        const clip = { x: Math.max(0, top.x - 110), y: Math.max(0, top.y - 40), width: 220, height: 220 };
        await page.screenshot({ path: `${OUT}/${type}-${id}-s${k}.png`, clip });
      }
    }
    report[id] = { sectors, seen };
    const missing = sectors.filter((s) => !seen[s]);
    if (missing.length) problems.push(`${id}: no capture for sectors ${missing.join(',')}`);
    console.log(`${id}: sectors ${sectors.join(',')} → ${Object.entries(seen).map(([k, v]) => `${k}:${v.drawn}/f${v.frame}${v.mirror ? 'm' : ''}`).join(' ')}`);
    await ctx.close();
  }
}
writeFileSync(`${OUT}/report.json`, JSON.stringify({ report, problems }, null, 1));
console.log(`problems ${problems.length}`);
for (const p of problems) console.log('  ' + p);
await browser.close();
process.exit(problems.length ? 1 : 0);
