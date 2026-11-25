import type { EventBus } from '../core/eventBus.ts';
import type { ObjectPool } from '../core/pool.ts';
import type { TowerType, Vec3 } from '../core/types.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import { TOWER_DEFS, towerStats } from '../data/towers.ts';
import type { EnemyEntity, TowerEntity } from './entities.ts';
import type { EnemySystem } from './enemySystem.ts';
import type { ProjectileSystem } from './projectileSystem.ts';
import type { SpatialHashGrid } from './spatialHash.ts';
import { acquireTarget, attackReach } from './targeting.ts';

/** Attack range a Veilcaster veil takes away (non-stacking per tower). */
const VEIL_RANGE_CUT = (() => {
  const a = ENEMY_DEFS.veilcaster.ability;
  return a?.kind === 'veil' ? a.rangeCut : 0;
})();

/** Seconds between Beacon aura pulse effects. */
export const BEACON_PULSE_INTERVAL = 2.6;

const _chainCandidates: number[] = [];
const _volleyCandidates: number[] = [];
const _stepTowerIds: number[] = [];
const _hitPoolIndices = new Set<number>();
const _volleyUsed = new Set<number>();

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
  private resetGen = 0;

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

  /** Aborts any in-flight `update()` tower loop when the world transitions to victory/defeat/skip/dispose. */
  abortCurrentStep(): void {
    this.resetGen++;
  }

  /**
   * Recomputes the support aura: each non-beacon tower receives the best fire-rate / range
   * bonus among the un-jammed Beacons covering it (bonuses from several Beacons do not stack).
   */
  applyBeaconAuras(towers: readonly TowerEntity[]): void {
    let anyBeacon = false;
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      t.auraRate = 0;
      t.auraRange = 0;
      if (t.type === 'beacon') anyBeacon = true;
    }
    if (!anyBeacon) return;

    for (let b = 0; b < towers.length; b++) {
      const beacon = towers[b];
      if (beacon.type !== 'beacon' || beacon.stunTimer > 0) continue;
      const bs = towerStats(beacon);
      const rSq = bs.range * bs.range;
      const rate = bs.auraRate ?? 0;
      const rng = bs.auraRange ?? 0;
      for (let i = 0; i < towers.length; i++) {
        const t = towers[i];
        if (t === beacon || t.type === 'beacon') continue;
        const dx = t.x - beacon.x;
        const dz = t.z - beacon.z;
        if (dx * dx + dz * dz > rSq) continue;
        if (rate > t.auraRate) t.auraRate = rate;
        if (rng > t.auraRange) t.auraRange = rng;
      }
    }
  }

  /**
   * Rime Beetle frost: every firing tower inside a live frost patch gets `frostSlow = 1 - rateMul`
   * (the strongest patch wins; patches never stack). Barracks and Beacons are not affected.
   */
  applyFrostPatches(towers: readonly TowerEntity[]): void {
    const patches = this.enemySystem.frostPatches;
    let any = false;
    for (let p = 0; p < patches.length; p++) {
      if (patches[p].active) {
        any = true;
        break;
      }
    }
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      if (!any) {
        if (t.frostSlow) t.frostSlow = 0;
        continue;
      }
      let slow = 0;
      const role = TOWER_DEFS[t.type].role;
      if (role !== 'barracks' && role !== 'support') {
        for (let p = 0; p < patches.length; p++) {
          const patch = patches[p];
          if (!patch.active) continue;
          const dx = t.x - patch.x;
          const dz = t.z - patch.z;
          if (dx * dx + dz * dz > patch.radius * patch.radius) continue;
          slow = Math.max(slow, 1 - patch.rateMul);
        }
      }
      t.frostSlow = slow;
    }
  }

  /**
   * Chapter five range cuts: ticks Veilcaster veils down and sets `rangeCut` on every firing tower
   * from its veil and the Eclipse Sovereign's eclipse (`1 - (1 - veil) * (1 - eclipse)`). Barracks
   * and Beacons are never cut. Towers that were never touched keep no `rangeCut` field at all.
   */
  applyRangeCuts(towers: readonly TowerEntity[], dt: number): void {
    const es = this.enemySystem;
    const eclipse = es.eclipseTimer > 0 ? es.eclipseCut : 0;
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      const veilLeft = t.veilTimer ?? 0;
      if (veilLeft <= 0 && eclipse <= 0 && !t.rangeCut) continue;
      if (veilLeft > 0) t.veilTimer = Math.max(0, veilLeft - dt);
      const role = TOWER_DEFS[t.type].role;
      let cut = 0;
      if (role !== 'barracks' && role !== 'support') {
        const veil = (t.veilTimer ?? 0) > 0 ? VEIL_RANGE_CUT : 0;
        if (veil > 0 || eclipse > 0) cut = 1 - (1 - veil) * (1 - eclipse);
      }
      t.rangeCut = cut;
    }
  }

  /** Per tower type fire-rate multiplier (Workshop family upgrades); missing = 1. */
  towerRateMul: Readonly<Partial<Record<TowerType, number>>> = {};

  update(dt: number, towers: TowerEntity[], fireRateMultiplier = 1): void {
    const turnSpeed = 12.0;
    const rateMult = Math.max(0.01, fireRateMultiplier);
    const gen = this.resetGen;

    this.applyBeaconAuras(towers);
    this.applyFrostPatches(towers);
    this.applyRangeCuts(towers, dt);

    _stepTowerIds.length = 0;
    for (let i = 0; i < towers.length; i++) {
      _stepTowerIds.push(towers[i].id);
    }

    for (let stepIdx = 0; stepIdx < _stepTowerIds.length; stepIdx++) {
      if (this.resetGen !== gen) return;
      const wantId = _stepTowerIds[stepIdx];
      let tower: TowerEntity | undefined;
      if (stepIdx < towers.length && towers[stepIdx].id === wantId) {
        tower = towers[stepIdx];
      } else {
        for (let k = 0; k < towers.length; k++) {
          if (towers[k].id === wantId) {
            tower = towers[k];
            break;
          }
        }
      }
      if (!tower) continue;
      tower.prevYaw = tower.yaw;

      if (tower.recoil > 0) {
        tower.recoil = Math.max(0, tower.recoil - dt * 5.0);
      }
      if (tower.popAnimTimer > 0) {
        tower.popAnimTimer = Math.max(0, tower.popAnimTimer - dt);
      }
      if ((tower.overhaulTimer ?? 0) > 0) {
        tower.overhaulTimer = Math.max(0, (tower.overhaulTimer ?? 0) - dt);
        if (tower.overhaulTimer === 0) tower.overhaulRateBonus = 0;
      }
      if (tower.stunTimer > 0) {
        tower.stunTimer = Math.max(0, tower.stunTimer - dt);
      }
      if ((tower.frostLockTimer ?? 0) > 0) {
        // The ice block never outlasts the stun it shows (cleanses thaw both).
        tower.frostLockTimer = Math.min(Math.max(0, (tower.frostLockTimer ?? 0) - dt), tower.stunTimer);
      }
      if (tower.stunTimer > 0) continue;

      // Barracks never shoot: their soldiers fight in SoldierSystem (stun / pop timers tick above).
      if (TOWER_DEFS[tower.type].role === 'barracks') continue;

      const stats = towerStats(tower);

      if (TOWER_DEFS[tower.type].role === 'support') {
        // Beacons only pulse (cosmetic event driving FX); their aura is applied above.
        tower.cooldownTimer -= dt;
        if (tower.cooldownTimer <= 0) {
          tower.cooldownTimer = BEACON_PULSE_INTERVAL;
          this.events.emit('beaconPulse', {
            towerId: tower.id,
            tier: stats.tier,
            x: tower.x,
            z: tower.z,
            radius: stats.range,
          });
          if (this.resetGen !== gen) return;
        }
        continue;
      }

      if (tower.cooldownTimer > 0) {
        const supportRate =
          1 +
          tower.auraRate +
          (tower.heroRateBonus ?? 0) +
          ((tower.overhaulTimer ?? 0) > 0 ? (tower.overhaulRateBonus ?? 0) : 0);
        tower.cooldownTimer = Math.max(
          0,
          tower.cooldownTimer -
            dt * rateMult * supportRate * (this.towerRateMul[tower.type] ?? 1) * (1 - (tower.frostSlow ?? 0)),
        );
      }

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

          tower.shotCount++;
          let special = false;
          if (tower.type === 'tesla') {
            special = (stats.overloadEvery ?? 0) > 0 && tower.shotCount % stats.overloadEvery! === 0;
            this.fireChainLightning(tower, target, stats, special, gen);
            if (this.resetGen !== gen) return;
          } else {
            this.projectileSystem.spawnProjectile(tower, target, stats.splashFalloffMin);
            if ((stats.volleyEvery ?? 0) > 0 && tower.shotCount % stats.volleyEvery! === 0) {
              special = true;
              this.fireVolley(tower, target, stats);
            }
          }

          this.events.emit('towerFired', {
            towerId: tower.id,
            type: tower.type,
            tier: stats.tier,
            x: tower.x,
            y: def.turretHeight + 0.15,
            z: tower.z,
            yaw: tower.yaw,
            special,
          });
          if (this.resetGen !== gen) return;
        }
      } else {
        // Gentle idle scan sweep
        tower.yaw += dt * 0.35;
      }
    }
  }

  /**
   * Archer T3 volley: extra arrows (reduced damage) go to the enemies closest to the primary target,
   * fanned out from slightly different launch points; leftovers double up on the primary target.
   */
  private fireVolley(
    tower: TowerEntity,
    primary: EnemyEntity,
    stats: ReturnType<typeof towerStats>,
  ): void {
    const extra = stats.volleyExtra ?? 0;
    const dmgMult = stats.volleyDamage ?? 0.6;
    const def = TOWER_DEFS[tower.type];
    const range = attackReach(tower, stats.range);
    // The tier-III volley uses the original neighborhood of grid cells. Swallow Roost
    // has a circular spread within those cells, independent of the lane's grid alignment.
    const radius = stats.volleyRadius;
    const radiusSq = radius === undefined ? Infinity : radius * radius;
    this.spatialHash.query(primary.x, primary.z, radius ?? 3.2, _volleyCandidates);
    _volleyUsed.clear();
    _volleyUsed.add(primary.poolIndex);
    for (let n = 0; n < extra; n++) {
      let best: EnemyEntity | null = null;
      let bestSq = Infinity;
      for (let k = 0; k < _volleyCandidates.length; k++) {
        const idx = _volleyCandidates[k];
        if (_volleyUsed.has(idx)) continue;
        const e = this.enemyPool.items[idx];
        if (!e.active || e.hp <= 0 || e.burrowed) continue;
        if (e.flying && !def.hitsFlyers) continue;
        if (Math.hypot(e.x - tower.x, e.z - tower.z) > range) continue;
        const dx = e.x - primary.x;
        const dz = e.z - primary.z;
        const dSq = dx * dx + dz * dz;
        if (dSq <= radiusSq && dSq < bestSq) {
          bestSq = dSq;
          best = e;
        }
      }
      if (best) _volleyUsed.add(best.poolIndex);
      const lateral = (n % 2 === 0 ? 1 : -1) * 0.2 * (1 + Math.floor(n / 2));
      this.projectileSystem.spawnProjectile(
        tower,
        best ?? primary,
        stats.splashFalloffMin,
        dmgMult,
        lateral,
      );
    }
  }

  private fireChainLightning(
    tower: TowerEntity,
    initialTarget: EnemyEntity,
    stats: ReturnType<typeof towerStats>,
    overload = false,
    gen = this.resetGen,
  ): void {
    const def = TOWER_DEFS.tesla;
    const points: Vec3[] = [{ x: tower.x, y: def.turretHeight + 0.35, z: tower.z }];
    _hitPoolIndices.clear();

    let current: EnemyEntity | null = initialTarget;
    let currentDamage = stats.damage * (overload ? (stats.overloadDamage ?? 1) : 1);
    const maxJumps = Math.max(1, stats.chainCount + (overload ? (stats.overloadChain ?? 0) : 0));

    for (let jump = 0; jump < maxJumps && current !== null; jump++) {
      _hitPoolIndices.add(current.poolIndex);
      points.push({
        x: current.x,
        y: current.y + current.height * 0.55,
        z: current.z,
      });

      // Tesla chains are shield breakers (Sledge Warden shields take 2x).
      const res = this.enemySystem.applyDamage(current, Math.round(currentDamage), false, true);
      tower.totalDamageDealt += res.actualDamage;
      if (res.killed) tower.kills++;
      if (this.resetGen !== gen) return;

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
          candidate.burrowed ||
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

    this.events.emit('lightningChain', { points, overload });
  }
}
