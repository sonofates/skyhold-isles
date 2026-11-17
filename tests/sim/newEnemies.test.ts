import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import type { EnemyType } from '../../src/core/types.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { ELITE_MODIFIERS, ENEMY_DEFS, ENEMY_TYPES } from '../../src/data/enemies.ts';
import { LEVELS } from '../../src/data/levels/index.ts';
import type { LevelDef } from '../../src/data/levels/index.ts';
import type { EnemyEntity } from '../../src/sim/entities.ts';
import { CompiledPath } from '../../src/sim/path.ts';
import { buildEndlessWaveDef, ENDLESS_SPOTLIGHTS } from '../../src/sim/waveSystem.ts';
import { SimWorld } from '../../src/sim/world.ts';
import { ENEMY_BADGE_META } from '../../src/ui/icons.ts';

const DT = BALANCE.fixedDt;
const NEW_TYPES: EnemyType[] = ['warden', 'burrower', 'carrier', 'blinker', 'golem', 'mite', 'hexer'];

function makeWorld(level: LevelDef = LEVELS[0]): { world: SimWorld; events: EventBus } {
  const events = new EventBus();
  const world = new SimWorld(level, events);
  return { world, events };
}

function tick(
  world: SimWorld,
  seconds: number,
  onKill: (e: EnemyEntity) => void = () => {},
  onLeak: (e: EnemyEntity) => void = () => {},
): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    world.enemySystem.update(DT, onLeak, onKill);
  }
}

function activeEnemies(world: SimWorld): EnemyEntity[] {
  const out: EnemyEntity[] = [];
  for (let i = 0; i < world.enemyPool.getActiveCount(); i++) {
    out.push(world.enemyPool.items[world.enemyPool.getActiveIndex(i)]);
  }
  return out;
}

function inSpatialHash(world: SimWorld, e: EnemyEntity): boolean {
  const out: number[] = [];
  world.spatialHash.query(e.x, e.z, 1, out);
  return out.includes(e.poolIndex);
}

describe('new enemy registry', () => {
  it('registers every new archetype with defs, badge meta and descriptions', () => {
    for (const type of NEW_TYPES) {
      expect(ENEMY_TYPES).toContain(type);
      const def = ENEMY_DEFS[type];
      expect(def.type).toBe(type);
      expect(def.maxHp).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(10);
      expect(def.counterHint?.length ?? 0).toBeGreaterThan(10);
      expect(ENEMY_BADGE_META[type].label.length).toBeGreaterThan(0);
    }
    // Boss stays last so menus / debug lists keep it at the end.
    expect(ENEMY_TYPES[ENEMY_TYPES.length - 1]).toBe('boss');
    expect(ENEMY_DEFS.carrier.flying).toBe(true);
  });
});

describe('CompiledPath.nearestDist', () => {
  it('projects points onto the closest segment', () => {
    const path = new CompiledPath(
      [
        { col: 0, row: 0 },
        { col: 4, row: 0 },
        { col: 4, row: 4 },
      ],
      5,
      5,
      0,
      false,
    );
    const p = { x: 0, y: 0, z: 0 };
    path.sample(3, p);
    expect(path.nearestDist(p.x, p.z + 0.5)).toBeCloseTo(3, 5);
    path.sample(11, p);
    expect(path.nearestDist(p.x + 0.7, p.z)).toBeCloseTo(11, 5);
    expect(path.nearestDist(-100, -100)).toBe(0);
  });
});

describe('Aegis Warden', () => {
  it('shields nearby allies (not itself) and shields absorb post-armor damage first', () => {
    const { world, events } = makeWorld();
    const warden = world.enemySystem.spawnEnemy('warden')!;
    const grunt = world.enemySystem.spawnEnemy('grunt')!;
    const pulses: number[] = [];
    events.on('wardPulse', (e) => pulses.push(e.shieldedCount));

    tick(world, 1.3);
    expect(pulses).toEqual([1]);
    expect(warden.shield).toBe(0);
    expect(grunt.shield).toBe(ENEMY_DEFS.warden.wardShield);
    expect(grunt.shieldMax).toBe(grunt.shield);

    const broken: number[] = [];
    const absorbs: number[] = [];
    events.on('shieldBroken', (e) => broken.push(e.enemyId));
    events.on('shieldAbsorb', (e) => absorbs.push(e.amount));
    const hpBefore = grunt.hp;
    const shield0 = grunt.shield;
    const res1 = world.enemySystem.applyDamage(grunt, 20);
    expect(res1.actualDamage).toBe(0);
    expect(grunt.hp).toBe(hpBefore);
    expect(grunt.shield).toBe(shield0 - 20);

    const res2 = world.enemySystem.applyDamage(grunt, 20);
    expect(res2.actualDamage).toBe(40 - shield0);
    expect(grunt.shield).toBe(0);
    expect(broken).toEqual([grunt.uid]);
    expect(absorbs).toEqual([20, shield0 - 20]);
  });

  it('scales the barrier with the warden HP scale and does not stack beyond it', () => {
    const { world } = makeWorld();
    world.enemySystem.spawnEnemy('warden', 2);
    const grunt = world.enemySystem.spawnEnemy('grunt')!;
    tick(world, 1.3);
    expect(grunt.shield).toBe(Math.round(ENEMY_DEFS.warden.wardShield! * 2));
    tick(world, ENEMY_DEFS.warden.wardInterval!);
    expect(grunt.shield).toBe(Math.round(ENEMY_DEFS.warden.wardShield! * 2));
  });
});

describe('Loam Burrower', () => {
  it('dives out of the spatial hash, is immune underground, moves faster, then resurfaces', () => {
    const { world, events } = makeWorld();
    const b = world.enemySystem.spawnEnemy('burrower')!;
    const burrowEvents: boolean[] = [];
    events.on('enemyBurrow', (e) => burrowEvents.push(e.burrowed));

    tick(world, 1.0);
    expect(b.burrowed).toBe(false);
    expect(inSpatialHash(world, b)).toBe(true);

    tick(world, 0.7);
    expect(b.burrowed).toBe(true);
    expect(burrowEvents).toEqual([true]);
    expect(inSpatialHash(world, b)).toBe(false);

    const hp = b.hp;
    expect(world.enemySystem.applyDamage(b, 500, true)).toEqual({ actualDamage: 0, killed: false });
    expect(b.hp).toBe(hp);
    world.enemySystem.applySlow(b, 0.5, 2);
    expect(b.slowRatio).toBe(0);

    const d0 = b.dist;
    tick(world, 0.5);
    const undergroundSpeed = (b.dist - d0) / 0.5;
    expect(undergroundSpeed).toBeCloseTo(
      ENEMY_DEFS.burrower.speed * ENEMY_DEFS.burrower.burrowSpeedMul!,
      1,
    );

    tick(world, ENEMY_DEFS.burrower.burrowDiveSec!);
    expect(b.burrowed).toBe(false);
    expect(burrowEvents).toEqual([true, false]);
    expect(inSpatialHash(world, b)).toBe(true);
  });

  it('never starts a dive close to the goal', () => {
    const { world } = makeWorld();
    const b = world.enemySystem.spawnEnemy('burrower')!;
    b.dist = b.totalDist - 3.5;
    b.abilityTimer = 0.01;
    tick(world, 0.2);
    expect(b.burrowed).toBe(false);
  });

  it('never reaches the goal underground, whatever its dive phase (incl. slowed dives)', () => {
    for (const level of LEVELS) {
      for (let phase = 0; phase < 24; phase++) {
        const { world } = makeWorld(level);
        const b = world.enemySystem.spawnEnemy('burrower', 1, false, level.extraGroundPaths ? 1 : 0)!;
        b.dist = Math.max(0, b.totalDist - 14 - phase * 0.37);
        b.abilityTimer = (phase % 6) * 0.3 + 0.01;
        let leakedBurrowed: boolean | null = null;
        for (let i = 0; i < 60 * 30 && leakedBurrowed === null; i++) {
          if (phase % 3 === 0 && i < 90 && !b.burrowed) world.enemySystem.applySlow(b, 0.55, 1.5);
          world.enemySystem.update(DT, (l) => (leakedBurrowed = l.burrowed), () => {});
        }
        expect(leakedBurrowed).toBe(false);
      }
    }
  });

  it('pops up at once if it is still underground near the goal', () => {
    const { world, events } = makeWorld();
    const b = world.enemySystem.spawnEnemy('burrower')!;
    const ev: boolean[] = [];
    events.on('enemyBurrow', (e) => ev.push(e.burrowed));
    b.burrowed = true;
    b.abilityTimer = 1.0;
    b.dist = b.totalDist - 2.5;
    tick(world, DT);
    expect(b.burrowed).toBe(false);
    expect(ev).toEqual([false]);
  });
});

describe('Cloud Hauler', () => {
  it('drops raiders onto the nearest ground point (never ahead of the goal margin) on death', () => {
    const { world, events } = makeWorld();
    const c = world.enemySystem.spawnEnemy('carrier', 1.5)!;
    tick(world, 2.0);
    const drops: Array<{ count: number }> = [];
    events.on('carrierDrop', (e) => drops.push({ count: e.count }));
    const nearest = world.groundPath.nearestDist(c.x, c.z);

    world.enemySystem.applyDamage(c, 99999, true);
    const killed: EnemyType[] = [];
    world.enemySystem.update(DT, () => {}, (e) => killed.push(e.type));
    expect(killed).toEqual(['carrier']);
    expect(drops).toEqual([{ count: 2 }]);

    const raiders = activeEnemies(world);
    expect(raiders).toHaveLength(2);
    const expectedHp = Math.round(
      ENEMY_DEFS.grunt.maxHp * ENEMY_DEFS.carrier.dropHpFrac! * 1.5,
    );
    for (const r of raiders) {
      expect(r.type).toBe('grunt');
      expect(r.isDropped).toBe(true);
      expect(r.flying).toBe(false);
      expect(r.maxHp).toBe(expectedHp);
      expect(r.reward).toBe(2);
      expect(r.dist).toBeLessThanOrEqual(nearest + 0.2);
    }
  });

  it('clamps the landing point away from the goal', () => {
    const { world } = makeWorld();
    const c = world.enemySystem.spawnEnemy('carrier')!;
    c.dist = c.totalDist - 0.3;
    tick(world, DT);
    world.enemySystem.applyDamage(c, 99999, true);
    world.enemySystem.update(DT, () => {}, () => {});
    for (const r of activeEnemies(world)) {
      // (+ one tick of walking after landing)
      expect(r.dist).toBeLessThanOrEqual(world.groundPath.totalLength - 3 + 0.1);
    }
  });

  it('still drops a raider into its own freed slot when the enemy pool is full', () => {
    const { world, events } = makeWorld();
    const c = world.enemySystem.spawnEnemy('carrier', 1.5)!;
    tick(world, 2.0);
    const wreckX = c.x;
    const wreckZ = c.z;
    while (world.enemySystem.spawnEnemy('grunt')) {
      // fill every remaining slot
    }
    const full = world.enemyPool.getActiveCount();
    let drop: { count: number; x: number; z: number } | null = null;
    events.on('carrierDrop', (e) => (drop = { count: e.count, x: e.x, z: e.z }));
    world.enemySystem.applyDamage(c, 99999, true);
    world.enemySystem.update(DT, () => {}, () => {});
    // The hauler's slot went to the first raider (the second has no room).
    expect(drop).toEqual({ count: 1, x: wreckX, z: wreckZ });
    expect(world.enemyPool.getActiveCount()).toBe(full);
    const raiders = activeEnemies(world).filter((e) => e.isDropped);
    expect(raiders).toHaveLength(1);
    expect(raiders[0].maxHp).toBe(Math.round(ENEMY_DEFS.grunt.maxHp * ENEMY_DEFS.carrier.dropHpFrac! * 1.5));
  });
});

describe('Rift Blinker', () => {
  it('teleports forward after its charge, and chill delays the charge', () => {
    const { world, events } = makeWorld();
    const fast = world.enemySystem.spawnEnemy('blinker')!;
    const blinks: number[] = [];
    events.on('enemyBlink', (e) => blinks.push(e.enemyId));
    const interval = ENEMY_DEFS.blinker.blinkInterval!;

    tick(world, interval - 0.1);
    expect(blinks).toEqual([]);
    const before = fast.dist;
    for (let i = 0; i < 20 && blinks.length === 0; i++) tick(world, DT);
    expect(blinks).toEqual([fast.uid]);
    expect(fast.dist - before).toBeGreaterThan(ENEMY_DEFS.blinker.blinkDistance!);
    // Renderer must not interpolate across the jump.
    expect(fast.prevX).toBe(fast.x);
    expect(fast.prevZ).toBe(fast.z);

    const { world: w2, events: ev2 } = makeWorld();
    const chilled = w2.enemySystem.spawnEnemy('blinker')!;
    const blinks2: number[] = [];
    ev2.on('enemyBlink', (e) => blinks2.push(e.enemyId));
    for (let i = 0; i < Math.round((interval + 0.2) / DT); i++) {
      w2.enemySystem.applySlow(chilled, 0.5, 1);
      w2.enemySystem.update(DT, () => {}, () => {});
    }
    expect(blinks2).toEqual([]);
  });

  it('never blinks to within the goal margin', () => {
    const { world } = makeWorld();
    const b = world.enemySystem.spawnEnemy('blinker')!;
    b.dist = b.totalDist - 3;
    b.abilityTimer = 0.01;
    tick(world, DT);
    expect(b.dist).toBeLessThanOrEqual(b.totalDist - 2 + 1e-6);
  });
});

describe('Basalt Golem', () => {
  it('has heavy armor that chill cracks for a while, then restores', () => {
    const { world, events } = makeWorld();
    const g = world.enemySystem.spawnEnemy('golem')!;
    const cracks: number[] = [];
    events.on('armorCracked', (e) => cracks.push(e.enemyId));
    expect(g.armor).toBe(12);
    expect(world.enemySystem.applyDamage(g, 18).actualDamage).toBe(6);

    world.enemySystem.applySlow(g, 0.3, 1);
    world.enemySystem.applySlow(g, 0.3, 1);
    expect(cracks).toEqual([g.uid]);
    expect(g.armor).toBe(ENEMY_DEFS.golem.brittleArmor);
    expect(world.enemySystem.applyDamage(g, 18).actualDamage).toBe(15);

    tick(world, ENEMY_DEFS.golem.brittleDuration! + 0.1);
    expect(g.armor).toBe(12);
    expect(g.armorBreakTimer).toBe(0);
  });
});

describe('Scuttle Mite', () => {
  it('is a tiny, fast, cheap swarm unit', () => {
    const def = ENEMY_DEFS.mite;
    expect(def.maxHp).toBeLessThan(ENEMY_DEFS.runner.maxHp);
    expect(def.speed).toBeLessThan(ENEMY_DEFS.runner.speed);
    expect(def.speed).toBeGreaterThan(ENEMY_DEFS.grunt.speed);
    expect(def.reward).toBe(1);
    expect(def.radius).toBeLessThan(0.3);
  });
});

describe('Empowered elites', () => {
  it('spawnEnemy(elite) boosts HP, armor and reward and survives armor restores', () => {
    const { world } = makeWorld();
    const e = world.enemySystem.spawnEnemy('golem', 1.2, true)!;
    expect(e.elite).toBe(true);
    expect(e.maxHp).toBe(Math.round(ENEMY_DEFS.golem.maxHp * 1.2 * ELITE_MODIFIERS.hpMul));
    expect(e.armor).toBe(12 + ELITE_MODIFIERS.armorBonus);
    expect(e.reward).toBe(Math.round(ENEMY_DEFS.golem.reward * ELITE_MODIFIERS.rewardMul));
    world.enemySystem.applySlow(e, 0.3, 1);
    tick(world, 3);
    expect(e.armor).toBe(12 + ELITE_MODIFIERS.armorBonus);
  });

  it('wave groups flagged elite spawn elites through the world tick', () => {
    const base = LEVELS[0];
    const level: LevelDef = {
      ...base,
      waves: [
        {
          clearBonus: 0,
          groups: [{ enemyType: 'grunt', count: 2, spawnInterval: 0.2, startDelay: 0, elite: true }],
        },
      ],
    };
    const { world } = makeWorld(level);
    world.startNextWave();
    for (let i = 0; i < 40; i++) world.fixedTick(DT);
    const spawned = activeEnemies(world);
    expect(spawned).toHaveLength(2);
    expect(spawned.every((e) => e.elite)).toBe(true);
  });

  it('wave preview reports how many of each type are elites', () => {
    const level: LevelDef = {
      ...LEVELS[0],
      waves: [
        {
          clearBonus: 0,
          groups: [
            { enemyType: 'brute', count: 3, spawnInterval: 1, startDelay: 0 },
            { enemyType: 'brute', count: 2, spawnInterval: 1, startDelay: 0, elite: true },
            { enemyType: 'grunt', count: 4, spawnInterval: 1, startDelay: 0 },
          ],
        },
      ],
    };
    const { world } = makeWorld(level);
    expect(world.waveSystem.getNextWavePreview()?.items).toEqual([
      { enemyType: 'brute', count: 5, eliteCount: 2 },
      { enemyType: 'grunt', count: 4 },
    ]);
  });

  it('a freshly re-used pool slot does not inherit elite/shield/burrow state', () => {
    const { world } = makeWorld();
    const e = world.enemySystem.spawnEnemy('burrower', 1, true)!;
    e.shield = 40;
    e.burrowed = true;
    e.hp = 0;
    e.burrowed = false;
    world.enemySystem.update(DT, () => {}, () => {});
    const fresh = world.enemySystem.spawnEnemy('grunt')!;
    expect(fresh.poolIndex).toBe(e.poolIndex);
    expect(fresh.elite).toBe(false);
    expect(fresh.shield).toBe(0);
    expect(fresh.burrowed).toBe(false);
    expect(fresh.armor).toBe(0);
  });
});

describe('endless spotlight variety', () => {
  it('cycles every new archetype through endless waves deterministically, with elites later', () => {
    const level = LEVELS[0];
    const seen = new Set<EnemyType>();
    let firstEliteOffset = -1;
    for (let offset = 0; offset < ENDLESS_SPOTLIGHTS.length; offset++) {
      const waveIndex = level.waves.length + offset;
      const def = buildEndlessWaveDef(waveIndex, level);
      expect(buildEndlessWaveDef(waveIndex, level)).toEqual(def);
      for (const g of def.groups) {
        seen.add(g.enemyType);
        expect(g.count).toBeGreaterThan(0);
        if (g.elite && firstEliteOffset < 0) firstEliteOffset = offset;
      }
    }
    for (const t of NEW_TYPES) expect(seen.has(t)).toBe(true);
    expect(firstEliteOffset).toBe(3);
  });

  it('deals endless groups across every spawn lane on multi-lane islands', () => {
    const multi = LEVELS.find((l) => (l.extraGroundPaths?.length ?? 0) > 0)!;
    expect(multi).toBeDefined();
    const lanes = new Set<number>();
    for (const g of buildEndlessWaveDef(multi.waves.length, multi).groups) lanes.add(g.lane ?? 0);
    expect([...lanes].sort()).toEqual([0, 1]);
    for (const g of buildEndlessWaveDef(LEVELS[0].waves.length, LEVELS[0]).groups) {
      expect(g.lane ?? 0).toBe(0);
    }
  });

  it('every second endless boss wave is led by a Tempest Colossus', () => {
    const level = LEVELS[0];
    const at = (offset: number): Map<EnemyType, number> => {
      const m = new Map<EnemyType, number>();
      for (const g of buildEndlessWaveDef(level.waves.length + offset, level).groups) {
        m.set(g.enemyType, (m.get(g.enemyType) ?? 0) + g.count);
      }
      return m;
    };
    expect(at(4).get('boss')).toBe(1);
    expect(at(4).has('tempest')).toBe(false);
    expect(at(9).get('tempest')).toBe(1);
    expect(at(9).get('boss')).toBe(1);
    expect(at(14).get('boss')).toBe(3);
    expect(at(19).get('tempest')).toBe(1);
    expect(at(19).get('boss')).toBe(3);
  });
});

describe('Tempest Colossus (phase boss)', () => {
  function placeTowersNear(world: SimWorld, boss: EnemyEntity, n: number): void {
    world.gold = 99999;
    let placed = 0;
    for (let r = 0; r < world.level.rows && placed < n; r++) {
      for (let c = 0; c < world.level.cols && placed < n; c++) {
        if (!world.grid.canPlaceTower(c, r)) continue;
        const dx = world.grid.gridToWorldX(c) - boss.x;
        const dz = world.grid.gridToWorldZ(r) - boss.z;
        if (dx * dx + dz * dz < 6 * 6 && world.placeTower(c, r, 'archer')) placed++;
      }
    }
  }

  it('raises a Stormwall at 66% (self + ally barrier, short channel), enrages at 33%', () => {
    const { world, events } = makeWorld();
    const boss = world.enemySystem.spawnEnemy('tempest')!;
    const ally = world.enemySystem.spawnEnemy('grunt')!;
    tick(world, 0.5);
    const phases: number[] = [];
    events.on('bossPhase', (e) => phases.push(e.phase));
    const hits: boolean[] = [];
    events.on('enemyHit', (e) => hits.push(e.isBoss));

    world.enemySystem.applyDamage(boss, Math.ceil(boss.maxHp * 0.35), true);
    expect(hits).toEqual([true]);
    tick(world, DT);
    expect(phases).toEqual([1]);
    expect(boss.shield).toBe(Math.round(boss.maxHp * ENEMY_DEFS.tempest.stormwallSelfFrac!));
    expect(ally.shield).toBe(Math.round(ally.maxHp * ENEMY_DEFS.tempest.stormwallAllyFrac!));

    // Channelling: stands still for the channel duration.
    const d0 = boss.dist;
    tick(world, 1.0);
    expect(boss.dist).toBe(d0);
    tick(world, 0.6);
    expect(boss.dist).toBeGreaterThan(d0);

    const baseSpeed = boss.speed;
    const before = world.enemyPool.getActiveCount();
    world.enemySystem.applyDamage(boss, boss.shield + Math.ceil(boss.maxHp * 0.35), true);
    tick(world, DT);
    expect(phases).toEqual([1, 2]);
    expect(boss.speed).toBeCloseTo(baseSpeed * ENEMY_DEFS.tempest.enrageSpeedMul!, 6);
    expect(world.enemyPool.getActiveCount() - before).toBe(ENEMY_DEFS.tempest.enrageSummonCount);
  });

  it('a single huge hit runs both phases in order', () => {
    const { world, events } = makeWorld();
    const boss = world.enemySystem.spawnEnemy('tempest')!;
    const phases: number[] = [];
    events.on('bossPhase', (e) => phases.push(e.phase));
    world.enemySystem.applyDamage(boss, Math.ceil(boss.maxHp * 0.8), true);
    tick(world, DT);
    expect(phases).toEqual([1, 2]);
    expect(boss.hp).toBeGreaterThan(0);
  });

  it('jams nearby towers on a cadence once enraged', () => {
    const { world, events } = makeWorld();
    const boss = world.enemySystem.spawnEnemy('tempest')!;
    for (let i = 0; i < 120; i++) world.enemySystem.update(DT, () => {}, () => {});
    placeTowersNear(world, boss, 3);
    expect(world.towers.length).toBeGreaterThanOrEqual(2);
    const pulses: number[] = [];
    events.on('bossPulse', (e) => pulses.push(e.stunnedTowerIds.length));
    const step = (s: number): void => {
      for (let i = 0; i < Math.round(s / DT); i++) {
        world.enemySystem.update(DT, () => {}, () => {}, world.towers, 1);
      }
    };
    step(3);
    expect(pulses).toEqual([]);
    world.enemySystem.applyDamage(boss, Math.ceil(boss.maxHp * 0.8), true);
    step(1.5);
    expect(pulses).toEqual([2]);
    boss.speed = 0; // keep it parked within range of the test towers
    step(ENEMY_DEFS.tempest.jamInterval! + 0.1);
    expect(pulses).toEqual([2, 2]);
  });
});
