// PC release QA (docs/handoff-pc-readiness.md), one Chromium, against `vite preview`:
// title menu, world map + Esc game menu, Settings (General / Audio / Graphics / Controls + a key
// rebind), a battle, the pause menu, right-click cancel, pause on blur, and a store-leftover text
// scan — at 1920x1080 and 1280x720 (desktop, mouse). The Electron shell is simulated by a fake
// `window.skyholdDesktop` (desktop/preload.cjs shape) so the PC-only rows (Display mode, VSync,
// Quit game) show; the real shell is covered by `npm run desktop:smoke`.
// Usage: python3 qa/withPreview.py --port=4417 node qa/pcshots.mjs [--sizes=1920x1080,1280x720] [--out=docs/pc-shots]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4417';
const OUT = arg('out') ?? 'docs/pc-shots';
const SIZES = (arg('sizes') ?? '1920x1080,1280x720').split(',').map((s) => {
  const [w, h] = s.split('x').map(Number);
  return { key: s, w, h };
});
const ISLAND = arg('island') ?? 'i37';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const problems = [];
const notes = [];
const check = (ok, msg) => {
  if (!ok) problems.push(msg);
};

const FAKE_SHELL = () => {
  let mode = 'fullscreen';
  const ls = new Set();
  window.__shellCalls = [];
  window.skyholdDesktop = {
    platform: 'linux',
    getWindowMode: () => mode,
    setWindowMode: async (m) => {
      window.__shellCalls.push(['mode', m]);
      mode = m;
      for (const l of ls) l(mode);
      return mode;
    },
    onWindowModeChange: (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    getVsync: () => true,
    setVsync: async (v) => {
      window.__shellCalls.push(['vsync', v]);
      return v;
    },
    quit: () => window.__shellCalls.push(['quit']),
  };
};

async function open(size, query, ready) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
  await ctx.addInitScript(FAKE_SHELL);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${size.key} ${query}: pageerror ${e.message}`));
  await page.goto(`${BASE}/2d.html?${query}`);
  await page.waitForFunction(ready, null, { timeout: 120000 });
  await page.waitForTimeout(800);
  return { ctx, page };
}
// SwiftShader at 2560x1440 on a busy server needs a long time per frame.
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 80, timeout: 150000 });
const visible = (page, testid) =>
  page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
  }, testid);
const storeText = (page) =>
  page.evaluate(() => {
    const txt = document.body.innerText;
    return /full adventure|restore purchases|buy the|unlock all|\$\d|€\d|£\d|crystal pack/i.exec(txt)?.[0] ?? null;
  });
/** Smallest rendered font size of visible text in the open board (px) — "phone-sized UI" probe. */
const minFont = (page, sel) =>
  page.evaluate((s) => {
    let min = Infinity;
    for (const el of document.querySelectorAll(`${s} *`)) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
    }
    return Math.round(min * 10) / 10;
  }, sel);

for (const size of SIZES) {
  const k = size.key;
  // 1. Title screen (main menu) with the PC Quit plank.
  {
    const { ctx, page } = await open(size, 'title=1', () => !!window.__title);
    await page.waitForFunction(() => window.__title.state().phase === 'tap', null, { timeout: 90000 });
    await page.waitForTimeout(600);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__title.state().phase === 'menu', null, { timeout: 10000 });
    await page.waitForTimeout(900);
    check(await visible(page, 'title2d-quit'), `${k}: title has no Quit plank`);
    await shot(page, `title-${k}`);
    await page.click('[data-testid="title2d-quit"]');
    await page.waitForTimeout(400);
    check(await visible(page, 'confirm-quit'), `${k}: title Quit does not ask`);
    await page.click('[data-testid="confirm-quit-yes"]');
    await page.waitForTimeout(200);
    const calls = await page.evaluate(() => window.__shellCalls);
    check(calls.some((c) => c[0] === 'quit'), `${k}: title Quit did not call the shell`);
    await ctx.close();
  }
  // 2. World map, Esc game menu, store scan, Settings tabs.
  {
    const { ctx, page } = await open(size, 'chapter=1', () => !!window.__map?.layout?.());
    await shot(page, `map-${k}`);
    const leftover = await storeText(page);
    check(leftover === null, `${k}: store text on the map: ${leftover}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    check(await visible(page, 'game-menu'), `${k}: Esc on the map shows no game menu`);
    check(await visible(page, 'game-menu-quit'), `${k}: game menu has no Quit`);
    await shot(page, `map-escmenu-${k}`);
    await page.click('[data-testid="game-menu-settings"]');
    await page.waitForTimeout(700);
    for (const tab of ['general', 'audio', 'graphics', 'controls']) {
      await page.click(`[data-testid="set2d-tab-${tab}"]`);
      await page.waitForTimeout(400);
      await shot(page, `settings-${tab}-${k}`);
      notes.push(`${k} settings/${tab}: min font ${await minFont(page, '[data-testid="settings2d"]')} px`);
      if (tab === 'general') {
        check(!(await visible(page, 'set2d-haptics')), `${k}: haptics row shown on a PC`);
        check((await storeText(page)) === null, `${k}: store text in Settings`);
      }
      if (tab === 'audio') check(await visible(page, 'set2d-sfx'), `${k}: no Effects volume slider`);
      if (tab === 'graphics') {
        check(await visible(page, 'set2d-display-windowed'), `${k}: no Display mode row`);
        check(await visible(page, 'set2d-vsync'), `${k}: no VSync row`);
        check(await visible(page, 'set2d-fpscap-144'), `${k}: no 144 FPS cap`);
        await page.click('[data-testid="set2d-display-windowed"]');
        await page.click('[data-testid="set2d-vsync"]');
        await page.waitForTimeout(200);
        const calls = await page.evaluate(() => window.__shellCalls);
        check(calls.some((c) => c[0] === 'mode' && c[1] === 'windowed'), `${k}: Display mode did not reach the shell`);
        check(calls.some((c) => c[0] === 'vsync' && c[1] === false), `${k}: VSync did not reach the shell`);
      }
      if (tab === 'controls') {
        // Rebind Meteor to B: the cap waits, takes the key, and the binding persists.
        await page.click('[data-testid="set2d-key-meteor"]');
        await page.waitForTimeout(150);
        await shot(page, `settings-controls-rebind-${k}`);
        await page.keyboard.press('b');
        await page.waitForTimeout(200);
        const cap = await page.textContent('[data-testid="set2d-key-meteor"]');
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('skyhold_isles_keys_v1') ?? '{}').meteor);
        check(cap?.trim() === 'B' && stored === 'B', `${k}: rebind failed (cap ${cap}, stored ${stored})`);
        check(await visible(page, 'settings2d'), `${k}: a rebind keypress closed Settings`);
        await page.click('[data-testid="set2d-keys-reset"]');
        await page.waitForTimeout(150);
        const back = await page.evaluate(() => JSON.parse(localStorage.getItem('skyhold_isles_keys_v1') ?? '{}').meteor);
        check(back === 'Q', `${k}: Reset keys did not restore Q (${back})`);
      }
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    check(!(await visible(page, 'settings2d')), `${k}: Esc does not close Settings`);
    await ctx.close();
  }
  // 3. A battle: HUD, pause menu (Esc), right-click cancel, pause on blur.
  {
    const { ctx, page } = await open(size, `level=${ISLAND}`, () => !!window.__p0?.state);
    await page.evaluate(() => window.__p0.setGold?.(2000));
    await page.keyboard.press('n');
    await page.waitForTimeout(4500);
    await shot(page, `battle-${k}`);
    const hud = await page.evaluate(() => window.__p0.hudCheck());
    notes.push(`${k} battle hudCheck: ${JSON.stringify(hud).slice(0, 200)}`);
    // Right click closes the build ring.
    const plot = await page.evaluate(() => {
      const st = window.__p0.state();
      for (let i = 0; i < 40; i++) {
        const p = window.__p0.plotScreen(i);
        if (p && p.x > 80 && p.y > 120 && p.x < innerWidth - 80 && p.y < innerHeight - 160 && !st.towers.some((t) => t.plot === i)) return p;
      }
      return null;
    });
    if (plot) {
      await page.mouse.click(plot.x, plot.y);
      await page.waitForTimeout(300);
      const opened = await page.evaluate(() => window.__p0.state().ring.open);
      await shot(page, `battle-ring-${k}`);
      await page.mouse.click(plot.x + 3, plot.y + 3, { button: 'right' });
      await page.waitForTimeout(250);
      const closed = !(await page.evaluate(() => window.__p0.state().ring.open));
      check(opened && closed, `${k}: right click did not close the ring (opened ${opened}, closed ${closed})`);
    } else notes.push(`${k}: no free plot found for the ring check`);
    // Esc: the pause menu with the PC Quit plank.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    check(await page.evaluate(() => window.__p0.state().paused), `${k}: Esc did not pause`);
    check(await visible(page, 'pause2d-quit'), `${k}: pause menu has no Quit`);
    await shot(page, `battle-pause-${k}`);
    await page.click('[data-testid="pause2d-resume"]');
    await page.waitForTimeout(300);
    check(!(await page.evaluate(() => window.__p0.state().paused)), `${k}: Resume did not resume`);
    // Focus loss pauses a running battle.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(200);
    check(await page.evaluate(() => window.__p0.state().paused), `${k}: blur did not pause`);
    await page.keyboard.press(' ');
    await page.waitForTimeout(200);
    check(!(await page.evaluate(() => window.__p0.state().paused)), `${k}: Space did not resume`);
    // A rebound pause key works in the run.
    await page.evaluate(() => localStorage.setItem('skyhold_isles_keys_v1', JSON.stringify({ pause: 'P', meteor: 'Q' })));
    await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'skyhold_isles_keys_v1' })));
    await page.keyboard.press('p');
    await page.waitForTimeout(200);
    check(await page.evaluate(() => window.__p0.state().paused), `${k}: rebound P did not pause`);
    await ctx.close();
  }
}

await browser.close();
console.log(JSON.stringify({ problems, notes }, null, 1));
process.exit(problems.length ? 1 : 0);
