import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventBus, type GameEventMap } from '../../src/core/eventBus.ts';
import type { EnemyType, HeroId } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import {
  buildLevel20Specialization,
  defaultLevel20Skills,
  defaultSkillsForLevel,
  getHeroDef,
  getHeroSkillNode,
  HERO_DEFS,
  HERO_IDS,
  HERO_LEVEL_XP,
  HERO_MAX_LEVEL,
  HERO_RULES,
  heroSkillPointsForLevel,
  isHeroId,
  resolveHeroStats,
} from '../../src/data/heroes.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { LEVEL_L1C } from '../../src/data/levels2d/index.ts';
import { parseLevel2D, type Level2DJson } from '../../src/data/levels2d/loader.ts';
import { combineRunModifiers } from '../../src/data/runModifiers.ts';
import { sanitizeHeroSkills, xpForRun } from '../../src/render2d/heroes2d.ts';
import type { EnemyEntity } from '../../src/sim/entities.ts';
import { findMergePoint } from '../../src/sim/groundGraph.ts';
import { SimWorld } from '../../src/sim/world.ts';

const DT = BALANCE.fixedDt;

/**
 * Two entrances `(100, 100)` and `(100, 400)` separated by open chasm, merging only at `(650, 250)`
 * before reaching the castle goal at `(900, 250)`. World coords: image 1000x500 @ 50 px/u.
 *  - Entrance A: (-8, -3)
 *  - Entrance B: (-8, +3)
 *  - Merge point: (+3, 0)
 *  - Castle goal: (+8, 0)
 */
const FORK_JSON: Level2DJson = {
  id: 'fork',
  image: 'fork',
  imageSize: [1000, 500],
  safeArea: [0, 0, 1000, 500],
  entrances: [
    { id: 'A', x: 100, y: 100 },
    { id: 'B', x: 100, y: 400 },
  ],
  goal: [900, 250],
  paths: [
    [
      [100, 100],
      [650, 100],
      [650, 250],
      [900, 250],
    ],
    [
      [100, 400],
      [650, 400],
      [650, 250],
      [900, 250],
    ],
  ],
  plots: [
    [500, 180],
    [720, 330],
    [800, 170],
  ],
  flightPath: [
    [100, 250],
    [900, 250],
  ],
};

function forkLevel(): LevelDef {
  return {
    ...LEVEL_L1C,
    id: 'fork',
    layout2d: parseLevel2D(FORK_JSON),
    waves: [
      {
        clearBonus: 20,
        groups: [{ enemyType: 'grunt', count: 2, spawnInterval: 0.8, startDelay: 0, lane: 0 }],
      },
    ],
  };
}

function spawnEnemyAtWorld(
  world: SimWorld,
  type: EnemyType,
  dist: number,
  lane = 0,
  hpOverride?: number,
): EnemyEntity {
  const e = world.enemySystem.spawnEnemy(type, 1, false, lane)!;
  if (hpOverride !== undefined) e.hp = hpOverride;
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

function tickUntil(world: SimWorld, cond: () => boolean, maxSec = 30): number {
  for (let i = 0; i < maxSec * 60; i++) {
    if (cond()) return i;
    world.fixedTick(DT);
  }
  throw new Error('condition never met within timeout');
}

describe('hero data validity & skill-tree DAGs', () => {
  it('defines all 5 spec heroes with starter + progressive island milestones', () => {
    expect(HERO_IDS).toEqual(['bran', 'wren', 'mira', 'tobb', 'sela']);
    expect(isHeroId('bran')).toBe(true);
    expect(isHeroId('nope')).toBe(false);
    expect(HERO_DEFS.bran.unlock).toEqual({ kind: 'starter' });
    expect(HERO_DEFS.wren.unlock).toEqual({ kind: 'islandsCleared', count: 2 });
    expect(HERO_DEFS.mira.unlock).toEqual({ kind: 'islandsCleared', count: 4 });
    expect(HERO_DEFS.tobb.unlock).toEqual({ kind: 'islandsCleared', count: 7 });
    expect(HERO_DEFS.sela.unlock).toEqual({ kind: 'islandsCleared', count: 10 });
  });

  it('has strictly increasing XP thresholds across levels 1..20', () => {
    expect(HERO_LEVEL_XP).toHaveLength(HERO_MAX_LEVEL);
    expect(HERO_LEVEL_XP[0]).toBe(0);
    for (let i = 1; i < HERO_LEVEL_XP.length; i++) {
      expect(HERO_LEVEL_XP[i]).toBeGreaterThan(HERO_LEVEL_XP[i - 1]);
    }
    expect(heroSkillPointsForLevel(1)).toBe(0);
    expect(heroSkillPointsForLevel(20)).toBe(19);
  });

  it('validates 3 branches x 4 tiers + 1 capstone (13 nodes), costs, and DAG prerequisites per hero', () => {
    const globalNodeIds = new Set<string>();

    for (const heroId of HERO_IDS) {
      const def = getHeroDef(heroId);
      expect(def.branches).toHaveLength(3);
      expect(def.actives).toHaveLength(2);
      expect(def.actives[0].slot).toBe(0);
      expect(def.actives[1].slot).toBe(1);
      expect(def.skillTree).toHaveLength(13);

      const branchIds = new Set(def.branches.map((b) => b.id));
      expect(branchIds.size).toBe(3);

      const localById = new Map(def.skillTree.map((n) => [n.id, n]));
      expect(localById.size).toBe(13);

      for (const n of def.skillTree) {
        expect(globalNodeIds.has(n.id), `duplicate node id ${n.id}`).toBe(false);
        globalNodeIds.add(n.id);
        expect(Number.isInteger(n.cost) && n.cost > 0, `${n.id} cost`).toBe(true);
        for (const pid of n.prerequisites) {
          const parent = localById.get(pid);
          expect(parent, `${n.id} missing prereq ${pid}`).toBeDefined();
          expect(parent!.tier).toBeLessThan(n.tier);
        }
      }

      // Each branch has exact tiers 1, 2, 3, 4 chained linearly.
      const tier3Ids: string[] = [];
      for (const b of def.branches) {
        const nodes = def.skillTree.filter((n) => n.branch === b.id).sort((x, y) => x.tier - y.tier);
        expect(nodes.map((n) => n.tier)).toEqual([1, 2, 3, 4]);
        expect(nodes[0].prerequisites).toEqual([]);
        expect(nodes[1].prerequisites).toEqual([nodes[0].id]);
        expect(nodes[2].prerequisites).toEqual([nodes[1].id]);
        expect(nodes[3].prerequisites).toEqual([nodes[2].id]);
        tier3Ids.push(nodes[2].id);
      }

      // Exactly 1 capstone requiring any 2 of the 3 tier-3 branch nodes.
      const capstones = def.skillTree.filter((n) => n.isCapstone);
      expect(capstones).toHaveLength(1);
      const cap = capstones[0];
      expect(cap.tier).toBe(5);
      expect(cap.minPrerequisites).toBe(2);
      expect([...cap.prerequisites].sort()).toEqual([...tier3Ids].sort());

      // Total cost of all 13 nodes exceeds 19 skill points so L20 builds make real choices;
      // defaultLevel20Skills spends exactly 19 points and passes topological validation.
      const totalTreeCost = def.skillTree.reduce((sum, n) => sum + n.cost, 0);
      expect(totalTreeCost).toBeGreaterThan(heroSkillPointsForLevel(HERO_MAX_LEVEL));

      const build20 = defaultLevel20Skills(heroId);
      const buildCost = build20.reduce((sum, id) => sum + (getHeroSkillNode(heroId, id)?.cost ?? 0), 0);
      expect(buildCost).toBe(heroSkillPointsForLevel(HERO_MAX_LEVEL));
      expect(sanitizeHeroSkills(heroId, build20, heroSkillPointsForLevel(HERO_MAX_LEVEL)).sort()).toEqual(
        [...build20].sort(),
      );

      for (const pair of [
        [0, 1],
        [0, 2],
        [1, 2],
      ] as const) {
        const spec = buildLevel20Specialization(heroId, pair);
        const specCost = spec.reduce((sum, id) => sum + (getHeroSkillNode(heroId, id)?.cost ?? 0), 0);
        expect(specCost).toBe(heroSkillPointsForLevel(HERO_MAX_LEVEL));
        expect(sanitizeHeroSkills(heroId, spec, heroSkillPointsForLevel(HERO_MAX_LEVEL)).sort()).toEqual(
          [...spec].sort(),
        );
      }

      for (let lvl = 1; lvl <= HERO_MAX_LEVEL; lvl++) {
        const auto = defaultSkillsForLevel(heroId, lvl);
        const budget = heroSkillPointsForLevel(lvl);
        const spent = auto.reduce((sum, id) => sum + (getHeroSkillNode(heroId, id)?.cost ?? 0), 0);
        expect(spent).toBeLessThanOrEqual(budget);
        expect(sanitizeHeroSkills(heroId, auto, budget)).toEqual(auto);
      }
    }
  });

  it('scales hero stats monotonically from L1 to L20 and applies node patches', () => {
    for (const heroId of HERO_IDS) {
      const s1 = resolveHeroStats(heroId, 1, []);
      const s10 = resolveHeroStats(heroId, 10, []);
      const s20 = resolveHeroStats(heroId, 20, defaultLevel20Skills(heroId));
      expect(s10.maxHp).toBeGreaterThan(s1.maxHp);
      expect(s20.maxHp).toBeGreaterThan(s10.maxHp);
      expect(s10.damage).toBeGreaterThan(s1.damage);
      expect(s20.damage).toBeGreaterThan(s10.damage);
      expect(s20.armor).toBeGreaterThanOrEqual(s1.armor);
    }
  });

  it('uses zero Math.random or DOM/Pixi/Three imports in hero data & sim files', () => {
    const root = join(__dirname, '../..');
    for (const rel of ['src/data/heroes.ts', 'src/sim/groundGraph.ts', 'src/sim/heroSystem.ts']) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src).not.toMatch(/Math\.random/);
      expect(src).not.toMatch(/from ['"](pixi\.js|three)['"]/);
      expect(src).not.toMatch(/\b(document|window|localStorage)\b/);
    }
  });
});

describe('hero castle spawn & ground-graph movement', () => {
  it('stays null when no hero is selected, and spawns at the castle when configured', () => {
    const noHero = new SimWorld(forkLevel(), new EventBus());
    expect(noHero.hero).toBeNull();
    expect(noHero.getHeroState()).toBeNull();
    expect(noHero.commandHeroMove(0, 0)).toBe(false);
    expect(noHero.castHeroSkill(0, 0, 0)).toBe(false);

    const withHero = new SimWorld(forkLevel(), new EventBus(), { heroId: 'bran', heroLevel: 1 });
    expect(withHero.hero).not.toBeNull();
    // Castle goal on forkLevel is (8, 0); spawn sits just inside the castle road threshold.
    expect(Math.hypot(withHero.hero!.x - 8, withHero.hero!.z - 0)).toBeLessThan(1.2);
  });

  it('routes between disconnected road branches via the merge junction instead of cutting across the chasm', () => {
    const events = new EventBus();
    const moved: GameEventMap['heroMoved'][] = [];
    events.on('heroMoved', (e) => moved.push(e));

    const world = new SimWorld(forkLevel(), events, { heroId: 'wren', heroLevel: 1 });
    // First walk from castle (8, 0) to Entrance A (-8, -3).
    expect(world.commandHeroMove(-7.5, -3)).toBe(true);
    expect(moved).toHaveLength(1);
    tickUntil(world, () => world.hero!.state === 'idle', 15);
    expect(world.hero!.x).toBeCloseTo(-7.5, 2);
    expect(world.hero!.z).toBeCloseTo(-3, 2);

    // Now command move to Entrance B (-7.5, +3). Direct straight line would cross x = -7.5, z = 0
    // (empty chasm far from the merge at x = +3). Ground graph routes east along lane A to x ≈ +3,
    // across the merge at (3, 0), and west along lane B!
    expect(world.commandHeroMove(-7.5, 3)).toBe(true);
    expect(moved).toHaveLength(2);
    let maxXDuringCrossing = -Infinity;
    while (world.hero!.state === 'moving') {
      world.fixedTick(DT);
      if (Math.abs(world.hero!.z) < 1.0 && world.hero!.x > maxXDuringCrossing) {
        maxXDuringCrossing = world.hero!.x;
      }
    }
    expect(maxXDuringCrossing).toBeGreaterThan(2.0);
    expect(world.hero!.x).toBeCloseTo(-7.5, 2);
    expect(world.hero!.z).toBeCloseTo(3, 2);
  });

  it('clamps far off-road move commands onto the road shoulder', () => {
    const world = new SimWorld(forkLevel(), new EventBus(), { heroId: 'bran', heroLevel: 1 });
    expect(world.commandHeroMove(0, 25)).toBe(true);
    tickUntil(world, () => world.hero!.state === 'idle', 15);
    // Nearest road to (0, 25) is lane B at z = +3; clamped within HERO_RULES.maxOffRoadDist.
    expect(Math.abs(world.hero!.z - 3)).toBeLessThanOrEqual(HERO_RULES.maxOffRoadDist + 0.05);
  });
});

describe('hero combat, passives, death & respawn', () => {
  it('Bran blocks ground foes like soldiers, applies Bulwark damage reduction, and cleaves when upgraded', () => {
    const events = new EventBus();
    const blocked: number[] = [];
    const attacks: GameEventMap['heroAttack'][] = [];
    events.on('enemyBlocked', (e) => blocked.push(e.enemyId));
    events.on('heroAttack', (e) => attacks.push(e));

    const world = new SimWorld(forkLevel(), events, {
      heroId: 'bran',
      heroLevel: 6,
      heroSkills: ['bran_iron_1', 'bran_iron_2', 'bran_iron_3'],
    });
    const merge = findMergePoint([world.groundPath, ...world.extraGroundPaths]);
    world.commandHeroMove(merge.x, merge.z);
    tickUntil(world, () => world.hero!.state === 'idle', 10);

    const lane0 = world.enemySystem.getPath(false, 0);
    const dMerge = lane0.nearestDist(merge.x, merge.z);
    const e1 = spawnEnemyAtWorld(world, 'grunt', dMerge - 0.5, 0, 5000);
    const e2 = spawnEnemyAtWorld(world, 'grunt', dMerge - 0.8, 0, 5000);
    const flyer = spawnEnemyAtWorld(world, 'flyer', 4, 0, 5000);

    tickUntil(world, () => world.hero!.state === 'fighting', 5);
    tick(world, 90);

    // Both ground grunts are held by Bran (holdCap = 2), flyer is ignored and keeps flying.
    expect(e1.heroBlockers).toBeGreaterThanOrEqual(1);
    expect(e2.heroBlockers).toBeGreaterThanOrEqual(1);
    expect(e1.heroDamageReduction).toBeCloseTo(world.hero!.stats.passive.power, 4);
    expect(flyer.heroBlockers).toBe(0);
    expect(blocked).toContain(e1.uid);
    expect(attacks.some((a) => a.mode === 'melee' && !a.cleave)).toBe(true);
    expect(attacks.some((a) => a.mode === 'melee' && a.cleave)).toBe(true);
  });

  it('Wren shoots ground and flying foes via projectiles and triggers Keen Eye crits on flyers', () => {
    const events = new EventBus();
    const attacks: GameEventMap['heroAttack'][] = [];
    events.on('heroAttack', (e) => attacks.push(e));

    const world = new SimWorld(forkLevel(), events, { heroId: 'wren', heroLevel: 1, seed: 42 });
    world.commandHeroMove(3, 0);
    tickUntil(world, () => world.hero!.state === 'idle', 10);

    const flyer = spawnEnemyAtWorld(world, 'flyer', 9, 0, 5000);
    flyer.speed = 0.25;
    tick(world, 60 * 12);

    expect(attacks.length).toBeGreaterThanOrEqual(8);
    expect(attacks.every((a) => a.mode === 'ranged')).toBe(true);
    expect(attacks.some((a) => a.crit)).toBe(true);
    expect(attacks.some((a) => !a.crit)).toBe(true);
    expect(flyer.hp).toBeLessThan(5000);
    expect(world.hero!.totalDamageDealt).toBeGreaterThan(0);
  });

  it('takes melee damage, dies (heroDied), locks commands while dead, and respawns at the castle (heroRespawn)', () => {
    const events = new EventBus();
    const hits: GameEventMap['heroHit'][] = [];
    const died: GameEventMap['heroDied'][] = [];
    const respawned: GameEventMap['heroRespawn'][] = [];
    events.on('heroHit', (e) => hits.push(e));
    events.on('heroDied', (e) => died.push(e));
    events.on('heroRespawn', (e) => respawned.push(e));

    const world = new SimWorld(forkLevel(), events, { heroId: 'bran', heroLevel: 1 });
    world.commandHeroMove(3, 0);
    tickUntil(world, () => world.hero!.state === 'idle', 10);

    const lane0 = world.enemySystem.getPath(false, 0);
    const dMerge = lane0.nearestDist(3, 0);
    // Spawn an elite high-HP boss so it strikes Bran down quickly.
    const boss = world.enemySystem.spawnEnemy('boss', 6, true, 0)!;
    const v = { x: 0, y: 0, z: 0 };
    lane0.sample(dMerge - 0.3, v);
    boss.dist = dMerge - 0.3;
    boss.x = boss.prevX = v.x;
    boss.z = boss.prevZ = v.z;

    tickUntil(world, () => world.hero!.state === 'dead', 25);
    expect(hits.length).toBeGreaterThan(0);
    expect(died).toHaveLength(1);
    expect(boss.heroBlockers).toBe(0);
    // Dead hero cannot move or cast skills.
    expect(world.commandHeroMove(0, -3)).toBe(false);
    expect(world.castHeroSkill(0, 3, 0)).toBe(false);

    // Advance past respawn timer: respawns at castle spawn point at full HP.
    tickUntil(world, () => world.hero!.state !== 'dead', 20);
    expect(respawned).toHaveLength(1);
    expect(world.hero!.hp).toBe(world.hero!.maxHp);
    expect(world.hero!.x).toBeCloseTo(world.hero!.spawnX, 5);
    expect(world.hero!.z).toBeCloseTo(world.hero!.spawnZ, 5);
  });
});

describe('all 10 hero active skills, passives, and 2D global abilities', () => {
  it('Bran: Shield Bash stuns in cone and Rally Banner buffs nearby barracks soldiers', () => {
    const world = new SimWorld(forkLevel(), new EventBus(), {
      heroId: 'bran',
      heroLevel: 12,
      heroSkills: ['bran_oak_1', 'bran_oak_2', 'bran_oak_3', 'bran_van_1', 'bran_van_2', 'bran_van_3', 'bran_cap'],
    });
    world.gold = 5000;
    const barracks = world.placeTowerOnPlot(1, 'barracks')!;
    const bState = world.soldierSystem.getBarracks(barracks.id)!;
    world.commandHeroMove(bState.rallyX, bState.rallyZ);
    tickUntil(world, () => world.hero!.state === 'idle', 10);

    const lane0 = world.enemySystem.getPath(false, 0);
    const dRally = lane0.nearestDist(bState.rallyX, bState.rallyZ);
    const foe = spawnEnemyAtWorld(world, 'brute', dRally + 0.6, 0, 2000);

    expect(world.castHeroSkill(0, foe.x, foe.z)).toBe(true);
    // Cooldown prevents immediate recast.
    expect(world.castHeroSkill(0, foe.x, foe.z)).toBe(false);
    expect(foe.stunTimer).toBeGreaterThan(1.0);
    expect(foe.slowRatio).toBeGreaterThanOrEqual(0.35); // bashSlow from capstone
    expect(foe.hp).toBeLessThan(2000);

    // Damage a soldier first so Rally Banner capstone heal is also exercised.
    const soldier = bState.squad[0];
    soldier.hp = 50;
    expect(world.castHeroSkill(1)).toBe(true);
    tick(world, 30);
    expect(soldier.bonusArmor).toBeGreaterThan(0);
    expect(soldier.damageMul).toBeGreaterThan(1.2);
    expect(soldier.hp).toBeGreaterThan(50);
  });

  it("Wren: Volley hits ground & flyers and Hunter's Mark amplifies tower damage", () => {
    const world = new SimWorld(forkLevel(), new EventBus(), {
      heroId: 'wren',
      heroLevel: 12,
      heroSkills: ['wren_bow_1', 'wren_bow_2', 'wren_bow_3', 'wren_vol_1', 'wren_vol_2', 'wren_vol_3', 'wren_cap'],
    });
    world.commandHeroMove(3, 0);
    tickUntil(world, () => world.hero!.state === 'idle', 10);

    const lane0 = world.enemySystem.getPath(false, 0);
    const d = lane0.nearestDist(3, 0);
    const grunt = spawnEnemyAtWorld(world, 'grunt', d, 0, 1000);
    const flyer = spawnEnemyAtWorld(world, 'flyer', 11, 0, 1000);

    // Volley + capstone second wave 0.35s later.
    expect(world.castHeroSkill(0, grunt.x, grunt.z)).toBe(true);
    const hpAfterWave1 = grunt.hp;
    expect(hpAfterWave1).toBeLessThan(1000);
    expect(flyer.hp).toBeLessThan(1000);
    tick(world, 30);
    expect(grunt.hp).toBeLessThan(hpAfterWave1);

    // Hunter's Mark boosts damage dealt to the marked target.
    const unmarked = spawnEnemyAtWorld(world, 'brute', d - 2, 0, 2000);
    const marked = spawnEnemyAtWorld(world, 'brute', d + 1, 0, 2000);
    expect(world.castHeroSkill(1, marked.x, marked.z)).toBe(true);
    expect(marked.markTimer).toBeGreaterThan(4);
    const rUnmarked = world.enemySystem.applyDamage(unmarked, 100);
    const rMarked = world.enemySystem.applyDamage(marked, 100);
    expect(rMarked.actualDamage).toBeGreaterThan(rUnmarked.actualDamage);
  });

  it('Mira: Fire Ring scorches area over time and Wisp Burst dashes through enemy lines + Kindling', () => {
    const world = new SimWorld(forkLevel(), new EventBus(), {
      heroId: 'mira',
      heroLevel: 12,
      heroSkills: ['mira_emb_1', 'mira_emb_2', 'mira_emb_3', 'mira_wsp_1', 'mira_wsp_2', 'mira_wsp_3', 'mira_wsp_4', 'mira_cap'],
    });
    world.commandHeroMove(3, 0);
    tickUntil(world, () => world.hero!.state === 'idle', 10);

    const lane0 = world.enemySystem.getPath(false, 0);
    const d = lane0.nearestDist(3, 0);
    const golem = spawnEnemyAtWorld(world, 'golem', d + 1.5, 0, 2500);
    golem.shield = 200;
    golem.shieldMax = 200;

    // Wisp Burst with shatterShields + wispFireRing capstone.
    expect(world.castHeroSkill(1, golem.x, golem.z)).toBe(true);
    expect(golem.shield).toBe(0);
    const hpAfterBurst = golem.hp;
    expect(hpAfterBurst).toBeLessThan(2500);
    expect(world.heroSystem.fireRings.length).toBe(1);

    // Fire Ring + Kindling burn ticks further reduce HP ignoring golem's 12 armor.
    expect(world.castHeroSkill(0, golem.x, golem.z)).toBe(true);
    const hpAfterRingCast = golem.hp;
    golem.speed = 0;
    tick(world, 60);
    expect(golem.hp).toBeLessThan(hpAfterRingCast);
  });

  it('Tobb: Tinker speeds nearby towers, Deploy Gizmo shoots foes, and Overhaul cleanses stun + reloads', () => {
    const world = new SimWorld(forkLevel(), new EventBus(), {
      heroId: 'tobb',
      heroLevel: 14,
      heroSkills: ['tobb_clk_1', 'tobb_clk_2', 'tobb_clk_3', 'tobb_giz_1', 'tobb_giz_2', 'tobb_giz_3', 'tobb_cap'],
    });
    world.gold = 5000;
    const cannon = world.placeTowerOnPlot(1, 'cannon')!;
    world.commandHeroMove(cannon.x, cannon.z - 0.6);
    tickUntil(world, () => world.hero!.state === 'idle', 10);
    tick(world, 2);

    // Tinker passive applies live fire-rate bonus to nearby cannon.
    expect(cannon.heroRateBonus).toBeGreaterThan(0.1);

    // Deploy 2 Gizmos (enabled by Master Gearwright capstone).
    expect(world.castHeroSkill(0, cannon.x + 0.5, cannon.z - 0.8)).toBe(true);
    world.hero!.skillCooldowns[0] = 0;
    expect(world.castHeroSkill(0, cannon.x - 0.5, cannon.z - 0.8)).toBe(true);
    expect(world.heroSystem.gizmos).toHaveLength(2);

    // Stun and put cannon on long cooldown, then cast Overhaul -> instant cleanse + reload + surge.
    cannon.stunTimer = 3.0;
    cannon.cooldownTimer = 1.4;
    expect(world.castHeroSkill(1, cannon.x, cannon.z)).toBe(true);
    expect(cannon.stunTimer).toBe(0);
    expect(cannon.cooldownTimer).toBe(0);
    expect(cannon.overhaulTimer).toBeGreaterThan(4);

    // Gizmos fire projectiles at approaching foes.
    const lane0 = world.enemySystem.getPath(false, 0);
    const d = lane0.nearestDist(cannon.x, cannon.z - 0.8);
    const foe = spawnEnemyAtWorld(world, 'grunt', d, 0, 1500);
    foe.speed = 0;
    tick(world, 60);
    expect(foe.hp).toBeLessThan(1500);
  });

  it('Sela: Calm Waters mends soldiers, Undertow slows packs, and Thunder Call chains lightning', () => {
    const events = new EventBus();
    const chains: GameEventMap['lightningChain'][] = [];
    events.on('lightningChain', (e) => chains.push(e));

    const world = new SimWorld(forkLevel(), events, {
      heroId: 'sela',
      heroLevel: 12,
      heroSkills: ['sela_cal_1', 'sela_cal_2', 'sela_cal_3', 'sela_thn_1', 'sela_thn_2', 'sela_thn_3', 'sela_thn_4', 'sela_cap'],
    });
    world.gold = 5000;
    const barracks = world.placeTowerOnPlot(1, 'barracks')!;
    const bState = world.soldierSystem.getBarracks(barracks.id)!;
    world.commandHeroMove(bState.rallyX, bState.rallyZ);
    tickUntil(world, () => world.hero!.state === 'idle', 10);

    // Hurt soldier is healed by Calm Waters passive and receives Shell Ward armor.
    const soldier = bState.squad[0];
    soldier.hp = 40;
    tick(world, 70);
    expect(soldier.hp).toBeGreaterThan(40);
    expect(soldier.bonusArmor).toBeGreaterThanOrEqual(2);

    // Spawn 3 enemies in range: Undertow slows all 3, Thunder Call chains across all 3 and stuns.
    const lane0 = world.enemySystem.getPath(false, 0);
    const d = lane0.nearestDist(bState.rallyX, bState.rallyZ);
    const e1 = spawnEnemyAtWorld(world, 'brute', d + 1.2, 0, 2000);
    const e2 = spawnEnemyAtWorld(world, 'brute', d + 2.0, 0, 2000);
    const e3 = spawnEnemyAtWorld(world, 'flyer', 12, 0, 2000);

    expect(world.castHeroSkill(0, e1.x, e1.z)).toBe(true);
    expect(e1.slowRatio).toBeGreaterThanOrEqual(0.4);
    expect(e2.slowRatio).toBeGreaterThanOrEqual(0.4);

    expect(world.castHeroSkill(1, e1.x, e1.z)).toBe(true);
    expect(chains).toHaveLength(1);
    expect(chains[0].points.length).toBeGreaterThanOrEqual(4); // Sela + 3 enemies
    expect(e1.hp).toBeLessThan(2000);
    expect(e2.hp).toBeLessThan(2000);
    expect(e3.hp).toBeLessThan(2000);
    expect(e1.stunTimer).toBeGreaterThan(0);
  });

  it('casts global Meteor and Overcharge via castAbility on 2D plot maps and reports cooldown state', () => {
    const events = new EventBus();
    let meteors = 0;
    let overcharges = 0;
    events.on('meteorImpact', () => meteors++);
    events.on('overchargeActivated', () => overcharges++);

    const mods = combineRunModifiers({ abilityCooldownMul: 0.85 });
    const world = new SimWorld(LEVEL_L1C, events, mods, { heroId: 'bran', heroLevel: 1 });
    world.gold = 1000;
    const archer = world.placeTowerOnPlot(0, 'archer')!;

    // Blocked before wave 1 starts.
    expect(world.getAbilityState('meteor').usable).toBe(false);
    expect(world.castAbility('meteor', 0, 0)).toBe(false);

    world.startNextWave();
    expect(world.getAbilitiesState()).toHaveLength(2);
    expect(world.getAbilityState('meteor').usable).toBe(true);
    expect(world.getAbilityState('overcharge').usable).toBe(true);

    const foe = spawnEnemyAtWorld(world, 'brute', 4, 0, 800);
    foe.speed = 0;
    archer.stunTimer = 2.5;

    expect(world.castAbility('meteor', foe.x, foe.z)).toBe(true);
    expect(world.castAbility('overcharge')).toBe(true);
    expect(archer.stunTimer).toBe(0);
    expect(overcharges).toBe(1);
    expect(world.getAbilityState('meteor').ready).toBe(false);
    expect(world.getAbilityState('meteor').maxCooldown).toBeCloseTo(30 * 0.85, 5);
    expect(world.getAbilityState('overcharge').activeRemaining).toBeGreaterThan(6);

    tick(world, 30);
    expect(meteors).toBe(1);
    expect(foe.hp).toBeLessThan(800);
  });
});

describe('in-run hero XP & bit-exact seed determinism', () => {
  it('emits heroXpGained on kills, wave clears, and victory matching xpForRun()', () => {
    const events = new EventBus();
    const xpEvents: GameEventMap['heroXpGained'][] = [];
    events.on('heroXpGained', (e) => xpEvents.push(e));

    const world = new SimWorld(forkLevel(), events, { heroId: 'wren', heroLevel: 5 });
    world.gold = 5000;
    const t = world.placeTowerOnPlot(1, 'archer')!;
    world.upgradeTower(t.id);
    world.upgradeTower(t.id);
    world.commandHeroMove(3, 0);
    world.startNextWave();

    tickUntil(world, () => world.outcome === 'won', 40);
    expect(xpEvents.some((e) => e.source === 'kill')).toBe(true);
    expect(xpEvents.some((e) => e.source === 'wave')).toBe(true);
    expect(xpEvents.some((e) => e.source === 'victory')).toBe(true);

    const expected = xpForRun({
      won: true,
      stars: world.computeStars(),
      enemiesKilled: world.enemiesKilledTotal,
      wavesCleared: forkLevel().waves.length,
    });
    expect(world.heroSystem.runXp).toBe(expected);
  });

  it('produces identical state and event logs for identical seeds, and varies crits across seeds', () => {
    function simulate(heroId: HeroId, seed: number): string {
      const events = new EventBus();
      const log: string[] = [];
      events.on('heroMoved', (e) => log.push(`M:${e.targetX.toFixed(2)},${e.targetZ.toFixed(2)}`));
      events.on('heroAttack', (e) => log.push(`A:${e.targetEnemyId}:${e.damage}:${e.crit ? 1 : 0}`));
      events.on('heroSkillCast', (e) => log.push(`S:${e.slot}:${e.skillId}`));
      events.on('heroXpGained', (e) => log.push(`X:${e.source}:${e.totalRunXp}`));

      const world = new SimWorld(LEVEL_L1C, events, {
        heroId,
        heroLevel: 12,
        heroSkills: defaultLevel20Skills(heroId).slice(0, 8),
        seed,
      });
      world.gold = 1200;
      world.placeTowerOnPlot(0, 'archer');
      world.placeTowerOnPlot(2, 'barracks');
      const merge = findMergePoint([world.groundPath, ...world.extraGroundPaths]);
      world.commandHeroMove(merge.x, merge.z);
      world.startNextWave();

      for (let step = 0; step < 60 * 35 && world.outcome === 'ongoing'; step++) {
        if (world.waveSystem.state === 'betweenWaves') world.startNextWave();
        if (step === 60 * 6) world.castHeroSkill(0, merge.x - 1, merge.z);
        if (step === 60 * 9) world.castHeroSkill(1, merge.x - 1, merge.z);
        world.fixedTick(DT);
      }

      return JSON.stringify({
        gold: world.gold,
        lives: world.lives,
        kills: world.enemiesKilledTotal,
        hero: world.getHeroState(),
        log,
      });
    }

    expect(simulate('wren', 12345)).toBe(simulate('wren', 12345));
    expect(simulate('mira', 999)).toBe(simulate('mira', 999));

    // Different seeds produce deterministic differences in Keen Eye crit rolls against flyers.
    function critSignature(seed: number): string {
      const events = new EventBus();
      const crits: number[] = [];
      events.on('heroAttack', (e) => crits.push(e.crit ? 1 : 0));
      const world = new SimWorld(forkLevel(), events, { heroId: 'wren', heroLevel: 1, seed });
      world.commandHeroMove(3, 0);
      tickUntil(world, () => world.hero!.state === 'idle', 10);
      const f = spawnEnemyAtWorld(world, 'flyer', 9, 0, 9999);
      f.speed = 0.2;
      tick(world, 60 * 15);
      return crits.join('');
    }

    expect(critSignature(101)).toBe(critSignature(101));
    expect(critSignature(101)).not.toBe(critSignature(202));
  });
});
