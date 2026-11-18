// Debug probe for qa/mapq.mjs: how fast wave-1 walkers progress toward the castle under swiftshader.
import { chromium } from 'playwright';

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
await p.goto('http://127.0.0.1:4173/2d.html?speed=2');
await p.waitForFunction(() => !!window.__p0);
await p.waitForTimeout(800);
await p.keyboard.press('n');
for (let i = 0; i < 8; i++) {
  await p.waitForTimeout(8000);
  const s = await p.evaluate(() => {
    const st = window.__p0.state();
    return { wave: st.wave, ws: st.waveState, speed: st.speed, paused: st.paused, lives: st.lives, e: (st.enemyPx || []).map((e) => [e.lane, e.dist, e.toGoal]).slice(0, 3) };
  });
  console.log(JSON.stringify(s));
}
await b.close();
