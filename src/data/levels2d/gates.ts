/**
 * Map gates (pure, no Pixi): the raider caves enemies come out of and the castle gate they try to
 * get into. A gate's MOUTH faces along the road — an entrance faces the direction of its path's
 * first segment (enemies walk out of it), the goal faces back along the last segment (enemies walk
 * into it). Screen axes: x → right (east), y → down (south). The map compositor
 * (tools/map-compose/compose.py) uses the same rule to pick the cave / castle art and writes the
 * resolved values into the level JSON; the renderer draws each gate's FRONT layer (rock lip /
 * arch + the dark mouth shading) above the actors so walkers appear inside the darkness.
 */
export type Facing = 'E' | 'S' | 'W' | 'N';

export const FACINGS: readonly Facing[] = ['E', 'S', 'W', 'N'];

/** Quantises a screen direction to a facing. Ties (exact diagonals) go to the horizontal facing. */
export function facingFromDir(dx: number, dy: number): Facing {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W';
  return dy > 0 ? 'S' : 'N';
}

type Pt = readonly [number, number] | readonly number[];

function firstStep(path: readonly Pt[], from: number, step: 1 | -1): [number, number] {
  const p0 = path[from];
  for (let i = from + step; i >= 0 && i < path.length; i += step) {
    const dx = path[i][0] - p0[0];
    const dy = path[i][1] - p0[1];
    if (dx !== 0 || dy !== 0) return [dx, dy];
  }
  throw new Error('path has no non-zero segment');
}

/** Facing of an entrance's mouth: along the first (non-degenerate) segment of its path. */
export function entranceFacing(path: readonly Pt[]): Facing {
  const [dx, dy] = firstStep(path, 0, 1);
  return facingFromDir(dx, dy);
}

/** Facing of the goal gate's mouth: back along the last (non-degenerate) segment of a path. */
export function goalFacing(path: readonly Pt[]): Facing {
  const [dx, dy] = firstStep(path, path.length - 1, -1);
  return facingFromDir(dx, dy);
}

/** Front layer of a gate, in map image px. */
export interface GateFront {
  /** Art key in the manifest's `overlays`. */
  readonly art: string;
  /** Top-left x, y and size of the sprite (image px). */
  readonly rect: readonly [number, number, number, number];
  /** Ground y of the gate's front edge: the depth key among the actors (actors sort by ground y). */
  readonly baseY: number;
}

export interface Level2DGate {
  readonly role: 'entrance' | 'goal';
  /** Entrance index (= its ground lane), -1 for the goal. */
  readonly lane: number;
  /** Art id of the gate prop (tools/map-compose landmarks), e.g. `cave-e`, `castle-w`. */
  readonly prop: string;
  readonly facing: Facing;
  /** Drawn above walkers, or null when the gate is fully baked into the map. */
  readonly front: GateFront | null;
}

/** Sprite placement of a front layer: position, size and depth key (zIndex) inside the actors. */
export function frontPlacement(front: GateFront): { x: number; y: number; width: number; height: number; zIndex: number } {
  const [x, y, width, height] = front.rect;
  return { x, y, width, height, zIndex: front.baseY };
}

/**
 * True when a walker standing at ground point (px, py) is drawn behind the front layer (it sorts
 * below it among the actors and its feet are inside the sprite's horizontal span).
 */
export function behindFront(front: GateFront, px: number, py: number): boolean {
  const [x, , w] = front.rect;
  return py < front.baseY && px >= x && px <= x + w;
}

export class GateParseError extends Error {}

function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new GateParseError(`${what} is not a number`);
  return v;
}

/** Parses an optional `gate` object of the level JSON (entrance `gate` or top-level `goalGate`). */
export function parseGate(raw: unknown, role: 'entrance' | 'goal', lane: number, what: string): Level2DGate | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') throw new GateParseError(`${what} is not an object`);
  const g = raw as Record<string, unknown>;
  if (typeof g.prop !== 'string' || g.prop === '') throw new GateParseError(`${what}.prop is missing`);
  if (typeof g.facing !== 'string' || !FACINGS.includes(g.facing as Facing)) {
    throw new GateParseError(`${what}.facing must be one of ${FACINGS.join('/')}`);
  }
  let front: GateFront | null = null;
  if (g.front !== undefined && g.front !== null) {
    const f = g.front as Record<string, unknown>;
    if (typeof f.art !== 'string' || f.art === '') throw new GateParseError(`${what}.front.art is missing`);
    const r = f.rect;
    if (!Array.isArray(r) || r.length !== 4) throw new GateParseError(`${what}.front.rect needs [x, y, w, h]`);
    const rect = [0, 1, 2, 3].map((i) => num(r[i], `${what}.front.rect[${i}]`)) as [number, number, number, number];
    if (rect[2] <= 0 || rect[3] <= 0) throw new GateParseError(`${what}.front.rect has no size`);
    front = { art: f.art, rect, baseY: num(f.baseY, `${what}.front.baseY`) };
  }
  return { role, lane, prop: g.prop, facing: g.facing as Facing, front };
}
