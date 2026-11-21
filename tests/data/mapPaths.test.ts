import { expect, it } from 'vitest';

type Point = readonly [number, number];
type Path = readonly Point[];
interface IslandLayout {
  id: string;
  imageSize: readonly [number, number];
  safeArea?: readonly [number, number, number, number];
  entrances: readonly { id: string; x: number; y: number }[];
  goal: Point;
  paths: Path[];
  flightPath?: Path;
}
const layouts = import.meta.glob<IslandLayout>(
  '../../src/data/levels2d/*.json', { eager: true, import: 'default' },
);
const mergeTolerance = 14; // layout px
const flightEntranceTolerance = 120; // layout px
const flightEdgeTolerance = 60; // layout px
const flightMaxTurnDeg = 100;
const flightMaxOvershootPx = 25;

function side(a: Point, b: Point, p: Point): number {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1,
    ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1),
  ));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function checkCrossings(path: Path, other: Path, lane: number, otherLane: number) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    // Adjacent segments in one lane are supposed to share an endpoint.
    for (let j = lane === otherLane ? i + 2 : 1; j < other.length; j++) {
      const c = other[j - 1], d = other[j];
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) {
        throw new Error(`Lane ${lane} segment ${i - 1} crosses lane ${otherLane} segment ${j - 1}`);
      }
      if (lane === otherLane && Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d),
        distanceToSegment(c, a, b), distanceToSegment(d, a, b)) < 1e-9) {
        throw new Error(`Lane ${lane} touches itself at segments ${i - 1} and ${j - 1}`);
      }
    }
  }
}

// Include segment interiors so a lane cannot leave and rejoin between two shared waypoints.
function* samples(path: Path): Generator<Point> {
  yield path[0];
  for (let i = 1; i < path.length; i++) {
    const [x, y] = path[i - 1];
    const dx = path[i][0] - x;
    const dy = path[i][1] - y;
    const steps = Math.ceil(Math.hypot(dx, dy) / (mergeTolerance / 2));
    for (let step = 1; step <= steps; step++) yield [x + dx * step / steps, y + dy * step / steps];
  }
}

function checkMerge(path: Path, other: Path, lane: number, otherLane: number) {
  let firstTouch: Point | undefined;
  for (const point of samples(path)) {
    const touches = other.some((end, i) =>
      i > 0 && distanceToSegment(point, other[i - 1], end) <= mergeTolerance,
    );
    if (touches) firstTouch ??= point;
    else if (firstTouch) {
      throw new Error(`Lane ${lane} touches lane ${otherLane} at ${firstTouch} and separates at ${point}`);
    }
  }
}

it.each(Object.values(layouts))('$id ground lanes only join on the way to the goal', ({ paths }) => {
  for (const [lane, path] of paths.entries()) {
    for (let otherLane = lane; otherLane < paths.length; otherLane++) {
      const other = paths[otherLane];
      checkCrossings(path, other, lane, otherLane);
      if (otherLane !== lane) {
        checkMerge(path, other, lane, otherLane);
        checkMerge(other, path, otherLane, lane);
      }
    }
  }
});

const flightLayouts = Object.values(layouts).filter(
  (l): l is IslandLayout & { flightPath: Path } => Boolean(l.flightPath && l.flightPath.length > 0),
);

it('covers every island with an authored flightPath', () => {
  expect(flightLayouts.length).toBeGreaterThanOrEqual(24);
});

it.each(flightLayouts)('$id flightPath is believable, smooth, inside safeArea and reaches goal without overshoot', (layout) => {
  const { flightPath, entrances, goal, imageSize } = layout;
  const [sx, sy, sw, sh] = layout.safeArea ?? [0, 0, imageSize[0], imageSize[1]];
  expect(flightPath.length).toBeGreaterThanOrEqual(2);

  // Every waypoint inside safeArea.
  for (const [i, [x, y]] of flightPath.entries()) {
    expect(x, `flight point ${i} x outside safeArea`).toBeGreaterThanOrEqual(sx - 0.5);
    expect(x, `flight point ${i} x outside safeArea`).toBeLessThanOrEqual(sx + sw + 0.5);
    expect(y, `flight point ${i} y outside safeArea`).toBeGreaterThanOrEqual(sy - 0.5);
    expect(y, `flight point ${i} y outside safeArea`).toBeLessThanOrEqual(sy + sh + 0.5);
  }

  // Starts near an entrance OR near the visible safeArea edge (open sky).
  const start = flightPath[0];
  const minEntranceDist = Math.min(...entrances.map((e) => Math.hypot(start[0] - e.x, start[1] - e.y)));
  const minEdgeDist = Math.min(start[0] - sx, sx + sw - start[0], start[1] - sy, sy + sh - start[1]);
  expect(
    minEntranceDist <= flightEntranceTolerance || minEdgeDist <= flightEdgeTolerance,
    `start (${start[0]}, ${start[1]}) is ${minEntranceDist.toFixed(1)}px from nearest entrance and ${minEdgeDist.toFixed(1)}px from safeArea edge`,
  ).toBe(true);

  // Ends at goal.
  const end = flightPath[flightPath.length - 1];
  expect(Math.hypot(end[0] - goal[0], end[1] - goal[1])).toBeLessThanOrEqual(2);

  // No turn sharper than 100° between consecutive segments.
  for (let i = 1; i < flightPath.length - 1; i++) {
    const v1x = flightPath[i][0] - flightPath[i - 1][0];
    const v1y = flightPath[i][1] - flightPath[i - 1][1];
    const v2x = flightPath[i + 1][0] - flightPath[i][0];
    const v2y = flightPath[i + 1][1] - flightPath[i][1];
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const cosA = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
    const deg = (Math.acos(cosA) * 180) / Math.PI;
    expect(deg, `turn at waypoint ${i} is ${deg.toFixed(1)}°`).toBeLessThanOrEqual(flightMaxTurnDeg);
  }

  // Never gets closer to goal and then farther again beyond tolerance (no overshoot).
  let minGoalDist = Infinity;
  for (const pt of samples(flightPath)) {
    const d = Math.hypot(pt[0] - goal[0], pt[1] - goal[1]);
    if (d < minGoalDist) minGoalDist = d;
    expect(
      d - minGoalDist,
      `flightPath overshoots goal by ${(d - minGoalDist).toFixed(1)}px at (${pt[0].toFixed(0)}, ${pt[1].toFixed(0)})`,
    ).toBeLessThanOrEqual(flightMaxOvershootPx);
  }

  // No self-intersection.
  checkCrossings(flightPath, flightPath, 0, 0);
});
