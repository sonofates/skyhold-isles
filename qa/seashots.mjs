// World-map sea QA against `vite preview`: frame time on the map + screenshots / frame sequences.
//
// Perf (--perf=1, default): for each size × quality, loads the map with a save at island 7 and
// measures for --secs (default 6) seconds: the rAF frame intervals (p50 / p95 / fps), the renderer
// main-thread busy time (CDP TaskDuration, ms per second) and the CPU time of every browser process
// (/proc utime+stime, incl. the GPU process where SwiftShader rasterises WebGL), as % of one core.
// `window.__sea.stats()` (when present) adds the sea's own draw cost per frame.
// Shots (--shots=1): a still + a 6-frame sequence 0.5 s apart per size into --out (docs/sea-shots).
//
// Usage: python3 qa/withPreview.py --port=4393 node qa/seashots.mjs [--perf=1] [--shots=1]
//        [--sizes=1920x1080,1920x1080@2,844x390] [--q=auto,high,low] [--tag=after] [--extra=&x=1]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? 'docs/sea-shots';
const TAG = arg('tag') ?? 'after';
const SECS = Number(arg('secs') ?? 6);
const PERF = arg('perf') !== '0';
const SHOTS = arg('shots') === '1';
const EXTRA = arg('extra') ?? '';
const FAKE_ART = !!arg('fakeart');
const QS = (arg('q') ?? 'auto,high').split(',');
const ALL = [
  { key: '1920x1080', w: 1920, h: 1080, dpr: 1, desktop: 1 },
  { key: '1920x1080@2', w: 1920, h: 1080, dpr: 2, desktop: 1 },
  { key: '844x390', w: 844, h: 390, dpr: 3, desktop: 0, touch: true },
];
const SIZES = ALL.filter((s) => !arg('sizes') || arg('sizes').split(',').includes(s.key));
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const problems = [];
const lines = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
function save(cleared) {
  const n = IDS.length;
  const fill = (f) => Array.from({ length: n }, (_, i) => (i < cleared ? f(i) : 0));
  return JSON.stringify({
    ids: IDS,
    progress: {
      version: 2,
      unlockedLevelIndex: Math.min(n - 1, cleared),
      bestStars: fill((i) => 1 + (i % 3)),
      bestEndlessWaves: fill(() => 0),
      bestLives: fill(() => 20),
      clears: fill(() => 1),
      workshop: {},
      challengeClears: Array.from({ length: n }, () => []),
      daily: { lastDay: -1, streak: 0, bestStreak: 0, total: 0 },
      heroes: { selectedHero: 'bran', roster: { bran: { xp: 900, skills: [] } } },
    },
  });
}

/** CPU ticks (utime + stime) of every descendant of this node process, keyed by process type. */
function cpuTicks() {
  const kids = new Map();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = readFileSync(`/proc/${d}/stat`, 'utf8');
      const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      kids.set(Number(d), { ppid: Number(rest[1]), ticks: Number(rest[11]) + Number(rest[12]) });
    } catch {
      // process went away
    }
  }
  const mine = new Set([process.pid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, p] of kids) if (!mine.has(pid) && mine.has(p.ppid)) (mine.add(pid), (grew = true));
  }
  const out = { total: 0, gpu: 0, renderer: 0, other: 0 };
  for (const pid of mine) {
    if (pid === process.pid) continue;
    const p = kids.get(pid);
    if (!p) continue;
    let type = 'other';
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (cmd.includes('--type=gpu-process')) type = 'gpu';
      else if (cmd.includes('--type=renderer')) type = 'renderer';
    } catch {
      // ignore
    }
    out[type] += p.ticks;
    out.total += p.ticks;
  }
  return out;
}

async function open(size, q, extra = '') {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.touch, hasTouch: !!size.touch });
  await ctx.addInitScript((v) => localStorage.setItem('skyhold_isles_progress2d_v1', v), save(7));
  // --reduced=1: Settings → Reduced motion on
  if (arg('reduced') === '1') await ctx.addInitScript(() => localStorage.setItem('skyhold_isles_graphics_v1', JSON.stringify({ reducedMotion: true })));
  if (arg('killanim')) {
    // cost probe: stop the animations of one selector (e.g. --killanim=.pu-ship-pennant)
    await ctx.addInitScript((sel) => {
      document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent = `${sel} { animation: none !important; }`;
        document.head.append(st);
      });
    }, arg('killanim'));
  }
  if (arg('noanim') === '1') {
    await ctx.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent = '*, *::before, *::after { animation: none !important; }';
        document.head.append(st);
      });
    });
  }
  const page = await ctx.newPage();
  // --fakeart=<dir>: stand-in sprites registered under paintedUi.sea (exercises the painted path:
  // strips with / without json, a .json-only entry, variants, the sea key turning into an object).
  const FAKE = arg('fakeart');
  if (FAKE) {
    await page.route('**/art2d/manifest.json', async (route) => {
      const r = await route.fetch();
      const m = await r.json();
      m.paintedUi.sea = {
        gull: 'seafake/gull.png',
        whale: { image: 'seafake/whale.png', json: 'seafake/whale.json' },
        foam: 'seafake/foam.png',
        cloud: ['seafake/cloud1.png', 'seafake/cloud2.png'],
        cloudShadow: 'seafake/cloudShadow.png',
        sparkle: 'seafake/sparkle.png',
        ripple: 'seafake/ripple.json',
        shipSail: { image: 'seafake/shipSail.png', frameW: 160, frameH: 160, count: 4, cols: 4, fps: 8 },
      };
      await route.fulfill({ response: r, json: m });
    });
    await page.route('**/art2d/seafake/*', async (route) => {
      const file = `${FAKE}/${route.request().url().split('/').pop()}`;
      if (existsSync(file)) await route.fulfill({ path: file });
      else await route.fulfill({ status: 404, body: '' });
    });
  }
  const tag = `${size.key} q=${q}${extra}`;
  page.on('pageerror', (e) => problems.push(`${tag}: pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !(FAKE_ART && /404/.test(m.text()))) problems.push(`${tag}: console ${m.text()}`);
  });
  const qp = q === 'auto' ? '' : `&quality=${q}`;
  await page.goto(`${BASE}/2d.html?lang=en&desktop=${arg('desktop') ?? size.desktop}${qp}${EXTRA}${extra}`);
  await page.waitForFunction(() => !!window.__map && !document.getElementById('boot'), null, { timeout: 60000 });
  await sleep(2500);
  return { ctx, page, tag };
}

async function perf(size, q) {
  const { ctx, page, tag } = await open(size, q);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  await page.evaluate(() => window.__sea?.resetStats?.());
  const m0 = await metric();
  const c0 = cpuTicks();
  const w0 = Date.now();
  const frames = await page.evaluate(async (ms) => {
    const d = [];
    let last = performance.now();
    const t0 = last;
    await new Promise((res) => {
      const f = (now) => {
        d.push(now - last);
        last = now;
        if (now - t0 < ms) requestAnimationFrame(f);
        else res();
      };
      requestAnimationFrame(f);
    });
    return d.slice(1);
  }, SECS * 1000);
  const wall = (Date.now() - w0) / 1000;
  const c1 = cpuTicks();
  const m1 = await metric();
  const sea = await page.evaluate(() => window.__sea?.stats?.() ?? null);
  const sorted = [...frames].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const busy = ((m1.TaskDuration - m0.TaskDuration) * 1000) / wall;
  const cpu = (k) => (((c1[k] - c0[k]) / 100) * 100) / wall; // ticks are 1/100 s → % of one core
  const row = {
    tag,
    fps: +(frames.length / wall).toFixed(1),
    p50: +pct(0.5).toFixed(1),
    p95: +pct(0.95).toFixed(1),
    mainBusyMsPerS: +busy.toFixed(0),
    cpuTotalPct: +cpu('total').toFixed(0),
    cpuGpuPct: +cpu('gpu').toFixed(0),
    cpuRendererPct: +cpu('renderer').toFixed(0),
    sea,
  };
  lines.push(row);
  console.log(JSON.stringify(row));
  await ctx.close();
}

async function shots(size, q) {
  const { ctx, page } = await open(size, q);
  const name = `${size.key.replace('@', '-dpr')}-${q}${arg('name') ?? ''}`;
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 88 });
  for (let i = 0; i < (arg('seq') === '0' ? 0 : 6); i++) {
    await page.screenshot({ path: `${OUT}/${name}-seq${i}.jpg`, type: 'jpeg', quality: 82 });
    await sleep(500);
  }
  const info = await page.evaluate(() => window.__sea?.stats?.() ?? null);
  console.log(name, JSON.stringify(info));
  await ctx.close();
}

for (const size of SIZES) {
  for (const q of QS) {
    if (PERF) await perf(size, q);
    if (SHOTS) await shots(size, q);
  }
}
if (PERF) writeFileSync(`${OUT}/perf-${TAG}.json`, JSON.stringify(lines, null, 1));
await browser.close();
console.log(problems.length ? `PROBLEMS ${problems.length}\n${problems.slice(0, 20).join('\n')}` : 'problems 0');
process.exit(problems.length ? 1 : 0);
