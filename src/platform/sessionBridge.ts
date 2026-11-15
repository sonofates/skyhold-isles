import type { SoundManager } from '../audio/soundManager.ts';
import type { EventBus } from '../core/eventBus.ts';
import type { EnemyType, GameSettings, ProgressData, TowerType } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { LEVELS } from '../data/levels/index.ts';
import { getTowerTierStats } from '../data/towers.ts';
import type { RenderWorld } from '../render/renderWorld.ts';
import type { SimWorld } from '../sim/world.ts';
import type { GameOverlays } from '../ui/gameOverlays.ts';
import type { HudStateView } from '../ui/hud.ts';
import type { GameLoop } from './browserLoop.ts';
import { saveProgress, hasSeenFlyerToast, markFlyerToastSeen } from './storage.ts';

export interface SimBridgeHandlers {
  bus: EventBus;
  soundManager: SoundManager;
  overlays: GameOverlays;
  getSettings: () => GameSettings;
  getSimClock: () => number;
  onSyncUi: () => void;
  onGameWon: (stars: 1 | 2 | 3, livesRemaining: number) => void;
  onGameLost: (waveIndex: number) => void;
}

export function bindSimEventBridge(h: SimBridgeHandlers): () => void {
  const unbindSound = h.soundManager.bindEvents(h.bus);
  h.bus.on('economyChanged', h.onSyncUi);
  h.bus.on('waveStarted', h.onSyncUi);
  h.bus.on('waveCompleted', h.onSyncUi);
  h.bus.on('towerBuilt', h.onSyncUi);
  h.bus.on('towerUpgraded', h.onSyncUi);
  h.bus.on('towerSold', h.onSyncUi);
  h.bus.on('enemySpawned', (e) => {
    if (!e.flying || hasSeenFlyerToast()) return;
    markFlyerToastSeen();
    h.overlays.toast.show('Flyers incoming! Only Archer, Frost and Tesla can hit them.');
  });
  h.bus.on('enemyHit', (e) => {
    if (!h.getSettings().damageNumbers) return;
    h.overlays.floatingTextPool.spawnDamage(
      e.enemyId,
      e.damage,
      e.x,
      e.y,
      e.z,
      h.getSimClock(),
      e.isBoss || e.damage >= 55,
    );
  });
  h.bus.on('enemyKilled', (e) => {
    h.overlays.floatingTextPool.spawnGold(e.reward, e.x, e.y + 0.35, e.z, h.getSimClock());
  });
  h.bus.on('gameWon', (ev) => h.onGameWon(ev.stars, ev.livesRemaining));
  h.bus.on('gameLost', (ev) => h.onGameLost(ev.waveIndex));
  return unbindSound;
}

export function recordWinProgress(
  progress: ProgressData,
  levelIndex: number,
  stars: 1 | 2 | 3,
): void {
  progress.bestStars[levelIndex] = Math.max(progress.bestStars[levelIndex] ?? 0, stars);
  if (levelIndex + 1 < LEVELS.length) {
    progress.unlockedLevelIndex = Math.max(progress.unlockedLevelIndex, levelIndex + 1);
  }
  saveProgress(progress);
}

export function buildHudStateView(simWorld: SimWorld, loop: GameLoop): HudStateView {
  const ws = simWorld.waveSystem;
  return {
    gold: simWorld.gold,
    lives: simWorld.lives,
    currentWave: ws.currentWaveOneBased,
    totalWaves: ws.totalWaves,
    speed: loop.speed,
    paused: loop.paused,
    canStartWave: simWorld.outcome === 'ongoing' && ws.canStartNextWave(),
    isPreFirstWave: ws.state === 'preFirstWave',
    earlyBonus: ws.getEarlyCallBonus(),
    countdownSec: ws.interWaveTimer,
    nextPreview: ws.getNextWavePreview(),
  };
}

export function updatePlacementPreviewFromNdc(
  active: boolean,
  placementType: TowerType | null,
  ndcX: number,
  ndcY: number,
  renderWorld: RenderWorld,
  simWorld: SimWorld,
): void {
  if (!active || !placementType) {
    renderWorld.setPlacementPreview(false, null, 0, 0, false);
    return;
  }
  const hit = renderWorld.cameraController.screenNdcToPlane(ndcX, ndcY, 0);
  if (!hit) {
    renderWorld.setPlacementPreview(false, null, 0, 0, false);
    return;
  }
  const coord = simWorld.grid.worldToGrid(hit.x, hit.z);
  if (!coord || simWorld.grid.getTile(coord.col, coord.row) === 'empty') {
    renderWorld.setPlacementPreview(false, null, 0, 0, false);
    return;
  }
  const wx = simWorld.grid.gridToWorldX(coord.col);
  const wz = simWorld.grid.gridToWorldZ(coord.row);
  const cost = getTowerTierStats(placementType, 1).upgradeCost;
  const valid = simWorld.grid.canPlaceTower(coord.col, coord.row) && simWorld.gold >= cost;
  renderWorld.setPlacementPreview(true, placementType, wx, wz, valid);
}

export function stepPendingSpawns(
  queue: Array<{ type: EnemyType; delay: number }>,
  simWorld: SimWorld,
  dt: number,
): void {
  let p = 0;
  while (p < queue.length) {
    queue[p].delay -= dt;
    if (queue[p].delay <= 0) {
      simWorld.enemySystem.spawnEnemy(queue[p].type);
      queue.splice(p, 1);
    } else {
      p++;
    }
  }
}

export function updateEnemyHoverTooltip(
  inPlay: boolean,
  pointerInside: boolean,
  paused: boolean,
  ndcX: number,
  ndcY: number,
  clientX: number,
  clientY: number,
  renderWorld: RenderWorld,
  simWorld: SimWorld,
  overlays: GameOverlays,
): void {
  if (!inPlay) {
    overlays.tooltip.hide();
    return;
  }
  if (!pointerInside || paused) return;

  const groundHit = renderWorld.cameraController.screenNdcToPlane(ndcX, ndcY, 0);
  const flyerHit = renderWorld.cameraController.screenNdcToPlane(ndcX, ndcY, BALANCE.flyerHeight);
  if (!groundHit || !flyerHit) return;

  const hovered = simWorld.findHoveredEnemy(groundHit.x, groundHit.z, flyerHit.x, flyerHit.z);
  if (hovered) overlays.tooltip.show(hovered, clientX, clientY);
  else overlays.tooltip.hide();
}
