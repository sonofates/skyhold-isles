import type { EventBus } from '../core/eventBus.ts';
import type { ObjectPool } from '../core/pool.ts';
import type { EnemyType } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { ELITE_MODIFIERS, ENEMY_DEFS } from '../data/enemies.ts';
import type { EnemyEntity, TowerEntity } from './entities.ts';
import type { CompiledPath } from './path.ts';
import type { SpatialHashGrid } from './spatialHash.ts';

const _sampleVec = { x: 0, y: 0, z: 0 };
const _healCandidates: number[] = [];
const _blinkFrom = { x: 0, y: 0, z: 0 };
/** Blinkers never teleport to within this path distance of the goal. */
const BLINK_GOAL_MARGIN = 2.0;
/** Hauler raiders never land closer than this to the goal. */
const DROP_GOAL_MARGIN = 3.0;
/**
 * Burrowers must be surfaced for at least this last stretch before the goal: a dive that would end
 * inside it is not started, and a burrower that still reaches it underground pops up at once.
 */
const BURROW_GOAL_MARGIN = 3.0;
/** First burrow dive happens this long after spawning (so it's seen surfaced at the spawn). */
const BURROW_FIRST_SURFACE_SEC = 1.6;
const BOSS_PULSE_RADIUS = 7.6;
const BOSS_PULSE_INTERVAL = 7.0;
const BOSS_PULSE_RETRY_INTERVAL = 0.75;
const BOSS_PULSE_INITIAL_DELAY = 4.2;
const BOSS_STUN_DURATION = 2.65;
/** Gloam Hexer: first hex can start this soon after spawning; retry cadence when nothing is in reach. */
const HEX_FIRST_DELAY = 1.0;
const HEX_RETRY_INTERVAL = 0.4;
/** A locked hex still lands if the tower is within reach × this when the channel ends. */
const HEX_LEASH = 1.25;

export class EnemySystem {
  private nextUid = 1;
  private readonly pool: ObjectPool<EnemyEntity>;
  /** Main ground lane (lane 0). */
  private readonly groundPath: CompiledPath;
  /** All ground lanes: [main, ...extra spawn lanes]. Every lane ends at the same goal. */
  private readonly groundPaths: readonly CompiledPath[];
  private readonly flightPath: CompiledPath;
  private readonly spatialHash: SpatialHashGrid;
  private readonly events: EventBus;

  constructor(
    pool: ObjectPool<EnemyEntity>,
    groundPath: CompiledPath,
    flightPath: CompiledPath,
    spatialHash: SpatialHashGrid,
    events: EventBus,
    extraGroundPaths: readonly CompiledPath[] = [],
  ) {
    this.pool = pool;
    this.groundPath = groundPath;
    this.groundPaths = [groundPath, ...extraGroundPaths];
    this.flightPath = flightPath;
    this.spatialHash = spatialHash;
    this.events = events;
  }

  /** Compiled path an enemy follows (flight lane for flyers), e.g. for shell target leading. */
  getPath(flying: boolean, lane = 0): CompiledPath {
    return flying ? this.flightPath : (this.groundPaths[lane] ?? this.groundPath);
  }

  /** Number of ground lanes (1 + extra spawn lanes). */
  get groundLaneCount(): number {
    return this.groundPaths.length;
  }

  spawnEnemy(type: EnemyType, hpScale = 1, elite = false, lane = 0): EnemyEntity | null {
    const def = ENEMY_DEFS[type];
    const hpMul = elite ? ELITE_MODIFIERS.hpMul : 1;
    const validLane =
      def.flying || lane < 0 || lane >= this.groundPaths.length ? 0 : Math.floor(lane);
    const entity = this.initEnemyAt(
      type,
      validLane,
      0,
      Math.round(def.maxHp * hpScale * hpMul),
      def.speed,
      elite ? Math.round(def.reward * ELITE_MODIFIERS.rewardMul) : def.reward,
      def.livesCost,
      elite ? ELITE_MODIFIERS.scaleMul : 1,
      false,
    );
    if (entity && elite) {
      entity.elite = true;
      entity.armor += ELITE_MODIFIERS.armorBonus;
      entity.baseArmor = entity.armor;
    }
    return entity;
  }

  /** HP scale an enemy was spawned with (wave scale × elite), used to scale its abilities. */
  private hpScaleOf(e: EnemyEntity): number {
    return e.maxHp / ENEMY_DEFS[e.type].maxHp;
  }

  /** Cloud Hauler death: raiders land on the ground path point nearest to the wreck. */
  private spawnDroppedRaiders(carrier: EnemyEntity): number {
    const def = ENEMY_DEFS[carrier.type];
    const count = def.dropCount ?? 0;
    if (count <= 0) return 0;
    const gruntDef = ENEMY_DEFS.grunt;
    // Land on whichever ground lane passes closest beneath the wreck.
    let lane = 0;
    let bestSq = Infinity;
    let nearest = 0;
    for (let l = 0; l < this.groundPaths.length; l++) {
      const d = this.groundPaths[l].nearestDist(carrier.x, carrier.z);
      this.groundPaths[l].sample(d, _sampleVec);
      const dx = _sampleVec.x - carrier.x;
      const dz = _sampleVec.z - carrier.z;
      if (dx * dx + dz * dz < bestSq - 1e-9) {
        bestSq = dx * dx + dz * dz;
        lane = l;
        nearest = d;
      }
    }
    const landPath = this.groundPaths[lane];
    const landDist = Math.max(0, Math.min(landPath.totalLength - DROP_GOAL_MARGIN, nearest));
    const hp = Math.max(
      1,
      Math.round(gruntDef.maxHp * (def.dropHpFrac ?? 0.6) * this.hpScaleOf(carrier)),
    );
    let spawned = 0;
    for (let k = 0; k < count; k++) {
      // Spread raiders out behind the landing point so none spawns further ahead.
      const raider = this.initEnemyAt(
        'grunt',
        lane,
        Math.max(0, landDist - k * 0.45),
        hp,
        gruntDef.speed,
        2,
        gruntDef.livesCost,
        0.86,
        false,
      );
      if (raider) {
        raider.isDropped = true;
        spawned++;
      }
    }
    if (spawned > 0) {
      landPath.sample(landDist, _sampleVec);
      this.events.emit('carrierDrop', {
        x: carrier.x,
        y: carrier.y,
        z: carrier.z,
        groundX: _sampleVec.x,
        groundY: _sampleVec.y,
        groundZ: _sampleVec.z,
        count: spawned,
      });
    }
    return spawned;
  }

  private spawnSplitChild(parent: EnemyEntity, dist: number): EnemyEntity | null {
    const maxHp = Math.max(18, Math.round(parent.maxHp * 0.34));
    const speed = parent.speed * 1.45;
    return this.initEnemyAt('runner', parent.lane, dist, maxHp, speed, 1, 1, 0.72, true);
  }

  private initEnemyAt(
    type: EnemyType,
    lane: number,
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
    const path = this.getPath(def.flying, lane);
    const totalDist = Math.max(0.01, path.totalLength);
    const clampedDist = Math.max(0, Math.min(totalDist, dist));
    const yaw = path.sample(clampedDist, _sampleVec);

    entity.uid = this.nextUid++;
    entity.lane = def.flying ? 0 : lane;
    entity.laneProgressOffset =
      def.flying || entity.lane === 0 ? 0 : this.groundPath.totalLength - path.totalLength;
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
    entity.shield = 0;
    entity.shieldMax = 0;
    entity.burrowed = false;
    entity.armorBreakTimer = 0;
    entity.baseArmor = def.armor;
    entity.elite = false;
    entity.isDropped = false;
    entity.bossPhase = 0;
    entity.channelTimer = 0;
    entity.abilityTimer =
      type === 'burrower'
        ? BURROW_FIRST_SURFACE_SEC
        : type === 'blinker'
          ? (def.blinkInterval ?? 3.4)
          : type === 'warden'
            ? (def.wardInterval ?? 4) * 0.3
            : type === 'hexer'
              ? HEX_FIRST_DELAY
              : 0;
    entity.hexTargetId = -1;

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
    if (!entity.active || entity.hp <= 0 || entity.burrowed) {
      // Burrowed enemies are immune: shots already in flight thud into the dirt.
      return { actualDamage: 0, killed: false };
    }
    let reduced = Math.round(
      ignoreArmor ? rawDamage : Math.max(BALANCE.minArmorDamage, rawDamage - entity.armor),
    );
    entity.hitFlashTimer = 0.12;
    if (entity.shield > 0) {
      const absorbed = Math.min(entity.shield, reduced);
      entity.shield -= absorbed;
      reduced -= absorbed;
      this.events.emit('shieldAbsorb', {
        enemyId: entity.uid,
        amount: absorbed,
        x: entity.x,
        y: entity.y + entity.height * 0.6,
        z: entity.z,
      });
      if (entity.shield <= 0) {
        entity.shield = 0;
        this.events.emit('shieldBroken', {
          enemyId: entity.uid,
          x: entity.x,
          y: entity.y + entity.height * 0.6,
          z: entity.z,
        });
      }
      if (reduced <= 0) {
        return { actualDamage: 0, killed: false };
      }
    }
    const actualDamage = Math.min(entity.hp, reduced);
    entity.hp -= actualDamage;

    this.events.emit('enemyHit', {
      enemyId: entity.uid,
      enemyType: entity.type,
      damage: actualDamage,
      x: entity.x,
      y: entity.y + entity.height * 0.9,
      z: entity.z,
      isBoss: ENEMY_DEFS[entity.type].isBoss === true,
    });

    if (entity.hp <= 0) {
      entity.hp = 0;
      return { actualDamage, killed: true };
    }
    return { actualDamage, killed: false };
  }

  applySlow(entity: EnemyEntity, slowRatio: number, duration: number): void {
    if (!entity.active || entity.burrowed) return;
    const brittleArmor = ENEMY_DEFS[entity.type].brittleArmor;
    if (brittleArmor !== undefined) {
      if (entity.armorBreakTimer <= 0 && entity.armor > brittleArmor) {
        this.events.emit('armorCracked', {
          enemyId: entity.uid,
          x: entity.x,
          y: entity.y + entity.height * 0.7,
          z: entity.z,
        });
      }
      entity.armor = Math.min(entity.baseArmor, brittleArmor);
      entity.armorBreakTimer = Math.max(
        entity.armorBreakTimer,
        ENEMY_DEFS[entity.type].brittleDuration ?? 2.5,
      );
    }
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
          // Both hatchlings spawn at or behind the parent so a splitter killed next to the goal
          // cannot push a child past it (which would leak extra lives instantly).
          this.spawnSplitChild(e, Math.max(0, e.dist - 0.35));
          this.spawnSplitChild(e, Math.max(0, e.dist));
        } else if (e.type === 'carrier') {
          this.spawnDroppedRaiders(e);
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

      if (e.armorBreakTimer > 0) {
        e.armorBreakTimer -= dt;
        if (e.armorBreakTimer <= 0) {
          e.armorBreakTimer = 0;
          e.armor = e.baseArmor;
        }
      }

      if (e.type === 'burrower') {
        this.updateBurrow(e, dt);
      }

      const burrowMul = e.burrowed ? (ENEMY_DEFS.burrower.burrowSpeedMul ?? 1.6) : 1;
      let channelMul = 1;
      if (e.channelTimer > 0) {
        e.channelTimer = Math.max(0, e.channelTimer - dt);
        channelMul = 0;
      }
      const effectiveSpeed = e.speed * (1 - e.slowRatio) * burrowMul * channelMul;
      e.dist += effectiveSpeed * dt;
      e.walkPhase += effectiveSpeed * dt * 3.4;

      if (e.type === 'blinker') {
        this.updateBlink(e, dt);
      }

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

      const path = this.getPath(e.flying, e.lane);
      e.yaw = path.sample(e.dist, _sampleVec);
      e.x = _sampleVec.x;
      e.y = _sampleVec.y;
      e.z = _sampleVec.z;

      if (!e.burrowed) {
        // Burrowed enemies stay out of the hash: no targeting, splash, chains, meteors or heals.
        this.spatialHash.insert(e.poolIndex, e.x, e.z);
      }
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
      } else if (actor.type === 'warden') {
        this.updateWardenPulse(actor, dt);
      } else if (actor.type === 'hexer') {
        this.updateHex(actor, dt, towers);
      } else if (actor.type === 'tempest') {
        this.updateTempest(actor, dt, towers, currentHpScale);
      } else if (actor.type === 'boss') {
        this.updateBossAbilities(actor, dt, towers, currentHpScale);
      }
    }
  }

  /**
   * Tempest Colossus phases. Phase 1 (≤ 66% HP): stops to channel a Stormwall — a barrier on
   * itself and on allies around it. Phase 2 (≤ 33% HP): enrages (faster), summons a mite swarm
   * behind it and thunderclaps every few seconds, jamming the two nearest towers.
   */
  private updateTempest(
    boss: EnemyEntity,
    dt: number,
    towers: readonly TowerEntity[] | undefined,
    currentHpScale: number,
  ): void {
    const def = ENEMY_DEFS.tempest;
    const [t1, t2] = def.phaseThresholds ?? [0.66, 0.33];
    const radius = def.stormwallRadius ?? 5;

    if (boss.bossPhase === 0 && boss.hp <= boss.maxHp * t1) {
      boss.bossPhase = 1;
      boss.channelTimer = def.stormwallChannelSec ?? 1.3;
      const selfShield = Math.round(boss.maxHp * (def.stormwallSelfFrac ?? 0.2));
      boss.shield = Math.max(boss.shield, selfShield);
      boss.shieldMax = Math.max(boss.shieldMax, boss.shield);
      this.spatialHash.query(boss.x, boss.z, radius, _healCandidates);
      const rSq = radius * radius;
      for (let k = 0; k < _healCandidates.length; k++) {
        const ally = this.pool.items[_healCandidates[k]];
        if (!ally.active || ally.hp <= 0 || ally === boss) continue;
        const dx = ally.x - boss.x;
        const dz = ally.z - boss.z;
        if (dx * dx + dz * dz > rSq) continue;
        const amount = Math.round(ally.maxHp * (def.stormwallAllyFrac ?? 0.6));
        if (ally.shield < amount) {
          ally.shield = amount;
          ally.shieldMax = amount;
        }
      }
      this.events.emit('bossPhase', {
        enemyId: boss.uid,
        enemyType: boss.type,
        phase: 1,
        x: boss.x,
        y: boss.y + 0.2,
        z: boss.z,
        radius,
      });
    }

    if (boss.bossPhase === 1 && boss.hp <= boss.maxHp * t2) {
      boss.bossPhase = 2;
      boss.speed *= def.enrageSpeedMul ?? 1.35;
      boss.channelTimer = 0;
      boss.abilityTimer = 1.2;
      const miteDef = ENEMY_DEFS.mite;
      const miteHp = Math.max(1, Math.round(miteDef.maxHp * currentHpScale));
      const count = def.enrageSummonCount ?? 6;
      let spawned = 0;
      for (let k = 0; k < count; k++) {
        const mite = this.initEnemyAt(
          'mite',
          boss.lane,
          Math.max(0, boss.dist - 0.9 - k * 0.32),
          miteHp,
          miteDef.speed,
          1,
          miteDef.livesCost,
          1,
          false,
        );
        if (mite) {
          this.spatialHash.insert(mite.poolIndex, mite.x, mite.z);
          spawned++;
        }
      }
      this.events.emit('bossPhase', {
        enemyId: boss.uid,
        enemyType: boss.type,
        phase: 2,
        x: boss.x,
        y: boss.y + 0.2,
        z: boss.z,
        radius: def.jamRadius ?? 7.6,
      });
      if (spawned > 0) {
        this.events.emit('bossSummon', {
          x: boss.x,
          y: boss.y + 0.8,
          z: boss.z,
          count: spawned,
        });
      }
    }

    if (boss.bossPhase === 2 && towers && towers.length > 0) {
      boss.abilityTimer -= dt;
      if (boss.abilityTimer <= 0) {
        const jamRadius = def.jamRadius ?? 7.6;
        const stunnedTowerIds = this.applyBossPulse(boss, towers, jamRadius);
        if (stunnedTowerIds.length > 0) {
          boss.abilityTimer = def.jamInterval ?? 6;
          this.events.emit('bossPulse', {
            x: boss.x,
            y: boss.y + 0.45,
            z: boss.z,
            radius: jamRadius,
            stunnedTowerIds,
          });
        } else {
          boss.abilityTimer = BOSS_PULSE_RETRY_INTERVAL;
        }
      }
    }
  }

  /**
   * Gloam Hexer: when an un-hexed tower stands within reach it stops and channels (telegraph), then
   * stuns the locked tower — or, if that tower was sold / is out of reach, the nearest other one.
   * Killing the hexer mid-channel cancels the hex.
   */
  private updateHex(e: EnemyEntity, dt: number, towers: readonly TowerEntity[] | undefined): void {
    const def = ENEMY_DEFS.hexer;
    const radius = def.hexRadius ?? 3.6;
    if (e.hexTargetId >= 0) {
      if (e.channelTimer > 0) return;
      let target: TowerEntity | null = null;
      if (towers) {
        for (let i = 0; i < towers.length; i++) {
          if (towers[i].id === e.hexTargetId) {
            target = towers[i];
            break;
          }
        }
      }
      e.hexTargetId = -1;
      e.abilityTimer = def.hexInterval ?? 5.5;
      if (!target || Math.hypot(target.x - e.x, target.z - e.z) > radius * HEX_LEASH) {
        target = towers ? this.nearestUnstunnedTower(e, towers, radius) : null;
      }
      if (!target) {
        e.abilityTimer = HEX_RETRY_INTERVAL;
        return;
      }
      const duration = def.hexStunSec ?? 2.4;
      target.stunTimer = Math.max(target.stunTimer, duration);
      this.events.emit('towerHexed', {
        enemyId: e.uid,
        towerId: target.id,
        x: e.x,
        y: e.y + e.height,
        z: e.z,
        towerX: target.x,
        towerZ: target.z,
        duration,
      });
      return;
    }
    e.abilityTimer -= dt;
    if (e.abilityTimer > 0 || !towers) return;
    const target = this.nearestUnstunnedTower(e, towers, radius);
    if (!target) {
      e.abilityTimer = HEX_RETRY_INTERVAL;
      return;
    }
    e.hexTargetId = target.id;
    e.channelTimer = def.hexChannelSec ?? 0.7;
    this.events.emit('hexCharge', {
      enemyId: e.uid,
      towerId: target.id,
      x: e.x,
      y: e.y + e.height,
      z: e.z,
      towerX: target.x,
      towerZ: target.z,
    });
  }

  private nearestUnstunnedTower(
    e: EnemyEntity,
    towers: readonly TowerEntity[],
    radius: number,
  ): TowerEntity | null {
    let best: TowerEntity | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      if (t.stunTimer > 0) continue;
      const d = Math.hypot(t.x - e.x, t.z - e.z);
      if (d > radius) continue;
      if (d < bestDist || (d === bestDist && best !== null && t.id < best.id)) {
        best = t;
        bestDist = d;
      }
    }
    return best;
  }

  /** Burrower phase machine: surfaced (abilityTimer counts down) ⇄ burrowed. */
  private updateBurrow(e: EnemyEntity, dt: number): void {
    const def = ENEMY_DEFS.burrower;
    const surfaceLimit = e.totalDist - BURROW_GOAL_MARGIN;
    e.abilityTimer -= dt;
    // Never reach the sanctuary underground (e.g. a dive started while slowed, then the slow ended).
    const forceSurface = e.burrowed && e.dist >= surfaceLimit;
    if (e.abilityTimer > 0 && !forceSurface) return;
    if (!e.burrowed) {
      // Only dive if the whole dive (at full underground speed) ends before the surface limit.
      const diveSec = def.burrowDiveSec ?? 1.6;
      const diveReach = e.speed * (def.burrowSpeedMul ?? 1.6) * diveSec;
      if (e.dist + diveReach > surfaceLimit) {
        e.abilityTimer = 0.5;
        return;
      }
    }
    if (forceSurface) e.abilityTimer = 0;
    e.burrowed = !e.burrowed;
    e.abilityTimer += e.burrowed ? (def.burrowDiveSec ?? 1.6) : (def.burrowSurfaceSec ?? 2.8);
    if (e.burrowed) {
      // Barriers don't survive the dig.
      e.shield = 0;
    }
    this.events.emit('enemyBurrow', {
      enemyId: e.uid,
      burrowed: e.burrowed,
      x: e.x,
      y: e.y,
      z: e.z,
    });
  }

  /** Blinker: charge (slowed by chill) then teleport forward along the path. */
  private updateBlink(e: EnemyEntity, dt: number): void {
    const def = ENEMY_DEFS.blinker;
    e.abilityTimer -= dt * (1 - e.slowRatio);
    if (e.abilityTimer > 0) return;
    e.abilityTimer += def.blinkInterval ?? 3.4;
    const target = Math.min(e.totalDist - BLINK_GOAL_MARGIN, e.dist + (def.blinkDistance ?? 4.5));
    if (target <= e.dist + 0.25) return;
    const path = this.getPath(e.flying, e.lane);
    path.sample(e.dist, _blinkFrom);
    e.dist = target;
    path.sample(e.dist, _sampleVec);
    // Teleports must not interpolate across the gap in the renderer.
    e.prevX = _sampleVec.x;
    e.prevY = _sampleVec.y;
    e.prevZ = _sampleVec.z;
    this.events.emit('enemyBlink', {
      enemyId: e.uid,
      fromX: _blinkFrom.x,
      fromY: _blinkFrom.y,
      fromZ: _blinkFrom.z,
      toX: _sampleVec.x,
      toY: _sampleVec.y,
      toZ: _sampleVec.z,
    });
  }

  /** Aegis Warden: periodically tops up a shield on nearby allies (never itself or other wardens). */
  private updateWardenPulse(warden: EnemyEntity, dt: number): void {
    const def = ENEMY_DEFS.warden;
    warden.abilityTimer -= dt;
    if (warden.abilityTimer > 0) return;
    warden.abilityTimer += def.wardInterval ?? 4;
    const radius = def.wardRadius ?? 3.4;
    const shieldAmount = Math.max(1, Math.round((def.wardShield ?? 26) * this.hpScaleOf(warden)));
    this.spatialHash.query(warden.x, warden.z, radius, _healCandidates);
    const rSq = radius * radius;
    let shielded = 0;
    for (let k = 0; k < _healCandidates.length; k++) {
      const ally = this.pool.items[_healCandidates[k]];
      if (!ally.active || ally.hp <= 0 || ally === warden || ally.type === 'warden') continue;
      const dx = ally.x - warden.x;
      const dz = ally.z - warden.z;
      if (dx * dx + dz * dz > rSq) continue;
      if (ally.shield < shieldAmount) {
        ally.shield = shieldAmount;
        ally.shieldMax = shieldAmount;
        shielded++;
      }
    }
    if (shielded > 0) {
      this.events.emit('wardPulse', {
        x: warden.x,
        y: warden.y + 0.12,
        z: warden.z,
        radius,
        shieldedCount: shielded,
      });
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
          boss.lane,
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
