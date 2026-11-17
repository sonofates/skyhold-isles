import '@fontsource-variable/fredoka';
import './style.css';
import { SoundManager } from './audio/soundManager.ts';
import { LEVELS } from './data/levels/index.ts';
import { GameLoop } from './platform/browserLoop.ts';
import { GameSession } from './platform/gameSession.ts';
import { InputManager } from './platform/input.ts';
import { initDeviceClass } from './platform/deviceClass.ts';
import { readSafeArea } from './platform/safeArea.ts';
import { loadSettings } from './platform/storage.ts';
import { KenneyAssetStore } from './render/kenneyAssets.ts';
import { RenderWorld } from './render/renderWorld.ts';
import { createDebugPanelIfEnabled } from './ui/debugWiring.ts';
import { GameOverlays } from './ui/gameOverlays.ts';
import { LoadingScreen } from './ui/loadingScreen.ts';
import { RadialMenu } from './ui/radialMenu.ts';

function describeBootError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/webgl|context/i.test(raw)) {
    return 'Your browser could not start WebGL. Try enabling hardware acceleration or another browser, then reload.';
  }
  return 'Some game assets could not be loaded. Check your connection and reload the page.';
}

async function bootstrap(loadingScreen: LoadingScreen): Promise<void> {
  initDeviceClass();
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui-root') as HTMLDivElement | null;
  if (!canvas || !uiRoot) {
    throw new Error('Missing #game-canvas or #ui-root');
  }

  const assets = await KenneyAssetStore.preload((loaded, total, label) => {
    loadingScreen.setProgress(loaded, total, label);
  });

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
    onSelectLevel: (idx) => session.selectIsland(idx),
    onBackFromLevelSelect: () => {
      soundManager.unlock();
      session.showMenuView('menu', false);
    },
    onResumeFromPause: () => session.closePauseMenu(),
    onRestartLevel: () => session.restartLevel(),
    onOpenSettingsFromPause: () => session.openSettingsModal('pause'),
    onOpenLevelSelectFromPause: () => session.showMenuView('levelSelect', true),
    onMainMenuFromPause: () => session.showMenuView('menu', true),
    onNextLevel: () => session.startLevel(Math.min(LEVELS.length - 1, session.currentLevelIndex + 1)),
    onEndlessMode: () => session.enterEndlessMode(),
    onSettingsChange: (next) => session.updateSettings(next),
    onSettingsClose: () => session.closeSettingsModal(),
    onOpenWorkshop: (from) => {
      soundManager.unlock();
      session.openWorkshop(from);
    },
    onWorkshopBuy: (id) => session.buyWorkshopUpgrade(id),
    onWorkshopRefundAll: () => session.refundWorkshop(),
    onWorkshopBack: () => session.closeWorkshop(),
    onBriefingStart: (idx, config) => {
      soundManager.unlock();
      session.startLevel(idx, config);
    },
    onBriefingToggle: (on) => (on ? soundManager.playUiConfirm() : soundManager.playUiBack()),
  });

  const debugPanel = createDebugPanelIfEnabled(uiRoot, {
    getSimWorld: () => session.simWorld,
    renderWorld,
    floatingTextPool: overlays.floatingTextPool,
    pendingDebugSpawns: session.pendingDebugSpawns,
    syncUi: session.syncUi,
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
    onDragStart: () => session.onUserPanStart(),
  });

  const radial = new RadialMenu(uiRoot, session, renderWorld);

  const loop = new GameLoop({
    onFixedTick: (dt) => session.fixedTick(dt),
    onRender: (frameDt, alpha, elapsedVisualTime) => {
      session.renderFrame(frameDt, alpha, elapsedVisualTime);
      if (session.viewMode === 'playing') debugPanel?.update(frameDt);
    },
  });

  session.attachRuntime({
    overlays,
    inputManager,
    loop,
    setDebugVisible: (v) => debugPanel?.setVisible(v),
    radial,
  });

  const onResize = (): void => {
    renderWorld.cameraController.setSafeInsets(readSafeArea());
    renderWorld.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  };
  // iOS reports the new size a beat after `orientationchange`; the visual viewport also moves
  // when the browser toolbar collapses.
  const onOrientation = (): void => {
    onResize();
    window.setTimeout(onResize, 180);
    window.setTimeout(onResize, 500);
  };
  renderWorld.cameraController.setSafeInsets(readSafeArea());
  const onFirstGesture = (): void => soundManager.unlock();
  window.addEventListener('pointerdown', onFirstGesture, { once: true });
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onOrientation);
  window.visualViewport?.addEventListener('resize', onResize);

  session.showMenuView('menu', true);
  loadingScreen.hide();
  loop.start();

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onOrientation);
      window.visualViewport?.removeEventListener('resize', onResize);
      radial.dispose();
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
