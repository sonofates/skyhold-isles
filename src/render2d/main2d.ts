import '@fontsource-variable/fredoka';
import { Application, UPDATE_PRIORITY } from 'pixi.js';
import { getLevelById } from '../data/levels2d/index.ts';
import { AbScene } from './abScene.ts';
import { artCheckSummary, mountArtCheck } from './artCheck.ts';
import { loadArt } from './assets2d.ts';
import { autoplayHooks, benchHooks } from './benchScene.ts';
import { mountCodex2D } from './codex2d.ts';
import { AimOverlay, aimHooks, towersHooks, zooHooks, ZooLabels, type AimSceneState } from './debugScenes.ts';
import { FrameStats } from './frameStats.ts';
import { Game2D, type Game2DHooks } from './game2d.ts';
import { HUD_FONT } from './hudText.ts';

/**
 * 2d.html entry — P0 vertical slice of the painted 2D renderer (Pixi v8) on the real sim.
 *   ?level=l1c        island id (2D layouts only; default l1c)
 *   ?ab=1             enemy-animation A/B showcase (no combat)
 *   ?bench=150        stress scene: ~N enemies, towers on every plot, window.__bench stats
 *   ?autoplay=1       plays the greedy build script and auto-calls waves
 *   ?raider=veo31q    raider walk-cycle variant (default omni12; `cheap` = procedural)
 *   ?codex=1          opens the codex (painted art) on load; a Codex button is always top-left
 *   ?artcheck=1       overlay: which manifest art files are present / missing (and the stand-ins)
 *   ?zoo=1            all 15 enemy types walking, specials triggered periodically (labelled)
 *   ?towers=1[&tier=N] every tower type built and firing (cycles T1-T3 unless tier is given)
 *   ?towers=aim&type=cannon|archer|ballista[&tier=N]  turret aim QA (window.__aim, aim overlay)
 *   ?speed=2|3        start at 2× / 3× sim speed (QA recordings)
 */
interface BenchStats {
  readonly fps: number;
  readonly p50: number;
  readonly p95: number;
  readonly enemies: number;
  readonly drawCalls: number | null;
  readonly samples: number;
  /** CPU ms per frame for sim + layer sync (p50/p95), and for Pixi's render submission. */
  readonly updateMs: readonly [number, number];
  readonly renderCpuMs: readonly [number, number];
  readonly renderer: string;
}

declare global {
  interface Window {
    __bench?: BenchStats;
    __aim?: AimSceneState;
    __p0?: {
      mode: string;
      state: () => Record<string, unknown>;
      plotScreen?: (i: number) => { x: number; y: number };
      artcheck?: () => ReturnType<typeof artCheckSummary>;
    };
  }
}

/** Counts WebGL draw calls per frame by wrapping the context's draw entry points. */
function countDrawCalls(gl: WebGLRenderingContext | WebGL2RenderingContext | undefined): { take: () => number } | null {
  if (!gl) return null;
  let n = 0;
  const g = gl as unknown as Record<string, unknown>;
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const fn = g[name];
    if (typeof fn !== 'function') continue;
    g[name] = function (this: unknown, ...args: unknown[]) {
      n++;
      return (fn as (...a: unknown[]) => unknown).apply(this, args);
    };
  }
  return {
    take: () => {
      const v = n;
      n = 0;
      return v;
    },
  };
}

function showError(msg: string): void {
  const el = document.getElementById('boot');
  if (el) el.textContent = msg;
}

async function main(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const levelId = q.get('level') ?? 'l1c';
  const level = getLevelById(levelId);
  if (!level?.layout2d) {
    showError(`Unknown 2D island: ${levelId}`);
    return;
  }
  const ab = q.get('ab') === '1';
  const bench = Math.max(0, Math.min(340, Number(q.get('bench') ?? 0) || 0));

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#5b8f3a',
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    preference: 'webgl',
  });
  document.getElementById('stage')!.appendChild(app.canvas);

  await Promise.all([
    document.fonts.load(`700 32px ${HUD_FONT}`).catch(() => undefined),
  ]);
  const art = await loadArt('/art2d/manifest.json', level.layout2d.image, { raider: q.get('raider') });
  if (art.notes.length > 0) console.info('[art2d] fallbacks:\n  ' + art.notes.join('\n  '));
  document.getElementById('boot')?.remove();
  if (q.get('artcheck') === '1') mountArtCheck(art);

  const draws = countDrawCalls((app.renderer as unknown as { gl?: WebGL2RenderingContext }).gl);
  const stats = new FrameStats();
  const updateStats = new FrameStats();
  const renderStats = new FrameStats();
  let renderStart = 0;
  let lastDraws = 0;
  const rendererName = (app.renderer as unknown as { name?: string }).name ?? 'unknown';

  if (ab) {
    const scene = new AbScene(app, art, level);
    const onResize = (): void => scene.resize(app.screen.width, app.screen.height);
    onResize();
    app.renderer.on('resize', onResize);
    app.ticker.add((t) => scene.frame(Math.min(0.1, t.deltaMS / 1000)));
    window.__p0 = { mode: 'ab', state: () => scene.debugState() };
    return;
  }

  let hooks: Game2DHooks = {};
  let aimState: AimSceneState | null = null;
  if (bench > 0) hooks = benchHooks(bench);
  else if (q.get('zoo') === '1') hooks = zooHooks();
  else if (q.get('towers') === 'aim') {
    const type = (['archer', 'cannon', 'ballista'] as const).find((x) => x === q.get('type')) ?? 'cannon';
    const tier = Math.max(1, Math.min(3, Number(q.get('tier') ?? 1) || 1));
    aimState = { type, tier, plot: -1, sectors: [], current: -1, since: 0 };
    hooks = aimHooks(type, tier, aimState, Math.max(0.5, Number(q.get('hold') ?? 1.6) || 1.6));
  } else if (q.get('towers') === '1') hooks = towersHooks(Math.max(0, Math.min(3, Number(q.get('tier') ?? 0) || 0)) || null);
  else if (q.get('autoplay') === '1') hooks = autoplayHooks(level.scriptedBuildOrder ?? []);
  const game = new Game2D(app, art, level, hooks);
  game.attachInput(app.canvas);
  const startSpeed = Number(q.get('speed'));
  if (startSpeed === 2 || startSpeed === 3) game.stepper.speed = startSpeed;
  const onResize = (): void => game.resize(app.screen.width, app.screen.height);
  onResize();
  app.renderer.on('resize', onResize);
  if (bench === 0) {
    let wasPaused = false;
    const codex = mountCodex2D(art, (open) => {
      if (open) {
        wasPaused = game.stepper.paused;
        game.stepper.paused = true;
      } else game.stepper.paused = wasPaused;
    });
    if (q.get('codex') === '1') codex.open();
  }
  const zooLabels = q.get('zoo') === '1' ? new ZooLabels(game) : null;
  const aimOverlay = aimState && q.get('overlay') !== '0' ? new AimOverlay(game) : null;
  app.ticker.add((t) => {
    if (draws) lastDraws = draws.take();
    const t0 = performance.now();
    stats.record(t.deltaMS, t0);
    game.frame(t.deltaMS / 1000);
    zooLabels?.update();
    aimOverlay?.update();
    renderStart = performance.now();
    updateStats.record(renderStart - t0, renderStart);
  });
  // Runs after the app's own render listener (LOW priority): CPU time spent submitting the frame.
  app.ticker.add(() => {
    const now = performance.now();
    renderStats.record(now - renderStart, now);
  }, null, UPDATE_PRIORITY.UTILITY);
  window.__p0 = {
    mode: bench > 0 ? 'bench' : 'play',
    state: () => game.debugState(),
    plotScreen: (i) => game.plotScreen(i),
    artcheck: () => artCheckSummary(art),
  };
  if (aimState) window.__aim = aimState;
  if (bench > 0) {
    Object.defineProperty(window, '__bench', {
      configurable: true,
      get: (): BenchStats => {
        const now = performance.now();
        const s = stats.snapshot(now);
        const u = updateStats.snapshot(now);
        const r = renderStats.snapshot(now);
        const r2 = (v: number): number => Math.round(v * 100) / 100;
        return {
          updateMs: [r2(u.p50), r2(u.p95)],
          renderCpuMs: [r2(r.p50), r2(r.p95)],
          fps: Math.round(s.fps * 10) / 10,
          p50: Math.round(s.p50 * 100) / 100,
          p95: Math.round(s.p95 * 100) / 100,
          samples: s.samples,
          enemies: game.world.enemyPool.getActiveCount(),
          drawCalls: draws ? lastDraws : null,
          renderer: rendererName,
        };
      },
    });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  showError(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
});
