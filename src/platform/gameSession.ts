import type { SoundManager } from '../audio/soundManager.ts';
import { EventBus } from '../core/eventBus.ts';
import type {
  AbilityId,
  EnemyType,
  GameSettings,
  ProgressData,
  SpeedMultiplier,
  TargetingMode,
  TowerType,
} from '../core/types.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import { LEVELS } from '../data/levels/index.ts';
import { TOWER_DEFS, TOWER_TYPES } from '../data/towers.ts';
import type { RenderWorld } from '../render/renderWorld.ts';
import { getTowerPickHeight } from '../render/towerPicking.ts';
import { SimWorld } from '../sim/world.ts';
import { STAR_REVEAL_DELAYS_MS } from '../ui/gameModals.ts';
import type { GameOverlays } from '../ui/gameOverlays.ts';
import type { RadialMenu } from '../ui/radialMenu.ts';
import type { GameLoop } from './browserLoop.ts';
import { isRadialActive } from './deviceClass.ts';
import { resolveTap, type GroundTileInfo, type TapTarget } from './tapResolution.ts';
import type { InputManager } from './input.ts';
import {
  bindSimEventBridge,
  buildAbilityBarState,
  buildHudStateView,
  recordEndlessProgress,
  recordWinProgress,
  stepPendingSpawns,
  updateHoverFeedback,
  updateMeteorPreviewFromNdc,
  updatePlacementPreviewFromNdc,
} from './sessionBridge.ts';
import {
  hasSeenUpgradeToast,
  loadProgress,
  loadSettings,
  markUpgradeToastSeen,
  saveProgress,
  saveSettings,
} from './storage.ts';
import type { RunModifiers } from '../data/runModifiers.ts';
import { buyRank, workshopModifiers, type WorkshopUpgradeId } from '../data/workshop.ts';
import { starWallet } from '../game/progression.ts';

/** Countdown / cooldown HUD refresh cadence when no event triggered a sync. */
const UI_SYNC_INTERVAL_SEC = 0.2;

export type ViewMode = 'menu' | 'levelSelect' | 'workshop' | 'playing';
export type SettingsOrigin = 'menu' | 'hud' | 'pause';

export interface SessionRuntimeDeps {
  overlays: GameOverlays;
  inputManager: InputManager;
  loop: GameLoop;
  setDebugVisible: (visible: boolean) => void;
  /** Touch build / tower menu; absent in tests. */
  radial?: RadialMenu;
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
  private readonly towerPanelAnchorOut = { x: 0, y: 0 };
  private simClockSec = 0;
  private activePlacementType: TowerType | null = null;
  private activeAbilityMode: AbilityId | null = null;
  private autoWaveEnabled = false;
  private routesPinned = false;
  private selectedTowerId: number | null = null;
  private sellConfirmTowerId: number | null = null;
  private sellConfirmDeadlineMs = 0;
  private lastClientX = -1;
  private lastClientY = -1;
  private lastNdcX = 0;
  private lastNdcY = 0;
  private pointerInside = false;
  private userPaused = false;
  /** Bumped on pointer movement/leave so hover refresh only runs when inputs changed. */
  private pointerVersion = 0;
  private lastHoverKey = '';
  /** Throttle for the per-frame HUD sync (countdowns / cooldowns); events sync immediately. */
  private uiSyncAccumSec = 0;
  private unbindSound: (() => void) | null = null;
  private deps: SessionRuntimeDeps | null = null;
  /** Tile whose ghost tower the radial build ring is previewing (survives pointer-leave refreshes). */
  private radialPreview: { type: TowerType; col: number; row: number } | null = null;
  private readonly starChimeTimers: number[] = [];

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
    const waveLabel = ws.isEndless
      ? `Wave ${ws.currentWaveOneBased} ∞`
      : `Wave ${ws.currentWaveOneBased}/${ws.totalWaves}`;
    return `${LEVELS[this.currentLevelIndex].name} · ${waveLabel}`;
  }

  syncLoopAndInput(): void {
    const { overlays, loop, inputManager } = this.d;
    const modalOpen = overlays.isModalOpen();
    if (modalOpen) this.deps?.radial?.close();
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
      buildHudStateView(this.simWorld, loop, this.routesPinned),
      buildAbilityBarState(this.simWorld, this.activeAbilityMode),
      this.activePlacementType,
      selectedTower,
      this.userPaused,
    );
    this.syncFlightPathHighlight();
  };

  refreshPlacementPreview(): void {
    const inPlayAndInside = this.viewMode === 'playing' && this.pointerInside;
    if (this.radialPreview && this.viewMode === 'playing') {
      const rp = this.radialPreview;
      const cost = TOWER_DEFS[rp.type].tiers[0].upgradeCost;
      const valid = this.simWorld.grid.canPlaceTower(rp.col, rp.row) && this.simWorld.gold >= cost;
      this.renderWorld.setPlacementPreview(
        true,
        rp.type,
        this.simWorld.grid.gridToWorldX(rp.col),
        this.simWorld.grid.gridToWorldZ(rp.row),
        valid,
      );
      return;
    }
    updatePlacementPreviewFromNdc(
      inPlayAndInside,
      this.activePlacementType,
      this.lastNdcX,
      this.lastNdcY,
      this.renderWorld,
      this.simWorld,
    );
    updateMeteorPreviewFromNdc(
      inPlayAndInside,
      this.activeAbilityMode,
      this.lastNdcX,
      this.lastNdcY,
      this.renderWorld,
    );
  }

  private clearSellConfirm(): void {
    if (this.sellConfirmTowerId === null) return;
    this.sellConfirmTowerId = null;
    this.sellConfirmDeadlineMs = 0;
    this.d.overlays.towerPanel.setSellConfirmArmed(false);
  }

  refreshHoverFeedback(): void {
    const { overlays, loop } = this.d;
    const aimingMeteor = this.activeAbilityMode === 'meteor';
    updateHoverFeedback(
      this.viewMode === 'playing',
      this.pointerInside,
      loop.paused,
      this.activePlacementType !== null || aimingMeteor,
      this.lastNdcX,
      this.lastNdcY,
      this.lastClientX,
      this.lastClientY,
      this.renderWorld,
      this.simWorld,
      overlays,
      this.selectedTowerId,
    );
  }

  selectTower(towerId: number | null): void {
    if (this.sellConfirmTowerId !== towerId) {
      this.clearSellConfirm();
    }
    this.selectedTowerId = towerId;
    const tower = towerId !== null ? this.simWorld.getTowerById(towerId) : null;
    this.renderWorld.overlayIndicators.setSelectedTowerRing(tower);
    this.syncUi();
    this.syncTowerPanelAnchor();
  }

  private syncFlightPathHighlight(): void {
    const inPlay = this.viewMode === 'playing';
    if (!inPlay) {
      this.renderWorld.setFlightPathHighlight(false);
      return;
    }
    this.renderWorld.setRoutesPinned(this.routesPinned);
    if (this.activePlacementType !== null) {
      // Bright when positioning anti-air towers, soft warning when placing ground-only towers
      this.renderWorld.setFlightPathHighlight(true, !TOWER_DEFS[this.activePlacementType].hitsFlyers);
      return;
    }
    const ws = this.simWorld.waveSystem;
    const nextHasFlyers =
      ws.getNextWavePreview()?.items.some((item) => ENEMY_DEFS[item.enemyType].flying) ?? false;
    const activeWave =
      ws.state === 'spawning' || ws.state === 'clearing'
        ? this.simWorld.level.waves[ws.currentWaveIndex]
        : undefined;
    const currentHasFlyers =
      ws.isEndless || (activeWave?.groups.some((g) => ENEMY_DEFS[g.enemyType].flying) ?? false);
    this.renderWorld.setFlightPathHighlight(nextHasFlyers || currentHasFlyers, true);
  }

  /** Records the current endless run (if any) so leaving/restarting mid-run keeps the best wave. */
  private recordEndlessIfActive(): void {
    if (this.viewMode !== 'playing') return;
    const ws = this.simWorld.waveSystem;
    if (!ws.isEndless) return;
    recordEndlessProgress(this.progress, this.currentLevelIndex, ws.currentWaveOneBased);
  }

  setPlacementMode(type: TowerType | null): void {
    this.activePlacementType = type;
    if (type !== null) {
      this.deps?.radial?.close(false);
      this.activeAbilityMode = null;
      this.selectTower(null);
    }
    const inPlay = this.viewMode === 'playing';
    this.renderWorld.setPlacementGridActive(inPlay && type !== null);
    this.syncFlightPathHighlight();
    this.refreshPlacementPreview();
    this.syncUi();
  }

  toggleBuildType(type: TowerType): void {
    this.soundManager.unlock();
    this.setPlacementMode(this.activePlacementType === type ? null : type);
  }

  toggleAutoWave(): void {
    this.soundManager.unlock();
    this.autoWaveEnabled = !this.autoWaveEnabled;
    this.simWorld.setAutoWave(this.autoWaveEnabled);
    this.syncUi();
  }

  toggleRoutesPinned(): void {
    this.soundManager.unlock();
    this.routesPinned = !this.routesPinned;
    this.syncFlightPathHighlight();
    this.syncUi();
  }

  activateAbility(id: AbilityId): void {
    if (this.viewMode !== 'playing' || this.d.overlays.isModalOpen()) return;
    if (this.simWorld.outcome !== 'ongoing' || this.simWorld.waveSystem.state === 'preFirstWave') {
      return;
    }
    this.soundManager.unlock();
    if (!this.simWorld.abilitySystem.canCast(id)) return;
    this.deps?.radial?.close();

    if (id === 'overcharge') {
      if (this.simWorld.castOvercharge()) {
        this.activeAbilityMode = null;
        this.refreshPlacementPreview();
        this.refreshHoverFeedback();
        this.syncUi();
      }
      return;
    }

    this.activeAbilityMode = this.activeAbilityMode === 'meteor' ? null : 'meteor';
    if (this.activeAbilityMode === 'meteor') {
      this.activePlacementType = null;
      this.renderWorld.setPlacementGridActive(false);
    }
    this.refreshPlacementPreview();
    this.refreshHoverFeedback();
    this.syncUi();
  }

  enterEndlessMode(): void {
    this.soundManager.unlock();
    if (!this.simWorld.enterEndlessMode()) return;
    const { overlays, loop } = this.d;
    // The win path pauses the loop via the outcome modal. Close every modal (a HUD-opened
    // Settings or the pause menu could still be stacked under the outcome card), drop any
    // stale user pause and restart the accumulator so play resumes at the chosen speed.
    overlays.closeModals();
    overlays.tooltip.hide();
    this.userPaused = false;
    loop.resetAccumulator();
    this.syncLoopAndInput();
    this.syncUi();
  }

  private clearTransientPlayState(): void {
    this.cancelStarChimes();
    this.pendingDebugSpawns.length = 0;
    this.deps?.radial?.close(false);
    this.radialPreview = null;
    this.clearSellConfirm();
    this.d.overlays.floatingTextPool.clear();
    this.d.overlays.tooltip.hide();
    this.d.overlays.toast.hide();
    this.renderWorld.setHoveredTowerId(null);
    this.renderWorld.setCanvasCursor('');
    this.renderWorld.setPlacementGridActive(false);
    this.renderWorld.setFlightPathHighlight(false);
    this.renderWorld.setRoutesPinned(false);
    this.renderWorld.setMeteorTargetPreview(false, 0, 0, 1);
    this.activePlacementType = null;
    this.activeAbilityMode = null;
    this.selectedTowerId = null;
    this.simClockSec = 0;
  }

  /** Chimes in sync with the victory star stamps; cancelled when the run is left early. */
  private scheduleStarChimes(stars: number): void {
    this.cancelStarChimes();
    for (let i = 0; i < stars; i++) {
      const delay = STAR_REVEAL_DELAYS_MS[i] ?? 0;
      this.starChimeTimers.push(window.setTimeout(() => this.soundManager.playStarChime(i), delay));
    }
  }

  private cancelStarChimes(): void {
    for (const t of this.starChimeTimers) window.clearTimeout(t);
    this.starChimeTimers.length = 0;
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
        const record = recordWinProgress(this.progress, this.currentLevelIndex, stars, livesRemaining);
        this.deps?.radial?.close();
        this.activeAbilityMode = null;
        this.setPlacementMode(null);
        overlays.tooltip.hide();
        overlays.closeModals();
        overlays.outcomeOverlay.showWin(
          LEVELS[this.currentLevelIndex],
          stars,
          livesRemaining,
          this.simWorld.enemiesKilledTotal,
          this.currentLevelIndex + 1 < LEVELS.length,
          this.simWorld.getMvpTowerSummary(),
          {
            record,
            startingLives: this.simWorld.startingLives,
            unlockedName: record.unlockedIndex !== null ? LEVELS[record.unlockedIndex]?.name : undefined,
          },
        );
        this.scheduleStarChimes(stars);
        this.syncLoopAndInput();
        this.syncUi();
      },
      onGameLost: (waveIndex, endless) => {
        this.deps?.radial?.close();
        this.activeAbilityMode = null;
        this.setPlacementMode(null);
        overlays.tooltip.hide();
        overlays.closeModals();
        const isEndless = Boolean(endless ?? this.simWorld.waveSystem.isEndless);
        if (isEndless) {
          recordEndlessProgress(this.progress, this.currentLevelIndex, waveIndex + 1);
        }
        overlays.outcomeOverlay.showLose(
          LEVELS[this.currentLevelIndex],
          waveIndex + 1,
          this.simWorld.enemiesKilledTotal,
          {
            isEndless,
            mvp: this.simWorld.getMvpTowerSummary(),
            earnedStars: isEndless ? (this.progress.bestStars[this.currentLevelIndex] ?? 0) : 0,
          },
        );
        this.syncLoopAndInput();
        this.syncUi();
      },
    });
  }

  /** Where the Workshop's back button returns to. */
  private workshopReturn: 'menu' | 'levelSelect' = 'menu';

  /** Modifiers for the next run: Workshop upgrades (+ challenge toggles once chosen). */
  buildRunModifiers(): RunModifiers {
    return workshopModifiers(this.progress.workshop);
  }

  openWorkshop(from: 'menu' | 'levelSelect'): void {
    this.workshopReturn = from;
    this.showMenuView('workshop');
  }

  closeWorkshop(): void {
    this.showMenuView(this.workshopReturn);
  }

  buyWorkshopUpgrade(id: WorkshopUpgradeId): boolean {
    this.soundManager.unlock();
    const next = buyRank(this.progress.workshop, id, starWallet(this.progress).available);
    if (!next) return false;
    this.progress.workshop = next;
    saveProgress(this.progress);
    this.soundManager.playUiConfirm();
    return true;
  }

  refundWorkshop(): void {
    this.soundManager.unlock();
    this.progress.workshop = {};
    saveProgress(this.progress);
    this.soundManager.playUiBack();
  }

  showMenuView(target: 'menu' | 'levelSelect' | 'workshop', reloadShowcase = false): void {
    const { overlays } = this.d;
    if (reloadShowcase) {
      this.recordEndlessIfActive();
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
    overlays.workshop.setOpen(target === 'workshop', this.progress);
    this.renderWorld.cameraController.setShowcaseMode(true);
    this.syncLoopAndInput();
    this.syncUi();
  }

  startLevel(levelIndex: number): void {
    const { overlays, loop } = this.d;
    this.recordEndlessIfActive();
    this.currentLevelIndex = Math.max(0, Math.min(LEVELS.length - 1, levelIndex));
    const level = LEVELS[this.currentLevelIndex];
    this.clearTransientPlayState();
    this.events.clear();
    this.events = new EventBus();
    this.simWorld = new SimWorld(level, this.events, this.buildRunModifiers());
    this.simWorld.setAutoWave(this.autoWaveEnabled);
    this.bindSimEvents(this.events);
    this.renderWorld.cameraController.setShowcaseMode(false);
    this.renderWorld.loadLevel(level, this.events, () => this.settings);

    this.viewMode = 'playing';
    this.userPaused = false;
    loop.speed = 1;
    overlays.mainMenu.setOpen(false);
    overlays.levelSelect.setOpen(false);
    overlays.workshop.setOpen(false);
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
    this.clearSellConfirm();
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
    this.pointerVersion++;
    this.refreshPlacementPreview();
    this.refreshHoverFeedback();
  }

  /** Pointer left the canvas (or the window lost focus): drop hover, ghost tower and tooltip. */
  onPointerLeave(): void {
    if (!this.pointerInside) return;
    this.pointerInside = false;
    this.pointerVersion++;
    this.refreshPlacementPreview();
    this.refreshHoverFeedback();
  }

  onPrimaryTap(ndcX: number, ndcY: number, shiftKey = false): void {
    this.soundManager.unlock();
    this.lastNdcX = ndcX;
    this.lastNdcY = ndcY;
    const hit = this.renderWorld.cameraController.screenNdcToPlane(ndcX, ndcY, 0);

    if (this.activeAbilityMode === 'meteor') {
      if (hit && this.simWorld.castMeteor(hit.x, hit.z)) {
        this.activeAbilityMode = null;
        this.refreshPlacementPreview();
        this.refreshHoverFeedback();
        this.syncUi();
      }
      return;
    }

    const silhouette = this.renderWorld.pickTowerAtNdc(ndcX, ndcY, this.simWorld.towers);
    const coord = hit ? this.simWorld.grid.worldToGrid(hit.x, hit.z) : null;
    const ground: GroundTileInfo | null = coord
      ? {
          col: coord.col,
          row: coord.row,
          towerId: this.simWorld.grid.getTowerIdAt(coord.col, coord.row),
          buildable: this.simWorld.grid.canPlaceTower(coord.col, coord.row),
        }
      : null;
    const target = resolveTap(ground, silhouette?.id ?? null);

    const radial = this.deps?.radial;
    if (radial && isRadialActive() && !this.activePlacementType) {
      this.onRadialTap(radial, target);
      return;
    }

    if (this.activePlacementType) {
      if (target.kind === 'tower') {
        this.setPlacementMode(null);
        this.selectTower(target.id);
        this.refreshHoverFeedback();
        return;
      }
      if (target.kind !== 'build') return;
      if (this.simWorld.placeTower(target.col, target.row, this.activePlacementType)) {
        if (!hasSeenUpgradeToast()) {
          markUpgradeToastSeen();
          this.d.overlays.toast.show(document.documentElement.classList.contains('is-touch') ? 'Tap a tower to upgrade or sell it' : 'Click a tower to upgrade or sell it');
        }
        if (!shiftKey) {
          this.setPlacementMode(null);
        } else {
          this.refreshPlacementPreview();
          this.syncUi();
        }
        this.refreshHoverFeedback();
      }
      return;
    }

    this.selectTower(target.kind === 'tower' ? target.id : null);
    this.refreshHoverFeedback();
  }

  /** Touch flow: tapping a tower / buildable tile opens the radial menu around it. */
  private onRadialTap(radial: RadialMenu, target: TapTarget): void {
    const open = radial.openedFor();
    if (target.kind === 'tower') {
      if (open?.kind === 'tower' && open.id === target.id) radial.close();
      else radial.openTower(target.id);
      return;
    }
    if (target.kind === 'build') {
      if (open?.kind === 'build' && open.col === target.col && open.row === target.row) {
        radial.close();
      } else {
        radial.openBuild(target.col, target.row);
      }
      return;
    }
    radial.close();
    this.selectTower(null);
  }

  /** The radial ring shows a ghost tower (and its range) on this tile; null clears it. */
  setRadialPlacementPreview(preview: { type: TowerType; col: number; row: number } | null): void {
    this.radialPreview = preview;
    this.renderWorld.setPlacementGridActive(this.viewMode === 'playing' && preview !== null);
    this.refreshPlacementPreview();
  }

  getSelectedTowerId(): number | null {
    return this.selectedTowerId;
  }

  isSellArmedFor(towerId: number): boolean {
    return this.sellConfirmTowerId === towerId && performance.now() <= this.sellConfirmDeadlineMs;
  }

  /** Builds `type` on a tile from the radial menu. Returns whether it was placed. */
  buildTowerAt(col: number, row: number, type: TowerType): boolean {
    this.soundManager.unlock();
    if (this.viewMode !== 'playing') return false;
    if (!this.simWorld.placeTower(col, row, type)) return false;
    if (!hasSeenUpgradeToast()) {
      markUpgradeToastSeen();
      this.d.overlays.toast.show('Tap a tower to upgrade or sell it');
    }
    this.refreshPlacementPreview();
    this.syncUi();
    return true;
  }

  /** Camera pan started: the radial build ring cancels (the tower ring just follows its anchor). */
  onUserPanStart(): void {
    this.deps?.radial?.onUserPan();
  }

  onTowerActionHotkey(action: 'upgrade' | 'sell' | 'target'): boolean {
    if (this.viewMode !== 'playing' || this.selectedTowerId === null) {
      return false;
    }
    const tower = this.simWorld.getTowerById(this.selectedTowerId);
    if (!tower) {
      this.selectTower(null);
      return false;
    }
    if (action === 'upgrade') {
      this.upgradeTower(tower.id);
      return true;
    }
    if (action === 'target') {
      const modes: readonly TargetingMode[] = ['first', 'last', 'strongest', 'closest'];
      const nextMode = modes[(modes.indexOf(tower.targetingMode) + 1) % modes.length];
      this.setTowerTargeting(tower.id, nextMode);
      return true;
    }

    const nowMs = performance.now();
    if (this.sellConfirmTowerId === tower.id && nowMs <= this.sellConfirmDeadlineMs) {
      this.sellTower(tower.id);
    } else {
      this.soundManager.unlock();
      this.sellConfirmTowerId = tower.id;
      this.sellConfirmDeadlineMs = nowMs + 3500;
      this.d.overlays.towerPanel.setSellConfirmArmed(true);
      this.syncUi();
    }
    return true;
  }

  onSecondaryAction(source: 'escape' | 'rightClick'): void {
    const { overlays } = this.d;
    if (overlays.settingsModal.isOpen()) return this.closeSettingsModal();
    if (overlays.pauseMenu.isOpen()) return this.closePauseMenu();
    if (this.deps?.radial?.isOpen()) return this.deps.radial.close();
    if (this.activeAbilityMode) {
      this.activeAbilityMode = null;
      this.refreshPlacementPreview();
      this.refreshHoverFeedback();
      this.syncUi();
      return;
    }
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

  private syncTowerPanelAnchor(): void {
    if (this.viewMode !== 'playing' || this.selectedTowerId === null) return;
    const tower = this.simWorld.getTowerById(this.selectedTowerId);
    if (!tower) return;
    const anchorY = getTowerPickHeight(tower.type, tower.tier) * 0.52;
    this.renderWorld.cameraController.worldCoordsToScreen(
      tower.x,
      anchorY,
      tower.z,
      this.towerPanelAnchorOut,
    );
    this.d.overlays.towerPanel.setAnchorScreenPos(
      this.towerPanelAnchorOut.x,
      this.towerPanelAnchorOut.y,
      window.innerWidth,
      window.innerHeight,
    );
  }

  renderFrame(frameDt: number, alpha: number, elapsedVisualTime: number): void {
    const { overlays, loop } = this.d;
    const inPlay = this.viewMode === 'playing';
    const fxDt = !inPlay || loop.paused ? 0 : frameDt * loop.speed;
    this.renderWorld.render(inPlay ? this.simWorld : null, frameDt, alpha, elapsedVisualTime, fxDt);
    overlays.floatingTextPool.update(
      fxDt > 0 ? frameDt : 0,
      (wx, wy, wz, out) => this.renderWorld.cameraController.worldCoordsToScreen(wx, wy, wz, out),
      inPlay ? frameDt : 0,
    );
    if (this.sellConfirmTowerId !== null && performance.now() > this.sellConfirmDeadlineMs) {
      this.clearSellConfirm();
      this.syncUi();
    }
    // Raycast-based hover only when something it depends on changed: pointer, camera view,
    // sim time (enemies moved) or pause state. Explicit state changes call it directly.
    const hoverKey = `${this.pointerVersion}|${this.renderWorld.cameraController.getViewVersion()}|${this.simClockSec}|${loop.paused ? 1 : 0}|${inPlay ? 1 : 0}`;
    if (hoverKey !== this.lastHoverKey) {
      this.lastHoverKey = hoverKey;
      this.refreshHoverFeedback();
    }
    if (inPlay) {
      overlays.toast.update(frameDt);
      // Discrete changes (gold, waves, towers, pause, speed…) sync via events/actions; this
      // throttled pass only keeps countdowns and ability cooldowns ticking.
      this.uiSyncAccumSec += frameDt;
      if (this.uiSyncAccumSec >= UI_SYNC_INTERVAL_SEC) {
        this.uiSyncAccumSec = 0;
        this.syncUi();
      }
      this.syncTowerPanelAnchor();
      this.deps?.radial?.update();
    }
  }

  dispose(): void {
    this.unbindSound?.();
    this.unbindSound = null;
  }
}
