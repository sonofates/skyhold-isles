// Island-switch memory check (docs/handoff-perf.md). ONE Chromium, through qa/withPreview.py:
//   python3 qa/withPreview.py --port=4395 node qa/perfMemory.mjs [--size=932x430] [--islands=i01,i12,i24,i36,i42,i01]
//   ... node qa/perfMemory.mjs --bfcache=1   (full Chromium with the back/forward cache on)
// 1. Switches islands the way the game does (world map → island → Menu → world map, full page
//    loads) and records, on each battle page: GL texture MB (counted at the WebGL API), Pixi's
//    resident texture MB (`__p0.gpu`), JS heap after a forced GC; and the heap back on the map.
//    Each battle is left through `__p0.menu()` (navigateWithVeil, as the end board's Menu).
// 2. What each battle page let go of on `pagehide` (pageCache.ts; only when bfcache keeps it).
// 3. bfcache probe: leaves a battle, goes Back: a page kept in the cache must come back as a
//    fresh load (never as the old page still holding its WebGL context).
// 4. In-page restarts (Retry) on one island: textures / heap must not grow.
// Exits 1 when the last switch / restart holds more than the first (+ tolerance), a cached
// battle page kept its GPU context, or one came back from the cache with it.
// Without --bfcache the browser has no back/forward cache (Playwright default): the switch
// numbers are then the pure per-page cost; with it, cached pages add their JS heap (~12 MB each,
// bounded by the browser's cache size) but no GPU textures or decoded sheets.
import { chromium } from 'playwright';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const base = arg('base', 'http://127.0.0.1:4381');
const [w, h] = arg('size', '932x430').split('x').map(Number);
const phone = w < 1100;
const islands = arg('islands', 'i01,i12,i24,i36,i42,i01').split(',');
const restarts = Number(arg('restarts', 5));
const settleMs = Number(arg('settle', 5000));

const bfcacheOn = arg('bfcache', '') === '1';
// Playwright disables the back/forward cache, and its headless shell has none: the probe uses
// full Chromium (new headless) with the cache on, as a browser has it.
const browser = await chromium.launch({
  ...(bfcacheOn ? { ignoreDefaultArgs: ['--disable-back-forward-cache'], channel: 'chromium' } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--enable-precise-memory-info'],
});
const fail = [];
try {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 3 : 1, isMobile: phone, hasTouch: phone });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  const bfcacheMisses = [];
  cdp.on('Page.backForwardCacheNotUsed', (e) => bfcacheMisses.push(e.notRestoredExplanations?.map((x) => x.reason) ?? []));
  await page.addInitScript(() => {
    const texBytes = new Map();
    const st = new WeakMap();
    const key = (gl, target) => `${st.get(gl)?.unit ?? 0}:${target}`;
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const at = proto.activeTexture;
      proto.activeTexture = function (u) { const s = st.get(this) ?? {}; s.unit = u; st.set(this, s); return at.call(this, u); };
      const bt = proto.bindTexture;
      proto.bindTexture = function (t, tex) { const s = st.get(this) ?? {}; s[key(this, t)] = tex; st.set(this, s); return bt.call(this, t, tex); };
      const bound = (gl, t) => st.get(gl)?.[key(gl, t)];
      const ti = proto.texImage2D;
      proto.texImage2D = function (...a) {
        const tex = bound(this, a[0]);
        if (tex && a[1] === 0) {
          let tw, th;
          if (a.length >= 8 && typeof a[3] === 'number' && typeof a[4] === 'number') [tw, th] = [a[3], a[4]];
          else { const s = a[5]; tw = s?.videoWidth || s?.naturalWidth || s?.displayWidth || s?.width || 0; th = s?.videoHeight || s?.naturalHeight || s?.displayHeight || s?.height || 0; }
          texBytes.set(tex, tw * th * 4);
        }
        return ti.apply(this, a);
      };
      if (proto.texStorage2D) {
        const ts = proto.texStorage2D;
        proto.texStorage2D = function (t, levels, f, tw, th) { const tex = bound(this, t); if (tex) texBytes.set(tex, Math.round(tw * th * 4 * (levels > 1 ? 4 / 3 : 1))); return ts.call(this, t, levels, f, tw, th); };
      }
      const gm = proto.generateMipmap;
      proto.generateMipmap = function (t) { const tex = bound(this, t); if (tex && texBytes.has(tex)) texBytes.set(tex, Math.round(texBytes.get(tex) * 4 / 3)); return gm.call(this, t); };
      const dt = proto.deleteTexture;
      proto.deleteTexture = function (tex) { texBytes.delete(tex); return dt.call(this, tex); };
    }
    window.__glMem = () => {
      let b = 0;
      for (const v of texBytes.values()) b += v;
      return { textures: texBytes.size, MB: Math.round((b / 1048576) * 10) / 10 };
    };
    window.__restored = false;
    addEventListener('pageshow', (e) => { if (e.persisted) window.__restored = true; });
  });

  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const m = await cdp.send('Performance.getMetrics');
    return Math.round((m.metrics.find((x) => x.name === 'JSHeapUsedSize').value / 1048576) * 10) / 10;
  };
  await cdp.send('Performance.enable');
  const battle = async () => {
    await page.waitForFunction(() => window.__p0?.state && window.__p0.textureWarmup, null, { timeout: 180000 });
    // Let the background warm-up finish (all the run's art resident) before measuring.
    await page.waitForFunction(() => window.__p0.textureWarmup().pending === 0, null, { timeout: 180000 }).catch(() => undefined);
    await page.waitForTimeout(settleMs);
    // Runs after the game's own pagehide handler (registered at boot): what it let go of.
    await page.evaluate(() => addEventListener('pagehide', (e) => {
      sessionStorage.setItem('qaHide', JSON.stringify({ persisted: e.persisted, release: window.__pageCacheRelease ?? null }));
    }));
    return page.evaluate(() => ({ gl: window.__glMem(), pixi: window.__p0.gpu ? window.__p0.gpu().textureMB : null }));
  };
  // Leave a battle the way the game does (end board Menu → navigateWithVeil); older builds
  // without `__p0.menu` navigate directly.
  const leave = async () => {
    await page.evaluate(() => (window.__p0.menu ? window.__p0.menu() : location.assign('/2d.html')));
    await page.waitForURL((u) => !u.search.includes('level='), { timeout: 30000 });
    await page.waitForTimeout(2500);
    return page.evaluate(() => JSON.parse(sessionStorage.getItem('qaHide') ?? 'null'));
  };

  // 1. Island switches through the world map (full page loads, as navigateWithVeil does).
  const switches = [];
  await page.goto(`${base}/2d.html`);
  await page.waitForTimeout(2500);
  for (const id of islands) {
    await page.evaluate((href) => location.assign(href), `/2d.html?level=${id}`);
    const b = await battle();
    const battleHeap = await heap();
    const hide = await leave();
    const mapHeap = await heap();
    const mapGl = await page.evaluate(() => window.__glMem());
    switches.push({ id, glMB: b.gl.MB, glTextures: b.gl.textures, pixiMB: b.pixi, heapMB: battleHeap, mapHeapMB: mapHeap, mapGlMB: mapGl.MB, hide });
    if (hide?.persisted && !hide.release?.contextLost) fail.push(`${id}: page went to the back/forward cache with its WebGL context`);
  }
  const firstSame = switches.find((s) => s.id === islands.at(-1));
  const last = switches.at(-1);
  if (firstSame && last !== firstSame) {
    if (last.glMB > firstSame.glMB * 1.05 + 2) fail.push(`GL textures grew on ${last.id}: ${firstSame.glMB} → ${last.glMB} MB`);
    if (!bfcacheOn && last.heapMB > firstSame.heapMB * 1.25 + 3) fail.push(`JS heap grew on ${last.id}: ${firstSame.heapMB} → ${last.heapMB} MB`);
  }
  if (!bfcacheOn && switches.at(-1).mapHeapMB > switches[0].mapHeapMB * 1.25 + 3) fail.push(`map heap grew: ${switches[0].mapHeapMB} → ${switches.at(-1).mapHeapMB} MB`);

  // 2. bfcache: battle → map → Back.
  await page.evaluate((href) => location.assign(href), `/2d.html?level=${islands[0]}`);
  await battle();
  const hide = await leave();
  // A page restored from bfcache fires no `load`: wait for the commit only.
  await page.goBack({ waitUntil: 'commit' });
  await page.waitForTimeout(4000);
  await page.waitForFunction(() => !!window.__glMem, null, { timeout: 60000 }).catch(() => undefined);
  const after = await page.evaluate(() => ({
    oldPageShown: window.__restored,
    nav: performance.getEntriesByType('navigation')[0]?.type ?? null,
    gl: window.__glMem(),
    contextLost: (() => { const c = document.querySelector('canvas'); const gl = c?.getContext('webgl2') ?? c?.getContext('webgl'); return gl ? gl.isContextLost() : null; })(),
  })).catch((e) => ({ error: String(e) }));
  const bfcache = { mode: bfcacheOn ? 'on' : 'off (Playwright default)', hide, back: after, notUsedReasons: bfcacheMisses.at(-1) ?? null };
  if (after.oldPageShown && after.contextLost === false && after.gl?.MB > 8) fail.push(`battle page came back from the back/forward cache still holding ${after.gl.MB} MB of GL textures`);

  // 3. In-page restarts on one island.
  await page.goto(`${base}/2d.html?level=${islands.at(-2) ?? islands[0]}`);
  const first = await battle();
  const runs = [{ glMB: first.gl.MB, heapMB: await heap() }];
  for (let i = 0; i < restarts; i++) {
    await page.evaluate(() => window.__p0.replay.restart());
    await page.waitForTimeout(settleMs);
    runs.push({ glMB: (await page.evaluate(() => window.__glMem())).MB, heapMB: await heap() });
  }
  if (runs.at(-1).glMB > runs[0].glMB * 1.05 + 2) fail.push(`GL textures grew over ${restarts} restarts: ${runs[0].glMB} → ${runs.at(-1).glMB} MB`);
  if (runs.at(-1).heapMB > runs[1].heapMB * 1.25 + 3) fail.push(`JS heap grew over ${restarts} restarts: ${runs[1].heapMB} → ${runs.at(-1).heapMB} MB`);

  console.log(JSON.stringify({ size: `${w}x${h}`, switches, bfcache, restarts: runs, errors, fail }));
} finally {
  await browser.close();
}
process.exit(fail.length ? 1 : 0);
