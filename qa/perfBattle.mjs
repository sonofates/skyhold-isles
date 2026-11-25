// Heavy-battle frame profile (docs/handoff-perf.md). ONE Chromium, run through qa/withPreview.py:
//   python3 qa/withPreview.py --port=4392 node qa/perfBattle.mjs --size=932x430 --cpu=4
// Options: --level=i42 --wave=8 --speed=3 --seconds=15 --warm=8 --waitWarm=1 --quality=low|medium|high
//   --dpr=N (default 3 for phone sizes, 1 otherwise) --profile=N (print the N top self-time
//   functions from a CPU profile of the sampled window; most useful against the dev server, whose
//   code keeps its names) --alloc=N (top N allocating functions, sampled) --uploads=1 --texts=1
//   --textures=N --shot=path.png --label=text --path=/2d.html
// Prints one JSON line: fps, frame ms p50/p95/p99/max, draw calls, JS heap, GPU textures, enemies.
import { chromium } from 'playwright';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const base = arg('base', 'http://127.0.0.1:4381');
const [w, h] = arg('size', '932x430').split('x').map(Number);
const phone = w < 1100;
const dpr = Number(arg('dpr', phone ? 3 : 1));
const cpu = Number(arg('cpu', 4));
const level = arg('level', 'i42');
const wave = Number(arg('wave', 8));
const speed = Number(arg('speed', 3));
const seconds = Number(arg('seconds', 15));
const warm = Number(arg('warm', 8));
const quality = arg('quality', '');
const profileTop = Number(arg('profile', 0));
const shot = arg('shot', '');
const path = arg('path', '/2d.html');

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: phone, hasTouch: phone });
  const page = await context.newPage();
  if (arg('reducedMotion', '') === '1') await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await page.addInitScript(() => {
    let draws = 0;
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
        const original = proto[name];
        if (original) proto[name] = function (...a) { draws++; return original.apply(this, a); };
      }
    }
    // GL texture memory, counted at the API (works on any build): bytes per live texture object.
    const texBytes = new Map();
    const unitOf = new WeakMap();
    const bound = (gl, target) => unitOf.get(gl)?.[`${unitOf.get(gl)?.unit ?? 0}:${target}`];
    const sizeOf = (a) => {
      // texImage2D(target, level, ifmt, w, h, border, fmt, type, src) or (target, level, ifmt, fmt, type, src)
      if (a.length >= 9 || typeof a[3] === 'number' && typeof a[4] === 'number' && a.length >= 8) return [a[3], a[4]];
      const s = a[5];
      return [s?.videoWidth || s?.naturalWidth || s?.displayWidth || s?.width || 0, s?.videoHeight || s?.naturalHeight || s?.displayHeight || s?.height || 0];
    };
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const at = proto.activeTexture;
      proto.activeTexture = function (u) { const st = unitOf.get(this) ?? {}; st.unit = u; unitOf.set(this, st); return at.call(this, u); };
      const bt = proto.bindTexture;
      proto.bindTexture = function (target, tex) { const st = unitOf.get(this) ?? {}; st[`${st.unit ?? 0}:${target}`] = tex; unitOf.set(this, st); return bt.call(this, target, tex); };
      const ti = proto.texImage2D;
      proto.texImage2D = function (...a) {
        const tex = bound(this, a[0]);
        if (tex && a[1] === 0) { const [tw, th] = sizeOf(a); texBytes.set(tex, tw * th * 4); }
        return ti.apply(this, a);
      };
      if (proto.texStorage2D) {
        const ts = proto.texStorage2D;
        proto.texStorage2D = function (target, levels, ifmt, tw, th) {
          const tex = bound(this, target);
          if (tex) texBytes.set(tex, Math.round(tw * th * 4 * (levels > 1 ? 4 / 3 : 1)));
          return ts.call(this, target, levels, ifmt, tw, th);
        };
      }
      const gm = proto.generateMipmap;
      proto.generateMipmap = function (target) {
        const tex = bound(this, target);
        if (tex && texBytes.has(tex)) texBytes.set(tex, Math.round(texBytes.get(tex) * 4 / 3));
        return gm.call(this, target);
      };
      const dt = proto.deleteTexture;
      proto.deleteTexture = function (tex) { texBytes.delete(tex); return dt.call(this, tex); };
    }
    // Upload attribution (--uploads=1): call counts per caller stack while sampling.
    const uploads = new Map();
    window.__uploads = uploads;
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const name of ['texSubImage2D', 'texImage2D']) {
        const orig = proto[name];
        proto[name] = function (...a) {
          if (window.__perf?.on && window.__perfUploads) {
            const st = (new Error().stack ?? '').split('\n').slice(2, 14).map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '').replace(/\?v=[0-9a-f]+/, '')).filter((l) => !/node_modules|pixi/.test(l)).slice(0, 3).join(' < ');
            const k = `${name} ${st}`;
            uploads.set(k, (uploads.get(k) ?? 0) + 1);
          }
          return orig.apply(this, a);
        };
      }
    }
    // Canvas text rasterization (--texts=1): which strings get drawn while sampling.
    const texts = new Map();
    window.__texts = texts;
    for (const name of ['fillText', 'strokeText']) {
      const orig = CanvasRenderingContext2D.prototype[name];
      CanvasRenderingContext2D.prototype[name] = function (str, ...rest) {
        if (window.__perf?.on && window.__perfTexts) {
          const k = `${name} ${String(str).replace(/[0-9]/g, '#').slice(0, 40)} @${this.font}`;
          texts.set(k, (texts.get(k) ?? 0) + 1);
        }
        return orig.call(this, str, ...rest);
      };
    }
    window.__glMem = () => {
      let b = 0;
      for (const v of texBytes.values()) b += v;
      return { textures: texBytes.size, MB: Math.round((b / 1048576) * 10) / 10 };
    };
    const perf = { on: false, frames: [], draws: [], enemiesMax: 0, last: 0 };
    window.__perf = perf;
    const tick = (now) => {
      if (perf.on) {
        if (perf.last) {
          perf.frames.push(now - perf.last);
          perf.draws.push(draws);
        }
        perf.last = now;
      }
      draws = 0;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const q = new URLSearchParams({ level, speed: String(speed) });
  if (quality) q.set('quality', quality);
  await page.goto(`${base}${path}?${q}`);
  await page.waitForFunction(() => window.__p0?.replay && window.__p0.state().towers, null, { timeout: 240000 });
  // Every plot built (mixed families, some upgraded), then wave `wave` and the next ones called
  // early so several waves overlap: the late-island worst case at 3x.
  const setup = await page.evaluate(({ wave }) => {
    const p = window.__p0;
    p.setGold(1e7);
    p.setLives(999);
    const types = ['archer', 'cannon', 'frost', 'tesla', 'mortar', 'ballista', 'barracks', 'archer'];
    let built = 0;
    for (let plot = 0; plot < 40; plot++) if (p.replay.cmd({ k: 'build', plot, type: types[plot % types.length] })) built++;
    for (const t of p.state().towers) {
      if (t.plot % 2 === 0) p.replay.cmd({ k: 'upgrade', id: t.id });
      if (t.plot % 3 === 0) p.replay.cmd({ k: 'upgrade', id: t.id });
    }
    const skipped = p.skipToWave(wave);
    p.replay.cmd({ k: 'wave' });
    return { built, skipped };
  }, { wave });
  const keepUp = async () =>
    page.evaluate(() => {
      const p = window.__p0;
      p.setLives(999);
      const s = p.state();
      window.__perf.enemiesMax = Math.max(window.__perf.enemiesMax, s.enemies);
      if (s.waveState !== 'spawning' || s.enemies < 60) p.replay.cmd({ k: 'wave' });
      return s.outcome;
    });
  if (arg('waitWarm', '')) {
    // Measure the steady state: the background texture warm-up (textureWarmup.ts) done.
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) {
      await keepUp();
      const pending = await page.evaluate(() => window.__p0.textureWarmup?.().pending ?? 0);
      if (pending === 0) break;
      await page.waitForTimeout(1000);
    }
  }
  const warmEnd = Date.now() + warm * 1000;
  while (Date.now() < warmEnd) {
    await keepUp();
    await page.waitForTimeout(700);
  }
  const m0 = await cdp.send('Performance.getMetrics');
  const allocTop = Number(arg('alloc', 0));
  if (allocTop > 0) {
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096 });
  }
  if (profileTop > 0) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
  }
  if (arg('uploads', '')) await page.evaluate(() => { window.__perfUploads = true; });
  if (arg('texts', '')) await page.evaluate(() => { window.__perfTexts = true; });
  await page.evaluate(() => {
    window.__perf.frames.length = 0;
    window.__perf.draws.length = 0;
    window.__perf.last = 0;
    window.__perf.on = true;
  });
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    await keepUp();
    await page.waitForTimeout(700);
  }
  if (arg('textures', '')) await page.evaluate((n) => { window.__perfTop = n; }, Number(arg('textures', '5')));
  const res = await page.evaluate(() => {
    const perf = window.__perf;
    perf.on = false;
    const f = [...perf.frames].sort((a, b) => a - b);
    const d = [...perf.draws].sort((a, b) => a - b);
    const qt = (a, x) => (a.length ? a[Math.min(a.length - 1, Math.ceil(a.length * x) - 1)] : 0);
    const r1 = (v) => Math.round(v * 10) / 10;
    const s = window.__p0.state();
    const mem = performance.memory;
    return {
      frames: f.length,
      fps: r1((1000 * f.length) / f.reduce((a, b) => a + b, 0)),
      frameMs: [qt(f, 0.5), qt(f, 0.95), qt(f, 0.99), f.at(-1) ?? 0].map(r1),
      drawCalls: [qt(d, 0.5), qt(d, 0.95)],
      enemiesMax: perf.enemiesMax,
      enemiesNow: s.enemies,
      projectiles: s.projectiles,
      towers: s.towers.length,
      wave: s.wave,
      tier: s.quality,
      veiled: s.towers.filter((t) => t.veil > 0 || t.rangeCut > 0).length,
      frosted: s.towers.filter((t) => t.frostSlow > 0 || t.frozen > 0).length,
      heapMB: mem ? r1(mem.usedJSHeapSize / 1048576) : null,
      gpu: window.__p0.gpu?.(window.__perfTop ?? 5) ?? null,
      glTextures: window.__glMem(),
      texts: window.__perfTexts ? [...window.__texts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25) : undefined,
      uploads: window.__perfUploads ? [...window.__uploads.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15) : undefined,
    };
  });
  const m1 = await cdp.send('Performance.getMetrics');
  const metric = (m, n) => m.metrics.find((x) => x.name === n)?.value ?? 0;
  const per = (n) => Math.round(((metric(m1, n) - metric(m0, n)) * 1000) / Math.max(1, res.frames) * 100) / 100;
  res.cpuMsPerFrame = { script: per('ScriptDuration'), task: per('TaskDuration'), layout: per('LayoutDuration'), style: per('RecalcStyleDuration') };
  res.gcHeapMB = Math.round((metric(m1, 'JSHeapUsedSize') / 1048576) * 10) / 10;
  if (profileTop > 0) {
    const { profile } = await cdp.send('Profiler.stop');
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const self = new Map();
    const dt = profile.timeDeltas;
    profile.samples.forEach((id, i) => {
      const n = byId.get(id);
      const cf = n.callFrame;
      const key = `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/(src|node_modules|assets)\//, '$1/')}:${cf.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
    });
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    res.profile = [...self.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, profileTop)
      .map(([k, v]) => `${((100 * v) / total).toFixed(1)}% ${k}`);
  }
  if (allocTop > 0) {
    // Allocation sampling over the window: bytes allocated per function (self), per frame.
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    const self = new Map();
    const walk = (n) => {
      const cf = n.callFrame;
      const key = `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/(src|node_modules|assets)\//, '$1/').replace(/\?v=[0-9a-f]+/, '')}:${cf.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + n.selfSize);
      for (const c of n.children) walk(c);
    };
    walk(profile.head);
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    res.allocKBPerFrame = Math.round(total / 1024 / Math.max(1, res.frames) * 10) / 10;
    res.alloc = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, allocTop)
      .map(([k, v]) => `${(v / 1024 / Math.max(1, res.frames)).toFixed(2)} KB/frame ${k}`);
  }
  if (shot) await page.screenshot({ path: shot });
  console.log(JSON.stringify({ label: arg('label', ''), size: `${w}x${h}@${dpr}`, cpu, level, speed, setup, ...res, errors }));
} finally {
  await browser.close();
}
