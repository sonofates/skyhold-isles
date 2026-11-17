import * as THREE from 'three';
import type { SeededRng } from '../core/rng.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import { mergeColoredParts, type ColoredPart } from './geometryHelpers.ts';
import type { AmbientSpec, IsletStyle } from './islandThemes.ts';
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

interface Flier {
  orbit: boolean;
  cx: number;
  cz: number;
  radius: number;
  height: number;
  speed: number;
  phase: number;
  phase2: number;
  flapSpeed: number;
  flapAmp: number;
  size: number;
  dir: number;
}

interface Leaf {
  x: number;
  z: number;
  phase: number;
  fall: number;
  sway: number;
  spin: number;
}

const _dummy = new THREE.Object3D();
const _base = new THREE.Matrix4();
const _wing = new THREE.Matrix4();
const _rot = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();

/** Pair of instanced wings (left/right) sharing flier state: birds (orbiting) and butterflies (wandering). */
class FlierSwarm {
  readonly left: THREE.InstancedMesh;
  readonly right: THREE.InstancedMesh;
  readonly fliers: Flier[] = [];

  constructor(
    geoLeft: THREE.BufferGeometry,
    geoRight: THREE.BufferGeometry,
    material: THREE.Material,
    fliers: Flier[],
    colors: readonly number[],
  ) {
    this.fliers = fliers;
    this.left = new THREE.InstancedMesh(geoLeft, material, fliers.length);
    this.right = new THREE.InstancedMesh(geoRight, material, fliers.length);
    const c = new THREE.Color();
    for (let i = 0; i < fliers.length; i++) {
      c.setHex(colors[i % colors.length]);
      this.left.setColorAt(i, c);
      this.right.setColorAt(i, c);
    }
    for (const m of [this.left, this.right]) {
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = false;
    }
  }

  update(t: number): void {
    for (let i = 0; i < this.fliers.length; i++) {
      const f = this.fliers[i];
      let x: number;
      let y: number;
      let z: number;
      let dx: number;
      let dz: number;
      if (f.orbit) {
        const a = f.phase + f.dir * f.speed * t;
        x = f.cx + Math.cos(a) * f.radius;
        z = f.cz + Math.sin(a) * f.radius * 0.82;
        y = f.height + Math.sin(t * 0.7 + f.phase2) * 0.35;
        dx = -Math.sin(a) * f.dir;
        dz = Math.cos(a) * 0.82 * f.dir;
      } else {
        const a1 = t * f.speed + f.phase;
        const a2 = t * f.speed * 0.83 + f.phase2;
        x = f.cx + Math.sin(a1) * f.radius;
        z = f.cz + Math.cos(a2) * f.radius;
        y = f.height + Math.sin(t * f.speed * 2.3 + f.phase) * 0.12;
        dx = Math.cos(a1);
        dz = -Math.sin(a2) * 0.83;
      }
      const yaw = Math.atan2(dx, dz);
      _pos.set(x, y, z);
      _quat.setFromEuler(_euler.set(0, yaw, 0));
      _scale.setScalar(f.size);
      _base.compose(_pos, _quat, _scale);
      const flap = Math.sin(t * f.flapSpeed + f.phase * 3.1) * f.flapAmp;
      _wing.multiplyMatrices(_base, _rot.makeRotationZ(flap));
      this.left.setMatrixAt(i, _wing);
      _wing.multiplyMatrices(_base, _rot.makeRotationZ(-flap));
      this.right.setMatrixAt(i, _wing);
    }
    this.left.instanceMatrix.needsUpdate = true;
    this.right.instanceMatrix.needsUpdate = true;
  }
}

function wingGeometry(side: 1 | -1, length: number, chord: number, bodyColor: number): THREE.BufferGeometry {
  const wing = new THREE.BoxGeometry(length, 0.012, chord);
  const body = new THREE.BoxGeometry(0.07, 0.05, chord * 0.9);
  const merged = mergeColoredParts([
    { geometry: wing, colorHex: 0xffffff, position: [side * length * 0.5, 0, 0], rotation: [0, side * -0.18, 0] },
    { geometry: body, colorHex: bodyColor, position: [0, 0, 0] },
  ]);
  wing.dispose();
  body.dispose();
  return merged;
}

export class AmbientDiorama {
  readonly group = new THREE.Group();
  private disposableGeometries: THREE.BufferGeometry[] = [];
  private isletMesh: THREE.InstancedMesh | null = null;
  private cloudMesh: THREE.InstancedMesh | null = null;
  private leafMesh: THREE.InstancedMesh | null = null;
  private leafRise = false;
  private swarms: FlierSwarm[] = [];
  private islets: IsletPlacement[] = [];
  private clouds: CloudPlacement[] = [];
  private leaves: Leaf[] = [];
  private lowQuality = false;

  build(
    lagoonRadius: number,
    rng: SeededRng,
    materials: MaterialLibrary,
    unitBox: THREE.BufferGeometry,
    unitCone: THREE.BufferGeometry,
    unitIco: THREE.BufferGeometry,
    spec: AmbientSpec,
  ): void {
    this.dispose();

    const owned: THREE.BufferGeometry[] = [];
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 5);
    const octa = new THREE.OctahedronGeometry(1, 0);
    owned.push(cyl, octa);

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
        colorHex: spec.isletStyle === 'rock' ? 0x9aa4b0 : spec.isletStyle === 'palm' ? 0xe9d3a6 : PALETTE_HEX.grass,
        position: [0, 0.22, 0],
        rotation: [0, 0.3, 0],
        scale: [1.6, 0.2, 1.5],
      },
      ...isletTop(spec.isletStyle ?? 'meadow', unitBox, unitCone, unitIco, cyl, octa),
    ];
    const isletGeo = mergeColoredParts(isletParts);
    this.disposableGeometries.push(isletGeo);

    const isletCount = Math.max(0, spec.islets);
    const isletDistanceBase = lagoonRadius + 2.6;
    this.isletMesh = new THREE.InstancedMesh(isletGeo, materials.vertexColored, Math.max(1, isletCount));
    this.isletMesh.count = isletCount;
    this.isletMesh.castShadow = false;
    this.isletMesh.receiveShadow = true;
    this.isletMesh.frustumCulled = false;

    for (let i = 0; i < isletCount; i++) {
      const ang = 0.55 + (i / isletCount) * Math.PI * 2 + rng.range(-0.18, 0.18);
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

    const cloudCount = Math.max(0, spec.clouds);
    this.cloudMesh = new THREE.InstancedMesh(cloudGeo, materials.solid.get('cream')!, Math.max(1, cloudCount));
    this.cloudMesh.count = cloudCount;
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

    // Birds: lazy orbits high above the island, flapping wings
    if (spec.birds > 0) {
      const fliers: Flier[] = [];
      for (let i = 0; i < spec.birds; i++) {
        fliers.push({
          orbit: true,
          cx: rng.range(-2, 2),
          cz: rng.range(-2, 2),
          radius: lagoonRadius * rng.range(0.8, 1.1),
          height: rng.range(4.5, 8),
          speed: rng.range(0.07, 0.13),
          phase: rng.range(0, Math.PI * 2),
          phase2: rng.range(0, Math.PI * 2),
          flapSpeed: rng.range(5.5, 7.5),
          flapAmp: 0.5,
          size: rng.range(1.0, 1.4),
          dir: rng.chance(0.5) ? 1 : -1,
        });
      }
      const gl = wingGeometry(1, 0.42, 0.16, 0xf8f4e8);
      const gr = wingGeometry(-1, 0.42, 0.16, 0xf8f4e8);
      this.disposableGeometries.push(gl, gr);
      const swarm = new FlierSwarm(gl, gr, materials.vertexColored, fliers, [0xffffff, 0xeef2f8, 0xdfe6ef]);
      this.swarms.push(swarm);
      this.group.add(swarm.left, swarm.right);
    }

    // Butterflies: tiny colourful wanderers just above the grass
    if (spec.butterflies > 0) {
      const fliers: Flier[] = [];
      const spread = lagoonRadius * 0.55;
      for (let i = 0; i < spec.butterflies; i++) {
        fliers.push({
          orbit: false,
          cx: rng.range(-spread, spread),
          cz: rng.range(-spread * 0.8, spread * 0.8),
          radius: rng.range(0.7, 1.6),
          height: rng.range(0.55, 1.05),
          speed: rng.range(0.5, 0.9),
          phase: rng.range(0, Math.PI * 2),
          phase2: rng.range(0, Math.PI * 2),
          flapSpeed: rng.range(16, 22),
          flapAmp: 0.85,
          size: rng.range(0.42, 0.58) * (spec.butterflySize ?? 1),
          dir: 1,
        });
      }
      const bl = wingGeometry(1, 0.42, 0.34, 0x484573);
      const br = wingGeometry(-1, 0.42, 0.34, 0x484573);
      this.disposableGeometries.push(bl, br);
      const swarm = new FlierSwarm(
        bl,
        br,
        materials.vertexColored,
        fliers,
        spec.butterflyColors ?? [PALETTE_HEX.gold, PALETTE_HEX.coral, PALETTE_HEX.cream, 0x5be3ff, 0xbd82e1],
      );
      this.swarms.push(swarm);
      this.group.add(swarm.left, swarm.right);
    }

    // Drifting leaves / petals
    if (spec.leafColors && spec.leafColors.length > 0 && (spec.leafCount ?? 0) > 0) {
      const rise = spec.leafRise === true;
      this.leafRise = rise;
      const leafGeo = rise ? new THREE.BoxGeometry(0.1, 0.14, 0.1) : new THREE.BoxGeometry(0.13, 0.012, 0.08);
      const merged = mergeColoredParts([{ geometry: leafGeo, colorHex: 0xffffff }]);
      leafGeo.dispose();
      this.disposableGeometries.push(merged);
      const n = spec.leafCount ?? 0;
      this.leafMesh = new THREE.InstancedMesh(merged, materials.vertexColored, n);
      this.leafMesh.castShadow = false;
      this.leafMesh.receiveShadow = false;
      this.leafMesh.frustumCulled = false;
      const c = new THREE.Color();
      const spread = lagoonRadius * 0.7;
      for (let i = 0; i < n; i++) {
        c.setHex(spec.leafColors[i % spec.leafColors.length]);
        this.leafMesh.setColorAt(i, c);
        this.leaves.push({
          x: rng.range(-spread, spread),
          z: rng.range(-spread * 0.8, spread * 0.8),
          phase: rng.range(0, 1),
          fall: rng.range(0.05, 0.1),
          sway: rng.range(0.6, 1.5),
          spin: rng.range(1.2, 3),
        });
      }
      if (this.leafMesh.instanceColor) this.leafMesh.instanceColor.needsUpdate = true;
      this.group.add(this.leafMesh);
    }

    for (const g of owned) g.dispose();
    this.setQuality(this.lowQuality);
    this.update(0);
  }

  /** 'low' quality drops the purely decorative fliers/leaves (islets and clouds stay). */
  setQuality(low: boolean): void {
    this.lowQuality = low;
    for (const s of this.swarms) {
      s.left.visible = !low;
      s.right.visible = !low;
    }
    if (this.leafMesh) this.leafMesh.visible = !low;
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

    if (!this.lowQuality) {
      for (let s = 0; s < this.swarms.length; s++) this.swarms[s].update(elapsedTime);
    }

    if (this.leafMesh && !this.lowQuality) {
      for (let i = 0; i < this.leaves.length; i++) {
        const l = this.leaves[i];
        const frac = (elapsedTime * l.fall + l.phase) % 1;
        if (this.leafRise) {
          _dummy.position.set(
            l.x + Math.sin(elapsedTime * 0.35 * l.sway + l.phase * 9) * 0.8 + frac * 0.8,
            -0.6 + frac * 5.2,
            l.z + Math.cos(elapsedTime * 0.3 * l.sway + l.phase * 5) * 0.6,
          );
          _dummy.rotation.set(0, elapsedTime * 0.4 * l.sway, 0);
        } else {
          _dummy.position.set(
            l.x + Math.sin(elapsedTime * 0.7 * l.sway + l.phase * 9) * 1.2 + frac * 1.6,
            4.2 - frac * 5.0,
            l.z + Math.cos(elapsedTime * 0.55 * l.sway + l.phase * 5) * 0.9,
          );
          _dummy.rotation.set(elapsedTime * l.spin, elapsedTime * l.spin * 0.7, elapsedTime * l.spin * 0.4);
        }
        _dummy.scale.setScalar(frac < 0.06 ? frac / 0.06 : frac > 0.92 ? (1 - frac) / 0.08 : 1);
        _dummy.updateMatrix();
        this.leafMesh.setMatrixAt(i, _dummy.matrix);
      }
      this.leafMesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.isletMesh?.dispose();
    this.cloudMesh?.dispose();
    this.leafMesh?.dispose();
    for (const s of this.swarms) {
      s.left.dispose();
      s.right.dispose();
    }
    this.isletMesh = null;
    this.cloudMesh = null;
    this.leafMesh = null;
    this.swarms = [];
    this.group.clear();
    for (let i = 0; i < this.disposableGeometries.length; i++) {
      this.disposableGeometries[i].dispose();
    }
    this.disposableGeometries.length = 0;
    this.islets.length = 0;
    this.clouds.length = 0;
    this.leaves.length = 0;
  }
}

/** Decorative top of each drifting islet, matched to the island's theme. */
function isletTop(
  style: IsletStyle,
  box: THREE.BufferGeometry,
  cone: THREE.BufferGeometry,
  ico: THREE.BufferGeometry,
  cyl: THREE.BufferGeometry,
  octa: THREE.BufferGeometry,
): ColoredPart[] {
  switch (style) {
    case 'palm':
      return [
        { geometry: cyl, colorHex: 0x9a7348, position: [0.1, 0.52, 0], rotation: [0, 0, -0.18], scale: [0.05, 0.62, 0.05] },
        { geometry: cone, colorHex: 0x3fae4f, position: [0.2, 0.9, 0], rotation: [0, 0.4, 0], scale: [0.55, 0.22, 0.55] },
        { geometry: ico, colorHex: PALETTE_HEX.coral, position: [-0.4, 0.3, 0.3], scale: [0.1, 0.07, 0.1] },
      ];
    case 'crystal':
      return [
        { geometry: octa, colorHex: 0x3fe0a0, position: [0.1, 0.66, -0.05], rotation: [0.05, 0.4, 0.1], scale: [0.22, 0.62, 0.22] },
        { geometry: octa, colorHex: 0x7dffb8, position: [-0.3, 0.5, 0.2], rotation: [-0.1, 1.1, -0.2], scale: [0.14, 0.4, 0.14] },
        { geometry: octa, colorHex: 0xc9a0ff, position: [0.4, 0.45, 0.3], rotation: [0.1, 2.1, 0.2], scale: [0.12, 0.34, 0.12] },
      ];
    case 'pine':
      return [
        { geometry: cone, colorHex: 0x2f7d3a, position: [0.1, 0.62, -0.05], scale: [0.48, 0.72, 0.48] },
        { geometry: cone, colorHex: 0x3a8c44, position: [-0.4, 0.5, 0.25], scale: [0.34, 0.5, 0.34] },
      ];
    case 'ruin':
      return [
        { geometry: box, colorHex: 0xb4bbc7, position: [0.3, 0.55, 0], scale: [0.2, 0.7, 0.2] },
        { geometry: box, colorHex: 0xa1aab8, position: [-0.25, 0.45, 0.2], scale: [0.2, 0.5, 0.2] },
        { geometry: box, colorHex: 0x8b95a5, position: [0.05, 0.38, -0.3], scale: [0.5, 0.16, 0.2] },
      ];
    case 'rock':
      return [
        { geometry: cone, colorHex: 0x8e98a8, position: [0.05, 0.75, 0], scale: [0.5, 1.0, 0.5] },
        { geometry: cone, colorHex: 0x7d8798, position: [-0.45, 0.55, 0.2], scale: [0.3, 0.6, 0.3] },
      ];
    case 'meadow':
    default:
      return [
        {
          geometry: ico,
          colorHex: PALETTE_HEX.foliageDark,
          position: [0.14, 0.58, -0.1],
          scale: [0.46, 0.6, 0.46],
        },
      ];
  }
}
