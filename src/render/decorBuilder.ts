import * as THREE from 'three';
import type { QualityLevel } from '../core/types.ts';
import { SeededRng } from '../core/rng.ts';
import { gridToWorldX, gridToWorldZ } from '../sim/grid.ts';
import { parseLevelGrid, type LevelDef } from '../data/levels/index.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import { disposeInstancedMeshes, mergeTexturedParts } from './geometryHelpers.ts';
import type { KenneyAssetStore } from './kenneyAssets.ts';
import type { MaterialLibrary } from './materials.ts';
import { claimedDecorTiles, decorHillHeight, type IslandTheme, type TreeKind } from './islandThemes.ts';
import { getIslandTheme } from './islandThemeTable.ts';
import { createPalmGeometry, createPineGeometry, createTintableBroadleafGeometry } from './treeGeometry.ts';

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


interface TreeSpec {
  readonly scale: readonly [number, number];
  readonly tints: readonly number[];
  readonly geometry: (assets: KenneyAssetStore, theme: IslandTheme) => THREE.BufferGeometry;
}

const AUTUMN_TINTS = [0xf28729, 0xf6bd41, 0xe0603a, 0xd9a52e, 0xf0a13a] as const;
const BLOSSOM_TINTS = [0xf7a9bb, 0xf4c6d0, 0xffe3e8, 0xf290a8] as const;

const TREE_SPECS: Record<TreeKind, TreeSpec> = {
  tree: { scale: [2.25, 2.85], tints: TREE_COLOR_TINTS, geometry: (a) => a.cloneGeometry('detail-tree') },
  treeLarge: { scale: [2.25, 2.85], tints: TREE_COLOR_TINTS, geometry: (a) => a.cloneGeometry('detail-tree-large') },
  oak: { scale: [1.65, 2.2], tints: TREE_COLOR_TINTS, geometry: () => createBroadleafTreeGeometry() },
  pine: {
    scale: [2.2, 3.0],
    tints: [0xffffff, 0xeaf3ea, 0xdfeede, 0xf2f8ee],
    geometry: (_a, theme) => createPineGeometry(theme.cliff.depthMul >= 1.5 && theme.pathStyle === 'stone'),
  },
  palm: { scale: [2.3, 3.0], tints: [0xffffff, 0xf4fbe8, 0xe8f6dd], geometry: () => createPalmGeometry() },
  autumn: { scale: [1.8, 2.4], tints: AUTUMN_TINTS, geometry: () => createTintableBroadleafGeometry(1.1) },
  blossom: { scale: [1.7, 2.2], tints: BLOSSOM_TINTS, geometry: () => createTintableBroadleafGeometry(0.95) },
};

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
    const theme = getIslandTheme(level.id);
    const claimed = claimedDecorTiles(level, theme);

    const kinds = Object.keys(theme.trees.weights) as TreeKind[];
    let totalWeight = 0;
    for (const k of kinds) totalWeight += theme.trees.weights[k] ?? 0;
    const placementsByKind = new Map<TreeKind, SwayPlacement[]>();

    for (let r = 0; r < level.rows; r++) {
      for (let c = 0; c < level.cols; c++) {
        const tile = grid[r][c];
        if (tile !== 'decor') continue;
        if (claimed.has(`${c},${r}`)) continue;

        const wx = gridToWorldX(c, level.cols);
        const wz = gridToWorldZ(r, level.rows);
        const hillH = decorHillHeight(theme, grid, c, r, claimed.has(`${c},${r}`));

        const count = rng.chance(theme.trees.density) ? 2 : 1;
        for (let t = 0; t < count; t++) {
          const offsetX = count === 1 ? rng.range(-0.22, 0.22) : t === 0 ? -0.34 : 0.34;
          const offsetZ = rng.range(-0.26, 0.26);
          const placement: SwayPlacement = {
            x: wx + offsetX,
            y: -0.02 + hillH * 0.8,
            z: wz + offsetZ,
            rotY: rng.range(0, Math.PI * 2),
            scale: rng.range(2.25, 2.85),
            phase: rng.range(0, Math.PI * 2),
            swayAmp: rng.range(0.024, 0.042),
          };
          let roll = rng.next() * totalWeight;
          let kind: TreeKind = kinds[kinds.length - 1];
          for (const k of kinds) {
            roll -= theme.trees.weights[k] ?? 0;
            if (roll <= 0) {
              kind = k;
              break;
            }
          }
          const spec = TREE_SPECS[kind];
          placement.scale = rng.range(spec.scale[0], spec.scale[1]);
          let list = placementsByKind.get(kind);
          if (!list) {
            list = [];
            placementsByKind.set(kind, list);
          }
          list.push(placement);
        }
      }
    }

    const colorTmp = new THREE.Color();
    const createLayer = (
      geo: THREE.BufferGeometry,
      placements: SwayPlacement[],
      castShadow: boolean,
      sway: boolean,
      tints: readonly number[],
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
        colorTmp.setHex(tints[i % tints.length]);
        mesh.setColorAt(i, colorTmp);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this.layers.push({ mesh, placements: ordered, sway });
    };

    for (const kind of kinds) {
      const list = placementsByKind.get(kind);
      if (!list || list.length === 0) continue;
      const spec = TREE_SPECS[kind];
      createLayer(spec.geometry(assets, theme), list, true, true, spec.tints);
    }
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
    disposeInstancedMeshes(this.group);
    this.group.clear();
    for (let i = 0; i < this.disposableGeometries.length; i++) {
      this.disposableGeometries[i].dispose();
    }
    this.disposableGeometries.length = 0;
    this.layers = [];
  }
}
