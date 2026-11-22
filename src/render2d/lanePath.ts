/** Lane helpers shared by the lane marks (ui/laneMarks2d.ts) and the horn (game2d.ts); pure. */

export interface PathPoint {
  readonly x: number;
  readonly z: number;
}

export interface EntranceCount {
  /** Ground lane index (0..paths.length - 1), or -1 for a dedicated flight entry (`flightPath`). */
  readonly lane: number;
  /** True when this entry is a dedicated flyer-only entry point (`lane === -1`). */
  readonly flying: boolean;
  readonly count: number;
  readonly path: readonly PathPoint[];
}

/** Max world-unit distance between `flightPath[0]` and a ground entrance to treat them as the same entry. */
export const SHARED_ENTRANCE_DIST = 1.0;

/** Foes per ground lane in a wave (pure). Groups without a lane march from lane 0. */
export function waveLaneCounts(groups: readonly { readonly lane?: number; readonly count: number }[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const g of groups) {
    if (g.count <= 0) continue;
    const lane = g.lane ?? 0;
    out.set(lane, (out.get(lane) ?? 0) + g.count);
  }
  return out;
}

/**
 * Per-entrance enemy counts for an upcoming wave (pure).
 * - Ground enemies count on their ground lane (`g.lane ?? 0`, falling back to lane 0 if out of range,
 *   matching `EnemySystem.getPath`).
 * - Flying enemies (`isFlying(g.enemyType)`) always follow `flightPath`: if `flightPath[0]` shares
 *   an entrance with a ground lane (within `SHARED_ENTRANCE_DIST`), they merge into that ground lane's
 *   count; otherwise they receive their own dedicated air entry (`lane: -1, flying: true`).
 * - Only entrances actually used by the wave (`count > 0`) are returned.
 */
export function waveEntranceCounts(
  groups: readonly { readonly enemyType?: string; readonly lane?: number; readonly count: number }[],
  paths: readonly (readonly PathPoint[])[],
  flightPath: readonly PathPoint[] | undefined,
  isFlying: (enemyType: string) => boolean,
): EntranceCount[] {
  const groundCounts = new Map<number, number>();
  const hasFlight = Boolean(flightPath && flightPath.length > 0);
  let flightGroundLane = -1;
  if (hasFlight) {
    const f0 = flightPath![0];
    for (let i = 0; i < paths.length; i++) {
      const p0 = paths[i]?.[0];
      if (p0 && Math.hypot(f0.x - p0.x, f0.z - p0.z) <= SHARED_ENTRANCE_DIST) {
        flightGroundLane = i;
        break;
      }
    }
  }
  let airCount = 0;
  for (const g of groups) {
    if (g.count <= 0) continue;
    const flyer = Boolean(g.enemyType && isFlying(g.enemyType));
    if (flyer) {
      if (hasFlight && flightGroundLane === -1) {
        airCount += g.count;
      } else if (flightGroundLane >= 0) {
        groundCounts.set(flightGroundLane, (groundCounts.get(flightGroundLane) ?? 0) + g.count);
      } else if (paths.length > 0) {
        groundCounts.set(0, (groundCounts.get(0) ?? 0) + g.count);
      }
    } else if (paths.length > 0) {
      const raw = g.lane ?? 0;
      const lane = raw >= 0 && raw < paths.length ? raw : 0;
      groundCounts.set(lane, (groundCounts.get(lane) ?? 0) + g.count);
    }
  }
  const out: EntranceCount[] = [];
  for (let i = 0; i < paths.length; i++) {
    const count = groundCounts.get(i) ?? 0;
    if (count > 0 && paths[i].length > 0) out.push({ lane: i, flying: false, count, path: paths[i] });
  }
  if (airCount > 0 && hasFlight) {
    out.push({ lane: -1, flying: true, count: airCount, path: flightPath! });
  }
  return out;
}

/**
 * Total world-unit length of a path (pure).
 */
export function pathLength(path: readonly PathPoint[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  }
  return len;
}

/**
 * The entrance with the most enemies in an upcoming wave (pure, shared by the horn).
 * Ties prefer ground entrances over a dedicated air entry (`flying: true`), then the lowest lane index.
 */
export function primaryWaveEntrance(entries: readonly EntranceCount[]): EntranceCount | null {
  let best: EntranceCount | null = null;
  for (const e of entries) {
    if (e.count <= 0 || e.path.length === 0) continue;
    if (
      !best ||
      e.count > best.count ||
      (e.count === best.count && (best.flying !== e.flying ? !e.flying : e.lane < best.lane))
    ) {
      best = e;
    }
  }
  return best;
}

/**
 * A point `dist` world units along a path from its start (just outside the cave mouth, where the
 * marker stands), clamped to the path's end (pure).
 */
export function pointAlong(path: readonly PathPoint[], dist: number): PathPoint | null {
  if (path.length === 0) return null;
  let left = dist;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len >= left && len > 0) return { x: a.x + ((b.x - a.x) * left) / len, z: a.z + ((b.z - a.z) * left) / len };
    left -= len;
  }
  const end = path[path.length - 1];
  return { x: end.x, z: end.z };
}
