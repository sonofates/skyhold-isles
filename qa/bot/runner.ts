import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import {
  parseSimReplay,
  serializeSimReplay,
  SimReplayPlayer,
  SimWorld,
  type SimReplayLog,
} from '../../src/sim/world.ts';
import { hashWorldState } from './hash.ts';
import { InvariantMonitor, type InvariantViolation } from './invariants.ts';
import {
  computeHeroPost,
  driveGlobalAbilitiesInBot,
  driveHeroInBot,
  spendLeftoverEndlessGold,
  tryStepScriptBuild,
  type BotScenario,
  type StrategyFamily,
} from './strategies.ts';

export interface ScenarioResult {
  readonly id: string;
  readonly family: StrategyFamily;
  readonly levelId: string;
  readonly outcome: 'ongoing' | 'won' | 'lost' | 'endless_capped';
  readonly ticks: number;
  readonly finalLives: number;
  readonly finalGold: number;
  readonly wavesReached: number;
  readonly stateHash: string;
  readonly waveHashes: readonly string[];
  readonly violations: readonly InvariantViolation[];
  readonly determinismVerified: boolean;
  readonly durationMs: number;
}

function executeOnce(
  scenario: BotScenario,
  recordReplay = false,
): Omit<ScenarioResult, 'determinismVerified' | 'durationMs'> & { readonly exportedReplay?: SimReplayLog } {
  const events = new EventBus();
  const world = new SimWorld(
    scenario.level,
    events,
    scenario.modifiers,
    scenario.heroId
      ? {
          heroId: scenario.heroId,
          heroLevel: scenario.heroLevel,
          heroSkills: scenario.heroSkills,
          seed: scenario.seed,
          recordCommands: recordReplay,
        }
      : { seed: scenario.seed, recordCommands: recordReplay },
  );

  if (scenario.startEndlessFromWave1) {
    world.startEndlessFromStart();
  }

  const monitor = new InvariantMonitor(world, events);
  const waveHashes: string[] = [];

  events.on('waveCompleted', () => {
    waveHashes.push(hashWorldState(world));
  });
  events.on('heroRespawn', () => {
    if (!world.hero) return;
    const mode = scenario.heroPark === 'roam' ? 'merge' : scenario.heroPark;
    const post = computeHeroPost(world, mode);
    world.commandHeroMove(post.x, post.z);
  });

  if (world.hero) {
    const initialMode = scenario.heroPark === 'roam' ? 'front' : scenario.heroPark;
    const post = computeHeroPost(world, initialMode);
    world.commandHeroMove(post.x, post.z);
  }

  const baseOrder =
    scenario.buildKind === 'greedy'
      ? (scenario.level.scriptedBuildOrder ?? [])
      : (scenario.level.weakBuildOrder ?? []);
  const queue = [...baseOrder];

  const stepBuildQueue = (): boolean => {
    while (queue.length > 0) {
      const res = tryStepScriptBuild(world, queue[0]);
      if (res === 'wait') return false;
      queue.shift();
      if (res === 'done') return true;
    }
    return false;
  };

  while (stepBuildQueue()) {
    // spend starting gold before wave 1
  }
  world.startNextWave();

  const COMBAT_BUILD_CADENCE = 8.0;
  let buildCooldown = COMBAT_BUILD_CADENCE;
  let wasBetween = false;
  let didSellRallyCheck = false;
  let tick = 0;

  const maxStoryTicks = 60 * Math.max(900, scenario.level.waves.length * 120);
  const targetEndlessWaveIdx =
    scenario.startEndlessFromWave1 && scenario.endlessWaves > 0
      ? scenario.level.waves.length - 1 + scenario.endlessWaves
      : -1;

  for (; tick < maxStoryTicks && world.outcome === 'ongoing'; tick++) {
    const wsState = world.waveSystem.state;
    if (wsState === 'betweenWaves') {
      wasBetween = true;
      while (stepBuildQueue()) {
        // spend between waves
      }
      if (scenario.startEndlessFromWave1 && queue.length === 0) {
        spendLeftoverEndlessGold(world);
      }
      // Exercise barracks rally move + tower sell/rebuild once mid-run so soldier cleanup is tested live.
      if (scenario.exerciseSellAndRally && !didSellRallyCheck && world.waveSystem.currentWaveOneBased >= 3) {
        didSellRallyCheck = true;
        const barracks = world.towers.find((t) => t.type === 'barracks');
        if (barracks) {
          world.setRallyPoint(barracks.id, barracks.x + 0.8, barracks.z - 0.8);
        }
        const sellTarget = world.towers[world.towers.length - 1];
        if (sellTarget) {
          const { col, row, type, targetingMode } = sellTarget;
          world.sellTower(sellTarget.id);
          world.placeTower(col, row, type, targetingMode);
        }
      }
    } else {
      if (wasBetween) {
        buildCooldown = COMBAT_BUILD_CADENCE;
        wasBetween = false;
      }
      if (buildCooldown > 0) {
        buildCooldown = Math.max(0, buildCooldown - BALANCE.fixedDt);
      }
      if (buildCooldown <= 0 && stepBuildQueue()) {
        buildCooldown = COMBAT_BUILD_CADENCE;
      }
    }

    if (world.hero) {
      driveHeroInBot(world, scenario.heroPark, Math.max(1, world.waveSystem.currentWaveOneBased));
    }
    if (scenario.useAbilities) {
      driveGlobalAbilitiesInBot(world);
    }

    monitor.beginTick(tick);
    world.fixedTick(BALANCE.fixedDt);
    monitor.endTick(tick, BALANCE.fixedDt);

    if (monitor.violations.length >= 8) break;
    if (
      targetEndlessWaveIdx >= 0 &&
      world.waveSystem.currentWaveIndex > targetEndlessWaveIdx
    ) {
      break;
    }
  }

  let finalOutcome: ScenarioResult['outcome'] = world.outcome;

  if (
    !scenario.startEndlessFromWave1 &&
    scenario.endlessWaves > 0 &&
    world.outcome === 'won' &&
    monitor.violations.length < 8 &&
    world.enterEndlessMode()
  ) {
    const capWaveIdx = scenario.level.waves.length - 1 + scenario.endlessWaves;
    const maxEndlessTicks = tick + 60 * scenario.endlessWaves * 120;
    for (; tick < maxEndlessTicks && world.outcome === 'ongoing'; tick++) {
      if (world.waveSystem.state === 'betweenWaves') {
        while (stepBuildQueue()) {
          // spend leftover actions
        }
        if (queue.length === 0) spendLeftoverEndlessGold(world);
      }
      if (world.hero) {
        driveHeroInBot(world, scenario.heroPark, Math.max(1, world.waveSystem.currentWaveOneBased));
      }
      if (scenario.useAbilities) {
        driveGlobalAbilitiesInBot(world);
      }

      monitor.beginTick(tick);
      world.fixedTick(BALANCE.fixedDt);
      monitor.endTick(tick, BALANCE.fixedDt);

      if (monitor.violations.length >= 8) break;
      if (world.waveSystem.currentWaveIndex > capWaveIdx) {
        finalOutcome = 'endless_capped';
        break;
      }
    }
    if (world.outcome === 'lost') finalOutcome = 'lost';
  } else if (scenario.startEndlessFromWave1 && world.outcome === 'ongoing') {
    finalOutcome = 'endless_capped';
  }

  const expectTerminated = !scenario.startEndlessFromWave1 && scenario.endlessWaves === 0;
  monitor.checkRunEnd(tick, expectTerminated);
  const stateHash = hashWorldState(world);
  const exportedReplay = recordReplay ? world.exportReplay() : undefined;

  // Verify post-run teardown leaves zero entities in any pool or subsystem.
  const finalLives = world.lives;
  const finalGold = world.gold;
  const wavesReached = world.waveSystem.currentWaveOneBased;
  world.dispose();
  if (
    world.enemyPool.getActiveCount() !== 0 ||
    world.projectilePool.getActiveCount() !== 0 ||
    world.projectileSystem.getActiveBurnZoneCount() !== 0 ||
    world.abilitySystem.getPendingMeteorCount() !== 0 ||
    world.soldierSystem.soldiers.length !== 0 ||
    world.soldierSystem.barracks.length !== 0 ||
    world.heroSystem.gizmos.length !== 0 ||
    world.heroSystem.fireRings.length !== 0 ||
    world.towers.length !== 0
  ) {
    monitor.violations.push({
      kind: 'entity_leak',
      tick,
      message: 'world.dispose() left active entities behind after run',
    });
  }

  return {
    id: scenario.id,
    family: scenario.family,
    levelId: scenario.level.id,
    outcome: finalOutcome,
    ticks: tick,
    finalLives,
    finalGold,
    wavesReached,
    stateHash,
    waveHashes,
    violations: monitor.violations,
    exportedReplay,
  };
}

export function runBotScenario(scenario: BotScenario): ScenarioResult {
  const t0 = performance.now();
  const first = executeOnce(scenario, scenario.verifyDeterminism);
  const violations: InvariantViolation[] = [...first.violations];
  let determinismVerified = false;

  if (scenario.verifyDeterminism && violations.length === 0) {
    const replay = executeOnce(scenario, false);
    determinismVerified = true;
    if (replay.stateHash !== first.stateHash || replay.ticks !== first.ticks || replay.outcome !== first.outcome) {
      violations.push({
        kind: 'determinism',
        tick: first.ticks,
        message: `determinism mismatch: hash ${first.stateHash} vs ${replay.stateHash} (ticks ${first.ticks} vs ${replay.ticks}, outcome ${first.outcome} vs ${replay.outcome})`,
      });
    } else if (replay.waveHashes.length !== first.waveHashes.length) {
      violations.push({
        kind: 'determinism',
        tick: first.ticks,
        message: `determinism waveHash count mismatch: ${first.waveHashes.length} vs ${replay.waveHashes.length}`,
      });
    } else {
      for (let i = 0; i < first.waveHashes.length; i++) {
        if (first.waveHashes[i] !== replay.waveHashes[i]) {
          violations.push({
            kind: 'determinism',
            tick: first.ticks,
            message: `determinism wave ${i + 1} hash mismatch: ${first.waveHashes[i]} vs ${replay.waveHashes[i]}`,
          });
          break;
        }
      }
    }

    if (violations.length === 0 && first.exportedReplay) {
      const parsed = parseSimReplay(serializeSimReplay(first.exportedReplay));
      if (!parsed) {
        violations.push({
          kind: 'determinism',
          tick: first.ticks,
          message: 'exported SimReplayLog failed JSON round-trip parse',
        });
      } else {
        const player = new SimReplayPlayer(scenario.level, parsed);
        const check = player.runToEnd();
        if (!check.matchesOutcome || !check.matchesHash) {
          violations.push({
            kind: 'determinism',
            tick: first.ticks,
            message: `SimReplayPlayer mismatch: hash ${check.actualHash} vs ${check.expectedHash} (outcome ${check.actualOutcome} vs ${check.expectedOutcome})`,
          });
        }
        player.world.dispose();
      }
    }
  }

  return {
    id: first.id,
    family: first.family,
    levelId: first.levelId,
    outcome: first.outcome,
    ticks: first.ticks,
    finalLives: first.finalLives,
    finalGold: first.finalGold,
    wavesReached: first.wavesReached,
    stateHash: first.stateHash,
    waveHashes: first.waveHashes,
    violations,
    determinismVerified,
    durationMs: performance.now() - t0,
  };
}
