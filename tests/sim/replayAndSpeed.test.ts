import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import {
  clampSpeedMultiplier,
  FixedTimestepStepper,
  isSpeedMultiplier,
  nextSpeedMultiplier,
  SPEED_MULTIPLIERS,
} from '../../src/core/gameLoop.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { runModifiersFor } from '../../src/data/challenges.ts';
import { defaultLevel20Skills } from '../../src/data/heroes.ts';
import { getLevelById, LEVEL_L1C } from '../../src/data/levels2d/index.ts';
import { maxedWorkshopRanks, workshopModifiers } from '../../src/data/workshop.ts';
import { GameLoop } from '../../src/platform/browserLoop.ts';
import { findMergePoint } from '../../src/sim/groundGraph.ts';
import {
  computeSimStateHash,
  parseSimReplay,
  serializeSimReplay,
  SIM_REPLAY_VERSION,
  SimReplayPlayer,
  SimWorld,
  type StampedSimCommand,
} from '../../src/sim/world.ts';

describe('Speed 3x support & FixedTimestepStepper helpers', () => {
  it('exposes 1x/2x/3x cycle helpers, clamps arbitrary inputs, and guards NaN frame deltas', () => {
    expect(SPEED_MULTIPLIERS).toEqual([1, 2, 3]);
    expect(isSpeedMultiplier(1)).toBe(true);
    expect(isSpeedMultiplier(2)).toBe(true);
    expect(isSpeedMultiplier(3)).toBe(true);
    expect(isSpeedMultiplier(4)).toBe(false);
    expect(isSpeedMultiplier(NaN)).toBe(false);

    expect(nextSpeedMultiplier(1)).toBe(2);
    expect(nextSpeedMultiplier(2)).toBe(3);
    expect(nextSpeedMultiplier(3)).toBe(1);

    expect(clampSpeedMultiplier(1)).toBe(1);
    expect(clampSpeedMultiplier(2.2)).toBe(2);
    expect(clampSpeedMultiplier(99)).toBe(3);
    expect(clampSpeedMultiplier(NaN, 2)).toBe(2);
    expect(clampSpeedMultiplier('3', 1)).toBe(1);

    const stepper = new FixedTimestepStepper();
    stepper.simActive = true;
    expect(stepper.speed).toBe(1);
    expect(stepper.cycleSpeed()).toBe(2);
    expect(stepper.cycleSpeed()).toBe(3);
    expect(stepper.cycleSpeed()).toBe(1);
    expect(stepper.setSpeed(3)).toBe(3);

    const loop = new GameLoop({ onFixedTick: () => {}, onRender: () => {} });
    expect(loop.cycleSpeed()).toBe(2);
    expect(loop.cycleSpeed()).toBe(3);
    expect(loop.cycleSpeed()).toBe(1);

    // Non-finite rawDt must never poison accumulator or elapsedVisualTime.
    const nanStep = stepper.step(NaN, () => {});
    expect(nanStep.ticksExecuted).toBe(0);
    expect(Number.isFinite(nanStep.alpha)).toBe(true);
    expect(Number.isFinite(nanStep.elapsedVisualTime)).toBe(true);
    const nextStep = stepper.step(BALANCE.fixedDt, () => {});
    expect(nextStep.ticksExecuted).toBe(3);
  });

  it('produces bit-identical SimWorld state at 1x, 2x, and 3x speeds for equal simulated ticks', () => {
    const runAtSpeed = (speed: 1 | 2 | 3): string => {
      const world = new SimWorld(LEVEL_L1C, new EventBus(), {
        heroId: 'wren',
        heroLevel: 12,
        heroSkills: defaultLevel20Skills('wren').slice(0, 9),
        seed: 777,
      });
      world.gold = 900;
      world.placeTowerOnPlot(0, 'archer');
      world.placeTowerOnPlot(2, 'barracks');
      world.startNextWave();

      const stepper = new FixedTimestepStepper();
      stepper.simActive = true;
      stepper.setSpeed(speed);

      // Feed 600 ticks total: 600 frames at 1x, 300 frames at 2x, 200 frames at 3x (each frame = fixedDt).
      const frames = 600 / speed;
      for (let f = 0; f < frames; f++) {
        stepper.step(BALANCE.fixedDt, (dt) => world.fixedTick(dt));
      }
      expect(world.tick).toBe(600);
      return computeSimStateHash(world);
    };

    const h1 = runAtSpeed(1);
    expect(runAtSpeed(2)).toBe(h1);
    expect(runAtSpeed(3)).toBe(h1);
  });
});

describe('Tick-stamped SimCommand recording & SimReplayPlayer', () => {
  it('records all player commands with tick+seq stamps, round-trips JSON, and replays to exact stateHash', () => {
    const mods = runModifiersFor(workshopModifiers(maxedWorkshopRanks()), ['galeForce']);
    const liveFeed: StampedSimCommand[] = [];
    const world = new SimWorld(LEVEL_L1C, new EventBus(), mods, {
      heroId: 'bran',
      heroLevel: 20,
      heroSkills: defaultLevel20Skills('bran'),
      seed: 20261119,
      recordCommands: true,
    });
    world.onCommandRecorded = (entry) => liveFeed.push(entry);

    // Pre-wave (tick 0): multiple commands get monotonic seq 0, 1, 2, ...
    world.gold = 5000;
    // Note: gold override is only for testing; keep real run valid with starting gold!
    // Reset to real starting gold so replay starts with identical economy:
    const realWorld = new SimWorld(LEVEL_L1C, new EventBus(), mods, {
      heroId: 'bran',
      heroLevel: 20,
      heroSkills: defaultLevel20Skills('bran'),
      seed: 20261119,
      recordCommands: true,
    });
    liveFeed.length = 0;
    realWorld.onCommandRecorded = (entry) => liveFeed.push(entry);

    const archer = realWorld.placeTowerOnPlot(0, 'archer', 'strongest')!;
    const barracks = realWorld.placeTowerOnPlot(2, 'barracks')!;
    expect(archer).not.toBeNull();
    expect(barracks).not.toBeNull();
    const merge = findMergePoint([realWorld.groundPath, ...realWorld.extraGroundPaths]);
    expect(realWorld.commandHeroMove(merge.x, merge.z)).toBe(true);
    realWorld.setAutoWave(true);
    expect(realWorld.startNextWave()).toBe(true);

    let midHashAt360 = '';
    let upgraded = false;
    let rallied = false;
    let sold = false;
    let enteredEndless = false;

    while (realWorld.tick < 4800) {
      if (realWorld.tick === 360) {
        midHashAt360 = computeSimStateHash(realWorld);
      }
      if (!rallied && realWorld.tick === 180) {
        rallied = realWorld.setRallyPoint(barracks.id, merge.x, merge.z);
        realWorld.setTowerTargeting(archer.id, 'first');
      }
      if (!upgraded && realWorld.gold >= 150) {
        upgraded = realWorld.upgradeTower(archer.id);
      }
      if (realWorld.tick === 420) {
        realWorld.castHeroSkill(0, merge.x - 1, merge.z);
        realWorld.castHeroSkill(1);
        realWorld.castAbility('meteor', merge.x - 1, merge.z);
        realWorld.castAbility('overcharge');
      }
      if (!sold && realWorld.tick === 900) {
        // Build & sell an extra tower when affordable to exercise sellTower + placeTowerOnPlot
        const temp = realWorld.placeTowerOnPlot(4, 'frost');
        if (temp) {
          realWorld.sellTower(temp.id);
          sold = true;
        }
      }
      if (realWorld.outcome === 'won' && !enteredEndless) {
        // Also exercise post-victory enterEndless transition in the same replay!
        enteredEndless = realWorld.enterEndlessMode();
      }
      if (enteredEndless && realWorld.tick >= realWorld.getRecordedCommands().at(-1)!.tick + 240) {
        break;
      }
      if (realWorld.outcome !== 'ongoing') break;
      realWorld.fixedTick(BALANCE.fixedDt);
    }

    const recorded = realWorld.getRecordedCommands();
    expect(recorded.length).toBeGreaterThanOrEqual(8);
    expect(liveFeed).toHaveLength(recorded.length);
    // Tick stamps are non-decreasing and seq is strictly increasing.
    for (let i = 1; i < recorded.length; i++) {
      expect(recorded[i].tick).toBeGreaterThanOrEqual(recorded[i - 1].tick);
      expect(recorded[i].seq).toBeGreaterThan(recorded[i - 1].seq);
    }

    const replay = realWorld.exportReplay();
    expect(replay.version).toBe(SIM_REPLAY_VERSION);
    expect(replay.summary.totalTicks).toBe(realWorld.tick);

    // Round-trip through JSON string and replay to end -> bit-exact stateHash!
    const json = serializeSimReplay(replay);
    const parsed = parseSimReplay(json);
    expect(parsed).not.toBeNull();

    const player = new SimReplayPlayer(LEVEL_L1C, parsed!);
    const verification = player.runToEnd();
    expect(verification.matchesOutcome).toBe(true);
    expect(verification.matchesHash).toBe(true);
    expect(player.world.tick).toBe(realWorld.tick);
    expect(player.world.gold).toBe(realWorld.gold);
    expect(player.world.lives).toBe(realWorld.lives);
    expect(player.world.enemiesKilledTotal).toBe(realWorld.enemiesKilledTotal);

    // Seek backward to tick 360 (silently, zero event spam), verify mid-run hash, then resume to end!
    let eventsDuringSeek = 0;
    player.events.on('enemyHit', () => eventsDuringSeek++);
    player.events.on('towerFired', () => eventsDuringSeek++);
    player.seekToTick(360);
    expect(eventsDuringSeek).toBe(0);
    expect(player.currentTick).toBe(360);
    expect(computeSimStateHash(player.world)).toBe(midHashAt360);

    // Stepping normally after seekToTick resumes emitting events and reaches exact final hash!
    const afterResume = player.runToEnd();
    expect(eventsDuringSeek).toBeGreaterThan(0);
    expect(afterResume.matchesHash).toBe(true);
  });

  it('replays identically via stepFrame at 1x, 3x, and 8x fast-forward speeds, and supports startEndlessFromStart', () => {
    const i10 = getLevelById('i10')!;
    const world = new SimWorld(i10, new EventBus(), {
      heroId: 'sela',
      heroLevel: 15,
      heroSkills: defaultLevel20Skills('sela').slice(0, 10),
      seed: 90909,
      recordCommands: true,
    });
    expect(world.applyCommand({ kind: 'startEndlessFromStart' })).toBe(true);
    expect(world.applyCommand({ kind: 'placeTowerOnPlot', plotIndex: 0, towerType: 'tesla' })).toBe(true);
    expect(world.applyCommand({ kind: 'placeTowerOnPlot', plotIndex: 1, towerType: 'frost' })).toBe(true);
    expect(world.applyCommand({ kind: 'startWave' })).toBe(true);

    for (let t = 0; t < 720 && world.outcome === 'ongoing'; t++) {
      if (t === 240) world.applyCommand({ kind: 'castHeroSkill', slot: 0 });
      if (t === 300) world.applyCommand({ kind: 'castHeroSkill', slot: 1 });
      world.fixedTick(BALANCE.fixedDt);
    }

    const replay = parseSimReplay(serializeSimReplay(world.exportReplay()))!;
    for (const speed of [1, 3, 8]) {
      const player = new SimReplayPlayer(i10, replay);
      let guard = 0;
      while (!player.finished && guard++ < 5000) {
        player.stepFrame(0.033, speed, false);
      }
      expect(player.finished).toBe(true);
      expect(player.verifyState().matchesHash).toBe(true);
    }
  });

  it('rejects malformed or corrupted replay payloads safely and imports zero DOM/Pixi/Math.random in sim', () => {
    for (const bad of [
      '',
      '{not-json',
      'null',
      '[]',
      { version: 2, levelId: 'l1c', seed: 1, commands: [] },
      { version: 1, levelId: '', seed: 1, commands: [] },
      { version: 1, levelId: 'l1c', seed: NaN, commands: [] },
      { version: 1, levelId: 'l1c', seed: 1, hero: { heroId: 'invalid' }, commands: [] },
      { version: 1, levelId: 'l1c', seed: 1, commands: [{ tick: -1, command: { kind: 'startWave' } }] },
      { version: 1, levelId: 'l1c', seed: 1, commands: [{ tick: 0, command: { kind: 'unknown' } }] },
      { version: 1, levelId: 'l1c', seed: 1, commands: [{ tick: 0, command: { kind: 'moveHero', x: NaN, z: 0 } }] },
    ]) {
      expect(parseSimReplay(bad)).toBeNull();
    }

    const root = join(__dirname, '../..');
    for (const rel of ['src/sim/replay.ts', 'src/sim/world.ts', 'src/core/gameLoop.ts']) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src).not.toMatch(/Math\.random/);
      expect(src).not.toMatch(/from ['"](pixi\.js|three)['"]/);
      expect(src).not.toMatch(/\b(document|window|localStorage)\b/);
    }
  });
});
