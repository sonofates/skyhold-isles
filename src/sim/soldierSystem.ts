import type { EventBus } from '../core/eventBus.ts';
import type { ObjectPool } from '../core/pool.ts';
import type { TowerType, Vec3 } from '../core/types.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import { ENEMY_MELEE, SOLDIER_FORMATION, SOLDIER_RULES } from '../data/soldiers.ts';
import { getTowerTierStats, type TowerTierStats } from '../data/towers.ts';
import type { EnemyEntity, TowerEntity } from './entities.ts';
import type { EnemySystem } from './enemySystem.ts';
import type { CompiledPath } from './path.ts';
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
  /** Maximum enemies this soldier can hold in melee at once (1 in all shipped barracks tiers). */
  holdCap: number;
  /** Extra-held enemy pool indices & uids when `holdCap > 1` (empty when `holdCap === 1`). */
  readonly extraHoldPoolIndices: number[];
  readonly extraHoldUids: number[];
  /** Render-facing only: the next blow was announced (`meleeSwing`); never read by the rules. */
  swingArmed: boolean;
  /** Temporary armor bonus granted by hero abilities/auras this tick (Bran Rally / Sela Shell Ward). */
  bonusArmor: number;
  /** Temporary melee damage multiplier granted by hero abilities this tick (Bran Rally). */
  damageMul: number;
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
const _baseVec: Vec3 = { x: 0, y: 0, z: 0 };
const _rallyRoadPt: RoadPoint = { x: 0, z: 0, yaw: 0 };
const _candidates: number[] = [];
const _engageList: number[] = [];
const _spreadOrder: number[] = [];
const _extraHoldOrder: number[] = [];

/** Golden-ratio conjugate: spreads consecutive integer uids evenly across [-1, 1] with zero RNG. */
const GOLDEN_CONJUGATE = 0.6180339887498949;
/** Max path distance gap (world units) between consecutive blocked foes in the same road queue. */
export const BLOCK_CLUSTER_GAP = 1.8;
/** Path spacing (world units) behind the front blocked foe per queue slot (0.30 u = 15 px at 50 px/u). */
export const BLOCK_QUEUE_SPACING = 0.30;
/** Half-width of lateral spread across the road (world units; 0.36 u = ±18 px inside a ~58 px road). */
export const BLOCK_LATERAL_MAX = 0.36;
/** Exponential smoothing rate (1/s) so blocked foes glide into and out of their queue slots. */
const BLOCK_EASE_RATE = 14;

/** Deterministic lateral road offset in [-halfWidth, +halfWidth], stable for an enemy's lifetime. */
export function blockedLateralOffset(uid: number, halfWidth = BLOCK_LATERAL_MAX): number {
  const u = (((uid * GOLDEN_CONJUGATE) % 1) + 1) % 1;
  return (u * 2 - 1) * halfWidth;
}

/** Samples `path` at `dist`, extrapolating backward along the start tangent when `dist < 0`. */
function samplePathWithBackoff(path: CompiledPath, dist: number, out: Vec3): number {
  if (dist >= 0) return path.sample(dist, out);
  const yaw = path.sample(0, out);
  out.x += Math.sin(yaw) * dist;
  out.z += Math.cos(yaw) * dist;
  return yaw;
}

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
  /** True while `update()` is executing (guards mid-tick re-entrant unblock emissions). */
  private inUpdate = false;
  /** Set when `clearCombatState` runs inside `update()` so the remaining tick steps abort cleanly. */
  private abortedStep = false;
  /** Enemies held at the end of the last update (QA / renderer). */
  blockedCount = 0;
  /** Per tower type attack-rate multiplier (Workshop / run modifiers); missing = 1. */
  towerRateMul: Readonly<Partial<Record<TowerType, number>>> = {};
  /** Optional hero-hold check wired by `HeroSystem` so mid-`HeroSystem.update` barracks releases see co-holds. */
  isHeroHoldingEnemy: ((poolIndex: number, uid: number) => boolean) | null = null;
  private readonly claims: Int16Array;
  private readonly wasBlocked: Uint8Array;
  private readonly primary: Int32Array;
  /** Render-facing only: a held enemy's next blow was announced (`meleeSwing`). */
  private readonly enemyArmed: Uint8Array;
  /** Per-pool-slot blocked queue spread state (world-unit offset from pure path sample). */
  private readonly spreadUid: Int32Array;
  private readonly spreadOffX: Float64Array;
  private readonly spreadOffZ: Float64Array;
  private readonly wantOffX: Float64Array;
  private readonly wantOffZ: Float64Array;
  private readonly isBlockedSlot: Uint8Array;
  private readonly blockedList: number[] = [];
  private readonly prevBlocked: number[] = [];
  private readonly prevBlockedUid: number[] = [];
  private readonly stepBarracksIds: number[] = [];
  private readonly sweepSoldiers: SoldierEntity[] = [];

  private readonly pool: ObjectPool<EnemyEntity>;
  private readonly spatialHash: SpatialHashGrid;
  private readonly enemySystem: EnemySystem;
  private readonly events: EventBus;

  private readonly byExtraHoldOrder = (ia: number, ib: number): number => {
    const a = this.pool.items[ia];
    const b = this.pool.items[ib];
    if (b.dist !== a.dist) return b.dist - a.dist;
    return a.uid - b.uid;
  };

  private readonly bySpreadOrder = (ia: number, ib: number): number => {
    const a = this.pool.items[ia];
    const b = this.pool.items[ib];
    if (a.lane !== b.lane) return a.lane - b.lane;
    if (b.dist !== a.dist) return b.dist - a.dist;
    return a.uid - b.uid;
  };

  constructor(pool: ObjectPool<EnemyEntity>, spatialHash: SpatialHashGrid, enemySystem: EnemySystem, events: EventBus) {
    this.pool = pool;
    this.spatialHash = spatialHash;
    this.enemySystem = enemySystem;
    this.events = events;
    const n = pool.items.length;
    this.claims = new Int16Array(n);
    this.wasBlocked = new Uint8Array(n);
    this.primary = new Int32Array(n).fill(-1);
    this.enemyArmed = new Uint8Array(n);
    this.spreadUid = new Int32Array(n);
    this.spreadOffX = new Float64Array(n);
    this.spreadOffZ = new Float64Array(n);
    this.wantOffX = new Float64Array(n);
    this.wantOffZ = new Float64Array(n);
    this.isBlockedSlot = new Uint8Array(n);
  }

  getBarracks(towerId: number): BarracksState | null {
    for (let i = 0; i < this.barracks.length; i++) {
      if (this.barracks[i].towerId === towerId) return this.barracks[i];
    }
    return null;
  }

  private getSoldierById(id: number): SoldierEntity | null {
    if (id < 0) return null;
    for (let i = 0; i < this.soldiers.length; i++) {
      if (this.soldiers[i].id === id) return this.soldiers[i];
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
    return this.findRoadPoint(x, z, range, x, z, _rallyRoadPt);
  }

  /** New barracks: rally on the nearest road point, squad steps out of the gate. */
  addBarracks(tower: TowerEntity): BarracksState | null {
    const stats = getTowerTierStats(tower.type, tower.tier);
    if (!this.findRoadPoint(tower.x, tower.z, stats.range, tower.x, tower.z, _rallyRoadPt)) return null;
    const b: BarracksState = {
      towerId: tower.id,
      x: tower.x,
      z: tower.z,
      rallyX: _rallyRoadPt.x,
      rallyZ: _rallyRoadPt.z,
      rallyYaw: _rallyRoadPt.yaw,
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
  setRally(tower: TowerEntity, x: number, z: number, onCommitted?: () => void): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const b = this.getBarracks(tower.id);
    if (!b) return false;
    const stats = getTowerTierStats(tower.type, tower.tier);
    const effRange = stats.range * (1 + tower.auraRange + (tower.heroRangeBonus ?? 0));
    if (!this.findRoadPoint(b.x, b.z, effRange, x, z, _rallyRoadPt)) return false;
    const rx = _rallyRoadPt.x;
    const rz = _rallyRoadPt.z;
    const ryaw = _rallyRoadPt.yaw;
    onCommitted?.();
    b.rallyX = rx;
    b.rallyZ = rz;
    b.rallyYaw = ryaw;
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

  private static resolveSoldierHoldCap(stats: TowerTierStats): number {
    const raw = (stats as { soldierHoldCap?: unknown }).soldierHoldCap;
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  }

  /**
   * Upgrade: every soldier is refreshed to the new tier (full HP; fallen ones step out at once),
   * new slots are filled (or excess slots retired on elite specializations), and the rally point
   * stays unless the new range shrank below its current distance.
   */
  onUpgrade(tower: TowerEntity): void {
    const b = this.getBarracks(tower.id);
    if (!b) return;
    const stats = getTowerTierStats(tower.type, tower.tier);
    b.stats = stats;
    const effRange = stats.range * (1 + tower.auraRange + (tower.heroRangeBonus ?? 0));
    const rallyDistSq = (b.rallyX - b.x) ** 2 + (b.rallyZ - b.z) ** 2;
    let rallyReclamped = false;
    if (
      rallyDistSq > effRange * effRange + 1e-9 &&
      this.findRoadPoint(b.x, b.z, effRange, b.rallyX, b.rallyZ, _rallyRoadPt)
    ) {
      b.rallyX = _rallyRoadPt.x;
      b.rallyZ = _rallyRoadPt.z;
      b.rallyYaw = _rallyRoadPt.yaw;
      rallyReclamped = true;
    }
    const count = Math.max(0, stats.soldierCount ?? b.squad.length);
    while (b.squad.length > count) {
      const removed = b.squad.pop()!;
      const si = this.soldiers.indexOf(removed);
      if (si !== -1) this.soldiers.splice(si, 1);
      if (removed.state !== 'dead') {
        this.release(removed, true);
        removed.state = 'dead';
        removed.swingArmed = false;
        this.events.emit('soldierRemoved', {
          soldierId: removed.id,
          towerId: b.towerId,
          x: removed.x,
          z: removed.z,
        });
      }
      this.dirty = true;
    }
    this.layoutPosts(b, count);
    const holdCap = SoldierSystem.resolveSoldierHoldCap(stats);
    for (let i = 0; i < b.squad.length; i++) {
      const s = b.squad[i];
      s.maxHp = stats.soldierHp ?? s.maxHp;
      s.hp = s.maxHp;
      s.holdCap = holdCap;
      while (s.extraHoldPoolIndices.length > Math.max(0, holdCap - 1)) {
        const ep = s.extraHoldPoolIndices.pop()!;
        const eu = s.extraHoldUids.pop()!;
        this.decrementEnemyHold(ep, eu, true);
      }
      if (s.state === 'dead') {
        this.respawn(b, s);
      } else if (rallyReclamped) {
        this.release(s, true);
        s.state = 'walking';
      } else if (s.state === 'idle') {
        s.state = 'walking';
      }
    }
    for (let slot = b.squad.length; slot < count; slot++) this.createSoldier(b, slot, stats);
    if (rallyReclamped) {
      this.events.emit('rallyMoved', { towerId: b.towerId, x: b.rallyX, z: b.rallyZ });
    }
  }

  /** Sell: the squad leaves the field (held enemies are released immediately). */
  removeBarracks(towerId: number): void {
    const bi = this.barracks.findIndex((b) => b.towerId === towerId);
    if (bi === -1) return;
    const b = this.barracks[bi];
    const squadCopy = b.squad.slice();
    b.squad.length = 0;
    this.barracks.splice(bi, 1);
    for (let i = this.soldiers.length - 1; i >= 0; i--) {
      if (this.soldiers[i].towerId === towerId) this.soldiers.splice(i, 1);
    }
    for (let i = 0; i < squadCopy.length; i++) {
      const s = squadCopy[i];
      if (s.state !== 'dead') {
        this.release(s, true);
        s.state = 'dead';
        s.swingArmed = false;
        this.events.emit('soldierRemoved', { soldierId: s.id, towerId, x: s.x, z: s.z });
      }
    }
    this.dirty = true;
  }

  /** True when `e` is currently held by soldiers (including pending pre-recount holds inside `update()`). */
  isHoldingEnemy(poolIndex: number, uid: number): boolean {
    if (poolIndex < 0 || poolIndex >= this.pool.items.length) return false;
    const e = this.pool.items[poolIndex];
    if (!e.active || e.uid !== uid) return false;
    if (e.blockers > 0) return true;
    if (this.inUpdate) {
      for (let k = 0; k < this.prevBlocked.length; k++) {
        if (this.prevBlocked[k] === poolIndex && this.prevBlockedUid[k] === uid) return true;
      }
    }
    return false;
  }

  private heldByHero(e: EnemyEntity): boolean {
    if (e.heroBlockers > 0) return true;
    return this.isHeroHoldingEnemy ? this.isHeroHoldingEnemy(e.poolIndex, e.uid) : false;
  }

  /** Releases active soldier claims and blocked-spread offsets when waves end, skip, or reset. */
  clearCombatState(emitUnblock = true): void {
    if (this.inUpdate) {
      this.abortedStep = true;
    }
    for (let i = 0; i < this.pool.getActiveCount(); i++) {
      const e = this.pool.items[this.pool.getActiveIndex(i)];
      if (e.blockers > 0) {
        e.blockers = 0;
        if (emitUnblock && !this.heldByHero(e) && this.consumeBlockedTracking(e)) {
          this.emitBlock('enemyUnblocked', e);
        }
      }
    }
    if (this.inUpdate) {
      for (let k = 0; k < this.prevBlocked.length; k++) {
        const uid = this.prevBlockedUid[k];
        if (uid < 0) continue;
        this.prevBlockedUid[k] = -1;
        const e = this.pool.items[this.prevBlocked[k]];
        e.blockers = 0;
        if (emitUnblock && e.active && e.uid === uid && !this.heldByHero(e)) {
          this.emitBlock('enemyUnblocked', e);
        }
      }
    }
    for (let i = 0; i < this.soldiers.length; i++) {
      const s = this.soldiers[i];
      s.targetPoolIndex = -1;
      s.targetUid = 0;
      s.extraHoldPoolIndices.length = 0;
      s.extraHoldUids.length = 0;
      s.swingArmed = false;
      if (s.state === 'engaging' || s.state === 'fighting') s.state = 'walking';
    }
    this.claims.fill(0);
    this.wasBlocked.fill(0);
    this.primary.fill(-1);
    this.enemyArmed.fill(0);
    this.spreadUid.fill(0);
    this.spreadOffX.fill(0);
    this.spreadOffZ.fill(0);
    this.wantOffX.fill(0);
    this.wantOffZ.fill(0);
    this.isBlockedSlot.fill(0);
    this.blockedList.length = 0;
    this.prevBlocked.length = 0;
    this.prevBlockedUid.length = 0;
    this.blockedCount = 0;
    this.dirty = false;
  }

  /** Full post-run cleanup (`SimWorld.dispose`). */
  clearAll(): void {
    this.clearCombatState(false);
    this.soldiers.length = 0;
    this.barracks.length = 0;
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
      holdCap: SoldierSystem.resolveSoldierHoldCap(stats),
      extraHoldPoolIndices: [],
      extraHoldUids: [],
      swingArmed: false,
      bonusArmor: 0,
      damageMul: 1,
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
    s.extraHoldPoolIndices.length = 0;
    s.extraHoldUids.length = 0;
    s.swingArmed = false;
    s.bonusArmor = 0;
    s.damageMul = 1;
    this.events.emit('soldierSpawned', { soldierId: s.id, towerId: b.towerId, x: s.x, z: s.z });
  }

  /**
   * Marks `e` as already unblocked in `prevBlocked` when inside `update()`.
   * Returns whether `'enemyBlocked'` had already been emitted for `e` (always true outside `update()`).
   */
  private consumeBlockedTracking(e: EnemyEntity): boolean {
    if (!this.inUpdate) return true;
    let found = false;
    for (let k = 0; k < this.prevBlocked.length; k++) {
      if (this.prevBlocked[k] === e.poolIndex && this.prevBlockedUid[k] === e.uid) {
        this.prevBlockedUid[k] = -1;
        found = true;
      }
    }
    return found;
  }

  private decrementEnemyHold(poolIndex: number, uid: number, emitNow: boolean): void {
    if (poolIndex < 0 || poolIndex >= this.pool.items.length) return;
    const e = this.pool.items[poolIndex];
    if (e.active && e.uid === uid && e.blockers > 0) {
      e.blockers--;
      if (emitNow && e.blockers === 0) {
        this.blockedCount = Math.max(0, this.blockedCount - 1);
        if (!this.heldByHero(e) && this.consumeBlockedTracking(e)) {
          this.emitBlock('enemyUnblocked', e);
        }
      }
    }
  }

  /**
   * Drops the soldier's claim. With `now`, a hold it provided ends immediately (orders / sell);
   * otherwise the next update's recount takes care of it.
   */
  private release(s: SoldierEntity, now: boolean): void {
    if (now && s.state === 'fighting') {
      if (s.targetPoolIndex >= 0) {
        this.decrementEnemyHold(s.targetPoolIndex, s.targetUid, true);
      }
      for (let k = 0; k < s.extraHoldPoolIndices.length; k++) {
        this.decrementEnemyHold(s.extraHoldPoolIndices[k], s.extraHoldUids[k], true);
      }
    }
    s.targetPoolIndex = -1;
    s.targetUid = 0;
    s.extraHoldPoolIndices.length = 0;
    s.extraHoldUids.length = 0;
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

  /** True when fighting soldier `s` is currently holding `e` (as primary target or extra hold). */
  private isSoldierHolding(s: SoldierEntity, e: EnemyEntity): boolean {
    if (s.state !== 'fighting') return false;
    if (s.targetPoolIndex === e.poolIndex && s.targetUid === e.uid) return true;
    for (let k = 0; k < s.extraHoldPoolIndices.length; k++) {
      if (s.extraHoldPoolIndices[k] === e.poolIndex && s.extraHoldUids[k] === e.uid) return true;
    }
    return false;
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
    this.inUpdate = true;
    this.abortedStep = false;
    try {
      this.updateStep(dt, towers, fireRateMultiplier);
    } finally {
      this.inUpdate = false;
      this.abortedStep = false;
    }
  }

  private updateStep(dt: number, towers: readonly TowerEntity[], fireRateMultiplier: number): void {
    this.dirty = this.soldiers.length > 0;
    const pool = this.pool;
    const R = SOLDIER_RULES;

    // Snapshot last tick's holds, then rebuild them from scratch (lease).
    const prevBlocked = this.prevBlocked;
    const prevBlockedUid = this.prevBlockedUid;
    const stepBarracksIds = this.stepBarracksIds;
    prevBlocked.length = 0;
    prevBlockedUid.length = 0;
    for (let i = 0; i < pool.getActiveCount(); i++) {
      const e = pool.items[pool.getActiveIndex(i)];
      if (e.blockers > 0) {
        prevBlocked.push(e.poolIndex);
        prevBlockedUid.push(e.uid);
        this.wasBlocked[e.poolIndex] = 1;
      }
      e.blockers = 0;
    }

    // 1. Timers, respawns, regeneration, engagement validation (snapshot barracks IDs for sellTower safety).
    stepBarracksIds.length = 0;
    for (let bi = 0; bi < this.barracks.length; bi++) {
      stepBarracksIds.push(this.barracks[bi].towerId);
    }
    for (let bi = 0; bi < stepBarracksIds.length; bi++) {
      const b = this.getBarracks(stepBarracksIds[bi]);
      if (!b) continue;
      const tower = this.findTower(towers, b.towerId);
      const jammed = tower !== null && tower.stunTimer > 0;
      const aura =
        tower
          ? 1 +
            tower.auraRate +
            (tower.heroRateBonus ?? 0) +
            ((tower.overhaulTimer ?? 0) > 0 ? (tower.overhaulRateBonus ?? 0) : 0)
          : 1;
      for (let i = 0; i < b.squad.length; i++) {
        const s = b.squad[i];
        s.prevX = s.x;
        s.prevZ = s.z;
        if (s.hitFlashTimer > 0) s.hitFlashTimer = Math.max(0, s.hitFlashTimer - dt);
        if (s.state === 'dead') {
          if (!jammed) {
            s.respawnTimer -= dt * aura;
            if (s.respawnTimer <= 0) {
              this.respawn(b, s);
              if (this.abortedStep) return;
              if (b.squad.length === 0) break;
            }
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

    // 2. Claims already held this tick (including active extra holds on elite multi-hold squads).
    for (let i = 0; i < this.soldiers.length; i++) {
      const s = this.soldiers[i];
      if ((s.state === 'engaging' || s.state === 'fighting') && s.targetPoolIndex >= 0) {
        this.claims[s.targetPoolIndex]++;
      }
      if (s.state === 'fighting') {
        for (let k = 0; k < s.extraHoldPoolIndices.length; k++) {
          const ep = s.extraHoldPoolIndices[k];
          const extra = pool.items[ep];
          if (extra && extra.active && extra.uid === s.extraHoldUids[k] && this.isHoldable(extra)) {
            this.claims[ep]++;
          }
        }
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
      // Soldiers ganging up on an enemy that is held without them switch to one nobody holds.
      // Soldiers still closing in go first; a soldier in contact only leaves if enough others
      // stay in contact to keep the hold. Last squad slot first, so the first soldiers keep fights.
      for (let pass = 0; pass < 2; pass++) {
        const want: SoldierState = pass === 0 ? 'engaging' : 'fighting';
        for (let i = b.squad.length - 1; i >= 0; i--) {
          const s = b.squad[i];
          if (s.state !== want) continue;
          const cur = this.target(s);
          if (!cur) continue;
          const hold = ENEMY_MELEE[cur.type].holdCost;
          if (this.claims[cur.poolIndex] <= hold) continue;
          if (want === 'fighting' && this.inContact(cur) <= hold) continue;
          const needy = this.pickTarget(true);
          if (!needy) break;
          if (want === 'fighting' && !this.canPeelOffExtraHolds(s, cur, needy)) continue;
          if (this.claims[cur.poolIndex] > 0) this.claims[cur.poolIndex]--;
          this.claim(s, needy);
        }
      }
    }
    this.claims.fill(0);

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
            s.extraHoldPoolIndices.length = 0;
            s.extraHoldUids.length = 0;
          }
        } else {
          const px = b.postX[s.slot] ?? b.rallyX;
          const pz = b.postZ[s.slot] ?? b.rallyZ;
          const arrived = this.moveToward(s, px, pz, dt);
          if (arrived && s.state === 'walking') s.state = 'idle';
        }
      }
    }

    // 5. Soldier swings (snapshot barracks IDs so mid-swing sellTower never shifts iteration).
    const rate = Math.max(0.01, fireRateMultiplier);
    stepBarracksIds.length = 0;
    for (let bi = 0; bi < this.barracks.length; bi++) {
      stepBarracksIds.push(this.barracks[bi].towerId);
    }
    for (let bi = 0; bi < stepBarracksIds.length; bi++) {
      const b = this.getBarracks(stepBarracksIds[bi]);
      if (!b) continue;
      const tower = this.findTower(towers, b.towerId);
      if (!tower) continue;
      const stats = b.stats;
      const swingRate = Math.max(0.01, stats.soldierRate ?? 1);
      const rateMul =
        rate *
        (this.towerRateMul[tower.type] ?? 1) *
        (1 +
          tower.auraRate +
          (tower.heroRateBonus ?? 0) +
          ((tower.overhaulTimer ?? 0) > 0 ? (tower.overhaulRateBonus ?? 0) : 0));
      for (let i = 0; i < b.squad.length; i++) {
        const s = b.squad[i];
        if (s.state !== 'fighting') {
          s.swingArmed = false;
          continue;
        }
        const e = this.target(s);
        if (!e || e.hp <= 0) {
          s.swingArmed = false;
          continue;
        }
        s.attackTimer -= dt * rateMul;
        if (s.attackTimer <= 0) {
          s.attackTimer += 1 / swingRate;
          if (s.attackTimer <= 0) s.attackTimer = 1 / swingRate;
          s.swingArmed = false;
          const baseDmg = Math.round((stats.soldierDamage ?? 0) * s.damageMul);
          this.strike(tower, s, e, baseDmg, false);
          if (this.abortedStep) return;
          if (s.state !== 'fighting') continue;
          const cleave = stats.soldierCleave ?? 0;
          if (cleave > 0) {
            const other = this.cleaveTarget(e);
            if (other) {
              this.strike(tower, s, other, Math.round(baseDmg * cleave), true);
              if (this.abortedStep) return;
              if (s.state !== 'fighting') continue;
            }
          }
        }
        // Announce the next blow (render timing only; the swing stays even if this blow killed).
        if (!s.swingArmed && s.state === 'fighting' && e.hp > 0) {
          s.swingArmed = true;
          this.events.emit('meleeSwing', {
            attacker: 'soldier',
            attackerId: s.id,
            targetId: e.uid,
            impactIn: s.attackTimer / rateMul,
            sweep: false,
          });
          if (this.abortedStep) return;
        }
      }
    }

    // 6. Holds: soldiers in contact with a living enemy.
    const blockedList = this.blockedList;
    const sweepSoldiers = this.sweepSoldiers;
    blockedList.length = 0;
    for (let i = 0; i < this.soldiers.length; i++) {
      const s = this.soldiers[i];
      s.extraHoldPoolIndices.length = 0;
      s.extraHoldUids.length = 0;
      if (s.state !== 'fighting') continue;
      const e = this.target(s);
      if (!e || e.hp <= 0) continue;
      if (e.blockers === 0) {
        blockedList.push(e.poolIndex);
        this.primary[e.poolIndex] = s.id;
      }
      e.blockers++;
      if (s.holdCap > 1) {
        this.applyExtraHolds(s, s.id, e);
      }
    }

    // 7. Held enemies strike back.
    for (let k = 0; k < blockedList.length; k++) {
      const e = pool.items[blockedList[k]];
      if (!e.active || e.hp <= 0 || e.blockers <= 0) continue;
      const m = ENEMY_MELEE[e.type];
      if (!this.wasBlocked[e.poolIndex]) {
        // Track in prevBlocked (even when co-held alongside a hero) so mid-tick hero move +
        // barracks sell/rally or counter-attack soldier death always reconciles enemyUnblocked 1-to-1.
        prevBlocked.push(e.poolIndex);
        prevBlockedUid.push(e.uid);
        if (e.heroBlockers === 0) {
          this.emitBlock('enemyBlocked', e);
          if (this.abortedStep) return;
          if (!e.active || e.hp <= 0 || e.blockers <= 0) continue;
        }
        if (e.meleeTimer <= 0) e.meleeTimer = 0.5 / Math.max(0.01, m.rate);
        this.enemyArmed[e.poolIndex] = 0;
      }
      if (m.rate <= 0 || m.damage <= 0) continue;
      // Chill slows the swing as much as the stride; stunned enemies cannot swing.
      const drain = e.stunTimer > 0 ? 0 : 1 - e.slowRatio;
      e.meleeTimer -= dt * drain;
      if (e.meleeTimer <= 0) {
        e.meleeTimer += 1 / m.rate;
        if (e.meleeTimer <= 0) e.meleeTimer = 1 / m.rate;
        this.enemyArmed[e.poolIndex] = 0;
        const scale = Math.sqrt(Math.max(0.01, e.maxHp / ENEMY_DEFS[e.type].maxHp));
        let first = this.getSoldierById(this.primary[e.poolIndex]);
        if (!first || !this.isSoldierHolding(first, e)) {
          first = null;
          for (let i = 0; i < this.soldiers.length; i++) {
            if (this.isSoldierHolding(this.soldiers[i], e)) {
              first = this.soldiers[i];
              break;
            }
          }
        }
        const fx = first ? first.x : e.x;
        const fz = first ? first.z : e.z;
        let struck = 0;
        let dealt = 0;
        let killed = false;
        if (m.sweep) {
          sweepSoldiers.length = 0;
          for (let i = 0; i < this.soldiers.length; i++) {
            const s = this.soldiers[i];
            if (this.isSoldierHolding(s, e)) {
              sweepSoldiers.push(s);
            }
          }
          for (let i = 0; i < sweepSoldiers.length; i++) {
            const s = sweepSoldiers[i];
            if (this.isSoldierHolding(s, e)) {
              const r = this.hurt(s, e, m.damage * scale);
              if (this.abortedStep) return;
              if (struck === 0) dealt = r;
              struck++;
              killed = killed || s.hp <= 0;
            }
          }
          sweepSoldiers.length = 0;
        } else if (first) {
          dealt = this.hurt(first, e, m.damage * scale);
          if (this.abortedStep) return;
          struck = 1;
          killed = first.hp <= 0;
        }
        if (struck > 0) {
          this.events.emit('meleeHit', {
            attacker: 'enemy',
            attackerId: e.uid,
            targetId: first ? first.id : -1,
            damage: dealt,
            x: e.x,
            z: e.z,
            targetX: fx,
            targetZ: fz,
            struck,
            cleave: false,
            sweep: m.sweep === true,
            killed,
          });
          if (this.abortedStep) return;
        }
      }
      // Announce the next blow while something still holds it (render timing only).
      let next = this.getSoldierById(this.primary[e.poolIndex]);
      if (!next || !this.isSoldierHolding(next, e)) {
        next = null;
        if (e.blockers > 0) {
          for (let i = 0; i < this.soldiers.length; i++) {
            const cand = this.soldiers[i];
            if (this.isSoldierHolding(cand, e)) {
              next = cand;
              break;
            }
          }
        }
      }
      if (!this.enemyArmed[e.poolIndex] && drain > 1e-6 && next) {
        this.enemyArmed[e.poolIndex] = 1;
        this.events.emit('meleeSwing', {
          attacker: 'enemy',
          attackerId: e.uid,
          targetId: next.id,
          impactIn: e.meleeTimer / drain,
          sweep: m.sweep === true,
        });
        if (this.abortedStep) return;
      }
    }
    for (let k = 0; k < blockedList.length; k++) this.primary[blockedList[k]] = -1;

    // 8. Holds that ended this tick.
    let held = 0;
    for (let k = 0; k < blockedList.length; k++) {
      if (pool.items[blockedList[k]].blockers > 0) held++;
    }
    this.blockedCount = held;
    for (let k = 0; k < prevBlocked.length; k++) {
      const slot = prevBlocked[k];
      const prevUid = prevBlockedUid[k];
      prevBlockedUid[k] = -1;
      this.wasBlocked[slot] = 0;
      const e = pool.items[slot];
      if (e.active && e.uid === prevUid && e.blockers === 0 && e.heroBlockers === 0) {
        this.emitBlock('enemyUnblocked', e);
        if (this.abortedStep) return;
      }
    }

    // 9. Deterministic spread for blocked / queued enemies along and across the road.
    const anyOffset = this.applyBlockedSpread(dt);
    this.dirty = this.soldiers.length > 0 || anyOffset;
  }

  /**
   * Optional multi-hold capacity on a single soldier (`holdCap > 1`; shipped barracks use 1):
   * holds additional ground enemies queued right behind the primary blocked target on the same lane.
   */
  private applyExtraHolds(s: SoldierEntity, soldierId: number, primary: EnemyEntity): void {
    const maxExtra = s.holdCap - 1;
    if (maxExtra <= 0) return;
    const reach = Math.max(SOLDIER_RULES.engageRadius, (s.holdCap + 1) * BLOCK_QUEUE_SPACING + 0.4);
    this.spatialHash.query(primary.x, primary.z, reach, _candidates);
    _extraHoldOrder.length = 0;
    let alreadyHeldBehind = 0;
    for (let k = 0; k < _candidates.length; k++) {
      const cand = this.pool.items[_candidates[k]];
      if (cand === primary || cand.lane !== primary.lane || !this.isHoldable(cand)) continue;
      if (cand.dist > primary.dist + 0.35) continue;
      if (cand.blockers >= ENEMY_MELEE[cand.type].holdCost) {
        if (primary.dist - cand.dist <= BLOCK_CLUSTER_GAP) alreadyHeldBehind++;
        continue;
      }
      _extraHoldOrder.push(cand.poolIndex);
    }
    _extraHoldOrder.sort(this.byExtraHoldOrder);
    let added = 0;
    for (let k = 0; k < _extraHoldOrder.length && added < maxExtra; k++) {
      const cand = this.pool.items[_extraHoldOrder[k]];
      const queueStopDist = primary.dist - (alreadyHeldBehind + added + 1) * BLOCK_QUEUE_SPACING;
      if (cand.dist < queueStopDist - 0.12) continue;
      if (cand.blockers === 0) {
        this.blockedList.push(cand.poolIndex);
        this.primary[cand.poolIndex] = soldierId;
      }
      cand.blockers++;
      s.extraHoldPoolIndices.push(cand.poolIndex);
      s.extraHoldUids.push(cand.uid);
      added++;
    }
  }

  /**
   * Gives blocked enemies a deterministic spread: lateral offset across the road width (stable per
   * enemy `uid`) and short spacing along the path behind the front blocker in each road cluster.
   * Returns true while any active enemy still carries a non-zero offset.
   */
  private applyBlockedSpread(dt: number): boolean {
    const pool = this.pool;
    _spreadOrder.length = 0;
    for (let k = 0; k < this.blockedList.length; k++) {
      const idx = this.blockedList[k];
      const e = pool.items[idx];
      if (e.active && e.hp > 0 && e.blockers > 0 && !e.flying && !e.burrowed) {
        _spreadOrder.push(idx);
      }
    }

    if (_spreadOrder.length > 1) {
      _spreadOrder.sort(this.bySpreadOrder);
    }

    let clusterLane = -1;
    let frontDist = 0;
    let prevDist = 0;
    let rank = 0;
    for (let k = 0; k < _spreadOrder.length; k++) {
      const idx = _spreadOrder[k];
      const e = pool.items[idx];
      if (k === 0 || e.lane !== clusterLane || prevDist - e.dist > BLOCK_CLUSTER_GAP) {
        clusterLane = e.lane;
        frontDist = e.dist;
        rank = 0;
      } else {
        rank++;
      }
      prevDist = e.dist;

      const path = this.enemySystem.getPath(false, e.lane);
      path.sample(e.dist, _baseVec);
      const targetDist = Math.min(e.dist, frontDist - rank * BLOCK_QUEUE_SPACING);
      const roadYaw = samplePathWithBackoff(path, targetDist, _v);
      const lateral = blockedLateralOffset(e.uid);
      const wantX = _v.x + Math.cos(roadYaw) * lateral;
      const wantZ = _v.z - Math.sin(roadYaw) * lateral;
      this.wantOffX[idx] = wantX - _baseVec.x;
      this.wantOffZ[idx] = wantZ - _baseVec.z;
      this.isBlockedSlot[idx] = 1;
    }

    const ease = dt > 0 ? 1 - Math.exp(-dt * BLOCK_EASE_RATE) : 1;
    let anyOffset = false;
    const activeCount = pool.getActiveCount();
    for (let i = 0; i < activeCount; i++) {
      const idx = pool.getActiveIndex(i);
      const e = pool.items[idx];
      if (this.spreadUid[idx] !== e.uid) {
        this.spreadUid[idx] = e.uid;
        this.spreadOffX[idx] = 0;
        this.spreadOffZ[idx] = 0;
      }
      if (e.flying || e.burrowed) {
        this.spreadOffX[idx] = 0;
        this.spreadOffZ[idx] = 0;
        this.isBlockedSlot[idx] = 0;
        continue;
      }
      const blocked = this.isBlockedSlot[idx] === 1;
      const tx = blocked ? this.wantOffX[idx] : 0;
      const tz = blocked ? this.wantOffZ[idx] : 0;
      this.isBlockedSlot[idx] = 0;

      let cx = this.spreadOffX[idx];
      let cz = this.spreadOffZ[idx];
      if (cx === 0 && cz === 0 && tx === 0 && tz === 0) continue;

      cx += (tx - cx) * ease;
      cz += (tz - cz) * ease;
      if (Math.abs(tx - cx) < 1e-5 && Math.abs(tz - cz) < 1e-5) {
        cx = tx;
        cz = tz;
      }
      this.spreadOffX[idx] = cx;
      this.spreadOffZ[idx] = cz;

      const path = this.enemySystem.getPath(false, e.lane);
      path.sample(e.dist, _baseVec);
      e.x = _baseVec.x + cx;
      e.z = _baseVec.z + cz;
      if (cx !== 0 || cz !== 0) anyOffset = true;
    }

    if (anyOffset) {
      this.spatialHash.clear();
      for (let i = 0; i < activeCount; i++) {
        const idx = pool.getActiveIndex(i);
        const e = pool.items[idx];
        if (!e.burrowed) this.spatialHash.insert(idx, e.x, e.z);
      }
    }
    return anyOffset;
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

  private activeExtraHoldCount(s: SoldierEntity): number {
    let active = 0;
    for (let k = 0; k < s.extraHoldPoolIndices.length; k++) {
      const ep = s.extraHoldPoolIndices[k];
      const extra = this.pool.items[ep];
      if (extra && extra.active && extra.uid === s.extraHoldUids[k] && this.isHoldable(extra)) {
        active++;
      }
    }
    return active;
  }

  /**
   * For elite multi-hold soldiers (`holdCap > 1`), peeling off from `cur` to `needy` is only safe
   * when every extra-held enemy on `s` is either already co-held, absorbable by spare `holdCap` on
   * squadmates still fighting `cur`, or strictly behind `needy` on the road.
   */
  private canPeelOffExtraHolds(s: SoldierEntity, cur: EnemyEntity, needy: EnemyEntity): boolean {
    if (s.extraHoldPoolIndices.length === 0) return true;
    let spareExtraSlots = 0;
    for (let i = 0; i < this.soldiers.length; i++) {
      const other = this.soldiers[i];
      if (other === s || other.state !== 'fighting' || other.holdCap <= 1) continue;
      if (this.target(other) !== cur) continue;
      const used = this.activeExtraHoldCount(other);
      if (other.holdCap - 1 > used) {
        spareExtraSlots += other.holdCap - 1 - used;
      }
    }
    for (let k = 0; k < s.extraHoldPoolIndices.length; k++) {
      const ep = s.extraHoldPoolIndices[k];
      const extra = this.pool.items[ep];
      if (!extra || !extra.active || extra.uid !== s.extraHoldUids[k] || !this.isHoldable(extra)) {
        continue;
      }
      if (this.inContact(extra) > ENEMY_MELEE[extra.type].holdCost) continue;
      if (spareExtraSlots > 0) {
        spareExtraSlots--;
        continue;
      }
      if (!this.better(needy, true, extra, true)) return false;
    }
    return true;
  }

  private claim(s: SoldierEntity, e: EnemyEntity): void {
    if (s.state === 'fighting' && s.extraHoldPoolIndices.length > 0) {
      for (let k = 0; k < s.extraHoldPoolIndices.length; k++) {
        const ep = s.extraHoldPoolIndices[k];
        const extra = this.pool.items[ep];
        if (extra && extra.active && extra.uid === s.extraHoldUids[k] && this.isHoldable(extra)) {
          if (this.claims[ep] > 0) this.claims[ep]--;
        }
      }
    }
    s.extraHoldPoolIndices.length = 0;
    s.extraHoldUids.length = 0;
    s.targetPoolIndex = e.poolIndex;
    s.targetUid = e.uid;
    s.state = 'engaging';
    this.claims[e.poolIndex]++;
  }

  /** Soldiers (any barracks) holding this enemy in melee contact right now (primary or extra hold). */
  private inContact(e: EnemyEntity): number {
    let n = 0;
    for (let i = 0; i < this.soldiers.length; i++) {
      if (this.isSoldierHolding(this.soldiers[i], e)) n++;
    }
    return n;
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
    this.events.emit('meleeHit', {
      attacker: 'soldier',
      attackerId: s.id,
      targetId: e.uid,
      damage: res.actualDamage,
      x: s.x,
      z: s.z,
      targetX: e.x,
      targetZ: e.z,
      struck: 1,
      cleave,
      sweep: false,
      killed: res.killed,
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

  /** Returns the damage dealt. */
  private hurt(s: SoldierEntity, e: EnemyEntity, raw: number): number {
    const stats = this.getBarracks(s.towerId)?.stats;
    const reducedRaw = e.heroDamageReduction > 0 ? raw * (1 - e.heroDamageReduction) : raw;
    const damage = Math.max(1, Math.round(reducedRaw - ((stats?.soldierArmor ?? 0) + s.bonusArmor)));
    s.hp = Math.max(0, s.hp - damage);
    s.hitFlashTimer = 0.12;
    s.sinceHurt = 0;
    const killedSoldier = s.hp <= 0;
    if (killedSoldier) {
      s.hp = 0;
      if (s.targetPoolIndex >= 0) {
        this.decrementEnemyHold(s.targetPoolIndex, s.targetUid, false);
      }
      for (let k = 0; k < s.extraHoldPoolIndices.length; k++) {
        this.decrementEnemyHold(s.extraHoldPoolIndices[k], s.extraHoldUids[k], false);
      }
      s.extraHoldPoolIndices.length = 0;
      s.extraHoldUids.length = 0;
      s.state = 'dead';
      s.swingArmed = false;
      s.targetPoolIndex = -1;
      s.targetUid = 0;
      s.respawnTimer = stats?.soldierRespawnSec ?? 8;
    }
    this.events.emit('soldierHurt', { soldierId: s.id, towerId: s.towerId, enemyId: e.uid, damage, x: s.x, z: s.z });
    if (this.abortedStep || !killedSoldier) return damage;
    if (this.getBarracks(s.towerId)) {
      this.events.emit('soldierDied', {
        soldierId: s.id,
        towerId: s.towerId,
        x: s.x,
        z: s.z,
        respawnSec: s.respawnTimer,
      });
    }
    return damage;
  }
}
