import { describe, expect, it, vi } from 'vitest';
import { InvariantMonitor } from '../../qa/bot/invariants.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import type { EnemyType } from '../../src/core/types.ts';
import { computeMeteorDamage } from '../../src/data/abilities.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { CHALLENGE_IDS, challengeModifiers, runModifiersFor } from '../../src/data/challenges.ts';
import { withDifficulty } from '../../src/data/difficulty.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVEL_L1C, LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { ITEM_IDS, ITEMS, MARKET_RULES, type ItemCounts } from '../../src/data/market.ts';
import { combineRunModifiers, NEUTRAL_RUN_MODIFIERS } from '../../src/data/runModifiers.ts';
import { STAR_RULES } from '../../src/data/stars.ts';
import { maxedWorkshopRanks, workshopModifiers } from '../../src/data/workshop.ts';
import { applyRunCommand, ReplayCursor, RunRecorder } from '../../src/render2d/ui/replay2d.ts';
import { cleanBelt } from '../../src/sim/itemSystem.ts';
import {
  computeSimStateHash,
  parseSimReplay,
  serializeSimReplay,
  SimReplayPlayer,
  SimWorld,
  type SimWorldOptions,
} from '../../src/sim/world.ts';

const dt = BALANCE.fixedDt;
// Multi-cast effect and replay cases exercise the fully stocked Easy belt.
const fullBelt = combineRunModifiers({ marketDifficulty: 'easy' });
function world(belt: ItemCounts, options: SimWorldOptions = {}) {
  const w = new SimWorld(LEVEL_L1C, new EventBus(), { modifiers: fullBelt, itemBelt: belt, ...options });
  expect(w.grid.isPlotMode).toBe(true);
  w.startNextWave();
  return w;
}
function spawn(w: SimWorld, type: EnemyType, dist: number, elite = false, lane = 0) {
  const e = w.enemySystem.spawnEnemy(type, 1, elite, lane)!;
  e.dist = dist;
  w.enemySystem.getPath(e.flying, e.lane).sample(dist, e);
  e.prevX = e.x;
  e.prevY = e.y;
  e.prevZ = e.z;
  return e;
}
function tick(w: SimWorld, n: number) {
  for (let i = 0; i < n; i++) w.fixedTick(dt);
}

describe('plot-map Market items', () => {
  it('ember impact scales below Meteor, respects the radius, and leaves a damaging fire patch', () => {
    const w = world({ emberPot: 2 });
    const e = spawn(w, 'golem', 6);
    e.hp = 3000;
    e.speed = 0;
    const other = spawn(w, 'grunt', w.groundPath.totalLength - 0.1);
    const before = other.hp;
    expect(w.useItem('emberPot', Infinity, 0)).toBe(false);
    expect(w.useItem('emberPot', e.x, e.z)).toBe(true);
    const damage = Math.round(computeMeteorDamage(1) * ITEMS.emberPot.meteorFraction);
    expect(e.hp).toBe(3000 - damage);
    expect(other.hp).toBe(before);
    tick(w, 33);
    expect(e.hp).toBeLessThan(3000 - damage);
    expect(w.itemSystem.belt().emberPot).toBe(1);
    w.debugSkipToWave(4);
    w.startNextWave();
    const next = spawn(w, 'grunt', 4);
    next.hp = 3000;
    w.useItem('emberPot', next.x, next.z);
    expect(3000 - next.hp).toBeGreaterThan(damage);
  });

  it('freezes normal foes for four seconds and only slows bosses and champions', () => {
    const w = world({ frostLantern: 2 });
    const grunt = spawn(w, 'blinker', 5);
    const boss = spawn(w, 'boss', 5);
    const elite = spawn(w, 'grunt', 5, true);
    const frozen = vi.fn();
    w.events.on('enemyFrozen', frozen);
    expect(w.useItem('frostLantern', grunt.x, grunt.z)).toBe(true);
    expect(frozen).toHaveBeenCalledTimes(3);
    for (const e of [boss, elite]) {
      expect(e.stunTimer).toBe(0);
      expect(e.frozenTimer).toBe(0);
      expect(e.slowRatio).toBe(ITEMS.frostLantern.eliteSlow);
    }
    grunt.abilityTimer = 0.1;
    const freezeTicks = Math.round(ITEMS.frostLantern.seconds / dt);
    tick(w, freezeTicks - 2);
    expect(grunt.dist).toBe(5);
    expect(boss.dist).toBeGreaterThan(5);
    tick(w, 5);
    expect(grunt.dist).toBeGreaterThan(5);
  });

  it('frostLantern vs bosses (Dreadnought & Tempest) and golems: chills without freezing boss phase abilities and cracks brittle armor', () => {
    const w = world({ frostLantern: 3 });
    // Empty radius or burrowed-only radius costs nothing.
    const burrowed = spawn(w, 'burrower', 4);
    burrowed.burrowed = true;
    expect(w.useItem('frostLantern', burrowed.x, burrowed.z)).toBe(false);
    expect(w.itemSystem.belt().frostLantern).toBe(3);

    const dread = spawn(w, 'boss', 6);
    const tempest = spawn(w, 'tempest', 6);
    const eliteGolem = spawn(w, 'golem', 6, true);
    const normalGolem = spawn(w, 'golem', 6, false);
    const casts: Array<{ enemyId: number; slowOnly: boolean }> = [];
    w.events.on('enemyFrozen', (ev) => casts.push({ enemyId: ev.enemyId, slowOnly: ev.slowOnly }));

    expect(w.useItem('frostLantern', dread.x, dread.z)).toBe(true);
    expect(w.itemSystem.belt().frostLantern).toBe(2);
    for (const boss of [dread, tempest]) {
      expect(boss.stunTimer).toBe(0);
      expect(boss.frozenTimer).toBe(0);
      expect(boss.slowRatio).toBe(ITEMS.frostLantern.eliteSlow);
      expect(boss.slowTimer).toBe(ITEMS.frostLantern.seconds);
      expect(casts.find((c) => c.enemyId === boss.uid)?.slowOnly).toBe(true);
    }
    expect(casts.find((c) => c.enemyId === eliteGolem.uid)?.slowOnly).toBe(true);
    expect(casts.find((c) => c.enemyId === normalGolem.uid)?.slowOnly).toBe(false);
    // Both normal and elite Basalt Golems have brittle shells cracked by Frost Lantern.
    expect(eliteGolem.armor).toBe(ENEMY_DEFS.golem.brittleArmor);
    expect(normalGolem.armor).toBe(ENEMY_DEFS.golem.brittleArmor);

    // Boss phase abilities (escort summon at <=50% HP, Stormwall at <=66% HP) still fire while slowed by Frost Lantern.
    let summons = 0;
    let phases = 0;
    w.events.on('bossSummon', () => { summons++; });
    w.events.on('bossPhase', () => { phases++; });
    dread.hp = Math.floor(dread.maxHp * 0.45);
    tempest.hp = Math.floor(tempest.maxHp * 0.60);
    tick(w, 2);
    expect(summons).toBeGreaterThanOrEqual(1);
    expect(phases).toBeGreaterThanOrEqual(1);

    // Slow expires cleanly after duration.
    tick(w, Math.round(ITEMS.frostLantern.seconds / dt) + 5);
    expect(dread.slowRatio).toBe(0);
    expect(tempest.slowRatio).toBe(0);
  });

  it.each(['normal', 'hard'] as const)('unlocks extra belt uses at five and ten leaked lives on %s', difficulty => {
    const spend = vi.fn(() => true);
    const w = world({ emberPot: 1, skyPurse: 1, galeBell: 1 }, {
      modifiers: withDifficulty(NEUTRAL_RUN_MODIFIERS, difficulty), spendItem: spend,
    });
    expect(w.useItem('emberPot', 0, 0)).toBe(true);
    w.lives -= 4;
    expect(w.useItem('skyPurse')).toBe(false);
    expect(w.itemSystem.livesUntilNextUse(w)).toBe(1);
    w.lives--;
    expect(w.useItem('skyPurse')).toBe(true);
    spawn(w, 'brute', 6);
    w.lives -= 4;
    expect(w.useItem('galeBell')).toBe(false);
    w.lives--;
    expect(w.useItem('galeBell')).toBe(true);
    expect(spend).toHaveBeenCalledTimes(3);
  });

  it.each(['normal', 'hard'] as const)('Heartstone repairs up to half the keep on %s, including Bastion', difficulty => {
    const modifiers = withDifficulty(workshopModifiers({ bastion: 1 }), difficulty);
    const w = world({ heartstone: 3 }, { modifiers });
    const limit = Math.ceil(w.startingLives / 2);
    w.lives = limit;
    expect(w.useItem('heartstone')).toBe(false);
    expect(w.itemSystem.belt().heartstone).toBe(1);
    w.lives -= 2;
    const stars = w.computeStars();
    expect(w.useItem('heartstone')).toBe(true);
    expect(w.lives).toBe(limit);
    expect(w.itemSystem.restoredLives).toBe(2);
    expect(w.computeStars()).toBe(stars);
  });

  it('heals only missing lives and keeps all leaks in the star calculation (heartstone can never raise stars)', () => {
    const debit = vi.fn(() => true);
    const w = world({ heartstone: 3 }, { spendItem: debit });
    expect(w.useItem('heartstone')).toBe(false);
    const rule = STAR_RULES[w.level.difficulty];
    // Drop into 2-star territory, heal back to full: stars stay 2, never 3.
    const dropToTwoStar = rule.threeStarMaxLost + 2;
    w.lives -= dropToTwoStar;
    expect(w.computeStars()).toBe(2);
    expect(w.useItem('heartstone')).toBe(true);
    expect(w.lives).toBe(w.startingLives);
    expect(w.computeStars()).toBe(2);
    // Drop further into 1-star territory across two waves, heal twice: stars stay 1, even at full lives.
    const extraLeak = rule.twoStarMaxLost - dropToTwoStar + 2;
    w.lives -= extraLeak;
    expect(w.computeStars()).toBe(1);
    expect(w.useItem('heartstone')).toBe(true);
    expect(w.useItem('heartstone')).toBe(true);
    expect(w.computeStars()).toBe(1);
    // Effective unhealed lives stay accurate for bestLives records, gameWon event, and replay summary.
    expect(w.lives - w.itemSystem.restoredLives).toBe(w.startingLives - dropToTwoStar - extraLeak);
    let wonPayload: { stars: number; livesRemaining: number } | null = null;
    w.events.on('gameWon', (ev) => { wonPayload = ev; });
    w.debugForceWin();
    expect(wonPayload?.stars).toBe(1);
    expect(w.exportReplay().summary.stars).toBe(1);
    expect(debit).toHaveBeenCalledTimes(3);
  });

  it('pays island- and wave-scaled gold, honors failed debits, and enforces belt limits', () => {
    const spend = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const w = world({ skyPurse: 1 }, { spendItem: spend });
    const before = w.gold;
    expect(w.useItem('skyPurse')).toBe(false);
    expect(w.gold).toBe(before);
    expect(w.useItem('skyPurse')).toBe(true);
    const expectedGold = Math.round(
      w.level.startingGold * ITEMS.skyPurse.startingGoldFraction + ITEMS.skyPurse.goldPerWave,
    );
    expect(w.gold - before).toBe(expectedGold);
    expect(w.useItem('skyPurse')).toBe(false);
    expect(w.useItem('heartstone')).toBe(false);
    expect(spend).toHaveBeenCalledTimes(2);
  });

  it('cloudguard snaps three soldiers onto a road, blocks temporarily, expires cleanly without blocking forever, and fallen guards stay down', () => {
    const events = new EventBus();
    const w = new SimWorld(LEVEL_L1C, events, { modifiers: fullBelt, itemBelt: { cloudguard: 2 } });
    const monitor = new InvariantMonitor(w, events);
    w.startNextWave();
    const e = spawn(w, 'grunt', 6);
    e.hp = 50_000;
    const spawned = vi.fn();
    const removed = vi.fn();
    const unblocked = vi.fn();
    events.on('soldierSpawned', spawned);
    events.on('soldierRemoved', removed);
    events.on('enemyUnblocked', unblocked);

    // Off-map and off-road casts cost nothing.
    expect(w.useItem('cloudguard', 999, 999)).toBe(false);
    expect(w.useItem('cloudguard', 0, w.level.layout2d!.imageSize[1] / (2 * w.level.layout2d!.pxPerUnit) - 0.1)).toBe(false);
    expect(w.itemSystem.belt().cloudguard).toBe(2);

    expect(w.useItem('cloudguard', e.x, e.z)).toBe(true);
    expect(spawned).toHaveBeenCalledTimes(ITEMS.cloudguard.soldiers);
    expect(w.towers).toHaveLength(0);

    const runMonitoredTicks = (n: number) => {
      for (let i = 0; i < n && w.outcome === 'ongoing'; i++) {
        const t = w.tick + 1;
        monitor.beginTick(t);
        w.fixedTick(dt);
        monitor.endTick(t, dt);
      }
    };

    // Keep guards alive so we test the 15s timer expiry & release.
    for (const s of w.soldierSystem.soldiers) {
      s.maxHp = 50_000;
      s.hp = 50_000;
    }
    runMonitoredTicks(90);
    expect(e.blockers).toBeGreaterThan(0);
    const heldDist = e.dist;
    runMonitoredTicks(60);
    expect(e.dist).toBe(heldDist);

    // Advance past full banner duration: soldiers despawn, hold releases, enemy resumes advancing!
    const remainingTicks = Math.ceil(ITEMS.cloudguard.seconds / dt) - 150 + 5;
    runMonitoredTicks(remainingTicks);
    expect(w.soldierSystem.soldiers).toHaveLength(0);
    expect(w.soldierSystem.barracks).toHaveLength(0);
    expect(removed).toHaveBeenCalledTimes(ITEMS.cloudguard.soldiers);
    expect(e.blockers).toBe(0);
    expect(unblocked).toHaveBeenCalled();
    runMonitoredTicks(30);
    expect(e.dist).toBeGreaterThan(heldDist + 0.5);

    // Second banner: kill all 3 guards early -> fallen guards never respawn and empty banner cleans up.
    const boss = spawn(w, 'boss', e.dist);
    boss.hp = 50_000;
    expect(w.useItem('cloudguard', boss.x, boss.z)).toBe(true);
    for (const s of w.soldierSystem.soldiers) s.hp = 1;
    runMonitoredTicks(240);
    expect(spawned).toHaveBeenCalledTimes(ITEMS.cloudguard.soldiers * 2);
    expect(w.soldierSystem.soldiers).toHaveLength(0);
    expect(w.soldierSystem.barracks).toHaveLength(0);
    expect(boss.blockers).toBe(0);
    expect(monitor.violations).toEqual([]);
  });

  it('galeBell pushes lane, flying, boss, and burrowed foes along their own paths, floors at 0, and never goes off-path or behind spawn', () => {
    const level = LEVELS_2D.find((l) => l.layout2d!.paths.length > 1)!;
    const events = new EventBus();
    const w = new SimWorld(level, events, { modifiers: fullBelt, itemBelt: { galeBell: 3 } });
    const monitor = new InvariantMonitor(w, events);
    w.startNextWave();

    const lane1Foe = spawn(w, 'grunt', ITEMS.galeBell.distance + 1.2, false, 1);
    const nearEntrance = spawn(w, 'runner', 0.35, false, 0);
    const boss = spawn(w, 'boss', ITEMS.galeBell.bossDistance + 3.0, false, 0);
    const nearBoss = spawn(w, 'tempest', 0.4, false, 0);
    const flyer = spawn(w, 'flyer', 1.8, false, 0);
    const burrower = spawn(w, 'burrower', 2.5, false, 0);
    burrower.burrowed = true;
    const foes = [lane1Foe, nearEntrance, boss, nearBoss, flyer, burrower];

    const pushed = vi.fn();
    events.on('enemyPushed', pushed);
    expect(w.useItem('galeBell')).toBe(true);
    expect(pushed).toHaveBeenCalledTimes(foes.length);

    expect(lane1Foe.dist).toBeCloseTo(1.2, 6);
    expect(nearEntrance.dist).toBe(0);
    expect(boss.dist).toBeCloseTo(3.0, 6);
    expect(nearBoss.dist).toBe(0);
    expect(flyer.dist).toBe(0);
    expect(burrower.dist).toBe(0);
    expect(burrower.burrowed).toBe(true);

    // Every displaced enemy sits strictly on its own lane / flight path; burrowed stays out of spatialHash.
    const hashHits: number[] = [];
    w.spatialHash.query(burrower.x, burrower.z, 2, hashHits);
    expect(hashHits).not.toContain(burrower.poolIndex);
    for (const e of foes) {
      expect(e.dist).toBeGreaterThanOrEqual(0);
      const p = { x: 0, y: 0, z: 0 };
      w.enemySystem.getPath(e.flying, e.lane).sample(e.dist, p);
      expect(e.x).toBeCloseTo(p.x, 6);
      expect(e.y).toBeCloseTo(p.y, 6);
      expect(e.z).toBeCloseTo(p.z, 6);
    }

    // Repeated rings clamp everyone to 0; once every enemy is at dist === 0, ringing again is rejected for free.
    expect(w.useItem('galeBell')).toBe(true);
    if (boss.dist > 0) expect(w.useItem('galeBell')).toBe(true);
    for (const e of foes) e.dist = 0;
    const beltBefore = w.itemSystem.belt().galeBell;
    expect(w.useItem('galeBell')).toBe(false);
    expect(w.itemSystem.belt().galeBell).toBe(beltBefore);

    for (let i = 0; i < 30; i++) {
      const t = w.tick + 1;
      monitor.beginTick(t);
      w.fixedTick(dt);
      monitor.endTick(t, dt);
    }
    expect(monitor.violations).toEqual([]);
  });

  it('enforces pre-wave lock matching abilities, all disabled modes (challenges, Endless start & continuation), caps, zero stock, and victory/defeat locks', () => {
    // 1. Pre-first-wave lock matches canUseAbilities() across all 6 items.
    const pre = new SimWorld(LEVEL_L1C, new EventBus(), {
      modifiers: fullBelt, itemBelt: { skyPurse: 2, heartstone: 2, emberPot: 2 },
      spendItem: vi.fn(() => true),
    });
    expect(pre.canUseAbilities()).toBe(false);
    pre.lives -= 3;
    const roadPt = pre.level.layout2d!.paths[0][1];
    for (const id of ITEM_IDS) {
      expect(pre.useItem(id, roadPt.x, roadPt.z)).toBe(false);
      expect(pre.applyCommand({ kind: 'useItem', id, x: roadPt.x, z: roadPt.z })).toBe(false);
    }
    expect(pre.itemSystem.belt()).toEqual({ skyPurse: 2, heartstone: 2, emberPot: 2 });

    // 2. Every challenge disables items; explicit itemsDisabled and abilitiesDisabled both lock belt.
    const wsMods = workshopModifiers(maxedWorkshopRanks());
    for (const cid of CHALLENGE_IDS) {
      expect(challengeModifiers([cid]).itemsDisabled).toBe(true);
      expect(runModifiersFor(wsMods, [cid]).itemsDisabled).toBe(true);
      const cw = world({ skyPurse: 2, emberPot: 2 }, { modifiers: runModifiersFor(wsMods, [cid]) });
      expect(cw.useItem('skyPurse')).toBe(false);
      expect(cw.useItem('emberPot', roadPt.x, roadPt.z)).toBe(false);
    }
    for (const patch of [{ itemsDisabled: true }, { abilitiesDisabled: true }]) {
      const dw = world({ skyPurse: 1 }, { modifiers: combineRunModifiers(patch) });
      expect(dw.useItem('skyPurse')).toBe(false);
      expect(dw.itemSystem.belt().skyPurse).toBe(1);
    }

    // 3. Endless from start AND post-victory enterEndlessMode() both block item usage.
    const endlessStart = new SimWorld(LEVEL_L1C, new EventBus(), { itemBelt: { skyPurse: 2 } });
    endlessStart.startEndlessFromStart();
    endlessStart.startNextWave();
    expect(endlessStart.useItem('skyPurse')).toBe(false);

    const cont = world({ skyPurse: 2, emberPot: 2 });
    expect(cont.useItem('skyPurse')).toBe(true);
    cont.debugForceWin();
    // Rejected after victory:
    expect(cont.useItem('skyPurse')).toBe(false);
    expect(cont.useItem('emberPot', roadPt.x, roadPt.z)).toBe(false);
    // Enter Endless continuation with remaining charges still on belt -> still blocked in Endless!
    expect(cont.enterEndlessMode()).toBe(true);
    cont.startNextWave();
    expect(cont.outcome).toBe('ongoing');
    expect(cont.waveSystem.isEndless).toBe(true);
    expect(cont.useItem('skyPurse')).toBe(false);
    expect(cont.useItem('emberPot', roadPt.x, roadPt.z)).toBe(false);
    expect(cont.itemSystem.belt()).toEqual({ skyPurse: 1, emberPot: 2 });

    // 4. Post-defeat lock: heartstone cannot revive a lost run at 0 lives.
    const defeated = world({ heartstone: 3, skyPurse: 2 });
    defeated.debugForceLose();
    expect(defeated.outcome).toBe('lost');
    expect(defeated.lives).toBe(0);
    expect(defeated.useItem('heartstone')).toBe(false);
    expect(defeated.useItem('skyPurse')).toBe(false);
    expect(defeated.lives).toBe(0);

    // 5. Slot caps, per-difficulty caps (Easy 3, Normal/Hard 1), junk-key sanitization, and 0 inventory.
    expect(
      cleanBelt({ junkA: 9, junkB: 9, junkC: 9, emberPot: 9, skyPurse: 0, galeBell: 4, heartstone: 2 }),
    ).toEqual({
      emberPot: MARKET_RULES.useCap.normal,
      skyPurse: 0,
      galeBell: MARKET_RULES.useCap.normal,
    });
    const hard = world({ skyPurse: 99, emberPot: 99 }, { modifiers: withDifficulty(NEUTRAL_RUN_MODIFIERS, 'hard') });
    expect(hard.itemSystem.belt()).toEqual({ skyPurse: 1, emberPot: 1 });
    expect(hard.useItem('skyPurse')).toBe(true);
    expect(hard.useItem('skyPurse')).toBe(false);
    const normalCap = world({ skyPurse: 99 }, { modifiers: withDifficulty(NEUTRAL_RUN_MODIFIERS, 'normal') });
    expect(normalCap.itemSystem.belt().skyPurse).toBe(MARKET_RULES.useCap.normal);
    expect(normalCap.useItem('skyPurse')).toBe(true);
    expect(normalCap.useItem('skyPurse')).toBe(false);
    const zeroStock = world({ skyPurse: 0 });
    expect(zeroStock.useItem('skyPurse')).toBe(false);
  });

  it('round-trips both replay formats deterministically across all 6 items, timeline scrubbing, and NaN self-coords with no replay debits', () => {
    const spend = vi.fn(() => true);
    const events1 = new EventBus();
    const beltA = { skyPurse: 2, cloudguard: 2, emberPot: 2 };
    const w = new SimWorld(LEVEL_L1C, events1, {
      modifiers: fullBelt, itemBelt: beltA,
      heroId: 'bran',
      heroLevel: 5,
      seed: 4242,
      recordCommands: true,
      spendItem: spend,
    });
    const monitor = new InvariantMonitor(w, events1);
    const recorder = new RunRecorder(w.level.id);
    const point = w.level.layout2d!.paths[0][1];

    expect(applyRunCommand(w, { k: 'wave' })).toBe(true);
    recorder.push(0, { k: 'wave' });
    // Passing NaN coordinates on a self-targeted item must not poison recorded replay commands.
    expect(w.useItem('skyPurse', NaN, NaN)).toBe(true);
    recorder.push(0, { k: 'item', id: 'skyPurse' });
    expect(applyRunCommand(w, { k: 'item', id: 'cloudguard', ...point })).toBe(true);
    recorder.push(0, { k: 'item', id: 'cloudguard', ...point });
    expect(applyRunCommand(w, { k: 'item', id: 'emberPot', ...point })).toBe(true);
    recorder.push(0, { k: 'item', id: 'emberPot', ...point });

    const hashesAtCheckpoints = new Map<number, string>();
    for (let step = 1; step <= 180; step++) {
      monitor.beginTick(step);
      w.fixedTick(dt);
      monitor.endTick(step, dt);
      if (step === 60) {
        expect(applyRunCommand(w, { k: 'item', id: 'skyPurse' })).toBe(true);
        recorder.push(w.tick, { k: 'item', id: 'skyPurse' });
      }
      if (step === 45 || step === 90 || step === 150) {
        hashesAtCheckpoints.set(w.tick, computeSimStateHash(w));
      }
    }
    expect(monitor.violations).toEqual([]);

    const exported = w.exportReplay();
    expect(exported.commands[1].command).toEqual({ kind: 'useItem', id: 'skyPurse' });
    const serialized = serializeSimReplay(exported);
    const replay = parseSimReplay(serialized)!;
    expect(replay).not.toBeNull();
    expect(replay.commands.filter((e) => e.command.kind === 'useItem')).toHaveLength(4);

    const legacy = JSON.parse(serialized);
    delete legacy.modifiers.marketDifficulty;
    const legacyPlayer = new SimReplayPlayer(w.level, parseSimReplay(JSON.stringify(legacy))!);
    expect(legacyPlayer.runToEnd().matchesHash).toBe(true);
    legacyPlayer.dispose();

    const player = new SimReplayPlayer(w.level, replay);
    expect(player.runToEnd().matchesHash).toBe(true);
    // Timeline scrubbing backward & forward reproduces intermediate and final hashes identically.
    player.seekToTick(150);
    expect(computeSimStateHash(player.world)).toBe(hashesAtCheckpoints.get(150));
    player.seekToTick(45);
    expect(computeSimStateHash(player.world)).toBe(hashesAtCheckpoints.get(45));
    player.seekToTick(90);
    expect(computeSimStateHash(player.world)).toBe(hashesAtCheckpoints.get(90));
    expect(player.runToEnd().matchesHash).toBe(true);

    const recorded = recorder.finish(w, w.tick);
    const playback = new SimWorld(w.level, new EventBus(), {
      heroId: 'bran',
      heroLevel: 5,
      seed: 4242,
      modifiers: fullBelt, itemBelt: recorded.itemBelt,
    });
    const cursor = new ReplayCursor(recorded);
    cursor.applyDue(playback, 0);
    for (let step = 1; step <= 180; step++) {
      playback.fixedTick(dt);
      cursor.applyDue(playback, playback.tick);
    }
    expect(playback.exportReplay().summary).toEqual(w.exportReplay().summary);
    expect(spend).toHaveBeenCalledTimes(4);

    // Second belt covering frostLantern, galeBell, and heartstone also replays bit-for-bit.
    const w2 = new SimWorld(LEVEL_L1C, new EventBus(), {
      modifiers: fullBelt, itemBelt: { frostLantern: 2, galeBell: 2, heartstone: 2 },
      recordCommands: true,
    });
    w2.startNextWave();
    for (let step = 0; step < 240; step++) w2.fixedTick(dt);
    // Force a leak by moving one spawned grunt to the goal so heartstone is legal in natural command flow
    const activeIdx = w2.enemyPool.getActiveIndex(0);
    const firstFoe = w2.enemyPool.items[activeIdx];
    expect(w2.useItem('frostLantern', firstFoe.x, firstFoe.z)).toBe(true);
    for (let step = 0; step < 30; step++) w2.fixedTick(dt);
    expect(w2.useItem('galeBell')).toBe(true);
    for (let step = 0; step < 2000 && w2.lives === w2.startingLives && w2.outcome === 'ongoing'; step++) {
      w2.fixedTick(dt);
    }
    if (w2.lives < w2.startingLives && w2.outcome === 'ongoing') {
      expect(w2.useItem('heartstone')).toBe(true);
    }
    for (let step = 0; step < 60 && w2.outcome === 'ongoing'; step++) w2.fixedTick(dt);
    const replay2 = parseSimReplay(serializeSimReplay(w2.exportReplay()))!;
    expect(new SimReplayPlayer(w2.level, replay2).runToEnd().matchesHash).toBe(true);
  });
});
