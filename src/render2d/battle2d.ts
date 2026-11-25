import { warmTextureSources } from './textureWarmup.ts';
import { bootPhase, reportBoot } from './bootTrace.ts';
import { runItemBelt2D, spendItem2D } from './ui/market2d.ts';
import '@fontsource-variable/fredoka';
import './ui/fredokaTr.css';
import { Application, UPDATE_PRIORITY } from 'pixi.js';
import { getLevelById, LEVELS_2D } from '../data/levels2d/index.ts';
import { buildEndlessWaveDef } from '../sim/waveSystem.ts';
import { AbScene } from './abScene.ts';
import { artCheckSummary, mountArtCheck } from './artCheck.ts';
import { changeMapVariant, loadArt } from './assets2d.ts';
import { autoplayHooks, benchHooks } from './benchScene.ts';
import { codexEnemyUrl, mountCodex2D } from './codex2d.ts';
import { specPortraitUrl } from './specArt.ts';
import { t } from '../i18n/index.ts';
import { heroName, islandName, islandWaveTitle } from '../i18n/data.ts';
import { AimOverlay, aimHooks, meleeHooks, towersHooks, zooHooks, ZooLabels, type AimSceneState, type MeleeSceneState } from './debugScenes.ts';
import { ENEMY_DEFS, ENEMY_TYPES } from '../data/enemies.ts';
import { getTowerTierStats } from '../data/towers.ts';
import type { EnemyType } from '../core/types.ts';
import { enemyArtKeys, runEnemyTypes } from './enemyArtSet.ts';
import { FrameStats } from './frameStats.ts';
import { gpuTextureStats } from './gpuStats.ts';
import { releaseOnPageCache } from './pageCache.ts';
import { Game2D, REPLAY_SPEEDS, type Game2DHooks } from './game2d.ts';
import { heroLevelProgress, resolveHeroForRun } from './heroes2d.ts';
import type { HeroHud2D } from './ui/heroHud2d.ts';
import type { HeroSkillSlot } from '../core/types.ts';
import type { RunCommand } from './ui/replay2d.ts';
import {
  detectSoftwareWebGL,
  isDesktopClient,
  MOBILE_SETTLE_GRACE_MS,
  qualityOverride,
  renderResolution,
  type QualityTier,
} from './renderResolution.ts';
import { setFxPrefs } from './fxLayer.ts';
import type { GameSettings } from '../core/types.ts';
import { isTouchDevice, loadSettings } from '../platform/storage.ts';
import { GRAPHICS_EVENT, loadGraphics, type GraphicsEngineState, type GraphicsSettings } from './ui/graphicsSettings.ts';
import { applyPageGraphics, showError } from './bootShared2d.ts';
import type { AbilityBar2D } from './ui/abilityBar2d.ts';
import type { AbilityId } from '../core/types.ts';
import { mapAnimLayer } from './mapAnimLayer.ts';
import { mapLifeLayer } from './mapLifeLayer.ts';
import { loadIslandTables } from './islandTable.ts';
import type { MapView } from './mapView.ts';
import type { GateLayer } from './gateLayer.ts';
import { MASTER_SCALE, maxMapScale, pickMapVariant } from './mapVariant.ts';
import { mountSettings2D, type Settings2D } from './settingsButton2d.ts';
import { hudKeepOuts, hudKeepOutsVersion, invalidateSafeInsets, readSafeInsets } from './uiKit.ts';
import { gateKeepOutsPx, hudButtonsKeepOut } from './uiLayout.ts';
import { uiUnit } from './hudDock.ts';
import { hudCheck } from './hudCheck.ts';
import { auditCanvasTexts } from './qaText.ts';
import { anySheetOpen } from './ui/dom.ts';
import { isDesktopShell, setPresence } from '../platform/desktopShell.ts';
import { mountFpsCounter } from './ui/fpsCounter.ts';
import { islandMapUrl } from './ui/islandArt.ts';
import { dismissBoot, setBootArtwork, setBootProgress, navigateWithVeil, pickLoadTip, setBootText, setBootTip } from './ui/transition2d.ts';

/**
 * The battle half of 2d.html (every `?level=` / debug scene; the URL parameters are listed in
 * main2d.ts). Loaded on demand by the entry, so the title screen and world map never fetch Pixi,
 * the sim or the battle layers (docs/handoff-perf.md).
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
      textureWarmup?: ReturnType<typeof warmTextureSources>;
      plotScreen?: (i: number) => { x: number; y: number };
      forceEnd?: (o: 'won' | 'lost') => void;
      /** QA: jump to a one-based wave (Endless records / end-panel shots). */
      skipToWave?: (n: number) => boolean;
      hudWave?: () => string;
      /** QA: GPU texture residency (count, MB, biggest uploads) and the canvas size (gpuStats.ts). */
      gpu?: (topN?: number) => import('./gpuStats.ts').GpuTextureStats;
      /** QA: leave to the world map the way the end board's Menu does (navigateWithVeil). */
      menu?: () => void;
      setGold?: (g: number) => void;
      setLives?: (n: number) => void;
      artcheck?: () => ReturnType<typeof artCheckSummary>;
      /** QA: the ability bar (state, boxes, FX counters) and aiming as a button press would. */
      abilities?: () => Record<string, unknown> | null;
      /** QA: the item belt (slots, states, aim, FX counters); `itemPress` presses a slot (null cancels). */
      items?: () => Record<string, unknown> | null;
      endCrystals?: () => number;
      /** QA: puts a mode note (challenge / Daily / Endless result) on the open end board. */
      endAnnotate?: (note: import('./ui/modeBits.ts').EndModeNote) => void;
      itemPress?: (id: import('../data/market.ts').ItemId | null) => void;
      /** QA: aim the held item at a screen point and cast there (as a tap would). */
      itemCastAt?: (x: number, y: number) => boolean;
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
      /** QA: procedural ambient FX state and deterministic step helper. */
      ambient?: () => ReturnType<import('./mapAnimLayer.ts').MapAnimController['debug']>;
      stepAmbient?: (dtSec: number) => void;
      /** QA: procedural map-life layer state and deterministic step helper. */
      mapLife?: () => ReturnType<import('./mapLifeLayer.ts').MapLifeController['debug']> | null;
      stepMapLife?: (dtSec: number) => void;
      /** QA: map life's surface pass on the full quad instead of its mask cells (same pixels). */
      mapLifeFullQuad?: (on: boolean) => void;
      /** QA: the caves / castle fronts on screen (`castle` = the goal). */
      gates?: () => { x: number; y: number; w: number; h: number; castle: boolean }[];
      lives?: () => Record<string, unknown> | null;
      /** QA: the foe info card, and the screen point of a live foe to tap. */
      foe?: () => Record<string, unknown> | null;
      coach?: () => Record<string, unknown> | null;
      /** QA: tier-IV specializations (comparison card open, the tier-III tip, flourishes, towers). */
      spec?: () => Record<string, unknown>;
      towerTop?: (id: number) => { x: number; y: number } | null;
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

/** Settings → Graphics: the page half (bootShared2d.ts) plus the battle's effects density. */
function applyGraphics(g: GraphicsSettings, quality: GameSettings['quality'], desktop: boolean): GraphicsEngineState {
  const engine = applyPageGraphics(g, quality, desktop);
  setFxPrefs(engine.fx);
  return engine;
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

/** What the entry (main2d.ts) hands over: the boot it already did before the battle loaded. */
export interface BattleBoot {
  readonly fontsReady: Promise<unknown>;
  readonly desktop: boolean;
  readonly gfx: GraphicsSettings;
  readonly engine: GraphicsEngineState;
}

/** Runs a battle (or debug scene) for the query `q`; main2d.ts calls this after its own boot. */
export async function runBattle2D(q: URLSearchParams, boot: BattleBoot): Promise<void> {
  const { fontsReady, desktop } = boot;
  let gfx = boot.gfx;
  let engine = boot.engine;
  setFxPrefs(engine.fx);
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
  bootPhase('resolve-run');
  const softwareWebGL = detectSoftwareWebGL();
  const startWave = Number(q.get('wave') ?? 0) || 0;
  // `?quality=` wins over the player's Quality preset (Settings → Graphics), which wins over Auto.
  const autoTier: QualityTier = explicitQuality ?? ((bench > 0 || startWave > 1) && softwareWebGL ? 'low' : 'high');
  const bootTier: QualityTier = explicitQuality ?? engine.prefs.lock ?? autoTier;
  // Desktops always start (and stay) at full canvas resolution; the tier only trims effects there.
  const bootResolutionTier: QualityTier = desktop && !explicitQuality ? 'high' : bootTier;
  const app = new Application();
  bootPhase('renderer-settings');
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

  bootPhase('renderer-initialized');
  setBootProgress(0.1);
  const layout2d = level.layout2d;
  // Device px per layout px at a screen size: picks the map bake (resolution variant) to load. The
  // map covers the screen (fullBleed.ts; it only ever shrinks from this).
  const mapNeed = (w: number, h: number): number =>
    Math.max(w / layout2d.imageSize[0], h / layout2d.imageSize[1]) * app.renderer.resolution;
  const textureLimit = gl ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) : 4096;
  const maxScale = maxMapScale(isDesktopClient(q), textureLimit, layout2d.imageSize);
  const fronts = ab ? [] : layout2d.gates?.flatMap((gate) => gate.front ? [gate.front.art] : []) ?? [];
  const mapMips = q.get('mapmips') === '1';
  // A story run loads only the foes its waves can put on the map (enemyArtSet.ts); Endless and
  // the showcase / QA scenes that walk any foe keep every enemy sheet.
  const allEnemyArt = run.runConfig.endless || ab || bench > 0 || q.get('zoo') === '1' || q.get('melee') === '1' || q.has('towers') || q.get('artcheck') === '1';
  const [art, hud] = await Promise.all([
    loadArt(
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
      manifest => setBootArtwork(islandMapUrl(manifest, level)),
      fraction => setBootProgress(0.1 + 0.7 * fraction),
      allEnemyArt ? null : (manifest) => enemyArtKeys(manifest, runEnemyTypes(level)),
    ),
    !ab && bench === 0 ? import('./ui/battleHud.ts') : null,
    fontsReady,
    // This island's ambient / map-life tables (one small lazy chunk each; islandTable.ts).
    loadIslandTables(level.id),
  ]);
  bootPhase('art-ready');
  if (art.notes.length > 0) console.info('[art2d] fallbacks:\n  ' + art.notes.join('\n  '));
  if (q.get('artcheck') === '1') mountArtCheck(art);

  // Subscribe after the master has painted. Serialize loads and recheck the fit before applying
  // them, since resizing / adaptive resolution can change the desired bake while it downloads.
  function watchMap(map: MapView, gates?: GateLayer, onSwap?: () => void): void {
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
            onSwap?.();
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
    setBootProgress(1);
    dismissBoot();
    app.ticker.start();
    window.__p0 = { mode: 'ab', state: () => scene.debugState() };
    bootPhase('interactive');
    reportBoot();
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
  else if (q.get('zoo') === '1') {
    const only = (q.get('types') ?? '')
      .split(',')
      .filter((t): t is EnemyType => (ENEMY_TYPES as readonly string[]).includes(t));
    hooks = zooHooks(only.length > 0 ? only : undefined);
  }
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
  /** Foes per entrance of the next wave, cached per level / endless / wave index (Endless builds its waves). */
  let laneCache: { key: string; entries: readonly import('./lanePath.ts').EntranceCount[] } | null = null;
  /** Cached marker screen placements (skipping DOM measuring & path search until wave, camera, viewport or HUD geometry changes). */
  let lanePlaceCache: { key: string; marks: import('./ui/laneMarks2d.ts').LaneMark[] } | null = null;
  let hudLayoutGen = 0;
  let calloutFor: ((waveIndex: number) => import('./ui/waveBanner2d.ts').WaveCallout) | null = null;
  let coachPlot = -1;
  let settingsRef: Settings2D | null = null;
  let gameRef: Game2D | null = null;
  let codexWasPaused = false;
  // The optional comparison card: pauses while open, always gives the pause back (specCardGate.ts).
  let specGate: import('./ui/specCardGate.ts').SpecCardGate | null = null;
  let specHint: import('./ui/specHint2d.ts').SpecHint2D | null = null;
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
    hudLayoutGen++;
  };
  window.addEventListener('storage', refreshLiveSettings, { capture: true });
  window.addEventListener('focus', refreshLiveSettings, { capture: true });
  let abilities: AbilityBar2D | null = null;
  let heroHud: HeroHud2D | null = null;
  let itemBelt: import('./ui/itemBelt2d.ts').ItemBelt2D | null = null;
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
      livesRemaining: Math.max(0, w.lives - w.itemSystem.restoredLives),
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
    ...(plainPlay ? { itemBelt: () => runItemBelt2D(runDifficulty ?? 'normal', run.modifiers.itemsDisabled), spendItem: spendItem2D } : {}),
    hero: heroSelection,
    ...(heroSelection && plainPlay ? { refreshHero: () => resolveHeroForRun(loadProgress2D(), q.get('hero'), q.get('herolevel')) } : {}),
    startEndless: run.runConfig.endless,
    ...(runDifficulty ? { difficulty: runDifficulty } : {}),
    initialUnlockedTier: autoTier,
    getSettings: baseHooks.getSettings ?? (() => liveSettings),
    onBackgroundChange: (inBackground) => {
      if (inBackground) {
        // Keep the run paused on resume even if Codex or the intro story was open when backgrounded.
        codexWasPaused = true;
        specGate?.keepPausedOnClose();
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
      itemBelt?.setVisible(!shown && !storyOpen);
      replayBar?.setVisible(!shown && !!gameRef?.replaying);
      const w = gameRef?.world;
      // A replay's end shows the recorded run's own board again: nothing is recorded twice.
      if (!shown || !w || gameRef?.replaying) return;
      const won = w.outcome === 'won';
      let heroRecorded = false;
      // This win completed the campaign (the last chapter's finale, first win): the ending follows.
      let endingDue = false;
      if (plainPlay) {
        const masteredBefore = routing.isMastered(level.id);
        const progressBefore = loadProgress2D();
        const result = routing.recordRunOutcome({
          levelId: level.id,
          won,
          stars: won ? w.computeStars() : 0,
          livesRemaining: Math.max(0, w.lives - w.itemSystem.restoredLives),
          waveReached: w.waveSystem.currentWaveOneBased,
          runConfig: run.runConfig,
          heroId: w.hero?.heroId ?? null,
          enemiesKilled: w.enemiesKilledTotal,
          wavesCleared: won ? level.waves.length : Math.max(0, w.waveSystem.currentWaveOneBased - 1),
          heroXpEarned: w.heroSystem.runXp,
        });
        endingDue = result.campaignComplete === true;
        // Feats this run completed: cards over the board (the Logbook lists them all).
        void import('./ui/featToast2d.ts').then((m) => m.showNewFeats(progressBefore, loadProgress2D(), LEVELS_2D));
        // Sky Crystals the win paid (Market): "+n" with the crystal on the board.
        if (won) gameRef?.end.setCrystals(result.crystalsEarned ?? 0);
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
      // QA (`?end=won&crystals=42`): the board's crystal line without recording a run.
      if (!plainPlay && won && q.has('crystals')) gameRef?.end.setCrystals(Number(q.get('crystals')) || 0);
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
      const outro = won && (plainPlay || story === 'outro') ? routing.playStoryOnce(level, 'outro', art.manifest, art.baseUrl, story === 'outro') : Promise.resolve(false);
      // `?end=won&story=ending` (QA): the ending over the board without recording a run.
      if (won && (endingDue || story === 'ending')) void outro.then((shown) => routing.playEndingAfterWin(art.manifest, art.baseUrl, shown));
    },
    onMenu: () => {
      recordEndlessQuit();
      navigateWithVeil(routing.worldMapHref());
    },
    onReplay: (on) => {
      document.documentElement.classList.toggle('pu-replaying', on);
      abilities?.aim(null);
      heroHud?.aim(null);
      itemBelt?.press(null);
      replayBar?.setVisible(on && !gameRef?.end.visible);
    },
    get onNext() {
      const next = routing.nextIslandOpen(level.id, gameRef?.world.outcome === 'won');
      return next ? () => navigateWithVeil(routing.islandHref(next)) : undefined;
    },
  };
  bootPhase('game-hooks');
  const game = new Game2D(app, art, level, hooks);
  gameRef = game;
  setPresence('battle', islandName(level));
  if (run.runConfig.endless) game.hud.setEndless(level.waves.length);
  if (q.get('end') === 'won' || q.get('end') === 'lost') {
    const end = q.get('end') as 'won' | 'lost';
    setTimeout(() => game.forceEnd(end), 300);
  }
  game.attachInput(app.canvas);
  const startSpeed = Number(q.get('speed'));
  if (startSpeed === 2 || startSpeed === 3 || startSpeed === 4) game.stepper.speed = startSpeed;
  let syncHudDom: (() => void) | null = null;
  const onResize = (): void => {
    invalidateSafeInsets();
    hudLayoutGen++;
    game.resize(app.screen.width, app.screen.height);
    syncHudDom?.();
    requestAnimationFrame(() => {
      hudLayoutGen++;
    });
  };
  app.renderer.on('resize', onResize);
  game.resize(app.screen.width, app.screen.height);
  bootPhase('construct-and-resize');
  game.prewarm({ benchSteps: bench > 0 ? Math.ceil(bench / 10) + 2 : 0 });
  bootPhase('calibrate-resolution');
  setBootProgress(0.95);
  const onUploadGrace = (): void => game.notifyQualityGrace(MOBILE_SETTLE_GRACE_MS);
  watchMap(game.map, game.gates, onUploadGrace);
  const ambient = mapAnimLayer(game.map.world, level.id, art.baseUrl, onUploadGrace);
  const life = mapLifeLayer(game.map.world, game.map, game.layers, level.id, art.baseUrl);
  draws?.take();
  // Settings → Graphics: frame-rate cap, FPS chip, and live re-apply while a run is open.
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
  if (hud) {
    // Global abilities (Meteor Strike, Overcharge): painted bar + aiming + FX (ui/abilityBar2d.ts).
    // The hero's portrait + skill buttons sit in front of the abilities as one bar (ui/heroHud2d.ts).
    heroHud = hud.createHeroHud2D(game, {
      desktop,
      files: hud.heroArtFiles(),
      onAimStart: () => {
        abilities?.aim(null);
        itemBelt?.press(null);
      },
    });
    // Market items (Sky Crystals): a belt group behind the abilities, own aiming + FX (ui/itemBelt2d.ts).
    itemBelt = hud.mountItemBelt2D(game, {
      desktop,
      onAimStart: () => {
        abilities?.aim(null);
        heroHud?.aim(null);
      },
    });
    abilities = hud.mountAbilityBar2D(game, {
      desktop,
      art: hud.abilityArtFiles(art.baseUrl),
      baseUrl: art.baseUrl,
      trail: { el: itemBelt.el },
      ...(heroHud ? { lead: { el: heroHud.el } } : {}),
      onAimStart: () => {
        heroHud?.aim(null);
        itemBelt?.press(null);
      },
    });
    if (q.get('herosel') === '1') game.setHeroSelected(true);
    // Keyboard arrows / gamepad: the in-run reticle (a virtual mouse on the canvas).
    padCursor = hud.mountPadCursor({
      canvas: app.canvas,
      targets: () => game.padTargets(),
      aiming: () => !!abilities?.aiming || !!heroHud?.aiming || !!itemBelt?.aiming,
      heroSpot: () => game.heroScreen(),
      paused: () => game.stepper.paused,
      clickPoint: (x, y) => game.padClickPoint(x, y),
    });

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
    const { mountPauseMenu, mountReplayBar, confirmBoard } = hud;
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
      ...(isDesktopShell()
        ? {
            quit: () => {
              if (asking) return;
              asking = true;
              void import('./ui/gameMenu2d.ts').then(({ confirmQuit }) => confirmQuit()).finally(() => {
                asking = false;
              });
            },
          }
        : {}),
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
    // The painted caves / castle on screen (their fronts, grown a little; `castle` = the goal).
    const gateRects = (): (import('./uiLayout.ts').Rect & { castle: boolean })[] => {
      const f = game.map.fit;
      return gateKeepOutsPx(level.layout2d?.gates ?? []).map((g) => ({ x: f.offsetX + g.x * f.scale, y: f.offsetY + g.y * f.scale, w: g.w * f.scale, h: g.h * f.scale, castle: g.castle }));
    };
    gateRectsRef = gateRects;
    livesWarn = hud.mountLivesWarning();
    if (desktop) {
      // Hover tooltips for the canvas HUD buttons (horn, pause, speed).
      const tips = hud.mountHudTips();
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
    foeCard = hud.mountEnemyCard((type) => codexEnemyUrl(art, type));
    // First-play tips on the first island (plain play), or forced with ?coach=1 (QA).
    const coachMod = hud.coach;
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
    // Tier-IV specializations are bought in the build ring (two taps, game.specializeTower); its
    // branch tip's "(i) Compare" row opens the side-by-side card as optional detail. The gate pauses while the
    // card is up and restores the pause whichever way it goes (incl. a chunk that fails to load).
    const { SpecCardGate } = hud;
    const gate = new SpecCardGate(game);
    specGate = gate;
    game.onSpecCompare = (req) => {
      if (game.replaying || game.end.visible) return;
      gate.open(req.towerId, game.world, async () => {
        const { openSpecCard } = await import('./ui/specCard2d.ts');
        return (onClose) =>
          openSpecCard({
            type: req.type,
            gold: game.world.gold,
            focus: req.focus,
            portraitUrl: (id) => specPortraitUrl(art, id),
            onChoose: (id) => game.specializeTower(req.towerId, id),
            onClose,
          });
      });
    };
    // The first tower at tier III: a one-time "choose a specialization" tip (?spechint=1 forces it).
    const sh = hud.specHint;
    if ((plainPlay && !sh.specHintDone()) || q.get('spechint') === '1') specHint = sh.mountSpecHint(!desktop || isTouchDevice(), q.get('spechint') === '1');
    const nf = hud.newFoes;
    foesSeen = new nf.FoesSeen(nf.seenFromCleared(LEVELS_2D, (i) => (progress2d.bestStars[i] ?? 0) > 0));
    const seenRef = foesSeen;
    newFoeToast = nf.mountNewFoeToast((type) => codexEnemyUrl(art, type));
    laneMod = hud.lanes;
    laneMarks = laneMod.mountLaneMarks();
    const wb = hud.waveBanner;
    waveBanner = wb.mountWaveBanner();
    if (runDifficulty) diffBadge = hud.mountDifficultyBadge(runDifficulty);
    calloutFor = (i) => wb.waveCallout(nf.waveTypes(game.world.level, i), i, game.world.level.waves.length, game.world.waveSystem.isEndless);
    waveTypesOf = (i) => nf.waveTypes(game.world.level, i);
    // In the dock's info slot (top-left, hudDock.ts), like the foe card.
    waveCard = hud.mountWaveCard((type) => codexEnemyUrl(art, type), (type) => !seenRef.has(type));
    syncHudDom = (): void => {
      const overlay = storyOpen || anySheetOpen() || game.end.visible;
      diffBadge?.update(game.dock.banner, !overlay);
      if (!waveCard) return;
      const w = game.world;
      const ws = w.waveSystem;
      const calm = ws.state === 'preFirstWave' || ws.state === 'betweenWaves' || game.stepper.paused;
      const hudState = game.debugHud();
      const visible = calm && !overlay && !game.ringOpen && w.outcome === 'ongoing' && ws.canStartNextWave() && !foeCard?.debug().shown && !newFoeToast?.debug().visible;
      const pv = visible ? ws.getNextWavePreview() : null;
      // Update the wave card first so lane marks always avoid its current-frame box (including on resize).
      waveCard.update({
        visible,
        preview: pv,
        title: pv ? islandWaveTitle(w.level, pv.waveOneBased - 1) : undefined,
        countdown: hudState.countdown,
        earlyBonus: hudState.earlyBonus,
        first: ws.state === 'preFirstWave',
        slot: game.dock.info,
        maxW: uiUnit(app.screen.width, app.screen.height) * 30,
      });
      // Cave / flyer entrance markers: show before every wave while callable (independent of the
      // top-left info slot, so new-foe toasts, foe inspection and tower building never hide them).
      const lay = w.level.layout2d;
      if (laneMarks && laneMod) {
        let marks: import('./ui/laneMarks2d.ts').LaneMark[] | null = null;
        const showMarks = laneMod.shouldShowEntranceMarks({
          waveState: ws.state,
          canStartNextWave: ws.canStartNextWave(),
          ongoing: w.outcome === 'ongoing',
          overlayOpen: overlay,
        });
        const nextPv = showMarks ? ws.getNextWavePreview() : null;
        if (nextPv && lay && (lay.paths.length > 0 || lay.flightPath.length > 0)) {
          const idx = nextPv.waveOneBased - 1;
          const cacheKey = `${w.level.id}|${ws.isEndless ? 1 : 0}|${idx}`;
          if (laneCache?.key !== cacheKey) {
            const def = idx < w.level.waves.length ? w.level.waves[idx] : ws.isEndless ? buildEndlessWaveDef(idx, w.level) : null;
            laneCache = {
              key: cacheKey,
              entries: def ? laneMod.waveEntranceCounts(def.groups, lay.paths, lay.flightPath, (ty) => Boolean(ENEMY_DEFS[ty as EnemyType]?.flying)) : [],
            };
          }
          const card = waveCard.box();
          const foe = foeCard?.debug().rect ?? null;
          const toast = newFoeToast?.debug().rect ?? null;
          const f = game.map.fit;
          const dk = game.dock;
          const unit = laneMod.kitUnit(app.screen.width, app.screen.height);
          const placeKey = laneMod.laneMarkPlaceKey({
            waveKey: cacheKey,
            viewW: app.screen.width,
            viewH: app.screen.height,
            unit,
            fitScale: f.scale,
            fitOffsetX: f.offsetX,
            fitOffsetY: f.offsetY,
            card,
            foe,
            toast,
            hornBox: dk.hornBox,
            plaque: dk.plaque,
            banner: dk.banner,
            tray: dk.tray,
            hasDiffBadge: !!diffBadge,
            coachKey: coach?.debug().shown ? coach.step : '',
            specHintShown: !!specHint?.debug().shown,
            keepOutsVersion: hudKeepOutsVersion(),
            layoutGen: hudLayoutGen,
          });
          if (lanePlaceCache?.key !== placeKey) {
            // Keep off the top-left card/foe/toast, the horn, the HUD pieces and the viewport edge.
            const diff = diffBadge?.debug();
            const avoid = [
              ...(card ? [card] : []),
              ...(foe ? [foe] : []),
              ...(toast ? [toast] : []),
              ...(diff && diff.shown && diff.w > 0 ? [{ x: diff.x, y: diff.y, w: diff.w, h: diff.h }] : []),
              dk.hornBox,
              dk.plaque,
              dk.banner,
              dk.tray,
              hudButtonsKeepOut(app.screen.width, app.screen.height, readSafeInsets()),
              ...hudKeepOuts(),
            ];
            const toScreen = (p: { x: number; z: number }): { x: number; y: number } => ({ x: game.map.screenX(game.map.pxX(p.x)), y: game.map.screenY(game.map.pxY(p.z)) });
            const vp = { w: app.screen.width, h: app.screen.height };
            const placed: import('./ui/laneMarks2d.ts').LaneMark[] = [];
            for (const entry of laneCache.entries) {
              const at = laneMod.laneMarkSpot(entry.path, toScreen, avoid, unit, vp);
              if (at) placed.push({ lane: entry.lane, count: entry.count, flying: entry.flying, ...at });
            }
            lanePlaceCache = { key: placeKey, marks: placed };
          }
          marks = lanePlaceCache.marks;
        }
        laneMarks.update(marks);
      }
    };
    syncHudDom();
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
      itemBelt?.setVisible(false);
      storyOpen = true;
      void routing.playStoryOnce(level, 'intro', art.manifest, art.baseUrl, storyQ === 'intro').then(() => {
        storyOpen = false;
        g.stepper.paused = introWasPaused;
        if (!g.end.visible) {
          codex.setButtonVisible(true);
          settings.setButtonVisible(true);
          abilities?.setVisible(true);
          heroHud?.setVisible(true);
          itemBelt?.setVisible(true);
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
  let lifeSwayReady = false;
  app.ticker.add((t) => {
    if (draws) lastDraws = draws.take();
    const t0 = performance.now();
    stats.record(t.deltaMS, t0);
    if (!manual) game.frame(t.deltaMS / 1000);
    const smallBake = game.map.texelScale <= 1;
    const lifeOn = game.qualityTier !== 'low' && !gfx.reducedMotion;
    ambient?.update(lifeOn, game.stepper.paused, smallBake, t.deltaMS / 1000, game.qualityTier);
    life?.update(lifeOn, game.stepper.paused, smallBake, t.deltaMS / 1000, game.qualityTier);
    if (life) {
      if (!lifeOn) {
        lifeSwayReady = false;
      } else if (!lifeSwayReady && life.debug().swayReady) {
        lifeSwayReady = true;
        onUploadGrace();
      }
    }
    abilities?.frame(t.deltaMS / 1000);
    itemBelt?.frame(t.deltaMS / 1000);
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
    if (specGate?.isOpen) {
      // The card only makes sense for this run's tier-III tower without a branch, live play.
      const tw = specGate.owner === game.world ? game.world.getTowerById(specGate.towerId) : null;
      specGate.frame(!!tw && tw.tier === 3 && !tw.specialization && !game.end.visible && !game.replaying);
    }
    if (specHint && !specHint.done) {
      const busy = game.end.visible || storyOpen || anySheetOpen() || game.ringOpen || game.replaying || game.stepper.paused || !!coach?.debug().shown;
      specHint.update(game.world.towers, (id) => game.towerTopScreen(id), busy);
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
    syncHudDom?.();
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
    gpu: (topN) => gpuTextureStats(app, topN),
    menu: () => hooks.onMenu?.(),
    artcheck: () => artCheckSummary(art),
    abilities: () => abilities?.debug() ?? null,
    pad: () => padCursor?.state() ?? null,
    padClick: () => padCursor?.click(),
    waveCard: () => waveCard?.debug() ?? null,
    hudCheck: () => hudCheck(game),
    items: () => itemBelt?.debug() ?? null,
    endCrystals: () => game.end.crystalsShown,
    endAnnotate: (note) => game.end.annotate(note),
    itemPress: (id) => itemBelt?.press(id),
    itemCastAt: (x, y) => itemBelt?.castAt(x, y) ?? false,
    textAudit: () => auditCanvasTexts([...game.hud.qaTexts(), ...game.end.qaTexts(), ...game.ring.qaTexts()], app.screen.width, app.screen.height),
    mapFrame: () => game.map.frameInfo(),
    ambient: () => ambient?.debug() ?? null,
    stepAmbient: (dt) => {
      ambient?.stepFx(dt, game.qualityTier);
      app.render();
    },
    mapLife: () => life?.debug() ?? null,
    mapLifeFullQuad: (on) => {
      life?.qaFullQuad(on);
      app.render();
    },
    stepMapLife: (dt) => {
      if (life) {
        let rem = Math.max(0, dt);
        while (rem > 1e-6) {
          const chunk = Math.min(0.1, rem);
          life.step(chunk, game.qualityTier);
          rem -= chunk;
        }
      }
      app.render();
    },
    gates: () => gateRectsRef?.() ?? [],
    lives: () => livesWarn?.debug() ?? null,
    foe: () => foeCard?.debug() ?? null,
    coach: () => coach?.debug() ?? null,
    spec: () => ({
      card: specGate?.isOpen ?? false,
      cardState: specGate?.debugState ?? 'closed',
      hint: specHint?.debug() ?? null,
      flourishes: game.specFlourishes,
      ringTower: game.ringTower,
      tip: game.ring.layoutInfo.tooltip,
      towers: game.world.towers.map((tw) => ({ id: tw.id, type: tw.type, tier: tw.tier, plot: tw.col, spec: tw.specialization?.id ?? null, abilities: tw.specialization?.abilities ?? [] })),
      // As drawn: which branch art is up, and its ring against the plot's (0 = fits).
      art: game.towers.ringReport(game.world.towers),
      turrets: game.towers.turretReport(),
    }),
    towerTop: (id) => game.towerTopScreen(id),
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
  setBootProgress(1);
  dismissBoot();
  if (!document.hidden || isDebugScene) app.ticker.start();
  bootPhase('interactive');
  reportBoot();
  // Leaving through the game's own navigation may park this page in the back/forward cache:
  // let go of the GPU context and decoded sheets then (pageCache.ts).
  releaseOnPageCache(app, () => game.textureSources());
  window.__p0.textureWarmup = warmTextureSources(app, game.textureSources(), () => {
    bootPhase('all-textures-resident');
    reportBoot();
    game.setQualityWarmupPending(false);
  });
  if (window.__p0.textureWarmup().pending > 0) game.setQualityWarmupPending(true);
}
