import type { GridCoord, Vec3 } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import type { WorldPoint } from '../data/levels/index.ts';
import { gridToWorldX, gridToWorldZ } from './grid.ts';

interface PathPoint {
  x: number;
  y: number;
  z: number;
  cumDist: number;
}

export class CompiledPath {
  readonly points: PathPoint[];
  readonly totalLength: number;

  /** Polyline already in world units (2D plot maps); `cols`/`rows` are ignored. */
  static fromWorld(points: readonly WorldPoint[], yLevel: number, bevelCorners: boolean): CompiledPath {
    return new CompiledPath({ world: points }, 0, 0, yLevel, bevelCorners);
  }

  constructor(
    waypoints: readonly GridCoord[] | { readonly world: readonly WorldPoint[] },
    cols: number,
    rows: number,
    yLevel: number,
    bevelCorners: boolean,
  ) {
    const raw: Array<{ x: number; y: number; z: number }> = [];
    if ('world' in waypoints) {
      const pts = waypoints.world;
      for (let i = 0; i < pts.length; i++) raw.push({ x: pts[i].x, y: yLevel, z: pts[i].z });
    } else {
      for (let i = 0; i < waypoints.length; i++) {
        raw.push({
          x: gridToWorldX(waypoints[i].col, cols),
          y: yLevel,
          z: gridToWorldZ(waypoints[i].row, rows),
        });
      }
    }

    const smoothed: Array<{ x: number; y: number; z: number }> = [];
    if (bevelCorners && raw.length >= 3) {
      smoothed.push(raw[0]);
      const bevelDist = BALANCE.tileSize * 0.34;
      for (let i = 1; i < raw.length - 1; i++) {
        const prev = raw[i - 1];
        const curr = raw[i];
        const next = raw[i + 1];

        const dx1 = curr.x - prev.x;
        const dz1 = curr.z - prev.z;
        const len1 = Math.hypot(dx1, dz1) || 1;

        const dx2 = next.x - curr.x;
        const dz2 = next.z - curr.z;
        const len2 = Math.hypot(dx2, dz2) || 1;

        const b1 = Math.min(bevelDist, len1 * 0.42);
        const b2 = Math.min(bevelDist, len2 * 0.42);

        const pIn = {
          x: curr.x - (dx1 / len1) * b1,
          y: yLevel,
          z: curr.z - (dz1 / len1) * b1,
        };
        const pOut = {
          x: curr.x + (dx2 / len2) * b2,
          y: yLevel,
          z: curr.z + (dz2 / len2) * b2,
        };
        const pMid = {
          x: (pIn.x + curr.x * 2 + pOut.x) * 0.25,
          y: yLevel,
          z: (pIn.z + curr.z * 2 + pOut.z) * 0.25,
        };

        smoothed.push(pIn, pMid, pOut);
      }
      smoothed.push(raw[raw.length - 1]);
    } else {
      for (let i = 0; i < raw.length; i++) {
        smoothed.push(raw[i]);
      }
    }

    this.points = [];
    let cum = 0;
    for (let i = 0; i < smoothed.length; i++) {
      const p = smoothed[i];
      if (i > 0) {
        const prev = smoothed[i - 1];
        cum += Math.hypot(p.x - prev.x, p.z - prev.z);
      }
      this.points.push({ x: p.x, y: p.y, z: p.z, cumDist: cum });
    }
    this.totalLength = cum;
  }

  /**
   * Path distance of the point on the path closest to (x, z) in the ground plane. Zero-alloc.
   * Ties resolve to the earliest segment so results are deterministic.
   */
  nearestDist(x: number, z: number): number {
    const pts = this.points;
    if (pts.length < 2 || !Number.isFinite(x) || !Number.isFinite(z)) return 0;
    let bestDistSq = Infinity;
    let bestCum = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const lenSq = abx * abx + abz * abz;
      let t = lenSq > 1e-9 ? ((x - a.x) * abx + (z - a.z) * abz) / lenSq : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a.x + abx * t;
      const pz = a.z + abz * t;
      const dSq = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (dSq < bestDistSq - 1e-9) {
        bestDistSq = dSq;
        bestCum = a.cumDist + (b.cumDist - a.cumDist) * t;
      }
    }
    return bestCum;
  }

  /**
   * Zero-alloc sample of world position & yaw along path distance.
   */
  sample(distance: number, outPos: Vec3): number {
    const pts = this.points;
    if (pts.length === 0) {
      outPos.x = 0;
      outPos.y = 0;
      outPos.z = 0;
      return 0;
    }
    if (pts.length === 1 || !(distance > 0)) {
      outPos.x = pts[0].x;
      outPos.y = pts[0].y;
      outPos.z = pts[0].z;
      if (pts.length >= 2) {
        return Math.atan2(pts[1].x - pts[0].x, pts[1].z - pts[0].z);
      }
      return 0;
    }
    if (distance >= this.totalLength) {
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      outPos.x = last.x;
      outPos.y = last.y;
      outPos.z = last.z;
      return Math.atan2(last.x - prev.x, last.z - prev.z);
    }

    // Linear scan is very fast since path has ~20-35 points
    let segIdx = 0;
    while (segIdx < pts.length - 2 && pts[segIdx + 1].cumDist < distance) {
      segIdx++;
    }
    const a = pts[segIdx];
    const b = pts[segIdx + 1];
    const segLen = Math.max(0.0001, b.cumDist - a.cumDist);
    const t = (distance - a.cumDist) / segLen;

    outPos.x = a.x + (b.x - a.x) * t;
    outPos.y = a.y + (b.y - a.y) * t;
    outPos.z = a.z + (b.z - a.z) * t;
    return Math.atan2(b.x - a.x, b.z - a.z);
  }
}
