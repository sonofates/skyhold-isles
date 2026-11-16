import './style.css';
import { SoundManager } from './audio/soundManager.ts';
import { LEVELS } from './data/levels/index.ts';
import { GameLoop, computeRenderPacingTarget, type RenderPacingMode } from './platform/browserLoop.ts';
import { GameSession } from './platform/gameSession.ts';
import { InputManager } from './platform/input.ts';
import { loadSettings } from './platform/storage.ts';
import { KenneyAssetStore } from './render/kenneyAssets.ts';
import type { StartupTimingMetrics } from './render/perfGovernor.ts';
import { RenderWorld } from './render/renderWorld.ts';
import { formatPerfLogLine } from './ui/debugPanel.ts';
import { createDebugPanelIfEnabled, readDebugPanelFlags } from './ui/debugWiring.ts';
import { GameOverlays } from './ui/gameOverlays.ts';
import { LoadingScreen } from './ui/loadingScreen.ts';

function nextAnimationFrame(): Promise<void> {
  if (typeof document !== 'undefined' && document.hidden) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      resolve();
    }
  });
}

function describeBootError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/webgl|context/i.test(raw)) {
    return 'Your browser could not start WebGL. Try enabling hardware acceleration or another browser, then reload.';
  }
  return 'Some game assets could not be loaded. Check your connection and reload the page.';
}

async function bootstrap(loadingScreen: LoadingScreen): Promise<void> {
  const bootStartMs = performance.now();
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui-root') as HTMLDivElement | null;
  if (!canvas || !uiRoot) {
    throw new Error('Missing #game-canvas or #ui-root');
  }

  const assetsStartMs = performance.now();
  const assets = await KenneyAssetStore.preload((loaded, total, label) => {
    // Reserve 2 final steps (island diorama setup + shader warm-up) so progress never steps backward.
    loadingScreen.setProgress(loaded, total + 2, label);
  });
  const assetsMs = performance.now() - assetsStartMs;

  loadingScreen.setProgress(41, 43, 'island diorama…');
  await nextAnimationFrame();

  const sceneStartMs = performance.now();
  const initialSettings = loadSettings();
  const soundManager = new SoundManager(initialSettings);
  const renderWorld = new RenderWorld(canvas, assets);
  const session = new GameSession(renderWorld, soundManager);

  const overlays = new GameOverlays(uiRoot, {
    initialSettings,
    onStartWave: () => {
      soundManager.unlock();
      session.simWorld.startNextWave();
      session.syncUi();
    },
    onToggleAutoWave: () => session.toggleAutoWave(),
    onToggleRoutes: () => session.toggleRoutesPinned(),
    onSetSpeed: (sp) => session.setSpeed(sp),
    onTogglePause: () => session.toggleUserPause(),
    onOpenSettings: () => session.openSettingsModal('hud'),
    onOpenMenu: () => session.openPauseMenu(),
    onRotateCamera: (dir) => renderWorld.cameraController.rotate90(dir),
    onSelectBuildType: (type) => session.toggleBuildType(type),
    onActivateAbility: (id) => session.activateAbility(id),
    onUpgradeTower: (id) => session.upgradeTower(id),
    onSellTower: (id) => session.sellTower(id),
    onSetTargeting: (id, mode) => session.setTowerTargeting(id, mode),
    onCloseTowerPanel: () => session.selectTower(null),
    onPlayFromMenu: (idx) => {
      soundManager.unlock();
      session.startLevel(idx);
    },
    onOpenLevelSelectFromMenu: () => {
      soundManager.unlock();
      session.showMenuView('levelSelect', false);
    },
    onOpenSettingsFromMenu: () => {
      soundManager.unlock();
      session.openSettingsModal('menu');
    },
    onSelectLevel: (idx) => {
      soundManager.unlock();
      session.startLevel(idx);
    },
    onBackFromLevelSelect: () => {
      soundManager.unlock();
      session.showMenuView('menu', false);
    },
    onResumeFromPause: () => session.closePauseMenu(),
    onRestartLevel: () => session.startLevel(session.currentLevelIndex),
    onOpenSettingsFromPause: () => session.openSettingsModal('pause'),
    onOpenLevelSelectFromPause: () => session.showMenuView('levelSelect', true),
    onMainMenuFromPause: () => session.showMenuView('menu', true),
    onNextLevel: () => session.startLevel(Math.min(LEVELS.length - 1, session.currentLevelIndex + 1)),
    onEndlessMode: () => session.enterEndlessMode(),
    onSettingsChange: (next) => {
      session.updateSettings(next);
      // Re-sync tier-driven outline & decor flags so changing non-quality settings in 'auto'
      // mode cannot overwrite an adapted Tier 0/1 state via RenderWorld.setQuality.
      const eff = renderWorld.sceneManager.getEffectiveRenderState();
      renderWorld.materials.setOutlineAlphaEnabled(eff.outlineEnabled);
      renderWorld.decorBuilder.setQuality(eff.decorLow ? 'low' : 'high');
    },
    onSettingsClose: () => session.closeSettingsModal(),
  });

  let startupMetrics: StartupTimingMetrics | null = null;
  let loopRef: GameLoop | null = null;

  const { hasPerf } = readDebugPanelFlags();
  const debugPanel = createDebugPanelIfEnabled(uiRoot, {
    getSimWorld: () => session.simWorld,
    renderWorld,
    floatingTextPool: overlays.floatingTextPool,
    pendingDebugSpawns: session.pendingDebugSpawns,
    syncUi: session.syncUi,
    getPacingInfo: () => loopRef?.getPacingInfo() ?? { mode: 'active', targetFps: null },
    getStartupMetrics: () => startupMetrics,
  });

  const inputManager = new InputManager(canvas, {
    onPanScreenDelta: (dx, dy) => renderWorld.cameraController.panByScreenDelta(dx, dy),
    onZoomDelta: (delta, ndcX, ndcY) => renderWorld.cameraController.zoomByDelta(delta, ndcX, ndcY),
    onRotateCamera: (dir) => renderWorld.cameraController.rotate90(dir),
    onPointerMoveNdc: (ndcX, ndcY, cx, cy) => session.onPointerMove(ndcX, ndcY, cx, cy),
    onPointerLeave: () => session.onPointerLeave(),
    onPrimaryTapNdc: (ndcX, ndcY, shiftKey) => session.onPrimaryTap(ndcX, ndcY, shiftKey),
    onSecondaryAction: (source) => session.onSecondaryAction(source),
    onHotkeyTower: (index) => session.onHotkeyTower(index),
    onHotkeyAbility: (id) => session.activateAbility(id),
    onToggleAutoWave: () => session.toggleAutoWave(),
    onToggleRoutes: () => session.toggleRoutesPinned(),
    onTowerActionHotkey: (action) => session.onTowerActionHotkey(action),
    onTogglePause: () => session.toggleUserPause(),
    onKeyPanState: (x, z) => renderWorld.cameraController.setKeyPan(x, z),
  });

  let lastCamViewVersion = renderWorld.cameraController.getViewVersion();
  let lastSimWorld = session.simWorld;
  let lastViewMode = session.viewMode;
  let lastPacingMode: RenderPacingMode = 'menu';
  let wasPacingThrottled = true;
  let perfLogAccumSec = 0;

  const loop: GameLoop = new GameLoop({
    resolveRenderPacing: (wakeActive) =>
      computeRenderPacingTarget({
        hidden: document.hidden,
        simActive: loop.simActive,
        paused: loop.paused,
        modalOpen: overlays.isModalOpen(),
        menuView: session.viewMode,
        wakeActive,
      }),
    onFixedTick: (dt) => session.fixedTick(dt),
    onRender: (frameDt, alpha, elapsedVisualTime) => {
      const levelOrViewChanged =
        session.simWorld !== lastSimWorld || session.viewMode !== lastViewMode;
      if (levelOrViewChanged) {
        lastSimWorld = session.simWorld;
        lastViewMode = session.viewMode;
        renderWorld.sceneManager.resetGovernorWarmup(undefined, true);
      }

      session.renderFrame(frameDt, alpha, elapsedVisualTime);

      const camVer = renderWorld.cameraController.getViewVersion();
      if (camVer !== lastCamViewVersion) {
        lastCamViewVersion = camVer;
        if (loop.paused && loop.simActive) {
          loop.wakeRender(0.35);
        }
      }

      const pacing = computeRenderPacingTarget({
        hidden: document.hidden,
        simActive: loop.simActive,
        paused: loop.paused,
        modalOpen: overlays.isModalOpen(),
        menuView: session.viewMode,
        wakeActive: loop.isWakeActive(),
      });
      if (!levelOrViewChanged) {
        if (wasPacingThrottled && pacing.targetFps === null) {
          renderWorld.sceneManager.resetGovernorWarmup(0.4, true);
        } else if (pacing.mode !== lastPacingMode && pacing.targetFps !== null) {
          renderWorld.sceneManager.resetDisplayMetrics();
        }
      }
      lastPacingMode = pacing.mode;
      wasPacingThrottled = pacing.targetFps !== null;
      loop.setRenderPacing(pacing.targetFps, pacing.mode);

      if (hasPerf || session.viewMode === 'playing') {
        debugPanel?.update(frameDt);
      }
    },
    onAfterRender: (frameDt, workMs, throttled) => {
      const transition = renderWorld.sceneManager.recordFrame(frameDt, workMs, {
        throttled,
        hidden: document.hidden,
      });
      if (hasPerf && transition) {
        console.info(
          `[Skyhold Perf] tier T${transition.fromTier}->T${transition.toTier} (${transition.reason}, avg=${transition.avgMs.toFixed(1)}ms, p95=${transition.p95Ms.toFixed(1)}ms)`,
        );
      }
      if (hasPerf && debugPanel) {
        perfLogAccumSec += frameDt;
        if (perfLogAccumSec >= 5) {
          perfLogAccumSec = 0;
          console.info(formatPerfLogLine(debugPanel.getTelemetrySnapshot()));
        }
      }
    },
    onVisibilityRestore: () => {
      renderWorld.sceneManager.resetGovernorWarmup();
    },
  });

  loopRef = loop;

  renderWorld.sceneManager.setEffectiveStateListener((eff) => {
    renderWorld.materials.setOutlineAlphaEnabled(eff.outlineEnabled);
    renderWorld.decorBuilder.setQuality(eff.decorLow ? 'low' : 'high');
  });

  session.attachRuntime({
    overlays,
    inputManager,
    loop,
    setDebugVisible: (v) => debugPanel?.setVisible(hasPerf ? true : v),
  });

  const onResize = (): void => {
    renderWorld.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  };
  const onFirstGesture = (): void => soundManager.unlock();
  const onWakeActivity = (): void => {
    if (loop.simActive && loop.paused && !overlays.isModalOpen()) {
      loop.wakeRender(0.75);
    }
  };
  window.addEventListener('pointerdown', onFirstGesture, { once: true });
  window.addEventListener('resize', onResize);
  window.addEventListener('pointerdown', onWakeActivity, { passive: true });
  window.addEventListener('pointermove', onWakeActivity, { passive: true });
  window.addEventListener('wheel', onWakeActivity, { passive: true });
  window.addEventListener('keydown', onWakeActivity, { passive: true });

  session.showMenuView('menu', true);
  const sceneSetupMs = performance.now() - sceneStartMs;

  loadingScreen.setProgress(42, 43, 'shaders…');
  await nextAnimationFrame();

  const warmStartMs = performance.now();
  await renderWorld.sceneManager.warmUp(renderWorld.cameraController.camera, {
    instancedHighlightMaterial: renderWorld.materials.kenneyTower,
    extraMaterials: [renderWorld.materials.ghostInvalidMaterial],
  });
  const warmupMs = performance.now() - warmStartMs;
  loadingScreen.setProgress(43, 43);

  startupMetrics = {
    assetsMs,
    sceneSetupMs,
    warmupMs,
    timeToMenuMs: performance.now() - bootStartMs,
  };

  if (hasPerf) {
    debugPanel?.setVisible(true);
    debugPanel?.update(0.25);
    const snap = renderWorld.sceneManager.getPerfSnapshot();
    const glInfo = renderWorld.sceneManager.getWebGLDiagnosticInfo();
    const gpuSuffix = glInfo.gpuRenderer ? ` gpu="${glInfo.gpuRenderer}"` : '';
    console.info(
      `[Skyhold Perf] timeToMenu=${Math.round(startupMetrics.timeToMenuMs)}ms ` +
        `(assets=${Math.round(assetsMs)}ms, setup=${Math.round(sceneSetupMs)}ms, warmup=${Math.round(warmupMs)}ms) ` +
        `quality=${snap.qualityMode}->T${snap.activeTier}(${snap.tierLabel}) dpr=${snap.dpr.toFixed(2)} ` +
        `composer=${snap.composerEnabled ? snap.activePasses : 'OFF'} ` +
        `gl=${glInfo.webgl2 ? 'WebGL2' : 'WebGL1'} progs=${glInfo.programs} maxTex=${glInfo.maxTextureSize} parallelCompile=${glInfo.parallelCompile}${gpuSuffix}`,
    );
  }

  loadingScreen.hide();
  loop.start();

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointerdown', onWakeActivity);
      window.removeEventListener('pointermove', onWakeActivity);
      window.removeEventListener('wheel', onWakeActivity);
      window.removeEventListener('keydown', onWakeActivity);
      session.dispose();
      soundManager.dispose();
      loop.stop();
      inputManager.dispose();
      overlays.dispose();
      debugPanel?.dispose();
      renderWorld.dispose();
    });
  }
}

const bootUiRoot = document.getElementById('ui-root');
const bootLoadingScreen = new LoadingScreen(bootUiRoot ?? document.body);
bootstrap(bootLoadingScreen).catch((err: unknown) => {
  console.error('[Skyhold] bootstrap failed:', err);
  bootLoadingScreen.showError(describeBootError(err));
});
