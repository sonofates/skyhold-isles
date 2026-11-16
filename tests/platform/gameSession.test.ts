import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoundManager } from '../../src/audio/soundManager.ts';
import type { AbilityId, SpeedMultiplier, TargetingMode, TowerType } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { GameLoop } from '../../src/platform/browserLoop.ts';
import { GameSession } from '../../src/platform/gameSession.ts';
import type { InputManager } from '../../src/platform/input.ts';
import { loadProgress, saveProgress } from '../../src/platform/storage.ts';
import { CameraController } from '../../src/render/cameraController.ts';
import type { RenderWorld } from '../../src/render/renderWorld.ts';
import type { TowerEntity } from '../../src/sim/entities.ts';
import type { GameOverlays } from '../../src/ui/gameOverlays.ts';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

function createHarness() {
  const cam = new CameraController(1280, 720);
  cam.configureForMap(LEVELS[0].cols, LEVELS[0].rows, LEVELS[0].layout);

  let pickedTower: TowerEntity | null = null;
  const unbindSoundSpy = vi.fn();

  const soundManager = {
    unlock: vi.fn(),
    updateSettings: vi.fn(),
    bindEvents: vi.fn(() => unbindSoundSpy),
  } as unknown as SoundManager;

  const renderWorld = {
    cameraController: cam,
    overlayIndicators: {
      setSelectedTowerRing: vi.fn(),
    },
    setQuality: vi.fn(),
    loadLevel: vi.fn((level: (typeof LEVELS)[number]) => {
      cam.configureForMap(level.cols, level.rows, level.layout);
    }),
    setPlacementGridActive: vi.fn(),
    setFlightPathHighlight: vi.fn(),
    setRoutesPinned: vi.fn(),
    setPlacementPreview: vi.fn(),
    setMeteorTargetPreview: vi.fn(),
    pickTowerAtNdc: vi.fn(() => pickedTower),
    setHoveredTowerId: vi.fn(),
    setCanvasCursor: vi.fn(),
    render: vi.fn(),
  } as unknown as RenderWorld & {
    setPickedTower: (t: TowerEntity | null) => void;
  };

  let pauseOpen = false;
  let settingsOpen = false;
  let outcomeOpen = false;

  const overlays = {
    isModalOpen: vi.fn(() => pauseOpen || settingsOpen || outcomeOpen),
    closeModals: vi.fn(() => {
      pauseOpen = false;
      settingsOpen = false;
      outcomeOpen = false;
    }),
    setPlayVisibility: vi.fn(),
    syncInPlay: vi.fn(),
    floatingTextPool: {
      clear: vi.fn(),
      spawnUpgradeTier: vi.fn(),
      spawnDamage: vi.fn(),
      spawnGold: vi.fn(),
      update: vi.fn(),
    },
    tooltip: {
      hide: vi.fn(),
      show: vi.fn(),
      showTower: vi.fn(),
    },
    toast: {
      show: vi.fn(),
      hide: vi.fn(),
      update: vi.fn(),
    },
    towerPanel: {
      setSellConfirmArmed: vi.fn(),
      setAnchorScreenPos: vi.fn(),
    },
    mainMenu: {
      setOpen: vi.fn(),
    },
    levelSelect: {
      setOpen: vi.fn(),
    },
    pauseMenu: {
      isOpen: () => pauseOpen,
      setOpen: vi.fn((open: boolean) => {
        pauseOpen = open;
      }),
    },
    settingsModal: {
      isOpen: () => settingsOpen,
      setOpen: vi.fn((open: boolean) => {
        settingsOpen = open;
      }),
    },
    outcomeOverlay: {
      isOpen: () => outcomeOpen,
      showWin: vi.fn(() => {
        outcomeOpen = true;
      }),
      showLose: vi.fn(() => {
        outcomeOpen = true;
      }),
    },
  } as unknown as GameOverlays;

  const inputManager = {
    setEnabled: vi.fn(),
    setModalOpen: vi.fn(),
  } as unknown as InputManager;

  const loop = new GameLoop({ onFixedTick: () => {}, onRender: () => {} });
  const setDebugVisible = vi.fn();

  const session = new GameSession(renderWorld, soundManager);
  session.attachRuntime({
    overlays,
    inputManager,
    loop,
    setDebugVisible,
  });

  return {
    session,
    cam,
    soundManager,
    unbindSoundSpy,
    renderWorld,
    overlays,
    inputManager,
    loop,
    setDebugVisible,
    setPickedTower: (t: TowerEntity | null) => {
      pickedTower = t;
    },
    setOutcomeOpen: (open: boolean) => {
      outcomeOpen = open;
    },
  };
}

function projectTileNdc(
  cam: CameraController,
  session: GameSession,
  col: number,
  row: number,
): { x: number; y: number } {
  const wx = session.simWorld.grid.gridToWorldX(col);
  const wz = session.simWorld.grid.gridToWorldZ(row);
  const p = new THREE.Vector3(wx, 0, wz).project(cam.camera);
  return { x: p.x, y: p.y };
}

describe('GameSession state machine, input, and lifecycle', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 720 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('initializes at unlocked level, manages menu/playing/pause/settings modal transitions, and syncs loop', () => {
    saveProgress({
      unlockedLevelIndex: 3,
      bestStars: [3, 2, 1, 0],
      bestEndlessWaves: [0, 0, 0, 0],
    });
    const h = createHarness();
    expect(h.session.currentLevelIndex).toBe(3);

    h.session.showMenuView('menu');
    expect(h.session.viewMode).toBe('menu');
    expect(h.loop.simActive).toBe(false);
    expect(h.inputManager.setEnabled).toHaveBeenLastCalledWith(false);
    expect(h.setDebugVisible).toHaveBeenLastCalledWith(false);

    h.session.startLevel(0);
    expect(h.session.viewMode).toBe('playing');
    expect(h.session.currentLevelIndex).toBe(0);
    expect(h.loop.simActive).toBe(true);
    expect(h.loop.paused).toBe(false);
    expect(h.loop.speed).toBe(1);
    expect(h.session.pauseSubtitle()).toBe(`${LEVELS[0].name} · Wave 0/${LEVELS[0].waves.length}`);

    // User pause & speed override
    h.session.toggleUserPause();
    expect(h.loop.paused).toBe(true);
    h.session.setSpeed(3 as SpeedMultiplier);
    expect(h.loop.speed).toBe(3);
    expect(h.loop.paused).toBe(false);

    // Pause -> Settings -> Close Settings returns cleanly to Pause Menu
    h.session.openPauseMenu();
    expect(h.overlays.pauseMenu.isOpen()).toBe(true);
    expect(h.loop.paused).toBe(true);
    h.session.openSettingsModal('pause');
    expect(h.overlays.pauseMenu.isOpen()).toBe(false);
    expect(h.overlays.settingsModal.isOpen()).toBe(true);

    // toggleUserPause is ignored while a modal is open
    h.session.toggleUserPause();
    expect(h.loop.paused).toBe(true);

    h.session.closeSettingsModal();
    expect(h.overlays.settingsModal.isOpen()).toBe(false);
    expect(h.overlays.pauseMenu.isOpen()).toBe(true);
    h.session.closePauseMenu();
    expect(h.overlays.pauseMenu.isOpen()).toBe(false);
    expect(h.loop.paused).toBe(false);

    h.session.dispose();
    expect(h.unbindSoundSpy).toHaveBeenCalledTimes(1);
  });

  it('handles tower placement, shift-multi-build, tower selection, hotkeys, double-press sell confirm, and Escape cascade', () => {
    let nowMs = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);

    const h = createHarness();
    h.session.startLevel(0);
    h.session.simWorld.gold = 1000;

    // Select archer via hotkey 0 -> places on grass tile (4, 2), shows one-time upgrade toast, exits placement
    h.session.onHotkeyTower(0);
    const tileA = projectTileNdc(h.cam, h.session, 4, 2);
    h.session.onPrimaryTap(tileA.x, tileA.y, false);
    const placedA = h.session.simWorld.getTowerById(
      h.session.simWorld.grid.getTowerIdAt(4, 2),
    )!;
    expect(placedA).not.toBeNull();
    expect(placedA.type).toBe('archer');
    expect(h.overlays.toast.show).toHaveBeenCalledTimes(1);

    // Shift-click places on (4, 3) and keeps placement mode active
    h.session.toggleBuildType('frost' as TowerType);
    const tileB = projectTileNdc(h.cam, h.session, 4, 3);
    h.session.onPrimaryTap(tileB.x, tileB.y, true);
    const placedB = h.session.simWorld.getTowerById(
      h.session.simWorld.grid.getTowerIdAt(4, 3),
    )!;
    expect(placedB).not.toBeNull();
    expect(placedB.type).toBe('frost');
    // Toast does not repeat after first build
    expect(h.overlays.toast.show).toHaveBeenCalledTimes(1);

    // Tapping an existing tower while in placement mode cancels placement and selects that tower
    h.session.onPrimaryTap(tileA.x, tileA.y, true);
    expect(h.renderWorld.overlayIndicators.setSelectedTowerRing).toHaveBeenLastCalledWith(placedA);
    expect(h.overlays.towerPanel.setAnchorScreenPos).toHaveBeenCalled();

    // Hotkey 'upgrade' upgrades placedA to Tier 2
    expect(h.session.onTowerActionHotkey('upgrade')).toBe(true);
    expect(placedA.tier).toBe(2);

    // Hotkey 'target' cycles through all 4 targeting modes
    const seenModes: TargetingMode[] = [];
    for (let i = 0; i < 4; i++) {
      expect(h.session.onTowerActionHotkey('target')).toBe(true);
      seenModes.push(placedA.targetingMode);
    }
    expect(seenModes).toEqual(['last', 'strongest', 'closest', 'first']);

    // First 'sell' arms confirmation; letting 3500ms expire via renderFrame disarms without selling
    expect(h.session.onTowerActionHotkey('sell')).toBe(true);
    expect(h.overlays.towerPanel.setSellConfirmArmed).toHaveBeenLastCalledWith(true);
    expect(h.session.simWorld.getTowerById(placedA.id)).not.toBeNull();

    nowMs += 4000;
    h.session.renderFrame(1 / 60, 0, 1);
    expect(h.overlays.towerPanel.setSellConfirmArmed).toHaveBeenLastCalledWith(false);
    expect(h.session.simWorld.getTowerById(placedA.id)).not.toBeNull();

    // Double 'sell' within 3500ms sells tower cleanly and clears selection
    expect(h.session.onTowerActionHotkey('sell')).toBe(true);
    nowMs += 500;
    expect(h.session.onTowerActionHotkey('sell')).toBe(true);
    expect(h.session.simWorld.getTowerById(placedA.id)).toBeNull();
    expect(h.session.onTowerActionHotkey('upgrade')).toBe(false);

    // Secondary action priority cascade:
    // activeAbilityMode ('meteor') -> activePlacementType -> selectedTowerId -> pauseMenu (only on escape)
    h.session.simWorld.startNextWave();
    h.session.activateAbility('meteor' as AbilityId);
    h.session.onSecondaryAction('rightClick'); // clears meteor targeting
    h.session.onHotkeyTower(1); // activates cannon placement
    h.session.onSecondaryAction('rightClick'); // clears placement
    h.setPickedTower(placedB);
    h.session.onPrimaryTap(tileB.x, tileB.y);
    h.session.onSecondaryAction('rightClick'); // deselects placedB
    h.session.onSecondaryAction('rightClick'); // rightClick on empty play must NOT open pause menu
    expect(h.overlays.pauseMenu.isOpen()).toBe(false);
    h.session.onSecondaryAction('escape'); // escape on empty play opens pause menu
    expect(h.overlays.pauseMenu.isOpen()).toBe(true);
    h.session.onSecondaryAction('escape'); // escape closes pause menu
    expect(h.overlays.pauseMenu.isOpen()).toBe(false);
  });

  it('guards abilities pre-wave, targets meteor & casts overcharge, and handles endless persistence on win/loss/restart', () => {
    const h = createHarness();
    h.session.startLevel(0);

    // Pre-first-wave abilities are blocked
    h.session.activateAbility('meteor');
    h.session.activateAbility('overcharge');
    expect(h.session.simWorld.abilitySystem.canCast('overcharge')).toBe(true);

    // Start wave -> overcharge fires immediately, meteor toggles aiming and casts on tap
    h.session.simWorld.startNextWave();
    h.session.activateAbility('overcharge');
    expect(h.session.simWorld.abilitySystem.isOverchargeActive()).toBe(true);

    h.session.activateAbility('meteor');
    const center = projectTileNdc(h.cam, h.session, 4, 2);
    h.session.onPrimaryTap(center.x, center.y);
    expect(h.session.simWorld.abilitySystem.canCast('meteor')).toBe(false);

    // Win event records progress, shows win overlay, and enterEndlessMode resumes cleanly
    h.session.simWorld.debugForceWin();
    expect(h.overlays.outcomeOverlay.showWin).toHaveBeenCalledTimes(1);
    expect(loadProgress(LEVELS.length).bestStars[0]).toBe(3);
    expect(loadProgress(LEVELS.length).unlockedLevelIndex).toBe(1);

    h.session.toggleUserPause();
    h.session.enterEndlessMode();
    expect(h.overlays.outcomeOverlay.isOpen()).toBe(false);
    expect(h.loop.paused).toBe(false);
    expect(h.session.simWorld.waveSystem.isEndless).toBe(true);
    expect(h.session.pauseSubtitle()).toContain('∞');

    // Leaving mid-endless via startLevel records reached endless wave
    h.session.simWorld.debugSkipToWave(LEVELS[0].waves.length + 3);
    const waveBeforeLeave = h.session.simWorld.waveSystem.currentWaveOneBased;
    h.session.startLevel(1);
    expect(loadProgress(LEVELS.length).bestEndlessWaves[0]).toBe(waveBeforeLeave);

    // Auto-wave preference persists across level startLevel
    h.session.toggleAutoWave();
    h.session.startLevel(0);
    expect(h.session.simWorld.waveSystem.autoWave).toBe(true);

    // Endless loss triggers outcomeOverlay.showLose with isEndless=true and persists bestEndlessWaves
    h.session.simWorld.debugForceWin();
    h.session.enterEndlessMode();
    h.session.simWorld.debugSkipToWave(LEVELS[0].waves.length + 5);
    h.session.simWorld.lives = 1;
    const leaker = h.session.simWorld.enemySystem.spawnEnemy('grunt')!;
    leaker.dist = leaker.totalDist - 0.001;
    h.session.fixedTick(BALANCE.fixedDt);
    expect(h.overlays.outcomeOverlay.showLose).toHaveBeenCalled();
    expect(loadProgress(LEVELS.length).bestEndlessWaves[0]).toBe(LEVELS[0].waves.length + 5);
  });

  it('throttles periodic UI sync to 0.2s and refreshes hover only when hoverKey changes', () => {
    const h = createHarness();
    h.session.startLevel(0);
    const syncCallsAtStart = (h.overlays.syncInPlay as ReturnType<typeof vi.fn>).mock.calls.length;

    // Pointer move sets pointerVersion=1
    h.session.onPointerMove(0, 0, 640, 360);
    const hoverCallsAfterMove = (h.renderWorld.pickTowerAtNdc as ReturnType<typeof vi.fn>).mock.calls.length;

    // Two small frames (< 0.2s total) with no simClock or pointer change -> no extra hover raycast, no periodic syncUi
    h.session.renderFrame(0.08, 0.5, 0.08);
    const hoverAfterFirstRender = (h.renderWorld.pickTowerAtNdc as ReturnType<typeof vi.fn>).mock.calls.length;
    h.session.renderFrame(0.08, 0.5, 0.16);
    expect((h.renderWorld.pickTowerAtNdc as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      hoverAfterFirstRender,
    );
    expect((h.overlays.syncInPlay as ReturnType<typeof vi.fn>).mock.calls.length).toBe(syncCallsAtStart);

    // Advancing past 0.2s triggers periodic UI sync; fixedTick advances simClockSec so hover refreshes once
    h.session.fixedTick(BALANCE.fixedDt);
    h.session.renderFrame(0.06, 0, 0.22);
    expect((h.overlays.syncInPlay as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      syncCallsAtStart + 1,
    );
    expect((h.renderWorld.pickTowerAtNdc as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      hoverAfterFirstRender,
    );
    expect(hoverCallsAfterMove).toBeGreaterThan(0);

    // Leaving pointer clears hover cleanly
    h.session.onPointerLeave();
    expect(h.renderWorld.setHoveredTowerId).toHaveBeenLastCalledWith(null);
    expect(h.overlays.tooltip.hide).toHaveBeenCalled();
  });
});
