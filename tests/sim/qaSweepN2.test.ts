import { describe, expect, it } from 'vitest';
import { hashWorldState } from '../../qa/bot/hash.ts';
import { runMidProgressSaveSweep } from '../../qa/bot/saveSweep.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { CHAPTER_ENEMY_TYPES, type ChapterEnemyType } from '../../src/data/enemies.ts';
import { defaultSkillsForLevel, HERO_IDS, HERO_RULES } from '../../src/data/heroes.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import { getLevelById, LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { maxedWorkshopRanks } from '../../src/data/workshop.ts';
import { describeMergeGain, mergeProgress } from '../../src/platform/saveCode.ts';
import { createDefaultProgress, hasAnyProgress, migrateProgress } from '../../src/platform/storage.ts';
import { composeRunModifiers2D } from '../../src/render2d/ui/modes2d.ts';
import {
  loadProgress2D,
  PROGRESS_2D_IMPORT_BACKUP_KEY,
  PROGRESS_2D_KEY,
  recordWin2D,
  importSaveCode2D,
  encodeSaveCode2D,
} from '../../src/render2d/ui/progress2d.ts';
import {
  applyRunCommand,
  ReplayCursor,
  RunRecorder,
  runFingerprint,
  sameFingerprint,
  type RunCommand,
} from '../../src/render2d/ui/replay2d.ts';
import {
  buildEndlessWaveDef,
  ENDLESS_CHAPTER2_SPOTLIGHTS,
  ENDLESS_SPOTLIGHTS,
  hasChapterTwoEnemies,
} from '../../src/sim/waveSystem.ts';
import { parseSimReplay, serializeSimReplay, SimReplayPlayer, SimWorld } from '../../src/sim/world.ts';

const DT = BALANCE.fixedDt;

describe('Overnight N2 QA Sweep: Difficulty × 25 Islands, Rally Respawn, Replays & Ch2 Endless', () => {
  it('verifies getFallbackRespawnPoint() and rally-point retreat across all 25 2D islands (including i17-i24)', () => {
    for (const level of LEVELS_2D) {
      const world = new SimWorld(level, new EventBus(), {
        heroId: 'bran',
        heroLevel: 10,
        modifiers: composeRunModifiers2D({}, [], 'hard'),
      });
      const fb = world.heroSystem.getFallbackRespawnPoint();
      const clamp = world.heroSystem.groundGraph.clampToGround(fb.x, fb.z, Infinity);
      const offRoad = Math.hypot(fb.x - clamp.roadX, fb.z - clamp.roadZ);
      expect(offRoad, `${level.id} fallback offRoad`).toBeLessThanOrEqual(HERO_RULES.maxOffRoadDist + 0.08);

      const mainPath = world.groundPath;
      const goalPt = { x: 0, y: 0, z: 0 };
      mainPath.sample(mainPath.totalLength, goalPt);
      const minClearance = Math.min(HERO_RULES.respawnCastleClearance, mainPath.totalLength * 0.35);
      // Arc distance before the castle goal must respect clearance on lane 0.
      const dOnMain = mainPath.nearestDist(fb.x, fb.z);
      expect(mainPath.totalLength - dOnMain, `${level.id} castle clearance`).toBeGreaterThanOrEqual(
        minClearance - 0.1,
      );

      // Command rally near mid-road, place a ground Kilnback directly on top of rally point, and verify safe retreat.
      const midPt = { x: 0, y: 0, z: 0 };
      mainPath.sample(mainPath.totalLength * 0.45, midPt);
      expect(world.commandHeroMove(midPt.x, midPt.z)).toBe(true);
      const rx = world.hero!.rallyX;
      const rz = world.hero!.rallyZ;

      const blocker = world.enemySystem.spawnEnemy('kilnback', 2, true, 0)!;
      blocker.x = blocker.prevX = rx;
      blocker.z = blocker.prevZ = rz;

      const resolved = world.heroSystem.resolveRespawnPoint();
      const rClamp = world.heroSystem.groundGraph.clampToGround(resolved.x, resolved.z, Infinity);
      expect(Math.hypot(resolved.x - rClamp.roadX, resolved.z - rClamp.roadZ)).toBeLessThanOrEqual(
        HERO_RULES.maxOffRoadDist + 0.08,
      );
      expect(Math.hypot(resolved.x - rx, resolved.z - rz)).toBeGreaterThan(0.3);
      expect(Math.hypot(resolved.x - rx, resolved.z - rz)).toBeLessThanOrEqual(
        HERO_RULES.respawnRetreatRadius + 0.05,
      );
      world.dispose();
    }
  });

  it('spawns all 4 chapter-two foes in Chapter 2 Endless waves while keeping 3D and Chapter 1 Endless unchanged and within pool cap', () => {
    for (const lvl of LEVELS) {
      expect(hasChapterTwoEnemies(lvl)).toBe(false);
    }
    for (const lvl of LEVELS_2D.slice(0, 17)) {
      expect(hasChapterTwoEnemies(lvl), lvl.id).toBe(false);
    }
    for (const lvl of LEVELS_2D.slice(17)) {
      expect(hasChapterTwoEnemies(lvl), lvl.id).toBe(true);
    }

    // Chapter 1 i16 endless wave 0 still uses ENDLESS_SPOTLIGHTS[0] ('warden', 'golem')
    const i16 = getLevelById('i16')!;
    const i16Endless0 = buildEndlessWaveDef(i16.waves.length, i16);
    const i16Types = new Set(i16Endless0.groups.map((g) => g.enemyType));
    for (const t of ENDLESS_SPOTLIGHTS[0]) expect(i16Types.has(t)).toBe(true);
    for (const ch2 of CHAPTER_ENEMY_TYPES) expect(i16Types.has(ch2)).toBe(false);

    // Chapter 2 i17..i24 cycle all 4 chapter-two enemies across ENDLESS_CHAPTER2_SPOTLIGHTS
    const i24 = getLevelById('i24')!;
    const seenCh2 = new Set<ChapterEnemyType>();
    for (let offset = 0; offset < ENDLESS_CHAPTER2_SPOTLIGHTS.length; offset++) {
      const def = buildEndlessWaveDef(i24.waves.length + offset, i24);
      for (const g of def.groups) {
        if ((CHAPTER_ENEMY_TYPES as readonly string[]).includes(g.enemyType)) {
          seenCh2.add(g.enemyType as ChapterEnemyType);
        }
      }
    }
    expect([...seenCh2].sort()).toEqual([...CHAPTER_ENEMY_TYPES].sort());

    // Pool capacity invariant across all 25 2D islands up to endless offset 200
    const extra: Record<string, number> = { splitter: 2, boss: 2, carrier: 2, tempest: 6 };
    for (const level of LEVELS_2D) {
      for (const offset of [0, 3, 4, 9, 19, 49, 99, 199]) {
        let worst = 0;
        const def = buildEndlessWaveDef(level.waves.length + offset, level);
        for (const g of def.groups) {
          expect(g.count).toBeGreaterThan(0);
          expect(g.spawnInterval).toBeGreaterThanOrEqual(0.18);
          worst += g.count * (1 + (extra[g.enemyType] ?? 0));
        }
        expect(worst, `${level.id} +${offset}`).toBeLessThanOrEqual(BALANCE.pools.maxEnemies);
      }
    }
  });

  it('maintains bit-exact replay determinism across Easy, Normal, and Hard with heroes, abilities, and Chapter 2 foes on i24', () => {
    const level = getLevelById('i24')!;
    const wsMax = maxedWorkshopRanks();

    for (const [idx, diff] of (['easy', 'normal', 'hard'] as const).entries()) {
      const heroId = HERO_IDS[(idx * 2) % HERO_IDS.length];
      const skills = defaultSkillsForLevel(heroId, 20);
      const mods = composeRunModifiers2D(wsMax, diff === 'hard' ? ['ironTide'] : [], diff);
      const seed = 9001 + idx * 137;

      const makeWorld = (recordCommands: boolean): SimWorld =>
        new SimWorld(level, new EventBus(), mods, {
          heroId,
          heroLevel: 20,
          heroSkills: skills,
          seed,
          recordCommands,
        });

      const live = makeWorld(true);
      const recorder = new RunRecorder(level.id);
      const runCmd = (tick: number, c: RunCommand): void => {
        if (applyRunCommand(live, c)) recorder.push(tick, c);
      };

      const path0 = level.layout2d!.paths[0];
      let tick = 0;
      for (; tick < 60 * 38 && live.outcome === 'ongoing'; tick++) {
        if (tick === 0) {
          runCmd(tick, { k: 'build', plot: 0, type: 'archer' });
          runCmd(tick, { k: 'build', plot: 1, type: 'barracks' });
          runCmd(tick, { k: 'heroMove', x: path0[1].x, z: path0[1].z });
          runCmd(tick, { k: 'wave' });
        }
        if (tick === 240 && live.towers.length > 0) {
          runCmd(tick, { k: 'upgrade', id: live.towers[0].id });
        }
        if (tick === 420) {
          runCmd(tick, { k: 'meteor', x: path0[1].x, z: path0[1].z });
          runCmd(tick, { k: 'overcharge' });
        }
        if (tick === 600 && live.hero) {
          runCmd(tick, { k: 'heroSkill', slot: 0, x: live.hero.x, z: live.hero.z });
          runCmd(tick, { k: 'heroSkill', slot: 1, x: live.hero.x, z: live.hero.z });
        }
        if (tick === 900 && live.waveSystem.canStartNextWave()) {
          runCmd(tick, { k: 'wave' });
        }
        live.fixedTick(DT);
      }

      const expectedHash = hashWorldState(live);
      const uiReplay = recorder.finish(live, tick);
      const simLog = parseSimReplay(serializeSimReplay(live.exportReplay()))!;
      expect(simLog).not.toBeNull();

      // 1. SimReplayPlayer (with forward + backward timeline seeks) reproduces exact stateHash
      const player = new SimReplayPlayer(level, simLog);
      player.seekToTick(Math.floor(tick * 0.6));
      player.seekToTick(Math.floor(tick * 0.25));
      const check = player.runToEnd();
      expect(check.matchesOutcome, `${diff} SimReplayPlayer outcome`).toBe(true);
      expect(check.matchesHash, `${diff} SimReplayPlayer hash`).toBe(true);
      expect(hashWorldState(player.world), `${diff} SimReplayPlayer full hash`).toBe(expectedHash);
      player.dispose();

      // 2. 2D UI ReplayCursor (replay2d.ts) reproduces exact fingerprint & 64-bit stateHash
      const uiWorld = makeWorld(false);
      const cursor = new ReplayCursor(uiReplay);
      for (let t = 0; t < uiReplay.endTick && uiWorld.outcome === 'ongoing'; t++) {
        cursor.applyDue(uiWorld, t);
        uiWorld.fixedTick(DT);
      }
      expect(sameFingerprint(runFingerprint(uiWorld, uiReplay.endTick), uiReplay.end)).toBe(true);
      expect(hashWorldState(uiWorld), `${diff} ReplayCursor full hash`).toBe(expectedHash);

      uiWorld.dispose();
      live.dispose();
    }
  });

  it('passes the full mid-progress campaign save/load/remap/cloud sweep and difficulty consistency guards', async () => {
    const violations = await runMidProgressSaveSweep();
    expect(violations).toEqual([]);

    // Corrupted partial save where bestStars was truncated/lost while difficultyWins survived:
    const recovered = migrateProgress(
      {
        version: 2,
        unlockedLevelIndex: 0,
        bestStars: [],
        clears: [],
        difficultyWins: { easy: [1, 0, 0], normal: [0, 2, 0], hard: [0, 0, 3] },
      },
      4,
    );
    expect(recovered.bestStars).toEqual([1, 2, 3, 0]);
    expect(recovered.clears).toEqual([1, 1, 1, 0]);
    expect(recovered.unlockedLevelIndex).toBe(3);
    expect(hasAnyProgress(recovered)).toBe(true);

    // describeMergeGain reports newly earned Hard ribbons even when campaign star totals stay equal
    const normSave = createDefaultProgress(4);
    normSave.bestStars = [3, 3, 0, 0];
    normSave.clears = [1, 1, 0, 0];
    const hardSave = createDefaultProgress(4);
    hardSave.bestStars = [2, 2, 0, 0];
    hardSave.clears = [1, 1, 0, 0];
    hardSave.difficultyWins = { easy: [0, 0, 0, 0], normal: [0, 0, 0, 0], hard: [2, 2, 0, 0] };
    const merged = mergeProgress(normSave, hardSave, 4);
    expect(describeMergeGain(normSave, merged)).toContain('+2 Hard ribbons');

    // recordWin2D honors difficulty ('easy' caps stars at 1 and skips badges/bestLives; 'hard' records ribbon)
    const store = new Map<string, string>();
    const prevLs = globalThis.localStorage;
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    };
    try {
      recordWin2D('l1c', 3, 25, LEVELS_2D, ['bowless'], 'easy');
      let p2d = loadProgress2D(LEVELS_2D);
      expect(p2d.bestStars[0]).toBe(1);
      expect(p2d.bestLives[0]).toBe(0);
      expect(p2d.challengeClears[0]).toEqual([]);
      expect(p2d.difficultyWins?.easy[0]).toBe(1);

      recordWin2D('l1c', 2, 15, LEVELS_2D, ['bowless'], 'hard');
      p2d = loadProgress2D(LEVELS_2D);
      expect(p2d.bestStars[0]).toBe(2);
      expect(p2d.bestLives[0]).toBe(15);
      expect(p2d.challengeClears[0]).toEqual(['bowless']);
      expect(p2d.difficultyWins?.hard[0]).toBe(2);

      // Importing onto an empty save must not overwrite an existing real import backup
      const realBackup = store.get(PROGRESS_2D_KEY)!;
      store.set(PROGRESS_2D_IMPORT_BACKUP_KEY, realBackup);
      store.set(PROGRESS_2D_KEY, JSON.stringify({ ids: LEVELS_2D.map((l) => l.id), progress: createDefaultProgress(LEVELS_2D.length) }));
      const code = encodeSaveCode2D(p2d, LEVELS_2D);
      const imp = importSaveCode2D(code, LEVELS_2D);
      expect(imp.ok).toBe(true);
      expect(store.get(PROGRESS_2D_IMPORT_BACKUP_KEY)).toBe(realBackup);
    } finally {
      (globalThis as unknown as { localStorage: Storage }).localStorage = prevLs;
    }
  });

  it('isolates per-SimWorld scratch buffers when a second SimWorld steps/disposes inside EventBus listeners, and guards Mira slot-0/slot-1 fireRing re-entrancy', async () => {
    const { InvariantMonitor } = await import('../../qa/bot/invariants.ts');
    const { defaultLevel20Skills } = await import('../../src/data/heroes.ts');
    const level = getLevelById('i10')!;

    const runScenario = (reentrantAuxWorld: boolean): { hash: string; violations: number } => {
      const bus = new EventBus();
      const w = new SimWorld(level, bus, {
        heroId: 'bran',
        heroLevel: 20,
        heroSkills: defaultLevel20Skills('bran'),
        seed: 77711,
      });
      const monitor = new InvariantMonitor(w, bus);
      w.gold = 2500;
      w.placeTowerOnPlot(0, 'barracks');
      w.placeTowerOnPlot(1, 'archer');
      w.upgradeTower(1);
      w.upgradeTower(1);
      const mid = level.layout2d!.paths[0][Math.floor(level.layout2d!.paths[0].length / 2)];
      w.commandHeroMove(mid[0], mid[1]);

      if (reentrantAuxWorld) {
        const disturb = (): void => {
          const auxBus = new EventBus();
          const aux = new SimWorld(level, auxBus, {
            heroId: 'bran',
            heroLevel: 20,
            heroSkills: defaultLevel20Skills('bran'),
            seed: 99999,
          });
          aux.gold = 1000;
          aux.placeTowerOnPlot(0, 'barracks');
          aux.startNextWave();
          for (let k = 0; k < 4; k++) aux.fixedTick(DT);
          aux.castAbility('meteor', mid[0], mid[1]);
          aux.dispose();
        };
        bus.on('enemyBlocked', disturb);
        bus.on('soldierAttack', disturb);
        bus.on('heroHit', disturb);
        bus.on('meteorImpact', disturb);
      }

      w.startNextWave();
      for (let t = 1; t <= 420 && w.outcome === 'ongoing'; t++) {
        if (t === 90) w.castAbility('meteor', mid[0], mid[1]);
        if (t === 140) w.castHeroSkill(0);
        if (t === 160) w.castHeroSkill(1);
        monitor.beginTick(t);
        w.fixedTick(DT);
        monitor.endTick(t, DT);
      }
      const hash = hashWorldState(w);
      w.dispose();
      return { hash, violations: monitor.violations.length };
    };

    const ref = runScenario(false);
    const isolated = runScenario(true);
    expect(ref.violations).toBe(0);
    expect(isolated.violations).toBe(0);
    expect(isolated.hash).toBe(ref.hash);

    // Same-world slot-0 fireRing -> enemyHit listener -> slot-1 wispBurst (wispFireRing capstone) re-entrancy:
    const miraBus = new EventBus();
    const miraWorld = new SimWorld(level, miraBus, {
      heroId: 'mira',
      heroLevel: 20,
      heroSkills: defaultLevel20Skills('mira'),
      seed: 4242,
    });
    const e1 = miraWorld.enemySystem.spawnEnemy('brute', 5, false, 0)!;
    const e2 = miraWorld.enemySystem.spawnEnemy('brute', 5, false, 0)!;
    const hx = miraWorld.hero!.x;
    const hz = miraWorld.hero!.z;
    e1.x = hx + 0.4;
    e1.z = hz;
    e2.x = hx - 0.4;
    e2.z = hz;
    miraWorld.spatialHash.clear();
    miraWorld.spatialHash.insert(e1.poolIndex, e1.x, e1.z);
    miraWorld.spatialHash.insert(e2.poolIndex, e2.x, e2.z);

    let wispTriggered = false;
    miraBus.on('enemyHit', () => {
      if (!wispTriggered) {
        wispTriggered = true;
        // Casts wispBurst (with wispFireRing) at a distant point while slot-0 spawnFireRing is mid-loop!
        miraWorld.castHeroSkill(1, hx, hz + 3.0);
      }
    });
    const hp1Before = e1.hp;
    const hp2Before = e2.hp;
    expect(miraWorld.castHeroSkill(0, hx, hz)).toBe(true);
    expect(wispTriggered).toBe(true);
    expect(e1.hp).toBeLessThan(hp1Before);
    expect(e2.hp).toBeLessThan(hp2Before);
    expect(miraWorld.heroSystem.fireRings.length).toBe(2);
    miraWorld.dispose();

    // Cross-world onCommandRecorded re-entrancy during Wren huntersMark & Tobb overhaul target selection:
    const wrenA = new SimWorld(level, new EventBus(), {
      heroId: 'wren',
      heroLevel: 20,
      heroSkills: defaultLevel20Skills('wren'),
      seed: 101,
      recordCommands: true,
    });
    const wrenB = new SimWorld(level, new EventBus(), {
      heroId: 'wren',
      heroLevel: 20,
      heroSkills: defaultLevel20Skills('wren'),
      seed: 202,
    });
    const fa = wrenA.enemySystem.spawnEnemy('brute', 3, false, 0)!;
    fa.x = wrenA.hero!.x + 0.5;
    fa.z = wrenA.hero!.z;
    wrenA.spatialHash.clear();
    wrenA.spatialHash.insert(fa.poolIndex, fa.x, fa.z);

    const fb = wrenB.enemySystem.spawnEnemy('grunt', 1, false, 0)!;
    fb.x = wrenB.hero!.x + 0.5;
    fb.z = wrenB.hero!.z;
    wrenB.spatialHash.clear();
    wrenB.spatialHash.insert(fb.poolIndex, fb.x, fb.z);

    wrenA.onCommandRecorded = () => {
      // Casts huntersMark on wrenB mid-execution of wrenA.castHeroSkill(1) (right inside commitSkillCooldown)!
      wrenB.castHeroSkill(1, fb.x, fb.z);
    };
    expect(wrenA.castHeroSkill(1, fa.x, fa.z)).toBe(true);
    expect(fa.markTimer).toBeGreaterThan(0);
    expect(fb.markTimer).toBeGreaterThan(0);
    wrenA.dispose();
    wrenB.dispose();

    const tobbA = new SimWorld(level, new EventBus(), {
      heroId: 'tobb',
      heroLevel: 20,
      heroSkills: defaultLevel20Skills('tobb'),
      seed: 303,
      recordCommands: true,
    });
    const tobbB = new SimWorld(level, new EventBus(), {
      heroId: 'tobb',
      heroLevel: 20,
      heroSkills: defaultLevel20Skills('tobb'),
      seed: 404,
    });
    tobbA.gold = 1000;
    tobbB.gold = 1000;
    const twA = tobbA.placeTowerOnPlot(0, 'archer')!;
    const twB = tobbB.placeTowerOnPlot(0, 'cannon')!;
    twA.stunTimer = 3.0;
    tobbA.hero!.x = twA.x;
    tobbA.hero!.z = twA.z;
    tobbB.hero!.x = twB.x;
    tobbB.hero!.z = twB.z;

    tobbA.onCommandRecorded = () => {
      tobbB.castHeroSkill(1, twB.x, twB.z);
    };
    expect(tobbA.castHeroSkill(1, twA.x, twA.z)).toBe(true);
    expect(twA.stunTimer).toBe(0);
    expect(twA.overhaulTimer ?? 0).toBeGreaterThan(0);
    expect(twB.overhaulTimer ?? 0).toBeGreaterThan(0);
    tobbA.dispose();
    tobbB.dispose();
  });
});
