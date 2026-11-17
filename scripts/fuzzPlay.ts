import { EventBus } from '../src/core/eventBus.ts';
import { FixedTimestepStepper } from '../src/core/gameLoop.ts';
import { SeededRng } from '../src/core/rng.ts';
import type { EnemyType, GridCoord, SpeedMultiplier, TargetingMode, TowerType } from '../src/core/types.ts';
import { ABILITY_DEFS, ABILITY_IDS } from '../src/data/abilities.ts';
import { BALANCE } from '../src/data/balance.ts';
import { ENEMY_DEFS, ENEMY_TYPES } from '../src/data/enemies.ts';
import { LEVELS, type LevelDef } from '../src/data/levels/index.ts';
import { getTowerTierStats, TOWER_DEFS, TOWER_TYPES } from '../src/data/towers.ts';
import type { TowerEntity } from '../src/sim/entities.ts';
import { buildEndlessWaveDef, type WaveState } from '../src/sim/waveSystem.ts';
import { computeSellRefund, computeStarRating, SimWorld } from '../src/sim/world.ts';

const TARGETING_MODES: readonly TargetingMode[] = ['first', 'last', 'strongest', 'closest'];
const TARGETING_MODE_SET = new Set<TargetingMode>(TARGETING_MODES);
const VALID_WAVE_STATES = new Set<WaveState>([
  'preFirstWave',
  'spawning',
  'clearing',
  'betweenWaves',
  'allSpawned',
  'finished',
]);
const SPEEDS: readonly SpeedMultiplier[] = [1, 2, 3];
const FRAME_DTS: readonly number[] = [1 / 60, 1 / 30, 0.05, 0.1];
const MAX_CHAIN_POINTS = 1 + Math.max(1, ...TOWER_TYPES.map((t) => getTowerTierStats(t, 3).chainCount));
const CHEAPEST_TOWER_COST = Math.min(...TOWER_TYPES.map((t) => getTowerTierStats(t, 1).upgradeCost));
const MAX_SLOW_DURATION = Math.max(
  ABILITY_DEFS.meteor.slowDuration,
  ...TOWER_TYPES.flatMap((t) => TOWER_DEFS[t].tiers.map((st) => st.slowDuration)),
);
const MIN_ENEMY_IMPACT_Y = Math.min(
  ...ENEMY_TYPES.map(
    (t) => (ENEMY_DEFS[t].flying ? BALANCE.flyerHeight : BALANCE.tilePathTopY) + ENEMY_DEFS[t].height * 0.55,
  ),
);
const MAX_GROUND_IMPACT_Y =
  BALANCE.tilePathTopY +
  Math.max(...ENEMY_TYPES.filter((t) => !ENEMY_DEFS[t].flying).map((t) => ENEMY_DEFS[t].height)) * 0.55;
const MAX_ANY_IMPACT_Y =
  BALANCE.flyerHeight + Math.max(...ENEMY_TYPES.map((t) => ENEMY_DEFS[t].height)) * 0.55;
const MAX_COOLDOWN_BY_TYPE: Record<TowerType, number> = Object.fromEntries(
  TOWER_TYPES.map((type) => [
    type,
    Math.max(
      0.15,
      1 / getTowerTierStats(type, 1).fireRate,
      1 / getTowerTierStats(type, 2).fireRate,
      1 / getTowerTierStats(type, 3).fireRate,
    ),
  ]),
) as Record<TowerType, number>;
const _hashProbe: number[] = [];
const _localHashProbe: number[] = [];
const _pathCheckVec = { x: 0, y: 0, z: 0 };
const _hashSeen = new Set<number>();
const _seenEnemyUids = new Set<number>();
const _seenTowerIds = new Set<number>();
const _seenTowerCoords = new Set<number>();
const _seenEventTowerIds = new Set<number>();
const _seenChainEnemyUids = new Set<number>();
const _expectedPreviewCounts = new Map<EnemyType, number>();
const _seenPreviewTypes = new Set<EnemyType>();
const _freeTiles: ScoredTile[] = [];
const _affordableTypes: TowerType[] = [];
const _aaAffordableTypes: TowerType[] = [];
const _upgradableTowers: TowerEntity[] = [];
const _towerTypeCounts = new Map<TowerType, number>();
const _bossesBelowHalfScratch = new Set<number>();

export type FuzzProfile = 'tactical' | 'competent' | 'balanced' | 'chaotic' | 'minimal';
export const FUZZ_PROFILES: readonly FuzzProfile[] = ['tactical', 'competent', 'balanced', 'chaotic', 'minimal'];

export interface FuzzPlayOptions {
  /** Number of endless waves to survive/play if story mode is won (0 = stop at story end). */
  readonly endlessWaves?: number;
  readonly maxStoryTicks?: number;
  readonly maxEndlessTicks?: number;
  /** Profile override; default rotates deterministically across all profiles from seed. */
  readonly profile?: FuzzProfile;
}

export interface FuzzStateDigest {
  readonly levelId: string;
  readonly seed: number;
  readonly profile: FuzzProfile;
  readonly storyOutcome: 'won' | 'lost' | 'timeout';
  readonly finalOutcome: 'ongoing' | 'won' | 'lost';
  readonly gold: number;
  readonly lives: number;
  readonly currentWaveOneBased: number;
  readonly waveState: string;
  readonly ticks: number;
  readonly spawnedCount: number;
  readonly killedCount: number;
  readonly leakedCount: number;
  readonly activeEnemiesAtEnd: number;
  readonly towerCount: number;
  readonly totalDamageDealtSum: number;
  readonly peakEnemies: number;
  readonly peakProjectiles: number;
  readonly enemyPoolOverflows: number;
  readonly projectilePoolOverflows: number;
  readonly endlessWavesCompleted: number;
  readonly stateHash: number;
}

export interface FuzzCoverageStats {
  readonly towerTypesBuilt: readonly TowerType[];
  readonly maxTierReached: number;
  readonly towersSold: number;
  readonly meteorCasts: number;
  readonly overchargeCasts: number;
  readonly targetingModesUsed: readonly TargetingMode[];
  readonly enemyTypesSpawned: readonly EnemyType[];
  readonly enemyTypesKilled: readonly EnemyType[];
  readonly splitterSplits: number;
  readonly healerPulses: number;
  readonly bossPulses: number;
  readonly bossSummons: number;
  readonly cleansedTowers: number;
}

export interface FuzzRunResult {
  readonly ok: boolean;
  readonly failure?: string;
  readonly failureDetail?: {
    readonly levelId: string;
    readonly levelIndex: number;
    readonly seed: number;
    readonly tick: number;
    readonly waveOneBased: number;
    readonly reason: string;
    readonly reproCmd: string;
  };
  readonly digest: FuzzStateDigest;
  readonly coverage?: FuzzCoverageStats;
}

interface ScoredTile {
  readonly col: number;
  readonly row: number;
  readonly groundCoverage: number;
  readonly mortarCoverage: number;
  readonly flightCoverage: number;
}

interface FuzzTracker {
  spawnedCount: number;
  killedCount: number;
  leakedCount: number;
  gameWonCount: number;
  gameLostCount: number;
  endlessEnteredCount: number;
  lastWinStars: number;
  lastLossEndless: boolean | undefined;
  enemyPoolOverflows: number;
  projectilePoolOverflows: number;
  peakEnemies: number;
  peakProjectiles: number;
  seenSpawnUids: Set<number>;
  spawnedTypes: Map<number, EnemyType>;
  killedUids: Set<number>;
  killedSplitterUids: Set<number>;
  pendingDeathUids: Set<number>;
  builtTowerIds: Set<number>;
  towerById: Map<number, TowerEntity>;
  everBuiltTowerIds: Set<number>;
  maxEverTowerId: number;
  builtTowerTypes: Set<TowerType>;
  usedTargetingModes: Set<TargetingMode>;
  spawnedEnemyTypes: Set<EnemyType>;
  killedEnemyTypes: Set<EnemyType>;
  maxTierReached: number;
  soldTowerCount: number;
  meteorCastCount: number;
  overchargeCastCount: number;
  splitterSplitCount: number;
  healerPulseCount: number;
  bossPulseCount: number;
  bossSummonCount: number;
  cleansedTowerCount: number;
  endlessWaveCompletedCount: number;
  expectedGold: number;
  expectedLives: number;
  pendingExpectedWaveBonus: number;
  soldTowerKills: number;
  soldTowerDamage: number;
  totalEnemyHitDamage: number;
  expectedNextWaveIndex: number;
  lastWaveHpScale: number;
  endlessWavesConfig: number;
  pendingSplitChildrenExpected: number;
  newlyStunnedTowerIds: Set<number>;
  bossSummonedUids: Set<number>;
  bossesBelowHalfLastTick: Set<number>;
  prevTowerStats: Map<
    number,
    {
      kills: number;
      dmg: number;
      cooldownTimer: number;
      stunTimer: number;
      tier: 1 | 2 | 3;
      totalInvested: number;
      recoil: number;
    }
  >;
  stateHash: number;
  eventInvariantError: string | null;
}

function mixHash(hash: number, value: number): number {
  return Math.imul(hash ^ (value | 0), 16777619) >>> 0;
}

function mixStringHash(hash: number, text: string): number {
  let h = hash;
  for (let i = 0; i < text.length; i++) {
    h = mixHash(h, text.charCodeAt(i));
  }
  return h;
}

function buildScoredGrassTiles(world: SimWorld): ScoredTile[] {
  const groundSamples: Array<{ x: number; z: number }> = [];
  const flightSamples: Array<{ x: number; z: number }> = [];
  const v = { x: 0, y: 0, z: 0 };

  for (let d = 0; d <= world.groundPath.totalLength; d += 1.0) {
    world.groundPath.sample(d, v);
    groundSamples.push({ x: v.x, z: v.z });
  }
  for (let d = 0; d <= world.flightPath.totalLength; d += 1.0) {
    world.flightPath.sample(d, v);
    flightSamples.push({ x: v.x, z: v.z });
  }

  const tiles: ScoredTile[] = [];
  const sampleR = 5.6;
  const sampleRSq = sampleR * sampleR;
  const mortarStats = getTowerTierStats('mortar', 1);
  const mortarMinSq = mortarStats.minRange * mortarStats.minRange;
  const mortarMaxSq = mortarStats.range * mortarStats.range;

  for (let row = 0; row < world.grid.rows; row++) {
    for (let col = 0; col < world.grid.cols; col++) {
      if (world.grid.getTile(col, row) !== 'grass') continue;
      const wx = world.grid.gridToWorldX(col);
      const wz = world.grid.gridToWorldZ(row);
      let gCov = 0;
      let mCov = 0;
      for (let i = 0; i < groundSamples.length; i++) {
        const dx = groundSamples[i].x - wx;
        const dz = groundSamples[i].z - wz;
        const dSq = dx * dx + dz * dz;
        if (dSq <= sampleRSq) gCov++;
        if (dSq >= mortarMinSq && dSq <= mortarMaxSq) mCov++;
      }
      let fCov = 0;
      for (let i = 0; i < flightSamples.length; i++) {
        const dx = flightSamples[i].x - wx;
        const dz = flightSamples[i].z - wz;
        if (dx * dx + dz * dz <= sampleRSq) fCov++;
      }
      tiles.push({ col, row, groundCoverage: gCov, mortarCoverage: mCov, flightCoverage: fCov });
    }
  }
  return tiles;
}

function instrumentPools(world: SimWorld, tracker: FuzzTracker): void {
  const origEnemyAcquire = world.enemyPool.acquire.bind(world.enemyPool);
  world.enemyPool.acquire = () => {
    const res = origEnemyAcquire();
    if (res === null) tracker.enemyPoolOverflows++;
    return res;
  };

  const origProjAcquire = world.projectilePool.acquire.bind(world.projectilePool);
  world.projectilePool.acquire = () => {
    const res = origProjAcquire();
    if (res === null) tracker.projectilePoolOverflows++;
    return res;
  };
}

function recordEventError(tracker: FuzzTracker, msg: string): void {
  if (!tracker.eventInvariantError) {
    tracker.eventInvariantError = msg;
  }
}

function attachEventTracker(
  world: SimWorld,
  events: EventBus,
  tracker: FuzzTracker,
  inEndless: () => boolean,
): void {
  events.on('enemySpawned', (ev) => {
    if (ev.enemyId <= 0 || tracker.seenSpawnUids.has(ev.enemyId)) {
      recordEventError(tracker, `Duplicate or invalid enemySpawned uid: ${ev.enemyId}`);
      return;
    }
    if (ev.enemyId !== tracker.spawnedCount + 1) {
      recordEventError(
        tracker,
        `Non-sequential enemySpawned uid: expected ${tracker.spawnedCount + 1}, got ${ev.enemyId}`,
      );
      return;
    }
    if (ev.flying !== ENEMY_DEFS[ev.enemyType].flying) {
      recordEventError(tracker, `enemySpawned flying=${ev.flying} mismatch for type=${ev.enemyType}`);
      return;
    }
    if (tracker.pendingSplitChildrenExpected > 0) {
      if (ev.enemyType !== 'runner' || ev.flying) {
        recordEventError(
          tracker,
          `Expected split child runner spawn, got type=${ev.enemyType} flying=${ev.flying}`,
        );
        return;
      }
      tracker.pendingSplitChildrenExpected--;
    }
    tracker.seenSpawnUids.add(ev.enemyId);
    tracker.spawnedTypes.set(ev.enemyId, ev.enemyType);
    tracker.spawnedEnemyTypes.add(ev.enemyType);
    tracker.spawnedCount++;
    tracker.stateHash = mixStringHash(mixHash(mixHash(tracker.stateHash, 1), ev.enemyId), ev.enemyType);
  });

  events.on('enemyKilled', (ev) => {
    if (!tracker.seenSpawnUids.has(ev.enemyId)) {
      recordEventError(tracker, `enemyKilled for unknown uid: ${ev.enemyId}`);
      return;
    }
    if (tracker.spawnedTypes.get(ev.enemyId) !== ev.enemyType) {
      recordEventError(
        tracker,
        `enemyKilled type mismatch for uid=${ev.enemyId}: expected ${tracker.spawnedTypes.get(ev.enemyId)}, got ${ev.enemyType}`,
      );
      return;
    }
    if (tracker.killedUids.has(ev.enemyId)) {
      recordEventError(tracker, `enemyKilled fired twice for uid: ${ev.enemyId}`);
      return;
    }
    const killedDef = ENEMY_DEFS[ev.enemyType];
    const expectedKillY = (killedDef.flying ? BALANCE.flyerHeight : BALANCE.tilePathTopY) + killedDef.height * 0.6;
    if (
      !Number.isFinite(ev.x) ||
      !Number.isFinite(ev.y) ||
      !Number.isFinite(ev.z) ||
      Math.abs(ev.y - expectedKillY) > 1e-5
    ) {
      recordEventError(
        tracker,
        `Invalid enemyKilled coordinates/y=${ev.y} (expected=${expectedKillY}) for uid=${ev.enemyId}`,
      );
      return;
    }
    const maxAllowedReward = Math.max(ENEMY_DEFS[ev.enemyType].reward, 2);
    if (!Number.isInteger(ev.reward) || ev.reward < 1 || ev.reward > maxAllowedReward) {
      recordEventError(
        tracker,
        `Invalid enemyKilled reward=${ev.reward} for ${ev.enemyType} uid=${ev.enemyId} (expected 1..${maxAllowedReward})`,
      );
      return;
    }
    tracker.killedUids.add(ev.enemyId);
    tracker.killedEnemyTypes.add(ev.enemyType);
    if (ev.enemyType === 'splitter') {
      tracker.killedSplitterUids.add(ev.enemyId);
    }
    tracker.killedCount++;
    tracker.expectedGold += ev.reward;
    if (world.gold !== tracker.expectedGold || world.enemiesKilledTotal !== tracker.killedCount) {
      recordEventError(
        tracker,
        `enemyKilled live counter mismatch: gold=${world.gold}/${tracker.expectedGold}, kills=${world.enemiesKilledTotal}/${tracker.killedCount}`,
      );
      return;
    }
    tracker.stateHash = mixHash(mixHash(mixHash(tracker.stateHash, 2), ev.enemyId), ev.reward);
  });

  events.on('enemyLeaked', (ev) => {
    const def = ENEMY_DEFS[ev.enemyType];
    const expectedCost = def.livesCost;
    const expectedLaneY = def.flying ? BALANCE.flyerHeight : BALANCE.tilePathTopY;
    if (ev.livesLost !== expectedCost || ev.livesLost < 1) {
      recordEventError(
        tracker,
        `enemyLeaked livesLost=${ev.livesLost} != ENEMY_DEFS[${ev.enemyType}].livesCost=${expectedCost}`,
      );
    }
    if (
      !Number.isFinite(ev.x) ||
      !Number.isFinite(ev.y) ||
      !Number.isFinite(ev.z) ||
      Math.abs(ev.y - expectedLaneY) > 1e-5
    ) {
      recordEventError(tracker, `Invalid enemyLeaked coordinates/laneY=${ev.y} for ${ev.enemyType}`);
    }
    tracker.leakedCount++;
    tracker.expectedLives = Math.max(0, tracker.expectedLives - ev.livesLost);
    if (world.lives !== tracker.expectedLives) {
      recordEventError(tracker, `enemyLeaked live lives mismatch: world=${world.lives}, expected=${tracker.expectedLives}`);
    }
    tracker.stateHash = mixStringHash(mixHash(mixHash(tracker.stateHash, 3), ev.livesLost), ev.enemyType);
  });

  events.on('enemySplit', (ev) => {
    if (ev.count !== 2) {
      recordEventError(tracker, `enemySplit count=${ev.count} != 2 for parentUid=${ev.parentUid}`);
    }
    if (tracker.spawnedTypes.get(ev.parentUid) !== 'splitter') {
      recordEventError(
        tracker,
        `enemySplit parentUid=${ev.parentUid} was spawned as ${tracker.spawnedTypes.get(ev.parentUid)}, not splitter`,
      );
    }
    if (!tracker.killedSplitterUids.has(ev.parentUid)) {
      recordEventError(tracker, `enemySplit fired before splitter enemyKilled for parentUid=${ev.parentUid}`);
    }
    const expectedSplitY = (ENEMY_DEFS.splitter.flying ? BALANCE.flyerHeight : BALANCE.tilePathTopY) + 0.4;
    if (
      !Number.isFinite(ev.x) ||
      !Number.isFinite(ev.y) ||
      !Number.isFinite(ev.z) ||
      Math.abs(ev.y - expectedSplitY) > 1e-5
    ) {
      recordEventError(
        tracker,
        `Invalid enemySplit coordinates/y=${ev.y} (expected=${expectedSplitY}) for parentUid=${ev.parentUid}`,
      );
    }
    tracker.pendingSplitChildrenExpected += ev.count;
    tracker.splitterSplitCount++;
    tracker.stateHash = mixHash(mixHash(tracker.stateHash, 4), ev.parentUid);
  });

  events.on('bossPulse', (ev) => {
    if (ev.stunnedTowerIds.length < 1 || ev.stunnedTowerIds.length > 2) {
      recordEventError(tracker, `bossPulse stunned ${ev.stunnedTowerIds.length} towers (expected 1..2)`);
    }
    if (!Number.isFinite(ev.x) || !Number.isFinite(ev.y) || !Number.isFinite(ev.z) || ev.radius <= 0) {
      recordEventError(tracker, `Invalid bossPulse coordinates/radius`);
    }
    world.spatialHash.query(ev.x, ev.z, 0.05, _localHashProbe);
    let hasBossAtSource = false;
    for (let i = 0; i < _localHashProbe.length; i++) {
      const e = world.enemyPool.items[_localHashProbe[i]];
      if (
        e.active &&
        e.type === 'boss' &&
        Math.hypot(e.x - ev.x, e.z - ev.z) <= 1e-5 &&
        Math.abs(ev.y - (e.y + 0.45)) <= 1e-6
      ) {
        hasBossAtSource = true;
        break;
      }
    }
    if (!hasBossAtSource) {
      recordEventError(tracker, `bossPulse emitted without active boss at (${ev.x},${ev.y},${ev.z})`);
    }
    _seenEventTowerIds.clear();
    let maxStunnedDist = -1;
    let maxStunnedDistId = -1;
    for (let i = 0; i < ev.stunnedTowerIds.length; i++) {
      const tid = ev.stunnedTowerIds[i];
      if (_seenEventTowerIds.has(tid)) {
        recordEventError(tracker, `Duplicate stunnedTowerId=${tid} in bossPulse`);
        break;
      }
      _seenEventTowerIds.add(tid);
      tracker.newlyStunnedTowerIds.add(tid);
      const t = tracker.towerById.get(tid);
      if (!t || Math.abs(t.stunTimer - 2.65) > 1e-6) {
        recordEventError(tracker, `bossPulse stunnedTowerId=${tid} not stunned at 2.65s`);
        break;
      }
      const dist = Math.hypot(t.x - ev.x, t.z - ev.z);
      if (dist > ev.radius + 1e-6) {
        recordEventError(tracker, `bossPulse stunnedTowerId=${tid} outside pulse radius ${ev.radius}`);
        break;
      }
      if (dist > maxStunnedDist || (dist === maxStunnedDist && tid > maxStunnedDistId)) {
        maxStunnedDist = dist;
        maxStunnedDistId = tid;
      }
    }
    if (!tracker.eventInvariantError) {
      for (let i = 0; i < world.towers.length; i++) {
        const o = world.towers[i];
        if (o.stunTimer !== 0) continue;
        const oDist = Math.hypot(o.x - ev.x, o.z - ev.z);
        if (oDist <= ev.radius) {
          if (
            ev.stunnedTowerIds.length < 2 ||
            oDist < maxStunnedDist ||
            (oDist === maxStunnedDist && o.id < maxStunnedDistId)
          ) {
            recordEventError(
              tracker,
              `bossPulse skipped closer/higher-priority unstunned tower id=${o.id} (dist=${oDist}) vs stunned max=${maxStunnedDist} id=${maxStunnedDistId}`,
            );
            break;
          }
        }
      }
    }
    tracker.bossPulseCount++;
    tracker.stateHash = mixHash(mixHash(tracker.stateHash, 5), ev.stunnedTowerIds.length);
  });

  events.on('bossSummon', (ev) => {
    if (ev.count < 1 || ev.count > 2) {
      recordEventError(tracker, `bossSummon count=${ev.count} out of 1..2`);
    }
    if (!Number.isFinite(ev.x) || !Number.isFinite(ev.y) || !Number.isFinite(ev.z)) {
      recordEventError(tracker, `Non-finite bossSummon coordinates`);
    }
    world.spatialHash.query(ev.x, ev.z, 0.05, _localHashProbe);
    let hasBossAtSource = false;
    for (let i = 0; i < _localHashProbe.length; i++) {
      const e = world.enemyPool.items[_localHashProbe[i]];
      if (
        e.active &&
        e.type === 'boss' &&
        e.bossSummonedEscorts &&
        e.hp <= e.maxHp * 0.5 &&
        Math.hypot(e.x - ev.x, e.z - ev.z) <= 1e-5 &&
        Math.abs(ev.y - (e.y + 0.8)) <= 1e-6
      ) {
        hasBossAtSource = true;
        break;
      }
    }
    if (!hasBossAtSource) {
      recordEventError(tracker, `bossSummon emitted without eligible active boss at (${ev.x},${ev.y},${ev.z})`);
    }
    tracker.bossSummonCount++;
    tracker.stateHash = mixHash(mixHash(tracker.stateHash, 6), ev.count);
  });

  events.on('enemyHit', (ev) => {
    if (!tracker.seenSpawnUids.has(ev.enemyId) || tracker.killedUids.has(ev.enemyId)) {
      recordEventError(tracker, `enemyHit for unknown or already-killed uid=${ev.enemyId}`);
      return;
    }
    if (tracker.spawnedTypes.get(ev.enemyId) !== ev.enemyType) {
      recordEventError(
        tracker,
        `enemyHit type mismatch for uid=${ev.enemyId}: expected ${tracker.spawnedTypes.get(ev.enemyId)}, got ${ev.enemyType}`,
      );
      return;
    }
    if (!Number.isInteger(ev.damage) || ev.damage < 1) {
      recordEventError(tracker, `Invalid enemyHit damage=${ev.damage} for uid=${ev.enemyId}`);
      return;
    }
    if (ev.isBoss !== (ev.enemyType === 'boss')) {
      recordEventError(tracker, `enemyHit isBoss=${ev.isBoss} mismatch for type=${ev.enemyType}`);
      return;
    }
    if (!Number.isFinite(ev.x) || !Number.isFinite(ev.y) || !Number.isFinite(ev.z)) {
      recordEventError(tracker, `Non-finite enemyHit coordinates for uid=${ev.enemyId}`);
      return;
    }
    world.spatialHash.query(ev.x, ev.z, 0.05, _localHashProbe);
    let matchedTarget = false;
    for (let i = 0; i < _localHashProbe.length; i++) {
      const e = world.enemyPool.items[_localHashProbe[i]];
      if (
        e.active &&
        e.uid === ev.enemyId &&
        Math.hypot(e.x - ev.x, e.z - ev.z) <= 1e-5 &&
        Math.abs(ev.y - (e.y + e.height * 0.9)) <= 1e-5 &&
        e.hitFlashTimer === 0.12 &&
        e.hp + ev.damage <= e.maxHp
      ) {
        matchedTarget = true;
        break;
      }
    }
    if (!matchedTarget) {
      recordEventError(tracker, `enemyHit uid=${ev.enemyId} failed spatialHash/entity state parity`);
      return;
    }
    tracker.totalEnemyHitDamage += ev.damage;
  });

  events.on('healerPulse', (ev) => {
    const expectedRadius = ENEMY_DEFS.healer.healRadius ?? 3.8;
    const expectedHealerY = (ENEMY_DEFS.healer.flying ? BALANCE.flyerHeight : BALANCE.tilePathTopY) + 0.12;
    if (
      !Number.isFinite(ev.x) ||
      !Number.isFinite(ev.y) ||
      !Number.isFinite(ev.z) ||
      Math.abs(ev.radius - expectedRadius) > 1e-6 ||
      Math.abs(ev.y - expectedHealerY) > 1e-6
    ) {
      recordEventError(tracker, `Invalid healerPulse payload`);
      return;
    }
    world.spatialHash.query(ev.x, ev.z, 0.05, _localHashProbe);
    let hasHealerAtSource = false;
    for (let i = 0; i < _localHashProbe.length; i++) {
      const e = world.enemyPool.items[_localHashProbe[i]];
      if (e.active && e.type === 'healer' && Math.hypot(e.x - ev.x, e.z - ev.z) <= 1e-5) {
        hasHealerAtSource = true;
        break;
      }
    }
    if (!hasHealerAtSource) {
      recordEventError(tracker, `healerPulse emitted without active healer at (${ev.x},${ev.z})`);
      return;
    }
    world.spatialHash.query(ev.x, ev.z, ev.radius, _localHashProbe);
    let hasHealedTargetInRadius = false;
    for (let i = 0; i < _localHashProbe.length; i++) {
      const ally = world.enemyPool.items[_localHashProbe[i]];
      if (
        ally.active &&
        ally.hp > 0 &&
        Math.hypot(ally.x - ev.x, ally.z - ev.z) <= ev.radius + 1e-5
      ) {
        hasHealedTargetInRadius = true;
        break;
      }
    }
    if (!hasHealedTargetInRadius) {
      recordEventError(tracker, `healerPulse emitted with no active target inside radius ${ev.radius}`);
    } else {
      tracker.healerPulseCount++;
    }
  });

  events.on('towerBuilt', (ev) => {
    const liveBuilt = world.getTowerById(ev.towerId);
    if (
      ev.towerId <= 0 ||
      tracker.builtTowerIds.has(ev.towerId) ||
      !TOWER_DEFS[ev.type] ||
      ev.tier !== 1 ||
      !liveBuilt ||
      liveBuilt.type !== ev.type ||
      liveBuilt.tier !== ev.tier ||
      Math.hypot(liveBuilt.x - ev.x, liveBuilt.z - ev.z) > 1e-6
    ) {
      recordEventError(tracker, `Invalid towerBuilt payload id=${ev.towerId} type=${ev.type} tier=${ev.tier}`);
      return;
    }
    if (!Number.isFinite(ev.x) || !Number.isFinite(ev.z)) {
      recordEventError(tracker, `Non-finite towerBuilt coordinates for id=${ev.towerId}`);
      return;
    }
    const tier1Cost = getTowerTierStats(ev.type, 1).upgradeCost;
    if (
      liveBuilt.popAnimTimer !== 0.32 ||
      liveBuilt.cooldownTimer !== 0.15 ||
      liveBuilt.totalInvested !== tier1Cost
    ) {
      recordEventError(tracker, `towerBuilt live state mismatch for id=${ev.towerId}`);
      return;
    }
    tracker.builtTowerIds.add(ev.towerId);
    tracker.towerById.set(ev.towerId, liveBuilt);
    tracker.everBuiltTowerIds.add(ev.towerId);
    if (ev.towerId > tracker.maxEverTowerId) {
      tracker.maxEverTowerId = ev.towerId;
    }
    tracker.builtTowerTypes.add(ev.type);
    tracker.maxTierReached = Math.max(tracker.maxTierReached, ev.tier);
    tracker.stateHash = mixStringHash(mixHash(mixHash(tracker.stateHash, 12), ev.towerId), ev.type);
  });

  events.on('towerUpgraded', (ev) => {
    const liveUpgraded = world.getTowerById(ev.towerId);
    if (
      !tracker.builtTowerIds.has(ev.towerId) ||
      (ev.tier !== 2 && ev.tier !== 3) ||
      !TOWER_DEFS[ev.type] ||
      !liveUpgraded ||
      liveUpgraded.type !== ev.type ||
      liveUpgraded.tier !== ev.tier ||
      Math.hypot(liveUpgraded.x - ev.x, liveUpgraded.z - ev.z) > 1e-6
    ) {
      recordEventError(tracker, `Invalid towerUpgraded payload id=${ev.towerId} tier=${ev.tier}`);
      return;
    }
    if (!Number.isFinite(ev.x) || !Number.isFinite(ev.z)) {
      recordEventError(tracker, `Non-finite towerUpgraded coordinates for id=${ev.towerId}`);
      return;
    }
    if (
      liveUpgraded.popAnimTimer !== 0.32 ||
      liveUpgraded.totalInvested !== expectedTowerInvestment(ev.type, ev.tier)
    ) {
      recordEventError(tracker, `towerUpgraded live state mismatch for id=${ev.towerId} tier=${ev.tier}`);
      return;
    }
    tracker.maxTierReached = Math.max(tracker.maxTierReached, ev.tier);
    tracker.stateHash = mixHash(mixHash(mixHash(tracker.stateHash, 13), ev.towerId), ev.tier);
  });

  events.on('towerSold', (ev) => {
    const soldTower = tracker.towerById.get(ev.towerId);
    if (
      !soldTower ||
      !tracker.builtTowerIds.has(ev.towerId) ||
      ev.type !== soldTower.type ||
      !Number.isInteger(ev.refund) ||
      ev.refund <= 0 ||
      ev.refund !== computeSellRefund(soldTower.totalInvested) ||
      world.getTowerById(ev.towerId) !== null
    ) {
      recordEventError(tracker, `Invalid towerSold payload id=${ev.towerId} refund=${ev.refund}`);
      return;
    }
    if (!Number.isFinite(ev.x) || !Number.isFinite(ev.z)) {
      recordEventError(tracker, `Non-finite towerSold coordinates for id=${ev.towerId}`);
      return;
    }
    const soldCoord = world.grid.worldToGrid(ev.x, ev.z);
    if (
      !soldCoord ||
      soldCoord.col !== soldTower.col ||
      soldCoord.row !== soldTower.row ||
      world.grid.getTowerIdAt(soldCoord.col, soldCoord.row) !== -1
    ) {
      recordEventError(tracker, `towerSold grid tile not cleared for id=${ev.towerId}`);
      return;
    }
    tracker.builtTowerIds.delete(ev.towerId);
    tracker.towerById.delete(ev.towerId);
    tracker.soldTowerCount++;
    tracker.stateHash = mixHash(mixHash(mixHash(tracker.stateHash, 14), ev.towerId), ev.refund);
  });

  events.on('towerFired', (ev) => {
    const tower = tracker.towerById.get(ev.towerId);
    if (!tower || !tracker.builtTowerIds.has(ev.towerId) || tower.stunTimer > 0) {
      recordEventError(tracker, `Invalid or stunned towerFired for id=${ev.towerId}`);
      return;
    }
    if (
      ev.type !== tower.type ||
      ev.tier !== tower.tier ||
      ev.x !== tower.x ||
      ev.z !== tower.z ||
      Math.abs(ev.y - (TOWER_DEFS[ev.type].turretHeight + 0.15)) > 1e-6 ||
      tower.recoil !== 1 ||
      Math.abs(tower.cooldownTimer - 1 / getTowerTierStats(ev.type, ev.tier).fireRate) > 1e-6 ||
      !Number.isFinite(ev.yaw) ||
      ev.yaw !== tower.yaw
    ) {
      recordEventError(tracker, `towerFired payload/state mismatch for id=${ev.towerId}`);
    }
  });

  events.on('projectileImpact', (ev) => {
    const towerDef = TOWER_DEFS[ev.towerType];
    if (!towerDef || ev.towerType === 'tesla') {
      recordEventError(tracker, `Invalid projectileImpact towerType=${ev.towerType}`);
      return;
    }
    const validRadius = towerDef.tiers.some((st) => st.splashRadius === ev.radius);
    const maxImpactY = towerDef.hitsFlyers ? MAX_ANY_IMPACT_Y : MAX_GROUND_IMPACT_Y;
    if (
      !Number.isFinite(ev.x) ||
      !Number.isFinite(ev.y) ||
      !Number.isFinite(ev.z) ||
      !Number.isFinite(ev.radius) ||
      ev.radius < 0 ||
      ev.y < BALANCE.tilePathTopY - 1e-5 ||
      ev.y > maxImpactY + 1e-4 ||
      !validRadius
    ) {
      recordEventError(tracker, `Invalid projectileImpact coordinates/radius for ${ev.towerType}: y=${ev.y}, r=${ev.radius}`);
      return;
    }
    const probeR = Math.max(ev.radius, 0.05);
    world.spatialHash.query(ev.x, ev.z, probeR, _localHashProbe);
    if (ev.isBossHit) {
      let matchedBoss = false;
      for (let i = 0; i < _localHashProbe.length; i++) {
        const e = world.enemyPool.items[_localHashProbe[i]];
        if (
          e.active &&
          e.type === 'boss' &&
          e.hitFlashTimer === 0.12 &&
          Math.hypot(e.x - ev.x, e.z - ev.z) <= probeR + 1e-4
        ) {
          matchedBoss = true;
          break;
        }
      }
      if (!matchedBoss) {
        recordEventError(tracker, `projectileImpact isBossHit=true without freshly-hit boss near (${ev.x},${ev.z})`);
      }
    } else if (ev.radius > 0 && (!ENEMY_DEFS.boss.flying || towerDef.hitsFlyers)) {
      for (let i = 0; i < _localHashProbe.length; i++) {
        const e = world.enemyPool.items[_localHashProbe[i]];
        if (
          e.active &&
          e.type === 'boss' &&
          e.hp > 0 &&
          Math.hypot(e.x - ev.x, e.z - ev.z) <= ev.radius - 1e-5
        ) {
          recordEventError(tracker, `projectileImpact isBossHit=false despite live boss inside radius ${ev.radius}`);
          break;
        }
      }
    }
  });

  events.on('lightningChain', (ev) => {
    if (ev.points.length < 2 || ev.points.length > MAX_CHAIN_POINTS) {
      recordEventError(tracker, `Invalid lightningChain points length=${ev.points.length}`);
      return;
    }
    for (let i = 0; i < ev.points.length; i++) {
      const pt = ev.points[i];
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y) || !Number.isFinite(pt.z)) {
        recordEventError(tracker, `Non-finite lightningChain point at index ${i}`);
        return;
      }
    }
    const origin = ev.points[0];
    let sourceTesla: TowerEntity | undefined;
    const expectedOriginY = TOWER_DEFS.tesla.turretHeight + 0.35;
    for (let i = 0; i < world.towers.length; i++) {
      const t = world.towers[i];
      if (
        t.type === 'tesla' &&
        t.x === origin.x &&
        t.z === origin.z &&
        Math.abs(origin.y - expectedOriginY) <= 1e-6
      ) {
        sourceTesla = t;
        break;
      }
    }
    if (!sourceTesla) {
      recordEventError(tracker, `lightningChain origin (${origin.x},${origin.y},${origin.z}) matches no live tesla tower`);
      return;
    }
    const stats = getTowerTierStats('tesla', sourceTesla.tier);
    if (
      sourceTesla.stunTimer > 0 ||
      sourceTesla.recoil !== 1 ||
      Math.abs(sourceTesla.cooldownTimer - 1 / stats.fireRate) > 1e-6
    ) {
      recordEventError(tracker, `lightningChain source tesla id=${sourceTesla.id} firing state mismatch`);
      return;
    }
    if (ev.points.length > 1 + Math.max(1, stats.chainCount)) {
      recordEventError(tracker, `lightningChain length ${ev.points.length} exceeded tier ${sourceTesla.tier} limit`);
      return;
    }
    if (Math.hypot(ev.points[1].x - origin.x, ev.points[1].z - origin.z) > stats.range + 1e-4) {
      recordEventError(tracker, `lightningChain first target exceeded tesla range ${stats.range}`);
      return;
    }
    for (let i = 1; i < ev.points.length - 1; i++) {
      const hop = Math.hypot(ev.points[i + 1].x - ev.points[i].x, ev.points[i + 1].z - ev.points[i].z);
      if (hop > stats.chainRange + 1e-4) {
        recordEventError(tracker, `lightningChain hop ${i} dist=${hop} exceeded chainRange=${stats.chainRange}`);
        return;
      }
    }
    _seenChainEnemyUids.clear();
    for (let i = 1; i < ev.points.length; i++) {
      const pt = ev.points[i];
      world.spatialHash.query(pt.x, pt.z, 0.05, _localHashProbe);
      let matchedUid = -1;
      for (let j = 0; j < _localHashProbe.length; j++) {
        const e = world.enemyPool.items[_localHashProbe[j]];
        if (
          e.active &&
          !_seenChainEnemyUids.has(e.uid) &&
          Math.hypot(e.x - pt.x, e.z - pt.z) <= 1e-5 &&
          Math.abs(pt.y - (e.y + e.height * 0.55)) <= 1e-5
        ) {
          matchedUid = e.uid;
          break;
        }
      }
      if (matchedUid === -1) {
        recordEventError(
          tracker,
          `lightningChain target point[${i}] (${pt.x},${pt.y},${pt.z}) matched no unhit active enemy`,
        );
        return;
      }
      _seenChainEnemyUids.add(matchedUid);
    }
    tracker.stateHash = mixHash(mixHash(tracker.stateHash, 15), ev.points.length);
  });

  events.on('abilityTargeted', (ev) => {
    const expectedRadius = ABILITY_DEFS.meteor.radius;
    if (
      ev.abilityId !== 'meteor' ||
      !Number.isFinite(ev.x) ||
      !Number.isFinite(ev.z) ||
      Math.abs(ev.radius - expectedRadius) > 1e-6 ||
      world.abilitySystem.canCast('meteor') ||
      Math.abs(world.abilitySystem.getCooldown('meteor') - ABILITY_DEFS.meteor.cooldownSec) > 1e-6
    ) {
      recordEventError(tracker, `Invalid abilityTargeted payload or cooldown for ${ev.abilityId}`);
      return;
    }
    tracker.meteorCastCount++;
  });

  events.on('meteorImpact', (ev) => {
    if (
      !Number.isFinite(ev.x) ||
      !Number.isFinite(ev.y) ||
      !Number.isFinite(ev.z) ||
      ev.y !== 0.25 ||
      Math.abs(ev.radius - ABILITY_DEFS.meteor.radius) > 1e-6
    ) {
      recordEventError(tracker, `Invalid meteorImpact payload y=${ev.y}, r=${ev.radius}`);
      return;
    }
    tracker.stateHash = mixHash(mixHash(tracker.stateHash, 16), Math.round(ev.x * 100));
  });

  events.on('overchargeActivated', (ev) => {
    const def = ABILITY_DEFS.overcharge;
    if (
      !Number.isFinite(ev.duration) ||
      ev.duration <= 0 ||
      Math.abs(ev.duration - def.durationSec) > 1e-6 ||
      !world.abilitySystem.isOverchargeActive() ||
      world.abilitySystem.canCast('overcharge') ||
      Math.abs(world.abilitySystem.getOverchargeRemaining() - ev.duration) > 1e-6 ||
      Math.abs(world.abilitySystem.getCooldown('overcharge') - def.cooldownSec) > 1e-6
    ) {
      recordEventError(tracker, `Invalid overchargeActivated state/duration=${ev.duration}`);
      return;
    }
    _seenEventTowerIds.clear();
    for (let i = 0; i < ev.cleansedTowerIds.length; i++) {
      const tid = ev.cleansedTowerIds[i];
      const cleansedTower = tracker.towerById.get(tid);
      if (
        _seenEventTowerIds.has(tid) ||
        !tracker.builtTowerIds.has(tid) ||
        !cleansedTower ||
        cleansedTower.stunTimer !== 0
      ) {
        recordEventError(tracker, `Invalid, un-cleansed, or duplicate cleansedTowerId=${tid} in overchargeActivated`);
        return;
      }
      _seenEventTowerIds.add(tid);
    }
    tracker.overchargeCastCount++;
    tracker.cleansedTowerCount += ev.cleansedTowerIds.length;
    tracker.stateHash = mixHash(mixHash(tracker.stateHash, 17), ev.cleansedTowerIds.length);
  });

  events.on('economyChanged', (ev) => {
    if (
      !Number.isInteger(ev.gold) ||
      ev.gold < 0 ||
      !Number.isInteger(ev.lives) ||
      ev.lives < 0 ||
      ev.lives > BALANCE.startingLives ||
      ev.gold !== world.gold ||
      ev.lives !== world.lives
    ) {
      recordEventError(
        tracker,
        `economyChanged mismatch/invalid (ev=${ev.gold}g/${ev.lives}L vs world=${world.gold}g/${world.lives}L)`,
      );
    }
  });

  events.on('gameWon', (ev) => {
    if (ev.livesRemaining !== world.lives || ev.stars !== computeStarRating(world.lives)) {
      recordEventError(
        tracker,
        `gameWon payload mismatch: lives=${ev.livesRemaining}/${world.lives}, stars=${ev.stars}/${computeStarRating(world.lives)}`,
      );
    }
    tracker.gameWonCount++;
    tracker.lastWinStars = ev.stars;
    tracker.stateHash = mixHash(mixHash(tracker.stateHash, 9), ev.stars);
  });

  events.on('gameLost', (ev) => {
    if (world.lives !== 0 || ev.waveIndex !== Math.max(0, world.waveSystem.currentWaveIndex)) {
      recordEventError(
        tracker,
        `gameLost payload mismatch: lives=${world.lives}, waveIndex=${ev.waveIndex} vs ${Math.max(0, world.waveSystem.currentWaveIndex)}`,
      );
    }
    tracker.gameLostCount++;
    tracker.lastLossEndless = ev.endless;
    tracker.stateHash = mixHash(mixHash(tracker.stateHash, 10), ev.waveIndex);
  });

  events.on('endlessEntered', (ev) => {
    if (ev.startingWave !== world.level.waves.length + 1) {
      recordEventError(
        tracker,
        `endlessEntered startingWave=${ev.startingWave} != ${world.level.waves.length + 1}`,
      );
    }
    tracker.endlessEnteredCount++;
    tracker.expectedNextWaveIndex = world.level.waves.length;
    tracker.stateHash = mixHash(tracker.stateHash, 11);
  });

  events.on('waveStarted', (ev) => {
    if (ev.waveIndex !== tracker.expectedNextWaveIndex) {
      recordEventError(
        tracker,
        `Unexpected waveStarted index: got ${ev.waveIndex}, expected ${tracker.expectedNextWaveIndex}`,
      );
    }
    const expectedTotalWaves = inEndless()
      ? Math.max(world.level.waves.length, ev.waveIndex + 1)
      : world.level.waves.length;
    if (ev.totalWaves !== expectedTotalWaves) {
      recordEventError(
        tracker,
        `waveStarted totalWaves=${ev.totalWaves} != expected=${expectedTotalWaves} (endless=${inEndless()})`,
      );
    }
    if (!Number.isInteger(ev.earlyBonus) || ev.earlyBonus < 0 || ev.earlyBonus > BALANCE.earlyWaveBonusMaxGold) {
      recordEventError(tracker, `Invalid waveStarted earlyBonus=${ev.earlyBonus}`);
    }
    tracker.expectedNextWaveIndex = ev.waveIndex + 1;
    if (Boolean(ev.endless) !== inEndless()) {
      recordEventError(tracker, `waveStarted endless=${ev.endless} mismatch (expected ${inEndless()})`);
    }
    const hpScale = world.waveSystem.getCurrentWaveHpScale();
    if (!Number.isFinite(hpScale) || hpScale <= 0 || hpScale < tracker.lastWaveHpScale - 1e-9) {
      recordEventError(
        tracker,
        `Invalid or non-monotonic wave HP scale ${hpScale} (prev=${tracker.lastWaveHpScale})`,
      );
    }
    tracker.lastWaveHpScale = hpScale;
    const rewardMult = world.waveSystem.getRewardMultiplier();
    const expectedRewardMult =
      ev.waveIndex < world.level.waves.length
        ? 1
        : Math.max(0.32, 1 / (1 + (ev.waveIndex - world.level.waves.length + 1) * 0.14));
    if (!Number.isFinite(rewardMult) || Math.abs(rewardMult - expectedRewardMult) > 1e-9) {
      recordEventError(tracker, `waveStarted rewardMultiplier=${rewardMult} != expected=${expectedRewardMult}`);
    }
    const waveDef =
      ev.waveIndex < world.level.waves.length
        ? world.level.waves[ev.waveIndex]
        : buildEndlessWaveDef(ev.waveIndex, world.level);
    if (waveDef.groups.length === 0) {
      recordEventError(tracker, `Wave ${ev.waveIndex + 1} has zero spawn groups`);
    }
    tracker.pendingExpectedWaveBonus += waveDef.clearBonus;
    tracker.expectedGold += ev.earlyBonus;
    tracker.stateHash = mixHash(mixHash(mixHash(tracker.stateHash, 7), ev.waveIndex), ev.earlyBonus);
  });

  events.on('waveCompleted', (ev) => {
    if (ev.waveIndex !== tracker.expectedNextWaveIndex - 1) {
      recordEventError(
        tracker,
        `waveCompleted waveIndex=${ev.waveIndex} != expected ${tracker.expectedNextWaveIndex - 1}`,
      );
    }
    if (ev.bonus !== tracker.pendingExpectedWaveBonus) {
      recordEventError(
        tracker,
        `waveCompleted bonus=${ev.bonus} != expected pending wave clear bonus=${tracker.pendingExpectedWaveBonus}`,
      );
    }
    tracker.pendingExpectedWaveBonus = 0;
    tracker.expectedGold += ev.bonus;
    if (world.gold !== tracker.expectedGold) {
      recordEventError(
        tracker,
        `waveCompleted live gold mismatch: world=${world.gold}, expected=${tracker.expectedGold}`,
      );
    }
    if (inEndless()) {
      tracker.endlessWaveCompletedCount++;
    }
    tracker.stateHash = mixHash(mixHash(mixHash(tracker.stateHash, 8), ev.waveIndex), ev.bonus);
  });
}

function expectedTowerInvestment(type: TowerType, tier: 1 | 2 | 3): number {
  let sum = getTowerTierStats(type, 1).upgradeCost;
  if (tier >= 2) sum += getTowerTierStats(type, 2).upgradeCost;
  if (tier >= 3) sum += getTowerTierStats(type, 3).upgradeCost;
  return sum;
}

function expectedWaveHpScale(level: LevelDef, waveIndex: number): number {
  const base = level.enemyHpScale ?? 1;
  const growth = level.waveHpGrowth ?? 0;
  const storyCount = level.waves.length;
  const storyScale = (idx: number): number => {
    const w = Math.max(0, idx);
    const linear = base * (1 + w * growth);
    return w <= 5 ? linear : linear * Math.pow(1.032, w - 5);
  };
  if (waveIndex < storyCount) {
    return storyScale(waveIndex);
  }
  const finalStoryScale = storyScale(Math.max(0, storyCount - 1));
  const offset = waveIndex - storyCount;
  return finalStoryScale * Math.pow(1.22, offset + 1);
}

function expectedWaveRewardMultiplier(level: LevelDef, waveIndex: number): number {
  if (waveIndex < level.waves.length) return 1;
  const step = waveIndex - level.waves.length + 1;
  return Math.max(0.32, 1 / (1 + step * 0.14));
}

function assertTickInvariants(world: SimWorld, tracker: FuzzTracker, tick: number): string | null {
  if (tracker.eventInvariantError) {
    return tracker.eventInvariantError;
  }
  if (!Number.isFinite(world.gold) || !Number.isInteger(world.gold) || world.gold < 0) {
    return `Invalid gold value: ${world.gold}`;
  }
  if (world.gold !== tracker.expectedGold) {
    return `Gold ledger mismatch: world.gold=${world.gold} != expected=${tracker.expectedGold}`;
  }
  if (
    !Number.isFinite(world.lives) ||
    !Number.isInteger(world.lives) ||
    world.lives < 0 ||
    world.lives > BALANCE.startingLives
  ) {
    return `Invalid lives value: ${world.lives}`;
  }
  if (world.lives !== tracker.expectedLives) {
    return `Lives ledger mismatch: world.lives=${world.lives} != expected=${tracker.expectedLives}`;
  }

  const activeEnemies = world.enemyPool.getActiveCount();
  const activeProj = world.projectilePool.getActiveCount();
  if (activeEnemies > tracker.peakEnemies) tracker.peakEnemies = activeEnemies;
  if (activeProj > tracker.peakProjectiles) tracker.peakProjectiles = activeProj;

  if (activeEnemies > BALANCE.pools.maxEnemies) {
    return `Enemy active count ${activeEnemies} exceeded pool capacity ${BALANCE.pools.maxEnemies}`;
  }
  if (activeProj > BALANCE.pools.maxProjectiles) {
    return `Projectile active count ${activeProj} exceeded pool capacity ${BALANCE.pools.maxProjectiles}`;
  }

  const accounted = tracker.killedCount + tracker.leakedCount + activeEnemies;
  if (tracker.spawnedCount !== accounted) {
    return `Enemy conservation violated: spawned=${tracker.spawnedCount} != killed(${tracker.killedCount}) + leaked(${tracker.leakedCount}) + active(${activeEnemies})`;
  }
  if (world.enemiesKilledTotal !== tracker.killedCount) {
    return `world.enemiesKilledTotal (${world.enemiesKilledTotal}) !== killedCount (${tracker.killedCount})`;
  }

  for (const prevDeadUid of tracker.pendingDeathUids) {
    if (!tracker.killedUids.has(prevDeadUid)) {
      return `Pending-death enemy uid=${prevDeadUid} failed to settle into enemyKilled on the following tick`;
    }
  }
  tracker.pendingDeathUids.clear();

  if (tracker.pendingSplitChildrenExpected !== 0) {
    if (tracker.enemyPoolOverflows === 0) {
      return `enemySplit expected ${tracker.pendingSplitChildrenExpected} more split hatchling spawn(s)`;
    }
    tracker.pendingSplitChildrenExpected = 0;
  }

  const groundPath = world.enemySystem.getPath(false);
  const flightPath = world.enemySystem.getPath(true);
  const groundPathLen = Math.max(0.01, groundPath.totalLength);
  const flightPathLen = Math.max(0.01, flightPath.totalLength);

  let pendingDeaths = 0;
  _seenEnemyUids.clear();
  _bossesBelowHalfScratch.clear();
  for (let i = 0; i < activeEnemies; i++) {
    const e = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
    if (!e.active) return `Inactive enemy at active index pos=${i}`;
    if (e.uid <= 0 || e.uid > tracker.spawnedCount || _seenEnemyUids.has(e.uid)) {
      return `Invalid or duplicate active enemy uid=${e.uid} at pos=${i}`;
    }
    _seenEnemyUids.add(e.uid);
    if (tracker.spawnedTypes.get(e.uid) !== e.type) {
      return `Active enemy uid=${e.uid} type mismatch: spawned=${tracker.spawnedTypes.get(e.uid)}, actual=${e.type}`;
    }
    if (e.isSplitChild && (e.type !== 'runner' || e.scaleOverride !== 0.72 || e.reward !== 1)) {
      return `Invalid split child state for uid=${e.uid} (type=${e.type}, scale=${e.scaleOverride}, reward=${e.reward})`;
    }
    if (!e.isSplitChild && e.scaleOverride !== 1) {
      return `Non-split enemy uid=${e.uid} has stale scaleOverride=${e.scaleOverride}`;
    }
    if (e.type !== 'boss' && e.bossSummonedEscorts) {
      return `Non-boss enemy uid=${e.uid} (${e.type}) has stale bossSummonedEscorts=true`;
    }
    if (e.type === 'boss') {
      if (e.bossSummonedEscorts) {
        tracker.bossSummonedUids.add(e.uid);
      } else if (tracker.bossSummonedUids.has(e.uid)) {
        return `Boss uid=${e.uid} reset bossSummonedEscorts from true to false`;
      } else if (world.outcome === 'ongoing' && tracker.bossesBelowHalfLastTick.has(e.uid)) {
        return `Boss uid=${e.uid} remained <= 50% HP across two ticks without triggering bossSummonedEscorts`;
      }
      if (e.hp > 0 && e.hp <= e.maxHp * 0.5) {
        _bossesBelowHalfScratch.add(e.uid);
      }
    }
    const def = ENEMY_DEFS[e.type];
    if (
      e.armor !== def.armor ||
      e.livesCost !== def.livesCost ||
      e.flying !== def.flying ||
      e.radius !== def.radius ||
      e.height !== def.height ||
      !Number.isInteger(e.reward) ||
      e.reward < 1 ||
      e.reward > def.reward
    ) {
      return `Enemy def/reward mismatch for ${e.type} uid=${e.uid} (armor=${e.armor}, livesCost=${e.livesCost}, flying=${e.flying}, reward=${e.reward})`;
    }
    if (
      (e.isSplitChild && Math.abs(e.speed - ENEMY_DEFS.splitter.speed * 1.45) > 1e-6) ||
      (!e.isSplitChild && e.speed !== def.speed)
    ) {
      return `Enemy speed mismatch for ${e.type} uid=${e.uid} (isSplitChild=${e.isSplitChild}, speed=${e.speed})`;
    }
    if ((e.slowTimer === 0) !== (e.slowRatio === 0)) {
      return `Enemy slow state mismatch for uid=${e.uid}: slowTimer=${e.slowTimer}, slowRatio=${e.slowRatio}`;
    }
    if (e.hp === 0) {
      pendingDeaths++;
      tracker.pendingDeathUids.add(e.uid);
    }
    if (
      !Number.isFinite(e.x) ||
      !Number.isFinite(e.y) ||
      !Number.isFinite(e.z) ||
      !Number.isFinite(e.prevX) ||
      !Number.isFinite(e.prevY) ||
      !Number.isFinite(e.prevZ) ||
      !Number.isFinite(e.yaw) ||
      !Number.isFinite(e.prevYaw) ||
      Math.abs(e.x) > world.grid.cols * BALANCE.tileSize ||
      Math.abs(e.z) > world.grid.rows * BALANCE.tileSize
    ) {
      return `Non-finite or out-of-bounds enemy position/yaw for uid=${e.uid} type=${e.type}`;
    }
    if (
      !Number.isInteger(e.hp) ||
      !Number.isInteger(e.maxHp) ||
      e.maxHp <= 0 ||
      e.hp < 0 ||
      e.hp > e.maxHp
    ) {
      return `Invalid enemy HP (${e.hp}/${e.maxHp}) for uid=${e.uid} type=${e.type}`;
    }
    const expectedLaneY = e.flying ? BALANCE.flyerHeight : BALANCE.tilePathTopY;
    if (Math.abs(e.y - expectedLaneY) > 1e-5 || e.y !== e.prevY) {
      return `Invalid enemy lane altitude y=${e.y} (prevY=${e.prevY}, expected ${expectedLaneY}) for ${e.type} uid=${e.uid}`;
    }
    const moveDx = e.x - e.prevX;
    const moveDz = e.z - e.prevZ;
    const maxStepDist = e.speed * BALANCE.fixedDt + 1e-4;
    const moveDistSq = moveDx * moveDx + moveDz * moveDz;
    if (moveDistSq > maxStepDist * maxStepDist) {
      return `Enemy uid=${e.uid} (${e.type}) moved ${Math.sqrt(moveDistSq)} > max ${e.speed * BALANCE.fixedDt} in one tick`;
    }
    if (!Number.isFinite(e.dist) || !Number.isFinite(e.totalDist) || e.dist < 0 || e.dist > e.totalDist) {
      return `Invalid enemy dist (${e.dist}/${e.totalDist}) for uid=${e.uid}`;
    }
    const expectedPath = e.flying ? flightPath : groundPath;
    const expectedYaw = expectedPath.sample(e.dist, _pathCheckVec);
    const expectedPathLen = e.flying ? flightPathLen : groundPathLen;
    if (Math.abs(e.totalDist - expectedPathLen) > 1e-4) {
      return `Enemy uid=${e.uid} totalDist=${e.totalDist} != path.totalLength=${expectedPathLen}`;
    }
    let yawDiff = Math.abs(e.yaw - expectedYaw) % (Math.PI * 2);
    if (yawDiff > Math.PI) yawDiff = Math.PI * 2 - yawDiff;
    const pathDx = e.x - _pathCheckVec.x;
    const pathDz = e.z - _pathCheckVec.z;
    if (pathDx * pathDx + pathDz * pathDz > 1e-8 || yawDiff > 1e-4) {
      return `Enemy uid=${e.uid} (${e.type}) drifted from compiled path (dist=${e.dist})`;
    }
    if (
      !Number.isFinite(e.slowRatio) ||
      e.slowRatio < 0 ||
      e.slowRatio > BALANCE.maxSlowRatio + 1e-9 ||
      !Number.isFinite(e.slowTimer) ||
      e.slowTimer < 0 ||
      e.slowTimer > MAX_SLOW_DURATION + 1e-6 ||
      !Number.isFinite(e.hitFlashTimer) ||
      e.hitFlashTimer < 0 ||
      e.hitFlashTimer > 0.12 + 1e-6 ||
      !Number.isFinite(e.healTimer) ||
      e.healTimer < 0 ||
      (e.type === 'healer' ? e.healTimer > (def.healInterval ?? 2.6) + 1e-6 : e.healTimer !== 0) ||
      !Number.isFinite(e.walkPhase) ||
      !Number.isFinite(e.bossPulseTimer) ||
      e.bossPulseTimer < 0 ||
      (e.type === 'boss' ? e.bossPulseTimer > 7.0 + 1e-6 : e.bossPulseTimer !== 0) ||
      !Number.isFinite(e.scaleOverride) ||
      e.scaleOverride <= 0 ||
      !Number.isFinite(e.armor) ||
      e.armor < 0 ||
      !Number.isFinite(e.speed) ||
      e.speed <= 0
    ) {
      return `Invalid status/stat state for uid=${e.uid} type=${e.type}`;
    }
  }

  for (let i = 0; i < activeProj; i++) {
    const p = world.projectilePool.items[world.projectilePool.getActiveIndex(i)];
    if (!p.active) return `Inactive projectile at active index pos=${i}`;
    if (!TOWER_DEFS[p.towerType] || p.towerType === 'tesla') {
      return `Invalid projectile towerType=${p.towerType}`;
    }
    if (
      !Number.isInteger(p.towerId) ||
      p.towerId <= 0 ||
      p.towerId > tracker.maxEverTowerId ||
      !tracker.everBuiltTowerIds.has(p.towerId) ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      !Number.isFinite(p.z) ||
      !Number.isFinite(p.prevX) ||
      !Number.isFinite(p.prevY) ||
      !Number.isFinite(p.prevZ) ||
      !Number.isFinite(p.startX) ||
      !Number.isFinite(p.startY) ||
      !Number.isFinite(p.startZ) ||
      !Number.isFinite(p.endX) ||
      !Number.isFinite(p.endY) ||
      !Number.isFinite(p.endZ) ||
      !Number.isFinite(p.yaw) ||
      !Number.isFinite(p.prevYaw) ||
      !Number.isFinite(p.progress) ||
      !Number.isFinite(p.duration) ||
      !Number.isFinite(p.arcHeight) ||
      !Number.isFinite(p.damage) ||
      !Number.isFinite(p.splashRadius) ||
      !Number.isFinite(p.splashFalloffMin) ||
      !Number.isFinite(p.slowRatio) ||
      !Number.isFinite(p.slowDuration) ||
      !Number.isFinite(p.speed) ||
      !Number.isInteger(p.targetUid) ||
      p.targetUid <= 0 ||
      p.targetUid > tracker.spawnedCount ||
      !tracker.seenSpawnUids.has(p.targetUid) ||
      !Number.isInteger(p.targetPoolIndex) ||
      p.targetPoolIndex < 0 ||
      p.targetPoolIndex >= BALANCE.pools.maxEnemies ||
      p.duration < 0.06 - 1e-9 ||
      (p.parabolic &&
        Math.abs(p.duration - Math.max(0.06, Math.hypot(p.endX - p.startX, p.endZ - p.startZ) / p.speed)) > 1e-9) ||
      p.progress <= 0 ||
      p.progress >= 1 ||
      p.endY < MIN_ENEMY_IMPACT_Y - 1e-5 ||
      p.endY > (TOWER_DEFS[p.towerType].hitsFlyers ? MAX_ANY_IMPACT_Y : MAX_GROUND_IMPACT_Y) + 1e-5 ||
      p.arcHeight < 0 ||
      (p.parabolic
        ? p.arcHeight <= 0 ||
          p.y < Math.min(p.startY, p.endY) - 1e-5 ||
          p.y > Math.max(p.startY, p.endY) + p.arcHeight + 1e-5
        : p.arcHeight !== 0 ||
          p.y < Math.min(p.startY, p.endY) - 1e-5 ||
          p.y > Math.max(p.startY, p.endY) + 1e-5) ||
      p.damage < 0 ||
      p.splashRadius < 0 ||
      p.splashFalloffMin <= 0 ||
      p.splashFalloffMin > 1 ||
      p.slowRatio < 0 ||
      p.slowRatio > 1 ||
      p.slowDuration < 0 ||
      p.speed <= 0
    ) {
      return `Non-finite or invalid projectile state (type=${p.towerType}, progress=${p.progress}, duration=${p.duration})`;
    }
    const tiers = TOWER_DEFS[p.towerType].tiers;
    let matchesTierStats = false;
    for (let tIdx = 0; tIdx < tiers.length; tIdx++) {
      const st = tiers[tIdx];
      if (
        p.damage === st.damage &&
        p.splashRadius === st.splashRadius &&
        p.splashFalloffMin === st.splashFalloffMin &&
        p.slowRatio === st.slowRatio &&
        p.slowDuration === st.slowDuration &&
        p.arcHeight === st.parabolicArcHeight &&
        p.speed === Math.max(1, st.projectileSpeed)
      ) {
        matchesTierStats = true;
        break;
      }
    }
    if (!matchesTierStats) {
      return `Projectile stats for ${p.towerType} (dmg=${p.damage}, splash=${p.splashRadius}, speed=${p.speed}) match no tier`;
    }
    const expectedStartY = TOWER_DEFS[p.towerType].turretHeight + 0.15;
    if (Math.abs(p.startY - expectedStartY) > 1e-6) {
      return `Projectile startY=${p.startY} != expected=${expectedStartY} for ${p.towerType}`;
    }
    const srcTower = tracker.towerById.get(p.towerId);
    if (
      srcTower &&
      (srcTower.type !== p.towerType ||
        Math.abs(p.startX - srcTower.x) > 1e-6 ||
        Math.abs(p.startZ - srcTower.z) > 1e-6)
    ) {
      return `Projectile start origin drifted from live source tower id=${p.towerId}`;
    }
    if (!p.parabolic && world.outcome === 'ongoing') {
      const target = world.enemyPool.items[p.targetPoolIndex];
      if (
        target.active &&
        target.uid === p.targetUid &&
        (Math.abs(p.endX - target.x) > 1e-6 ||
          Math.abs(p.endY - (target.y + target.height * 0.55)) > 1e-5 ||
          Math.abs(p.endZ - target.z) > 1e-6)
      ) {
        return `Linear projectile target (${p.endX},${p.endY},${p.endZ}) out of sync with live target uid=${p.targetUid}`;
      }
    } else if (p.parabolic && Math.hypot(p.endX - p.startX, p.endZ - p.startZ) > 0.01) {
      const expectedProjYaw = Math.atan2(p.endX - p.startX, p.endZ - p.startZ);
      let projYawDiff = Math.abs(p.yaw - expectedProjYaw) % (Math.PI * 2);
      if (projYawDiff > Math.PI) projYawDiff = Math.PI * 2 - projYawDiff;
      if (projYawDiff > 1e-4) {
        return `Parabolic projectile yaw=${p.yaw} diverged from travel heading=${expectedProjYaw}`;
      }
    }
    const projT = Math.min(1, p.progress);
    const expProjX = p.startX + (p.endX - p.startX) * projT;
    const expProjZ = p.startZ + (p.endZ - p.startZ) * projT;
    const expProjY =
      p.startY + (p.endY - p.startY) * projT + (p.parabolic ? 4 * p.arcHeight * projT * (1 - projT) : 0);
    if (
      Math.abs(p.x - expProjX) > 1e-5 ||
      Math.abs(p.y - expProjY) > 1e-5 ||
      Math.abs(p.z - expProjZ) > 1e-5
    ) {
      return `Projectile (${p.x},${p.y},${p.z}) diverged from parametric curve (${expProjX},${expProjY},${expProjZ}) at progress=${p.progress}`;
    }
  }

  _seenTowerIds.clear();
  _seenTowerCoords.clear();
  let prevTowerId = 0;
  let activeTowerKills = 0;
  let activeTowerDamage = 0;
  for (let i = 0; i < world.towers.length; i++) {
    const t = world.towers[i];
    if (t.id <= prevTowerId || t.id > tracker.maxEverTowerId) {
      return `Non-monotonic or out-of-range tower id=${t.id} (prev=${prevTowerId}, max=${tracker.maxEverTowerId})`;
    }
    prevTowerId = t.id;
    if (t.stunTimer > 0 && t.yaw !== t.prevYaw) {
      return `Stunned tower id=${t.id} rotated yaw (${t.prevYaw} -> ${t.yaw}) while stunTimer=${t.stunTimer}`;
    }
    if (
      !Number.isFinite(t.x) ||
      !Number.isFinite(t.z) ||
      !Number.isFinite(t.yaw) ||
      !Number.isFinite(t.prevYaw) ||
      !Number.isFinite(t.targetYaw) ||
      (t.tier !== 1 && t.tier !== 2 && t.tier !== 3) ||
      !TARGETING_MODE_SET.has(t.targetingMode) ||
      !Number.isFinite(t.cooldownTimer) ||
      t.cooldownTimer < 0 ||
      t.cooldownTimer > MAX_COOLDOWN_BY_TYPE[t.type] + 1e-6 ||
      !Number.isFinite(t.stunTimer) ||
      t.stunTimer < 0 ||
      t.stunTimer > 2.65 + 1e-6 ||
      !Number.isFinite(t.recoil) ||
      t.recoil < 0 ||
      t.recoil > 1.0001 ||
      !Number.isFinite(t.popAnimTimer) ||
      t.popAnimTimer < 0 ||
      t.popAnimTimer > 0.3201 ||
      !Number.isFinite(t.totalDamageDealt) ||
      t.totalDamageDealt < 0 ||
      !Number.isInteger(t.kills) ||
      t.kills < 0
    ) {
      return `Invalid tower state for id=${t.id} type=${t.type}`;
    }
    if (t.x !== world.grid.gridToWorldX(t.col) || t.z !== world.grid.gridToWorldZ(t.row)) {
      return `Tower id=${t.id} position (${t.x},${t.z}) drifted from grid tile (${t.col},${t.row})`;
    }
    if (_seenTowerIds.has(t.id)) {
      return `Duplicate tower id=${t.id}`;
    }
    _seenTowerIds.add(t.id);
    const coordKey = t.row * world.grid.cols + t.col;
    if (_seenTowerCoords.has(coordKey)) {
      return `Multiple towers on tile (${t.col},${t.row})`;
    }
    _seenTowerCoords.add(coordKey);
    if (world.grid.getTile(t.col, t.row) !== 'grass') {
      return `Tower id=${t.id} placed on non-grass tile (${t.col},${t.row})`;
    }
    if (world.grid.getTowerIdAt(t.col, t.row) !== t.id) {
      return `Grid occupancy mismatch at (${t.col},${t.row}): grid=${world.grid.getTowerIdAt(t.col, t.row)}, tower=${t.id}`;
    }
    const expInvested = expectedTowerInvestment(t.type, t.tier);
    if (t.totalInvested !== expInvested) {
      return `Tower id=${t.id} totalInvested=${t.totalInvested} != expected=${expInvested}`;
    }
    const prevStats = tracker.prevTowerStats.get(t.id);
    if (prevStats) {
      if (
        t.kills < prevStats.kills ||
        t.totalDamageDealt + 1e-9 < prevStats.dmg ||
        t.tier < prevStats.tier ||
        t.totalInvested < prevStats.totalInvested
      ) {
        return `Tower id=${t.id} stats/tier regressed (kills ${prevStats.kills}->${t.kills}, dmg ${prevStats.dmg}->${t.totalDamageDealt}, tier ${prevStats.tier}->${t.tier})`;
      }
      if (
        prevStats.stunTimer > BALANCE.fixedDt + 1e-6 &&
        t.stunTimer > 0 &&
        !tracker.newlyStunnedTowerIds.has(t.id)
      ) {
        if (
          t.stunTimer > prevStats.stunTimer + 1e-9 ||
          t.cooldownTimer !== prevStats.cooldownTimer ||
          t.recoil > prevStats.recoil + 1e-9
        ) {
          return `Continuously stunned tower id=${t.id} mutated cooldown (${prevStats.cooldownTimer}->${t.cooldownTimer}), stun (${prevStats.stunTimer}->${t.stunTimer}), or recoil`;
        }
      }
      prevStats.kills = t.kills;
      prevStats.dmg = t.totalDamageDealt;
      prevStats.cooldownTimer = t.cooldownTimer;
      prevStats.stunTimer = t.stunTimer;
      prevStats.tier = t.tier;
      prevStats.totalInvested = t.totalInvested;
      prevStats.recoil = t.recoil;
    } else {
      tracker.prevTowerStats.set(t.id, {
        kills: t.kills,
        dmg: t.totalDamageDealt,
        cooldownTimer: t.cooldownTimer,
        stunTimer: t.stunTimer,
        tier: t.tier,
        totalInvested: t.totalInvested,
        recoil: t.recoil,
      });
    }
    activeTowerKills += t.kills;
    activeTowerDamage += t.totalDamageDealt;
  }
  tracker.newlyStunnedTowerIds.clear();
  tracker.bossesBelowHalfLastTick.clear();
  for (const bossUid of _bossesBelowHalfScratch) {
    tracker.bossesBelowHalfLastTick.add(bossUid);
  }

  if (activeTowerKills + tracker.soldTowerKills > tracker.killedCount + pendingDeaths) {
    return `Tower kills (${activeTowerKills}+${tracker.soldTowerKills}) exceeded killedCount+pendingDeaths (${tracker.killedCount}+${pendingDeaths})`;
  }
  if (activeTowerDamage + tracker.soldTowerDamage > tracker.totalEnemyHitDamage) {
    return `Tower damage (${activeTowerDamage}+${tracker.soldTowerDamage}) exceeded total enemyHit damage (${tracker.totalEnemyHitDamage})`;
  }

  for (const id of ABILITY_IDS) {
    const cd = world.abilitySystem.getCooldown(id);
    const maxCd = world.abilitySystem.getMaxCooldown(id);
    if (!Number.isFinite(cd) || cd < 0 || cd > maxCd + 1e-6) {
      return `Invalid ability cooldown for ${id}: ${cd} (max=${maxCd})`;
    }
  }
  const overchargeRem = world.abilitySystem.getOverchargeRemaining();
  if (
    !Number.isFinite(overchargeRem) ||
    overchargeRem < 0 ||
    overchargeRem > ABILITY_DEFS.overcharge.durationSec + 1e-6
  ) {
    return `Invalid overchargeRemaining: ${overchargeRem}`;
  }
  const expectedFireMult = world.abilitySystem.isOverchargeActive()
    ? ABILITY_DEFS.overcharge.fireRateMultiplier
    : 1;
  if (world.abilitySystem.getFireRateMultiplier() !== expectedFireMult) {
    return `Fire rate multiplier mismatch: got ${world.abilitySystem.getFireRateMultiplier()}, expected ${expectedFireMult}`;
  }

  const ws = world.waveSystem;
  if (world.towers.length !== tracker.builtTowerIds.size) {
    return `Tower ledger mismatch: world=${world.towers.length}, builtTowerIds=${tracker.builtTowerIds.size}`;
  }
  const maxInterWave = ws.autoWave ? 0.8 : BALANCE.interWaveCountdownSec;
  if (
    !VALID_WAVE_STATES.has(ws.state) ||
    ws.currentWaveIndex < -1 ||
    (ws.state === 'preFirstWave') !== (ws.currentWaveIndex === -1) ||
    (!ws.isEndless && ws.totalWaves !== world.level.waves.length) ||
    (ws.isEndless && ws.totalWaves !== Math.max(world.level.waves.length, ws.currentWaveOneBased)) ||
    ws.currentWaveOneBased !== Math.max(0, ws.currentWaveIndex + 1) ||
    ws.totalWaves < world.level.waves.length ||
    !Number.isFinite(ws.interWaveTimer) ||
    (ws.state === 'betweenWaves' && (ws.interWaveTimer < -BALANCE.fixedDt || ws.interWaveTimer > maxInterWave + 1e-6)) ||
    !Number.isFinite(ws.waveElapsed) ||
    ws.waveElapsed < 0
  ) {
    return `Invalid waveSystem state (${ws.state}, wave=${ws.currentWaveOneBased}, interWave=${ws.interWaveTimer})`;
  }
  if (
    ((ws.state === 'spawning' || ws.state === 'finished') && (ws.canStartNextWave() || ws.getEarlyCallBonus() !== 0)) ||
    (ws.state === 'preFirstWave' && (!ws.canStartNextWave() || ws.getEarlyCallBonus() !== 0)) ||
    (ws.state === 'clearing' &&
      ws.getEarlyCallBonus() !== (ws.canStartNextWave() ? BALANCE.earlyWaveBonusMaxGold : 0)) ||
    (ws.state === 'betweenWaves' &&
      ws.canStartNextWave() !== (ws.isEndless || ws.currentWaveIndex + 1 < world.level.waves.length)) ||
    (ws.state === 'allSpawned' &&
      (ws.canStartNextWave() !== ws.isEndless ||
        ws.getEarlyCallBonus() !== (ws.isEndless ? BALANCE.earlyWaveBonusMaxGold : 0)))
  ) {
    return `Inconsistent waveSystem action/bonus state in ${ws.state} (endless=${ws.isEndless})`;
  }
  const clearBonusInvalid =
    ws.state === 'preFirstWave' || ws.state === 'betweenWaves' || ws.state === 'finished'
      ? ws.pendingClearBonus !== 0 || tracker.pendingExpectedWaveBonus !== 0
      : ws.state === 'spawning'
        ? ws.pendingClearBonus < 0 || ws.pendingClearBonus > tracker.pendingExpectedWaveBonus
        : ws.pendingClearBonus !== tracker.pendingExpectedWaveBonus;
  if (clearBonusInvalid) {
    return `Pending clear bonus ledger mismatch in ${ws.state}: sim=${ws.pendingClearBonus}, tracker=${tracker.pendingExpectedWaveBonus}`;
  }
  if (ws.currentWaveIndex >= 0) {
    const expHpScale = expectedWaveHpScale(world.level, ws.currentWaveIndex);
    const actHpScale = ws.getCurrentWaveHpScale();
    if (Math.abs(actHpScale - expHpScale) > 1e-9 || actHpScale < tracker.lastWaveHpScale - 1e-9) {
      return `Wave HP scale mismatch at wave=${ws.currentWaveOneBased}: got=${actHpScale}, expected=${expHpScale}`;
    }
    const expRewardMult = expectedWaveRewardMultiplier(world.level, ws.currentWaveIndex);
    const actRewardMult = ws.getRewardMultiplier();
    if (Math.abs(actRewardMult - expRewardMult) > 1e-9) {
      return `Wave rewardMultiplier mismatch at wave=${ws.currentWaveOneBased}: got=${actRewardMult}, expected=${expRewardMult}`;
    }
  }

  if (tick % 30 === 0) {
    let gridOccupiedCount = 0;
    for (let r = 0; r < world.grid.rows; r++) {
      for (let c = 0; c < world.grid.cols; c++) {
        if (world.grid.getTowerIdAt(c, r) !== -1) gridOccupiedCount++;
      }
    }
    if (gridOccupiedCount !== world.towers.length) {
      return `Grid occupied count (${gridOccupiedCount}) != towers.length (${world.towers.length})`;
    }

    world.spatialHash.query(0, 0, 1000, _hashProbe);
    _hashSeen.clear();
    for (let i = 0; i < _hashProbe.length; i++) {
      const idx = _hashProbe[i];
      if (_hashSeen.has(idx)) {
        return `Duplicate poolIndex=${idx} in SpatialHashGrid`;
      }
      _hashSeen.add(idx);
    }
    if (_hashSeen.size !== activeEnemies) {
      return `SpatialHash count (${_hashSeen.size}) != activeEnemies (${activeEnemies})`;
    }
    for (let i = 0; i < activeEnemies; i++) {
      const poolIdx = world.enemyPool.getActiveIndex(i);
      if (!_hashSeen.has(poolIdx)) {
        return `Active enemy poolIndex=${poolIdx} missing from SpatialHashGrid`;
      }
    }
    const probeSampleCount = Math.min(8, activeEnemies);
    for (let s = 0; s < probeSampleCount; s++) {
      const eIdx = world.enemyPool.getActiveIndex(Math.floor((s * activeEnemies) / probeSampleCount));
      const enemy = world.enemyPool.items[eIdx];
      world.spatialHash.query(enemy.x, enemy.z, 0.01, _localHashProbe);
      if (!_localHashProbe.includes(eIdx)) {
        return `Active enemy poolIndex=${eIdx} missing from localized SpatialHashGrid cell at (${enemy.x},${enemy.z})`;
      }
    }

    const mvp = world.getMvpTowerSummary();
    if (world.towers.length === 0) {
      if (mvp !== null) return 'Expected null MVP summary when zero towers exist';
    } else {
      if (!mvp) return 'Expected non-null MVP summary with active towers';
      let matching = false;
      for (let tIdx = 0; tIdx < world.towers.length; tIdx++) {
        const t = world.towers[tIdx];
        if (
          t.type === mvp.type &&
          t.tier === mvp.tier &&
          t.kills === mvp.kills &&
          Math.round(t.totalDamageDealt) === mvp.damageDealt
        ) {
          matching = true;
          break;
        }
      }
      if (!matching) {
        return `MVP summary (${mvp.type} T${mvp.tier} dmg=${mvp.damageDealt} kills=${mvp.kills}) matches no live tower`;
      }
    }

    const preview = ws.getNextWavePreview();
    const nextWaveIdx = ws.state === 'preFirstWave' ? 0 : ws.currentWaveIndex + 1;
    const expectsPreview =
      ws.state !== 'finished' && (ws.isEndless || nextWaveIdx < world.level.waves.length);
    if (!expectsPreview) {
      if (preview !== null) return `Expected null nextWavePreview at final/finished wave`;
    } else {
      if (!preview || preview.waveOneBased !== nextWaveIdx + 1) {
        return `Invalid nextWavePreview waveOneBased=${preview?.waveOneBased} (expected ${nextWaveIdx + 1})`;
      }
      const nextDef =
        nextWaveIdx < world.level.waves.length
          ? world.level.waves[nextWaveIdx]
          : buildEndlessWaveDef(nextWaveIdx, world.level);
      _expectedPreviewCounts.clear();
      for (let g = 0; g < nextDef.groups.length; g++) {
        const grp = nextDef.groups[g];
        _expectedPreviewCounts.set(grp.enemyType, (_expectedPreviewCounts.get(grp.enemyType) ?? 0) + grp.count);
      }
      _seenPreviewTypes.clear();
      for (let pIdx = 0; pIdx < preview.items.length; pIdx++) {
        const item = preview.items[pIdx];
        if (item.count <= 0 || _seenPreviewTypes.has(item.enemyType)) {
          return `Invalid or duplicate nextWavePreview item ${item.enemyType}=${item.count}`;
        }
        _seenPreviewTypes.add(item.enemyType);
        const expCount = _expectedPreviewCounts.get(item.enemyType) ?? 0;
        if (item.count !== expCount) {
          return `nextWavePreview ${item.enemyType} count ${item.count} != waveDef count ${expCount}`;
        }
      }
      if (_seenPreviewTypes.size !== _expectedPreviewCounts.size) {
        return `nextWavePreview missing enemy types (${_seenPreviewTypes.size} != ${_expectedPreviewCounts.size})`;
      }
    }
  }

  if (tick % 60 === 0) {
    let h = mixHash(tracker.stateHash, world.gold);
    h = mixHash(h, world.lives);
    h = mixHash(h, world.towers.length);
    h = mixHash(h, activeEnemies);
    if (activeEnemies > 0) {
      const sample = world.enemyPool.items[world.enemyPool.getActiveIndex(0)];
      h = mixHash(mixHash(h, Math.round(sample.x * 100)), Math.round(sample.dist * 100));
      const hovered = sample.flying
        ? world.findHoveredEnemy(9999, 9999, sample.x, sample.z)
        : world.findHoveredEnemy(sample.x, sample.z, 9999, 9999);
      if (!hovered || !hovered.active || hovered.flying !== sample.flying) {
        return `findHoveredEnemy failed for active ${sample.type} (flying=${sample.flying})`;
      }
    }
    tracker.stateHash = h;
  }

  if (tracker.gameWonCount > 1) {
    return `gameWon fired ${tracker.gameWonCount} times`;
  }
  if (tracker.gameLostCount > 1) {
    return `gameLost fired ${tracker.gameLostCount} times`;
  }
  if (tracker.gameWonCount > 0 && tracker.gameLostCount > 0 && !world.waveSystem.isEndless) {
    return `Both gameWon and gameLost fired in story mode`;
  }

  return null;
}

function compareTilesMortar(a: ScoredTile, b: ScoredTile): number {
  return b.mortarCoverage - a.mortarCoverage;
}

function compareTilesAir(a: ScoredTile, b: ScoredTile): number {
  return b.groundCoverage + b.flightCoverage * 0.95 - (a.groundCoverage + a.flightCoverage * 0.95);
}

function compareTilesGround(a: ScoredTile, b: ScoredTile): number {
  return b.groundCoverage - a.groundCoverage;
}

function chooseTileForBuild(
  world: SimWorld,
  rng: SeededRng,
  tiles: readonly ScoredTile[],
  towerType: TowerType,
  profile: FuzzProfile,
): GridCoord | null {
  _freeTiles.length = 0;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (world.grid.canPlaceTower(t.col, t.row)) {
      _freeTiles.push(t);
    }
  }
  if (_freeTiles.length === 0) return null;

  if (profile === 'chaotic' || profile === 'minimal') {
    return rng.pick(_freeTiles);
  }

  const hitsFlyers = TOWER_DEFS[towerType].hitsFlyers;
  const cmp =
    towerType === 'mortar'
      ? compareTilesMortar
      : hitsFlyers
        ? compareTilesAir
        : compareTilesGround;
  _freeTiles.sort(cmp);

  const poolSize =
    profile === 'tactical'
      ? Math.min(2, _freeTiles.length)
      : profile === 'competent'
        ? Math.min(4, _freeTiles.length)
        : Math.min(10, _freeTiles.length);
  return _freeTiles[rng.int(0, poolSize - 1)];
}

function chooseTowerType(world: SimWorld, rng: SeededRng, profile: FuzzProfile): TowerType | null {
  _affordableTypes.length = 0;
  for (let i = 0; i < TOWER_TYPES.length; i++) {
    const type = TOWER_TYPES[i];
    if (world.gold >= getTowerTierStats(type, 1).upgradeCost) {
      _affordableTypes.push(type);
    }
  }
  if (_affordableTypes.length === 0) return null;

  if (profile === 'tactical') {
    _towerTypeCounts.clear();
    let antiAirCount = 0;
    for (let i = 0; i < world.towers.length; i++) {
      const t = world.towers[i];
      _towerTypeCounts.set(t.type, (_towerTypeCounts.get(t.type) ?? 0) + 1);
      if (TOWER_DEFS[t.type].hitsFlyers) antiAirCount++;
    }
    let nextHasFlyer = false;
    const preview = world.waveSystem.getNextWavePreview();
    if (preview) {
      for (let i = 0; i < preview.items.length; i++) {
        if (preview.items[i].enemyType === 'flyer') {
          nextHasFlyer = true;
          break;
        }
      }
    }
    let anyAffordableFlyer = false;
    for (let i = 0; i < _affordableTypes.length; i++) {
      if (TOWER_DEFS[_affordableTypes[i]].hitsFlyers) {
        anyAffordableFlyer = true;
        break;
      }
    }

    if ((nextHasFlyer || antiAirCount < 2) && anyAffordableFlyer) {
      if ((_towerTypeCounts.get('frost') ?? 0) === 0 && _affordableTypes.includes('frost')) return 'frost';
      if (_affordableTypes.includes('tesla') && rng.chance(0.45)) return 'tesla';
      if (_affordableTypes.includes('archer')) return 'archer';
    }
    if ((_towerTypeCounts.get('frost') ?? 0) < 2 && _affordableTypes.includes('frost')) return 'frost';
    if ((_towerTypeCounts.get('cannon') ?? 0) < 2 && _affordableTypes.includes('cannon')) return 'cannon';
    if ((_towerTypeCounts.get('mortar') ?? 0) < 2 && _affordableTypes.includes('mortar')) return 'mortar';
    if ((_towerTypeCounts.get('tesla') ?? 0) < 2 && _affordableTypes.includes('tesla')) return 'tesla';
    return rng.pick(_affordableTypes);
  }

  if (profile !== 'competent') {
    return rng.pick(_affordableTypes);
  }

  // Competent profile prefers anti-air early if aerial coverage is sparse
  let antiAirCount = 0;
  for (let i = 0; i < world.towers.length; i++) {
    if (TOWER_DEFS[world.towers[i].type].hitsFlyers) antiAirCount++;
  }
  let nextHasFlyer = false;
  const preview = world.waveSystem.getNextWavePreview();
  if (preview) {
    for (let i = 0; i < preview.items.length; i++) {
      if (preview.items[i].enemyType === 'flyer') {
        nextHasFlyer = true;
        break;
      }
    }
  }
  if ((nextHasFlyer || antiAirCount < 2) && rng.chance(0.7)) {
    _aaAffordableTypes.length = 0;
    for (let i = 0; i < _affordableTypes.length; i++) {
      const t = _affordableTypes[i];
      if (TOWER_DEFS[t].hitsFlyers) _aaAffordableTypes.push(t);
    }
    if (_aaAffordableTypes.length > 0) return rng.pick(_aaAffordableTypes);
  }
  return rng.pick(_affordableTypes);
}

function performLegalAction(
  world: SimWorld,
  rng: SeededRng,
  tiles: readonly ScoredTile[],
  profile: FuzzProfile,
  tracker: FuzzTracker,
): string | null {
  if (world.outcome !== 'ongoing') return null;

  // Occasionally probe illegal calls to verify they fail safely with zero state mutation
  if (rng.chance(0.06)) {
    const goldSnap = world.gold;
    const countSnap = world.towers.length;
    const spawn = world.level.pathWaypoints[0];
    const existingTower = world.towers[0];
    let maxTierTower: TowerEntity | undefined;
    let unaffordableUpgrade: TowerEntity | undefined;
    for (let i = 0; i < world.towers.length; i++) {
      const t = world.towers[i];
      if (!maxTierTower && t.tier >= 3) maxTierTower = t;
      if (
        !unaffordableUpgrade &&
        t.tier < 3 &&
        world.gold < getTowerTierStats(t.type, (t.tier + 1) as 2 | 3).upgradeCost
      ) {
        unaffordableUpgrade = t;
      }
      if (maxTierTower && unaffordableUpgrade) break;
    }
    const unaffordableTierBefore = unaffordableUpgrade?.tier;
    let freeTile: ScoredTile | undefined;
    if (world.gold < CHEAPEST_TOWER_COST) {
      for (let i = 0; i < tiles.length; i++) {
        if (world.grid.canPlaceTower(tiles[i].col, tiles[i].row)) {
          freeTile = tiles[i];
          break;
        }
      }
    }
    if (
      world.placeTower(-1, -1, 'archer') !== null ||
      (spawn && world.placeTower(spawn.col, spawn.row, 'archer') !== null) ||
      (existingTower && world.placeTower(existingTower.col, existingTower.row, 'archer') !== null) ||
      (freeTile && world.placeTower(freeTile.col, freeTile.row, 'archer') !== null) ||
      world.upgradeTower(999_999) !== false ||
      (maxTierTower && world.upgradeTower(maxTierTower.id) !== false) ||
      (unaffordableUpgrade && world.upgradeTower(unaffordableUpgrade.id) !== false) ||
      world.sellTower(999_999) !== 0 ||
      world.enterEndlessMode() !== false
    ) {
      return 'Illegal action succeeded unexpectedly during ongoing play';
    }
    world.setTowerTargeting(999_999, 'last');
    if (
      world.gold !== goldSnap ||
      world.towers.length !== countSnap ||
      (unaffordableUpgrade && unaffordableUpgrade.tier !== unaffordableTierBefore)
    ) {
      return 'Illegal action mutated gold, tower count, or unaffordable tower tier';
    }
  }

  // Toggle auto-wave occasionally and verify countdown conservation
  if (rng.chance(0.1)) {
    const wasBetween = world.waveSystem.state === 'betweenWaves';
    const prevAuto = world.waveSystem.autoWave;
    const prevTimer = world.waveSystem.interWaveTimer;
    world.setAutoWave(!prevAuto);
    if (wasBetween) {
      if (prevAuto && world.waveSystem.interWaveTimer + 1e-9 < prevTimer) {
        return `Turning off autoWave shrank interWaveTimer (${prevTimer} -> ${world.waveSystem.interWaveTimer})`;
      }
      if (!prevAuto && world.waveSystem.interWaveTimer > Math.min(prevTimer, 0.75) + 1e-9) {
        return `Turning on autoWave failed to cap interWaveTimer (${prevTimer} -> ${world.waveSystem.interWaveTimer})`;
      }
    }
  }

  // Start / early-call wave when legal
  if (world.waveSystem.canStartNextWave()) {
    const wsState = world.waveSystem.state;
    const activeCount = world.enemyPool.getActiveCount();
    const shouldStart =
      wsState === 'preFirstWave' ||
      (wsState === 'betweenWaves' && (profile === 'tactical' ? rng.chance(0.75) : rng.chance(0.55))) ||
      (profile === 'chaotic' && activeCount < 140 && rng.chance(0.25)) ||
      (wsState === 'clearing' && profile !== 'tactical' && activeCount <= 4 && rng.chance(0.35));

    if (shouldStart) {
      const goldBefore = world.gold;
      const expectedBonus = world.waveSystem.getEarlyCallBonus();
      const previewBefore = world.waveSystem.getNextWavePreview();
      const started = world.startNextWave();
      if (!started) {
        return `canStartNextWave() was true in state=${wsState} but startNextWave() returned false`;
      }
      if (tracker.eventInvariantError) {
        return tracker.eventInvariantError;
      }
      if (!previewBefore || previewBefore.waveOneBased !== world.waveSystem.currentWaveOneBased) {
        return `Next wave preview (${previewBefore?.waveOneBased}) did not match started wave ${world.waveSystem.currentWaveOneBased}`;
      }
      if (world.gold !== goldBefore + expectedBonus) {
        return `Early call bonus mismatch: expected ${goldBefore + expectedBonus}, got ${world.gold}`;
      }
    }
  }

  // Abilities (also test preFirstWave rejection guard safely)
  if (world.waveSystem.state === 'preFirstWave') {
    if (world.castMeteor(0, 0) || world.castOvercharge()) {
      return 'Ability cast succeeded during preFirstWave';
    }
  } else {
    if (!world.abilitySystem.canCast('meteor')) {
      const meteorCd = world.abilitySystem.getCooldown('meteor');
      if (world.castMeteor(0, 0) || world.abilitySystem.getCooldown('meteor') !== meteorCd) {
        return 'castMeteor succeeded or mutated cooldown while on cooldown';
      }
    } else if (profile === 'tactical' ? world.enemyPool.getActiveCount() >= 4 : rng.chance(0.35)) {
      const activeEnemies = world.enemyPool.getActiveCount();
      let tx: number;
      let tz: number;
      if (activeEnemies > 0) {
        const idx = world.enemyPool.getActiveIndex(rng.int(0, activeEnemies - 1));
        const target = world.enemyPool.items[idx];
        tx = target.x;
        tz = target.z;
      } else {
        world.groundPath.sample(rng.range(0, world.groundPath.totalLength), _pathCheckVec);
        tx = _pathCheckVec.x;
        tz = _pathCheckVec.z;
      }
      if (!world.castMeteor(tx, tz)) {
        return 'castMeteor returned false while canCast("meteor") was true during combat';
      }
    }
    if (!world.abilitySystem.canCast('overcharge')) {
      const overCd = world.abilitySystem.getCooldown('overcharge');
      if (world.castOvercharge() || world.abilitySystem.getCooldown('overcharge') !== overCd) {
        return 'castOvercharge succeeded or mutated cooldown while on cooldown';
      }
    } else {
      let shouldCastOvercharge: boolean;
      if (profile === 'tactical') {
        let anyStunned = false;
        for (let i = 0; i < world.towers.length; i++) {
          if (world.towers[i].stunTimer > 0) {
            anyStunned = true;
            break;
          }
        }
        shouldCastOvercharge = anyStunned || world.enemyPool.getActiveCount() >= 6;
      } else {
        shouldCastOvercharge = rng.chance(0.35);
      }
      if (shouldCastOvercharge) {
        if (!world.castOvercharge()) {
          return 'castOvercharge returned false while canCast("overcharge") was true during combat';
        }
        for (let i = 0; i < world.towers.length; i++) {
          if (world.towers[i].stunTimer > 0) {
            return 'castOvercharge left a tower stunned';
          }
        }
      }
    }
  }

  // Decide tower action (build / upgrade / sell / retarget)
  const roll = rng.next();
  const sellCutoff =
    profile === 'chaotic'
      ? 0.22
      : profile === 'minimal'
        ? 0.28
        : profile === 'tactical'
          ? 0
          : profile === 'competent'
            ? 0.02
            : 0.06;
  const upgradeCutoff =
    sellCutoff +
    (profile === 'minimal' ? 0.2 : profile === 'tactical' ? (world.towers.length >= 6 ? 0.62 : 0.36) : 0.42);
  const retargetCutoff = upgradeCutoff + (profile === 'tactical' ? 0.08 : 0.12);

  if (roll < sellCutoff && world.towers.length > 0) {
    const victim = rng.pick(world.towers);
    const goldBefore = world.gold;
    const expectedRefund = computeSellRefund(victim.totalInvested);
    const victimKills = victim.kills;
    const victimDamage = victim.totalDamageDealt;
    const refund = world.sellTower(victim.id);
    if (refund !== expectedRefund || world.gold !== goldBefore + expectedRefund) {
      return `Sell refund mismatch: got ${refund}, expected ${expectedRefund}`;
    }
    tracker.expectedGold += refund;
    tracker.soldTowerKills += victimKills;
    tracker.soldTowerDamage += victimDamage;
    if (!world.grid.canPlaceTower(victim.col, victim.row)) {
      return `Tile (${victim.col},${victim.row}) remained blocked after sellTower`;
    }
    return null;
  }

  if (roll < upgradeCutoff && world.towers.length > 0) {
    _upgradableTowers.length = 0;
    for (let i = 0; i < world.towers.length; i++) {
      const t = world.towers[i];
      if (t.tier >= 3) continue;
      const nextTier = (t.tier + 1) as 2 | 3;
      if (world.gold >= getTowerTierStats(t.type, nextTier).upgradeCost) {
        _upgradableTowers.push(t);
      }
    }
    if (_upgradableTowers.length > 0) {
      const target = rng.pick(_upgradableTowers);
      const nextTier = (target.tier + 1) as 2 | 3;
      const cost = getTowerTierStats(target.type, nextTier).upgradeCost;
      const goldBefore = world.gold;
      const investedBefore = target.totalInvested;
      if (!world.upgradeTower(target.id)) {
        return `upgradeTower failed despite sufficient gold (${goldBefore} >= ${cost})`;
      }
      tracker.expectedGold -= cost;
      if (
        world.gold !== goldBefore - cost ||
        target.totalInvested !== investedBefore + cost ||
        target.tier !== nextTier
      ) {
        return `upgradeTower accounting mismatch on tower ${target.id}`;
      }
      return null;
    }
  }

  if (roll < retargetCutoff && world.towers.length > 0) {
    const tower = rng.pick(world.towers);
    const mode = rng.pick(TARGETING_MODES);
    world.setTowerTargeting(tower.id, mode);
    if (tower.targetingMode !== mode) {
      return `setTowerTargeting failed on tower ${tower.id}`;
    }
    tracker.usedTargetingModes.add(mode);
    return null;
  }

  // Try building on a free grass tile
  const maxTowers = profile === 'minimal' ? Math.max(2, Math.floor(tiles.length * 0.12)) : tiles.length;
  if (world.towers.length < maxTowers) {
    const type = chooseTowerType(world, rng, profile);
    if (type) {
      const coord = chooseTileForBuild(world, rng, tiles, type, profile);
      if (coord) {
        const mode = rng.pick(TARGETING_MODES);
        const cost = getTowerTierStats(type, 1).upgradeCost;
        const goldBefore = world.gold;
        const placed = world.placeTower(coord.col, coord.row, type, mode);
        if (!placed) {
          return `placeTower failed on legal grass tile (${coord.col},${coord.row}) for ${type}`;
        }
        tracker.usedTargetingModes.add(mode);
        tracker.expectedGold -= cost;
        if (world.gold !== goldBefore - cost || placed.totalInvested !== cost) {
          return `placeTower gold mismatch after building ${type}`;
        }
      }
    }
  }

  return null;
}

function buildDigest(
  level: LevelDef,
  seed: number,
  profile: FuzzProfile,
  storyOutcome: 'won' | 'lost' | 'timeout',
  world: SimWorld,
  tracker: FuzzTracker,
  ticks: number,
): FuzzStateDigest {
  let damageSum = 0;
  for (let i = 0; i < world.towers.length; i++) {
    damageSum += Math.round(world.towers[i].totalDamageDealt);
  }
  return {
    levelId: level.id,
    seed,
    profile,
    storyOutcome,
    finalOutcome: world.outcome,
    gold: world.gold,
    lives: world.lives,
    currentWaveOneBased: world.waveSystem.currentWaveOneBased,
    waveState: world.waveSystem.state,
    ticks,
    spawnedCount: tracker.spawnedCount,
    killedCount: tracker.killedCount,
    leakedCount: tracker.leakedCount,
    activeEnemiesAtEnd: world.enemyPool.getActiveCount(),
    towerCount: world.towers.length,
    totalDamageDealtSum: damageSum,
    peakEnemies: tracker.peakEnemies,
    peakProjectiles: tracker.peakProjectiles,
    enemyPoolOverflows: tracker.enemyPoolOverflows,
    projectilePoolOverflows: tracker.projectilePoolOverflows,
    endlessWavesCompleted: tracker.endlessWaveCompletedCount,
    stateHash: tracker.stateHash,
  };
}

function createFuzzTracker(startingGold: number, endlessWavesConfig: number): FuzzTracker {
  return {
    spawnedCount: 0,
    killedCount: 0,
    leakedCount: 0,
    gameWonCount: 0,
    gameLostCount: 0,
    endlessEnteredCount: 0,
    lastWinStars: 0,
    lastLossEndless: undefined,
    enemyPoolOverflows: 0,
    projectilePoolOverflows: 0,
    peakEnemies: 0,
    peakProjectiles: 0,
    seenSpawnUids: new Set<number>(),
    spawnedTypes: new Map<number, EnemyType>(),
    killedUids: new Set<number>(),
    killedSplitterUids: new Set<number>(),
    pendingDeathUids: new Set<number>(),
    builtTowerIds: new Set<number>(),
    towerById: new Map<number, TowerEntity>(),
    everBuiltTowerIds: new Set<number>(),
    maxEverTowerId: 0,
    builtTowerTypes: new Set<TowerType>(),
    usedTargetingModes: new Set<TargetingMode>(),
    spawnedEnemyTypes: new Set<EnemyType>(),
    killedEnemyTypes: new Set<EnemyType>(),
    maxTierReached: 0,
    soldTowerCount: 0,
    meteorCastCount: 0,
    overchargeCastCount: 0,
    splitterSplitCount: 0,
    healerPulseCount: 0,
    bossPulseCount: 0,
    bossSummonCount: 0,
    cleansedTowerCount: 0,
    endlessWaveCompletedCount: 0,
    expectedGold: startingGold,
    expectedLives: BALANCE.startingLives,
    pendingExpectedWaveBonus: 0,
    soldTowerKills: 0,
    soldTowerDamage: 0,
    totalEnemyHitDamage: 0,
    expectedNextWaveIndex: 0,
    lastWaveHpScale: 0,
    endlessWavesConfig,
    pendingSplitChildrenExpected: 0,
    newlyStunnedTowerIds: new Set<number>(),
    bossSummonedUids: new Set<number>(),
    bossesBelowHalfLastTick: new Set<number>(),
    prevTowerStats: new Map(),
    stateHash: 2166136261,
    eventInvariantError: null,
  };
}

function makeFailure(
  level: LevelDef,
  seed: number,
  profile: FuzzProfile,
  tick: number,
  world: SimWorld,
  tracker: FuzzTracker,
  storyOutcome: 'won' | 'lost' | 'timeout',
  reason: string,
  endlessOnly = false,
): FuzzRunResult {
  const reproCmd =
    `npx tsx scripts/fuzzPlay.ts --level ${level.index + 1} --seed ${seed} --profile ${profile} --endless-waves ${tracker.endlessWavesConfig}` +
    (endlessOnly ? ' --endless-only' : '');
  return {
    ok: false,
    failure: `[L${level.index + 1} ${level.id} seed=${seed} profile=${profile} tick=${tick} wave=${world.waveSystem.currentWaveOneBased}] ${reason} (repro: ${reproCmd})`,
    failureDetail: {
      levelId: level.id,
      levelIndex: level.index,
      seed,
      tick,
      waveOneBased: world.waveSystem.currentWaveOneBased,
      reason,
      reproCmd,
    },
    digest: buildDigest(level, seed, profile, storyOutcome, world, tracker, tick),
  };
}

function verifyPostEndImmutability(
  world: SimWorld,
  tiles: readonly ScoredTile[],
  tracker: FuzzTracker,
): string | null {
  const outcomeSnap = world.outcome;
  if (outcomeSnap === 'ongoing') return null;

  const goldSnap = world.gold;
  const livesSnap = world.lives;
  const towersSnap = world.towers.length;
  const killsSnap = world.enemiesKilledTotal;
  const wonSnap = tracker.gameWonCount;
  const lostSnap = tracker.gameLostCount;

  let freeTile: ScoredTile | undefined;
  for (let i = 0; i < tiles.length; i++) {
    if (world.grid.canPlaceTower(tiles[i].col, tiles[i].row)) {
      freeTile = tiles[i];
      break;
    }
  }
  if (freeTile && world.placeTower(freeTile.col, freeTile.row, 'archer') !== null) {
    return `placeTower succeeded after outcome=${outcomeSnap}`;
  }
  const existing = world.towers[0];
  if (existing) {
    if (existing.tier < 3 && world.upgradeTower(existing.id)) {
      return `upgradeTower succeeded after outcome=${outcomeSnap}`;
    }
    if (world.sellTower(existing.id) !== 0) {
      return `sellTower succeeded after outcome=${outcomeSnap}`;
    }
  }
  if (world.castMeteor(0, 0) || world.castOvercharge() || world.startNextWave()) {
    return `Ability or wave start succeeded after outcome=${outcomeSnap}`;
  }
  if (outcomeSnap === 'lost' && world.enterEndlessMode()) {
    return `enterEndlessMode succeeded after outcome=lost`;
  }
  world.debugForceWin();
  world.debugForceLose();

  world.fixedTick(BALANCE.fixedDt);
  if (
    world.outcome !== outcomeSnap ||
    world.gold !== goldSnap ||
    world.lives !== livesSnap ||
    world.towers.length !== towersSnap ||
    world.enemiesKilledTotal !== killsSnap ||
    tracker.gameWonCount !== wonSnap ||
    tracker.gameLostCount !== lostSnap
  ) {
    return `Post-end actions/fixedTick mutated world after outcome=${outcomeSnap}`;
  }
  return null;
}

interface FuzzStepContext {
  readonly world: SimWorld;
  readonly stepper: FixedTimestepStepper;
  readonly rng: SeededRng;
  readonly tiles: readonly ScoredTile[];
  readonly profile: FuzzProfile;
  readonly tracker: FuzzTracker;
  readonly onTick: (fixedDt: number) => void;
  readonly onPausedTick: () => void;
  maxTicksLimit: number;
  targetEndlessWaves: number;
  tickCount: number;
  nextActionTick: number;
  fatalReason: string | null;
}

function createFuzzStepContext(
  world: SimWorld,
  stepper: FixedTimestepStepper,
  rng: SeededRng,
  tiles: readonly ScoredTile[],
  profile: FuzzProfile,
  tracker: FuzzTracker,
  nextActionTick: number,
  maxTicksLimit: number,
): FuzzStepContext {
  const ctx: FuzzStepContext = {
    world,
    stepper,
    rng,
    tiles,
    profile,
    tracker,
    maxTicksLimit,
    targetEndlessWaves: -1,
    tickCount: 0,
    nextActionTick,
    fatalReason: null,
    onPausedTick: () => {
      ctx.fatalReason = 'FixedTimestepStepper ticked while paused';
    },
    onTick: (fixedDt: number) => {
      if (
        ctx.fatalReason ||
        ctx.world.outcome !== 'ongoing' ||
        (ctx.targetEndlessWaves >= 0 && ctx.tracker.endlessWaveCompletedCount >= ctx.targetEndlessWaves) ||
        ctx.tickCount >= ctx.maxTicksLimit
      ) {
        return;
      }
      ctx.tickCount++;
      const prevWaveState = world.waveSystem.state;
      const prevMeteorCd = world.abilitySystem.getCooldown('meteor');
      const prevOverchargeCd = world.abilitySystem.getCooldown('overcharge');
      try {
        world.fixedTick(fixedDt);
      } catch (err) {
        ctx.fatalReason = `Uncaught error in fixedTick: ${err instanceof Error ? err.message : String(err)}`;
        return;
      }

      if (prevWaveState === 'betweenWaves' && world.waveSystem.state === 'betweenWaves') {
        if (
          world.abilitySystem.getCooldown('meteor') !== prevMeteorCd ||
          world.abilitySystem.getCooldown('overcharge') !== prevOverchargeCd
        ) {
          ctx.fatalReason = 'Ability cooldown changed during betweenWaves idle countdown';
          return;
        }
      }

      const invErr = assertTickInvariants(world, tracker, ctx.tickCount);
      if (invErr) {
        ctx.fatalReason = invErr;
        return;
      }

      if (ctx.tickCount >= ctx.nextActionTick && world.outcome === 'ongoing') {
        const actErr = performLegalAction(world, rng, tiles, profile, tracker);
        if (actErr) {
          ctx.fatalReason = actErr;
          return;
        }
        ctx.nextActionTick = ctx.tickCount + rng.int(18, 65);
      }
    },
  };
  return ctx;
}

function buildCoverageStats(tracker: FuzzTracker): FuzzCoverageStats {
  return {
    towerTypesBuilt: [...tracker.builtTowerTypes],
    maxTierReached: tracker.maxTierReached,
    towersSold: tracker.soldTowerCount,
    meteorCasts: tracker.meteorCastCount,
    overchargeCasts: tracker.overchargeCastCount,
    targetingModesUsed: [...tracker.usedTargetingModes],
    enemyTypesSpawned: [...tracker.spawnedEnemyTypes],
    enemyTypesKilled: [...tracker.killedEnemyTypes],
    splitterSplits: tracker.splitterSplitCount,
    healerPulses: tracker.healerPulseCount,
    bossPulses: tracker.bossPulseCount,
    bossSummons: tracker.bossSummonCount,
    cleansedTowers: tracker.cleansedTowerCount,
  };
}

function stepFuzzFrame(ctx: FuzzStepContext): void {
  const { stepper, rng } = ctx;
  if (rng.chance(0.08)) {
    stepper.speed = rng.pick(SPEEDS);
  }
  if (rng.chance(0.02)) {
    stepper.paused = true;
    const pausedStep = stepper.step(rng.pick(FRAME_DTS), ctx.onPausedTick);
    if (pausedStep.ticksExecuted !== 0) {
      ctx.fatalReason = `Expected 0 ticks while paused, got ${pausedStep.ticksExecuted}`;
    }
    stepper.paused = false;
    if (ctx.fatalReason) return;
  }

  const frameDt = rng.pick(FRAME_DTS);
  const stepRes = stepper.step(frameDt, ctx.onTick);
  if (
    !ctx.fatalReason &&
    (!Number.isFinite(stepRes.alpha) ||
      stepRes.alpha < 0 ||
      stepRes.alpha > 1 ||
      !Number.isFinite(stepRes.elapsedVisualTime))
  ) {
    ctx.fatalReason = `Invalid FixedTimestepStepper state: alpha=${stepRes.alpha}, visualTime=${stepRes.elapsedVisualTime}`;
  }
}

/**
 * Runs a single deterministic seeded fuzz playthrough for `level`:
 * drives SimWorld via FixedTimestepStepper (varying speeds/pauses/auto-wave),
 * performs legal build/upgrade/sell/retarget/ability/wave-call actions,
 * checks strict invariants every tick, and if story mode is won, enters Endless Mode
 * for up to `endlessWaves` waves.
 */
export function runFuzzPlaythrough(
  level: LevelDef,
  seed: number,
  options: FuzzPlayOptions = {},
): FuzzRunResult {
  const endlessWaves = options.endlessWaves ?? 4;
  const maxStoryTicks = options.maxStoryTicks ?? 60 * 3000;
  const maxEndlessTicks = options.maxEndlessTicks ?? 60 * 1500;
  const rng = new SeededRng(seed);
  const profile = options.profile ?? FUZZ_PROFILES[Math.abs(seed) % FUZZ_PROFILES.length];

  const events = new EventBus();
  const world = new SimWorld(level, events);
  const stepper = new FixedTimestepStepper();
  stepper.simActive = true;
  const tiles = buildScoredGrassTiles(world);

  const tracker = createFuzzTracker(level.startingGold, endlessWaves);

  let inEndless = false;
  let storyOutcome: 'won' | 'lost' | 'timeout' = 'timeout';

  instrumentPools(world, tracker);
  attachEventTracker(world, events, tracker, () => inEndless);

  // Pre-wave 1 setup: build initial affordable towers and start wave 1
  for (let i = 0; i < 6 && world.outcome === 'ongoing'; i++) {
    const err = performLegalAction(world, rng, tiles, profile, tracker);
    if (err) return makeFailure(level, seed, profile, 0, world, tracker, storyOutcome, err);
    if (world.waveSystem.state !== 'preFirstWave') break;
  }
  if (world.waveSystem.state === 'preFirstWave') {
    world.startNextWave();
  }

  const stepCtx = createFuzzStepContext(
    world,
    stepper,
    rng,
    tiles,
    profile,
    tracker,
    rng.int(20, 75),
    maxStoryTicks,
  );

  while (world.outcome === 'ongoing' && stepCtx.tickCount < maxStoryTicks && !stepCtx.fatalReason) {
    stepFuzzFrame(stepCtx);
  }

  if (stepCtx.fatalReason) {
    return makeFailure(level, seed, profile, stepCtx.tickCount, world, tracker, storyOutcome, stepCtx.fatalReason);
  }

  if (world.outcome === 'ongoing') {
    return makeFailure(
      level,
      seed,
      profile,
      stepCtx.tickCount,
      world,
      tracker,
      'timeout',
      `Story playthrough did not terminate within ${maxStoryTicks} ticks (wave ${world.waveSystem.currentWaveOneBased}, state=${world.waveSystem.state})`,
    );
  }

  storyOutcome = world.outcome;

  if (storyOutcome === 'won') {
    if (tracker.gameWonCount !== 1 || tracker.gameLostCount !== 0) {
      return makeFailure(
        level,
        seed,
        profile,
        stepCtx.tickCount,
        world,
        tracker,
        storyOutcome,
        `Expected gameWon=1 & gameLost=0 on win, got won=${tracker.gameWonCount}, lost=${tracker.gameLostCount}`,
      );
    }
    if (tracker.lastWinStars !== computeStarRating(world.lives)) {
      return makeFailure(
        level,
        seed,
        profile,
        stepCtx.tickCount,
        world,
        tracker,
        storyOutcome,
        `gameWon stars ${tracker.lastWinStars} != computeStarRating(${world.lives})`,
      );
    }
    if (world.enemyPool.getActiveCount() !== 0) {
      return makeFailure(
        level,
        seed,
        profile,
        stepCtx.tickCount,
        world,
        tracker,
        storyOutcome,
        `Expected 0 active enemies on win, got ${world.enemyPool.getActiveCount()}`,
      );
    }
    if (tracker.spawnedCount !== tracker.killedCount + tracker.leakedCount) {
      return makeFailure(
        level,
        seed,
        profile,
        stepCtx.tickCount,
        world,
        tracker,
        storyOutcome,
        `Not all spawned enemies resolved at win: spawned=${tracker.spawnedCount}, killed=${tracker.killedCount}, leaked=${tracker.leakedCount}`,
      );
    }
    if (tracker.enemyPoolOverflows > 0 || tracker.projectilePoolOverflows > 0) {
      return makeFailure(
        level,
        seed,
        profile,
        stepCtx.tickCount,
        world,
        tracker,
        storyOutcome,
        `Pool overflow during story play: enemy=${tracker.enemyPoolOverflows}, projectile=${tracker.projectilePoolOverflows}`,
      );
    }

    const postWinErr = verifyPostEndImmutability(world, tiles, tracker);
    if (postWinErr) {
      return makeFailure(level, seed, profile, stepCtx.tickCount, world, tracker, storyOutcome, postWinErr);
    }

    if (endlessWaves > 0) {
      inEndless = true;
      const entered = world.enterEndlessMode();
      const getOutcome = (): SimWorld['outcome'] => world.outcome;
      const getLostCount = (): number => tracker.gameLostCount;
      if (!entered || tracker.endlessEnteredCount !== 1 || getOutcome() !== 'ongoing') {
        return makeFailure(
          level,
          seed,
          profile,
          stepCtx.tickCount,
          world,
          tracker,
          storyOutcome,
          `enterEndlessMode() failed after story victory`,
        );
      }
      const endlessTickCap = stepCtx.tickCount + maxEndlessTicks;
      stepCtx.maxTicksLimit = endlessTickCap;
      stepCtx.targetEndlessWaves = endlessWaves;
      while (
        getOutcome() === 'ongoing' &&
        tracker.endlessWaveCompletedCount < endlessWaves &&
        stepCtx.tickCount < endlessTickCap &&
        !stepCtx.fatalReason
      ) {
        stepFuzzFrame(stepCtx);
      }
      if (stepCtx.fatalReason) {
        return makeFailure(level, seed, profile, stepCtx.tickCount, world, tracker, storyOutcome, stepCtx.fatalReason);
      }
      if (getOutcome() === 'ongoing' && tracker.endlessWaveCompletedCount < endlessWaves) {
        return makeFailure(
          level,
          seed,
          profile,
          stepCtx.tickCount,
          world,
          tracker,
          storyOutcome,
          `Endless mode stalled before ${endlessWaves} waves (completed ${tracker.endlessWaveCompletedCount})`,
        );
      }
      if (tracker.gameWonCount !== 1) {
        return makeFailure(
          level,
          seed,
          profile,
          stepCtx.tickCount,
          world,
          tracker,
          storyOutcome,
          `gameWon fired again during endless mode (count=${tracker.gameWonCount})`,
        );
      }
      if (getOutcome() === 'lost') {
        if (getLostCount() !== 1 || tracker.lastLossEndless !== true) {
          return makeFailure(
            level,
            seed,
            profile,
            stepCtx.tickCount,
            world,
            tracker,
            storyOutcome,
            `Endless loss did not emit gameLost once with endless=true`,
          );
        }
        const postEndlessLossErr = verifyPostEndImmutability(world, tiles, tracker);
        if (postEndlessLossErr) {
          return makeFailure(
            level,
            seed,
            profile,
            stepCtx.tickCount,
            world,
            tracker,
            storyOutcome,
            postEndlessLossErr,
          );
        }
      }
    }
  } else {
    if (tracker.gameLostCount !== 1 || tracker.gameWonCount !== 0 || world.lives !== 0) {
      return makeFailure(
        level,
        seed,
        profile,
        stepCtx.tickCount,
        world,
        tracker,
        storyOutcome,
        `Expected gameLost=1, gameWon=0, lives=0 on loss; got lost=${tracker.gameLostCount}, won=${tracker.gameWonCount}, lives=${world.lives}`,
      );
    }
    if (tracker.enemyPoolOverflows > 0 || tracker.projectilePoolOverflows > 0) {
      return makeFailure(
        level,
        seed,
        profile,
        stepCtx.tickCount,
        world,
        tracker,
        storyOutcome,
        `Pool overflow during story play: enemy=${tracker.enemyPoolOverflows}, projectile=${tracker.projectilePoolOverflows}`,
      );
    }

    const postLossErr = verifyPostEndImmutability(world, tiles, tracker);
    if (postLossErr) {
      return makeFailure(level, seed, profile, stepCtx.tickCount, world, tracker, storyOutcome, postLossErr);
    }
  }

  return {
    ok: true,
    digest: buildDigest(level, seed, profile, storyOutcome, world, tracker, stepCtx.tickCount),
    coverage: buildCoverageStats(tracker),
  };
}

/**
 * Runs a dedicated Endless Mode fuzz check on `level` by applying its scripted defense
 * (when present) or path-aware towers, winning, entering endless mode, and fuzzing `wavesTarget`
 * endless waves cleanly without pool overflows or errors.
 */
export function runEndlessFuzz(
  level: LevelDef,
  seed: number,
  wavesTarget = 5,
  profile: FuzzProfile = 'competent',
): FuzzRunResult {
  const rng = new SeededRng(seed);
  const events = new EventBus();
  const world = new SimWorld(level, events);
  const stepper = new FixedTimestepStepper();
  stepper.simActive = true;
  const tiles = buildScoredGrassTiles(world);

  const tracker = createFuzzTracker(level.startingGold, wavesTarget);

  let inEndless = false;

  instrumentPools(world, tracker);
  attachEventTracker(world, events, tracker, () => inEndless);

  // Deploy scripted late-game defense so endless waves play through multiple wave clears
  world.gold = Math.max(world.gold, 8000);
  if (level.scriptedBuildOrder && level.scriptedBuildOrder.length > 0) {
    for (const act of level.scriptedBuildOrder) {
      if (act.action === 'build' && act.towerType) {
        const mode = act.targetingMode ?? 'first';
        if (world.placeTower(act.col, act.row, act.towerType, mode)) {
          tracker.usedTargetingModes.add(mode);
        }
      } else if (act.action === 'upgrade') {
        const tid = world.grid.getTowerIdAt(act.col, act.row);
        if (tid !== -1) world.upgradeTower(tid);
      }
    }
  } else {
    for (let i = 0; i < Math.min(12, tiles.length); i++) {
      const type = chooseTowerType(world, rng, profile);
      if (!type) break;
      const coord = chooseTileForBuild(world, rng, tiles, type, profile);
      if (coord) {
        const mode = rng.pick(TARGETING_MODES);
        if (world.placeTower(coord.col, coord.row, type, mode)) {
          tracker.usedTargetingModes.add(mode);
        }
      }
    }
  }

  tracker.expectedGold = world.gold;
  world.debugForceWin();
  inEndless = true;
  if (!world.enterEndlessMode() || tracker.endlessEnteredCount !== 1 || world.outcome !== 'ongoing') {
    return makeFailure(
      level,
      seed,
      profile,
      0,
      world,
      tracker,
      'won',
      'enterEndlessMode() failed',
      true,
    );
  }
  if (wavesTarget > 0) {
    world.startNextWave();
  }
  const initialInvErr = assertTickInvariants(world, tracker, 0);
  if (initialInvErr) {
    return makeFailure(level, seed, profile, 0, world, tracker, 'won', initialInvErr, true);
  }

  const maxTicks = 60 * 1500;
  const stepCtx = createFuzzStepContext(
    world,
    stepper,
    rng,
    tiles,
    profile,
    tracker,
    rng.int(20, 60),
    maxTicks,
  );
  stepCtx.targetEndlessWaves = wavesTarget;

  while (
    world.outcome === 'ongoing' &&
    tracker.endlessWaveCompletedCount < wavesTarget &&
    stepCtx.tickCount < maxTicks &&
    !stepCtx.fatalReason
  ) {
    stepFuzzFrame(stepCtx);
  }

  if (stepCtx.fatalReason) {
    return makeFailure(level, seed, profile, stepCtx.tickCount, world, tracker, 'won', stepCtx.fatalReason, true);
  }
  if (world.outcome === 'ongoing' && tracker.endlessWaveCompletedCount < wavesTarget) {
    return makeFailure(
      level,
      seed,
      profile,
      stepCtx.tickCount,
      world,
      tracker,
      'won',
      `Endless mode stalled at wave ${world.waveSystem.currentWaveOneBased} (${tracker.endlessWaveCompletedCount}/${wavesTarget} endless waves completed)`,
      true,
    );
  }
  if (tracker.enemyPoolOverflows > 0 || tracker.projectilePoolOverflows > 0) {
    return makeFailure(
      level,
      seed,
      profile,
      stepCtx.tickCount,
      world,
      tracker,
      'won',
      `Pool overflow during endless run: enemy=${tracker.enemyPoolOverflows}, projectile=${tracker.projectilePoolOverflows}`,
      true,
    );
  }
  if (tracker.gameWonCount !== 1) {
    return makeFailure(
      level,
      seed,
      profile,
      stepCtx.tickCount,
      world,
      tracker,
      'won',
      `gameWon fired ${tracker.gameWonCount} times (expected 1)`,
      true,
    );
  }
  if (world.outcome === 'lost') {
    if (tracker.gameLostCount !== 1 || tracker.lastLossEndless !== true) {
      return makeFailure(
        level,
        seed,
        profile,
        stepCtx.tickCount,
        world,
        tracker,
        'won',
        `Endless loss did not emit gameLost once with endless=true`,
        true,
      );
    }
    const postLossErr = verifyPostEndImmutability(world, tiles, tracker);
    if (postLossErr) {
      return makeFailure(level, seed, profile, stepCtx.tickCount, world, tracker, 'won', postLossErr, true);
    }
  }

  return {
    ok: true,
    digest: buildDigest(level, seed, profile, 'won', world, tracker, stepCtx.tickCount),
    coverage: buildCoverageStats(tracker),
  };
}

export function digestsEqual(a: FuzzStateDigest, b: FuzzStateDigest): boolean {
  return (
    a.levelId === b.levelId &&
    a.seed === b.seed &&
    a.profile === b.profile &&
    a.storyOutcome === b.storyOutcome &&
    a.finalOutcome === b.finalOutcome &&
    a.gold === b.gold &&
    a.lives === b.lives &&
    a.currentWaveOneBased === b.currentWaveOneBased &&
    a.waveState === b.waveState &&
    a.ticks === b.ticks &&
    a.spawnedCount === b.spawnedCount &&
    a.killedCount === b.killedCount &&
    a.leakedCount === b.leakedCount &&
    a.activeEnemiesAtEnd === b.activeEnemiesAtEnd &&
    a.towerCount === b.towerCount &&
    a.totalDamageDealtSum === b.totalDamageDealtSum &&
    a.peakEnemies === b.peakEnemies &&
    a.peakProjectiles === b.peakProjectiles &&
    a.endlessWavesCompleted === b.endlessWavesCompleted &&
    a.stateHash === b.stateHash
  );
}

export interface FuzzCampaignSummary {
  readonly totalRuns: number;
  readonly passedRuns: number;
  readonly storyWins: number;
  readonly storyLosses: number;
  readonly endlessChecks: number;
  readonly endlessWavesCompletedTotal: number;
  readonly determinismChecks: number;
  readonly failures: readonly FuzzRunResult[];
  readonly maxPeakEnemies: number;
  readonly maxPeakProjectiles: number;
  readonly coverage: FuzzCoverageStats;
}

export function runFuzzCampaign(config: {
  seedsPerLevel: number;
  baseSeed: number;
  endlessWaves: number;
  levelIndices?: readonly number[];
  profile?: FuzzProfile;
  endlessOnly?: boolean;
}): FuzzCampaignSummary {
  const indices = config.levelIndices ?? LEVELS.map((_, idx) => idx);
  const failures: FuzzRunResult[] = [];
  let totalRuns = 0;
  let passedRuns = 0;
  let storyWins = 0;
  let storyLosses = 0;
  let endlessChecks = 0;
  let endlessWavesCompletedTotal = 0;
  let determinismChecks = 0;
  let maxPeakEnemies = 0;
  let maxPeakProjectiles = 0;
  const towerTypesBuilt = new Set<TowerType>();
  const targetingModesUsed = new Set<TargetingMode>();
  const enemyTypesSpawned = new Set<EnemyType>();
  const enemyTypesKilled = new Set<EnemyType>();
  let maxTierReached = 0;
  let towersSold = 0;
  let meteorCasts = 0;
  let overchargeCasts = 0;
  let splitterSplits = 0;
  let healerPulses = 0;
  let bossPulses = 0;
  let bossSummons = 0;
  let cleansedTowers = 0;

  const mergeCoverage = (cov?: FuzzCoverageStats): void => {
    if (!cov) return;
    for (const t of cov.towerTypesBuilt) towerTypesBuilt.add(t);
    for (const m of cov.targetingModesUsed) targetingModesUsed.add(m);
    for (const e of cov.enemyTypesSpawned) enemyTypesSpawned.add(e);
    for (const e of cov.enemyTypesKilled) enemyTypesKilled.add(e);
    if (cov.maxTierReached > maxTierReached) maxTierReached = cov.maxTierReached;
    towersSold += cov.towersSold;
    meteorCasts += cov.meteorCasts;
    overchargeCasts += cov.overchargeCasts;
    splitterSplits += cov.splitterSplits;
    healerPulses += cov.healerPulses;
    bossPulses += cov.bossPulses;
    bossSummons += cov.bossSummons;
    cleansedTowers += cov.cleansedTowers;
  };

  for (const li of indices) {
    const level = LEVELS[li];
    if (!level) continue;

    if (!config.endlessOnly) {
      for (let s = 0; s < config.seedsPerLevel; s++) {
        const seed = config.baseSeed + li * 1009 + s * 97;
        const profile = config.profile ?? FUZZ_PROFILES[s % FUZZ_PROFILES.length];
        const res = runFuzzPlaythrough(level, seed, { endlessWaves: config.endlessWaves, profile });
        totalRuns++;
        maxPeakEnemies = Math.max(maxPeakEnemies, res.digest.peakEnemies);
        maxPeakProjectiles = Math.max(maxPeakProjectiles, res.digest.peakProjectiles);
        mergeCoverage(res.coverage);

        if (!res.ok) {
          failures.push(res);
        } else {
          passedRuns++;
          if (res.digest.storyOutcome === 'won') storyWins++;
          else if (res.digest.storyOutcome === 'lost') storyLosses++;
        }

        // Verify determinism on first seed of each level
        if (s === 0 && res.ok) {
          determinismChecks++;
          const replay = runFuzzPlaythrough(level, seed, { endlessWaves: config.endlessWaves, profile });
          if (!replay.ok) {
            failures.push(replay);
          } else if (!digestsEqual(res.digest, replay.digest)) {
            const reproCmd = `npx tsx scripts/fuzzPlay.ts --level ${level.index + 1} --seed ${seed} --profile ${profile} --endless-waves ${config.endlessWaves}`;
            failures.push({
              ok: false,
              failure: `[L${level.index + 1} ${level.id} seed=${seed} profile=${profile}] Determinism failure: replay digest differed (repro: ${reproCmd})`,
              failureDetail: {
                levelId: level.id,
                levelIndex: level.index,
                seed,
                tick: replay.digest.ticks,
                waveOneBased: replay.digest.currentWaveOneBased,
                reason: 'Determinism failure: replay digest differed',
                reproCmd,
              },
              digest: replay.digest,
            });
          }
        }
      }
    }

    // Dedicated endless mode pass per level so every island exercises N endless waves
    if (config.endlessWaves > 0) {
      const endlessCount = config.endlessOnly ? config.seedsPerLevel : 1;
      for (let s = 0; s < endlessCount; s++) {
        const endlessSeed = config.baseSeed + li * 7919 + 42 + s * 97;
        const endlessProfile =
          config.profile ?? (config.endlessOnly ? FUZZ_PROFILES[(s + 1) % FUZZ_PROFILES.length] : 'competent');
        const eRes = runEndlessFuzz(level, endlessSeed, config.endlessWaves, endlessProfile);
        endlessChecks++;
        endlessWavesCompletedTotal += eRes.digest.endlessWavesCompleted;
        maxPeakEnemies = Math.max(maxPeakEnemies, eRes.digest.peakEnemies);
        maxPeakProjectiles = Math.max(maxPeakProjectiles, eRes.digest.peakProjectiles);
        mergeCoverage(eRes.coverage);
        if (!eRes.ok) {
          failures.push(eRes);
        } else if (config.endlessOnly && s === 0) {
          determinismChecks++;
          const replay = runEndlessFuzz(level, endlessSeed, config.endlessWaves, endlessProfile);
          if (!replay.ok) {
            failures.push(replay);
          } else if (!digestsEqual(eRes.digest, replay.digest)) {
            const reproCmd = `npx tsx scripts/fuzzPlay.ts --level ${level.index + 1} --seed ${endlessSeed} --profile ${endlessProfile} --endless-waves ${config.endlessWaves} --endless-only`;
            failures.push({
              ok: false,
              failure: `[L${level.index + 1} ${level.id} seed=${endlessSeed} profile=${endlessProfile}] Endless determinism failure: replay digest differed (repro: ${reproCmd})`,
              failureDetail: {
                levelId: level.id,
                levelIndex: level.index,
                seed: endlessSeed,
                tick: replay.digest.ticks,
                waveOneBased: replay.digest.currentWaveOneBased,
                reason: 'Endless determinism failure: replay digest differed',
                reproCmd,
              },
              digest: replay.digest,
            });
          }
        }
      }
    }
  }

  return {
    totalRuns,
    passedRuns,
    storyWins,
    storyLosses,
    endlessChecks,
    endlessWavesCompletedTotal,
    determinismChecks,
    failures,
    maxPeakEnemies,
    maxPeakProjectiles,
    coverage: {
      towerTypesBuilt: [...towerTypesBuilt],
      maxTierReached,
      towersSold,
      meteorCasts,
      overchargeCasts,
      targetingModesUsed: [...targetingModesUsed],
      enemyTypesSpawned: [...enemyTypesSpawned],
      enemyTypesKilled: [...enemyTypesKilled],
      splitterSplits,
      healerPulses,
      bossPulses,
      bossSummons,
      cleansedTowers,
    },
  };
}

const VALUE_FLAGS = new Set(['seeds', 'seed', 'level', 'levels', 'endless-waves', 'profile']);
const BOOLEAN_FLAGS = new Set(['endless-only', 'json', 'help']);

function validateCliFlags(argv: readonly string[]): void {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h') continue;
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument "${arg}". Run with --help for usage.`);
    }
    const eqIdx = arg.indexOf('=');
    const flagName = eqIdx === -1 ? arg.slice(2) : arg.slice(2, eqIdx);
    if (BOOLEAN_FLAGS.has(flagName)) {
      if (eqIdx !== -1) {
        throw new Error(`Flag --${flagName} does not take a value`);
      }
      continue;
    }
    if (!VALUE_FLAGS.has(flagName)) {
      throw new Error(`Unknown flag "--${flagName}". Run with --help for usage.`);
    }
    if (eqIdx === -1) {
      if (i + 1 >= argv.length) {
        throw new Error(`Flag --${flagName} requires a value`);
      }
      i++;
    }
  }
}

function parseArgValue(argv: readonly string[], name: string): string | null {
  const prefix = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === `--${name}` && i + 1 < argv.length) return argv[i + 1];
  }
  return null;
}

export interface ParsedFuzzCliArgs {
  readonly seedsPerLevel: number;
  readonly singleSeedMode: boolean;
  readonly endlessOnly: boolean;
  readonly json: boolean;
  readonly baseSeed: number;
  readonly endlessWaves: number;
  readonly levelIndices?: readonly number[];
  readonly profile?: FuzzProfile;
}

export function parseFuzzCliArgs(argv: readonly string[]): ParsedFuzzCliArgs {
  validateCliFlags(argv);

  const seedsArg = parseArgValue(argv, 'seeds');
  const singleSeedArg = parseArgValue(argv, 'seed');
  const levelArg = parseArgValue(argv, 'level') ?? parseArgValue(argv, 'levels');
  const endlessArg = parseArgValue(argv, 'endless-waves');
  const profileArg = parseArgValue(argv, 'profile');
  const endlessOnly = argv.includes('--endless-only');
  const json = argv.includes('--json');

  let profile: FuzzProfile | undefined;
  if (profileArg !== null) {
    if (!(FUZZ_PROFILES as readonly string[]).includes(profileArg)) {
      throw new Error(
        `Invalid --profile "${profileArg}". Valid profiles: ${FUZZ_PROFILES.join(', ')}`,
      );
    }
    profile = profileArg as FuzzProfile;
  }

  let baseSeed = 1336;
  if (singleSeedArg !== null) {
    if (singleSeedArg.trim() === '') {
      throw new Error(`Invalid --seed value: "${singleSeedArg}"`);
    }
    baseSeed = Number(singleSeedArg);
    if (!Number.isInteger(baseSeed)) {
      throw new Error(`Invalid --seed value: "${singleSeedArg}"`);
    }
  }

  let seedsPerLevel = 1;
  if (!singleSeedArg) {
    if (seedsArg !== null) {
      if (seedsArg.trim() === '') {
        throw new Error(`Invalid --seeds value: "${seedsArg}"`);
      }
      const parsedSeeds = Number(seedsArg);
      if (!Number.isInteger(parsedSeeds) || parsedSeeds < 1) {
        throw new Error(`Invalid --seeds value: "${seedsArg}" (expected integer >= 1)`);
      }
      seedsPerLevel = parsedSeeds;
    } else {
      seedsPerLevel = 8;
    }
  }

  let endlessWaves = 5;
  if (endlessArg !== null) {
    if (endlessArg.trim() === '') {
      throw new Error(`Invalid --endless-waves value: "${endlessArg}"`);
    }
    const parsedEndless = Number(endlessArg);
    if (!Number.isInteger(parsedEndless) || parsedEndless < 0) {
      throw new Error(`Invalid --endless-waves value: "${endlessArg}" (expected integer >= 0)`);
    }
    endlessWaves = parsedEndless;
  }

  let levelIndices: number[] | undefined;
  if (levelArg !== null) {
    const tokens = levelArg.split(',').map((x) => x.trim());
    levelIndices = [];
    const seenLevels = new Set<number>();
    for (const token of tokens) {
      const idx = token === '' ? NaN : Number(token) - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx >= LEVELS.length) {
        throw new Error(`No valid levels matched --level="${levelArg}" (1..${LEVELS.length})`);
      }
      if (!seenLevels.has(idx)) {
        seenLevels.add(idx);
        levelIndices.push(idx);
      }
    }
  }

  return {
    seedsPerLevel,
    singleSeedMode: singleSeedArg !== null,
    endlessOnly,
    json,
    baseSeed,
    endlessWaves,
    levelIndices,
    profile,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(
      'Usage: npm run sim:fuzz [-- --seeds N] [--seed S] [--level L] [--profile P] [--endless-waves W] [--endless-only] [--json]',
    );
    console.log(`  Profiles: ${FUZZ_PROFILES.join(', ')}`);
    return;
  }

  const parsed = parseFuzzCliArgs(argv);

  if (parsed.singleSeedMode && parsed.levelIndices && parsed.levelIndices.length === 1) {
    const level = LEVELS[parsed.levelIndices[0]];
    const resolvedProfile = parsed.endlessOnly
      ? (parsed.profile ?? 'competent')
      : (parsed.profile ?? FUZZ_PROFILES[Math.abs(parsed.baseSeed) % FUZZ_PROFILES.length]);
    const modeLabel = parsed.endlessOnly ? `endless-only, profile=${resolvedProfile}` : `profile=${resolvedProfile}`;
    if (!parsed.json) {
      console.log(
        `=== Skyhold Isles Fuzz Repro: L${level.index + 1} ${level.name}, seed=${parsed.baseSeed}, ${modeLabel} ===`,
      );
    }
    const t0 = performance.now();
    const res = parsed.endlessOnly
      ? runEndlessFuzz(level, parsed.baseSeed, parsed.endlessWaves, resolvedProfile)
      : runFuzzPlaythrough(level, parsed.baseSeed, {
          endlessWaves: parsed.endlessWaves,
          profile: resolvedProfile,
        });
    const replay = parsed.endlessOnly
      ? runEndlessFuzz(level, parsed.baseSeed, parsed.endlessWaves, resolvedProfile)
      : runFuzzPlaythrough(level, parsed.baseSeed, {
          endlessWaves: parsed.endlessWaves,
          profile: resolvedProfile,
        });
    const dt = (performance.now() - t0) / 1000;
    const deterministic = res.ok && replay.ok && digestsEqual(res.digest, replay.digest);

    if (parsed.json) {
      console.log(
        JSON.stringify(
          {
            mode: 'repro',
            endlessOnly: parsed.endlessOnly,
            passed: res.ok && deterministic,
            deterministic,
            elapsedSec: dt,
            failure: res.failure ?? null,
            digest: res.digest,
          },
          null,
          2,
        ),
      );
    } else {
      console.log('Digest:', res.digest);
    }

    if (!res.ok) {
      if (!parsed.json) console.error('FAILED:', res.failure);
      process.exit(1);
    }
    if (!deterministic) {
      if (!parsed.json) console.error('FAILED: Non-deterministic replay!', { first: res.digest, replay: replay.digest });
      process.exit(1);
    }
    if (!parsed.json) {
      console.log(`PASSED in ${dt.toFixed(2)}s`);
    }
    return;
  }

  const profileNote = parsed.profile ? `, profile=${parsed.profile}` : '';
  if (!parsed.json) {
    console.log(
      `=== Skyhold Isles Fuzz Playthrough Harness (${parsed.seedsPerLevel} seeds/island, endless=${parsed.endlessWaves} waves${parsed.endlessOnly ? ', endless-only' : ''}${profileNote}) ===`,
    );
  }
  const startMs = performance.now();
  const summary = runFuzzCampaign({
    seedsPerLevel: parsed.seedsPerLevel,
    baseSeed: parsed.baseSeed,
    endlessWaves: parsed.endlessWaves,
    levelIndices: parsed.levelIndices,
    profile: parsed.profile,
    endlessOnly: parsed.endlessOnly,
  });
  const elapsedSec = (performance.now() - startMs) / 1000;

  if (parsed.json) {
    console.log(
      JSON.stringify(
        {
          mode: 'campaign',
          endlessOnly: parsed.endlessOnly,
          passed: summary.failures.length === 0,
          elapsedSec,
          totalRuns: summary.totalRuns,
          passedRuns: summary.passedRuns,
          storyWins: summary.storyWins,
          storyLosses: summary.storyLosses,
          endlessChecks: summary.endlessChecks,
          endlessWavesCompletedTotal: summary.endlessWavesCompletedTotal,
          determinismChecks: summary.determinismChecks,
          maxPeakEnemies: summary.maxPeakEnemies,
          maxPeakProjectiles: summary.maxPeakProjectiles,
          maxPoolEnemies: BALANCE.pools.maxEnemies,
          maxPoolProjectiles: BALANCE.pools.maxProjectiles,
          coverage: summary.coverage,
          failures: summary.failures.map((f) => f.failure ?? 'Unknown failure'),
        },
        null,
        2,
      ),
    );
    if (summary.failures.length > 0) {
      process.exit(1);
    }
    return;
  }

  console.log(
    `Completed ${summary.totalRuns} story runs (wins=${summary.storyWins}, losses=${summary.storyLosses}) + ` +
      `${summary.endlessChecks} endless runs (${summary.endlessWavesCompletedTotal} endless waves cleared) + ` +
      `${summary.determinismChecks} determinism checks in ${elapsedSec.toFixed(2)}s`,
  );
  console.log(
    `Peak pools observed: enemies=${summary.maxPeakEnemies}/${BALANCE.pools.maxEnemies}, ` +
      `projectiles=${summary.maxPeakProjectiles}/${BALANCE.pools.maxProjectiles}`,
  );
  console.log(
    `Coverage: towers=${summary.coverage.towerTypesBuilt.length}/${TOWER_TYPES.length} (T${summary.coverage.maxTierReached}), ` +
      `enemies=${summary.coverage.enemyTypesKilled.length}/${ENEMY_TYPES.length} killed, ` +
      `splits=${summary.coverage.splitterSplits}, healerPulses=${summary.coverage.healerPulses}, ` +
      `bossPulses=${summary.coverage.bossPulses}, cleansed=${summary.coverage.cleansedTowers}`,
  );

  if (summary.failures.length > 0) {
    console.error(`\nFuzz harness FAILED (${summary.failures.length} failure(s)):`);
    for (const f of summary.failures) {
      console.error(' - ' + (f.failure ?? 'Unknown failure'));
    }
    process.exit(1);
  }
  console.log('Fuzz harness PASSED: all invariants held!');
}

if (process.argv[1]?.endsWith('fuzzPlay.ts')) {
  main();
}
