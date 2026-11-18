import { describe, expect, it } from 'vitest';
import { hashWorldState } from '../../qa/bot/hash.ts';
import { runQaBotSuite } from '../../qa/bot/index.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { HERO_RULES } from '../../src/data/heroes.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { getLevelById, LEVEL_L1C, LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { parseLevel2D, type Level2DJson } from '../../src/data/levels2d/loader.ts';
import { SimWorld } from '../../src/sim/world.ts';

const DT = BALANCE.fixedDt;

/**
 * Two entrances whose roads pass 3.4u apart (within 1.2 + 1.2 + 1.4 = 3.8u shoulder-to-shoulder
 * Euclidean distance, NOT connected until the merge far to the east at x = +6).
 *Image 1000x500 @ 50 px/u => world [-10..+10] x [-5..+5].
 * - Lane 0: z = -1.7 (y = 165) from x = -8 to x = +6, then merges to goal (+8, 0).
 * - Lane 1: z = +1.7 (y = 335) from x = -8 to x = +6, then merges to goal (+8, 0).
 */
const CHASM_PARALLEL_JSON: Level2DJson = {
  id: 'chasm-parallel',
  image: 'chasm-parallel',
  imageSize: [1000, 500],
  safeArea: [0, 0, 1000, 500],
  entrances: [
    { id: 'A', x: 100, y: 165 },
    { id: 'B', x: 100, y: 335 },
  ],
  goal: [900, 250],
  paths: [
    [
      [100, 165],
      [800, 165],
      [900, 250],
    ],
    [
      [100, 335],
      [800, 335],
      [900, 250],
    ],
  ],
  plots: [
    [500, 110],
    [500, 390],
  ],
  flightPath: [
    [100, 250],
    [900, 250],
  ],
};

function chasmLevel(): LevelDef {
  return {
    ...LEVEL_L1C,
    id: 'chasm-parallel',
    layout2d: parseLevel2D(CHASM_PARALLEL_JSON),
    waves: [
      {
        clearBonus: 20,
        groups: [{ enemyType: 'grunt', count: 1, spawnInterval: 1, startDelay: 0, lane: 0 }],
      },
    ],
  };
}

describe('QA bot regression & invariant unit tests', () => {
  it('GroundGraph never shortcuts across a narrow chasm between two unconnected road verges', () => {
    const world = new SimWorld(chasmLevel(), new EventBus(), { heroId: 'wren', heroLevel: 1 });
    // Walk onto Lane 0's inner verge at (-5, -0.5) (1.2u from z = -1.7).
    expect(world.commandHeroMove(-5, -0.5)).toBe(true);
    for (let i = 0; i < 60 * 12 && world.hero!.state === 'moving'; i++) {
      world.fixedTick(DT);
    }
    expect(world.hero!.x).toBeCloseTo(-5, 1);
    expect(world.hero!.z).toBeCloseTo(-0.5, 1);

    // Now command move to (-5, +0.5) on Lane 1's inner verge (Euclidean gap is 1.0u <= 1.4u,
    // but across an unconnected 3.4u chasm!). Hero must route east through the merge around x = +6!
    expect(world.commandHeroMove(-5, 0.5)).toBe(true);
    let maxEastX = -Infinity;
    for (let i = 0; i < 60 * 20 && world.hero!.state === 'moving'; i++) {
      world.fixedTick(DT);
      if (world.hero!.x > maxEastX) maxEastX = world.hero!.x;
      const c = world.heroSystem.groundGraph.clampToGround(world.hero!.x, world.hero!.z, Infinity);
      expect(Math.hypot(world.hero!.x - c.roadX, world.hero!.z - c.roadZ)).toBeLessThanOrEqual(
        HERO_RULES.maxOffRoadDist + 0.06,
      );
    }
    expect(maxEastX).toBeGreaterThan(5.0);
  });

  it('Tobb Deploy Gizmo avoids landing on any build plot across all 17 2D islands even when aimed directly onto plots', () => {
    for (const level of LEVELS_2D) {
      const world = new SimWorld(level, new EventBus(), { heroId: 'tobb', heroLevel: 20 });
      const plots = world.grid.plots!;
      const minClearance = world.grid.plotRadius * 1.15;

      for (let p = 0; p < plots.length; p++) {
        const plot = plots[p];
        // Teleport Tobb onto the nearest road beside this plot and cast Deploy Gizmo directly at the plot centre!
        const road = world.heroSystem.groundGraph.clampToGround(plot.x, plot.z, 0);
        world.hero!.x = world.hero!.prevX = road.x;
        world.hero!.z = world.hero!.prevZ = road.z;
        world.hero!.skillCooldowns[0] = 0;

        expect(world.castHeroSkill(0, plot.x, plot.z)).toBe(true);
        for (const g of world.heroSystem.gizmos) {
          for (let q = 0; q < plots.length; q++) {
            const dist = Math.hypot(g.x - plots[q].x, g.z - plots[q].z);
            expect(
              dist,
              `${level.id} gizmo aimed at plot ${p} overlapped plot ${q} (dist=${dist.toFixed(3)})`,
            ).toBeGreaterThanOrEqual(minClearance);
          }
        }
      }
    }
  });

  it('balances enemyBlocked and enemyUnblocked when Bran dies on the exact tick he blocks an enemy, and alongside soldiers', () => {
    const events = new EventBus();
    const activeBlocked = new Set<number>();
    let doubleBlocks = 0;
    events.on('enemyBlocked', (e) => {
      if (activeBlocked.has(e.enemyId)) doubleBlocks++;
      activeBlocked.add(e.enemyId);
    });
    events.on('enemyUnblocked', (e) => {
      activeBlocked.delete(e.enemyId);
    });
    events.on('enemyKilled', (e) => {
      activeBlocked.delete(e.enemyId);
    });

    const world = new SimWorld(LEVEL_L1C, events, { heroId: 'bran', heroLevel: 1 });
    world.gold = 2000;
    const barracks = world.placeTowerOnPlot(2, 'barracks')!;
    const bState = world.soldierSystem.getBarracks(barracks.id)!;

    // Put Bran at 1 HP right on the barracks rally point so he blocks alongside soldiers and dies immediately.
    world.commandHeroMove(bState.rallyX, bState.rallyZ);
    for (let i = 0; i < 60 * 10 && world.hero!.state === 'moving'; i++) {
      world.fixedTick(DT);
    }
    world.hero!.hp = 1;

    const foe = world.enemySystem.spawnEnemy('brute', 4, true, 0)!;
    const lane0 = world.enemySystem.getPath(false, 0);
    const dRally = lane0.nearestDist(bState.rallyX, bState.rallyZ);
    const v = { x: 0, y: 0, z: 0 };
    lane0.sample(dRally - 0.1, v);
    foe.dist = dRally - 0.1;
    foe.x = foe.prevX = v.x;
    foe.z = foe.prevZ = v.z;
    world.spatialHash.insert(foe.poolIndex, foe.x, foe.z);

    for (let i = 0; i < 60 * 15; i++) {
      world.fixedTick(DT);
      if (foe.active && foe.hp > 0 && foe.blockers + foe.heroBlockers === 0) {
        expect(activeBlocked.has(foe.uid)).toBe(false);
      }
    }
    expect(doubleBlocks).toBe(0);
  });

  it('cleans up mid-flight projectiles, burn zones, fire rings, and pools on victory and world.dispose()', () => {
    const world = new SimWorld(chasmLevel(), new EventBus(), { heroId: 'mira', heroLevel: 12 });
    world.gold = 5000;
    const mortar = world.placeTowerOnPlot(0, 'mortar')!;
    world.upgradeTower(mortar.id);
    world.upgradeTower(mortar.id);
    const archer = world.placeTowerOnPlot(1, 'archer')!;
    world.upgradeTower(archer.id);
    world.upgradeTower(archer.id);

    world.startNextWave();
    world.castHeroSkill(0, 0, -1.7); // spawn Mira Fire Ring
    world.castAbility('meteor', 0, -1.7);

    for (let i = 0; i < 60 * 30 && world.outcome === 'ongoing'; i++) {
      world.fixedTick(DT);
    }
    expect(world.outcome).toBe('won');
    expect(world.enemyPool.getActiveCount()).toBe(0);
    expect(world.projectilePool.getActiveCount()).toBe(0);
    expect(world.projectileSystem.getActiveBurnZoneCount()).toBe(0);
    expect(world.heroSystem.fireRings).toHaveLength(0);

    world.dispose();
    expect(world.towers).toHaveLength(0);
    expect(world.soldierSystem.soldiers).toHaveLength(0);
  });

  it('hashWorldState detects 1-ULP state changes and matches across deterministic replays', () => {
    const makeWorld = (): SimWorld => {
      const w = new SimWorld(getLevelById('l1c')!, new EventBus(), {
        heroId: 'wren',
        heroLevel: 10,
        seed: 4242,
      });
      w.placeTowerOnPlot(0, 'archer');
      w.startNextWave();
      for (let i = 0; i < 300; i++) w.fixedTick(DT);
      return w;
    };

    const w1 = makeWorld();
    const w2 = makeWorld();
    const h1 = hashWorldState(w1);
    expect(hashWorldState(w2)).toBe(h1);

    // Mutate hero x by 1e-12 -> hash must change.
    w2.hero!.x += 1e-12;
    expect(hashWorldState(w2)).not.toBe(h1);
  });

  it('runs quick headless QA bot slice cleanly across l1c and i10 with 0 violations', async () => {
    const summary = await runQaBotSuite({
      quick: true,
      levelIds: ['l1c', 'i10'],
      jobs: 1,
    });
    expect(summary.totalScenarios).toBeGreaterThanOrEqual(12);
    expect(summary.failedScenarios).toBe(0);
    expect(summary.determinismReplays).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
