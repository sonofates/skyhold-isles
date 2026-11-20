import type { EventBus } from '../core/eventBus.ts';
import type { ObjectPool } from '../core/pool.ts';
import type { TowerType } from '../core/types.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import { TOWER_DEFS, towerStats } from '../data/towers.ts';
import type { EnemyEntity, ProjectileEntity, TowerEntity } from './entities.ts';
import type { EnemySystem } from './enemySystem.ts';
import type { SpatialHashGrid } from './spatialHash.ts';

const _burnCandidates: number[] = [];
const _splashCandidates: number[] = [];
const _pierceCandidates: number[] = [];
/** Seconds between burn ticks (all patches tick together so overlapping patches never double-hit). */
export const BURN_TICK_INTERVAL = 0.5;
const MAX_BURN_ZONES = 14;
const _burnHit = new Set<number>();
const _pierceUsed = new Set<number>();
/** Half-width of the corridor a piercing bolt can hit enemies in. */
const PIERCE_HALF_WIDTH = 0.55;
const _leadVec = { x: 0, y: 0, z: 0 };
const _impactOut = { x: 0, z: 0 };

/** Fraction of full target lead applied to parabolic shells (1 = perfect aim). */
const SHELL_LEAD_FACTOR = 0.8;
const SHELL_LEAD_ITERATIONS = 5;

export interface ReadonlyBurnZone {
  readonly active: boolean;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly timeLeft: number;
  readonly damage: number;
  readonly towerId: number;
}

interface BurnZone extends ReadonlyBurnZone {
  active: boolean;
  x: number;
  z: number;
  radius: number;
  timeLeft: number;
  damage: number;
  towerId: number;
}

export interface HeroShotParams {
  readonly style: TowerType;
  readonly startX: number;
  readonly startY: number;
  readonly startZ: number;
  readonly target: EnemyEntity;
  readonly damage: number;
  readonly speed: number;
  readonly splashRadius: number;
  readonly armorPierce: number;
  readonly slowRatio: number;
  readonly slowDuration: number;
  readonly hitsFlyers: boolean;
  readonly lateral?: number;
}

export class ProjectileSystem {
  private readonly burnZones: BurnZone[] = [];
  private readonly burnTickZones: BurnZone[] = [];
  private burnTickTimer = BURN_TICK_INTERVAL;
  private resetGen = 0;
  /** Invoked when a `fromHero` projectile deals positive damage to an enemy. */
  onHeroHit: ((target: EnemyEntity, actualDamage: number, killed: boolean) => void) | null = null;

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
    for (let i = 0; i < MAX_BURN_ZONES; i++) {
      this.burnZones.push({ active: false, x: 0, z: 0, radius: 0, timeLeft: 0, damage: 0, towerId: 0 });
    }
  }

  getActiveBurnZoneCount(): number {
    let n = 0;
    for (let i = 0; i < this.burnZones.length; i++) if (this.burnZones[i].active) n++;
    return n;
  }

  getBurnZones(): readonly ReadonlyBurnZone[] {
    return this.burnZones;
  }

  getBurnTickTimer(): number {
    return this.burnTickTimer;
  }

  clearBurnZones(): void {
    this.resetGen++;
    for (let i = 0; i < this.burnZones.length; i++) this.burnZones[i].active = false;
    this.burnTickTimer = BURN_TICK_INTERVAL;
  }

  private spawnBurnZone(p: ProjectileEntity): void {
    // Reuse an inactive slot, else overwrite the patch closest to expiry.
    let slot: BurnZone | null = null;
    let soonest = Infinity;
    for (let i = 0; i < this.burnZones.length; i++) {
      const z = this.burnZones[i];
      if (!z.active) {
        slot = z;
        break;
      }
      if (z.timeLeft < soonest) {
        soonest = z.timeLeft;
        slot = z;
      }
    }
    if (!slot) return;
    slot.active = true;
    slot.x = p.endX;
    slot.z = p.endZ;
    slot.radius = p.burnRadius;
    slot.timeLeft = p.burnDuration;
    slot.damage = p.burnDamage;
    slot.towerId = p.towerId;
    this.events.emit('groundZone', {
      kind: 'fire',
      x: p.endX,
      z: p.endZ,
      radius: p.burnRadius,
      duration: p.burnDuration,
    });
  }

  private updateBurnZones(dt: number, towers: readonly TowerEntity[]): void {
    let any = false;
    for (let i = 0; i < this.burnZones.length; i++) {
      const z = this.burnZones[i];
      if (!z.active) continue;
      z.timeLeft -= dt;
      if (z.timeLeft <= 0) z.active = false;
      else any = true;
    }
    if (!any) {
      this.burnTickTimer = BURN_TICK_INTERVAL;
      return;
    }
    this.burnTickTimer -= dt;
    if (this.burnTickTimer > 0) return;
    this.burnTickTimer += BURN_TICK_INTERVAL;

    // Strongest covering patch wins. Stable sorting preserves pool-slot credit for ties.
    const zones = this.burnTickZones;
    zones.length = 0;
    for (const zone of this.burnZones) if (zone.active) zones.push(zone);
    zones.sort((a, b) => b.damage - a.damage);
    _burnHit.clear();
    const gen = this.resetGen;
    for (const z of zones) {
      if (this.resetGen !== gen) return;
      this.spatialHash.query(z.x, z.z, z.radius, _burnCandidates);
      const rSq = z.radius * z.radius;
      for (let k = 0; k < _burnCandidates.length; k++) {
        if (this.resetGen !== gen) return;
        const idx = _burnCandidates[k];
        if (_burnHit.has(idx)) continue;
        const e = this.enemyPool.items[idx];
        if (!e.active || e.hp <= 0 || e.flying || e.burrowed) continue;
        const dx = e.x - z.x;
        const dz = e.z - z.z;
        if (dx * dx + dz * dz > rSq) continue;
        _burnHit.add(idx);
        const res = this.enemySystem.applyDamage(e, z.damage, true);
        if (res.actualDamage > 0) {
          const src = this.findTowerById(towers, z.towerId);
          if (src) {
            src.totalDamageDealt += res.actualDamage;
            if (res.killed) src.kills++;
          }
        }
      }
    }
  }

  /**
   * @param damageMult scales this projectile's damage (volley arrows)
   * @param lateral    launch-point offset perpendicular to the aim direction (fans volley arrows out)
   */
  spawnProjectile(
    tower: TowerEntity,
    target: EnemyEntity,
    splashFalloffMin: number,
    damageMult = 1,
    lateral = 0,
  ): ProjectileEntity | null {
    const p = this.projectilePool.acquire();
    if (!p) return null;

    const def = TOWER_DEFS[tower.type];
    const stats = towerStats(tower);
    let sx = tower.x;
    const sy = def.turretHeight + 0.15;
    let sz = tower.z;
    if (lateral !== 0) {
      const ax = target.x - tower.x;
      const az = target.z - tower.z;
      const al = Math.hypot(ax, az);
      if (al > 0.0001) {
        sx += (-az / al) * lateral;
        sz += (ax / al) * lateral;
      }
    }
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
    p.damage = stats.damage * damageMult;
    p.splashRadius = stats.splashRadius;
    p.splashFalloffMin = splashFalloffMin;
    p.slowRatio = stats.slowRatio;
    p.slowDuration = stats.slowDuration;
    p.parabolic = parabolic;
    p.arcHeight = stats.parabolicArcHeight;
    p.speed = Math.max(1, stats.projectileSpeed);
    p.armorPierce = stats.armorPierce ?? 0;
    p.pierceCount = stats.pierceCount ?? 0;
    p.pierceLength = stats.pierceLength ?? 0;
    p.pierceFalloff = stats.pierceFalloff ?? 1;
    p.brittle = stats.brittle ?? 0;
    p.clusterCount = stats.clusterCount ?? 0;
    p.clusterDamage = stats.clusterDamage ?? 0;
    p.clusterRadius = stats.clusterRadius ?? 0;
    p.clusterOffset = stats.clusterOffset ?? 0;
    p.clusterSeed = tower.shotCount;
    p.burnDamage = stats.burnDamage ?? 0;
    p.burnRadius = stats.burnRadius ?? 0;
    p.burnDuration = stats.burnDuration ?? 0;
    p.fromHero = false;
    p.hitsFlyersOverride = false;

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

  /** Spawns a projectile fired by a ranged hero or deployed hero gizmo (`towerId = 0`). */
  spawnHeroProjectile(params: HeroShotParams): ProjectileEntity | null {
    const p = this.projectilePool.acquire();
    if (!p) return null;

    let sx = params.startX;
    const sy = params.startY;
    let sz = params.startZ;
    const lateral = params.lateral ?? 0;
    const target = params.target;
    if (lateral !== 0) {
      const ax = target.x - sx;
      const az = target.z - sz;
      const al = Math.hypot(ax, az);
      if (al > 0.0001) {
        sx += (-az / al) * lateral;
        sz += (ax / al) * lateral;
      }
    }
    const tx = target.x;
    const ty = target.y + target.height * 0.55;
    const tz = target.z;
    const dist = Math.hypot(tx - sx, tz - sz);

    p.towerType = params.style;
    p.towerId = 0;
    p.targetUid = target.uid;
    p.targetPoolIndex = target.poolIndex;
    p.damage = params.damage;
    p.splashRadius = params.splashRadius;
    p.splashFalloffMin = 0.6;
    p.slowRatio = params.slowRatio;
    p.slowDuration = params.slowDuration;
    p.parabolic = false;
    p.arcHeight = 0;
    p.speed = Math.max(1, params.speed);
    p.armorPierce = params.armorPierce;
    p.pierceCount = 0;
    p.pierceLength = 0;
    p.pierceFalloff = 1;
    p.brittle = 0;
    p.clusterCount = 0;
    p.clusterDamage = 0;
    p.clusterRadius = 0;
    p.clusterOffset = 0;
    p.clusterSeed = 0;
    p.burnDamage = 0;
    p.burnRadius = 0;
    p.burnDuration = 0;
    p.fromHero = true;
    p.hitsFlyersOverride = params.hitsFlyers;

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
    const path = this.enemySystem.getPath(target.flying, target.lane);

    const effSpeed = target.speed * (1 - target.slowRatio);
    // Lead = displacement of the path sample between "now" and "at impact", added to the
    // enemy's actual position (so an enemy that is not exactly on the path is not snapped to it).
    path.sample(target.dist, _leadVec);
    const baseX = _leadVec.x;
    const baseZ = _leadVec.z;
    let t = Math.max(0.06, Math.hypot(target.x - sx, target.z - sz) / shellSpeed);
    let px = target.x;
    let pz = target.z;
    for (let i = 0; i < SHELL_LEAD_ITERATIONS; i++) {
      const d = Math.min(target.totalDist, target.dist + effSpeed * t * SHELL_LEAD_FACTOR);
      path.sample(d, _leadVec);
      px = target.x + (_leadVec.x - baseX);
      pz = target.z + (_leadVec.z - baseZ);
      t = Math.max(0.06, Math.hypot(px - sx, pz - sz) / shellSpeed);
      _impactOut.x = px;
      _impactOut.z = pz;
    }
    _impactOut.x = px;
    _impactOut.z = pz;
    return _impactOut;
  }

  update(dt: number, towers: readonly TowerEntity[]): void {
    const gen = this.resetGen;
    this.updateBurnZones(dt, towers);
    if (this.resetGen !== gen) return;
    let pos = 0;
    while (pos < this.projectilePool.getActiveCount()) {
      if (this.resetGen !== gen) return;
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
        this.resolveImpact(p, towers, gen);
        if (this.resetGen !== gen) return;
        if (
          p.active &&
          p.progress >= 1 &&
          pos < this.projectilePool.getActiveCount() &&
          this.projectilePool.getActiveIndex(pos) === idx
        ) {
          this.projectilePool.releaseAtActivePos(pos);
        }
      } else {
        pos++;
      }
    }
  }

  private resolveImpact(p: ProjectileEntity, towers: readonly TowerEntity[], gen = this.resetGen): void {
    const sourceTower = p.fromHero ? null : this.findTowerById(towers, p.towerId);
    const def = TOWER_DEFS[p.towerType];
    const hitsFlyers = p.fromHero ? p.hitsFlyersOverride : def.hitsFlyers;

    let hitBoss = false;

    if (p.splashRadius > 0) {
      hitBoss = this.applySplash(p, sourceTower, hitsFlyers, p.endX, p.endZ, p.splashRadius, 1, p.brittle, gen);
      if (this.resetGen !== gen) return;
      if (p.clusterCount > 0) {
        this.resolveCluster(p, sourceTower, hitsFlyers, gen);
        if (this.resetGen !== gen) return;
      }
      if (p.burnDamage > 0) {
        this.spawnBurnZone(p);
        if (this.resetGen !== gen) return;
      }
    } else if (p.targetPoolIndex >= 0) {
      const target = this.enemyPool.items[p.targetPoolIndex];
      if (target.active && target.uid === p.targetUid && target.hp > 0 && !target.burrowed) {
        const res = this.enemySystem.applyDamage(target, p.damage + Math.min(target.armor, p.armorPierce));
        if (ENEMY_DEFS[target.type].isBoss === true && res.actualDamage > 0) hitBoss = true;
        if (sourceTower) {
          sourceTower.totalDamageDealt += res.actualDamage;
          if (res.killed) sourceTower.kills++;
        } else if (p.fromHero && res.actualDamage > 0) {
          this.onHeroHit?.(target, res.actualDamage, res.killed);
        }
        if (this.resetGen !== gen) return;
        if (p.slowRatio > 0 && target.hp > 0) {
          this.enemySystem.applySlow(target, p.slowRatio, p.slowDuration);
          if (this.resetGen !== gen) return;
        }
        if (p.pierceCount > 0) {
          if (this.resolvePierce(p, target, sourceTower, hitsFlyers, gen)) hitBoss = true;
          if (this.resetGen !== gen) return;
        }
      }
    }

    const pierceLen = p.pierceCount > 0 ? p.pierceLength : 0;
    let pierce: { dx: number; dz: number; length: number } | undefined;
    if (pierceLen > 0) {
      const dx = p.endX - p.startX;
      const dz = p.endZ - p.startZ;
      const l = Math.hypot(dx, dz);
      if (l > 0.0001) pierce = { dx: dx / l, dz: dz / l, length: pierceLen };
    }
    this.events.emit('projectileImpact', {
      towerType: p.towerType as TowerType,
      x: p.endX,
      y: p.endY,
      z: p.endZ,
      radius: p.splashRadius,
      isBossHit: hitBoss,
      pierce,
    });
  }

  /** Radial splash damage around (cx, cz); returns whether a boss took damage. */
  private applySplash(
    p: ProjectileEntity,
    sourceTower: TowerEntity | null,
    hitsFlyers: boolean,
    cx: number,
    cz: number,
    radius: number,
    damageScale: number,
    brittle: number,
    gen = this.resetGen,
  ): boolean {
    let hitBoss = false;
    this.spatialHash.query(cx, cz, radius, _splashCandidates);
    const rSq = radius * radius;
    for (let i = 0; i < _splashCandidates.length; i++) {
      if (this.resetGen !== gen) return hitBoss;
      const e = this.enemyPool.items[_splashCandidates[i]];
      if (!e.active || e.hp <= 0 || e.burrowed) continue;
      if (e.flying && !hitsFlyers) continue;

      const dx = e.x - cx;
      const dz = e.z - cz;
      const dSq = dx * dx + dz * dz;
      if (dSq > rSq) continue;

      const dist = Math.sqrt(dSq);
      const falloff = computeSplashMultiplier(dist, radius, p.splashFalloffMin);
      const chill = brittle > 0 ? 1 + brittle * e.slowRatio : 1;
      const dmg = Math.round(p.damage * damageScale * falloff * chill);
      const pierce = p.armorPierce > 0 ? Math.min(e.armor, p.armorPierce) : 0;
      const res = this.enemySystem.applyDamage(e, dmg + pierce);
      if (ENEMY_DEFS[e.type].isBoss === true && res.actualDamage > 0) hitBoss = true;
      if (sourceTower) {
        sourceTower.totalDamageDealt += res.actualDamage;
        if (res.killed) sourceTower.kills++;
      } else if (p.fromHero && res.actualDamage > 0) {
        this.onHeroHit?.(e, res.actualDamage, res.killed);
      }
      if (this.resetGen !== gen) return hitBoss;
      if (chill > 1.05 && res.actualDamage > 0) {
        this.events.emit('brittleCrack', { x: e.x, y: e.flying ? e.y : 0.5, z: e.z, bonus: chill - 1 });
        if (this.resetGen !== gen) return hitBoss;
      }
      if (p.slowRatio > 0 && e.hp > 0) {
        this.enemySystem.applySlow(e, p.slowRatio, p.slowDuration);
      }
    }
    return hitBoss;
  }

  /** Cannon T3: bomblets land in a ring around the main blast (fixed golden-angle rotation per shot). */
  private resolveCluster(
    p: ProjectileEntity,
    sourceTower: TowerEntity | null,
    hitsFlyers: boolean,
    gen = this.resetGen,
  ): void {
    const n = p.clusterCount;
    const base = p.clusterSeed * 2.399963;
    for (let k = 0; k < n; k++) {
      if (this.resetGen !== gen) return;
      const a = base + (k / n) * Math.PI * 2;
      const bx = p.endX + Math.cos(a) * p.clusterOffset;
      const bz = p.endZ + Math.sin(a) * p.clusterOffset;
      const boss = this.applySplash(p, sourceTower, hitsFlyers, bx, bz, p.clusterRadius, p.clusterDamage, 0, gen);
      if (this.resetGen !== gen) return;
      this.events.emit('projectileImpact', {
        towerType: p.towerType as TowerType,
        x: bx,
        y: 0.15,
        z: bz,
        radius: p.clusterRadius,
        isBossHit: boss,
      });
    }
  }

  /**
   * Bolt keeps flying: damages up to `pierceCount` further enemies standing in a narrow corridor behind
   * the primary target (along the shot direction), nearest first, at `pierceFalloff` damage each.
   */
  private resolvePierce(
    p: ProjectileEntity,
    primary: EnemyEntity,
    sourceTower: TowerEntity | null,
    hitsFlyers: boolean,
    gen = this.resetGen,
  ): boolean {
    let hitBoss = false;
    let dirX = p.endX - p.startX;
    let dirZ = p.endZ - p.startZ;
    const dirLen = Math.hypot(dirX, dirZ);
    if (dirLen < 0.0001) return false;
    dirX /= dirLen;
    dirZ /= dirLen;

    const reach = p.pierceLength;
    this.spatialHash.query(
      primary.x + dirX * reach * 0.5,
      primary.z + dirZ * reach * 0.5,
      reach * 0.5 + 0.9,
      _pierceCandidates,
    );
    _pierceUsed.clear();
    const dmg = Math.round(p.damage * p.pierceFalloff);
    for (let n = 0; n < p.pierceCount; n++) {
      if (this.resetGen !== gen) return hitBoss;
      let best: EnemyEntity | null = null;
      let bestAlong = Infinity;
      for (let i = 0; i < _pierceCandidates.length; i++) {
        const idx = _pierceCandidates[i];
        if (idx === primary.poolIndex || _pierceUsed.has(idx)) continue;
        const e = this.enemyPool.items[idx];
        if (!e.active || e.hp <= 0 || e.burrowed) continue;
        if (e.flying && !hitsFlyers) continue;
        const rx = e.x - primary.x;
        const rz = e.z - primary.z;
        const along = rx * dirX + rz * dirZ;
        if (along < -0.2 || along > reach) continue;
        const perp = Math.abs(rx * dirZ - rz * dirX);
        if (perp > PIERCE_HALF_WIDTH + e.radius * 0.6) continue;
        if (along < bestAlong) {
          bestAlong = along;
          best = e;
        }
      }
      if (!best) break;
      _pierceUsed.add(best.poolIndex);
      const res = this.enemySystem.applyDamage(best, dmg + Math.min(best.armor, p.armorPierce));
      if (ENEMY_DEFS[best.type].isBoss === true && res.actualDamage > 0) hitBoss = true;
      if (sourceTower) {
        sourceTower.totalDamageDealt += res.actualDamage;
        if (res.killed) sourceTower.kills++;
      } else if (p.fromHero && res.actualDamage > 0) {
        this.onHeroHit?.(best, res.actualDamage, res.killed);
      }
      if (this.resetGen !== gen) return hitBoss;
    }
    return hitBoss;
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
