import type { SoundManager } from '../audio/soundManager.ts';
import { EventBus } from '../core/eventBus.ts';
import type {
  EnemyType,
  GameSettings,
  ProgressData,
  SpeedMultiplier,
  TargetingMode,
  TowerType,
} from '../core/types.ts';
import { LEVELS } from '../data/levels/index.ts';
import { TOWER_DEFS, TOWER_TYPES } from '../data/towers.ts';
import type { RenderWorld } from '../render/renderWorld.ts';
import { SimWorld } from '../sim/world.ts';
import type { GameOverlays } from '../ui/gameOverlays.ts';
import type { GameLoop } from './browserLoop.ts';
import type { InputManager } from './input.ts';
import {
  bindSimEventBridge,
  buildHudStateView,
  recordWinProgress,
  stepPendingSpawns,
  updateEnemyHoverTooltip,
  updatePlacementPreviewFromNdc,
} from './sessionBridge.ts';
import { loadProgress, loadSettings, saveSettings } from './storage.ts';

export type ViewMode = 'menu' | 'levelSelect' | 'playing';
export type SettingsOrigin = 'menu' | 'hud' | 'pause';

export interface SessionRuntimeDeps {
  overlays: GameOverlays;
  inputManager: InputManager;
  loop: GameLoop;
  setDebugVisible: (visible: boolean) => void;
}

export class GameSession {
  settings: GameSettings = loadSettings();
  readonly progress: ProgressData = loadProgress(LEVELS.length);
  currentLevelIndex: number;
  viewMode: ViewMode = 'menu';
  settingsOrigin: SettingsOrigin = 'hud';

  events = new EventBus();
  simWorld: SimWorld;
  readonly pendingDebugSpawns: Array<{ type: EnemyType; delay: number }> = [];

  private readonly renderWorld: RenderWorld;
  private readonly soundManager: SoundManager;
  private simClockSec = 0;
  private activePlacementType: TowerType | null = null;
  private selectedTowerId: number | null = null;
  private lastClientX = -1;
  private lastClientY = -1;
  private lastNdcX = 0;
  private lastNdcY = 0;
  private pointerInside = false;
  private userPaused = false;
  private unbindSound: (() => void) | null = null;
  private deps: SessionRuntimeDeps | null = null;

  constructor(renderWorld: RenderWorld, soundManager: SoundManager) {
    this.renderWorld = renderWorld;
    this.soundManager = soundManager;
    this.renderWorld.setQuality(this.settings.quality);
    this.currentLevelIndex = Math.max(
      0,
      Math.min(LEVELS.length - 1, this.progress.unlockedLevelIndex),
    );
    this.simWorld = new SimWorld(LEVELS[this.currentLevelIndex], this.events);
  }

  attachRuntime(deps: SessionRuntimeDeps): void {
    this.deps = deps;
  }

  private get d(): SessionRuntimeDeps {
    if (!this.deps) throw new Error('GameSession runtime deps not attached');
    return this.deps;
  }

  pauseSubtitle(): string {
    const ws = this.simWorld.waveSystem;
    return `${LEVELS[this.currentLevelIndex].name} · Wave ${ws.currentWaveOneBased}/${ws.totalWaves}`;
  }

  syncLoopAndInput(): void {
    const { overlays, loop, inputManager } = this.d;
    const modalOpen = overlays.isModalOpen();
    loop.simActive = this.viewMode === 'playing';
    loop.paused = this.userPaused || modalOpen;
    inputManager.setEnabled(this.viewMode === 'playing');
    inputManager.setModalOpen(modalOpen);
  }

  syncUi = (): void => {
    const { overlays, loop, setDebugVisible } = this.d;
    const inPlay = this.viewMode === 'playing';
    overlays.setPlayVisibility(inPlay);
    setDebugVisible(inPlay);
    if (!inPlay) return;

    const selectedTower =
      this.selectedTowerId !== null ? this.simWorld.getTowerById(this.selectedTowerId) : null;
    if (this.selectedTowerId !== null && !selectedTower) {
      this.selectedTowerId = null;
      this.renderWorld.overlayIndicators.setSelectedTowerRing(null);
    }
    overlays.syncInPlay(
      buildHudStateView(this.simWorld, loop),
      this.activePlacementType,
      selectedTower,
      this.userPaused,
    );
  };

  refreshPlacementPreview(): void {
    updatePlacementPreviewFromNdc(
      this.viewMode === 'playing' && this.pointerInside,
      this.activePlacementType,
      this.lastNdcX,
      this.lastNdcY,
      this.renderWorld,
      this.simWorld,
    );
  }

  selectTower(towerId: number | null): void {
    this.selectedTowerId = towerId;
    const tower = towerId !== null ? this.simWorld.getTowerById(towerId) : null;
    this.renderWorld.overlayIndicators.setSelectedTowerRing(tower);
    this.syncUi();
  }

  setPlacementMode(type: TowerType | null): void {
    this.activePlacementType = type;
    if (type !== null) this.selectTower(null);
    const inPlay = this.viewMode === 'playing';
    this.renderWorld.setPlacementGridActive(inPlay && type !== null);
    const highlightFlight = inPlay && type !== null && !TOWER_DEFS[type].hitsFlyers;
    this.renderWorld.setFlightPathHighlight(highlightFlight);
    this.refreshPlacementPreview();
    this.syncUi();
  }

  toggleBuildType(type: TowerType): void {
    this.soundManager.unlock();
    this.setPlacementMode(this.activePlacementType === type ? null : type);
  }

  private clearTransientPlayState(): void {
    this.pendingDebugSpawns.length = 0;
    this.d.overlays.floatingTextPool.clear();
    this.d.overlays.tooltip.hide();
    this.d.overlays.toast.hide();
    this.renderWorld.setPlacementGridActive(false);
    this.renderWorld.setFlightPathHighlight(false);
    this.activePlacementType = null;
    this.selectedTowerId = null;
    this.simClockSec = 0;
  }

  private bindSimEvents(bus: EventBus): void {
    const { overlays } = this.d;
    this.unbindSound?.();
    this.unbindSound = bindSimEventBridge({
      bus,
      soundManager: this.soundManager,
      overlays,
      getSettings: () => this.settings,
      getSimClock: () => this.simClockSec,
      onSyncUi: this.syncUi,
      onGameWon: (stars, livesRemaining) => {
        recordWinProgress(this.progress, this.currentLevelIndex, stars);
        this.setPlacementMode(null);
        overlays.tooltip.hide();
        overlays.closeModals();
        overlays.outcomeOverlay.showWin(
          LEVELS[this.currentLevelIndex],
          stars,
          livesRemaining,
          this.simWorld.enemiesKilledTotal,
          this.currentLevelIndex + 1 < LEVELS.length,
        );
        this.syncLoopAndInput();
        this.syncUi();
      },
      onGameLost: (waveIndex) => {
        this.setPlacementMode(null);
        overlays.tooltip.hide();
        overlays.closeModals();
        overlays.outcomeOverlay.showLose(
          LEVELS[this.currentLevelIndex],
          waveIndex + 1,
          this.simWorld.enemiesKilledTotal,
        );
        this.syncLoopAndInput();
        this.syncUi();
      },
    });
  }

  showMenuView(target: 'menu' | 'levelSelect', reloadShowcase = false): void {
    const { overlays } = this.d;
    if (reloadShowcase) {
      this.clearTransientPlayState();
      this.events.clear();
      this.events = new EventBus();
      this.simWorld = new SimWorld(LEVELS[this.currentLevelIndex], this.events);
      this.renderWorld.loadLevel(LEVELS[this.currentLevelIndex], undefined, () => this.settings);
    }
    this.viewMode = target;
    overlays.closeModals();
    overlays.mainMenu.setOpen(target === 'menu', this.progress);
    overlays.levelSelect.setOpen(target === 'levelSelect', this.progress);
    this.renderWorld.cameraController.setShowcaseMode(true);
    this.syncLoopAndInput();
    this.syncUi();
  }

  startLevel(levelIndex: number): void {
    const { overlays, loop } = this.d;
    this.currentLevelIndex = Math.max(0, Math.min(LEVELS.length - 1, levelIndex));
    const level = LEVELS[this.currentLevelIndex];
    this.clearTransientPlayState();
    this.events.clear();
    this.events = new EventBus();
    this.simWorld = new SimWorld(level, this.events);
    this.bindSimEvents(this.events);
    this.renderWorld.cameraController.setShowcaseMode(false);
    this.renderWorld.loadLevel(level, this.events, () => this.settings);

    this.viewMode = 'playing';
    this.userPaused = false;
    loop.speed = 1;
    overlays.mainMenu.setOpen(false);
    overlays.levelSelect.setOpen(false);
    overlays.closeModals();
    this.refreshPlacementPreview();
    this.syncLoopAndInput();
    this.syncUi();
  }

  openSettingsModal(origin: SettingsOrigin): void {
    const { overlays } = this.d;
    this.settingsOrigin = origin;
    if (origin === 'pause') overlays.pauseMenu.setOpen(false);
    overlays.settingsModal.setOpen(true, this.settings, origin !== 'menu');
    this.syncLoopAndInput();
    this.syncUi();
  }

  closeSettingsModal(): void {
    const { overlays } = this.d;
    overlays.settingsModal.setOpen(false);
    if (this.settingsOrigin === 'pause') {
      overlays.pauseMenu.setOpen(true, this.pauseSubtitle());
    }
    this.syncLoopAndInput();
    this.syncUi();
  }

  openPauseMenu(): void {
    const { overlays } = this.d;
    if (this.viewMode !== 'playing' || overlays.outcomeOverlay.isOpen()) return;
    overlays.tooltip.hide();
    overlays.settingsModal.setOpen(false);
    overlays.pauseMenu.setOpen(true, this.pauseSubtitle());
    this.syncLoopAndInput();
    this.syncUi();
  }

  closePauseMenu(): void {
    this.d.overlays.pauseMenu.setOpen(false);
    this.syncLoopAndInput();
    this.syncUi();
  }

  setSpeed(sp: SpeedMultiplier): void {
    this.soundManager.unlock();
    this.d.loop.speed = sp;
    if (this.userPaused) this.userPaused = false;
    this.syncLoopAndInput();
    this.syncUi();
  }

  toggleUserPause(): void {
    if (this.d.overlays.isModalOpen()) return;
    this.userPaused = !this.userPaused;
    this.syncLoopAndInput();
    this.syncUi();
  }

  updateSettings(next: GameSettings): void {
    this.settings = next;
    saveSettings(next);
    this.soundManager.updateSettings(next);
    this.renderWorld.setQuality(next.quality);
  }

  upgradeTower(id: number): void {
    this.soundManager.unlock();
    if (this.simWorld.upgradeTower(id)) {
      this.renderWorld.overlayIndicators.setSelectedTowerRing(this.simWorld.getTowerById(id));
      this.syncUi();
    }
  }

  sellTower(id: number): void {
    this.soundManager.unlock();
    if (this.simWorld.sellTower(id) > 0) {
      this.selectTower(null);
      this.refreshPlacementPreview();
    }
  }

  setTowerTargeting(id: number, mode: TargetingMode): void {
    this.simWorld.setTowerTargeting(id, mode);
    this.syncUi();
  }

  onPointerMove(ndcX: number, ndcY: number, clientX: number, clientY: number): void {
    this.lastNdcX = ndcX;
    this.lastNdcY = ndcY;
    this.lastClientX = clientX;
    this.lastClientY = clientY;
    this.pointerInside = true;
    this.refreshPlacementPreview();
  }

  onPrimaryTap(ndcX: number, ndcY: number): void {
    this.soundManager.unlock();
    const hit = this.renderWorld.cameraController.screenNdcToPlane(ndcX, ndcY, 0);
    if (!hit) return;
    const coord = this.simWorld.grid.worldToGrid(hit.x, hit.z);
    if (!coord) return;
    if (this.activePlacementType) {
      if (this.simWorld.placeTower(coord.col, coord.row, this.activePlacementType)) {
        this.refreshPlacementPreview();
        this.syncUi();
      }
      return;
    }
    const towerId = this.simWorld.grid.getTowerIdAt(coord.col, coord.row);
    this.selectTower(towerId !== -1 ? towerId : null);
  }

  onSecondaryAction(source: 'escape' | 'rightClick'): void {
    const { overlays } = this.d;
    if (overlays.settingsModal.isOpen()) return this.closeSettingsModal();
    if (overlays.pauseMenu.isOpen()) return this.closePauseMenu();
    if (this.activePlacementType) return this.setPlacementMode(null);
    if (this.selectedTowerId !== null) return this.selectTower(null);
    if (source === 'escape' && this.viewMode === 'playing' && !overlays.outcomeOverlay.isOpen()) {
      this.openPauseMenu();
    }
  }

  onHotkeyTower(index: number): void {
    this.soundManager.unlock();
    const type = TOWER_TYPES[index];
    if (type) this.setPlacementMode(this.activePlacementType === type ? null : type);
  }

  fixedTick(dt: number): void {
    this.simClockSec += dt;
    stepPendingSpawns(this.pendingDebugSpawns, this.simWorld, dt);
    this.simWorld.fixedTick(dt);
  }

  renderFrame(frameDt: number, alpha: number, elapsedVisualTime: number): void {
    const { overlays, loop } = this.d;
    const inPlay = this.viewMode === 'playing';
    const fxDt = !inPlay || loop.paused ? 0 : frameDt * loop.speed;
    this.renderWorld.render(inPlay ? this.simWorld : null, frameDt, alpha, elapsedVisualTime, fxDt);
    overlays.floatingTextPool.update(fxDt > 0 ? frameDt : 0, (wx, wy, wz, out) =>
      this.renderWorld.cameraController.worldCoordsToScreen(wx, wy, wz, out),
    );
    updateEnemyHoverTooltip(
      inPlay,
      this.pointerInside,
      loop.paused,
      this.lastNdcX,
      this.lastNdcY,
      this.lastClientX,
      this.lastClientY,
      this.renderWorld,
      this.simWorld,
      overlays,
    );
    if (inPlay) {
      overlays.toast.update(frameDt);
      this.syncUi();
    }
  }

  dispose(): void {
    this.unbindSound?.();
    this.unbindSound = null;
  }
}
