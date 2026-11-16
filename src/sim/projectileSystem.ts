import type { EventBus } from '../core/eventBus.ts';
import type { ObjectPool } from '../core/pool.ts';
import type { TowerType } from '../core/types.ts';
import { TOWER_DEFS, getTowerTierStats } from '../data/towers.ts';
import type { EnemyEntity, ProjectileEntity, TowerEntity } from './entities.ts';
import type { EnemySystem } from './enemySystem.ts';
import type { CompiledPath } from './path.ts';
import type { SpatialHashGrid } from './spatialHash.ts';

const _splashCandidates: number[] = [];
const _leadVec = { x: 0, y: 0, z: 0 };

/**
 * EnemySystem keeps its compiled paths private (and is out of scope for balance
 * changes), so the aiming code reads them through a structural view.
 */
interface EnemyPathView {
  readonly groundPath: CompiledPath;
  readonly flightPath: CompiledPath;
}

/** Fraction of full target lead applied to parabolic shells (1 = perfect aim). */
const SHELL_LEAD_FACTOR = 0.8;
const SHELL_LEAD_ITERATIONS = 5;

export class ProjectileSystem {
  private readonly projectilePool: ObjectPool<ProjectileEntity>;
  private readonly enemyPool: ObjectPool<EnemyEntity>;
  private readonly spatialHash: SpatialHashGrid;
  private readonly enemySystem: EnemySystem;
  private readonly events: EventBus;

  constructor(
    projectilePool: ObjectPool<ProjectileEntity>,
    enemyPool: ObjectPool<EnemyEntity>,
    spatialHash: SpatialHashGrid,
    enemySystem: EnemySystem,
    events: EventBus,
  ) {
    this.projectilePool = projectilePool;
    this.enemyPool = enemyPool;
    this.spatialHash = spatialHash;
    this.enemySystem = enemySystem;
    this.events = events;
  }

  spawnProjectile(
    tower: TowerEntity,
    target: EnemyEntity,
    splashFalloffMin: number,
  ): ProjectileEntity | null {
    const p = this.projectilePool.acquire();
    if (!p) return null;

    const def = TOWER_DEFS[tower.type];
    const stats = getTowerTierStats(tower.type, tower.tier);
    const sx = tower.x;
    const sy = def.turretHeight + 0.15;
    const sz = tower.z;
    let tx = target.x;
    const ty = target.y + target.height * 0.55;
    let tz = target.z;
    const parabolic = stats.parabolicArcHeight > 0;
    if (parabolic) {
      // Lead the target along its waypoint path so lobbed shells land where it
      // will be at impact time instead of where it was when the shell left.
      const lead = this.predictImpactPoint(target, sx, sz, Math.max(1, stats.projectileSpeed));
      tx = lead.x;
      tz = lead.z;
    }
    const dist = Math.hypot(tx - sx, tz - sz);

    p.towerType = tower.type;
    p.towerId = tower.id;
    p.targetUid = target.uid;
    p.targetPoolIndex = target.poolIndex;
    p.damage = stats.damage;
    p.splashRadius = stats.splashRadius;
    p.splashFalloffMin = splashFalloffMin;
    p.slowRatio = stats.slowRatio;
    p.slowDuration = stats.slowDuration;
    p.parabolic = parabolic;
    p.arcHeight = stats.parabolicArcHeight;
    p.speed = Math.max(1, stats.projectileSpeed);

    p.startX = sx;
    p.startY = sy;
    p.startZ = sz;
    p.endX = tx;
    p.endY = ty;
    p.endZ = tz;
    p.progress = 0;
    p.duration = Math.max(0.06, dist / p.speed);

    p.x = sx;
    p.y = sy;
    p.z = sz;
    p.prevX = sx;
    p.prevY = sy;
    p.prevZ = sz;
    p.yaw = Math.atan2(tx - sx, tz - sz);
    p.prevYaw = p.yaw;

    return p;
  }

  /**
   * Fixed-point iteration: flight time depends on where the shell lands, which
   * depends on flight time. Converges in a few steps since enemy speed << shell
   * speed. Uses the enemy's current (slowed) speed; later slows cause small misses.
   */
  private predictImpactPoint(
    target: EnemyEntity,
    sx: number,
    sz: number,
    shellSpeed: number,
  ): { x: number; z: number } {
    const paths = this.enemySystem as unknown as EnemyPathView;
    const path = target.flying ? paths.flightPath : paths.groundPath;
    if (!path) return { x: target.x, z: target.z };

    const effSpeed = target.speed * (1 - target.slowRatio);
    let t = Math.max(0.06, Math.hypot(target.x - sx, target.z - sz) / shellSpeed);
    let px = target.x;
    let pz = target.z;
    for (let i = 0; i < SHELL_LEAD_ITERATIONS; i++) {
      const d = Math.min(target.totalDist, target.dist + effSpeed * t * SHELL_LEAD_FACTOR);
      path.sample(d, _leadVec);
      px = _leadVec.x;
      pz = _leadVec.z;
      t = Math.max(0.06, Math.hypot(px - sx, pz - sz) / shellSpeed);
    }
    return { x: px, z: pz };
  }

  update(dt: number, towers: readonly TowerEntity[]): void {
    let pos = 0;
    while (pos < this.projectilePool.getActiveCount()) {
      const idx = this.projectilePool.getActiveIndex(pos);
      const p = this.projectilePool.items[idx];

      p.prevX = p.x;
      p.prevY = p.y;
      p.prevZ = p.z;
      p.prevYaw = p.yaw;

      // Linear homing projectiles track moving targets cleanly
      if (!p.parabolic && p.targetPoolIndex >= 0) {
        const target = this.enemyPool.items[p.targetPoolIndex];
        if (target.active && target.uid === p.targetUid) {
          p.endX = target.x;
          p.endY = target.y + target.height * 0.55;
          p.endZ = target.z;
        }
      }

      p.progress += dt / p.duration;
      const t = Math.min(1, p.progress);

      const nx = p.startX + (p.endX - p.startX) * t;
      const nz = p.startZ + (p.endZ - p.startZ) * t;
      let ny = p.startY + (p.endY - p.startY) * t;
      if (p.parabolic) {
        ny += 4 * p.arcHeight * t * (1 - t);
      }

      const dx = nx - p.x;
      const dz = nz - p.z;
      if (dx * dx + dz * dz > 0.00001) {
        p.yaw = Math.atan2(dx, dz);
      }
      p.x = nx;
      p.y = ny;
      p.z = nz;

      if (p.progress >= 1) {
        this.resolveImpact(p, towers);
        this.projectilePool.releaseAtActivePos(pos);
      } else {
        pos++;
      }
    }
  }

  private resolveImpact(p: ProjectileEntity, towers: readonly TowerEntity[]): void {
    const sourceTower = this.findTowerById(towers, p.towerId);
    const falloffMin = p.splashFalloffMin;
    const def = TOWER_DEFS[p.towerType];

    let hitBoss = false;

    if (p.splashRadius > 0) {
      this.spatialHash.query(p.endX, p.endZ, p.splashRadius, _splashCandidates);
      const rSq = p.splashRadius * p.splashRadius;
      for (let i = 0; i < _splashCandidates.length; i++) {
        const e = this.enemyPool.items[_splashCandidates[i]];
        if (!e.active || e.hp <= 0) continue;
        if (e.flying && !def.hitsFlyers) continue;

        const dx = e.x - p.endX;
        const dz = e.z - p.endZ;
        const dSq = dx * dx + dz * dz;
        if (dSq > rSq) continue;

        const dist = Math.sqrt(dSq);
        const falloff = computeSplashMultiplier(dist, p.splashRadius, falloffMin);
        const dmg = Math.round(p.damage * falloff);
        const res = this.enemySystem.applyDamage(e, dmg);
        if (e.type === 'boss' && res.actualDamage > 0) hitBoss = true;
        if (p.slowRatio > 0) {
          this.enemySystem.applySlow(e, p.slowRatio, p.slowDuration);
        }
        if (sourceTower) {
          sourceTower.totalDamageDealt += res.actualDamage;
          if (res.killed) sourceTower.kills++;
        }
      }
    } else if (p.targetPoolIndex >= 0) {
      const target = this.enemyPool.items[p.targetPoolIndex];
      if (target.active && target.uid === p.targetUid && target.hp > 0) {
        const res = this.enemySystem.applyDamage(target, p.damage);
        if (target.type === 'boss' && res.actualDamage > 0) hitBoss = true;
        if (p.slowRatio > 0) {
          this.enemySystem.applySlow(target, p.slowRatio, p.slowDuration);
        }
        if (sourceTower) {
          sourceTower.totalDamageDealt += res.actualDamage;
          if (res.killed) sourceTower.kills++;
        }
      }
    }

    this.events.emit('projectileImpact', {
      towerType: p.towerType as TowerType,
      x: p.endX,
      y: p.endY,
      z: p.endZ,
      radius: p.splashRadius,
      isBossHit: hitBoss,
    });
  }

  private findTowerById(towers: readonly TowerEntity[], id: number): TowerEntity | null {
    for (let i = 0; i < towers.length; i++) {
      if (towers[i].id === id) return towers[i];
    }
    return null;
  }
}

export function computeSplashMultiplier(
  distance: number,
  radius: number,
  falloffMin: number,
): number {
  if (radius <= 0) return 1;
  const t = Math.max(0, Math.min(1, distance / radius));
  return 1 - (1 - falloffMin) * t;
}
