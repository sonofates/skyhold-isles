import { BALANCE } from '../balance.ts';
import type { Level2DLayout, WorldPoint } from '../levels/types.ts';
import { parseGate, type Level2DGate } from './gates.ts';

/**
 * Map-editor export (`tools/map-editor`), all in image px. `pxPerUnit`, `plotRadiusPx` and
 * `flightPath` are optional extras a map may carry.
 */
export interface Level2DJson {
  readonly id: string;
  readonly image: string;
  readonly imageSize: readonly number[];
  readonly safeArea?: readonly number[];
  readonly entrances: readonly { readonly id: string; readonly x: number; readonly y: number; readonly gate?: unknown }[];
  readonly goal: readonly number[];
  readonly paths: readonly (readonly (readonly number[])[])[];
  readonly plots: readonly (readonly number[])[];
  readonly pxPerUnit?: number;
  readonly plotRadiusPx?: number;
  readonly flightPath?: readonly (readonly number[])[];
  /** Optional goal gate (castle): prop, facing, front layer (see gates.ts). */
  readonly goalGate?: unknown;
}

/** Default world scale: 50 image px per world unit (a ~100 px stone plot ≈ one old 2.0-unit tile). */
export const DEFAULT_PX_PER_UNIT = 50;
/** Default plot radius in image px (the painted stone rings are ~90-100 px across). */
export const DEFAULT_PLOT_RADIUS_PX = 48;
/** How far the flyer route bows away from the straight entrance→goal line (fraction of its length). */
const FLIGHT_BOW = 0.12;
const FLIGHT_SAMPLES = 10;

export class Level2DError extends Error {}

function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Level2DError(`${what} is not a number`);
  return v;
}

/**
 * Converts an editor export into a sim layout. World origin = image centre:
 *   x = (px - imageW / 2) / pxPerUnit,  z = (py - imageH / 2) / pxPerUnit.
 * Validates that every path ends at the goal and that all gameplay sits inside the safe area.
 */
export function parseLevel2D(json: Level2DJson): Level2DLayout {
  const w = num(json.imageSize[0], 'imageSize[0]');
  const h = num(json.imageSize[1], 'imageSize[1]');
  const ppu = json.pxPerUnit === undefined ? DEFAULT_PX_PER_UNIT : num(json.pxPerUnit, 'pxPerUnit');
  if (w <= 0 || h <= 0 || ppu <= 0) throw new Level2DError('imageSize and pxPerUnit must be positive');
  const sa = json.safeArea ?? [0, 0, w, h];
  const safeArea = [
    num(sa[0], 'safeArea.x'),
    num(sa[1], 'safeArea.y'),
    num(sa[2], 'safeArea.w'),
    num(sa[3], 'safeArea.h'),
  ] as const;

  const toWorld = (px: number, py: number): WorldPoint => ({ x: (px - w / 2) / ppu, z: (py - h / 2) / ppu });
  const pt = (p: readonly number[], what: string): WorldPoint => {
    const px = num(p[0], `${what}.x`);
    const py = num(p[1], `${what}.y`);
    const [sx, sy, sw, sh] = safeArea;
    if (px < sx - 0.5 || px > sx + sw + 0.5 || py < sy - 0.5 || py > sy + sh + 0.5) {
      throw new Level2DError(`${what} (${px}, ${py}) is outside the safe area`);
    }
    return toWorld(px, py);
  };

  if (json.paths.length === 0) throw new Level2DError('level has no paths');
  if (json.entrances.length !== json.paths.length) {
    throw new Level2DError(`${json.entrances.length} entrances for ${json.paths.length} paths`);
  }
  const goal = pt(json.goal, 'goal');
  const paths = json.paths.map((path, i) => {
    if (path.length < 2) throw new Level2DError(`path ${i} needs at least 2 points`);
    const pts = path.map((p, j) => pt(p, `path ${i} point ${j}`));
    const last = pts[pts.length - 1];
    if (Math.hypot(last.x - goal.x, last.z - goal.z) > 0.05) {
      throw new Level2DError(`path ${i} does not end at the goal`);
    }
    return pts;
  });
  const entrances = json.entrances.map((e, i) => ({ id: String(e.id), ...pt([e.x, e.y], `entrance ${i}`) }));
  const plots = json.plots.map((p, i) => pt(p, `plot ${i}`));
  const plotRadius = (json.plotRadiusPx ?? DEFAULT_PLOT_RADIUS_PX) / ppu;

  const flightPath = json.flightPath
    ? json.flightPath.map((p, i) => pt(p, `flight point ${i}`))
    : defaultFlightPath(paths[0][0], goal);

  const gates: Level2DGate[] = [];
  json.entrances.forEach((e, i) => {
    const g = parseGate(e.gate, 'entrance', i, `entrance ${i} gate`);
    if (g) gates.push(g);
  });
  const goalGate = parseGate(json.goalGate, 'goal', -1, 'goalGate');
  if (goalGate) gates.push(goalGate);

  return {
    image: json.image,
    imageSize: [w, h],
    pxPerUnit: ppu,
    safeArea,
    entrances,
    goal,
    paths,
    flightPath,
    plots,
    plotRadius,
    gates,
  };
}

/**
 * Flyers ignore the road: they cross from the main entrance to the goal on a gentle arc (a
 * quadratic curve bowed toward the map centre), so they pass over the middle plots.
 */
export function defaultFlightPath(start: WorldPoint, goal: WorldPoint): WorldPoint[] {
  const mx = (start.x + goal.x) / 2;
  const mz = (start.z + goal.z) / 2;
  const dx = goal.x - start.x;
  const dz = goal.z - start.z;
  const len = Math.hypot(dx, dz) || 1;
  // Unit normal pointing toward the world origin (map centre).
  let nx = -dz / len;
  let nz = dx / len;
  if (nx * -mx + nz * -mz < 0) {
    nx = -nx;
    nz = -nz;
  }
  const cx = mx + nx * len * FLIGHT_BOW;
  const cz = mz + nz * len * FLIGHT_BOW;
  const out: WorldPoint[] = [];
  for (let i = 0; i <= FLIGHT_SAMPLES; i++) {
    const t = i / FLIGHT_SAMPLES;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    out.push({ x: a * start.x + b * cx + c * goal.x, z: a * start.z + b * cz + c * goal.z });
  }
  return out;
}

/** Tile-grid size that covers the map (the grid stays all-empty on plot levels). */
export function gridSizeFor(layout: Level2DLayout): { cols: number; rows: number; layout: string[] } {
  const cols = Math.ceil(layout.imageSize[0] / layout.pxPerUnit / BALANCE.tileSize);
  const rows = Math.ceil(layout.imageSize[1] / layout.pxPerUnit / BALANCE.tileSize);
  const row = new Array<string>(cols).fill('~').join(' ');
  return { cols, rows, layout: new Array<string>(rows).fill(row) };
}

/** Inverse of the loader's px→world mapping (renderers, tools). */
export function worldToImagePx(layout: Level2DLayout, x: number, z: number): { px: number; py: number } {
  return {
    px: x * layout.pxPerUnit + layout.imageSize[0] / 2,
    py: z * layout.pxPerUnit + layout.imageSize[1] / 2,
  };
}
