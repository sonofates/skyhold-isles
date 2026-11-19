import type { EventBus } from '../../src/core/eventBus.ts';
import type { ObjectPool } from '../../src/core/pool.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { HERO_RULES } from '../../src/data/heroes.ts';
import { ENEMY_MELEE } from '../../src/data/soldiers.ts';
import type { TowerEntity } from '../../src/sim/entities.ts';
import type { SimWorld } from '../../src/sim/world.ts';

export type InvariantKind =
  | 'nan_or_infinity'
  | 'negative_gold'
  | 'unexpected_lives'
  | 'enemy_stuck'
  | 'wave_never_ends'
  | 'hero_walkable_graph'
  | 'gizmo_on_plot'
  | 'entity_leak'
  | 'determinism';

export interface InvariantViolation {
  readonly kind: InvariantKind;
  readonly tick: number;
  readonly message: string;
}

/** Max seconds an unblocked living enemy may fail to advance along its path (covers max stun + channel). */
export const MAX_ENEMY_STUCK_SEC = 5.0;
/** Max sim seconds a single wave may stay active before being flagged as hung. */
export const MAX_WAVE_ACTIVE_SEC = 300.0;

const _hashQueryBuf: number[] = [];
const _poolStampBuf = new Uint32Array(1024);
let _poolStamp = 1;

function nextStamp(): number {
  _poolStamp = (_poolStamp + 1) >>> 0;
  if (_poolStamp === 0) {
    _poolStampBuf.fill(0);
    _poolStamp = 1;
  }
  return _poolStamp;
}

function checkGraphConnectivity(world: SimWorld): string | null {
  const nodes = world.heroSystem.groundGraph.nodes;
  if (nodes.length <= 1) return null;
  const visited = new Uint8Array(nodes.length);
  const queue: number[] = [0];
  visited[0] = 1;
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    const edges = nodes[u].edges;
    for (let i = 0; i < edges.length; i++) {
      const to = edges[i].to;
      if (!visited[to]) {
        visited[to] = 1;
        queue.push(to);
      }
    }
  }
  if (queue.length !== nodes.length) {
    return `groundGraph disconnected: reached ${queue.length}/${nodes.length} nodes from node 0`;
  }
  return null;
}

function checkPoolIntegrity<T extends { active: boolean }>(
  pool: ObjectPool<T>,
  label: string,
  fullScan: boolean,
): string | null {
  const cap = pool.items.length;
  const activeCount = pool.getActiveCount();
  if (activeCount < 0 || activeCount > cap) {
    return `${label}: invalid activeCount=${activeCount} (capacity=${cap})`;
  }
  const stamp = nextStamp();
  for (let p = 0; p < activeCount; p++) {
    const idx = pool.getActiveIndex(p);
    if (idx < 0 || idx >= cap) {
      return `${label}: out-of-range activeIndex=${idx} at pos=${p}`;
    }
    if (_poolStampBuf[idx] === stamp) {
      return `${label}: duplicate activeIndex=${idx}`;
    }
    _poolStampBuf[idx] = stamp;
    if (!pool.items[idx].active) {
      return `${label}: activeIndex=${idx} points to item with active=false`;
    }
  }
  if (fullScan) {
    for (let i = 0; i < cap; i++) {
      if (pool.items[i].active && _poolStampBuf[i] !== stamp) {
        return `${label}: leaked item[${i}] has active=true outside activeIndices`;
      }
    }
  }
  return null;
}

function hasTowerWithId(towers: readonly TowerEntity[], id: number): boolean {
  for (let i = 0; i < towers.length; i++) {
    if (towers[i].id === id) return true;
  }
  return false;
}

export class InvariantMonitor {
  readonly violations: InvariantViolation[] = [];
  private readonly world: SimWorld;
  private readonly maxViolations: number;
  private prevLives: number;
  private leakedLivesThisTick = 0;
  private heroRespawnedThisTick = false;
  private prevHeroLane = -1;
  private prevHeroRoadX = 0;
  private prevHeroRoadZ = 0;
  private prevHeroCheckX = NaN;
  private prevHeroCheckZ = NaN;
  private currentTick = 0;
  private activeWaveIndex = -1;
  private lastCompletedWaveIndex = -1;
  private waveActiveSec = 0;
  private betweenWaveSec = 0;

  private readonly trackUid: Int32Array;
  private readonly trackLastDist: Float64Array;
  private readonly trackStuckSec: Float64Array;
  private readonly trackFreeFrozenTicks: Int32Array;
  private readonly trackZeroHpTicks: Int32Array;
  private readonly blockedEventUids = new Set<number>();

  constructor(world: SimWorld, events: EventBus, maxViolations = 8) {
    this.world = world;
    this.maxViolations = maxViolations;
    this.prevLives = world.lives;

    const maxE = world.enemyPool.items.length;
    this.trackUid = new Int32Array(maxE);
    this.trackLastDist = new Float64Array(maxE);
    this.trackStuckSec = new Float64Array(maxE);
    this.trackFreeFrozenTicks = new Int32Array(maxE);
    this.trackZeroHpTicks = new Int32Array(maxE);

    const graphErr = checkGraphConnectivity(world);
    if (graphErr) {
      this.record('hero_walkable_graph', 0, graphErr);
    }

    if (world.hero) {
      const c = world.heroSystem.groundGraph.clampToGround(world.hero.x, world.hero.z, Infinity);
      this.prevHeroLane = c.lane;
      this.prevHeroRoadX = c.roadX;
      this.prevHeroRoadZ = c.roadZ;
    }

    this.bindEvents(events);
  }

  private record(kind: InvariantKind, tick: number, message: string): void {
    if (this.violations.length >= this.maxViolations) return;
    this.violations.push({ kind, tick, message });
  }

  private assertFinite(val: number, name: string): void {
    if (!Number.isFinite(val)) {
      this.record('nan_or_infinity', this.currentTick, `${name} is ${String(val)}`);
    }
  }

  private bindEvents(events: EventBus): void {
    events.on('economyChanged', (ev) => {
      this.assertFinite(ev.gold, 'event.economyChanged.gold');
      this.assertFinite(ev.lives, 'event.economyChanged.lives');
      if (ev.gold < 0 || !Number.isInteger(ev.gold)) {
        this.record('negative_gold', this.currentTick, `economyChanged gold=${ev.gold}`);
      }
      if (ev.lives > this.prevLives) {
        this.record(
          'unexpected_lives',
          this.currentTick,
          `economyChanged lives increased from ${this.prevLives} to ${ev.lives}`,
        );
      }
    });

    events.on('enemyLeaked', (ev) => {
      this.assertFinite(ev.livesLost, 'event.enemyLeaked.livesLost');
      this.assertFinite(ev.x, 'event.enemyLeaked.x');
      this.assertFinite(ev.z, 'event.enemyLeaked.z');
      if (ev.livesLost <= 0) {
        this.record('unexpected_lives', this.currentTick, `enemyLeaked non-positive livesLost=${ev.livesLost}`);
      }
      this.leakedLivesThisTick += ev.livesLost;
    });

    events.on('enemyKilled', (ev) => {
      this.assertFinite(ev.reward, 'event.enemyKilled.reward');
      this.assertFinite(ev.x, 'event.enemyKilled.x');
      this.assertFinite(ev.z, 'event.enemyKilled.z');
      if (ev.reward < 0) {
        this.record('negative_gold', this.currentTick, `enemyKilled negative reward=${ev.reward}`);
      }
      this.blockedEventUids.delete(ev.enemyId);
    });

    events.on('enemyHit', (ev) => {
      this.assertFinite(ev.damage, 'event.enemyHit.damage');
      this.assertFinite(ev.x, 'event.enemyHit.x');
      this.assertFinite(ev.y, 'event.enemyHit.y');
      this.assertFinite(ev.z, 'event.enemyHit.z');
    });

    events.on('enemyBlocked', (ev) => {
      this.blockedEventUids.add(ev.enemyId);
    });

    events.on('enemyUnblocked', (ev) => {
      this.blockedEventUids.delete(ev.enemyId);
    });

    events.on('waveStarted', (ev) => {
      if (ev.waveIndex !== this.activeWaveIndex + 1 && this.activeWaveIndex !== -1) {
        this.record(
          'wave_never_ends',
          this.currentTick,
          `waveStarted jumped from ${this.activeWaveIndex} to ${ev.waveIndex}`,
        );
      }
      this.activeWaveIndex = ev.waveIndex;
      this.waveActiveSec = 0;
      this.betweenWaveSec = 0;
    });

    events.on('waveCompleted', (ev) => {
      if (ev.waveIndex <= this.lastCompletedWaveIndex) {
        this.record(
          'wave_never_ends',
          this.currentTick,
          `duplicate or out-of-order waveCompleted=${ev.waveIndex} (last=${this.lastCompletedWaveIndex})`,
        );
      }
      this.lastCompletedWaveIndex = ev.waveIndex;
      if (this.world.enemyPool.getActiveCount() !== 0) {
        this.record(
          'wave_never_ends',
          this.currentTick,
          `waveCompleted(${ev.waveIndex}) fired with ${this.world.enemyPool.getActiveCount()} active enemies`,
        );
      }
    });

    events.on('heroRespawn', (ev) => {
      this.heroRespawnedThisTick = true;
      this.assertFinite(ev.x, 'event.heroRespawn.x');
      this.assertFinite(ev.z, 'event.heroRespawn.z');
      this.assertFinite(ev.hp, 'event.heroRespawn.hp');
    });

    events.on('heroMoved', (ev) => {
      this.assertFinite(ev.x, 'event.heroMoved.x');
      this.assertFinite(ev.z, 'event.heroMoved.z');
      this.assertFinite(ev.targetX, 'event.heroMoved.targetX');
      this.assertFinite(ev.targetZ, 'event.heroMoved.targetZ');
    });

    events.on('heroSkillCast', (ev) => {
      this.assertFinite(ev.x, 'event.heroSkillCast.x');
      this.assertFinite(ev.z, 'event.heroSkillCast.z');
      this.assertFinite(ev.targetX, 'event.heroSkillCast.targetX');
      this.assertFinite(ev.targetZ, 'event.heroSkillCast.targetZ');
    });
  }

  /** Call immediately before `world.fixedTick(dt)`. */
  beginTick(tick: number): void {
    this.currentTick = tick;
    this.leakedLivesThisTick = 0;
    this.heroRespawnedThisTick = false;
    this.prevLives = this.world.lives;
  }

  /** Call immediately after `world.fixedTick(dt)`. */
  endTick(tick: number, dt: number): void {
    this.currentTick = tick;
    const w = this.world;
    const periodicFullScan = (tick & 31) === 0;

    // 1. Economy & lives invariants
    this.assertFinite(w.gold, 'world.gold');
    this.assertFinite(w.lives, 'world.lives');
    this.assertFinite(w.startingLives, 'world.startingLives');
    this.assertFinite(w.enemiesKilledTotal, 'world.enemiesKilledTotal');

    if (w.gold < 0 || !Number.isInteger(w.gold)) {
      this.record('negative_gold', tick, `world.gold=${w.gold}`);
    }
    if (w.lives < 0 || !Number.isInteger(w.lives)) {
      this.record('unexpected_lives', tick, `world.lives=${w.lives}`);
    }
    if (w.lives > this.prevLives) {
      this.record(
        'unexpected_lives',
        tick,
        `world.lives increased from ${this.prevLives} to ${w.lives}`,
      );
    }
    const expectedLivesLost = Math.min(this.prevLives, this.leakedLivesThisTick);
    if (this.prevLives - w.lives !== expectedLivesLost) {
      this.record(
        'unexpected_lives',
        tick,
        `lives delta mismatch: prev=${this.prevLives} now=${w.lives} leakedThisTick=${this.leakedLivesThisTick}`,
      );
    }

    // 2. Wave & ability system finiteness + wave progress bounds
    const ws = w.waveSystem;
    this.assertFinite(ws.interWaveTimer, 'waveSystem.interWaveTimer');
    this.assertFinite(ws.waveElapsed, 'waveSystem.waveElapsed');
    this.assertFinite(ws.pendingClearBonus, 'waveSystem.pendingClearBonus');
    this.assertFinite(w.abilitySystem.getCooldown('meteor'), 'ability.meteor.cooldown');
    this.assertFinite(w.abilitySystem.getCooldown('overcharge'), 'ability.overcharge.cooldown');
    this.assertFinite(w.abilitySystem.getOverchargeRemaining(), 'ability.overcharge.remaining');

    if (w.outcome === 'ongoing') {
      if (ws.state === 'spawning' || ws.state === 'clearing' || ws.state === 'allSpawned') {
        this.waveActiveSec += dt;
        if (this.waveActiveSec > MAX_WAVE_ACTIVE_SEC) {
          this.record(
            'wave_never_ends',
            tick,
            `wave ${ws.currentWaveOneBased} (${ws.state}) stayed active > ${MAX_WAVE_ACTIVE_SEC}s with ${w.enemyPool.getActiveCount()} active enemies`,
          );
        }
      } else if (ws.state === 'betweenWaves') {
        this.betweenWaveSec += dt;
        if (this.betweenWaveSec > BALANCE.interWaveCountdownSec + 1.0) {
          this.record(
            'wave_never_ends',
            tick,
            `betweenWaves stuck for ${this.betweenWaveSec.toFixed(2)}s (interWaveTimer=${ws.interWaveTimer.toFixed(2)})`,
          );
        }
      }
    }

    // 3. Pool integrity (enemyPool & projectilePool)
    const epErr = checkPoolIntegrity(w.enemyPool, 'enemyPool', periodicFullScan);
    if (epErr) this.record('entity_leak', tick, epErr);
    const ppErr = checkPoolIntegrity(w.projectilePool, 'projectilePool', periodicFullScan);
    if (ppErr) this.record('entity_leak', tick, ppErr);

    // 4. Towers & Soldiers
    const towers = w.towers;
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      this.assertFinite(t.x, 'tower.x');
      this.assertFinite(t.z, 'tower.z');
      this.assertFinite(t.yaw, 'tower.yaw');
      this.assertFinite(t.cooldownTimer, 'tower.cooldownTimer');
      this.assertFinite(t.stunTimer, 'tower.stunTimer');
      this.assertFinite(t.totalDamageDealt, 'tower.totalDamageDealt');
      this.assertFinite(t.auraRate, 'tower.auraRate');
      this.assertFinite(t.auraRange, 'tower.auraRange');
    }

    let fightingSoldiers = 0;
    const soldiers = w.soldierSystem.soldiers;
    for (let i = 0; i < soldiers.length; i++) {
      const s = soldiers[i];
      if (!hasTowerWithId(towers, s.towerId)) {
        this.record(
          'entity_leak',
          tick,
          `orphan soldier id=${s.id} references missing barracks towerId=${s.towerId}`,
        );
      }
      this.assertFinite(s.x, 'soldier.x');
      this.assertFinite(s.z, 'soldier.z');
      this.assertFinite(s.hp, 'soldier.hp');
      this.assertFinite(s.maxHp, 'soldier.maxHp');
      this.assertFinite(s.respawnTimer, 'soldier.respawnTimer');
      this.assertFinite(s.attackTimer, 'soldier.attackTimer');
      this.assertFinite(s.bonusArmor, 'soldier.bonusArmor');
      this.assertFinite(s.damageMul, 'soldier.damageMul');
      if (s.state === 'fighting') fightingSoldiers++;
    }

    // 5. Projectiles
    for (let i = 0; i < w.projectilePool.getActiveCount(); i++) {
      const p = w.projectilePool.items[w.projectilePool.getActiveIndex(i)];
      this.assertFinite(p.x, 'proj.x');
      this.assertFinite(p.y, 'proj.y');
      this.assertFinite(p.z, 'proj.z');
      this.assertFinite(p.progress, 'proj.progress');
      this.assertFinite(p.duration, 'proj.duration');
      this.assertFinite(p.damage, 'proj.damage');
    }

    // 6. Active enemies: finiteness, blocker lease validity, progress / stuck detection
    const heroFighting = w.hero !== null && w.hero.state === 'fighting';
    const eCount = w.enemyPool.getActiveCount();
    for (let i = 0; i < eCount; i++) {
      const idx = w.enemyPool.getActiveIndex(i);
      const e = w.enemyPool.items[idx];
      this.assertFinite(e.hp, 'enemy.hp');
      this.assertFinite(e.maxHp, 'enemy.maxHp');
      this.assertFinite(e.speed, 'enemy.speed');
      this.assertFinite(e.armor, 'enemy.armor');
      this.assertFinite(e.dist, 'enemy.dist');
      this.assertFinite(e.totalDist, 'enemy.totalDist');
      this.assertFinite(e.x, 'enemy.x');
      this.assertFinite(e.y, 'enemy.y');
      this.assertFinite(e.z, 'enemy.z');
      this.assertFinite(e.yaw, 'enemy.yaw');
      this.assertFinite(e.slowRatio, 'enemy.slowRatio');
      this.assertFinite(e.shield, 'enemy.shield');
      this.assertFinite(e.stunTimer, 'enemy.stunTimer');
      this.assertFinite(e.markTimer, 'enemy.markTimer');
      this.assertFinite(e.channelTimer, 'enemy.channelTimer');

      if (this.trackUid[idx] !== e.uid) {
        this.trackUid[idx] = e.uid;
        this.trackLastDist[idx] = e.dist;
        this.trackStuckSec[idx] = 0;
        this.trackFreeFrozenTicks[idx] = 0;
        this.trackZeroHpTicks[idx] = 0;
        continue;
      }

      if (e.hp <= 0) {
        const zt = ++this.trackZeroHpTicks[idx];
        if (w.outcome === 'ongoing' && zt >= 2) {
          this.record(
            'entity_leak',
            tick,
            `dead enemy uid=${e.uid} (${e.type}) stayed active in pool for ${zt} ticks`,
          );
        }
        continue;
      }
      this.trackZeroHpTicks[idx] = 0;

      if (w.outcome !== 'ongoing') continue;

      const melee = ENEMY_MELEE[e.type];
      const tramples = melee.trampleFromPhase !== undefined && e.bossPhase >= melee.trampleFromPhase;
      if ((e.flying || e.burrowed || tramples) && (e.blockers > 0 || e.heroBlockers > 0)) {
        this.record(
          'enemy_stuck',
          tick,
          `unholdable enemy uid=${e.uid} (${e.type}, flying=${e.flying}, burrowed=${e.burrowed}, phase=${e.bossPhase}) has blockers=${e.blockers}+${e.heroBlockers}`,
        );
      }
      if (e.blockers > 0 && fightingSoldiers === 0) {
        this.record(
          'enemy_stuck',
          tick,
          `enemy uid=${e.uid} (${e.type}) has blockers=${e.blockers} with 0 fighting soldiers`,
        );
      }
      if (e.heroBlockers > 0 && !heroFighting) {
        this.record(
          'enemy_stuck',
          tick,
          `enemy uid=${e.uid} (${e.type}) has heroBlockers=${e.heroBlockers} while hero state=${w.hero?.state ?? 'none'}`,
        );
      }

      const totalBlockers = e.blockers + e.heroBlockers;
      const isBlocked = melee.block === 'block' && !tramples && totalBlockers >= melee.holdCost;
      if (isBlocked) {
        this.trackLastDist[idx] = e.dist;
        this.trackStuckSec[idx] = 0;
        this.trackFreeFrozenTicks[idx] = 0;
      } else {
        if (e.dist > this.trackLastDist[idx] + 1e-7) {
          this.trackLastDist[idx] = e.dist;
          this.trackStuckSec[idx] = 0;
          this.trackFreeFrozenTicks[idx] = 0;
        } else {
          const stuck = (this.trackStuckSec[idx] += dt);
          if (e.stunTimer > 0 || e.channelTimer > 0) {
            this.trackFreeFrozenTicks[idx] = 0;
          } else {
            const frozen = ++this.trackFreeFrozenTicks[idx];
            if (frozen >= 3) {
              this.record(
                'enemy_stuck',
                tick,
                `enemy uid=${e.uid} (${e.type}) made 0 progress for ${frozen} ticks while unblocked, unstunned, unchannelled at dist=${e.dist.toFixed(3)}/${e.totalDist.toFixed(3)}`,
              );
            }
          }
          if (stuck > MAX_ENEMY_STUCK_SEC) {
            this.record(
              'enemy_stuck',
              tick,
              `enemy uid=${e.uid} (${e.type}) made no progress for ${stuck.toFixed(2)}s while not blocked (stun=${e.stunTimer.toFixed(2)}, channel=${e.channelTimer.toFixed(2)})`,
            );
          }
        }
      }

      if (totalBlockers === 0 && this.blockedEventUids.has(e.uid)) {
        this.record(
          'entity_leak',
          tick,
          `enemy uid=${e.uid} (${e.type}) emitted enemyBlocked without matching enemyUnblocked after hold ended`,
        );
        this.blockedEventUids.delete(e.uid);
      }
    }

    if (periodicFullScan) {
      w.spatialHash.query(0, 0, 500, _hashQueryBuf);
      for (let i = 0; i < _hashQueryBuf.length; i++) {
        const e = w.enemyPool.items[_hashQueryBuf[i]];
        if (!e.active) {
          this.record('entity_leak', tick, `spatialHash contains inactive enemy poolIndex=${_hashQueryBuf[i]}`);
        } else if (e.burrowed) {
          this.record('entity_leak', tick, `spatialHash contains burrowed enemy uid=${e.uid}`);
        }
      }
    }

    // 7. Hero walkable graph & gizmo placement invariants
    const h = w.hero;
    if (h) {
      this.assertFinite(h.x, 'hero.x');
      this.assertFinite(h.z, 'hero.z');
      this.assertFinite(h.prevX, 'hero.prevX');
      this.assertFinite(h.prevZ, 'hero.prevZ');
      this.assertFinite(h.yaw, 'hero.yaw');
      this.assertFinite(h.postX, 'hero.postX');
      this.assertFinite(h.postZ, 'hero.postZ');
      this.assertFinite(h.hp, 'hero.hp');
      this.assertFinite(h.maxHp, 'hero.maxHp');
      this.assertFinite(h.respawnTimer, 'hero.respawnTimer');
      this.assertFinite(h.attackTimer, 'hero.attackTimer');
      this.assertFinite(h.skillCooldowns[0], 'hero.skillCooldowns[0]');
      this.assertFinite(h.skillCooldowns[1], 'hero.skillCooldowns[1]');
      this.assertFinite(h.totalDamageDealt, 'hero.totalDamageDealt');
      for (let i = 0; i < h.waypoints.length; i++) {
        this.assertFinite(h.waypoints[i].x, 'hero.waypoint.x');
        this.assertFinite(h.waypoints[i].z, 'hero.waypoint.z');
      }

      if (h.x !== this.prevHeroCheckX || h.z !== this.prevHeroCheckZ || this.prevHeroLane < 0) {
        this.prevHeroCheckX = h.x;
        this.prevHeroCheckZ = h.z;
        const curClamp = w.heroSystem.groundGraph.clampToGround(h.x, h.z, Infinity);
        const offRoad = Math.hypot(h.x - curClamp.roadX, h.z - curClamp.roadZ);
        if (offRoad > HERO_RULES.maxOffRoadDist + 0.08) {
          this.record(
            'hero_walkable_graph',
            tick,
            `hero (${h.heroId}, state=${h.state}) left walkable road graph: offRoad=${offRoad.toFixed(3)}u > maxOffRoadDist=${HERO_RULES.maxOffRoadDist}u at (${h.x.toFixed(2)}, ${h.z.toFixed(2)})`,
          );
        }

        if (h.state !== 'dead' && !this.heroRespawnedThisTick && w.outcome === 'ongoing') {
          const stepDist = Math.hypot(h.x - h.prevX, h.z - h.prevZ);
          const maxStep = h.stats.moveSpeed * dt + 0.05;
          if (stepDist > maxStep) {
            this.record(
              'hero_walkable_graph',
              tick,
              `hero (${h.heroId}) teleported ${stepDist.toFixed(3)}u in one tick (max=${maxStep.toFixed(3)}u)`,
            );
          }
          if (this.prevHeroLane >= 0 && this.prevHeroLane !== curClamp.lane) {
            const roadGap = Math.hypot(
              curClamp.roadX - this.prevHeroRoadX,
              curClamp.roadZ - this.prevHeroRoadZ,
            );
            if (roadGap > 2.8) {
              this.record(
                'hero_walkable_graph',
                tick,
                `hero (${h.heroId}) jumped across unconnected lanes ${this.prevHeroLane}->${curClamp.lane} (roadGap=${roadGap.toFixed(2)}u)`,
              );
            }
          }
        }
        this.prevHeroLane = curClamp.lane;
        this.prevHeroRoadX = curClamp.roadX;
        this.prevHeroRoadZ = curClamp.roadZ;
      }

      const gizmos = w.heroSystem.gizmos;
      const plots = w.grid.plots;
      const plotMinDist = w.grid.plotRadius * 1.15;
      for (let i = 0; i < gizmos.length; i++) {
        const g = gizmos[i];
        this.assertFinite(g.x, 'gizmo.x');
        this.assertFinite(g.z, 'gizmo.z');
        this.assertFinite(g.remainingSec, 'gizmo.remainingSec');
        if (plots) {
          for (let p = 0; p < plots.length; p++) {
            const d = Math.hypot(g.x - plots[p].x, g.z - plots[p].z);
            if (d < plotMinDist) {
              this.record(
                'gizmo_on_plot',
                tick,
                `Tobb gizmo id=${g.id} landed on plot ${p} (dist=${d.toFixed(2)}u < ${plotMinDist.toFixed(2)}u)`,
              );
            }
          }
        }
      }

      const rings = w.heroSystem.fireRings;
      for (let i = 0; i < rings.length; i++) {
        this.assertFinite(rings[i].x, 'fireRing.x');
        this.assertFinite(rings[i].z, 'fireRing.z');
        this.assertFinite(rings[i].remainingSec, 'fireRing.remainingSec');
      }
    }
  }

  /** Call once the scenario loop finishes to verify terminal & entity-leak invariants. */
  checkRunEnd(tick: number, expectTerminated: boolean): void {
    const w = this.world;
    if (expectTerminated && w.outcome === 'ongoing') {
      this.record(
        'wave_never_ends',
        tick,
        `run stayed 'ongoing' at tick=${tick} (wave=${w.waveSystem.currentWaveOneBased}/${w.waveSystem.totalWaves}, state=${w.waveSystem.state}, activeEnemies=${w.enemyPool.getActiveCount()})`,
      );
    }

    const epErr = checkPoolIntegrity(w.enemyPool, 'enemyPool(end)', true);
    if (epErr) this.record('entity_leak', tick, epErr);
    const ppErr = checkPoolIntegrity(w.projectilePool, 'projectilePool(end)', true);
    if (ppErr) this.record('entity_leak', tick, ppErr);

    if (w.outcome === 'won' && !w.waveSystem.isEndless) {
      if (w.enemyPool.getActiveCount() !== 0) {
        this.record(
          'entity_leak',
          tick,
          `won run still has ${w.enemyPool.getActiveCount()} active enemies`,
        );
      }
      if (w.projectilePool.getActiveCount() !== 0) {
        this.record(
          'entity_leak',
          tick,
          `won run leaked ${w.projectilePool.getActiveCount()} mid-flight projectiles`,
        );
      }
      if (w.projectileSystem.getActiveBurnZoneCount() !== 0) {
        this.record(
          'entity_leak',
          tick,
          `won run leaked ${w.projectileSystem.getActiveBurnZoneCount()} active burn zones`,
        );
      }
      if (w.heroSystem.fireRings.length !== 0) {
        this.record(
          'entity_leak',
          tick,
          `won run leaked ${w.heroSystem.fireRings.length} hero fireRings`,
        );
      }
      if (w.heroSystem.getPendingVolleys().length !== 0) {
        this.record(
          'entity_leak',
          tick,
          `won run leaked ${w.heroSystem.getPendingVolleys().length} pendingVolleys`,
        );
      }
      if (w.hero && (w.hero.state === 'moving' || w.hero.state === 'engaging' || w.hero.state === 'fighting')) {
        this.record(
          'entity_leak',
          tick,
          `won run left hero in active transient state=${w.hero.state}`,
        );
      }
      w.spatialHash.query(0, 0, 500, _hashQueryBuf);
      if (_hashQueryBuf.length !== 0) {
        this.record(
          'entity_leak',
          tick,
          `won run leaked ${_hashQueryBuf.length} spatialHash entries`,
        );
      }
    }
  }
}
