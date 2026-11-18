import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEVELS, groundLaneCount } from '../../src/data/levels/index.ts';
import { getLevelById, LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { parseLevel2D, type Level2DJson } from '../../src/data/levels2d/loader.ts';
import { parseManifest } from '../../src/render2d/manifest.ts';
import { pickMapVariant } from '../../src/render2d/mapVariant.ts';
import manifestJson from '../../public/art2d/manifest.json';

const art = parseManifest(manifestJson);
const ids = ['i01', 'i02', 'i03', 'i04', 'i05', 'i06', 'i07', 'i08'];

describe.each(ids)('%s campaign plot map', (id) => {
  const index = ids.indexOf(id);
  const file = `src/data/levels2d/${id}.json`;
  const json: Level2DJson = JSON.parse(readFileSync(file, 'utf8'));
  const layout = parseLevel2D(json);
  const source = LEVELS[index];

  it('resolves in campaign order with the source waves and valid plot purchases', () => {
    const level = getLevelById(id)!;
    expect(level).toBe(LEVELS_2D[index + 1]);
    expect(level.layout2d).toEqual(layout);
    expect(level.waves).toBe(source.waves);
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
    expect(layout.flightPath[0]).toEqual(layout.paths[0][0]);
    expect(layout.flightPath.at(-1)).toEqual(layout.goal);
    expect(layout.flightPath).not.toEqual(layout.paths[0]);
  });

  it('satisfies the bake rules for plot count, clearance, spacing and route coverage', () => {
    expect(json.plots.length).toBeGreaterThanOrEqual(16);
    expect(json.plots.length).toBeLessThanOrEqual(28);
    // Use the compositor itself to include the painted spline and the real gate alpha masks.
    execFileSync(process.env.PYTHON ?? 'python3', [
      'tools/map-compose/compose.py', file, 'design/art-2d/v2/assets', '--check-plots',
    ], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  });

  it('selects this map at every resolution and supplies its gate fronts', () => {
    expect(layout.image).toBe(`map-${id}-layered`);
    for (const [need, suffix] of [[1, '@1x'], [1.5, '@1.5x'], [2, '']] as const) {
      const key = pickMapVariant(art.maps, layout.image, need);
      expect(key).toBe(layout.image + suffix);
      expect(art.maps[key!]).toBe(key + '.webp');
      expect(existsSync('public/art2d/' + art.maps[key!])).toBe(true);
    }
    expect(layout.gates).toHaveLength(layout.paths.length + 1);
    for (const gate of layout.gates!) {
      const key = gate.front!.art;
      expect(key).toBe(layout.image + '-gate-' + (gate.role === 'goal' ? 'goal' : layout.entrances[gate.lane].id));
      expect(art.overlays[key]).toBe(key + '.webp');
      expect(existsSync('public/art2d/' + art.overlays[key])).toBe(true);
    }
  });
});
