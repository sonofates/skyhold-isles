import { Vector3 } from 'three';
import type { SoundManager } from '../audio/soundManager.ts';
import type { EventBus } from '../core/eventBus.ts';
import type { AbilityId, EnemyType, GameSettings, ProgressData, TowerType } from '../core/types.ts';
import { ABILITY_DEFS } from '../data/abilities.ts';
import { applyEndlessRecord, applyWin, type WinRecord } from '../game/progression.ts';
import { BALANCE } from '../data/balance.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import { LEVELS } from '../data/levels/index.ts';
import { getTowerTierStats } from '../data/towers.ts';
import type { RenderWorld } from '../render/renderWorld.ts';
import { getTowerPickHeight } from '../render/towerPicking.ts';
import type { SimWorld } from '../sim/world.ts';
import type { AbilityBarState } from '../ui/abilityBar.ts';
import type { GameOverlays } from '../ui/gameOverlays.ts';
import type { HudStateView } from '../ui/hud.ts';
import type { GameLoop } from './browserLoop.ts';
import {
  saveProgress,
  hasSeenEnemyIntro,
  hasSeenFlyerToast,
  markEnemyIntroSeen,
  markFlyerToastSeen,
} from './storage.ts';

export interface SimBridgeHandlers {
  bus: EventBus;
  soundManager: SoundManager;
  overlays: GameOverlays;
  getSettings: () => GameSettings;
  getSimClock: () => number;
  /** Wall-clock seconds (the toast counts down in real time, whatever the game speed). */
  getRealClock?: () => number;
  onSyncUi: () => void;
  onGameWon: (stars: 1 | 2 | 3, livesRemaining: number) => void;
  onGameLost: (waveIndex: number, endless?: boolean) => void;
}

/** First-encounter hints stay up this long (real seconds); the next hint waits until it is gone. */
const INTRO_TOAST_SEC = 7.0;

export function bindSimEventBridge(h: SimBridgeHandlers): () => void {
  const unbindSound = h.soundManager.bindEvents(h.bus);
  h.bus.on('economyChanged', h.onSyncUi);
  h.bus.on('waveStarted', h.onSyncUi);
  h.bus.on('waveCompleted', h.onSyncUi);
  h.bus.on('towerBuilt', h.onSyncUi);
  h.bus.on('towerUpgraded', (e) => {
    h.onSyncUi();
    if (e.tier === 2 || e.tier === 3) {
      const topY = getTowerPickHeight(e.type, e.tier) + 0.35;
      h.overlays.floatingTextPool.spawnUpgradeTier(e.tier, e.x, topY, e.z, h.getSimClock());
    }
  });
  h.bus.on('towerSold', h.onSyncUi);
  // Wall-clock time of the last "New foe" hint: a second new type (or the flyer hint) arriving while
  // it is still on screen — at any game speed — waits for a later spawn instead of wiping it
  // (a hint is only marked seen once it was actually shown).
  const realClock = h.getRealClock ?? ((): number => performance.now() / 1000);
  let lastIntroAt = -Infinity;
  const introOnScreen = (): boolean => realClock() - lastIntroAt < INTRO_TOAST_SEC;
  h.bus.on('enemySpawned', (e) => {
    // First encounter with a newer archetype: one-time counterplay hint.
    const hint = ENEMY_DEFS[e.enemyType].counterHint;
    if (hint && !hasSeenEnemyIntro(e.enemyType)) {
      if (!introOnScreen()) {
        lastIntroAt = realClock();
        markEnemyIntroSeen(e.enemyType);
        h.overlays.toast.show(`New foe — ${ENEMY_DEFS[e.enemyType].name}: ${hint}`, INTRO_TOAST_SEC);
      }
      return;
    }
    if (!e.flying || hasSeenFlyerToast() || introOnScreen()) return;
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
  h.bus.on('gameLost', (ev) => h.onGameLost(ev.waveIndex, ev.endless));
  return unbindSound;
}

export function recordWinProgress(
  progress: ProgressData,
  levelIndex: number,
  stars: 1 | 2 | 3,
  livesRemaining = 0,
): WinRecord {
  const record = applyWin(progress, levelIndex, LEVELS.length, stars, livesRemaining);
  saveProgress(progress);
  return record;
}

export function recordEndlessProgress(
  progress: ProgressData,
  levelIndex: number,
  waveReached: number,
): ReturnType<typeof applyEndlessRecord> {
  const result = applyEndlessRecord(progress, levelIndex, waveReached);
  saveProgress(progress);
  return result;
}

type WavePreview = ReturnType<SimWorld['waveSystem']['getNextWavePreview']>;
const previewCache = new WeakMap<SimWorld, { key: string; preview: WavePreview }>();

/**
 * Returns the next-wave preview, recomputed only when the wave index/state changes. The stable
 * object identity lets the HUD skip rebuilding its preview chips on every sync.
 */
function getCachedNextWavePreview(simWorld: SimWorld): WavePreview {
  const ws = simWorld.waveSystem;
  const key = `${ws.state}|${ws.currentWaveIndex}|${ws.isEndless ? 1 : 0}`;
  const cached = previewCache.get(simWorld);
  if (cached && cached.key === key) return cached.preview;
  const preview = ws.getNextWavePreview();
  previewCache.set(simWorld, { key, preview });
  return preview;
}

export function buildHudStateView(
  simWorld: SimWorld,
  loop: GameLoop,
  routesVisible = false,
): HudStateView {
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
    nextPreview: getCachedNextWavePreview(simWorld),
    autoWave: ws.autoWave,
    routesVisible,
    isEndless: ws.isEndless,
  };
}

export function buildAbilityBarState(
  simWorld: SimWorld,
  activeAbility: AbilityId | null,
): AbilityBarState {
  const ab = simWorld.abilitySystem;
  const ws = simWorld.waveSystem;
  return {
    activeAbility,
    meteorCooldown: ab.getCooldown('meteor'),
    meteorMaxCooldown: ab.getMaxCooldown('meteor'),
    overchargeCooldown: ab.getCooldown('overcharge'),
    overchargeMaxCooldown: ab.getMaxCooldown('overcharge'),
    overchargeRemaining: ab.getOverchargeRemaining(),
    overchargeDuration: ABILITY_DEFS.overcharge.durationSec,
    disabled:
      simWorld.outcome !== 'ongoing' ||
      ws.state === 'preFirstWave' ||
      simWorld.mods.abilitiesDisabled,
  };
}

export function updateMeteorPreviewFromNdc(
  active: boolean,
  activeAbility: AbilityId | null,
  ndcX: number,
  ndcY: number,
  renderWorld: RenderWorld,
): void {
  if (!active || activeAbility !== 'meteor') {
    renderWorld.setMeteorTargetPreview(false, 0, 0, 1);
    return;
  }
  const hit = renderWorld.cameraController.screenNdcToPlane(ndcX, ndcY, 0);
  if (!hit) {
    renderWorld.setMeteorTargetPreview(false, 0, 0, 1);
    return;
  }
  renderWorld.setMeteorTargetPreview(true, hit.x, hit.z, ABILITY_DEFS.meteor.radius);
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
  // Ground-plane hit only: a tower silhouette drawn over an empty tile must not hide its ghost.
  const hit = renderWorld.cameraController.screenNdcToPlane(ndcX, ndcY, 0);
  if (!hit) {
    renderWorld.setPlacementPreview(false, null, 0, 0, false);
    return;
  }
  const coord = simWorld.grid.worldToGrid(hit.x, hit.z);
  if (
    !coord ||
    simWorld.grid.getTile(coord.col, coord.row) === 'empty' ||
    simWorld.grid.getTowerIdAt(coord.col, coord.row) !== -1
  ) {
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

const groundHitScratch = new Vector3();
const flyerHitScratch = new Vector3();

export function updateHoverFeedback(
  inPlay: boolean,
  pointerInside: boolean,
  paused: boolean,
  placementActive: boolean,
  ndcX: number,
  ndcY: number,
  clientX: number,
  clientY: number,
  renderWorld: RenderWorld,
  simWorld: SimWorld,
  overlays: GameOverlays,
  selectedTowerId: number | null = null,
): void {
  if (!inPlay || !pointerInside) {
    renderWorld.setHoveredTowerId(null);
    renderWorld.setCanvasCursor('');
    overlays.tooltip.hide();
    return;
  }

  const hoveredTower = renderWorld.pickTowerAtNdc(ndcX, ndcY, simWorld.towers);
  if (hoveredTower) {
    renderWorld.setHoveredTowerId(hoveredTower.id);
    renderWorld.setCanvasCursor('pointer');
    if (hoveredTower.id === selectedTowerId) {
      overlays.tooltip.hide();
    } else {
      overlays.tooltip.showTower(hoveredTower, clientX, clientY);
    }
    return;
  }

  renderWorld.setHoveredTowerId(null);
  renderWorld.setCanvasCursor(placementActive ? 'crosshair' : '');

  if (paused || placementActive) {
    overlays.tooltip.hide();
    return;
  }

  const cam = renderWorld.cameraController;
  const groundHit = cam.screenNdcToPlane(ndcX, ndcY, 0, groundHitScratch);
  const flyerHit = cam.screenNdcToPlane(ndcX, ndcY, BALANCE.flyerHeight, flyerHitScratch);
  if (!groundHit || !flyerHit) {
    overlays.tooltip.hide();
    return;
  }

  const hovered = simWorld.findHoveredEnemy(groundHit.x, groundHit.z, flyerHit.x, flyerHit.z);
  if (hovered) overlays.tooltip.show(hovered, clientX, clientY);
  else overlays.tooltip.hide();
}
