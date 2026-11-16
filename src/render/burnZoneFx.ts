import * as THREE from 'three';
import { PALETTE_HEX } from '../data/palette.ts';
import { applyAlphaPreserveBlend } from './materials.ts';

interface BurnZoneVisual {
  active: boolean;
  x: number;
  z: number;
  radius: number;
  life: number;
  maxLife: number;
  emberTimer: number;
}

const MAX_ZONES = 14;
const EMBER_INTERVAL = 0.09;
const _dummy = new THREE.Object3D();

/**
 * Glowing patch + rim for Mortar T3 incendiary ground fire: two InstancedMeshes (disc + ring), no per-frame
 * allocations. Embers are emitted through the caller's particle pool via `emitEmber`.
 */
export class BurnZoneFx {
  readonly group = new THREE.Group();
  private readonly discMesh: THREE.InstancedMesh;
  private readonly ringMesh: THREE.InstancedMesh;
  private readonly discGeo: THREE.BufferGeometry;
  private readonly ringGeo: THREE.BufferGeometry;
  private readonly discMat: THREE.MeshBasicMaterial;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly zones: BurnZoneVisual[] = [];

  constructor() {
    this.discGeo = new THREE.CircleGeometry(1, 24);
    this.discGeo.rotateX(-Math.PI / 2);
    this.discMat = new THREE.MeshBasicMaterial({
      color: 0xff7a2e,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
    });
    applyAlphaPreserveBlend(this.discMat);
    this.discMesh = new THREE.InstancedMesh(this.discGeo, this.discMat, MAX_ZONES);

    this.ringGeo = new THREE.RingGeometry(0.88, 1.0, 28);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.5, 0.85, 0.4),
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    applyAlphaPreserveBlend(this.ringMat);
    this.ringMesh = new THREE.InstancedMesh(this.ringGeo, this.ringMat, MAX_ZONES);

    for (const m of [this.discMesh, this.ringMesh]) {
      m.count = 0;
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 3;
      this.group.add(m);
    }
    for (let i = 0; i < MAX_ZONES; i++) {
      this.zones.push({ active: false, x: 0, z: 0, radius: 1, life: 0, maxLife: 1, emberTimer: 0 });
    }
  }

  spawn(x: number, z: number, radius: number, duration: number): void {
    let slot: BurnZoneVisual | null = null;
    let soonest = Infinity;
    for (let i = 0; i < this.zones.length; i++) {
      const zn = this.zones[i];
      if (!zn.active) {
        slot = zn;
        break;
      }
      if (zn.life < soonest) {
        soonest = zn.life;
        slot = zn;
      }
    }
    if (!slot) return;
    slot.active = true;
    slot.x = x;
    slot.z = z;
    slot.radius = radius;
    slot.life = duration;
    slot.maxLife = duration;
    slot.emberTimer = 0;
  }

  update(
    dt: number,
    time: number,
    emitEmber: (x: number, z: number, color: number) => void,
  ): void {
    let n = 0;
    for (let i = 0; i < this.zones.length; i++) {
      const zn = this.zones[i];
      if (!zn.active) continue;
      zn.life -= dt;
      if (zn.life <= 0) {
        zn.active = false;
        continue;
      }
      // Grow in fast, hold, shrink away over the last 0.5s.
      const age = zn.maxLife - zn.life;
      const grow = Math.min(1, age / 0.18);
      const fade = Math.min(1, zn.life / 0.5);
      const pulse = 1 + Math.sin(time * 9 + i) * 0.035;
      const r = zn.radius * (0.55 + 0.45 * grow) * (0.7 + 0.3 * fade) * pulse;
      _dummy.position.set(zn.x, 0.055, zn.z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.setScalar(r);
      _dummy.updateMatrix();
      this.discMesh.setMatrixAt(n, _dummy.matrix);
      this.ringMesh.setMatrixAt(n, _dummy.matrix);
      n++;

      zn.emberTimer -= dt;
      if (zn.emberTimer <= 0) {
        zn.emberTimer += EMBER_INTERVAL;
        // Deterministic-looking scatter without Math.random: spiral by life.
        const a = zn.life * 11.7 + i * 2.1;
        const d = Math.abs(Math.sin(zn.life * 5.3 + i)) * zn.radius * 0.85;
        emitEmber(zn.x + Math.cos(a) * d, zn.z + Math.sin(a) * d, i % 3 === 0 ? PALETTE_HEX.gold : 0xff6a2a);
      }
    }
    this.discMesh.count = n;
    this.ringMesh.count = n;
    this.discMesh.visible = n > 0;
    this.ringMesh.visible = n > 0;
    if (n > 0) {
      this.discMesh.instanceMatrix.needsUpdate = true;
      this.ringMesh.instanceMatrix.needsUpdate = true;
    }
  }

  getActiveCount(): number {
    return this.discMesh.count;
  }

  clear(): void {
    for (let i = 0; i < this.zones.length; i++) this.zones[i].active = false;
    this.discMesh.count = 0;
    this.ringMesh.count = 0;
    this.discMesh.visible = false;
    this.ringMesh.visible = false;
  }

  dispose(): void {
    this.discMesh.dispose();
    this.ringMesh.dispose();
    this.discGeo.dispose();
    this.ringGeo.dispose();
    this.discMat.dispose();
    this.ringMat.dispose();
    this.group.clear();
  }
}
