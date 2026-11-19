import type { EventBus } from '../core/eventBus.ts';
import type { ObjectPool } from '../core/pool.ts';
import type { AbilityId } from '../core/types.ts';
import { ABILITY_DEFS, ABILITY_IDS, computeMeteorDamage } from '../data/abilities.ts';
import type { EnemyEntity, TowerEntity } from './entities.ts';
import type { EnemySystem } from './enemySystem.ts';
import type { SpatialHashGrid } from './spatialHash.ts';

export interface ReadonlyPendingMeteor {
  readonly x: number;
  readonly z: number;
  readonly remaining: number;
  readonly radius: number;
  readonly damage: number;
}

interface PendingMeteor extends ReadonlyPendingMeteor {
  remaining: number;
  readonly slowRatio: number;
  readonly slowDuration: number;
}

const _meteorCandidates: number[] = [];

export class AbilitySystem {
  private readonly events: EventBus;
  private readonly cooldowns: Record<AbilityId, number> = {
    meteor: 0,
    overcharge: 0,
  };
  private overchargeRemaining = 0;
  private readonly pendingMeteors: PendingMeteor[] = [];
  /** Scales every ability cooldown (Workshop upgrade); 1 = classic. */
  cooldownMul = 1;

  constructor(events: EventBus) {
    this.events = events;
  }

  reset(): void {
    this.cooldowns.meteor = 0;
    this.cooldowns.overcharge = 0;
    this.overchargeRemaining = 0;
    this.pendingMeteors.length = 0;
  }

  /** Drops in-flight meteors and active buffs at run end or wave skip while preserving cooldowns. */
  clearPending(): void {
    this.pendingMeteors.length = 0;
    this.overchargeRemaining = 0;
  }

  getPendingMeteorCount(): number {
    return this.pendingMeteors.length;
  }

  getPendingMeteors(): readonly ReadonlyPendingMeteor[] {
    return this.pendingMeteors;
  }

  canCast(id: AbilityId): boolean {
    return this.cooldowns[id] <= 0;
  }

  getCooldown(id: AbilityId): number {
    return this.cooldowns[id];
  }

  getMaxCooldown(id: AbilityId): number {
    return ABILITY_DEFS[id].cooldownSec * this.cooldownMul;
  }

  isOverchargeActive(): boolean {
    return this.overchargeRemaining > 0;
  }

  getOverchargeRemaining(): number {
    return this.overchargeRemaining;
  }

  getFireRateMultiplier(): number {
    return this.overchargeRemaining > 0 ? ABILITY_DEFS.overcharge.fireRateMultiplier : 1;
  }

  castMeteor(x: number, z: number, waveOneBased: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (!this.canCast('meteor')) return false;
    const def = ABILITY_DEFS.meteor;
    this.cooldowns.meteor = this.getMaxCooldown('meteor');
    this.pendingMeteors.push({
      x,
      z,
      remaining: def.impactDelaySec,
      radius: def.radius,
      damage: computeMeteorDamage(waveOneBased),
      slowRatio: def.slowRatio,
      slowDuration: def.slowDuration,
    });

    this.events.emit('abilityTargeted', {
      abilityId: 'meteor',
      x,
      z,
      radius: def.radius,
    });
    return true;
  }

  castOvercharge(towers: readonly TowerEntity[]): boolean {
    if (!this.canCast('overcharge')) return false;
    const def = ABILITY_DEFS.overcharge;
    this.cooldowns.overcharge = this.getMaxCooldown('overcharge');
    this.overchargeRemaining = def.durationSec;

    const cleansedTowerIds: number[] = [];
    for (let i = 0; i < towers.length; i++) {
      const tower = towers[i];
      if (tower.stunTimer > 0) {
        tower.stunTimer = 0;
        cleansedTowerIds.push(tower.id);
      }
    }

    this.events.emit('overchargeActivated', {
      duration: def.durationSec,
      cleansedTowerIds,
    });
    return true;
  }

  update(
    dt: number,
    isCombatActive: boolean,
    enemyPool: ObjectPool<EnemyEntity>,
    spatialHash: SpatialHashGrid,
    enemySystem: EnemySystem,
    _onKilledEnemy?: (enemy: EnemyEntity) => void,
  ): void {
    void _onKilledEnemy;
    if (dt <= 0) return;

    if (this.overchargeRemaining > 0) {
      this.overchargeRemaining = Math.max(0, this.overchargeRemaining - dt);
    }

    if (isCombatActive) {
      for (let i = 0; i < ABILITY_IDS.length; i++) {
        const id = ABILITY_IDS[i];
        if (this.cooldowns[id] > 0) {
          this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
        }
      }
    }

    // Pending meteor impacts resolve even if wave ends mid-flight; lethal hits set hp = 0
    // so EnemySystem.update processes kills, splits, rewards, and pool release uniformly.
    let i = 0;
    while (i < this.pendingMeteors.length) {
      const meteor = this.pendingMeteors[i];
      meteor.remaining -= dt;
      if (meteor.remaining > 0) {
        i++;
        continue;
      }

      this.pendingMeteors.splice(i, 1);

      spatialHash.query(meteor.x, meteor.z, meteor.radius, _meteorCandidates);
      const rSq = meteor.radius * meteor.radius;
      for (let k = 0; k < _meteorCandidates.length; k++) {
        const enemy = enemyPool.items[_meteorCandidates[k]];
        if (!enemy.active || enemy.hp <= 0 || enemy.burrowed) continue;
        const dx = enemy.x - meteor.x;
        const dz = enemy.z - meteor.z;
        if (dx * dx + dz * dz > rSq) continue;

        enemySystem.applyDamage(enemy, meteor.damage, true);
        if (enemy.hp > 0 && meteor.slowRatio > 0) {
          enemySystem.applySlow(enemy, meteor.slowRatio, meteor.slowDuration);
        }
      }

      this.events.emit('meteorImpact', {
        x: meteor.x,
        y: 0.25,
        z: meteor.z,
        radius: meteor.radius,
      });
    }
  }
}
