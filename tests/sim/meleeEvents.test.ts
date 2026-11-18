import { describe, expect, it } from 'vitest';
import { EventBus, type GameEventMap } from '../../src/core/eventBus.ts';
import type { EnemyType } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/index.ts';
import { parseLevel2D, type Level2DJson } from '../../src/data/levels2d/loader.ts';
import type { EnemyEntity } from '../../src/sim/entities.ts';
import { SimWorld } from '../../src/sim/world.ts';

/**
 * Render-facing melee timing events (`meleeSwing` announces a blow, `meleeHit` marks it landing).
 * They must line up with the rules' own blows (soldierAttack / soldierHurt) and never change them.
 */

const DT = BALANCE.fixedDt;

const ROAD_JSON: Level2DJson = {
  id: 'road',
  image: 'road',
  imageSize: [1000, 500],
  safeArea: [0, 0, 1000, 500],
  entrances: [{ id: 'A', x: 100, y: 250 }],
  goal: [900, 250],
  paths: [
    [
      [100, 250],
      [900, 250],
    ],
  ],
  plots: [[500, 330]],
  flightPath: [
    [100, 250],
    [900, 250],
  ],
};

function roadLevel(): LevelDef {
  return {
    ...LEVEL_L1C,
    id: 'road',
    layout2d: parseLevel2D(ROAD_JSON),
    waves: [{ clearBonus: 0, groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 1, startDelay: 0 }] }],
  };
}

type Stamped<K extends keyof GameEventMap> = GameEventMap[K] & { tick: number };

interface Run {
  world: SimWorld;
  swings: Stamped<'meleeSwing'>[];
  hits: Stamped<'meleeHit'>[];
  attacks: Stamped<'soldierAttack'>[];
  hurts: Stamped<'soldierHurt'>[];
  step: (n: number) => void;
}

function setup(listen = true): Run {
  const events = new EventBus();
  const world = new SimWorld(roadLevel(), events);
  world.gold = 100000;
  let now = 0;
  const run: Run = {
    world,
    swings: [],
    hits: [],
    attacks: [],
    hurts: [],
    step: (n) => {
      for (let i = 0; i < n; i++) {
        now++;
        world.fixedTick(DT);
      }
    },
  };
  if (listen) {
    events.on('meleeSwing', (e) => run.swings.push({ ...e, tick: now }));
    events.on('meleeHit', (e) => run.hits.push({ ...e, tick: now }));
    events.on('soldierAttack', (e) => run.attacks.push({ ...e, tick: now }));
    events.on('soldierHurt', (e) => run.hurts.push({ ...e, tick: now }));
  }
  return run;
}

function spawnAt(world: SimWorld, type: EnemyType, dist: number): EnemyEntity {
  const e = world.enemySystem.spawnEnemy(type, 1, false, 0)!;
  e.hp = 1e6;
  const v = { x: 0, y: 0, z: 0 };
  world.enemySystem.getPath(e.flying, 0).sample(dist, v);
  e.dist = dist;
  e.x = e.prevX = v.x;
  e.y = e.prevY = v.y;
  e.z = e.prevZ = v.z;
  return e;
}

/** Soldiers that outlast the test (HP only: armor and damage stay as built). */
function toughen(world: SimWorld): void {
  for (const so of world.soldierSystem.soldiers) so.hp = so.maxHp = 1e6;
}

/** Every hit has a swing by the same attacker announced before it that predicted it within a tick. */
function expectAnnounced(swings: Stamped<'meleeSwing'>[], hits: Stamped<'meleeHit'>[], min = 3): void {
  expect(hits.length).toBeGreaterThanOrEqual(min);
  for (const h of hits) {
    let swing: Stamped<'meleeSwing'> | null = null;
    for (const s of swings) {
      if (s.attacker === h.attacker && s.attackerId === h.attackerId && s.tick < h.tick) swing = s;
    }
    expect(swing, `hit at tick ${h.tick} was not announced`).not.toBeNull();
    const predicted = swing!.tick * DT + swing!.impactIn;
    expect(Math.abs(predicted - h.tick * DT)).toBeLessThanOrEqual(DT + 1e-9);
  }
}

describe('melee timing events', () => {
  it('soldier blows are announced with the right lead and land as meleeHit with soldierAttack', () => {
    const r = setup();
    r.world.placeTowerOnPlot(0, 'barracks');
    r.step(60);
    spawnAt(r.world, 'grunt', 3);
    r.step(60 * 6);
    const soldierHits = r.hits.filter((h) => h.attacker === 'soldier' && !h.cleave);
    expect(soldierHits.length).toBe(r.attacks.filter((a) => !a.cleave).length);
    expectAnnounced(r.swings, soldierHits);
    // First blow after contact comes fast (0.2 s), later ones at the tier rate (1 / s at T1).
    const sid = soldierHits[0].attackerId;
    const own = r.swings.filter((s) => s.attacker === 'soldier' && s.attackerId === sid);
    expect(own[0].impactIn).toBeLessThanOrEqual(0.2 + 1e-9);
    expect(own[2].impactIn).toBeCloseTo(1, 1);
    for (const h of soldierHits) expect(h.damage).toBeGreaterThan(0);
  });

  it('a held enemy announces its blows on its first soldier and lands one meleeHit per blow', () => {
    const r = setup();
    r.world.placeTowerOnPlot(0, 'barracks');
    r.step(60);
    const e = spawnAt(r.world, 'brute', 3);
    r.step(60 * 6);
    const enemyHits = r.hits.filter((h) => h.attacker === 'enemy');
    expect(enemyHits.every((h) => h.attackerId === e.uid && h.struck === 1 && !h.sweep)).toBe(true);
    expect(enemyHits.length).toBe(r.hurts.length);
    expectAnnounced(r.swings, enemyHits);
    for (const s of r.swings.filter((x) => x.attacker === 'enemy')) {
      expect(r.world.soldierSystem.soldiers.some((so) => so.id === s.targetId)).toBe(true);
    }
  });

  it('chill stretches the announced lead as much as the swing', () => {
    const r = setup();
    r.world.placeTowerOnPlot(0, 'barracks');
    r.step(60);
    toughen(r.world);
    const e = spawnAt(r.world, 'brute', 3);
    r.step(60 * 2);
    r.world.enemySystem.applySlow(e, 0.5, 30);
    const from = r.hits.length;
    r.step(60 * 6);
    const later = r.hits.slice(from).filter((h) => h.attacker === 'enemy');
    expectAnnounced(r.swings, later, 2);
    const slowed = r.swings.filter((s) => s.attacker === 'enemy' && s.tick > 60 * 4);
    // Brute: 0.8 blows / s → 1.25 s; at half speed 2.5 s.
    expect(slowed[slowed.length - 1].impactIn).toBeGreaterThan(2);
  });

  it('a sweeping boss blow is one meleeHit striking every soldier in contact', () => {
    const r = setup();
    const t = r.world.placeTowerOnPlot(0, 'barracks')!;
    r.world.upgradeTower(t.id);
    r.step(90);
    toughen(r.world);
    spawnAt(r.world, 'boss', 3);
    r.step(60 * 6);
    const sweeps = r.hits.filter((h) => h.attacker === 'enemy');
    expect(sweeps.length).toBeGreaterThan(0);
    expect(sweeps.every((h) => h.sweep)).toBe(true);
    expect(sweeps.some((h) => h.struck > 1)).toBe(true);
    const struck = sweeps.reduce((n, h) => n + h.struck, 0);
    expect(struck).toBe(r.hurts.length);
    expectAnnounced(r.swings, sweeps, 2);
  });

  it('listening changes nothing (events are render-only)', () => {
    const play = (listen: boolean): string => {
      const r = setup(listen);
      r.world.placeTowerOnPlot(0, 'barracks');
      r.step(60);
      const a = spawnAt(r.world, 'brute', 3);
      const b = spawnAt(r.world, 'grunt', 2);
      a.hp = 400;
      b.hp = 300;
      r.step(60 * 10);
      return JSON.stringify([
        r.world.soldierSystem.soldiers.map((s) => [s.state, s.hp, s.x.toFixed(6), s.z.toFixed(6), s.attackTimer.toFixed(6)]),
        [a.hp, a.dist, a.meleeTimer, b.hp, b.dist],
      ]);
    };
    expect(play(true)).toBe(play(false));
  });
});
