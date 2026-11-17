import { EventBus } from '../src/core/eventBus.ts';
import { FixedTimestepStepper } from '../src/core/gameLoop.ts';
import { SeededRng } from '../src/core/rng.ts';
import type { GridCoord, SpeedMultiplier, TargetingMode, TowerType } from '../src/core/types.ts';
import { ABILITY_DEFS, ABILITY_IDS } from '../src/data/abilities.ts';
import { BALANCE } from '../src/data/balance.ts';
import { LEVELS, type LevelDef } from '../src/data/levels/index.ts';
import { getTowerTierStats, TOWER_DEFS, TOWER_TYPES } from '../src/data/towers.ts';
import { buildEndlessWaveDef } from '../src/sim/waveSystem.ts';
import { computeSellRefund, computeStarRating, SimWorld } from '../src/sim/world.ts';

const TARGETING_MODES: readonly TargetingMode[] = ['first', 'last', 'strongest', 'closest'];
const TARGETING_MODE_SET = new Set<TargetingMode>(TARGETING_MODES);
const SPEEDS: readonly SpeedMultiplier[] = [1, 2, 3];
const FRAME_DTS: readonly number[] = [1 / 60, 1 / 30, 0.05, 0.1];
const _hashProbe: number[] = [];
const _hashSeen = new Set<number>();
const _seenTowerIds = new Set<number>();
const _seenTowerCoords = new Set<number>();

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
  killedUids: Set<number>;
  endlessWaveCompletedCount: number;
  expectedGold: number;
  soldTowerKills: number;
  expectedNextWaveIndex: number;
  lastWaveHpScale: number;
  endlessWavesConfig: number;
  eventInvariantError: string | null;
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
    tracker.seenSpawnUids.add(ev.enemyId);
    tracker.spawnedCount++;
  });

  events.on('enemyKilled', (ev) => {
    if (!tracker.seenSpawnUids.has(ev.enemyId)) {
      recordEventError(tracker, `enemyKilled for unknown uid: ${ev.enemyId}`);
      return;
    }
    if (tracker.killedUids.has(ev.enemyId)) {
      recordEventError(tracker, `enemyKilled fired twice for uid: ${ev.enemyId}`);
      return;
    }
    tracker.killedUids.add(ev.enemyId);
    tracker.killedCount++;
    tracker.expectedGold += ev.reward;
  });

  events.on('enemyLeaked', () => {
    tracker.leakedCount++;
  });

  events.on('gameWon', (ev) => {
    tracker.gameWonCount++;
    tracker.lastWinStars = ev.stars;
  });

  events.on('gameLost', (ev) => {
    tracker.gameLostCount++;
    tracker.lastLossEndless = ev.endless;
  });

  events.on('endlessEntered', () => {
    tracker.endlessEnteredCount++;
    tracker.expectedNextWaveIndex = world.level.waves.length;
  });

  events.on('waveStarted', (ev) => {
    if (ev.waveIndex !== tracker.expectedNextWaveIndex) {
      recordEventError(
        tracker,
        `Unexpected waveStarted index: got ${ev.waveIndex}, expected ${tracker.expectedNextWaveIndex}`,
      );
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
    if (inEndless()) {
      if (!Number.isFinite(rewardMult) || rewardMult < 0.32 - 1e-9 || rewardMult > 1 + 1e-9) {
        recordEventError(tracker, `Endless rewardMultiplier out of [0.32, 1]: ${rewardMult}`);
      }
    } else if (rewardMult !== 1) {
      recordEventError(tracker, `Story rewardMultiplier expected 1, got ${rewardMult}`);
    }
    const waveDef =
      ev.waveIndex < world.level.waves.length
        ? world.level.waves[ev.waveIndex]
        : buildEndlessWaveDef(ev.waveIndex, world.level);
    if (waveDef.groups.length === 0) {
      recordEventError(tracker, `Wave ${ev.waveIndex + 1} has zero spawn groups`);
    }
    tracker.expectedGold += ev.earlyBonus;
  });

  events.on('waveCompleted', (ev) => {
    tracker.expectedGold += ev.bonus;
    if (inEndless()) {
      tracker.endlessWaveCompletedCount++;
    }
  });
}

function expectedTowerInvestment(type: TowerType, tier: 1 | 2 | 3): number {
  let sum = getTowerTierStats(type, 1).upgradeCost;
  if (tier >= 2) sum += getTowerTierStats(type, 2).upgradeCost;
  if (tier >= 3) sum += getTowerTierStats(type, 3).upgradeCost;
  return sum;
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

  let pendingDeaths = 0;
  for (let i = 0; i < activeEnemies; i++) {
    const e = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
    if (!e.active) return `Inactive enemy at active index pos=${i}`;
    if (e.hp === 0) pendingDeaths++;
    if (
      !Number.isFinite(e.x) ||
      !Number.isFinite(e.y) ||
      !Number.isFinite(e.z) ||
      !Number.isFinite(e.prevX) ||
      !Number.isFinite(e.prevY) ||
      !Number.isFinite(e.prevZ) ||
      !Number.isFinite(e.yaw) ||
      !Number.isFinite(e.prevYaw)
    ) {
      return `Non-finite enemy position/yaw for uid=${e.uid} type=${e.type}`;
    }
    if (!Number.isFinite(e.hp) || !Number.isFinite(e.maxHp) || e.maxHp <= 0 || e.hp < 0 || e.hp > e.maxHp) {
      return `Invalid enemy HP (${e.hp}/${e.maxHp}) for uid=${e.uid} type=${e.type}`;
    }
    if (!Number.isFinite(e.dist) || !Number.isFinite(e.totalDist) || e.dist < 0 || e.dist > e.totalDist) {
      return `Invalid enemy dist (${e.dist}/${e.totalDist}) for uid=${e.uid}`;
    }
    if (
      !Number.isFinite(e.slowRatio) ||
      e.slowRatio < 0 ||
      e.slowRatio > BALANCE.maxSlowRatio + 1e-9 ||
      !Number.isFinite(e.slowTimer) ||
      e.slowTimer < 0
    ) {
      return `Invalid slow state (${e.slowRatio}, ${e.slowTimer}) for uid=${e.uid}`;
    }
  }

  for (let i = 0; i < activeProj; i++) {
    const p = world.projectilePool.items[world.projectilePool.getActiveIndex(i)];
    if (!p.active) return `Inactive projectile at active index pos=${i}`;
    if (
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      !Number.isFinite(p.z) ||
      !Number.isFinite(p.progress) ||
      !Number.isFinite(p.duration) ||
      p.duration <= 0 ||
      p.progress < 0
    ) {
      return `Non-finite or invalid projectile state (progress=${p.progress}, duration=${p.duration})`;
    }
  }

  _seenTowerIds.clear();
  _seenTowerCoords.clear();
  let activeTowerKills = 0;
  for (let i = 0; i < world.towers.length; i++) {
    const t = world.towers[i];
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
      !Number.isFinite(t.stunTimer) ||
      t.stunTimer < 0 ||
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
    activeTowerKills += t.kills;
  }

  if (activeTowerKills + tracker.soldTowerKills > tracker.killedCount + pendingDeaths) {
    return `Tower kills (${activeTowerKills}+${tracker.soldTowerKills}) exceeded killedCount+pendingDeaths (${tracker.killedCount}+${pendingDeaths})`;
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
  if (
    ws.currentWaveOneBased !== Math.max(0, ws.currentWaveIndex + 1) ||
    ws.totalWaves < world.level.waves.length ||
    !Number.isFinite(ws.interWaveTimer) ||
    (ws.state === 'betweenWaves' && ws.interWaveTimer < -BALANCE.fixedDt) ||
    !Number.isFinite(ws.waveElapsed) ||
    ws.waveElapsed < 0
  ) {
    return `Invalid waveSystem state (${ws.state}, wave=${ws.currentWaveOneBased}, interWave=${ws.interWaveTimer})`;
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

    const mvp = world.getMvpTowerSummary();
    if (world.towers.length === 0) {
      if (mvp !== null) return 'Expected null MVP summary when zero towers exist';
    } else {
      if (!mvp) return 'Expected non-null MVP summary with active towers';
      const matching = world.towers.some(
        (t) =>
          t.type === mvp.type &&
          t.tier === mvp.tier &&
          t.kills === mvp.kills &&
          Math.round(t.totalDamageDealt) === mvp.damageDealt,
      );
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
      const expectedTotal = nextDef.groups.reduce((s, g) => s + g.count, 0);
      const previewTotal = preview.items.reduce((s, it) => s + it.count, 0);
      if (previewTotal !== expectedTotal) {
        return `nextWavePreview count ${previewTotal} != waveDef count ${expectedTotal}`;
      }
    }
  }

  if (tick % 60 === 0 && activeEnemies > 0) {
    const sample = world.enemyPool.items[world.enemyPool.getActiveIndex(0)];
    const hovered = sample.flying
      ? world.findHoveredEnemy(9999, 9999, sample.x, sample.z)
      : world.findHoveredEnemy(sample.x, sample.z, 9999, 9999);
    if (!hovered || !hovered.active || hovered.flying !== sample.flying) {
      return `findHoveredEnemy failed for active ${sample.type} (flying=${sample.flying})`;
    }
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

function chooseTileForBuild(
  world: SimWorld,
  rng: SeededRng,
  tiles: readonly ScoredTile[],
  towerType: TowerType,
  profile: FuzzProfile,
): GridCoord | null {
  const free = tiles.filter((t) => world.grid.canPlaceTower(t.col, t.row));
  if (free.length === 0) return null;

  if (profile === 'chaotic' || profile === 'minimal') {
    return rng.pick(free);
  }

  const hitsFlyers = TOWER_DEFS[towerType].hitsFlyers;
  const isMortar = towerType === 'mortar';
  const sorted = [...free].sort((a, b) => {
    const scoreA = isMortar
      ? a.mortarCoverage
      : hitsFlyers
        ? a.groundCoverage + a.flightCoverage * 0.95
        : a.groundCoverage;
    const scoreB = isMortar
      ? b.mortarCoverage
      : hitsFlyers
        ? b.groundCoverage + b.flightCoverage * 0.95
        : b.groundCoverage;
    return scoreB - scoreA;
  });

  const poolSize =
    profile === 'tactical'
      ? Math.min(2, sorted.length)
      : profile === 'competent'
        ? Math.min(4, sorted.length)
        : Math.min(10, sorted.length);
  return sorted[rng.int(0, poolSize - 1)];
}

function chooseTowerType(world: SimWorld, rng: SeededRng, profile: FuzzProfile): TowerType | null {
  const affordable = TOWER_TYPES.filter((type) => world.gold >= getTowerTierStats(type, 1).upgradeCost);
  if (affordable.length === 0) return null;

  if (profile === 'tactical') {
    const counts = new Map<TowerType, number>();
    for (const t of world.towers) counts.set(t.type, (counts.get(t.type) ?? 0) + 1);
    const antiAirCount = world.towers.filter((t) => TOWER_DEFS[t.type].hitsFlyers).length;
    const nextHasFlyer =
      world.waveSystem.getNextWavePreview()?.items.some((it) => it.enemyType === 'flyer') ?? false;

    if ((nextHasFlyer || antiAirCount < 2) && affordable.some((t) => TOWER_DEFS[t].hitsFlyers)) {
      if ((counts.get('frost') ?? 0) === 0 && affordable.includes('frost')) return 'frost';
      if (affordable.includes('tesla') && rng.chance(0.45)) return 'tesla';
      if (affordable.includes('archer')) return 'archer';
    }
    if ((counts.get('frost') ?? 0) < 2 && affordable.includes('frost')) return 'frost';
    if ((counts.get('cannon') ?? 0) < 2 && affordable.includes('cannon')) return 'cannon';
    if ((counts.get('mortar') ?? 0) < 2 && affordable.includes('mortar')) return 'mortar';
    if ((counts.get('tesla') ?? 0) < 2 && affordable.includes('tesla')) return 'tesla';
    return rng.pick(affordable);
  }

  if (profile !== 'competent') {
    return rng.pick(affordable);
  }

  // Competent profile prefers anti-air early if aerial coverage is sparse
  const antiAirCount = world.towers.filter((t) => TOWER_DEFS[t.type].hitsFlyers).length;
  const nextHasFlyer =
    world.waveSystem.getNextWavePreview()?.items.some((it) => it.enemyType === 'flyer') ?? false;
  if ((nextHasFlyer || antiAirCount < 2) && rng.chance(0.7)) {
    const aaAffordable = affordable.filter((t) => TOWER_DEFS[t].hitsFlyers);
    if (aaAffordable.length > 0) return rng.pick(aaAffordable);
  }
  return rng.pick(affordable);
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
    if (
      world.placeTower(-1, -1, 'archer') !== null ||
      (spawn && world.placeTower(spawn.col, spawn.row, 'archer') !== null) ||
      world.upgradeTower(999_999) !== false ||
      world.sellTower(999_999) !== 0 ||
      world.enterEndlessMode() !== false
    ) {
      return 'Illegal action succeeded unexpectedly during ongoing play';
    }
    if (world.gold !== goldSnap || world.towers.length !== countSnap) {
      return 'Illegal action mutated gold or tower count';
    }
  }

  // Toggle auto-wave occasionally and verify countdown conservation
  if (rng.chance(0.1)) {
    const wasBetween = world.waveSystem.state === 'betweenWaves';
    const prevAuto = world.waveSystem.autoWave;
    const prevTimer = world.waveSystem.interWaveTimer;
    world.setAutoWave(!prevAuto);
    if (wasBetween && prevAuto && world.waveSystem.interWaveTimer + 1e-9 < prevTimer) {
      return `Turning off autoWave shrank interWaveTimer (${prevTimer} -> ${world.waveSystem.interWaveTimer})`;
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
    if (world.abilitySystem.canCast('meteor') && (profile === 'tactical' ? world.enemyPool.getActiveCount() >= 4 : rng.chance(0.35))) {
      const activeEnemies = world.enemyPool.getActiveCount();
      let tx: number;
      let tz: number;
      if (activeEnemies > 0) {
        const idx = world.enemyPool.getActiveIndex(rng.int(0, activeEnemies - 1));
        const target = world.enemyPool.items[idx];
        tx = target.x;
        tz = target.z;
      } else {
        const samplePos = { x: 0, y: 0, z: 0 };
        world.groundPath.sample(rng.range(0, world.groundPath.totalLength), samplePos);
        tx = samplePos.x;
        tz = samplePos.z;
      }
      if (!world.castMeteor(tx, tz)) {
        return 'castMeteor returned false while canCast("meteor") was true during combat';
      }
    }
    const anyStunned = world.towers.some((t) => t.stunTimer > 0);
    if (
      world.abilitySystem.canCast('overcharge') &&
      (profile === 'tactical' ? anyStunned || world.enemyPool.getActiveCount() >= 6 : rng.chance(0.35))
    ) {
      if (!world.castOvercharge()) {
        return 'castOvercharge returned false while canCast("overcharge") was true during combat';
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
    const refund = world.sellTower(victim.id);
    if (refund !== expectedRefund || world.gold !== goldBefore + expectedRefund) {
      return `Sell refund mismatch: got ${refund}, expected ${expectedRefund}`;
    }
    tracker.expectedGold += refund;
    tracker.soldTowerKills += victimKills;
    if (!world.grid.canPlaceTower(victim.col, victim.row)) {
      return `Tile (${victim.col},${victim.row}) remained blocked after sellTower`;
    }
    return null;
  }

  if (roll < upgradeCutoff && world.towers.length > 0) {
    const upgradable = world.towers.filter((t) => {
      if (t.tier >= 3) return false;
      const nextTier = (t.tier + 1) as 2 | 3;
      return world.gold >= getTowerTierStats(t.type, nextTier).upgradeCost;
    });
    if (upgradable.length > 0) {
      const target = rng.pick(upgradable);
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
): FuzzRunResult {
  const reproCmd = `npx tsx scripts/fuzzPlay.ts --level ${level.index + 1} --seed ${seed} --profile ${profile} --endless-waves ${tracker.endlessWavesConfig}`;
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

  const freeTile = tiles.find((t) => world.grid.canPlaceTower(t.col, t.row));
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

  const tracker: FuzzTracker = {
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
    killedUids: new Set<number>(),
    endlessWaveCompletedCount: 0,
    expectedGold: level.startingGold,
    soldTowerKills: 0,
    expectedNextWaveIndex: 0,
    lastWaveHpScale: 0,
    endlessWavesConfig: endlessWaves,
    eventInvariantError: null,
  };

  let inEndless = false;
  let tickCount = 0;
  let storyOutcome: 'won' | 'lost' | 'timeout' = 'timeout';

  instrumentPools(world, tracker);
  attachEventTracker(world, events, tracker, () => inEndless);

  // Pre-wave 1 setup: build initial affordable towers and start wave 1
  for (let i = 0; i < 6 && world.outcome === 'ongoing'; i++) {
    const err = performLegalAction(world, rng, tiles, profile, tracker);
    if (err) return makeFailure(level, seed, profile, tickCount, world, tracker, storyOutcome, err);
    if (world.waveSystem.state !== 'preFirstWave') break;
  }
  if (world.waveSystem.state === 'preFirstWave') {
    world.startNextWave();
  }

  let nextActionTick = rng.int(20, 75);
  let fatalReason: string | null = null;

  const stepOneFrame = (maxTicksLimit: number, stopPredicate: () => boolean): void => {
    if (rng.chance(0.08)) {
      stepper.speed = rng.pick(SPEEDS);
    }
    if (rng.chance(0.02)) {
      stepper.paused = true;
      const pausedStep = stepper.step(rng.pick(FRAME_DTS), () => {
        fatalReason = 'FixedTimestepStepper ticked while paused';
      });
      if (pausedStep.ticksExecuted !== 0) {
        fatalReason = `Expected 0 ticks while paused, got ${pausedStep.ticksExecuted}`;
      }
      stepper.paused = false;
      if (fatalReason) return;
    }

    const frameDt = rng.pick(FRAME_DTS);
    stepper.step(frameDt, (fixedDt) => {
      if (fatalReason || stopPredicate() || tickCount >= maxTicksLimit) return;
      tickCount++;
      const prevWaveState = world.waveSystem.state;
      const prevMeteorCd = world.abilitySystem.getCooldown('meteor');
      const prevOverchargeCd = world.abilitySystem.getCooldown('overcharge');
      try {
        world.fixedTick(fixedDt);
      } catch (err) {
        fatalReason = `Uncaught error in fixedTick: ${err instanceof Error ? err.message : String(err)}`;
        return;
      }

      if (prevWaveState === 'betweenWaves' && world.waveSystem.state === 'betweenWaves') {
        if (
          world.abilitySystem.getCooldown('meteor') !== prevMeteorCd ||
          world.abilitySystem.getCooldown('overcharge') !== prevOverchargeCd
        ) {
          fatalReason = 'Ability cooldown changed during betweenWaves idle countdown';
          return;
        }
      }

      const invErr = assertTickInvariants(world, tracker, tickCount);
      if (invErr) {
        fatalReason = invErr;
        return;
      }

      if (tickCount >= nextActionTick && world.outcome === 'ongoing') {
        const actErr = performLegalAction(world, rng, tiles, profile, tracker);
        if (actErr) {
          fatalReason = actErr;
          return;
        }
        nextActionTick = tickCount + rng.int(18, 65);
      }
    });
  };

  while (world.outcome === 'ongoing' && tickCount < maxStoryTicks && !fatalReason) {
    stepOneFrame(maxStoryTicks, () => world.outcome !== 'ongoing');
  }

  if (fatalReason) {
    return makeFailure(level, seed, profile, tickCount, world, tracker, storyOutcome, fatalReason);
  }

  if (world.outcome === 'ongoing') {
    return makeFailure(
      level,
      seed,
      profile,
      tickCount,
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
        tickCount,
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
        tickCount,
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
        tickCount,
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
        tickCount,
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
        tickCount,
        world,
        tracker,
        storyOutcome,
        `Pool overflow during story play: enemy=${tracker.enemyPoolOverflows}, projectile=${tracker.projectilePoolOverflows}`,
      );
    }

    const postWinErr = verifyPostEndImmutability(world, tiles, tracker);
    if (postWinErr) {
      return makeFailure(level, seed, profile, tickCount, world, tracker, storyOutcome, postWinErr);
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
          tickCount,
          world,
          tracker,
          storyOutcome,
          `enterEndlessMode() failed after story victory`,
        );
      }
      const endlessTickCap = tickCount + maxEndlessTicks;
      while (
        getOutcome() === 'ongoing' &&
        tracker.endlessWaveCompletedCount < endlessWaves &&
        tickCount < endlessTickCap &&
        !fatalReason
      ) {
        stepOneFrame(
          endlessTickCap,
          () => getOutcome() !== 'ongoing' || tracker.endlessWaveCompletedCount >= endlessWaves,
        );
      }
      if (fatalReason) {
        return makeFailure(level, seed, profile, tickCount, world, tracker, storyOutcome, fatalReason);
      }
      if (getOutcome() === 'ongoing' && tracker.endlessWaveCompletedCount < endlessWaves) {
        return makeFailure(
          level,
          seed,
          profile,
          tickCount,
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
          tickCount,
          world,
          tracker,
          storyOutcome,
          `gameWon fired again during endless mode (count=${tracker.gameWonCount})`,
        );
      }
      if (getOutcome() === 'lost' && (getLostCount() !== 1 || tracker.lastLossEndless !== true)) {
        return makeFailure(
          level,
          seed,
          profile,
          tickCount,
          world,
          tracker,
          storyOutcome,
          `Endless loss did not emit gameLost once with endless=true`,
        );
      }
    }
  } else {
    if (tracker.gameLostCount !== 1 || tracker.gameWonCount !== 0 || world.lives !== 0) {
      return makeFailure(
        level,
        seed,
        profile,
        tickCount,
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
        tickCount,
        world,
        tracker,
        storyOutcome,
        `Pool overflow during story play: enemy=${tracker.enemyPoolOverflows}, projectile=${tracker.projectilePoolOverflows}`,
      );
    }

    const postLossErr = verifyPostEndImmutability(world, tiles, tracker);
    if (postLossErr) {
      return makeFailure(level, seed, profile, tickCount, world, tracker, storyOutcome, postLossErr);
    }
  }

  return {
    ok: true,
    digest: buildDigest(level, seed, profile, storyOutcome, world, tracker, tickCount),
  };
}

/**
 * Runs a dedicated Endless Mode fuzz check on `level` by applying its scripted defense
 * (when present) or path-aware towers, winning, entering endless mode, and fuzzing `wavesTarget`
 * endless waves cleanly without pool overflows or errors.
 */
export function runEndlessFuzz(level: LevelDef, seed: number, wavesTarget = 5): FuzzRunResult {
  const rng = new SeededRng(seed);
  const events = new EventBus();
  const world = new SimWorld(level, events);
  const stepper = new FixedTimestepStepper();
  stepper.simActive = true;
  const tiles = buildScoredGrassTiles(world);

  const tracker: FuzzTracker = {
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
    killedUids: new Set<number>(),
    endlessWaveCompletedCount: 0,
    expectedGold: level.startingGold,
    soldTowerKills: 0,
    expectedNextWaveIndex: 0,
    lastWaveHpScale: 0,
    endlessWavesConfig: wavesTarget,
    eventInvariantError: null,
  };

  let inEndless = false;
  let tickCount = 0;

  instrumentPools(world, tracker);
  attachEventTracker(world, events, tracker, () => inEndless);

  // Deploy scripted late-game defense so endless waves play through multiple wave clears
  world.gold = Math.max(world.gold, 8000);
  if (level.scriptedBuildOrder && level.scriptedBuildOrder.length > 0) {
    for (const act of level.scriptedBuildOrder) {
      if (act.action === 'build' && act.towerType) {
        world.placeTower(act.col, act.row, act.towerType, act.targetingMode ?? 'first');
      } else if (act.action === 'upgrade') {
        const tid = world.grid.getTowerIdAt(act.col, act.row);
        if (tid !== -1) world.upgradeTower(tid);
      }
    }
  } else {
    for (let i = 0; i < Math.min(12, tiles.length); i++) {
      const type = chooseTowerType(world, rng, 'competent');
      if (!type) break;
      const coord = chooseTileForBuild(world, rng, tiles, type, 'competent');
      if (coord) world.placeTower(coord.col, coord.row, type, rng.pick(TARGETING_MODES));
    }
  }

  tracker.expectedGold = world.gold;
  world.debugForceWin();
  inEndless = true;
  if (!world.enterEndlessMode()) {
    return makeFailure(level, seed, 'competent', tickCount, world, tracker, 'won', 'enterEndlessMode() failed');
  }
  world.startNextWave();

  const maxTicks = 60 * 1500;
  let nextActionTick = rng.int(20, 60);
  let fatalReason: string | null = null;

  while (
    world.outcome === 'ongoing' &&
    tracker.endlessWaveCompletedCount < wavesTarget &&
    tickCount < maxTicks &&
    !fatalReason
  ) {
    if (rng.chance(0.1)) stepper.speed = rng.pick(SPEEDS);
    stepper.step(rng.pick(FRAME_DTS), (dt) => {
      if (fatalReason || world.outcome !== 'ongoing' || tracker.endlessWaveCompletedCount >= wavesTarget) return;
      tickCount++;
      try {
        world.fixedTick(dt);
      } catch (err) {
        fatalReason = `Uncaught error in endless fixedTick: ${err instanceof Error ? err.message : String(err)}`;
        return;
      }
      const invErr = assertTickInvariants(world, tracker, tickCount);
      if (invErr) {
        fatalReason = invErr;
        return;
      }
      if (tickCount >= nextActionTick && world.outcome === 'ongoing') {
        const actErr = performLegalAction(world, rng, tiles, 'competent', tracker);
        if (actErr) {
          fatalReason = actErr;
          return;
        }
        nextActionTick = tickCount + rng.int(20, 65);
      }
    });
  }

  if (fatalReason) {
    return makeFailure(level, seed, 'competent', tickCount, world, tracker, 'won', fatalReason);
  }
  if (world.outcome === 'ongoing' && tracker.endlessWaveCompletedCount < wavesTarget) {
    return makeFailure(
      level,
      seed,
      'competent',
      tickCount,
      world,
      tracker,
      'won',
      `Endless mode stalled at wave ${world.waveSystem.currentWaveOneBased} (${tracker.endlessWaveCompletedCount}/${wavesTarget} endless waves completed)`,
    );
  }
  if (tracker.enemyPoolOverflows > 0 || tracker.projectilePoolOverflows > 0) {
    return makeFailure(
      level,
      seed,
      'competent',
      tickCount,
      world,
      tracker,
      'won',
      `Pool overflow during endless run: enemy=${tracker.enemyPoolOverflows}, projectile=${tracker.projectilePoolOverflows}`,
    );
  }
  if (tracker.gameWonCount !== 1) {
    return makeFailure(
      level,
      seed,
      'competent',
      tickCount,
      world,
      tracker,
      'won',
      `gameWon fired ${tracker.gameWonCount} times (expected 1)`,
    );
  }

  return {
    ok: true,
    digest: buildDigest(level, seed, 'competent', 'won', world, tracker, tickCount),
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
    a.endlessWavesCompleted === b.endlessWavesCompleted
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
}

export function runFuzzCampaign(config: {
  seedsPerLevel: number;
  baseSeed: number;
  endlessWaves: number;
  levelIndices?: readonly number[];
  profile?: FuzzProfile;
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

  for (const li of indices) {
    const level = LEVELS[li];
    if (!level) continue;

    for (let s = 0; s < config.seedsPerLevel; s++) {
      const seed = config.baseSeed + li * 1009 + s * 97;
      const profile = config.profile ?? FUZZ_PROFILES[s % FUZZ_PROFILES.length];
      const res = runFuzzPlaythrough(level, seed, { endlessWaves: config.endlessWaves, profile });
      totalRuns++;
      maxPeakEnemies = Math.max(maxPeakEnemies, res.digest.peakEnemies);
      maxPeakProjectiles = Math.max(maxPeakProjectiles, res.digest.peakProjectiles);

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
          failures.push({
            ok: false,
            failure: `[L${level.index + 1} ${level.id} seed=${seed} profile=${profile}] Determinism failure: replay digest differed`,
            digest: replay.digest,
          });
        }
      }
    }

    // Dedicated endless mode pass per level so every island exercises N endless waves
    if (config.endlessWaves > 0) {
      const endlessSeed = config.baseSeed + li * 7919 + 42;
      const eRes = runEndlessFuzz(level, endlessSeed, config.endlessWaves);
      endlessChecks++;
      endlessWavesCompletedTotal += eRes.digest.endlessWavesCompleted;
      maxPeakEnemies = Math.max(maxPeakEnemies, eRes.digest.peakEnemies);
      maxPeakProjectiles = Math.max(maxPeakProjectiles, eRes.digest.peakProjectiles);
      if (!eRes.ok) {
        failures.push(eRes);
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
  };
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
  readonly baseSeed: number;
  readonly endlessWaves: number;
  readonly levelIndices?: readonly number[];
  readonly profile?: FuzzProfile;
}

export function parseFuzzCliArgs(argv: readonly string[]): ParsedFuzzCliArgs {
  const seedsArg = parseArgValue(argv, 'seeds');
  const singleSeedArg = parseArgValue(argv, 'seed');
  const levelArg = parseArgValue(argv, 'level') ?? parseArgValue(argv, 'levels');
  const endlessArg = parseArgValue(argv, 'endless-waves');
  const profileArg = parseArgValue(argv, 'profile');

  let profile: FuzzProfile | undefined;
  if (profileArg !== null) {
    if (!(FUZZ_PROFILES as readonly string[]).includes(profileArg)) {
      throw new Error(
        `Invalid --profile "${profileArg}". Valid profiles: ${FUZZ_PROFILES.join(', ')}`,
      );
    }
    profile = profileArg as FuzzProfile;
  }

  const baseSeed = Number(singleSeedArg ?? 1336);
  if (!Number.isFinite(baseSeed)) {
    throw new Error(`Invalid --seed value: "${singleSeedArg}"`);
  }

  const seedsPerLevel = singleSeedArg ? 1 : Math.max(1, Math.floor(Number(seedsArg ?? 8)));
  if (!Number.isFinite(seedsPerLevel)) {
    throw new Error(`Invalid --seeds value: "${seedsArg}"`);
  }

  const endlessWaves = Math.max(0, Math.floor(Number(endlessArg ?? 5)));
  if (!Number.isFinite(endlessWaves)) {
    throw new Error(`Invalid --endless-waves value: "${endlessArg}"`);
  }

  let levelIndices: number[] | undefined;
  if (levelArg !== null) {
    levelIndices = levelArg
      .split(',')
      .map((x) => Number(x.trim()) - 1)
      .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < LEVELS.length);
    if (levelIndices.length === 0) {
      throw new Error(`No valid levels matched --level="${levelArg}" (1..${LEVELS.length})`);
    }
  }

  return {
    seedsPerLevel,
    singleSeedMode: singleSeedArg !== null,
    baseSeed,
    endlessWaves,
    levelIndices,
    profile,
  };
}

function main(): void {
  const parsed = parseFuzzCliArgs(process.argv.slice(2));

  if (parsed.singleSeedMode && parsed.levelIndices && parsed.levelIndices.length === 1) {
    const level = LEVELS[parsed.levelIndices[0]];
    const resolvedProfile =
      parsed.profile ?? FUZZ_PROFILES[Math.abs(parsed.baseSeed) % FUZZ_PROFILES.length];
    console.log(
      `=== Skyhold Isles Fuzz Repro: L${level.index + 1} ${level.name}, seed=${parsed.baseSeed}, profile=${resolvedProfile} ===`,
    );
    const t0 = performance.now();
    const res = runFuzzPlaythrough(level, parsed.baseSeed, {
      endlessWaves: parsed.endlessWaves,
      profile: resolvedProfile,
    });
    const replay = runFuzzPlaythrough(level, parsed.baseSeed, {
      endlessWaves: parsed.endlessWaves,
      profile: resolvedProfile,
    });
    const dt = (performance.now() - t0) / 1000;
    console.log('Digest:', res.digest);
    if (!res.ok) {
      console.error('FAILED:', res.failure);
      process.exit(1);
    }
    if (!digestsEqual(res.digest, replay.digest)) {
      console.error('FAILED: Non-deterministic replay!', { first: res.digest, replay: replay.digest });
      process.exit(1);
    }
    console.log(`PASSED in ${dt.toFixed(2)}s`);
    return;
  }

  const profileNote = parsed.profile ? `, profile=${parsed.profile}` : '';
  console.log(
    `=== Skyhold Isles Fuzz Playthrough Harness (${parsed.seedsPerLevel} seeds/island, endless=${parsed.endlessWaves} waves${profileNote}) ===`,
  );
  const startMs = performance.now();
  const summary = runFuzzCampaign({
    seedsPerLevel: parsed.seedsPerLevel,
    baseSeed: parsed.baseSeed,
    endlessWaves: parsed.endlessWaves,
    levelIndices: parsed.levelIndices,
    profile: parsed.profile,
  });
  const elapsedSec = (performance.now() - startMs) / 1000;

  console.log(
    `Completed ${summary.totalRuns} story runs (wins=${summary.storyWins}, losses=${summary.storyLosses}) + ` +
      `${summary.endlessChecks} endless runs (${summary.endlessWavesCompletedTotal} endless waves cleared) + ` +
      `${summary.determinismChecks} determinism checks in ${elapsedSec.toFixed(2)}s`,
  );
  console.log(
    `Peak pools observed: enemies=${summary.maxPeakEnemies}/${BALANCE.pools.maxEnemies}, ` +
      `projectiles=${summary.maxPeakProjectiles}/${BALANCE.pools.maxProjectiles}`,
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
