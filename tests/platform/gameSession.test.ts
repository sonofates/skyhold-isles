import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoundManager } from '../../src/audio/soundManager.ts';
import type { AbilityId, SpeedMultiplier, TargetingMode, TowerType } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { GameLoop } from '../../src/platform/browserLoop.ts';
import { GameSession } from '../../src/platform/gameSession.ts';
import type { InputManager } from '../../src/platform/input.ts';
import { loadProgress, loadSettings, saveProgress } from '../../src/platform/storage.ts';
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

    // Redundant onPointerLeave when already outside is a no-op
    const hideCount = (h.overlays.tooltip.hide as ReturnType<typeof vi.fn>).mock.calls.length;
    h.session.onPointerLeave();
    expect((h.overlays.tooltip.hide as ReturnType<typeof vi.fn>).mock.calls.length).toBe(hideCount);
  });

  it('ignores unaffordable or out-of-bounds taps cleanly and restores settings origins from menu and hud', () => {
    const h = createHarness();
    h.session.showMenuView('menu');
    h.session.openSettingsModal('menu');
    expect(h.session.settingsOrigin).toBe('menu');
    expect(h.overlays.settingsModal.isOpen()).toBe(true);
    h.session.closeSettingsModal();
    expect(h.overlays.settingsModal.isOpen()).toBe(false);
    expect(h.overlays.pauseMenu.isOpen()).toBe(false);

    h.session.startLevel(0);
    h.session.openSettingsModal('hud');
    expect(h.overlays.settingsModal.isOpen()).toBe(true);
    h.session.closeSettingsModal();
    expect(h.overlays.pauseMenu.isOpen()).toBe(false);

    // Unaffordable build tap keeps placement mode active and places zero towers
    h.session.simWorld.gold = 10;
    h.session.toggleBuildType('mortar');
    const grassTile = projectTileNdc(h.cam, h.session, 4, 2);
    h.session.onPrimaryTap(grassTile.x, grassTile.y, false);
    expect(h.session.simWorld.towers).toHaveLength(0);

    // Out-of-bounds tap while selecting clears selection
    h.session.setPlacementMode(null);
    h.session.simWorld.gold = 500;
    const placed = h.session.simWorld.placeTower(4, 2, 'archer')!;
    h.session.selectTower(placed.id);
    h.session.onPrimaryTap(0.99, 0.99, false);
    expect(h.renderWorld.overlayIndicators.setSelectedTowerRing).toHaveBeenLastCalledWith(null);

    // Starting another level unbinds the previous SoundManager subscription
    h.session.startLevel(1);
    expect(h.unbindSoundSpy).toHaveBeenCalledTimes(1);
  });

  it('handles non-grass taps, updateSettings, toggleRoutesPinned, pendingDebugSpawns, and showcase reset cleanly', () => {
    const h = createHarness();
    h.session.startLevel(0);
    h.session.simWorld.gold = 1000;

    // Tapping road tile (1, 2) during placement places nothing, shows no toast, keeps placement active
    h.session.toggleBuildType('archer');
    const roadNdc = projectTileNdc(h.cam, h.session, 1, 2);
    h.session.onPrimaryTap(roadNdc.x, roadNdc.y, false);
    expect(h.session.simWorld.towers).toHaveLength(0);
    expect(h.overlays.toast.show).not.toHaveBeenCalled();

    // Tapping grass tile afterwards still places tower -> proves placement mode stayed active
    const grassNdc = projectTileNdc(h.cam, h.session, 4, 2);
    h.session.onPrimaryTap(grassNdc.x, grassNdc.y, false);
    expect(h.session.simWorld.towers).toHaveLength(1);

    // updateSettings persists and syncs SoundManager + RenderWorld quality
    const nextSettings = {
      masterVolume: 0.25,
      muted: true,
      cameraShake: false,
      damageNumbers: false,
      quality: 'low' as const,
    };
    h.session.updateSettings(nextSettings);
    expect(loadSettings()).toEqual(nextSettings);
    expect(h.soundManager.updateSettings).toHaveBeenCalledWith(nextSettings);
    expect(h.renderWorld.setQuality).toHaveBeenLastCalledWith('low');

    // toggleRoutesPinned forwards state to RenderWorld & HUD
    h.session.toggleRoutesPinned();
    expect(h.renderWorld.setRoutesPinned).toHaveBeenLastCalledWith(true);

    // fixedTick drains pendingDebugSpawns cleanly
    h.session.pendingDebugSpawns.push({ type: 'grunt', delay: 0.05 });
    for (let i = 0; i < 4; i++) h.session.fixedTick(BALANCE.fixedDt);
    expect(h.session.pendingDebugSpawns).toHaveLength(0);
    expect(h.session.simWorld.enemyPool.getActiveCount()).toBe(1);

    // Returning to levelSelect with reloadShowcase=true from Endless records progress, clears spawns, and resets world
    h.session.simWorld.debugForceWin();
    h.session.enterEndlessMode();
    h.session.simWorld.debugSkipToWave(LEVELS[0].waves.length + 2);
    h.session.pendingDebugSpawns.push({ type: 'runner', delay: 1.0 });
    h.session.showMenuView('levelSelect', true);

    expect(h.session.viewMode).toBe('levelSelect');
    expect(h.session.pendingDebugSpawns).toHaveLength(0);
    expect(h.session.simWorld.waveSystem.isEndless).toBe(false);
    expect(loadProgress(LEVELS.length).bestEndlessWaves[0]).toBe(LEVELS[0].waves.length + 2);
  });

  it('handles cross-mode meteor/placement toggles, pickedTower & OOB placement taps, flight highlight subtlety, and menu renderFrame', () => {
    const h = createHarness();
    h.session.startLevel(0);
    h.session.simWorld.gold = 2000;

    // Flight path highlight is bright (subtle=false) for anti-air towers, subtle (subtle=true) for ground-only
    h.session.toggleBuildType('archer');
    expect(h.renderWorld.setFlightPathHighlight).toHaveBeenLastCalledWith(true, false);
    h.session.toggleBuildType('cannon');
    expect(h.renderWorld.setFlightPathHighlight).toHaveBeenLastCalledWith(true, true);

    // Out-of-bounds tap while in placement mode leaves placement active (does not exit placement)
    h.session.onPrimaryTap(0.99, 0.99, false);
    expect(h.renderWorld.setPlacementGridActive).toHaveBeenLastCalledWith(true);

    // Clicking an existing pickedTower while in placement mode exits placement and selects that tower
    const placed = h.session.simWorld.placeTower(4, 2, 'archer')!;
    h.setPickedTower(placed);
    const tileA = projectTileNdc(h.cam, h.session, 4, 2);
    h.session.onPrimaryTap(tileA.x, tileA.y, false);
    expect(h.renderWorld.setPlacementGridActive).toHaveBeenLastCalledWith(false);
    expect(h.renderWorld.overlayIndicators.setSelectedTowerRing).toHaveBeenLastCalledWith(placed);

    // Activating meteor clears active placement mode; pointer move previews meteor; clicking meteor again toggles OFF
    h.setPickedTower(null);
    h.session.simWorld.startNextWave();
    h.session.toggleBuildType('frost');
    h.session.activateAbility('meteor');
    expect(h.renderWorld.setPlacementGridActive).toHaveBeenLastCalledWith(false);
    h.session.onPointerMove(0, 0, 640, 360);
    expect(h.renderWorld.setMeteorTargetPreview).toHaveBeenLastCalledWith(true, expect.any(Number), expect.any(Number), expect.any(Number));
    h.session.activateAbility('meteor');
    expect(h.renderWorld.setMeteorTargetPreview).toHaveBeenLastCalledWith(false, 0, 0, 1);

    // Selecting a build tower while aiming meteor cancels meteor mode
    h.session.activateAbility('meteor');
    h.session.toggleBuildType('tesla');
    expect(h.renderWorld.setMeteorTargetPreview).toHaveBeenLastCalledWith(false, 0, 0, 1);
    expect(h.renderWorld.setPlacementGridActive).toHaveBeenLastCalledWith(true);

    // Escape does NOT open pause menu while outcomeOverlay is open
    h.session.setPlacementMode(null);
    h.setOutcomeOpen(true);
    h.session.onSecondaryAction('escape');
    expect(h.overlays.pauseMenu.isOpen()).toBe(false);

    // renderFrame in menu mode renders with null simWorld and fxDt = 0 without periodic UI sync
    h.session.showMenuView('menu');
    const syncCallsBefore = (h.overlays.syncInPlay as ReturnType<typeof vi.fn>).mock.calls.length;
    h.session.renderFrame(0.5, 0.25, 2.0);
    expect(h.renderWorld.render).toHaveBeenLastCalledWith(null, 0.5, 0.25, 2.0, 0);
    expect((h.overlays.syncInPlay as ReturnType<typeof vi.fn>).mock.calls.length).toBe(syncCallsBefore);
  });

  it('handles grid tower selection fallback, modal unwind on secondary action, hotkey guards, flyer highlights, and paused frame sync', () => {
    const h = createHarness();
    h.session.startLevel(0);
    h.session.simWorld.gold = 2000;
    h.setPickedTower(null);

    const tower = h.session.simWorld.placeTower(4, 2, 'archer')!;
    const towerNdc = projectTileNdc(h.cam, h.session, 4, 2);

    // Find an unoccupied grass tile distinct from (4, 2)
    let emptyCoord: { col: number; row: number } | null = null;
    for (let r = 0; r < h.session.simWorld.grid.rows && !emptyCoord; r++) {
      for (let c = 0; c < h.session.simWorld.grid.cols; c++) {
        if ((c !== 4 || r !== 2) && h.session.simWorld.grid.canPlaceTower(c, r)) {
          emptyCoord = { col: c, row: r };
          break;
        }
      }
    }
    expect(emptyCoord).not.toBeNull();
    const emptyNdc = projectTileNdc(h.cam, h.session, emptyCoord!.col, emptyCoord!.row);

    // 1. Grid lookup fallback when pickTowerAtNdc returns null:
    // In placement mode: clicking a tile occupied via grid.getTowerIdAt exits placement & selects that tower
    h.session.toggleBuildType('cannon');
    expect(h.renderWorld.setPlacementGridActive).toHaveBeenLastCalledWith(true);
    h.session.onPrimaryTap(towerNdc.x, towerNdc.y, false);
    expect(h.renderWorld.setPlacementGridActive).toHaveBeenLastCalledWith(false);
    expect(h.renderWorld.overlayIndicators.setSelectedTowerRing).toHaveBeenLastCalledWith(tower);

    // Clicking an empty grass tile in idle mode deselects the current tower
    h.session.onPrimaryTap(emptyNdc.x, emptyNdc.y, false);
    expect(h.renderWorld.overlayIndicators.setSelectedTowerRing).toHaveBeenLastCalledWith(null);

    // In idle mode: clicking an occupied tower tile without mesh pick still selects via grid.getTowerIdAt
    h.session.onPrimaryTap(towerNdc.x, towerNdc.y, false);
    expect(h.renderWorld.overlayIndicators.setSelectedTowerRing).toHaveBeenLastCalledWith(tower);

    // 2. onTowerActionHotkey returns false if selectedTowerId was removed externally or viewMode !== 'playing'
    h.session.simWorld.sellTower(tower.id);
    expect(h.session.onTowerActionHotkey('upgrade')).toBe(false);
    expect(h.renderWorld.overlayIndicators.setSelectedTowerRing).toHaveBeenLastCalledWith(null);

    const tower2 = h.session.simWorld.placeTower(4, 2, 'archer')!;
    h.session.selectTower(tower2.id);
    h.session.showMenuView('menu');
    expect(h.session.onTowerActionHotkey('target')).toBe(false);

    // Restore playing view
    h.session.startLevel(0);
    h.session.simWorld.gold = 2000;

    // 3. onSecondaryAction closes settingsModal (restoring pauseMenu for 'pause' origin), then closes pauseMenu
    h.session.openPauseMenu();
    expect(h.overlays.pauseMenu.isOpen()).toBe(true);
    h.session.openSettingsModal('pause');
    expect(h.overlays.settingsModal.isOpen()).toBe(true);
    expect(h.overlays.pauseMenu.isOpen()).toBe(false);

    h.session.onSecondaryAction('rightClick');
    expect(h.overlays.settingsModal.isOpen()).toBe(false);
    expect(h.overlays.pauseMenu.isOpen()).toBe(true);

    h.session.onSecondaryAction('escape');
    expect(h.overlays.pauseMenu.isOpen()).toBe(false);

    // 4. syncFlightPathHighlight during active story waves with vs without flyers
    const lvl0 = LEVELS[0];
    const noFlyerWaveIdx = lvl0.waves.findIndex(
      (w, idx) =>
        !w.groups.some((g) => g.enemyType === 'flyer') &&
        !(lvl0.waves[idx + 1]?.groups.some((g) => g.enemyType === 'flyer') ?? false),
    );
    const flyerWaveIdx = lvl0.waves.findIndex((w) => w.groups.some((g) => g.enemyType === 'flyer'));
    if (noFlyerWaveIdx >= 0) {
      h.session.simWorld.debugSkipToWave(noFlyerWaveIdx + 1);
      h.session.syncUi();
      expect(h.renderWorld.setFlightPathHighlight).toHaveBeenLastCalledWith(false, true);
    }
    expect(flyerWaveIdx).toBeGreaterThanOrEqual(0);
    h.session.simWorld.debugSkipToWave(flyerWaveIdx + 1);
    h.session.syncUi();
    expect(h.renderWorld.setFlightPathHighlight).toHaveBeenLastCalledWith(true, true);

    // 5. Paused playing renderFrame passes non-null simWorld with fxDt=0 and hides hover tooltip
    h.session.onPointerMove(emptyNdc.x, emptyNdc.y, 200, 200);
    const tooltipHide = h.overlays.tooltip.hide as ReturnType<typeof vi.fn>;
    const hideCallsBefore = tooltipHide.mock.calls.length;
    h.session.toggleUserPause();
    expect(h.loop.paused).toBe(true);
    h.session.renderFrame(0.05, 0.5, 4.0);
    expect(h.renderWorld.render).toHaveBeenLastCalledWith(h.session.simWorld, 0.05, 0.5, 4.0, 0);
    expect(tooltipHide.mock.calls.length).toBeGreaterThan(hideCallsBefore);
  });

  it('handles final-level win, story/endless loss payloads, hotkey/meteor edge guards, modal-paused speed, and idempotent dispose', () => {
    const lastIdx = LEVELS.length - 1;
    saveProgress({
      unlockedLevelIndex: lastIdx,
      bestStars: new Array<number>(LEVELS.length).fill(0),
      bestEndlessWaves: new Array<number>(LEVELS.length).fill(0),
    });
    const h = createHarness();
    h.session.startLevel(lastIdx);
    h.session.simWorld.gold = 2000;

    // Out-of-range tower hotkey leaves active placement intact; pressing same hotkey toggles OFF
    h.session.onHotkeyTower(0);
    expect(h.renderWorld.setPlacementGridActive).toHaveBeenLastCalledWith(true);
    h.session.onHotkeyTower(99);
    h.session.onHotkeyTower(-1);
    expect(h.renderWorld.setPlacementGridActive).toHaveBeenLastCalledWith(true);
    h.session.onHotkeyTower(0);
    expect(h.renderWorld.setPlacementGridActive).toHaveBeenLastCalledWith(false);

    // Place & upgrade tower, then verify setSelectedTowerRing refreshes and sellTower clears preview
    const t = h.session.simWorld.placeTower(
      LEVELS[lastIdx].scriptedBuildOrder?.[0]?.col ?? 4,
      LEVELS[lastIdx].scriptedBuildOrder?.[0]?.row ?? 2,
      'archer',
    );
    // Find any valid grass tile if scriptedBuildOrder[0] wasn't grass or wasn't present
    let tower = t;
    if (!tower) {
      for (let r = 0; r < h.session.simWorld.grid.rows && !tower; r++) {
        for (let c = 0; c < h.session.simWorld.grid.cols; c++) {
          if (h.session.simWorld.grid.canPlaceTower(c, r)) {
            tower = h.session.simWorld.placeTower(c, r, 'archer');
            break;
          }
        }
      }
    }
    expect(tower).not.toBeNull();
    h.session.selectTower(tower!.id);
    h.session.upgradeTower(tower!.id);
    expect(tower!.tier).toBe(2);
    expect(h.renderWorld.overlayIndicators.setSelectedTowerRing).toHaveBeenLastCalledWith(tower);
    h.session.sellTower(tower!.id);
    expect(h.renderWorld.overlayIndicators.setSelectedTowerRing).toHaveBeenLastCalledWith(null);

    // Meteor aim with null ground hit keeps meteor targeting active until a valid tap succeeds
    h.session.simWorld.startNextWave();
    h.session.activateAbility('meteor');
    const origScreenToPlane = h.cam.screenNdcToPlane.bind(h.cam);
    const screenSpy = vi.spyOn(h.cam, 'screenNdcToPlane').mockReturnValueOnce(null);
    h.session.onPrimaryTap(0, 0);
    expect(h.session.simWorld.abilitySystem.canCast('meteor')).toBe(true);
    screenSpy.mockImplementation(origScreenToPlane);

    // Final-level win passes hasNextLevel=false, closes stacked modals, clears placement/meteor, and clamps unlock
    h.session.openPauseMenu();
    h.session.simWorld.debugForceWin();
    expect(h.overlays.pauseMenu.isOpen()).toBe(false);
    expect(h.overlays.outcomeOverlay.showWin).toHaveBeenLastCalledWith(
      LEVELS[lastIdx],
      3,
      BALANCE.startingLives,
      expect.any(Number),
      false,
      null,
    );
    expect(loadProgress(LEVELS.length).unlockedLevelIndex).toBe(lastIdx);

    // enterEndlessMode while user-paused & with outcome modal open resumes play cleanly
    h.session.enterEndlessMode();
    expect(h.overlays.outcomeOverlay.isOpen()).toBe(false);
    expect(h.loop.paused).toBe(false);

    // Endless loss on a level with existing bestStars passes earnedStars and isEndless=true
    h.session.simWorld.lives = 1;
    const leaker = h.session.simWorld.enemySystem.spawnEnemy('grunt')!;
    leaker.dist = leaker.totalDist - 0.001;
    h.session.fixedTick(BALANCE.fixedDt);
    expect(h.overlays.outcomeOverlay.showLose).toHaveBeenLastCalledWith(
      LEVELS[lastIdx],
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ isEndless: true, earnedStars: 3 }),
    );

    // Story loss emits showLose with isEndless=false and earnedStars=0
    h.session.startLevel(0);
    h.session.simWorld.debugForceLose();
    expect(h.overlays.outcomeOverlay.showLose).toHaveBeenLastCalledWith(
      LEVELS[0],
      1,
      0,
      { isEndless: false, mvp: null, earnedStars: 0 },
    );

    // setSpeed while modal is open updates speed yet keeps loop paused; showMenuView(..., false) preserves simWorld
    h.session.startLevel(0);
    const simRef = h.session.simWorld;
    const loadCallsBeforeMenu = (h.renderWorld.loadLevel as ReturnType<typeof vi.fn>).mock.calls.length;
    h.session.openPauseMenu();
    h.session.setSpeed(2);
    expect(h.loop.speed).toBe(2);
    expect(h.loop.paused).toBe(true);
    h.session.closePauseMenu();
    expect(h.loop.paused).toBe(false);

    // Selected tower panel anchor re-projects across camera rotation during renderFrame
    h.session.simWorld.gold = 500;
    const anchorTower = h.session.simWorld.placeTower(4, 2, 'archer')!;
    h.session.selectTower(anchorTower.id);
    const anchorSpy = h.overlays.towerPanel.setAnchorScreenPos as ReturnType<typeof vi.fn>;
    const firstAnchor = anchorSpy.mock.calls[anchorSpy.mock.calls.length - 1];
    h.cam.rotate90(1);
    for (let i = 0; i < 30; i++) h.cam.update(1 / 60);
    h.session.renderFrame(1 / 60, 0, 1);
    const rotatedAnchor = anchorSpy.mock.calls[anchorSpy.mock.calls.length - 1];
    expect(rotatedAnchor[0]).not.toBeCloseTo(firstAnchor[0], 1);
    expect(rotatedAnchor[2]).toBe(1280);
    expect(rotatedAnchor[3]).toBe(720);

    h.session.showMenuView('levelSelect', false);
    expect(h.session.simWorld).toBe(simRef);
    expect((h.renderWorld.loadLevel as ReturnType<typeof vi.fn>).mock.calls.length).toBe(loadCallsBeforeMenu);

    // Double dispose is idempotent
    h.session.dispose();
    h.session.dispose();
  });
});
