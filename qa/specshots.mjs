// Tier-IV specialization UI, end to end through the real input (taps / clicks on the canvas, the
// DOM card): for every tower family build it → upgrade to III → open its ring → the tier-III tip →
// tap a specialization (tooltip) → tap again (comparison card; keyboard nav + overflow audit) →
// Choose → flourish → its ring with the info card → buy the ability → ring with the ability owned.
// Then a battle with all eight branches: which branch art / turret facings are drawn, ring fit.
// Usage: node qa/specshots.mjs --base=.. [--lang=en|tr] [--size=desk|phone] [--branch=0|1]
//        [--out=docs/spec-ui-shots] [--steps=all|min] [--report=file.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { auditPage } from './uiAuditLib.mjs';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const LANG = arg('lang') ?? 'en';
const SIZE = arg('size') ?? 'desk';
const BRANCH = Number(arg('branch') ?? 0);
const OUT = arg('out') ?? null;
const STEPS = arg('steps') ?? 'all';
const REPORT = arg('report') ?? null;
const LEVEL = arg('level') ?? 'l1c';
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const VIEW = SIZE === 'phone' ? { w: 844, h: 390, dpr: 2, touch: true } : { w: 2000, h: 991, dpr: 1, touch: false };
const FAMILIES = ['archer', 'cannon', 'frost', 'tesla', 'mortar', 'ballista', 'beacon', 'barracks'];
if (OUT) mkdirSync(OUT, { recursive: true });

const problems = [];
const log = [];
const report = { lang: LANG, size: SIZE, branch: BRANCH, families: {}, nav: [], audit: [], battle: null };
const tag = `${LANG}-${SIZE}-b${BRANCH}`;

const browser = await chromium.launch({ args: ARGS });
const ctx = await browser.newContext({ viewport: { width: VIEW.w, height: VIEW.h }, deviceScaleFactor: VIEW.dpr, isMobile: VIEW.touch, hasTouch: VIEW.touch, locale: LANG === 'tr' ? 'tr-TR' : 'en-US' });
await ctx.addInitScript((l) => {
  try {
    if (sessionStorage.getItem('qa-seeded')) return;
    sessionStorage.setItem('qa-seeded', '1');
    localStorage.clear();
    localStorage.setItem('skyhold_isles_language_v1', l);
    localStorage.setItem('skyhold_isles_settings_v1', JSON.stringify({ language: l }));
    localStorage.setItem('skyhold2d_coach_v1', 'done');
    localStorage.setItem('skyhold_isles_coach2d_v1', '1');
  } catch {
    /* ignore */
  }
}, LANG);
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`page error ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' || /could not load/.test(m.text())) problems.push(`console ${m.type()}: ${m.text().slice(0, 200)}`);
});
await page.goto(`${BASE}/2d.html?level=${LEVEL}&lang=${LANG}&desktop=${VIEW.touch ? 0 : 1}&quality=high`);
await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'), null, { timeout: 60000 });
await page.waitForTimeout(1200);
await page.evaluate(() => window.__p0.setGold(99999));

const tap = async (x, y, wait = 280) => {
  if (VIEW.touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await page.waitForTimeout(wait);
};
const shot = async (name) => {
  if (!OUT) return;
  if (STEPS === 'min' && !/card|spec-ring|map|battle|codex|hint/.test(name)) return;
  await page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
};
const ring = () => page.evaluate(() => window.__p0.state().ring);
const spec = () => page.evaluate(() => window.__p0.spec());
const until = (fn, arg, what, timeout = 6000) => page.waitForFunction(fn, arg, { timeout }).catch(() => problems.push(`timeout: ${what}`));

// Build-ring order (the manifest's buildRing).
const buildRing = await page.evaluate(async () => (await (await fetch('/art2d/manifest.json')).json()).buildRing);
// Eight plots far apart (greedy farthest point from the screen centre).
const plots = await page.evaluate(() => {
  const n = window.__p0.state().plots.count;
  return Array.from({ length: n }, (_, i) => ({ i, ...window.__p0.plotScreen(i) }));
});
const chosen = [];
const cx = VIEW.w / 2;
const cy = VIEW.h * 0.55;
const usable = plots.filter((p) => p.x > VIEW.w * 0.08 && p.x < VIEW.w * 0.92 && p.y > VIEW.h * 0.2 && p.y < VIEW.h * 0.9);
chosen.push(usable.reduce((a, b) => (Math.hypot(a.x - cx, a.y - cy) < Math.hypot(b.x - cx, b.y - cy) ? a : b)));
while (chosen.length < FAMILIES.length && chosen.length < usable.length) {
  let best = null;
  let bd = -1;
  for (const p of usable) {
    if (chosen.includes(p)) continue;
    const d = Math.min(...chosen.map((c) => Math.hypot(c.x - p.x, c.y - p.y)));
    if (d > bd) {
      bd = d;
      best = p;
    }
  }
  chosen.push(best);
}
log.push(`plots ${chosen.map((p) => p.i).join(',')}`);

const towerOn = async (plot) => (await spec()).towers.find((t) => t.plot === plot) ?? null;
const openTowerRing = async (plot) => {
  const tw = await towerOn(plot);
  const top = await page.evaluate((id) => window.__p0.towerTop(id), tw.id);
  const p = plots[plot];
  // The tower's body, a little under its roof (a tap on the plot works too).
  await tap(p.x, Math.min(p.y - 8, top.y + 30), 450);
  const r = await ring();
  if (!r?.open || r.mode !== 'tower') {
    await tap(p.x, p.y, 450);
  }
  return ring();
};
const closeRing = async (plot) => {
  const r = await ring();
  if (!r?.open) return;
  const p = plots[plot];
  await tap(p.x, p.y, 350);
  if ((await ring())?.open) await tap(8, VIEW.h - 8, 300);
};

let first = true;
for (let f = 0; f < FAMILIES.length && f < chosen.length; f++) {
  const type = FAMILIES[f];
  const plot = chosen[f].i;
  const fam = { plot, steps: [] };
  // Support towers (beacon) have no targeting medallion.
  const base = type === 'beacon' ? 2 : 3;
  report.families[type] = fam;
  const step = (s) => fam.steps.push(s);
  // Build through the ring: tap the plot, tap the medallion twice.
  await tap(plots[plot].x, plots[plot].y, 450);
  let r = await ring();
  const bi = buildRing.indexOf(type);
  if (!r?.open || r.mode !== 'build' || bi < 0 || !r.tokens[bi]) {
    problems.push(`${type}: build ring not open on plot ${plot}`);
    continue;
  }
  await tap(r.tokens[bi].x, r.tokens[bi].y);
  await tap(r.tokens[bi].x, r.tokens[bi].y, 500);
  let tw = await towerOn(plot);
  if (!tw) {
    problems.push(`${type}: not built`);
    continue;
  }
  step('built');
  // Upgrade to III through the ring's upgrade medallion.
  for (const want of [2, 3]) {
    r = await openTowerRing(plot);
    if (!r?.open || r.tokens.length !== base) problems.push(`${type}: tier ${want - 1} ring has ${r?.tokens.length} tokens`);
    await tap(r.tokens[0].x, r.tokens[0].y);
    await tap(r.tokens[0].x, r.tokens[0].y, 500);
    tw = await towerOn(plot);
    if (tw.tier !== want) problems.push(`${type}: upgrade to ${want} failed (tier ${tw.tier})`);
  }
  step('tier3');
  if (first) {
    await until(() => window.__p0.spec().hint?.shown, null, 'tier-III tip');
    await page.waitForTimeout(500);
    const h = (await spec()).hint;
    report.hint = h;
    await shot('0-hint');
  }
  // The tier-III ring: two specialization medallions + targeting / rally + sell.
  r = await openTowerRing(plot);
  if (r.tokens.length !== base + 1) problems.push(`${type}: tier-III ring has ${r.tokens.length} tokens (want ${base + 1})`);
  await page.waitForTimeout(500);
  await shot(`${type}-1-ring`);
  const tk = r.tokens[BRANCH];
  await tap(tk.x, tk.y, 500);
  const tip = (await spec()).tip;
  if (!tip) problems.push(`${type}: no tooltip on the specialization medallion`);
  report.families[type].tip = tip;
  const range = await page.evaluate(() => window.__p0.state().ring.rangeShown);
  if (!range) problems.push(`${type}: no range preview for the branch`);
  await shot(`${type}-2-tip`);
  // Second tap: the comparison card.
  await tap(tk.x, tk.y, 300);
  await until(() => !!document.querySelector('[data-testid="spec-card"]'), null, `${type}: comparison card`);
  await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().filter((an) => an.effect?.getComputedTiming().iterations !== Infinity).map((an) => an.finished.catch(() => undefined))), new Promise((res) => setTimeout(res, 2000))]));
  // Pictures in: both portraits decoded.
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="spec-card"] img.pu-spec-art')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 8000 }).catch(() => problems.push(`${type}: card portraits not loaded`));
  const card = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('[data-testid^="spec-col-"]')].map((c) => ({
      id: c.dataset.testid.slice(9),
      changes: c.querySelectorAll('.pu-spec-change').length,
      abilities: c.querySelectorAll('.pu-spec-ability').length,
      portrait: !!c.querySelector('img.pu-spec-art'),
      disabled: c.querySelector('button')?.disabled ?? null,
    }));
    return { cols, focus: document.activeElement?.dataset?.testid ?? null, paused: window.__p0.state().paused ?? null };
  });
  fam.card = card;
  if (card.cols.length !== 2) problems.push(`${type}: card has ${card.cols.length} branches`);
  for (const c of card.cols) if (!c.changes || !c.abilities || !c.portrait) problems.push(`${type}: card column ${c.id} incomplete ${JSON.stringify(c)}`);
  const audit = await page.evaluate(auditPage, {});
  for (const p of audit.problems) problems.push(`${type} card: [${p.kind}] ${p.at} "${p.text}" — ${p.detail}`);
  report.audit.push({ type, texts: audit.stats.texts, problems: audit.problems.length });
  await shot(`${type}-3-card`);
  // Keyboard / pad nav: arrows walk between the two Choose planks (and the close seal).
  const ids = card.cols.map((c) => `spec-choose-${c.id}`);
  const want = ids[BRANCH];
  const nav = [card.focus];
  // Left then right: from either column this visits both planks (right of the right one is the close seal).
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowRight', 'ArrowLeft']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
    nav.push(await page.evaluate(() => document.activeElement?.dataset?.testid ?? document.activeElement?.className ?? null));
  }
  report.nav.push({ type, nav });
  if (!nav.includes(ids[0]) || !nav.includes(ids[1])) problems.push(`${type}: keyboard nav did not reach both Choose planks (${nav.join(' → ')})`);
  // Choose: by keyboard (Enter on the focused plank) for branch 0 on desktop, a tap otherwise.
  const focusNow = nav[nav.length - 1];
  if (!VIEW.touch && focusNow === want) await page.keyboard.press('Enter');
  else {
    const b = await page.locator(`[data-testid="${want}"]`).boundingBox();
    await tap(b.x + b.width / 2, b.y + b.height / 2, 0);
  }
  await page.waitForTimeout(140);
  await shot(`${type}-4-flourish`);
  await until((pl) => window.__p0.spec().towers.find((t) => t.plot === pl)?.spec, plot, `${type}: specialized`);
  tw = await towerOn(plot);
  fam.spec = tw.spec;
  if (tw.spec !== card.cols[BRANCH].id) problems.push(`${type}: chose ${card.cols[BRANCH].id}, tower has ${tw.spec}`);
  if (await page.evaluate(() => !!document.querySelector('[data-testid="spec-card"]:not(.closing)'))) problems.push(`${type}: card still open after Choose`);
  step('specialized');
  // The new art in the world (loads lazily).
  await page.waitForFunction((pl) => window.__p0.spec().art.find((a) => a.plot === pl)?.specialization, plot, { timeout: 10000 }).catch(() => problems.push(`${type}: branch art not drawn`));
  const art = (await spec()).art.find((a) => a.plot === plot);
  fam.art = art;
  if (art && (Math.abs(art.dx) > 0.5 || Math.abs(art.dy) > 0.5 || Math.abs(art.dw) > 0.5)) problems.push(`${type}: branch ring off its plot ${JSON.stringify(art)}`);
  await page.waitForTimeout(600);
  // Specialized ring: the ability medallion (price, pip) + the info card.
  r = await openTowerRing(plot);
  if (r.tokens.length !== base) problems.push(`${type}: specialized ring has ${r.tokens.length} tokens (want ${base})`);
  await page.waitForTimeout(500);
  const info = (await spec()).tip;
  if (!info) problems.push(`${type}: no info card on the specialized ring`);
  const ta = await page.evaluate(() => window.__p0.textAudit());
  for (const p of ta) problems.push(`${type} spec ring: [canvas] ${p.name} "${p.text}" ${p.detail ?? ''}`);
  await shot(`${type}-5-spec-ring`);
  const gold0 = await page.evaluate(() => window.__p0.state().gold ?? null);
  await tap(r.tokens[0].x, r.tokens[0].y, 400);
  await shot(`${type}-6-ability-tip`);
  await tap(r.tokens[0].x, r.tokens[0].y, 500);
  tw = await towerOn(plot);
  fam.abilities = tw.abilities;
  if (tw.abilities.length !== 1) problems.push(`${type}: ability not bought (${JSON.stringify(tw.abilities)}, gold ${gold0})`);
  step('ability');
  r = await openTowerRing(plot);
  await page.waitForTimeout(400);
  await shot(`${type}-7-owned`);
  await closeRing(plot);
  first = false;
}

// All eight branches on the island, then a battle: what the turret / sheet art draws.
await page.waitForTimeout(800);
await shot('map');
report.hudCheck = await page.evaluate(() => {
  const h = window.__p0.hudCheck();
  return { overlaps: h.overlaps, outside: Object.fromEntries(Object.entries(h.outside).filter(([, v]) => v > 1)) };
});
if (report.hudCheck.overlaps.length) problems.push(`hudCheck overlaps ${JSON.stringify(report.hudCheck.overlaps)}`);
if (Object.keys(report.hudCheck.outside).length) problems.push(`hudCheck outside ${JSON.stringify(report.hudCheck.outside)}`);
const seen = {};
await page.evaluate(() => {
  window.__p0.replay.cmd({ k: 'wave' });
});
for (let i = 0; i < 70; i++) {
  await page.evaluate(() => window.__p0.replay.step(3));
  const s = await spec();
  for (const t of s.turrets) {
    if (!t.specialization) continue;
    const k = t.specialization;
    seen[k] ??= { sectors: [], frames: [], mirror: [] };
    if (!seen[k].sectors.includes(t.sector)) seen[k].sectors.push(t.sector);
    if (!seen[k].frames.includes(t.frame)) seen[k].frames.push(t.frame);
    if (!seen[k].mirror.includes(t.mirror)) seen[k].mirror.push(t.mirror);
  }
  for (const a of s.art) {
    if (!a.specialization) continue;
    seen[a.specialization] ??= { sectors: [], frames: [], mirror: [] };
    seen[a.specialization].attackFrames ??= [];
    if (a.attackFrame >= 0 && !seen[a.specialization].attackFrames.includes(a.attackFrame)) seen[a.specialization].attackFrames.push(a.attackFrame);
  }
  if (i === 35) await shot('battle');
  if ((await page.evaluate(() => window.__p0.state().outcome ?? 'ongoing')) !== 'ongoing') break;
}
report.battle = seen;
const s = await spec();
report.final = s.towers;
report.flourishes = s.flourishes;
if (s.flourishes !== FAMILIES.length) problems.push(`flourishes ${s.flourishes} (want ${FAMILIES.length})`);
for (const a of s.art) if (!a.specialization) problems.push(`tower on plot ${a.plot} (${a.type}) draws no branch art`);

report.problems = problems;
report.log = log;
if (REPORT) writeFileSync(REPORT, JSON.stringify(report, null, 1));
console.log(`${tag}: families ${Object.keys(report.families).length}, problems ${problems.length}`);
for (const p of problems) console.log('  ' + p);
for (const [k, v] of Object.entries(report.families)) console.log(`  ${k}: ${v.steps.join('>')} spec=${v.spec} abilities=${(v.abilities ?? []).join(',')} art=${v.art?.specialization ?? '-'} card=${(v.card?.cols ?? []).map((c) => `${c.id}:${c.changes}`).join(' ')}`);
console.log('  battle', JSON.stringify(seen));
await browser.close();
process.exit(problems.length ? 1 : 0);
