// Regression: tier-IV branch bought from the build ring (two taps, no board, no pause), the
// optional compare card closes by every path without leaving the run stuck, and the ring still
// upgrades other towers afterwards (owner report 2026-11-21: "after the box opened I could not
// upgrade anything any more" — the lazy card chunk failing left the run paused for good).
// Usage (vite dev or preview): node qa/specstuck.mjs --base=http://127.0.0.1:4471 [--shots=docs/anim-shots/spec] [--size=844x390] [--desktop=1]
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const SHOTS = arg('shots') ?? null;
const DESKTOP = arg('desktop') === '1';
const [W, H] = (arg('size') ?? '844x390').split('x').map(Number);
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, ...(DESKTOP ? {} : { isMobile: true, hasTouch: true }) });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('skyhold2d_coach_v1', 'done');
    localStorage.setItem('skyhold_isles_language_v1', 'tr');
  } catch {
    /* */
  }
});
const page = await ctx.newPage();
const errors = [];
let blockCard = false;
page.on('pageerror', (e) => {
  if (!(blockCard && /dynamically imported module|Importing a module script failed/.test(e.message))) errors.push(e.stack?.split('\n').slice(0, 3).join(' / ') ?? e.message);
});
await page.route(/specCard2d/, (r) => (blockCard ? r.abort() : r.continue()));
await page.goto(`${BASE}/2d.html?level=i02&hero=bran&lang=tr&desktop=${DESKTOP ? 1 : 0}`);
await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'), null, { timeout: 90000 });
const wait = (ms) => page.waitForTimeout(ms);
const tapAt = async (x, y) => (DESKTOP ? page.mouse.click(x, y) : page.touchscreen.tap(x, y));
const st = () => page.evaluate(() => ({ paused: window.__p0.state().paused, spec: window.__p0.spec(), ring: window.__p0.state().ring }));
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`);
};
const ids = await page.evaluate(() => {
  const p = window.__p0;
  p.setGold(5000);
  for (const plot of [2, 4, 0]) p.replay.cmd({ k: 'build', plot, type: 'archer' });
  const [a, b, c] = p.spec().towers.map((t) => t.id);
  for (const id of [a, c]) {
    p.replay.cmd({ k: 'upgrade', id });
    p.replay.cmd({ k: 'upgrade', id });
  }
  return { a, b, c };
});
await wait(700);
const openRing = async (id) => {
  const top = await page.evaluate((t) => window.__p0.towerTop(t), id);
  await tapAt(top.x, top.y + 30);
  await wait(600);
  return (await st()).ring.tokens;
};
const tier = async (id) => (await st()).spec.towers.find((t) => t.id === id);
/** The ring on this tower (kept when already open on it: a second tap on the tower would close it). */
const ringOn = async (id) => {
  const c = await st();
  return c.ring.open && c.spec.ringTower === id ? c.ring.tokens : openRing(id);
};
/** Select branch 0 (if not yet), then tap the tip's "(i) Compare" row. */
const tapCompare = async (id) => {
  const t = await ringOn(id);
  if ((await st()).ring.layout.selected !== 0) {
    await tapAt(t[0].x, t[0].y);
    await wait(350);
  }
  const cmp = (await st()).ring.compare;
  if (!cmp) return false;
  await tapAt(cmp.x, cmp.y);
  return true;
};

// 1. Tier III ring: branch, branch, target, sell (unchanged 4-token layout). First tap previews, no board.
let tk = await openRing(ids.a);
check('ring open with two branches', tk.length === 4, `tokens=${tk.length}`);
await tapAt(tk[0].x, tk[0].y);
await wait(450);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/ring-preview.png` });
let s = await st();
check('first tap previews, no board, run not paused', !(await page.$('[data-testid="spec-card"]')) && s.paused === false && s.ring.layout.selected === 0);
check('branch tip shows the (i) Compare row', !!s.ring.compare);
const strayTip = s.ring.layout.tooltip;
await tapAt(strayTip.x + strayTip.w / 2, strayTip.y + 12);
await wait(300);
check('stray tap on the tip title: no card', !(await st()).spec.card && (await st()).ring.open);

// 2a. The card chunk failing (before any card loaded: modules are cached) (stale deploy, first open): the run must not stay paused.
blockCard = true;
await tapCompare(ids.a);
await wait(800);
s = await st();
check('card chunk fails: not stuck', s.spec.card === false && s.paused === false, `cardState=${s.spec.cardState}`);
blockCard = false;

// 2b. The optional card: opens from the tip's (i) row; Escape, seal and backdrop all restore the run.
for (const how of ['escape', 'seal', 'backdrop']) {
  await tapCompare(ids.a);
  await page.waitForSelector('[data-testid="spec-card"]', { timeout: 8000 }).catch(() => null);
  await wait(500);
  s = await st();
  check(`compare opens card (${how})`, s.spec.card === true && s.paused === true);
  if (how === 'escape' && SHOTS) await page.screenshot({ path: `${SHOTS}/card-detail.png` });
  if (how === 'escape') await page.keyboard.press('Escape');
  else if (how === 'seal') await page.click('[data-testid="spec-card-close"]');
  else await tapAt(4, H - 4);
  await wait(400);
  s = await st();
  check(`card closed by ${how}: run resumes`, s.spec.card === false && s.paused === false);
}

// 4. Buy branch on tower a from the ring (select → confirm).
tk = await ringOn(ids.a);
await tapAt(tk[1].x, tk[1].y);
await wait(300);
await tapAt(tk[1].x, tk[1].y);
await wait(600);
s = await st();
check('second tap buys branch', !!(await tier(ids.a)).spec && s.paused === false && !s.ring.open, `spec=${(await tier(ids.a)).spec}`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/bought.png` });

// 5. Another tower still upgrades through the ring.
tk = await openRing(ids.b);
const before = (await tier(ids.b)).tier;
await tapAt(tk[0].x, tk[0].y);
await wait(300);
await tapAt(tk[0].x, tk[0].y);
await wait(500);
check('other tower upgrades', (await tier(ids.b)).tier === before + 1, `${before} -> ${(await tier(ids.b)).tier}`);

// 6. Unaffordable branch: previews, the confirm tap buys nothing.
await page.evaluate(() => window.__p0.setGold(10));
tk = await openRing(ids.c);
await tapAt(tk[0].x, tk[0].y);
await wait(300);
await tapAt(tk[0].x, tk[0].y);
await wait(500);
s = await st();
check('poor: no purchase, ring stays', !(await tier(ids.c)).spec && s.ring.open);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/need-gold.png` });

// 7. Keyboard reticle (padCursor: arrows snap to ring tokens, Enter clicks): choose a branch.
await page.evaluate(() => window.__p0.setGold(5000));
tk = await ringOn(ids.c);
let onBranch = -1;
const keys = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
for (let k = 0; k < keys.length && onBranch < 0; k++) {
  await page.keyboard.press(keys[k]);
  await wait(150);
  const pd = await page.evaluate(() => window.__p0.pad());
  const i = tk.findIndex((t) => Math.hypot(t.x - pd.x, t.y - pd.y) < 6);
  if (arg('debug')) console.log('pad', keys[k], JSON.stringify(pd), i);
  if (pd.mode === 'ring' && (i === 0 || i === 1)) onBranch = i;
}
check('reticle reaches a branch token', onBranch >= 0);
await page.keyboard.press('Enter');
await wait(300);
check('keyboard: first Enter previews (no card)', !(await st()).spec.card && (await st()).ring.layout.selected === onBranch);
await page.keyboard.press('Enter');
await wait(600);
check('keyboard: Enter, Enter chooses the branch', !!(await tier(ids.c)).spec, `spec=${(await tier(ids.c)).spec}`);
console.log(JSON.stringify({ errors, failed: results.filter((r) => !r.ok).length }));
await browser.close();
process.exit(results.every((r) => r.ok) && errors.length === 0 ? 0 : 1);
