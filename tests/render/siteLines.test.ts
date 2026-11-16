import { describe, expect, it } from 'vitest';
import { LEVELS, parseLevelGrid } from '../../src/data/levels/index.ts';
import { getIslandTheme } from '../../src/render/islandThemeTable.ts';
import { gridToWorldX, gridToWorldZ } from '../../src/sim/grid.ts';

/**
 * Tall landmarks (windmills, towers, lighthouse...) must not stand directly in front of the enemy route as seen
 * from the default isometric camera, or walking units would vanish behind them.
 * [world height incl. render scale, half width] per kind.
 */
const TALL: Record<string, readonly [number, number]> = {
  windmill: [3.4, 0.9],
  watchtower: [3.1, 0.7],
  lighthouse: [4.4, 0.8],
  obelisk: [3.1, 0.5],
  lamp: [2.4, 0.25],
  statue: [2.4, 0.6],
  tent: [1.9, 0.9],
  cabin: [1.9, 0.95],
  hut: [1.9, 0.8],
};
const KIND_SCALE: Record<string, number> = { windmill: 1, watchtower: 1, lighthouse: 1, obelisk: 1 };

describe.each([0, 1, 2, 3])('landmark sight lines (camera quarter-turn %i)', (quarter) => {
  const yaw = Math.PI / 4 + (quarter * Math.PI) / 2;
  const tilt = Math.asin(1 / Math.sqrt(3));
  // direction towards the camera
  const d = [Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt), Math.cos(yaw) * Math.cos(tilt)];
  const rx = d[2];
  const rz = -d[0];
  const rl = Math.hypot(rx, rz);
  const right = [rx / rl, rz / rl];
  const upv = [d[1] * right[1], d[2] * right[0] - d[0] * right[1], -d[1] * right[0]];
  const ul = Math.hypot(upv[0], upv[1], upv[2]);
  const proj = (x: number, y: number, z: number): { sx: number; sy: number; depth: number } => ({
    sx: x * right[0] + z * right[1],
    sy: (x * upv[0] + y * upv[1] + z * upv[2]) / ul,
    depth: x * d[0] + y * d[1] + z * d[2],
  });

  for (const level of LEVELS) {
    it(`${level.name}: no tall landmark hides the route`, () => {
      const theme = getIslandTheme(level.id);
      const grid = parseLevelGrid(level);
      for (const p of theme.setPieces) {
        const dims = TALL[p.kind];
        if (!dims) continue;
        const sc = (p.scale ?? 1) * (KIND_SCALE[p.kind] ?? 1);
        const base = proj(gridToWorldX(p.col, level.cols), 0, gridToWorldZ(p.row, level.rows));
        const topSy = base.sy + dims[0] * sc * Math.cos(tilt);
        for (let r = 0; r < level.rows; r++) {
          for (let c = 0; c < level.cols; c++) {
            const t = grid[r][c];
            if (t !== 'path' && t !== 'spawn' && t !== 'goal') continue;
            const q = proj(gridToWorldX(c, level.cols), 0.5, gridToWorldZ(r, level.rows));
            if (q.depth >= base.depth) continue;
            const hidden =
              Math.abs(q.sx - base.sx) < dims[1] * sc + 0.45 && q.sy > base.sy - 0.2 && q.sy < topSy;
            expect(hidden, `${p.kind}@${p.col},${p.row} hides route tile ${c},${r}`).toBe(false);
          }
        }
      }
    });
  }
});
