import { describe, expect, it } from 'vitest';
import { EventBus, type GameEventMap } from '../../src/core/eventBus.ts';
import type { EnemyType } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/index.ts';
import { parseLevel2D, type Level2DJson } from '../../src/data/levels2d/loader.ts';
import { ENEMY_MELEE, SOLDIER_RULES } from '../../src/data/soldiers.ts';
import { ALL_TOWER_TYPES, getTowerTierStats, TOWER_DEFS, TOWER_TYPES } from '../../src/data/towers.ts';
import type { EnemyEntity, TowerEntity } from '../../src/sim/entities.ts';
import { BLOCK_LATERAL_MAX, blockedLateralOffset } from '../../src/sim/soldierSystem.ts';
import { computeSellRefund, SimWorld } from '../../src/sim/world.ts';
import { InvariantMonitor } from '../../qa/bot/invariants.ts';

const DT = BALANCE.fixedDt;

/**
 * 1000x500 px, one straight road from (100, 250) to (900, 250) px = world (-8, 0) → (8, 0).
 * Plot 0 sits 1.6 units below the road at x = 0; plot 1 is 4.2 units above it (out of barracks
 * reach); plot 2 is beside the road further on. The flight lane runs straight over the road.
 */
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
  plots: [
    [500, 330],
    [500, 40],
    [700, 330],
  ],
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

type Log = { [K in keyof GameEventMap]?: GameEventMap[K][] };

function setup(): { world: SimWorld; log: Log } {
  const events = new EventBus();
  const log: Log = {};
  const track = <K extends keyof GameEventMap>(k: K): void => {
    events.on(k, (p) => {
      (log[k] ??= [] as never as GameEventMap[K][]).push(p);
    });
  };
  for (const k of [
    'soldierSpawned',
    'soldierAttack',
    'soldierHurt',
    'soldierDied',
    'soldierRemoved',
    'rallyMoved',
    'enemyBlocked',
    'enemyUnblocked',
    'enemyLeaked',
  ] as const) {
    track(k);
  }
  const world = new SimWorld(roadLevel(), events);
  world.gold = 100000;
  return { world, log };
}

function barracksOn(world: SimWorld, plot = 0): TowerEntity {
  const t = world.placeTowerOnPlot(plot, 'barracks');
  if (!t) throw new Error('barracks not built');
  return t;
}

/**
 * Spawns an enemy at path distance `dist`. `tough` pads its current HP (not max HP, so its melee
 * strength stays at hp scale 1) so soldiers can't end the fight early.
 */
function spawnAt(world: SimWorld, type: EnemyType, dist: number, tough = true): EnemyEntity {
  const e = world.enemySystem.spawnEnemy(type, 1, false, 0)!;
  if (tough) e.hp = 1e6;
  const v = { x: 0, y: 0, z: 0 };
  world.enemySystem.getPath(e.flying, 0).sample(dist, v);
  e.dist = dist;
  e.x = e.prevX = v.x;
  e.y = e.prevY = v.y;
  e.z = e.prevZ = v.z;
  return e;
}

function tick(world: SimWorld, n: number): void {
  for (let i = 0; i < n; i++) world.fixedTick(DT);
}

function tickUntil(world: SimWorld, cond: () => boolean, maxSec = 30): number {
  for (let i = 0; i < maxSec * 60; i++) {
    if (cond()) return i;
    world.fixedTick(DT);
  }
  throw new Error('condition never met');
}

function squad(world: SimWorld, towerId: number) {
  return world.soldierSystem.getBarracks(towerId)!.squad;
}

describe('barracks data', () => {
  it('has three tiers: more soldiers, HP, damage and armor per tier; UI fields mirror soldier stats', () => {
    const [t1, t2, t3] = TOWER_DEFS.barracks.tiers;
    expect([t1.soldierCount, t2.soldierCount, t3.soldierCount]).toEqual([2, 3, 3]);
    for (const [a, b] of [
      [t1, t2],
      [t2, t3],
    ] as const) {
      expect(b.soldierHp!).toBeGreaterThan(a.soldierHp!);
      expect(b.soldierDamage!).toBeGreaterThan(a.soldierDamage!);
      expect(b.soldierArmor!).toBeGreaterThan(a.soldierArmor!);
      expect(b.soldierRespawnSec!).toBeLessThan(a.soldierRespawnSec!);
      expect(b.range).toBeGreaterThan(a.range);
    }
    for (const t of [t1, t2, t3]) {
      expect(t.damage).toBe(t.soldierDamage);
      expect(t.fireRate).toBe(t.soldierRate);
    }
    expect(t3.soldierCleave).toBeGreaterThan(0);
    expect(TOWER_DEFS.barracks.role).toBe('barracks');
    expect(TOWER_DEFS.barracks.hitsFlyers).toBe(false);
  });

  it('is 2D-only: the 3D roster (build bar, radial, hotkeys, codex) leaves it out', () => {
    expect(TOWER_DEFS.barracks.only2d).toBe(true);
    expect(TOWER_TYPES).not.toContain('barracks');
    expect(TOWER_TYPES).toHaveLength(7);
    expect(ALL_TOWER_TYPES).toContain('barracks');
    expect(ALL_TOWER_TYPES.filter((t) => !TOWER_DEFS[t].only2d)).toEqual(TOWER_TYPES);
  });

  it('flyers ignore soldiers; bosses need a full squad; the Tempest tramples once enraged', () => {
    expect(ENEMY_MELEE.flyer.block).toBe('ignore');
    expect(ENEMY_MELEE.carrier.block).toBe('ignore');
    for (const t of Object.keys(ENEMY_DEFS) as EnemyType[]) {
      if (ENEMY_DEFS[t].flying) expect(ENEMY_MELEE[t].block).toBe('ignore');
    }
    expect(ENEMY_MELEE.golem.holdCost).toBe(2);
    expect(ENEMY_MELEE.boss.holdCost).toBe(3);
    expect(ENEMY_MELEE.tempest.trampleFromPhase).toBe(2);
    expect(ENEMY_MELEE.brute.damage).toBeGreaterThan(ENEMY_MELEE.grunt.damage * 2);
  });
});

describe('building, rally point and squad', () => {
  it('needs a road within range; the gold is only charged on success', () => {
    const { world } = setup();
    const gold = world.gold;
    expect(world.placeTowerOnPlot(1, 'barracks')).toBeNull();
    expect(world.gold).toBe(gold);
    expect(world.placeTowerOnPlot(1, 'archer')).not.toBeNull();
    const t = barracksOn(world);
    expect(world.gold).toBe(gold - getTowerTierStats('archer', 1).upgradeCost - getTowerTierStats('barracks', 1).upgradeCost);
    expect(t.type).toBe('barracks');
  });

  it('rallies on the nearest road point; the squad steps out of the barracks and walks to its posts', () => {
    const { world, log } = setup();
    const t = barracksOn(world);
    const b = world.soldierSystem.getBarracks(t.id)!;
    expect(b.rallyX).toBeCloseTo(0, 1);
    expect(b.rallyZ).toBeCloseTo(0, 5);
    expect(log.rallyMoved).toEqual([{ towerId: t.id, x: b.rallyX, z: b.rallyZ }]);
    const s = squad(world, t.id);
    expect(s).toHaveLength(2);
    expect(log.soldierSpawned).toHaveLength(2);
    for (const so of s) {
      expect(so.state).toBe('walking');
      expect(so.x).toBeCloseTo(t.x, 9);
      expect(so.z).toBeCloseTo(t.z, 9);
    }
    tick(world, 60);
    for (const so of s) {
      expect(so.state).toBe('idle');
      expect(so.x).toBeCloseTo(b.postX[so.slot], 6);
      expect(so.z).toBeCloseTo(b.postZ[so.slot], 6);
      expect(Math.hypot(so.x - b.rallyX, so.z - b.rallyZ)).toBeLessThan(0.6);
    }
  });

  it('clamps a moved rally point onto the road inside the barracks range', () => {
    const { world, log } = setup();
    const t = barracksOn(world);
    const range = getTowerTierStats('barracks', 1).range;
    const b = world.soldierSystem.getBarracks(t.id)!;
    // Off the road: snaps straight onto it.
    expect(world.setRallyPoint(t.id, 1, 1.2)).toBe(true);
    expect(b.rallyX).toBeCloseTo(1, 1);
    expect(b.rallyZ).toBeCloseTo(0, 6);
    // Far down the road: stops at the edge of the range.
    expect(world.setRallyPoint(t.id, 7, 0)).toBe(true);
    expect(Math.hypot(b.rallyX - t.x, b.rallyZ - t.z)).toBeLessThanOrEqual(range + 1e-9);
    expect(b.rallyX).toBeGreaterThan(range * 0.7);
    expect(b.rallyZ).toBeCloseTo(0, 6);
    expect(log.rallyMoved).toHaveLength(3);
    // Squad walks to the new posts.
    tick(world, 120);
    for (const s of b.squad) expect(Math.hypot(s.x - b.postX[s.slot], s.z - b.postZ[s.slot])).toBeLessThan(1e-6);
    // Not a barracks → refused.
    const archer = world.placeTowerOnPlot(2, 'archer')!;
    expect(world.setRallyPoint(archer.id, 0, 0)).toBe(false);
  });

  it('upgrades refresh the squad (full HP at the new tier, fallen soldiers step out, a third soldier joins)', () => {
    const { world } = setup();
    const t = barracksOn(world);
    tick(world, 60);
    const s = squad(world, t.id);
    s[0].hp = 10;
    s[1].hp = 0;
    s[1].state = 'dead';
    s[1].respawnTimer = 5;
    expect(world.upgradeTower(t.id)).toBe(true);
    const t2 = getTowerTierStats('barracks', 2);
    expect(s).toHaveLength(3);
    for (const so of s) {
      expect(so.maxHp).toBe(t2.soldierHp);
      expect(so.hp).toBe(t2.soldierHp);
      expect(so.state).not.toBe('dead');
    }
  });

  it('selling removes the squad and frees a held enemy at once', () => {
    const { world, log } = setup();
    const t = barracksOn(world);
    const e = spawnAt(world, 'grunt', 6);
    tickUntil(world, () => e.blockers > 0);
    const refund = world.sellTower(t.id);
    expect(refund).toBe(computeSellRefund(getTowerTierStats('barracks', 1).upgradeCost));
    expect(world.soldierSystem.soldiers).toHaveLength(0);
    expect(world.soldierSystem.barracks).toHaveLength(0);
    expect(log.soldierRemoved).toHaveLength(2);
    expect(e.blockers).toBe(0);
    expect(log.enemyUnblocked?.map((u) => u.enemyId)).toContain(e.uid);
    const d0 = e.dist;
    tick(world, 30);
    expect(e.dist).toBeGreaterThan(d0 + 1);
    expect(world.soldierSystem.blockedCount).toBe(0);
  });
});

describe('blocking and melee', () => {
  it('a held enemy stops; it walks on when its soldiers fall', () => {
    const { world, log } = setup();
    const t = barracksOn(world);
    tick(world, 60);
    const e = spawnAt(world, 'grunt', 3);
    tickUntil(world, () => e.blockers > 0);
    expect(log.enemyBlocked?.[0].enemyId).toBe(e.uid);
    const held = e.dist;
    tick(world, 120);
    expect(e.dist).toBe(held);
    expect(e.hp).toBeLessThan(1e6);
    expect(log.soldierAttack!.length).toBeGreaterThan(0);
    expect(log.soldierHurt!.length).toBeGreaterThan(0);
    // Both soldiers gang up on the lone grunt (it is held by the first contact already).
    const s = squad(world, t.id);
    expect(s.filter((so) => so.state === 'fighting')).toHaveLength(2);

    for (const so of s) so.hp = 1;
    tickUntil(world, () => s.every((so) => so.state === 'dead'));
    expect(log.soldierDied).toHaveLength(2);
    tick(world, 2);
    expect(e.blockers).toBe(0);
    expect(log.enemyUnblocked?.map((u) => u.enemyId)).toContain(e.uid);
    const d0 = e.dist;
    tick(world, 30);
    expect(e.dist).toBeCloseTo(d0 + ENEMY_DEFS.grunt.speed * 0.5, 1);
  });

  it('soldiers respawn at the barracks after the tier timer, paused while the barracks is jammed', () => {
    const { world, log } = setup();
    const t = barracksOn(world);
    tick(world, 60);
    const s = squad(world, t.id)[0];
    const e = spawnAt(world, 'brute', 3);
    s.hp = 1;
    const died = tickUntil(world, () => s.state === 'dead');
    expect(log.soldierDied![0].respawnSec).toBe(getTowerTierStats('barracks', 1).soldierRespawnSec);
    const spawnedBefore = log.soldierSpawned!.length;
    const respawn = tickUntil(world, () => s.state !== 'dead');
    const sec = (respawn + 1) / 60;
    expect(sec).toBeCloseTo(getTowerTierStats('barracks', 1).soldierRespawnSec!, 1);
    expect(log.soldierSpawned!.length).toBe(spawnedBefore + 1);
    expect(s.hp).toBe(s.maxHp);
    expect(Math.hypot(s.x - t.x, s.z - t.z)).toBeLessThan(SOLDIER_RULES.speed * DT * 2);
    void died;
    void e;

    // Jammed (hex / boss pulse): the timer stands still.
    s.hp = 0;
    s.state = 'dead';
    s.respawnTimer = 1;
    t.stunTimer = 5;
    tick(world, 120);
    expect(s.state).toBe('dead');
    expect(s.respawnTimer).toBeCloseTo(1, 9);
  });

  it('idle soldiers regenerate slowly', () => {
    const { world } = setup();
    const t = barracksOn(world);
    tick(world, 60);
    const s = squad(world, t.id)[0];
    s.hp = 40;
    s.sinceHurt = 0;
    tick(world, 60); // regen waits 1.5 s after the last hit
    expect(s.hp).toBe(40);
    tick(world, 120);
    const regen = s.maxHp * SOLDIER_RULES.regenFrac;
    expect(s.hp).toBeGreaterThan(40 + regen * 1.4);
    expect(s.hp).toBeLessThan(40 + regen * 1.6 + 1e-6);
  });

  it('flyers pass over the squad', () => {
    const { world, log } = setup();
    const t = barracksOn(world);
    tick(world, 60);
    const f = spawnAt(world, 'flyer', 3);
    let minGap = Infinity;
    const b = world.soldierSystem.getBarracks(t.id)!;
    for (let i = 0; i < 60 * 5 && f.active; i++) {
      world.fixedTick(DT);
      if (f.active) minGap = Math.min(minGap, Math.hypot(f.x - b.rallyX, f.z - b.rallyZ));
      expect(f.blockers).toBe(0);
    }
    expect(minGap).toBeLessThan(0.2);
    expect(log.enemyBlocked ?? []).toHaveLength(0);
    expect(squad(world, t.id).every((s) => s.state === 'idle')).toBe(true);
  });

  it('a burrower dives out of the hold; a blinker jumps past the squad', () => {
    const { world, log } = setup();
    barracksOn(world);
    tick(world, 60);
    const bur = spawnAt(world, 'burrower', 4.5);
    bur.abilityTimer = 99;
    tickUntil(world, () => bur.blockers > 0);
    const held = bur.dist;
    tick(world, 30);
    expect(bur.dist).toBe(held);
    bur.abilityTimer = 0; // dive now
    tick(world, 3);
    expect(bur.burrowed).toBe(true);
    expect(bur.blockers).toBe(0);
    expect(log.enemyUnblocked?.map((u) => u.enemyId)).toContain(bur.uid);
    tick(world, 30);
    expect(bur.dist).toBeGreaterThan(held + 1);

    const { world: w2 } = setup();
    barracksOn(w2);
    tick(w2, 60);
    const bl = spawnAt(w2, 'blinker', 4.5);
    bl.abilityTimer = 99;
    tickUntil(w2, () => bl.blockers > 0);
    const at = bl.dist;
    bl.abilityTimer = 0; // blink now
    tick(w2, 3);
    expect(bl.dist).toBeGreaterThan(at + 4);
    expect(bl.blockers).toBe(0);
    tick(w2, 30);
    expect(bl.dist).toBeGreaterThan(at + 5);
  });

  it('a golem needs two soldiers to stop (one slows it to half speed); an enraged Tempest tramples', () => {
    const { world } = setup();
    const t = barracksOn(world);
    tick(world, 60);
    const g = spawnAt(world, 'golem', 5);
    tickUntil(world, () => g.blockers >= 2);
    const held = g.dist;
    tick(world, 30);
    expect(g.dist).toBe(held);
    // Take one soldier out of the fight: half speed.
    const s = squad(world, t.id);
    const fighter = s.find((so) => so.state === 'fighting')!;
    fighter.hp = 0;
    fighter.state = 'dead';
    fighter.respawnTimer = 99;
    tick(world, 2);
    expect(g.blockers).toBe(1);
    const d0 = g.dist;
    tick(world, 30);
    expect(g.dist - d0).toBeCloseTo(ENEMY_DEFS.golem.speed * 0.5 * 0.5, 1);

    const { world: w2 } = setup();
    barracksOn(w2);
    tick(w2, 60);
    const boss = spawnAt(w2, 'tempest', 5);
    boss.bossPhase = 2;
    tick(w2, 120);
    expect(boss.blockers).toBe(0);
    expect(w2.soldierSystem.isHoldable(boss)).toBe(false);
  });

  it('soldiers hold at most their own number; the rest stream past and cost lives as usual', () => {
    const { world, log } = setup();
    barracksOn(world);
    tick(world, 60);
    for (let i = 0; i < 5; i++) spawnAt(world, 'grunt', 2 - i * 0.4);
    tickUntil(world, () => (log.enemyLeaked?.length ?? 0) >= 3, 20);
    expect(log.enemyLeaked).toHaveLength(3);
    expect(world.lives).toBe(BALANCE.startingLives - 3);
    expect(world.soldierSystem.blockedCount).toBe(2);
    // Held grunts are freed once the squad falls, and then leak too.
    for (const s of world.soldierSystem.soldiers) s.hp = 1;
    tickUntil(world, () => world.enemyPool.getActiveCount() === 0, 20);
    expect(world.lives).toBe(BALANCE.startingLives - 5);
  });

  it('kills count for the barracks and pay gold like any kill', () => {
    const { world } = setup();
    const t = barracksOn(world);
    tick(world, 60);
    const e = spawnAt(world, 'grunt', 3, false);
    const gold = world.gold;
    tickUntil(world, () => !e.active);
    expect(t.kills).toBe(1);
    expect(t.totalDamageDealt).toBe(e.maxHp);
    expect(world.gold).toBe(gold + e.reward);
    expect(world.lives).toBe(BALANCE.startingLives);
  });

  it('6 enemies blocked by one soldier end up at distinct positions at least 12 px apart', () => {
    const { world } = setup();
    const ppu = world.level.layout2d!.pxPerUnit;
    const t = barracksOn(world, 0);
    tick(world, 60);
    const [blocker, spare] = squad(world, t.id);
    // Keep only one active soldier on the road, able to hold 6 foes for the queue-spread test.
    blocker.hp = blocker.maxHp = 1e6;
    blocker.holdCap = 6;
    spare.hp = 0;
    spare.state = 'dead';
    spare.respawnTimer = 999;

    const enemies = Array.from({ length: 6 }, (_, i) => spawnAt(world, 'grunt', 5.4 - i * 0.12));
    tickUntil(world, () => enemies.every((e) => e.blockers >= 1));
    // Allow exponential easing to settle into the queue slots.
    tick(world, 45);

    expect(world.soldierSystem.blockedCount).toBe(6);
    const minPairwisePx = 12;
    for (let i = 0; i < enemies.length; i++) {
      // Lateral offset stays within the road band around z = 0.
      expect(Math.abs(enemies[i].z)).toBeLessThanOrEqual(BLOCK_LATERAL_MAX + 1e-3);
      for (let j = i + 1; j < enemies.length; j++) {
        const dxPx = (enemies[i].x - enemies[j].x) * ppu;
        const dzPx = (enemies[i].z - enemies[j].z) * ppu;
        expect(Math.hypot(dxPx, dzPx)).toBeGreaterThanOrEqual(minPairwisePx);
      }
    }
    // Queue spans both across the road (z) and along the path behind the blocker (x).
    const xs = enemies.map((e) => e.x);
    const zs = enemies.map((e) => e.z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1.0);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.3);
  });

  it('blocked crowd at a standard barracks choke spreads deterministically with uid-stable lateral slots', () => {
    const runCrowd = (): { x: number; z: number; uid: number }[] => {
      const { world } = setup();
      const t1 = barracksOn(world, 0);
      const t2 = barracksOn(world, 2);
      world.upgradeTower(t1.id);
      world.upgradeTower(t2.id);
      world.setRallyPoint(t1.id, 1.5, 0);
      world.setRallyPoint(t2.id, 1.5, 0);
      tick(world, 90);
      for (const s of world.soldierSystem.soldiers) s.hp = s.maxHp = 1e6;
      const foes = Array.from({ length: 6 }, () => spawnAt(world, 'grunt', 6.5));
      tickUntil(world, () => foes.every((e) => e.blockers >= 1));
      tick(world, 45);
      return foes.map((e) => ({ x: e.x, z: e.z, uid: e.uid }));
    };

    const first = runCrowd();
    const second = runCrowd();
    expect(first).toEqual(second);
    const ppu = 50;
    for (let i = 0; i < first.length; i++) {
      expect(first[i].z).toBeCloseTo(-blockedLateralOffset(first[i].uid), 2);
      for (let j = i + 1; j < first.length; j++) {
        const dPx = Math.hypot((first[i].x - first[j].x) * ppu, (first[i].z - first[j].z) * ppu);
        expect(dPx).toBeGreaterThanOrEqual(12);
      }
    }

    // Lateral slot stays bound to enemy uid when the front foe dies, and eases back to 0 once freed.
    const { world } = setup();
    const t = barracksOn(world, 0);
    tick(world, 60);
    for (const s of squad(world, t.id)) s.hp = s.maxHp = 1e6;
    const front = spawnAt(world, 'grunt', 6.4);
    const rear = spawnAt(world, 'grunt', 6.2);
    tickUntil(world, () => front.blockers >= 1 && rear.blockers >= 1);
    tick(world, 45);
    const rearLatBefore = rear.z;
    front.hp = 0;
    tick(world, 45);
    expect(rear.z).toBeCloseTo(rearLatBefore, 3);
    world.sellTower(t.id);
    tick(world, 45);
    expect(Math.abs(rear.z)).toBeLessThan(1e-3);
  });
});

describe('determinism and isolation', () => {
  function l1cRun(): string {
    const world = new SimWorld(LEVEL_L1C, new EventBus());
    world.gold = 100000;
    const types = ['barracks', 'archer', 'cannon', 'barracks', 'tesla'] as const;
    for (let p = 0; p < world.grid.plotCount; p++) {
      const t = world.placeTowerOnPlot(p, types[p % types.length]);
      if (t && p % 3 === 0) world.upgradeTower(t.id);
    }
    world.startNextWave();
    for (let i = 0; i < 60 * 150 && world.outcome === 'ongoing'; i++) {
      if (world.waveSystem.state === 'betweenWaves') world.startNextWave();
      if (i === 60 * 40) {
        const b = world.towers.find((t) => t.type === 'barracks')!;
        world.setRallyPoint(b.id, b.x + 2, b.z);
      }
      world.fixedTick(DT);
    }
    return JSON.stringify({
      gold: world.gold,
      lives: world.lives,
      wave: world.waveSystem.currentWaveIndex,
      towers: world.towers.map((t) => [t.id, t.kills, Math.round(t.totalDamageDealt * 1000)]),
      soldiers: world.soldierSystem.soldiers.map((s) => [s.id, s.state, s.hp.toFixed(6), s.x.toFixed(6), s.z.toFixed(6)]),
    });
  }

  it('two L1c runs with barracks produce identical results', () => {
    const a = l1cRun();
    expect(a).toBe(l1cRun());
    expect(JSON.parse(a).soldiers.length).toBeGreaterThan(0);
  });

  it('without a barracks the soldier system never touches an enemy', () => {
    const { world } = setup();
    world.placeTowerOnPlot(0, 'archer');
    const e = spawnAt(world, 'grunt', 1);
    let i = 0;
    for (; i < 60 * 4 && e.active; i++) {
      world.fixedTick(DT);
      expect(e.blockers).toBe(0);
    }
    expect(world.soldierSystem.soldiers).toHaveLength(0);
    expect(e.dist).toBeCloseTo(1 + ENEMY_DEFS.grunt.speed * (i / 60), 6);
  });

  it('onUpgrade cleanly retires excess squad slots, refreshes soldierHoldCap, and re-clamps rally when a specialization shrinks count or range', () => {
    const { world, log } = setup();
    const t = barracksOn(world, 0);
    expect(world.upgradeTower(t.id)).toBe(true); // T2: 3 soldiers, range 2.8
    const b = world.soldierSystem.getBarracks(t.id)!;
    expect(b.squad).toHaveLength(3);

    // Push rally point near the outer edge of T2 range (~2.8 units from plot 0 at (0, 1.6)) and let squad arrive.
    expect(world.setRallyPoint(t.id, 7, 0)).toBe(true);
    const t2RallyDist = Math.hypot(b.rallyX - b.x, b.rallyZ - b.z);
    expect(t2RallyDist).toBeGreaterThan(2.3);
    tick(world, 90);

    // Let all 3 soldiers engage and hold 3 grunts near the outer rally point.
    const g1 = spawnAt(world, 'grunt', 8 + b.rallyX - 0.3);
    const g2 = spawnAt(world, 'grunt', 8 + b.rallyX - 0.45);
    const g3 = spawnAt(world, 'grunt', 8 + b.rallyX - 0.6);
    tickUntil(world, () => g1.blockers >= 1 && g2.blockers >= 1 && g3.blockers >= 1);

    const origT3 = TOWER_DEFS.barracks.tiers[2];
    const rallyMovesBefore = (log.rallyMoved ?? []).length;
    try {
      // Simulate an elite T3 specialization: 1 champion soldier with holdCap=2 and tighter range=2.0.
      (TOWER_DEFS.barracks.tiers as unknown as Record<number, unknown>)[2] = {
        ...origT3,
        range: 2.0,
        soldierCount: 1,
        soldierHp: 500,
        soldierHoldCap: 2,
      };
      expect(world.upgradeTower(t.id)).toBe(true);

      // Excess 2 soldiers were cleanly retired, removed from SoldierSystem.soldiers, and emitted soldierRemoved.
      expect(b.squad).toHaveLength(1);
      expect(world.soldierSystem.soldiers).toHaveLength(1);
      expect(log.soldierRemoved).toHaveLength(2);
      expect(b.squad[0].maxHp).toBe(500);
      expect(b.squad[0].holdCap).toBe(2);

      // Rally point re-clamped inside the tighter 2.0 range and emitted rallyMoved.
      expect(Math.hypot(b.rallyX - b.x, b.rallyZ - b.z)).toBeLessThanOrEqual(2.0 + 1e-9);
      expect((log.rallyMoved ?? []).length).toBe(rallyMovesBefore + 1);

      // Every previously held grunt was cleanly unblocked (no dangling blockers).
      expect(g1.blockers).toBe(0);
      expect(g2.blockers).toBe(0);
      expect(g3.blockers).toBe(0);
      expect((log.enemyUnblocked ?? []).length).toBe((log.enemyBlocked ?? []).length);
    } finally {
      (TOWER_DEFS.barracks.tiers as unknown as Record<number, unknown>)[2] = origT3;
    }
  });

  it('elite multi-hold (soldierHoldCap: 2) cleanly releases extra-held foes on rally move, sell, and soldier death', () => {
    const origT3 = TOWER_DEFS.barracks.tiers[2];
    try {
      (TOWER_DEFS.barracks.tiers as unknown as Record<number, unknown>)[2] = {
        ...origT3,
        soldierCount: 1,
        soldierHp: 14,
        soldierArmor: 0,
        soldierDamage: 0,
        soldierHoldCap: 2,
      };

      const { world } = setup();
      const monitor = new InvariantMonitor(world, world.events, 8);
      const stepWorld = (n: number): void => {
        for (let i = 0; i < n; i++) {
          const nextTick = world.tick + 1;
          monitor.beginTick(nextTick);
          world.fixedTick(DT);
          monitor.endTick(world.tick, DT);
        }
      };

      const t = world.placeTowerOnPlot(0, 'barracks')!;
      expect(world.upgradeTower(t.id)).toBe(true);
      expect(world.upgradeTower(t.id)).toBe(true);
      const b = world.soldierSystem.getBarracks(t.id)!;
      expect(b.squad).toHaveLength(1);
      expect(b.squad[0].holdCap).toBe(2);
      stepWorld(60);

      // Spawn two grunts right behind each other so the lone holdCap=2 soldier holds BOTH (primary + extra).
      const g1 = spawnAt(world, 'grunt', 8 + b.rallyX - 0.15);
      const g2 = spawnAt(world, 'grunt', 8 + b.rallyX - 0.42);
      for (let guard = 0; guard < 180 && !(g1.blockers >= 1 && g2.blockers >= 1); guard++) {
        stepWorld(1);
      }
      expect(g1.blockers).toBe(1);
      expect(g2.blockers).toBe(1);
      expect(b.squad[0].extraHoldPoolIndices).toHaveLength(1);

      // Between-tick rally move must immediately release BOTH primary and extra-held foes before next tick's EnemySystem.
      expect(world.setRallyPoint(t.id, b.rallyX + 1.1, 0)).toBe(true);
      expect(g1.blockers).toBe(0);
      expect(g2.blockers).toBe(0);

      // Re-engage both grunts at the new rally point, then let them kill the fragile soldier in melee.
      g1.dist = 8 + b.rallyX - 0.15;
      g2.dist = 8 + b.rallyX - 0.42;
      world.groundPath.sample(g1.dist, g1);
      world.groundPath.sample(g2.dist, g2);
      for (let guard = 0; guard < 180 && !(g1.blockers >= 1 && g2.blockers >= 1); guard++) {
        stepWorld(1);
      }
      expect(g1.blockers).toBe(1);
      expect(g2.blockers).toBe(1);

      // Run until the lone soldier dies: on the death tick itself, BOTH grunts must drop to blockers === 0
      // with zero InvariantMonitor violations (no blockers > 0 with 0 fighting soldiers, exact unblock parity).
      for (let guard = 0; guard < 240 && b.squad[0].state !== 'dead'; guard++) {
        stepWorld(1);
      }
      expect(b.squad[0].state).toBe('dead');
      expect(g1.blockers).toBe(0);
      expect(g2.blockers).toBe(0);
      expect(monitor.violations).toEqual([]);

      // Let the soldier respawn, re-hold the two grunts, and verify sellTower releases both immediately.
      b.squad[0].respawnTimer = 0.01;
      stepWorld(35);
      g1.dist = 8 + b.rallyX - 0.15;
      g2.dist = 8 + b.rallyX - 0.42;
      world.groundPath.sample(g1.dist, g1);
      world.groundPath.sample(g2.dist, g2);
      for (let guard = 0; guard < 180 && !(g1.blockers >= 1 && g2.blockers >= 1); guard++) {
        stepWorld(1);
      }
      expect(g1.blockers).toBe(1);
      expect(g2.blockers).toBe(1);
      expect(world.sellTower(t.id)).toBeGreaterThan(0);
      expect(g1.blockers).toBe(0);
      expect(g2.blockers).toBe(0);
      stepWorld(5);
      expect(monitor.violations).toEqual([]);
    } finally {
      (TOWER_DEFS.barracks.tiers as unknown as Record<number, unknown>)[2] = origT3;
    }
  });
});
