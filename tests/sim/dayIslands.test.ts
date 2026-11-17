import { describe, expect, it } from 'vitest';
import { LEVELS, parseLevelGrid, type LevelDef } from '../../src/data/levels/index.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';

const byId = (id: string): LevelDef => {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`missing level ${id}`);
  return l;
};

function roadCells(lane: LevelDef['pathWaypoints']): string[] {
  const out: string[] = [];
  for (let i = 0; i < lane.length - 1; i++) {
    const a = lane[i];
    const b = lane[i + 1];
    const sc = Math.sign(b.col - a.col);
    const sr = Math.sign(b.row - a.row);
    let c = a.col;
    let r = a.row;
    out.push(`${c},${r}`);
    while (c !== b.col || r !== b.row) {
      c += sc;
      r += sr;
      out.push(`${c},${r}`);
    }
  }
  return out;
}

describe('registry', () => {
  it('ids are unique and each level knows its own position', () => {
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
    LEVELS.forEach((l, i) => expect(l.index).toBe(i));
  });
});

describe('day-pass islands (L14-L16)', () => {
  const day = ['amberstone-mesa', 'moonwell-crossing', 'emberglass-sanctum'].map(byId);

  it('continue the campaign after Stormcrown Citadel at Master difficulty', () => {
    expect(day.map((l) => l.index)).toEqual([13, 14, 15]);
    for (const l of day) expect(l.difficulty).toBe('Master');
  });

  it('each island is built around its own layout idea', () => {
    const [mesa, moonwell, ring] = day;
    expect(1 + (mesa.extraGroundPaths?.length ?? 0)).toBe(3); // three gates
    expect(1 + (ring.extraGroundPaths?.length ?? 0)).toBe(3); // two counter-rotating rings + north gate
    // Moonwell: the main road crosses itself at the well, the late gate merges onto its last stretch.
    const cells = roadCells(moonwell.pathWaypoints);
    const dup = cells.filter((c, i) => cells.indexOf(c) !== i);
    expect(dup).toContain('8,6');
    expect(moonwell.extraGroundPaths).toHaveLength(1);
    // Ring: lanes 0 and 1 are mirror images that circle in opposite directions.
    const west = ring.pathWaypoints.map((p) => p.col);
    const east = (ring.extraGroundPaths ?? [])[0].map((p) => p.col);
    expect(Math.min(...west)).toBeLessThan(8);
    expect(Math.max(...east)).toBeGreaterThan(8);
  });

  it('use bosses, elites and every extra lane, with flyers on the aerial lane', () => {
    for (const l of day) {
      const groups = l.waves.flatMap((w) => w.groups);
      expect(groups.some((g) => ENEMY_DEFS[g.enemyType].isBoss)).toBe(true);
      expect(groups.some((g) => g.elite)).toBe(true);
      expect(groups.some((g) => ENEMY_DEFS[g.enemyType].flying)).toBe(true);
      const laneCount = 1 + (l.extraGroundPaths?.length ?? 0);
      for (let lane = 0; lane < laneCount; lane++) {
        expect(groups.some((g) => (g.lane ?? 0) === lane), `${l.name} never uses lane ${lane}`).toBe(true);
      }
    }
  });

  it('end the aerial lane on the sanctuary tile', () => {
    for (const l of day) {
      const goal = l.pathWaypoints[l.pathWaypoints.length - 1];
      const end = l.flightPath[l.flightPath.length - 1];
      expect(end).toEqual(goal);
    }
  });

  it('keep every build site on buildable grass and out of the way of the roads', () => {
    for (const l of day) {
      const grid = parseLevelGrid(l);
      for (const a of [...(l.scriptedBuildOrder ?? []), ...(l.weakBuildOrder ?? [])]) {
        if (a.action === 'build') expect(grid[a.row][a.col], `${l.name} builds on ${a.col},${a.row}`).toBe('grass');
      }
      expect((l.scriptedBuildOrder ?? []).length).toBeGreaterThan(40);
      expect((l.weakBuildOrder ?? []).length).toBeGreaterThan(25);
    }
  });

  it('keep waves in escalating order: last wave is the biggest', () => {
    for (const l of day) {
      const size = (i: number): number => l.waves[i].groups.reduce((n, g) => n + g.count, 0);
      const last = l.waves.length - 1;
      expect(l.waves[last].clearBonus).toBeGreaterThanOrEqual(l.waves[0].clearBonus * 4);
      expect(size(last)).toBeGreaterThan(size(0) * 2);
    }
  });
});
