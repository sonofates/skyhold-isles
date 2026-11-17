import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameSettings } from '../../src/core/types.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import type { GameOverlayCallbacks } from '../../src/ui/gameOverlays.ts';
import type { InputHandlers } from '../../src/platform/input.ts';
import type { LoopCallbacks } from '../../src/platform/browserLoop.ts';

const bootMocks = vi.hoisted(() => ({
  preloadError: null as Error | null,
  renderWorldError: null as Error | null,
  debugPanelEnabled: true,
  initialSettings: {
    masterVolume: 0.7,
    muted: false,
    cameraShake: true,
    damageNumbers: true,
    quality: 'high',
  } as GameSettings,
  assetsObj: { dispose: vi.fn() },
  loadingInstances: [] as Array<{
    parent: unknown;
    setProgress: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
    showError: ReturnType<typeof vi.fn>;
  }>,
  soundInstances: [] as Array<{
    unlock: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  renderInstances: [] as Array<{
    cameraController: { rotate90: ReturnType<typeof vi.fn>; panByScreenDelta: ReturnType<typeof vi.fn>; zoomByDelta: ReturnType<typeof vi.fn>; setKeyPan: ReturnType<typeof vi.fn> };
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  sessionInstances: [] as Array<{
    currentLevelIndex: number;
    viewMode: 'menu' | 'levelSelect' | 'playing';
    pendingDebugSpawns: Array<unknown>;
    simWorld: { startNextWave: ReturnType<typeof vi.fn> };
    syncUi: ReturnType<typeof vi.fn>;
    attachRuntime: ReturnType<typeof vi.fn>;
    toggleAutoWave: ReturnType<typeof vi.fn>;
    toggleRoutesPinned: ReturnType<typeof vi.fn>;
    setSpeed: ReturnType<typeof vi.fn>;
    toggleUserPause: ReturnType<typeof vi.fn>;
    openSettingsModal: ReturnType<typeof vi.fn>;
    openPauseMenu: ReturnType<typeof vi.fn>;
    toggleBuildType: ReturnType<typeof vi.fn>;
    activateAbility: ReturnType<typeof vi.fn>;
    upgradeTower: ReturnType<typeof vi.fn>;
    sellTower: ReturnType<typeof vi.fn>;
    setTowerTargeting: ReturnType<typeof vi.fn>;
    selectTower: ReturnType<typeof vi.fn>;
    startLevel: ReturnType<typeof vi.fn>;
    showMenuView: ReturnType<typeof vi.fn>;
    closePauseMenu: ReturnType<typeof vi.fn>;
    enterEndlessMode: ReturnType<typeof vi.fn>;
    updateSettings: ReturnType<typeof vi.fn>;
    closeSettingsModal: ReturnType<typeof vi.fn>;
    onPointerMove: ReturnType<typeof vi.fn>;
    onPointerLeave: ReturnType<typeof vi.fn>;
    onPrimaryTap: ReturnType<typeof vi.fn>;
    onSecondaryAction: ReturnType<typeof vi.fn>;
    onHotkeyTower: ReturnType<typeof vi.fn>;
    onTowerActionHotkey: ReturnType<typeof vi.fn>;
    fixedTick: ReturnType<typeof vi.fn>;
    renderFrame: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  overlayCallbacks: null as GameOverlayCallbacks | null,
  overlayInstance: null as { floatingTextPool: unknown; dispose: ReturnType<typeof vi.fn> } | null,
  debugPanelInstance: null as {
    update: ReturnType<typeof vi.fn>;
    setVisible: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  } | null,
  debugWiringArgs: null as { getSimWorld: () => unknown; syncUi: () => void } | null,
  inputHandlers: null as InputHandlers | null,
  loopCallbacks: null as LoopCallbacks | null,
  loopInstance: null as { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } | null,
}));

vi.mock('../../src/style.css', () => ({}));

vi.mock('../../src/platform/storage.ts', () => ({
  loadSettings: () => bootMocks.initialSettings,
}));

vi.mock('../../src/ui/loadingScreen.ts', () => {
  class MockLoadingScreen {
    setProgress = vi.fn();
    hide = vi.fn();
    showError = vi.fn();
    constructor(public readonly parent: unknown) {
      bootMocks.loadingInstances.push(this);
    }
  }
  return { LoadingScreen: MockLoadingScreen };
});

vi.mock('../../src/render/kenneyAssets.ts', () => ({
  KenneyAssetStore: {
    preload: vi.fn(async (onProgress?: (loaded: number, total: number, label: string) => void) => {
      onProgress?.(2, 4, 'tile-straight');
      if (bootMocks.preloadError) throw bootMocks.preloadError;
      return bootMocks.assetsObj;
    }),
  },
}));

vi.mock('../../src/audio/soundManager.ts', () => {
  class MockSoundManager {
    unlock = vi.fn();
    dispose = vi.fn();
    constructor() {
      bootMocks.soundInstances.push(this);
    }
  }
  return { SoundManager: MockSoundManager };
});

vi.mock('../../src/render/renderWorld.ts', () => {
  class MockRenderWorld {
    cameraController = {
      rotate90: vi.fn(),
      panByScreenDelta: vi.fn(),
      zoomByDelta: vi.fn(),
      setKeyPan: vi.fn(),
    };
    resize = vi.fn();
    dispose = vi.fn();
    constructor() {
      if (bootMocks.renderWorldError) throw bootMocks.renderWorldError;
      bootMocks.renderInstances.push(this);
    }
  }
  return { RenderWorld: MockRenderWorld };
});

vi.mock('../../src/platform/gameSession.ts', () => {
  class MockGameSession {
    currentLevelIndex = 0;
    viewMode: 'menu' | 'levelSelect' | 'playing' = 'menu';
    pendingDebugSpawns: Array<unknown> = [];
    simWorld = { startNextWave: vi.fn() };
    syncUi = vi.fn();
    attachRuntime = vi.fn();
    toggleAutoWave = vi.fn();
    toggleRoutesPinned = vi.fn();
    setSpeed = vi.fn();
    toggleUserPause = vi.fn();
    openSettingsModal = vi.fn();
    openPauseMenu = vi.fn();
    toggleBuildType = vi.fn();
    activateAbility = vi.fn();
    upgradeTower = vi.fn();
    sellTower = vi.fn();
    setTowerTargeting = vi.fn();
    selectTower = vi.fn();
    startLevel = vi.fn();
    showMenuView = vi.fn();
    closePauseMenu = vi.fn();
    enterEndlessMode = vi.fn();
    updateSettings = vi.fn();
    closeSettingsModal = vi.fn();
    onPointerMove = vi.fn();
    onPointerLeave = vi.fn();
    onPrimaryTap = vi.fn();
    onSecondaryAction = vi.fn();
    onHotkeyTower = vi.fn();
    onTowerActionHotkey = vi.fn(() => true);
    fixedTick = vi.fn();
    renderFrame = vi.fn();
    dispose = vi.fn();
    constructor() {
      bootMocks.sessionInstances.push(this);
    }
  }
  return { GameSession: MockGameSession };
});

vi.mock('../../src/ui/gameOverlays.ts', () => {
  class MockGameOverlays {
    floatingTextPool = { id: 'float-pool' };
    dispose = vi.fn();
    constructor(_root: unknown, callbacks: GameOverlayCallbacks) {
      bootMocks.overlayCallbacks = callbacks;
      bootMocks.overlayInstance = this;
    }
  }
  return { GameOverlays: MockGameOverlays };
});

vi.mock('../../src/ui/debugWiring.ts', () => ({
  createDebugPanelIfEnabled: vi.fn((_root: unknown, ctx: { getSimWorld: () => unknown; syncUi: () => void }) => {
    bootMocks.debugWiringArgs = ctx;
    if (!bootMocks.debugPanelEnabled) {
      bootMocks.debugPanelInstance = null;
      return null;
    }
    bootMocks.debugPanelInstance = {
      update: vi.fn(),
      setVisible: vi.fn(),
      dispose: vi.fn(),
    };
    return bootMocks.debugPanelInstance;
  }),
}));

vi.mock('../../src/platform/input.ts', () => {
  class MockInputManager {
    dispose = vi.fn();
    constructor(_canvas: unknown, handlers: InputHandlers) {
      bootMocks.inputHandlers = handlers;
    }
  }
  return { InputManager: MockInputManager };
});

vi.mock('../../src/platform/browserLoop.ts', () => {
  class MockGameLoop {
    start = vi.fn();
    stop = vi.fn();
    constructor(callbacks: LoopCallbacks) {
      bootMocks.loopCallbacks = callbacks;
      bootMocks.loopInstance = this;
    }
  }
  return { GameLoop: MockGameLoop };
});

function setupDom(options?: {
  hasCanvas?: boolean;
  hasUiRoot?: boolean;
  canvasWidth?: number;
  canvasHeight?: number;
}) {
  const hasCanvas = options?.hasCanvas ?? true;
  const hasUiRoot = options?.hasUiRoot ?? true;
  const canvas = {
    clientWidth: options?.canvasWidth ?? 1280,
    clientHeight: options?.canvasHeight ?? 720,
  };
  const uiRoot = { id: 'ui-root' };
  const body = { id: 'body' };
  const windowListeners = new Map<string, Array<{ cb: () => void; once?: boolean }>>();

  vi.stubGlobal('document', {
    body,
    getElementById: (id: string) => {
      if (id === 'game-canvas') return hasCanvas ? canvas : null;
      if (id === 'ui-root') return hasUiRoot ? uiRoot : null;
      return null;
    },
  });
  vi.stubGlobal('window', {
    innerWidth: 960,
    innerHeight: 540,
    addEventListener: (type: string, cb: () => void, opts?: { once?: boolean }) => {
      const list = windowListeners.get(type) ?? [];
      list.push({ cb, once: opts?.once });
      windowListeners.set(type, list);
    },
    removeEventListener: vi.fn(),
  });

  const emitWindow = (type: string) => {
    const list = windowListeners.get(type) ?? [];
    for (const entry of [...list]) {
      entry.cb();
      if (entry.once) {
        const idx = list.indexOf(entry);
        if (idx !== -1) list.splice(idx, 1);
      }
    }
  };

  return { canvas, uiRoot, body, windowListeners, emitWindow };
}

describe('main bootstrap entrypoint', () => {
  beforeEach(() => {
    vi.resetModules();
    bootMocks.preloadError = null;
    bootMocks.renderWorldError = null;
    bootMocks.debugPanelEnabled = true;
    bootMocks.loadingInstances.length = 0;
    bootMocks.soundInstances.length = 0;
    bootMocks.renderInstances.length = 0;
    bootMocks.sessionInstances.length = 0;
    bootMocks.overlayCallbacks = null;
    bootMocks.overlayInstance = null;
    bootMocks.debugPanelInstance = null;
    bootMocks.debugWiringArgs = null;
    bootMocks.inputHandlers = null;
    bootMocks.loopCallbacks = null;
    bootMocks.loopInstance = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports generic load error when #game-canvas or #ui-root is missing and falls back to document.body', async () => {
    const dom = setupDom({ hasCanvas: false, hasUiRoot: false });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await import('../../src/main.ts');
    await vi.waitFor(() => expect(bootMocks.loadingInstances[0]?.showError).toHaveBeenCalledTimes(1));

    expect(bootMocks.loadingInstances[0].parent).toBe(dom.body);
    expect(bootMocks.loadingInstances[0].showError).toHaveBeenCalledWith(
      'Some game assets could not be loaded. Check your connection and reload the page.',
    );
    expect(errSpy).toHaveBeenCalled();
  });

  it('reports WebGL-specific guidance when RenderWorld throws a WebGL/context error', async () => {
    setupDom();
    bootMocks.renderWorldError = new Error('WebGL2 context creation failed');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await import('../../src/main.ts');
    await vi.waitFor(() => expect(bootMocks.loadingInstances[0]?.showError).toHaveBeenCalledTimes(1));

    expect(bootMocks.loadingInstances[0].showError).toHaveBeenCalledWith(
      'Your browser could not start WebGL. Try enabling hardware acceleration or another browser, then reload.',
    );
  });

  it('wires overlays, input hotkeys, debug panel, resize/gesture listeners, and game loop cleanly', async () => {
    const dom = setupDom({ canvasWidth: 0, canvasHeight: 0 });
    await import('../../src/main.ts');
    await vi.waitFor(() => expect(bootMocks.loopInstance?.start).toHaveBeenCalledTimes(1));

    const loading = bootMocks.loadingInstances[0];
    const sound = bootMocks.soundInstances[0];
    const rw = bootMocks.renderInstances[0];
    const session = bootMocks.sessionInstances[0];
    const overlaysCb = bootMocks.overlayCallbacks!;
    const inputHandlers = bootMocks.inputHandlers!;
    const loopCb = bootMocks.loopCallbacks!;
    const debugPanel = bootMocks.debugPanelInstance!;

    expect(loading.parent).toBe(dom.uiRoot);
    expect(loading.setProgress).toHaveBeenCalledWith(2, 4, 'tile-straight');
    expect(loading.hide).toHaveBeenCalledTimes(1);
    expect(session.attachRuntime).toHaveBeenCalledWith({
      overlays: bootMocks.overlayInstance,
      inputManager: expect.any(Object),
      loop: bootMocks.loopInstance,
      setDebugVisible: expect.any(Function),
    });
    expect(session.showMenuView).toHaveBeenCalledWith('menu', true);

    // attachRuntime.setDebugVisible forwards to debugPanel.setVisible
    const attachArg = session.attachRuntime.mock.calls[0][0] as { setDebugVisible: (v: boolean) => void };
    attachArg.setDebugVisible(true);
    expect(debugPanel.setVisible).toHaveBeenCalledWith(true);
    expect(bootMocks.debugWiringArgs?.getSimWorld()).toBe(session.simWorld);

    // Window resize falls back to innerWidth/innerHeight when canvas client dims are 0, and pointerdown unlocks once
    dom.emitWindow('resize');
    expect(rw.resize).toHaveBeenCalledWith(960, 540);
    dom.emitWindow('pointerdown');
    expect(sound.unlock).toHaveBeenCalledTimes(1);

    // Loop callbacks gate debugPanel.update on viewMode === 'playing'
    loopCb.onFixedTick(1 / 60);
    expect(session.fixedTick).toHaveBeenCalledWith(1 / 60);
    session.viewMode = 'menu';
    loopCb.onRender(0.016, 0.5, 1.0);
    expect(session.renderFrame).toHaveBeenCalledWith(0.016, 0.5, 1.0);
    expect(debugPanel.update).not.toHaveBeenCalled();
    session.viewMode = 'playing';
    loopCb.onRender(0.02, 0.25, 1.5);
    expect(debugPanel.update).toHaveBeenCalledWith(0.02);

    // Exercise every GameOverlay callback
    overlaysCb.onStartWave();
    expect(session.simWorld.startNextWave).toHaveBeenCalledTimes(1);
    expect(session.syncUi).toHaveBeenCalledTimes(1);
    overlaysCb.onToggleAutoWave();
    overlaysCb.onToggleRoutes();
    overlaysCb.onSetSpeed(3);
    overlaysCb.onTogglePause();
    overlaysCb.onOpenSettings();
    overlaysCb.onOpenMenu();
    overlaysCb.onRotateCamera(-1);
    overlaysCb.onSelectBuildType('frost');
    overlaysCb.onActivateAbility('meteor');
    overlaysCb.onUpgradeTower(7);
    overlaysCb.onSellTower(7);
    overlaysCb.onSetTargeting(7, 'strongest');
    overlaysCb.onCloseTowerPanel();
    overlaysCb.onPlayFromMenu(2);
    overlaysCb.onOpenLevelSelectFromMenu();
    overlaysCb.onOpenSettingsFromMenu();
    overlaysCb.onSelectLevel(4);
    overlaysCb.onBackFromLevelSelect();
    overlaysCb.onResumeFromPause();
    session.currentLevelIndex = 3;
    overlaysCb.onRestartLevel();
    overlaysCb.onOpenSettingsFromPause();
    overlaysCb.onOpenLevelSelectFromPause();
    overlaysCb.onMainMenuFromPause();
    overlaysCb.onNextLevel();
    session.currentLevelIndex = LEVELS.length - 1;
    overlaysCb.onNextLevel();
    overlaysCb.onEndlessMode();
    overlaysCb.onSettingsChange({ ...bootMocks.initialSettings, muted: true });
    overlaysCb.onSettingsClose();

    expect(session.toggleAutoWave).toHaveBeenCalledTimes(1);
    expect(session.toggleRoutesPinned).toHaveBeenCalledTimes(1);
    expect(session.setSpeed).toHaveBeenCalledWith(3);
    expect(session.toggleUserPause).toHaveBeenCalledTimes(1);
    expect(session.openSettingsModal).toHaveBeenNthCalledWith(1, 'hud');
    expect(session.openSettingsModal).toHaveBeenNthCalledWith(2, 'menu');
    expect(session.openSettingsModal).toHaveBeenNthCalledWith(3, 'pause');
    expect(session.openPauseMenu).toHaveBeenCalledTimes(1);
    expect(rw.cameraController.rotate90).toHaveBeenCalledWith(-1);
    expect(session.toggleBuildType).toHaveBeenCalledWith('frost');
    expect(session.activateAbility).toHaveBeenCalledWith('meteor');
    expect(session.upgradeTower).toHaveBeenCalledWith(7);
    expect(session.sellTower).toHaveBeenCalledWith(7);
    expect(session.setTowerTargeting).toHaveBeenCalledWith(7, 'strongest');
    expect(session.selectTower).toHaveBeenCalledWith(null);
    expect(session.startLevel).toHaveBeenCalledWith(2);
    expect(session.startLevel).toHaveBeenCalledWith(4);
    expect(session.startLevel).toHaveBeenCalledWith(3);
    expect(session.startLevel).toHaveBeenCalledWith(LEVELS.length - 1);
    expect(session.showMenuView).toHaveBeenCalledWith('levelSelect', false);
    expect(session.showMenuView).toHaveBeenCalledWith('menu', false);
    expect(session.showMenuView).toHaveBeenCalledWith('levelSelect', true);
    expect(session.showMenuView).toHaveBeenCalledWith('menu', true);
    expect(session.closePauseMenu).toHaveBeenCalledTimes(1);
    expect(session.enterEndlessMode).toHaveBeenCalledTimes(1);
    expect(session.updateSettings).toHaveBeenCalledWith({ ...bootMocks.initialSettings, muted: true });
    expect(session.closeSettingsModal).toHaveBeenCalledTimes(1);

    // Exercise every InputManager handler
    inputHandlers.onPanScreenDelta(12, -8);
    inputHandlers.onZoomDelta(0.2, 0.1, -0.3);
    inputHandlers.onRotateCamera(1);
    inputHandlers.onPointerMoveNdc(0.2, 0.4, 300, 200);
    inputHandlers.onPointerLeave();
    inputHandlers.onPrimaryTapNdc(-0.1, 0.2, true);
    inputHandlers.onSecondaryAction('escape');
    inputHandlers.onHotkeyTower(1);
    inputHandlers.onHotkeyAbility('overcharge');
    inputHandlers.onToggleAutoWave();
    inputHandlers.onToggleRoutes();
    expect(inputHandlers.onTowerActionHotkey('upgrade')).toBe(true);
    inputHandlers.onTogglePause();
    inputHandlers.onKeyPanState(-1, 1);

    expect(rw.cameraController.panByScreenDelta).toHaveBeenCalledWith(12, -8);
    expect(rw.cameraController.zoomByDelta).toHaveBeenCalledWith(0.2, 0.1, -0.3);
    expect(rw.cameraController.rotate90).toHaveBeenLastCalledWith(1);
    expect(session.onPointerMove).toHaveBeenCalledWith(0.2, 0.4, 300, 200);
    expect(session.onPointerLeave).toHaveBeenCalledTimes(1);
    expect(session.onPrimaryTap).toHaveBeenCalledWith(-0.1, 0.2, true);
    expect(session.onSecondaryAction).toHaveBeenCalledWith('escape');
    expect(session.onHotkeyTower).toHaveBeenCalledWith(1);
    expect(session.activateAbility).toHaveBeenLastCalledWith('overcharge');
    expect(session.onTowerActionHotkey).toHaveBeenCalledWith('upgrade');
    expect(rw.cameraController.setKeyPan).toHaveBeenCalledWith(-1, 1);
  });

  it('handles disabled debugPanel and explicit canvas client dimensions cleanly', async () => {
    const dom = setupDom({ canvasWidth: 1440, canvasHeight: 900 });
    bootMocks.debugPanelEnabled = false;
    await import('../../src/main.ts');
    await vi.waitFor(() => expect(bootMocks.loopInstance?.start).toHaveBeenCalledTimes(1));

    const session = bootMocks.sessionInstances[0];
    const rw = bootMocks.renderInstances[0];
    const attachArg = session.attachRuntime.mock.calls[0][0] as { setDebugVisible: (v: boolean) => void };
    expect(() => attachArg.setDebugVisible(true)).not.toThrow();

    dom.emitWindow('resize');
    expect(rw.resize).toHaveBeenCalledWith(1440, 900);

    session.viewMode = 'playing';
    expect(() => bootMocks.loopCallbacks!.onRender(1 / 60, 0.5, 2.0)).not.toThrow();
  });
});
