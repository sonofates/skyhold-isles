/**
 * Hero tap rules (pure, unit-tested). game2d.ts asks this after the end panel, the build ring,
 * the HUD buttons and a pending rally-flag move have had their turn, and before plot taps. The
 * DOM layers on top (ability / hero-skill aiming, ui/abilityBar2d.ts + ui/heroHud2d.ts) catch the
 * pointer in the capture phase while they aim, so none of this runs then.
 *
 * Priority (first match wins):
 *  1. No hero, or the hero is down        → `pass` (a selection is dropped).
 *  2. Tap on the hero's body               → `select` (or `deselect` when already selected).
 *  3. Hero not selected                    → `pass` (plots / towers as usual).
 *  4. Tap on a plot or a tower             → `deselectPass` (drop the hero, open that plot's ring).
 *  5. Within reach of a road               → `move` (the sim clamps the point onto the verge).
 *  6. Anywhere else                        → `invalid` (red cross, the hero stays selected).
 */
export type HeroTapAction = 'pass' | 'select' | 'deselect' | 'deselectPass' | 'move' | 'invalid';

export interface HeroTapInput {
  readonly hasHero: boolean;
  readonly heroAlive: boolean;
  readonly selected: boolean;
  /** The tap is on the hero's body (with a touch-sized margin). */
  readonly onHero: boolean;
  /** The tap is on a plot or a tower body. */
  readonly onPlot: boolean;
  /** Distance (world units) from the tap to the nearest road centreline. */
  readonly offRoad: number;
  /** HERO_RULES.maxOffRoadDist. */
  readonly maxOffRoad: number;
}

/** Extra tap tolerance past the road verge (world units): a slightly sloppy tap still walks. */
export const HERO_TAP_SLACK = 0.8;

export function resolveHeroTap(i: HeroTapInput): HeroTapAction {
  if (!i.hasHero || !i.heroAlive) return 'pass';
  if (i.onHero) return i.selected ? 'deselect' : 'select';
  if (!i.selected) return 'pass';
  if (i.onPlot) return 'deselectPass';
  return i.offRoad <= i.maxOffRoad + HERO_TAP_SLACK ? 'move' : 'invalid';
}

/** Hit box for the hero in screen px: its body box, grown to at least `minPx` on each side. */
export function heroHitBox(body: { x: number; y: number; w: number; h: number }, minPx: number): { x: number; y: number; w: number; h: number } {
  const w = Math.max(body.w, minPx);
  const h = Math.max(body.h, minPx);
  return { x: body.x + body.w / 2 - w / 2, y: body.y + body.h - h, w, h };
}

export function inBox(b: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/** Aim preview shape of a hero active (by its data `kind`). */
export function heroAimShape(kind: string): 'circle' | 'cone' | 'line' | 'towers' {
  if (kind === 'shieldBash') return 'cone';
  if (kind === 'wispBurst') return 'line';
  if (kind === 'overhaul') return 'towers';
  return 'circle';
}

/** The point the sim will use: `(tx, tz)` pulled back to `range` around the hero (range 0 = no limit). */
export function clampToReach(hx: number, hz: number, tx: number, tz: number, range: number): { x: number; z: number } {
  const dx = tx - hx;
  const dz = tz - hz;
  const d = Math.hypot(dx, dz);
  if (range <= 0 || d <= range || d < 1e-6) return { x: tx, z: tz };
  return { x: hx + (dx / d) * range, z: hz + (dz / d) * range };
}

/**
 * Overhaul's targets as the sim picks them (heroSystem.pickTowersNear): non-beacon towers within
 * `range` of the hero, nearest to the aim point first (ties by id), up to `count`.
 */
export function overhaulPicks<T extends { readonly id: number; readonly x: number; readonly z: number; readonly type: string }>(
  towers: readonly T[],
  tx: number,
  tz: number,
  hx: number,
  hz: number,
  range: number,
  count: number,
): { candidates: T[]; picked: T[] } {
  const rSq = range * range;
  const candidates = towers.filter((t) => t.type !== 'beacon' && (t.x - hx) ** 2 + (t.z - hz) ** 2 <= rSq);
  const sorted = [...candidates].sort((a, b) => {
    const da = (a.x - tx) ** 2 + (a.z - tz) ** 2;
    const db = (b.x - tx) ** 2 + (b.z - tz) ** 2;
    return Math.abs(da - db) > 1e-6 ? da - db : a.id - b.id;
  });
  return { candidates, picked: sorted.slice(0, Math.max(1, count)) };
}
