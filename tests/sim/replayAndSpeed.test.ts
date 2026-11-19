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
import { combineRunModifiers } from '../../src/data/runModifiers.ts';
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
      { version: 1, levelId: 'l1c', seed: 1, commands: [{ tick: 0, command: { kind: 'castHeroSkill', slot: 0, x: NaN, z: 0 } }] },
      { version: 1, levelId: 'l1c', seed: 1, commands: [{ tick: 0, command: { kind: 'castHeroSkill', slot: 0, x: 1 } }] },
      { version: 1, levelId: 'l1c', seed: 1, commands: [{ tick: 0, command: { kind: 'castAbility', id: 'meteor' } }] },
      { version: 1, levelId: 'l1c', seed: 1, commands: [{ tick: 0, command: { kind: 'castAbility', id: 'meteor', x: Infinity, z: 0 } }] },
    ]) {
      expect(parseSimReplay(bad)).toBeNull();
    }

    // Unknown or duplicate hero skill IDs in a replay payload are stripped cleanly.
    const sanitizedHeroReplay = parseSimReplay({
      version: 1,
      levelId: 'l1c',
      seed: 7,
      hero: { heroId: 'wren', level: 5, skills: ['wren_bow_1', 'bogus_node', 'wren_bow_1'] },
      commands: [{ tick: 0, seq: 0, command: { kind: 'castAbility', id: 'overcharge' } }],
    });
    expect(sanitizedHeroReplay?.hero?.skills).toEqual(['wren_bow_1']);

    const root = join(__dirname, '../..');
    for (const rel of ['src/sim/replay.ts', 'src/sim/world.ts', 'src/core/gameLoop.ts']) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src).not.toMatch(/Math\.random/);
      expect(src).not.toMatch(/from ['"](pixi\.js|three)['"]/);
      expect(src).not.toMatch(/\b(document|window|localStorage)\b/);
    }
  });

  it('replays a full story victory -> enterEndless -> endless wave transition and handles terminal totalTicks', () => {
    const miniLevel = {
      ...LEVEL_L1C,
      id: 'mini-replay-win',
      waves: [
        {
          groups: [{ enemyType: 'grunt' as const, count: 3, spawnInterval: 0.35, startDelay: 0 }],
          clearBonus: 30,
        },
      ],
    };
    const world = new SimWorld(miniLevel, new EventBus(), {
      heroId: 'mira',
      heroLevel: 20,
      heroSkills: defaultLevel20Skills('mira'),
      seed: 4242,
      recordCommands: true,
    });
    expect(world.placeTowerOnPlot(0, 'archer')).not.toBeNull();
    expect(world.placeTowerOnPlot(1, 'cannon')).not.toBeNull();
    expect(world.startNextWave()).toBe(true);

    for (let guard = 0; guard < 4000 && world.outcome === 'ongoing'; guard++) {
      world.fixedTick(BALANCE.fixedDt);
    }
    expect(world.outcome).toBe('won');
    const victoryTick = world.tick;
    const preEndlessHash = computeSimStateHash(world);

    // Player clicks Enter Endless on the victory card, starts wave 2 (endless), and plays 180 ticks!
    expect(world.enterEndlessMode()).toBe(true);
    expect(world.startNextWave()).toBe(true);
    for (let t = 0; t < 180 && world.outcome === 'ongoing'; t++) {
      if (t === 30) world.castHeroSkill(0);
      if (t === 45) world.castAbility('meteor', world.groundPath.points[0].x, world.groundPath.points[0].z);
      world.fixedTick(BALANCE.fixedDt);
    }

    const replay = parseSimReplay(serializeSimReplay(world.exportReplay()))!;
    const player = new SimReplayPlayer(miniLevel, replay);
    const res = player.runToEnd();
    expect(res.matchesOutcome).toBe(true);
    expect(res.matchesHash).toBe(true);
    expect(player.world.waveSystem.isEndless).toBe(true);
    expect(player.currentTick).toBe(world.tick);

    // Seeking past the victory tick and back to before victory stays bit-exact!
    player.seekToTick(Math.max(1, victoryTick - 5));
    expect(player.world.outcome).toBe('ongoing');
    expect(player.world.waveSystem.isEndless).toBe(false);
    const resumed = player.runToEnd();
    expect(resumed.matchesHash).toBe(true);
    expect(computeSimStateHash(player.world)).not.toBe(preEndlessHash);

    // Terminal run whose summary.totalTicks was inflated still reports finished=true once outcome !== 'ongoing'.
    const terminalWorld = new SimWorld(miniLevel, new EventBus(), { seed: 11, recordCommands: true });
    terminalWorld.placeTowerOnPlot(0, 'tesla');
    terminalWorld.placeTowerOnPlot(1, 'archer');
    terminalWorld.startNextWave();
    while (terminalWorld.outcome === 'ongoing' && terminalWorld.tick < 4000) {
      terminalWorld.fixedTick(BALANCE.fixedDt);
    }
    expect(terminalWorld.outcome).toBe('won');
    const rawLog = terminalWorld.exportReplay();
    const inflated = parseSimReplay({
      ...rawLog,
      summary: { ...rawLog.summary, totalTicks: rawLog.summary.totalTicks + 5000 },
    })!;
    const termPlayer = new SimReplayPlayer(miniLevel, inflated);
    termPlayer.stepFrame(0.05, 8, false);
    termPlayer.runToEnd();
    expect(termPlayer.world.outcome).toBe('won');
    expect(termPlayer.finished).toBe(true);
  });
});

describe('EventBus re-entrancy & SoldierSystem towerFireRateMul', () => {
  it('never skips sibling listeners on self-unsubscribe, honors cross-unsubscribe, and stops on clear()', () => {
    const bus = new EventBus();
    const order: string[] = [];
    const offA = bus.on('waveCompleted', () => {
      order.push('A');
      offA();
    });
    bus.on('waveCompleted', () => {
      order.push('B');
    });
    bus.emit('waveCompleted', { waveIndex: 0, bonus: 10 });
    expect(order).toEqual(['A', 'B']);

    order.length = 0;
    bus.emit('waveCompleted', { waveIndex: 1, bonus: 10 });
    expect(order).toEqual(['B']);

    // Cross-unsubscribe during emit suppresses not-yet-invoked listener C2.
    const crossOrder: string[] = [];
    let offC2: () => void = () => {};
    bus.on('economyChanged', () => {
      crossOrder.push('C1');
      offC2();
    });
    offC2 = bus.on('economyChanged', () => {
      crossOrder.push('C2');
    });
    bus.on('economyChanged', () => {
      crossOrder.push('C3');
    });
    bus.emit('economyChanged', { gold: 100, lives: 20 });
    expect(crossOrder).toEqual(['C1', 'C3']);

    // clear() inside listener stops remaining listeners in the same emit.
    const clearOrder: string[] = [];
    bus.on('gameLost', () => {
      clearOrder.push('L1');
      bus.clear();
    });
    bus.on('gameLost', () => {
      clearOrder.push('L2');
    });
    bus.emit('gameLost', { waveIndex: 0 });
    expect(clearOrder).toEqual(['L1']);

    // Mid-emit on() subscription never fires during the already-in-flight emit.
    const addOrder: string[] = [];
    bus.on('waveStarted', () => {
      addOrder.push('W1');
      bus.on('waveStarted', () => {
        addOrder.push('W2-late');
      });
    });
    bus.emit('waveStarted', { waveIndex: 0, totalWaves: 5, earlyBonus: 0 });
    expect(addOrder).toEqual(['W1']);
    bus.emit('waveStarted', { waveIndex: 1, totalWaves: 5, earlyBonus: 0 });
    expect(addOrder).toEqual(['W1', 'W1', 'W2-late']);
  });

  it('settles fighting barracks soldiers on story victory, normalizes replay hero/seed, zeroes seek alpha, and auto-aims Overhaul onto stunned towers & beacons', () => {
    // 1. Barracks soldiers holding the last enemy reset out of 'fighting' immediately on story win.
    const world = new SimWorld(LEVEL_L1C, new EventBus(), {
      heroId: 'tobb',
      heroLevel: 99.8,
      heroSkills: defaultLevel20Skills('tobb'),
      seed: NaN,
      recordCommands: true,
    });
    expect(world.heroConfig?.level).toBe(20);
    expect(world.hero?.level).toBe(20);
    expect(Number.isFinite(world.seed) && world.seed > 0).toBe(true);

    world.gold = 5000;
    const barracks = world.placeTowerOnPlot(21, 'barracks')!;
    expect(barracks).not.toBeNull();
    world.startNextWave();
    const foe = world.enemySystem.spawnEnemy('brute', 2, false, 0)!;
    const bState = world.soldierSystem.getBarracks(barracks.id)!;
    foe.x = foe.prevX = bState.rallyX;
    foe.z = foe.prevZ = bState.rallyZ;
    world.spatialHash.clear();
    world.spatialHash.insert(foe.poolIndex, foe.x, foe.z);
    for (
      let i = 0;
      i < 240 && !world.soldierSystem.soldiers.some((s) => s.state === 'fighting');
      i++
    ) {
      world.soldierSystem.update(BALANCE.fixedDt, world.towers, 1);
    }
    expect(world.soldierSystem.soldiers.some((s) => s.state === 'fighting')).toBe(true);

    world.debugForceWin();
    expect(world.outcome).toBe('won');
    expect(world.soldierSystem.blockedCount).toBe(0);
    expect(world.soldierSystem.soldiers.every((s) => s.state !== 'fighting' && s.state !== 'engaging')).toBe(true);

    // 2. SimReplayPlayer stateful speed/pause helpers & seekToTick zeroing fractional alpha on forward seek.
    const ongoingWorld = new SimWorld(LEVEL_L1C, new EventBus(), { seed: 314, recordCommands: true });
    ongoingWorld.placeTowerOnPlot(11, 'archer');
    ongoingWorld.startNextWave();
    for (let t = 0; t < 180; t++) ongoingWorld.fixedTick(BALANCE.fixedDt);
    const replay = parseSimReplay(serializeSimReplay(ongoingWorld.exportReplay()))!;
    const player = new SimReplayPlayer(LEVEL_L1C, replay);
    expect(player.cycleSpeed()).toBe(2);
    expect(player.cycleSpeed()).toBe(3);
    expect(player.cycleSpeed()).toBe(4);
    expect(player.cycleSpeed()).toBe(1);
    expect(player.setSpeed(2)).toBe(2);
    // Feed half a tick at 1x so accumulator holds 0.5 * fixedDt (alpha ~ 0.5), then seek forward.
    const halfStep = player.stepFrame(BALANCE.fixedDt * 0.5, 1, false);
    expect(halfStep.alpha).toBeGreaterThan(0.4);
    player.seekToTick(60);
    expect(player.currentTick).toBe(60);
    expect(player.stepFrame(0, 1, true).alpha).toBe(0);

    // 3. Tobb Overhaul auto-aim cleanses a stunned Beacon (or stunned attack tower) while ignoring idle Beacons.
    const tobbWorld = new SimWorld(LEVEL_L1C, new EventBus(), {
      heroId: 'tobb',
      heroLevel: 10,
      seed: 123,
    });
    tobbWorld.gold = 5000;
    const idleBeacon = tobbWorld.placeTowerOnPlot(20, 'beacon')!;
    const farArcher = tobbWorld.placeTowerOnPlot(21, 'archer')!;
    tobbWorld.hero!.x = tobbWorld.hero!.postX = idleBeacon.x;
    tobbWorld.hero!.z = tobbWorld.hero!.postZ = idleBeacon.z;
    // Un-stunned Beacon is skipped so Overhaul surges the nearby Archer instead.
    expect(tobbWorld.castHeroSkill(1)).toBe(true);
    expect(farArcher.overhaulTimer).toBeGreaterThan(0);
    expect(idleBeacon.overhaulTimer ?? 0).toBe(0);

    // When the Beacon IS stunned by a Hexer/Boss, targetless Overhaul prioritizes cleansing it!
    tobbWorld.hero!.skillCooldowns[1] = 0;
    farArcher.overhaulTimer = 0;
    idleBeacon.stunTimer = 3.5;
    expect(tobbWorld.castHeroSkill(1)).toBe(true);
    expect(idleBeacon.stunTimer).toBe(0);
  });

  it('applies RunModifiers.towerFireRateMul.barracks to barracks soldier melee swing cadence', () => {
    const runBarracksDamage = (barracksRateMul: number): number => {
      const mods = {
        ...workshopModifiers({}),
        towerFireRateMul: barracksRateMul === 1 ? {} : { barracks: barracksRateMul },
      };
      const world = new SimWorld(LEVEL_L1C, new EventBus(), mods, { seed: 55 });
      const b = world.placeTowerOnPlot(2, 'barracks')!;
      expect(b).not.toBeNull();
      world.startNextWave();
      for (let t = 0; t < 900 && world.outcome === 'ongoing'; t++) {
        world.fixedTick(BALANCE.fixedDt);
      }
      return b.totalDamageDealt;
    };

    const baseDmg = runBarracksDamage(1.0);
    const boostedDmg = runBarracksDamage(1.6);
    expect(baseDmg).toBeGreaterThan(0);
    expect(boostedDmg).toBeGreaterThan(baseDmg);
  });

  it('cleans defeat transients, tags debugForceLose endless flag, and handles post-victory delayed enterEndless in SimReplayPlayer', () => {
    const events = new EventBus();
    const lostEvents: Array<{ waveIndex: number; endless?: boolean }> = [];
    events.on('gameLost', (ev) => lostEvents.push(ev));

    const world = new SimWorld(LEVEL_L1C, events, {
      heroId: 'wren',
      heroLevel: 20,
      heroSkills: defaultLevel20Skills('wren'),
      seed: 909,
    });
    expect(world.startEndlessFromStart()).toBe(true);
    expect(world.startNextWave()).toBe(true);
    world.fixedTick(BALANCE.fixedDt);

    // Put hero in 'moving', spawn a pending meteor, and spawn a pending doubleVolley wave.
    const endPt = world.groundPath.points[0];
    expect(world.commandHeroMove(endPt.x, endPt.z)).toBe(true);
    expect(world.hero!.state).toBe('moving');
    expect(world.castAbility('meteor', endPt.x, endPt.z)).toBe(true);
    expect(world.castHeroSkill(0, endPt.x, endPt.z)).toBe(true);
    expect(world.abilitySystem.getPendingMeteorCount()).toBe(1);
    expect(world.heroSystem.getPendingVolleys().length).toBe(1);

    world.debugForceLose();
    expect(world.outcome).toBe('lost');
    expect(lostEvents).toEqual([{ waveIndex: 0, endless: true }]);
    expect(world.abilitySystem.getPendingMeteorCount()).toBe(0);
    expect(world.heroSystem.getPendingVolleys().length).toBe(0);
    expect(world.hero!.state).toBe('idle');

    // SimReplayPlayer: delayed enterEndless stamped past winTick still transitions into Endless,
    // and a terminal 'lost' replay finishes cleanly even if trailing commands exist.
    const miniWin = {
      ...LEVEL_L1C,
      id: 'mini-delayed-endless',
      waves: [{ groups: [{ enemyType: 'grunt' as const, count: 1, spawnInterval: 0.2, startDelay: 0 }], clearBonus: 20 }],
    };
    const w2 = new SimWorld(miniWin, new EventBus(), { seed: 77, recordCommands: true });
    w2.placeTowerOnPlot(0, 'archer');
    w2.startNextWave();
    while (w2.outcome === 'ongoing') w2.fixedTick(BALANCE.fixedDt);
    expect(w2.outcome).toBe('won');
    const winTick = w2.tick;

    const delayedEndlessLog = parseSimReplay({
      ...w2.exportReplay(),
      commands: [
        ...w2.getRecordedCommands(),
        { tick: winTick + 30, seq: 99, command: { kind: 'enterEndless' } },
        { tick: winTick + 30, seq: 100, command: { kind: 'startWave' } },
      ],
      summary: { ...w2.exportReplay().summary, totalTicks: winTick + 60, outcome: 'ongoing' },
    })!;
    const player = new SimReplayPlayer(miniWin, delayedEndlessLog);
    player.runToEnd();
    expect(player.world.waveSystem.isEndless).toBe(true);
    expect(player.world.waveSystem.currentWaveOneBased).toBe(2);
    expect(player.finished).toBe(true);
  });

  it('clears burn zones, co-held blockers, and hero aura buffs on defeat/hero-death, and replays pre-endless setAutoWave', () => {
    // 1. Co-held enemy (Bran + Barracks soldier) + Mortar T3 burn zone on defeat:
    //    enemyBlocked / enemyUnblocked remain 1-to-1, burn zones clear, and no stale blockers remain.
    const events = new EventBus();
    let blockedCount = 0;
    let unblockedCount = 0;
    events.on('enemyBlocked', () => void blockedCount++);
    events.on('enemyUnblocked', () => void unblockedCount++);

    const defeatWorld = new SimWorld(LEVEL_L1C, events, {
      heroId: 'bran',
      heroLevel: 20,
      heroSkills: defaultLevel20Skills('bran'),
      seed: 2026,
      recordCommands: true,
    });
    defeatWorld.gold = 9000;
    const barracks = defeatWorld.placeTowerOnPlot(21, 'barracks')!;
    const mortar = defeatWorld.placeTowerOnPlot(0, 'mortar')!;
    defeatWorld.upgradeTower(mortar.id);
    defeatWorld.upgradeTower(mortar.id);
    defeatWorld.startNextWave();

    const bState = defeatWorld.soldierSystem.getBarracks(barracks.id)!;
    defeatWorld.hero!.x = defeatWorld.hero!.postX = bState.rallyX;
    defeatWorld.hero!.z = defeatWorld.hero!.postZ = bState.rallyZ;

    const heldFoe = defeatWorld.enemySystem.spawnEnemy('brute', 100, false, 0)!;
    heldFoe.dist = defeatWorld.groundPath.nearestDist(bState.rallyX, bState.rallyZ);
    heldFoe.x = heldFoe.prevX = bState.rallyX;
    heldFoe.z = heldFoe.prevZ = bState.rallyZ;
    defeatWorld.spatialHash.clear();
    defeatWorld.spatialHash.insert(heldFoe.poolIndex, heldFoe.x, heldFoe.z);

    // Spawn a Mortar T3 shell and resolve impact to create an active ground burn zone.
    const shell = defeatWorld.projectileSystem.spawnProjectile(mortar, heldFoe, 0.55)!;
    shell.progress = 1;
    defeatWorld.projectileSystem.update(BALANCE.fixedDt, defeatWorld.towers);
    expect(defeatWorld.projectileSystem.getActiveBurnZoneCount()).toBeGreaterThan(0);

    for (let i = 0; i < 240 && (heldFoe.blockers === 0 || heldFoe.heroBlockers === 0); i++) {
      defeatWorld.soldierSystem.update(BALANCE.fixedDt, defeatWorld.towers, 1);
      defeatWorld.heroSystem.update(BALANCE.fixedDt, defeatWorld.towers, 1);
    }
    expect(heldFoe.blockers).toBeGreaterThan(0);
    expect(heldFoe.heroBlockers).toBeGreaterThan(0);
    expect(blockedCount).toBe(1);
    expect(unblockedCount).toBe(0);

    const cmdsBeforeLose = defeatWorld.getRecordedCommands().length;
    defeatWorld.debugForceLose();
    expect(defeatWorld.outcome).toBe('lost');
    expect(defeatWorld.projectileSystem.getActiveBurnZoneCount()).toBe(0);
    expect(defeatWorld.soldierSystem.blockedCount).toBe(0);
    expect(defeatWorld.soldierSystem.soldiers.every((s) => s.state !== 'fighting' && s.state !== 'engaging')).toBe(true);
    expect(heldFoe.blockers).toBe(0);
    expect(heldFoe.heroBlockers).toBe(0);
    expect(unblockedCount).toBe(1);

    // Post-defeat setAutoWave is ignored and never appends dead commands to commandLog.
    defeatWorld.setAutoWave(true);
    expect(defeatWorld.getRecordedCommands().length).toBe(cmdsBeforeLose);

    // 2. Hero death immediately zeroes Tobb Tinker tower bonuses and soldier Rally/Calm buffs on the same tick.
    const tobbWorld = new SimWorld(LEVEL_L1C, new EventBus(), {
      heroId: 'tobb',
      heroLevel: 20,
      heroSkills: defaultLevel20Skills('tobb'),
      seed: 303,
    });
    tobbWorld.gold = 5000;
    const archer = tobbWorld.placeTowerOnPlot(21, 'archer')!;
    tobbWorld.hero!.x = tobbWorld.hero!.postX = archer.x;
    tobbWorld.hero!.z = tobbWorld.hero!.postZ = archer.z;
    tobbWorld.startNextWave();
    tobbWorld.heroSystem.update(BALANCE.fixedDt, tobbWorld.towers, 1);
    expect(archer.heroRateBonus).toBeGreaterThan(0);
    expect(archer.heroRangeBonus).toBeGreaterThan(0);

    // Put Tobb at 1 HP in melee reach of a Brute and run heroSystem.update until Tobb falls.
    tobbWorld.hero!.hp = 1;
    const killer = tobbWorld.enemySystem.spawnEnemy('brute', 5, false, 0)!;
    killer.x = killer.prevX = tobbWorld.hero!.x;
    killer.z = killer.prevZ = tobbWorld.hero!.z;
    tobbWorld.spatialHash.clear();
    tobbWorld.spatialHash.insert(killer.poolIndex, killer.x, killer.z);
    for (let i = 0; i < 90 && tobbWorld.hero!.state !== 'dead'; i++) {
      tobbWorld.heroSystem.update(BALANCE.fixedDt, tobbWorld.towers, 1);
    }
    expect(tobbWorld.hero!.state).toBe('dead');
    expect(archer.heroRateBonus).toBe(0);
    expect(archer.heroRangeBonus).toBe(0);

    // 3. Forced mid-wave win clears enemyPool so enterEndlessMode starts clean, and SimReplayPlayer
    //    flushes pre-endless setAutoWave commands before delayed enterEndless.
    const midWaveWin = new SimWorld(LEVEL_L1C, new EventBus(), { seed: 44 });
    midWaveWin.startNextWave();
    midWaveWin.enemySystem.spawnEnemy('grunt', 1, false, 0);
    expect(midWaveWin.enemyPool.getActiveCount()).toBe(1);
    midWaveWin.debugForceWin();
    expect(midWaveWin.enemyPool.getActiveCount()).toBe(0);
    expect(midWaveWin.enterEndlessMode()).toBe(true);

    const miniWin = {
      ...LEVEL_L1C,
      id: 'mini-pre-endless-autowave',
      waves: [{ groups: [{ enemyType: 'grunt' as const, count: 1, spawnInterval: 0.2, startDelay: 0 }], clearBonus: 20 }],
    };
    const baseWin = new SimWorld(miniWin, new EventBus(), { seed: 88, recordCommands: true });
    baseWin.placeTowerOnPlot(0, 'archer');
    baseWin.startNextWave();
    while (baseWin.outcome === 'ongoing') baseWin.fixedTick(BALANCE.fixedDt);
    const wTick = baseWin.tick;
    const autoBeforeEndless = parseSimReplay({
      ...baseWin.exportReplay(),
      commands: [
        ...baseWin.getRecordedCommands(),
        { tick: wTick + 10, seq: 10, command: { kind: 'setAutoWave', enabled: true } },
        { tick: wTick + 20, seq: 11, command: { kind: 'enterEndless' } },
      ],
      summary: { ...baseWin.exportReplay().summary, totalTicks: wTick + 90, outcome: 'ongoing' },
    })!;
    const player2 = new SimReplayPlayer(miniWin, autoBeforeEndless);
    player2.runToEnd();
    expect(player2.world.waveSystem.isEndless).toBe(true);
    expect(player2.world.waveSystem.autoWave).toBe(true);
    expect(player2.finished).toBe(true);
  });

  it('keeps SoldierSystem block/unblock 1-to-1 on same-tick counter-kills, flushes delayed enterEndless siblings, and guards findHoveredEnemy', () => {
    // 1. Newly-blocking 1-HP soldier killed on the exact counter-attack tick still emits enemyUnblocked 1-to-1,
    //    and selling / rallying immediately decrements soldierSystem.blockedCount.
    const events = new EventBus();
    let blocked = 0;
    let unblocked = 0;
    events.on('enemyBlocked', () => void blocked++);
    events.on('enemyUnblocked', () => void unblocked++);

    const w = new SimWorld(LEVEL_L1C, events, { seed: 777 });
    w.gold = 9000;
    const bTower = w.placeTowerOnPlot(21, 'barracks')!;
    w.startNextWave();
    const bState = w.soldierSystem.getBarracks(bTower.id)!;

    // Keep only slot 0 alive at 1 HP right on the rally point; put slot 1 dead with long respawn.
    const s0 = bState.squad[0];
    const s1 = bState.squad[1];
    s0.hp = 1;
    s0.x = s0.prevX = bState.rallyX;
    s0.z = s0.prevZ = bState.rallyZ;
    s0.state = 'idle';
    s1.state = 'dead';
    s1.respawnTimer = 999;

    // Brute was previously held and released with residual meleeTimer = 0.005s (> 0, <= fixedDt).
    const brute = w.enemySystem.spawnEnemy('brute', 10, false, 0)!;
    brute.x = brute.prevX = bState.rallyX;
    brute.z = brute.prevZ = bState.rallyZ;
    brute.meleeTimer = 0.005;
    w.spatialHash.clear();
    w.spatialHash.insert(brute.poolIndex, brute.x, brute.z);

    w.soldierSystem.update(BALANCE.fixedDt, w.towers, 1);
    expect(s0.state).toBe('dead');
    expect(brute.blockers).toBe(0);
    expect(w.soldierSystem.blockedCount).toBe(0);
    expect(blocked).toBe(1);
    expect(unblocked).toBe(1);

    // Revive s0 at full HP, let it block brute, then sell the barracks -> blockedCount drops to 0 immediately.
    s0.state = 'idle';
    s0.hp = s0.maxHp;
    s0.x = s0.prevX = bState.rallyX;
    s0.z = s0.prevZ = bState.rallyZ;
    brute.meleeTimer = 5.0;
    w.soldierSystem.update(BALANCE.fixedDt, w.towers, 1);
    expect(w.soldierSystem.blockedCount).toBe(1);
    expect(blocked).toBe(2);
    expect(unblocked).toBe(1);
    w.sellTower(bTower.id);
    expect(w.soldierSystem.blockedCount).toBe(0);
    expect(unblocked).toBe(2);

    // 2. SimReplayPlayer flushes sibling commands (startWave, placeTowerOnPlot) stamped on the same delayed tick as enterEndless.
    const miniWin = {
      ...LEVEL_L1C,
      id: 'mini-delayed-endless-siblings',
      waves: [{ groups: [{ enemyType: 'grunt' as const, count: 1, spawnInterval: 0.2, startDelay: 0 }], clearBonus: 80 }],
    };
    const baseWin = new SimWorld(miniWin, new EventBus(), { seed: 91, recordCommands: true });
    baseWin.placeTowerOnPlot(0, 'archer');
    baseWin.startNextWave();
    while (baseWin.outcome === 'ongoing') baseWin.fixedTick(BALANCE.fixedDt);
    const wTick = baseWin.tick;
    const siblingReplay = parseSimReplay({
      ...baseWin.exportReplay(),
      commands: [
        ...baseWin.getRecordedCommands(),
        { tick: wTick + 15, seq: 0, command: { kind: 'enterEndless' } },
        { tick: wTick + 15, seq: 1, command: { kind: 'placeTowerOnPlot', plotIndex: 1, towerType: 'frost' } },
        { tick: wTick + 15, seq: 2, command: { kind: 'startWave' } },
      ],
      summary: { ...baseWin.exportReplay().summary, totalTicks: wTick + 15, outcome: 'ongoing' },
    })!;
    const sibPlayer = new SimReplayPlayer(miniWin, siblingReplay);
    sibPlayer.runToEnd();
    expect(sibPlayer.world.waveSystem.isEndless).toBe(true);
    expect(sibPlayer.world.towers.length).toBe(2);
    expect(sibPlayer.world.waveSystem.currentWaveOneBased).toBe(2);

    // 3. WaveSystem autoShortenedBy is captured in computeSimStateHash and cleared by skipToWave,
    //    and findHoveredEnemy ignores 0-HP corpses and burrowed enemies.
    const hoverWorld = new SimWorld(LEVEL_L1C, new EventBus(), { seed: 12 });
    hoverWorld.waveSystem.state = 'betweenWaves';
    hoverWorld.waveSystem.interWaveTimer = 0.75;
    const hashBeforeAuto = computeSimStateHash(hoverWorld);
    hoverWorld.waveSystem.interWaveTimer = 8.0;
    hoverWorld.waveSystem.setAutoWave(true); // interWaveTimer -> 0.75, autoShortenedBy -> 7.25
    hoverWorld.waveSystem.setAutoWave(false); // interWaveTimer -> 8.0, autoShortenedBy -> 0
    hoverWorld.waveSystem.setAutoWave(true); // interWaveTimer -> 0.75, autoShortenedBy -> 7.25
    // Compare against a world at interWaveTimer=0.75 with autoWave=true but autoShortenedBy=0:
    const hoverWorldNoShorten = new SimWorld(LEVEL_L1C, new EventBus(), { seed: 12 });
    hoverWorldNoShorten.waveSystem.setAutoWave(true);
    hoverWorldNoShorten.waveSystem.state = 'betweenWaves';
    hoverWorldNoShorten.waveSystem.interWaveTimer = 0.75;
    expect(hashBeforeAuto).not.toBe(computeSimStateHash(hoverWorld));
    expect(computeSimStateHash(hoverWorld)).not.toBe(computeSimStateHash(hoverWorldNoShorten));
    hoverWorld.debugSkipToWave(1);
    expect(hoverWorld.waveSystem.getAutoShortenedBy()).toBe(0);

    const alive = hoverWorld.enemySystem.spawnEnemy('grunt', 1, false, 0)!;
    hoverWorld.spatialHash.clear();
    hoverWorld.spatialHash.insert(alive.poolIndex, alive.x, alive.z);
    expect(hoverWorld.findHoveredEnemy(alive.x, alive.z, alive.x, alive.z)).toBe(alive);
    alive.burrowed = true;
    expect(hoverWorld.findHoveredEnemy(alive.x, alive.z, alive.x, alive.z)).toBeNull();
    alive.burrowed = false;
    alive.hp = 0;
    expect(hoverWorld.findHoveredEnemy(alive.x, alive.z, alive.x, alive.z)).toBeNull();
  });

  it('prevents mid-tick listener duplicate enemyUnblocked, resolves heroSkillCast targets, and paces delayed enterEndless ticks exactly', () => {
    // 1. Mid-tick 'heroHit' listener calling commandHeroMove emits enemyUnblocked once (never duplicated by reconcileHeroUnblocks).
    const heroEvents = new EventBus();
    let hBlocked = 0;
    let hUnblocked = 0;
    const branWorld = new SimWorld(LEVEL_L1C, heroEvents, { heroId: 'bran', heroLevel: 10, seed: 51 });
    branWorld.startNextWave();
    const roadEnd = branWorld.groundPath.points[branWorld.groundPath.points.length - 1];
    const roadStart = branWorld.groundPath.points[0];
    branWorld.hero!.x = branWorld.hero!.postX = roadStart.x;
    branWorld.hero!.z = branWorld.hero!.postZ = roadStart.z;
    const foe = branWorld.enemySystem.spawnEnemy('brute', 10, false, 0)!;
    foe.x = foe.prevX = roadStart.x;
    foe.z = foe.prevZ = roadStart.z;
    foe.heroMeleeTimer = 0.005;
    branWorld.spatialHash.clear();
    branWorld.spatialHash.insert(foe.poolIndex, foe.x, foe.z);

    heroEvents.on('enemyBlocked', () => void hBlocked++);
    heroEvents.on('enemyUnblocked', () => void hUnblocked++);
    heroEvents.on('heroHit', () => {
      branWorld.commandHeroMove(roadEnd.x, roadEnd.z);
    });

    for (let i = 0; i < 30 && hUnblocked === 0; i++) {
      branWorld.heroSystem.update(BALANCE.fixedDt, branWorld.towers, 1);
    }
    expect(hBlocked).toBe(1);
    expect(hUnblocked).toBe(1);

    // 2. Mid-tick 'meleeHit' listener calling setRallyPoint emits enemyUnblocked once (never duplicated by Step 8).
    const solEvents = new EventBus();
    let sBlocked = 0;
    let sUnblocked = 0;
    const solWorld = new SimWorld(LEVEL_L1C, solEvents, { seed: 52 });
    solWorld.gold = 5000;
    const bar = solWorld.placeTowerOnPlot(21, 'barracks')!;
    solWorld.startNextWave();
    const bState = solWorld.soldierSystem.getBarracks(bar.id)!;
    for (const s of bState.squad) {
      s.x = s.prevX = bState.rallyX;
      s.z = s.prevZ = bState.rallyZ;
    }
    const brute = solWorld.enemySystem.spawnEnemy('brute', 10, false, 0)!;
    brute.x = brute.prevX = bState.rallyX;
    brute.z = brute.prevZ = bState.rallyZ;
    brute.meleeTimer = 0.005;
    solWorld.spatialHash.clear();
    solWorld.spatialHash.insert(brute.poolIndex, brute.x, brute.z);

    solEvents.on('enemyBlocked', () => void sBlocked++);
    solEvents.on('enemyUnblocked', () => void sUnblocked++);
    let ralliedInHit = false;
    solEvents.on('meleeHit', (ev) => {
      if (ev.attacker === 'enemy' && !ralliedInHit) {
        ralliedInHit = true;
        solWorld.setRallyPoint(bar.id, bar.x, bar.z);
      }
    });
    solWorld.soldierSystem.update(BALANCE.fixedDt, solWorld.towers, 1);
    expect(sBlocked).toBe(1);
    expect(sUnblocked).toBe(1);

    // 3. heroSkillCast emits resolved target coordinates (gizmo cleared off plot, overhaul snapped to tower, shieldBash in front of Bran).
    const castTargets: Array<{ skillId: string; tx: number; tz: number }> = [];
    const tobbEvents = new EventBus();
    tobbEvents.on('heroSkillCast', (ev) => castTargets.push({ skillId: ev.skillId, tx: ev.targetX, tz: ev.targetZ }));
    const tobbW = new SimWorld(LEVEL_L1C, tobbEvents, { heroId: 'tobb', heroLevel: 10, seed: 53 });
    tobbW.gold = 5000;
    const nearPlot = LEVEL_L1C.layout2d!.plots[3];
    const builtTower = tobbW.placeTowerOnPlot(3, 'archer')!;
    tobbW.hero!.x = tobbW.hero!.postX = nearPlot.x;
    tobbW.hero!.z = tobbW.hero!.postZ = nearPlot.z;
    expect(tobbW.castHeroSkill(0, nearPlot.x, nearPlot.z)).toBe(true); // deployGizmo aimed directly on plot 3
    expect(tobbW.heroSystem.gizmos).toHaveLength(1);
    expect(castTargets[0].tx).toBeCloseTo(tobbW.heroSystem.gizmos[0].x, 6);
    expect(castTargets[0].tz).toBeCloseTo(tobbW.heroSystem.gizmos[0].z, 6);
    expect(tobbW.castHeroSkill(1, nearPlot.x + 1.2, nearPlot.z - 0.9)).toBe(true); // overhaul snaps onto builtTower
    expect(castTargets[1].tx).toBeCloseTo(builtTower.x, 6);
    expect(castTargets[1].tz).toBeCloseTo(builtTower.z, 6);

    // 4. SimWorld guards non-finite/non-positive fixedTick dt, invalid TowerType/TargetingMode, and debugForceWin wave state.
    const guardW = new SimWorld(LEVEL_L1C, new EventBus(), { seed: 54 });
    guardW.fixedTick(NaN);
    guardW.fixedTick(0);
    guardW.fixedTick(-1 / 60);
    expect(guardW.tick).toBe(0);
    expect(guardW.canPlaceTowerAt(0, 0, 'trebuchet' as never)).toBe(false);
    expect(guardW.placeTowerOnPlot(0, 'trebuchet' as never)).toBeNull();
    const validArch = guardW.placeTowerOnPlot(0, 'archer', 'bogus' as never)!;
    expect(validArch.targetingMode).toBe('first');
    expect(guardW.setTowerTargeting(validArch.id, 'bogus' as never)).toBe(false);
    guardW.startNextWave();
    guardW.waveSystem.pendingClearBonus = 99;
    guardW.debugForceWin();
    expect(guardW.waveSystem.state).toBe('finished');
    expect(guardW.waveSystem.pendingClearBonus).toBe(0);
    expect(guardW.waveSystem.getNextWavePreview()).toBeNull();

    // 5. SimReplayPlayer seekToTick & post-endless command delta across a paused victory window.
    const miniWin = {
      ...LEVEL_L1C,
      id: 'mini-exact-victory-wait',
      waves: [{ groups: [{ enemyType: 'grunt' as const, count: 1, spawnInterval: 0.2, startDelay: 0 }], clearBonus: 80 }],
    };
    const baseWin = new SimWorld(miniWin, new EventBus(), { seed: 95, recordCommands: true });
    const t0 = baseWin.placeTowerOnPlot(0, 'archer')!;
    baseWin.startNextWave();
    while (baseWin.outcome === 'ongoing') baseWin.fixedTick(BALANCE.fixedDt);
    const wTick = baseWin.tick;
    const exactWaitLog = parseSimReplay({
      ...baseWin.exportReplay(),
      commands: [
        ...baseWin.getRecordedCommands(),
        { tick: wTick + 10, seq: 0, command: { kind: 'setAutoWave', enabled: true } },
        { tick: wTick + 20, seq: 0, command: { kind: 'enterEndless' } },
        { tick: wTick + 35, seq: 0, command: { kind: 'sellTower', towerId: t0.id } },
      ],
      summary: { ...baseWin.exportReplay().summary, totalTicks: wTick + 40, outcome: 'ongoing' },
    })!;
    const waitPlayer = new SimReplayPlayer(miniWin, exactWaitLog);
    waitPlayer.seekToTick(wTick + 5);
    expect(waitPlayer.currentTick).toBe(wTick + 5);
    expect(waitPlayer.world.outcome).toBe('won');
    expect(waitPlayer.world.waveSystem.autoWave).toBe(false);
    waitPlayer.seekToTick(wTick + 12);
    expect(waitPlayer.currentTick).toBe(wTick + 12);
    expect(waitPlayer.world.outcome).toBe('won');
    expect(waitPlayer.world.waveSystem.autoWave).toBe(true);
    waitPlayer.seekToTick(wTick + 25); // 5 ticks into endless, BEFORE sellTower at wTick + 35!
    expect(waitPlayer.world.waveSystem.isEndless).toBe(true);
    expect(waitPlayer.world.towers).toHaveLength(1);
    waitPlayer.runToEnd();
    expect(waitPlayer.currentTick).toBe(wTick + 40);
    expect(waitPlayer.world.towers).toHaveLength(0);
  });

  it('guards re-entrant hero skill casts/scratches, preserves causal command seq across synchronous listeners, and skips burrowed foes in combat subsystems', () => {
    // 1. Re-entrant castHeroSkill(0) inside 'enemyHit' sees cooldown > 0 immediately (no recursion),
    //    while chaining castHeroSkill(1) inside 'enemyHit' uses isolated scratch buffers and resolved targets.
    const chainEvents = new EventBus();
    const castEvents: Array<{ slot: number; tx: number; tz: number }> = [];
    let slot0RecastResult: boolean | null = null;
    let slot1ChainResult: boolean | null = null;
    const selaW = new SimWorld(LEVEL_L1C, chainEvents, { heroId: 'sela', heroLevel: 20, seed: 71 });
    selaW.startNextWave();
    const r0 = selaW.groundPath.points[0];
    selaW.hero!.x = selaW.hero!.postX = r0.x;
    selaW.hero!.z = selaW.hero!.postZ = r0.z;
    const e1 = selaW.enemySystem.spawnEnemy('brute', 10, false, 0)!;
    const e2 = selaW.enemySystem.spawnEnemy('brute', 10, false, 0)!;
    e1.x = r0.x + 0.4;
    e1.z = r0.z;
    e2.x = r0.x + 0.9;
    e2.z = r0.z + 0.3;
    selaW.spatialHash.clear();
    selaW.spatialHash.insert(e1.poolIndex, e1.x, e1.z);
    selaW.spatialHash.insert(e2.poolIndex, e2.x, e2.z);

    let hitTriggered = false;
    chainEvents.on('heroSkillCast', (ev) => castEvents.push({ slot: ev.slot, tx: ev.targetX, tz: ev.targetZ }));
    chainEvents.on('enemyHit', () => {
      if (hitTriggered) return;
      hitTriggered = true;
      slot0RecastResult = selaW.castHeroSkill(0, e1.x, e1.z); // must fail: slot 0 is already on cooldown
      slot1ChainResult = selaW.castHeroSkill(1, e2.x, e2.z); // Thunder Call on slot 1 succeeds cleanly
    });

    expect(selaW.castHeroSkill(0, e1.x, e1.z)).toBe(true); // Undertow hits e1 AND e2 without scratch clobbering
    expect(slot0RecastResult).toBe(false);
    expect(slot1ChainResult).toBe(true);
    expect(e1.slowRatio).toBeGreaterThan(0);
    expect(e2.slowRatio).toBeGreaterThan(0);
    expect(castEvents.map((c) => c.slot)).toEqual([1, 0]);
    expect(castEvents[1].tx).toBeCloseTo(e1.x, 6);
    expect(castEvents[1].tz).toBeCloseTo(e1.z, 6);

    // 2. Lethal 'heroHit' marks getHeroState().alive === false and blocks 0-HP resurrection casts.
    const lethalEvents = new EventBus();
    let stateInLethalHit: ReturnType<SimWorld['getHeroState']> = null;
    let castAtZeroHp = true;
    let moveAtZeroHp = true;
    const dyingSela = new SimWorld(LEVEL_L1C, lethalEvents, {
      heroId: 'sela',
      heroLevel: 20,
      heroSkills: ['sela_tide_1', 'sela_tide_2', 'sela_tide_3'],
      seed: 72,
    });
    dyingSela.startNextWave();
    dyingSela.hero!.x = dyingSela.hero!.postX = r0.x;
    dyingSela.hero!.z = dyingSela.hero!.postZ = r0.z;
    dyingSela.hero!.hp = 1;
    const killer = dyingSela.enemySystem.spawnEnemy('brute', 10, false, 0)!;
    killer.x = r0.x;
    killer.z = r0.z;
    killer.heroMeleeTimer = 0.001;
    dyingSela.spatialHash.clear();
    dyingSela.spatialHash.insert(killer.poolIndex, killer.x, killer.z);
    lethalEvents.on('heroHit', () => {
      stateInLethalHit = dyingSela.getHeroState();
      castAtZeroHp = dyingSela.castHeroSkill(0, r0.x, r0.z);
      moveAtZeroHp = dyingSela.commandHeroMove(r0.x + 2, r0.z);
    });
    dyingSela.heroSystem.update(BALANCE.fixedDt, dyingSela.towers, 1);
    expect(stateInLethalHit?.hp).toBe(0);
    expect(stateInLethalHit?.alive).toBe(false);
    expect(castAtZeroHp).toBe(false);
    expect(moveAtZeroHp).toBe(false);
    expect(dyingSela.hero!.state).toBe('dead');

    // 3. Causal command seq recording when synchronous EventBus listeners issue follow-up commands
    //    (towerBuilt from placeTowerOnPlot -> upgradeTower; towerSold refund -> placeTowerOnPlot; endlessEntered -> startNextWave).
    const miniCausal = {
      ...LEVEL_L1C,
      id: 'mini-causal-seq',
      startingGold: 220, // Archer T1 (70) + T2 (110) = 180, leaving 40; selling refunds 126 -> 166 (>= Cannon 100)
      waves: [{ groups: [{ enemyType: 'grunt' as const, count: 1, spawnInterval: 0.2, startDelay: 0 }], clearBonus: 60 }],
    };
    const causalEvents = new EventBus();
    const liveW = new SimWorld(miniCausal, causalEvents, { seed: 73, recordCommands: true });
    let upgradedOnBuild = false;
    causalEvents.on('towerBuilt', (ev) => {
      if (!upgradedOnBuild && ev.type === 'archer') {
        upgradedOnBuild = true;
        liveW.upgradeTower(ev.towerId);
      }
    });
    causalEvents.on('towerSold', () => {
      // Spend the sell refund immediately on the freed plot 0!
      liveW.placeTowerOnPlot(0, 'cannon');
    });
    causalEvents.on('endlessEntered', () => {
      liveW.startNextWave();
    });

    const arch = liveW.placeTowerOnPlot(0, 'archer')!;
    expect(arch.tier).toBe(2);
    liveW.sellTower(arch.id);
    expect(liveW.towers).toHaveLength(1);
    expect(liveW.towers[0].type).toBe('cannon');
    liveW.startNextWave();
    while (liveW.outcome === 'ongoing') liveW.fixedTick(BALANCE.fixedDt);
    expect(liveW.outcome).toBe('won');
    expect(liveW.enterEndlessMode()).toBe(true);
    expect(liveW.waveSystem.state).toBe('spawning');
    for (let i = 0; i < 30; i++) liveW.fixedTick(BALANCE.fixedDt);

    const causalLog = liveW.exportReplay();
    expect(causalLog.commands.map((c) => c.command.kind)).toEqual([
      'placeTowerOnPlot',
      'upgradeTower',
      'sellTower',
      'placeTowerOnPlot',
      'startWave',
      'enterEndless',
      'startWave',
    ]);
    const causalPlayer = new SimReplayPlayer(miniCausal, parseSimReplay(serializeSimReplay(causalLog))!);
    const causalVerify = causalPlayer.runToEnd();
    expect(causalVerify.matchesOutcome).toBe(true);
    expect(causalVerify.matchesHash).toBe(true);

    // 4. applyCommand('setAutoWave') returns false once lost, and combat subsystems ignore burrowed foes in spatialHash.
    const burWorld = new SimWorld(LEVEL_L1C, new EventBus(), { seed: 74 });
    burWorld.gold = 9999;
    const tesla = burWorld.placeTowerOnPlot(0, 'tesla')!;
    burWorld.upgradeTower(tesla.id);
    burWorld.upgradeTower(tesla.id);
    const ballista = burWorld.placeTowerOnPlot(1, 'ballista')!;
    burWorld.upgradeTower(ballista.id);
    burWorld.upgradeTower(ballista.id);
    burWorld.startNextWave();
    const bur = burWorld.enemySystem.spawnEnemy('burrower', 5, false, 0)!;
    bur.x = tesla.x + 0.5;
    bur.z = tesla.z;
    bur.burrowed = true;
    burWorld.spatialHash.clear();
    burWorld.spatialHash.insert(bur.poolIndex, bur.x, bur.z);
    const hpBefore = bur.hp;
    burWorld.combatSystem.update(0.5, burWorld.towers, 1);
    burWorld.abilitySystem.castMeteor(bur.x, bur.z, 1);
    burWorld.abilitySystem.update(1.0, true, burWorld.enemyPool, burWorld.spatialHash, burWorld.enemySystem);
    const bolt = burWorld.projectileSystem.spawnProjectile(ballista, bur, 1)!;
    bolt.progress = 1;
    burWorld.projectileSystem.update(BALANCE.fixedDt, burWorld.towers);
    expect(bur.hp).toBe(hpBefore);

    burWorld.debugForceLose();
    expect(burWorld.applyCommand({ kind: 'setAutoWave', enabled: true })).toBe(false);
  });

  it('halts multi-tick 3x frames on mid-tick pause/reset, keeps EventBus duplicate unsubs independent, and reports dead getHeroState on lethal heroHit', () => {
    // 1. FixedTimestepStepper stops remaining 3x catch-up ticks on mid-tick pause and keeps accumulator >= 0 on resetAccumulator.
    const stepper = new FixedTimestepStepper();
    stepper.simActive = true;
    stepper.setSpeed(3);
    let ticksOnPause = 0;
    stepper.step(0.1, () => {
      ticksOnPause++;
      if (ticksOnPause === 2) stepper.paused = true;
    });
    expect(ticksOnPause).toBe(2);

    stepper.paused = false;
    stepper.resetAccumulator();
    const afterReset = stepper.step(BALANCE.fixedDt, () => {
      stepper.resetAccumulator();
    });
    expect(afterReset.ticksExecuted).toBe(1);
    expect(afterReset.alpha).toBe(0);

    // 2. SimReplayPlayer.stepFrame halts on mid-frame player.paused = true and keeps alpha = 0 on mid-frame reset.
    const miniLvl = {
      ...LEVEL_L1C,
      id: 'mini-stepframe-pause',
      waves: [{ groups: [{ enemyType: 'grunt' as const, count: 3, spawnInterval: 0.5, startDelay: 0 }], clearBonus: 20 }],
    };
    const recWorld = new SimWorld(miniLvl, new EventBus(), { seed: 19, recordCommands: true });
    recWorld.startNextWave();
    for (let i = 0; i < 60; i++) recWorld.fixedTick(BALANCE.fixedDt);
    const replayEvents = new EventBus();
    const player = new SimReplayPlayer(miniLvl, recWorld.exportReplay(), replayEvents);
    player.setSpeed(8);
    let spawnedSeen = 0;
    const offSpawn = replayEvents.on('enemySpawned', () => {
      spawnedSeen++;
      player.paused = true;
    });
    const pausedStep = player.stepFrame(0.1);
    expect(spawnedSeen).toBe(1);
    expect(pausedStep.ticksExecuted).toBe(1);
    offSpawn();

    player.paused = false;
    player.reset(false);
    const offReset = replayEvents.on('enemySpawned', () => {
      offReset();
      player.reset(false);
    });
    const resetStep = player.stepFrame(BALANCE.fixedDt, 1, false);
    expect(resetStep.alpha).toBe(0);

    // 3. EventBus duplicate callback registrations stay independent on double-off and mid-emit off.
    const bus = new EventBus();
    const calls: string[] = [];
    const shared = (): void => {
      calls.push('shared');
    };
    const off1 = bus.on('economyChanged', shared);
    const off2 = bus.on('economyChanged', shared);
    off1();
    off1(); // idempotent: must NOT unsubscribe off2!
    bus.emit('economyChanged', { gold: 10, lives: 20 });
    expect(calls).toEqual(['shared']);
    off2();

    calls.length = 0;
    let unsubA: () => void = () => {};
    bus.on('economyChanged', () => {
      unsubA(); // unsubscribes first shared registration mid-emit; second must still fire once!
    });
    unsubA = bus.on('economyChanged', shared);
    bus.on('economyChanged', shared);
    bus.emit('economyChanged', { gold: 10, lives: 20 });
    expect(calls).toEqual(['shared']);

    // 4. Lethal 'heroHit' observes dead HeroRuntimeState (alive: false, state: 'dead', respawnRemaining > 0) before 'heroDied'.
    const hitEvents = new EventBus();
    const order: string[] = [];
    const heroW = new SimWorld(LEVEL_L1C, hitEvents, { heroId: 'wren', heroLevel: 5, seed: 31 });
    heroW.startNextWave();
    heroW.hero!.hp = 1;
    const brute = heroW.enemySystem.spawnEnemy('brute', 10, false, 0)!;
    brute.x = brute.prevX = heroW.hero!.x;
    brute.z = brute.prevZ = heroW.hero!.z;
    brute.heroMeleeTimer = 0.005;
    heroW.spatialHash.clear();
    heroW.spatialHash.insert(brute.poolIndex, brute.x, brute.z);

    hitEvents.on('heroHit', (ev) => {
      order.push('heroHit');
      const hs = heroW.getHeroState()!;
      expect(ev.hp).toBe(0);
      expect(hs.alive).toBe(false);
      expect(hs.state).toBe('dead');
      expect(hs.hp).toBe(0);
      expect(hs.respawnRemaining).toBeGreaterThan(0);
    });
    hitEvents.on('heroDied', () => {
      order.push('heroDied');
    });
    heroW.heroSystem.update(BALANCE.fixedDt, heroW.towers, 1);
    expect(order).toEqual(['heroHit', 'heroDied']);

    // 5. SoldierSystem.setRally scales barracks rally reach with auraRange / heroRangeBonus.
    const rallyW = new SimWorld(LEVEL_L1C, new EventBus(), { seed: 32 });
    rallyW.gold = 9999;
    const builtBarracks = rallyW.placeTowerOnPlot(21, 'barracks')!;
    expect(builtBarracks).not.toBeNull();
    // Find a road sample beyond base range (3.2u) but within +18% range (~3.77u).
    let boostedPt: { x: number; z: number } | null = null;
    const sample = { x: 0, y: 0, z: 0 };
    for (let d = 0; d <= rallyW.groundPath.totalLength; d += 0.15) {
      rallyW.groundPath.sample(d, sample);
      const dist = Math.hypot(sample.x - builtBarracks.x, sample.z - builtBarracks.z);
      if (dist > 3.28 && dist <= 3.72) {
        boostedPt = { x: sample.x, z: sample.z };
        break;
      }
    }
    expect(boostedPt).not.toBeNull();
    // Without range aura, aiming at boostedPt clamps inside <= 3.2u; with +18% range aura, rally reaches > 3.25u!
    rallyW.setRallyPoint(builtBarracks.id, boostedPt!.x, boostedPt!.z);
    const bUnbuffed = rallyW.soldierSystem.getBarracks(builtBarracks.id)!;
    expect(Math.hypot(bUnbuffed.rallyX - builtBarracks.x, bUnbuffed.rallyZ - builtBarracks.z)).toBeLessThanOrEqual(3.2001);

    builtBarracks.auraRange = 0.1;
    builtBarracks.heroRangeBonus = 0.08;
    expect(rallyW.setRallyPoint(builtBarracks.id, boostedPt!.x, boostedPt!.z)).toBe(true);
    const bAfter = rallyW.soldierSystem.getBarracks(builtBarracks.id)!;
    expect(Math.hypot(bAfter.rallyX - builtBarracks.x, bAfter.rallyZ - builtBarracks.z)).toBeGreaterThan(3.25);
  });

  it('handles mid-tick sellTower re-entrancy in SoldierSystem & CombatSystem, Ballista pierce boss hits, and 0.05..0.1 replay modifiers', () => {
    // 1. Mid-swing sellTower inside 'soldierAttack' (T3 barracks with cleave + second barracks):
    //    sold barracks stops immediately (no phantom cleave/meleeSwing), and the second barracks still swings this tick!
    const solEvents = new EventBus();
    const attacksByTower: number[] = [];
    const swingsBySoldier: number[] = [];
    const solW = new SimWorld(LEVEL_L1C, solEvents, { seed: 81 });
    solW.gold = 99999;
    // Find two plots within barracks road range:
    const barracksPlots: number[] = [];
    for (let p = 0; p < solW.grid.plotCount && barracksPlots.length < 2; p++) {
      if (solW.canPlaceTowerAt(p, 0, 'barracks')) barracksPlots.push(p);
    }
    expect(barracksPlots.length).toBe(2);
    const b1 = solW.placeTowerOnPlot(barracksPlots[0], 'barracks')!;
    solW.upgradeTower(b1.id);
    solW.upgradeTower(b1.id); // T3 cleave
    const b2 = solW.placeTowerOnPlot(barracksPlots[1], 'barracks')!;
    solW.startNextWave();

    const bs1 = solW.soldierSystem.getBarracks(b1.id)!;
    const bs2 = solW.soldierSystem.getBarracks(b2.id)!;
    const b1SoldierIds = new Set(bs1.squad.map((s) => s.id));

    const foe1a = solW.enemySystem.spawnEnemy('brute', 20, false, 0)!;
    const foe1b = solW.enemySystem.spawnEnemy('brute', 20, false, 0)!;
    const d1 = solW.groundPath.nearestDist(bs1.rallyX, bs1.rallyZ);
    foe1a.dist = d1;
    foe1b.dist = Math.max(0, d1 - 0.25);
    foe1a.x = foe1a.prevX = bs1.rallyX;
    foe1a.z = foe1a.prevZ = bs1.rallyZ;
    foe1b.x = foe1b.prevX = bs1.rallyX + 0.3;
    foe1b.z = foe1b.prevZ = bs1.rallyZ;

    const foe2 = solW.enemySystem.spawnEnemy('brute', 20, false, 0)!;
    foe2.dist = solW.groundPath.nearestDist(bs2.rallyX, bs2.rallyZ);
    foe2.x = foe2.prevX = bs2.rallyX;
    foe2.z = foe2.prevZ = bs2.rallyZ;

    // Walk soldiers onto their posts first, then step into contact and force swing:
    for (let i = 0; i < 60; i++) solW.soldierSystem.update(BALANCE.fixedDt, solW.towers, 1);
    solW.spatialHash.clear();
    solW.spatialHash.insert(foe1a.poolIndex, foe1a.x, foe1a.z);
    solW.spatialHash.insert(foe1b.poolIndex, foe1b.x, foe1b.z);
    solW.spatialHash.insert(foe2.poolIndex, foe2.x, foe2.z);
    for (let i = 0; i < 30; i++) solW.soldierSystem.update(BALANCE.fixedDt, solW.towers, 1);
    for (const s of solW.soldierSystem.soldiers) s.attackTimer = 0.001;

    let soldMidSwing = false;
    solEvents.on('soldierAttack', (ev) => {
      attacksByTower.push(ev.towerId);
      if (!soldMidSwing && ev.towerId === b1.id) {
        soldMidSwing = true;
        solW.sellTower(b1.id);
      }
    });
    solEvents.on('meleeSwing', (ev) => {
      if (ev.attacker === 'soldier') swingsBySoldier.push(ev.attackerId);
    });

    solW.soldierSystem.update(BALANCE.fixedDt, solW.towers, 1);
    expect(soldMidSwing).toBe(true);
    // b1 only landed its single primary blow before being sold (no post-sell cleave or squadmate blows),
    // and b2 WAS NOT SKIPPED despite b1 being spliced out of this.barracks!
    expect(attacksByTower.filter((id) => id === b1.id)).toHaveLength(1);
    expect(attacksByTower.filter((id) => id === b2.id).length).toBeGreaterThan(0);
    expect(swingsBySoldier.some((sid) => b1SoldierIds.has(sid))).toBe(false);

    // 2. Mid-shot sellTower inside CombatSystem ('towerFired') does NOT skip the next tower in world.towers!
    const combatEvents = new EventBus();
    const firedIds: number[] = [];
    const combatW = new SimWorld(LEVEL_L1C, combatEvents, { seed: 82 });
    combatW.gold = 99999;
    const tFirst = combatW.placeTowerOnPlot(0, 'archer')!;
    const tSecond = combatW.placeTowerOnPlot(1, 'archer')!;
    combatW.startNextWave();
    tFirst.cooldownTimer = 0;
    tSecond.cooldownTimer = 0;
    const targetFoe = combatW.enemySystem.spawnEnemy('brute', 30, false, 0)!;
    targetFoe.x = (tFirst.x + tSecond.x) * 0.5;
    targetFoe.z = (tFirst.z + tSecond.z) * 0.5;
    combatW.spatialHash.clear();
    combatW.spatialHash.insert(targetFoe.poolIndex, targetFoe.x, targetFoe.z);

    combatEvents.on('towerFired', (ev) => {
      firedIds.push(ev.towerId);
      if (ev.towerId === tFirst.id) {
        combatW.sellTower(tFirst.id);
      }
    });
    combatW.combatSystem.update(BALANCE.fixedDt, combatW.towers, 1);
    expect(firedIds).toEqual([tFirst.id, tSecond.id]);

    // 3. Ballista T3 piercing bolt hitting a boss behind a grunt sets projectileImpact.isBossHit = true.
    const impactEvents = new EventBus();
    let bossPierceImpact = false;
    impactEvents.on('projectileImpact', (ev) => {
      if (ev.isBossHit) bossPierceImpact = true;
    });
    const pierceW = new SimWorld(LEVEL_L1C, impactEvents, { seed: 83 });
    pierceW.gold = 99999;
    const ballista = pierceW.placeTowerOnPlot(0, 'ballista')!;
    pierceW.upgradeTower(ballista.id);
    pierceW.upgradeTower(ballista.id);
    pierceW.startNextWave();
    const frontGrunt = pierceW.enemySystem.spawnEnemy('grunt', 5, false, 0)!;
    const rearBoss = pierceW.enemySystem.spawnEnemy('boss', 5, false, 0)!;
    frontGrunt.x = ballista.x + 2.0;
    frontGrunt.z = ballista.z;
    rearBoss.x = ballista.x + 3.5;
    rearBoss.z = ballista.z;
    pierceW.spatialHash.clear();
    pierceW.spatialHash.insert(frontGrunt.poolIndex, frontGrunt.x, frontGrunt.z);
    pierceW.spatialHash.insert(rearBoss.poolIndex, rearBoss.x, rearBoss.z);
    const skewerBolt = pierceW.projectileSystem.spawnProjectile(ballista, frontGrunt, 1)!;
    skewerBolt.progress = 1;
    pierceW.projectileSystem.update(BALANCE.fixedDt, pierceW.towers);
    expect(bossPierceImpact).toBe(true);

    // 4. parseSimReplay preserves valid 0.05..0.1 modifiers and falls back <= 0 corrupt values to 1; player.dispose() cleans up.
    const extremeMods = combineRunModifiers({
      abilityCooldownMul: 0.06,
      enemySpeedMul: 0.07,
      enemyHpMul: 0.08,
    });
    const modWorld = new SimWorld(LEVEL_L1C, new EventBus(), extremeMods, { seed: 84, recordCommands: true });
    modWorld.startNextWave();
    for (let i = 0; i < 30; i++) modWorld.fixedTick(BALANCE.fixedDt);
    const parsedExtreme = parseSimReplay(serializeSimReplay(modWorld.exportReplay()))!;
    expect(parsedExtreme.modifiers.abilityCooldownMul).toBeCloseTo(0.06, 6);
    expect(parsedExtreme.modifiers.enemySpeedMul).toBeCloseTo(0.07, 6);
    expect(parsedExtreme.modifiers.enemyHpMul).toBeCloseTo(0.08, 6);
    const extremePlayer = new SimReplayPlayer(LEVEL_L1C, parsedExtreme);
    expect(extremePlayer.runToEnd().matchesHash).toBe(true);
    extremePlayer.dispose();
    expect(extremePlayer.world.enemyPool.getActiveCount()).toBe(0);

    const corruptModLog = parseSimReplay({
      ...modWorld.exportReplay(),
      modifiers: { abilityCooldownMul: 0, enemySpeedMul: -5, enemyHpMul: 0 },
    })!;
    expect(corruptModLog.modifiers.abilityCooldownMul).toBe(1);
    expect(corruptModLog.modifiers.enemySpeedMul).toBe(1);
    expect(corruptModLog.modifiers.enemyHpMul).toBe(1);
  });

  it('hardens startNextWave & lethal-leak economyChanged state ordering, Step-7 counterattack sellTower re-entrancy, Tempest boss hits, SpatialHashGrid cycle guards, and replay resetGen', () => {
    // 1. WaveSystem.startNextWave updates wave state BEFORE emitting early-bonus 'economyChanged' (no re-entrant double start/bonus).
    const earlyEvents = new EventBus();
    const earlyW = new SimWorld(LEVEL_L1C, earlyEvents, { seed: 101 });
    expect(earlyW.startNextWave()).toBe(true);
    while (earlyW.waveSystem.state !== 'betweenWaves') {
      for (let i = 0; i < earlyW.enemyPool.getActiveCount(); i++) {
        const e = earlyW.enemyPool.items[earlyW.enemyPool.getActiveIndex(i)];
        earlyW.enemySystem.applyDamage(e, 99_999, true);
      }
      earlyW.fixedTick(BALANCE.fixedDt);
    }
    const goldBeforeEarly = earlyW.gold;
    let reentrantStartResult: boolean | null = null;
    let seenWaveOnEconomy = -1;
    let seenStateOnEconomy = '';
    let seenCanStart = true;
    earlyEvents.on('economyChanged', () => {
      if (reentrantStartResult !== null) return;
      seenWaveOnEconomy = earlyW.waveSystem.currentWaveOneBased;
      seenStateOnEconomy = earlyW.waveSystem.state;
      seenCanStart = earlyW.waveSystem.canStartNextWave();
      reentrantStartResult = earlyW.startNextWave();
    });
    expect(earlyW.startNextWave()).toBe(true);
    expect(seenWaveOnEconomy).toBe(2);
    expect(seenStateOnEconomy).toBe('spawning');
    expect(seenCanStart).toBe(false);
    expect(reentrantStartResult).toBe(false);
    expect(earlyW.waveSystem.currentWaveOneBased).toBe(2);
    expect(earlyW.gold).toBeGreaterThan(goldBeforeEarly);

    // 2. Lethal leak sets world.outcome = 'lost' BEFORE 'economyChanged' fires, and non-lethal partially-held Brute leak emits 'enemyUnblocked'.
    const leakEvents = new EventBus();
    const leakW = new SimWorld(LEVEL_L1C, leakEvents, { seed: 102 });
    leakW.lives = 5;
    let unblockedCount = 0;
    const zeroLifeOutcomes: string[] = [];
    leakEvents.on('enemyUnblocked', () => void unblockedCount++);
    leakEvents.on('economyChanged', (ev) => {
      if (ev.lives === 0) {
        zeroLifeOutcomes.push(leakW.outcome);
        expect(leakW.placeTowerOnPlot(0, 'archer')).toBeNull();
      }
    });
    leakW.startNextWave();
    const partialBrute = leakW.enemySystem.spawnEnemy('brute', 1, false, 0)!;
    partialBrute.blockers = 1; // < holdCost(2), so it still advances and leaks non-lethally (livesCost = 2 -> 3 lives left)
    partialBrute.dist = partialBrute.totalDist + 0.1;
    leakW.fixedTick(BALANCE.fixedDt);
    expect(leakW.lives).toBe(3);
    expect(leakW.outcome).toBe('ongoing');
    expect(unblockedCount).toBe(1);

    const lethalBoss = leakW.enemySystem.spawnEnemy('boss', 1, false, 0)!;
    lethalBoss.dist = lethalBoss.totalDist + 0.1;
    leakW.fixedTick(BALANCE.fixedDt);
    expect(leakW.lives).toBe(0);
    expect(leakW.outcome).toBe('lost');
    expect(zeroLifeOutcomes).toEqual(['lost']);

    // 3. SoldierSystem Step-7 mid-counterattack sellTower across 2 newly-blocked enemies emits 1-to-1 block/unblock (no ghost block on foe B).
    const s7Events = new EventBus();
    const s7Log: string[] = [];
    const s7W = new SimWorld(LEVEL_L1C, s7Events, { seed: 103 });
    s7W.gold = 99999;
    const barPlot = Array.from({ length: s7W.grid.plotCount }, (_, p) => p).find((p) =>
      s7W.canPlaceTowerAt(p, 0, 'barracks'),
    )!;
    const bar = s7W.placeTowerOnPlot(barPlot, 'barracks')!;
    s7W.startNextWave();
    const bs = s7W.soldierSystem.getBarracks(bar.id)!;
    for (const s of bs.squad) {
      s.x = s.prevX = bs.rallyX;
      s.z = s.prevZ = bs.rallyZ;
    }
    const gA = s7W.enemySystem.spawnEnemy('grunt', 20, false, 0)!;
    const gB = s7W.enemySystem.spawnEnemy('grunt', 20, false, 0)!;
    const rallyDist = s7W.groundPath.nearestDist(bs.rallyX, bs.rallyZ);
    gA.dist = rallyDist;
    gB.dist = Math.max(0, rallyDist - 0.15);
    gA.x = gA.prevX = bs.rallyX;
    gA.z = gA.prevZ = bs.rallyZ;
    gB.x = gB.prevX = bs.rallyX + 0.15;
    gB.z = gB.prevZ = bs.rallyZ;
    gA.meleeTimer = 0.001; // swings immediately in Step 7!
    gB.meleeTimer = 5;
    s7W.spatialHash.clear();
    s7W.spatialHash.insert(gA.poolIndex, gA.x, gA.z);
    s7W.spatialHash.insert(gB.poolIndex, gB.x, gB.z);
    s7Events.on('enemyBlocked', (ev) => s7Log.push(`B:${ev.enemyId}`));
    s7Events.on('enemyUnblocked', (ev) => s7Log.push(`U:${ev.enemyId}`));
    s7Events.on('soldierHurt', () => {
      if (s7W.getTowerById(bar.id)) s7W.sellTower(bar.id);
    });
    // Tick 1: both squad soldiers claim gA & gB, step into fighting, gA blocks -> counter-swings -> sells barracks!
    // gB was also in _blockedList[1], and MUST NOT emit a ghost B:gB or orphan U:gB!
    s7W.soldierSystem.update(BALANCE.fixedDt, s7W.towers, 1);
    expect(s7Log).toEqual([`B:${gA.uid}`, `U:${gA.uid}`]);

    // 4. ProjectileSystem sets isBossHit = true when hitting flying boss Tempest (direct, splash, and pierce).
    const tempestImpacts: boolean[] = [];
    const tEvents = new EventBus();
    tEvents.on('projectileImpact', (ev) => tempestImpacts.push(ev.isBossHit));
    const tW = new SimWorld(LEVEL_L1C, tEvents, { seed: 104 });
    tW.gold = 99999;
    const arch = tW.placeTowerOnPlot(0, 'archer')!;
    const frost = tW.placeTowerOnPlot(1, 'frost')!;
    const bal = tW.placeTowerOnPlot(2, 'ballista')!;
    tW.upgradeTower(bal.id);
    tW.upgradeTower(bal.id);
    tW.startNextWave();
    const flyer = tW.enemySystem.spawnEnemy('flyer', 5, false, 0)!;
    const tempest = tW.enemySystem.spawnEnemy('tempest', 5, false, 0)!;
    flyer.x = bal.x + 2.0;
    flyer.z = bal.z;
    tempest.x = bal.x + 3.5;
    tempest.z = bal.z;
    tW.spatialHash.clear();
    tW.spatialHash.insert(flyer.poolIndex, flyer.x, flyer.z);
    tW.spatialHash.insert(tempest.poolIndex, tempest.x, tempest.z);

    const pDirect = tW.projectileSystem.spawnProjectile(arch, tempest, 1)!;
    pDirect.progress = 1;
    const pSplash = tW.projectileSystem.spawnProjectile(frost, tempest, 0.7)!;
    pSplash.progress = 1;
    const pPierce = tW.projectileSystem.spawnProjectile(bal, flyer, 1)!;
    pPierce.progress = 1;
    tW.projectileSystem.update(BALANCE.fixedDt, tW.towers);
    expect(tempestImpacts).toEqual([true, true, true]);

    // 5. SpatialHashGrid rejects NaN, float, and duplicate entityIdx without forming infinite cycles; ObjectPool ignores NaN/float activePos.
    tW.spatialHash.clear();
    tW.spatialHash.insert(NaN, 0, 0);
    tW.spatialHash.insert(1.5, 0, 0);
    tW.spatialHash.insert(0, 1, 1);
    tW.spatialHash.insert(0, 1, 1); // duplicate insert without clear() must NOT create self-loop!
    const qOut: number[] = [];
    tW.spatialHash.query(1, 1, 2, qOut);
    expect(qOut).toEqual([0]);
    const countBefore = tW.enemyPool.getActiveCount();
    tW.enemyPool.releaseAtActivePos(NaN);
    tW.enemyPool.releaseAtActivePos(0.5);
    expect(tW.enemyPool.getActiveCount()).toBe(countBefore);

    // 6. SimReplayPlayer survives re-entrant reset() / seekToTick() inside EventBus listeners without skipping tick-0 commands.
    const recW = new SimWorld(LEVEL_L1C, new EventBus(), { seed: 105, recordCommands: true });
    recW.placeTowerOnPlot(0, 'archer');
    recW.placeTowerOnPlot(1, 'frost');
    recW.startNextWave();
    for (let i = 0; i < 20; i++) recW.fixedTick(BALANCE.fixedDt);
    const rLog = parseSimReplay(serializeSimReplay(recW.exportReplay()))!;
    const rEvents = new EventBus();
    const rPlayer = new SimReplayPlayer(LEVEL_L1C, rLog, rEvents);
    let resetTriggered = false;
    rEvents.on('waveStarted', () => {
      if (!resetTriggered) {
        resetTriggered = true;
        rPlayer.reset(false);
      }
    });
    rPlayer.reset(true);
    expect(resetTriggered).toBe(true);
    expect(rPlayer.currentTick).toBe(0);
    expect(rPlayer.appliedCommands).toBe(3);
    expect(rPlayer.world.towers).toHaveLength(2);
    rPlayer.dispose();
  });

  it('emits 1-to-1 enemyUnblocked on mid-wave debugForceWin/debugSkipToWave and mid-step combat resets, keeps dispose silent, and hashes sub-tick timers', () => {
    // 1. Mid-wave debugForceWin() and debugSkipToWave() emit enemyUnblocked before clearing enemyPool,
    //    while dispose() tears down held enemies silently without emitting enemyUnblocked.
    const mwEvents = new EventBus();
    const mwLog: string[] = [];
    mwEvents.on('enemyBlocked', (ev) => mwLog.push(`B:${ev.enemyId}`));
    mwEvents.on('enemyUnblocked', (ev) => mwLog.push(`U:${ev.enemyId}`));
    const mwWorld = new SimWorld(LEVEL_L1C, mwEvents, { heroId: 'bran', heroLevel: 10, seed: 201 });
    mwWorld.gold = 9000;
    const bar = mwWorld.placeTowerOnPlot(21, 'barracks')!;
    mwWorld.startNextWave();
    const bState = mwWorld.soldierSystem.getBarracks(bar.id)!;
    mwWorld.hero!.x = mwWorld.hero!.postX = bState.rallyX;
    mwWorld.hero!.z = mwWorld.hero!.postZ = bState.rallyZ;
    for (const s of bState.squad) {
      s.x = s.prevX = bState.rallyX;
      s.z = s.prevZ = bState.rallyZ;
    }
    const g1 = mwWorld.enemySystem.spawnEnemy('brute', 15, false, 0)!;
    const uid1 = g1.uid;
    g1.x = g1.prevX = bState.rallyX;
    g1.z = g1.prevZ = bState.rallyZ;
    mwWorld.spatialHash.clear();
    mwWorld.spatialHash.insert(g1.poolIndex, g1.x, g1.z);
    mwWorld.soldierSystem.update(BALANCE.fixedDt, mwWorld.towers, 1);
    mwWorld.heroSystem.update(BALANCE.fixedDt, mwWorld.towers, 1);
    expect(mwLog).toEqual([`B:${uid1}`]);
    mwWorld.debugSkipToWave(2);
    expect(mwLog).toEqual([`B:${uid1}`, `U:${uid1}`]);

    // Block a second foe and call debugForceWin() mid-wave -> emits U:uid2 exactly once before clearing pool!
    const g2 = mwWorld.enemySystem.spawnEnemy('brute', 15, false, 0)!;
    const uid2 = g2.uid;
    g2.x = g2.prevX = bState.rallyX;
    g2.z = g2.prevZ = bState.rallyZ;
    for (const s of bState.squad) {
      s.x = s.prevX = bState.rallyX;
      s.z = s.prevZ = bState.rallyZ;
    }
    mwWorld.spatialHash.clear();
    mwWorld.spatialHash.insert(g2.poolIndex, g2.x, g2.z);
    mwWorld.soldierSystem.update(BALANCE.fixedDt, mwWorld.towers, 1);
    mwWorld.heroSystem.update(BALANCE.fixedDt, mwWorld.towers, 1);
    expect(mwLog).toEqual([`B:${uid1}`, `U:${uid1}`, `B:${uid2}`]);
    mwWorld.debugForceWin();
    expect(mwLog).toEqual([`B:${uid1}`, `U:${uid1}`, `B:${uid2}`, `U:${uid2}`]);

    // Enter endless, block g3, and call dispose() -> tears down silently with zero extra unblock events!
    mwWorld.enterEndlessMode();
    mwWorld.startNextWave();
    const g3 = mwWorld.enemySystem.spawnEnemy('brute', 15, false, 0)!;
    const uid3 = g3.uid;
    g3.x = g3.prevX = bState.rallyX;
    g3.z = g3.prevZ = bState.rallyZ;
    for (const s of bState.squad) {
      s.x = s.prevX = bState.rallyX;
      s.z = s.prevZ = bState.rallyZ;
    }
    mwWorld.spatialHash.clear();
    mwWorld.spatialHash.insert(g3.poolIndex, g3.x, g3.z);
    mwWorld.soldierSystem.update(BALANCE.fixedDt, mwWorld.towers, 1);
    expect(mwLog).toEqual([`B:${uid1}`, `U:${uid1}`, `B:${uid2}`, `U:${uid2}`, `B:${uid3}`]);
    mwWorld.dispose();
    expect(mwLog).toHaveLength(5);

    // 2. Mid-'soldierAttack' co-hold: commandHeroMove does NOT emit premature enemyUnblocked while soldier still holds,
    //    and debugForceLose() inside 'soldierAttack' emits 1-to-1 enemyUnblocked and aborts remaining step cleanly.
    const coEvents = new EventBus();
    const coLog: string[] = [];
    coEvents.on('enemyBlocked', (ev) => coLog.push(`B:${ev.enemyId}`));
    coEvents.on('enemyUnblocked', (ev) => coLog.push(`U:${ev.enemyId}`));
    const coWorld = new SimWorld(LEVEL_L1C, coEvents, { heroId: 'bran', heroLevel: 10, seed: 202 });
    coWorld.gold = 9000;
    const coBar = coWorld.placeTowerOnPlot(21, 'barracks')!;
    coWorld.startNextWave();
    const coBState = coWorld.soldierSystem.getBarracks(coBar.id)!;
    const roadStart = coWorld.groundPath.points[0];
    coWorld.hero!.x = coWorld.hero!.postX = coBState.rallyX;
    coWorld.hero!.z = coWorld.hero!.postZ = coBState.rallyZ;
    for (const s of coBState.squad) {
      s.x = s.prevX = coBState.rallyX;
      s.z = s.prevZ = coBState.rallyZ;
    }
    const coFoe = coWorld.enemySystem.spawnEnemy('brute', 30, false, 0)!;
    coFoe.dist = coWorld.groundPath.nearestDist(coBState.rallyX, coBState.rallyZ);
    coFoe.x = coFoe.prevX = coBState.rallyX;
    coFoe.z = coFoe.prevZ = coBState.rallyZ;
    coWorld.spatialHash.clear();
    coWorld.spatialHash.insert(coFoe.poolIndex, coFoe.x, coFoe.z);
    coWorld.soldierSystem.update(BALANCE.fixedDt, coWorld.towers, 1);
    coWorld.heroSystem.update(BALANCE.fixedDt, coWorld.towers, 1);
    expect(coFoe.blockers).toBeGreaterThan(0);
    expect(coFoe.heroBlockers).toBeGreaterThan(0);
    expect(coLog).toEqual([`B:${coFoe.uid}`]);

    // Force soldier 0 to swing on the next tick; first swing moves Bran away, second swing forces defeat.
    let swingPhase = 0;
    coEvents.on('soldierAttack', () => {
      swingPhase++;
      if (swingPhase === 1) {
        coWorld.commandHeroMove(roadStart.x, roadStart.z);
      } else if (swingPhase === 2) {
        coWorld.debugForceLose();
      }
    });
    coBState.squad[0].attackTimer = 0.001;
    coWorld.soldierSystem.update(BALANCE.fixedDt, coWorld.towers, 1);
    // Soldier still holds coFoe after Bran moved away -> NO premature U:coFoe!
    expect(coLog).toEqual([`B:${coFoe.uid}`]);
    expect(coFoe.blockers).toBeGreaterThan(0);

    coBState.squad[0].attackTimer = 0.001;
    coWorld.soldierSystem.update(BALANCE.fixedDt, coWorld.towers, 1);
    expect(coWorld.outcome).toBe('lost');
    expect(coFoe.blockers).toBe(0);
    expect(coLog).toEqual([`B:${coFoe.uid}`, `U:${coFoe.uid}`]);

    // 3. computeSimStateHash captures sub-tick hero waypoints and soldier attackTimer differences.
    const hashA = new SimWorld(LEVEL_L1C, new EventBus(), { heroId: 'sela', heroLevel: 5, seed: 203 });
    const hashB = new SimWorld(LEVEL_L1C, new EventBus(), { heroId: 'sela', heroLevel: 5, seed: 203 });
    expect(computeSimStateHash(hashA)).toBe(computeSimStateHash(hashB));
    hashA.hero!.waypoints.push({ x: 1.5, z: -2.0 });
    expect(computeSimStateHash(hashA)).not.toBe(computeSimStateHash(hashB));
    hashB.hero!.waypoints.push({ x: 1.5, z: -2.0 });
    expect(computeSimStateHash(hashA)).toBe(computeSimStateHash(hashB));
  });
});
