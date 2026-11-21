import type { Vec3 } from '../core/types.ts';
import { HERO_RULES } from '../data/heroes.ts';
import type { CompiledPath } from './path.ts';

export interface GroundWaypoint {
  readonly x: number;
  readonly z: number;
}

export interface GroundClampResult {
  x: number;
  z: number;
  roadX: number;
  roadZ: number;
  lane: number;
  dist: number;
}

interface GraphEdge {
  readonly to: number;
  readonly cost: number;
}

interface GraphNode {
  readonly x: number;
  readonly z: number;
  readonly lane: number;
  readonly edges: GraphEdge[];
}

const SAMPLE_STEP = 0.65;
const JUNCTION_DIST = 1.05;
const DIRECT_SAMPLE_STEP = 0.25;
const MAX_ROAD_JUMP = JUNCTION_DIST + 0.35;
const _v: Vec3 = { x: 0, y: 0, z: 0 };
const _v2: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Undirected road graph built from a level's ground polylines (`groundPath` + `extraGroundPaths`).
 * Routes hero movement commands cleanly along roads, bridges, and lane merge junctions without
 * cutting across chasms, cliffs, or tower plots. Deterministic and zero-RNG.
 */
export class GroundGraph {
  readonly nodes: readonly GraphNode[];
  private readonly paths: readonly CompiledPath[];
  private readonly distBuf: Float64Array;
  private readonly prevBuf: Int32Array;
  private readonly visitedBuf: Uint8Array;
  private readonly walkDistBuf: Float64Array;
  private readonly walkVisitedBuf: Uint8Array;
  private readonly findClampDest: GroundClampResult = { x: 0, z: 0, roadX: 0, roadZ: 0, lane: 0, dist: 0 };
  private readonly findClampFrom: GroundClampResult = { x: 0, z: 0, roadX: 0, roadZ: 0, lane: 0, dist: 0 };
  private readonly segClampA: GroundClampResult = { x: 0, z: 0, roadX: 0, roadZ: 0, lane: 0, dist: 0 };
  private readonly segClampB: GroundClampResult = { x: 0, z: 0, roadX: 0, roadZ: 0, lane: 0, dist: 0 };
  private readonly walkClampPrev: GroundClampResult = { x: 0, z: 0, roadX: 0, roadZ: 0, lane: 0, dist: 0 };
  private readonly walkClampCur: GroundClampResult = { x: 0, z: 0, roadX: 0, roadZ: 0, lane: 0, dist: 0 };
  private readonly chainScratch: number[] = [];

  constructor(groundPaths: readonly CompiledPath[]) {
    this.paths = groundPaths;
    const nodes: GraphNode[] = [];

    for (let lane = 0; lane < groundPaths.length; lane++) {
      const path = groundPaths[lane];
      if (path.totalLength <= 0) continue;
      const steps = Math.max(1, Math.ceil(path.totalLength / SAMPLE_STEP));
      let prevIdx = -1;
      for (let s = 0; s <= steps; s++) {
        const d = Math.min(path.totalLength, (s / steps) * path.totalLength);
        path.sample(d, _v);
        const idx = nodes.length;
        nodes.push({ x: _v.x, z: _v.z, lane, edges: [] });
        if (prevIdx >= 0) {
          const prev = nodes[prevIdx];
          const cost = Math.hypot(_v.x - prev.x, _v.z - prev.z);
          prev.edges.push({ to: idx, cost });
          nodes[idx].edges.push({ to: prevIdx, cost });
        }
        prevIdx = idx;
      }
    }

    // Link cross-lane junctions and closely kissing switchbacks.
    const jSq = JUNCTION_DIST * JUNCTION_DIST;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if (a.lane === b.lane && j === i + 1) continue;
        // On the same lane, only bridge true self-crossings (not adjacent samples along a curve).
        if (a.lane === b.lane && j - i < 5) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dSq = dx * dx + dz * dz;
        if (dSq <= jSq) {
          const cost = Math.sqrt(dSq);
          a.edges.push({ to: j, cost });
          b.edges.push({ to: i, cost });
        }
      }
    }

    this.nodes = nodes;
    this.distBuf = new Float64Array(nodes.length);
    this.prevBuf = new Int32Array(nodes.length);
    this.visitedBuf = new Uint8Array(nodes.length);
    this.walkDistBuf = new Float64Array(nodes.length);
    this.walkVisitedBuf = new Uint8Array(nodes.length);
  }

  /** Castle threshold position where the hero spawns at run start and respawns after death. */
  castleSpawnPoint(): { x: number; z: number; yaw: number } {
    const main = this.paths[0];
    if (!main || main.totalLength <= 0) return { x: 0, z: 0, yaw: 0 };
    const dist = Math.max(0, main.totalLength - HERO_RULES.castleSpawnBackoff);
    const roadYaw = main.sample(dist, _v);
    // Face back down the road toward approaching enemies.
    let yaw = roadYaw + Math.PI;
    if (yaw > Math.PI) yaw -= Math.PI * 2;
    return { x: _v.x, z: _v.z, yaw };
  }

  /**
   * Zero-allocation clamp of `(wantX, wantZ)` onto the road or its shoulder verge into `out`.
   */
  clampToGroundOut(
    wantX: number,
    wantZ: number,
    maxOffRoad: number,
    out: GroundClampResult,
  ): GroundClampResult {
    if (!Number.isFinite(wantX) || !Number.isFinite(wantZ)) {
      const n0 = this.nodes[0];
      const fx = n0 ? n0.x : 0;
      const fz = n0 ? n0.z : 0;
      out.x = fx;
      out.z = fz;
      out.roadX = fx;
      out.roadZ = fz;
      out.lane = n0 ? n0.lane : 0;
      out.dist = 0;
      return out;
    }

    let bestLane = 0;
    let bestDist = 0;
    let bestRoadX = wantX;
    let bestRoadZ = wantZ;
    let bestSq = Infinity;

    for (let lane = 0; lane < this.paths.length; lane++) {
      const path = this.paths[lane];
      if (path.points.length === 0) continue;
      const nd = path.nearestDist(wantX, wantZ);
      path.sample(nd, _v);
      const dx = wantX - _v.x;
      const dz = wantZ - _v.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestSq - 1e-9) {
        bestSq = dSq;
        bestLane = lane;
        bestDist = nd;
        bestRoadX = _v.x;
        bestRoadZ = _v.z;
      }
    }

    out.roadX = bestRoadX;
    out.roadZ = bestRoadZ;
    out.lane = bestLane;
    out.dist = bestDist;

    const safeMaxOff =
      maxOffRoad === Infinity
        ? Infinity
        : Number.isFinite(maxOffRoad)
          ? Math.max(0, maxOffRoad)
          : HERO_RULES.maxOffRoadDist;
    const offset = Math.sqrt(bestSq);
    if (!Number.isFinite(offset) || offset <= safeMaxOff || offset < 1e-9) {
      out.x = wantX;
      out.z = wantZ;
      return out;
    }
    const scale = safeMaxOff / offset;
    out.x = bestRoadX + (wantX - bestRoadX) * scale;
    out.z = bestRoadZ + (wantZ - bestRoadZ) * scale;
    return out;
  }

  /**
   * Clamps an arbitrary world point `(wantX, wantZ)` onto the road or its shoulder verge
   * (within `maxOffRoad` of the nearest road segment across all ground lanes).
   */
  clampToGround(
    wantX: number,
    wantZ: number,
    maxOffRoad: number = HERO_RULES.maxOffRoadDist,
  ): GroundClampResult {
    return this.clampToGroundOut(
      wantX,
      wantZ,
      maxOffRoad,
      { x: 0, z: 0, roadX: 0, roadZ: 0, lane: 0, dist: 0 },
    );
  }

  private nearestNodeIndex(x: number, z: number): number {
    let best = -1;
    let bestSq = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const dSq = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (dSq < bestSq - 1e-9) {
        bestSq = dSq;
        best = i;
      }
    }
    return best;
  }

  /**
   * True when the road points nearest `(ax, az)` and `(bx, bz)` are connected within `maxGraphDist`
   * along the walkable `GroundGraph` (same road bend or local merge junction — never across an
   * unconnected canyon, river chasm, or long hairpin switchback). Deterministic, zero-allocation.
   */
  isLocallyConnected(ax: number, az: number, bx: number, bz: number, maxGraphDist: number): boolean {
    if (!Number.isFinite(ax) || !Number.isFinite(az) || !Number.isFinite(bx) || !Number.isFinite(bz)) {
      return false;
    }
    if (this.nodes.length === 0) return true;
    const ca = this.clampToGroundOut(ax, az, Infinity, this.walkClampPrev);
    const cb = this.clampToGroundOut(bx, bz, Infinity, this.walkClampCur);
    if (ca.lane === cb.lane && Math.abs(ca.dist - cb.dist) <= maxGraphDist) {
      return true;
    }
    return this.areNodesLocallyConnected(ca.roadX, ca.roadZ, cb.roadX, cb.roadZ, maxGraphDist);
  }

  private areNodesLocallyConnected(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    maxGraphDist: number,
  ): boolean {
    const startIdx = this.nearestNodeIndex(ax, az);
    const endIdx = this.nearestNodeIndex(bx, bz);
    if (startIdx < 0 || endIdx < 0) return false;
    if (startIdx === endIdx) return true;

    const count = this.nodes.length;
    const dist = this.walkDistBuf;
    const vis = this.walkVisitedBuf;
    dist.fill(Infinity);
    vis.fill(0);
    dist[startIdx] = 0;

    for (let step = 0; step < count; step++) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < count; i++) {
        if (!vis[i] && dist[i] < best) {
          best = dist[i];
          u = i;
        }
      }
      if (u === -1 || best > maxGraphDist) return false;
      if (u === endIdx) return true;
      vis[u] = 1;
      const edges = this.nodes[u].edges;
      for (let e = 0; e < edges.length; e++) {
        const edge = edges[e];
        if (vis[edge.to]) continue;
        const cand = best + edge.cost;
        if (cand < dist[edge.to] - 1e-9) {
          dist[edge.to] = cand;
        }
      }
    }
    return dist[endIdx] <= maxGraphDist;
  }

  /**
   * True when the straight segment `(ax, az) -> (bx, bz)` stays inside `maxOffRoad` of the road
   * network without jumping across unconnected parallel lanes, canyons, or hairpin switchbacks.
   * Deterministic and zero-allocation.
   */
  canWalkDirect(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    maxOffRoad: number = HERO_RULES.maxOffRoadDist,
  ): boolean {
    if (!Number.isFinite(ax) || !Number.isFinite(az) || !Number.isFinite(bx) || !Number.isFinite(bz)) {
      return false;
    }
    if (this.paths.length === 0) return true;
    const safeMaxOff =
      maxOffRoad === Infinity
        ? Infinity
        : Number.isFinite(maxOffRoad)
          ? Math.max(0, maxOffRoad)
          : HERO_RULES.maxOffRoadDist;

    const prev = this.clampToGroundOut(ax, az, Infinity, this.walkClampPrev);
    if (safeMaxOff !== Infinity && (ax - prev.roadX) ** 2 + (az - prev.roadZ) ** 2 > (safeMaxOff + 1e-4) ** 2) {
      return false;
    }

    const total = Math.hypot(bx - ax, bz - az);
    if (total < 1e-6) return true;

    const steps = Math.max(1, Math.ceil(total / DIRECT_SAMPLE_STEP));
    const maxJumpSq = MAX_ROAD_JUMP * MAX_ROAD_JUMP;
    const maxOffSq = safeMaxOff === Infinity ? Infinity : (safeMaxOff + 1e-4) ** 2;
    const localGraphLimit = Math.max(7.5, total * 3.2);

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const sx = ax + (bx - ax) * t;
      const sz = az + (bz - az) * t;
      const cur = this.clampToGroundOut(sx, sz, Infinity, this.walkClampCur);
      if ((sx - cur.roadX) ** 2 + (sz - cur.roadZ) ** 2 > maxOffSq) {
        return false;
      }
      if (
        (cur.roadX - prev.roadX) ** 2 + (cur.roadZ - prev.roadZ) ** 2 > maxJumpSq &&
        !this.areNodesLocallyConnected(prev.roadX, prev.roadZ, cur.roadX, cur.roadZ, localGraphLimit)
      ) {
        return false;
      }
      prev.roadX = cur.roadX;
      prev.roadZ = cur.roadZ;
      prev.lane = cur.lane;
      prev.dist = cur.dist;
    }
    return true;
  }

  private segmentCorridorLimit(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    safeMaxOff: number,
  ): number {
    if (safeMaxOff === Infinity) return Infinity;
    const ca = this.clampToGroundOut(ax, az, Infinity, this.segClampA);
    const cb = this.clampToGroundOut(bx, bz, Infinity, this.segClampB);
    const offA = Math.hypot(ax - ca.roadX, az - ca.roadZ);
    const offB = Math.hypot(bx - cb.roadX, bz - cb.roadZ);
    const endpointMax = Math.max(offA, offB);
    if (Math.min(offA, offB) < 0.02) return -1;
    return Math.max(endpointMax, Math.min(safeMaxOff, endpointMax + 0.01));
  }

  /**
   * Populates `out` in-place with deterministic waypoints along the ground road graph from
   * `(fromX, fromZ)` to the clamped ground point for `(wantX, wantZ)`.
   */
  findPathInto(
    fromX: number,
    fromZ: number,
    wantX: number,
    wantZ: number,
    maxOffRoad: number,
    out: GroundWaypoint[],
  ): GroundWaypoint[] {
    out.length = 0;
    const safeMaxOff =
      maxOffRoad === Infinity
        ? Infinity
        : Number.isFinite(maxOffRoad)
          ? Math.max(0, maxOffRoad)
          : HERO_RULES.maxOffRoadDist;
    const clamped = this.clampToGroundOut(wantX, wantZ, safeMaxOff, this.findClampDest);
    let destX = clamped.x;
    let destZ = clamped.z;
    const targetX = Number.isFinite(wantX) && Number.isFinite(wantZ) ? wantX : destX;
    const targetZ = Number.isFinite(wantX) && Number.isFinite(wantZ) ? wantZ : destZ;

    if (this.nodes.length === 0) {
      out.push({ x: destX, z: destZ });
      return out;
    }

    const fromClamp = this.clampToGroundOut(fromX, fromZ, Infinity, this.findClampFrom);
    const startX = Number.isFinite(fromX) && Number.isFinite(fromZ) ? fromX : fromClamp.x;
    const startZ = Number.isFinite(fromX) && Number.isFinite(fromZ) ? fromZ : fromClamp.z;
    const sameNeighborhood =
      (fromClamp.lane === clamped.lane && Math.abs(fromClamp.dist - clamped.dist) <= 1.8) ||
      Math.hypot(fromClamp.roadX - clamped.roadX, fromClamp.roadZ - clamped.roadZ) <= JUNCTION_DIST;
    if (sameNeighborhood && Math.hypot(destX - startX, destZ - startZ) <= 1.4) {
      out.push({ x: destX, z: destZ });
      return out;
    }

    const directLim = this.segmentCorridorLimit(startX, startZ, destX, destZ, safeMaxOff);
    if (directLim >= 0 && this.canWalkDirect(startX, startZ, destX, destZ, directLim)) {
      out.push({ x: destX, z: destZ });
      return out;
    }

    const startIdx = this.nearestNodeIndex(startX, startZ);
    let endIdx = this.nearestNodeIndex(clamped.roadX, clamped.roadZ);
    if (startIdx < 0 || endIdx < 0 || startIdx === endIdx) {
      out.push({ x: destX, z: destZ });
      return out;
    }

    const count = this.nodes.length;
    this.distBuf.fill(Infinity);
    this.prevBuf.fill(-1);
    this.visitedBuf.fill(0);
    this.distBuf[startIdx] = 0;

    for (let step = 0; step < count; step++) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < count; i++) {
        if (!this.visitedBuf[i] && this.distBuf[i] < best) {
          best = this.distBuf[i];
          u = i;
        }
      }
      if (u === -1 || u === endIdx) break;
      this.visitedBuf[u] = 1;
      const edges = this.nodes[u].edges;
      for (let e = 0; e < edges.length; e++) {
        const edge = edges[e];
        if (this.visitedBuf[edge.to]) continue;
        const cand = best + edge.cost;
        if (cand < this.distBuf[edge.to] - 1e-9) {
          this.distBuf[edge.to] = cand;
          this.prevBuf[edge.to] = u;
        }
      }
    }

    if (!Number.isFinite(this.distBuf[endIdx])) {
      // Disconnected graph component fallback: route to the closest reachable node instead of crossing a chasm.
      let bestReachIdx = startIdx;
      let bestReachSq = Infinity;
      for (let i = 0; i < count; i++) {
        if (!Number.isFinite(this.distBuf[i])) continue;
        const dSq = (this.nodes[i].x - targetX) ** 2 + (this.nodes[i].z - targetZ) ** 2;
        if (dSq < bestReachSq - 1e-9) {
          bestReachSq = dSq;
          bestReachIdx = i;
        }
      }
      endIdx = bestReachIdx;
      const rn = this.nodes[endIdx];
      const off = Math.hypot(targetX - rn.x, targetZ - rn.z);
      if (off <= safeMaxOff || off < 1e-9) {
        destX = targetX;
        destZ = targetZ;
      } else {
        const s = safeMaxOff / off;
        destX = rn.x + (targetX - rn.x) * s;
        destZ = rn.z + (targetZ - rn.z) * s;
      }
      if (endIdx === startIdx) {
        out.push({ x: destX, z: destZ });
        return out;
      }
    }

    const chain = this.chainScratch;
    chain.length = 0;
    for (let cur = endIdx; cur !== -1; cur = this.prevBuf[cur]) {
      chain.push(cur);
      if (cur === startIdx) break;
    }
    chain.reverse();

    // Trim the first graph node if stepping straight to chain[1] avoids a tiny backtrack.
    if (chain.length >= 2) {
      const n0 = this.nodes[chain[0]];
      const n1 = this.nodes[chain[1]];
      const segDx = n1.x - n0.x;
      const segDz = n1.z - n0.z;
      const fromDx = startX - n0.x;
      const fromDz = startZ - n0.z;
      if (fromDx * segDx + fromDz * segDz > 0) {
        chain.shift();
      }
    }

    // Trim the last graph node if `dest` lies between `chain[last - 1]` and `chain[last]`.
    if (chain.length >= 2) {
      const prev = this.nodes[chain[chain.length - 2]];
      const last = this.nodes[chain[chain.length - 1]];
      const segDx = last.x - prev.x;
      const segDz = last.z - prev.z;
      const destDx = destX - last.x;
      const destDz = destZ - last.z;
      if (destDx * segDx + destDz * segDz < 0) {
        chain.pop();
      }
    }

    for (let i = 0; i < chain.length; i++) {
      const n = this.nodes[chain[i]];
      if (Math.hypot(n.x - startX, n.z - startZ) < 0.05) continue;
      out.push({ x: n.x, z: n.z });
    }
    const prevWp = out[out.length - 1];
    if (!prevWp || Math.hypot(destX - prevWp.x, destZ - prevWp.z) > 0.03) {
      out.push({ x: destX, z: destZ });
    }
    if (out.length === 0) out.push({ x: destX, z: destZ });
    return out;
  }

  /**
   * Computes a deterministic waypoint list along the ground road graph from `(fromX, fromZ)`
   * to the clamped ground point for `(wantX, wantZ)`.
   */
  findPath(
    fromX: number,
    fromZ: number,
    wantX: number,
    wantZ: number,
    maxOffRoad: number = HERO_RULES.maxOffRoadDist,
  ): GroundWaypoint[] {
    return this.findPathInto(fromX, fromZ, wantX, wantZ, maxOffRoad, []);
  }
}

/**
 * Finds the road point where all ground lanes converge before the castle (or ~55% down a single-lane
 * road), suitable for scripted hero positioning (`npm run sim:heroes`).
 */
export function findMergePoint(groundPaths: readonly CompiledPath[]): GroundWaypoint {
  const main = groundPaths[0];
  if (!main || main.totalLength <= 0) return { x: 0, z: 0 };
  if (groundPaths.length === 1) {
    main.sample(main.totalLength * 0.55, _v);
    return { x: _v.x, z: _v.z };
  }

  // Walk backward from the goal along lane 0 until lanes diverge (> 0.7u apart).
  let earliestSharedDist = main.totalLength;
  const step = 0.25;
  for (let d = main.totalLength; d >= 0; d -= step) {
    main.sample(d, _v);
    let allClose = true;
    for (let l = 1; l < groundPaths.length; l++) {
      const other = groundPaths[l];
      const nd = other.nearestDist(_v.x, _v.z);
      other.sample(nd, _v2);
      if (Math.hypot(_v.x - _v2.x, _v.z - _v2.z) > 0.7) {
        allClose = false;
        break;
      }
    }
    if (allClose) {
      earliestSharedDist = d;
    } else {
      break;
    }
  }

  const anchorDist = Math.min(Math.max(0, main.totalLength - 1.5), earliestSharedDist + 0.8);
  main.sample(anchorDist, _v);
  return { x: _v.x, z: _v.z };
}
