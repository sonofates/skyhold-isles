import '@fontsource-variable/fredoka';
import './ui/fredokaTr.css';
import { Application, UPDATE_PRIORITY } from 'pixi.js';
import { getLevelById, LEVELS_2D } from '../data/levels2d/index.ts';
import { buildEndlessWaveDef } from '../sim/waveSystem.ts';
import { AbScene } from './abScene.ts';
import { artCheckSummary, mountArtCheck } from './artCheck.ts';
import { changeMapVariant, loadArt } from './assets2d.ts';
import { autoplayHooks, benchHooks } from './benchScene.ts';
import { mountCodex2D } from './codex2d.ts';
import { initLocale, t } from '../i18n/index.ts';
import { heroName, islandName } from '../i18n/data.ts';
import { AimOverlay, aimHooks, meleeHooks, towersHooks, zooHooks, ZooLabels, type AimSceneState, type MeleeSceneState } from './debugScenes.ts';
import { ENEMY_TYPES } from '../data/enemies.ts';
import { getTowerTierStats } from '../data/towers.ts';
import type { EnemyType } from '../core/types.ts';
import { FrameStats } from './frameStats.ts';
import { Game2D, REPLAY_SPEEDS, type Game2DHooks } from './game2d.ts';
import { heroLevelProgress, resolveHeroForRun } from './heroes2d.ts';
import type { HeroHud2D } from './ui/heroHud2d.ts';
import type { HeroSkillSlot } from '../core/types.ts';
import type { RunCommand } from './ui/replay2d.ts';
import { HUD_FONT } from './hudText.ts';
import { detectSoftwareWebGL, isDesktopClient, qualityOverride, renderResolution, setGraphicsPrefs, type QualityTier } from './renderResolution.ts';
import { setFxPrefs } from './fxLayer.ts';
import type { GameSettings } from '../core/types.ts';
import { isTouchDevice, loadSettings } from '../platform/storage.ts';
import { GRAPHICS_EVENT, graphicsEngineState, loadGraphics, type GraphicsEngineState, type GraphicsSettings } from './ui/graphicsSettings.ts';
import type { AbilityBar2D } from './ui/abilityBar2d.ts';
import type { AbilityId } from '../core/types.ts';
import type { MapView } from './mapView.ts';
import type { GateLayer } from './gateLayer.ts';
import { MASTER_SCALE, maxMapScale, pickMapVariant } from './mapVariant.ts';
import { mountSettings2D, type Settings2D } from './settingsButton2d.ts';
import { hudKeepOuts, readSafeInsets } from './uiKit.ts';
import { gateKeepOutsPx, hudButtonsKeepOut, setUserUiScale, userUiScale } from './uiLayout.ts';
import { uiUnit } from './hudDock.ts';
import { hudCheck } from './hudCheck.ts';
import { auditCanvasTexts } from './qaText.ts';
import { anySheetOpen } from './ui/dom.ts';
import { installNav } from './ui/navFocus.ts';
import { dismissBoot, navigateWithVeil, pickLoadTip, setBootText, setBootTip } from './ui/transition2d.ts';

/**
 * 2d.html entry — the painted 2D renderer (Pixi v8) on the real sim.
 *   (no params)       the title screen once per session (titleScreen.ts; ?title=1 forces it, ?title=0 or
 *                     an automated browser skips it), then the world map (island select, briefing,
 *                     Workshop / Logbook / Daily / Settings);
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
 *   ?zoo=1            all 19 enemy types walking, specials triggered periodically (labelled)
 *   ?towers=1[&tier=N] every tower type built and firing (cycles T1-T3 unless tier is given)
 *   ?towers=aim&type=cannon|archer|ballista|mortar[&tier=N]  turret aim QA (window.__aim, aim overlay)
 *   ?melee=1[&tier=N][&types=a,b][&plot=N][&die=1][&kill=1][&crowd=N]  barracks melee QA
 *                     (window.__meleeScene; with &manual=1 the game only advances through
 *                     window.__meleeScene.step(frames), for frame-exact captures)
 *   ?speed=2|3        start at 2× / 3× sim speed (QA recordings)
 *   ?end=won|lost     force the end panel shortly after load (UI QA)
 *   ?mapmips=1        QA: draw the map texture mipmapped (default: resolution variant, no mips)
 *   &settings=1       open the in-game Settings on load (a language switch reloads with it)
 *   &settab=general|audio|graphics|controls   the Settings section it opens on (QA; map too)
 *   ?desktop=1|0      QA: force the desktop / phone render-resolution policy (renderResolution.ts)
 *   ?hero=<id>|none   run with that hero (or none); &herolevel=1..20 forces its level (QA)
 *   &herosel=1        QA: start with the hero selected (move mode)
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
    /** QA: the title screen (phase, loading fraction, menu entries). */
    __title?: import('./ui/titleScreen.ts').TitleScreen;
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
      /** QA: the ability bar (state, boxes, FX counters) and aiming as a button press would. */
      abilities?: () => Record<string, unknown> | null;
      /** QA: the keyboard / gamepad reticle (padCursor.ts). */
      pad?: () => { shown: boolean; x: number; y: number; mode: string } | null;
      padClick?: () => void;
      /** QA: the next-wave card (in the dock's info slot). */
      waveCard?: () => Record<string, unknown> | null;
      /** QA: every HUD piece as drawn (screen px) and what playable shape each one covers (must be none). */
      hudCheck?: () => import('./hudCheck.ts').HudCheck;
      /** QA: canvas lettering against its painted box (qaText.ts); empty = all inside. */
      textAudit?: () => import('./qaText.ts').QaTextProblem[];
      /** QA: what fills the letterbox bands (blurred backdrop, shadow, vignette, border). */
      mapFrame?: () => ReturnType<import('./mapView.ts').MapView['frameInfo']>;
      /** QA: the caves / castle fronts on screen (`castle` = the goal). */
      gates?: () => { x: number; y: number; w: number; h: number; castle: boolean }[];
      lives?: () => Record<string, unknown> | null;
      /** QA: the foe info card, and the screen point of a live foe to tap. */
      foe?: () => Record<string, unknown> | null;
      coach?: () => Record<string, unknown> | null;
      goldPops?: () => { active: number; spawned: number };
      newFoe?: () => Record<string, unknown> | null;
      callout?: () => Record<string, unknown> | null;
      calloutAgain?: () => void;
      /** QA: the in-run difficulty badge and the end board's difficulty tag. */
      diffBadge?: () => Record<string, unknown> | null;
      endDiff?: () => Record<string, unknown> | null;
      laneMarks?: () => Record<string, unknown> | null;
      foeAt?: () => { x: number; y: number; h: number } | null;
      aimAbility?: (id: AbilityId | null) => void;
      /** QA: stop / restart the ticker (a frozen frame for mid-effect screenshots, no Paused plate). */
      freeze?: (on: boolean) => void;
      /** QA: watch the last run / leave it / viewer speed / restart the island now (no confirm). */
      replay?: {
        start: () => boolean;
        exit: () => void;
        speed: (s: number) => void;
        restart: () => void;
        /** A player command through the recorded command layer. */
        cmd: (c: RunCommand) => boolean;
        /** Runs `frames` game frames of 0.1 s right now (fast-forward for QA). */
        step: (frames: number) => void;
        /** Per-tick callback (determinism traces), null to stop. */
        probe: (fn: ((world: import('../sim/world.ts').SimWorld, tick: number) => void) | null) => void;
      };
      /** QA: the hero (HUD + render + sim state) and commands as the player would give them. */
      hero?: {
        state: () => Record<string, unknown>;
        select: (on: boolean) => void;
        move: (x: number, z: number) => boolean;
        aim: (slot: HeroSkillSlot | null) => void;
        cast: (slot: HeroSkillSlot, x?: number, z?: number) => boolean;
        kill: () => void;
        toScreen: (x: number, z: number) => { x: number; y: number };
        tap: (x: number, y: number) => void;
        nearestEnemy: () => { x: number; z: number } | null;
      };
    };
  }
}

/**
 * Settings → Graphics into the renderer (resolution / tier lock, effects density, reduced-motion
 * flashes) and the page (reduced-motion class). Returns the engine state for the ticker cap.
 */
function applyGraphics(g: GraphicsSettings, quality: GameSettings['quality'], desktop: boolean): GraphicsEngineState {
  const engine = graphicsEngineState(quality, g, desktop);
  setGraphicsPrefs(engine.prefs);
  setFxPrefs(engine.fx);
  document.documentElement.classList.toggle('pu-reduce-motion', g.reducedMotion);
  applyUiScale(g.uiScale);
  return engine;
}

/** Interface size: the CSS unit (`--ui-scale`) and the HUD layout math (uiLayout.ts) together. */
function applyUiScale(k: number): void {
  if (k === userUiScale() && document.documentElement.style.getPropertyValue('--ui-scale') === String(k)) return;
  const changed = k !== userUiScale();
  setUserUiScale(k);
  document.documentElement.style.setProperty('--ui-scale', String(k));
  // Everything laid out from the screen size (map fit, HUD dock, boards) lays out again.
  if (changed) requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

/** Pixi skips a frame that comes a hair early: leave 8% slack so a 60 cap keeps every 60 Hz frame. */
function tickerMaxFps(cap: number): number {
  return cap > 0 ? cap * 1.08 : 0;
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
 * boot line and the page title follow it, and the Turkish letters Fredoka lacks (ğ ş İ, served by
 * the 'Fredoka TR' faces of ui/fredokaTr.css) are fetched up front, so canvas text never falls
 * back to another font for them.
 */
function bootLocale(): Promise<unknown> {
  initLocale();
  document.title = t('page.title');
  setBootText(t('boot.loading'));
  return Promise.all([
    document.fonts.load(`700 32px ${HUD_FONT}`, 'Aa'), // i18n-ignore (font probe)
    document.fonts.load(`700 32px ${HUD_FONT}`, 'ğşıİçöüĞŞÇÖÜ'),
    document.fonts.load(`600 32px ${HUD_FONT}`, 'ğşıİçöüĞŞÇÖÜ'),
  ]).catch(() => undefined);
}

/** The title screen in front of the world map (titleScreen.ts); the map mounts on Continue / New game. */
async function runTitleScreen(q: URLSearchParams, title: typeof import('./ui/titleScreen.ts')): Promise<void> {
  dismissBoot();
  const { screen, done } = title.runTitle(q, {
    openMap: async () => {
      const { mountWorldMap } = await import('./ui/worldMap.ts');
      await mountWorldMap(q);
    },
    openSettings: (onClose) => {
      void import('./ui/metaScreens.ts').then(({ openSettings }) =>
        openSettings({ levels: LEVELS_2D, onChange: () => undefined, onClose, reloadTo: '?title=1&titleopen=settings' }),
      );
    },
    openCredits: (onClose) => {
      void import('./ui/credits2d.ts').then(({ openCredits }) => openCredits(onClose));
    },
    confirmNewGame: async () => {
      const { confirmBoard } = await import('./ui/runControls2d.ts');
      return confirmBoard({ title: t('title.newTitle'), body: t('title.newBody'), yes: t('title.newYes'), no: t('title.newNo'), testid: 'confirm-newgame' });
    },
  });
  window.__title = screen;
  await done;
}

async function main(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const fontsReady = bootLocale();
  installNav();
  // Interface size changes on the map too (the run's own listener re-applies the rest).
  window.addEventListener(GRAPHICS_EVENT, () => applyUiScale(loadGraphics().uiScale));
  const desktop = isDesktopClient(q);
  let gfx = loadGraphics();
  let engine = applyGraphics(gfx, loadSettings().quality, desktop);
  if (!GAME_PARAMS.some((k) => q.has(k))) {
    await fontsReady;
    const title = await import('./ui/titleScreen.ts');
    if (title.shouldShowTitle(q, { seen: title.titleSeen(), automated: navigator.webdriver === true })) {
      await runTitleScreen(q, title);
      return;
    }
    const { mountWorldMap } = await import('./ui/worldMap.ts');
    await mountWorldMap(q);
    dismissBoot();
    return;
  }
  // A battle is loading: the boot screen names the island and shows a tip.
  const bootLevel = getLevelById(q.get('level') ?? '');
  if (bootLevel && !q.has('bench') && !q.has('ab')) setBootText(t('boot.course', { name: islandName(bootLevel) }));
  if (!q.has('bench') && !q.has('ab')) setBootTip(t('boot.tipLabel'), t(pickLoadTip(Math.random())));
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
  // `?quality=` wins over the player's Quality preset (Settings → Graphics), which wins over Auto.
  const autoTier: QualityTier = explicitQuality ?? ((bench > 0 || startWave > 1) && softwareWebGL ? 'low' : 'high');
  const bootTier: QualityTier = explicitQuality ?? engine.prefs.lock ?? autoTier;
  // Desktops always start (and stay) at full canvas resolution; the tier only trims effects there.
  const bootResolutionTier: QualityTier = desktop && !explicitQuality ? 'high' : bootTier;
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
  // Device px per layout px at a screen size: picks the map bake (resolution variant) to load. The
  // map covers the screen (fullBleed.ts; it only ever shrinks from this).
  const mapNeed = (w: number, h: number): number =>
    Math.max(w / layout2d.imageSize[0], h / layout2d.imageSize[1]) * app.renderer.resolution;
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
    heroSelection?.heroId ?? null,
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
    dismissBoot();
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
  let pauseMenu: import('./ui/runControls2d.ts').PauseMenu2D | null = null;
  let waveCard: import('./ui/wavePreview2d.ts').WaveCard2D | null = null;
  let livesWarn: import('./ui/lowLives2d.ts').LivesWarning | null = null;
  let diffBadge: import('./ui/difficulty2d.ts').DifficultyBadge2D | null = null;
  let foeCard: import('./ui/enemyCard2d.ts').EnemyCard2D | null = null;
  let coach: import('./ui/coach2d.ts').Coach2D | null = null;
  let gateRectsRef: (() => (import('./uiLayout.ts').Rect & { castle: boolean })[]) | null = null;
  let hudTipsFrame: (() => void) | null = null;
  let foesSeen: import('./ui/newFoes2d.ts').FoesSeen | null = null;
  let newFoeToast: import('./ui/newFoes2d.ts').NewFoeToast | null = null;
  let waveTypesOf: ((waveIndex: number) => import('../core/types.ts').EnemyType[]) | null = null;
  let lastWaveSeen = 0;
  let waveBanner: import('./ui/waveBanner2d.ts').WaveBanner2D | null = null;
  let laneMarks: import('./ui/laneMarks2d.ts').LaneMarks2D | null = null;
  let laneMod: typeof import('./ui/laneMarks2d.ts') | null = null;
  /** Foes per lane of the next wave, cached per wave index (Endless builds its waves). */
  let laneCache: { idx: number; counts: Map<number, number> } | null = null;
  let calloutFor: ((waveIndex: number) => import('./ui/waveBanner2d.ts').WaveCallout) | null = null;
  let coachPlot = -1;
  let settingsRef: Settings2D | null = null;
  let gameRef: Game2D | null = null;
  let codexWasPaused = false;
  let settingsWasPaused = false;
  let introWasPaused = false;
  let storyOpen = false;
  const routing = await import('./ui/inGame.ts');
  const baseHooks = hooks;
  // Shared settings as the game reads them (every frame / hit): cached, re-read when Settings
  // closes, on another tab's save / focus (capture, so before game2d's own refresh) and on a
  // graphics change. Reduced motion turns the screen shake off whatever the Shake toggle says.
  const readSettings = (): GameSettings => {
    const s = loadSettings();
    return gfx.reducedMotion ? { ...s, cameraShake: false } : s;
  };
  let liveSettings = readSettings();
  const refreshLiveSettings = (): void => {
    liveSettings = readSettings();
  };
  window.addEventListener('storage', refreshLiveSettings, { capture: true });
  window.addEventListener('focus', refreshLiveSettings, { capture: true });
  let abilities: AbilityBar2D | null = null;
  let heroHud: HeroHud2D | null = null;
  let padCursor: import('./ui/padCursor.ts').PadCursor | null = null;
  let replayBar: import('./ui/runControls2d.ts').ReplayBar2D | null = null;
  // Endless run left early (World Map / Restart): its best wave still goes on the board.
  const recordEndlessQuit = (): void => {
    const w = gameRef?.world;
    if (!plainPlay || !w || !run.runConfig.endless || w.outcome !== 'ongoing' || gameRef?.replaying) return;
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
  };
  // Difficulty (Easy / Normal / Hard): its patch is already in run.modifiers; the board and the HUD
  // badge show it. Endless runs are always Normal and show none; bench / debug scenes neither.
  const runDifficulty = !run.runConfig.endless && bench === 0 && !ab && !q.has('towers') && q.get('zoo') !== '1' && q.get('melee') !== '1' ? (run.runConfig.difficulty ?? 'normal') : undefined;
  hooks = {
    ...baseHooks,
    modifiers: run.modifiers,
    hero: heroSelection,
    startEndless: run.runConfig.endless,
    ...(runDifficulty ? { difficulty: runDifficulty } : {}),
    initialUnlockedTier: autoTier,
    getSettings: baseHooks.getSettings ?? (() => liveSettings),
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
      abilities?.setVisible(!shown && !storyOpen);
      heroHud?.setVisible(!shown && !storyOpen);
      replayBar?.setVisible(!shown && !!gameRef?.replaying);
      const w = gameRef?.world;
      // A replay's end shows the recorded run's own board again: nothing is recorded twice.
      if (!shown || !w || gameRef?.replaying) return;
      const won = w.outcome === 'won';
      let heroRecorded = false;
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
        const hr = result.hero;
        if (hr) {
          heroRecorded = true;
          const from = heroLevelProgress(hr.previousXp);
          const to = heroLevelProgress(hr.newXp);
          gameRef?.end.setHero({
            heroId: hr.heroId,
            name: heroName(hr.heroId),
            xpGained: hr.xpGained,
            fromFrac: from.fraction,
            toFrac: to.fraction,
            fromLevel: hr.previousLevel,
            toLevel: hr.newLevel,
            skillPoints: hr.skillPointsGained,
            recorded: true,
          });
        }
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
      if (!heroRecorded && w.hero) {
        // Not recorded (QA / debug scenes): the run's XP only.
        gameRef?.end.setHero({
          heroId: w.hero.heroId,
          name: heroName(w.hero.heroId),
          xpGained: w.heroSystem.runXp,
          fromFrac: 0,
          toFrac: 0,
          fromLevel: w.hero.level,
          toLevel: w.hero.level,
          skillPoints: 0,
          recorded: false,
        });
      }
      const story = q.get('story');
      if (won && (plainPlay || story === 'outro')) void routing.playStoryOnce(level, 'outro', art.manifest, art.baseUrl, story === 'outro');
    },
    onMenu: () => {
      recordEndlessQuit();
      navigateWithVeil(routing.worldMapHref());
    },
    onReplay: (on) => {
      document.documentElement.classList.toggle('pu-replaying', on);
      abilities?.aim(null);
      heroHud?.aim(null);
      replayBar?.setVisible(on && !gameRef?.end.visible);
    },
    get onNext() {
      const next = routing.nextIslandOpen(level.id, gameRef?.world.outcome === 'won');
      return next ? () => navigateWithVeil(routing.islandHref(next)) : undefined;
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
  dismissBoot();
  // Settings → Graphics: frame-rate cap, FPS chip, and live re-apply while a run is open.
  const { mountFpsCounter } = await import('./ui/fpsCounter.ts');
  const fpsChip = mountFpsCounter();
  fpsChip.setVisible(gfx.showFps);
  app.ticker.maxFPS = tickerMaxFps(engine.maxFps);
  window.addEventListener(GRAPHICS_EVENT, () => {
    gfx = loadGraphics();
    engine = applyGraphics(gfx, loadSettings().quality, desktop);
    app.ticker.maxFPS = tickerMaxFps(engine.maxFps);
    fpsChip.setVisible(gfx.showFps);
    refreshLiveSettings();
  });
  if (bench === 0) {
    // Global abilities (Meteor Strike, Overcharge): painted bar + aiming + FX (ui/abilityBar2d.ts).
    const { mountAbilityBar2D, abilityArtFiles } = await import('./ui/abilityBar2d.ts');
    // The hero's portrait + skill buttons sit in front of the abilities as one bar (ui/heroHud2d.ts).
    const [{ createHeroHud2D }, { heroArtFiles }] = await Promise.all([import('./ui/heroHud2d.ts'), import('./ui/heroBits.ts')]);
    heroHud = createHeroHud2D(game, { desktop, files: heroArtFiles(), onAimStart: () => abilities?.aim(null) });
    abilities = mountAbilityBar2D(game, {
      desktop,
      art: abilityArtFiles(art.baseUrl),
      baseUrl: art.baseUrl,
      ...(heroHud ? { lead: { el: heroHud.el }, onAimStart: () => heroHud?.aim(null) } : {}),
    });
    if (q.get('herosel') === '1') game.setHeroSelected(true);
    // Keyboard arrows / gamepad: the in-run reticle (a virtual mouse on the canvas).
    const { mountPadCursor } = await import('./ui/padCursor.ts');
    padCursor = mountPadCursor({
      canvas: app.canvas,
      targets: () => game.padTargets(),
      aiming: () => !!abilities?.aiming || !!heroHud?.aiming,
      heroSpot: () => game.heroScreen(),
      paused: () => game.stepper.paused,
      clickPoint: (x, y) => game.padClickPoint(x, y),
    });
  }
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
          refreshLiveSettings();
          game.refreshSettings();
        }
      },
      () => undefined,
    );
    settingsRef = settings;
    const { mountPauseMenu, mountReplayBar, confirmBoard } = await import('./ui/runControls2d.ts');
    let asking = false;
    const ask = async (kind: 'restart' | 'leave'): Promise<boolean> => {
      if (asking) return false;
      asking = true;
      const endless = run.runConfig.endless;
      const ok = await confirmBoard(
        kind === 'restart'
          ? { title: t('confirm.restartTitle'), body: t('confirm.restartBody'), yes: t('confirm.restartYes'), no: t('confirm.cancel'), testid: 'confirm-restart' }
          : { title: t('confirm.leaveTitle'), body: t(endless ? 'confirm.leaveBodyEndless' : 'confirm.leaveBody'), yes: t('confirm.leaveYes'), no: t('confirm.cancel'), testid: 'confirm-leave' },
      );
      asking = false;
      return ok;
    };
    pauseMenu = mountPauseMenu({
      resume: () => {
        game.stepper.paused = false;
      },
      restart: () => {
        void ask('restart').then((ok) => {
          if (!ok) return;
          recordEndlessQuit();
          game.newRun();
        });
      },
      settings: () => settings.open(),
      map: () => {
        void ask('leave').then((ok) => {
          if (ok) hooks.onMenu?.();
        });
      },
    });
    replayBar = mountReplayBar(
      {
        togglePause: () => {
          game.stepper.paused = !game.stepper.paused;
        },
        setSpeed: (sp) => game.setReplaySpeed(sp),
        exit: () => game.exitReplay(),
      },
      REPLAY_SPEEDS,
      desktop,
    );
    const { mountWaveCard } = await import('./ui/wavePreview2d.ts');
    // The painted caves / castle on screen (their fronts, grown a little; `castle` = the goal).
    const gateRects = (): (import('./uiLayout.ts').Rect & { castle: boolean })[] => {
      const f = game.map.fit;
      return gateKeepOutsPx(level.layout2d?.gates ?? []).map((g) => ({ x: f.offsetX + g.x * f.scale, y: f.offsetY + g.y * f.scale, w: g.w * f.scale, h: g.h * f.scale, castle: g.castle }));
    };
    gateRectsRef = gateRects;
    const { codexEnemyUrl } = await import('./codex2d.ts');
    livesWarn = (await import('./ui/lowLives2d.ts')).mountLivesWarning();
    if (desktop) {
      // Hover tooltips for the canvas HUD buttons (horn, pause, speed).
      const tips = (await import('./ui/hudTips2d.ts')).mountHudTips();
      let over: import('./ui/hudTips2d.ts').HudTipFor | null = null;
      app.canvas.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        const r = app.canvas.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        const h = game.hud.hit(x, y);
        over = h;
        if (h) app.canvas.style.cursor = 'pointer';
        else {
          // The plaque: hearts on its left half, gold on the right.
          const p = game.hud.rects().plaque;
          if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) over = x < p.x + p.w / 2 ? 'lives' : 'gold';
        }
      });
      app.canvas.addEventListener('pointerleave', () => {
        over = null;
      });
      hudTipsFrame = () => {
        const show = over && !game.end.visible && !anySheetOpen() && !storyOpen ? over : null;
        const s = game.debugHud();
        if (!show) {
          tips.update(null, { paused: s.paused, speed: s.speed, canCall: s.canCall, earlyBonus: s.earlyBonus, first: false }, null);
          return;
        }
        const b = game.hud.buttonPositions;
        const hr = game.hud.rects();
        const pl = hr.plaque;
        const at =
          show === 'horn'
            ? { ...game.hud.hornPosition, r: game.hud.hornRadius }
            : show === 'pause'
              ? { ...b.pause, r: hr.pause.w / 2 }
              : show === 'speed'
                ? { ...b.speed, r: hr.speed.w / 2 }
                : { x: pl.x + (show === 'lives' ? pl.w * 0.25 : pl.w * 0.75), y: pl.y + pl.h / 2, r: pl.h / 2 };
        tips.update(show, { paused: s.paused, speed: s.speed, canCall: s.canCall, earlyBonus: s.earlyBonus, first: game.world.waveSystem.state === 'preFirstWave' }, at);
      };
    }
    foeCard = (await import('./ui/enemyCard2d.ts')).mountEnemyCard((type) => codexEnemyUrl(art, type));
    // First-play tips on the first island (plain play), or forced with ?coach=1 (QA).
    const coachMod = await import('./ui/coach2d.ts');
    if ((level.id === 'l1c' && plainPlay && !coachMod.coachDone()) || q.get('coach') === '1') {
      const hero = game.world.hero;
      // The caves / castle: the card keeps off them when it has to leave its home spot.
      coach = coachMod.mountCoach(!desktop || isTouchDevice(), hero ? heroName(hero.heroId).split(' ')[0] : '', gateRects);
      // Suggested first plot: the one with the most road within reach of an archer.
      const lay = level.layout2d!;
      let best = -1;
      lay.plots.forEach((p, i) => {
        let n = 0;
        for (const path of lay.paths) for (const r of path) if (Math.hypot(r.x - p.x, r.z - p.z) < 4.5) n++;
        if (best === -1 || n > best) {
          best = n;
          coachPlot = i;
        }
      });
    }
    const nf = await import('./ui/newFoes2d.ts');
    const { LEVELS_2D } = await import('../data/levels2d/index.ts');
    foesSeen = new nf.FoesSeen(nf.seenFromCleared(LEVELS_2D, (i) => (progress2d.bestStars[i] ?? 0) > 0));
    const seenRef = foesSeen;
    newFoeToast = nf.mountNewFoeToast((type) => codexEnemyUrl(art, type));
    laneMod = await import('./ui/laneMarks2d.ts');
    laneMarks = laneMod.mountLaneMarks();
    const wb = await import('./ui/waveBanner2d.ts');
    waveBanner = wb.mountWaveBanner();
    if (runDifficulty) diffBadge = (await import('./ui/difficulty2d.ts')).mountDifficultyBadge(runDifficulty);
    calloutFor = (i) => wb.waveCallout(nf.waveTypes(game.world.level, i), i, game.world.level.waves.length, game.world.waveSystem.isEndless);
    waveTypesOf = (i) => nf.waveTypes(game.world.level, i);
    // In the dock's info slot (top-left, hudDock.ts), like the foe card.
    waveCard = mountWaveCard((type) => codexEnemyUrl(art, type), (type) => !seenRef.has(type));
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
      abilities?.setVisible(false);
      heroHud?.setVisible(false);
      storyOpen = true;
      void routing.playStoryOnce(level, 'intro', art.manifest, art.baseUrl, storyQ === 'intro').then(() => {
        storyOpen = false;
        g.stepper.paused = introWasPaused;
        if (!g.end.visible) {
          codex.setButtonVisible(true);
          settings.setButtonVisible(true);
          abilities?.setVisible(true);
          heroHud?.setVisible(true);
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
  let fpsShownAt = 0;
  app.ticker.add((t) => {
    if (draws) lastDraws = draws.take();
    const t0 = performance.now();
    stats.record(t.deltaMS, t0);
    if (!manual) game.frame(t.deltaMS / 1000);
    abilities?.frame(t.deltaMS / 1000);
    heroHud?.frame(t.deltaMS / 1000);
    if (fpsChip.visible && t0 - fpsShownAt > 500) {
      fpsShownAt = t0;
      fpsChip.show(stats.snapshot(t0).fps);
    }
    pauseMenu?.setPlate(storyOpen || anySheetOpen() || game.replaying ? null : game.hud.pausePlate);
    if (foeCard) {
      const foe = game.inspectedEnemy;
      const showFoe = game.inspecting && !game.end.visible && !anySheetOpen();
      // Docked in the info slot (it takes it over from the next-wave card while it is open).
      const dk = game.dock;
      foeCard.update(showFoe ? foe : null, showFoe, dk.info, dk.info.w, false);
      if (game.inspecting && !foe && !foeCard.debug().shown) game.clearInspect();
    }
    if (coach && coach.step !== 'done') {
      const w = game.world;
      let cheapest = Infinity;
      let maxTier = 0;
      for (const tw of w.towers) {
        maxTier = Math.max(maxTier, tw.tier);
        if (tw.tier < 3) cheapest = Math.min(cheapest, getTowerTierStats(tw.type, (tw.tier + 1) as 2 | 3).upgradeCost);
      }
      const meteor = game.getAbilityState('meteor');
      const obs = {
        towers: w.towers.length,
        maxTier,
        waves: w.waveSystem.state === 'preFirstWave' ? 0 : w.waveSystem.currentWaveOneBased,
        buildRingOpen: game.buildRingOpen,
        gold: w.gold,
        cheapestUpgrade: cheapest,
        hasHero: !!w.hero,
        heroMoves: game.commandsDone('heroMove'),
        meteorReady: meteor.usable,
        meteors: game.commandsDone('meteor'),
      };
      // A bar button: from above, or from the side when the bar is an edge column.
      const rectTop = (sel: string): { x: number; y: number; dir?: 'left' | 'right' } | null => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        if (r.width <= 0) return null;
        if (e.closest('.edge')) {
          const leftEdge = r.left + r.width / 2 < app.screen.width / 2;
          return leftEdge ? { x: r.right, y: r.top + r.height / 2, dir: 'left' } : { x: r.left, y: r.top + r.height / 2, dir: 'right' };
        }
        return { x: r.left + r.width / 2, y: r.top };
      };
      const step = coach.step;
      let target: { x: number; y: number } | null = null;
      if (step === 'build' && coachPlot >= 0) target = game.plotScreen(coachPlot);
      else if (step === 'wave') target = { x: game.hud.hornPosition.x, y: game.hud.hornPosition.y - game.hud.hornRadius };
      else if (step === 'upgrade' && w.towers[0] && !game.ringOpen) {
        const p = game.plotScreen(w.towers[0].col);
        target = { x: p.x, y: p.y - 40 };
      } else if (step === 'hero' && !game.heroSelected) {
        // The hero's head (its HP bar; scales with the map: phones draw the hero smaller). The
        // arrow's tip already floats a little above its target.
        target = game.heroHeadScreen();
      } else if (step === 'meteor') target = rectTop('[data-testid="ab2d-meteor"]');
      // Hidden under the pause menu too (the card and its arrow cluttered it on phones).
      coach.update(obs, target, game.end.visible || storyOpen || anySheetOpen() || game.replaying || game.stepper.paused);
    }
    hudTipsFrame?.();
    if (foesSeen && newFoeToast && waveTypesOf) {
      // A wave just marched: its never-seen foes get the toast (live play only), then count as seen.
      const ws = game.world.waveSystem;
      const n = ws.state === 'preFirstWave' ? 0 : ws.currentWaveOneBased;
      if (n < lastWaveSeen) lastWaveSeen = 0;
      if (n > lastWaveSeen) {
        for (let w = lastWaveSeen; w < n; w++) {
          if (game.replaying) continue;
          const fresh = foesSeen.mark(waveTypesOf(w));
          if (fresh.length > 0 && !coach?.debug().shown) newFoeToast.show(fresh);
        }
        // The newest wave that marched: a boss or the final wave gets the big call-out.
        if (calloutFor && !game.end.visible) waveBanner?.show(calloutFor(n - 1));
        lastWaveSeen = n;
      }
      // In the dock's info slot: a tapped foe's card has it first, the next-wave card waits for it.
      const dk = game.dock;
      const unit = uiUnit(app.screen.width, app.screen.height);
      newFoeToast.update(t.deltaMS / 1000, game.end.visible || anySheetOpen() || storyOpen || !!foeCard?.debug().shown, dk.info, Math.min(dk.info.w, unit * 30));
    }
    livesWarn?.update(game.world.lives, game.world.startingLives, !game.end.visible && !storyOpen && game.world.outcome === 'ongoing');
    diffBadge?.update(game.hud.rects().banner, !game.end.visible && !storyOpen && !anySheetOpen());
    if (waveCard) {
      const w = game.world;
      const ws = w.waveSystem;
      const calm = ws.state === 'preFirstWave' || ws.state === 'betweenWaves' || game.stepper.paused;
      const hud = game.debugHud();
      const visible = calm && !storyOpen && !anySheetOpen() && !game.end.visible && !game.ringOpen && w.outcome === 'ongoing' && ws.canStartNextWave() && !foeCard?.debug().shown && !newFoeToast?.debug().visible;
      const pv = visible ? ws.getNextWavePreview() : null;
      // Multi-cave islands: which caves the next wave marches out of (with the card).
      const lay = w.level.layout2d;
      if (laneMarks && laneMod) {
        let marks: import('./ui/laneMarks2d.ts').LaneMark[] | null = null;
        if (pv && lay && lay.paths.length > 1) {
          const idx = pv.waveOneBased - 1;
          if (laneCache?.idx !== idx) {
            const def = idx < w.level.waves.length ? w.level.waves[idx] : ws.isEndless ? buildEndlessWaveDef(idx, w.level) : null;
            laneCache = { idx, counts: def ? laneMod.waveLaneCounts(def.groups) : new Map() };
          }
          marks = [];
          // Keep off the card (last frame's spot), the horn and the HUD pieces.
          const card = waveCard.box();
          const hr = game.hud.rects();
          const avoid = [...(card ? [card] : []), hr.hornBox, hr.plaque, hr.banner, hudButtonsKeepOut(app.screen.width, app.screen.height, readSafeInsets()), ...hudKeepOuts()];
          const toScreen = (p: { x: number; z: number }): { x: number; y: number } => ({ x: game.map.screenX(game.map.pxX(p.x)), y: game.map.screenY(game.map.pxY(p.z)) });
          const unit = laneMod.kitUnit(app.screen.width, app.screen.height);
          for (const [lane, count] of laneCache.counts) {
            const at = laneMod.laneMarkSpot(lay.paths[lane] ?? [], toScreen, avoid, unit);
            if (at) marks.push({ lane, count, ...at });
          }
        }
        laneMarks.update(marks);
      }
      waveCard.update({
        visible,
        preview: pv,
        countdown: hud.countdown,
        earlyBonus: hud.earlyBonus,
        first: ws.state === 'preFirstWave',
        slot: game.dock.info,
        maxW: uiUnit(app.screen.width, app.screen.height) * 30,
      });
    }
    if (game.replaying && !game.end.visible) {
      replayBar?.update({ paused: game.stepper.paused, speed: game.stepper.speed, progress: game.replayProgress, wave: game.hud.waveLabel });
    }
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
    abilities: () => abilities?.debug() ?? null,
    pad: () => padCursor?.state() ?? null,
    padClick: () => padCursor?.click(),
    waveCard: () => waveCard?.debug() ?? null,
    hudCheck: () => hudCheck(game),
    textAudit: () => auditCanvasTexts([...game.hud.qaTexts(), ...game.end.qaTexts(), ...game.ring.qaTexts()], app.screen.width, app.screen.height),
    mapFrame: () => game.map.frameInfo(),
    gates: () => gateRectsRef?.() ?? [],
    lives: () => livesWarn?.debug() ?? null,
    foe: () => foeCard?.debug() ?? null,
    coach: () => coach?.debug() ?? null,
    goldPops: () => ({ active: game.goldPops.active, spawned: game.goldPops.spawned }),
    newFoe: () => newFoeToast?.debug() ?? null,
    callout: () => waveBanner?.debug() ?? null,
    diffBadge: () => diffBadge?.debug() ?? null,
    endDiff: () => game.end.difficultyTag,
    laneMarks: () => laneMarks?.debug() ?? null,
    calloutAgain: () => waveBanner?.again(),
    foeAt: () => {
      const pool = game.world.enemyPool;
      for (let i = 0; i < pool.getActiveCount(); i++) {
        const e = pool.items[pool.getActiveIndex(i)];
        if (e.active && e.hp > 0 && !e.burrowed) return game.enemyScreen(e);
      }
      return null;
    },
    aimAbility: (id) => abilities?.aim(id),
    freeze: (on) => (on ? app.ticker.stop() : app.ticker.start()),
    replay: {
      start: () => game.startReplay(),
      exit: () => game.exitReplay(),
      speed: (sp) => game.setReplaySpeed(sp),
      restart: () => game.newRun(),
      cmd: (c) => game.command(c),
      step: (frames) => {
        for (let i = 0; i < frames; i++) game.frame(0.1);
        app.render();
      },
      probe: (fn) => {
        game.tickProbe = fn;
      },
    },
    hero: {
      state: () => ({ hud: heroHud?.debug() ?? null, view: game.heroes.debug(), sim: game.getHeroState(), selected: game.heroSelected }),
      select: (on) => game.setHeroSelected(on),
      move: (x, z) => game.commandHeroMove(x, z),
      aim: (slot) => heroHud?.aim(slot),
      cast: (slot, x, z) => (x === undefined || z === undefined ? game.castHeroSkill(slot) : game.castHeroSkill(slot, x, z)),
      kill: () => {
        // QA only: fell the hero now (the sim's own death path needs an enemy blow).
        const h = game.world.hero;
        if (!h || h.state === 'dead') return;
        h.hp = 0;
        h.state = 'dead';
        h.respawnTimer = h.stats.respawnSec;
        h.waypoints.length = 0;
        game.events.emit('heroDied', { heroId: h.heroId, x: h.x, z: h.z, respawnSec: h.stats.respawnSec });
      },
      toScreen: (x, z) => ({ x: game.map.screenX(game.map.pxX(x)), y: game.map.screenY(game.map.pxY(z)) }),
      tap: (x, y) => game.tap(x, y),
      nearestEnemy: () => {
        const h = game.world.hero;
        const pool = game.world.enemyPool;
        let best: { x: number; z: number } | null = null;
        let bd = Infinity;
        for (let i = 0; i < pool.getActiveCount(); i++) {
          const e = pool.items[pool.getActiveIndex(i)];
          if (!e.active || e.hp <= 0) continue;
          const d = h ? (e.x - h.x) ** 2 + (e.z - h.z) ** 2 : 0;
          if (d < bd) {
            bd = d;
            best = { x: e.x, z: e.z };
          }
        }
        return best;
      },
    },
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
