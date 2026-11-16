import { EventBus } from '../src/core/eventBus.ts';
import { SeededRng } from '../src/core/rng.ts';
import type { EnemyType } from '../src/core/types.ts';
import { BALANCE } from '../src/data/balance.ts';
import { LEVELS, type LevelDef } from '../src/data/levels/index.ts';
import { TOWER_TYPES } from '../src/data/towers.ts';
import { SimWorld } from '../src/sim/world.ts';

export interface BenchScenarioConfig {
  readonly enemyCount: number;
  readonly towerCount: number;
  /**
   * Soft desktop Node ticks/sec budget (~8-10x above 180 Hz 3x speed) so even
   * mobile JS engines running ~6-8x slower stay smooth under heavy load.
   */
  readonly softBudgetTicksPerSec: number;
}

export interface BenchScenarioResult {
  readonly enemyCount: number;
  readonly towerCount: number;
  readonly totalTicks: number;
  readonly elapsedMs: number;
  readonly ticksPerSec: number;
  readonly msPerTick: number;
  readonly simMsAt3xFrame: number;
  readonly softBudgetTicksPerSec: number;
  readonly meetsSoftBudget: boolean;
  readonly peakProjectiles: number;
}

export const BENCH_SCENARIOS: readonly BenchScenarioConfig[] = [
  { enemyCount: 100, towerCount: 40, softBudgetTicksPerSec: 3600 },
  { enemyCount: 250, towerCount: 40, softBudgetTicksPerSec: 2200 },
  { enemyCount: 360, towerCount: 40, softBudgetTicksPerSec: 1500 },
];

/** Hard safety floor: desktop host must at least sustain 3x speed (180 ticks/sec). */
const HARD_FLOOR_TICKS_PER_SEC = 180;

function pickBenchLevel(): LevelDef {
  let best = LEVELS[LEVELS.length - 1];
  let bestLen = -1;
  for (const level of LEVELS) {
    const tmp = new SimWorld(level, new EventBus());
    let grassCount = 0;
    for (let r = 0; r < tmp.grid.rows; r++) {
      for (let c = 0; c < tmp.grid.cols; c++) {
        if (tmp.grid.getTile(c, r) === 'grass') grassCount++;
      }
    }
    if (grassCount >= 40 && tmp.groundPath.totalLength > bestLen) {
      bestLen = tmp.groundPath.totalLength;
      best = level;
    }
  }
  return best;
}

function placeBenchTowers(world: SimWorld, targetCount: number): number {
  const pathSamples: Array<{ x: number; z: number }> = [];
  const v = { x: 0, y: 0, z: 0 };
  const activeSpan = world.groundPath.totalLength * 0.72;
  for (let d = 0; d <= activeSpan; d += 1.0) {
    world.groundPath.sample(d, v);
    pathSamples.push({ x: v.x, z: v.z });
  }

  const candidates: Array<{ col: number; row: number; cov: number }> = [];
  for (let r = 0; r < world.grid.rows; r++) {
    for (let c = 0; c < world.grid.cols; c++) {
      if (!world.grid.canPlaceTower(c, r)) continue;
      const wx = world.grid.gridToWorldX(c);
      const wz = world.grid.gridToWorldZ(r);
      let cov = 0;
      for (let i = 0; i < pathSamples.length; i++) {
        const dx = pathSamples[i].x - wx;
        const dz = pathSamples[i].z - wz;
        if (dx * dx + dz * dz <= 36) cov++;
      }
      candidates.push({ col: c, row: r, cov });
    }
  }
  candidates.sort((a, b) => b.cov - a.cov || a.row - b.row || a.col - b.col);

  world.gold = 1_000_000;
  let placed = 0;
  for (let i = 0; i < candidates.length && placed < targetCount; i++) {
    const type = TOWER_TYPES[i % TOWER_TYPES.length];
    const tower = world.placeTower(candidates[i].col, candidates[i].row, type, 'first');
    if (!tower) continue;
    const targetTier = (i % 3) + 1;
    if (targetTier >= 2) world.upgradeTower(tower.id);
    if (targetTier >= 3) world.upgradeTower(tower.id);
    placed++;
  }
  return placed;
}

function resetEnemiesForBatch(world: SimWorld, rng: SeededRng): void {
  const pos = { x: 0, y: 0, z: 0 };
  world.spatialHash.clear();
  world.projectilePool.clear();
  const count = world.enemyPool.getActiveCount();
  for (let i = 0; i < count; i++) {
    const e = world.enemyPool.items[world.enemyPool.getActiveIndex(i)];
    const path = world.enemySystem.getPath(e.flying);
    e.dist = rng.range(0, e.totalDist * 0.62);
    e.yaw = path.sample(e.dist, pos);
    e.x = pos.x;
    e.y = pos.y;
    e.z = pos.z;
    e.prevX = e.x;
    e.prevY = e.y;
    e.prevZ = e.z;
    e.prevYaw = e.yaw;
    e.hp = e.maxHp;
    e.slowRatio = 0;
    e.slowTimer = 0;
    e.hitFlashTimer = 0;
    e.bossSummonedEscorts = true;
    world.spatialHash.insert(e.poolIndex, e.x, e.z);
  }
  for (let i = 0; i < world.towers.length; i++) {
    world.towers[i].stunTimer = 0;
  }
}

export function runSimBenchScenario(
  level: LevelDef,
  config: BenchScenarioConfig,
  batches = 6,
  ticksPerBatch = 180,
): BenchScenarioResult {
  const world = new SimWorld(level, new EventBus());
  const actualTowers = placeBenchTowers(world, config.towerCount);
  if (actualTowers !== config.towerCount) {
    throw new Error(`Level ${level.id} placed only ${actualTowers}/${config.towerCount} towers`);
  }

  world.waveSystem.state = 'clearing';
  world.waveSystem.currentWaveIndex = 0;

  const mix: readonly EnemyType[] = ['grunt', 'runner', 'brute', 'flyer', 'healer', 'splitter'];
  for (let i = 0; i < config.enemyCount; i++) {
    const type: EnemyType = i % 60 === 59 ? 'boss' : mix[i % mix.length];
    const enemy = world.enemySystem.spawnEnemy(type, 100_000);
    if (!enemy) {
      throw new Error(`Failed to spawn enemy ${i + 1}/${config.enemyCount}`);
    }
    enemy.bossSummonedEscorts = true;
  }

  const rng = new SeededRng(2026 + config.enemyCount);

  // Warmup pass so JIT & pools stabilize before timing
  for (let w = 0; w < 2; w++) {
    resetEnemiesForBatch(world, rng);
    for (let t = 0; t < ticksPerBatch; t++) {
      world.fixedTick(BALANCE.fixedDt);
    }
  }

  let totalMs = 0;
  let peakProjectiles = 0;
  for (let b = 0; b < batches; b++) {
    resetEnemiesForBatch(world, rng);
    const t0 = performance.now();
    for (let t = 0; t < ticksPerBatch; t++) {
      world.fixedTick(BALANCE.fixedDt);
    }
    totalMs += performance.now() - t0;

    if (world.enemyPool.getActiveCount() !== config.enemyCount) {
      throw new Error(
        `Benchmark lost/leaked enemies (${world.enemyPool.getActiveCount()} != ${config.enemyCount})`,
      );
    }
    peakProjectiles = Math.max(peakProjectiles, world.projectilePool.getActiveCount());
  }

  const totalTicks = batches * ticksPerBatch;
  const ticksPerSec = totalTicks / (totalMs / 1000);
  const msPerTick = totalMs / totalTicks;
  const simMsAt3xFrame = msPerTick * 3;

  return {
    enemyCount: config.enemyCount,
    towerCount: actualTowers,
    totalTicks,
    elapsedMs: totalMs,
    ticksPerSec,
    msPerTick,
    simMsAt3xFrame,
    softBudgetTicksPerSec: config.softBudgetTicksPerSec,
    meetsSoftBudget: ticksPerSec >= config.softBudgetTicksPerSec,
    peakProjectiles,
  };
}

function main(): void {
  const strict = process.argv.includes('--strict');
  const level = pickBenchLevel();

  console.log(
    `=== Skyhold Isles Sim Benchmark (level=${level.name}, 40 active towers, 60 Hz fixedTick) ===\n`,
  );

  // Brief global JIT warmup before running reported scenarios
  runSimBenchScenario(level, BENCH_SCENARIOS[0], 1, 120);

  const results: BenchScenarioResult[] = [];
  for (const scenario of BENCH_SCENARIOS) {
    results.push(runSimBenchScenario(level, scenario));
  }

  let anySoftMiss = false;
  let anyHardFail = false;

  console.log('Enemies | Towers | Ticks/sec |  ms/tick | 3x Sim/Frame | PeakProj | Soft Budget | Status');
  console.log('--------+--------+-----------+----------+--------------+----------+-------------+--------');
  for (const r of results) {
    const hardOk = r.ticksPerSec >= HARD_FLOOR_TICKS_PER_SEC;
    if (!hardOk) anyHardFail = true;
    if (!r.meetsSoftBudget) anySoftMiss = true;

    const status = !hardOk ? 'FAIL' : r.meetsSoftBudget ? 'PASS' : 'WARN';
    console.log(
      `${String(r.enemyCount).padStart(7)} | ` +
        `${String(r.towerCount).padStart(6)} | ` +
        `${Math.round(r.ticksPerSec).toString().padStart(9)} | ` +
        `${r.msPerTick.toFixed(4).padStart(8)} | ` +
        `${(r.simMsAt3xFrame.toFixed(3) + ' ms').padStart(12)} | ` +
        `${String(r.peakProjectiles).padStart(8)} | ` +
        `${('>=' + r.softBudgetTicksPerSec + '/s').padStart(11)} | ` +
        `${status}`,
    );
  }

  console.log('');
  if (anyHardFail) {
    console.error(`Sim benchmark FAILED: dropped below 3x real-time floor (${HARD_FLOOR_TICKS_PER_SEC} ticks/sec).`);
    process.exit(1);
  }
  if (anySoftMiss) {
    const msg = 'Sim benchmark WARN: one or more scenarios missed the soft mobile-headroom budget.';
    if (strict) {
      console.error(`${msg} (--strict enabled)`);
      process.exit(1);
    }
    console.warn(`${msg} (soft assertion; pass --strict to fail CI)`);
    return;
  }
  console.log('Sim benchmark PASSED: all scenarios met soft phone-headroom budgets!');
}

if (process.argv[1]?.endsWith('simBench.ts')) {
  main();
}
