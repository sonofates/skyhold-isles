import type { EventBus } from '../core/eventBus.ts';
import type { ObjectPool } from '../core/pool.ts';
import type { Vec3 } from '../core/types.ts';
import { TOWER_DEFS, getTowerTierStats } from '../data/towers.ts';
import type { EnemyEntity, TowerEntity } from './entities.ts';
import type { EnemySystem } from './enemySystem.ts';
import type { ProjectileSystem } from './projectileSystem.ts';
import type { SpatialHashGrid } from './spatialHash.ts';
import { acquireTarget } from './targeting.ts';

const _chainCandidates: number[] = [];
const _hitPoolIndices = new Set<number>();

function shortestAngleDiff(from: number, to: number): number {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

export class CombatSystem {
  private readonly enemyPool: ObjectPool<EnemyEntity>;
  private readonly spatialHash: SpatialHashGrid;
  private readonly enemySystem: EnemySystem;
  private readonly projectileSystem: ProjectileSystem;
  private readonly events: EventBus;

  constructor(
    enemyPool: ObjectPool<EnemyEntity>,
    spatialHash: SpatialHashGrid,
    enemySystem: EnemySystem,
    projectileSystem: ProjectileSystem,
    events: EventBus,
  ) {
    this.enemyPool = enemyPool;
    this.spatialHash = spatialHash;
    this.enemySystem = enemySystem;
    this.projectileSystem = projectileSystem;
    this.events = events;
  }

  update(dt: number, towers: TowerEntity[], fireRateMultiplier = 1): void {
    const turnSpeed = 12.0;
    const rateMult = Math.max(0.01, fireRateMultiplier);

    for (let i = 0; i < towers.length; i++) {
      const tower = towers[i];
      tower.prevYaw = tower.yaw;

      if (tower.recoil > 0) {
        tower.recoil = Math.max(0, tower.recoil - dt * 5.0);
      }
      if (tower.popAnimTimer > 0) {
        tower.popAnimTimer = Math.max(0, tower.popAnimTimer - dt);
      }
      if (tower.stunTimer > 0) {
        tower.stunTimer = Math.max(0, tower.stunTimer - dt);
        if (tower.stunTimer > 0) {
          continue;
        }
      }
      if (tower.cooldownTimer > 0) {
        tower.cooldownTimer = Math.max(0, tower.cooldownTimer - dt * rateMult);
      }

      const stats = getTowerTierStats(tower.type, tower.tier);
      const target = acquireTarget(tower, stats, this.enemyPool, this.spatialHash);

      if (target) {
        tower.targetYaw = Math.atan2(target.x - tower.x, target.z - tower.z);
        const diff = shortestAngleDiff(tower.yaw, tower.targetYaw);
        const maxStep = turnSpeed * dt;
        if (Math.abs(diff) <= maxStep) {
          tower.yaw = tower.targetYaw;
        } else {
          tower.yaw += Math.sign(diff) * maxStep;
        }

        if (tower.cooldownTimer <= 0) {
          tower.cooldownTimer = 1 / stats.fireRate;
          tower.recoil = 1;
          const def = TOWER_DEFS[tower.type];

          if (tower.type === 'tesla') {
            this.fireChainLightning(tower, target, stats);
          } else {
            this.projectileSystem.spawnProjectile(tower, target, stats.splashFalloffMin);
          }

          this.events.emit('towerFired', {
            towerId: tower.id,
            type: tower.type,
            tier: tower.tier,
            x: tower.x,
            y: def.turretHeight + 0.15,
            z: tower.z,
            yaw: tower.yaw,
          });
        }
      } else {
        // Gentle idle scan sweep
        tower.yaw += dt * 0.35;
      }
    }
  }

  private fireChainLightning(
    tower: TowerEntity,
    initialTarget: EnemyEntity,
    stats: ReturnType<typeof getTowerTierStats>,
  ): void {
    const def = TOWER_DEFS.tesla;
    const points: Vec3[] = [{ x: tower.x, y: def.turretHeight + 0.35, z: tower.z }];
    _hitPoolIndices.clear();

    let current: EnemyEntity | null = initialTarget;
    let currentDamage = stats.damage;
    const maxJumps = Math.max(1, stats.chainCount);

    for (let jump = 0; jump < maxJumps && current !== null; jump++) {
      _hitPoolIndices.add(current.poolIndex);
      points.push({
        x: current.x,
        y: current.y + current.height * 0.55,
        z: current.z,
      });

      const res = this.enemySystem.applyDamage(current, Math.round(currentDamage));
      tower.totalDamageDealt += res.actualDamage;
      if (res.killed) tower.kills++;

      if (jump === maxJumps - 1) break;

      // Find closest unhit enemy within chainRange
      this.spatialHash.query(current.x, current.z, stats.chainRange, _chainCandidates);
      const maxRSq = stats.chainRange * stats.chainRange;
      let nextTarget: EnemyEntity | null = null;
      let bestDistSq = Infinity;

      for (let k = 0; k < _chainCandidates.length; k++) {
        const candidate = this.enemyPool.items[_chainCandidates[k]];
        if (
          !candidate.active ||
          candidate.hp <= 0 ||
          _hitPoolIndices.has(candidate.poolIndex)
        ) {
          continue;
        }
        const dx = candidate.x - current.x;
        const dz = candidate.z - current.z;
        const dSq = dx * dx + dz * dz;
        if (dSq <= maxRSq && dSq < bestDistSq) {
          bestDistSq = dSq;
          nextTarget = candidate;
        }
      }

      current = nextTarget;
      currentDamage *= stats.chainFalloff;
    }

    this.events.emit('lightningChain', { points });
  }
}
