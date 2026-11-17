import { afterEach, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { SoundManager } from '../../src/audio/soundManager.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import type { GameLoop } from '../../src/platform/browserLoop.ts';
import { GameSession, type SessionRuntimeDeps } from '../../src/platform/gameSession.ts';
import type { InputManager } from '../../src/platform/input.ts';
import { updatePlacementPreviewFromNdc } from '../../src/platform/sessionBridge.ts';
import type { RenderWorld } from '../../src/render/renderWorld.ts';
import { createDefaultMetaSave } from '../../src/sim/meta/metaEngine.ts';
import type { GameOverlays } from '../../src/ui/gameOverlays.ts';

function installMockLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const mockStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
  return store;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

function createStubEnv() {
  const placementCalls: Array<{ visible: boolean; type: string | null; valid: boolean }> = [];
  const menuCalls: Array<{ screen: 'menu' | 'levelSelect'; open: boolean; unlocked: number }> = [];
  const hitPos = new Vector3();

  const renderWorld = {
    setQuality: () => {},
    loadLevel: () => {},
    setHoveredTowerId: () => {},
    setCanvasCursor: () => {},
    setPlacementGridActive: () => {},
    setFlightPathHighlight: () => {},
    setRoutesPinned: () => {},
    setMeteorTargetPreview: () => {},
    setPlacementPreview: (visible: boolean, type: string | null, _x: number, _z: number, valid: boolean) => {
      placementCalls.push({ visible, type, valid });
    },
    pickTowerAtNdc: () => null,
    cameraController: {
      setShowcaseMode: () => {},
      screenNdcToPlane: () => hitPos,
    },
    overlayIndicators: {
      setSelectedTowerRing: () => {},
    },
  } as unknown as RenderWorld;

  const soundManager = {
    unlock: () => {},
    bindEvents: () => () => {},
    updateSettings: () => {},
  } as unknown as SoundManager;

  const overlays = {
    isModalOpen: () => false,
    setPlayVisibility: () => {},
    syncInPlay: () => {},
    closeModals: () => {},
    floatingTextPool: { clear: () => {} },
    tooltip: { hide: () => {} },
    toast: { hide: () => {}, show: () => {} },
    towerPanel: { setSellConfirmArmed: () => {} },
    outcomeOverlay: { showWin: () => {}, showLose: () => {}, isOpen: () => false },
    pauseMenu: { setOpen: () => {} },
    settingsModal: { setOpen: () => {} },
    mainMenu: {
      setOpen: (open: boolean, progress?: { unlockedLevelIndex: number }) => {
        menuCalls.push({ screen: 'menu', open, unlocked: progress?.unlockedLevelIndex ?? -1 });
      },
    },
    levelSelect: {
      setOpen: (open: boolean, progress?: { unlockedLevelIndex: number }) => {
        menuCalls.push({ screen: 'levelSelect', open, unlocked: progress?.unlockedLevelIndex ?? -1 });
      },
    },
  } as unknown as GameOverlays;

  const deps: SessionRuntimeDeps = {
    overlays,
    inputManager: { setEnabled: () => {}, setModalOpen: () => {} } as unknown as InputManager,
    loop: {
      speed: 1,
      simActive: false,
      paused: false,
      resetAccumulator: () => {},
    } as unknown as GameLoop,
    setDebugVisible: () => {},
  };

  return { renderWorld, soundManager, deps, placementCalls, menuCalls, hitPos };
}

describe('GameSession and sessionBridge meta wiring', () => {
  it('enforces tower bans, cost scaling, restartCurrentRun, save import menu sync, and pendingDebugSpawns taint', () => {
    installMockLocalStorage();
    const { renderWorld, soundManager, deps, placementCalls, menuCalls, hitPos } = createStubEnv();
    const session = new GameSession(renderWorld, soundManager);
    session.attachRuntime(deps);

    // Start a daily run with restricted towers and scaled costs
    const spec = session.startDailyChallenge('2026-07-13');
    expect(session.viewMode).toBe('playing');
    expect(session.getActiveDailyChallenge()?.date).toBe('2026-07-13');

    // Placement mode blocks banned towers (cannon is banned on 2026-07-13)
    const bannedTower = spec.modifiers.forbiddenTowerTypes[0] ?? 'cannon';
    expect(session.isTowerAllowed(bannedTower)).toBe(false);
    session.setPlacementMode(bannedTower);
    expect(session.getAllowedTowerTypes()).not.toContain(bannedTower);

    // restartCurrentRun preserves active daily date and modifiers
    session.restartCurrentRun();
    expect(session.getActiveDailyChallenge()?.date).toBe('2026-07-13');

    // startMutatedLevel with tight_budget updates build & upgrade costs and placement preview validity
    session.startMutatedLevel(0, ['tight_budget']);
    expect(session.getActiveDailyChallenge()).toBeNull();
    const scaledBuildCost = Math.round(50 * 1.15);
    expect(session.getTowerBuildCost('archer')).toBe(scaledBuildCost);
    const archer = session.simWorld.placeTower(4, 2, 'archer')!;
    expect(archer).not.toBeNull();
    expect(session.getTowerUpgradeCost(archer.id)).toBe(Math.round(55 * 1.15));

    // updatePlacementPreviewFromNdc checks towerCostMultiplier & bans
    hitPos.set(
      session.simWorld.grid.gridToWorldX(4),
      0,
      session.simWorld.grid.gridToWorldZ(3),
    );
    session.simWorld.gold = 55; // >= base 50, but < scaled 57!
    placementCalls.length = 0;
    updatePlacementPreviewFromNdc(true, 'archer', 0, 0, renderWorld, session.simWorld);
    expect(placementCalls[placementCalls.length - 1]?.valid).toBe(false);

    session.simWorld.gold = scaledBuildCost;
    updatePlacementPreviewFromNdc(true, 'archer', 0, 0, renderWorld, session.simWorld);
    expect(placementCalls[placementCalls.length - 1]?.valid).toBe(true);

    // Queued pendingDebugSpawns taints run on fixedTick even before spawn delay expires
    session.startLevel(0);
    expect(session.meta.isCurrentRunEligible()).toBe(true);
    session.pendingDebugSpawns.push({ type: 'grunt', delay: 5 });
    session.fixedTick(BALANCE.fixedDt);
    expect(session.meta.isCurrentRunEligible()).toBe(false);

    // importMetaSaveJson refreshes menu/levelSelect overlays when not playing
    session.showMenuView('menu', true);
    menuCalls.length = 0;
    const upgradedSave = createDefaultMetaSave(LEVELS.length);
    upgradedSave.campaign.unlockedLevelIndex = 4;
    upgradedSave.campaign.bestStars[0] = 3;
    expect(session.importMetaSaveJson(JSON.stringify(upgradedSave), 'merge').ok).toBe(true);
    expect(menuCalls).toEqual([
      { screen: 'menu', open: true, unlocked: 4 },
      { screen: 'levelSelect', open: false, unlocked: 4 },
    ]);

    session.dispose();
  });
});
