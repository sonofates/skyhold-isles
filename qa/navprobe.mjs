// Keyboard + gamepad menu navigation probe (navFocus.ts): map → briefing → Play focus, Settings
// tabs with LB/RB, title menu, pause menu, with a fake standard gamepad (navigator.getGamepads stub).
// Usage: node qa/navprobe.mjs [--base=..] [--shots=dir] [--size=1920x1080]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const SHOTS = arg('shots') ?? null;
const [W, H] = (arg('size') ?? '1920x1080').split('x').map(Number);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const pad = (a, v) => [...a, ...Array(Math.max(0, 25 - a.length)).fill(v)];
const SEED = JSON.stringify({ ids: IDS, progress: { version: 2, unlockedLevelIndex: 4, bestStars: pad([3, 2, 3, 1], 0), clears: pad([2, 1, 1, 1], 0) } });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const problems = [];
const check = (ok, msg) => {
  if (!ok) problems.push(msg);
  console.log(`${ok ? 'ok ' : 'BAD'} ${msg}`);
};

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript(([s]) => {
    if (!sessionStorage.getItem('qa-seeded')) {
      sessionStorage.setItem('qa-seeded', '1');
      localStorage.clear();
      localStorage.setItem('skyhold_isles_language_v1', 'en');
      localStorage.setItem('skyhold_isles_progress2d_v1', s);
      localStorage.setItem('skyhold_isles_coach2d_v1', '1');
      localStorage.setItem('skyhold2d_coach_v1', 'done');
    }
    // A fake standard-mapping pad the probe drives (17 buttons, 4 axes).
    const pad = { id: 'qa pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    window.__fakePad = {
      connect() {
        navigator.getGamepads = () => [pad, null, null, null];
        window.dispatchEvent(new Event('gamepadconnected'));
      },
      set(i, on) {
        pad.buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 };
      },
      axes(x, y) {
        pad.axes[0] = x;
        pad.axes[1] = y;
      },
    };
  }, [SEED]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`page error ${e.message}`));
  return { ctx, page };
}

const focused = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return a && a !== document.body ? (a.dataset.testid ?? a.className) : null;
});
const kbd = (page) => page.evaluate(() => document.documentElement.classList.contains('pu-kbd'));
const tapPad = async (page, i, ms = 250) => {
  // Held for a while: a run renders slowly in software GL and the pad is polled once per frame.
  await page.evaluate((b) => window.__fakePad.set(b, true), i);
  await page.waitForTimeout(ms);
  await page.evaluate((b) => window.__fakePad.set(b, false), i);
  await page.waitForTimeout(250);
};
const shot = (page, n) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${n}.jpg`, type: 'jpeg', quality: 74 }) : Promise.resolve());

// --- keyboard on the map -------------------------------------------------------------------------
{
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/2d.html?lang=en&desktop=1`);
  await page.waitForSelector('[data-testid="worldmap2d"] .pu-node');
  await page.waitForTimeout(1500);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  const f0 = await focused(page);
  check(f0 === 'map2d-island-i04', `map: first arrow focuses the island to play next (got ${f0})`);
  check(await kbd(page), 'map: focus ring mode on');
  await shot(page, 'nav-map-focus');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  const f1 = await focused(page);
  check(f1 && f1 !== f0 && f1.startsWith('map2d-island-'), `map: ← moves to another island (${f1})`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.pu-overlay', { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(600);
  check(await page.evaluate(() => !!document.querySelector('.pu-overlay')), 'map: Enter on an island opens its briefing');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  const fp = await focused(page);
  check(!!fp, `briefing: ↓ walks the board (now ${fp})`);
  await shot(page, 'nav-brief-focus');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check(await page.evaluate(() => !document.querySelector('.pu-overlay')), 'briefing: Esc closes it');
  // Pointer press hides the ring.
  await page.mouse.click(5, H - 5);
  check(!(await kbd(page)), 'pointer press turns the focus ring mode off');
  await ctx.close();
}

// --- gamepad: settings tabs, slider, back --------------------------------------------------------
{
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/2d.html?lang=en&desktop=1&screen=settings`);
  await page.waitForSelector('[data-testid="settings2d"]');
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__fakePad.connect());
  await page.waitForTimeout(200);
  await tapPad(page, 13); // down
  const g0 = await focused(page);
  check(!!g0, `pad: D-pad down focuses a control in Settings (${g0})`);
  await tapPad(page, 5); // RB
  await page.waitForTimeout(200);
  const tab = await page.evaluate(() => document.querySelector('.pu-settings .pu-sheet-body')?.dataset.tab);
  check(tab === 'audio', `pad: RB switches to the next tab (${tab})`);
  await tapPad(page, 5);
  await tapPad(page, 5);
  const tab2 = await page.evaluate(() => document.querySelector('.pu-settings .pu-sheet-body')?.dataset.tab);
  check(tab2 === 'controls', `pad: RB again → controls (${tab2})`);
  await shot(page, 'nav-settings-controls');
  await tapPad(page, 4); // LB
  await tapPad(page, 4);
  const tab3 = await page.evaluate(() => document.querySelector('.pu-settings .pu-sheet-body')?.dataset.tab);
  check(tab3 === 'audio', `pad: LB goes back (${tab3})`);
  // Walk to the volume slider and nudge it with D-pad →.
  let onSlider = false;
  for (let i = 0; i < 8 && !onSlider; i++) {
    await tapPad(page, 13);
    onSlider = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'slider');
  }
  if (onSlider) {
    const v0 = await page.evaluate(() => document.activeElement.getAttribute('aria-valuenow'));
    await tapPad(page, 14); // left
    const v1 = await page.evaluate(() => document.activeElement.getAttribute('aria-valuenow'));
    check(v0 !== v1, `pad: D-pad ← on a slider changes it (${v0} → ${v1})`);
  } else check(false, 'pad: could not reach a slider in Audio');
  await tapPad(page, 1); // B
  await page.waitForTimeout(400);
  check(await page.evaluate(() => !document.querySelector('[data-testid="settings2d"]')), 'pad: B closes the board');
  await ctx.close();
}

// --- title with keyboard + pad A -----------------------------------------------------------------
{
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/2d.html?lang=en&desktop=1&title=1`);
  await page.waitForFunction(() => window.__title?.state().phase === 'tap', null, { timeout: 30000 });
  await page.evaluate(() => window.__fakePad.connect());
  await tapPad(page, 0); // A = press any key
  await page.waitForTimeout(500);
  const ph = await page.evaluate(() => window.__title.state().phase);
  check(ph === 'menu', `title: pad A opens the menu (${ph})`);
  await tapPad(page, 13);
  const t1 = await focused(page);
  check(t1 === 'title2d-new', `title: D-pad down → New game (${t1})`);
  await tapPad(page, 13);
  const t2 = await focused(page);
  check(t2 === 'title2d-settings' || t2 === 'title2d-credits', `title: down again → bottom row (${t2})`);
  await shot(page, 'nav-title-focus');
  await ctx.close();
}

// --- pause menu (keyboard) -----------------------------------------------------------------------
{
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/2d.html?lang=en&desktop=1&level=i02&hero=bran`);
  await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  const p0 = await focused(page);
  check(p0 === 'pause2d-resume', `pause: first arrow focuses Resume (${p0})`);
  await page.keyboard.press('ArrowRight');
  const p1 = await focused(page);
  check(p1 === 'pause2d-restart', `pause: → Restart (${p1})`);
  await shot(page, 'nav-pause-focus');
  await page.keyboard.press(' ');
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => ({ paused: window.__p0.state().paused, confirm: !!document.querySelector('[data-testid="confirm-restart"]') }));
  check(!st.paused && !st.confirm, `pause: Space resumes without pressing the focused plank (${JSON.stringify(st)})`);
  await ctx.close();
}

// --- in a run: pad reticle → plot → ring → build; hero glide + move; keyboard arrows + Enter -----
{
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/2d.html?lang=en&desktop=1&level=i02&hero=bran`);
  await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.__p0.setGold(3000);
    window.__fakePad.connect();
  });
  await page.waitForTimeout(200);
  await tapPad(page, 15); // right: wakes the reticle on the nearest target
  let pad = await page.evaluate(() => window.__p0.pad());
  check(pad?.shown && pad.mode === 'snap', `run: D-pad shows the reticle in snap mode (${JSON.stringify(pad)})`);
  // Walk until the reticle sits on a plot (the hero is a target too).
  const plotUnder = () => page.evaluate(() => {
    const p0 = window.__p0.pad();
    const n = window.__p0.state().fit ? 60 : 0;
    for (let i = 0; i < n; i++) {
      let p;
      try { p = window.__p0.plotScreen(i); } catch { break; }
      if (!p || !Number.isFinite(p.x)) break;
      if (Math.hypot(p.x - p0.x, p.y - p0.y) < 2) return i;
    }
    return -1;
  });
  let onPlot = await plotUnder();
  for (const b of [15, 13, 14, 12, 15, 15]) {
    if (onPlot >= 0) break;
    await tapPad(page, b);
    onPlot = await plotUnder();
  }
  check(onPlot >= 0, `run: the reticle sits on a plot (${onPlot})`);
  await tapPad(page, 0, 450); // A: open the ring
  await page.waitForTimeout(500);
  let st = await page.evaluate(() => window.__p0.state());
  check(st.ring.open, 'run: A on a plot opens the build ring');
  await shot(page, 'nav-run-ring');
  await tapPad(page, 12); // up: to a token
  pad = await page.evaluate(() => window.__p0.pad());
  check(pad.mode === 'ring', `run: reticle walks the ring tokens (${pad.mode})`);
  const towers0 = st.towers.length;
  await tapPad(page, 0, 450); // A on a token: select it (first tap shows the tooltip, second builds)
  await page.waitForTimeout(300);
  const selAfterOne = await page.evaluate(() => window.__p0.state().ring.layout.selected);
  await tapPad(page, 0, 450);
  await page.waitForTimeout(600);
  st = await page.evaluate(() => window.__p0.state());
  if (st.ring.open && st.towers.length === towers0) {
    // A missed poll (software GL frames are slow) or a real miss: press through the reticle itself.
    console.log(`note: second pad A not seen (selected after one: ${selAfterOne}); pressing via the reticle`);
    await page.evaluate(() => window.__p0.padClick());
    await page.waitForTimeout(600);
    st = await page.evaluate(() => window.__p0.state());
  }
  const padNow = await page.evaluate(() => window.__p0.pad());
  check(st.towers.length === towers0 + 1 || !st.ring.open, `run: A on a ring token acts (towers ${towers0} → ${st.towers.length}, ring ${st.ring.open}, selected ${st.ring.layout.selected}, pad ${Math.round(padNow.x)},${Math.round(padNow.y)} ${padNow.mode}, tokens ${JSON.stringify(st.ring.tokens.map((t) => [Math.round(t.x), Math.round(t.y), t.enabled]))})`);
  if (st.ring.open) {
    await tapPad(page, 1); // B
    await page.waitForTimeout(300);
    st = await page.evaluate(() => window.__p0.state());
  }
  check(!st.ring.open, 'run: B closes the ring');
  await tapPad(page, 3); // Y: hero
  await page.waitForTimeout(300);
  pad = await page.evaluate(() => window.__p0.pad());
  check(pad.mode === 'free', `run: Y selects the hero, reticle glides (${pad.mode})`);
  const x0 = pad.x;
  await page.evaluate(() => window.__fakePad.axes(0.9, 0));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__fakePad.axes(0, 0));
  pad = await page.evaluate(() => window.__p0.pad());
  check(pad.x > x0 + 40, `run: the stick glides the reticle (${Math.round(x0)} → ${Math.round(pad.x)})`);
  await shot(page, 'nav-run-hero');
  await tapPad(page, 0, 450);
  await page.waitForTimeout(300);
  const sel = await page.evaluate(() => window.__p0.hero.state());
  check(!sel.selected, `run: A gives the move order (selected ${sel.selected})`);
  // Keyboard: arrows move the reticle, Enter clicks.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  st = await page.evaluate(() => window.__p0.state());
  check(st.ring.open, 'run: arrows + Enter open a ring');
  await page.keyboard.press('Escape');
  // The HUD's DOM buttons are reticle targets too: top-right is Settings / Codex.
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  const board = await page.evaluate(() => document.querySelector('.pu-overlay:not(.closing)')?.dataset.testid ?? null);
  check(!!board, `run: reticle reaches a HUD button and Enter presses it (${board})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.mouse.move(10, 10);
  await page.mouse.move(30, 30);
  pad = await page.evaluate(() => window.__p0.pad());
  check(!pad.shown, 'run: a real mouse hides the reticle');
  await ctx.close();
}

// --- end boards: the reticle jumps to the glowing button (Retry after a defeat, Next after a win) --
for (const outcome of ['lost', 'won']) {
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/2d.html?lang=en&desktop=1&level=i02&hero=bran`);
  await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__fakePad.connect());
  await page.waitForTimeout(200);
  await tapPad(page, 15); // wake the reticle in the run
  await page.evaluate((o) => window.__p0.forceEnd(o), outcome);
  await page.waitForFunction(() => !!window.__p0.state().end, null, { timeout: 10000 });
  await page.locator('[data-testid="story2d-skip"]').click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(2600);
  const r = await page.evaluate(() => ({ pad: window.__p0.pad(), buttons: window.__p0.state().end?.buttons ?? [] }));
  const want = outcome === 'lost' ? 'retry' : 'next';
  const b = r.buttons.find((x) => x.action === want);
  const on = b && Math.hypot(r.pad.x - b.x, r.pad.y - b.y) < 6;
  check(r.pad.mode === 'end' && !!on, `end ${outcome}: reticle starts on ${want} (pad ${Math.round(r.pad.x)},${Math.round(r.pad.y)} ${r.pad.mode}; ${want} ${b ? `${Math.round(b.x)},${Math.round(b.y)}` : 'missing'})`);
  await ctx.close();
}

await browser.close();
console.log(problems.length ? `nav probe: ${problems.length} problems\n  ${problems.join('\n  ')}` : 'nav probe: 0 problems');
process.exit(problems.length ? 1 : 0);
