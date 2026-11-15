import type { EventBus } from '../core/eventBus.ts';
import type { ObjectPool } from '../core/pool.ts';
import type { EnemyType } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import type { EnemyEntity } from './entities.ts';
import type { CompiledPath } from './path.ts';
import type { SpatialHashGrid } from './spatialHash.ts';

const _sampleVec = { x: 0, y: 0, z: 0 };
const _healCandidates: number[] = [];

export class EnemySystem {
  private nextUid = 1;
  private readonly pool: ObjectPool<EnemyEntity>;
  private readonly groundPath: CompiledPath;
  private readonly flightPath: CompiledPath;
  private readonly spatialHash: SpatialHashGrid;
  private readonly events: EventBus;

  constructor(
    pool: ObjectPool<EnemyEntity>,
    groundPath: CompiledPath,
    flightPath: CompiledPath,
    spatialHash: SpatialHashGrid,
    events: EventBus,
  ) {
    this.pool = pool;
    this.groundPath = groundPath;
    this.flightPath = flightPath;
    this.spatialHash = spatialHash;
    this.events = events;
  }

  spawnEnemy(type: EnemyType, hpScale = 1): EnemyEntity | null {
    const entity = this.pool.acquire();
    if (!entity) return null;

    const def = ENEMY_DEFS[type];
    const path = def.flying ? this.flightPath : this.groundPath;
    const yaw = path.sample(0, _sampleVec);

    entity.uid = this.nextUid++;
    entity.type = type;
    entity.maxHp = Math.round(def.maxHp * hpScale);
    entity.hp = entity.maxHp;
    entity.speed = def.speed;
    entity.armor = def.armor;
    entity.reward = def.reward;
    entity.livesCost = def.livesCost;
    entity.flying = def.flying;
    entity.radius = def.radius;
    entity.height = def.height;

    entity.dist = 0;
    entity.totalDist = Math.max(0.01, path.totalLength);
    entity.x = _sampleVec.x;
    entity.y = _sampleVec.y;
    entity.z = _sampleVec.z;
    entity.prevX = entity.x;
    entity.prevY = entity.y;
    entity.prevZ = entity.z;
    entity.yaw = yaw;
    entity.prevYaw = yaw;

    entity.slowTimer = 0;
    entity.slowRatio = 0;
    entity.hitFlashTimer = 0;
    entity.healTimer = def.healInterval ? def.healInterval * 0.65 : 0;
    entity.walkPhase = (entity.uid * 1.37) % (Math.PI * 2);

    this.events.emit('enemySpawned', {
      enemyId: entity.uid,
      enemyType: type,
      flying: def.flying,
    });

    return entity;
  }

  applyDamage(
    entity: EnemyEntity,
    rawDamage: number,
    ignoreArmor = false,
  ): { actualDamage: number; killed: boolean } {
    if (!entity.active || entity.hp <= 0) {
      return { actualDamage: 0, killed: false };
    }
    const reduced = ignoreArmor
      ? rawDamage
      : Math.max(BALANCE.minArmorDamage, rawDamage - entity.armor);
    const actualDamage = Math.min(entity.hp, Math.round(reduced));
    entity.hp -= actualDamage;
    entity.hitFlashTimer = 0.12;

    this.events.emit('enemyHit', {
      enemyId: entity.uid,
      enemyType: entity.type,
      damage: actualDamage,
      x: entity.x,
      y: entity.y + entity.height * 0.9,
      z: entity.z,
      isBoss: entity.type === 'boss',
    });

    if (entity.hp <= 0) {
      entity.hp = 0;
      return { actualDamage, killed: true };
    }
    return { actualDamage, killed: false };
  }

  applySlow(entity: EnemyEntity, slowRatio: number, duration: number): void {
    if (!entity.active) return;
    const combined = Math.min(BALANCE.maxSlowRatio, Math.max(entity.slowRatio, slowRatio));
    // Stacking slightly increases slow up to cap
    const stacked = Math.min(BALANCE.maxSlowRatio, entity.slowRatio + slowRatio * 0.5);
    entity.slowRatio = Math.max(combined, stacked);
    entity.slowTimer = Math.max(entity.slowTimer, duration);
  }

  update(dt: number, onLeak: (enemy: EnemyEntity) => void, onKill: (enemy: EnemyEntity) => void): void {
    this.spatialHash.clear();

    // First pass: advance movement, handle leaks & deaths, rebuild spatial hash
    let pos = 0;
    while (pos < this.pool.getActiveCount()) {
      const idx = this.pool.getActiveIndex(pos);
      const e = this.pool.items[idx];

      if (e.hp <= 0) {
        onKill(e);
        this.events.emit('enemyKilled', {
          enemyId: e.uid,
          enemyType: e.type,
          reward: e.reward,
          x: e.x,
          y: e.y + e.height * 0.6,
          z: e.z,
        });
        this.pool.releaseAtActivePos(pos);
        continue;
      }

      e.prevX = e.x;
      e.prevY = e.y;
      e.prevZ = e.z;
      e.prevYaw = e.yaw;

      if (e.hitFlashTimer > 0) {
        e.hitFlashTimer = Math.max(0, e.hitFlashTimer - dt);
      }

      if (e.slowTimer > 0) {
        e.slowTimer -= dt;
        if (e.slowTimer <= 0) {
          e.slowTimer = 0;
          e.slowRatio = 0;
        }
      }

      const effectiveSpeed = e.speed * (1 - e.slowRatio);
      e.dist += effectiveSpeed * dt;
      e.walkPhase += effectiveSpeed * dt * 3.4;

      if (e.dist >= e.totalDist) {
        onLeak(e);
        this.events.emit('enemyLeaked', {
          enemyType: e.type,
          livesLost: e.livesCost,
          x: e.x,
          y: e.y,
          z: e.z,
        });
        this.pool.releaseAtActivePos(pos);
        continue;
      }

      const path = e.flying ? this.flightPath : this.groundPath;
      e.yaw = path.sample(e.dist, _sampleVec);
      e.x = _sampleVec.x;
      e.y = _sampleVec.y;
      e.z = _sampleVec.z;

      this.spatialHash.insert(e.poolIndex, e.x, e.z);
      pos++;
    }

    // Second pass: Healer aura pulses (uses newly populated spatial hash)
    const activeCount = this.pool.getActiveCount();
    for (let i = 0; i < activeCount; i++) {
      const idx = this.pool.getActiveIndex(i);
      const healer = this.pool.items[idx];
      if (healer.type !== 'healer' || !healer.active) continue;

      const def = ENEMY_DEFS.healer;
      const interval = def.healInterval ?? 2.6;
      const radius = def.healRadius ?? 3.8;
      const healAmount = def.healAmount ?? 22;

      healer.healTimer -= dt;
      if (healer.healTimer <= 0) {
        healer.healTimer += interval;
        this.spatialHash.query(healer.x, healer.z, radius, _healCandidates);
        const rSq = radius * radius;
        let healedAny = false;
        for (let k = 0; k < _healCandidates.length; k++) {
          const ally = this.pool.items[_healCandidates[k]];
          if (!ally.active || ally.hp >= ally.maxHp) continue;
          const dx = ally.x - healer.x;
          const dz = ally.z - healer.z;
          if (dx * dx + dz * dz <= rSq) {
            ally.hp = Math.min(ally.maxHp, ally.hp + healAmount);
            healedAny = true;
          }
        }
        if (healedAny) {
          this.events.emit('healerPulse', {
            x: healer.x,
            y: healer.y + 0.12,
            z: healer.z,
            radius,
          });
        }
      }
    }
  }
}
