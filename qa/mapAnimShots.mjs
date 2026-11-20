// Run against vite preview. The sequence is stepped on the real video timeline while the
// game ticker is frozen. The frame-time runs use uninterrupted playback on the same scene.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BASE || 'http://127.0.0.1:4173';
const island = process.env.ISLAND || 'i02';
const survey = island !== 'i02';
const demo = !survey && process.env.DEMO;
const sequenceTimes = survey ? [0, 1.5, 3, 4.5, 6, 191/24] : [0, .5, 1, 1.5, 2, 2.5];
const out = process.env.OUT || (survey ? join('docs/anim-shots', island) : 'docs/anim-i02-shots');
const work = process.env.CAPTURE_WORK || mkdtempSync(join(tmpdir(), 'map-anim-'));
mkdirSync(out, { recursive: true });
mkdirSync(work, { recursive: true });
console.log('Lossless review frames', work);
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined, headless: !process.env.HEADED,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const report = { browser: browser.version(), sequenceTimes, cases: [] };

async function setReduced(page, on) {
  await page.evaluate(value => {
    const key = 'skyhold_isles_settings_v1';
    const settings = JSON.parse(localStorage.getItem(key) || '{}');
    settings.graphics = { ...settings.graphics, reducedMotion: value };
    localStorage.setItem(key, JSON.stringify(settings));
    window.dispatchEvent(new Event('skyhold:graphics'));
  }, on);
}

async function measure(page, playing = false) {
  return page.evaluate(({playing, survey}) => new Promise(resolve => {
    const deltas = [];
    let start, previous, lastTime = 0, wraps = 0;
    const video = playing && window.ambientVideo();
    function sample(t) {
      if (start === undefined) start = t;
      if (previous !== undefined) deltas.push(t - previous);
      previous = t;
      if (video) {
        if (video.currentTime < lastTime) wraps++;
        lastTime = video.currentTime;
      }
      if (t - start < (survey ? 3000 : 5000) || (!survey && playing && wraps < 3 && t - start < 32000)) return requestAnimationFrame(sample);
      deltas.sort((a,b) => a-b);
      const quantile = q => +deltas[Math.round((deltas.length-1)*q)].toFixed(2);
      resolve({ wraps, frames: deltas.length, meanMs: +((t-start)/deltas.length).toFixed(2), p50Ms: quantile(.5), p95Ms: quantile(.95) });
    }
    requestAnimationFrame(sample);
  }), {playing, survey});
}

async function seek(page, t) {
  await page.evaluate(async time => {
    const video = window.ambientVideo();
    video.pause();
    if (video.currentTime !== time) {
      await new Promise(resolve => {
        video.addEventListener('seeked', resolve, { once: true });
        video.currentTime = time;
      });
    }
    window.__p0.replay.step(0); // submit the sought frame, without advancing the simulation
  }, t);
}

async function run({width, height, dpr, phone, low, upgrade, fullMap}) {
  const name = fullMap ? 'full-map' : upgrade ? 'swap' : low ? 'low' : phone ? 'phone' : 'desktop';
  const ctx = await browser.newContext({
    viewport: {width,height}, deviceScaleFactor: dpr, isMobile: !!phone, hasTouch: !!phone,
    reducedMotion: low ? 'no-preference' : 'reduce',
  });
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('request', req => { if (req.url().includes('/art2d/ambient/')) requests.push(req.url().split('/').pop()); });
  await page.addInitScript(() => {
    localStorage.setItem('skyhold2d_coach_v1', 'done');
    window.__PIXI_APP_INIT__ = app => { window.qaPixi = app; };
    const create = Document.prototype.createElement, videos = [];
    Document.prototype.createElement = function (...args) {
      const el = create.apply(this, args);
      if (args[0] === 'video') videos.push(el);
      return el;
    };
    window.ambientVideo = () => videos.find(v => v.src.includes('/ambient/'));
  });
  let finishUpgrade;
  if (upgrade) {
    const hold = new Promise(resolve => { finishUpgrade = resolve; });
    await page.route('**/*@3x.webp', async route => { await hold; await route.continue(); });
  }
  try {
    const quality = low ? 'low' : fullMap ? 'med' : 'high';
    await page.goto(base+'/2d.html?level='+island+'&quality='+quality+'&hero=none&lang=en');
    await page.waitForFunction(() => !!window.__p0?.state, undefined, { timeout: 90000 });
    await page.waitForTimeout(700);
    assert.equal(requests.length, 0, 'static tier must not request ambient art');
    const state = () => page.evaluate(() => {
      const s = window.__p0.state();
      return {quality:s.quality, map:s.mapInfo.texelScale, fit:s.fit, render:s.render};
    });
    const row = { name, width, height, dpr, ...await state(), initialAmbientRequests:requests.length };
    report.cases.push(row);
    if (low) return;
    // Save raw static/active references without the DOM ability bar obscuring the berths.
    const clean = { style: survey ? 'body *:not(canvas):not(:has(canvas)) { visibility:hidden !important }' : '.pu-abilities { visibility:hidden !important }' };
    const raw = (label) => page.screenshot({path:join(work,name+'-'+label+'.png'), ...clean});
    if (fullMap) {
      // Capture the painting behind the HUD and beyond the normal viewport crop.
      await setReduced(page, false);
      await page.waitForFunction(() => window.ambientVideo()?.currentTime > .2);
      await page.evaluate(() => {
        window.__p0.freeze(true);
        const [map, screen] = window.qaPixi.stage.children;
        screen.visible = false;
        const world = map.children[1];
        world.scale.set(1);
        world.position.set(0, 0);
      });
      row.captureFit = { scale:1, offsetX:0, offsetY:0 };
      for (const [label, time] of [['0',0], ['2',2], ['4',4], ['last',191/24]]) {
        await seek(page, time);
        await raw(label);
      }
      row.files = [...new Set(requests)];
      return;
    }
    await raw('static');
    if (!upgrade) row.staticBefore = await measure(page);
    await setReduced(page,false);
    await page.waitForFunction(()=>window.ambientVideo()?.currentTime > .2, undefined, {timeout:30000});
    if (upgrade) {
      assert.equal(row.map,2);
      await page.evaluate(()=>window.__p0.freeze(true));
      await seek(page, 3); await raw('2x');
      finishUpgrade();
      await page.waitForFunction(()=>window.__p0.state().mapInfo.texelScale===3);
      await seek(page,3); await raw('3x');
      row.after = await state();
      await page.evaluate(()=>window.__p0.freeze(false));
      await setReduced(page,true);
      await page.waitForFunction(()=>!window.ambientVideo());
      await raw('static3x');
      return;
    }
    await page.waitForTimeout(900);
    row.animated = await measure(page, true);
    if (!survey) assert.equal(row.animated.wraps,3);
    await page.keyboard.press('Space');
    await page.waitForFunction(()=>window.__p0.state().paused && window.ambientVideo().paused);
    const time = await page.evaluate(()=>window.ambientVideo().currentTime);
    await page.waitForTimeout(550);
    assert.equal(time,await page.evaluate(()=>window.ambientVideo().currentTime));
    await page.keyboard.press('Space');
    await page.waitForFunction(()=>!window.__p0.state().paused && !window.ambientVideo().paused);
    row.gamePause = 'held and resumed';
    await page.evaluate(()=>window.__p0.freeze(true));
    for (const [k, time] of sequenceTimes.entries()) {
      await seek(page, time);
      const filename = survey ? `${name}-seq-${k}.jpg` : `${name}-${k}.jpg`;
      await page.screenshot({ path:join(survey ? work : out, filename), scale:'css', quality:94 });
    }
    for (const t of [0,2,4,191/24]) {
      await seek(page,t);
      await raw(t>7?'last':String(t));
    }
    if (name === 'desktop' && demo) {
      for (let i=0;i<96;i++) {
        await seek(page,i/12);
        await page.screenshot({ path:join(work,'demo-'+String(i).padStart(3,'0')+'.jpg'),quality:92 });
      }
    }
    await page.evaluate(()=>window.__p0.freeze(false));
    await setReduced(page,true);
    await page.waitForFunction(()=>!window.ambientVideo());
    await page.waitForTimeout(700);
    if (!survey) row.staticAfter = await measure(page);
    row.files = [...new Set(requests)];
  } finally {
    finishUpgrade?.();
    await ctx.close();
    console.log(JSON.stringify(report.cases.at(-1)));
    assert.deepEqual(errors,[]);
  }
}

try {
  for (const params of [
    {width:2000,height:991,dpr:1},
    {width:844,height:390,dpr:2,phone:true},
    {width:2000,height:991,dpr:2,upgrade:true},
    {width:844,height:390,dpr:1,low:true,phone:true},
  ]) if (!survey || !params.upgrade) await run(params);
  if (survey) await run({width:1846,height:852,dpr:1,fullMap:true});
  writeFileSync(join(out,'measurements.json'),JSON.stringify(report,null,2)+'\n');
} finally { await browser.close(); }

execFileSync('python3', ['tools/map-anim/review_captures.py', work, out, island], {stdio:'inherit'});
if (demo) {
  execFileSync('ffmpeg', ['-y','-loglevel','error','-framerate','12','-i',join(work,'demo-%03d.jpg'),
    '-frames:v','96','-vf','scale=1600:-2:flags=lanczos','-c:v','libx264','-crf','18',
    '-preset','slow','-threads','4','-pix_fmt','yuv420p','-movflags','+faststart',
    join(dirname(out),'anim-i02-demo.mp4')]);
}
