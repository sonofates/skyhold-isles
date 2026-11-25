import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { CHAPTER4_ENEMY_TYPES, CHAPTER_ENEMY_TYPES } from '../../src/data/enemies.ts';
import {
  ReplayCursor,
  runFingerprint,
  sameFingerprint,
  type RecordedCommand,
  type RunReplay,
} from '../../src/render2d/ui/replay2d.ts';
import { hasChapterFourEnemies, hasChapterTwoEnemies } from '../../src/sim/waveSystem.ts';
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
  readonly heroDeaths: number;
  readonly heroRespawns: number;
  readonly durationMs: number;
}

const CHAPTER_FOE_SET: ReadonlySet<string> = new Set<string>(CHAPTER_ENEMY_TYPES);
const CHAPTER4_FOE_SET: ReadonlySet<string> = new Set<string>(CHAPTER4_ENEMY_TYPES);

function verifyUiReplayCursor(
  scenario: BotScenario,
  replayLog: SimReplayLog,
  expectedHash: string,
  expectedTicks: number,
  expectedEnd: ReturnType<typeof runFingerprint>,
): string | null {
  if (!scenario.level.layout2d || scenario.startEndlessFromWave1 || scenario.endlessWaves > 0) {
    return null;
  }
  const recorded: RecordedCommand[] = [];
  let nextTowerId = 1;
  for (let i = 0; i < replayLog.commands.length; i++) {
    const entry = replayLog.commands[i];
    const cmd = entry.command;
    switch (cmd.kind) {
      case 'placeTowerOnPlot': {
        const assignedId = nextTowerId++;
        recorded.push({ t: entry.tick, c: { k: 'build', plot: cmd.plotIndex, type: cmd.towerType } });
        if (cmd.targetingMode && cmd.targetingMode !== 'first') {
          recorded.push({ t: entry.tick, c: { k: 'target', id: assignedId, mode: cmd.targetingMode } });
        }
        break;
      }
      case 'upgradeTower':
        recorded.push({ t: entry.tick, c: { k: 'upgrade', id: cmd.towerId } });
        break;
      case 'sellTower':
        recorded.push({ t: entry.tick, c: { k: 'sell', id: cmd.towerId } });
        break;
      case 'setTargeting':
        recorded.push({ t: entry.tick, c: { k: 'target', id: cmd.towerId, mode: cmd.mode } });
        break;
      case 'setRally':
        recorded.push({ t: entry.tick, c: { k: 'rally', id: cmd.towerId, x: cmd.x, z: cmd.z } });
        break;
      case 'startWave':
        recorded.push({ t: entry.tick, c: { k: 'wave' } });
        break;
      case 'moveHero':
        recorded.push({ t: entry.tick, c: { k: 'heroMove', x: cmd.x, z: cmd.z } });
        break;
      case 'castHeroSkill':
        recorded.push({
          t: entry.tick,
          c: { k: 'heroSkill', slot: cmd.slot, x: cmd.x ?? null, z: cmd.z ?? null },
        });
        break;
      case 'castAbility':
        if (cmd.id === 'meteor') {
          recorded.push({ t: entry.tick, c: { k: 'meteor', x: cmd.x ?? 0, z: cmd.z ?? 0 } });
        } else {
          recorded.push({ t: entry.tick, c: { k: 'overcharge' } });
        }
        break;
      default:
        return null;
    }
  }

  const runReplay: RunReplay = {
    levelId: scenario.level.id,
    commands: recorded,
    endTick: expectedTicks,
    end: expectedEnd,
  };
  const uiWorld = new SimWorld(
    scenario.level,
    new EventBus(),
    scenario.modifiers,
    scenario.heroId
      ? {
          heroId: scenario.heroId,
          heroLevel: scenario.heroLevel,
          heroSkills: scenario.heroSkills,
          seed: scenario.seed,
        }
      : { seed: scenario.seed },
  );
  const cursor = new ReplayCursor(runReplay);
  let tick = 0;
  for (; tick < runReplay.endTick && uiWorld.outcome === 'ongoing'; tick++) {
    cursor.applyDue(uiWorld, tick);
    uiWorld.fixedTick(BALANCE.fixedDt);
  }
  const fp = runFingerprint(uiWorld, tick);
  const uiHash = hashWorldState(uiWorld);
  uiWorld.dispose();
  if (!sameFingerprint(fp, expectedEnd) || uiHash !== expectedHash) {
    return `ReplayCursor (replay2d.ts) mismatch: hash ${uiHash} vs ${expectedHash} (tick ${tick} vs ${expectedTicks}, outcome ${fp.outcome} vs ${expectedEnd.outcome})`;
  }
  return null;
}

function executeOnce(
  scenario: BotScenario,
  recordReplay = false,
): Omit<ScenarioResult, 'determinismVerified' | 'durationMs'> & {
  readonly exportedReplay?: SimReplayLog;
  readonly endFp?: ReturnType<typeof runFingerprint>;
} {
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
  let endlessChapterFoesSpawned = 0;
  let endlessChapter4FoesSpawned = 0;

  events.on('enemySpawned', (ev) => {
    if (world.waveSystem.isEndless && world.waveSystem.currentWaveIndex >= scenario.level.waves.length) {
      if (CHAPTER_FOE_SET.has(ev.enemyType)) endlessChapterFoesSpawned++;
      if (CHAPTER4_FOE_SET.has(ev.enemyType)) endlessChapter4FoesSpawned++;
    }
  });

  events.on('waveCompleted', () => {
    waveHashes.push(hashWorldState(world));
  });

  if (world.hero && scenario.heroPark !== 'castle') {
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
          if (world.grid.isPlotMode && row === 0) {
            world.placeTowerOnPlot(col, type, targetingMode);
          } else {
            world.placeTower(col, row, type, targetingMode);
          }
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
      if (
        scenario.heroPark === 'roam' &&
        scenario.buildKind === 'greedy' &&
        wsState === 'clearing' &&
        world.waveSystem.canStartNextWave() &&
        world.enemyPool.getActiveCount() <= 2
      ) {
        world.startNextWave();
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
  if (
    scenario.endlessWaves > 0 &&
    hasChapterTwoEnemies(scenario.level) &&
    world.waveSystem.currentWaveOneBased >= scenario.level.waves.length + 2 &&
    endlessChapterFoesSpawned === 0
  ) {
    monitor.violations.push({
      kind: 'wave_never_ends',
      tick,
      message: `Chapter 2 endless waves on ${scenario.level.id} spawned 0 chapter-two enemies across endless waves`,
    });
  }
  if (
    scenario.endlessWaves > 0 &&
    hasChapterFourEnemies(scenario.level) &&
    world.waveSystem.currentWaveOneBased >= scenario.level.waves.length + 2 &&
    endlessChapter4FoesSpawned === 0
  ) {
    monitor.violations.push({
      kind: 'wave_never_ends',
      tick,
      message: `Chapter 4 endless waves on ${scenario.level.id} spawned 0 chapter-four enemies across endless waves`,
    });
  }
  const stateHash = hashWorldState(world);
  const endFp = recordReplay ? runFingerprint(world, tick) : undefined;
  const exportedReplay = recordReplay ? world.exportReplay() : undefined;

  // Verify post-run teardown leaves zero entities in any pool or subsystem.
  const finalLives = world.lives;
  const finalGold = world.gold;
  const wavesReached = world.waveSystem.currentWaveOneBased;
  const heroDeaths = monitor.heroDeaths;
  const heroRespawns = monitor.heroRespawns;
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
    heroDeaths,
    heroRespawns,
    exportedReplay,
    endFp,
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
        if (first.ticks >= 120) {
          player.seekToTick(Math.floor(first.ticks * 0.5));
          player.seekToTick(Math.floor(first.ticks * 0.25));
        }
        const check = player.runToEnd();
        if (!check.matchesOutcome || !check.matchesHash) {
          violations.push({
            kind: 'determinism',
            tick: first.ticks,
            message: `SimReplayPlayer mismatch: hash ${check.actualHash} vs ${check.expectedHash} (outcome ${check.actualOutcome} vs ${check.expectedOutcome})`,
          });
        }
        player.dispose();
      }
      if (violations.length === 0 && first.endFp) {
        const uiErr = verifyUiReplayCursor(
          scenario,
          first.exportedReplay,
          first.stateHash,
          first.ticks,
          first.endFp,
        );
        if (uiErr) {
          violations.push({
            kind: 'determinism',
            tick: first.ticks,
            message: uiErr,
          });
        }
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
    heroDeaths: first.heroDeaths,
    heroRespawns: first.heroRespawns,
    durationMs: performance.now() - t0,
  };
}
