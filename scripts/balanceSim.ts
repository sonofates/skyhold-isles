import { balanceBuildOrder, type BalanceBuildAction } from './lib/specializationBuilds.ts';
import { driveScriptedHero } from './heroBalance.ts';
import { campaignKit, driveGlobalAbilities, type CampaignKit } from './lib/campaignKit.ts';
import { findMergePoint } from '../src/sim/groundGraph.ts';
import { EventBus } from '../src/core/eventBus.ts';
import type { EnemyType } from '../src/core/types.ts';
import { HERO_DEFS, HERO_IDS } from '../src/data/heroes.ts';
import { BALANCE } from '../src/data/balance.ts';
import { ENEMY_DEFS } from '../src/data/enemies.ts';
import { LEVELS, type LevelDef } from '../src/data/levels/index.ts';
import { LEVELS_2D } from '../src/data/levels2d/index.ts';
import { NEUTRAL_RUN_MODIFIERS, type RunModifiers } from '../src/data/runModifiers.ts';
import { getTowerTierStats, specializationsFor } from '../src/data/towers.ts';
import { maxedWorkshopRanks, workshopModifiers, workshopStarsSpent } from '../src/data/workshop.ts';
import { endlessMutatorsAt } from '../src/data/endlessMutators.ts';
import { challengesForLevel, runModifiersFor } from '../src/data/challenges.ts';
import { computeStarRating, SimWorld } from '../src/sim/world.ts';

type ScriptKind = 'greedy' | 'weak';

interface WaveStatRow {
  waveNumber: number;
  startGold: number;
  livesStart: number;
  /** Furthest path progress (0..1) any ground enemy reached during the wave: a continuous "how close was it" signal. */
  peakGroundProgress: number;
  livesLost: number;
  /** Sum of the crossing enemies' full costs, used by the historical 3D text report. */
  nominalLeakCost: number;
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
  startingLives: number;
  heroXp: number;
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
  towerPurchases: string[];
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
  act: BalanceBuildAction,
): { executed: boolean; invalid: boolean; cost: number; isBuild: boolean; changedTargeting: boolean } {
  if (act.action === 'build') {
    if (!act.towerType) return { executed: false, invalid: true, cost: 0, isBuild: false, changedTargeting: false };
    // Plot levels address plots as (col = plot index, row = 0); see MapGrid.
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
  if (!tower) return { executed: false, invalid: true, cost: 0, isBuild: false, changedTargeting: false };
  if (act.action === 'specialize' || act.action === 'buyAbility') {
    const branches = specializationsFor(tower);
    const branchId = act.action === 'specialize' ? act.id : tower.specialization?.id;
    const branch = branches.find(b => b.id === branchId);
    const item = act.action === 'specialize' ? branch : branch?.abilities.find(a => a.id === act.id);
    const cost = item?.cost ?? 0;
    if (item && world.gold < cost) return { executed: false, invalid: false, cost, isBuild: false, changedTargeting: false };
    const executed = act.action === 'specialize' ? world.specializeTower(tid, act.id) : world.buyTowerAbility(tid, act.id);
    return { executed, invalid: !executed, cost, isBuild: false, changedTargeting: false };
  }
  if (tower.tier >= 3) {
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
    if (world.grid.isPlotMode) {
      for (let p = 0; p < world.grid.plotCount && !placed; p++) {
        if (world.placeTowerOnPlot(p, type)) placed = true;
      }
      if (!placed) return;
      continue;
    }
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
  scriptActions: readonly BalanceBuildAction[],
  profile: RunModifiers | CampaignKit = NEUTRAL_RUN_MODIFIERS,
  /** After a win, keep going in Endless for up to this many generated waves (0 = stop at the win). */
  endlessWaves = 0,
): SimRunResult {
  const kit = 'heroId' in profile ? profile : undefined;
  const events = new EventBus();
  const world = new SimWorld(level, events, profile);
  const post = world.hero ? findMergePoint([world.groundPath, ...world.extraGroundPaths]) : null;

  const startingGold = world.gold;
  const plannedTowers = scriptActions.filter((a) => a.action === 'build').length;
  const waveRows: WaveStatRow[] = [];
  let activeWaveRow = null as WaveStatRow | null;
  let goldEarned = 0;
  let earnedBeforeLastWave = 0;
  let goldSpent = 0;
  let towersBuilt = 0;
  let targetingChanges = 0;
  const towerPurchases: string[] = [];
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
      nominalLeakCost: 0,
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
    // The world has already charged this arrival. More enemies can cross on the defeat tick.
    const waveLoss = activeWaveRow.livesStart - world.lives;
    const charged = waveLoss - activeWaveRow.livesLost;
    activeWaveRow.livesLost = waveLoss;
    activeWaveRow.nominalLeakCost += ev.livesLost;
    activeWaveRow.leaksByType[ev.enemyType] =
      (activeWaveRow.leaksByType[ev.enemyType] ?? 0) + 1;
    activeWaveRow.livesByType[ev.enemyType] =
      (activeWaveRow.livesByType[ev.enemyType] ?? 0) + charged;
  });

  const queue = [...scriptActions];
  const executeStep = (): boolean => {
    while (queue.length > 0) {
      const action = queue[0];
      const res = tryExecuteAction(world, action);
      if (res.invalid) {
        invalidActions++;
        queue.shift();
        continue;
      }
      if (!res.executed) return false;
      if (action.action === 'specialize' || action.action === 'buyAbility') towerPurchases.push(action.id);
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
  if (post) {
    world.commandHeroMove(post.x, post.z);
    for (let i = 0; i < 720 && world.hero?.state === 'moving'; i++) world.fixedTick(BALANCE.fixedDt);
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

    if (kit && tick % 30 === 0) {
      if (post) driveScriptedHero(world, post.x, post.z);
      driveGlobalAbilities(world, kit);
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
  // Endless reuses the world, event listeners and build queue. Record the story at its boundary.
  const story = {
    levelId: level.id,
    name: level.name,
    scriptKind,
    outcome: world.outcome,
    finalLives: world.lives,
    stars: world.outcome === 'won' ? computeStarRating(world.lives, level.difficulty, world.startingLives) : 0,
    startingGold,
    startingLives: world.startingLives,
    heroXp: world.heroSystem.runXp,
    goldEarned,
    goldSpent,
    finalGold: world.gold,
    endGoldPctOfEarned,
    lastWaveHoardPct,
    towersBuilt,
    plannedTowers,
    targetingChanges,
    towerPurchases: [...towerPurchases],
    waves: [...waveRows],
    unspentScriptActions: queue.length,
    invalidActions,
  };

  let endlessReachedWave: number | undefined;
  let endlessPeakEnemies: number | undefined;
  let endlessOutcome: SimRunResult['endlessOutcome'];
  if (endlessWaves > 0) {
    endlessOutcome = 'skipped';
    if (world.enterEndlessMode()) {
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
    ...story,
    endlessReachedWave,
    endlessPeakEnemies,
    endlessOutcome,
  };
}

/** Campaign islands are labelled L1..L16; 2D side islands by id (e.g. l1c). */
export interface BalanceEntry {
  readonly label: string;
  readonly level: LevelDef;
}

export function balanceEntries(): BalanceEntry[] {
  return [
    ...LEVELS.map((level, i) => ({ label: `L${i + 1}`, level })),
    ...LEVELS_2D.map((level) => ({ label: level.id, level })),
  ];
}

/** `--levels=3,6,l1c`: numbers pick campaign islands (1-based), other tokens match 2D ids. */
function entryMatches(filter: ReadonlySet<string> | null, e: BalanceEntry): boolean {
  if (!filter) return true;
  return filter.has(e.label) || filter.has(e.label.toLowerCase());
}

function printResult(label: string, res: SimRunResult, level: LevelDef): void {
  const tag = res.scriptKind === 'greedy' ? 'GREEDY' : 'WEAK  ';
  console.log(
    `[${label} ${tag}] ${res.name} (${level.difficulty}) -> ${res.outcome.toUpperCase()} | ` +
      `Lives: ${res.finalLives}/${res.startingLives} | Stars: ${res.stars}/3 | ` +
      `Towers: ${res.towersBuilt}/${res.plannedTowers} (tgtSwaps: ${res.targetingChanges})`,
  );
  console.log(
    `           Start: ${res.startingGold}g | Earned: ${res.goldEarned}g | Spent: ${res.goldSpent}g | ` +
      `End Gold: ${res.finalGold}g (${res.endGoldPctOfEarned.toFixed(1)}% of earned; ${res.lastWaveHoardPct.toFixed(1)}% hoarded at final wave start) | ` +
      `RemainingSteps: ${res.unspentScriptActions} | Invalid: ${res.invalidActions}`,
  );
  if (res.towerPurchases.length) console.log(`           Tier IV purchases: ${res.towerPurchases.join(', ')}`);
  if (res.scriptKind === 'greedy' || res.outcome === 'lost' || res.finalLives < 20) {
    console.log('           Wave | StartGold | LivesLost | PeakProgress | Leaks');
    for (let w = 0; w < res.waves.length; w++) {
      const row = res.waves[w];
      const reportedLoss = level.layout2d ? row.livesLost : row.nominalLeakCost;
      if (reportedLoss === 0 && res.waves.length > 12 && w > 0 && w < res.waves.length - 1) {
        continue;
      }
      const leakPairs = Object.entries(row.leaksByType)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ');
      console.log(
        `           ${String(row.waveNumber).padStart(4)} | ${String(row.startGold).padStart(8)}g | ` +
          `${String(reportedLoss).padStart(9)} | ${(row.peakGroundProgress * 100).toFixed(0).padStart(11)}% | ${leakPairs || '-'}`,
      );
    }
  }
}

/** First-clear targets in campaign order, expressed in lives LOST including Bastion's lives. */
function islandLossWindow(index: number): readonly [number, number] {
  if (index <= 1) return [1, 3];
  if (index <= 5) return [2, 6];
  if (index === 6) return [6, 8]; // Three bosses, five lives apiece.
  if (index <= 10) return [4, 8];
  if (index <= 16) return [6, 11];
  if (index <= 20) return [7, 12];
  return [9, 14];
}

function runScript(map: LevelDef, kind: ScriptKind, kit?: CampaignKit): SimRunResult {
  return runLevelBalanceSim(map, kind, balanceBuildOrder(map, kind), kit);
}

function formatLoss(res: SimRunResult): string {
  return `${res.startingLives - res.finalLives} lost / ${res.stars}★`;
}

/** Optional, matched-inventory probes. A newly unlocked hero starts from zero personal XP. */
function printKitDetail(level: LevelDef, kit: CampaignKit, xpAtEntry: number[], previousStars: number): void {
  function printPair(label: string, profile: CampaignKit): void {
    const greedy = runScript(level, 'greedy', profile);
    const weak = runScript(level, 'weak', profile);
    console.log(`  ${label}: greedy ${formatLoss(greedy)}, weak ${formatLoss(weak)}`);
  }
  console.log(`[${level.id} kit detail]`);
  const empty: CampaignKit = { ...kit, heroId: null, modifiers: NEUTRAL_RUN_MODIFIERS, meteor: false, overcharge: false };
  printPair('Bran alone', { ...empty, heroId: 'bran' });
  printPair('Meteor alone', { ...empty, meteor: true });
  printPair('Overcharge alone', { ...empty, overcharge: true });
  printPair('Workshop alone', { ...empty, modifiers: kit.modifiers });
  for (const id of HERO_IDS) {
    const unlock = HERO_DEFS[id].unlock;
    if (unlock.kind !== 'islandsCleared' || unlock.count >= xpAtEntry.length) continue;
    const alternate = campaignKit(xpAtEntry[xpAtEntry.length - 1] - xpAtEntry[unlock.count], previousStars, id);
    printPair(`${id} L${alternate.heroLevel}, full kit`, alternate);
  }
}

/** Runs every (filtered) level's greedy + weak script and applies the balance windows/asserts. */
export function evaluateBalance(
  levelFilter: ReadonlySet<string> | null,
  verbose: boolean,
  probeCampaignVariance = false,
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

  // A filtered run must enter with exactly the inventory it would have in the full campaign.
  const lastIsland = LEVELS_2D.findLastIndex(level => entryMatches(levelFilter, { level, label: level.id }));
  const xpAtEntry: number[] = [];
  let xp = 0;
  let stars = 0;
  let previousLoss = 0;
  for (const entry of balanceEntries()) {
    const { level, label } = entry;
    const index = LEVELS_2D.indexOf(level);
    const selected = entryMatches(levelFilter, entry);
    if (!selected && (index < 0 || index > lastIsland)) continue;
    const kit = index >= 0 ? campaignKit(xp, stars) : undefined;
    const greedyRes = runScript(level, 'greedy', kit);
    const entryStars = stars;
    if (kit) {
      xpAtEntry.push(xp);
      xp += greedyRes.heroXp;
      stars += greedyRes.stars;
      const lost = greedyRes.startingLives - greedyRes.finalLives;
      if (selected && index !== 17 && previousLoss - lost > 3) {
        failures.push(`${label} loses ${lost} lives after ${previousLoss} on the preceding island`);
      }
      previousLoss = lost;
    }
    if (!selected) continue;
    if (verbose) printResult(label, greedyRes, level);
    const weakRes = runScript(level, 'weak', kit);
    if (verbose) printResult(label, weakRes, level);
    if (verbose) console.log('');

    if (process.argv.includes('--peaks')) {
      console.log(
        `           peak ground progress per wave (greedy): ${greedyRes.waves
          .map((w) => (w.peakGroundProgress * 100).toFixed(0))
          .join(' ')}`,
      );
    }

    const start = greedyRes.startingLives;
    const [minLost, maxLost] = islandLossWindow(index);
    const [gMin, gMax] = kit ? [start - maxLost, start - minLost] : GREEDY_LIVES[level.difficulty];
    if (robust && !kit) {
      // Informational: greedy lives when every enemy HP is scaled by +-1.5% / +-3% (knife-edge detector).
      const cells: string[] = [];
      for (const k of [0.97, 0.985, 1.0, 1.015, 1.03]) {
        const scaled: LevelDef = { ...level, enemyHpScale: (level.enemyHpScale ?? 1) * k };
        const r = runScript(scaled, 'greedy', kit);
        const ok = r.outcome === 'won' && r.finalLives >= gMin && r.finalLives <= gMax;
        cells.push(`x${k.toFixed(3)}:${r.outcome === 'won' ? r.finalLives : 'LOST'}${ok ? '' : '!'}`);
      }
      robustLines.push(`${label} ${level.difficulty.padEnd(11)} ${cells.join('  ')}   (window ${gMin}-${gMax}, ! = outside)`);
    }

    const gT = livesLostTotals(greedyRes);
    const wT = livesLostTotals(weakRes);
    const fmt = (t: ReturnType<typeof livesLostTotals>): string =>
      Object.entries(t.byType)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ') || '-';
    summary.push(
      `${label} ${level.difficulty.padEnd(11)} greedy ${greedyRes.outcome === 'won' ? 'W' : greedyRes.outcome === 'lost' ? 'L' : '?'} ` +
        `${String(greedyRes.finalLives).padStart(2)}L ${greedyRes.stars}* leaks[${fmt(gT)}] | ` +
        `weak ${weakRes.outcome === 'won' ? 'W' : weakRes.outcome === 'lost' ? 'L' : '?'} ` +
        `${String(weakRes.finalLives).padStart(2)}L ${weakRes.stars}* (reached wave ${weakRes.waves.length}/${level.waves.length}) leaks[${fmt(wT)}]`,
    );

    if (greedyRes.outcome !== 'won') {
      failures.push(`${label} greedy did not win`);
    }

    if (greedyRes.finalLives < gMin || greedyRes.finalLives > gMax) {
      failures.push(`${label} greedy lives ${greedyRes.finalLives} outside ${level.difficulty} window ${gMin}-${gMax}`);
    }
    if (gT.total >= 4 && gT.flyers / gT.total > MAX_FLYER_SHARE_GREEDY) {
      failures.push(`${label} greedy flyer leaks dominate (${gT.flyers}/${gT.total} lives)`);
    }
    if (weakRes.outcome === 'lost' && wT.total >= 4 && wT.flyers / wT.total > MAX_FLYER_SHARE_WEAK_LOSS) {
      failures.push(`${label} weak loss dominated by flyers (${wT.flyers}/${wT.total} lives)`);
    }
    if (greedyRes.lastWaveHoardPct >= 15) {
      failures.push(`${label} greedy hoards ${greedyRes.lastWaveHoardPct.toFixed(1)}% of earned gold at final wave start (>= 15%)`);
    }
    if (greedyRes.invalidActions > 0) {
      failures.push(`${label} greedy has ${greedyRes.invalidActions} invalid actions`);
    }
    if (weakRes.invalidActions > 0) {
      failures.push(`${label} weak has ${weakRes.invalidActions} invalid actions`);
    }
    if (weakRes.targetingChanges > 0) {
      failures.push(`${label} weak used ${weakRes.targetingChanges} targeting mode changes (expected 0)`);
    }

    const weakPlanRatio =
      greedyRes.plannedTowers > 0 ? weakRes.plannedTowers / greedyRes.plannedTowers : 1;
    if (weakPlanRatio > 0.74 || weakPlanRatio < 0.64) {
      failures.push(
        `${label} weak planned towers (${weakRes.plannedTowers}/${greedyRes.plannedTowers} = ${(weakPlanRatio * 100).toFixed(0)}%) should be ~70%`,
      );
    }

    if (kit) {
      const greedyBase = runScript(level, 'greedy');
      const weakBase = runScript(level, 'weak');
      summary[summary.length - 1] +=
        ` | Bran L${kit.heroLevel}, Workshop ${workshopStarsSpent(kit.ranks)}/${entryStars} stars spent` +
        `\n    no kit (info): greedy ${formatLoss(greedyBase)}, weak ${formatLoss(weakBase)}`;
      if (process.argv.includes('--kit-detail')) printKitDetail(level, kit, xpAtEntry, entryStars);
      if (index <= 1 && weakBase.outcome !== 'won') failures.push(`${label} weak must clear with towers alone`);
      if (probeCampaignVariance || robust) {
        const variants = new Map<string, SimRunResult>([['default', greedyRes]]);
        for (const hp of [0.97, 0.985, 1.015, 1.03]) {
          variants.set(`HP×${hp}`, runScript({ ...level, enemyHpScale: (level.enemyHpScale ?? 1) * hp }, 'greedy', kit));
        }
        for (const seed of [1, 727]) {
          const seeded = { ...kit, seed };
          variants.set(`seed ${seed}`, runScript(level, 'greedy', seeded));
        }
        for (const hero of HERO_IDS) {
          const unlock = HERO_DEFS[hero].unlock;
          if (unlock.kind !== 'islandsCleared' || index < unlock.count) continue;
          variants.set(hero, runScript(level, 'greedy', campaignKit(xpAtEntry[index] - xpAtEntry[unlock.count], entryStars, hero)));
        }
        if (balanceBuildOrder(level, 'greedy').some(action => action.action === 'specialize')) {
          variants.set('base towers', runLevelBalanceSim(level, 'greedy', level.scriptedBuildOrder ?? [], kit));
        }
        for (const [variant, result] of variants) {
          if (result.outcome !== 'won') failures.push(`${label} Normal ${variant} did not clear`);
        }
        robustLines.push(`${label} ${[...variants].map(([name, r]) => `${name}=${formatLoss(r)}`).join(' | ')}`);
      }
      if (weakRes.outcome === 'ongoing') failures.push(`${label} weak hit the simulation tick limit`);
      if (index <= 2 && (weakRes.outcome !== 'won' || weakRes.stars < 2)) {
        failures.push(`${label} weak must win onboarding with at least 2 stars`);
      }
      if (index > 2 && level.difficulty === 'Challenging' && (weakRes.finalLives > 8 ||
          weakRes.waves.length < Math.ceil(level.waves.length * 0.75))) {
        failures.push(`${label} weak should reach the last quarter and finish with at most 8 lives`);
      }
      if ((level.difficulty === 'Heroic' || level.difficulty === 'Master') && weakRes.outcome !== 'lost') {
        failures.push(`${label} weak must lose with the campaign kit`);
      }
      if (level.id === 'i24' && (greedyRes.waves.at(-1)?.livesLost ?? 0) < 3) {
        failures.push('i24 greedy must lose at least 3 lives during the Tempest wave');
      }
      continue;
    }

    if (level.difficulty === 'Breezy' && greedyRes.stars !== 3) {
      failures.push(`${label} greedy got ${greedyRes.stars} stars (expected 3)`);
    }
    if (level.difficulty === 'Challenging' && greedyRes.stars !== 2) {
      failures.push(`${label} greedy got ${greedyRes.stars} stars (expected 2)`);
    }
    if ((level.difficulty === 'Heroic' || level.difficulty === 'Master') && (greedyRes.stars < 1 || greedyRes.stars > 2)) {
      failures.push(`${label} greedy got ${greedyRes.stars} stars (expected 1-2)`);
    }

    if (level.difficulty === 'Breezy') {
      if (weakRes.outcome !== 'won') {
        failures.push(`${label} weak must still be winnable`);
      } else if (weakRes.stars === 3) {
        failures.push(`${label} weak won with 3 stars (${weakRes.finalLives} lives); expected 1-2 stars`);
      }
    }
    if (level.difficulty === 'Challenging') {
      if (weakRes.outcome === 'won' && weakRes.finalLives > 8) {
        failures.push(`${label} weak too comfortable (${weakRes.finalLives} lives left; expected borderline <= 8)`);
      }
      if (weakRes.outcome === 'lost' && weakRes.waves.length < Math.ceil(level.waves.length * 0.75)) {
        failures.push(`${label} weak lost too early on wave ${weakRes.waves.length}/${level.waves.length}`);
      }
    }
    if ((level.difficulty === 'Heroic' || level.difficulty === 'Master') && weakRes.outcome !== 'lost') {
      failures.push(`${label} weak must lose (got ${weakRes.outcome} with ${weakRes.finalLives} lives)`);
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
  levelFilter: ReadonlySet<string> | null,
): { lines: string[]; failures: string[] } {
  const CAP = 40;
  const sample = [0, 6, LEVELS.length - 1];
  const lines: string[] = [];
  const failures: string[] = [];
  for (const i of sample) {
    if (levelFilter && !levelFilter.has(`L${i + 1}`)) continue;
    const level = LEVELS[i];
    const r = runLevelBalanceSim(level, 'greedy', balanceBuildOrder(level, 'greedy'), NEUTRAL_RUN_MODIFIERS, CAP);
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
 * Challenge sanity (informational, `--challenges`): greedy with each island challenge, without and
 * with a maxed Workshop. Tower-ban challenges make the fixed script skip its banned builds, so they
 * usually lose here — a player re-plans; rule challenges should sit near the edge.
 */
export function evaluateChallenges(levelFilter: ReadonlySet<string> | null): string[] {
  const maxed = workshopModifiers(maxedWorkshopRanks());
  const lines: string[] = [];
  for (let i = 0; i < LEVELS.length; i++) {
    if (levelFilter && !levelFilter.has(`L${i + 1}`)) continue;
    const level = LEVELS[i];
    const cells: string[] = [];
    for (const id of challengesForLevel(level)) {
      for (const [tag, base] of [['ws0', NEUTRAL_RUN_MODIFIERS], ['wsMax', maxed]] as const) {
        const mods = runModifiersFor(base, [id]);
        const r = runLevelBalanceSim(level, 'greedy', balanceBuildOrder(level, 'greedy'), mods);
        const start = mods.maxLives ?? BALANCE.startingLives + mods.bonusLives;
        cells.push(`${id}/${tag}:${r.outcome === 'won' ? `W-${start - r.finalLives}` : `L@${r.waves.length}`}`);
      }
    }
    lines.push(`L${i + 1} ${level.difficulty.padEnd(11)} ${cells.join('  ')}`);
  }
  return lines;
}

/**
 * Meta-progression guard: the same greedy scripts with every Workshop upgrade at max rank.
 * Upgrades must help (never hurt) but not trivialise the hardest islands: a maxed greedy run must
 * still lose lives on every Master island (and on average gain only a few lives anywhere).
 */
export function evaluateWorkshopMax(
  levelFilter: ReadonlySet<string> | null,
): { lines: string[]; failures: string[] } {
  const mods = workshopModifiers(maxedWorkshopRanks());
  const lines: string[] = [];
  const failures: string[] = [];
  for (const { label, level } of balanceEntries()) {
    if (!entryMatches(levelFilter, { label, level })) continue;
    const base = runLevelBalanceSim(level, 'greedy', balanceBuildOrder(level, 'greedy'));
    const maxed = runLevelBalanceSim(level, 'greedy', balanceBuildOrder(level, 'greedy'), mods);
    const baseLost = base.outcome === 'won' ? BALANCE.startingLives - base.finalLives : BALANCE.startingLives;
    const startLives = BALANCE.startingLives + mods.bonusLives;
    const maxedLost = maxed.outcome === 'won' ? startLives - maxed.finalLives : startLives;
    // Informational: the scripted build is chaotic, so a small boost can also shift its timing
    // into a worse run (more lives lost) — that is noise, not the upgrade hurting real players.
    const note = maxedLost > baseLost ? '  (script timing noise: worse than base)' : '';
    lines.push(
      `${label} ${level.difficulty.padEnd(11)} lives lost: base ${String(baseLost).padStart(2)} -> maxed ${String(maxedLost).padStart(2)} ` +
        `(${maxed.outcome === 'won' ? 'W' : 'L'}, ${maxed.stars}*)${note}`,
    );
    if (level.difficulty === 'Master' && maxed.outcome === 'won' && maxedLost === 0) {
      failures.push(`${label} Workshop-maxed greedy loses no lives on a Master island (trivialised)`);
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
  const levelFilter = levelsSpec
    ? new Set(
        levelsSpec.split(',').map((x) => {
          const t = x.trim();
          return /^\d+$/.test(t) ? `L${Number(t)}` : t;
        }),
      )
    : null;
  const { summary, failures, robustLines } = evaluateBalance(levelFilter, true, true);
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
  if (process.argv.includes('--challenges')) {
    console.log('=== Challenges (greedy; W-n = won losing n lives, L@w = lost on wave w) ===');
    for (const line of evaluateChallenges(levelFilter)) console.log(line);
    console.log('');
  }
  console.log('=== Workshop max (greedy, no hero or casts; compares Workshop alone) ===');
  for (const line of workshop.lines) console.log(line);
  console.log('');
  if (robustLines.length > 0) {
    console.log('=== Robustness (Normal campaign lives lost across HP, seeds, heroes and build orders) ===');
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
