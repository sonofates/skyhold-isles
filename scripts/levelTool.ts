/**
 * Authoring helpers for new islands (not used at runtime):
 *  - `renderLayout`  turns a land mask + lane waypoints into the `layout` strings a LevelDef wants,
 *  - `rankSites`     scores buildable tiles by how much road they cover (greedy set cover, diminishing returns),
 *  - `orderFromTemplate` re-targets an existing level's scripted build order onto a new level's ranked sites,
 *    so a new island starts from a sane build script before hand-tuning.
 *
 * CLI: `npx tsx scripts/levelTool.ts <levelId>` prints the layout + ranked sites of a registered level.
 */
import type { GridCoord } from '../src/core/types.ts';
import { LEVELS, parseLevelGrid, type LevelDef, type ScriptedBuildAction } from '../src/data/levels/index.ts';

export interface LayoutSpec {
  /** One string per row; chars: `.` buildable grass, `T` decor, `~` water. Space-separated or packed. */
  readonly land: readonly string[];
  readonly lanes: readonly (readonly GridCoord[])[];
}

function cellsAlong(lane: readonly GridCoord[]): GridCoord[] {
  const out: GridCoord[] = [];
  for (let i = 0; i < lane.length - 1; i++) {
    const a = lane[i];
    const b = lane[i + 1];
    const sc = Math.sign(b.col - a.col);
    const sr = Math.sign(b.row - a.row);
    let c = a.col;
    let r = a.row;
    out.push({ col: c, row: r });
    while (c !== b.col || r !== b.row) {
      c += sc;
      r += sr;
      out.push({ col: c, row: r });
    }
  }
  return out;
}

/** Rounded cells along a (possibly diagonal) polyline, sampled every half tile. */
function sampleLine(pts: readonly GridCoord[]): GridCoord[] {
  const seen = new Set<string>();
  const out: GridCoord[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.col - a.col, b.row - a.row) * 2));
    for (let k = 0; k <= n; k++) {
      const col = Math.round(a.col + ((b.col - a.col) * k) / n);
      const row = Math.round(a.row + ((b.row - a.row) * k) / n);
      const key = col + ',' + row;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ col, row });
      }
    }
  }
  return out;
}

export function laneCells(lanes: readonly (readonly GridCoord[])[]): GridCoord[][] {
  return lanes.map(cellsAlong);
}

export function renderLayout(spec: LayoutSpec): string[] {
  const rows = spec.land.length;
  const grid = spec.land.map((r) => r.replace(/\s+/g, '').split(''));
  const cols = grid[0].length;
  for (const lane of spec.lanes) {
    const cells = cellsAlong(lane);
    for (const c of cells) grid[c.row][c.col] = 'P';
    const s = lane[0];
    grid[s.row][s.col] = 'S';
  }
  const goal = spec.lanes[0][spec.lanes[0].length - 1];
  grid[goal.row][goal.col] = 'G';
  void rows;
  void cols;
  return grid.map((r) => r.join(' '));
}

export interface Site {
  readonly col: number;
  readonly row: number;
  readonly score: number;
}

/** Greedy road-coverage ranking of buildable tiles. `radiusTiles` ~ range / 2 (tile size is 2 world units). */
export function rankSites(level: LevelDef, count: number, radiusTiles = 3.2): Site[] {
  const grid = parseLevelGrid(level);
  const lanes = [level.pathWaypoints, ...(level.extraGroundPaths ?? [])];
  const weight = new Map<string, number>();
  const add = (c: GridCoord, w: number): void => {
    const k = `${c.col},${c.row}`;
    weight.set(k, (weight.get(k) ?? 0) + w);
  };
  for (const lane of lanes) for (const c of cellsAlong(lane)) add(c, 1);
  // Flight path counts at 0.7: only some towers can reach it.
  for (const c of sampleLine(level.flightPath)) add(c, 0.7);

  const cells = [...weight.entries()].map(([k, w]) => {
    const [col, row] = k.split(',').map(Number);
    return { col, row, w };
  });
  const sites: Site[] = [];
  const taken = new Set<string>();
  for (let n = 0; n < count; n++) {
    let best: Site | null = null;
    for (let r = 0; r < level.rows; r++) {
      for (let c = 0; c < level.cols; c++) {
        if (grid[r][c] !== 'grass' || taken.has(`${c},${r}`)) continue;
        let score = 0;
        for (const cell of cells) {
          const d = Math.hypot(cell.col - c, cell.row - r);
          if (d <= radiusTiles && d >= 0.9) score += cell.w * (1 - (d / radiusTiles) * 0.35);
        }
        if (!best || score > best.score) best = { col: c, row: r, score };
      }
    }
    if (!best) break;
    sites.push(best);
    taken.add(`${best.col},${best.row}`);
    for (const cell of cells) {
      if (Math.hypot(cell.col - best.col, cell.row - best.row) <= radiusTiles) cell.w *= 0.55;
    }
  }
  return sites;
}

type Order = readonly ScriptedBuildAction[];

/** Re-targets `template` onto `sites` (template positions are mapped in order of first appearance). */
export function orderFromTemplate(template: Order, sites: readonly GridCoord[], mapping?: Map<string, GridCoord>): {
  order: ScriptedBuildAction[];
  mapping: Map<string, GridCoord>;
} {
  const map = mapping ?? new Map<string, GridCoord>();
  let next = map.size;
  const order: ScriptedBuildAction[] = [];
  for (const a of template) {
    const key = `${a.col},${a.row}`;
    let to = map.get(key);
    if (!to) {
      to = sites[next++];
      if (!to) continue;
      map.set(key, to);
    }
    order.push({ ...a, col: to.col, row: to.row });
  }
  return { order, mapping: map };
}

export function formatOrder(order: Order, indent = '    '): string {
  return order
    .map((a) => {
      const parts = [`waveIndex: ${a.waveIndex}`, `action: '${a.action}'`, `col: ${a.col}`, `row: ${a.row}`];
      if (a.towerType) parts.push(`towerType: '${a.towerType}'`);
      if (a.targetingMode) parts.push(`targetingMode: '${a.targetingMode}'`);
      return `${indent}{ ${parts.join(', ')} },`;
    })
    .join('\n');
}

function main(): void {
  const id = process.argv[2];
  const level = LEVELS.find((l) => l.id === id || String(l.index + 1) === id);
  if (!level) {
    console.error('usage: tsx scripts/levelTool.ts <levelId|number>');
    process.exit(1);
  }
  console.log(level.layout.join('\n'));
  console.log(
    rankSites(level, 24)
      .map((s, i) => `${i + 1}. (${s.col},${s.row}) ${s.score.toFixed(1)}`)
      .join('\n'),
  );
}

if (process.argv[1]?.endsWith('levelTool.ts')) main();
