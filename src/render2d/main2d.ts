import '@fontsource-variable/fredoka';
import { Application, UPDATE_PRIORITY } from 'pixi.js';
import { getLevelById } from '../data/levels2d/index.ts';
import { AbScene } from './abScene.ts';
import { artCheckSummary, mountArtCheck } from './artCheck.ts';
import { changeMapVariant, loadArt } from './assets2d.ts';
import { autoplayHooks, benchHooks } from './benchScene.ts';
import { mountCodex2D } from './codex2d.ts';
import { initLocale, t } from '../i18n/index.ts';
import { AimOverlay, aimHooks, meleeHooks, towersHooks, zooHooks, ZooLabels, type AimSceneState, type MeleeSceneState } from './debugScenes.ts';
import { ENEMY_TYPES } from '../data/enemies.ts';
import type { EnemyType } from '../core/types.ts';
import { FrameStats } from './frameStats.ts';
import { Game2D, type Game2DHooks } from './game2d.ts';
import { resolveHeroForRun } from './heroes2d.ts';
import { HUD_FONT } from './hudText.ts';
import { detectSoftwareWebGL, isDesktopClient, qualityOverride, renderResolution, type QualityTier } from './renderResolution.ts';
import type { MapView } from './mapView.ts';
import type { GateLayer } from './gateLayer.ts';
import { MASTER_SCALE, maxMapScale, pickMapVariant } from './mapVariant.ts';
import { computeMapFit } from './viewFit.ts';
import { mountSettings2D, type Settings2D } from './settingsButton2d.ts';
import { anySheetOpen } from './ui/dom.ts';

/**
 * 2d.html entry — the painted 2D renderer (Pixi v8) on the real sim.
 *   (no params)       the world map (island select, briefing, Workshop / Logbook / Daily / Settings);
 *                     map QA: ?screen=brief|workshop|logbook|daily|settings|store, ?mockislands=N,
 *                     ?store=<id> (store card for a paid island), ?iapmock=1 (mock store, mobile scope)
 *   ?level=l1c        play an island (deep link, skips the map; any debug param below defaults to l1c)
 *   &intro=1          show the island's story panels first (once; the map adds it on a first play)
 *   ?story=intro|outro QA: force the story panels (intro on load, outro after a win)
 *   ?ab=1             enemy-animation A/B showcase (no combat)
 *   ?bench=150        stress scene: ~N enemies, towers on every plot, window.__bench stats
 *   ?autoplay=1       plays the greedy build script and auto-calls waves
 *   ?raider=veo31q    raider walk-cycle variant (default omni12; `cheap` = procedural)
 *   ?codex=1          opens the codex (painted art) on load; a Codex button is always top-left
 *   ?artcheck=1       overlay: which manifest art files are present / missing (and the stand-ins)
 *   ?zoo=1            all 15 enemy types walking, specials triggered periodically (labelled)
 *   ?towers=1[&tier=N] every tower type built and firing (cycles T1-T3 unless tier is given)
 *   ?towers=aim&type=cannon|archer|ballista|mortar[&tier=N]  turret aim QA (window.__aim, aim overlay)
 *   ?melee=1[&tier=N][&types=a,b][&plot=N][&die=1][&kill=1][&crowd=N]  barracks melee QA
 *                     (window.__meleeScene; with &manual=1 the game only advances through
 *                     window.__meleeScene.step(frames), for frame-exact captures)
 *   ?speed=2|3        start at 2× / 3× sim speed (QA recordings)
 *   ?end=won|lost     force the end panel shortly after load (UI QA)
 *   ?mapmips=1        QA: draw the map texture mipmapped (default: resolution variant, no mips)
 *   &settings=1       open the in-game Settings on load (a language switch reloads with it)
 *   ?desktop=1|0      QA: force the desktop / phone render-resolution policy (renderResolution.ts)
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
    __meleeScene?: MeleeSceneState & { step: (frames: number) => void; stats: () => Record<string, unknown>; toScreen: (x: number, z: number) => { x: number; y: number } };
    __p0?: {
      mode: string;
      state: () => Record<string, unknown>;
      plotScreen?: (i: number) => { x: number; y: number };
      forceEnd?: (o: 'won' | 'lost') => void;
      /** QA: jump to a one-based wave (Endless records / end-panel shots). */
      skipToWave?: (n: number) => boolean;
      hudWave?: () => string;
      setGold?: (g: number) => void;
      setLives?: (n: number) => void;
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

/** Query keys that start a game scene; without any of them 2d.html opens the world map. */
const GAME_PARAMS = ['level', 'hero', 'daily', 'challenge', 'endless', 'ab', 'bench', 'autoplay', 'raider', 'codex', 'artcheck', 'zoo', 'towers', 'melee', 'speed', 'end', 'mapmips'] as const;

/**
 * Language first (before any text is built): `?lang=`, the stored setting, else the browser. The
 * boot line and the page title follow it, and Fredoka's latin-ext subset (ğ ş ı İ) is fetched with
 * the latin one, so canvas text never falls back to another font for Turkish letters.
 */
function bootLocale(): Promise<unknown> {
  initLocale();
  document.title = t('page.title');
  const boot = document.getElementById('boot');
  if (boot) boot.textContent = t('boot.loading');
  return Promise.all([
    document.fonts.load(`700 32px ${HUD_FONT}`, 'Aa'), // i18n-ignore (font probe)
    document.fonts.load(`700 32px ${HUD_FONT}`, 'ğşıİçöüĞŞÇÖÜ'),
  ]).catch(() => undefined);
}

async function main(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const fontsReady = bootLocale();
  if (!GAME_PARAMS.some((k) => q.has(k))) {
    await fontsReady;
    const { mountWorldMap } = await import('./ui/worldMap.ts');
    await mountWorldMap(q);
    document.getElementById('boot')?.remove();
    return;
  }
  const ab = q.get('ab') === '1';
  const bench = Math.max(0, Math.min(340, Number(q.get('bench') ?? 0) || 0));
  const isDebugScene =
    ab ||
    bench > 0 ||
    q.get('melee') === '1' ||
    q.get('zoo') === '1' ||
    q.has('towers') ||
    q.get('autoplay') === '1' ||
    q.has('end');
  const [{ loadProgress2D }, { resolveQueryRun2D }] = await Promise.all([
    import('./ui/progress2d.ts'),
    import('./ui/modes2d.ts'),
  ]);
  const progress2d = loadProgress2D();
  const run = resolveQueryRun2D(q, progress2d, {
    nowMs: Date.now(),
    lookupLevel: getLevelById,
    applySaveModifiers: !isDebugScene,
  });
  const heroSelection =
    isDebugScene && !q.has('hero')
      ? null
      : resolveHeroForRun(progress2d, q.get('hero'), q.get('herolevel'));
  // Mobile builds (and ?iapmock=1): an island past the free version's scope (deep link, Daily
  // Squall, Next Isle) goes to the world map with the store card open instead of playing.
  if (!isDebugScene) {
    const { canPlayIsland, storeHref } = await import('./ui/store2d.ts');
    if (!canPlayIsland(run.levelId)) {
      location.replace(storeHref(run.levelId));
      return;
    }
  }
  const level = run.level;
  if (!level?.layout2d) {
    showError(t('boot.unknownIsland', { id: run.levelId }));
    return;
  }

  const dprOverride = Number(q.get('dpr')) || undefined;
  const explicitQuality = qualityOverride(q.get('quality'));
  const softwareWebGL = detectSoftwareWebGL();
  const startWave = Number(q.get('wave') ?? 0) || 0;
  const bootTier: QualityTier =
    explicitQuality ?? ((bench > 0 || startWave > 1) && softwareWebGL ? 'low' : 'high');
  // Desktops always start (and stay) at full canvas resolution; the tier only trims effects there.
  const bootResolutionTier: QualityTier = isDesktopClient(q) && !explicitQuality ? 'high' : bootTier;
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#5b8f3a',
    antialias: !softwareWebGL,
    autoDensity: true,
    autoStart: false,
    resolution: renderResolution(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, dprOverride, bootResolutionTier),
    preference: 'webgl',
  });
  document.getElementById('stage')!.appendChild(app.canvas);

  const gl = (app.renderer as unknown as { gl?: WebGL2RenderingContext }).gl;

  await fontsReady;
  const layout2d = level.layout2d;
  // Device px per layout px at a screen size: picks the map bake (resolution variant) to load.
  const mapNeed = (w: number, h: number): number =>
    computeMapFit(w, h, layout2d.imageSize[0], layout2d.imageSize[1], layout2d.safeArea).scale * app.renderer.resolution;
  const textureLimit = gl ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) : 4096;
  const maxScale = maxMapScale(isDesktopClient(q), textureLimit, layout2d.imageSize);
  const fronts = ab ? [] : layout2d.gates?.flatMap((gate) => gate.front ? [gate.front.art] : []) ?? [];
  const mapMips = q.get('mapmips') === '1';
  const art = await loadArt(
    '/art2d/manifest.json',
    layout2d.image,
    { raider: q.get('raider') },
    {
      need: mapNeed(app.screen.width, app.screen.height),
      mips: mapMips,
      overlayKeys: fronts,
      maxScale,
    },
  );
  if (art.notes.length > 0) console.info('[art2d] fallbacks:\n  ' + art.notes.join('\n  '));
  if (q.get('artcheck') === '1') mountArtCheck(art);

  // Subscribe after the master has painted. Serialize loads and recheck the fit before applying
  // them, since resizing / adaptive resolution can change the desired bake while it downloads.
  function watchMap(map: MapView, gates?: GateLayer): void {
    const desired = (): string | null => {
      const need = mapNeed(app.screen.width, app.screen.height);
      // Small bakes can stay resident when a phone calibrates down after boot.
      if (map.texelScale <= MASTER_SCALE && map.texelScale >= need) return art.map.key;
      return pickMapVariant(art.manifest.maps, layout2d.image, need, maxScale);
    };
    let loading = false;
    const update = async (): Promise<void> => {
      if (loading) return;
      loading = true;
      try {
        let key = desired();
        while (key && key !== art.map.key) {
          const target = key;
          await changeMapVariant(art, target, fronts, mapMips, () => desired() === target, () => {
            map.setTexture(art.map.texture);
            gates?.setTextures(art.map.overlays);
          });
          key = desired();
          if (key === target) break;
        }
      } finally {
        loading = false;
      }
    };
    const refresh = (): void => { void update().catch((err: unknown) => console.warn('[art2d] map swap failed', err)); };
    app.ticker.addOnce(() => requestAnimationFrame(() => {
      app.renderer.on('resize', refresh);
      app.renderer.runners.resolutionChange.add({ resolutionChange: refresh });
      refresh();
    }), null, UPDATE_PRIORITY.UTILITY);
  }

  const draws = countDrawCalls(gl);
  const stats = new FrameStats();
  const updateStats = new FrameStats();
  const renderStats = new FrameStats();
  let renderStart = 0;
  let lastDraws = 0;
  const rendererName = (app.renderer as unknown as { name?: string }).name ?? 'unknown';

  if (ab) {
    const scene = new AbScene(app, art, level);
    const onResize = (): void => {
      scene.resize(app.screen.width, app.screen.height);
    };
    onResize();
    watchMap(scene.map);
    app.renderer.on('resize', onResize);
    app.ticker.add((t) => scene.frame(Math.min(0.1, t.deltaMS / 1000)));
    document.getElementById('boot')?.remove();
    app.ticker.start();
    window.__p0 = { mode: 'ab', state: () => scene.debugState() };
    return;
  }

  let hooks: Game2DHooks = {};
  let aimState: AimSceneState | null = null;
  let meleeState: MeleeSceneState | null = null;
  if (bench > 0) hooks = benchHooks(bench);
  else if (q.get('melee') === '1') {
    meleeState = { towerId: -1, rally: null, lane: 0, spawned: 0 };
    const types = (q.get('types') ?? 'grunt,brute,golem,mite')
      .split(',')
      .filter((t): t is EnemyType => (ENEMY_TYPES as readonly string[]).includes(t));
    hooks = meleeHooks(
      {
        tier: Math.max(1, Math.min(3, Number(q.get('tier') ?? 3) || 3)),
        types: types.length > 0 ? types : ['grunt'],
        plot: Number(q.get('plot') ?? -1),
        die: q.get('die') === '1',
        kill: q.get('kill') === '1',
        crowd: Math.max(1, Math.min(6, Number(q.get('crowd') ?? 3) || 3)),
      },
      meleeState,
    );
  }
  else if (q.get('zoo') === '1') hooks = zooHooks();
  else if (q.get('towers') === 'aim') {
    const type = (['archer', 'cannon', 'ballista', 'mortar'] as const).find((x) => x === q.get('type')) ?? 'cannon';
    const tier = Math.max(1, Math.min(3, Number(q.get('tier') ?? 1) || 1));
    aimState = { type, tier, plot: -1, sectors: [], current: -1, since: 0 };
    hooks = aimHooks(type, tier, aimState, Math.max(0.5, Number(q.get('hold') ?? 1.6) || 1.6));
  } else if (q.get('towers') === '1') hooks = towersHooks(Math.max(0, Math.min(3, Number(q.get('tier') ?? 0) || 0)) || null);
  else if (q.get('autoplay') === '1') hooks = autoplayHooks(level.scriptedBuildOrder ?? []);
  // End panel: Next Isle = the following island on the world map route (only when it is open, or
  // this run just won it open), World Map = back to the map. Plain play records wins in the 2D save
  // and shows the island's after-battle story once; QA / debug scenes record nothing.
  const plainPlay = Object.keys(hooks).length === 0 && !q.has('end') && bench === 0;
  let codexRef: { setButtonVisible(v: boolean): void } | null = null;
  let settingsRef: Settings2D | null = null;
  let gameRef: Game2D | null = null;
  let codexWasPaused = false;
  let settingsWasPaused = false;
  let introWasPaused = false;
  let storyOpen = false;
  const routing = await import('./ui/inGame.ts');
  const baseHooks = hooks;
  hooks = {
    ...baseHooks,
    modifiers: run.modifiers,
    hero: heroSelection,
    startEndless: run.runConfig.endless,
    initialUnlockedTier: bootTier,
    onBackgroundChange: (inBackground) => {
      if (inBackground) {
        // Keep the run paused on resume even if Codex or the intro story was open when backgrounded.
        codexWasPaused = true;
        settingsWasPaused = true;
        introWasPaused = true;
        if (!isDebugScene) app.ticker.stop();
      } else if (!isDebugScene) {
        app.ticker.start();
        app.render();
      }
    },
    onEndPanel: (shown) => {
      codexRef?.setButtonVisible(!shown);
      settingsRef?.setButtonVisible(!shown);
      const w = gameRef?.world;
      if (!shown || !w) return;
      const won = w.outcome === 'won';
      if (plainPlay) {
        const masteredBefore = routing.isMastered(level.id);
        const result = routing.recordRunOutcome({
          levelId: level.id,
          won,
          stars: won ? w.computeStars() : 0,
          livesRemaining: w.lives,
          waveReached: w.waveSystem.currentWaveOneBased,
          runConfig: run.runConfig,
          heroId: w.hero?.heroId ?? null,
          enemiesKilled: w.enemiesKilledTotal,
          wavesCleared: won ? level.waves.length : Math.max(0, w.waveSystem.currentWaveOneBased - 1),
          heroXpEarned: w.heroSystem.runXp,
        });
        // Challenge badges, Daily Squall and Endless records go on the board.
        gameRef?.end.annotate(
          routing.endNoteFor({
            won,
            runConfig: run.runConfig,
            result,
            wave: w.waveSystem.currentWaveOneBased,
            storyWaves: level.waves.length,
            masteredNow: !masteredBefore && routing.isMastered(level.id),
          }),
        );
      }
      const story = q.get('story');
      if (won && (plainPlay || story === 'outro')) void routing.playStoryOnce(level, 'outro', art.manifest, art.baseUrl, story === 'outro');
    },
    onMenu: () => {
      const w = gameRef?.world;
      if (plainPlay && w && run.runConfig.endless && w.outcome === 'ongoing') {
        routing.recordRunOutcome({
          levelId: level.id,
          won: false,
          stars: 0,
          livesRemaining: w.lives,
          waveReached: w.waveSystem.currentWaveOneBased,
          runConfig: run.runConfig,
          heroId: w.hero?.heroId ?? null,
          enemiesKilled: w.enemiesKilledTotal,
          wavesCleared: Math.max(0, w.waveSystem.currentWaveOneBased - 1),
          heroXpEarned: w.heroSystem.runXp,
        });
      }
      location.assign(routing.worldMapHref());
    },
    get onNext() {
      const next = routing.nextIslandOpen(level.id, gameRef?.world.outcome === 'won');
      return next ? () => location.assign(routing.islandHref(next)) : undefined;
    },
  };
  const game = new Game2D(app, art, level, hooks);
  gameRef = game;
  if (run.runConfig.endless) game.hud.setEndless(level.waves.length);
  if (q.get('end') === 'won' || q.get('end') === 'lost') {
    const end = q.get('end') as 'won' | 'lost';
    setTimeout(() => game.forceEnd(end), 300);
  }
  game.attachInput(app.canvas);
  const startSpeed = Number(q.get('speed'));
  if (startSpeed === 2 || startSpeed === 3) game.stepper.speed = startSpeed;
  game.resize(app.screen.width, app.screen.height);
  game.prewarm({ benchSteps: bench > 0 ? Math.ceil(bench / 10) + 2 : 0 });
  watchMap(game.map, game.gates);
  const onResize = (): void => {
    game.resize(app.screen.width, app.screen.height);
  };
  app.renderer.on('resize', onResize);
  for (let warmFrames = 0; warmFrames < 4; warmFrames++) {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        app.render();
        resolve();
      }),
    );
  }
  draws?.take();
  document.getElementById('boot')?.remove();
  if (bench === 0) {
    const codex = mountCodex2D(art, (open) => {
      if (open) {
        codexWasPaused = game.stepper.paused;
        game.stepper.paused = true;
      } else game.stepper.paused = codexWasPaused;
    });
    codexRef = codex;
    // In-game Settings (HUD row + the Paused plate): pauses the run while open.
    const settings = mountSettings2D(
      (open) => {
        if (open) {
          settingsWasPaused = game.stepper.paused;
          game.stepper.paused = true;
        } else {
          game.stepper.paused = settingsWasPaused;
          game.refreshSettings();
        }
      },
      () => undefined,
    );
    settingsRef = settings;
    if (q.get('codex') === '1') codex.open();
    else if (q.get('settings') === '1') settings.open();
    // Story panels before an island's first play (map → Play / Next Isle add &intro=1; ?story=intro forces them).
    const storyQ = q.get('story');
    if (q.get('intro') === '1' || storyQ === 'intro') {
      const g = game;
      introWasPaused = g.stepper.paused;
      g.stepper.paused = true;
      codex.setButtonVisible(false);
      settings.setButtonVisible(false);
      storyOpen = true;
      void routing.playStoryOnce(level, 'intro', art.manifest, art.baseUrl, storyQ === 'intro').then(() => {
        storyOpen = false;
        g.stepper.paused = introWasPaused;
        if (!g.end.visible) {
          codex.setButtonVisible(true);
          settings.setButtonVisible(true);
        }
      });
    }
  }
  const zooLabels = q.get('zoo') === '1' ? new ZooLabels(game) : null;
  const aimOverlay = aimState && q.get('overlay') !== '0' ? new AimOverlay(game) : null;
  const manual = meleeState !== null && q.get('manual') === '1';
  if (meleeState) {
    const ms = meleeState;
    window.__meleeScene = Object.assign(ms, {
      step: (frames: number): void => {
        for (let i = 0; i < frames; i++) game.frame(1 / 60);
      },
      stats: (): Record<string, unknown> => ({ ...game.melee.stats, ...game.soldiers.debug(game.world.soldierSystem) }),
      toScreen: (x: number, z: number) => ({ x: game.map.screenX(game.map.pxX(x)), y: game.map.screenY(game.map.pxY(z)) }),
    });
  }
  app.ticker.add((t) => {
    if (draws) lastDraws = draws.take();
    const t0 = performance.now();
    stats.record(t.deltaMS, t0);
    if (!manual) game.frame(t.deltaMS / 1000);
    settingsRef?.setPausePlate(storyOpen || anySheetOpen() ? null : game.hud.pausePlate);
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
    forceEnd: (o) => game.forceEnd(o),
    skipToWave: (n) => game.world.debugSkipToWave(n),
    hudWave: () => game.hud.waveLabel,
    artcheck: () => artCheckSummary(art),
    setGold: (g) => {
      game.world.gold = g;
      game.markHudDirty();
    },
    setLives: (n) => {
      game.world.lives = n;
      game.markHudDirty();
    },
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
  if (!document.hidden || isDebugScene) app.ticker.start();
}

main().catch((err: unknown) => {
  console.error(err);
  showError(t('boot.failed', { msg: err instanceof Error ? err.message : String(err) }));
});
