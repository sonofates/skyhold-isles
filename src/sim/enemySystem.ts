import type { EventBus } from '../core/eventBus.ts';
import type { ObjectPool } from '../core/pool.ts';
import type { EnemyType } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import type { EnemyEntity, TowerEntity } from './entities.ts';
import type { CompiledPath } from './path.ts';
import type { SpatialHashGrid } from './spatialHash.ts';

const _sampleVec = { x: 0, y: 0, z: 0 };
const _healCandidates: number[] = [];
const BOSS_PULSE_RADIUS = 7.6;
const BOSS_PULSE_INTERVAL = 7.0;
const BOSS_PULSE_RETRY_INTERVAL = 0.75;
const BOSS_PULSE_INITIAL_DELAY = 4.2;
const BOSS_STUN_DURATION = 2.65;

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
    const def = ENEMY_DEFS[type];
    return this.initEnemyAt(
      type,
      0,
      Math.round(def.maxHp * hpScale),
      def.speed,
      def.reward,
      def.livesCost,
      1,
      false,
    );
  }

  private spawnSplitChild(parent: EnemyEntity, dist: number): EnemyEntity | null {
    const maxHp = Math.max(18, Math.round(parent.maxHp * 0.34));
    const speed = parent.speed * 1.45;
    return this.initEnemyAt('runner', dist, maxHp, speed, 1, 1, 0.72, true);
  }

  private initEnemyAt(
    type: EnemyType,
    dist: number,
    maxHp: number,
    speed: number,
    reward: number,
    livesCost: number,
    scaleOverride: number,
    isSplitChild: boolean,
  ): EnemyEntity | null {
    const entity = this.pool.acquire();
    if (!entity) return null;

    const def = ENEMY_DEFS[type];
    const path = def.flying ? this.flightPath : this.groundPath;
    const totalDist = Math.max(0.01, path.totalLength);
    const clampedDist = Math.max(0, Math.min(totalDist, dist));
    const yaw = path.sample(clampedDist, _sampleVec);

    entity.uid = this.nextUid++;
    entity.type = type;
    entity.maxHp = maxHp;
    entity.hp = maxHp;
    entity.speed = speed;
    entity.armor = def.armor;
    entity.reward = reward;
    entity.livesCost = livesCost;
    entity.flying = def.flying;
    entity.radius = def.radius;
    entity.height = def.height;

    entity.dist = clampedDist;
    entity.totalDist = totalDist;
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
    entity.bossPulseTimer = type === 'boss' ? BOSS_PULSE_INITIAL_DELAY : 0;
    entity.bossSummonedEscorts = false;
    entity.scaleOverride = scaleOverride;
    entity.isSplitChild = isSplitChild;

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

  update(
    dt: number,
    onLeak: (enemy: EnemyEntity) => void,
    onKill: (enemy: EnemyEntity) => void,
    towers?: readonly TowerEntity[],
    currentHpScale = 1,
  ): void {
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
        if (e.type === 'splitter' && !e.isSplitChild) {
          this.events.emit('enemySplit', {
            parentUid: e.uid,
            x: e.x,
            y: e.y + 0.4,
            z: e.z,
            count: 2,
          });
          this.spawnSplitChild(e, Math.max(0, e.dist - 0.35));
          this.spawnSplitChild(e, Math.max(0, Math.min(e.totalDist - 0.5, e.dist + 0.35)));
        }
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

    // Second pass: Healer aura pulses & Boss abilities (uses newly populated spatial hash)
    const activeCount = this.pool.getActiveCount();
    for (let i = 0; i < activeCount; i++) {
      const idx = this.pool.getActiveIndex(i);
      const actor = this.pool.items[idx];
      if (!actor.active || actor.hp <= 0) continue;

      if (actor.type === 'healer') {
        this.updateHealerAura(actor, dt);
      } else if (actor.type === 'boss') {
        this.updateBossAbilities(actor, dt, towers, currentHpScale);
      }
    }
  }

  private updateHealerAura(healer: EnemyEntity, dt: number): void {
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

  private updateBossAbilities(
    boss: EnemyEntity,
    dt: number,
    towers: readonly TowerEntity[] | undefined,
    currentHpScale: number,
  ): void {
    if (!boss.bossSummonedEscorts && boss.hp <= boss.maxHp * 0.5) {
      boss.bossSummonedEscorts = true;
      const runnerDef = ENEMY_DEFS.runner;
      const escortMaxHp = Math.max(1, Math.round(runnerDef.maxHp * (currentHpScale * 0.75)));
      const offsets = [0.8, 1.5];
      let spawnedCount = 0;
      for (let k = 0; k < offsets.length; k++) {
        const escort = this.initEnemyAt(
          'runner',
          Math.max(0, boss.dist - offsets[k]),
          escortMaxHp,
          runnerDef.speed,
          2,
          runnerDef.livesCost,
          1,
          false,
        );
        if (escort) {
          this.spatialHash.insert(escort.poolIndex, escort.x, escort.z);
          spawnedCount++;
        }
      }
      if (spawnedCount > 0) {
        this.events.emit('bossSummon', {
          x: boss.x,
          y: boss.y + 0.8,
          z: boss.z,
          count: spawnedCount,
        });
      }
    }

    if (towers && towers.length > 0) {
      boss.bossPulseTimer -= dt;
      if (boss.bossPulseTimer <= 0) {
        const stunnedTowerIds = this.applyBossPulse(boss, towers, BOSS_PULSE_RADIUS);
        if (stunnedTowerIds.length > 0) {
          boss.bossPulseTimer = BOSS_PULSE_INTERVAL;
          this.events.emit('bossPulse', {
            x: boss.x,
            y: boss.y + 0.45,
            z: boss.z,
            radius: BOSS_PULSE_RADIUS,
            stunnedTowerIds,
          });
        } else {
          boss.bossPulseTimer = BOSS_PULSE_RETRY_INTERVAL;
        }
      }
    }
  }

  private applyBossPulse(
    boss: EnemyEntity,
    towers: readonly TowerEntity[],
    pulseRadius: number,
  ): number[] {
    let best1: TowerEntity | null = null;
    let best1Stunned = false;
    let best1Dist = Infinity;
    let best2: TowerEntity | null = null;
    let best2Stunned = false;
    let best2Dist = Infinity;

    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      const dist = Math.hypot(t.x - boss.x, t.z - boss.z);
      if (dist > pulseRadius) continue;

      const stunned = t.stunTimer > 0;
      const betterThan1 =
        best1 === null ||
        (stunned !== best1Stunned
          ? !stunned
          : dist < best1Dist || (dist === best1Dist && t.id < best1.id));

      if (betterThan1) {
        best2 = best1;
        best2Stunned = best1Stunned;
        best2Dist = best1Dist;
        best1 = t;
        best1Stunned = stunned;
        best1Dist = dist;
      } else {
        const betterThan2 =
          best2 === null ||
          (stunned !== best2Stunned
            ? !stunned
            : dist < best2Dist || (dist === best2Dist && t.id < best2.id));
        if (betterThan2) {
          best2 = t;
          best2Stunned = stunned;
          best2Dist = dist;
        }
      }
    }

    const stunnedTowerIds: number[] = [];
    if (best1) {
      best1.stunTimer = BOSS_STUN_DURATION;
      stunnedTowerIds.push(best1.id);
    }
    if (best2) {
      best2.stunTimer = BOSS_STUN_DURATION;
      stunnedTowerIds.push(best2.id);
    }
    return stunnedTowerIds;
  }
}
