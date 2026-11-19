/** Lane helpers shared by the lane marks (ui/laneMarks2d.ts) and the horn (game2d.ts); pure. */

/** Foes per ground lane in a wave (pure). Groups without a lane march from lane 0. */
export function waveLaneCounts(groups: readonly { readonly lane?: number; readonly count: number }[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const g of groups) {
    const lane = g.lane ?? 0;
    out.set(lane, (out.get(lane) ?? 0) + g.count);
  }
  return out;
}

/**
 * A point `dist` world units along a path from its start (just outside the cave mouth, where the
 * marker stands), clamped to the path's end (pure).
 */
export function pointAlong(path: readonly { readonly x: number; readonly z: number }[], dist: number): { x: number; z: number } | null {
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
