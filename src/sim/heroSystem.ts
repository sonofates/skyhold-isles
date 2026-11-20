import type { EventBus } from '../core/eventBus.ts';
import type { ObjectPool } from '../core/pool.ts';
import { SeededRng } from '../core/rng.ts';
import type { HeroId, HeroSkillSlot, TowerType, Vec3 } from '../core/types.ts';
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
import type { MapGrid } from './grid.ts';
import { GroundGraph, type GroundClampResult, type GroundWaypoint } from './groundGraph.ts';
import type { CompiledPath } from './path.ts';
import { BURN_TICK_INTERVAL, type HeroShotParams, type ProjectileSystem } from './projectileSystem.ts';
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
  hasRallyPoint: boolean;
  rallyX: number;
  rallyZ: number;
  postX: number;
  postZ: number;
  hp: number;
  maxHp: number;
  respawnTimer: number;
  invulnTimer: number;
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
  /** Difficulty: scales the hero's respawn timer (default 1). */
  readonly respawnMul?: number;
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
  readonly invulnRemaining: number;
  readonly runXp: number;
  readonly kills: number;
  readonly totalDamageDealt: number;
  readonly skills: readonly [HeroSkillRuntimeState, HeroSkillRuntimeState];
}

export interface ReadonlyPendingVolley {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly damage: number;
  readonly slow: boolean;
  readonly remainingSec: number;
}

interface PendingVolleyWave extends ReadonlyPendingVolley {
  remainingSec: number;
}

const _queryCandidates: number[] = [];
const _skillCandidates0: number[] = [];
const _skillCandidates1: number[] = [];
const _fireRingCandidates: number[] = [];
const _fireRingTickCandidates: number[] = [];
const _pickCandidates: number[] = [];
const _periodicCandidates: number[] = [];
const _strikeCandidates: number[] = [];
const _holdCandidates: number[] = [];
const _cleaveCandidates: number[] = [];
const _pickedEnemies: EnemyEntity[] = [];
const _pickedTowers: TowerEntity[] = [];
const _prevHeroBlockedIdx: number[] = [];
const _prevHeroBlockedUid: number[] = [];
const _prevTotalBlocked: number[] = [];
const _extraHoldIndices: number[] = [];
const _samplePt: Vec3 = { x: 0, y: 0, z: 0 };
const _respawnPtA: Vec3 = { x: 0, y: 0, z: 0 };
const _respawnPtB: Vec3 = { x: 0, y: 0, z: 0 };
const _hitSets = [new Set<number>(), new Set<number>()] as const;
const _clampTarget: GroundClampResult = { x: 0, z: 0, roadX: 0, roadZ: 0, lane: 0, dist: 0 };
const _clampStep: GroundClampResult = { x: 0, z: 0, roadX: 0, roadZ: 0, lane: 0, dist: 0 };
const _heroShotScratch: {
  style: TowerType;
  startX: number;
  startY: number;
  startZ: number;
  target: EnemyEntity | null;
  damage: number;
  speed: number;
  splashRadius: number;
  armorPierce: number;
  slowRatio: number;
  slowDuration: number;
  hitsFlyers: boolean;
  lateral: number;
} = {
  style: 'archer',
  startX: 0,
  startY: 0.9,
  startZ: 0,
  target: null,
  damage: 1,
  speed: 24,
  splashRadius: 0,
  armorPierce: 0,
  slowRatio: 0,
  slowDuration: 0,
  hitsFlyers: true,
  lateral: 0,
};
const GIZMO_DIST_OFFSETS: readonly number[] = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8, 2.3, -2.3, 2.8, -2.8];
const GIZMO_LAT_OFFSETS: readonly number[] = [0, 0.45, -0.45, 0.85, -0.85, 1.1, -1.1];
const _gizmoPlacementOut = { x: 0, z: 0 };
const _resolvedCastTargets: readonly [{ x: number; z: number }, { x: number; z: number }] = [
  { x: 0, z: 0 },
  { x: 0, z: 0 },
];

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

function wrapYaw(rad: number): number {
  let y = rad;
  while (y > Math.PI) y -= Math.PI * 2;
  while (y < -Math.PI) y += Math.PI * 2;
  return y;
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
  private inUpdate = false;
  private abortedStep = false;
  private resetGen = 0;
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
  private readonly grid: MapGrid | null;
  private readonly groundPaths: readonly CompiledPath[];

  private readonly byUidAsc = (ia: number, ib: number): number =>
    this.pool.items[ia].uid - this.pool.items[ib].uid;

  private readonly byProgressDesc = (ia: number, ib: number): number => {
    const a = this.pool.items[ia];
    const b = this.pool.items[ib];
    const pa = a.dist + a.laneProgressOffset;
    const pb = b.dist + b.laneProgressOffset;
    if (pb !== pa) return pb - pa;
    return a.uid - b.uid;
  };

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
    grid?: MapGrid | null,
  ) {
    this.pool = pool;
    this.spatialHash = spatialHash;
    this.enemySystem = enemySystem;
    this.projectileSystem = projectileSystem;
    this.soldierSystem = soldierSystem;
    this.events = events;
    this.grid = grid ?? null;
    this.groundPaths = groundPaths;
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
      const baseStats = resolveHeroStats(config.heroId, lvl, skills);
      const respawnMul =
        typeof config.respawnMul === 'number' && Number.isFinite(config.respawnMul) && config.respawnMul > 0
          ? config.respawnMul
          : 1;
      const stats = respawnMul === 1 ? baseStats : { ...baseStats, respawnSec: baseStats.respawnSec * respawnMul };
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
        hasRallyPoint: false,
        rallyX: spawn.x,
        rallyZ: spawn.z,
        postX: spawn.x,
        postZ: spawn.z,
        hp: stats.maxHp,
        maxHp: stats.maxHp,
        respawnTimer: 0,
        invulnTimer: 0,
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
      this.soldierSystem.isHeroHoldingEnemy = (poolIndex, uid) => this.isHoldingEnemy(poolIndex, uid);
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

  onWaveCleared(waveCount = 1): void {
    if (!this.hero) return;
    const count = Number.isFinite(waveCount) ? Math.max(0, Math.floor(waveCount)) : 0;
    if (count <= 0) return;
    this.grantXp(HERO_XP_RULES.perWaveCleared * count, 'wave', this.hero.x, this.hero.z);
  }

  onVictory(stars: 1 | 2 | 3): void {
    if (!this.hero) return;
    this.grantXp(HERO_XP_RULES.winBase + stars * HERO_XP_RULES.perStar, 'victory', this.hero.x, this.hero.z);
  }

  private clearHeroBuffs(towers?: readonly TowerEntity[]): void {
    const soldiers = this.soldierSystem.soldiers;
    for (let i = 0; i < soldiers.length; i++) {
      soldiers[i].bonusArmor = 0;
      soldiers[i].damageMul = 1;
    }
    if (towers) {
      for (let i = 0; i < towers.length; i++) {
        towers[i].heroRateBonus = 0;
        towers[i].heroRangeBonus = 0;
      }
    }
  }

  /** Clears lingering ground zones, pending volleys, active holds, and burns at run end or wave skip. */
  clearTransientZones(includeGizmos = false, towers?: readonly TowerEntity[], emitUnblocks = true): void {
    this.resetGen++;
    if (this.inUpdate) {
      this.abortedStep = true;
    }
    this.fireRings.length = 0;
    this.pendingVolleys.length = 0;
    this.burnLeft.fill(0);
    this.burnDps.fill(0);
    this.burnUid.fill(0);
    this.burnTickTimer = BURN_TICK_INTERVAL;
    if (includeGizmos) {
      this.gizmos.length = 0;
      this.calmHealTimer = 1.0;
    }
    this.clearHeroBuffs(towers);
    if (this.hero) {
      if (emitUnblocks) {
        this.releaseCurrentMeleeHolds(true);
      } else {
        for (let i = 0; i < this.pool.getActiveCount(); i++) {
          const e = this.pool.items[this.pool.getActiveIndex(i)];
          e.heroBlockers = 0;
          e.heroDamageReduction = 0;
        }
        this.releaseCurrentMeleeHolds(false);
      }
      _prevHeroBlockedIdx.length = 0;
      _prevHeroBlockedUid.length = 0;
      _prevTotalBlocked.length = 0;
      this.hero.rallyBannerTimer = 0;
      this.hero.invulnTimer = 0;
      this.hero.waypoints.length = 0;
      if (
        this.hero.state === 'engaging' ||
        this.hero.state === 'fighting' ||
        this.hero.state === 'moving'
      ) {
        this.hero.state = 'idle';
        this.hero.postX = this.hero.x;
        this.hero.postZ = this.hero.z;
      }
    }
  }

  getPendingVolleys(): readonly ReadonlyPendingVolley[] {
    return this.pendingVolleys;
  }

  getBurnTickTimer(): number {
    return this.burnTickTimer;
  }

  getCalmHealTimer(): number {
    return this.calmHealTimer;
  }

  getEnemyBurnRemaining(poolIndex: number, uid: number): number {
    if (poolIndex < 0 || poolIndex >= this.burnLeft.length) return 0;
    return this.burnUid[poolIndex] === uid ? this.burnLeft[poolIndex] : 0;
  }

  getEnemyBurnDps(poolIndex: number, uid: number): number {
    if (poolIndex < 0 || poolIndex >= this.burnDps.length) return 0;
    return this.burnUid[poolIndex] === uid && this.burnLeft[poolIndex] > 0 ? this.burnDps[poolIndex] : 0;
  }

  private static buildSkillRuntimeState(
    h: HeroEntity,
    def: (typeof HERO_DEFS)[HeroId],
    slot: HeroSkillSlot,
    alive: boolean,
    runOngoing: boolean,
  ): HeroSkillRuntimeState {
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
  }

  /** Read-only snapshot of the hero and its skill cooldowns for HUD / debug / QA. */
  getRuntimeState(runOngoing = true): HeroRuntimeState | null {
    const h = this.hero;
    if (!h) return null;
    const def = HERO_DEFS[h.heroId];
    const alive = h.state !== 'dead' && h.hp > 0;
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
      invulnRemaining: alive ? h.invulnTimer : 0,
      runXp: this.runXp,
      kills: h.kills,
      totalDamageDealt: Math.round(h.totalDamageDealt),
      skills: [
        HeroSystem.buildSkillRuntimeState(h, def, 0, alive, runOngoing),
        HeroSystem.buildSkillRuntimeState(h, def, 1, alive, runOngoing),
      ],
    };
  }

  /** Orders the hero to walk along the ground road graph to `(wantX, wantZ)`. */
  commandMove(wantX: number, wantZ: number, onCommitted?: () => void): boolean {
    const h = this.hero;
    if (!h || h.state === 'dead' || h.hp <= 0 || !Number.isFinite(wantX) || !Number.isFinite(wantZ)) {
      return false;
    }

    onCommitted?.();
    this.releaseCurrentMeleeHolds(true);
    this.groundGraph.findPathInto(h.x, h.z, wantX, wantZ, HERO_RULES.maxOffRoadDist, h.waypoints);
    const last = h.waypoints[h.waypoints.length - 1];
    h.hasRallyPoint = true;
    h.rallyX = last.x;
    h.rallyZ = last.z;
    h.postX = last.x;
    h.postZ = last.z;
    h.state = Math.hypot(last.x - h.x, last.z - h.z) > 1e-4 ? 'moving' : 'idle';

    this.events.emit('heroMoved', {
      heroId: h.heroId,
      x: h.x,
      z: h.z,
      targetX: last.x,
      targetZ: last.z,
      waypoints: [...h.waypoints],
    });
    return true;
  }

  /**
   * Deterministic fallback respawn point when the player has never issued a move command:
   * - Multi-lane maps: the first merge junction walking out from the castle side of the road.
   * - Single-lane maps: the first castle-side road bend/chokepoint (or a clear castle-side road post).
   * Always outside the castle threshold (`>= respawnCastleClearance` when road length allows) and on the road.
   */
  getFallbackRespawnPoint(): { x: number; z: number; yaw: number } {
    const main = this.groundPaths[0];
    if (!main || main.totalLength <= 0) {
      return {
        x: this.hero?.spawnX ?? 0,
        z: this.hero?.spawnZ ?? 0,
        yaw: this.hero?.spawnYaw ?? 0,
      };
    }

    const total = main.totalLength;
    const minBack = Math.min(HERO_RULES.respawnCastleClearance, total * 0.35);

    if (this.groundPaths.length >= 2) {
      let earliestSharedDist = total;
      const step = 0.25;
      for (let d = total; d >= 0; d -= step) {
        main.sample(d, _respawnPtA);
        let allClose = true;
        for (let l = 1; l < this.groundPaths.length; l++) {
          const other = this.groundPaths[l];
          const nd = other.nearestDist(_respawnPtA.x, _respawnPtA.z);
          other.sample(nd, _respawnPtB);
          if (Math.hypot(_respawnPtA.x - _respawnPtB.x, _respawnPtA.z - _respawnPtB.z) > 0.7) {
            allClose = false;
            break;
          }
        }
        if (allClose) {
          earliestSharedDist = d;
        } else {
          break;
        }
      }
      const anchorDist = Math.max(0, Math.min(total - minBack, earliestSharedDist + 0.8));
      const roadYaw = main.sample(anchorDist, _samplePt);
      return { x: _samplePt.x, z: _samplePt.z, yaw: wrapYaw(roadYaw + Math.PI) };
    }

    // Single-lane road: walk out from the castle side and pick the first bend/chokepoint outside the castle.
    const maxBack = Math.min(18.0, total * 0.45);
    const minTurnRad = (25 * Math.PI) / 180;
    let chosenBack = Math.min(4.5, total * 0.35);
    for (let b = minBack; b <= maxBack; b += 0.25) {
      const d = total - b;
      const y1 = main.sample(Math.max(0, d - 1.0), _respawnPtA);
      const y2 = main.sample(Math.min(total, d + 1.0), _respawnPtB);
      let diff = Math.abs(y2 - y1);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff >= minTurnRad) {
        let peakBack = b;
        let peakDiff = diff;
        const limitBack = Math.min(maxBack, b + 2.0);
        for (let pb = b + 0.25; pb <= limitBack; pb += 0.25) {
          const pd = total - pb;
          const py1 = main.sample(Math.max(0, pd - 1.0), _respawnPtA);
          const py2 = main.sample(Math.min(total, pd + 1.0), _respawnPtB);
          let pdiff = Math.abs(py2 - py1);
          if (pdiff > Math.PI) pdiff = Math.PI * 2 - pdiff;
          if (pdiff > peakDiff + 1e-9) {
            peakDiff = pdiff;
            peakBack = pb;
          }
        }
        chosenBack = peakBack;
        break;
      }
    }

    const anchorDist = Math.max(0, Math.min(total - minBack, total - chosenBack));
    const roadYaw = main.sample(anchorDist, _samplePt);
    return { x: _samplePt.x, z: _samplePt.z, yaw: wrapYaw(roadYaw + Math.PI) };
  }

  private minEnemyMarginAt(x: number, z: number): number {
    let minMargin = Infinity;
    const activeCount = this.pool.getActiveCount();
    for (let i = 0; i < activeCount; i++) {
      const e = this.pool.items[this.pool.getActiveIndex(i)];
      if (!e.active || e.hp <= 0 || e.flying || e.burrowed) continue;
      const d = Math.hypot(e.x - x, e.z - z);
      const margin = d - (e.radius + HERO_RULES.respawnSafeClearance);
      if (margin < minMargin) minMargin = margin;
    }
    return minMargin;
  }

  /**
   * Deterministic respawn resolver:
   * - Uses the hero's last commanded rally point (`rallyX`, `rallyZ`) when set; otherwise `getFallbackRespawnPoint()`.
   * - If ground enemies make that point unsafe, steps along the walkable road behind it (towards the castle)
   *   within `HERO_RULES.respawnRetreatRadius` and picks the nearest safe road point.
   */
  resolveRespawnPoint(): { x: number; z: number; yaw: number } {
    const h = this.hero;
    const fallback = h?.hasRallyPoint ? null : this.getFallbackRespawnPoint();
    const wantX = h?.hasRallyPoint ? h.rallyX : (fallback?.x ?? 0);
    const wantZ = h?.hasRallyPoint ? h.rallyZ : (fallback?.z ?? 0);

    const base = this.groundGraph.clampToGroundOut(
      wantX,
      wantZ,
      HERO_RULES.maxOffRoadDist,
      _clampTarget,
    );
    const path = this.groundPaths[base.lane] ?? this.groundPaths[0];
    if (!path || path.totalLength <= 0) {
      return { x: base.x, z: base.z, yaw: fallback?.yaw ?? h?.spawnYaw ?? 0 };
    }

    const baseRoadYaw = path.sample(base.dist, _samplePt);
    const baseYaw = wrapYaw(baseRoadYaw + Math.PI);
    const baseMargin = this.minEnemyMarginAt(base.x, base.z);
    if (baseMargin > 0) {
      return { x: base.x, z: base.z, yaw: baseYaw };
    }

    const goalBackoff = h?.hasRallyPoint
      ? HERO_RULES.castleSpawnBackoff
      : Math.min(1.5, path.totalLength * 0.25);
    const maxDist = Math.max(base.dist, path.totalLength - goalBackoff);
    const maxEuclidSq = HERO_RULES.respawnRetreatRadius * HERO_RULES.respawnRetreatRadius;
    const maxArc = Math.min(maxDist - base.dist, HERO_RULES.respawnRetreatRadius * 1.5);
    const STEP = 0.35;

    let bestMargin = baseMargin;
    let bestX = base.x;
    let bestZ = base.z;
    let bestYaw = baseYaw;

    if (maxArc > 1e-6) {
      let done = false;
      for (let arc = STEP; !done; arc += STEP) {
        if (arc >= maxArc - 1e-9) {
          arc = maxArc;
          done = true;
        }
        const d = base.dist + arc;
        const roadYaw = path.sample(d, _samplePt);
        const cx = _samplePt.x;
        const cz = _samplePt.z;
        if ((cx - base.x) ** 2 + (cz - base.z) ** 2 > maxEuclidSq) continue;
        const candYaw = wrapYaw(roadYaw + Math.PI);
        const margin = this.minEnemyMarginAt(cx, cz);
        if (margin > 0) {
          return { x: cx, z: cz, yaw: candYaw };
        }
        if (margin > bestMargin + 1e-9) {
          bestMargin = margin;
          bestX = cx;
          bestZ = cz;
          bestYaw = candYaw;
        }
      }
    }

    return { x: bestX, z: bestZ, yaw: bestYaw };
  }

  /** Casts hero active skill `slot` (`0` or `1`), targeting `(wantX, wantZ)` when point-targeted. */
  castSkill(
    slot: HeroSkillSlot,
    wantX = NaN,
    wantZ = NaN,
    towers: readonly TowerEntity[] = [],
    onCommitted?: () => void,
  ): boolean {
    const h = this.hero;
    if (!h || h.state === 'dead' || h.hp <= 0) return false;
    if (slot !== 0 && slot !== 1) return false;
    if (h.skillCooldowns[slot] > 0) return false;

    const act = h.stats.actives[slot];
    let tx = h.x;
    let tz = h.z;

    if (act.targetMode === 'point') {
      const autoAim = Number.isNaN(wantX) && Number.isNaN(wantZ);
      if (!autoAim && (!Number.isFinite(wantX) || !Number.isFinite(wantZ))) {
        return false;
      }
      if (!autoAim) {
        tx = wantX;
        tz = wantZ;
      } else if (act.kind === 'overhaul') {
        const maxRSq = act.range * act.range;
        let bestTower: TowerEntity | null = null;
        let bestStunned = false;
        let bestSq = Infinity;
        for (let i = 0; i < towers.length; i++) {
          const t = towers[i];
          if (t.type === 'beacon' && t.stunTimer <= 0) continue;
          const dSq = (t.x - h.x) ** 2 + (t.z - h.z) ** 2;
          if (dSq > maxRSq) continue;
          const stunned = t.stunTimer > 0;
          if (
            !bestTower ||
            (stunned && !bestStunned) ||
            (stunned === bestStunned && (dSq < bestSq - 1e-6 || (Math.abs(dSq - bestSq) <= 1e-6 && t.id < bestTower.id)))
          ) {
            bestTower = t;
            bestStunned = stunned;
            bestSq = dSq;
          }
        }
        if (bestTower) {
          tx = bestTower.x;
          tz = bestTower.z;
        }
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

    const gen = this.resetGen;
    const resolvedTarget = _resolvedCastTargets[slot];
    resolvedTarget.x = tx;
    resolvedTarget.z = tz;
    const ok = this.executeActive(h, slot, act, tx, tz, towers, onCommitted, gen);
    if (!ok) return false;
    if (this.resetGen !== gen || h.hp <= 0) return true;

    if (Math.hypot(tx - h.x, tz - h.z) > 0.05) {
      h.yaw = Math.atan2(tx - h.x, tz - h.z);
    }
    this.events.emit('heroSkillCast', {
      heroId: h.heroId,
      slot,
      skillId: act.id,
      x: h.x,
      z: h.z,
      targetX: resolvedTarget.x,
      targetZ: resolvedTarget.z,
      radius: act.radius,
      duration: act.durationSec,
    });
    return true;
  }

  private commitSkillCooldown(
    h: HeroEntity,
    slot: HeroSkillSlot,
    cooldownSec: number,
    onCommitted?: () => void,
  ): void {
    h.skillCooldowns[slot] = cooldownSec;
    onCommitted?.();
  }

  private executeActive(
    h: HeroEntity,
    slot: HeroSkillSlot,
    act: ResolvedHeroActive,
    tx: number,
    tz: number,
    towers: readonly TowerEntity[],
    onCommitted?: () => void,
    gen = this.resetGen,
  ): boolean {
    const skillCandidates = slot === 0 ? _skillCandidates0 : _skillCandidates1;
    const hitSet = _hitSets[slot];
    const resolvedTarget = _resolvedCastTargets[slot];
    switch (act.kind) {
      case 'shieldBash': {
        this.commitSkillCooldown(h, slot, act.cooldownSec, onCommitted);
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
        const dirLen = Math.hypot(dirX, dirZ) || 1;
        resolvedTarget.x = h.x + (dirX / dirLen) * (reach * 0.65);
        resolvedTarget.z = h.z + (dirZ / dirLen) * (reach * 0.65);
        this.spatialHash.query(h.x, h.z, reach + 0.8, skillCandidates);
        const rSq = (reach + 0.45) * (reach + 0.45);
        const minCos = Math.cos((72 * Math.PI) / 180);
        const slowAfter = act.extras.has('bashSlow');
        for (let i = 0; i < skillCandidates.length; i++) {
          if (this.resetGen !== gen) return true;
          const e = this.pool.items[skillCandidates[i]];
          if (!e.active || e.hp <= 0 || e.flying || e.burrowed) continue;
          const ex = e.x - h.x;
          const ez = e.z - h.z;
          const dSq = ex * ex + ez * ez;
          if (dSq > rSq) continue;
          if (dSq > 0.85 * 0.85 && angleCosBetween(dirX, dirZ, ex, ez) < minCos) continue;
          const res = this.enemySystem.applyDamage(e, act.damage, true);
          h.totalDamageDealt += res.actualDamage;
          if (res.killed) h.kills++;
          if (this.resetGen !== gen) return true;
          if (e.hp > 0) {
            this.enemySystem.applyStun(e, act.durationSec);
            if (slowAfter) this.enemySystem.applySlow(e, 0.35, act.durationSec + 2.5);
          }
        }
        return true;
      }

      case 'rallyBanner': {
        this.commitSkillCooldown(h, slot, act.cooldownSec, onCommitted);
        h.rallyBannerTimer = act.durationSec;
        this.applyRallyAura(h, 0);
        return true;
      }

      case 'volley': {
        this.commitSkillCooldown(h, slot, act.cooldownSec, onCommitted);
        const slow = act.extras.has('volleySlow');
        this.applyVolleyStrike(h, tx, tz, act.radius, act.damage, slow, skillCandidates, gen);
        if (this.resetGen !== gen) return true;
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
        resolvedTarget.x = targets[0].x;
        resolvedTarget.z = targets[0].z;
        this.commitSkillCooldown(h, slot, act.cooldownSec, onCommitted);
        for (let i = 0; i < targets.length; i++) {
          this.enemySystem.applyMark(targets[i], act.effect, act.durationSec);
        }
        return true;
      }

      case 'fireRing': {
        this.commitSkillCooldown(h, slot, act.cooldownSec, onCommitted);
        this.spawnFireRing(
          h,
          tx,
          tz,
          act.radius,
          act.damage,
          act.effect,
          act.durationSec,
          act.extras.has('ringSlow'),
          gen,
        );
        return true;
      }

      case 'wispBurst': {
        this.commitSkillCooldown(h, slot, act.cooldownSec, onCommitted);
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
        this.spatialHash.query(midX, midZ, dashLen * 0.5 + halfWidth + 0.9, skillCandidates);
        const shatter = act.extras.has('shatterShields');
        hitSet.clear();
        for (let i = 0; i < skillCandidates.length; i++) {
          if (this.resetGen !== gen) return true;
          const idx = skillCandidates[i];
          if (hitSet.has(idx)) continue;
          const e = this.pool.items[idx];
          if (!e.active || e.hp <= 0 || e.burrowed) continue;
          const rx = e.x - h.x;
          const rz = e.z - h.z;
          const along = rx * dx + rz * dz;
          if (along < -0.35 || along > dashLen + 0.35) continue;
          const perp = Math.abs(rx * dz - rz * dx);
          if (perp > halfWidth + e.radius) continue;
          hitSet.add(idx);
          if (shatter && e.shield > 0) {
            e.shield = 0;
            this.events.emit('shieldBroken', {
              enemyId: e.uid,
              x: e.x,
              y: e.y + e.height * 0.6,
              z: e.z,
            });
            if (this.resetGen !== gen || !e.active || e.hp <= 0) continue;
          }
          const res = this.enemySystem.applyDamage(e, act.damage, true);
          h.totalDamageDealt += res.actualDamage;
          if (res.killed) h.kills++;
          if (this.resetGen !== gen) return true;
          if (e.hp > 0) {
            this.igniteEnemy(e, h.stats.passive.power, h.stats.passive.durationSec);
          }
        }
        if (this.resetGen !== gen) return true;
        if (act.extras.has('wispFireRing')) {
          const ringAct = h.stats.actives[0];
          this.spawnFireRing(
            h,
            endX,
            endZ,
            ringAct.radius * 0.78,
            Math.round(ringAct.damage * 0.42),
            Math.round(ringAct.effect * 0.55),
            2.0,
            ringAct.extras.has('ringSlow'),
            gen,
          );
        }
        return true;
      }

      case 'deployGizmo': {
        this.commitSkillCooldown(h, slot, act.cooldownSec, onCommitted);
        const placed = this.resolveGizmoPlacement(tx, tz, h.x, h.z, act.range);
        resolvedTarget.x = placed.x;
        resolvedTarget.z = placed.z;
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
          x: placed.x,
          z: placed.z,
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
        if (chosen.length > 0) {
          resolvedTarget.x = chosen[0].x;
          resolvedTarget.z = chosen[0].z;
        } else if (this.gizmos.length > 0) {
          resolvedTarget.x = this.gizmos[0].x;
          resolvedTarget.z = this.gizmos[0].z;
        }
        this.commitSkillCooldown(h, slot, act.cooldownSec, onCommitted);
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
        this.commitSkillCooldown(h, slot, act.cooldownSec, onCommitted);
        this.spatialHash.query(tx, tz, act.radius, skillCandidates);
        const rSq = act.radius * act.radius;
        const slowRatio = Math.min(0.75, act.effect);
        for (let i = 0; i < skillCandidates.length; i++) {
          if (this.resetGen !== gen) return true;
          const e = this.pool.items[skillCandidates[i]];
          if (!e.active || e.hp <= 0 || e.burrowed) continue;
          const dx = e.x - tx;
          const dz = e.z - tz;
          if (dx * dx + dz * dz > rSq) continue;
          const res = this.enemySystem.applyDamage(e, act.damage);
          h.totalDamageDealt += res.actualDamage;
          if (res.killed) h.kills++;
          if (this.resetGen !== gen) return true;
          if (e.hp > 0) {
            this.enemySystem.applySlow(e, slowRatio, act.durationSec);
          }
        }
        if (this.resetGen !== gen) return true;
        if (act.extras.has('undertowHeal')) {
          this.healNearbyAllies(h, 45);
        }
        return true;
      }

      case 'thunderCall': {
        const firstList = this.pickEnemiesNear(tx, tz, act.radius, h.x, h.z, act.range, 1, false);
        if (firstList.length === 0) return false;
        let current: EnemyEntity | null = firstList[0];
        resolvedTarget.x = current.x;
        resolvedTarget.z = current.z;
        this.commitSkillCooldown(h, slot, act.cooldownSec, onCommitted);
        let dmg = act.damage;
        const maxJumps = act.count;
        const chainRange = act.radius;
        const maxRSq = chainRange * chainRange;
        const stun = act.extras.has('thunderStun');
        const brittle = act.extras.has('thunderBrittle');
        const points: Vec3[] = [{ x: h.x, y: 1.1, z: h.z }];
        hitSet.clear();

        for (let jump = 0; jump < maxJumps && current !== null; jump++) {
          if (this.resetGen !== gen) return true;
          hitSet.add(current.poolIndex);
          points.push({ x: current.x, y: current.y + current.height * 0.55, z: current.z });
          const bonusMul = brittle && current.slowRatio > 0 ? 1.3 : 1;
          const res = this.enemySystem.applyDamage(current, Math.round(dmg * bonusMul), true);
          h.totalDamageDealt += res.actualDamage;
          if (res.killed) h.kills++;
          if (this.resetGen !== gen) return true;
          if (stun && current.hp > 0 && !current.flying) {
            this.enemySystem.applyStun(current, 0.6);
          }
          if (jump === maxJumps - 1) break;

          this.spatialHash.query(current.x, current.z, chainRange, skillCandidates);
          let nextTarget: EnemyEntity | null = null;
          let bestSq = Infinity;
          for (let k = 0; k < skillCandidates.length; k++) {
            const cand = this.pool.items[skillCandidates[k]];
            if (!cand.active || cand.hp <= 0 || cand.burrowed || hitSet.has(cand.poolIndex)) continue;
            const dSq = (cand.x - current.x) ** 2 + (cand.z - current.z) ** 2;
            if (dSq <= maxRSq && (dSq < bestSq - 1e-9 || (Math.abs(dSq - bestSq) <= 1e-9 && nextTarget && cand.uid < nextTarget.uid))) {
              bestSq = dSq;
              nextTarget = cand;
            }
          }
          current = nextTarget;
          dmg *= act.effect;
        }
        if (this.resetGen !== gen) return true;
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
    scratch: number[],
    gen = this.resetGen,
  ): void {
    this.spatialHash.query(cx, cz, radius, scratch);
    const rSq = radius * radius;
    for (let i = 0; i < scratch.length; i++) {
      if (this.resetGen !== gen) return;
      const e = this.pool.items[scratch[i]];
      if (!e.active || e.hp <= 0 || e.burrowed) continue;
      const dSq = (e.x - cx) ** 2 + (e.z - cz) ** 2;
      if (dSq > rSq) continue;
      const res = this.enemySystem.applyDamage(e, damage + Math.min(e.armor, 2));
      h.totalDamageDealt += res.actualDamage;
      if (res.killed) h.kills++;
      if (this.resetGen !== gen) return;
      if (slow && e.hp > 0) {
        this.enemySystem.applySlow(e, 0.30, 2.0);
      }
    }
  }

  private isClearOfPlots(x: number, z: number): boolean {
    const plots = this.grid?.plots;
    if (!plots || plots.length === 0) return true;
    const minSq = (this.grid.plotRadius * 1.28) ** 2;
    for (let i = 0; i < plots.length; i++) {
      const dx = x - plots[i].x;
      const dz = z - plots[i].z;
      if (dx * dx + dz * dz < minSq) return false;
    }
    return true;
  }

  /**
   * Places Tobb's gizmo turret on/beside the road while guaranteeing it never overlaps any build
   * plot (`grid.plots`), even when the player taps directly on top of a roadside plot.
   */
  private resolveGizmoPlacement(
    tx: number,
    tz: number,
    hx: number,
    hz: number,
    maxCastRange: number,
  ): { x: number; z: number } {
    const initial = this.groundGraph.clampToGroundOut(
      tx,
      tz,
      HERO_RULES.maxOffRoadDist,
      _clampTarget,
    );
    if (this.isClearOfPlots(initial.x, initial.z)) {
      _gizmoPlacementOut.x = initial.x;
      _gizmoPlacementOut.z = initial.z;
      return _gizmoPlacementOut;
    }

    const maxRSq = maxCastRange > 0 ? (maxCastRange + 0.35) ** 2 : Infinity;
    let bestX = initial.roadX;
    let bestZ = initial.roadZ;
    let bestScore = Infinity;
    let found = false;

    for (let lane = 0; lane < this.groundPaths.length; lane++) {
      const path = this.groundPaths[lane];
      if (path.totalLength <= 0) continue;
      const baseDist = lane === initial.lane ? initial.dist : path.nearestDist(tx, tz);
      for (let di = 0; di < GIZMO_DIST_OFFSETS.length; di++) {
        const d = baseDist + GIZMO_DIST_OFFSETS[di];
        if (d < 0 || d > path.totalLength) continue;
        const yaw = path.sample(d, _samplePt);
        const nx = Math.cos(yaw);
        const nz = -Math.sin(yaw);
        for (let li = 0; li < GIZMO_LAT_OFFSETS.length; li++) {
          const lat = GIZMO_LAT_OFFSETS[li];
          const cx = _samplePt.x + nx * lat;
          const cz = _samplePt.z + nz * lat;
          if ((cx - hx) ** 2 + (cz - hz) ** 2 > maxRSq) continue;
          if (!this.isClearOfPlots(cx, cz)) continue;
          // Prefer small distance from aimed point and slight spacing from already-active gizmos.
          let penalty = (cx - tx) ** 2 + (cz - tz) ** 2;
          for (let g = 0; g < this.gizmos.length; g++) {
            if ((cx - this.gizmos[g].x) ** 2 + (cz - this.gizmos[g].z) ** 2 < 0.5 * 0.5) {
              penalty += 4.0;
            }
          }
          if (penalty < bestScore - 1e-9) {
            bestScore = penalty;
            bestX = cx;
            bestZ = cz;
            found = true;
          }
        }
      }
    }

    _gizmoPlacementOut.x = found ? bestX : initial.roadX;
    _gizmoPlacementOut.z = found ? bestZ : initial.roadZ;
    return _gizmoPlacementOut;
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
    gen = this.resetGen,
  ): void {
    if (burstDamage > 0) {
      this.spatialHash.query(cx, cz, radius, _fireRingCandidates);
      const rSq = radius * radius;
      for (let i = 0; i < _fireRingCandidates.length; i++) {
        if (this.resetGen !== gen) return;
        const e = this.pool.items[_fireRingCandidates[i]];
        if (!e.active || e.hp <= 0 || e.burrowed) continue;
        if ((e.x - cx) ** 2 + (e.z - cz) ** 2 > rSq) continue;
        const res = this.enemySystem.applyDamage(e, burstDamage, true);
        h.totalDamageDealt += res.actualDamage;
        if (res.killed) h.kills++;
        if (this.resetGen !== gen) return;
        if (e.hp > 0) {
          this.igniteEnemy(e, h.stats.passive.power, h.stats.passive.durationSec);
          if (slowInside) this.enemySystem.applySlow(e, 0.25, 1.0);
        }
      }
    }
    if (this.resetGen !== gen) return;
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

  private fillPickedEnemies(cx: number, cz: number, r: number, preferStrongest: boolean): void {
    this.spatialHash.query(cx, cz, r, _pickCandidates);
    const rSq = r * r;
    _pickedEnemies.length = 0;
    for (let i = 0; i < _pickCandidates.length; i++) {
      const e = this.pool.items[_pickCandidates[i]];
      if (!e.active || e.hp <= 0 || e.burrowed) continue;
      if ((e.x - cx) ** 2 + (e.z - cz) ** 2 <= rSq) _pickedEnemies.push(e);
    }
    for (let i = 1; i < _pickedEnemies.length; i++) {
      const cur = _pickedEnemies[i];
      const dCur = (cur.x - cx) ** 2 + (cur.z - cz) ** 2;
      let j = i - 1;
      while (j >= 0) {
        const prev = _pickedEnemies[j];
        let cmp: number;
        if (preferStrongest && cur.hp !== prev.hp) {
          cmp = prev.hp - cur.hp;
        } else {
          const dPrev = (prev.x - cx) ** 2 + (prev.z - cz) ** 2;
          cmp = Math.abs(dCur - dPrev) > 1e-6 ? dCur - dPrev : cur.uid - prev.uid;
        }
        if (cmp >= 0) break;
        _pickedEnemies[j + 1] = prev;
        j--;
      }
      _pickedEnemies[j + 1] = cur;
    }
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
  ): readonly EnemyEntity[] {
    this.fillPickedEnemies(tx, tz, searchRadius, preferStrongest);
    if (_pickedEnemies.length === 0 && fallbackRange > 0) {
      this.fillPickedEnemies(hx, hz, fallbackRange, preferStrongest);
    }
    if (_pickedEnemies.length > count) _pickedEnemies.length = count;
    return _pickedEnemies;
  }

  private pickTowersNear(
    towers: readonly TowerEntity[],
    tx: number,
    tz: number,
    hx: number,
    hz: number,
    maxHeroRange: number,
    count: number,
  ): readonly TowerEntity[] {
    _pickedTowers.length = 0;
    const rSq = maxHeroRange * maxHeroRange;
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      if (t.type === 'beacon' && t.stunTimer <= 0) continue;
      if ((t.x - hx) ** 2 + (t.z - hz) ** 2 <= rSq) {
        _pickedTowers.push(t);
      }
    }
    for (let i = 1; i < _pickedTowers.length; i++) {
      const cur = _pickedTowers[i];
      const dCur = (cur.x - tx) ** 2 + (cur.z - tz) ** 2;
      let j = i - 1;
      while (j >= 0) {
        const prev = _pickedTowers[j];
        const dPrev = (prev.x - tx) ** 2 + (prev.z - tz) ** 2;
        const cmp = Math.abs(dCur - dPrev) > 1e-6 ? dCur - dPrev : cur.id - prev.id;
        if (cmp >= 0) break;
        _pickedTowers[j + 1] = prev;
        j--;
      }
      _pickedTowers[j + 1] = cur;
    }
    if (_pickedTowers.length > count) _pickedTowers.length = count;
    return _pickedTowers;
  }

  private isHoldable(e: EnemyEntity): boolean {
    if (!e.active || e.hp <= 0 || e.flying || e.burrowed) return false;
    const m = ENEMY_MELEE[e.type];
    if (m.block !== 'block') return false;
    return m.trampleFromPhase === undefined || e.bossPhase < m.trampleFromPhase;
  }

  /** True when `e` is currently held by the hero (including pending pre-recount holds inside `update()`). */
  isHoldingEnemy(poolIndex: number, uid: number): boolean {
    if (poolIndex < 0 || poolIndex >= this.pool.items.length) return false;
    const e = this.pool.items[poolIndex];
    if (!e.active || e.uid !== uid) return false;
    if (e.heroBlockers > 0) return true;
    if (this.inUpdate) {
      for (let k = 0; k < _prevHeroBlockedIdx.length; k++) {
        if (
          _prevHeroBlockedIdx[k] === poolIndex &&
          _prevHeroBlockedUid[k] === uid &&
          _prevTotalBlocked[k] > 0
        ) {
          return true;
        }
      }
    }
    return false;
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
          for (let k = 0; k < _prevHeroBlockedIdx.length; k++) {
            if (_prevHeroBlockedIdx[k] === e.poolIndex) _prevTotalBlocked[k] = 0;
          }
          if (!this.soldierSystem.isHoldingEnemy(e.poolIndex, e.uid)) {
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
      if (this.inUpdate) {
        for (let k = 0; k < _prevHeroBlockedIdx.length; k++) {
          if (_prevTotalBlocked[k] <= 0) continue;
          _prevTotalBlocked[k] = 0;
          const idx = _prevHeroBlockedIdx[k];
          const uid = _prevHeroBlockedUid[k];
          const e = this.pool.items[idx];
          e.heroBlockers = 0;
          e.heroDamageReduction = 0;
          if (e.active && e.uid === uid && !this.soldierSystem.isHoldingEnemy(idx, uid)) {
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
      if (this.abortedStep) return;
      if (i >= this.pendingVolleys.length) continue;
      const pv = this.pendingVolleys[i];
      pv.remainingSec -= dt;
      if (pv.remainingSec <= 0) {
        this.pendingVolleys.splice(i, 1);
        this.applyVolleyStrike(h, pv.x, pv.z, pv.radius, pv.damage, pv.slow, _periodicCandidates);
        if (this.abortedStep) return;
      }
    }

    // Active Fire Rings & Kindling DoT ticks (synchronized every 0.5s).
    let anyFire = this.fireRings.length > 0;
    for (let i = this.fireRings.length - 1; i >= 0; i--) {
      if (this.abortedStep) return;
      if (i >= this.fireRings.length) continue;
      const ring = this.fireRings[i];
      ring.remainingSec -= dt;
      if (ring.remainingSec <= 0) {
        this.fireRings.splice(i, 1);
      } else if (ring.slowRatio > 0) {
        this.spatialHash.query(ring.x, ring.z, ring.radius, _periodicCandidates);
        const rSq = ring.radius * ring.radius;
        for (let k = 0; k < _periodicCandidates.length; k++) {
          if (this.abortedStep) return;
          const e = this.pool.items[_periodicCandidates[k]];
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
        const ringCount = this.fireRings.length;
        for (let r = 0; r < ringCount && r < this.fireRings.length; r++) {
          if (this.abortedStep) return;
          const ring = this.fireRings[r];
          this.spatialHash.query(ring.x, ring.z, ring.radius, _fireRingTickCandidates);
          const rSq = ring.radius * ring.radius;
          const tickDmg = Math.max(1, Math.round(ring.dps * BURN_TICK_INTERVAL));
          for (let k = 0; k < _fireRingTickCandidates.length; k++) {
            if (this.abortedStep) return;
            const e = this.pool.items[_fireRingTickCandidates[k]];
            if (!e.active || e.hp <= 0 || e.burrowed) continue;
            if ((e.x - ring.x) ** 2 + (e.z - ring.z) ** 2 > rSq) continue;
            const res = this.enemySystem.applyDamage(e, tickDmg, true);
            h.totalDamageDealt += res.actualDamage;
            if (res.killed) h.kills++;
          }
        }
        for (let i = 0; i < this.pool.getActiveCount(); i++) {
          if (this.abortedStep) return;
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
          _heroShotScratch.style = 'ballista';
          _heroShotScratch.startX = g.x;
          _heroShotScratch.startY = 0.65;
          _heroShotScratch.startZ = g.z;
          _heroShotScratch.target = target;
          _heroShotScratch.damage = g.damage;
          _heroShotScratch.speed = 28;
          _heroShotScratch.splashRadius = g.splashRadius;
          _heroShotScratch.armorPierce = 2;
          _heroShotScratch.slowRatio = 0;
          _heroShotScratch.slowDuration = 0;
          _heroShotScratch.hitsFlyers = true;
          _heroShotScratch.lateral = 0;
          this.projectileSystem.spawnHeroProjectile(_heroShotScratch as HeroShotParams);
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
    this.spatialHash.query(cx, cz, range, _queryCandidates);
    const maxRSq = range * range;
    let best: EnemyEntity | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < _queryCandidates.length; i++) {
      const e = this.pool.items[_queryCandidates[i]];
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
    const clampedTarget = this.groundGraph.clampToGroundOut(
      tx,
      tz,
      HERO_RULES.maxOffRoadDist,
      _clampTarget,
    );
    const goalX = clampedTarget.x;
    const goalZ = clampedTarget.z;
    const dx = goalX - h.x;
    const dz = goalZ - h.z;
    const d = Math.hypot(dx, dz);
    const step = h.stats.moveSpeed * dt;
    if (d <= step || d < 1e-6) {
      h.x = goalX;
      h.z = goalZ;
      return true;
    }
    const nx = h.x + (dx / d) * step;
    const nz = h.z + (dz / d) * step;
    const clampedStep = this.groundGraph.clampToGroundOut(
      nx,
      nz,
      HERO_RULES.maxOffRoadDist,
      _clampStep,
    );
    const movedDx = clampedStep.x - h.x;
    const movedDz = clampedStep.z - h.z;
    h.x = clampedStep.x;
    h.z = clampedStep.z;
    if (movedDx * movedDx + movedDz * movedDz > 1e-10) {
      h.yaw = Math.atan2(movedDx, movedDz);
    }
    return false;
  }

  update(dt: number, towers: readonly TowerEntity[], fireRateMultiplier = 1): void {
    const h = this.hero;
    if (!h || dt <= 0) return;
    this.inUpdate = true;
    this.abortedStep = false;
    try {
      this.updateStep(dt, h, towers, fireRateMultiplier);
    } finally {
      this.inUpdate = false;
      this.abortedStep = false;
    }
  }

  private updateStep(dt: number, h: HeroEntity, towers: readonly TowerEntity[], fireRateMultiplier: number): void {
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
    if (this.abortedStep) return;
    this.updateGizmos(dt, fireRateMultiplier);
    if (this.abortedStep) return;

    // 3. Respawn countdown while dead.
    if (h.state === 'dead') {
      h.respawnTimer -= dt;
      if (h.respawnTimer <= 0) {
        const respawn = this.resolveRespawnPoint();
        h.respawnTimer = 0;
        h.state = 'idle';
        h.hp = h.maxHp;
        h.invulnTimer = HERO_RULES.respawnInvulnSec;
        h.x = h.prevX = respawn.x;
        h.z = h.prevZ = respawn.z;
        h.postX = respawn.x;
        h.postZ = respawn.z;
        h.yaw = h.prevYaw = respawn.yaw;
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
        if (this.abortedStep) return;
      }
      this.reconcileHeroUnblocks();
      return;
    }

    // 4. Living hero timers & passive/active support auras.
    h.prevX = h.x;
    h.prevZ = h.z;
    h.prevYaw = h.yaw;
    const invulnerable = h.invulnTimer > 0;
    if (h.invulnTimer > 0) {
      h.invulnTimer = Math.max(0, h.invulnTimer - dt);
      if (h.invulnTimer <= 1e-9) h.invulnTimer = 0;
    }
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
    if (this.abortedStep) return;

    // 6. Enemy melee counter-attacks on the hero (blocked foes or unblocked ground foes stepping onto the hero).
    this.updateEnemyStrikesAgainstHero(h, dt, towers, invulnerable);
    if (this.abortedStep) return;

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
      this.spatialHash.query(h.postX, h.postZ, HERO_RULES.meleeEngageRadius, _holdCandidates);
      const rSq = HERO_RULES.meleeEngageRadius * HERO_RULES.meleeEngageRadius;
      let best: EnemyEntity | null = null;
      let bestNeeds = false;
      for (let i = 0; i < _holdCandidates.length; i++) {
        const e = this.pool.items[_holdCandidates[i]];
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
        h.waypoints.length = 0;
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
        if (this.abortedStep || h.state !== 'fighting') return;
        const bannerSpeedMul = h.rallyBannerTimer > 0 ? 1.06 : 1;
        h.attackTimer -= dt * rateMul * bannerSpeedMul;
        if (h.attackTimer <= 0) {
          h.attackTimer += 1 / h.stats.attackSpeed;
          if (h.attackTimer <= 0) h.attackTimer = 1 / h.stats.attackSpeed;
          const rallyBonus = h.rallyBannerTimer > 0 ? 1 + h.stats.actives[1].effect * 0.55 : 1;
          const baseDmg = Math.round(h.stats.damage * rallyBonus);
          const pierce = Math.min(target.armor, h.stats.armorPierce);
          const res = this.enemySystem.applyDamage(target, baseDmg + pierce);
          h.totalDamageDealt += res.actualDamage;
          if (res.killed) h.kills++;
          if (this.abortedStep) return;
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
          if (this.abortedStep || h.state !== 'fighting') return;

          if (h.stats.cleave > 0) {
            const other = this.findCleaveTarget(target);
            if (other) {
              const cleaveDmg = Math.max(1, Math.round(baseDmg * h.stats.cleave));
              const cRes = this.enemySystem.applyDamage(other, cleaveDmg + Math.min(other.armor, h.stats.armorPierce));
              h.totalDamageDealt += cRes.actualDamage;
              if (cRes.killed) h.kills++;
              if (this.abortedStep) return;
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

    // Idle / returning to guard post along the walkable road graph.
    h.attackTimer = Math.max(0, h.attackTimer - dt * rateMul);
    const postDist = Math.hypot(h.postX - h.x, h.postZ - h.z);
    if (postDist > 1.4 || h.waypoints.length > 0) {
      if (h.waypoints.length === 0) {
        this.groundGraph.findPathInto(h.x, h.z, h.postX, h.postZ, HERO_RULES.maxOffRoadDist, h.waypoints);
      }
      const wp = h.waypoints[0];
      if (this.stepTowardPoint(h, wp.x, wp.z, dt)) {
        h.waypoints.shift();
      }
      return;
    }
    const atPost = this.stepTowardPoint(h, h.postX, h.postZ, dt);
    if (atPost) {
      h.state = 'idle';
      if (h.sinceHurt >= HERO_RULES.regenDelay && h.hp < h.maxHp) {
        h.hp = Math.min(h.maxHp, h.hp + h.maxHp * HERO_RULES.regenFrac * dt);
      }
    }
  }

  private assignSingleHeroHold(h: HeroEntity, e: EnemyEntity, red: number, budget: number): number {
    const wasFree = e.blockers + e.heroBlockers === 0;
    const needed = Math.max(1, ENEMY_MELEE[e.type].holdCost - e.blockers);
    const give = Math.min(budget, needed);
    e.heroBlockers += give;
    if (red > e.heroDamageReduction) e.heroDamageReduction = red;
    if (!_prevHeroBlockedIdx.includes(e.poolIndex)) {
      // Track in _prevHeroBlockedIdx (even when co-held alongside soldiers) so same-tick hero death
      // or mid-tick barracks sell/rally always reconciles enemyUnblocked 1-to-1.
      _prevHeroBlockedIdx.push(e.poolIndex);
      _prevHeroBlockedUid.push(e.uid);
      _prevTotalBlocked.push(e.blockers + e.heroBlockers);
      if (wasFree) {
        this.events.emit('enemyBlocked', {
          enemyId: e.uid,
          enemyType: e.type,
          x: e.x,
          y: e.y,
          z: e.z,
        });
      }
    }
    void h;
    return budget - give;
  }

  private applyMeleeHolds(h: HeroEntity, primary: EnemyEntity): void {
    if (primary.hp <= 0) return;
    let budget = h.stats.holdCap;
    const red = h.stats.passive.kind === 'bulwark' ? h.stats.passive.power : 0;

    budget = this.assignSingleHeroHold(h, primary, red, budget);
    if (this.abortedStep || h.state !== 'fighting' || budget <= 0) return;

    this.spatialHash.query(h.x, h.z, HERO_RULES.meleeEngageRadius, _holdCandidates);
    _extraHoldIndices.length = 0;
    const rSq = HERO_RULES.meleeEngageRadius * HERO_RULES.meleeEngageRadius;
    for (let i = 0; i < _holdCandidates.length; i++) {
      const idx = _holdCandidates[i];
      const cand = this.pool.items[idx];
      if (cand === primary || !this.isHoldable(cand)) continue;
      if (cand.blockers + cand.heroBlockers >= ENEMY_MELEE[cand.type].holdCost) continue;
      if ((cand.x - h.x) ** 2 + (cand.z - h.z) ** 2 > rSq) continue;
      _extraHoldIndices.push(idx);
    }
    if (_extraHoldIndices.length > 1) {
      _extraHoldIndices.sort(this.byProgressDesc);
    }
    for (let i = 0; i < _extraHoldIndices.length && budget > 0; i++) {
      const cand = this.pool.items[_extraHoldIndices[i]];
      if (!this.isHoldable(cand) || cand.blockers + cand.heroBlockers >= ENEMY_MELEE[cand.type].holdCost) {
        continue;
      }
      budget = this.assignSingleHeroHold(h, cand, red, budget);
      if (this.abortedStep || h.state !== 'fighting') return;
    }
  }

  private findCleaveTarget(primary: EnemyEntity): EnemyEntity | null {
    const r = HERO_RULES.cleaveRadius;
    this.spatialHash.query(primary.x, primary.z, r, _cleaveCandidates);
    const rSq = r * r;
    let best: EnemyEntity | null = null;
    let bestSq = rSq;
    for (let i = 0; i < _cleaveCandidates.length; i++) {
      const e = this.pool.items[_cleaveCandidates[i]];
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
        _heroShotScratch.style = h.stats.projectileStyle;
        _heroShotScratch.startX = h.x;
        _heroShotScratch.startY = 0.9;
        _heroShotScratch.startZ = h.z;
        _heroShotScratch.target = target;
        _heroShotScratch.damage = dmg;
        _heroShotScratch.speed = h.stats.projectileSpeed;
        _heroShotScratch.splashRadius = h.stats.splashRadius;
        _heroShotScratch.armorPierce = h.stats.armorPierce;
        _heroShotScratch.slowRatio = chill ? 0.22 : 0;
        _heroShotScratch.slowDuration = chill ? 1.6 : 0;
        _heroShotScratch.hitsFlyers = h.stats.hitsFlyers;
        _heroShotScratch.lateral = 0;
        this.projectileSystem.spawnHeroProjectile(_heroShotScratch as HeroShotParams);

        if (pas.extras.has('twinArrow') && h.shotCount % 3 === 0) {
          const second = this.findSecondRangedTarget(h, target) ?? target;
          _heroShotScratch.target = second;
          _heroShotScratch.damage = Math.max(1, Math.round(h.stats.damage * 0.55));
          _heroShotScratch.splashRadius = 0;
          _heroShotScratch.slowRatio = 0;
          _heroShotScratch.slowDuration = 0;
          _heroShotScratch.lateral = 0.22;
          this.projectileSystem.spawnHeroProjectile(_heroShotScratch as HeroShotParams);
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
    this.spatialHash.query(primary.x, primary.z, 3.2, _queryCandidates);
    const maxRSq = h.stats.range * h.stats.range;
    let best: EnemyEntity | null = null;
    let bestSq = Infinity;
    for (let i = 0; i < _queryCandidates.length; i++) {
      const e = this.pool.items[_queryCandidates[i]];
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

  private updateEnemyStrikesAgainstHero(
    h: HeroEntity,
    dt: number,
    towers: readonly TowerEntity[],
    invulnerable: boolean,
  ): void {
    if (invulnerable) return;
    this.spatialHash.query(h.x, h.z, 2.2, _strikeCandidates);
    // Sort by uid so enemy swing order is strictly deterministic (zero closure alloc).
    if (_strikeCandidates.length > 1) {
      _strikeCandidates.sort(this.byUidAsc);
    }

    for (let i = 0; i < _strikeCandidates.length; i++) {
      if (h.state === 'dead' || h.hp <= 0) return;
      const e = this.pool.items[_strikeCandidates[i]];
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

      const armor = h.stats.armor + (h.rallyBannerTimer > 0 ? h.stats.actives[1].armorBonus : 0);
      const hpScale = Math.sqrt(Math.max(0.01, e.maxHp / ENEMY_DEFS[e.type].maxHp));
      const raw = m.damage * hpScale * (1 - e.heroDamageReduction);
      const damage = Math.max(1, Math.round(raw - armor));
      h.hp = Math.max(0, h.hp - damage);
      h.sinceHurt = 0;
      h.hitFlashTimer = 0.12;
      const killedHero = h.hp <= 0;

      if (killedHero) {
        h.hp = 0;
        h.state = 'dead';
        h.respawnTimer = h.stats.respawnSec;
        h.invulnTimer = 0;
        h.rallyBannerTimer = 0;
        h.waypoints.length = 0;
        this.clearHeroBuffs(towers);
        for (let k = 0; k < this.pool.getActiveCount(); k++) {
          const held = this.pool.items[this.pool.getActiveIndex(k)];
          held.heroBlockers = 0;
          held.heroDamageReduction = 0;
        }
        this.releaseCurrentMeleeHolds(false);
      }

      this.events.emit('heroHit', {
        heroId: h.heroId,
        enemyId: e.uid,
        damage,
        hp: Math.ceil(h.hp),
        maxHp: h.maxHp,
        x: h.x,
        z: h.z,
      });
      if (this.abortedStep) return;

      if (killedHero) {
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
      if (this.abortedStep) return;
      const prevTotal = _prevTotalBlocked[i];
      _prevTotalBlocked[i] = 0;
      const e = this.pool.items[_prevHeroBlockedIdx[i]];
      if (
        e.active &&
        e.uid === _prevHeroBlockedUid[i] &&
        prevTotal > 0 &&
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
