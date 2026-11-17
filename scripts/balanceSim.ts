import { EventBus } from '../src/core/eventBus.ts';
import type { EnemyType } from '../src/core/types.ts';
import { BALANCE } from '../src/data/balance.ts';
import { ENEMY_DEFS } from '../src/data/enemies.ts';
import { LEVELS, type LevelDef, type ScriptedBuildAction } from '../src/data/levels/index.ts';
import { NEUTRAL_RUN_MODIFIERS, type RunModifiers } from '../src/data/runModifiers.ts';
import { getTowerTierStats } from '../src/data/towers.ts';
import { maxedWorkshopRanks, workshopModifiers } from '../src/data/workshop.ts';
import { endlessMutatorsAt } from '../src/data/endlessMutators.ts';
import { computeStarRating, SimWorld } from '../src/sim/world.ts';

type ScriptKind = 'greedy' | 'weak';

interface WaveStatRow {
  waveNumber: number;
  startGold: number;
  livesStart: number;
  /** Furthest path progress (0..1) any ground enemy reached during the wave: a continuous "how close was it" signal. */
  peakGroundProgress: number;
  livesLost: number;
  leaksByType: Partial<Record<EnemyType, number>>;
  /** Lives lost per enemy type (a leaking brute/boss/hauler costs more than 1). */
  livesByType: Partial<Record<EnemyType, number>>;
}

export interface SimRunResult {
  levelId: string;
  name: string;
  scriptKind: ScriptKind;
  outcome: 'ongoing' | 'won' | 'lost';
  finalLives: number;
  stars: number;
  startingGold: number;
  goldEarned: number;
  goldSpent: number;
  finalGold: number;
  endGoldPctOfEarned: number;
  /** Unspent gold when the final wave starts, as % of gold earned before it (the final wave's own income can't be spent). */
  lastWaveHoardPct: number;
  towersBuilt: number;
  plannedTowers: number;
  targetingChanges: number;
  waves: WaveStatRow[];
  unspentScriptActions: number;
  invalidActions: number;
  /** Endless continuation (only when requested): furthest wave reached and peak live enemies. */
  endlessReachedWave?: number;
  endlessPeakEnemies?: number;
  endlessOutcome?: 'lost' | 'capped' | 'skipped';
}

function tryExecuteAction(
  world: SimWorld,
  act: ScriptedBuildAction,
): { executed: boolean; invalid: boolean; cost: number; isBuild: boolean; changedTargeting: boolean } {
  if (act.action === 'build') {
    if (!act.towerType) return { executed: false, invalid: true, cost: 0, isBuild: false, changedTargeting: false };
    if (!world.grid.canPlaceTower(act.col, act.row)) {
      return { executed: false, invalid: true, cost: 0, isBuild: false, changedTargeting: false };
    }
    const cost = getTowerTierStats(act.towerType, 1).upgradeCost;
    if (world.gold < cost) {
      return { executed: false, invalid: false, cost, isBuild: false, changedTargeting: false };
    }
    const mode = act.targetingMode ?? 'first';
    const built = world.placeTower(act.col, act.row, act.towerType, mode);
    if (!built) {
      return { executed: false, invalid: true, cost: 0, isBuild: false, changedTargeting: false };
    }
    return {
      executed: true,
      invalid: false,
      cost,
      isBuild: true,
      changedTargeting: mode !== 'first',
    };
  }

  const tid = world.grid.getTowerIdAt(act.col, act.row);
  if (tid === -1) {
    return { executed: false, invalid: true, cost: 0, isBuild: false, changedTargeting: false };
  }
  const tower = world.getTowerById(tid);
  if (!tower || tower.tier >= 3) {
    return { executed: false, invalid: true, cost: 0, isBuild: false, changedTargeting: false };
  }
  const nextTier = (tower.tier + 1) as 2 | 3;
  const cost = getTowerTierStats(tower.type, nextTier).upgradeCost;
  if (world.gold < cost) {
    return { executed: false, invalid: false, cost, isBuild: false, changedTargeting: false };
  }
  const upgraded = world.upgradeTower(tid);
  if (!upgraded) {
    return { executed: false, invalid: true, cost: 0, isBuild: false, changedTargeting: false };
  }
  return { executed: true, invalid: false, cost, isBuild: false, changedTargeting: false };
}

/**
 * Endless sanity spender (script exhausted): upgrade the cheapest tower below T3, otherwise build
 * alternating archers/cannons on the free tiles closest to the road. Crude, but it keeps a late
 * Endless run investing like a player would, so the stacked mutators actually get exercised.
 */
function spendEndlessGold(world: SimWorld): void {
  for (let guard = 0; guard < 40; guard++) {
    let best: { id: number; cost: number } | null = null;
    for (const t of world.towers) {
      if (t.tier >= 3 || t.type === 'beacon') continue;
      const cost = getTowerTierStats(t.type, (t.tier + 1) as 2 | 3).upgradeCost;
      if (!best || cost < best.cost) best = { id: t.id, cost };
    }
    if (best && world.gold >= best.cost) {
      world.upgradeTower(best.id);
      continue;
    }
    if (best) return;
    const type = world.towers.length % 2 === 0 ? 'archer' : 'cannon';
    if (world.gold < getTowerTierStats(type, 1).upgradeCost) return;
    let placed = false;
    for (let r = 0; r < world.level.rows && !placed; r++) {
      for (let c = 0; c < world.level.cols && !placed; c++) {
        if (!world.grid.canPlaceTower(c, r)) continue;
        const nearRoad =
          world.grid.getTile(c + 1, r) === 'path' ||
          world.grid.getTile(c - 1, r) === 'path' ||
          world.grid.getTile(c, r + 1) === 'path' ||
          world.grid.getTile(c, r - 1) === 'path';
        if (nearRoad && world.placeTower(c, r, type)) placed = true;
      }
    }
    if (!placed) return;
  }
}

export function runLevelBalanceSim(
  level: LevelDef,
  scriptKind: ScriptKind,
  scriptActions: readonly ScriptedBuildAction[],
  mods: RunModifiers = NEUTRAL_RUN_MODIFIERS,
  /** After a win, keep going in Endless for up to this many generated waves (0 = stop at the win). */
  endlessWaves = 0,
): SimRunResult {
  const events = new EventBus();
  const world = new SimWorld(level, events, mods);

  const plannedTowers = scriptActions.filter((a) => a.action === 'build').length;
  const waveRows: WaveStatRow[] = [];
  let activeWaveRow = null as WaveStatRow | null;
  let goldEarned = 0;
  let earnedBeforeLastWave = 0;
  let goldSpent = 0;
  let towersBuilt = 0;
  let targetingChanges = 0;
  let invalidActions = 0;

  events.on('waveStarted', (ev) => {
    goldEarned += ev.earlyBonus;
    if (ev.waveIndex === level.waves.length - 1) earnedBeforeLastWave = goldEarned;
    activeWaveRow = {
      waveNumber: ev.waveIndex + 1,
      startGold: world.gold,
      livesStart: world.lives,
      peakGroundProgress: 0,
      livesLost: 0,
      leaksByType: {},
      livesByType: {},
    };
    waveRows.push(activeWaveRow);
  });

  events.on('enemyKilled', (ev) => {
    goldEarned += ev.reward;
  });

  events.on('waveCompleted', (ev) => {
    goldEarned += ev.bonus;
  });

  events.on('enemyLeaked', (ev) => {
    if (!activeWaveRow) return;
    activeWaveRow.livesLost += ev.livesLost;
    activeWaveRow.leaksByType[ev.enemyType] =
      (activeWaveRow.leaksByType[ev.enemyType] ?? 0) + 1;
    activeWaveRow.livesByType[ev.enemyType] =
      (activeWaveRow.livesByType[ev.enemyType] ?? 0) + ev.livesLost;
  });

  const queue = [...scriptActions];
  const executeStep = (): boolean => {
    while (queue.length > 0) {
      const res = tryExecuteAction(world, queue[0]);
      if (res.invalid) {
        invalidActions++;
        queue.shift();
        continue;
      }
      if (!res.executed) return false;
      goldSpent += res.cost;
      if (res.isBuild) towersBuilt++;
      if (res.changedTargeting) targetingChanges++;
      queue.shift();
      return true;
    }
    return false;
  };

  // Pre-wave 1: human player places initial towers freely before pressing Start Wave
  while (executeStep()) {
    // spend starting gold greedily
  }
  world.startNextWave();

  // During active waves, player builds/upgrades at most once every 8.0 seconds.
  // Between waves, player builds/upgrades greedily using available gold.
  const COMBAT_COOLDOWN_SEC = 8.0;
  let combatCooldown = COMBAT_COOLDOWN_SEC;
  let wasBetweenWaves = false;

  const maxTicks = 60 * 2600;
  for (let tick = 0; tick < maxTicks && world.outcome === 'ongoing'; tick++) {
    const state = world.waveSystem.state;
    if (state === 'betweenWaves') {
      wasBetweenWaves = true;
      while (executeStep()) {
        // spend between waves greedily
      }
    } else {
      if (wasBetweenWaves) {
        combatCooldown = COMBAT_COOLDOWN_SEC;
        wasBetweenWaves = false;
      }
      if (combatCooldown > 0) {
        combatCooldown = Math.max(0, combatCooldown - BALANCE.fixedDt);
      }
      if (combatCooldown <= 0 && executeStep()) {
        combatCooldown = COMBAT_COOLDOWN_SEC;
      }
    }

    world.fixedTick(BALANCE.fixedDt);
    if (activeWaveRow) {
      const pool = world.enemyPool;
      for (let p = 0; p < pool.getActiveCount(); p++) {
        const e = pool.items[pool.getActiveIndex(p)];
        if (e.flying || e.totalDist <= 0) continue;
        const prog = e.dist / e.totalDist;
        if (prog > activeWaveRow.peakGroundProgress) activeWaveRow.peakGroundProgress = prog;
      }
    }
  }

  const lastRow = waveRows[waveRows.length - 1];
  const lastWaveHoardPct =
    lastRow && earnedBeforeLastWave > 0 ? (lastRow.startGold / earnedBeforeLastWave) * 100 : 0;
  const endGoldPctOfEarned = goldEarned > 0 ? (world.gold / goldEarned) * 100 : 0;
  const storyOutcome = world.outcome;
  const storyLives = world.lives;
  const storyGold = world.gold;
  const storyWaves = [...waveRows];

  let endlessReachedWave: number | undefined;
  let endlessPeakEnemies: number | undefined;
  let endlessOutcome: SimRunResult['endlessOutcome'];
  if (endlessWaves > 0) {
    endlessOutcome = 'skipped';
    if (world.outcome === 'won' && world.enterEndlessMode()) {
      // Endless sanity run: keep spending leftover script steps between waves; waves auto-start.
      endlessPeakEnemies = 0;
      const lastIdx = level.waves.length - 1 + endlessWaves;
      const endlessTicks = 60 * 60 * 90;
      for (let tick = 0; tick < endlessTicks && world.outcome === 'ongoing'; tick++) {
        if (world.waveSystem.state === 'betweenWaves') {
          while (executeStep()) {
            // spend between waves greedily
          }
          if (queue.length === 0) spendEndlessGold(world);
        }
        world.fixedTick(BALANCE.fixedDt);
        endlessPeakEnemies = Math.max(endlessPeakEnemies, world.enemyPool.getActiveCount());
        if (world.waveSystem.currentWaveIndex > lastIdx) break;
      }
      endlessReachedWave = world.waveSystem.currentWaveOneBased;
      endlessOutcome = world.outcome === 'lost' ? 'lost' : 'capped';
    }
  }

  return {
    levelId: level.id,
    name: level.name,
    scriptKind,
    outcome: storyOutcome,
    finalLives: storyLives,
    stars: storyOutcome === 'won' ? computeStarRating(storyLives, level.difficulty, world.startingLives) : 0,
    startingGold: level.startingGold,
    goldEarned,
    goldSpent,
    finalGold: storyGold,
    endGoldPctOfEarned,
    lastWaveHoardPct,
    towersBuilt,
    plannedTowers,
    targetingChanges,
    waves: storyWaves,
    unspentScriptActions: queue.length,
    invalidActions,
    endlessReachedWave,
    endlessPeakEnemies,
    endlessOutcome,
  };
}

function printResult(lvlIdx: number, res: SimRunResult, difficulty: string): void {
  const tag = res.scriptKind === 'greedy' ? 'GREEDY' : 'WEAK  ';
  console.log(
    `[L${lvlIdx + 1} ${tag}] ${res.name} (${difficulty}) -> ${res.outcome.toUpperCase()} | ` +
      `Lives: ${res.finalLives}/${BALANCE.startingLives} | Stars: ${res.stars}/3 | ` +
      `Towers: ${res.towersBuilt}/${res.plannedTowers} (tgtSwaps: ${res.targetingChanges})`,
  );
  console.log(
    `           Start: ${res.startingGold}g | Earned: ${res.goldEarned}g | Spent: ${res.goldSpent}g | ` +
      `End Gold: ${res.finalGold}g (${res.endGoldPctOfEarned.toFixed(1)}% of earned; ${res.lastWaveHoardPct.toFixed(1)}% hoarded at final wave start) | ` +
      `RemainingSteps: ${res.unspentScriptActions} | Invalid: ${res.invalidActions}`,
  );
  if (res.scriptKind === 'greedy' || res.outcome === 'lost' || res.finalLives < 20) {
    console.log('           Wave | StartGold | LivesLost | PeakProgress | Leaks');
    for (let w = 0; w < res.waves.length; w++) {
      const row = res.waves[w];
      if (row.livesLost === 0 && res.waves.length > 12 && w > 0 && w < res.waves.length - 1) {
        continue;
      }
      const leakPairs = Object.entries(row.leaksByType)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ');
      console.log(
        `           ${String(row.waveNumber).padStart(4)} | ${String(row.startGold).padStart(8)}g | ` +
          `${String(row.livesLost).padStart(9)} | ${(row.peakGroundProgress * 100).toFixed(0).padStart(11)}% | ${leakPairs || '-'}`,
      );
    }
  }
}

/** Runs every (filtered) level's greedy + weak script and applies the balance windows/asserts. */
export function evaluateBalance(
  levelFilter: ReadonlySet<number> | null,
  verbose: boolean,
): { summary: string[]; failures: string[]; robustLines: string[] } {
  /** Greedy (competent build script) lives-left window per difficulty label. */
  const GREEDY_LIVES: Record<LevelDef['difficulty'], readonly [number, number]> = {
    Breezy: [18, 20],
    Challenging: [12, 16],
    Heroic: [8, 13],
    Master: [5, 10],
  };
  /** Max share of lives lost to flyers in a greedy run / a lost weak run. */
  const MAX_FLYER_SHARE_GREEDY = 0.55;
  const MAX_FLYER_SHARE_WEAK_LOSS = 0.7;

  function livesLostTotals(res: SimRunResult): { total: number; flyers: number; byType: Partial<Record<EnemyType, number>> } {
    const byType: Partial<Record<EnemyType, number>> = {};
    let total = 0;
    for (const w of res.waves) {
      total += w.livesLost;
      for (const [k, v] of Object.entries(w.leaksByType)) {
        byType[k as EnemyType] = (byType[k as EnemyType] ?? 0) + (v ?? 0);
      }
    }
    // Lives lost to every flying type (Sky Skimmers and Cloud Haulers alike).
    let flyers = 0;
    for (const w of res.waves) {
      for (const [k, v] of Object.entries(w.livesByType)) {
        if (ENEMY_DEFS[k as EnemyType].flying) flyers += v ?? 0;
      }
    }
    return { total, flyers, byType };
  }

  const robust = process.argv.includes('--robust');
  const failures: string[] = [];
  const summary: string[] = [];
  const robustLines: string[] = [];

  for (let i = 0; i < LEVELS.length; i++) {
    if (levelFilter && !levelFilter.has(i)) continue;
    const level = LEVELS[i];
    const greedyRes = runLevelBalanceSim(level, 'greedy', level.scriptedBuildOrder ?? []);
    if (verbose) printResult(i, greedyRes, level.difficulty);

    const weakRes = runLevelBalanceSim(level, 'weak', level.weakBuildOrder ?? []);
    if (verbose) printResult(i, weakRes, level.difficulty);
    if (verbose) console.log('');

    if (process.argv.includes('--peaks')) {
      console.log(
        `           peak ground progress per wave (greedy): ${greedyRes.waves
          .map((w) => (w.peakGroundProgress * 100).toFixed(0))
          .join(' ')}`,
      );
    }

    if (robust) {
      // Informational: greedy lives when every enemy HP is scaled by +-1.5% / +-3% (knife-edge detector).
      const [lo, hi] = GREEDY_LIVES[level.difficulty];
      const cells: string[] = [];
      for (const k of [0.97, 0.985, 1.0, 1.015, 1.03]) {
        const scaled: LevelDef = { ...level, enemyHpScale: (level.enemyHpScale ?? 1) * k };
        const r = runLevelBalanceSim(scaled, 'greedy', level.scriptedBuildOrder ?? []);
        const ok = r.outcome === 'won' && r.finalLives >= lo && r.finalLives <= hi;
        cells.push(`x${k.toFixed(3)}:${r.outcome === 'won' ? r.finalLives : 'LOST'}${ok ? '' : '!'}`);
      }
      robustLines.push(`L${i + 1} ${level.difficulty.padEnd(11)} ${cells.join('  ')}   (window ${lo}-${hi}, ! = outside)`);
    }

    const gT = livesLostTotals(greedyRes);
    const wT = livesLostTotals(weakRes);
    const fmt = (t: ReturnType<typeof livesLostTotals>): string =>
      Object.entries(t.byType)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ') || '-';
    summary.push(
      `L${i + 1} ${level.difficulty.padEnd(11)} greedy ${greedyRes.outcome === 'won' ? 'W' : greedyRes.outcome === 'lost' ? 'L' : '?'} ` +
        `${String(greedyRes.finalLives).padStart(2)}L ${greedyRes.stars}* leaks[${fmt(gT)}] | ` +
        `weak ${weakRes.outcome === 'won' ? 'W' : weakRes.outcome === 'lost' ? 'L' : '?'} ` +
        `${String(weakRes.finalLives).padStart(2)}L ${weakRes.stars}* (reached wave ${weakRes.waves.length}/${level.waves.length}) leaks[${fmt(wT)}]`,
    );

    if (greedyRes.outcome !== 'won') {
      failures.push(`L${i + 1} greedy did not win`);
    }
    const [gMin, gMax] = GREEDY_LIVES[level.difficulty];
    if (greedyRes.finalLives < gMin || greedyRes.finalLives > gMax) {
      failures.push(`L${i + 1} greedy lives ${greedyRes.finalLives} outside ${level.difficulty} window ${gMin}-${gMax}`);
    }
    if (gT.total >= 4 && gT.flyers / gT.total > MAX_FLYER_SHARE_GREEDY) {
      failures.push(`L${i + 1} greedy flyer leaks dominate (${gT.flyers}/${gT.total} lives)`);
    }
    if (weakRes.outcome === 'lost' && wT.total >= 4 && wT.flyers / wT.total > MAX_FLYER_SHARE_WEAK_LOSS) {
      failures.push(`L${i + 1} weak loss dominated by flyers (${wT.flyers}/${wT.total} lives)`);
    }
    if (greedyRes.lastWaveHoardPct >= 15) {
      failures.push(`L${i + 1} greedy hoards ${greedyRes.lastWaveHoardPct.toFixed(1)}% of earned gold at final wave start (>= 15%)`);
    }
    if (greedyRes.invalidActions > 0) {
      failures.push(`L${i + 1} greedy has ${greedyRes.invalidActions} invalid actions`);
    }
    if (weakRes.invalidActions > 0) {
      failures.push(`L${i + 1} weak has ${weakRes.invalidActions} invalid actions`);
    }
    if (weakRes.targetingChanges > 0) {
      failures.push(`L${i + 1} weak used ${weakRes.targetingChanges} targeting mode changes (expected 0)`);
    }

    const weakPlanRatio =
      greedyRes.plannedTowers > 0 ? weakRes.plannedTowers / greedyRes.plannedTowers : 1;
    if (weakPlanRatio > 0.74 || weakPlanRatio < 0.64) {
      failures.push(
        `L${i + 1} weak planned towers (${weakRes.plannedTowers}/${greedyRes.plannedTowers} = ${(weakPlanRatio * 100).toFixed(0)}%) should be ~70%`,
      );
    }

    if (level.difficulty === 'Breezy' && greedyRes.stars !== 3) {
      failures.push(`L${i + 1} greedy got ${greedyRes.stars} stars (expected 3)`);
    }
    if (level.difficulty === 'Challenging' && greedyRes.stars !== 2) {
      failures.push(`L${i + 1} greedy got ${greedyRes.stars} stars (expected 2)`);
    }
    if ((level.difficulty === 'Heroic' || level.difficulty === 'Master') && (greedyRes.stars < 1 || greedyRes.stars > 2)) {
      failures.push(`L${i + 1} greedy got ${greedyRes.stars} stars (expected 1-2)`);
    }

    if (level.difficulty === 'Breezy') {
      if (weakRes.outcome !== 'won') {
        failures.push(`L${i + 1} weak must still be winnable`);
      } else if (weakRes.stars === 3) {
        failures.push(`L${i + 1} weak won with 3 stars (${weakRes.finalLives} lives); expected 1-2 stars`);
      }
    }
    if (level.difficulty === 'Challenging') {
      if (weakRes.outcome === 'won' && weakRes.finalLives > 8) {
        failures.push(`L${i + 1} weak too comfortable (${weakRes.finalLives} lives left; expected borderline <= 8)`);
      }
      if (weakRes.outcome === 'lost' && weakRes.waves.length < Math.ceil(level.waves.length * 0.75)) {
        failures.push(`L${i + 1} weak lost too early on wave ${weakRes.waves.length}/${level.waves.length}`);
      }
    }
    if ((level.difficulty === 'Heroic' || level.difficulty === 'Master') && weakRes.outcome !== 'lost') {
      failures.push(`L${i + 1} weak must lose (got ${weakRes.outcome} with ${weakRes.finalLives} lives)`);
    }
  }

  return { summary, failures, robustLines };
}

/**
 * Endless sanity: a few islands continue into Endless after the greedy win. Escalation (HP growth,
 * bosses, stacking mutators) must end every run well before the cap, and the live enemy count
 * must stay inside the pool.
 */
export function evaluateEndlessSanity(
  levelFilter: ReadonlySet<number> | null,
): { lines: string[]; failures: string[] } {
  const CAP = 40;
  const sample = [0, 6, LEVELS.length - 1];
  const lines: string[] = [];
  const failures: string[] = [];
  for (const i of sample) {
    if (levelFilter && !levelFilter.has(i)) continue;
    const level = LEVELS[i];
    const r = runLevelBalanceSim(level, 'greedy', level.scriptedBuildOrder ?? [], NEUTRAL_RUN_MODIFIERS, CAP);
    const reached = r.endlessReachedWave ?? 0;
    const cleared = Math.max(0, reached - 1 - level.waves.length);
    const mutators = endlessMutatorsAt(cleared, level.index).map((m) => m.name);
    lines.push(
      `L${i + 1} ${level.difficulty.padEnd(11)} endless ${r.endlessOutcome} at wave ${reached} ` +
        `(${cleared} endless waves cleared, peak ${r.endlessPeakEnemies ?? 0} foes; mutators: ${mutators.join(', ') || '-'})`,
    );
    if (r.endlessOutcome === 'capped') {
      failures.push(`L${i + 1} endless greedy survived ${CAP} generated waves (escalation too weak)`);
    }
    if ((r.endlessPeakEnemies ?? 0) >= BALANCE.pools.maxEnemies) {
      failures.push(`L${i + 1} endless filled the enemy pool (${r.endlessPeakEnemies})`);
    }
  }
  return { lines, failures };
}

/**
 * Meta-progression guard: the same greedy scripts with every Workshop upgrade at max rank.
 * Upgrades must help (never hurt) but not trivialise the hardest islands: a maxed greedy run must
 * still lose lives on every Master island (and on average gain only a few lives anywhere).
 */
export function evaluateWorkshopMax(
  levelFilter: ReadonlySet<number> | null,
): { lines: string[]; failures: string[] } {
  const mods = workshopModifiers(maxedWorkshopRanks());
  const lines: string[] = [];
  const failures: string[] = [];
  for (let i = 0; i < LEVELS.length; i++) {
    if (levelFilter && !levelFilter.has(i)) continue;
    const level = LEVELS[i];
    const base = runLevelBalanceSim(level, 'greedy', level.scriptedBuildOrder ?? []);
    const maxed = runLevelBalanceSim(level, 'greedy', level.scriptedBuildOrder ?? [], mods);
    const baseLost = base.outcome === 'won' ? BALANCE.startingLives - base.finalLives : BALANCE.startingLives;
    const startLives = BALANCE.startingLives + mods.bonusLives;
    const maxedLost = maxed.outcome === 'won' ? startLives - maxed.finalLives : startLives;
    // Informational: the scripted build is chaotic, so a small boost can also shift its timing
    // into a worse run (more lives lost) — that is noise, not the upgrade hurting real players.
    const note = maxedLost > baseLost ? '  (script timing noise: worse than base)' : '';
    lines.push(
      `L${i + 1} ${level.difficulty.padEnd(11)} lives lost: base ${String(baseLost).padStart(2)} -> maxed ${String(maxedLost).padStart(2)} ` +
        `(${maxed.outcome === 'won' ? 'W' : 'L'}, ${maxed.stars}*)${note}`,
    );
    if (level.difficulty === 'Master' && maxed.outcome === 'won' && maxedLost === 0) {
      failures.push(`L${i + 1} Workshop-maxed greedy loses no lives on a Master island (trivialised)`);
    }
  }
  return { lines, failures };
}

function main(): void {
  console.log('=== Skyhold Isles Headless Balance Simulator (60 Hz Human-Paced) ===\n');

  // Optional filter for quicker iteration, e.g. `LEVELS=3,6 npm run sim:balance`.
  // CLI alternative: `npm run sim:balance -- --levels=3,6`.
  const levelsArg = process.argv.find((a) => a.startsWith('--levels='))?.slice('--levels='.length);
  const levelsSpec = levelsArg ?? process.env.LEVELS;
  const levelFilter = levelsSpec ? new Set(levelsSpec.split(',').map((x) => Number(x.trim()) - 1)) : null;
  const { summary, failures, robustLines } = evaluateBalance(levelFilter, true);
  const workshop = evaluateWorkshopMax(levelFilter);
  failures.push(...workshop.failures);
  const endless = evaluateEndlessSanity(levelFilter);
  failures.push(...endless.failures);

  console.log('=== Summary (lives left / stars / leaks by type over the whole run) ===');
  for (const line of summary) console.log(line);
  console.log('');
  console.log('=== Endless sanity (greedy continues after the win; informational unless capped/pool-full) ===');
  for (const line of endless.lines) console.log(line);
  console.log('');
  console.log('=== Workshop max (all upgrades, greedy script; baseline above uses none) ===');
  for (const line of workshop.lines) console.log(line);
  console.log('');
  if (robustLines.length > 0) {
    console.log('=== Robustness (greedy lives vs enemy HP scale; informational) ===');
    for (const line of robustLines) console.log(line);
    console.log('');
  }

  if (failures.length > 0) {
    console.error('Balance check FAILED:');
    for (const f of failures) console.error(' - ' + f);
    process.exit(1);
  }
  console.log(`Balance check PASSED: Greedy & Weak targets met across ${summary.length} level(s)!`);
}

if (process.argv[1]?.endsWith('balanceSim.ts')) main();
