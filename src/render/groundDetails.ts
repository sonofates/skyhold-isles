import * as THREE from 'three';
import { SeededRng } from '../core/rng.ts';
import { BALANCE } from '../data/balance.ts';
import { parseLevelGrid, type LevelDef } from '../data/levels/index.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import type { TowerEntity } from '../sim/entities.ts';
import { gridToWorldX, gridToWorldZ } from '../sim/grid.ts';
import { disposeInstancedMeshes, mergeColoredParts, type ColoredPart } from './geometryHelpers.ts';
import type { MaterialLibrary } from './materials.ts';
import { claimedDecorTiles, resolveGroundKind } from './islandThemes.ts';
import { getIslandTheme } from './islandThemeTable.ts';

interface BucketPlacement {
  col: number;
  row: number;
  matrix: THREE.Matrix4;
}

interface TileBinding {
  bucketIndex: number;
  instanceIndex: number;
  baseMatrix: THREE.Matrix4;
}

const ZERO_SCALE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

function createGrassTuftGeometry(): THREE.BufferGeometry {
  const bladeGeo = new THREE.ConeGeometry(0.026, 0.17, 4, 1);
  const parts: ColoredPart[] = [
    {
      geometry: bladeGeo,
      colorHex: 0x5ab83d,
      position: [0, 0.085, 0],
      rotation: [0.08, 0.2, -0.1],
      scale: [1, 1.08, 1],
    },
    {
      geometry: bladeGeo,
      colorHex: 0x7be04e,
      position: [-0.042, 0.07, 0.028],
      rotation: [0.24, 1.5, 0.3],
      scale: [0.9, 0.88, 0.9],
    },
    {
      geometry: bladeGeo,
      colorHex: 0x67cc44,
      position: [0.04, 0.068, -0.026],
      rotation: [-0.26, 2.7, -0.24],
      scale: [0.85, 0.85, 0.85],
    },
    {
      geometry: bladeGeo,
      colorHex: 0x8ae95c,
      position: [0.015, 0.055, 0.042],
      rotation: [0.3, -0.8, 0.14],
      scale: [0.75, 0.72, 0.75],
    },
  ];
  const merged = mergeColoredParts(parts);
  bladeGeo.dispose();
  return merged;
}

function createFlowerGeometry(petalHex: number, centerHex: number): THREE.BufferGeometry {
  const stemGeo = new THREE.CylinderGeometry(0.01, 0.013, 0.13, 4);
  const leafGeo = new THREE.ConeGeometry(0.024, 0.085, 4);
  const budGeo = new THREE.DodecahedronGeometry(0.036, 0);

  const parts: ColoredPart[] = [
    {
      geometry: leafGeo,
      colorHex: PALETTE_HEX.foliageDark,
      position: [-0.025, 0.036, 0.014],
      rotation: [0.42, 0.4, 0.55],
    },
    {
      geometry: leafGeo,
      colorHex: 0x56b93c,
      position: [0.026, 0.034, -0.015],
      rotation: [-0.4, 1.9, -0.52],
    },
    {
      geometry: stemGeo,
      colorHex: 0x5bc041,
      position: [0, 0.065, 0],
      rotation: [0.05, 0, -0.05],
    },
    {
      geometry: budGeo,
      colorHex: petalHex,
      position: [0.005, 0.132, 0],
      scale: [1.15, 0.62, 1.15],
    },
    {
      geometry: budGeo,
      colorHex: centerHex,
      position: [0.005, 0.146, 0],
      scale: [0.48, 0.45, 0.48],
    },
    {
      geometry: stemGeo,
      colorHex: 0x52b13a,
      position: [0.045, 0.048, 0.028],
      rotation: [0.22, 0.6, 0.18],
      scale: [0.82, 0.76, 0.82],
    },
    {
      geometry: budGeo,
      colorHex: petalHex,
      position: [0.058, 0.098, 0.036],
      scale: [0.85, 0.5, 0.85],
    },
  ];
  const merged = mergeColoredParts(parts);
  stemGeo.dispose();
  leafGeo.dispose();
  budGeo.dispose();
  return merged;
}

function createWheatTuftGeometry(): THREE.BufferGeometry {
  const stalk = new THREE.ConeGeometry(0.02, 0.26, 4, 1);
  const cols = [0xe3b84a, 0xf1cf6a, 0xc99a35, 0xe9c25a, 0xd4a53c];
  const parts: ColoredPart[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push({
      geometry: stalk,
      colorHex: cols[i],
      position: [Math.cos(a) * 0.035, 0.12, Math.sin(a) * 0.035],
      rotation: [Math.sin(a) * 0.28, a, -Math.cos(a) * 0.28],
      scale: [1, 0.9 + (i % 3) * 0.12, 1],
    });
  }
  const merged = mergeColoredParts(parts);
  stalk.dispose();
  return merged;
}

function createShellGeometry(): THREE.BufferGeometry {
  const body = new THREE.DodecahedronGeometry(0.05, 0);
  const parts: ColoredPart[] = [
    {
      geometry: body,
      colorHex: PALETTE_HEX.cream,
      position: [0, 0.02, 0],
      rotation: [0.2, 0.5, 0],
      scale: [1.15, 0.55, 0.9],
    },
    {
      geometry: body,
      colorHex: 0xf4b8b0,
      position: [0.07, 0.015, 0.03],
      rotation: [0, 1.1, 0.1],
      scale: [0.7, 0.42, 0.6],
    },
  ];
  const merged = mergeColoredParts(parts);
  body.dispose();
  return merged;
}

function createStarfishGeometry(): THREE.BufferGeometry {
  const arm = new THREE.BoxGeometry(0.11, 0.022, 0.034);
  const parts: ColoredPart[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI;
    parts.push({ geometry: arm, colorHex: i === 0 ? 0xf08a5d : PALETTE_HEX.coral, position: [0, 0.012, 0], rotation: [0, a, 0] });
  }
  parts.push({ geometry: arm, colorHex: 0xf6bd41, position: [0, 0.026, 0], rotation: [0, 0.3, 0], scale: [0.3, 1, 1.4] });
  const merged = mergeColoredParts(parts);
  arm.dispose();
  return merged;
}

function createBushGeometry(main: number, light: number): THREE.BufferGeometry {
  const blob = new THREE.IcosahedronGeometry(1, 0);
  const parts: ColoredPart[] = [
    { geometry: blob, colorHex: main, position: [0, 0.07, 0], scale: [0.13, 0.095, 0.12] },
    { geometry: blob, colorHex: light, position: [0.1, 0.06, 0.05], scale: [0.085, 0.07, 0.085] },
    { geometry: blob, colorHex: main, position: [-0.09, 0.05, -0.06], scale: [0.075, 0.06, 0.075] },
    { geometry: blob, colorHex: light, position: [0.02, 0.13, -0.01], scale: [0.05, 0.04, 0.05] },
  ];
  const merged = mergeColoredParts(parts);
  blob.dispose();
  return merged;
}

function createPebbleGeometry(): THREE.BufferGeometry {
  const stoneGeo = new THREE.DodecahedronGeometry(0.062, 0);
  const parts: ColoredPart[] = [
    {
      geometry: stoneGeo,
      colorHex: PALETTE_HEX.stone,
      position: [-0.02, 0.024, 0.01],
      rotation: [0.15, 0.5, 0.1],
      scale: [1.1, 0.55, 0.88],
    },
    {
      geometry: stoneGeo,
      colorHex: PALETTE_HEX.sand,
      position: [0.048, 0.018, -0.024],
      rotation: [-0.1, 1.7, 0.2],
      scale: [0.72, 0.46, 0.65],
    },
    {
      geometry: stoneGeo,
      colorHex: 0x8c97a4,
      position: [0.018, 0.014, 0.052],
      rotation: [0.2, -0.9, -0.15],
      scale: [0.56, 0.4, 0.54],
    },
  ];
  const merged = mergeColoredParts(parts);
  stoneGeo.dispose();
  return merged;
}

/**
 * Low-density, seeded instanced meadow details (grass tufts, wildflowers, pebbles)
 * scattered across non-path, non-center margins and automatically hidden beneath placed towers.
 */
export class GroundDetails {
  readonly group = new THREE.Group();
  private disposableGeometries: THREE.BufferGeometry[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private tileBindings = new Map<string, TileBinding[]>();
  private hiddenTiles = new Set<string>();
  private tempOccupied = new Set<string>();
  /** Cheap tower-set signature (count + id sum); ids only grow, so any build/sell changes it. */
  private lastTowerCount = -1;
  private lastTowerIdSum = -1;

  build(level: LevelDef, materials: MaterialLibrary): void {
    this.dispose();

    const grid = parseLevelGrid(level);
    const rng = new SeededRng(level.decorationSeed + 3137);
    const theme = getIslandTheme(level.id);
    const claimed = claimedDecorTiles(level, theme);
    const isLandTile = (c: number, r: number): boolean => c >= 0 && r >= 0 && c < level.cols && r < level.rows && grid[r][c] !== 'empty';
    const tileAt = (c: number, r: number) =>
      c >= 0 && r >= 0 && c < level.cols && r < level.rows ? grid[r][c] : 'water';
    const isPathNeighbor = (c: number, r: number) => {
      const t = tileAt(c, r);
      return t === 'path' || t === 'spawn' || t === 'goal';
    };

    // 0: grass tufts, 1-3: flowers, 4: pebbles, 5: wheat tufts, 6: shells, 7: starfish, 8: bushes
    const placements: BucketPlacement[][] = [[], [], [], [], [], [], [], [], []];
    const dummy = new THREE.Object3D();

    const pickOffset = (
      col: number,
      row: number,
      enforceOuterRing: boolean,
    ): [number, number] | null => {
      const blockNegX = isPathNeighbor(col - 1, row);
      const blockPosX = isPathNeighbor(col + 1, row);
      const blockNegZ = isPathNeighbor(col, row - 1);
      const blockPosZ = isPathNeighbor(col, row + 1);

      for (let attempt = 0; attempt < 8; attempt++) {
        const dx = rng.range(-0.84, 0.84);
        const dz = rng.range(-0.84, 0.84);
        const cheb = Math.max(Math.abs(dx), Math.abs(dz));
        if (enforceOuterRing && cheb < 0.6) continue;
        if (!enforceOuterRing && Math.hypot(dx, dz) < 0.34) continue;
        if (blockNegX && dx < -0.58) continue;
        if (blockPosX && dx > 0.58) continue;
        if (blockNegZ && dz < -0.58) continue;
        if (blockPosZ && dz > 0.58) continue;
        return [dx, dz];
      }
      return null;
    };

    const pushItem = (
      bucketIndex: number,
      col: number,
      row: number,
      wx: number,
      wz: number,
      scaleMin: number,
      scaleMax: number,
    ): void => {
      dummy.position.set(wx, BALANCE.tileGrassTopY - 0.004, wz);
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      const s = rng.range(scaleMin, scaleMax);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      placements[bucketIndex].push({
        col,
        row,
        matrix: dummy.matrix.clone(),
      });
    };

    for (let r = 0; r < level.rows; r++) {
      for (let c = 0; c < level.cols; c++) {
        const tile = grid[r][c];
        if (tile !== 'grass' && tile !== 'decor') continue;
        if (claimed.has(`${c},${r}`)) continue;

        const baseX = gridToWorldX(c, level.cols);
        const baseZ = gridToWorldZ(r, level.rows);
        const isBuildable = tile === 'grass';
        const ground = resolveGroundKind(theme, c, r, isLandTile, tile === 'decor');
        const d = theme.details;

        // Grass tufts (outer border only on buildable tiles); sand/cobble stay bare, fields get wheat
        if (ground === 'grass' || ground === 'moss' || ground === 'field') {
          const baseTufts = isBuildable ? (rng.chance(0.58 * d.tuftMul) ? 1 : 0) : rng.chance(0.75 * d.tuftMul) ? 2 : 1;
          const tuftCount = ground === 'field' ? (rng.chance(0.85) ? 2 : 1) : baseTufts;
          for (let i = 0; i < tuftCount; i++) {
            const offset = pickOffset(c, r, isBuildable);
            if (!offset) continue;
            const wheatBucket = ground === 'field' || (d.wheat > 0 && rng.chance(d.wheat));
            pushItem(wheatBucket ? 5 : 0, c, r, baseX + offset[0], baseZ + offset[1], 0.85, 1.25);
          }
        }

        // Tiny wildflowers in 3 palette accents
        if (ground === 'grass' || ground === 'moss') {
          const flowerChance = (isBuildable ? 0.34 : 0.52) * d.flowerMul;
          if (rng.chance(flowerChance)) {
            const offset = pickOffset(c, r, isBuildable);
            if (offset) {
              const roll = rng.next();
              const bucket = roll < 0.36 ? 1 : roll < 0.72 ? 2 : 3;
              pushItem(bucket, c, r, baseX + offset[0], baseZ + offset[1], 0.9, 1.28);
            }
          }
        }

        // Small bushes (hide beneath towers like every other detail)
        if (ground === 'grass' || ground === 'moss') {
          if (rng.chance((isBuildable ? 0.12 : 0.3) * d.bushMul)) {
            const offset = pickOffset(c, r, isBuildable);
            if (offset) pushItem(8, c, r, baseX + offset[0], baseZ + offset[1], 0.9, 1.5);
          }
        }

        // Small pebbles
        const pebbleChance = (isBuildable ? 0.22 : 0.36) * d.pebbleMul * (ground === 'field' ? 0.3 : 1);
        if (rng.chance(pebbleChance)) {
          const offset = pickOffset(c, r, isBuildable);
          if (offset) {
            pushItem(4, c, r, baseX + offset[0], baseZ + offset[1], 0.82, 1.22);
          }
        }

        // Beach finds on sand tiles
        if (d.shells && ground === 'sand') {
          if (rng.chance(0.3)) {
            const offset = pickOffset(c, r, isBuildable);
            if (offset) pushItem(6, c, r, baseX + offset[0], baseZ + offset[1], 0.9, 1.3);
          }
          if (rng.chance(0.14)) {
            const offset = pickOffset(c, r, isBuildable);
            if (offset) pushItem(7, c, r, baseX + offset[0], baseZ + offset[1], 0.9, 1.25);
          }
        }
      }
    }

    const geometries = [
      createGrassTuftGeometry(),
      createFlowerGeometry(theme.details.flowers[0][0], theme.details.flowers[0][1]),
      createFlowerGeometry(theme.details.flowers[1][0], theme.details.flowers[1][1]),
      createFlowerGeometry(theme.details.flowers[2][0], theme.details.flowers[2][1]),
      createPebbleGeometry(),
      createWheatTuftGeometry(),
      createShellGeometry(),
      createStarfishGeometry(),
      createBushGeometry(theme.details.bushColors[0], theme.details.bushColors[1]),
    ];

    for (let b = 0; b < geometries.length; b++) {
      const geo = geometries[b];
      this.disposableGeometries.push(geo);
      const list = placements[b];
      if (list.length === 0) continue;

      const mesh = new THREE.InstancedMesh(geo, materials.vertexColored, list.length);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;

      const meshIndex = this.meshes.length;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        mesh.setMatrixAt(i, p.matrix);
        const key = `${p.col},${p.row}`;
        let bindings = this.tileBindings.get(key);
        if (!bindings) {
          bindings = [];
          this.tileBindings.set(key, bindings);
        }
        bindings.push({
          bucketIndex: meshIndex,
          instanceIndex: i,
          baseMatrix: p.matrix,
        });
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  syncOccupiedTiles(towers: readonly TowerEntity[]): void {
    if (this.meshes.length === 0) return;

    let idSum = 0;
    for (let i = 0; i < towers.length; i++) idSum += towers[i].id;
    if (towers.length === this.lastTowerCount && idSum === this.lastTowerIdSum) return;
    this.lastTowerCount = towers.length;
    this.lastTowerIdSum = idSum;

    this.tempOccupied.clear();
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      this.tempOccupied.add(`${t.col},${t.row}`);
    }

    if (this.tempOccupied.size === this.hiddenTiles.size) {
      let unchanged = true;
      for (const key of this.tempOccupied) {
        if (!this.hiddenTiles.has(key)) {
          unchanged = false;
          break;
        }
      }
      if (unchanged) return;
    }

    const dirtyMeshes = new Set<number>();

    // Restore details for tiles where a tower was sold
    for (const prevKey of this.hiddenTiles) {
      if (this.tempOccupied.has(prevKey)) continue;
      const bindings = this.tileBindings.get(prevKey);
      if (bindings) {
        for (let i = 0; i < bindings.length; i++) {
          const b = bindings[i];
          this.meshes[b.bucketIndex].setMatrixAt(b.instanceIndex, b.baseMatrix);
          dirtyMeshes.add(b.bucketIndex);
        }
      }
      this.hiddenTiles.delete(prevKey);
    }

    // Hide details for newly occupied tiles
    for (const key of this.tempOccupied) {
      if (this.hiddenTiles.has(key)) continue;
      const bindings = this.tileBindings.get(key);
      if (bindings) {
        for (let i = 0; i < bindings.length; i++) {
          const b = bindings[i];
          this.meshes[b.bucketIndex].setMatrixAt(b.instanceIndex, ZERO_SCALE_MATRIX);
          dirtyMeshes.add(b.bucketIndex);
        }
      }
      this.hiddenTiles.add(key);
    }

    for (const meshIdx of dirtyMeshes) {
      this.meshes[meshIdx].instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    disposeInstancedMeshes(this.group);
    this.group.clear();
    for (let i = 0; i < this.disposableGeometries.length; i++) {
      this.disposableGeometries[i].dispose();
    }
    this.disposableGeometries.length = 0;
    this.meshes.length = 0;
    this.tileBindings.clear();
    this.hiddenTiles.clear();
    this.tempOccupied.clear();
    this.lastTowerCount = -1;
    this.lastTowerIdSum = -1;
  }
}
