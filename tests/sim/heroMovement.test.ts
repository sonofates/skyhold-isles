import { describe, expect, it } from 'vitest';
import { InvariantMonitor } from '../../qa/bot/invariants.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import type { EnemyType } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { HERO_RULES } from '../../src/data/heroes.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/index.ts';
import { parseLevel2D, type Level2DJson } from '../../src/data/levels2d/loader.ts';
import { ENEMY_MELEE } from '../../src/data/soldiers.ts';
import type { EnemyEntity } from '../../src/sim/entities.ts';
import { computeSimStateHash, parseSimReplay, serializeSimReplay, SimReplayPlayer, SimWorld } from '../../src/sim/world.ts';

const DT = BALANCE.fixedDt;

/**
 * Straight single-lane horizontal road from (-8, 0) to (+8, 0) (image 1000x500 @ 50 px/u),
 * with plots beside the road at (0, +1.6) and (+4, +1.6).
 */
const STRAIGHT_JSON: Level2DJson = {
  id: 'straight-hero-move',
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
    [700, 330],
  ],
  flightPath: [
    [100, 250],
    [900, 250],
  ],
};

/**
 * Two parallel horizontal lanes separated by an unwalkable 2.5u canyon (`z = -1.25` and `z = +1.25`,
 * so `euclidGap = 2.5u > 2 * maxOffRoadDist` — neither merging nor walkable across at x = 0),
 * merging only far downstream at x = +6.5 before the castle at (+8, 0).
 */
const CANYON_LANES_JSON: Level2DJson = {
  id: 'canyon-lanes',
  image: 'road',
  imageSize: [1000, 500],
  safeArea: [0, 0, 1000, 500],
  entrances: [
    { id: 'A', x: 100, y: 187.5 },
    { id: 'B', x: 100, y: 312.5 },
  ],
  goal: [900, 250],
  paths: [
    [
      [100, 187.5],
      [825, 187.5],
      [825, 250],
      [900, 250],
    ],
    [
      [100, 312.5],
      [825, 312.5],
      [825, 250],
      [900, 250],
    ],
  ],
  plots: [
    [500, 100],
    [500, 400],
  ],
  flightPath: [
    [100, 250],
    [900, 250],
  ],
};

function makeLevel(json: Level2DJson): LevelDef {
  return {
    ...LEVEL_L1C,
    id: json.id,
    startingGold: 2000,
    layout2d: parseLevel2D(json),
    waves: [
      {
        clearBonus: 15,
        groups: [{ enemyType: 'grunt', count: 3, spawnInterval: 0.7, startDelay: 0, lane: 0 }],
      },
    ],
  };
}

function spawnAtDist(
  world: SimWorld,
  type: EnemyType,
  dist: number,
  lane = 0,
  hpOverride = 5000,
): EnemyEntity {
  const e = world.enemySystem.spawnEnemy(type, 1, false, lane)!;
  e.hp = hpOverride;
  const v = { x: 0, y: 0, z: 0 };
  world.enemySystem.getPath(e.flying, lane).sample(dist, v);
  e.dist = dist;
  e.x = e.prevX = v.x;
  e.y = e.prevY = v.y;
  e.z = e.prevZ = v.z;
  world.spatialHash.insert(e.poolIndex, e.x, e.z);
  return e;
}

function tick(world: SimWorld, n: number): void {
  for (let i = 0; i < n; i++) world.fixedTick(DT);
}

function tickUntil(world: SimWorld, cond: () => boolean, maxSec = 20): number {
  for (let i = 0; i < maxSec * 60; i++) {
    if (cond()) return i;
    world.fixedTick(DT);
  }
  throw new Error('condition never met within timeout');
}

describe('hero movement, engagement & blocking rules', () => {
  it('breaks melee engagement immediately when ordered to move while an enemy is adjacent, and walks straight to destination', () => {
    const events = new EventBus();
    const unblocked: number[] = [];
    events.on('enemyUnblocked', (e) => unblocked.push(e.enemyId));

    const world = new SimWorld(makeLevel(STRAIGHT_JSON), events, { heroId: 'bran', heroLevel: 1 });
    expect(world.commandHeroMove(0, 0)).toBe(true);
    tickUntil(world, () => world.hero!.state === 'idle');

    // Spawn an adjacent grunt right in melee contact so Bran locks into 'fighting'.
    const dCenter = world.groundPath.nearestDist(0, 0);
    const foe = spawnAtDist(world, 'grunt', dCenter - 0.5, 0, 5000);
    tickUntil(world, () => world.hero!.state === 'fighting' && foe.heroBlockers > 0);
    expect(foe.heroBlockers).toBe(1);

    // Order Bran to move west to (-5, 0), walking right past / through the adjacent foe!
    expect(world.commandHeroMove(-5, 0)).toBe(true);
    expect(world.hero!.state).toBe('moving');
    expect(world.hero!.targetPoolIndex).toBe(-1);
    expect(world.hero!.targetUid).toBe(0);
    expect(foe.heroBlockers).toBe(0);
    expect(unblocked).toContain(foe.uid);

    const foeDistAtRelease = foe.dist;
    let prevX = world.hero!.x;
    while (world.hero!.state === 'moving') {
      world.fixedTick(DT);
      expect(world.hero!.x).toBeLessThan(prevX);
      expect(Math.abs(world.hero!.z)).toBeLessThan(1e-6);
      expect(foe.heroBlockers).toBe(0);
      prevX = world.hero!.x;
    }

    expect(world.hero!.state).toBe('idle');
    expect(world.hero!.x).toBeCloseTo(-5, 4);
    expect(world.hero!.z).toBeCloseTo(0, 4);
    // Released foe resumed walking forward unimpeded.
    expect(foe.dist).toBeGreaterThan(foeDistAtRelease + 1.0);
  });

  it('walks past packs of enemies without stopping mid-walk or blocking them until reaching destination', () => {
    const world = new SimWorld(makeLevel(STRAIGHT_JSON), new EventBus(), { heroId: 'bran', heroLevel: 5 });
    expect(world.commandHeroMove(4, 0)).toBe(true);
    tickUntil(world, () => world.hero!.state === 'idle');

    // Place a line of enemies along the road between x = +3 and x = -3.
    const enemies = [11, 9.5, 8, 6.5, 5].map((dist) => spawnAtDist(world, 'grunt', dist, 0, 8000));

    // Order Bran to walk west through the entire enemy column to (-5, 0).
    expect(world.commandHeroMove(-5, 0)).toBe(true);
    let walkTicks = 0;
    while (world.hero!.state === 'moving') {
      const beforeX = world.hero!.x;
      world.fixedTick(DT);
      walkTicks++;
      // Never stops or slows mid-walk even when enemies touch/strike him.
      if (world.hero!.state === 'moving') {
        expect(beforeX - world.hero!.x).toBeCloseTo(world.hero!.stats.moveSpeed * DT, 5);
      }
      for (const e of enemies) {
        expect(e.heroBlockers).toBe(0);
      }
    }

    expect(walkTicks).toBeGreaterThan(30);
    expect(world.hero!.x).toBeCloseTo(-5, 4);
  });

  it('does not freeze enemies across unwalkable canyons / unconnected lanes with spare holdCap', () => {
    const world = new SimWorld(makeLevel(CANYON_LANES_JSON), new EventBus(), { heroId: 'bran', heroLevel: 1 });
    // Post Bran on Lane 0 verge at (0, -0.65) so Lane 1 at (0, +1.25) is 1.90u away (<= meleeEngageRadius 2.1u)
    // across an unwalkable canyon (merge is 6.5u downstream -> graphDist = 13u >> 7.2u).
    expect(world.commandHeroMove(0, -0.65)).toBe(true);
    tickUntil(world, () => world.hero!.state === 'idle');

    const lane0 = world.enemySystem.getPath(false, 0);
    const lane1 = world.enemySystem.getPath(false, 1);
    const eSame1 = spawnAtDist(world, 'grunt', lane0.nearestDist(0, -1.25) - 0.3, 0, 8000);
    const eAcross = spawnAtDist(world, 'grunt', lane1.nearestDist(0, 1.25) - 0.4, 1, 8000);

    tickUntil(world, () => world.hero!.state === 'fighting' && eSame1.heroBlockers > 0);
    expect(Math.hypot(eAcross.x - world.hero!.x, eAcross.z - world.hero!.z)).toBeLessThan(HERO_RULES.meleeEngageRadius);

    // Bran (`holdCap = 2`) has 1 spare hold slot while fighting `eSame1`, yet MUST NOT freeze `eAcross` across the canyon!
    const acrossBefore = eAcross.dist;
    for (let i = 0; i < 20; i++) {
      world.fixedTick(DT);
      expect(eAcross.heroBlockers).toBe(0);
    }
    expect(eAcross.dist).toBeGreaterThan(acrossBefore + 0.3);

    // A second enemy on Bran's own Lane 0 IS caught by Bran's 2nd hold slot!
    const eSame2 = spawnAtDist(world, 'grunt', lane0.nearestDist(0, -1.25) - 0.8, 0, 8000);
    tickUntil(world, () => eSame2.heroBlockers > 0, 4);
    expect(eSame1.heroBlockers).toBe(1);
    expect(eSame2.heroBlockers).toBe(1);
  });

  it('hero + soldier + enemy at one point: enforces one blocker per holdCost slot and peels off when holdCap fills', () => {
    const world = new SimWorld(makeLevel(STRAIGHT_JSON), new EventBus(), { heroId: 'bran', heroLevel: 1 });
    world.gold = 5000;
    const barracks = world.placeTowerOnPlot(0, 'barracks')!;
    // Keep only 1 living soldier at the rally point so 1 soldier (`holdCap = 1`) + L1 Bran (`holdCap = 2`) share the post.
    const sq = world.soldierSystem.getBarracks(barracks.id)!.squad;
    sq[1].hp = 0;
    sq[1].state = 'dead';
    sq[1].respawnTimer = 999;

    const bState = world.soldierSystem.getBarracks(barracks.id)!;
    expect(world.commandHeroMove(bState.rallyX, bState.rallyZ)).toBe(true);
    tickUntil(world, () => world.hero!.state === 'idle' && sq[0].state === 'idle');

    // 1. Lone Grunt A (`holdCost = 1`): while nothing else needs holding, Soldier 0 and Bran both
    // assist on Grunt A (`blockers = 1, heroBlockers = 1`, applying Bulwark).
    const dRally = world.groundPath.nearestDist(bState.rallyX, bState.rallyZ);
    const eA = spawnAtDist(world, 'grunt', dRally - 0.4, 0, 9000);
    tickUntil(world, () => sq[0].state === 'fighting' && world.hero!.state === 'fighting');
    expect(eA.blockers).toBe(1);
    expect(eA.heroBlockers).toBe(1);

    // 2. Grunt B arrives unblocked (`blockers = 0`): Bran (`holdCap = 2`) catches Grunt B with his
    // spare 2nd slot without needlessly dropping frontmost Grunt A.
    const eB = spawnAtDist(world, 'grunt', dRally - 1.2, 0, 9000);
    tickUntil(world, () => eB.heroBlockers >= 1, 4);
    expect(eB.blockers).toBe(0);
    expect(eB.heroBlockers).toBe(1);

    // 3. Grunt C arrives unblocked (`3` grunts vs `1 Soldier + Bran(holdCap=2)` = 3 total capacity):
    // Bran immediately peels his primary hold off soldier-held Grunt A (`eA.heroBlockers -> 0`) so
    // Soldier 0 holds Grunt A and Bran holds Grunt B + Grunt C — exact 1 blocker per holdCost slot!
    const eC = spawnAtDist(world, 'grunt', dRally - 1.5, 0, 9000);
    tickUntil(world, () => eC.heroBlockers >= 1, 4);
    expect(world.hero!.targetUid).toBe(eB.uid);
    expect(eA.blockers).toBe(1);
    expect(eA.heroBlockers).toBe(0);
    expect(eA.blockers + eA.heroBlockers).toBe(ENEMY_MELEE.grunt.holdCost);
    expect(eB.blockers + eB.heroBlockers).toBe(ENEMY_MELEE.grunt.holdCost);
    expect(eC.blockers + eC.heroBlockers).toBe(ENEMY_MELEE.grunt.holdCost);
  });

  it('never freezes at a lane edge trying to engage a stationary enemy across an unwalkable canyon', () => {
    const world = new SimWorld(makeLevel(CANYON_LANES_JSON), new EventBus(), { heroId: 'bran', heroLevel: 1 });
    // Post Bran on Lane 0 verge at (0, -0.65). Lane 1 runs at z = +1.25 (1.90u away <= meleeEngageRadius 2.1u,
    // separated by an unwalkable canyon around z = 0 where offRoad = 1.25u > maxOffRoadDist 1.20u).
    expect(world.commandHeroMove(0, -0.65)).toBe(true);
    tickUntil(world, () => world.hero!.state === 'idle');

    const lane1 = world.enemySystem.getPath(false, 1);
    const d1 = lane1.nearestDist(0, 1.25);
    const acrossCanyon = spawnAtDist(world, 'grunt', d1, 1, 9000);
    acrossCanyon.speed = 0;

    tick(world, 60);
    // Bran must NOT lock onto `acrossCanyon` and freeze in 'engaging' against the canyon wall!
    expect(world.hero!.state).toBe('idle');
    expect(world.hero!.targetPoolIndex).toBe(-1);

    // An enemy arriving on Bran's own Lane 0 IS engaged and blocked normally.
    const lane0 = world.enemySystem.getPath(false, 0);
    const d0 = lane0.nearestDist(0, -1.25);
    const sameLaneFoe = spawnAtDist(world, 'grunt', d0 - 0.5, 0, 9000);
    tickUntil(world, () => sameLaneFoe.heroBlockers > 0, 4);
    expect(world.hero!.targetUid).toBe(sameLaneFoe.uid);

    // Also verify a wider 2.6u canyon (`z = -1.30` and `z = +1.30`, where previously `clampToGroundOut`
    // pinned Bran at `z = -0.10` with `movedDx = 0`, permanently freezing him in `state === 'engaging'`).
    const widerCanyonJson: Level2DJson = {
      ...CANYON_LANES_JSON,
      id: 'wider-canyon-lanes',
      entrances: [
        { id: 'A', x: 100, y: 185 },
        { id: 'B', x: 100, y: 315 },
      ],
      paths: [
        [
          [100, 185],
          [825, 185],
          [825, 250],
          [900, 250],
        ],
        [
          [100, 315],
          [825, 315],
          [825, 250],
          [900, 250],
        ],
      ],
    };
    const wideWorld = new SimWorld(makeLevel(widerCanyonJson), new EventBus(), { heroId: 'bran', heroLevel: 1 });
    expect(wideWorld.commandHeroMove(0, -0.7)).toBe(true);
    tickUntil(wideWorld, () => wideWorld.hero!.state === 'idle');
    const wideLane1 = wideWorld.enemySystem.getPath(false, 1);
    const wideFoe = spawnAtDist(wideWorld, 'grunt', wideLane1.nearestDist(0, 1.3), 1, 9000);
    wideFoe.speed = 0;
    tick(wideWorld, 60);
    expect(wideWorld.hero!.state).toBe('idle');
    expect(wideWorld.hero!.targetPoolIndex).toBe(-1);
  });

  it('walks straight through friendly barracks soldiers without slowing, deflecting, or blocking them', () => {
    const world = new SimWorld(makeLevel(STRAIGHT_JSON), new EventBus(), { heroId: 'bran', heroLevel: 1 });
    const barracks = world.placeTowerOnPlot(0, 'barracks')!;
    const bState = world.soldierSystem.getBarracks(barracks.id)!;
    // Wait until all friendly soldiers settle on the road around x = 0, then move rally west as Bran walks east.
    expect(world.commandHeroMove(-3, 0)).toBe(true);
    tickUntil(world, () => world.hero!.state === 'idle' && bState.squad.every((s) => s.state === 'idle'));

    expect(world.setRallyPoint(barracks.id, -2, 0)).toBe(true);
    expect(world.commandHeroMove(3, 0)).toBe(true);

    while (world.hero!.state === 'moving') {
      const beforeX = world.hero!.x;
      world.fixedTick(DT);
      if (world.hero!.state === 'moving') {
        expect(world.hero!.x - beforeX).toBeCloseTo(world.hero!.stats.moveSpeed * DT, 5);
        expect(Math.abs(world.hero!.z)).toBeLessThan(1e-6);
      }
    }
    tickUntil(world, () => bState.squad.every((s) => s.state === 'idle'), 4);
    expect(world.hero!.x).toBeCloseTo(3, 4);
  });

  it('has zero sideways drift toward the centreline when ordered to move along the road shoulder', () => {
    const world = new SimWorld(makeLevel(STRAIGHT_JSON), new EventBus(), { heroId: 'wren', heroLevel: 1 });
    // First position Wren on the road shoulder at (-3, +0.85).
    expect(world.commandHeroMove(-3, 0.85)).toBe(true);
    tickUntil(world, () => world.hero!.state === 'idle');
    expect(world.hero!.x).toBeCloseTo(-3, 4);
    expect(world.hero!.z).toBeCloseTo(0.85, 4);

    // Now move parallel to the road along the shoulder from (-3, +0.85) to (+3, +0.85) (6.0u > 1.4u),
    // and also test a 1.6u step from (+3, +0.85) to (+4.6, +0.85).
    for (const targetX of [3, 4.6]) {
      expect(world.commandHeroMove(targetX, 0.85)).toBe(true);
      let maxDriftZ = 0;
      while (world.hero!.state === 'moving') {
        world.fixedTick(DT);
        maxDriftZ = Math.max(maxDriftZ, Math.abs(world.hero!.z - 0.85));
      }
      expect(maxDriftZ).toBeLessThan(1e-4);
      expect(world.hero!.x).toBeCloseTo(targetX, 4);
      expect(world.hero!.z).toBeCloseTo(0.85, 4);
    }
  });

  it('does not get pushed backwards or dragged sideways by crowd spread while co-fighting an enemy', () => {
    const world = new SimWorld(makeLevel(STRAIGHT_JSON), new EventBus(), { heroId: 'bran', heroLevel: 1 });
    const barracks = world.placeTowerOnPlot(0, 'barracks')!;
    const bState = world.soldierSystem.getBarracks(barracks.id)!;
    expect(world.commandHeroMove(bState.rallyX, bState.rallyZ)).toBe(true);
    tickUntil(world, () => world.hero!.state === 'idle' && bState.squad.every((s) => s.state === 'idle'));

    const dRally = world.groundPath.nearestDist(bState.rallyX, bState.rallyZ);
    const e1 = spawnAtDist(world, 'grunt', dRally - 0.3, 0, 9000);
    const e2 = spawnAtDist(world, 'grunt', dRally - 0.4, 0, 9000);
    tickUntil(world, () => world.hero!.state === 'fighting' && e1.blockers > 0 && e2.blockers > 0);

    const fightX = world.hero!.x;
    const fightZ = world.hero!.z;
    // As `SoldierSystem.applyBlockedSpread` eases `e1`/`e2` laterally and backwards across the road,
    // Bran holds his ground with zero backward push or lateral slide!
    for (let i = 0; i < 45; i++) {
      world.fixedTick(DT);
      expect(world.hero!.state).toBe('fighting');
      expect(world.hero!.x).toBeCloseTo(fightX, 6);
      expect(world.hero!.z).toBeCloseTo(fightZ, 6);
    }
  });

  it('does not prematurely peel off into engaging when spare soldiers exist or upstream heavies enter outer hero reach', () => {
    const world = new SimWorld(makeLevel(STRAIGHT_JSON), new EventBus(), { heroId: 'bran', heroLevel: 7 });
    world.gold = 5000;
    const barracks = world.placeTowerOnPlot(0, 'barracks')!;
    const bState = world.soldierSystem.getBarracks(barracks.id)!;
    expect(world.commandHeroMove(bState.rallyX, bState.rallyZ)).toBe(true);
    tickUntil(world, () => world.hero!.state === 'idle' && bState.squad.every((s) => s.state === 'idle'));

    // Soldier 0 and Bran both fight frontmost Reed Piper while Soldier 1 remains idle at the post.
    const dRally = world.groundPath.nearestDist(bState.rallyX, bState.rallyZ);
    const piper = spawnAtDist(world, 'reedpiper', dRally - 0.3, 0, 900);
    tickUntil(world, () => world.hero!.state === 'fighting' && piper.blockers >= 1);
    expect(world.hero!.targetUid).toBe(piper.uid);

    // Upstream Kilnback (`holdCost = 2`) + Grunts cross Bran's 2.1u engage circle before Soldier 1's 1.7u reach:
    // Bran must stay in `'fighting'` on `piper` (keeping extra holds active) rather than resetting to `'engaging'`.
    spawnAtDist(world, 'kilnback', dRally - 1.95, 0, 1200);
    spawnAtDist(world, 'grunt', dRally - 1.9, 0, 900);
    spawnAtDist(world, 'grunt', dRally - 1.85, 0, 900);
    world.fixedTick(DT);
    expect(world.hero!.state).toBe('fighting');
    expect(world.hero!.targetUid).toBe(piper.uid);
  });

  it('maintains monotonic heading (no end-of-walk overshoot backtrack or facing flip) across diagonal verge walks', () => {
    const world = new SimWorld(makeLevel(STRAIGHT_JSON), new EventBus(), { heroId: 'bran', heroLevel: 1 });
    expect(world.commandHeroMove(1.95, 0.9)).toBe(true);
    tickUntil(world, () => world.hero!.state === 'idle');

    // Move left-up across the road from (1.95, +0.9) to (1.80, -0.9) (dx = -0.15, dz = -1.80, dist = 1.806u > 1.4u).
    expect(world.commandHeroMove(1.8, -0.9)).toBe(true);
    let prevX = world.hero!.x;
    while (world.hero!.state === 'moving') {
      world.fixedTick(DT);
      // Must move monotonically left (dx <= 0) and keep facing left (sin(yaw) < 0) without overshooting to x = 1.60!
      expect(world.hero!.x).toBeLessThanOrEqual(prevX + 1e-9);
      expect(Math.sin(world.hero!.yaw)).toBeLessThan(0);
      prevX = world.hero!.x;
    }
    expect(world.hero!.x).toBeCloseTo(1.8, 4);
    expect(world.hero!.z).toBeCloseTo(-0.9, 4);
    expect(Math.sin(world.hero!.yaw)).toBeLessThan(0);
  });

  it('preserves zero invariant violations and bit-exact replay determinism across move-while-engaged & co-blocking', () => {
    const level = makeLevel(STRAIGHT_JSON);
    const events = new EventBus();
    const world = new SimWorld(level, events, {
      heroId: 'bran',
      heroLevel: 10,
      seed: 20261121,
      recordCommands: true,
    });
    const monitor = new InvariantMonitor(world, events);

    expect(world.placeTowerOnPlot(0, 'barracks')).not.toBeNull();
    expect(world.placeTowerOnPlot(1, 'archer')).not.toBeNull();
    expect(world.commandHeroMove(0, 0.4)).toBe(true);
    expect(world.startNextWave()).toBe(true);

    for (let t = 1; t <= 360 && world.outcome === 'ongoing'; t++) {
      if (t === 90) world.commandHeroMove(-3.5, -0.5);
      if (t === 150) world.castHeroSkill(0, -4.5, 0);
      if (t === 210) world.commandHeroMove(0.2, 0.3);
      if (t === 260) world.castHeroSkill(1);
      monitor.beginTick(t);
      world.fixedTick(DT);
      monitor.endTick(t, DT);
    }

    expect(monitor.violations).toEqual([]);
    const expectedHash = computeSimStateHash(world);
    const replay = parseSimReplay(serializeSimReplay(world.exportReplay()))!;
    expect(replay).not.toBeNull();

    const player = new SimReplayPlayer(level, replay);
    const res = player.runToEnd();
    expect(res.matchesOutcome).toBe(true);
    expect(res.matchesHash).toBe(true);
    expect(computeSimStateHash(player.world)).toBe(expectedHash);
    player.dispose();
    world.dispose();
  });
});
