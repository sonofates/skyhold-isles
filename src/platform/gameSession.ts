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
import { getTowerTierStats, TOWER_DEFS, TOWER_TYPES } from '../data/towers.ts';
import type { RenderWorld } from '../render/renderWorld.ts';
import { getTowerPickHeight } from '../render/towerPicking.ts';
import { SimWorld } from '../sim/world.ts';
import { STAR_REVEAL_DELAYS_MS } from '../ui/gameModals.ts';
import type { GameOverlays } from '../ui/gameOverlays.ts';
import type { ContentDirector } from '../ui/content/contentDirector.ts';
import type { OnboardingObs } from '../ui/content/onboardingMachine.ts';
import { collectHudRects } from '../ui/hudRects.ts';
import type { RadialMenu } from '../ui/radialMenu.ts';
import type { GameLoop } from './browserLoop.ts';
import { isRadialActive, isTouchDevice } from './deviceClass.ts';
import { bindHaptics, haptics } from './haptics.ts';
import { QualityController } from './qualityController.ts';
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
  backupProgressBeforeImport,
  resetProgressSave,
  saveProgress,
  saveSettings,
} from './storage.ts';
import type { RunModifiers } from '../data/runModifiers.ts';
import {
  applyDailyWin,
  dailyChallengeFor,
  utcDayNumber,
  type DailyChallenge,
} from '../data/daily.ts';
import {
  CHALLENGES,
  challengesForLevel,
  isChallengeId,
  runModifiersFor,
  type ChallengeId,
} from '../data/challenges.ts';
import { STAR_RULES } from '../data/stars.ts';
import {
  ENDLESS_TIERS,
  endlessTier,
  ENDLESS_MUTATOR_INTERVAL,
  endlessMutatorsAt,
  newEndlessMutatorAt,
} from '../data/endlessMutators.ts';
import type { EndlessResultView } from '../ui/gameModals.ts';
import { affordableUpgradeCount } from '../ui/workshop.ts';
import { buyRank, workshopModifiers, type WorkshopUpgradeId } from '../data/workshop.ts';
import { isEndlessBestCrossing, isIslandMastered, starWallet } from '../game/progression.ts';
import { badgesForWin, resolveRunConfig, type RunConfig } from '../game/runConfig.ts';
import { earnedFeatIds, newlyEarnedFeats, type FeatDef } from '../game/feats.ts';
import { dailyShareText } from '../game/share.ts';
import { decodeSaveCode, describeMergeGain, encodeSaveCode, mergeProgress } from './saveCode.ts';

/** Countdown / cooldown HUD refresh cadence when no event triggered a sync. */
const UI_SYNC_INTERVAL_SEC = 0.2;

export type ViewMode = 'menu' | 'levelSelect' | 'workshop' | 'playing';
export type SettingsOrigin = 'menu' | 'hud' | 'pause';

export type { RunConfig } from '../game/runConfig.ts';

export interface SessionRuntimeDeps {
  overlays: GameOverlays;
  inputManager: InputManager;
  loop: GameLoop;
  setDebugVisible: (visible: boolean) => void;
  /** Touch build / tower menu; absent in tests. */
  radial?: RadialMenu;
  /** Onboarding / first-sighting cards / codex; absent in tests. */
  content?: ContentDirector;
}

/** `?perf` in the URL logs quality-tier changes to the console (for tuning the governor from device reports). */
function perfLogEnabled(): boolean {
  return typeof location !== 'undefined' && /[?&]perf\b/.test(location.search);
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
  private unbindHaptics: (() => void) | null = null;
  private deps: SessionRuntimeDeps | null = null;
  private readonly quality: QualityController;
  /** Tile whose ghost tower the radial build ring is previewing (survives pointer-leave refreshes). */
  private radialPreview: { type: TowerType; col: number; row: number } | null = null;
  private readonly starChimeTimers: number[] = [];

  constructor(renderWorld: RenderWorld, soundManager: SoundManager) {
    this.renderWorld = renderWorld;
    this.soundManager = soundManager;
    this.quality = new QualityController(
      (tier) => {
        if (perfLogEnabled()) console.info(`[skyhold] quality tier -> ${tier}`);
        this.renderWorld.setQuality(tier);
      },
      isTouchDevice,
    );
    this.quality.setSetting(this.settings.quality);
    haptics.setEnabled(this.settings.haptics && isTouchDevice());
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

  /** Short label for the debug overlay, e.g. `auto→medium` or `high`. */
  qualityLabel(): string {
    return this.quality.isAuto ? `auto→${this.quality.tier}` : this.quality.tier;
  }

  pauseSubtitle(): string {
    const ws = this.simWorld.waveSystem;
    const waveLabel = ws.isEndless
      ? `Wave ${ws.currentWaveOneBased} ∞`
      : `Wave ${ws.currentWaveOneBased}/${ws.totalWaves}`;
    const challenges = this.runConfig.challenges.map((id) => CHALLENGES[id].name);
    const daily = this.runConfig.daily !== null ? 'Daily: ' : '';
    const tag = challenges.length > 0 ? ` · ${daily}${challenges.join(' + ')}` : '';
    return `${LEVELS[this.currentLevelIndex].name} · ${waveLabel}${tag}`;
  }

  /** Pause card detail: lives lost vs the star goals, or the endless mutators in play. */
  pauseRunInfo(): string | null {
    const w = this.simWorld;
    const ws = w.waveSystem;
    const level = w.level;
    if (ws.isEndless) {
      const offset = ws.currentWaveIndex - level.waves.length;
      if (offset < 0) return null;
      const muts = endlessMutatorsAt(offset, level.index).map((m) => m.name);
      return muts.length > 0
        ? `<span class="pri-label">Mutators</span> ${muts.join(' · ')}`
        : `<span class="pri-label">Mutators</span> first one at endless wave ${ENDLESS_MUTATOR_INTERVAL + 1}`;
    }
    const rule = STAR_RULES[level.difficulty] ?? STAR_RULES.Breezy;
    const lost = Math.max(0, w.startingLives - w.lives);
    const stars = w.computeStars();
    const next =
      stars === 3
        ? `3★ holds while you lose ≤ ${rule.threeStarMaxLost}`
        : stars === 2
          ? `2★ holds while you lose ≤ ${rule.twoStarMaxLost}`
          : '1★ — any win counts';
    return `<span class="pri-label">Lives lost ${lost}</span> ${next}`;
  }

  syncLoopAndInput(): void {
    const { overlays, loop, inputManager } = this.d;
    const modalOpen = overlays.isModalOpen() || (this.deps?.content?.isBlocking() ?? false);
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
    this.deps?.content?.observe(this.buildOnboardingObs(selectedTower !== null));
  };

  /** Snapshot of what the player is doing, for the first-run tour. */
  private buildOnboardingObs(towerSelected: boolean): OnboardingObs {
    const sim = this.simWorld;
    const ws = sim.waveSystem;
    const radialMode = this.deps?.radial?.openedFor()?.kind ?? 'closed';
    let maxTier = 0;
    let cheapestUpgrade = Infinity;
    for (const t of sim.towers) {
      if (t.tier > maxTier) maxTier = t.tier;
      if (t.tier < 3) {
        const cost = getTowerTierStats(t.type, (t.tier + 1) as 2 | 3).upgradeCost;
        if (cost < cheapestUpgrade) cheapestUpgrade = cost;
      }
    }
    const overlays = this.deps?.overlays;
    return {
      inPlay: this.viewMode === 'playing',
      levelIndex: this.currentLevelIndex,
      touch: isRadialActive(),
      modalOpen: overlays?.isModalOpen() ?? false,
      towerCount: sim.towers.length,
      maxTier,
      towerSelected: towerSelected || radialMode === 'tower',
      placementActive: this.activePlacementType !== null,
      radialMode,
      wavesStarted: ws.currentWaveOneBased,
      gold: sim.gold,
      cheapestUpgrade,
      meteorReady: ws.state !== 'preFirstWave' && sim.abilitySystem.canCast('meteor'),
      meteorAiming: this.activeAbilityMode === 'meteor',
    };
  }

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

  /**
   * Records the current endless run (if any) so leaving/restarting mid-run keeps the best wave.
   * Returns feats that record just earned (announced by the caller once the view has changed).
   */
  private recordEndlessIfActive(): FeatDef[] {
    if (this.viewMode !== 'playing') return [];
    const ws = this.simWorld.waveSystem;
    // Endless started from the island card: story waves never count as an endless record.
    if (!ws.isEndless || ws.currentWaveIndex < this.simWorld.level.waves.length) return [];
    const featsBefore = earnedFeatIds(this.progress);
    recordEndlessProgress(this.progress, this.currentLevelIndex, ws.currentWaveOneBased);
    return newlyEarnedFeats(featsBefore, this.progress);
  }

  private announceFeats(feats: readonly FeatDef[]): void {
    if (feats.length === 0) return;
    this.d.overlays.toast.show(`Feat earned: ${feats.map((f) => f.name).join(', ')}`, 4);
    this.soundManager.playStarChime(2);
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
    if (this.activePlacementType !== type && this.isBanned(type)) return;
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
    if (this.simWorld.mods.abilitiesDisabled) {
      this.d.overlays.toast.show('Abilities are off in this challenge', 2.5);
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
    this.unbindHaptics?.();
    this.unbindHaptics = bindHaptics(bus);
    this.unbindSound = bindSimEventBridge({
      bus,
      suppressIntroToasts: this.deps?.content !== undefined,
      soundManager: this.soundManager,
      overlays,
      getSettings: () => this.settings,
      getSimClock: () => this.simClockSec,
      onSyncUi: this.syncUi,
      onGameWon: (stars, livesRemaining) => {
        // Island badges only for the island's own challenges (a Daily may use others).
        const offered = challengesForLevel(LEVELS[this.currentLevelIndex]);
        const masteredBefore = isIslandMastered(this.progress, this.currentLevelIndex, offered);
        const featsBefore = earnedFeatIds(this.progress);
        const record = recordWinProgress(
          this.progress,
          this.currentLevelIndex,
          stars,
          livesRemaining,
          badgesForWin(offered, this.runConfig.challenges),
        );
        let dailyStreak = 0;
        if (this.runConfig.daily !== null) {
          const res = applyDailyWin(
            this.progress.daily,
            this.runConfig.daily,
            utcDayNumber(Date.now()),
          );
          if (res.counted) {
            dailyStreak = res.streak;
            saveProgress(this.progress);
          }
        }
        this.deps?.content?.onLevelWon(this.currentLevelIndex);
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
            newChallengeNames: record.newChallenges.map((id) =>
              isChallengeId(id) ? CHALLENGES[id].name : id,
            ),
            workshopStars:
              affordableUpgradeCount(this.progress) > 0 ? starWallet(this.progress).available : 0,
            dailyStreak,
            newlyMastered:
              !masteredBefore && isIslandMastered(this.progress, this.currentLevelIndex, offered),
            newFeats: newlyEarnedFeats(featsBefore, this.progress),
            shareText:
              this.runConfig.daily !== null
                ? dailyShareText({
                    day: this.runConfig.daily,
                    islandName: LEVELS[this.currentLevelIndex].name,
                    challenges: this.runConfig.challenges,
                    stars,
                    livesLost: Math.max(0, this.simWorld.startingLives - livesRemaining),
                    streak: dailyStreak,
                  })
                : undefined,
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
        const level = LEVELS[this.currentLevelIndex];
        let endlessResult: EndlessResultView | undefined;
        if (isEndless) {
          const offset = waveIndex - level.waves.length;
          if (offset >= 0) {
            const featsBefore = earnedFeatIds(this.progress);
            const rec = recordEndlessProgress(this.progress, this.currentLevelIndex, waveIndex + 1);
            const tierBefore = endlessTier(rec.previousBest, level.waves.length);
            const tierNow = endlessTier(rec.best, level.waves.length);
            endlessResult = {
              newTierName: tierNow > tierBefore ? ENDLESS_TIERS[tierNow - 1].name : undefined,
              best: rec.best,
              previousBest: rec.previousBest,
              isNewBest: rec.isNewBest,
              reachedEndless: true,
              endlessWavesCleared: offset,
              mutators: endlessMutatorsAt(offset, level.index).map((m) => m.name),
              newFeats: newlyEarnedFeats(featsBefore, this.progress),
            };
          } else {
            // Fell during the story waves of an island-card Endless run: no record.
            const best = this.progress.bestEndlessWaves[this.currentLevelIndex] ?? 0;
            endlessResult = {
              best,
              previousBest: best,
              isNewBest: false,
              reachedEndless: false,
              endlessWavesCleared: 0,
              mutators: [],
            };
          }
        }
        overlays.outcomeOverlay.showLose(level, waveIndex + 1, this.simWorld.enemiesKilledTotal, {
          isEndless,
          mvp: this.simWorld.getMvpTowerSummary(),
          earnedStars: isEndless ? (this.progress.bestStars[this.currentLevelIndex] ?? 0) : 0,
          endless: endlessResult,
          startingLives: this.simWorld.startingLives,
          workshopStars:
            !isEndless && affordableUpgradeCount(this.progress) > 0 ? starWallet(this.progress).available : 0,
        });
        this.syncLoopAndInput();
        this.syncUi();
      },
    });
  }

  /** Where the Workshop's back button returns to. */
  private workshopReturn: 'menu' | 'levelSelect' = 'menu';

  /** How the current run was started (kept for Restart / Retry). */
  private runConfig: RunConfig = { endless: false, challenges: [], daily: null };

  /** Modifiers for a run: Workshop upgrades + the run's challenge toggles. */
  buildRunModifiers(challenges: readonly ChallengeId[] = []): RunModifiers {
    return runModifiersFor(workshopModifiers(this.progress.workshop), challenges);
  }

  /** Challenges currently active (empty for a normal run). */
  getRunConfig(): Readonly<RunConfig> {
    return this.runConfig;
  }

  /** Island select → card button: cleared islands open the briefing, new ones start at once. */
  selectIsland(levelIndex: number): void {
    this.soundManager.unlock();
    const idx = Math.max(0, Math.min(LEVELS.length - 1, levelIndex));
    if ((this.progress.clears[idx] ?? 0) > 0) {
      this.d.overlays.islandBriefing.show(idx, this.progress);
      return;
    }
    this.startLevel(idx);
  }

  /** Settings (menu) → Reset progress, after the in-dialog confirm. The old save is backed up. */
  resetProgress(): void {
    const fresh = resetProgressSave(LEVELS.length);
    Object.assign(this.progress, fresh);
    this.currentLevelIndex = 0;
    this.runConfig = { endless: false, challenges: [], daily: null };
    this.soundManager.playUiBack();
    this.d.overlays.mainMenu.setOpen(this.viewMode === 'menu', this.progress);
    this.d.overlays.toast.show('Progress reset — a backup of the old save was kept.', 3);
  }

  exportSaveCode(): string {
    return encodeSaveCode(this.progress);
  }

  /** Settings → Save code → Load: merges a pasted save (best of both), backs up the old one. */
  importSaveCode(code: string): { ok: boolean; message: string } {
    const res = decodeSaveCode(code, LEVELS.length);
    if (!res.ok) {
      this.soundManager.playUiBack();
      return { ok: false, message: res.error };
    }
    const merged = mergeProgress(this.progress, res.progress, LEVELS.length);
    const gain = describeMergeGain(this.progress, merged);
    backupProgressBeforeImport();
    Object.assign(this.progress, merged);
    saveProgress(this.progress);
    this.soundManager.playUiConfirm();
    this.d.overlays.mainMenu.setOpen(this.viewMode === 'menu', this.progress);
    return { ok: true, message: `Loaded: ${gain}.` };
  }

  /** Today's Daily Squall (UTC day), or null until an island has been cleared. */
  todaysDaily(): DailyChallenge | null {
    const cleared: number[] = [];
    for (let i = 0; i < LEVELS.length; i++) if ((this.progress.clears[i] ?? 0) > 0) cleared.push(i);
    return dailyChallengeFor(utcDayNumber(Date.now()), cleared);
  }

  openDaily(): void {
    this.soundManager.unlock();
    this.d.overlays.daily.show(this.todaysDaily(), this.progress);
  }

  startDaily(shown?: DailyChallenge): void {
    const d = shown ?? this.todaysDaily();
    if (!d) return;
    this.startLevel(d.levelIndex, { challenges: [...d.challenges], daily: d.day });
  }

  openLogbook(): void {
    this.soundManager.unlock();
    this.d.overlays.logbook.show(this.progress);
  }

  /** Escape outside gameplay: closes the island briefing, then backs out of the Workshop. */
  onMenuEscape(): boolean {
    const { overlays } = this.d;
    if (this.viewMode === 'playing') return false;
    if (overlays.settingsModal.isOpen()) return false;
    if (overlays.islandBriefing.isOpen()) {
      overlays.islandBriefing.close();
      return true;
    }
    if (overlays.logbook.isOpen()) {
      overlays.logbook.hide();
      return true;
    }
    if (overlays.daily.isOpen()) {
      overlays.daily.hide();
      return true;
    }
    if (this.viewMode === 'workshop') {
      this.closeWorkshop();
      return true;
    }
    return false;
  }

  /** Restart / Retry: same island, same mode and challenges. */
  restartLevel(): void {
    this.startLevel(this.currentLevelIndex, this.runConfig);
  }

  /** Banned towers can't be picked from the build bar / hotkeys; the radial ring greys them via CSS. */
  private isBanned(type: TowerType): boolean {
    if (!this.simWorld.isTowerBanned(type)) return false;
    this.d.overlays.toast.show(`${TOWER_DEFS[type].name} is off-limits in this challenge`, 2.5);
    return true;
  }

  private applyBannedTowerMarkers(): void {
    const banned = this.viewMode === 'playing' ? this.simWorld.mods.bannedTowers : [];
    if (banned.length > 0) document.documentElement.dataset.bannedTowers = banned.join(' ');
    else delete document.documentElement.dataset.bannedTowers;
  }

  private announceRun(): void {
    const level = LEVELS[this.currentLevelIndex];
    const { challenges, endless, daily } = this.runConfig;
    if (daily !== null) {
      const names = challenges.map((id) => CHALLENGES[id].name).join(' + ');
      const today = utcDayNumber(Date.now());
      const done = this.progress.daily.lastDay === daily || daily < today - 1;
      this.d.overlays.toast.show(
        `Daily Squall: ${names}${done ? ' — no daily star this time' : ' — win for +1★ (badges extra)'}`,
        5,
      );
    } else if (challenges.length > 0) {
      const names = challenges.map((id) => CHALLENGES[id].name).join(' + ');
      this.d.overlays.toast.show(`Challenge: ${names} — win for +${challenges.length}★`, 5);
    } else if (endless) {
      const best = this.progress.bestEndlessWaves[this.currentLevelIndex] ?? 0;
      this.d.overlays.toast.show(
        `Endless on ${level.name}${best > 0 ? ` · best wave ${best}` : ''} — a new mutator joins every ${ENDLESS_MUTATOR_INTERVAL} endless waves`,
        5,
      );
    }
  }

  openWorkshop(from: 'menu' | 'levelSelect'): void {
    this.workshopReturn = from;
    this.showMenuView('workshop');
  }

  /** From a results card: tear the finished run down and open the Workshop (Back → islands). */
  openWorkshopFromRun(): void {
    this.soundManager.unlock();
    this.workshopReturn = 'levelSelect';
    this.showMenuView('workshop', true);
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
    let feats: FeatDef[] = [];
    if (reloadShowcase) {
      feats = this.recordEndlessIfActive();
      this.clearTransientPlayState();
      this.events.clear();
      this.events = new EventBus();
      this.simWorld = new SimWorld(LEVELS[this.currentLevelIndex], this.events);
      this.renderWorld.loadLevel(LEVELS[this.currentLevelIndex], undefined, () => this.settings);
    }
    this.viewMode = target;
    this.deps?.content?.onLeavePlay();
    this.applyBannedTowerMarkers();
    overlays.closeModals();
    overlays.mainMenu.setOpen(target === 'menu', this.progress);
    overlays.levelSelect.setOpen(target === 'levelSelect', this.progress);
    overlays.workshop.setOpen(target === 'workshop', this.progress);
    this.renderWorld.cameraController.setShowcaseMode(true);
    this.syncLoopAndInput();
    this.syncUi();
    this.announceFeats(feats);
  }

  startLevel(levelIndex: number, config: Partial<RunConfig> = {}): void {
    const { overlays, loop } = this.d;
    const feats = this.recordEndlessIfActive();
    this.currentLevelIndex = Math.max(0, Math.min(LEVELS.length - 1, levelIndex));
    const level = LEVELS[this.currentLevelIndex];
    // Challenges and island-card Endless unlock after the first clear.
    const cleared = (this.progress.clears[this.currentLevelIndex] ?? 0) > 0;
    this.runConfig = resolveRunConfig(level, cleared, config);
    this.clearTransientPlayState();
    this.events.clear();
    this.events = new EventBus();
    this.simWorld = new SimWorld(level, this.events, this.buildRunModifiers(this.runConfig.challenges));
    if (this.runConfig.endless) this.simWorld.startEndlessFromStart();
    this.simWorld.setAutoWave(this.autoWaveEnabled);
    this.bindSimEvents(this.events);
    this.deps?.content?.bindLevel(this.events, level, this.currentLevelIndex);
    // Read once per run: the record only changes when this run ends.
    const endlessBest = this.progress.bestEndlessWaves[this.currentLevelIndex] ?? 0;
    this.events.on('waveStarted', (ev) => {
      if (!ev.endless) return;
      const mut = newEndlessMutatorAt(ev.waveIndex - level.waves.length, level.index);
      const best = isEndlessBestCrossing(endlessBest, ev.waveIndex + 1);
      if (best) this.soundManager.playStarChime(2);
      else if (mut) this.soundManager.playBossPulse();
      if (best || mut) {
        const parts: string[] = [];
        if (best) parts.push(`New best — past wave ${endlessBest}!`);
        if (mut) parts.push(`Mutator: ${mut.name} — ${mut.description}`);
        this.d.overlays.toast.show(parts.join(' · '), 4);
      }
    });
    this.renderWorld.cameraController.setShowcaseMode(false);
    this.renderWorld.loadLevel(level, this.events, () => this.settings);
    this.quality.rearm();

    this.viewMode = 'playing';
    this.userPaused = false;
    loop.speed = 1;
    overlays.mainMenu.setOpen(false);
    overlays.levelSelect.setOpen(false);
    overlays.workshop.setOpen(false);
    overlays.closeModals();
    this.applyBannedTowerMarkers();
    this.announceRun();
    this.announceFeats(feats);
    this.refreshPlacementPreview();
    this.syncLoopAndInput();
    this.syncUi();
    // The HUD is laid out now: frame the island clear of its controls.
    this.renderWorld.cameraController.setHudRects(collectHudRects());
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
      overlays.pauseMenu.setRunInfo(this.pauseRunInfo());
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
    overlays.pauseMenu.setRunInfo(this.pauseRunInfo());
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

  /**
   * The page went to the background (tab hidden, phone locked, app switched): freeze play so the
   * player does not come back to a lost wave, and re-arm the quality governor for the resume hitch.
   */
  enterBackground(): void {
    this.pauseIfRunning();
    this.soundManager.suspendForBackground();
    this.quality.rearm();
  }

  /** Freezes play (user pause) when a level is running and nothing else already paused it. */
  pauseIfRunning(): void {
    const overlays = this.deps?.overlays;
    if (overlays && this.viewMode === 'playing' && !this.userPaused && !overlays.isModalOpen()) {
      this.userPaused = true;
      this.syncLoopAndInput();
      this.syncUi();
    }
  }

  returnFromBackground(): void {
    this.soundManager.resumeFromBackground();
    this.quality.rearm();
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
    this.quality.setSetting(next.quality);
    haptics.setEnabled(next.haptics && isTouchDevice());
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

  /** What a tap at this screen position means (ground tile first, tower silhouette as fallback). */
  private tapTargetAt(ndcX: number, ndcY: number, hit: { x: number; z: number } | null): TapTarget {
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
    return resolveTap(ground, silhouette?.id ?? null);
  }

  /** Long press (touch): a tower opens straight into its info card. */
  onLongPress(ndcX: number, ndcY: number): void {
    const radial = this.deps?.radial;
    if (this.viewMode !== 'playing' || !radial || !isRadialActive()) return;
    if (this.activeAbilityMode || this.activePlacementType) return;
    const hit = this.renderWorld.cameraController.screenNdcToPlane(ndcX, ndcY, 0);
    const target = this.tapTargetAt(ndcX, ndcY, hit);
    if (target.kind !== 'tower') return;
    haptics.pulse('longPress');
    radial.openTowerInfo(target.id);
  }

  /**
   * Double tap (touch): on empty map (nothing to select or build) the camera returns to its default
   * framing. Returns true when handled, so the tap is not also treated as a normal tap.
   */
  onDoubleTap(ndcX: number, ndcY: number): boolean {
    if (this.viewMode !== 'playing' || this.activeAbilityMode) return false;
    const hit = this.renderWorld.cameraController.screenNdcToPlane(ndcX, ndcY, 0);
    if (this.tapTargetAt(ndcX, ndcY, hit).kind !== 'none') return false;
    haptics.pulse('tap');
    this.renderWorld.cameraController.recenter();
    return true;
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

    const target = this.tapTargetAt(ndcX, ndcY, hit);

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
      else {
        haptics.pulse('tap');
        radial.openTower(target.id);
      }
      return;
    }
    if (target.kind === 'build') {
      if (open?.kind === 'build' && open.col === target.col && open.row === target.row) {
        radial.close();
      } else {
        haptics.pulse('tap');
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
    if (!type || (this.activePlacementType !== type && this.isBanned(type))) return;
    this.setPlacementMode(this.activePlacementType === type ? null : type);
  }

  fixedTick(dt: number): void {
    // A first-sighting card opened mid-frame: drop the rest of this frame's catch-up ticks.
    if (this.deps?.content?.isBlocking()) return;
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
    this.quality.frame(frameDt * 1000);
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
      this.deps?.content?.updateMarker((col, row, out) => {
        const cam = this.renderWorld.cameraController;
        cam.worldCoordsToScreen(this.simWorld.grid.gridToWorldX(col), 0.35, this.simWorld.grid.gridToWorldZ(row), out);
        return out.x > 8 && out.y > 8 && out.x < window.innerWidth - 8 && out.y < window.innerHeight - 8;
      });
    }
  }

  dispose(): void {
    this.unbindSound?.();
    this.unbindSound = null;
    this.unbindHaptics?.();
    this.unbindHaptics = null;
  }
}
