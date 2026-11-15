import * as THREE from 'three';
import type { QualityLevel } from '../core/types.ts';
import { SeededRng } from '../core/rng.ts';
import { gridToWorldX, gridToWorldZ } from '../sim/grid.ts';
import { parseLevelGrid, type LevelDef } from '../data/levels/index.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import { mergeTexturedParts } from './geometryHelpers.ts';
import type { KenneyAssetStore } from './kenneyAssets.ts';
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

const TREE_COLOR_TINTS = [0xffffff, 0xf2faea, 0xe8f3da, 0xf8f6e8] as const;

function createBroadleafTreeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.055, 0.08, 0.42, 6);
  const crown = new THREE.IcosahedronGeometry(1, 0);
  const merged = mergeTexturedParts([
    {
      geometry: trunk,
      colorHex: 0x795138,
      position: [0, 0.21, 0],
      forceWhiteUv: true,
    },
    {
      geometry: crown,
      colorHex: 0x6ac74a,
      position: [0, 0.54, 0],
      rotation: [0.1, 0.4, 0],
      scale: [0.27, 0.24, 0.27],
      forceWhiteUv: true,
    },
    {
      geometry: crown,
      colorHex: PALETTE_HEX.grass,
      position: [0.09, 0.48, -0.07],
      rotation: [-0.1, 1.2, 0.1],
      scale: [0.19, 0.17, 0.19],
      forceWhiteUv: true,
    },
  ]);
  trunk.dispose();
  crown.dispose();
  return merged;
}

export class DecorBuilder {
  readonly group = new THREE.Group();
  private disposableGeometries: THREE.BufferGeometry[] = [];
  private layers: DecorLayer[] = [];
  private quality: QualityLevel = 'high';
  private readonly dummy = new THREE.Object3D();

  build(level: LevelDef, materials: MaterialLibrary, assets: KenneyAssetStore): void {
    this.dispose();

    const grid = parseLevelGrid(level);
    const rng = new SeededRng(level.decorationSeed);

    const smallTreePlacements: SwayPlacement[] = [];
    const largeTreePlacements: SwayPlacement[] = [];
    const broadleafPlacements: SwayPlacement[] = [];

    for (let r = 0; r < level.rows; r++) {
      for (let c = 0; c < level.cols; c++) {
        const tile = grid[r][c];
        if (tile !== 'decor') continue;

        const wx = gridToWorldX(c, level.cols);
        const wz = gridToWorldZ(r, level.rows);

        const count = rng.chance(0.45) ? 2 : 1;
        for (let t = 0; t < count; t++) {
          const offsetX = count === 1 ? rng.range(-0.22, 0.22) : t === 0 ? -0.34 : 0.34;
          const offsetZ = rng.range(-0.26, 0.26);
          const placement: SwayPlacement = {
            x: wx + offsetX,
            y: -0.02,
            z: wz + offsetZ,
            rotY: rng.range(0, Math.PI * 2),
            scale: rng.range(2.25, 2.85),
            phase: rng.range(0, Math.PI * 2),
            swayAmp: rng.range(0.024, 0.042),
          };
          const roll = rng.next();
          if (roll < 0.38) {
            largeTreePlacements.push(placement);
          } else if (roll < 0.72) {
            smallTreePlacements.push(placement);
          } else {
            broadleafPlacements.push({
              ...placement,
              scale: rng.range(1.65, 2.2),
            });
          }
        }
      }
    }

    const colorTmp = new THREE.Color();
    const createLayer = (
      geo: THREE.BufferGeometry,
      placements: SwayPlacement[],
      castShadow: boolean,
      sway: boolean,
    ): void => {
      if (placements.length === 0) {
        geo.dispose();
        return;
      }
      const ordered = interleavePlacements(placements);
      this.disposableGeometries.push(geo);
      const mesh = new THREE.InstancedMesh(geo, materials.kenneyTerrain, ordered.length);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      for (let i = 0; i < ordered.length; i++) {
        const p = ordered[i];
        this.dummy.position.set(p.x, p.y, p.z);
        this.dummy.rotation.set(0, p.rotY, 0);
        this.dummy.scale.setScalar(p.scale);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
        colorTmp.setHex(TREE_COLOR_TINTS[i % TREE_COLOR_TINTS.length]);
        mesh.setColorAt(i, colorTmp);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this.layers.push({ mesh, placements: ordered, sway });
    };

    createLayer(assets.cloneGeometry('detail-tree'), smallTreePlacements, true, true);
    createLayer(assets.cloneGeometry('detail-tree-large'), largeTreePlacements, true, true);
    createLayer(createBroadleafTreeGeometry(), broadleafPlacements, true, true);
    this.applyQualityCounts();
  }

  setQuality(quality: QualityLevel): void {
    this.quality = quality;
    this.applyQualityCounts();
  }

  private applyQualityCounts(): void {
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      const full = layer.placements.length;
      layer.mesh.count = this.quality === 'low' ? Math.max(1, Math.ceil(full * 0.5)) : full;
    }
  }

  update(elapsedTime: number): void {
    if (this.quality === 'low') return;
    for (let l = 0; l < this.layers.length; l++) {
      const layer = this.layers[l];
      if (!layer.sway) continue;
      for (let i = 0; i < layer.mesh.count; i++) {
        const p = layer.placements[i];
        this.dummy.position.set(p.x, p.y, p.z);
        this.dummy.rotation.set(
          Math.sin(elapsedTime * 1.4 + p.phase) * p.swayAmp,
          p.rotY,
          Math.cos(elapsedTime * 1.15 + p.phase) * p.swayAmp,
        );
        this.dummy.scale.setScalar(p.scale);
        this.dummy.updateMatrix();
        layer.mesh.setMatrixAt(i, this.dummy.matrix);
      }
      layer.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.group.clear();
    for (let i = 0; i < this.disposableGeometries.length; i++) {
      this.disposableGeometries[i].dispose();
    }
    this.disposableGeometries.length = 0;
    this.layers = [];
  }
}
