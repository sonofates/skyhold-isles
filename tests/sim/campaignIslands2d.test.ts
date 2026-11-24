import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { EventBus } from '../../src/core/eventBus.ts';
import { BALANCE } from '../../src/data/balance.ts';
import { CAMPAIGN_ORDER } from '../../src/data/chapters.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVELS, groundLaneCount } from '../../src/data/levels/index.ts';
import { getLevelById, LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { parseLevel2D, type Level2DJson } from '../../src/data/levels2d/loader.ts';
import { entranceFacing } from '../../src/data/levels2d/gates.ts';
import { SimWorld } from '../../src/sim/world.ts';
import { parseManifest } from '../../src/render2d/manifest.ts';
import { pickMapVariant } from '../../src/render2d/mapVariant.ts';
import manifestJson from '../../public/art2d/manifest.json';
import moonwell from '../../src/data/levels2d/i15.json';

/** The bake-rule check runs compose.py; skip it where Python lacks Pillow/numpy (e.g. the plain node CI image). */
const PYTHON = process.env.PYTHON ?? 'python3';
const hasPil = (() => {
  try {
    execFileSync(PYTHON, ['-c', 'import PIL, numpy'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const art = parseManifest(manifestJson);
const ids = Array.from({ length: 16 }, (_, n) => 'i' + String(n + 1).padStart(2, '0'));

const formations = [
  { id: 'i04', wave: 'Terrace Siege', slot: 3, from: 'flyer', patch: { count: 16 } },
  { id: 'i05', wave: 'Whirlwind', slot: 1, from: 'flyer', patch: { count: 9 } },
  { id: 'i10', wave: 'Skitter Flood', slot: 0, from: 'flyer', patch: { count: 9 } },
  { id: 'i13', wave: 'Downpour', slot: 2, from: 'flyer', patch: { count: 18 } },
  { id: 'i13', wave: 'North Road', slot: 1, from: 'mite', patch: { enemyType: 'bellrunner', count: 4, startDelay: 3.6, spawnInterval: 1 } },
  { id: 'i14', wave: 'Salt Wind', slot: 1, from: 'healer', patch: { enemyType: 'reedpiper', lane: 2, startDelay: 5.6, spawnInterval: 2.4 } },
  { id: 'i15', wave: 'Veil of Mist', slot: 2, from: 'flyer', patch: { enemyType: 'draftwing' } },
  { id: 'i16', wave: 'Gatecrash', slot: 2, from: 'brute', patch: { enemyType: 'kilnback' } },
] as const;

// Painted-route adjustments apply after the shared air tuning.
const paintedFormations = [
  { id: 'i01', wave: 'Iron Knock', slot: 1, from: 'brute', patch: { elite: true, hpScale: 2.4 } },
  { id: 'i02', wave: 'Spring Tide', slot: 2, from: 'flyer', patch: { count: 13 } },
  { id: 'i02', wave: 'Dreadnought Fleet', slot: 4, from: 'boss', patch: { hpScale: 1.5 } },
  { id: 'i04', wave: 'Emerald Dreadnoughts', slot: 4, from: 'boss', patch: { hpScale: 1.6 } },
  { id: 'i05', wave: 'Gale Force', slot: 2, from: 'flyer', patch: { hpScale: 0.85 } },
  { id: 'i05', wave: 'Harvest Dreadnought', slot: 5, from: 'boss', patch: { hpScale: 1.3 } },
  { id: 'i05', wave: 'Harvest Dreadnought', slot: 3, from: 'flyer', patch: { count: 28 } },
  { id: 'i06', wave: 'The Leviathan', slot: 4, from: 'boss', patch: { hpScale: 0.6 } },
  { id: 'i06', wave: 'Maelstrom', slot: 0, from: 'flyer', patch: { count: 12 } },
  { id: 'i07', wave: 'Fortress Breaker', slot: 3, from: 'boss', patch: { hpScale: 1.4 } },
  { id: 'i09', wave: 'Twin Warlords', slot: 3, from: 'boss', patch: { hpScale: 1.35, spawnInterval: 4.5 } },
  { id: 'i10', wave: 'Earthshaker', slot: 3, from: 'flyer', patch: { count: 12 } },
  { id: 'i10', wave: 'The Confluence', slot: 0, from: 'boss', patch: { hpScale: 2.5 } },
  { id: 'i11', wave: 'Golden Freight', slot: 0, from: 'golem', patch: { hpScale: 1.45 } },
  { id: 'i12', wave: 'Hexfire Legion', slot: 0, from: 'brute', patch: { hpScale: 1.4 } },
  { id: 'i14', wave: 'Aegis Dune', slot: 0, from: 'warden', patch: { count: 4 } },
  { id: 'i14', wave: 'Aegis Dune', slot: 2, from: 'healer', patch: { count: 2 } },
  { id: 'i14', wave: 'Aegis Dune', slot: 3, from: 'flyer', patch: { count: 14 } },
] as const;

const air: Partial<Record<string, { hp?: number; count?: number; interval?: number }>> = {
  i03: { hp: 0.75 }, i06: { count: 0.65, interval: 1.2 }, i07: { hp: 0.58 },
  i08: { hp: 0.4, interval: 1.5 }, i11: { hp: 0.15 }, i13: { hp: 0.35 },
  i14: { hp: 0.55, interval: 1.2 }, i15: { hp: 0.8, interval: 1.75 }, i16: { hp: 0.5, interval: 1.5 },
};

describe.each(ids)('%s campaign plot map', (id) => {
  const index = ids.indexOf(id);
  const file = `src/data/levels2d/${id}.json`;
  const json: Level2DJson = JSON.parse(readFileSync(file, 'utf8'));
  const layout = parseLevel2D(json);
  const source = LEVELS[index];

  it('resolves in campaign order with its authored formations and valid plot purchases', () => {
    const level = getLevelById(id)!;
    // Campaign order is the chapter order (i25/i26 sit before i16), so look the slot up by id.
    expect(LEVELS_2D.indexOf(level)).toBe(CAMPAIGN_ORDER.indexOf(id));
    expect(level.layout2d).toEqual(layout);
    const overrides = formations.filter(formation => formation.id === id);
    const tuning = air[id];
    const painted = paintedFormations.filter(formation => formation.id === id);
    if (overrides.length || tuning || painted.length) {
      const expected = source.waves.map(wave => ({ ...wave, groups: wave.groups.map(group => ({ ...group })) }));
      for (const { wave, slot, from, patch } of overrides) {
        const group = expected.find(w => w.name === wave)!.groups[slot];
        expect(group.enemyType).toBe(from);
        Object.assign(group, patch);
      }
      if (tuning) {
        for (const wave of expected) {
          for (const group of wave.groups.filter(g => ENEMY_DEFS[g.enemyType].flying)) {
            if (tuning.hp !== undefined) group.hpScale = tuning.hp;
            if (tuning.count !== undefined) group.count = Math.round(group.count * tuning.count);
            if (tuning.interval !== undefined) group.spawnInterval *= tuning.interval;
          }
        }
      }
      for (const { wave, slot, from, patch } of painted) {
        const group = expected.find(w => w.name === wave)!.groups[slot];
        expect(group.enemyType).toBe(from);
        Object.assign(group, patch);
      }
      expect(level.waves).toEqual(expected);
    } else {
      expect(level.waves).toBe(source.waves);
    }
    expect(level.name).toBe(source.name);
    expect(level.difficulty).toBe(source.difficulty);
    for (const order of [level.scriptedBuildOrder!, level.weakBuildOrder!]) {
      const occupied = new Set<number>();
      for (const step of order) {
        expect(step.row).toBe(0);
        expect(layout.plots[step.col]).toBeDefined();
        expect(occupied.has(step.col)).toBe(step.action === 'upgrade');
        occupied.add(step.col);
      }
    }
  });

  it('preserves the ground lanes and flies a separate route to the same goal', () => {
    expect(json.id).toBe(id);
    expect(layout.imageSize).toEqual([1846, 852]);
    expect(layout.safeArea).toEqual([166, 0, 1515, 852]);
    expect(layout.paths).toHaveLength(groundLaneCount(source));
    layout.paths.forEach((path, i) => {
      expect(layout.entrances[i]).toMatchObject(path[0]);
      expect(path.at(-1)).toEqual(layout.goal);
    });
    const takeoff = source.flightPath[0];
    const sourceLanes = [source.pathWaypoints, ...(source.extraGroundPaths ?? [])];
    const airGate = sourceLanes.findIndex(([p]) => p.col === takeoff.col && p.row === takeoff.row);
    const groundStarts = layout.paths.map(([start]) => start);
    if (airGate >= 0) expect(layout.flightPath[0]).toEqual(groundStarts[airGate]);
    else expect(groundStarts).not.toContainEqual(layout.flightPath[0]);
    expect(new Set(json.entrances.map(({ x, y }) => [x, y].join(','))).size).toBe(sourceLanes.length);
    // Each multi-gate campaign island has a shared approach before the goal itself.
    for (const path of layout.paths.slice(1)) expect(path.at(-2)).toEqual(layout.paths[0].at(-2));
    expect(layout.flightPath.at(-1)).toEqual(layout.goal);
    expect(layout.flightPath).not.toEqual(layout.paths[0]);
  });

  it('supports a tier-one barracks from every plot', () => {
    const world = new SimWorld(getLevelById(id)!, new EventBus());
    world.gold = 10_000;
    for (let i = 0; i < layout.plots.length; i++) expect(world.placeTower(i, 0, 'barracks')).not.toBeNull();
  });

  it.skipIf(!hasPil)('satisfies the bake rules for plot count, clearance, spacing and route coverage', () => {
    expect(json.plots.length).toBeGreaterThanOrEqual(16);
    expect(json.plots.length).toBeLessThanOrEqual(28);
    // Use the compositor itself to include the painted spline and the real gate alpha masks.
    execFileSync(PYTHON, [
      'tools/map-compose/compose.py', file, 'design/art-2d/v2/assets', '--check-plots',
    ], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  }, 20_000);

  it('selects this map at every resolution and supplies its gate fronts', () => {
    expect(layout.image).toBe(`map-${id}-layered`);
    for (const [need, suffix] of [[1, '@1x'], [1.5, '@1.5x'], [2, ''], [3, '@3x']] as const) {
      const key = pickMapVariant(art.maps, layout.image, need);
      expect(key).toBe(layout.image + suffix);
      expect(art.maps[key!]).toBe(key + '.webp');
      expect(existsSync('public/art2d/' + art.maps[key!])).toBe(true);
    }
    expect(layout.gates).toHaveLength(layout.paths.length + 1);
    for (const gate of layout.gates!) {
      if (gate.role === 'entrance') {
        expect(gate.facing).toBe(entranceFacing(json.paths[gate.lane]));
        expect(['E', 'S', 'W']).toContain(gate.facing);
        const e = json.entrances[gate.lane];
        const [left, top, width, height] = layout.safeArea;
        expect(height + top - e.y).toBeGreaterThan(Math.min(e.x - left, left + width - e.x, e.y - top));
      }
      const key = gate.front!.art;
      expect(key).toBe(layout.image + '-gate-' + (gate.role === 'goal' ? 'goal' : layout.entrances[gate.lane].id));
      for (const variant of [key, key + '@3x']) {
        expect(art.overlays[variant]).toBe(variant + '.webp');
        expect(existsSync('public/art2d/' + art.overlays[variant])).toBe(true);
      }
    }
  });
});

it('Lanternfall hexers can jam the hedge plots while the clearing stays out of reach', () => {
  const level = getLevelById('i12')!;
  const layout = level.layout2d!;
  const clearing = new Set([590, 720, 900, 1080]);
  const sheltered: number[] = [];
  for (const [index, plot] of layout.plots.entries()) {
    const world = new SimWorld(level, new EventBus());
    const tower = world.placeTower(index, 0, 'archer')!;
    const hexer = world.enemySystem.spawnEnemy('hexer')!;
    hexer.dist = world.groundPath.nearestDist(plot.x, plot.z);
    hexer.speed = 0;
    hexer.abilityTimer = 0;
    for (let i = 0; i < 120; i++) world.enemySystem.update(1 / 60, () => {}, () => {}, [tower], 1);
    if (tower.stunTimer === 0) sheltered.push(Math.round(plot.x * layout.pxPerUnit + layout.imageSize[0] / 2));
  }
  expect(new Set(sheltered)).toEqual(clearing);
});

it('Moonwell raiders round the pond counter-clockwise before joining the shortcut', () => {
  const [road, shortcut] = moonwell.paths;
  const south = road.findIndex(([x, y]) => x > 1050 && y > 700);
  const east = road.findIndex(([x]) => x > 1400);
  const north = road.findIndex(([x, y]) => x > 1050 && y < 510);
  const atMerge = ([x, y]: number[]) => x === 823 && y === 284;
  const merge = road.findIndex(atMerge);
  expect(south).toBeGreaterThanOrEqual(0);
  expect(east).toBeGreaterThan(south);
  expect(north).toBeGreaterThan(east);
  expect(merge).toBeGreaterThan(north);
  expect(road.slice(merge)).toEqual(shortcut.slice(shortcut.findIndex(atMerge)));
});

it('Sanctum can defend both opening lanes using only its base starting gold', () => {
  const level = getLevelById('i16')!;
  const world = new SimWorld(level, new EventBus());
  const startingLives = world.lives;
  for (const build of level.scriptedBuildOrder!.filter(action => action.waveIndex === 0)) {
    expect(world.placeTowerOnPlot(build.col, build.towerType!)).not.toBeNull();
  }
  expect(world.startNextWave()).toBe(true);
  for (let tick = 0; tick < 60 / BALANCE.fixedDt && world.waveSystem.state !== 'betweenWaves'; tick++) {
    world.fixedTick(BALANCE.fixedDt);
  }
  expect(world.waveSystem.state).toBe('betweenWaves');
  expect(world.lives).toBe(startingLives);
  world.dispose();
});
