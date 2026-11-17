import type { RingSpec, SpriteFit } from './towerFit.ts';

/**
 * Aimable turrets (pure math, no Pixi). Directional towers (archer, cannon, ballista) draw a static
 * BODY (ring-fitted like any tower sprite) and a TURRET piece on its platform, picked from 8
 * directions by the screen-space angle to the target. The art ships 5 frames (S, SE, E, NE, N);
 * W / SW / NW mirror E / SE / NE about the piece's foot. Packed by tools/sprites/turret_pack.py.
 *
 * Screen angles: 0 = right (E), +π/2 = down (S, toward the camera), map px y grows downward. The
 * 2D map is unforeshortened (MapView.pxX / pxY use one scale), so a sim yaw (atan2(dx, dz)) maps to
 * the screen vector (sin yaw, cos yaw).
 */

/** Sectors clockwise from E, 45° apart. */
export const SECTORS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;
export type Sector = (typeof SECTORS)[number];
/** Frame order in the packed turret strip. */
export const TURRET_DIRS = ['S', 'SE', 'E', 'NE', 'N'] as const;
/** Idle default before a turret ever had a target: SE (index into SECTORS). */
export const DEFAULT_SECTOR = 1;
/** Extra angle (rad) past a sector border before the turret switches (no flicker at borders). */
export const SECTOR_HYSTERESIS = (8 * Math.PI) / 180;

const STEP = Math.PI / 4;
const TAU = Math.PI * 2;

function wrap(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}

/** Screen angle of a sim yaw (atan2(dx, dz)). */
export function yawToScreenAngle(yaw: number): number {
  return Math.atan2(Math.cos(yaw), Math.sin(yaw));
}

/** Nearest sector (index into SECTORS) to a screen angle. */
export function sectorOf(angle: number): number {
  return ((Math.round(wrap(angle) / STEP) % 8) + 8) % 8;
}

/**
 * Sector to show for a target at `angle`, given the one shown now (-1 = none yet): it only changes
 * once the angle is more than half a sector plus `hysteresis` away from the current sector's centre.
 */
export function pickSector(angle: number, current: number, hysteresis = SECTOR_HYSTERESIS): number {
  if (current < 0 || current > 7) return sectorOf(angle);
  const off = Math.abs(wrap(angle - current * STEP));
  return off <= STEP / 2 + hysteresis ? current : sectorOf(angle);
}

/** Unit screen vector of a sector (E = (1, 0), S = (0, 1)). */
export function sectorVector(sector: number): { x: number; y: number } {
  const a = sector * STEP;
  // Rounded so the axis sectors are exact (and +0, not -0).
  return { x: Math.round(Math.cos(a) * 1e9) / 1e9 + 0, y: Math.round(Math.sin(a) * 1e9) / 1e9 + 0 };
}

/** Strip frame (index into TURRET_DIRS) of a sector and whether it is drawn mirrored. */
export function frameFor(sector: number): { frame: number; mirror: boolean } {
  switch (((sector % 8) + 8) % 8) {
    case 0:
      return { frame: 2, mirror: false }; // E
    case 1:
      return { frame: 1, mirror: false }; // SE
    case 2:
      return { frame: 0, mirror: false }; // S
    case 3:
      return { frame: 1, mirror: true }; // SW = SE mirrored
    case 4:
      return { frame: 2, mirror: true }; // W = E mirrored
    case 5:
      return { frame: 3, mirror: true }; // NW = NE mirrored
    case 6:
      return { frame: 4, mirror: false }; // N
    default:
      return { frame: 3, mirror: false }; // NE
  }
}

/** Packed turret description (`<type>-<tier>-turret.json`). */
export interface TurretSpec {
  readonly image: string;
  readonly frameW: number;
  readonly frameH: number;
  /** The piece's foot in frame px (sprite anchor; mirroring is about it). */
  readonly pivot: readonly [number, number];
  /** Per frame (TURRET_DIRS order): barrel / bolt / arrow tip relative to the pivot, frame px. */
  readonly muzzle: readonly (readonly [number, number])[];
  /** Body file (relative to the turret JSON) and its platform centre in body px. */
  readonly body: string | null;
  readonly bodyMount: readonly [number, number];
  /** The body's stone ring (body px), when measured by the packer. */
  readonly bodyRing: RingSpec | null;
  /** Turret px → body px. */
  readonly scale: number;
  readonly placeholder: boolean;
}

export class TurretSpecError extends Error {}

function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TurretSpecError(`${what} must be a finite number`);
  return v;
}

function xy(v: unknown, what: string): readonly [number, number] {
  if (!Array.isArray(v) || v.length !== 2) throw new TurretSpecError(`${what} must be [x, y]`);
  return [num(v[0], `${what}[0]`), num(v[1], `${what}[1]`)];
}

/** Parses and validates a turret JSON (`defaultImage` when it names none). */
export function parseTurretJson(raw: unknown, defaultImage = ''): TurretSpec {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TurretSpecError('turret JSON must be an object');
  const j = raw as Record<string, unknown>;
  const frameW = num(j.frameW, 'frameW');
  const frameH = num(j.frameH, 'frameH');
  if (frameW <= 0 || frameH <= 0) throw new TurretSpecError('frameW / frameH must be > 0');
  if (j.dirs !== undefined) {
    const d = j.dirs;
    if (!Array.isArray(d) || d.length !== TURRET_DIRS.length || d.some((x, i) => x !== TURRET_DIRS[i])) {
      throw new TurretSpecError(`dirs must be ${TURRET_DIRS.join(',')}`);
    }
  }
  if (!Array.isArray(j.muzzle) || j.muzzle.length !== TURRET_DIRS.length) throw new TurretSpecError('muzzle needs one [dx, dy] per direction (5)');
  const muzzle = j.muzzle.map((m, i) => xy(m, `muzzle[${i}]`));
  let bodyRing: RingSpec | null = null;
  if (j.bodyRing && typeof j.bodyRing === 'object') {
    const r = j.bodyRing as Record<string, unknown>;
    bodyRing = { ringWidthPx: num(r.ringWidthPx, 'bodyRing.ringWidthPx'), ringBottomPx: num(r.ringBottomPx, 'bodyRing.ringBottomPx'), ringCenterXPx: num(r.ringCenterXPx, 'bodyRing.ringCenterXPx') };
    if (bodyRing.ringWidthPx <= 0) throw new TurretSpecError('bodyRing.ringWidthPx must be > 0');
  }
  const image = typeof j.image === 'string' && j.image.length > 0 ? j.image : defaultImage;
  if (!image) throw new TurretSpecError('turret JSON needs an image');
  const scale = j.scale === undefined ? 1 : num(j.scale, 'scale');
  return {
    image,
    frameW,
    frameH,
    pivot: j.pivot === undefined ? [frameW / 2, frameH] : xy(j.pivot, 'pivot'),
    muzzle,
    body: typeof j.body === 'string' && j.body.length > 0 ? j.body : null,
    bodyMount: xy(j.bodyMount, 'bodyMount'),
    bodyRing,
    scale: scale > 0 ? scale : 1,
    placeholder: j.placeholder === true,
  };
}

/** The body's platform centre in map px, through the body's ring fit (+ its build / upgrade pop). */
export function mountPoint(fit: SpriteFit, ring: RingSpec, bodyMount: readonly [number, number], scaleX = fit.scale, scaleY = fit.scale): { x: number; y: number } {
  return { x: fit.x + (bodyMount[0] - ring.ringCenterXPx) * scaleX, y: fit.y + (bodyMount[1] - ring.ringBottomPx) * scaleY };
}

/** Turret sprite scale (map px per turret px) for a body drawn at `bodyScale`. */
export function turretScale(bodyScale: number, spec: Pick<TurretSpec, 'scale'>): number {
  return bodyScale * spec.scale;
}

/** Muzzle of the piece facing `sector`, in map px, for a turret whose foot is at `mount`. */
export function turretMuzzle(spec: Pick<TurretSpec, 'muzzle'>, sector: number, mount: { x: number; y: number }, scale: number, offset: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
  const { frame, mirror } = frameFor(sector);
  const m = spec.muzzle[frame];
  return { x: mount.x + (mirror ? -m[0] : m[0]) * scale + offset.x, y: mount.y + m[1] * scale + offset.y };
}

/** Recoil kick 0..1 (`t` s after the shot): a fast push back (first 20 %), eased return to rest. */
export function recoilCurve(t: number, dur: number): number {
  if (!(dur > 0) || t < 0 || t >= dur) return 0;
  const u = t / dur;
  const PEAK = 0.2;
  if (u < PEAK) {
    const k = u / PEAK;
    return 1 - (1 - k) * (1 - k);
  }
  const k = (u - PEAK) / (1 - PEAK);
  return 1 - k * k * (3 - 2 * k);
}

/** Recoil offset (map px): along the aim reversed, foreshortened a little on screen y. */
export function recoilOffset(sector: number, amount: number): { x: number; y: number } {
  const v = sectorVector(sector);
  return { x: -v.x * amount, y: -v.y * amount * 0.7 };
}

/**
 * Drawn projectile position: the sim's screen position plus the launch offset (drawn muzzle minus
 * the sim's start point), blended out over the flight (`t` = progress 0..1), so a shot leaves the
 * painted muzzle and still lands exactly where the sim hits. Render-only.
 */
export function launchBlend(simX: number, simY: number, offX: number, offY: number, t: number): { x: number; y: number } {
  const u = 1 - Math.max(0, Math.min(1, t));
  return { x: simX + offX * u, y: simY + offY * u };
}

/** Render-only lob of a (straight-flying) cannonball, map px above its line at progress `t`. */
export function cannonArcPx(duration: number, t: number): number {
  const peak = Math.max(6, Math.min(26, duration * 55));
  const u = Math.max(0, Math.min(1, t));
  return 4 * peak * u * (1 - u);
}

/** A sprite-relative muzzle point (tier sprite px) → map px through the sprite's ring fit. */
export function spriteMuzzle(fit: SpriteFit, ring: RingSpec, p: readonly [number, number]): { x: number; y: number } {
  return { x: fit.x + (p[0] - ring.ringCenterXPx) * fit.scale, y: fit.y + (p[1] - ring.ringBottomPx) * fit.scale };
}
