import type { EventBus } from '../core/eventBus.ts';
import type { ObjectPool } from '../core/pool.ts';
import type { Vec3 } from '../core/types.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import { ENEMY_MELEE, SOLDIER_FORMATION, SOLDIER_RULES } from '../data/soldiers.ts';
import { getTowerTierStats, type TowerTierStats } from '../data/towers.ts';
import type { EnemyEntity, TowerEntity } from './entities.ts';
import type { EnemySystem } from './enemySystem.ts';
import type { SpatialHashGrid } from './spatialHash.ts';

/**
 * dead     — waiting in the barracks for the respawn timer
 * walking  — on the way to its post (fresh spawn, new rally point, or back from a fight)
 * idle     — standing at its post (regenerates)
 * engaging — closing in on a claimed enemy (does not block yet)
 * fighting — in melee contact: blocks the enemy and trades blows
 */
export type SoldierState = 'dead' | 'walking' | 'idle' | 'engaging' | 'fighting';

export interface SoldierEntity {
  readonly id: number;
  readonly towerId: number;
  /** Formation slot (0 = first soldier of the squad). */
  readonly slot: number;
  state: SoldierState;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  /** Facing, atan2(dx, dz) like enemies and towers. */
  yaw: number;
  hp: number;
  maxHp: number;
  respawnTimer: number;
  attackTimer: number;
  /** Seconds since the last enemy strike (regeneration waits for SOLDIER_RULES.regenDelay). */
  sinceHurt: number;
  hitFlashTimer: number;
  /** Claimed enemy (pool index + uid; pool slots are reused), -1 / 0 when none. */
  targetPoolIndex: number;
  targetUid: number;
}

export interface BarracksState {
  readonly towerId: number;
  readonly x: number;
  readonly z: number;
  rallyX: number;
  rallyZ: number;
  /** Road direction at the rally point (atan2(dx, dz) toward the goal), orients the formation. */
  rallyYaw: number;
  /** Formation posts, one per soldier slot. */
  readonly postX: number[];
  readonly postZ: number[];
  readonly squad: SoldierEntity[];
  /** Current tier stats of the barracks (soldier HP, damage, armor, respawn). */
  stats: TowerTierStats;
}

/** A road point picked for a rally flag. */
export interface RoadPoint {
  x: number;
  z: number;
  yaw: number;
}

const _v: Vec3 = { x: 0, y: 0, z: 0 };
const _candidates: number[] = [];
const _engageList: number[] = [];
const _blockedList: number[] = [];
const _prevBlocked: number[] = [];
const _prevBlockedUid: number[] = [];

/**
 * Barracks soldiers (deterministic, fixed-step, no RNG). Runs after enemy movement each tick:
 *
 * 1. Respawn, regenerate, and drop engagements that became invalid (target dead or recycled,
 *    flying, burrowed, trampling, or dragged / blinked beyond the leash around the rally point).
 * 2. Free soldiers claim enemies that come within `engageRadius` of the rally point: first those
 *    that still need holding (fewer soldiers than their `holdCost`), nearest-to-goal first; when
 *    every enemy in reach is held, spare soldiers gang up (up to `maxPerEnemy`).
 * 3. Soldiers walk to their post or to contact range; in contact they fight.
 * 4. Fighting soldiers swing (beacon aura + Overcharge speed them up); held enemies strike back
 *    (`ENEMY_MELEE`); a soldier at 0 HP falls and respawns at the barracks after the tier's timer.
 *    A jammed barracks (hexer hex, boss pulse) pauses its respawn timers; soldiers already in the
 *    field keep fighting.
 * 5. `enemy.blockers` is rewritten every tick this system runs (a lease: anything that removes
 *    soldiers can never leave an enemy frozen), and the enemy movement consumes it next tick.
 *
 * Costs nothing on islands without a barracks: `update` returns before touching any enemy.
 */
export class SoldierSystem {
  readonly soldiers: SoldierEntity[] = [];
  readonly barracks: BarracksState[] = [];
  private nextSoldierId = 1;
  /** Blockers may still be set on some enemy: run the clear pass even with no soldiers left. */
  private dirty = false;
  /** Enemies held at the end of the last update (QA / renderer). */
  blockedCount = 0;
  private readonly claims: Int16Array;
  private readonly wasBlocked: Uint8Array;
  private readonly primary: Int32Array;

  private readonly pool: ObjectPool<EnemyEntity>;
  private readonly spatialHash: SpatialHashGrid;
  private readonly enemySystem: EnemySystem;
  private readonly events: EventBus;

  constructor(pool: ObjectPool<EnemyEntity>, spatialHash: SpatialHashGrid, enemySystem: EnemySystem, events: EventBus) {
    this.pool = pool;
    this.spatialHash = spatialHash;
    this.enemySystem = enemySystem;
    this.events = events;
    const n = pool.items.length;
    this.claims = new Int16Array(n);
    this.wasBlocked = new Uint8Array(n);
    this.primary = new Int32Array(n).fill(-1);
  }

  getBarracks(towerId: number): BarracksState | null {
    for (let i = 0; i < this.barracks.length; i++) {
      if (this.barracks[i].towerId === towerId) return this.barracks[i];
    }
    return null;
  }

  /**
   * Nearest road point (any ground lane) to (wantX, wantZ) among those within `range` of the
   * barracks at (cx, cz). False when no road passes within range.
   */
  findRoadPoint(cx: number, cz: number, range: number, wantX: number, wantZ: number, out: RoadPoint): boolean {
    const step = SOLDIER_RULES.rallySampleStep;
    const rSq = range * range;
    let best = Infinity;
    let found = false;
    for (let lane = 0; lane < this.enemySystem.groundLaneCount; lane++) {
      const path = this.enemySystem.getPath(false, lane);
      const n = Math.ceil(path.totalLength / step);
      for (let i = 0; i <= n; i++) {
        const d = Math.min(path.totalLength, i * step);
        const yaw = path.sample(d, _v);
        const dx = _v.x - cx;
        const dz = _v.z - cz;
        if (dx * dx + dz * dz > rSq) continue;
        const wx = _v.x - wantX;
        const wz = _v.z - wantZ;
        const dSq = wx * wx + wz * wz;
        if (dSq < best - 1e-9) {
          best = dSq;
          out.x = _v.x;
          out.z = _v.z;
          out.yaw = yaw;
          found = true;
        }
      }
    }
    return found;
  }

  /** True when a barracks at (x, z) with this rally range would reach the road. */
  hasRoadInRange(x: number, z: number, range: number): boolean {
    const p: RoadPoint = { x: 0, z: 0, yaw: 0 };
    return this.findRoadPoint(x, z, range, x, z, p);
  }

  /** New barracks: rally on the nearest road point, squad steps out of the gate. */
  addBarracks(tower: TowerEntity): BarracksState | null {
    const stats = getTowerTierStats(tower.type, tower.tier);
    const p: RoadPoint = { x: 0, z: 0, yaw: 0 };
    if (!this.findRoadPoint(tower.x, tower.z, stats.range, tower.x, tower.z, p)) return null;
    const b: BarracksState = {
      towerId: tower.id,
      x: tower.x,
      z: tower.z,
      rallyX: p.x,
      rallyZ: p.z,
      rallyYaw: p.yaw,
      postX: [],
      postZ: [],
      squad: [],
      stats,
    };
    this.barracks.push(b);
    this.layoutPosts(b, stats.soldierCount ?? 0);
    this.events.emit('rallyMoved', { towerId: b.towerId, x: b.rallyX, z: b.rallyZ });
    for (let slot = 0; slot < (stats.soldierCount ?? 0); slot++) this.createSoldier(b, slot, stats);
    return b;
  }

  /**
   * Player order: move the rally point (clamped to the barracks range and onto the road). The
   * squad lets go of its fights and walks to the new posts. False if the barracks is unknown.
   */
  setRally(tower: TowerEntity, x: number, z: number): boolean {
    const b = this.getBarracks(tower.id);
    if (!b) return false;
    const stats = getTowerTierStats(tower.type, tower.tier);
    const p: RoadPoint = { x: 0, z: 0, yaw: 0 };
    if (!this.findRoadPoint(b.x, b.z, stats.range, x, z, p)) return false;
    b.rallyX = p.x;
    b.rallyZ = p.z;
    b.rallyYaw = p.yaw;
    this.layoutPosts(b, stats.soldierCount ?? b.squad.length);
    for (let i = 0; i < b.squad.length; i++) {
      const s = b.squad[i];
      if (s.state === 'dead') continue;
      this.release(s, true);
      s.state = 'walking';
    }
    this.events.emit('rallyMoved', { towerId: b.towerId, x: b.rallyX, z: b.rallyZ });
    return true;
  }

  /**
   * Upgrade: every soldier is refreshed to the new tier (full HP; fallen ones step out at once)
   * and new slots are filled. The rally point stays (re-clamped if the range shrank — it never
   * does with the shipped tiers).
   */
  onUpgrade(tower: TowerEntity): void {
    const b = this.getBarracks(tower.id);
    if (!b) return;
    const stats = getTowerTierStats(tower.type, tower.tier);
    b.stats = stats;
    const count = stats.soldierCount ?? b.squad.length;
    this.layoutPosts(b, count);
    for (let i = 0; i < b.squad.length; i++) {
      const s = b.squad[i];
      s.maxHp = stats.soldierHp ?? s.maxHp;
      s.hp = s.maxHp;
      if (s.state === 'dead') this.respawn(b, s);
      else if (s.state === 'idle') s.state = 'walking';
    }
    for (let slot = b.squad.length; slot < count; slot++) this.createSoldier(b, slot, stats);
  }

  /** Sell: the squad leaves the field (held enemies are released immediately). */
  removeBarracks(towerId: number): void {
    const bi = this.barracks.findIndex((b) => b.towerId === towerId);
    if (bi === -1) return;
    const b = this.barracks[bi];
    for (let i = 0; i < b.squad.length; i++) {
      const s = b.squad[i];
      if (s.state !== 'dead') {
        this.release(s, true);
        this.events.emit('soldierRemoved', { soldierId: s.id, towerId, x: s.x, z: s.z });
      }
    }
    this.barracks.splice(bi, 1);
    for (let i = this.soldiers.length - 1; i >= 0; i--) {
      if (this.soldiers[i].towerId === towerId) this.soldiers.splice(i, 1);
    }
    this.dirty = true;
  }

  private layoutPosts(b: BarracksState, count: number): void {
    const form = SOLDIER_FORMATION[Math.min(count, SOLDIER_FORMATION.length - 1)] ?? [];
    const ax = Math.sin(b.rallyYaw);
    const az = Math.cos(b.rallyYaw);
    // Across the road: the along vector turned 90°.
    const nx = az;
    const nz = -ax;
    b.postX.length = 0;
    b.postZ.length = 0;
    for (let slot = 0; slot < count; slot++) {
      const f = form[slot] ?? [0, 0];
      b.postX.push(b.rallyX + ax * f[0] + nx * f[1]);
      b.postZ.push(b.rallyZ + az * f[0] + nz * f[1]);
    }
  }

  private createSoldier(b: BarracksState, slot: number, stats: TowerTierStats): SoldierEntity {
    const s: SoldierEntity = {
      id: this.nextSoldierId++,
      towerId: b.towerId,
      slot,
      state: 'dead',
      x: b.x,
      z: b.z,
      prevX: b.x,
      prevZ: b.z,
      yaw: 0,
      hp: stats.soldierHp ?? 1,
      maxHp: stats.soldierHp ?? 1,
      respawnTimer: 0,
      attackTimer: 0,
      sinceHurt: 99,
      hitFlashTimer: 0,
      targetPoolIndex: -1,
      targetUid: 0,
    };
    b.squad.push(s);
    this.soldiers.push(s);
    this.respawn(b, s);
    return s;
  }

  private respawn(b: BarracksState, s: SoldierEntity): void {
    s.state = 'walking';
    s.hp = s.maxHp;
    s.x = s.prevX = b.x;
    s.z = s.prevZ = b.z;
    s.respawnTimer = 0;
    s.attackTimer = 0;
    s.sinceHurt = 99;
    s.hitFlashTimer = 0;
    s.targetPoolIndex = -1;
    s.targetUid = 0;
    this.events.emit('soldierSpawned', { soldierId: s.id, towerId: b.towerId, x: s.x, z: s.z });
  }

  /**
   * Drops the soldier's claim. With `now`, a hold it provided ends immediately (orders / sell);
   * otherwise the next update's recount takes care of it.
   */
  private release(s: SoldierEntity, now: boolean): void {
    if (now && s.state === 'fighting' && s.targetPoolIndex >= 0) {
      const e = this.pool.items[s.targetPoolIndex];
      if (e.active && e.uid === s.targetUid && e.blockers > 0) {
        e.blockers--;
        if (e.blockers === 0) this.emitBlock('enemyUnblocked', e);
      }
    }
    s.targetPoolIndex = -1;
    s.targetUid = 0;
  }

  private emitBlock(kind: 'enemyBlocked' | 'enemyUnblocked', e: EnemyEntity): void {
    this.events.emit(kind, { enemyId: e.uid, enemyType: e.type, x: e.x, y: e.y, z: e.z });
  }

  /** Can soldiers hold this enemy right now? */
  isHoldable(e: EnemyEntity): boolean {
    if (!e.active || e.hp <= 0 || e.flying || e.burrowed) return false;
    const m = ENEMY_MELEE[e.type];
    if (m.block !== 'block') return false;
    return m.trampleFromPhase === undefined || e.bossPhase < m.trampleFromPhase;
  }

  private target(s: SoldierEntity): EnemyEntity | null {
    if (s.targetPoolIndex < 0) return null;
    const e = this.pool.items[s.targetPoolIndex];
    return e.active && e.uid === s.targetUid ? e : null;
  }

  private findTower(towers: readonly TowerEntity[], id: number): TowerEntity | null {
    for (let i = 0; i < towers.length; i++) if (towers[i].id === id) return towers[i];
    return null;
  }

  update(dt: number, towers: readonly TowerEntity[], fireRateMultiplier = 1): void {
    if (this.soldiers.length === 0 && !this.dirty) return;
    this.dirty = this.soldiers.length > 0;
    const pool = this.pool;
    const R = SOLDIER_RULES;

    // Snapshot last tick's holds, then rebuild them from scratch (lease).
    _prevBlocked.length = 0;
    _prevBlockedUid.length = 0;
    for (let i = 0; i < pool.getActiveCount(); i++) {
      const e = pool.items[pool.getActiveIndex(i)];
      if (e.blockers > 0) {
        _prevBlocked.push(e.poolIndex);
        _prevBlockedUid.push(e.uid);
        this.wasBlocked[e.poolIndex] = 1;
      }
      e.blockers = 0;
    }

    // 1. Timers, respawns, regeneration, engagement validation.
    for (let bi = 0; bi < this.barracks.length; bi++) {
      const b = this.barracks[bi];
      const tower = this.findTower(towers, b.towerId);
      const jammed = tower !== null && tower.stunTimer > 0;
      const aura = tower ? 1 + tower.auraRate : 1;
      for (let i = 0; i < b.squad.length; i++) {
        const s = b.squad[i];
        s.prevX = s.x;
        s.prevZ = s.z;
        if (s.hitFlashTimer > 0) s.hitFlashTimer = Math.max(0, s.hitFlashTimer - dt);
        if (s.state === 'dead') {
          if (!jammed) {
            s.respawnTimer -= dt * aura;
            if (s.respawnTimer <= 0) this.respawn(b, s);
          }
          continue;
        }
        s.sinceHurt += dt;
        if (s.state === 'engaging' || s.state === 'fighting') {
          const e = this.target(s);
          const ok =
            e !== null &&
            this.isHoldable(e) &&
            Math.hypot(e.x - b.rallyX, e.z - b.rallyZ) <= R.leashRadius;
          if (!ok) {
            this.release(s, false);
            s.state = 'walking';
          }
        } else if (s.state === 'idle' && s.sinceHurt >= R.regenDelay && s.hp < s.maxHp) {
          s.hp = Math.min(s.maxHp, s.hp + s.maxHp * R.regenFrac * dt);
        }
        if (s.state !== 'engaging' && s.state !== 'fighting') {
          s.attackTimer = Math.max(0, s.attackTimer - dt);
        }
      }
    }

    // 2. Claims already held this tick.
    for (let i = 0; i < this.soldiers.length; i++) {
      const s = this.soldiers[i];
      if ((s.state === 'engaging' || s.state === 'fighting') && s.targetPoolIndex >= 0) {
        this.claims[s.targetPoolIndex]++;
      }
    }

    // 3. Free soldiers claim enemies near their rally point; spare ones peel off to new arrivals.
    for (let bi = 0; bi < this.barracks.length; bi++) {
      const b = this.barracks[bi];
      let anyAlive = false;
      for (let i = 0; i < b.squad.length && !anyAlive; i++) anyAlive = b.squad[i].state !== 'dead';
      if (!anyAlive) continue;
      this.spatialHash.query(b.rallyX, b.rallyZ, R.engageRadius, _candidates);
      _engageList.length = 0;
      const rSq = R.engageRadius * R.engageRadius;
      for (let k = 0; k < _candidates.length; k++) {
        const e = pool.items[_candidates[k]];
        if (!this.isHoldable(e)) continue;
        const dx = e.x - b.rallyX;
        const dz = e.z - b.rallyZ;
        if (dx * dx + dz * dz > rSq) continue;
        _engageList.push(e.poolIndex);
      }
      if (_engageList.length === 0) continue;
      for (let i = 0; i < b.squad.length; i++) {
        const s = b.squad[i];
        if (!this.isFree(b, s)) continue;
        const best = this.pickTarget(false);
        if (!best) break;
        this.claim(s, best);
      }
      // Soldiers ganging up on an enemy that is held without them switch to one nobody holds
      // (last squad slot first, so the first soldiers keep their fights).
      for (let i = b.squad.length - 1; i >= 0; i--) {
        const s = b.squad[i];
        if (s.state !== 'engaging' && s.state !== 'fighting') continue;
        const cur = this.target(s);
        if (!cur || this.claims[cur.poolIndex] <= ENEMY_MELEE[cur.type].holdCost) continue;
        const needy = this.pickTarget(true);
        if (!needy) break;
        this.claims[cur.poolIndex]--;
        this.claim(s, needy);
      }
    }
    for (let i = 0; i < this.soldiers.length; i++) {
      const pi = this.soldiers[i].targetPoolIndex;
      if (pi >= 0) this.claims[pi] = 0;
    }

    // 4. Movement and contact.
    for (let bi = 0; bi < this.barracks.length; bi++) {
      const b = this.barracks[bi];
      for (let i = 0; i < b.squad.length; i++) {
        const s = b.squad[i];
        if (s.state === 'dead') continue;
        const e = s.state === 'engaging' || s.state === 'fighting' ? this.target(s) : null;
        if (e) {
          const contact = e.radius + R.radius;
          let dx = s.x - e.x;
          let dz = s.z - e.z;
          let d = Math.hypot(dx, dz);
          if (d < 1e-6) {
            dx = b.postX[s.slot] - e.x;
            dz = b.postZ[s.slot] - e.z;
            d = Math.hypot(dx, dz);
            if (d < 1e-6) {
              dx = 0;
              dz = -1;
              d = 1;
            }
          }
          this.moveToward(s, e.x + (dx / d) * contact, e.z + (dz / d) * contact, dt);
          const now = Math.hypot(s.x - e.x, s.z - e.z);
          s.yaw = Math.atan2(e.x - s.x, e.z - s.z);
          if (s.state === 'engaging' && now <= contact + 0.08) {
            s.state = 'fighting';
            if (s.attackTimer < 0.2) s.attackTimer = 0.2;
          } else if (s.state === 'fighting' && now > contact + R.contactSlack) {
            s.state = 'engaging';
          }
        } else {
          const px = b.postX[s.slot] ?? b.rallyX;
          const pz = b.postZ[s.slot] ?? b.rallyZ;
          const arrived = this.moveToward(s, px, pz, dt);
          if (arrived && s.state === 'walking') s.state = 'idle';
        }
      }
    }

    // 5. Soldier swings.
    const rate = Math.max(0.01, fireRateMultiplier);
    for (let bi = 0; bi < this.barracks.length; bi++) {
      const b = this.barracks[bi];
      const tower = this.findTower(towers, b.towerId);
      if (!tower) continue;
      const stats = b.stats;
      const swingRate = Math.max(0.01, stats.soldierRate ?? 1);
      const rateMul = rate * (1 + tower.auraRate);
      for (let i = 0; i < b.squad.length; i++) {
        const s = b.squad[i];
        if (s.state !== 'fighting') continue;
        const e = this.target(s);
        if (!e || e.hp <= 0) continue;
        s.attackTimer -= dt * rateMul;
        if (s.attackTimer > 0) continue;
        s.attackTimer += 1 / swingRate;
        if (s.attackTimer <= 0) s.attackTimer = 1 / swingRate;
        this.strike(tower, s, e, stats.soldierDamage ?? 0, false);
        const cleave = stats.soldierCleave ?? 0;
        if (cleave > 0) {
          const other = this.cleaveTarget(e);
          if (other) this.strike(tower, s, other, Math.round((stats.soldierDamage ?? 0) * cleave), true);
        }
      }
    }

    // 6. Holds: soldiers in contact with a living enemy.
    _blockedList.length = 0;
    for (let i = 0; i < this.soldiers.length; i++) {
      const s = this.soldiers[i];
      if (s.state !== 'fighting') continue;
      const e = this.target(s);
      if (!e || e.hp <= 0) continue;
      if (e.blockers === 0) {
        _blockedList.push(e.poolIndex);
        this.primary[e.poolIndex] = i;
      }
      e.blockers++;
    }

    // 7. Held enemies strike back.
    for (let k = 0; k < _blockedList.length; k++) {
      const e = pool.items[_blockedList[k]];
      const m = ENEMY_MELEE[e.type];
      if (!this.wasBlocked[e.poolIndex]) {
        this.emitBlock('enemyBlocked', e);
        if (e.meleeTimer <= 0) e.meleeTimer = 0.5 / Math.max(0.01, m.rate);
      }
      if (m.rate <= 0 || m.damage <= 0) continue;
      // Chill slows the swing as much as the stride.
      e.meleeTimer -= dt * (1 - e.slowRatio);
      if (e.meleeTimer > 0) continue;
      e.meleeTimer += 1 / m.rate;
      if (e.meleeTimer <= 0) e.meleeTimer = 1 / m.rate;
      const scale = Math.sqrt(Math.max(0.01, e.maxHp / ENEMY_DEFS[e.type].maxHp));
      if (m.sweep) {
        for (let i = 0; i < this.soldiers.length; i++) {
          const s = this.soldiers[i];
          if (s.state === 'fighting' && s.targetPoolIndex === e.poolIndex && s.targetUid === e.uid) {
            this.hurt(s, e, m.damage * scale);
          }
        }
      } else {
        const s = this.soldiers[this.primary[e.poolIndex]];
        if (s) this.hurt(s, e, m.damage * scale);
      }
    }
    for (let k = 0; k < _blockedList.length; k++) this.primary[_blockedList[k]] = -1;

    // 8. Holds that ended this tick.
    let held = 0;
    for (let k = 0; k < _blockedList.length; k++) {
      if (pool.items[_blockedList[k]].blockers > 0) held++;
    }
    this.blockedCount = held;
    for (let k = 0; k < _prevBlocked.length; k++) {
      const e = pool.items[_prevBlocked[k]];
      this.wasBlocked[_prevBlocked[k]] = 0;
      if (e.active && e.uid === _prevBlockedUid[k] && e.blockers === 0) this.emitBlock('enemyUnblocked', e);
    }
  }

  /**
   * Best enemy of the current engage list: one that still needs holding (fewer claims than its
   * holdCost), else (unless `needyOnly`) one with room for another soldier.
   */
  private pickTarget(needyOnly: boolean): EnemyEntity | null {
    let best: EnemyEntity | null = null;
    let bestNeeds = false;
    for (let k = 0; k < _engageList.length; k++) {
      const e = this.pool.items[_engageList[k]];
      const c = this.claims[e.poolIndex];
      const needs = c < ENEMY_MELEE[e.type].holdCost;
      if (!needs && (needyOnly || c >= SOLDIER_RULES.maxPerEnemy)) continue;
      if (best === null || this.better(e, needs, best, bestNeeds)) {
        best = e;
        bestNeeds = needs;
      }
    }
    return best;
  }

  private claim(s: SoldierEntity, e: EnemyEntity): void {
    s.targetPoolIndex = e.poolIndex;
    s.targetUid = e.uid;
    s.state = 'engaging';
    this.claims[e.poolIndex]++;
  }

  /** Free = alive, not claiming anything, and close enough to the rally point to help. */
  private isFree(b: BarracksState, s: SoldierEntity): boolean {
    if (s.state === 'idle') return true;
    if (s.state !== 'walking') return false;
    return Math.hypot(s.x - b.rallyX, s.z - b.rallyZ) <= SOLDIER_RULES.leashRadius;
  }

  /** Claim order: enemies that still need holding, then nearest to the goal, then oldest. */
  private better(a: EnemyEntity, aNeeds: boolean, b: EnemyEntity, bNeeds: boolean): boolean {
    if (aNeeds !== bNeeds) return aNeeds;
    const pa = a.dist + a.laneProgressOffset;
    const pb = b.dist + b.laneProgressOffset;
    if (pa !== pb) return pa > pb;
    return a.uid < b.uid;
  }

  /** Steps toward (tx, tz) at soldier speed; true once there. */
  private moveToward(s: SoldierEntity, tx: number, tz: number, dt: number): boolean {
    const dx = tx - s.x;
    const dz = tz - s.z;
    const d = Math.hypot(dx, dz);
    const step = SOLDIER_RULES.speed * dt;
    if (d <= step || d < 1e-6) {
      s.x = tx;
      s.z = tz;
      return true;
    }
    s.x += (dx / d) * step;
    s.z += (dz / d) * step;
    s.yaw = Math.atan2(dx, dz);
    return false;
  }

  private strike(tower: TowerEntity, s: SoldierEntity, e: EnemyEntity, damage: number, cleave: boolean): void {
    const res = this.enemySystem.applyDamage(e, damage);
    tower.totalDamageDealt += res.actualDamage;
    if (res.killed) tower.kills++;
    this.events.emit('soldierAttack', {
      soldierId: s.id,
      towerId: s.towerId,
      enemyId: e.uid,
      x: s.x,
      z: s.z,
      targetX: e.x,
      targetZ: e.z,
      damage: res.actualDamage,
      cleave,
    });
  }

  /** T3 Cleave: nearest other living ground enemy beside the struck one. */
  private cleaveTarget(primary: EnemyEntity): EnemyEntity | null {
    const r = SOLDIER_RULES.cleaveRadius;
    this.spatialHash.query(primary.x, primary.z, r, _candidates);
    let best: EnemyEntity | null = null;
    let bestSq = r * r;
    for (let k = 0; k < _candidates.length; k++) {
      const e = this.pool.items[_candidates[k]];
      if (e === primary || !e.active || e.hp <= 0 || e.flying || e.burrowed) continue;
      const dx = e.x - primary.x;
      const dz = e.z - primary.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestSq || (dSq === bestSq && best !== null && e.uid < best.uid)) {
        bestSq = dSq;
        best = e;
      }
    }
    return best;
  }

  private hurt(s: SoldierEntity, e: EnemyEntity, raw: number): void {
    const stats = this.getBarracks(s.towerId)?.stats;
    const damage = Math.max(1, Math.round(raw - (stats?.soldierArmor ?? 0)));
    s.hp -= damage;
    s.hitFlashTimer = 0.12;
    s.sinceHurt = 0;
    this.events.emit('soldierHurt', { soldierId: s.id, towerId: s.towerId, enemyId: e.uid, damage, x: s.x, z: s.z });
    if (s.hp > 0) return;
    s.hp = 0;
    if (e.blockers > 0) e.blockers--;
    s.state = 'dead';
    s.targetPoolIndex = -1;
    s.targetUid = 0;
    s.respawnTimer = stats?.soldierRespawnSec ?? 8;
    this.events.emit('soldierDied', {
      soldierId: s.id,
      towerId: s.towerId,
      x: s.x,
      z: s.z,
      respawnSec: s.respawnTimer,
    });
  }
}
