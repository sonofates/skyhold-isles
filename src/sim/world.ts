import type { EventBus } from '../core/eventBus.ts';
import { ObjectPool } from '../core/pool.ts';
import type { TargetingMode, TowerMvpSummary, TowerType } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import type { LevelDef } from '../data/levels/index.ts';
import { computeStarsForLivesLost, type Difficulty } from '../data/stars.ts';
import { getTowerTierStats, TOWER_DEFS } from '../data/towers.ts';
import { AbilitySystem } from './abilitySystem.ts';
import { CombatSystem } from './combatSystem.ts';
import {
  createEnemyEntity,
  createProjectileEntity,
  type EnemyEntity,
  type ProjectileEntity,
  type TowerEntity,
} from './entities.ts';
import { EnemySystem } from './enemySystem.ts';
import { MapGrid } from './grid.ts';
import { CompiledPath } from './path.ts';
import { ProjectileSystem } from './projectileSystem.ts';
import { SpatialHashGrid } from './spatialHash.ts';
import { WaveSystem } from './waveSystem.ts';

const _hoverCandidates: number[] = [];

export function computeSellRefund(totalInvested: number): number {
  return Math.round(totalInvested * BALANCE.sellRefundRatio);
}

/**
 * Star rating for a win: based on lives LOST against the island's difficulty table
 * (`src/data/stars.ts`). Defaults reproduce the classic 20-life Breezy rule (18+ left = 3★, 10+ = 2★).
 */
export function computeStarRating(
  livesRemaining: number,
  difficulty: Difficulty = 'Breezy',
  startingLives: number = BALANCE.startingLives,
): 1 | 2 | 3 {
  return computeStarsForLivesLost(startingLives - livesRemaining, difficulty);
}

export class SimWorld {
  readonly level: LevelDef;
  readonly grid: MapGrid;
  readonly groundPath: CompiledPath;
  /** Extra spawn lanes (level.extraGroundPaths), compiled like the main road. */
  readonly extraGroundPaths: readonly CompiledPath[];
  readonly flightPath: CompiledPath;
  readonly spatialHash: SpatialHashGrid;
  readonly enemyPool: ObjectPool<EnemyEntity>;
  readonly projectilePool: ObjectPool<ProjectileEntity>;
  readonly enemySystem: EnemySystem;
  readonly projectileSystem: ProjectileSystem;
  readonly combatSystem: CombatSystem;
  readonly waveSystem: WaveSystem;
  readonly abilitySystem: AbilitySystem;
  readonly events: EventBus;

  readonly towers: TowerEntity[] = [];
  private nextTowerId = 1;

  gold: number;
  lives: number;
  /** Lives this run started with (stars are rated on lives lost from here). */
  readonly startingLives: number;
  enemiesKilledTotal = 0;
  outcome: 'ongoing' | 'won' | 'lost' = 'ongoing';

  constructor(level: LevelDef, events: EventBus) {
    this.level = level;
    this.events = events;
    this.grid = new MapGrid(level);

    this.groundPath = new CompiledPath(
      level.pathWaypoints,
      level.cols,
      level.rows,
      BALANCE.tilePathTopY,
      true,
    );
    this.extraGroundPaths = (level.extraGroundPaths ?? []).map(
      (wps) => new CompiledPath(wps, level.cols, level.rows, BALANCE.tilePathTopY, true),
    );
    this.flightPath = new CompiledPath(
      level.flightPath,
      level.cols,
      level.rows,
      BALANCE.flyerHeight,
      false,
    );

    const worldW = level.cols * BALANCE.tileSize;
    const worldD = level.rows * BALANCE.tileSize;
    this.spatialHash = new SpatialHashGrid(worldW, worldD, BALANCE.pools.maxEnemies);
    this.enemyPool = new ObjectPool<EnemyEntity>(BALANCE.pools.maxEnemies, createEnemyEntity);
    this.projectilePool = new ObjectPool<ProjectileEntity>(
      BALANCE.pools.maxProjectiles,
      createProjectileEntity,
    );
    this.enemySystem = new EnemySystem(
      this.enemyPool,
      this.groundPath,
      this.flightPath,
      this.spatialHash,
      events,
      this.extraGroundPaths,
    );
    this.projectileSystem = new ProjectileSystem(
      this.projectilePool,
      this.enemyPool,
      this.spatialHash,
      this.enemySystem,
      events,
    );
    this.combatSystem = new CombatSystem(
      this.enemyPool,
      this.spatialHash,
      this.enemySystem,
      this.projectileSystem,
      events,
    );
    this.waveSystem = new WaveSystem(level, events);
    this.abilitySystem = new AbilitySystem(events);

    this.gold = level.startingGold;
    this.startingLives = BALANCE.startingLives;
    this.lives = this.startingLives;
  }

  /** Star rating the run would earn if it were won right now. */
  computeStars(): 1 | 2 | 3 {
    return computeStarRating(this.lives, this.level.difficulty, this.startingLives);
  }

  setAutoWave(enabled: boolean): void {
    this.waveSystem.setAutoWave(enabled);
  }

  /** Abilities are only usable once the first wave has started (mirrors the HUD guard). */
  private canUseAbilities(): boolean {
    return this.outcome === 'ongoing' && this.waveSystem.state !== 'preFirstWave';
  }

  castMeteor(x: number, z: number): boolean {
    if (!this.canUseAbilities()) return false;
    return this.abilitySystem.castMeteor(x, z, Math.max(1, this.waveSystem.currentWaveOneBased));
  }

  castOvercharge(): boolean {
    if (!this.canUseAbilities()) return false;
    return this.abilitySystem.castOvercharge(this.towers);
  }

  enterEndlessMode(): boolean {
    if (this.outcome !== 'won') return false;
    this.outcome = 'ongoing';
    this.waveSystem.enterEndlessMode();
    return true;
  }

  getMvpTowerSummary(): TowerMvpSummary | null {
    if (this.towers.length === 0) return null;
    let best = this.towers[0];
    for (let i = 1; i < this.towers.length; i++) {
      const candidate = this.towers[i];
      if (
        candidate.totalDamageDealt > best.totalDamageDealt ||
        (candidate.totalDamageDealt === best.totalDamageDealt && candidate.kills > best.kills)
      ) {
        best = candidate;
      }
    }
    return {
      name: TOWER_DEFS[best.type].name,
      type: best.type,
      tier: best.tier,
      damageDealt: Math.round(best.totalDamageDealt),
      kills: best.kills,
    };
  }

  startNextWave(): boolean {
    if (this.outcome !== 'ongoing') return false;
    return this.waveSystem.startNextWave((bonus) => {
      this.gold += bonus;
      this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
    });
  }

  debugSkipToWave(waveOneBased: number): boolean {
    this.enemyPool.clear();
    this.projectilePool.clear();
    this.projectileSystem.clearBurnZones();
    this.spatialHash.clear();
    if (this.lives <= 0) {
      this.lives = this.startingLives;
    }
    this.outcome = 'ongoing';
    const ok = this.waveSystem.skipToWave(waveOneBased);
    this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
    return ok;
  }

  debugForceWin(): void {
    if (this.outcome !== 'ongoing') return;
    if (this.lives <= 0) this.lives = 1;
    this.outcome = 'won';
    this.events.emit('gameWon', {
      stars: this.computeStars(),
      livesRemaining: this.lives,
    });
  }

  debugForceLose(): void {
    if (this.outcome !== 'ongoing') return;
    this.lives = 0;
    this.outcome = 'lost';
    this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
    this.events.emit('gameLost', { waveIndex: Math.max(0, this.waveSystem.currentWaveIndex) });
  }

  placeTower(
    col: number,
    row: number,
    type: TowerType,
    targetingMode: TargetingMode = 'first',
  ): TowerEntity | null {
    if (this.outcome !== 'ongoing') return null;
    if (!this.grid.canPlaceTower(col, row)) return null;
    const stats = getTowerTierStats(type, 1);
    if (this.gold < stats.upgradeCost) return null;

    this.gold -= stats.upgradeCost;
    const x = this.grid.gridToWorldX(col);
    const z = this.grid.gridToWorldZ(row);
    const tower: TowerEntity = {
      id: this.nextTowerId++,
      col,
      row,
      x,
      z,
      type,
      tier: 1,
      totalInvested: stats.upgradeCost,
      targetingMode,
      cooldownTimer: 0.15,
      stunTimer: 0,
      yaw: 0,
      prevYaw: 0,
      targetYaw: 0,
      recoil: 0,
      popAnimTimer: 0.32,
      totalDamageDealt: 0,
      kills: 0,
      auraRate: 0,
      auraRange: 0,
      shotCount: 0,
    };

    this.towers.push(tower);
    this.grid.setTowerAt(col, row, tower.id);

    this.events.emit('towerBuilt', {
      towerId: tower.id,
      type: tower.type,
      tier: tower.tier,
      x,
      z,
    });
    this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
    return tower;
  }

  upgradeTower(towerId: number): boolean {
    if (this.outcome !== 'ongoing') return false;
    const tower = this.getTowerById(towerId);
    if (!tower || tower.tier >= 3) return false;

    const nextTier = (tower.tier + 1) as 2 | 3;
    const nextStats = getTowerTierStats(tower.type, nextTier);
    if (this.gold < nextStats.upgradeCost) return false;

    this.gold -= nextStats.upgradeCost;
    tower.tier = nextTier;
    tower.totalInvested += nextStats.upgradeCost;
    tower.popAnimTimer = 0.32;

    this.events.emit('towerUpgraded', {
      towerId: tower.id,
      type: tower.type,
      tier: tower.tier,
      x: tower.x,
      z: tower.z,
    });
    this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
    return true;
  }

  sellTower(towerId: number): number {
    if (this.outcome !== 'ongoing') return 0;
    const idx = this.towers.findIndex((t) => t.id === towerId);
    if (idx === -1) return 0;

    const tower = this.towers[idx];
    const refund = computeSellRefund(tower.totalInvested);
    this.gold += refund;
    this.grid.clearTowerAt(tower.col, tower.row);
    this.towers.splice(idx, 1);

    this.events.emit('towerSold', {
      towerId: tower.id,
      type: tower.type,
      tier: tower.tier,
      refund,
      x: tower.x,
      z: tower.z,
    });
    this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
    return refund;
  }

  setTowerTargeting(towerId: number, mode: TargetingMode): void {
    const tower = this.getTowerById(towerId);
    if (tower) {
      tower.targetingMode = mode;
    }
  }

  getTowerById(towerId: number): TowerEntity | null {
    for (let i = 0; i < this.towers.length; i++) {
      if (this.towers[i].id === towerId) return this.towers[i];
    }
    return null;
  }

  fixedTick(dt: number): void {
    if (this.outcome !== 'ongoing') return;

    this.waveSystem.update(
      dt,
      () => this.enemyPool.getActiveCount(),
      (enemyType, hpScale, elite, lane) => {
        const spawned = this.enemySystem.spawnEnemy(enemyType, hpScale, elite, lane);
        if (spawned) {
          spawned.reward = Math.max(
            1,
            Math.round(spawned.reward * this.waveSystem.getRewardMultiplier()),
          );
        }
      },
      (bonus) => {
        this.gold += bonus;
        this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
      },
      () => {
        if (this.outcome === 'ongoing' && this.lives > 0 && !this.waveSystem.isEndless) {
          this.outcome = 'won';
          this.events.emit('gameWon', {
            stars: this.computeStars(),
            livesRemaining: this.lives,
          });
        }
      },
    );

    if (this.outcome !== 'ongoing') return;

    const wsState = this.waveSystem.state;
    const isCombatActive =
      wsState === 'spawning' || wsState === 'clearing' || wsState === 'allSpawned';
    this.abilitySystem.update(
      dt,
      isCombatActive,
      this.enemyPool,
      this.spatialHash,
      this.enemySystem,
    );

    this.enemySystem.update(
      dt,
      (leaked) => {
        this.lives = Math.max(0, this.lives - leaked.livesCost);
        this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
        if (this.lives <= 0 && this.outcome === 'ongoing') {
          this.outcome = 'lost';
          this.events.emit('gameLost', {
            waveIndex: Math.max(0, this.waveSystem.currentWaveIndex),
            endless: this.waveSystem.isEndless,
          });
        }
      },
      (killed) => {
        this.enemiesKilledTotal++;
        this.gold += killed.reward;
        this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
      },
      this.towers,
      this.waveSystem.getCurrentWaveHpScale(),
    );

    if (this.outcome !== 'ongoing') return;

    this.waveSystem.checkCompletion(
      () => this.enemyPool.getActiveCount(),
      (bonus) => {
        this.gold += bonus;
        this.events.emit('economyChanged', { gold: this.gold, lives: this.lives });
      },
      () => {
        if (this.outcome === 'ongoing' && this.lives > 0 && !this.waveSystem.isEndless) {
          this.outcome = 'won';
          this.events.emit('gameWon', {
            stars: this.computeStars(),
            livesRemaining: this.lives,
          });
        }
      },
    );

    if (this.outcome !== 'ongoing') return;

    this.combatSystem.update(dt, this.towers, this.abilitySystem.getFireRateMultiplier());
    this.projectileSystem.update(dt, this.towers);
  }

  findHoveredEnemy(
    groundHitX: number,
    groundHitZ: number,
    flyerHitX: number,
    flyerHitZ: number,
  ): EnemyEntity | null {
    let best: EnemyEntity | null = null;
    let bestDistSq = Infinity;

    this.spatialHash.query(flyerHitX, flyerHitZ, 1.4, _hoverCandidates);
    for (let i = 0; i < _hoverCandidates.length; i++) {
      const e = this.enemyPool.items[_hoverCandidates[i]];
      if (!e.active || !e.flying) continue;
      const dx = e.x - flyerHitX;
      const dz = e.z - flyerHitZ;
      const dSq = dx * dx + dz * dz;
      const r = e.radius + 0.45;
      if (dSq <= r * r && dSq < bestDistSq) {
        bestDistSq = dSq;
        best = e;
      }
    }
    if (best) return best;

    this.spatialHash.query(groundHitX, groundHitZ, 1.4, _hoverCandidates);
    for (let i = 0; i < _hoverCandidates.length; i++) {
      const e = this.enemyPool.items[_hoverCandidates[i]];
      if (!e.active || e.flying) continue;
      const dx = e.x - groundHitX;
      const dz = e.z - groundHitZ;
      const dSq = dx * dx + dz * dz;
      const r = e.radius + 0.45;
      if (dSq <= r * r && dSq < bestDistSq) {
        bestDistSq = dSq;
        best = e;
      }
    }
    return best;
  }
}
