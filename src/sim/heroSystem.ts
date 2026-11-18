import type { EventBus } from '../core/eventBus.ts';
import type { ObjectPool } from '../core/pool.ts';
import { SeededRng } from '../core/rng.ts';
import type { HeroId, HeroSkillSlot, Vec3 } from '../core/types.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import {
  HERO_DEFS,
  HERO_RULES,
  HERO_XP_RULES,
  resolveHeroStats,
  type ResolvedHeroActive,
  type ResolvedHeroStats,
} from '../data/heroes.ts';
import { ENEMY_MELEE } from '../data/soldiers.ts';
import { TOWER_DEFS } from '../data/towers.ts';
import type { EnemyEntity, TowerEntity } from './entities.ts';
import type { EnemySystem } from './enemySystem.ts';
import { GroundGraph, type GroundWaypoint } from './groundGraph.ts';
import type { CompiledPath } from './path.ts';
import { BURN_TICK_INTERVAL, type ProjectileSystem } from './projectileSystem.ts';
import type { SoldierSystem } from './soldierSystem.ts';
import type { SpatialHashGrid } from './spatialHash.ts';

export type HeroState = 'idle' | 'moving' | 'engaging' | 'fighting' | 'dead';

export interface HeroGizmoEntity {
  readonly id: number;
  x: number;
  z: number;
  yaw: number;
  remainingSec: number;
  cooldownTimer: number;
  range: number;
  damage: number;
  fireRate: number;
  splashRadius: number;
  boostTimer: number;
  boostRate: number;
}

export interface HeroFireRingZone {
  x: number;
  z: number;
  radius: number;
  remainingSec: number;
  dps: number;
  slowRatio: number;
}

export interface HeroEntity {
  readonly heroId: HeroId;
  readonly level: number;
  readonly unlockedSkills: readonly string[];
  readonly stats: ResolvedHeroStats;
  state: HeroState;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  yaw: number;
  prevYaw: number;
  readonly spawnX: number;
  readonly spawnZ: number;
  readonly spawnYaw: number;
  postX: number;
  postZ: number;
  hp: number;
  maxHp: number;
  respawnTimer: number;
  attackTimer: number;
  sinceHurt: number;
  hitFlashTimer: number;
  shotCount: number;
  readonly skillCooldowns: [number, number];
  rallyBannerTimer: number;
  readonly waypoints: GroundWaypoint[];
  targetPoolIndex: number;
  targetUid: number;
  totalDamageDealt: number;
  kills: number;
}

export interface HeroInitConfig {
  readonly heroId: HeroId;
  readonly level?: number;
  readonly skills?: readonly string[];
  readonly seed?: number;
}

export interface HeroSkillRuntimeState {
  readonly slot: HeroSkillSlot;
  readonly id: string;
  readonly name: string;
  readonly targetMode: 'self' | 'point';
  readonly cooldown: number;
  readonly maxCooldown: number;
  readonly ready: boolean;
  readonly usable: boolean;
  readonly range: number;
  readonly radius: number;
  readonly durationSec: number;
}

export interface HeroRuntimeState {
  readonly heroId: HeroId;
  readonly name: string;
  readonly level: number;
  readonly state: HeroState;
  readonly alive: boolean;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly armor: number;
  readonly respawnRemaining: number;
  readonly respawnMax: number;
  readonly runXp: number;
  readonly kills: number;
  readonly totalDamageDealt: number;
  readonly skills: readonly [HeroSkillRuntimeState, HeroSkillRuntimeState];
}

interface PendingVolleyWave {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly damage: number;
  readonly slow: boolean;
  remainingSec: number;
}

const _candidates: number[] = [];
const _prevHeroBlockedIdx: number[] = [];
const _prevHeroBlockedUid: number[] = [];
const _prevTotalBlocked: number[] = [];
const _hitSet = new Set<number>();

/** Deterministic FNV-1a string hash for default RNG seeding. */
export function hashHeroSeed(levelId: string, heroId: string, level: number): number {
  let h = 0x811c9dc5;
  const s = `${levelId}:${heroId}:${level}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function angleCosBetween(ax: number, az: number, bx: number, bz: number): number {
  const la = Math.hypot(ax, az);
  const lb = Math.hypot(bx, bz);
  if (la < 1e-6 || lb < 1e-6) return 1;
  return (ax * bx + az * bz) / (la * lb);
}

/**
 * Deterministic hero simulation system (`src/sim/heroSystem.ts`).
 * Completely idle (`this.hero === null`) on runs without a hero, keeping `npm run sim:balance`
 * byte-identical. Uses `SeededRng` exclusively.
 */
export class HeroSystem {
  readonly hero: HeroEntity | null = null;
  readonly groundGraph: GroundGraph;
  readonly gizmos: HeroGizmoEntity[] = [];
  readonly fireRings: HeroFireRingZone[] = [];
  readonly rng: SeededRng;
  runXp = 0;

  private nextGizmoId = 1;
  private readonly pendingVolleys: PendingVolleyWave[] = [];
  private readonly burnLeft: Float64Array;
  private readonly burnDps: Float64Array;
  private readonly burnUid: Int32Array;
  private burnTickTimer = BURN_TICK_INTERVAL;
  private calmHealTimer = 1.0;

  private readonly pool: ObjectPool<EnemyEntity>;
  private readonly spatialHash: SpatialHashGrid;
  private readonly enemySystem: EnemySystem;
  private readonly projectileSystem: ProjectileSystem;
  private readonly soldierSystem: SoldierSystem;
  private readonly events: EventBus;

  constructor(
    levelId: string,
    groundPaths: readonly CompiledPath[],
    pool: ObjectPool<EnemyEntity>,
    spatialHash: SpatialHashGrid,
    enemySystem: EnemySystem,
    projectileSystem: ProjectileSystem,
    soldierSystem: SoldierSystem,
    events: EventBus,
    config?: HeroInitConfig | null,
  ) {
    this.pool = pool;
    this.spatialHash = spatialHash;
    this.enemySystem = enemySystem;
    this.projectileSystem = projectileSystem;
    this.soldierSystem = soldierSystem;
    this.events = events;
    this.groundGraph = new GroundGraph(groundPaths);

    const n = pool.items.length;
    this.burnLeft = new Float64Array(n);
    this.burnDps = new Float64Array(n);
    this.burnUid = new Int32Array(n);

    const lvl = config?.level ?? 1;
    const seed =
      config?.seed !== undefined
        ? config.seed >>> 0
        : hashHeroSeed(levelId, config?.heroId ?? 'none', lvl);
    this.rng = new SeededRng(seed);

    if (config) {
      const skills = config.skills ? [...config.skills] : [];
      const stats = resolveHeroStats(config.heroId, lvl, skills);
      const spawn = this.groundGraph.castleSpawnPoint();
      this.hero = {
        heroId: config.heroId,
        level: stats.level,
        unlockedSkills: skills,
        stats,
        state: 'idle',
        x: spawn.x,
        z: spawn.z,
        prevX: spawn.x,
        prevZ: spawn.z,
        yaw: spawn.yaw,
        prevYaw: spawn.yaw,
        spawnX: spawn.x,
        spawnZ: spawn.z,
        spawnYaw: spawn.yaw,
        postX: spawn.x,
        postZ: spawn.z,
        hp: stats.maxHp,
        maxHp: stats.maxHp,
        respawnTimer: 0,
        attackTimer: 0,
        sinceHurt: 99,
        hitFlashTimer: 0,
        shotCount: 0,
        skillCooldowns: [0, 0],
        rallyBannerTimer: 0,
        waypoints: [],
        targetPoolIndex: -1,
        targetUid: 0,
        totalDamageDealt: 0,
        kills: 0,
      };
      this.projectileSystem.onHeroHit = (target, actualDamage, killed) => {
        if (!this.hero) return;
        this.hero.totalDamageDealt += actualDamage;
        if (killed) this.hero.kills++;
        if (this.hero.stats.passive.kind === 'kindling' && target.hp > 0) {
          this.igniteEnemy(target, this.hero.stats.passive.power, this.hero.stats.passive.durationSec);
        }
      };
    }
  }

  /** Grants persistent hero XP during a run and emits `heroXpGained`. */
  grantXp(amount: number, source: 'kill' | 'wave' | 'victory', x?: number, z?: number): void {
    if (!this.hero || amount <= 0) return;
    const gained = Math.floor(amount);
    if (gained <= 0) return;
    this.runXp += gained;
    this.events.emit('heroXpGained', {
      heroId: this.hero.heroId,
      amount: gained,
      totalRunXp: this.runXp,
      source,
      x: x ?? this.hero.x,
      z: z ?? this.hero.z,
    });
  }

  onEnemyKilled(enemy: EnemyEntity): void {
    if (!this.hero) return;
    this.grantXp(HERO_XP_RULES.perKill, 'kill', enemy.x, enemy.z);
  }

  onWaveCleared(): void {
    if (!this.hero) return;
    this.grantXp(HERO_XP_RULES.perWaveCleared, 'wave', this.hero.x, this.hero.z);
  }

  onVictory(stars: 1 | 2 | 3): void {
    if (!this.hero) return;
    this.grantXp(HERO_XP_RULES.winBase + stars * HERO_XP_RULES.perStar, 'victory', this.hero.x, this.hero.z);
  }

  /** Read-only snapshot of the hero and its skill cooldowns for HUD / debug / QA. */
  getRuntimeState(runOngoing = true): HeroRuntimeState | null {
    const h = this.hero;
    if (!h) return null;
    const def = HERO_DEFS[h.heroId];
    const alive = h.state !== 'dead';
    const mkSkill = (slot: HeroSkillSlot): HeroSkillRuntimeState => {
      const a = h.stats.actives[slot];
      const base = def.actives[slot];
      const cd = h.skillCooldowns[slot];
      return {
        slot,
        id: a.id,
        name: base.name,
        targetMode: a.targetMode,
        cooldown: cd,
        maxCooldown: a.cooldownSec,
        ready: cd <= 0,
        usable: runOngoing && alive && cd <= 0,
        range: a.range,
        radius: a.radius,
        durationSec: a.durationSec,
      };
    };
    return {
      heroId: h.heroId,
      name: def.name,
      level: h.level,
      state: h.state,
      alive,
      x: h.x,
      z: h.z,
      yaw: h.yaw,
      hp: Math.ceil(h.hp),
      maxHp: h.maxHp,
      armor: h.stats.armor + (h.rallyBannerTimer > 0 ? h.stats.actives[1].armorBonus : 0),
      respawnRemaining: h.state === 'dead' ? h.respawnTimer : 0,
      respawnMax: h.stats.respawnSec,
      runXp: this.runXp,
      kills: h.kills,
      totalDamageDealt: Math.round(h.totalDamageDealt),
      skills: [mkSkill(0), mkSkill(1)],
    };
  }

  /** Orders the hero to walk along the ground road graph to `(wantX, wantZ)`. */
  commandMove(wantX: number, wantZ: number): boolean {
    const h = this.hero;
    if (!h || h.state === 'dead' || !Number.isFinite(wantX) || !Number.isFinite(wantZ)) return false;

    this.releaseCurrentMeleeHolds(true);
    const waypoints = this.groundGraph.findPath(h.x, h.z, wantX, wantZ);
    const last = waypoints[waypoints.length - 1];
    h.waypoints.length = 0;
    for (let i = 0; i < waypoints.length; i++) h.waypoints.push(waypoints[i]);
    h.postX = last.x;
    h.postZ = last.z;
    h.state = Math.hypot(last.x - h.x, last.z - h.z) > 1e-4 ? 'moving' : 'idle';

    this.events.emit('heroMoved', {
      heroId: h.heroId,
      x: h.x,
      z: h.z,
      targetX: last.x,
      targetZ: last.z,
      waypoints: [...waypoints],
    });
    return true;
  }

  /** Casts hero active skill `slot` (`0` or `1`), targeting `(wantX, wantZ)` when point-targeted. */
  castSkill(
    slot: HeroSkillSlot,
    wantX = NaN,
    wantZ = NaN,
    towers: readonly TowerEntity[] = [],
  ): boolean {
    const h = this.hero;
    if (!h || h.state === 'dead') return false;
    if (slot !== 0 && slot !== 1) return false;
    if (h.skillCooldowns[slot] > 0) return false;

    const act = h.stats.actives[slot];
    let tx = h.x;
    let tz = h.z;

    if (act.targetMode === 'point') {
      if (Number.isFinite(wantX) && Number.isFinite(wantZ)) {
        tx = wantX;
        tz = wantZ;
      } else {
        const auto = this.acquireRangedTarget(h.x, h.z, Math.max(act.range, h.stats.range), true);
        if (auto) {
          tx = auto.x;
          tz = auto.z;
        } else {
          tx = h.x + Math.sin(h.yaw) * Math.min(2.0, act.range);
          tz = h.z + Math.cos(h.yaw) * Math.min(2.0, act.range);
        }
      }
      if (act.range > 0) {
        const dx = tx - h.x;
        const dz = tz - h.z;
        const d = Math.hypot(dx, dz);
        if (d > act.range && d > 1e-6) {
          tx = h.x + (dx / d) * act.range;
          tz = h.z + (dz / d) * act.range;
        }
      }
    }

    const ok = this.executeActive(h, act, tx, tz, towers);
    if (!ok) return false;

    h.skillCooldowns[slot] = act.cooldownSec;
    if (Math.hypot(tx - h.x, tz - h.z) > 0.05) {
      h.yaw = Math.atan2(tx - h.x, tz - h.z);
    }
    this.events.emit('heroSkillCast', {
      heroId: h.heroId,
      slot,
      skillId: act.id,
      x: h.x,
      z: h.z,
      targetX: tx,
      targetZ: tz,
      radius: act.radius,
      duration: act.durationSec,
    });
    return true;
  }

  private executeActive(
    h: HeroEntity,
    act: ResolvedHeroActive,
    tx: number,
    tz: number,
    towers: readonly TowerEntity[],
  ): boolean {
    switch (act.kind) {
      case 'shieldBash': {
        let dirX = tx - h.x;
        let dirZ = tz - h.z;
        if (Math.hypot(dirX, dirZ) < 0.05) {
          const cur = this.currentMeleeTarget(h);
          if (cur) {
            dirX = cur.x - h.x;
            dirZ = cur.z - h.z;
          } else {
            dirX = Math.sin(h.yaw);
            dirZ = Math.cos(h.yaw);
          }
        }
        const reach = act.radius;
        this.spatialHash.query(h.x, h.z, reach + 0.8, _candidates);
        const rSq = (reach + 0.45) * (reach + 0.45);
        const minCos = Math.cos((72 * Math.PI) / 180);
        const slowAfter = act.extras.has('bashSlow');
        for (let i = 0; i < _candidates.length; i++) {
          const e = this.pool.items[_candidates[i]];
          if (!e.active || e.hp <= 0 || e.flying || e.burrowed) continue;
          const ex = e.x - h.x;
          const ez = e.z - h.z;
          const dSq = ex * ex + ez * ez;
          if (dSq > rSq) continue;
          if (dSq > 0.85 * 0.85 && angleCosBetween(dirX, dirZ, ex, ez) < minCos) continue;
          const res = this.enemySystem.applyDamage(e, act.damage, true);
          h.totalDamageDealt += res.actualDamage;
          if (res.killed) h.kills++;
          if (e.hp > 0) {
            this.enemySystem.applyStun(e, act.durationSec);
            if (slowAfter) this.enemySystem.applySlow(e, 0.35, act.durationSec + 2.5);
          }
        }
        return true;
      }

      case 'rallyBanner': {
        h.rallyBannerTimer = act.durationSec;
        this.applyRallyAura(h, 0);
        return true;
      }

      case 'volley': {
        const slow = act.extras.has('volleySlow');
        this.applyVolleyStrike(h, tx, tz, act.radius, act.damage, slow);
        if (act.extras.has('doubleVolley')) {
          this.pendingVolleys.push({
            x: tx,
            z: tz,
            radius: act.radius,
            damage: Math.max(1, Math.round(act.damage * 0.45)),
            slow,
            remainingSec: 0.35,
          });
        }
        return true;
      }

      case 'huntersMark': {
        const targets = this.pickEnemiesNear(tx, tz, act.radius, h.x, h.z, act.range, act.count, true);
        if (targets.length === 0) return false;
        for (let i = 0; i < targets.length; i++) {
          this.enemySystem.applyMark(targets[i], act.effect, act.durationSec);
        }
        return true;
      }

      case 'fireRing': {
        this.spawnFireRing(h, tx, tz, act.radius, act.damage, act.effect, act.durationSec, act.extras.has('ringSlow'));
        return true;
      }

      case 'wispBurst': {
        let dx = tx - h.x;
        let dz = tz - h.z;
        let len = Math.hypot(dx, dz);
        if (len < 0.05) {
          dx = Math.sin(h.yaw);
          dz = Math.cos(h.yaw);
          len = 1;
        }
        dx /= len;
        dz /= len;
        const dashLen = act.radius;
        const halfWidth = Math.max(0.5, act.effect);
        const endX = h.x + dx * dashLen;
        const endZ = h.z + dz * dashLen;
        const midX = (h.x + endX) * 0.5;
        const midZ = (h.z + endZ) * 0.5;
        this.spatialHash.query(midX, midZ, dashLen * 0.5 + halfWidth + 0.9, _candidates);
        const shatter = act.extras.has('shatterShields');
        _hitSet.clear();
        for (let i = 0; i < _candidates.length; i++) {
          const idx = _candidates[i];
          if (_hitSet.has(idx)) continue;
          const e = this.pool.items[idx];
          if (!e.active || e.hp <= 0 || e.burrowed) continue;
          const rx = e.x - h.x;
          const rz = e.z - h.z;
          const along = rx * dx + rz * dz;
          if (along < -0.35 || along > dashLen + 0.35) continue;
          const perp = Math.abs(rx * dz - rz * dx);
          if (perp > halfWidth + e.radius) continue;
          _hitSet.add(idx);
          if (shatter && e.shield > 0) {
            e.shield = 0;
            this.events.emit('shieldBroken', {
              enemyId: e.uid,
              x: e.x,
              y: e.y + e.height * 0.6,
              z: e.z,
            });
          }
          const res = this.enemySystem.applyDamage(e, act.damage, true);
          h.totalDamageDealt += res.actualDamage;
          if (res.killed) h.kills++;
          if (e.hp > 0) {
            this.igniteEnemy(e, h.stats.passive.power, h.stats.passive.durationSec);
          }
        }
        if (act.extras.has('wispFireRing')) {
          const ringAct = h.stats.actives[0];
          this.spawnFireRing(
            h,
            endX,
            endZ,
            ringAct.radius * 0.85,
            Math.round(ringAct.damage * 0.5),
            Math.round(ringAct.effect * 0.75),
            2.5,
            ringAct.extras.has('ringSlow'),
          );
        }
        return true;
      }

      case 'deployGizmo': {
        const clamped = this.groundGraph.clampToGround(tx, tz, 2.4);
        const maxCount = act.count;
        while (this.gizmos.length >= maxCount) {
          // Replace the gizmo closest to expiring.
          let oldest = 0;
          for (let i = 1; i < this.gizmos.length; i++) {
            if (this.gizmos[i].remainingSec < this.gizmos[oldest].remainingSec) oldest = i;
          }
          this.gizmos.splice(oldest, 1);
        }
        this.gizmos.push({
          id: this.nextGizmoId++,
          x: clamped.x,
          z: clamped.z,
          yaw: h.yaw,
          remainingSec: act.durationSec,
          cooldownTimer: 0.1,
          range: act.radius,
          damage: act.damage,
          fireRate: Math.max(0.2, act.effect),
          splashRadius: act.extras.has('gizmoSplash') ? 1.15 : 0,
          boostTimer: 0,
          boostRate: 0,
        });
        return true;
      }

      case 'overhaul': {
        const chosen = this.pickTowersNear(towers, tx, tz, h.x, h.z, act.range, act.count);
        const boostGizmos = act.extras.has('overhaulGizmos') && this.gizmos.length > 0;
        if (chosen.length === 0 && !boostGizmos) return false;
        for (let i = 0; i < chosen.length; i++) {
          const t = chosen[i];
          t.stunTimer = 0;
          t.cooldownTimer = 0;
          t.overhaulTimer = Math.max(t.overhaulTimer ?? 0, act.durationSec);
          t.overhaulRateBonus = Math.max(t.overhaulRateBonus ?? 0, act.effect);
          if (TOWER_DEFS[t.type].role === 'barracks') {
            const b = this.soldierSystem.getBarracks(t.id);
            if (b) {
              for (let s = 0; s < b.squad.length; s++) {
                const sol = b.squad[s];
                if (sol.state === 'dead') sol.respawnTimer = Math.max(0, sol.respawnTimer - 4.0);
                else sol.hp = Math.min(sol.maxHp, sol.hp + Math.round(sol.maxHp * 0.35));
              }
            }
          }
        }
        if (boostGizmos) {
          for (let i = 0; i < this.gizmos.length; i++) {
            this.gizmos[i].cooldownTimer = 0;
            this.gizmos[i].boostTimer = act.durationSec;
            this.gizmos[i].boostRate = act.effect;
          }
        }
        return true;
      }

      case 'undertow': {
        this.spatialHash.query(tx, tz, act.radius, _candidates);
        const rSq = act.radius * act.radius;
        const slowRatio = Math.min(0.75, act.effect);
        for (let i = 0; i < _candidates.length; i++) {
          const e = this.pool.items[_candidates[i]];
          if (!e.active || e.hp <= 0 || e.burrowed) continue;
          const dx = e.x - tx;
          const dz = e.z - tz;
          if (dx * dx + dz * dz > rSq) continue;
          const res = this.enemySystem.applyDamage(e, act.damage);
          h.totalDamageDealt += res.actualDamage;
          if (res.killed) h.kills++;
          if (e.hp > 0) {
            this.enemySystem.applySlow(e, slowRatio, act.durationSec);
          }
        }
        if (act.extras.has('undertowHeal')) {
          this.healNearbyAllies(h, 45);
        }
        return true;
      }

      case 'thunderCall': {
        const firstList = this.pickEnemiesNear(tx, tz, act.radius, h.x, h.z, act.range, 1, false);
        if (firstList.length === 0) return false;
        let current: EnemyEntity | null = firstList[0];
        let dmg = act.damage;
        const maxJumps = act.count;
        const chainRange = act.radius;
        const maxRSq = chainRange * chainRange;
        const stun = act.extras.has('thunderStun');
        const brittle = act.extras.has('thunderBrittle');
        const points: Vec3[] = [{ x: h.x, y: 1.1, z: h.z }];
        _hitSet.clear();

        for (let jump = 0; jump < maxJumps && current !== null; jump++) {
          _hitSet.add(current.poolIndex);
          points.push({ x: current.x, y: current.y + current.height * 0.55, z: current.z });
          const bonusMul = brittle && current.slowRatio > 0 ? 1.3 : 1;
          const res = this.enemySystem.applyDamage(current, Math.round(dmg * bonusMul), true);
          h.totalDamageDealt += res.actualDamage;
          if (res.killed) h.kills++;
          if (stun && current.hp > 0 && !current.flying) {
            this.enemySystem.applyStun(current, 0.6);
          }
          if (jump === maxJumps - 1) break;

          this.spatialHash.query(current.x, current.z, chainRange, _candidates);
          let nextTarget: EnemyEntity | null = null;
          let bestSq = Infinity;
          for (let k = 0; k < _candidates.length; k++) {
            const cand = this.pool.items[_candidates[k]];
            if (!cand.active || cand.hp <= 0 || cand.burrowed || _hitSet.has(cand.poolIndex)) continue;
            const dSq = (cand.x - current.x) ** 2 + (cand.z - current.z) ** 2;
            if (dSq <= maxRSq && (dSq < bestSq - 1e-9 || (Math.abs(dSq - bestSq) <= 1e-9 && nextTarget && cand.uid < nextTarget.uid))) {
              bestSq = dSq;
              nextTarget = cand;
            }
          }
          current = nextTarget;
          dmg *= act.effect;
        }
        this.events.emit('lightningChain', { points, overload: maxJumps >= 6 });
        return true;
      }
    }
  }

  private applyVolleyStrike(
    h: HeroEntity,
    cx: number,
    cz: number,
    radius: number,
    damage: number,
    slow: boolean,
  ): void {
    this.spatialHash.query(cx, cz, radius, _candidates);
    const rSq = radius * radius;
    for (let i = 0; i < _candidates.length; i++) {
      const e = this.pool.items[_candidates[i]];
      if (!e.active || e.hp <= 0 || e.burrowed) continue;
      const dSq = (e.x - cx) ** 2 + (e.z - cz) ** 2;
      if (dSq > rSq) continue;
      const res = this.enemySystem.applyDamage(e, damage + Math.min(e.armor, 2));
      h.totalDamageDealt += res.actualDamage;
      if (res.killed) h.kills++;
      if (slow && e.hp > 0) {
        this.enemySystem.applySlow(e, 0.30, 2.0);
      }
    }
  }

  private spawnFireRing(
    h: HeroEntity,
    cx: number,
    cz: number,
    radius: number,
    burstDamage: number,
    dps: number,
    durationSec: number,
    slowInside: boolean,
  ): void {
    if (burstDamage > 0) {
      this.spatialHash.query(cx, cz, radius, _candidates);
      const rSq = radius * radius;
      for (let i = 0; i < _candidates.length; i++) {
        const e = this.pool.items[_candidates[i]];
        if (!e.active || e.hp <= 0 || e.burrowed) continue;
        if ((e.x - cx) ** 2 + (e.z - cz) ** 2 > rSq) continue;
        const res = this.enemySystem.applyDamage(e, burstDamage, true);
        h.totalDamageDealt += res.actualDamage;
        if (res.killed) h.kills++;
        if (e.hp > 0) {
          this.igniteEnemy(e, h.stats.passive.power, h.stats.passive.durationSec);
          if (slowInside) this.enemySystem.applySlow(e, 0.25, 1.0);
        }
      }
    }
    this.fireRings.push({
      x: cx,
      z: cz,
      radius,
      remainingSec: durationSec,
      dps,
      slowRatio: slowInside ? 0.25 : 0,
    });
    this.events.emit('groundZone', {
      kind: 'fire',
      x: cx,
      z: cz,
      radius,
      duration: durationSec,
    });
  }

  private igniteEnemy(e: EnemyEntity, dps: number, durationSec: number): void {
    if (!e.active || e.hp <= 0 || e.burrowed || dps <= 0 || durationSec <= 0) return;
    const idx = e.poolIndex;
    if (this.burnUid[idx] !== e.uid) {
      this.burnUid[idx] = e.uid;
      this.burnDps[idx] = dps;
      this.burnLeft[idx] = durationSec;
      return;
    }
    this.burnDps[idx] = Math.max(this.burnDps[idx], dps);
    this.burnLeft[idx] = Math.max(this.burnLeft[idx], durationSec);
  }

  private pickEnemiesNear(
    tx: number,
    tz: number,
    searchRadius: number,
    hx: number,
    hz: number,
    fallbackRange: number,
    count: number,
    preferStrongest: boolean,
  ): EnemyEntity[] {
    const queryAndSort = (cx: number, cz: number, r: number): EnemyEntity[] => {
      this.spatialHash.query(cx, cz, r, _candidates);
      const rSq = r * r;
      const list: EnemyEntity[] = [];
      for (let i = 0; i < _candidates.length; i++) {
        const e = this.pool.items[_candidates[i]];
        if (!e.active || e.hp <= 0 || e.burrowed) continue;
        if ((e.x - cx) ** 2 + (e.z - cz) ** 2 <= rSq) list.push(e);
      }
      list.sort((a, b) => {
        if (preferStrongest && b.hp !== a.hp) return b.hp - a.hp;
        const da = (a.x - cx) ** 2 + (a.z - cz) ** 2;
        const db = (b.x - cx) ** 2 + (b.z - cz) ** 2;
        if (Math.abs(da - db) > 1e-6) return da - db;
        return a.uid - b.uid;
      });
      return list;
    };

    let found = queryAndSort(tx, tz, searchRadius);
    if (found.length === 0 && fallbackRange > 0) {
      found = queryAndSort(hx, hz, fallbackRange);
    }
    return found.slice(0, count);
  }

  private pickTowersNear(
    towers: readonly TowerEntity[],
    tx: number,
    tz: number,
    hx: number,
    hz: number,
    maxHeroRange: number,
    count: number,
  ): TowerEntity[] {
    const candidates: TowerEntity[] = [];
    const rSq = maxHeroRange * maxHeroRange;
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      if (t.type === 'beacon') continue;
      if ((t.x - hx) ** 2 + (t.z - hz) ** 2 <= rSq) {
        candidates.push(t);
      }
    }
    candidates.sort((a, b) => {
      const da = (a.x - tx) ** 2 + (a.z - tz) ** 2;
      const db = (b.x - tx) ** 2 + (b.z - tz) ** 2;
      if (Math.abs(da - db) > 1e-6) return da - db;
      return a.id - b.id;
    });
    return candidates.slice(0, count);
  }

  private isHoldable(e: EnemyEntity): boolean {
    if (!e.active || e.hp <= 0 || e.flying || e.burrowed) return false;
    const m = ENEMY_MELEE[e.type];
    if (m.block !== 'block') return false;
    return m.trampleFromPhase === undefined || e.bossPhase < m.trampleFromPhase;
  }

  private currentMeleeTarget(h: HeroEntity): EnemyEntity | null {
    if (h.targetPoolIndex < 0) return null;
    const e = this.pool.items[h.targetPoolIndex];
    return e.active && e.uid === h.targetUid ? e : null;
  }

  private releaseCurrentMeleeHolds(emitNow: boolean): void {
    const h = this.hero;
    if (!h) return;
    if (emitNow) {
      for (let i = 0; i < this.pool.getActiveCount(); i++) {
        const e = this.pool.items[this.pool.getActiveIndex(i)];
        if (e.heroBlockers > 0) {
          e.heroBlockers = 0;
          e.heroDamageReduction = 0;
          if (e.blockers === 0) {
            this.events.emit('enemyUnblocked', {
              enemyId: e.uid,
              enemyType: e.type,
              x: e.x,
              y: e.y,
              z: e.z,
            });
          }
        }
      }
    }
    h.targetPoolIndex = -1;
    h.targetUid = 0;
  }

  private applyRallyAura(h: HeroEntity, dt: number): void {
    const act = h.stats.actives[1];
    const rSq = act.radius * act.radius;
    const healPerSec = act.extras.has('rallyHeal') ? 18 : 0;
    const soldiers = this.soldierSystem.soldiers;
    for (let i = 0; i < soldiers.length; i++) {
      const s = soldiers[i];
      if (s.state === 'dead') continue;
      if ((s.x - h.x) ** 2 + (s.z - h.z) ** 2 <= rSq) {
        s.bonusArmor += act.armorBonus;
        s.damageMul *= 1 + act.effect;
        if (healPerSec > 0 && dt > 0 && s.hp < s.maxHp) {
          s.hp = Math.min(s.maxHp, s.hp + healPerSec * dt);
        }
      }
    }
    if (healPerSec > 0 && dt > 0 && h.hp < h.maxHp) {
      h.hp = Math.min(h.maxHp, h.hp + healPerSec * dt);
    }
  }

  private healNearbyAllies(h: HeroEntity, amount: number): void {
    const r = Math.max(h.stats.passive.radius, 4.2);
    const rSq = r * r;
    const soldiers = this.soldierSystem.soldiers;
    for (let i = 0; i < soldiers.length; i++) {
      const s = soldiers[i];
      if (s.state === 'dead' || s.hp >= s.maxHp) continue;
      if ((s.x - h.x) ** 2 + (s.z - h.z) ** 2 <= rSq) {
        s.hp = Math.min(s.maxHp, s.hp + amount);
      }
    }
    if (h.hp < h.maxHp) {
      h.hp = Math.min(h.maxHp, h.hp + amount * 0.5);
    }
  }

  private updatePeriodicEffects(dt: number, h: HeroEntity): void {
    // Pending second Volley waves (Wren capstone).
    for (let i = this.pendingVolleys.length - 1; i >= 0; i--) {
      const pv = this.pendingVolleys[i];
      pv.remainingSec -= dt;
      if (pv.remainingSec <= 0) {
        this.applyVolleyStrike(h, pv.x, pv.z, pv.radius, pv.damage, pv.slow);
        this.pendingVolleys.splice(i, 1);
      }
    }

    // Active Fire Rings & Kindling DoT ticks (synchronized every 0.5s).
    let anyFire = this.fireRings.length > 0;
    for (let i = this.fireRings.length - 1; i >= 0; i--) {
      const ring = this.fireRings[i];
      ring.remainingSec -= dt;
      if (ring.remainingSec <= 0) {
        this.fireRings.splice(i, 1);
      } else if (ring.slowRatio > 0) {
        this.spatialHash.query(ring.x, ring.z, ring.radius, _candidates);
        const rSq = ring.radius * ring.radius;
        for (let k = 0; k < _candidates.length; k++) {
          const e = this.pool.items[_candidates[k]];
          if (e.active && e.hp > 0 && !e.burrowed && (e.x - ring.x) ** 2 + (e.z - ring.z) ** 2 <= rSq) {
            this.enemySystem.applySlow(e, ring.slowRatio, 0.6);
          }
        }
      }
    }

    const activeCount = this.pool.getActiveCount();
    for (let i = 0; i < activeCount; i++) {
      const idx = this.pool.getActiveIndex(i);
      const e = this.pool.items[idx];
      if (this.burnLeft[idx] > 0) {
        if (this.burnUid[idx] !== e.uid || !e.active || e.hp <= 0) {
          this.burnLeft[idx] = 0;
        } else {
          this.burnLeft[idx] = Math.max(0, this.burnLeft[idx] - dt);
          if (this.burnLeft[idx] > 0) anyFire = true;
        }
      }
    }

    if (!anyFire && this.fireRings.length === 0) {
      this.burnTickTimer = BURN_TICK_INTERVAL;
    } else {
      this.burnTickTimer -= dt;
      if (this.burnTickTimer <= 0) {
        this.burnTickTimer += BURN_TICK_INTERVAL;
        for (let r = 0; r < this.fireRings.length; r++) {
          const ring = this.fireRings[r];
          this.spatialHash.query(ring.x, ring.z, ring.radius, _candidates);
          const rSq = ring.radius * ring.radius;
          const tickDmg = Math.max(1, Math.round(ring.dps * BURN_TICK_INTERVAL));
          for (let k = 0; k < _candidates.length; k++) {
            const e = this.pool.items[_candidates[k]];
            if (!e.active || e.hp <= 0 || e.burrowed) continue;
            if ((e.x - ring.x) ** 2 + (e.z - ring.z) ** 2 > rSq) continue;
            const res = this.enemySystem.applyDamage(e, tickDmg, true);
            h.totalDamageDealt += res.actualDamage;
            if (res.killed) h.kills++;
          }
        }
        for (let i = 0; i < this.pool.getActiveCount(); i++) {
          const idx = this.pool.getActiveIndex(i);
          if (this.burnLeft[idx] <= 0) continue;
          const e = this.pool.items[idx];
          if (!e.active || e.hp <= 0 || e.burrowed || this.burnUid[idx] !== e.uid) continue;
          const tickDmg = Math.max(1, Math.round(this.burnDps[idx] * BURN_TICK_INTERVAL));
          const res = this.enemySystem.applyDamage(e, tickDmg, true);
          h.totalDamageDealt += res.actualDamage;
          if (res.killed) h.kills++;
        }
      }
    }
  }

  private updateGizmos(dt: number, fireRateMultiplier: number): void {
    for (let i = this.gizmos.length - 1; i >= 0; i--) {
      const g = this.gizmos[i];
      g.remainingSec -= dt;
      if (g.remainingSec <= 0) {
        this.gizmos.splice(i, 1);
        continue;
      }
      if (g.boostTimer > 0) {
        g.boostTimer = Math.max(0, g.boostTimer - dt);
        if (g.boostTimer === 0) g.boostRate = 0;
      }
      const rateMul = fireRateMultiplier * (1 + (g.boostTimer > 0 ? g.boostRate : 0));
      if (g.cooldownTimer > 0) {
        g.cooldownTimer = Math.max(0, g.cooldownTimer - dt * rateMul);
      }
      const target = this.acquireRangedTarget(g.x, g.z, g.range, true);
      if (target) {
        g.yaw = Math.atan2(target.x - g.x, target.z - g.z);
        if (g.cooldownTimer <= 0) {
          g.cooldownTimer = 1 / g.fireRate;
          this.projectileSystem.spawnHeroProjectile({
            style: 'ballista',
            startX: g.x,
            startY: 0.65,
            startZ: g.z,
            target,
            damage: g.damage,
            speed: 28,
            splashRadius: g.splashRadius,
            armorPierce: 2,
            slowRatio: 0,
            slowDuration: 0,
            hitsFlyers: true,
          });
        }
      }
    }
  }

  private acquireRangedTarget(
    cx: number,
    cz: number,
    range: number,
    hitsFlyers: boolean,
  ): EnemyEntity | null {
    this.spatialHash.query(cx, cz, range, _candidates);
    const maxRSq = range * range;
    let best: EnemyEntity | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < _candidates.length; i++) {
      const e = this.pool.items[_candidates[i]];
      if (!e.active || e.hp <= 0 || e.burrowed) continue;
      if (e.flying && !hitsFlyers) continue;
      const dSq = (e.x - cx) ** 2 + (e.z - cz) ** 2;
      if (dSq > maxRSq) continue;
      const score = (e.dist + e.laneProgressOffset) / (e.totalDist + e.laneProgressOffset);
      if (score > bestScore || (score === bestScore && best !== null && e.uid < best.uid)) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  private stepAlongWaypoints(h: HeroEntity, dt: number): boolean {
    let remaining = h.stats.moveSpeed * dt;
    while (h.waypoints.length > 0 && remaining > 1e-6) {
      const wp = h.waypoints[0];
      const dx = wp.x - h.x;
      const dz = wp.z - h.z;
      const d = Math.hypot(dx, dz);
      if (d <= remaining || d < 1e-6) {
        h.x = wp.x;
        h.z = wp.z;
        remaining -= d;
        h.waypoints.shift();
        if (d > 1e-6) h.yaw = Math.atan2(dx, dz);
      } else {
        h.x += (dx / d) * remaining;
        h.z += (dz / d) * remaining;
        h.yaw = Math.atan2(dx, dz);
        remaining = 0;
      }
    }
    return h.waypoints.length === 0;
  }

  private stepTowardPoint(h: HeroEntity, tx: number, tz: number, dt: number): boolean {
    const dx = tx - h.x;
    const dz = tz - h.z;
    const d = Math.hypot(dx, dz);
    const step = h.stats.moveSpeed * dt;
    if (d <= step || d < 1e-6) {
      h.x = tx;
      h.z = tz;
      return true;
    }
    h.x += (dx / d) * step;
    h.z += (dz / d) * step;
    h.yaw = Math.atan2(dx, dz);
    return false;
  }

  update(dt: number, towers: readonly TowerEntity[], fireRateMultiplier = 1): void {
    const h = this.hero;
    if (!h || dt <= 0) return;

    // 1. Snapshot last tick's hero holds & reset transient per-tick buffs.
    _prevHeroBlockedIdx.length = 0;
    _prevHeroBlockedUid.length = 0;
    _prevTotalBlocked.length = 0;
    for (let i = 0; i < this.pool.getActiveCount(); i++) {
      const e = this.pool.items[this.pool.getActiveIndex(i)];
      if (e.heroBlockers > 0) {
        _prevHeroBlockedIdx.push(e.poolIndex);
        _prevHeroBlockedUid.push(e.uid);
        _prevTotalBlocked.push(e.blockers + e.heroBlockers);
      }
      e.heroBlockers = 0;
      e.heroDamageReduction = 0;
    }

    const soldiers = this.soldierSystem.soldiers;
    for (let i = 0; i < soldiers.length; i++) {
      soldiers[i].bonusArmor = 0;
      soldiers[i].damageMul = 1;
    }
    for (let i = 0; i < towers.length; i++) {
      towers[i].heroRateBonus = 0;
      towers[i].heroRangeBonus = 0;
    }

    // 2. Skill cooldowns, persistent ground fire / burns, and Tobb's active Gizmos.
    for (let s = 0; s < 2; s++) {
      if (h.skillCooldowns[s] > 0) {
        h.skillCooldowns[s] = Math.max(0, h.skillCooldowns[s] - dt);
      }
    }
    this.updatePeriodicEffects(dt, h);
    this.updateGizmos(dt, fireRateMultiplier);

    // 3. Respawn countdown while dead.
    if (h.state === 'dead') {
      h.respawnTimer -= dt;
      if (h.respawnTimer <= 0) {
        h.respawnTimer = 0;
        h.state = 'idle';
        h.hp = h.maxHp;
        h.x = h.prevX = h.spawnX;
        h.z = h.prevZ = h.spawnZ;
        h.postX = h.spawnX;
        h.postZ = h.spawnZ;
        h.yaw = h.prevYaw = h.spawnYaw;
        h.waypoints.length = 0;
        h.attackTimer = 0;
        h.sinceHurt = 99;
        h.hitFlashTimer = 0;
        this.events.emit('heroRespawn', {
          heroId: h.heroId,
          x: h.x,
          z: h.z,
          hp: h.hp,
          maxHp: h.maxHp,
        });
      }
      this.reconcileHeroUnblocks();
      return;
    }

    // 4. Living hero timers & passive/active support auras.
    h.prevX = h.x;
    h.prevZ = h.z;
    h.prevYaw = h.yaw;
    if (h.hitFlashTimer > 0) h.hitFlashTimer = Math.max(0, h.hitFlashTimer - dt);
    h.sinceHurt += dt;
    if (h.rallyBannerTimer > 0) {
      h.rallyBannerTimer = Math.max(0, h.rallyBannerTimer - dt);
      if (h.rallyBannerTimer > 0) this.applyRallyAura(h, dt);
    }

    const pas = h.stats.passive;
    if (pas.kind === 'tinker') {
      const rSq = pas.radius * pas.radius;
      const grantRange = pas.extras.has('tinkerRange') ? 0.08 : 0;
      for (let i = 0; i < towers.length; i++) {
        const t = towers[i];
        if (t.type === 'beacon') continue;
        if ((t.x - h.x) ** 2 + (t.z - h.z) ** 2 <= rSq) {
          t.heroRateBonus = pas.power;
          t.heroRangeBonus = grantRange;
        }
      }
    } else if (pas.kind === 'calmWaters') {
      const rSq = pas.radius * pas.radius;
      if (pas.extras.has('calmArmor')) {
        for (let i = 0; i < soldiers.length; i++) {
          const s = soldiers[i];
          if (s.state !== 'dead' && (s.x - h.x) ** 2 + (s.z - h.z) ** 2 <= rSq) {
            s.bonusArmor += 2;
          }
        }
      }
      this.calmHealTimer -= dt;
      if (this.calmHealTimer <= 0) {
        this.calmHealTimer += 1.0;
        for (let i = 0; i < soldiers.length; i++) {
          const s = soldiers[i];
          if (s.state !== 'dead' && s.hp < s.maxHp && (s.x - h.x) ** 2 + (s.z - h.z) ** 2 <= rSq) {
            s.hp = Math.min(s.maxHp, s.hp + pas.power);
          }
        }
        if (h.hp < h.maxHp && h.sinceHurt >= 1.0) {
          h.hp = Math.min(h.maxHp, h.hp + pas.power * 0.5);
        }
      }
    }

    // 5. Player move order along the ground road graph.
    const rateMul = Math.max(0.01, fireRateMultiplier);
    if (h.state === 'moving') {
      h.attackTimer = Math.max(0, h.attackTimer - dt * rateMul);
      const arrived = this.stepAlongWaypoints(h, dt);
      if (arrived) {
        h.postX = h.x;
        h.postZ = h.z;
        h.state = 'idle';
      }
    } else if (h.stats.attackMode === 'melee') {
      this.updateMeleeCombat(h, dt, rateMul);
    } else {
      this.updateRangedCombat(h, dt, rateMul);
    }

    // 6. Enemy melee counter-attacks on the hero (blocked foes or unblocked ground foes stepping onto the hero).
    this.updateEnemyStrikesAgainstHero(h, dt);

    // 7. Emit block / unblock transitions for melee hero holds.
    this.reconcileHeroUnblocks();
  }

  private updateMeleeCombat(h: HeroEntity, dt: number, rateMul: number): void {
    let target = this.currentMeleeTarget(h);
    if (
      target !== null &&
      (!this.isHoldable(target) ||
        Math.hypot(target.x - h.postX, target.z - h.postZ) > HERO_RULES.meleeLeashRadius)
    ) {
      h.targetPoolIndex = -1;
      h.targetUid = 0;
      target = null;
      h.state = 'idle';
    }

    if (!target) {
      this.spatialHash.query(h.postX, h.postZ, HERO_RULES.meleeEngageRadius, _candidates);
      const rSq = HERO_RULES.meleeEngageRadius * HERO_RULES.meleeEngageRadius;
      let best: EnemyEntity | null = null;
      let bestNeeds = false;
      for (let i = 0; i < _candidates.length; i++) {
        const e = this.pool.items[_candidates[i]];
        if (!this.isHoldable(e)) continue;
        if ((e.x - h.postX) ** 2 + (e.z - h.postZ) ** 2 > rSq) continue;
        const needs = e.blockers < ENEMY_MELEE[e.type].holdCost;
        if (!best) {
          best = e;
          bestNeeds = needs;
          continue;
        }
        if (needs !== bestNeeds) {
          if (needs) {
            best = e;
            bestNeeds = needs;
          }
          continue;
        }
        const pa = e.dist + e.laneProgressOffset;
        const pb = best.dist + best.laneProgressOffset;
        if (pa > pb || (pa === pb && e.uid < best.uid)) {
          best = e;
          bestNeeds = needs;
        }
      }
      if (best) {
        h.targetPoolIndex = best.poolIndex;
        h.targetUid = best.uid;
        h.state = 'engaging';
        target = best;
      }
    }

    if (target) {
      const contact = target.radius + HERO_RULES.radius;
      let dx = h.x - target.x;
      let dz = h.z - target.z;
      let d = Math.hypot(dx, dz);
      if (d < 1e-6) {
        dx = h.postX - target.x;
        dz = h.postZ - target.z;
        d = Math.hypot(dx, dz);
        if (d < 1e-6) {
          dx = 0;
          dz = -1;
          d = 1;
        }
      }
      this.stepTowardPoint(h, target.x + (dx / d) * contact, target.z + (dz / d) * contact, dt);
      const nowDist = Math.hypot(h.x - target.x, h.z - target.z);
      h.yaw = Math.atan2(target.x - h.x, target.z - h.z);

      if (h.state !== 'fighting' && nowDist <= contact + 0.08) {
        h.state = 'fighting';
        if (h.attackTimer < 0.15) h.attackTimer = 0.15;
      } else if (h.state === 'fighting' && nowDist > contact + HERO_RULES.contactSlack) {
        h.state = 'engaging';
      }

      if (h.state === 'fighting') {
        this.applyMeleeHolds(h, target);
        h.attackTimer -= dt * rateMul;
        if (h.attackTimer <= 0) {
          h.attackTimer += 1 / h.stats.attackSpeed;
          if (h.attackTimer <= 0) h.attackTimer = 1 / h.stats.attackSpeed;
          const rallyBonus = h.rallyBannerTimer > 0 ? 1 + h.stats.actives[1].effect * 0.5 : 1;
          const baseDmg = Math.round(h.stats.damage * rallyBonus);
          const pierce = Math.min(target.armor, h.stats.armorPierce);
          const res = this.enemySystem.applyDamage(target, baseDmg + pierce);
          h.totalDamageDealt += res.actualDamage;
          if (res.killed) h.kills++;
          this.events.emit('heroAttack', {
            heroId: h.heroId,
            mode: 'melee',
            x: h.x,
            z: h.z,
            targetX: target.x,
            targetZ: target.z,
            targetEnemyId: target.uid,
            yaw: h.yaw,
            damage: res.actualDamage,
            crit: false,
            cleave: false,
          });

          if (h.stats.cleave > 0) {
            const other = this.findCleaveTarget(target);
            if (other) {
              const cleaveDmg = Math.max(1, Math.round(baseDmg * h.stats.cleave));
              const cRes = this.enemySystem.applyDamage(other, cleaveDmg + Math.min(other.armor, h.stats.armorPierce));
              h.totalDamageDealt += cRes.actualDamage;
              if (cRes.killed) h.kills++;
              this.events.emit('heroAttack', {
                heroId: h.heroId,
                mode: 'melee',
                x: h.x,
                z: h.z,
                targetX: other.x,
                targetZ: other.z,
                targetEnemyId: other.uid,
                yaw: h.yaw,
                damage: cRes.actualDamage,
                crit: false,
                cleave: true,
              });
            }
          }
        }
      } else {
        h.attackTimer = Math.max(0, h.attackTimer - dt * rateMul);
      }
      return;
    }

    // Idle / returning to guard post.
    h.attackTimer = Math.max(0, h.attackTimer - dt * rateMul);
    const atPost = this.stepTowardPoint(h, h.postX, h.postZ, dt);
    if (atPost) {
      h.state = 'idle';
      if (h.sinceHurt >= HERO_RULES.regenDelay && h.hp < h.maxHp) {
        h.hp = Math.min(h.maxHp, h.hp + h.maxHp * HERO_RULES.regenFrac * dt);
      }
    }
  }

  private applyMeleeHolds(h: HeroEntity, primary: EnemyEntity): void {
    if (primary.hp <= 0) return;
    let budget = h.stats.holdCap;
    const red = h.stats.passive.kind === 'bulwark' ? h.stats.passive.power : 0;

    const assignHold = (e: EnemyEntity): void => {
      const wasFree = e.blockers + e.heroBlockers === 0;
      const needed = Math.max(1, ENEMY_MELEE[e.type].holdCost - e.blockers);
      const give = Math.min(budget, needed);
      e.heroBlockers += give;
      if (red > e.heroDamageReduction) e.heroDamageReduction = red;
      budget -= give;
      if (wasFree && !_prevHeroBlockedIdx.includes(e.poolIndex)) {
        this.events.emit('enemyBlocked', {
          enemyId: e.uid,
          enemyType: e.type,
          x: e.x,
          y: e.y,
          z: e.z,
        });
      }
    };

    assignHold(primary);
    if (budget <= 0) return;

    this.spatialHash.query(h.x, h.z, HERO_RULES.meleeEngageRadius, _candidates);
    const extras: EnemyEntity[] = [];
    const rSq = HERO_RULES.meleeEngageRadius * HERO_RULES.meleeEngageRadius;
    for (let i = 0; i < _candidates.length; i++) {
      const cand = this.pool.items[_candidates[i]];
      if (cand === primary || !this.isHoldable(cand)) continue;
      if (cand.blockers + cand.heroBlockers >= ENEMY_MELEE[cand.type].holdCost) continue;
      if ((cand.x - h.x) ** 2 + (cand.z - h.z) ** 2 > rSq) continue;
      extras.push(cand);
    }
    extras.sort((a, b) => {
      const pa = a.dist + a.laneProgressOffset;
      const pb = b.dist + b.laneProgressOffset;
      if (pb !== pa) return pb - pa;
      return a.uid - b.uid;
    });
    for (let i = 0; i < extras.length && budget > 0; i++) {
      assignHold(extras[i]);
    }
  }

  private findCleaveTarget(primary: EnemyEntity): EnemyEntity | null {
    const r = HERO_RULES.cleaveRadius;
    this.spatialHash.query(primary.x, primary.z, r, _candidates);
    const rSq = r * r;
    let best: EnemyEntity | null = null;
    let bestSq = rSq;
    for (let i = 0; i < _candidates.length; i++) {
      const e = this.pool.items[_candidates[i]];
      if (e === primary || !e.active || e.hp <= 0 || e.flying || e.burrowed) continue;
      const dSq = (e.x - primary.x) ** 2 + (e.z - primary.z) ** 2;
      if (dSq < bestSq || (dSq === bestSq && best !== null && e.uid < best.uid)) {
        bestSq = dSq;
        best = e;
      }
    }
    return best;
  }

  private updateRangedCombat(h: HeroEntity, dt: number, rateMul: number): void {
    h.state = 'idle';
    if (h.attackTimer > 0) {
      h.attackTimer = Math.max(0, h.attackTimer - dt * rateMul);
    }

    const target = this.acquireRangedTarget(h.x, h.z, h.stats.range, h.stats.hitsFlyers);
    if (target) {
      h.yaw = Math.atan2(target.x - h.x, target.z - h.z);
      if (h.attackTimer <= 0) {
        h.attackTimer = 1 / h.stats.attackSpeed;
        h.shotCount++;

        let dmg = h.stats.damage;
        let crit = false;
        const pas = h.stats.passive;
        if (pas.kind === 'keenEye') {
          const chance = target.flying
            ? pas.chance
            : pas.extras.has('groundCrits')
              ? pas.chance * 0.5
              : 0;
          if (chance > 0 && this.rng.chance(chance)) {
            dmg = Math.round(dmg * (1 + pas.power));
            crit = true;
          }
        }

        const chill = pas.extras.has('chillBolts');
        this.projectileSystem.spawnHeroProjectile({
          style: h.stats.projectileStyle,
          startX: h.x,
          startY: 0.9,
          startZ: h.z,
          target,
          damage: dmg,
          speed: h.stats.projectileSpeed,
          splashRadius: h.stats.splashRadius,
          armorPierce: h.stats.armorPierce,
          slowRatio: chill ? 0.22 : 0,
          slowDuration: chill ? 1.6 : 0,
          hitsFlyers: h.stats.hitsFlyers,
        });

        if (pas.extras.has('twinArrow') && h.shotCount % 3 === 0) {
          const second = this.findSecondRangedTarget(h, target) ?? target;
          this.projectileSystem.spawnHeroProjectile({
            style: h.stats.projectileStyle,
            startX: h.x,
            startY: 0.9,
            startZ: h.z,
            target: second,
            damage: Math.max(1, Math.round(h.stats.damage * 0.55)),
            speed: h.stats.projectileSpeed,
            splashRadius: 0,
            armorPierce: h.stats.armorPierce,
            slowRatio: 0,
            slowDuration: 0,
            hitsFlyers: h.stats.hitsFlyers,
            lateral: 0.22,
          });
        }

        this.events.emit('heroAttack', {
          heroId: h.heroId,
          mode: 'ranged',
          x: h.x,
          z: h.z,
          targetX: target.x,
          targetZ: target.z,
          targetEnemyId: target.uid,
          yaw: h.yaw,
          damage: dmg,
          crit,
          cleave: false,
        });
      }
    }

    if (h.sinceHurt >= HERO_RULES.regenDelay && h.hp < h.maxHp) {
      h.hp = Math.min(h.maxHp, h.hp + h.maxHp * HERO_RULES.regenFrac * dt);
    }
  }

  private findSecondRangedTarget(h: HeroEntity, primary: EnemyEntity): EnemyEntity | null {
    this.spatialHash.query(primary.x, primary.z, 3.2, _candidates);
    const maxRSq = h.stats.range * h.stats.range;
    let best: EnemyEntity | null = null;
    let bestSq = Infinity;
    for (let i = 0; i < _candidates.length; i++) {
      const e = this.pool.items[_candidates[i]];
      if (e === primary || !e.active || e.hp <= 0 || e.burrowed) continue;
      if (e.flying && !h.stats.hitsFlyers) continue;
      if ((e.x - h.x) ** 2 + (e.z - h.z) ** 2 > maxRSq) continue;
      const dSq = (e.x - primary.x) ** 2 + (e.z - primary.z) ** 2;
      if (dSq < bestSq || (dSq === bestSq && best !== null && e.uid < best.uid)) {
        bestSq = dSq;
        best = e;
      }
    }
    return best;
  }

  private updateEnemyStrikesAgainstHero(h: HeroEntity, dt: number): void {
    this.spatialHash.query(h.x, h.z, 2.2, _candidates);
    // Sort by uid so enemy swing order is strictly deterministic.
    _candidates.sort((ia, ib) => this.pool.items[ia].uid - this.pool.items[ib].uid);

    const armor = h.stats.armor + (h.rallyBannerTimer > 0 ? h.stats.actives[1].armorBonus : 0);
    for (let i = 0; i < _candidates.length; i++) {
      const e = this.pool.items[_candidates[i]];
      if (!this.isHoldable(e)) continue;
      const m = ENEMY_MELEE[e.type];
      if (m.rate <= 0 || m.damage <= 0 || e.stunTimer > 0) continue;

      const heldByHero = e.heroBlockers > 0;
      const touchingFree =
        e.blockers === 0 &&
        Math.hypot(e.x - h.x, e.z - h.z) <= e.radius + HERO_RULES.radius + 0.18;
      if (!heldByHero && !touchingFree) continue;

      if (e.heroMeleeTimer <= 0) {
        e.heroMeleeTimer = 0.45 / Math.max(0.01, m.rate);
      }
      const drain = 1 - e.slowRatio;
      e.heroMeleeTimer -= dt * drain;
      if (e.heroMeleeTimer > 0) continue;

      e.heroMeleeTimer += 1 / m.rate;
      if (e.heroMeleeTimer <= 0) e.heroMeleeTimer = 1 / m.rate;

      const hpScale = Math.sqrt(Math.max(0.01, e.maxHp / ENEMY_DEFS[e.type].maxHp));
      const raw = m.damage * hpScale * (1 - e.heroDamageReduction);
      const damage = Math.max(1, Math.round(raw - armor));
      h.hp = Math.max(0, h.hp - damage);
      h.sinceHurt = 0;
      h.hitFlashTimer = 0.12;

      this.events.emit('heroHit', {
        heroId: h.heroId,
        enemyId: e.uid,
        damage,
        hp: Math.ceil(h.hp),
        maxHp: h.maxHp,
        x: h.x,
        z: h.z,
      });

      if (h.hp <= 0) {
        h.hp = 0;
        h.state = 'dead';
        h.respawnTimer = h.stats.respawnSec;
        h.rallyBannerTimer = 0;
        h.waypoints.length = 0;
        for (let k = 0; k < this.pool.getActiveCount(); k++) {
          const held = this.pool.items[this.pool.getActiveIndex(k)];
          held.heroBlockers = 0;
          held.heroDamageReduction = 0;
        }
        this.releaseCurrentMeleeHolds(false);
        this.events.emit('heroDied', {
          heroId: h.heroId,
          x: h.x,
          z: h.z,
          respawnSec: h.respawnTimer,
        });
        return;
      }
    }
  }

  private reconcileHeroUnblocks(): void {
    for (let i = 0; i < _prevHeroBlockedIdx.length; i++) {
      const e = this.pool.items[_prevHeroBlockedIdx[i]];
      if (
        e.active &&
        e.uid === _prevHeroBlockedUid[i] &&
        _prevTotalBlocked[i] > 0 &&
        e.blockers + e.heroBlockers === 0
      ) {
        this.events.emit('enemyUnblocked', {
          enemyId: e.uid,
          enemyType: e.type,
          x: e.x,
          y: e.y,
          z: e.z,
        });
      }
    }
  }
}
