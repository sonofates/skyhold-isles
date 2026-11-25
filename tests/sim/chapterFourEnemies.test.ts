import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { EnemyType, TowerType } from '../../src/core/types.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import {
  CHAPTER4_ENEMY_DEFS,
  CHAPTER4_ENEMY_MELEE,
  CHAPTER4_ENEMY_TYPES,
  ENEMY_DEFS,
  ENEMY_TYPES,
} from '../../src/data/enemies.ts';
import { ENDLESS_UNSCALED_TYPES } from '../../src/data/endlessMutators.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { I16 } from '../../src/data/levels2d/i16.ts';
import { ENEMY_MELEE } from '../../src/data/soldiers.ts';
import { towerStats } from '../../src/data/towers.ts';
import { DATA_TR } from '../../src/i18n/dataTr.ts';
import { resolveEnemyType } from '../../src/render2d/artResolve.ts';
import { enemyArtFor, parseManifest } from '../../src/render2d/manifest.ts';
import { ENEMY_LORE } from '../../src/ui/content/codexData.ts';
import { ENEMY_BADGE_META, ENEMY_ICON_SVGS } from '../../src/ui/icons.ts';
import type { EnemyEntity, TowerEntity } from '../../src/sim/entities.ts';
import { computeSimStateHash } from '../../src/sim/replay.ts';
import { buildEndlessWaveDef, ENDLESS_CHAPTER4_SPOTLIGHTS, hasChapterFourEnemies } from '../../src/sim/waveSystem.ts';
import { SimWorld } from '../../src/sim/world.ts';

const DT = BALANCE.fixedDt;
const RIME = CHAPTER4_ENEMY_DEFS.rimebeetle.ability;
const GUARD = CHAPTER4_ENEMY_DEFS.sledguard.ability;
const GLACIER = CHAPTER4_ENEMY_DEFS.glacier_warden.ability;
const noop = (): void => {};
const ROOT = resolve(import.meta.dirname, '../..');
const M = parseManifest(JSON.parse(readFileSync(resolve(ROOT, 'public/art2d/manifest.json'), 'utf8')) as Record<string, unknown>);
const onDisk = (p: string): boolean => existsSync(resolve(ROOT, 'public/art2d', p));

/** A 2D plot island (I16) with every plot built as `type` and plenty of gold. */
function plotWorld(type: TowerType = 'archer', plots = Infinity) {
  const events = new EventBus();
  const world = new SimWorld(I16, events);
  world.gold = 999_999;
  const count = Math.min(plots, I16.layout2d!.plots.length);
  for (let p = 0; p < count; p++) world.placeTowerOnPlot(p, type);
  return { world, events };
}

/** Enemy pass only (tower timers are ticked by CombatSystem, not here). */
function enemyStep(world: SimWorld, seconds: number): void {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) world.enemySystem.update(DT, noop, noop, world.towers, 1);
}

function parkAt(world: SimWorld, e: EnemyEntity, dist: number): void {
  e.dist = dist;
  e.speed = 0;
  world.enemySystem.update(DT, noop, noop, world.towers, 1);
}

function near(t: TowerEntity, x: number, z: number): number {
  return Math.hypot(t.x - x, t.z - z);
}

describe('chapter four roster wiring', () => {
  it.each(CHAPTER4_ENEMY_TYPES)('%s: defs, melee and bestiary slot', (type) => {
    expect(ENEMY_DEFS[type]).toBe(CHAPTER4_ENEMY_DEFS[type]);
    expect(ENEMY_MELEE[type]).toBe(CHAPTER4_ENEMY_MELEE[type]);
    expect(ENEMY_TYPES).toContain(type);
    // Bestiary order: ordinary foes before the bosses, the bosses last.
    if (ENEMY_DEFS[type].isBoss) expect(ENEMY_TYPES.indexOf(type)).toBeGreaterThan(ENEMY_TYPES.indexOf('tempest'));
    else expect(ENEMY_TYPES.indexOf(type)).toBeLessThan(ENEMY_TYPES.indexOf('tempest'));
  });

  it.each(CHAPTER4_ENEMY_TYPES)('%s: codex lore, HUD badge + glyph and Turkish text', (type) => {
    expect(ENEMY_LORE[type].blurb.length).toBeGreaterThan(10);
    expect(ENEMY_LORE[type].counter).toBe(CHAPTER4_ENEMY_DEFS[type].counterHint);
    expect(ENEMY_BADGE_META[type].label).toBeTruthy();
    expect(ENEMY_ICON_SVGS[type]).toContain('<svg');
    expect(DATA_TR.enemies[type]?.name).toBeTruthy();
    expect(DATA_TR.enemies[type]?.desc).toBeTruthy();
    expect(DATA_TR.enemies[type]?.counter).toBeTruthy();
  });

  it.each(CHAPTER4_ENEMY_TYPES)('%s: own manifest art; a tinted placeholder until the files land, then its own', (type) => {
    expect(enemyArtFor(M, type, false).art).toBe(type);
    const art = M.enemies[type];
    expect(art.file).toBe(`enemy-${type}.webp`);
    expect(art.sheet?.side).toBe(`anim/${type}-walk-side.json`);
    expect(art.death).toBe(`anim/${type}-death.json`);
    expect(art.attack).toBe(`anim/${type}-attack.json`);
    // Today: whatever is drawn has its front file on disk (own art, or the tinted fallback).
    const now = resolveEnemyType(M, type, false, onDisk);
    expect(onDisk(M.enemies[now.key].file), `${type} → ${now.key}`).toBe(true);
    if (!now.own) {
      expect(art.fallback).toBeDefined();
      expect(now.key).toBe(art.fallback!.art);
    }
    // Once the painted files exist the real art wins with no code change.
    expect(resolveEnemyType(M, type, false, () => true)).toMatchObject({ key: type, own: true });
  });

  it('the Glacier Warden is boss-class everywhere bosses are special-cased', () => {
    expect(ENEMY_DEFS.glacier_warden.isBoss).toBe(true);
    expect(ENDLESS_UNSCALED_TYPES).toContain('glacier_warden');
    expect(ENEMY_DEFS.rimebeetle.isBoss).toBeUndefined();
    expect(ENEMY_DEFS.sledguard.isBoss).toBeUndefined();
  });
});

describe('Rime Beetle frost patch', () => {
  it('a dying beetle leaves a patch; towers inside fire 30% slower for 3 s, outside are untouched', () => {
    const { world, events } = plotWorld();
    const patches: { x: number; z: number; radius: number; duration: number }[] = [];
    events.on('frostPatch', (e) => patches.push(e));
    // Park the beetle where at least one tower is inside the patch radius and one is outside.
    const beetle = world.enemySystem.spawnEnemy('rimebeetle')!;
    let best = 0;
    let bestCount = -1;
    for (let d = 2; d < world.groundPath.totalLength - 2; d += 0.5) {
      parkAt(world, beetle, d);
      const inside = world.towers.filter((t) => near(t, beetle.x, beetle.z) <= RIME.patchRadius).length;
      if (inside > bestCount && inside < world.towers.length) {
        best = d;
        bestCount = inside;
      }
    }
    expect(bestCount).toBeGreaterThan(0);
    parkAt(world, beetle, best);
    const at = { x: beetle.x, z: beetle.z };
    beetle.hp = 0;
    enemyStep(world, DT);
    expect(patches).toHaveLength(1);
    expect(patches[0].radius).toBe(RIME.patchRadius);
    expect(patches[0].duration).toBe(RIME.patchSec);
    expect(world.enemySystem.frostPatchCount).toBe(1);

    // CombatSystem marks the covered towers and drains their cooldown at rateMul.
    for (const t of world.towers) t.cooldownTimer = 10;
    world.combatSystem.update(DT, world.towers);
    for (const t of world.towers) {
      const inside = near(t, at.x, at.z) <= RIME.patchRadius;
      expect(t.frostSlow, `tower ${t.id}`).toBeCloseTo(inside ? 1 - RIME.rateMul : 0);
      expect(10 - t.cooldownTimer, `tower ${t.id}`).toBeCloseTo(DT * (inside ? RIME.rateMul : 1), 9);
    }

    // A second overlapping patch does not stack.
    const second = world.enemySystem.spawnEnemy('rimebeetle')!;
    parkAt(world, second, best);
    second.hp = 0;
    enemyStep(world, DT);
    expect(world.enemySystem.frostPatchCount).toBe(2);
    world.combatSystem.update(DT, world.towers);
    const covered = world.towers.filter((t) => near(t, at.x, at.z) <= RIME.patchRadius);
    for (const t of covered) expect(t.frostSlow).toBeCloseTo(1 - RIME.rateMul);

    // Both patches melt after patchSec; the slow lifts with them.
    enemyStep(world, RIME.patchSec + DT);
    expect(world.enemySystem.frostPatchCount).toBe(0);
    world.combatSystem.update(DT, world.towers);
    for (const t of world.towers) expect(t.frostSlow ?? 0).toBe(0);
  });

  it('only firing towers are slowed (barracks and beacons are not), and a leak leaves no patch', () => {
    const { world } = plotWorld('barracks', 2);
    world.placeTowerOnPlot(2, 'beacon');
    world.enemySystem.frostPatches[0].active = true;
    Object.assign(world.enemySystem.frostPatches[0], { x: 0, z: 0, radius: 999, timeLeft: 3, duration: 3, rateMul: 0.7 });
    world.combatSystem.update(DT, world.towers);
    for (const t of world.towers) expect(t.frostSlow ?? 0).toBe(0);
    world.enemySystem.clearFrostPatches();

    const beetle = world.enemySystem.spawnEnemy('rimebeetle')!;
    beetle.dist = beetle.totalDist - 0.01;
    enemyStep(world, 0.2);
    expect(world.enemySystem.frostPatchCount).toBe(0);
  });

  it('measurably cuts a covered tower’s shots over a long window (fire rate x0.7)', () => {
    const shots = (slowed: boolean): number => {
      const { world, events } = plotWorld('archer', 1);
      const tower = world.towers[0];
      if (slowed) {
        const p = world.enemySystem.frostPatches[0];
        Object.assign(p, { active: true, x: tower.x, z: tower.z, radius: 1, timeLeft: 999, duration: 999, rateMul: RIME.rateMul });
      }
      let fired = 0;
      events.on('towerFired', () => fired++);
      // A tanky dummy parked in reach keeps the tower busy.
      const dummy = world.enemySystem.spawnEnemy('golem', 50)!;
      let bestD = 0;
      let bestR = Infinity;
      for (let d = 1; d < world.groundPath.totalLength - 1; d += 0.25) {
        parkAt(world, dummy, d);
        const r = near(tower, dummy.x, dummy.z);
        if (r < bestR) {
          bestR = r;
          bestD = d;
        }
      }
      parkAt(world, dummy, bestD);
      expect(bestR).toBeLessThan(towerStats(tower).range);
      for (let i = 0; i < Math.round(30 / DT); i++) {
        world.enemySystem.update(DT, noop, noop, world.towers, 1);
        world.combatSystem.update(DT, world.towers);
        dummy.hp = dummy.maxHp;
        if (slowed) world.enemySystem.frostPatches[0].timeLeft = 999;
      }
      return fired;
    };
    const free = shots(false);
    const slowed = shots(true);
    expect(free).toBeGreaterThan(20);
    expect(slowed / free).toBeGreaterThan(RIME.rateMul - 0.05);
    expect(slowed / free).toBeLessThan(RIME.rateMul + 0.05);
  });
});

describe('Sledge Warden shield', () => {
  it('spawns with a separate shield pool of 40% max HP (wave- and elite-scaled)', () => {
    const { world } = plotWorld('archer', 0);
    const plain = world.enemySystem.spawnEnemy('sledguard')!;
    expect(plain.shield).toBe(Math.round(plain.maxHp * GUARD.shieldFrac));
    expect(plain.shieldMax).toBe(plain.shield);
    const elite = world.enemySystem.spawnEnemy('sledguard', 1.5, true)!;
    expect(elite.maxHp).toBeGreaterThan(plain.maxHp * 2);
    expect(elite.shield).toBe(Math.round(elite.maxHp * GUARD.shieldFrac));
  });

  it('absorbs damage before HP; tesla / mortar (breaker) hits deal 2x to the shield only', () => {
    const { world } = plotWorld('archer', 0);
    const sys = world.enemySystem;
    const g = sys.spawnEnemy('sledguard')!;
    const full = g.shield;
    expect(sys.applyDamage(g, 30, true).actualDamage).toBe(0);
    expect(g.shield).toBe(full - 30);
    expect(g.hp).toBe(g.maxHp);
    sys.applyDamage(g, 20, true, true);
    expect(g.shield).toBe(full - 30 - 40);
    // Overflow: the breaker spends 2 points of shield per point of damage, the rest hits HP.
    g.shield = 10;
    const res = sys.applyDamage(g, 20, true, true);
    expect(g.shield).toBe(0);
    expect(res.actualDamage).toBe(15);
    expect(g.hp).toBe(g.maxHp - 15);
    // Armor still applies before the shield.
    g.shield = 50;
    sys.applyDamage(g, 24, false, true);
    expect(g.shield).toBe(50 - 2 * (24 - g.armor));

    // Any other shield (a Warden ward on a grunt) takes breaker hits at 1x.
    const grunt = sys.spawnEnemy('grunt')!;
    grunt.shield = 50;
    grunt.shieldMax = 50;
    sys.applyDamage(grunt, 20, true, true);
    expect(grunt.shield).toBe(30);
  });

  it('refreezes to full after 4 s without damage; any hit restarts the count', () => {
    const { world, events } = plotWorld('archer', 0);
    const sys = world.enemySystem;
    const restored: number[] = [];
    events.on('guardShieldRestored', (e) => restored.push(e.enemyId));
    const g = sys.spawnEnemy('sledguard')!;
    g.speed = 0;
    const full = g.shield;
    sys.applyDamage(g, full + 40, true);
    expect(g.shield).toBe(0);
    expect(g.hp).toBe(g.maxHp - 40);
    enemyStep(world, GUARD.regenSec - 0.25);
    expect(g.shield).toBe(0);
    sys.applyDamage(g, 5, true);
    enemyStep(world, GUARD.regenSec - 0.25);
    expect(g.shield).toBe(0);
    expect(restored).toEqual([]);
    enemyStep(world, 0.5);
    expect(g.shield).toBe(full);
    expect(restored).toEqual([g.uid]);
    // Steady damage (a burn every second) keeps it down for good.
    sys.applyDamage(g, full, true);
    for (let s = 0; s < 12; s++) {
      enemyStep(world, 1);
      sys.applyDamage(g, 1, true);
    }
    expect(g.shield).toBe(0);
  });

  it.each([
    ['tesla', true],
    ['mortar', true],
    ['cannon', false],
    ['archer', false],
  ] as const)('a %s tower hits the shield as breaker=%s', (type, breaker) => {
    const { world } = plotWorld(type);
    const g = world.enemySystem.spawnEnemy('sledguard', 20)!;
    const spy = vi.spyOn(world.enemySystem, 'applyDamage');
    // Walk the road slowly through the defence until some tower lands a hit on the shield.
    for (let i = 0; i < Math.round(60 / DT) && spy.mock.calls.length === 0; i++) world.fixedTick(DT);
    const hits = spy.mock.calls.filter((c) => c[0] === g);
    expect(hits.length).toBeGreaterThan(0);
    for (const c of hits) expect(c[3] === true).toBe(breaker);
  });
});

describe('Glacier Warden phases', () => {
  function bossWorld() {
    const { world, events } = plotWorld('archer');
    const boss = world.enemySystem.spawnEnemy('glacier_warden')!;
    parkAt(world, boss, world.groundPath.totalLength * 0.5);
    const log = { phases: [] as number[], frozen: [] as number[], summons: [] as number[] };
    events.on('bossPhase', (e) => log.phases.push(e.phase));
    events.on('towerFrozen', (e) => log.frozen.push(e.towerId));
    events.on('bossSummon', (e) => log.summons.push(e.count));
    return { world, events, boss, log };
  }

  it('at 66% and 33% HP freezes the nearest (unfrozen) tower for 4 s and summons 3 Rime Beetles behind it', () => {
    const { world, boss, log } = bossWorld();
    const byDist = [...world.towers].sort((a, b) => near(a, boss.x, boss.z) - near(b, boss.x, boss.z) || a.id - b.id);
    const beetles = (): EnemyEntity[] => {
      const out: EnemyEntity[] = [];
      const pool = world.enemyPool;
      for (let i = 0; i < pool.getActiveCount(); i++) {
        const e = pool.items[pool.getActiveIndex(i)];
        if (e.type === 'rimebeetle') out.push(e);
      }
      return out;
    };

    boss.hp = Math.floor(boss.maxHp * 0.7);
    enemyStep(world, 0.1);
    expect(log.phases).toEqual([]);

    boss.hp = Math.floor(boss.maxHp * GLACIER.thresholds[0]);
    enemyStep(world, DT);
    expect(boss.bossPhase).toBe(1);
    expect(log.phases).toEqual([1]);
    expect(log.frozen).toEqual([byDist[0].id]);
    expect(byDist[0].stunTimer).toBe(GLACIER.freezeSec);
    expect(byDist[0].frostLockTimer).toBe(GLACIER.freezeSec);
    expect(log.summons).toEqual([GLACIER.summonCount]);
    expect(beetles()).toHaveLength(GLACIER.summonCount);
    for (const b of beetles()) expect(b.dist).toBeLessThan(boss.dist);

    // No repeat while it stays in the same band.
    enemyStep(world, 0.5);
    expect(log.phases).toEqual([1]);

    // Second threshold: the nearest tower is still frozen, so the next-nearest freezes.
    boss.hp = Math.floor(boss.maxHp * GLACIER.thresholds[1]);
    enemyStep(world, DT);
    expect(boss.bossPhase).toBe(2);
    expect(log.frozen).toEqual([byDist[0].id, byDist[1].id]);
    expect(beetles()).toHaveLength(GLACIER.summonCount * 2);
    enemyStep(world, 1);
    expect(log.phases).toEqual([1, 2]);
  });

  it('one huge hit through both thresholds still plays both phases (one per tick)', () => {
    const { world, boss, log } = bossWorld();
    boss.hp = Math.floor(boss.maxHp * 0.1);
    enemyStep(world, DT);
    expect(log.phases).toEqual([1]);
    enemyStep(world, DT);
    expect(log.phases).toEqual([1, 2]);
    expect(log.summons).toEqual([3, 3]);
  });

  it('a frozen tower does not fire for 4 s, can still be upgraded and sold, and Overcharge thaws it', () => {
    const { world, boss, log } = bossWorld();
    let fired = 0;
    const firedBy = new Set<number>();
    world.events.on('towerFired', (e) => {
      fired++;
      firedBy.add(e.towerId);
    });
    boss.hp = Math.floor(boss.maxHp * 0.6);
    enemyStep(world, DT);
    const frozenId = log.frozen[0];
    const frozen = world.getTowerById(frozenId)!;
    // Keep the boss alive and in reach while towers would fire.
    for (let i = 0; i < Math.round((GLACIER.freezeSec - 0.2) / DT); i++) {
      world.combatSystem.update(DT, world.towers);
      boss.hp = Math.floor(boss.maxHp * 0.6);
    }
    expect(fired).toBeGreaterThan(0);
    expect(firedBy.has(frozenId)).toBe(false);
    expect(frozen.frostLockTimer).toBeGreaterThan(0);
    expect(frozen.frostLockTimer).toBeLessThanOrEqual(frozen.stunTimer);
    // Upgrade works while frozen and keeps it frozen.
    expect(world.upgradeTower(frozenId)).toBe(true);
    expect(frozen.stunTimer).toBeGreaterThan(0);
    // The freeze ends on time with the stun.
    for (let i = 0; i < Math.round(0.4 / DT); i++) world.combatSystem.update(DT, world.towers);
    expect(frozen.stunTimer).toBe(0);
    expect(frozen.frostLockTimer).toBe(0);

    // Phase 2 freeze, then Overcharge: stun and ice block go together.
    boss.hp = Math.floor(boss.maxHp * 0.3);
    enemyStep(world, DT);
    const second = world.getTowerById(log.frozen[1])!;
    expect(second.frostLockTimer).toBe(GLACIER.freezeSec);
    world.abilitySystem.castOvercharge(world.towers);
    world.combatSystem.update(DT, world.towers);
    expect(second.stunTimer).toBe(0);
    expect(second.frostLockTimer).toBe(0);
    // Selling a frozen tower is allowed.
    boss.hp = 1;
    const third = world.towers.find((t) => t.id !== frozenId && t.id !== second.id)!;
    third.stunTimer = 4;
    third.frostLockTimer = 4;
    expect(world.sellTower(third.id)).toBeGreaterThan(0);
  });
});

/** Test-only level: I16's map with a short chapter-four wave list (never registered anywhere). */
function chapterFourTestLevel(): LevelDef {
  const g = (enemyType: EnemyType, count: number, startDelay: number, spawnInterval = 1.2, elite?: boolean) => ({
    enemyType,
    count,
    startDelay,
    spawnInterval,
    ...(elite ? { elite } : {}),
  });
  return {
    ...I16,
    id: 'test-ch4-foes',
    waves: [
      { groups: [g('grunt', 6, 0, 0.9), g('rimebeetle', 4, 2)], clearBonus: 40 },
      { groups: [g('rimebeetle', 6, 0, 0.9), g('sledguard', 2, 3, 2.5)], clearBonus: 45 },
      { groups: [g('sledguard', 3, 0, 2), g('rimebeetle', 6, 1, 0.8), g('runner', 6, 2, 0.5)], clearBonus: 50 },
      { groups: [g('glacier_warden', 1, 0), g('rimebeetle', 4, 4, 1.4), g('sledguard', 2, 6, 3)], clearBonus: 60 },
    ],
  };
}

describe('chapter four test-only level (full SimWorld run)', () => {
  function play(level: LevelDef) {
    const events = new EventBus();
    const world = new SimWorld(level, events);
    world.gold = 6000;
    const types: TowerType[] = ['tesla', 'mortar', 'archer', 'cannon', 'frost', 'ballista'];
    const plots = level.layout2d!.plots.length;
    for (let p = 0; p < plots; p++) world.placeTowerOnPlot(p, types[p % types.length]);
    for (const t of [...world.towers]) {
      world.upgradeTower(t.id);
      world.upgradeTower(t.id);
    }
    const counts = { frostPatch: 0, restored: 0, frozen: 0, phases: 0, absorb: 0 };
    events.on('frostPatch', () => counts.frostPatch++);
    events.on('guardShieldRestored', () => counts.restored++);
    events.on('towerFrozen', () => counts.frozen++);
    events.on('bossPhase', () => counts.phases++);
    events.on('shieldAbsorb', () => counts.absorb++);
    let slowedTicks = 0;
    world.setAutoWave(true);
    world.startNextWave();
    for (let i = 0; i < Math.round(900 / DT) && world.outcome === 'ongoing'; i++) {
      world.fixedTick(DT);
      if (world.towers.some((t) => (t.frostSlow ?? 0) > 0)) slowedTicks++;
    }
    return { world, counts, slowedTicks };
  }

  it('plays through: patches slow towers, shields absorb, the boss freezes and summons; deterministic', () => {
    const level = chapterFourTestLevel();
    const a = play(level);
    expect(a.world.outcome).not.toBe('ongoing');
    expect(a.counts.frostPatch).toBeGreaterThan(10);
    expect(a.slowedTicks).toBeGreaterThan(0);
    expect(a.counts.absorb).toBeGreaterThan(0);
    expect(a.counts.frozen).toBe(2);
    expect(a.counts.phases).toBe(2);
    expect(Number.isFinite(a.world.gold)).toBe(true);
    const b = play(level);
    expect(computeSimStateHash(b.world)).toBe(computeSimStateHash(a.world));
    expect(b.counts).toEqual(a.counts);
  });

  it('endless on a chapter-four island spotlights the new foes and the Glacier Warden leads the 10th wave', () => {
    const level = chapterFourTestLevel();
    expect(hasChapterFourEnemies(level)).toBe(true);
    expect(hasChapterFourEnemies(I16)).toBe(false);
    const seen = new Set<EnemyType>();
    for (let k = 0; k < ENDLESS_CHAPTER4_SPOTLIGHTS.length; k++) {
      for (const grp of buildEndlessWaveDef(level.waves.length + k, level).groups) seen.add(grp.enemyType);
    }
    expect(seen.has('rimebeetle')).toBe(true);
    expect(seen.has('sledguard')).toBe(true);
    const tenth = buildEndlessWaveDef(level.waves.length + 9, level).groups.map((grp) => grp.enemyType);
    expect(tenth).toContain('glacier_warden');
    expect(tenth).not.toContain('tempest');
    const legacyTenth = buildEndlessWaveDef(I16.waves.length + 9, I16).groups.map((grp) => grp.enemyType);
    expect(legacyTenth).toContain('tempest');
    expect(legacyTenth).not.toContain('glacier_warden');
  });
});
