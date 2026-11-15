import * as THREE from 'three';
import type { QualityLevel } from '../core/types.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import { SeededRng } from '../core/rng.ts';
import { gridToWorldX, gridToWorldZ } from '../sim/grid.ts';
import { parseLevelGrid, type LevelDef } from '../data/levels/index.ts';
import { mergeColoredParts, type ColoredPart } from './geometryHelpers.ts';
import type { MaterialLibrary } from './materials.ts';

interface SwayPlacement {
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
  phase: number;
  swayAmp: number;
}

interface DecorLayer {
  mesh: THREE.InstancedMesh;
  placements: SwayPlacement[];
  sway: boolean;
}

function interleavePlacements(list: SwayPlacement[]): SwayPlacement[] {
  const evens: SwayPlacement[] = [];
  const odds: SwayPlacement[] = [];
  for (let i = 0; i < list.length; i++) {
    if (i % 2 === 0) evens.push(list[i]);
    else odds.push(list[i]);
  }
  return [...evens, ...odds];
}

export class DecorBuilder {
  readonly group = new THREE.Group();
  private disposableGeometries: THREE.BufferGeometry[] = [];
  private layers: DecorLayer[] = [];
  private quality: QualityLevel = 'high';
  private readonly dummy = new THREE.Object3D();

  build(level: LevelDef, materials: MaterialLibrary): void {
    this.dispose();

    const grid = parseLevelGrid(level);
    const rng = new SeededRng(level.decorationSeed);

    const pinePlacements: SwayPlacement[] = [];
    const oakPlacements: SwayPlacement[] = [];
    const bushPlacements: SwayPlacement[] = [];
    const rockPlacements: SwayPlacement[] = [];
    const flowerPlacements: SwayPlacement[] = [];

    for (let r = 0; r < level.rows; r++) {
      for (let c = 0; c < level.cols; c++) {
        const tile = grid[r][c];
        const wx = gridToWorldX(c, level.cols);
        const wz = gridToWorldZ(r, level.rows);

        if (tile === 'decor') {
          const roll = rng.next();
          if (roll < 0.36) {
            pinePlacements.push({
              x: wx + rng.range(-0.22, 0.22),
              y: 0,
              z: wz + rng.range(-0.22, 0.22),
              rotY: rng.range(0, Math.PI * 2),
              scale: rng.range(0.85, 1.24),
              phase: rng.range(0, Math.PI * 2),
              swayAmp: 0.045,
            });
            if (rng.chance(0.55)) {
              flowerPlacements.push({
                x: wx + rng.range(-0.62, 0.62),
                y: 0,
                z: wz + rng.range(-0.62, 0.62),
                rotY: rng.range(0, Math.PI * 2),
                scale: rng.range(0.85, 1.15),
                phase: rng.range(0, Math.PI * 2),
                swayAmp: 0.06,
              });
            }
          } else if (roll < 0.66) {
            oakPlacements.push({
              x: wx + rng.range(-0.2, 0.2),
              y: 0,
              z: wz + rng.range(-0.2, 0.2),
              rotY: rng.range(0, Math.PI * 2),
              scale: rng.range(0.85, 1.2),
              phase: rng.range(0, Math.PI * 2),
              swayAmp: 0.04,
            });
          } else if (roll < 0.85) {
            rockPlacements.push({
              x: wx + rng.range(-0.18, 0.18),
              y: 0,
              z: wz + rng.range(-0.18, 0.18),
              rotY: rng.range(0, Math.PI * 2),
              scale: rng.range(0.85, 1.25),
              phase: 0,
              swayAmp: 0,
            });
            bushPlacements.push({
              x: wx + rng.range(-0.55, 0.55),
              y: 0,
              z: wz + rng.range(-0.55, 0.55),
              rotY: rng.range(0, Math.PI * 2),
              scale: rng.range(0.75, 1.05),
              phase: rng.range(0, Math.PI * 2),
              swayAmp: 0.055,
            });
          } else {
            bushPlacements.push({
              x: wx + rng.range(-0.25, 0.25),
              y: 0,
              z: wz + rng.range(-0.25, 0.25),
              rotY: rng.range(0, Math.PI * 2),
              scale: rng.range(0.95, 1.28),
              phase: rng.range(0, Math.PI * 2),
              swayAmp: 0.055,
            });
            flowerPlacements.push({
              x: wx + rng.range(-0.55, 0.55),
              y: 0,
              z: wz + rng.range(-0.55, 0.55),
              rotY: rng.range(0, Math.PI * 2),
              scale: rng.range(0.9, 1.2),
              phase: rng.range(0, Math.PI * 2),
              swayAmp: 0.06,
            });
          }
        }
      }
    }

    const pineGeo = this.createPineGeometry();
    const oakGeo = this.createOakGeometry();
    const bushGeo = this.createBushGeometry();
    const rockGeo = this.createRockGeometry();
    const flowerGeo = this.createFlowerGeometry();

    this.createInstancedLayer(pineGeo, interleavePlacements(pinePlacements), materials, true, true);
    this.createInstancedLayer(oakGeo, interleavePlacements(oakPlacements), materials, true, true);
    this.createInstancedLayer(bushGeo, interleavePlacements(bushPlacements), materials, true, false);
    this.createInstancedLayer(rockGeo, interleavePlacements(rockPlacements), materials, false, false);
    this.createInstancedLayer(flowerGeo, interleavePlacements(flowerPlacements), materials, true, false);

    this.applyDensity();
  }

  private createInstancedLayer(
    geo: THREE.BufferGeometry,
    placements: SwayPlacement[],
    materials: MaterialLibrary,
    sway: boolean,
    castShadow: boolean,
  ): void {
    this.disposableGeometries.push(geo);
    if (placements.length === 0) {
      return;
    }
    const mesh = new THREE.InstancedMesh(geo, materials.vertexColored, placements.length);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;

    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.rotation.set(0, p.rotY, 0);
      this.dummy.scale.setScalar(p.scale);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);

    this.layers.push({ mesh, placements, sway });
  }

  setQuality(quality: QualityLevel): void {
    this.quality = quality;
    this.applyDensity();
  }

  private applyDensity(): void {
    const ratio = this.quality === 'low' ? 0.5 : 1.0;
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      const total = layer.placements.length;
      const targetCount = this.quality === 'low' ? Math.max(total > 0 ? 1 : 0, Math.round(total * ratio)) : total;
      layer.mesh.count = targetCount;
      layer.mesh.visible = targetCount > 0;
    }
  }

  update(elapsedTime: number): void {
    for (let l = 0; l < this.layers.length; l++) {
      const layer = this.layers[l];
      if (!layer.sway || layer.mesh.count <= 0) continue;
      const list = layer.placements;
      const activeCount = layer.mesh.count;
      for (let i = 0; i < activeCount; i++) {
        const p = list[i];
        const swayX = Math.sin(elapsedTime * 1.65 + p.phase) * p.swayAmp;
        const swayZ = Math.cos(elapsedTime * 1.3 + p.phase * 1.3) * p.swayAmp * 0.7;
        this.dummy.position.set(p.x, p.y, p.z);
        this.dummy.rotation.set(swayX, p.rotY, swayZ);
        this.dummy.scale.setScalar(p.scale);
        this.dummy.updateMatrix();
        layer.mesh.setMatrixAt(i, this.dummy.matrix);
      }
      layer.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private createPineGeometry(): THREE.BufferGeometry {
    const trunk = new THREE.CylinderGeometry(0.11, 0.16, 0.65, 5);
    const cone = new THREE.ConeGeometry(1, 1, 6);
    const parts: ColoredPart[] = [
      { geometry: trunk, colorHex: PALETTE_HEX.dirt, position: [0, 0.32, 0] },
      { geometry: cone, colorHex: PALETTE_HEX.foliageDark, position: [0, 0.92, 0], scale: [0.68, 0.95, 0.68] },
      { geometry: cone, colorHex: PALETTE_HEX.grass, position: [0, 1.42, 0], scale: [0.54, 0.85, 0.54] },
      { geometry: cone, colorHex: PALETTE_HEX.foliageDark, position: [0, 1.88, 0], scale: [0.38, 0.72, 0.38] },
    ];
    const geo = mergeColoredParts(parts);
    trunk.dispose();
    cone.dispose();
    return geo;
  }

  private createOakGeometry(): THREE.BufferGeometry {
    const trunk = new THREE.CylinderGeometry(0.12, 0.18, 0.78, 5);
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const parts: ColoredPart[] = [
      { geometry: trunk, colorHex: PALETTE_HEX.dirt, position: [0, 0.38, 0] },
      { geometry: ico, colorHex: PALETTE_HEX.foliageDark, position: [-0.22, 1.05, 0.14], scale: [0.46, 0.42, 0.46] },
      { geometry: ico, colorHex: PALETTE_HEX.grass, position: [0.18, 1.25, -0.08], scale: [0.52, 0.48, 0.52] },
      { geometry: ico, colorHex: PALETTE_HEX.grass, position: [0.02, 1.56, 0.08], scale: [0.38, 0.36, 0.38] },
    ];
    const geo = mergeColoredParts(parts);
    trunk.dispose();
    ico.dispose();
    return geo;
  }

  private createBushGeometry(): THREE.BufferGeometry {
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const parts: ColoredPart[] = [
      { geometry: ico, colorHex: PALETTE_HEX.foliageDark, position: [0, 0.24, 0], scale: [0.44, 0.34, 0.44] },
      { geometry: ico, colorHex: PALETTE_HEX.grass, position: [0.24, 0.2, 0.14], scale: [0.3, 0.25, 0.3] },
      { geometry: ico, colorHex: PALETTE_HEX.foliageDark, position: [-0.22, 0.18, -0.14], scale: [0.28, 0.24, 0.28] },
      { geometry: ico, colorHex: PALETTE_HEX.coral, position: [0.16, 0.4, 0.12], scale: [0.06, 0.06, 0.06] },
      { geometry: ico, colorHex: PALETTE_HEX.gold, position: [-0.14, 0.36, 0.18], scale: [0.06, 0.06, 0.06] },
    ];
    const geo = mergeColoredParts(parts);
    ico.dispose();
    return geo;
  }

  private createRockGeometry(): THREE.BufferGeometry {
    const dod = new THREE.DodecahedronGeometry(1, 0);
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const parts: ColoredPart[] = [
      { geometry: dod, colorHex: PALETTE_HEX.stone, position: [0, 0.28, 0], rotation: [0.2, 0.6, 0.1], scale: [0.48, 0.36, 0.42] },
      { geometry: dod, colorHex: PALETTE_HEX.stone, position: [0.36, 0.17, 0.22], rotation: [-0.2, 1.1, 0.3], scale: [0.26, 0.2, 0.24] },
      { geometry: ico, colorHex: PALETTE_HEX.foliageDark, position: [-0.28, 0.14, -0.22], scale: [0.22, 0.16, 0.22] },
    ];
    const geo = mergeColoredParts(parts);
    dod.dispose();
    ico.dispose();
    return geo;
  }

  private createFlowerGeometry(): THREE.BufferGeometry {
    const stem = new THREE.CylinderGeometry(0.025, 0.03, 0.22, 4);
    const petal = new THREE.CylinderGeometry(0.1, 0.04, 0.07, 5);
    const parts: ColoredPart[] = [
      { geometry: stem, colorHex: PALETTE_HEX.foliageDark, position: [0, 0.11, 0] },
      { geometry: petal, colorHex: PALETTE_HEX.gold, position: [0, 0.23, 0] },
      { geometry: stem, colorHex: PALETTE_HEX.foliageDark, position: [0.18, 0.09, 0.14] },
      { geometry: petal, colorHex: PALETTE_HEX.coral, position: [0.18, 0.19, 0.14] },
      { geometry: stem, colorHex: PALETTE_HEX.foliageDark, position: [-0.15, 0.1, 0.12] },
      { geometry: petal, colorHex: PALETTE_HEX.cream, position: [-0.15, 0.21, 0.12] },
    ];
    const geo = mergeColoredParts(parts);
    stem.dispose();
    petal.dispose();
    return geo;
  }

  dispose(): void {
    for (let i = 0; i < this.layers.length; i++) {
      this.layers[i].mesh.dispose();
    }
    this.group.clear();
    for (let i = 0; i < this.disposableGeometries.length; i++) {
      this.disposableGeometries[i].dispose();
    }
    this.disposableGeometries.length = 0;
    this.layers.length = 0;
  }
}
