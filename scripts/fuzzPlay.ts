import { EventBus } from '../src/core/eventBus.ts';
import { FixedTimestepStepper } from '../src/core/gameLoop.ts';
import { SeededRng } from '../src/core/rng.ts';
import type { GridCoord, SpeedMultiplier, TargetingMode, TowerType } from '../src/core/types.ts';
import { BALANCE } from '../src/data/balance.ts';
import { LEVELS, type LevelDef } from '../src/data/levels/index.ts';
import { getTowerTierStats, TOWER_DEFS, TOWER_TYPES } from '../src/data/towers.ts';
import { computeSellRefund, computeStarRating, SimWorld } from '../src/sim/world.ts';

const TARGETING_MODES: readonly TargetingMode[] = ['first', 'last', 'strongest', 'closest'];
const SPEEDS: readonly SpeedMultiplier[] = [1, 2, 3];
const FRAME_DTS: readonly number[] = [1 / 60, 1 / 30, 0.05, 0.1];

export type FuzzProfile = 'competent' | 'balanced' | 'chaotic' | 'minimal';

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

  for (let row = 0; row < world.grid.rows; row++) {
    for (let col = 0; col < world.grid.cols; col++) {
      if (world.grid.getTile(col, row) !== 'grass') continue;
      const wx = world.grid.gridToWorldX(col);
      const wz = world.grid.gridToWorldZ(row);
      let gCov = 0;
      for (let i = 0; i < groundSamples.length; i++) {
        const dx = groundSamples[i].x - wx;
        const dz = groundSamples[i].z - wz;
        if (dx * dx + dz * dz <= sampleRSq) gCov++;
      }
      let fCov = 0;
      for (let i = 0; i < flightSamples.length; i++) {
        const dx = flightSamples[i].x - wx;
        const dz = flightSamples[i].z - wz;
        if (dx * dx + dz * dz <= sampleRSq) fCov++;
      }
      tiles.push({ col, row, groundCoverage: gCov, flightCoverage: fCov });
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

function attachEventTracker(events: EventBus, tracker: FuzzTracker, inEndless: () => boolean): void {
  events.on('enemySpawned', (ev) => {
    if (ev.enemyId <= 0 || tracker.seenSpawnUids.has(ev.enemyId)) {
      throw new Error(`Duplicate or invalid enemySpawned uid: ${ev.enemyId}`);
    }
    tracker.seenSpawnUids.add(ev.enemyId);
    tracker.spawnedCount++;
  });

  events.on('enemyKilled', (ev) => {
    if (!tracker.seenSpawnUids.has(ev.enemyId)) {
      throw new Error(`enemyKilled for unknown uid: ${ev.enemyId}`);
    }
    if (tracker.killedUids.has(ev.enemyId)) {
      throw new Error(`enemyKilled fired twice for uid: ${ev.enemyId}`);
    }
    tracker.killedUids.add(ev.enemyId);
    tracker.killedCount++;
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
  });

  events.on('waveCompleted', () => {
    if (inEndless()) {
      tracker.endlessWaveCompletedCount++;
    }
  });
}

function assertTickInvariants(world: SimWorld, tracker: FuzzTracker): string | null {
  if (!Number.isFinite(world.gold) || !Number.isInteger(world.gold) || world.gold < 0) {
    return `Invalid gold value: ${world.gold}`;
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

  for (let i = 0; i < activeEnemies; i++) {
    const e = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
    if (!e.active) return `Inactive enemy at active index pos=${i}`;
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

  for (let i = 0; i < world.towers.length; i++) {
    const t = world.towers[i];
    if (
      !Number.isFinite(t.x) ||
      !Number.isFinite(t.z) ||
      !Number.isFinite(t.yaw) ||
      !Number.isFinite(t.cooldownTimer) ||
      t.cooldownTimer < 0 ||
      !Number.isFinite(t.stunTimer) ||
      t.stunTimer < 0 ||
      !Number.isFinite(t.totalDamageDealt) ||
      t.totalDamageDealt < 0 ||
      !Number.isInteger(t.kills) ||
      t.kills < 0
    ) {
      return `Invalid tower state for id=${t.id} type=${t.type}`;
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
  const sorted = [...free].sort((a, b) => {
    const scoreA = hitsFlyers ? a.groundCoverage + a.flightCoverage * 0.9 : a.groundCoverage;
    const scoreB = hitsFlyers ? b.groundCoverage + b.flightCoverage * 0.9 : b.groundCoverage;
    return scoreB - scoreA;
  });

  const poolSize = profile === 'competent' ? Math.min(4, sorted.length) : Math.min(10, sorted.length);
  return sorted[rng.int(0, poolSize - 1)];
}

function chooseTowerType(world: SimWorld, rng: SeededRng, profile: FuzzProfile): TowerType | null {
  const affordable = TOWER_TYPES.filter((type) => world.gold >= getTowerTierStats(type, 1).upgradeCost);
  if (affordable.length === 0) return null;

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
): string | null {
  if (world.outcome !== 'ongoing') return null;

  // Toggle auto-wave occasionally
  if (rng.chance(0.1)) {
    world.setAutoWave(!world.waveSystem.autoWave);
  }

  // Start / early-call wave when legal
  if (world.waveSystem.canStartNextWave()) {
    const wsState = world.waveSystem.state;
    const activeCount = world.enemyPool.getActiveCount();
    const shouldStart =
      wsState === 'preFirstWave' ||
      (wsState === 'betweenWaves' && rng.chance(0.55)) ||
      (profile === 'chaotic' && activeCount < 140 && rng.chance(0.25)) ||
      (wsState === 'clearing' && activeCount <= 4 && rng.chance(0.35));

    if (shouldStart) {
      const goldBefore = world.gold;
      const expectedBonus = world.waveSystem.getEarlyCallBonus();
      const started = world.startNextWave();
      if (!started) {
        return `canStartNextWave() was true in state=${wsState} but startNextWave() returned false`;
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
    if (world.abilitySystem.canCast('meteor') && rng.chance(0.35)) {
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
    if (world.abilitySystem.canCast('overcharge') && rng.chance(0.35)) {
      if (!world.castOvercharge()) {
        return 'castOvercharge returned false while canCast("overcharge") was true during combat';
      }
    }
  }

  // Decide tower action (build / upgrade / sell / retarget)
  const roll = rng.next();
  const sellCutoff =
    profile === 'chaotic' ? 0.22 : profile === 'minimal' ? 0.28 : profile === 'competent' ? 0.02 : 0.06;
  const upgradeCutoff = sellCutoff + (profile === 'minimal' ? 0.2 : 0.42);
  const retargetCutoff = upgradeCutoff + 0.12;

  if (roll < sellCutoff && world.towers.length > 0) {
    const victim = rng.pick(world.towers);
    const goldBefore = world.gold;
    const expectedRefund = computeSellRefund(victim.totalInvested);
    const refund = world.sellTower(victim.id);
    if (refund !== expectedRefund || world.gold !== goldBefore + expectedRefund) {
      return `Sell refund mismatch: got ${refund}, expected ${expectedRefund}`;
    }
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
  const reproCmd = `npx tsx scripts/fuzzPlay.ts --level ${level.index + 1} --seed ${seed}`;
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
  const profiles: readonly FuzzProfile[] = ['competent', 'balanced', 'chaotic', 'minimal'];
  const profile = options.profile ?? profiles[Math.abs(seed) % profiles.length];

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
  };

  let inEndless = false;
  let tickCount = 0;
  let storyOutcome: 'won' | 'lost' | 'timeout' = 'timeout';

  instrumentPools(world, tracker);
  try {
    attachEventTracker(events, tracker, () => inEndless);
  } catch (err) {
    return makeFailure(level, seed, profile, tickCount, world, tracker, storyOutcome, String(err));
  }

  // Pre-wave 1 setup: build initial affordable towers and start wave 1
  for (let i = 0; i < 6 && world.outcome === 'ongoing'; i++) {
    const err = performLegalAction(world, rng, tiles, profile);
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
      try {
        world.fixedTick(fixedDt);
      } catch (err) {
        fatalReason = `Uncaught error in fixedTick: ${err instanceof Error ? err.message : String(err)}`;
        return;
      }

      const invErr = assertTickInvariants(world, tracker);
      if (invErr) {
        fatalReason = invErr;
        return;
      }

      if (tickCount >= nextActionTick && world.outcome === 'ongoing') {
        const actErr = performLegalAction(world, rng, tiles, profile);
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
  };

  let inEndless = false;
  let tickCount = 0;

  instrumentPools(world, tracker);
  try {
    attachEventTracker(events, tracker, () => inEndless);
  } catch (err) {
    return makeFailure(level, seed, 'competent', tickCount, world, tracker, 'won', String(err));
  }

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
      const invErr = assertTickInvariants(world, tracker);
      if (invErr) {
        fatalReason = invErr;
        return;
      }
      if (tickCount >= nextActionTick && world.outcome === 'ongoing') {
        const actErr = performLegalAction(world, rng, tiles, 'competent');
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
      const res = runFuzzPlaythrough(level, seed, { endlessWaves: config.endlessWaves });
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
        const replay = runFuzzPlaythrough(level, seed, { endlessWaves: config.endlessWaves });
        if (!replay.ok) {
          failures.push(replay);
        } else if (!digestsEqual(res.digest, replay.digest)) {
          failures.push({
            ok: false,
            failure: `[L${level.index + 1} ${level.id} seed=${seed}] Determinism failure: replay digest differed`,
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

function parseArgValue(name: string): string | null {
  const prefix = `--${name}=`;
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === `--${name}` && i + 1 < process.argv.length) return process.argv[i + 1];
  }
  return null;
}

function main(): void {
  const seedsArg = parseArgValue('seeds');
  const singleSeedArg = parseArgValue('seed');
  const levelArg = parseArgValue('level') ?? parseArgValue('levels');
  const endlessArg = parseArgValue('endless-waves');

  const seedsPerLevel = singleSeedArg ? 1 : Math.max(1, Number(seedsArg ?? 8));
  const baseSeed = Number(singleSeedArg ?? 1336);
  const endlessWaves = Math.max(0, Number(endlessArg ?? 5));
  const levelIndices = levelArg
    ? levelArg
        .split(',')
        .map((x) => Number(x.trim()) - 1)
        .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < LEVELS.length)
    : undefined;

  if (singleSeedArg && levelIndices && levelIndices.length === 1) {
    const level = LEVELS[levelIndices[0]];
    console.log(`=== Skyhold Isles Fuzz Repro: L${level.index + 1} ${level.name}, seed=${baseSeed} ===`);
    const t0 = performance.now();
    const res = runFuzzPlaythrough(level, baseSeed, { endlessWaves });
    const replay = runFuzzPlaythrough(level, baseSeed, { endlessWaves });
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

  console.log(
    `=== Skyhold Isles Fuzz Playthrough Harness (${seedsPerLevel} seeds/island, endless=${endlessWaves} waves) ===`,
  );
  const startMs = performance.now();
  const summary = runFuzzCampaign({
    seedsPerLevel,
    baseSeed,
    endlessWaves,
    levelIndices,
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
