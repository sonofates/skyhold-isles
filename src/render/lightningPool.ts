import * as THREE from 'three';
import type { Vec3 } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';

interface LightningArc {
  active: boolean;
  life: number;
  maxLife: number;
  basePoints: Vec3[];
}

const SEGS_PER_JUMP = 3;
const MAX_JUMPS_PER_ARC = 6;
const MAX_VERTICES_TOTAL = BALANCE.pools.maxLightningArcs * MAX_JUMPS_PER_ARC * SEGS_PER_JUMP * 2;

export class LightningArcPool {
  readonly group = new THREE.Group();
  private readonly arcs: LightningArc[] = [];
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly lineMaterial: THREE.LineBasicMaterial;
  private readonly lineSegments: THREE.LineSegments;

  constructor() {
    // Subtle HDR emissive tint triggers soft Bloom only in High post-processing mode
    this.lineMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(1.45, 2.05, 2.85),
    });
    this.positions = new Float32Array(MAX_VERTICES_TOTAL * 3);
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setDrawRange(0, 0);

    this.lineSegments = new THREE.LineSegments(this.geometry, this.lineMaterial);
    this.lineSegments.visible = false;
    this.lineSegments.frustumCulled = false;
    this.group.add(this.lineSegments);

    for (let i = 0; i < BALANCE.pools.maxLightningArcs; i++) {
      this.arcs.push({
        active: false,
        life: 0,
        maxLife: 0.16,
        basePoints: [],
      });
    }
  }

  spawn(points: readonly Vec3[]): void {
    if (points.length < 2) return;
    for (let i = 0; i < this.arcs.length; i++) {
      const arc = this.arcs[i];
      if (arc.active) continue;
      arc.active = true;
      arc.maxLife = 0.16;
      arc.life = arc.maxLife;
      arc.basePoints = points.map((pt) => ({ x: pt.x, y: pt.y, z: pt.z }));
      this.rebuildBuffer();
      return;
    }
  }

  update(dt: number): void {
    let anyActive = false;
    for (let i = 0; i < this.arcs.length; i++) {
      const arc = this.arcs[i];
      if (!arc.active) continue;
      arc.life -= dt;
      if (arc.life <= 0) {
        arc.active = false;
        continue;
      }
      anyActive = true;
    }
    if (anyActive) {
      this.rebuildBuffer();
    } else if (this.lineSegments.visible) {
      this.geometry.setDrawRange(0, 0);
      this.lineSegments.visible = false;
    }
  }

  private rebuildBuffer(): void {
    let vertexCount = 0;
    const arr = this.positions;

    for (let aIdx = 0; aIdx < this.arcs.length; aIdx++) {
      const arc = this.arcs[aIdx];
      if (!arc.active) continue;

      for (let i = 0; i < arc.basePoints.length - 1; i++) {
        const a = arc.basePoints[i];
        const b = arc.basePoints[i + 1];
        let prevX = a.x;
        let prevY = a.y;
        let prevZ = a.z;

        for (let s = 1; s <= SEGS_PER_JUMP; s++) {
          if (vertexCount + 2 > MAX_VERTICES_TOTAL) break;
          const t = s / SEGS_PER_JUMP;
          const isEnd = s === SEGS_PER_JUMP;
          const jitter = isEnd ? 0 : 0.26;
          const nextX = a.x + (b.x - a.x) * t + (Math.random() - 0.5) * jitter;
          const nextY = a.y + (b.y - a.y) * t + (Math.random() - 0.5) * jitter;
          const nextZ = a.z + (b.z - a.z) * t + (Math.random() - 0.5) * jitter;

          const off = vertexCount * 3;
          arr[off] = prevX;
          arr[off + 1] = prevY;
          arr[off + 2] = prevZ;
          arr[off + 3] = nextX;
          arr[off + 4] = nextY;
          arr[off + 5] = nextZ;
          vertexCount += 2;

          prevX = nextX;
          prevY = nextY;
          prevZ = nextZ;
        }
      }
    }

    this.geometry.setDrawRange(0, vertexCount);
    this.lineSegments.visible = vertexCount > 0;
    if (vertexCount > 0) {
      this.posAttr.needsUpdate = true;
    }
  }

  clear(): void {
    for (let i = 0; i < this.arcs.length; i++) {
      this.arcs[i].active = false;
    }
    this.geometry.setDrawRange(0, 0);
    this.lineSegments.visible = false;
  }

  dispose(): void {
    this.group.clear();
    this.geometry.dispose();
    this.lineMaterial.dispose();
  }
}
