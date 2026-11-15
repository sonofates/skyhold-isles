import type {
  GameSettings,
  SpeedMultiplier,
  TargetingMode,
  TowerType,
} from '../core/types.ts';
import type { TowerEntity } from '../sim/entities.ts';
import { BuildBar } from './buildBar.ts';
import { FloatingTextPool } from './floatingText.ts';
import { OutcomeOverlay, PauseMenuModal } from './gameModals.ts';
import { HudBar, type HudStateView } from './hud.ts';
import { LevelSelectOverlay, MainMenuOverlay } from './menus.ts';
import { SettingsModal } from './settingsModal.ts';
import { GameToast } from './toast.ts';
import { EnemyTooltip } from './tooltip.ts';
import { TowerPanel } from './towerPanel.ts';

export interface GameOverlayCallbacks {
  initialSettings: GameSettings;
  onStartWave: () => void;
  onSetSpeed: (speed: SpeedMultiplier) => void;
  onTogglePause: () => void;
  onOpenSettings: () => void;
  onOpenMenu: () => void;
  onRotateCamera: (dir: -1 | 1) => void;
  onSelectBuildType: (type: TowerType) => void;
  onUpgradeTower: (id: number) => void;
  onSellTower: (id: number) => void;
  onSetTargeting: (id: number, mode: TargetingMode) => void;
  onCloseTowerPanel: () => void;
  onPlayFromMenu: (levelIndex: number) => void;
  onOpenLevelSelectFromMenu: () => void;
  onOpenSettingsFromMenu: () => void;
  onSelectLevel: (levelIndex: number) => void;
  onBackFromLevelSelect: () => void;
  onResumeFromPause: () => void;
  onRestartLevel: () => void;
  onOpenSettingsFromPause: () => void;
  onOpenLevelSelectFromPause: () => void;
  onMainMenuFromPause: () => void;
  onNextLevel: () => void;
  onSettingsChange: (next: GameSettings) => void;
  onSettingsClose: () => void;
}

export class GameOverlays {
  readonly floatingTextPool: FloatingTextPool;
  readonly tooltip: EnemyTooltip;
  readonly toast: GameToast;
  readonly hudBar: HudBar;
  readonly buildBar: BuildBar;
  readonly towerPanel: TowerPanel;
  readonly mainMenu: MainMenuOverlay;
  readonly levelSelect: LevelSelectOverlay;
  readonly pauseMenu: PauseMenuModal;
  readonly outcomeOverlay: OutcomeOverlay;
  readonly settingsModal: SettingsModal;
  private readonly pauseBanner: HTMLDivElement;

  constructor(uiRoot: HTMLElement, cb: GameOverlayCallbacks) {
    this.floatingTextPool = new FloatingTextPool(uiRoot);
    this.tooltip = new EnemyTooltip(uiRoot);
    this.toast = new GameToast(uiRoot);

    this.pauseBanner = document.createElement('div');
    this.pauseBanner.className = 'pause-banner hidden';
    this.pauseBanner.textContent = 'PAUSED · Press Space to resume';
    uiRoot.appendChild(this.pauseBanner);

    this.hudBar = new HudBar(uiRoot, {
      onStartWave: cb.onStartWave,
      onSetSpeed: cb.onSetSpeed,
      onTogglePause: cb.onTogglePause,
      onOpenSettings: cb.onOpenSettings,
      onOpenMenu: cb.onOpenMenu,
      onRotateCamera: cb.onRotateCamera,
    });

    this.buildBar = new BuildBar(uiRoot, cb.onSelectBuildType);

    this.towerPanel = new TowerPanel(uiRoot, {
      onUpgrade: cb.onUpgradeTower,
      onSell: cb.onSellTower,
      onSetTargeting: cb.onSetTargeting,
      onClose: cb.onCloseTowerPanel,
    });

    this.mainMenu = new MainMenuOverlay(uiRoot, {
      onPlay: cb.onPlayFromMenu,
      onOpenLevelSelect: cb.onOpenLevelSelectFromMenu,
      onOpenSettings: cb.onOpenSettingsFromMenu,
    });

    this.levelSelect = new LevelSelectOverlay(uiRoot, {
      onSelectLevel: cb.onSelectLevel,
      onBack: cb.onBackFromLevelSelect,
    });

    this.pauseMenu = new PauseMenuModal(uiRoot, {
      onResume: cb.onResumeFromPause,
      onRestart: cb.onRestartLevel,
      onOpenSettings: cb.onOpenSettingsFromPause,
      onOpenLevelSelect: cb.onOpenLevelSelectFromPause,
      onMainMenu: cb.onMainMenuFromPause,
    });

    this.outcomeOverlay = new OutcomeOverlay(uiRoot, {
      onNextLevel: cb.onNextLevel,
      onReplay: cb.onRestartLevel,
      onLevelSelect: cb.onOpenLevelSelectFromPause,
      onMainMenu: cb.onMainMenuFromPause,
    });

    this.settingsModal = new SettingsModal(uiRoot, cb.initialSettings, {
      onChange: cb.onSettingsChange,
      onRestart: cb.onRestartLevel,
      onQuitToMenu: cb.onMainMenuFromPause,
      onClose: cb.onSettingsClose,
    });
  }

  isModalOpen(): boolean {
    return (
      this.pauseMenu.isOpen() ||
      this.settingsModal.isOpen() ||
      this.outcomeOverlay.isOpen()
    );
  }

  closeModals(): void {
    this.pauseMenu.setOpen(false);
    this.settingsModal.setOpen(false);
    this.outcomeOverlay.hide();
  }

  setPlayVisibility(inPlay: boolean): void {
    this.hudBar.setVisible(inPlay);
    this.buildBar.setVisible(inPlay);
    if (!inPlay) {
      this.towerPanel.update(null, 0);
      this.pauseBanner.classList.add('hidden');
      this.toast.hide();
    }
  }

  syncInPlay(
    hudState: HudStateView,
    activePlacementType: TowerType | null,
    selectedTower: TowerEntity | null,
    userPaused: boolean,
  ): void {
    this.hudBar.update(hudState);
    this.buildBar.update(hudState.gold, activePlacementType);
    this.towerPanel.update(selectedTower, hudState.gold);
    this.pauseBanner.classList.toggle('hidden', !userPaused || this.isModalOpen());
  }

  dispose(): void {
    this.hudBar.dispose();
    this.buildBar.dispose();
    this.towerPanel.dispose();
    this.mainMenu.dispose();
    this.levelSelect.dispose();
    this.pauseMenu.dispose();
    this.outcomeOverlay.dispose();
    this.settingsModal.dispose();
    this.floatingTextPool.dispose();
    this.pauseBanner.remove();
    this.tooltip.dispose();
    this.toast.dispose();
  }
}
