import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import type { EnemyType } from '../../src/core/types.ts';
import { computeMeteorDamage } from '../../src/data/abilities.ts';
import { withDifficulty } from '../../src/data/difficulty.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { LEVEL_L1C, LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { ITEMS, type ItemCounts } from '../../src/data/market.ts';
import { NEUTRAL_RUN_MODIFIERS } from '../../src/data/runModifiers.ts';
import { applyRunCommand, ReplayCursor, RunRecorder } from '../../src/render2d/ui/replay2d.ts';
import { parseSimReplay, SimReplayPlayer, SimWorld, type SimWorldOptions } from '../../src/sim/world.ts';

const dt = BALANCE.fixedDt;
function world(belt: ItemCounts, options: SimWorldOptions = {}) {
  const w = new SimWorld(LEVEL_L1C, new EventBus(), { itemBelt: belt, ...options });
  expect(w.grid.isPlotMode).toBe(true);
  w.startNextWave();
  return w;
}
function spawn(w: SimWorld, type: EnemyType, dist: number, elite = false, lane = 0) {
  const e = w.enemySystem.spawnEnemy(type, 1, elite, lane)!;
  e.dist = dist;
  w.enemySystem.getPath(e.flying, e.lane).sample(dist, e);
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
      expect(e.slowRatio).toBe(0.5);
    }
    grunt.abilityTimer = 0.1;
    tick(w, 238);
    expect(grunt.dist).toBe(5);
    expect(boss.dist).toBeGreaterThan(5);
    tick(w, 5);
    expect(grunt.dist).toBeGreaterThan(5);
  });

  it('heals only missing lives and keeps all leaks in the star calculation', () => {
    const debit = vi.fn(() => true);
    const w = world({ heartstone: 3 }, { spendItem: debit });
    expect(w.useItem('heartstone')).toBe(false);
    w.lives -= 7;
    const stars = w.computeStars();
    expect(w.useItem('heartstone')).toBe(true);
    expect(w.lives).toBe(w.startingLives - 2);
    expect(w.computeStars()).toBe(stars);
    expect(w.useItem('heartstone')).toBe(true);
    expect(w.lives).toBe(w.startingLives);
    expect(w.computeStars()).toBe(stars);
    expect(w.useItem('heartstone')).toBe(false);
    expect(debit).toHaveBeenCalledTimes(2);
  });

  it('pays island- and wave-scaled gold, honors failed debits, and enforces belt limits', () => {
    const spend = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const w = world({ skyPurse: 1 }, { spendItem: spend });
    const before = w.gold;
    expect(w.useItem('skyPurse')).toBe(false);
    expect(w.gold).toBe(before);
    expect(w.useItem('skyPurse')).toBe(true);
    expect(w.gold - before).toBe(Math.round(w.level.startingGold * 0.30 + 5));
    expect(w.useItem('skyPurse')).toBe(false);
    expect(w.useItem('heartstone')).toBe(false);
    expect(spend).toHaveBeenCalledTimes(2);
  });

  it('snaps three soldiers onto a road, blocks there, and releases the squad at 15s', () => {
    const w = world({ cloudguard: 1 });
    const e = spawn(w, 'grunt', 6);
    e.hp = 5000; e.speed = 0;
    const spawned = vi.fn();
    w.events.on('soldierSpawned', spawned);
    expect(w.useItem('cloudguard', 999, 999)).toBe(false);
    expect(w.useItem('cloudguard', e.x, e.z)).toBe(true);
    expect(spawned).toHaveBeenCalledTimes(3);
    tick(w, 120);
    expect(e.blockers).toBeGreaterThan(0);
    expect(w.towers).toHaveLength(0);
    tick(w, 781);
    expect(w.soldierSystem.soldiers).toHaveLength(0);
    expect(e.blockers).toBe(0);
  });

  it('pushes lane and flying foes along their own paths, floors at spawn, and pushes bosses less', () => {
    const level = LEVELS_2D.find(l => l.layout2d!.paths.length > 1)!;
    const w = new SimWorld(level, new EventBus(), { itemBelt: { galeBell: 1 } });
    w.startNextWave();
    const foes = [spawn(w, 'grunt', 5, false, 1), spawn(w, 'boss', 5), spawn(w, 'flyer', 2)];
    const pushed = vi.fn();
    w.events.on('enemyPushed', pushed);
    expect(w.useItem('galeBell')).toBe(true);
    expect(foes.map(e => e.dist)).toEqual([1, 4, 0]);
    for (const e of foes) {
      const p = { x: 0, y: 0, z: 0 };
      w.enemySystem.getPath(e.flying, e.lane).sample(e.dist, p);
      expect(e).toMatchObject(p);
    }
    expect(pushed).toHaveBeenCalledTimes(3);
  });

  it('refuses casts before wave one, after the outcome, in Endless, and under either disabling flag', () => {
    for (const mods of [{ itemsDisabled: true }, { abilitiesDisabled: true }]) {
      const w = world({ skyPurse: 1 }, { modifiers: { ...NEUTRAL_RUN_MODIFIERS, ...mods } });
      expect(w.useItem('skyPurse')).toBe(false);
      expect(w.itemSystem.belt().skyPurse).toBe(1);
    }
    const w = new SimWorld(LEVEL_L1C, new EventBus(), { itemBelt: { skyPurse: 1 } });
    expect(w.useItem('skyPurse')).toBe(false);
    w.startEndlessFromStart();
    w.startNextWave();
    expect(w.useItem('skyPurse')).toBe(false);
    const hard = world({ skyPurse: 3 }, { modifiers: withDifficulty(NEUTRAL_RUN_MODIFIERS, 'hard') });
    expect(hard.itemSystem.belt().skyPurse).toBe(1);
    expect(hard.useItem('skyPurse')).toBe(true);
    expect(hard.useItem('skyPurse')).toBe(false);
    const ended = world({ skyPurse: 1 });
    ended.outcome = 'won';
    expect(ended.useItem('skyPurse')).toBe(false);
  });

  it('round-trips both replay formats using the recorded starting belt, with no replay debits', () => {
    const spend = vi.fn(() => true);
    const belt = { skyPurse: 1, cloudguard: 1, emberPot: 1 };
    const w = new SimWorld(LEVEL_L1C, new EventBus(), { itemBelt: belt, recordCommands: true, spendItem: spend });
    const recorder = new RunRecorder(w.level.id);
    const point = w.level.layout2d!.paths[0][1];
    for (const c of [{ k: 'wave' }, { k: 'item', id: 'skyPurse' }, { k: 'item', id: 'cloudguard', ...point }, { k: 'item', id: 'emberPot', ...point }] as const) {
      expect(applyRunCommand(w, c)).toBe(true);
      recorder.push(0, c);
    }
    expect(w.useItem('skyPurse')).toBe(false);
    tick(w, 70);
    const replay = parseSimReplay(JSON.stringify(w.exportReplay()))!;
    expect(replay.commands.filter(e => e.command.kind === 'useItem')).toHaveLength(3);
    expect(new SimReplayPlayer(w.level, replay).runToEnd().matchesHash).toBe(true);
    const recorded = recorder.finish(w, w.tick);
    const playback = new SimWorld(w.level, new EventBus(), { itemBelt: recorded.itemBelt });
    new ReplayCursor(recorded).applyDue(playback, 0);
    tick(playback, 70);
    expect(playback.exportReplay().summary).toEqual(w.exportReplay().summary);
    expect(spend).toHaveBeenCalledTimes(3);
  });
});
