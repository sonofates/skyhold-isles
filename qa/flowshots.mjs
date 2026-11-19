// Small game-flow QA against `vite preview` (default http://127.0.0.1:4381): low-lives warning,
// pause on window blur (desktop), Settings → Controls (3× + replay keys), 3× speed key.
// Usage: node qa/flowshots.mjs [--lang=en,tr] [--size=1920x1080,844x390]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'docs/overnight/opus-shots';
const LANGS = (arg('lang') ?? 'en,tr').split(',');
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const ALL_SIZES = [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1, desktop: true },
  { key: '1920x1080@2', w: 1920, h: 1080, dpr: 2, desktop: true },
  { key: '844x390', w: 844, h: 390, dpr: 2, touch: true },
];
const SIZES = ALL_SIZES.filter((s) => !arg('size') || arg('size').split(',').includes(s.key));
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
    await page.goto(`${BASE}/2d.html?level=l1c&hero=bran&lang=${lang}&desktop=${size.desktop ? 1 : 0}`);
    await page.waitForFunction(() => window.__p0?.lives && !document.getElementById('boot'), null, { timeout: 60000 });
    await page.waitForTimeout(500);
    // Foe info card: call wave 1, let foes walk out, tap one.
    await page.evaluate(() => {
      window.__p0.replay.cmd({ k: 'wave' });
      window.__p0.replay.step(40);
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__p0.freeze(true));
    const at = await page.evaluate(() => window.__p0.foeAt());
    if (!at) problems.push(`${tag}: no foe to tap`);
    else {
      await page.evaluate(([x, y]) => window.__p0.hero.tap(x, y), [at.x, at.y]);
      await page.evaluate(() => window.__p0.freeze(false));
      await page.waitForFunction(() => window.__p0.foe().shown, null, { timeout: 6000 }).catch(() => undefined);
      await page.evaluate(() => window.__p0.freeze(true));
      const fc = await page.evaluate(() => window.__p0.foe());
      ok(fc?.shown && fc.type, `${tag}: foe card not shown ${JSON.stringify(fc)}`);
      await page.screenshot({ path: `${OUT}/${lang}-${size.key}-foe-card.jpg`, type: 'jpeg', quality: 84 });
      await page.evaluate(() => window.__p0.freeze(false));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      ok(!(await page.evaluate(() => window.__p0.foe().shown)), `${tag}: Esc did not close the foe card`);
      ok(!(await page.evaluate(() => window.__p0.state().paused)), `${tag}: Esc that closed the foe card also paused`);
    }
    // Low lives: drop to 4 of 20 (a hit flash, then the slow pulse).
    await page.evaluate(() => window.__p0.setLives(4));
    await page.waitForFunction(() => window.__p0.lives().low, null, { timeout: 5000 }).catch(() => undefined);
    let lv = await page.evaluate(() => window.__p0.lives());
    ok(lv.low && lv.flashes >= 1, `${tag}: low lives not flagged ${JSON.stringify(lv)}`);
    await page.screenshot({ path: `${OUT}/${lang}-${size.key}-lives-hit.jpg`, type: 'jpeg', quality: 82 });
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `${OUT}/${lang}-${size.key}-lives-low.jpg`, type: 'jpeg', quality: 82 });
    // Speed key 3 (desktop).
    if (size.desktop) {
      // HUD hover tooltip on the horn.
      const horn = await page.evaluate(() => window.__p0.state().horn);
      await page.mouse.move(horn.x, horn.y);
      await page.waitForFunction(() => !document.querySelector('[data-testid="hud2d-tip"]')?.hidden, null, { timeout: 5000 }).catch(() => problems.push(`${tag}: no horn tooltip`));
      await page.screenshot({ path: `${OUT}/${lang}-${size.key}-tip-horn.jpg`, type: 'jpeg', quality: 84 });
      await page.mouse.move(5, size.h / 2);
      // Tower ring: the targeting token's tooltip (mode, record, next mode).
      await page.evaluate(() => {
        window.__p0.setGold(900);
        window.__p0.replay.cmd({ k: 'build', plot: 6, type: 'archer' });
      });
      const pl = await page.evaluate(() => window.__p0.plotScreen(6));
      await page.mouse.click(pl.x, pl.y - 30);
      await page.waitForFunction(() => window.__p0.state().ring.open, null, { timeout: 5000 }).catch(() => problems.push(`${tag}: tower ring did not open`));
      const toks = await page.evaluate(() => window.__p0.state().ring.tokens);
      if (toks?.[1]) {
        await page.mouse.move(toks[1].x, toks[1].y);
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/${lang}-${size.key}-ring-target-tip.jpg`, type: 'jpeg', quality: 84 });
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      ok(!(await page.evaluate(() => window.__p0.state().paused)), `${tag}: Esc that closed the ring also paused`);
      // Esc with nothing open: the pause menu, Esc again: back to the battle.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      ok(await page.evaluate(() => window.__p0.state().paused), `${tag}: Esc with nothing open did not pause`);
      await page.screenshot({ path: `${OUT}/${lang}-${size.key}-esc-pause.jpg`, type: 'jpeg', quality: 80 });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      ok(!(await page.evaluate(() => window.__p0.state().paused)), `${tag}: second Esc did not resume`);
      // Esc that cancels an ability aim does not pause.
      const ab = await page.evaluate(() => window.__p0.abilities());
      if (ab?.buttons?.overcharge?.state === 'ready' || ab?.buttons?.meteor?.state === 'ready') {
        await page.keyboard.press(ab.buttons.meteor.state === 'ready' ? 'q' : 'w');
        await page.waitForTimeout(100);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        ok(!(await page.evaluate(() => window.__p0.state().paused)), `${tag}: Esc that cancelled an aim also paused`);
      } else console.log(`${tag}: no ability ready, aim + Esc not checked`);
      await page.keyboard.press('3');
      await page.waitForTimeout(150);
      ok((await page.evaluate(() => window.__p0.state().speed)) === 3, `${tag}: key 3 did not set 3×`);
      // Window blur pauses the run.
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.waitForTimeout(200);
      ok(await page.evaluate(() => window.__p0.state().paused), `${tag}: blur did not pause`);
    }
    await ctx.close();
    // New-foe heads-up on an island the (fresh) player never cleared: New tags, then the toast.
    const ctx4 = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch });
    const p4 = await ctx4.newPage();
    await p4.goto(`${BASE}/2d.html?level=i09&hero=bran&lang=${lang}&desktop=${size.desktop ? 1 : 0}`);
    await p4.waitForFunction(() => window.__p0?.newFoe && !document.getElementById('boot'), null, { timeout: 60000 });
    await p4.waitForTimeout(800);
    ok((await p4.locator('.pu-wave-new').count()) > 0, `${tag}: no New tag on the wave card`);
    await p4.screenshot({ path: `${OUT}/${lang}-${size.key}-newfoe-card.jpg`, type: 'jpeg', quality: 84 });
    await p4.evaluate(() => window.__p0.replay.cmd({ k: 'wave' }));
    await p4.waitForFunction(() => window.__p0.newFoe().shown, null, { timeout: 8000 }).catch(() => problems.push(`${tag}: no new-foe toast`));
    await p4.waitForTimeout(600);
    await p4.screenshot({ path: `${OUT}/${lang}-${size.key}-newfoe-toast.jpg`, type: 'jpeg', quality: 84 });
    await ctx4.close();
    // Final-wave / boss call-out: jump near the end of l1c (plain final) and i01 (a boss leads it),
    // then call the last wave.
    for (const [lvl, suffix] of [['l1c', ''], ['i01', '-boss']]) {
      const ctx5 = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch });
      await ctx5.addInitScript(() => localStorage.setItem('skyhold2d_coach_v1', 'done'));
      const p5 = await ctx5.newPage();
      await p5.goto(`${BASE}/2d.html?level=${lvl}&hero=bran&lang=${lang}&desktop=${size.desktop ? 1 : 0}`);
      await p5.waitForFunction(() => window.__p0?.callout && !document.getElementById('boot'), null, { timeout: 60000 });
      await p5.evaluate(() => {
        const p = window.__p0;
        const n = Number(String(p.hudWave()).split('/')[1]) || 10;
        p.skipToWave(n - 1);
        p.replay.step(2);
      });
      await p5.evaluate(() => {
        // Wave n-1 spawns first: run until the horn can call the last one, then call it.
        const p = window.__p0;
        for (let i = 0; i < 400 && !['clearing', 'betweenWaves'].includes(p.state().waveState); i++) p.replay.step(3);
        p.replay.cmd({ k: 'wave' });
      });
      // A slow software-GL frame can outlast the 2.6 s call-out: wait on its show count, then
      // show the last one again for the shot.
      await p5.waitForFunction(() => window.__p0.callout().count > 0, null, { timeout: 8000 }).catch(() => problems.push(`${tag}: no final / boss call-out on ${lvl}`));
      const co = await p5.evaluate(() => window.__p0.callout());
      if (!co.shown) await p5.evaluate(() => window.__p0.calloutAgain?.());
      await p5.waitForTimeout(500);
      await p5.screenshot({ path: `${OUT}/${lang}-${size.key}-callout${suffix}.jpg`, type: 'jpeg', quality: 80 });
      await ctx5.close();
    }
    // Victory board with the star rule (5 lives lost).
    const ctx3 = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch });
    const p3 = await ctx3.newPage();
    await p3.goto(`${BASE}/2d.html?level=l1c&hero=bran&lang=${lang}&desktop=${size.desktop ? 1 : 0}`);
    await p3.waitForFunction(() => window.__p0?.forceEnd && !document.getElementById('boot'), null, { timeout: 60000 });
    await p3.evaluate(() => {
      window.__p0.setLives(15);
      window.__p0.forceEnd('won');
    });
    await p3.waitForFunction(() => !!window.__p0.state().end, null, { timeout: 10000 }).catch(() => problems.push(`${tag}: no victory board`));
    // A plain-play win shows the island's after-battle story first: skip it.
    await p3.locator('[data-testid="story2d-skip"]').click({ timeout: 8000 }).catch(() => undefined);
    await p3.waitForTimeout(2500);
    await p3.screenshot({ path: `${OUT}/${lang}-${size.key}-end-stars.jpg`, type: 'jpeg', quality: 84 });
    await ctx3.close();
    // Controls page.
    const ctx2 = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch });
    const p2 = await ctx2.newPage();
    await p2.goto(`${BASE}/2d.html?level=l1c&lang=${lang}&settings=1&settab=controls&desktop=${size.desktop ? 1 : 0}`);
    await p2.waitForSelector(".pu-settings", { timeout: 30000 }).catch(() => undefined);
    await p2.waitForTimeout(4000);
    await p2.screenshot({ path: `${OUT}/${lang}-${size.key}-controls.jpg`, type: 'jpeg', quality: 82 });
    await p2.goto(`${BASE}/2d.html?level=l1c&lang=${lang}&settings=1&settab=general&desktop=${size.desktop ? 1 : 0}`);
    await p2.waitForSelector('[data-testid="set2d-tips"]', { timeout: 30000 }).catch(() => problems.push(`${tag}: no Tips row in Settings`));
    await p2.waitForTimeout(3000);
    await p2.screenshot({ path: `${OUT}/${lang}-${size.key}-settings-general.jpg`, type: 'jpeg', quality: 82 });
    await ctx2.close();
    console.log(`${tag}: done`);
  }
}
await browser.close();
if (problems.length) {
  console.log(`PROBLEMS (${problems.length}):\n  ` + problems.join('\n  '));
  process.exitCode = 1;
} else console.log('no problems');
