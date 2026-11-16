/**
 * Decides what a tap on the map means. The ground tile under the finger always wins over tower
 * silhouettes, so a tall tower drawn in front of an empty tile can never swallow a build tap.
 */
export interface GroundTileInfo {
  col: number;
  row: number;
  /** Id of the tower standing on this tile, or -1. */
  towerId: number;
  /** Empty grass tile a tower can be built on right now. */
  buildable: boolean;
}

export type TapTarget =
  | { kind: 'tower'; id: number }
  | { kind: 'build'; col: number; row: number }
  | { kind: 'none' };

export function resolveTap(
  ground: GroundTileInfo | null,
  /** Tower whose silhouette (bounding volume) is under the finger, if any. */
  silhouetteTowerId: number | null,
): TapTarget {
  if (ground) {
    if (ground.towerId !== -1) return { kind: 'tower', id: ground.towerId };
    if (ground.buildable) return { kind: 'build', col: ground.col, row: ground.row };
  }
  // Path / water / decor / off-map: tapping the top of a tall tower still selects it.
  if (silhouetteTowerId !== null && silhouetteTowerId !== -1) {
    return { kind: 'tower', id: silhouetteTowerId };
  }
  return { kind: 'none' };
}
