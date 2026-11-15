import * as THREE from 'three';
import type { SeededRng } from '../core/rng.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import { mergeColoredParts, type ColoredPart } from './geometryHelpers.ts';
import type { MaterialLibrary } from './materials.ts';

interface IsletPlacement {
  x: number;
  baseY: number;
  z: number;
  rotY: number;
  scale: number;
  phase: number;
  speed: number;
}

interface CloudPlacement {
  baseX: number;
  baseY: number;
  baseZ: number;
  rotY: number;
  scale: number;
  phase: number;
  speed: number;
  driftAmp: number;
}

const _dummy = new THREE.Object3D();

export class AmbientDiorama {
  readonly group = new THREE.Group();
  private disposableGeometries: THREE.BufferGeometry[] = [];
  private isletMesh: THREE.InstancedMesh | null = null;
  private cloudMesh: THREE.InstancedMesh | null = null;
  private islets: IsletPlacement[] = [];
  private clouds: CloudPlacement[] = [];

  build(
    lagoonRadius: number,
    rng: SeededRng,
    materials: MaterialLibrary,
    unitBox: THREE.BufferGeometry,
    unitCone: THREE.BufferGeometry,
    unitIco: THREE.BufferGeometry,
  ): void {
    this.dispose();

    const isletParts: ColoredPart[] = [
      {
        geometry: unitCone,
        colorHex: PALETTE_HEX.stone,
        position: [0, -0.85, 0],
        rotation: [Math.PI, 0.4, 0],
        scale: [1.15, 1.75, 1.15],
      },
      {
        geometry: unitBox,
        colorHex: PALETTE_HEX.dirt,
        position: [0, -0.05, 0],
        rotation: [0, 0.3, 0],
        scale: [1.65, 0.42, 1.55],
      },
      {
        geometry: unitBox,
        colorHex: PALETTE_HEX.grass,
        position: [0, 0.22, 0],
        rotation: [0, 0.3, 0],
        scale: [1.6, 0.2, 1.5],
      },
      {
        geometry: unitIco,
        colorHex: PALETTE_HEX.foliageDark,
        position: [0.14, 0.58, -0.1],
        scale: [0.46, 0.6, 0.46],
      },
    ];
    const isletGeo = mergeColoredParts(isletParts);
    this.disposableGeometries.push(isletGeo);

    const isletDistanceBase = lagoonRadius + 2.6;
    const isletAngles = [0.55, 2.15, 3.8, 5.3];
    this.isletMesh = new THREE.InstancedMesh(isletGeo, materials.vertexColored, isletAngles.length);
    this.isletMesh.castShadow = false;
    this.isletMesh.receiveShadow = true;
    this.isletMesh.frustumCulled = false;

    for (let i = 0; i < isletAngles.length; i++) {
      const ang = isletAngles[i] + rng.range(-0.18, 0.18);
      const dist = isletDistanceBase + rng.range(0.8, 3.8);
      this.islets.push({
        x: Math.cos(ang) * dist,
        baseY: rng.range(0.1, 1.4),
        z: Math.sin(ang) * dist,
        rotY: rng.range(0, Math.PI * 2),
        scale: rng.range(0.88, 1.16),
        phase: rng.range(0, Math.PI * 2),
        speed: rng.range(0.75, 1.15),
      });
    }
    this.group.add(this.isletMesh);

    const cloudParts: ColoredPart[] = [
      { geometry: unitIco, colorHex: PALETTE_HEX.cream, position: [0, 0, 0], scale: [1.6, 0.8, 1.25] },
      { geometry: unitIco, colorHex: PALETTE_HEX.cream, position: [1.1, -0.1, 0.25], scale: [1.15, 0.65, 1.0] },
      { geometry: unitIco, colorHex: PALETTE_HEX.cream, position: [-1.05, -0.15, -0.2], scale: [1.05, 0.6, 0.95] },
    ];
    const cloudGeo = mergeColoredParts(cloudParts);
    this.disposableGeometries.push(cloudGeo);

    const cloudCount = 5;
    this.cloudMesh = new THREE.InstancedMesh(cloudGeo, materials.solid.get('cream')!, cloudCount);
    this.cloudMesh.castShadow = false;
    this.cloudMesh.receiveShadow = false;
    this.cloudMesh.frustumCulled = false;

    for (let i = 0; i < cloudCount; i++) {
      const ang = (i / cloudCount) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const dist = lagoonRadius + rng.range(4.0, 9.5);
      this.clouds.push({
        baseX: Math.cos(ang) * dist,
        baseY: rng.range(-4.5, -1.8),
        baseZ: Math.sin(ang) * dist,
        rotY: rng.range(0, Math.PI * 2),
        scale: rng.range(0.88, 1.18),
        phase: rng.range(0, Math.PI * 2),
        speed: rng.range(0.22, 0.38),
        driftAmp: rng.range(0.9, 1.6),
      });
    }
    this.group.add(this.cloudMesh);
    this.update(0);
  }

  update(elapsedTime: number): void {
    if (this.isletMesh) {
      for (let i = 0; i < this.islets.length; i++) {
        const p = this.islets[i];
        _dummy.position.set(p.x, p.baseY + Math.sin(elapsedTime * p.speed + p.phase) * 0.16, p.z);
        _dummy.rotation.set(0, p.rotY, 0);
        _dummy.scale.setScalar(p.scale);
        _dummy.updateMatrix();
        this.isletMesh.setMatrixAt(i, _dummy.matrix);
      }
      this.isletMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.cloudMesh) {
      for (let i = 0; i < this.clouds.length; i++) {
        const c = this.clouds[i];
        _dummy.position.set(
          c.baseX + Math.sin(elapsedTime * c.speed + c.phase) * c.driftAmp,
          c.baseY + Math.cos(elapsedTime * c.speed * 1.4 + c.phase) * 0.18,
          c.baseZ,
        );
        _dummy.rotation.set(0, c.rotY, 0);
        _dummy.scale.setScalar(c.scale);
        _dummy.updateMatrix();
        this.cloudMesh.setMatrixAt(i, _dummy.matrix);
      }
      this.cloudMesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.isletMesh?.dispose();
    this.cloudMesh?.dispose();
    this.isletMesh = null;
    this.cloudMesh = null;
    this.group.clear();
    for (let i = 0; i < this.disposableGeometries.length; i++) {
      this.disposableGeometries[i].dispose();
    }
    this.disposableGeometries.length = 0;
    this.islets.length = 0;
    this.clouds.length = 0;
  }
}
