import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EnemyType, TowerType } from '../../src/core/types.ts';
import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import {
  CHAPTER4_ENEMY_DEFS,
  CHAPTER5_ENEMY_DEFS,
  CHAPTER5_ENEMY_MELEE,
  CHAPTER5_ENEMY_TYPES,
  ENEMY_DEFS,
  ENEMY_TYPES,
} from '../../src/data/enemies.ts';
import { ENDLESS_UNSCALED_TYPES } from '../../src/data/endlessMutators.ts';
import type { LevelDef } from '../../src/data/levels/types.ts';
import { I16 } from '../../src/data/levels2d/i16.ts';
import { getLevelById, LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { ENEMY_MELEE } from '../../src/data/soldiers.ts';
import { towerStats } from '../../src/data/towers.ts';
import { DATA_TR } from '../../src/i18n/dataTr.ts';
import { resolveEnemyType } from '../../src/render2d/artResolve.ts';
import { enemyArtFor, parseManifest } from '../../src/render2d/manifest.ts';
import type { EnemyEntity, TowerEntity } from '../../src/sim/entities.ts';
import { computeSimStateHash } from '../../src/sim/replay.ts';
import { acquireTarget, attackReach } from '../../src/sim/targeting.ts';
import {
  buildEndlessWaveDef,
  ENDLESS_CHAPTER5_SPOTLIGHTS,
  hasChapterFiveEnemies,
  hasChapterFourEnemies,
} from '../../src/sim/waveSystem.ts';
import { SimWorld } from '../../src/sim/world.ts';
import { allEnemyEntries, ENEMY_LORE } from '../../src/ui/content/codexData.ts';
import { SightingQueue } from '../../src/ui/content/firstSighting.ts';
import { ENEMY_BADGE_META, ENEMY_ICON_SVGS } from '../../src/ui/icons.ts';

const DT = BALANCE.fixedDt;
const PACK = CHAPTER5_ENEMY_DEFS.duskhound.ability;
const VEIL = CHAPTER5_ENEMY_DEFS.veilcaster.ability;
const SOV = CHAPTER5_ENEMY_DEFS.eclipse_sovereign.ability;
const noop = (): void => {};
const ROOT = resolve(import.meta.dirname, '../..');
const M = parseManifest(JSON.parse(readFileSync(resolve(ROOT, 'public/art2d/manifest.json'), 'utf8')) as Record<string, unknown>);
const onDisk = (p: string): boolean => existsSync(resolve(ROOT, 'public/art2d', p));

/** A 2D plot island (I16) with the first `plots` plots built as `type` and plenty of gold. */
function plotWorld(type: TowerType = 'archer', plots = Infinity) {
  const events = new EventBus();
  const world = new SimWorld(I16, events);
  world.gold = 999_999;
  const count = Math.min(plots, I16.layout2d!.plots.length);
  for (let p = 0; p < count; p++) world.placeTowerOnPlot(p, type);
  return { world, events };
}

/** Enemy pass only (tower timers and range cuts are ticked by CombatSystem, not here). */
function enemyStep(world: SimWorld, seconds: number): void {
  const frames = Math.max(1, Math.round(seconds / DT));
  for (let i = 0; i < frames; i++) world.enemySystem.update(DT, noop, noop, world.towers, 1);
}

/** Enemy pass + tower pass (veils tick down, range cuts are applied, towers fire). */
function bothStep(world: SimWorld, seconds: number): void {
  const frames = Math.max(1, Math.round(seconds / DT));
  for (let i = 0; i < frames; i++) {
    world.enemySystem.update(DT, noop, noop, world.towers, 1);
    world.combatSystem.update(DT, world.towers);
  }
}

function parkAt(world: SimWorld, e: EnemyEntity, dist: number): void {
  e.dist = dist;
  e.speed = 0;
  world.enemySystem.update(DT, noop, noop, world.towers, 1);
}

function near(t: TowerEntity, x: number, z: number): number {
  return Math.hypot(t.x - x, t.z - z);
}

function active(world: SimWorld, type?: EnemyType): EnemyEntity[] {
  const out: EnemyEntity[] = [];
  const pool = world.enemyPool;
  for (let i = 0; i < pool.getActiveCount(); i++) {
    const e = pool.items[pool.getActiveIndex(i)];
    if (e.active && (!type || e.type === type)) out.push(e);
  }
  return out;
}

const FIRING = (t: TowerEntity): boolean => t.type !== 'barracks' && t.type !== 'beacon';

describe('chapter five roster wiring', () => {
  it.each(CHAPTER5_ENEMY_TYPES)('%s: defs, melee and bestiary slot', (type) => {
    expect(ENEMY_DEFS[type]).toBe(CHAPTER5_ENEMY_DEFS[type]);
    expect(ENEMY_MELEE[type]).toBe(CHAPTER5_ENEMY_MELEE[type]);
    expect(ENEMY_TYPES).toContain(type);
    // Bestiary order: ordinary foes before the bosses, the bosses last, the Dreadnought very last.
    if (ENEMY_DEFS[type].isBoss) expect(ENEMY_TYPES.indexOf(type)).toBeGreaterThan(ENEMY_TYPES.indexOf('glacier_warden'));
    else expect(ENEMY_TYPES.indexOf(type)).toBeLessThan(ENEMY_TYPES.indexOf('tempest'));
    expect(ENEMY_TYPES[ENEMY_TYPES.length - 1]).toBe('boss');
  });

  it.each(CHAPTER5_ENEMY_TYPES)('%s: codex lore, HUD badge + glyph and Turkish text', (type) => {
    expect(ENEMY_LORE[type].blurb.length).toBeGreaterThan(10);
    expect(ENEMY_LORE[type].blurb.length).toBeLessThanOrEqual(90);
    expect(ENEMY_LORE[type].counter).toBe(CHAPTER5_ENEMY_DEFS[type].counterHint);
    expect(ENEMY_BADGE_META[type].label).toBeTruthy();
    expect(ENEMY_ICON_SVGS[type]).toContain('<svg');
    expect(DATA_TR.enemies[type]?.name).toBeTruthy();
    expect(DATA_TR.enemies[type]?.desc).toBeTruthy();
    expect(DATA_TR.enemies[type]?.counter).toBeTruthy();
    for (const tag of ENEMY_LORE[type].tags) expect(DATA_TR.tags[tag], tag).toBeTruthy();
  });

  it.each(CHAPTER5_ENEMY_TYPES)('%s: own manifest art; a tinted placeholder until the files land, then its own', (type) => {
    expect(enemyArtFor(M, type, false).art).toBe(type);
    const art = M.enemies[type];
    expect(art.file).toBe(`enemy-${type}.webp`);
    expect(art.back).toBe(`enemy-${type}-back.webp`);
    expect(art.sheet?.side).toBe(`anim/${type}-walk-side.json`);
    expect(art.death).toBe(`anim/${type}-death.json`);
    expect(art.attack).toBe(`anim/${type}-attack.json`);
    // Today: whatever is drawn has its front file on disk (own art, or the tinted fallback chain).
    const now = resolveEnemyType(M, type, false, onDisk);
    expect(onDisk(M.enemies[now.key].file), `${type} → ${now.key}`).toBe(true);
    if (!now.own) {
      expect(art.fallback).toBeDefined();
      expect(now.chain[1]).toBe(art.fallback!.art);
    }
    // Once the painted files exist the real art wins with no code change.
    expect(resolveEnemyType(M, type, false, () => true)).toMatchObject({ key: type, own: true });
  });

  it('the Shadow Halves fall back to the Sovereign art first (art id eclipse_shade)', () => {
    expect(M.enemies.eclipse_shade.fallback?.art).toBe('eclipse_sovereign');
    // Sovereign painted, halves still pending → the halves draw the (tinted) Sovereign.
    const sovereignOnly = (p: string): boolean => !p.includes('eclipse_shade') && (p.includes('eclipse_sovereign') || onDisk(p));
    expect(resolveEnemyType(M, 'eclipse_shade', false, sovereignOnly)).toMatchObject({ key: 'eclipse_sovereign', own: false });
  });

  it('the Sovereign and its halves are boss-class everywhere bosses are special-cased', () => {
    for (const type of ['eclipse_sovereign', 'eclipse_shade'] as const) {
      expect(ENEMY_DEFS[type].isBoss).toBe(true);
      expect(ENDLESS_UNSCALED_TYPES).toContain(type);
    }
    expect(ENEMY_DEFS.duskhound.isBoss).toBeUndefined();
    expect(ENEMY_DEFS.veilcaster.isBoss).toBeUndefined();
  });

  it('the Shadow Half is part of the Sovereign: no codex tile, no first-sighting card', () => {
    expect(ENEMY_DEFS.eclipse_shade.partOf).toBe('eclipse_sovereign');
    const ids = allEnemyEntries().map((e) => e.id);
    expect(ids).toContain('eclipse_sovereign');
    expect(ids).not.toContain('eclipse_shade');
    const seen = new Set<string>();
    const q = new SightingQueue({ hasSeen: (id) => seen.has(id), markSeen: (id) => (seen.has(id) ? false : (seen.add(id), true)) });
    expect(q.offerEnemy('eclipse_shade')).toBe(false);
    expect(q.offerEnemy('eclipse_sovereign')).toBe(true);
  });

  it('balance vs chapter four is as documented (handoff-ch5-foes.md)', () => {
    // Hound: a pack walker between the Belfry Hare and the Rime Beetle.
    expect(ENEMY_DEFS.duskhound.maxHp).toBeLessThan(CHAPTER4_ENEMY_DEFS.rimebeetle.maxHp);
    // Sovereign: one step above the Glacier Warden; both halves together pay its bounty.
    expect(ENEMY_DEFS.eclipse_sovereign.maxHp).toBeGreaterThan(CHAPTER4_ENEMY_DEFS.glacier_warden.maxHp);
    expect(ENEMY_DEFS.eclipse_sovereign.livesCost).toBeGreaterThan(CHAPTER4_ENEMY_DEFS.glacier_warden.livesCost);
    expect(ENEMY_DEFS.eclipse_shade.reward * 2).toBe(ENEMY_DEFS.eclipse_sovereign.reward);
    expect(ENEMY_DEFS.eclipse_shade.livesCost * 2).toBe(ENEMY_DEFS.eclipse_sovereign.livesCost);
    expect(ENEMY_DEFS.eclipse_shade.maxHp).toBe(Math.round(ENEMY_DEFS.eclipse_sovereign.maxHp * SOV!.splitAt * SOV!.splitHpFrac));
  });
});

describe('Dusk Hound pack enrage', () => {
  /** Five parked hounds: four a tile apart (one pack) and one far away (> pack radius). */
  function pack() {
    const { world, events } = plotWorld('archer', 0);
    const enrages: number[] = [];
    events.on('packEnrage', (e) => enrages.push(e.count));
    const len = world.groundPath.totalLength;
    const base = 1;
    const hounds = [0, 1, 2, 3].map((k) => {
      const h = world.enemySystem.spawnEnemy('duskhound')!;
      parkAt(world, h, base + k * 1.2);
      return h;
    });
    // The far hound: the road point furthest (in a straight line) from the pack.
    const far = world.enemySystem.spawnEnemy('duskhound')!;
    let farDist = -1;
    let farR = 0;
    for (let d = base + 4; d < len - 1; d += 0.5) {
      parkAt(world, far, d);
      const r = Math.min(...hounds.map((h) => Math.hypot(far.x - h.x, far.z - h.z)));
      if (r > farR) {
        farR = r;
        farDist = d;
      }
    }
    expect(farR).toBeGreaterThan(PACK!.radius + 1);
    parkAt(world, far, farDist);
    return { world, hounds, far, enrages };
  }

  it('a fallen hound enrages the pack within 5 tiles (+30%, 4 s); stacks twice at most, refreshed per death', () => {
    const { world, hounds, far, enrages } = pack();
    hounds[0].hp = 0;
    enemyStep(world, DT);
    expect(enrages).toEqual([3]);
    for (const h of hounds.slice(1)) {
      expect(h.enrageStacks).toBe(1);
      expect(h.enrageTimer).toBe(PACK!.enrageSec);
    }
    expect(far.enrageStacks).toBe(0);

    enemyStep(world, 1);
    hounds[1].hp = 0;
    enemyStep(world, DT);
    for (const h of hounds.slice(2)) {
      expect(h.enrageStacks).toBe(2);
      expect(h.enrageTimer).toBe(PACK!.enrageSec);
    }
    // A third death refreshes the timer but never adds a third stack.
    enemyStep(world, 1);
    hounds[2].hp = 0;
    enemyStep(world, DT);
    expect(hounds[3].enrageStacks).toBe(PACK!.maxStacks);
    expect(hounds[3].enrageTimer).toBe(PACK!.enrageSec);
    expect(enrages).toEqual([3, 2, 1]);
    // ... and it all lapses after enrageSec without another death.
    enemyStep(world, PACK!.enrageSec + DT);
    expect(hounds[3].enrageStacks).toBe(0);
    expect(hounds[3].enrageTimer).toBe(0);
    expect(far.enrageStacks).toBe(0);
  });

  it('an enraged hound runs +30% per stack', () => {
    const { world } = plotWorld('archer', 0);
    const plain = world.enemySystem.spawnEnemy('duskhound')!;
    const mad = world.enemySystem.spawnEnemy('duskhound')!;
    plain.dist = mad.dist = 2;
    mad.enrageStacks = 2;
    mad.enrageTimer = PACK!.enrageSec;
    const p0 = plain.dist;
    const m0 = mad.dist;
    enemyStep(world, 1);
    expect((mad.dist - m0) / (plain.dist - p0)).toBeCloseTo(1 + PACK!.speedBonus * 2, 6);
  });

  it('a hound that leaks (not killed) enrages nobody', () => {
    const { world, hounds, enrages } = pack();
    hounds[3].dist = hounds[3].totalDist - 0.001;
    hounds[3].speed = 1;
    enemyStep(world, 0.2);
    expect(active(world, 'duskhound')).not.toContain(hounds[3]);
    expect(enrages).toEqual([]);
    for (const h of hounds.slice(0, 3)) expect(h.enrageStacks).toBe(0);
  });
});

describe('Veilcaster veil', () => {
  /** A caster parked where at least two firing towers stand within its reach. */
  function casterWorld(type: TowerType = 'archer', plots = Infinity) {
    const { world, events } = plotWorld(type, plots);
    const veiled: number[] = [];
    events.on('towerVeiled', (e) => veiled.push(e.towerId));
    const caster = world.enemySystem.spawnEnemy('veilcaster', 200)!;
    let best = -1;
    let bestCount = 0;
    for (let d = 2; d < world.groundPath.totalLength - 2; d += 0.5) {
      parkAt(world, caster, d);
      const inReach = world.towers.filter((t) => near(t, caster.x, caster.z) <= VEIL!.reach).length;
      if (inReach > bestCount) {
        best = d;
        bestCount = inReach;
      }
    }
    parkAt(world, caster, Math.max(0, best));
    return { world, events, caster, veiled, inReach: bestCount };
  }

  it('every 6 s veils the nearest tower in reach: attack range -30% for 4 s', () => {
    const { world, caster, veiled, inReach } = casterWorld();
    expect(inReach).toBeGreaterThanOrEqual(2);
    caster.abilityTimer = VEIL!.firstSec;
    const byDist = world.towers
      .filter((t) => near(t, caster.x, caster.z) <= VEIL!.reach)
      .sort((a, b) => near(a, caster.x, caster.z) - near(b, caster.x, caster.z) || a.id - b.id);
    enemyStep(world, VEIL!.firstSec - 0.1);
    expect(veiled).toEqual([]);
    enemyStep(world, 0.2);
    expect(veiled).toEqual([byDist[0].id]);
    const t = byDist[0];
    expect(t.veilTimer).toBe(VEIL!.veilSec);
    world.combatSystem.update(DT, world.towers);
    expect(t.rangeCut).toBeCloseTo(VEIL!.rangeCut, 9);
    const base = towerStats(t).range * (1 + t.auraRange + (t.heroRangeBonus ?? 0));
    expect(attackReach(t, towerStats(t).range)).toBeCloseTo(base * (1 - VEIL!.rangeCut), 9);
    for (const o of world.towers) if (o !== t) expect(o.rangeCut ?? 0).toBe(0);

    // Lifts after 4 s; the next cast comes 6 s after the first.
    bothStep(world, VEIL!.veilSec);
    expect(t.veilTimer ?? 0).toBe(0);
    expect(t.rangeCut ?? 0).toBe(0);
    caster.hp = caster.maxHp;
    bothStep(world, VEIL!.interval - VEIL!.veilSec);
    expect(veiled).toHaveLength(2);
  });

  it('veils never stack on one tower: a second caster picks the next-nearest tower', () => {
    const { world, caster, veiled } = casterWorld();
    const second = world.enemySystem.spawnEnemy('veilcaster', 200)!;
    parkAt(world, second, caster.dist);
    caster.abilityTimer = second.abilityTimer = 0.05;
    enemyStep(world, 0.1);
    expect(veiled).toHaveLength(2);
    expect(veiled[0]).not.toBe(veiled[1]);
    for (const id of veiled) expect(world.getTowerById(id)!.veilTimer).toBe(VEIL!.veilSec);
    // While both are veiled and no third tower is free, nothing is re-veiled or extended.
    world.combatSystem.update(DT, world.towers);
    for (const id of veiled) expect(world.getTowerById(id)!.rangeCut).toBeCloseTo(VEIL!.rangeCut, 9);
  });

  it('only the attack range shrinks: targeting misses a foe at 85% range; sell and upgrade still work', () => {
    const { world } = plotWorld('archer', 1);
    const tower = world.towers[0];
    const dummy = world.enemySystem.spawnEnemy('golem', 50)!;
    const range = towerStats(tower).range;
    let at = -1;
    for (let d = 1; d < world.groundPath.totalLength - 1; d += 0.05) {
      parkAt(world, dummy, d);
      const r = near(tower, dummy.x, dummy.z);
      if (r > range * 0.8 && r < range * 0.9) {
        at = d;
        break;
      }
    }
    expect(at).toBeGreaterThan(0);
    parkAt(world, dummy, at);
    expect(acquireTarget(tower, towerStats(tower), world.enemyPool, world.spatialHash)).toBe(dummy);
    tower.veilTimer = VEIL!.veilSec;
    world.combatSystem.applyRangeCuts(world.towers, DT);
    expect(acquireTarget(tower, towerStats(tower), world.enemyPool, world.spatialHash)).toBeNull();
    // Upgrade and sell are untouched by the veil.
    expect(world.upgradeTower(tower.id)).toBe(true);
    expect(tower.veilTimer).toBeGreaterThan(0);
    expect(world.sellTower(tower.id)).toBeGreaterThan(0);
  });

  it('barracks and beacons are never veiled, and the beacon aura keeps its reach', () => {
    const { world } = plotWorld('barracks', 2);
    world.placeTowerOnPlot(2, 'beacon');
    world.placeTowerOnPlot(3, 'archer');
    const caster = world.enemySystem.spawnEnemy('veilcaster', 200)!;
    const veiled: number[] = [];
    world.events.on('towerVeiled', (e) => veiled.push(e.towerId));
    const archer = world.towers.find((t) => t.type === 'archer')!;
    // Park the caster next to the barracks / beacon.
    let best = 0;
    let bestR = Infinity;
    for (let d = 1; d < world.groundPath.totalLength - 1; d += 0.5) {
      parkAt(world, caster, d);
      const r = Math.min(...world.towers.filter((t) => !FIRING(t)).map((t) => near(t, caster.x, caster.z)));
      if (r < bestR) {
        bestR = r;
        best = d;
      }
    }
    parkAt(world, caster, best);
    caster.abilityTimer = 0.05;
    enemyStep(world, 3);
    for (const id of veiled) expect(world.getTowerById(id)!.type).toBe('archer');
    // Force a veil + eclipse on everything: barracks / beacon keep rangeCut 0, the aura still reaches.
    for (const t of world.towers) t.veilTimer = VEIL!.veilSec;
    world.enemySystem.eclipseTimer = 5;
    world.enemySystem.eclipseCut = SOV!.eclipseCut;
    world.combatSystem.update(DT, world.towers);
    for (const t of world.towers) {
      if (FIRING(t)) expect(t.rangeCut).toBeCloseTo(1 - (1 - VEIL!.rangeCut) * (1 - SOV!.eclipseCut), 9);
      else expect(t.rangeCut ?? 0).toBe(0);
    }
    const beacon = world.towers.find((t) => t.type === 'beacon')!;
    const inBeacon = near(archer, beacon.x, beacon.z) <= towerStats(beacon).range;
    expect(archer.auraRate > 0).toBe(inBeacon);
  });
});

describe('Eclipse Sovereign', () => {
  function bossWorld(type: TowerType = 'archer') {
    const { world, events } = plotWorld(type);
    const boss = world.enemySystem.spawnEnemy('eclipse_sovereign')!;
    parkAt(world, boss, world.groundPath.totalLength * 0.5);
    const log = {
      phases: [] as number[],
      eclipses: 0,
      splits: [] as { count: number; halfHp: number }[],
      summons: [] as number[],
      killed: [] as string[],
    };
    events.on('bossPhase', (e) => log.phases.push(e.phase));
    events.on('eclipse', () => log.eclipses++);
    events.on('sovereignSplit', (e) => log.splits.push({ count: e.count, halfHp: e.halfHp }));
    events.on('bossSummon', (e) => log.summons.push(e.count));
    events.on('enemyKilled', (e) => log.killed.push(e.enemyType));
    return { world, events, boss, log };
  }

  it('at 66% HP: eclipse, every firing tower loses 20% attack range for 8 s', () => {
    const { world, boss, log } = bossWorld();
    boss.hp = Math.floor(boss.maxHp * 0.7);
    enemyStep(world, 0.1);
    expect(log.phases).toEqual([]);
    boss.hp = Math.floor(boss.maxHp * SOV!.eclipseAt);
    enemyStep(world, DT);
    expect(log.phases).toEqual([1]);
    expect(log.eclipses).toBe(1);
    expect(boss.bossPhase).toBe(1);
    expect(world.enemySystem.eclipseTimer).toBe(SOV!.eclipseSec);
    world.combatSystem.update(DT, world.towers);
    for (const t of world.towers) {
      expect(t.rangeCut).toBeCloseTo(SOV!.eclipseCut, 9);
      expect(attackReach(t, 10)).toBeCloseTo(10 * (1 + t.auraRange + (t.heroRangeBonus ?? 0)) * (1 - SOV!.eclipseCut), 9);
    }
    // No second eclipse in the same band; it ends after 8 s.
    boss.hp = Math.floor(boss.maxHp * 0.5);
    bothStep(world, SOV!.eclipseSec - 0.2);
    expect(log.eclipses).toBe(1);
    expect(world.enemySystem.eclipseTimer).toBeGreaterThan(0);
    boss.hp = Math.floor(boss.maxHp * 0.5);
    bothStep(world, 0.3);
    expect(world.enemySystem.eclipseTimer).toBe(0);
    for (const t of world.towers) expect(t.rangeCut ?? 0).toBe(0);
  });

  it('at 40% HP splits into two Shadow Halves with 55% of the HP left each and summons 4 Dusk Hounds', () => {
    const { world, boss, log } = bossWorld();
    const at = { dist: boss.dist, lane: boss.lane };
    boss.hp = Math.floor(boss.maxHp * 0.6);
    enemyStep(world, DT);
    expect(log.phases).toEqual([1]);
    const left = Math.floor(boss.maxHp * 0.35);
    boss.hp = left;
    enemyStep(world, DT);
    expect(active(world, 'eclipse_sovereign')).toHaveLength(0);
    const halves = active(world, 'eclipse_shade');
    expect(halves).toHaveLength(2);
    const halfHp = Math.round(left * SOV!.splitHpFrac);
    for (const h of halves) {
      expect(h.hp).toBe(halfHp);
      expect(h.maxHp).toBe(halfHp);
      expect(h.bossPhase).toBe(2);
      expect(h.livesCost).toBe(ENEMY_DEFS.eclipse_shade.livesCost);
      expect(h.reward).toBe(ENEMY_DEFS.eclipse_sovereign.reward / 2);
      expect(h.lane).toBe(at.lane);
      expect(h.dist).toBeLessThanOrEqual(at.dist + 1e-9);
      expect(ENEMY_DEFS[h.type].isBoss).toBe(true);
    }
    expect(log.splits).toEqual([{ count: 2, halfHp }]);
    expect(log.phases).toEqual([1, 2]);
    const hounds = active(world, 'duskhound');
    expect(hounds).toHaveLength(SOV!.summonCount);
    for (const h of hounds) expect(h.dist).toBeLessThan(at.dist);
    expect(log.summons).toEqual([SOV!.summonCount]);
    // A split is not a kill: no bounty, no death event for the Sovereign.
    expect(log.killed).not.toContain('eclipse_sovereign');
  });

  it('one huge hit through both thresholds plays the eclipse and the split in the same tick', () => {
    const { world, boss, log } = bossWorld();
    boss.hp = Math.floor(boss.maxHp * 0.1);
    enemyStep(world, DT);
    expect(log.phases).toEqual([1, 2]);
    expect(log.eclipses).toBe(1);
    expect(active(world, 'eclipse_shade')).toHaveLength(2);
    expect(world.enemySystem.eclipseTimer).toBe(SOV!.eclipseSec);
  });

  it('even a killing blow cannot skip the split (halves of at least 1 HP)', () => {
    const { world, boss, log } = bossWorld();
    world.enemySystem.applyDamage(boss, boss.maxHp * 10, true);
    expect(boss.hp).toBe(0);
    enemyStep(world, DT);
    expect(log.killed).not.toContain('eclipse_sovereign');
    const halves = active(world, 'eclipse_shade');
    expect(halves).toHaveLength(2);
    for (const h of halves) expect(h.hp).toBe(1);
  });

  /** One-wave level with just the Sovereign (I16 map), for wave-end and lives checks. */
  function finale(): LevelDef {
    return { ...I16, id: 'test-ch5-finale', waves: [{ groups: [{ enemyType: 'eclipse_sovereign', count: 1, spawnInterval: 1, startDelay: 0 }], clearBonus: 0 }] };
  }

  it('the fight ends only when both halves fall; both together pay the Sovereign bounty', () => {
    const world = new SimWorld(finale(), new EventBus());
    world.startNextWave();
    for (let i = 0; i < 10 && active(world, 'eclipse_sovereign').length === 0; i++) world.fixedTick(DT);
    const boss = active(world, 'eclipse_sovereign')[0];
    expect(boss).toBeDefined();
    boss.speed = 0;
    boss.hp = Math.floor(boss.maxHp * 0.3);
    world.fixedTick(DT);
    const [a, b] = active(world, 'eclipse_shade');
    for (const h of active(world, 'duskhound')) h.hp = 0;
    world.fixedTick(DT);
    const gold0 = world.gold;
    a.hp = 0;
    for (let i = 0; i < 30; i++) world.fixedTick(DT);
    expect(world.outcome).toBe('ongoing');
    expect(active(world, 'eclipse_shade')).toEqual([b]);
    b.hp = 0;
    for (let i = 0; i < 30 && world.outcome === 'ongoing'; i++) world.fixedTick(DT);
    expect(world.outcome).toBe('won');
    expect(world.gold - gold0).toBe(ENEMY_DEFS.eclipse_sovereign.reward);
  });

  it('reserves the Sovereign for the final procession and both halves for its split', () => {
    const encounters = LEVELS_2D.flatMap(level => level.waves.flatMap((wave, i) =>
      wave.groups.filter(g => g.enemyType === 'eclipse_sovereign' || g.enemyType === 'eclipse_shade')
        .map(g => [level.id, i + 1, g.enemyType, g.count, g.lane])));
    expect(encounters).toEqual([['i45', 16, 'eclipse_sovereign', 1, 0]]);
    const world = new SimWorld(getLevelById('i45')!, new EventBus());
    expect(world.extraGroundPaths).toHaveLength(2);
    for (const spur of world.extraGroundPaths) expect(world.groundPath.totalLength).toBeGreaterThan(spur.totalLength);
    world.dispose();
  });

  it.each(['eclipse_sovereign', 'eclipse_shade'] as const)('a %s breach ends the Throne story, even at full lives', type => {
    const events = new EventBus();
    const world = new SimWorld(getLevelById('i45')!, events);
    let breachCost = 0;
    events.on('enemyLeaked', e => { breachCost = e.livesLost; });
    world.debugSkipToWave(16);
    const foe = world.enemySystem.spawnEnemy(type)!;
    foe.dist = foe.totalDist;
    world.fixedTick(DT);
    expect(breachCost).toBe(world.startingLives);
    expect(world.outcome).toBe('lost');
    world.dispose();
  });

  it('charges the ordinary Shadow Half cost in Throne Endless', () => {
    const world = new SimWorld(getLevelById('i45')!, new EventBus());
    world.startEndlessFromStart();
    world.startNextWave();
    const half = world.enemySystem.spawnEnemy('eclipse_shade')!;
    half.dist = half.totalDist;
    world.fixedTick(DT);
    expect(world.outcome).toBe('ongoing');
    expect(world.startingLives - world.lives).toBe(ENEMY_DEFS.eclipse_shade.livesCost);
    world.dispose();
  });

  it('a Shadow Half that reaches the sanctuary costs boss lives', () => {
    const world = new SimWorld(finale(), new EventBus());
    world.startNextWave();
    for (let i = 0; i < 10 && active(world, 'eclipse_sovereign').length === 0; i++) world.fixedTick(DT);
    const boss = active(world, 'eclipse_sovereign')[0];
    boss.hp = 1;
    world.fixedTick(DT);
    for (const h of active(world, 'duskhound')) h.hp = 0;
    world.fixedTick(DT);
    const lives0 = world.lives;
    const half = active(world, 'eclipse_shade')[0];
    half.dist = half.totalDist - 0.001;
    world.fixedTick(DT);
    expect(lives0 - world.lives).toBe(ENEMY_DEFS.eclipse_shade.livesCost);
    expect(world.outcome).toBe('ongoing');
  });
});

describe('chapter five state hashing', () => {
  it('new state enters the hash only while it exists', () => {
    const { world } = plotWorld('archer', 3);
    const hound = world.enemySystem.spawnEnemy('duskhound')!;
    const h0 = computeSimStateHash(world);
    // Present-but-zero fields do not change the hash (older replays keep their hashes).
    for (const t of world.towers) {
      t.veilTimer = 0;
      t.rangeCut = 0;
    }
    world.enemySystem.clearEclipse();
    expect(computeSimStateHash(world)).toBe(h0);
    world.towers[0].veilTimer = 2;
    const hVeil = computeSimStateHash(world);
    expect(hVeil).not.toBe(h0);
    world.towers[0].veilTimer = 0;
    world.enemySystem.eclipseTimer = 3;
    world.enemySystem.eclipseCut = 0.2;
    expect(computeSimStateHash(world)).not.toBe(h0);
    world.enemySystem.clearEclipse();
    hound.enrageStacks = 1;
    hound.enrageTimer = 2;
    expect(computeSimStateHash(world)).not.toBe(h0);
    hound.enrageStacks = 0;
    hound.enrageTimer = 0;
    expect(computeSimStateHash(world)).toBe(h0);
  });
});

/** Test-only level: I16's map with a short chapter-five wave list (never registered anywhere). */
function chapterFiveTestLevel(): LevelDef {
  const g = (enemyType: EnemyType, count: number, startDelay: number, spawnInterval = 1.2) => ({
    enemyType,
    count,
    startDelay,
    spawnInterval,
  });
  return {
    ...I16,
    id: 'test-ch5-foes',
    waves: [
      { groups: [g('grunt', 6, 0, 0.9), g('duskhound', 6, 2, 0.45)], clearBonus: 40 },
      { groups: [g('duskhound', 6, 0, 0.45), g('veilcaster', 2, 3, 3)], clearBonus: 45 },
      { groups: [g('veilcaster', 3, 0, 2), g('duskhound', 8, 1, 0.4), g('runner', 6, 2, 0.5)], clearBonus: 50 },
      { groups: [g('eclipse_sovereign', 1, 0), g('veilcaster', 2, 4, 3), g('duskhound', 5, 7, 0.45)], clearBonus: 60 },
    ],
  };
}

describe('chapter five test-only level (full SimWorld run)', () => {
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
    const counts = { packEnrage: 0, veiled: 0, eclipse: 0, split: 0, phases: 0, shadeKills: 0 };
    events.on('packEnrage', () => counts.packEnrage++);
    events.on('towerVeiled', () => counts.veiled++);
    events.on('eclipse', () => counts.eclipse++);
    events.on('sovereignSplit', () => counts.split++);
    events.on('bossPhase', () => counts.phases++);
    events.on('enemyKilled', (e) => {
      if (e.enemyType === 'eclipse_shade') counts.shadeKills++;
    });
    let cutTicks = 0;
    let enragedTicks = 0;
    world.setAutoWave(true);
    world.startNextWave();
    for (let i = 0; i < Math.round(900 / DT) && world.outcome === 'ongoing'; i++) {
      world.fixedTick(DT);
      if (world.towers.some((t) => (t.rangeCut ?? 0) > 0)) cutTicks++;
      if (active(world, 'duskhound').some((h) => h.enrageStacks > 0)) enragedTicks++;
    }
    return { world, counts, cutTicks, enragedTicks };
  }

  it('plays through: packs enrage, veils and the eclipse cut range, the Sovereign splits; deterministic', () => {
    const level = chapterFiveTestLevel();
    const a = play(level);
    expect(a.world.outcome).not.toBe('ongoing');
    expect(a.counts.packEnrage).toBeGreaterThan(5);
    expect(a.enragedTicks).toBeGreaterThan(0);
    expect(a.counts.veiled).toBeGreaterThan(0);
    expect(a.cutTicks).toBeGreaterThan(0);
    expect(a.counts.eclipse).toBe(1);
    expect(a.counts.split).toBe(1);
    expect(a.counts.phases).toBe(2);
    expect(Number.isFinite(a.world.gold)).toBe(true);
    // Run end clears every range cut and the eclipse.
    expect(a.world.enemySystem.eclipseTimer).toBe(0);
    for (const t of a.world.towers) {
      expect(t.veilTimer ?? 0).toBe(0);
      expect(t.rangeCut ?? 0).toBe(0);
    }
    const b = play(level);
    expect(computeSimStateHash(b.world)).toBe(computeSimStateHash(a.world));
    expect(b.counts).toEqual(a.counts);
  });

  it('endless on a chapter-five island spotlights the new foes and the Sovereign leads the 10th / 20th wave', () => {
    const level = chapterFiveTestLevel();
    expect(hasChapterFiveEnemies(level)).toBe(true);
    expect(hasChapterFiveEnemies(I16)).toBe(false);
    const seen = new Set<EnemyType>();
    for (let k = 0; k < ENDLESS_CHAPTER5_SPOTLIGHTS.length; k++) {
      for (const grp of buildEndlessWaveDef(level.waves.length + k, level).groups) seen.add(grp.enemyType);
    }
    expect(seen.has('duskhound')).toBe(true);
    expect(seen.has('veilcaster')).toBe(true);
    for (const n of [9, 19]) {
      const lead = buildEndlessWaveDef(level.waves.length + n, level).groups.map((grp) => grp.enemyType);
      expect(lead).toContain('eclipse_sovereign');
      expect(lead).not.toContain('tempest');
      expect(lead).not.toContain('glacier_warden');
    }
    // A chapter-five island that also uses chapter-four foes still gets the chapter-five rotation.
    const mixed: LevelDef = { ...level, waves: [...level.waves, { groups: [{ enemyType: 'rimebeetle', count: 3, spawnInterval: 1, startDelay: 0 }], clearBonus: 10 }] };
    expect(hasChapterFourEnemies(mixed)).toBe(true);
    expect(buildEndlessWaveDef(mixed.waves.length + 9, mixed).groups.map((grp) => grp.enemyType)).toContain('eclipse_sovereign');
    // Chapter four and older islands are unchanged.
    const ch4: LevelDef = { ...I16, waves: [{ groups: [{ enemyType: 'rimebeetle', count: 3, spawnInterval: 1, startDelay: 0 }], clearBonus: 10 }] };
    expect(buildEndlessWaveDef(ch4.waves.length + 9, ch4).groups.map((grp) => grp.enemyType)).toContain('glacier_warden');
    const legacyTenth = buildEndlessWaveDef(I16.waves.length + 9, I16).groups.map((grp) => grp.enemyType);
    expect(legacyTenth).toContain('tempest');
    expect(legacyTenth).not.toContain('eclipse_sovereign');
  });
});
