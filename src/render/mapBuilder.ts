import * as THREE from 'three';
import { BALANCE } from '../data/balance.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import { SeededRng } from '../core/rng.ts';
import { gridToWorldX, gridToWorldZ } from '../sim/grid.ts';
import type { TowerEntity } from '../sim/entities.ts';
import type { LevelDef } from '../data/levels/index.ts';
import { parseLevelGrid } from '../data/levels/index.ts';
import { disposeInstancedMeshes, mergeTexturedParts, type TexturedPart } from './geometryHelpers.ts';
import type { KenneyAssetStore } from './kenneyAssets.ts';
import { remapUvCell } from './kenneyPalette.ts';
import type { MaterialLibrary } from './materials.ts';
import { AmbientDiorama } from './ambientDiorama.ts';
import { GroundDetails } from './groundDetails.ts';

// Cardinal neighbor bitmask for auto-tiling path geometry
const DIR_N = 1; // row - 1 (-Z)
const DIR_E = 2; // col + 1 (+X)
const DIR_S = 4; // row + 1 (+Z)
const DIR_W = 8; // col - 1 (-X)

function dirToMask(dc: number, dr: number): number {
  if (dr < 0) return DIR_N;
  if (dc > 0) return DIR_E;
  if (dr > 0) return DIR_S;
  if (dc < 0) return DIR_W;
  return 0;
}

function maskToSingleRotY(mask: number): number {
  // Kenney end/spawn tiles open toward +Z (South) at rotY = 0
  if (mask === DIR_S) return 0;
  if (mask === DIR_E) return Math.PI / 2;
  if (mask === DIR_N) return Math.PI;
  if (mask === DIR_W) return -Math.PI / 2;
  return 0;
}

function resolvePathPiece(mask: number): {
  model: 'tile-straight' | 'tile-corner-round' | 'tile-split' | 'tile-crossing';
  rotY: number;
} {
  // Straight: tile-straight connects N (-Z) and S (+Z) at rotY = 0
  if (mask === (DIR_N | DIR_S)) return { model: 'tile-straight', rotY: 0 };
  if (mask === (DIR_E | DIR_W)) return { model: 'tile-straight', rotY: Math.PI / 2 };

  // Corners: tile-corner-round connects E (+X) and S (+Z) at rotY = 0
  if (mask === (DIR_E | DIR_S)) return { model: 'tile-corner-round', rotY: 0 };
  if (mask === (DIR_N | DIR_E)) return { model: 'tile-corner-round', rotY: Math.PI / 2 };
  if (mask === (DIR_W | DIR_N)) return { model: 'tile-corner-round', rotY: Math.PI };
  if (mask === (DIR_S | DIR_W)) return { model: 'tile-corner-round', rotY: -Math.PI / 2 };

  // Single-ended / fallback straights
  if (mask === DIR_N || mask === DIR_S) return { model: 'tile-straight', rotY: 0 };
  if (mask === DIR_E || mask === DIR_W) return { model: 'tile-straight', rotY: Math.PI / 2 };

  // 3-way T-junctions (tile-split open sides at rotY=0 are E/S/W? Fall back cleanly)
  if ((mask & (DIR_N | DIR_E | DIR_S | DIR_W)) === (DIR_N | DIR_E | DIR_S | DIR_W)) {
    return { model: 'tile-crossing', rotY: 0 };
  }
  return { model: 'tile-split', rotY: 0 };
}

function sampleGrassTopUv(geo: THREE.BufferGeometry): readonly [number, number] {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  const norm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (pos && norm && uv) {
    for (let i = 0; i < pos.count; i++) {
      if (norm.getY(i) < 0.9 || pos.getY(i) < 0.16) continue;
      const u = uv.getX(i);
      const v = uv.getY(i);
      if (u >= 0.375 && u <= 0.5 && v >= 0.5 && v <= 0.75) {
        return [u, v];
      }
    }
  }
  return [0.46875, 0.525];
}

function buildGrassTilePatchGeometry(
  ts: number,
  grassU: number,
  grassV: number,
  edgeN: boolean,
  edgeE: boolean,
  edgeS: boolean,
  edgeW: boolean,
): THREE.BufferGeometry {
  const subs = 4;
  const half = ts * 0.5;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Continuous 4x4 top grid so world-space noise interpolates seamlessly with zero internal seams
  for (let iz = 0; iz <= subs; iz++) {
    const z = -half + (iz / subs) * ts;
    for (let ix = 0; ix <= subs; ix++) {
      const x = -half + (ix / subs) * ts;
      positions.push(x, 0, z);
      normals.push(0, 1, 0);
      uvs.push(grassU, grassV);
    }
  }
  const stride = subs + 1;
  for (let iz = 0; iz < subs; iz++) {
    for (let ix = 0; ix < subs; ix++) {
      const i00 = iz * stride + ix;
      const i10 = i00 + 1;
      const i01 = i00 + stride;
      const i11 = i01 + 1;
      indices.push(i00, i01, i10, i10, i01, i11);
    }
  }

  const skirtV = Math.min(0.735, grassV + 0.085);
  const pushLipWall = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number): void => {
    const base = positions.length / 3;
    positions.push(
      x0, 0, z0,
      x0, -0.2, z0,
      x1, 0, z1,
      x1, -0.2, z1,
    );
    normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
    uvs.push(grassU, grassV, grassU, skirtV, grassU, grassV, grassU, skirtV);
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  };

  if (edgeN) pushLipWall(half, -half, -half, -half, 0, -1);
  if (edgeE) pushLipWall(half, half, half, -half, 1, 0);
  if (edgeS) pushLipWall(-half, half, half, half, 0, 1);
  if (edgeW) pushLipWall(-half, -half, -half, half, -1, 0);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function hash2D(ix: number, iz: number, seed: number): number {
  let n = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function smoothValueNoise2D(wx: number, wz: number, wavelength: number, seed: number): number {
  const sx = wx / wavelength;
  const sz = wz / wavelength;
  const ix = Math.floor(sx);
  const iz = Math.floor(sz);
  const fx = sx - ix;
  const fz = sz - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2D(ix, iz, seed);
  const b = hash2D(ix + 1, iz, seed);
  const c = hash2D(ix, iz + 1, seed);
  const d = hash2D(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function applyContinuousGrassVariation(geo: THREE.BufferGeometry, seed: number, ts: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  const norm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const col = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!pos || !norm || !uv || !col) return;

  for (let i = 0; i < pos.count; i++) {
    const py = pos.getY(i);
    const ny = norm.getY(i);
    if (ny <= 0.72 || Math.abs(py) > 0.065) continue;
    const u = uv.getX(i);
    const v = uv.getY(i);
    const cx = Math.min(7, Math.max(0, Math.floor(u * 8)));
    const cy = Math.min(3, Math.max(0, Math.floor(v * 4)));
    if (cx !== 3 || cy !== 2) continue;

    const px = pos.getX(i);
    const pz = pos.getZ(i);
    const lowFreqB = smoothValueNoise2D(px, pz, ts * 4.5, seed);
    const midFreqB = smoothValueNoise2D(px + 21.4, pz - 13.8, ts * 2.1, seed + 131);
    const brightSigned = (lowFreqB * 0.7 + midFreqB * 0.3) * 2 - 1;
    const brightMul = 1.0 + brightSigned * 0.135;

    const lowFreqH = smoothValueNoise2D(px - 37.1, pz + 29.3, ts * 3.8, seed + 503);
    const midFreqH = smoothValueNoise2D(px + 9.2, pz + 43.7, ts * 1.8, seed + 887);
    const hueSigned = (lowFreqH * 0.7 + midFreqH * 0.3) * 2 - 1;

    const warm = Math.max(0, hueSigned);
    const cool = Math.max(0, -hueSigned);
    const rMul = brightMul * (1.0 + warm * 0.3 - cool * 0.26);
    const gMul = brightMul * (1.0 + warm * 0.055 - cool * 0.015);
    const bMul = brightMul * (1.0 - warm * 0.28 + cool * 0.72);
    col.setXYZ(i, col.getX(i) * rMul, col.getY(i) * gMul, col.getZ(i) * bMul);
  }
  col.needsUpdate = true;
}

interface ShoreFoamCollector {
  positions: number[];
  uvs: number[];
  indices: number[];
}

function pushShoreTriangle(
  col: ShoreFoamCollector,
  p0x: number,
  p0z: number,
  u0: number,
  v0: number,
  p1x: number,
  p1z: number,
  u1: number,
  v1: number,
  p2x: number,
  p2z: number,
  u2: number,
  v2: number,
  foamY: number,
): void {
  const crossY = (p1z - p0z) * (p2x - p0x) - (p1x - p0x) * (p2z - p0z);
  const base = col.positions.length / 3;
  col.positions.push(p0x, foamY, p0z, p1x, foamY, p1z, p2x, foamY, p2z);
  col.uvs.push(u0, v0, u1, v1, u2, v2);
  if (crossY >= 0) {
    col.indices.push(base, base + 1, base + 2);
  } else {
    col.indices.push(base, base + 2, base + 1);
  }
}

export class MapBuilder {
  readonly group = new THREE.Group();
  private readonly ambient = new AmbientDiorama();
  readonly groundDetails = new GroundDetails();
  private disposableGeometries: THREE.BufferGeometry[] = [];
  private materialsRef: MaterialLibrary | null = null;
  private goalPos: THREE.Vector3 | null = null;
  private goalCrystalMesh: THREE.Mesh | null = null;

  build(level: LevelDef, materials: MaterialLibrary, assets: KenneyAssetStore): void {
    this.dispose();
    this.materialsRef = materials;
    this.group.add(this.ambient.group);
    this.group.add(this.groundDetails.group);

    const grid = parseLevelGrid(level);
    const rng = new SeededRng(level.decorationSeed + 7919);
    const ts = BALANCE.tileSize;
    const parts: TexturedPart[] = [];

    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const unitCone = new THREE.ConeGeometry(1, 1, 5);
    const unitIco = new THREE.IcosahedronGeometry(1, 0);

    // Clone reusable base Kenney geometries once per map build
    const geoStraight = assets.cloneGeometry('tile-straight');
    const [grassU, grassV] = sampleGrassTopUv(geoStraight);
    const geoGrassInterior = buildGrassTilePatchGeometry(ts, grassU, grassV, false, false, false, false);
    const edgeGrassPatches: THREE.BufferGeometry[] = [];
    const geoCorner = assets.cloneGeometry('tile-corner-round');
    const geoEnd = assets.cloneGeometry('tile-end-round');
    const geoSpawnEnd = assets.cloneGeometry('tile-spawn-end-round');
    const geoSplit = assets.cloneGeometry('tile-split');
    const geoCrossing = assets.cloneGeometry('tile-crossing');
    const geoBridgePier = assets.cloneGeometry('wood-structure-high');
    const geoTowerBase = assets.cloneGeometry('tower-round-base');
    const geoSpawnPad = remapUvCell(
      remapUvCell(assets.cloneGeometry('spawn-square'), [3, 3], [1, 1]),
      [5, 3],
      [1, 1],
    );
    const geoSpawnPillar = assets.cloneGeometry('tower-square-bottom-c');
    const geoSpawnCap = assets.cloneGeometry('tower-square-top-a');
    const geoSpawnBeam = assets.cloneGeometry('wood-structure');
    const geoSpawnCrystal = remapUvCell(assets.cloneGeometry('detail-crystal'), [2, 1], [6, 2]);
    const geoGoalPad = remapUvCell(
      remapUvCell(assets.cloneGeometry('spawn-square'), [3, 3], [7, 0]),
      [5, 3],
      [7, 0],
    );
    const geoRocks = assets.cloneGeometry('detail-rocks');
    const geoShrub = assets.cloneGeometry('detail-rocks-large');
    const geoCrystalSmall = remapUvCell(assets.cloneGeometry('detail-crystal'), [2, 1], [0, 3]);
    const shoreFoam: ShoreFoamCollector = { positions: [], uvs: [], indices: [] };

    const isLand = (c: number, r: number): boolean => {
      if (c < 0 || c >= level.cols || r < 0 || r >= level.rows) return false;
      return grid[r][c] !== 'empty';
    };

    // Derive exact waypoint-order path connectivity per tile (immune to parallel road proximity)
    const pathMask = Array.from({ length: level.rows }, () => new Uint8Array(level.cols));
    const lanes = [level.pathWaypoints, ...(level.extraGroundPaths ?? [])];
    for (let li = 0; li < lanes.length; li++) {
      const lane = lanes[li];
      for (let i = 0; i < lane.length - 1; i++) {
        const a = lane[i];
        const b = lane[i + 1];
        const stepC = Math.sign(b.col - a.col);
        const stepR = Math.sign(b.row - a.row);
        let c = a.col;
        let r = a.row;
        while (c !== b.col || r !== b.row) {
          const nc = c + stepC;
          const nr = r + stepR;
          if (r >= 0 && r < level.rows && c >= 0 && c < level.cols) {
            pathMask[r][c] |= dirToMask(stepC, stepR);
          }
          if (nr >= 0 && nr < level.rows && nc >= 0 && nc < level.cols) {
            pathMask[nr][nc] |= dirToMask(-stepC, -stepR);
          }
          c = nc;
          r = nr;
        }
      }
    }

    for (let r = 0; r < level.rows; r++) {
      for (let c = 0; c < level.cols; c++) {
        const tile = grid[r][c];
        if (tile === 'empty') continue;

        const wx = gridToWorldX(c, level.cols);
        const wz = gridToWorldZ(r, level.rows);

        const mask = pathMask[r][c];
        // Detect open-water bridges (e.g. Level 2 twin timber/stone bridges over water)
        const isBridge =
          tile === 'path' &&
          ((!isLand(c, r - 1) && !isLand(c, r + 1)) || (!isLand(c - 1, r) && !isLand(c + 1, r)));

        const edgeCount =
          (isLand(c - 1, r) ? 0 : 1) +
          (isLand(c + 1, r) ? 0 : 1) +
          (isLand(c, r - 1) ? 0 : 1) +
          (isLand(c, r + 1) ? 0 : 1);

        // 1. Tile top cap using Kenney modular terrain tiles & continuous grass surface
        if (tile === 'spawn') {
          const rotY = maskToSingleRotY(mask);
          parts.push({
            geometry: geoSpawnEnd,
            colorHex: 0xffffff,
            position: [wx, -0.2, wz],
            rotation: [0, rotY, 0],
            scale: [ts, 1, ts],
          });

          // Kenney fortress spawn archway & crystal threshold
          parts.push({
            geometry: geoSpawnPad,
            colorHex: 0xf4f6ff,
            position: [wx, -0.09, wz],
            rotation: [0, rotY, 0],
            scale: [1.35, 0.9, 1.35],
          });
          const dirX = mask === DIR_E ? 1 : mask === DIR_W ? -1 : 0;
          const alongX = Math.abs(dirX) > 0;
          const pOff = 0.78;
          for (const side of [-1, 1] as const) {
            const px = wx + (alongX ? 0 : side * pOff);
            const pz = wz + (alongX ? side * pOff : 0);
            parts.push(
              {
                geometry: geoSpawnPillar,
                position: [px, -0.06, pz],
                scale: [0.68, 1.05, 0.68],
              },
              {
                geometry: geoSpawnCap,
                position: [px, 0.56, pz],
                scale: [0.7, 0.82, 0.7],
              },
              {
                geometry: geoSpawnCrystal,
                position: [px, 1.06, pz],
                rotation: [0, side * 0.6, 0],
                scale: [0.9, 1.05, 0.9],
              },
            );
          }
          parts.push(
            {
              geometry: geoSpawnBeam,
              position: [wx, 0.86, wz],
              rotation: [0, alongX ? Math.PI / 2 : 0, 0],
              scale: [1.62, 0.42, 0.5],
            },
            {
              geometry: geoSpawnCrystal,
              position: [wx, 1.15, wz],
              rotation: [0, rotY, 0],
              scale: [1.45, 1.55, 1.45],
            },
          );
        } else if (tile === 'goal') {
          const rotY = maskToSingleRotY(mask);
          parts.push({
            geometry: geoEnd,
            colorHex: 0xffffff,
            position: [wx, -0.2, wz],
            rotation: [0, rotY, 0],
            scale: [ts, 1, ts],
          });
          // Shrine pedestal base + golden Kenney spawn pad
          parts.push(
            {
              geometry: geoTowerBase,
              colorHex: 0xf0f4ff,
              position: [wx, -0.1, wz],
              scale: [1.35, 1.15, 1.35],
            },
            {
              geometry: geoGoalPad,
              colorHex: PALETTE_HEX.gold,
              position: [wx, 0.08, wz],
              rotation: [0, rotY, 0],
              scale: [1.15, 0.78, 1.15],
            },
          );
          this.goalPos = new THREE.Vector3(wx, 0.82, wz);
        } else if (tile === 'path') {
          const { model, rotY } = resolvePathPiece(mask);
          const geoMap = {
            'tile-straight': geoStraight,
            'tile-corner-round': geoCorner,
            'tile-split': geoSplit,
            'tile-crossing': geoCrossing,
          } as const;
          parts.push({
            geometry: geoMap[model],
            colorHex: 0xffffff,
            position: [wx, -0.2, wz],
            rotation: [0, rotY, 0],
            scale: [ts, 1, ts],
          });
        } else {
          // Seamless flat meadow grass patch with continuous world-space noise applied post-merge
          const edgeN = !isLand(c, r - 1);
          const edgeE = !isLand(c + 1, r);
          const edgeS = !isLand(c, r + 1);
          const edgeW = !isLand(c - 1, r);
          let patchGeo = geoGrassInterior;
          if (edgeN || edgeE || edgeS || edgeW) {
            patchGeo = buildGrassTilePatchGeometry(ts, grassU, grassV, edgeN, edgeE, edgeS, edgeW);
            edgeGrassPatches.push(patchGeo);
          }
          parts.push({
            geometry: patchGeo,
            colorHex: 0xffffff,
            position: [wx, 0, wz],
          });

          // Bake static rocks/shrubs/crystals directly into terrain mesh to keep draw calls minimal
          if (tile === 'decor') {
            if (rng.chance(0.28)) {
              parts.push({
                geometry: geoRocks,
                position: [wx + rng.range(-0.42, 0.42), -0.02, wz + rng.range(-0.42, 0.42)],
                rotation: [0, rng.range(0, Math.PI * 2), 0],
                scale: [1.65, 1.65, 1.65],
              });
            }
            if (rng.chance(0.32)) {
              const sScale = rng.range(1.35, 1.8);
              parts.push({
                geometry: geoShrub,
                colorHex: rng.chance(0.5) ? 0xf2faea : 0xe4f1d8,
                position: [wx + rng.range(-0.38, 0.38), -0.01, wz + rng.range(-0.38, 0.38)],
                rotation: [0, rng.range(0, Math.PI * 2), 0],
                scale: [sScale, sScale, sScale],
              });
            }
            if (rng.chance(0.14)) {
              parts.push({
                geometry: geoCrystalSmall,
                position: [wx + rng.range(-0.4, 0.4), 0, wz + rng.range(-0.4, 0.4)],
                rotation: [0, rng.range(0, Math.PI * 2), 0],
                scale: [1.35, 1.35, 1.35],
              });
            }
          }
        }

        // 2. Sub-surface cliffs & bridge piers
        if (isBridge) {
          // Slender bridge deck + Kenney timber trestle piers reaching into lagoon water
          const alongX = !isLand(c, r - 1) && !isLand(c, r + 1);
          parts.push({
            geometry: unitBox,
            colorHex: PALETTE_HEX.dirt,
            position: [wx, -0.26, wz],
            scale: [ts, 0.14, ts],
            forceWhiteUv: true,
          });
          parts.push({
            geometry: geoBridgePier,
            colorHex: 0xd8c3aa,
            position: [wx, -1.04, wz],
            rotation: [0, alongX ? 0 : Math.PI / 2, 0],
            scale: [1.55, 0.8, 1.55],
          });
          continue;
        }

        // 3-stratum stepped floating-island underside (dirt band -> prominent stone -> inset craggy bedrock)
        const dirtWarmHex = rng.chance(0.45) ? 0x7b5338 : PALETTE_HEX.dirt;
        parts.push({
          geometry: unitBox,
          colorHex: dirtWarmHex,
          position: [wx, -0.265, wz],
          scale: [ts * 0.994, 0.19, ts * 0.994],
          forceWhiteUv: true,
        });

        const upperStoneHex = edgeCount > 0 && rng.chance(0.45) ? 0x9aa4b0 : PALETTE_HEX.stone;
        const stoneDrop = edgeCount > 0 ? rng.range(0.54, 0.62) : 0.56;
        parts.push({
          geometry: unitBox,
          colorHex: upperStoneHex,
          position: [wx, -0.36 - stoneDrop * 0.5, wz],
          scale: [
            ts * (edgeCount > 0 ? 0.938 : 0.99),
            stoneDrop,
            ts * (edgeCount > 0 ? 0.938 : 0.99),
          ],
          forceWhiteUv: true,
        });

        const cliffDepth = edgeCount > 0 ? rng.range(1.45, 2.3) : rng.range(2.3, 3.8);
        const bedrockHex = edgeCount > 0 ? (rng.chance(0.5) ? 0x768393 : 0x677484) : 0x5c6878;
        const bedrockTopY = -0.36 - stoneDrop;
        parts.push({
          geometry: unitBox,
          colorHex: bedrockHex,
          position: [wx, bedrockTopY - cliffDepth * 0.5, wz],
          scale: [
            ts * (edgeCount > 0 ? 0.86 : 0.96),
            cliffDepth,
            ts * (edgeCount > 0 ? 0.86 : 0.96),
          ],
          forceWhiteUv: true,
        });

        // Sculpted stone cliff outcrops clinging to exposed sides above & at the waterline
        if (edgeCount > 0 && rng.chance(edgeCount >= 2 ? 0.9 : 0.68)) {
          const rockSides: Array<[number, number]> = [];
          if (!isLand(c - 1, r)) rockSides.push([-1, 0]);
          if (!isLand(c + 1, r)) rockSides.push([1, 0]);
          if (!isLand(c, r - 1)) rockSides.push([0, -1]);
          if (!isLand(c, r + 1)) rockSides.push([0, 1]);
          const [ox, oz] = rockSides[rng.int(0, rockSides.length - 1)];
          const tangentOffset = rng.range(-0.42, 0.42);
          const rx = wx + ox * ts * 0.42 + oz * tangentOffset;
          const rz = wz + oz * ts * 0.42 - ox * tangentOffset;
          parts.push({
            geometry: geoRocks,
            colorHex: rng.chance(0.5) ? PALETTE_HEX.stone : 0x8793a1,
            position: [rx, rng.range(-0.92, -0.52), rz],
            rotation: [rng.range(-0.18, 0.18), rng.range(0, Math.PI * 2), rng.range(-0.18, 0.18)],
            scale: [rng.range(0.68, 0.98), rng.range(0.64, 0.96), rng.range(0.68, 0.98)],
            forceWhiteUv: true,
          });
        }

        // Hanging faceted rock spires & crags beneath the island base
        if (edgeCount <= 2 && rng.chance(edgeCount === 0 ? 0.92 : edgeCount === 1 ? 0.8 : 0.62)) {
          const spireH = rng.range(1.65, 3.25);
          const spireR = rng.range(0.75, 1.24);
          const pullIn = edgeCount > 0 ? 0.16 : 0;
          const inX = (!isLand(c + 1, r) ? -1 : !isLand(c - 1, r) ? 1 : 0) * pullIn;
          const inZ = (!isLand(c, r + 1) ? -1 : !isLand(c, r - 1) ? 1 : 0) * pullIn;
          parts.push({
            geometry: unitCone,
            colorHex: rng.chance(0.45)
              ? PALETTE_HEX.stone
              : rng.chance(0.55)
                ? 0x8b96a4
                : PALETTE_HEX.dirt,
            position: [
              wx + inX + rng.range(-0.16, 0.16),
              bedrockTopY - cliffDepth - spireH * 0.44,
              wz + inZ + rng.range(-0.16, 0.16),
            ],
            rotation: [Math.PI + rng.range(-0.08, 0.08), rng.range(0, Math.PI * 2), rng.range(-0.08, 0.08)],
            scale: [spireR, spireH, spireR],
            forceWhiteUv: true,
          });

          if (edgeCount <= 1 && rng.chance(0.55)) {
            const subH = spireH * rng.range(0.5, 0.72);
            const subR = spireR * rng.range(0.5, 0.72);
            parts.push({
              geometry: unitCone,
              colorHex: PALETTE_HEX.stone,
              position: [
                wx + inX + rng.range(-0.4, 0.4),
                bedrockTopY - cliffDepth - subH * 0.42,
                wz + inZ + rng.range(-0.4, 0.4),
              ],
              rotation: [Math.PI + rng.range(-0.08, 0.08), rng.range(0, Math.PI * 2), rng.range(-0.08, 0.08)],
              scale: [subR, subH, subR],
              forceWhiteUv: true,
            });
          }
        }

        // Animated shoreline foam ribbon riding directly on waterPlaneY along exposed coast
        if (edgeCount > 0 && !isBridge) {
          const inR = ts * 0.42;
          const outR = ts * 0.45 + 0.3;
          const foamW = outR - inR;
          const foamY = BALANCE.waterPlaneY + 0.015;
          const foamOffsets: Array<[number, number, boolean]> = [
            [-1, 0, !isLand(c - 1, r)],
            [1, 0, !isLand(c + 1, r)],
            [0, -1, !isLand(c, r - 1)],
            [0, 1, !isLand(c, r + 1)],
          ];

          for (let k = 0; k < foamOffsets.length; k++) {
            const [ox, oz, exposed] = foamOffsets[k];
            if (!exposed) continue;

            const tx = oz;
            const tz = -ox;
            const tMin = !isLand(c - tx, r - tz) ? -inR : -ts * 0.5;
            const tMax = !isLand(c + tx, r + tz) ? inR : ts * 0.5;
            const segs = 4;
            for (let s = 0; s < segs; s++) {
              const t0 = tMin + ((tMax - tMin) * s) / segs;
              const t1 = tMin + ((tMax - tMin) * (s + 1)) / segs;
              const in0x = wx + ox * inR + tx * t0;
              const in0z = wz + oz * inR + tz * t0;
              const in1x = wx + ox * inR + tx * t1;
              const in1z = wz + oz * inR + tz * t1;
              const out0x = wx + ox * outR + tx * t0;
              const out0z = wz + oz * outR + tz * t0;
              const out1x = wx + ox * outR + tx * t1;
              const out1z = wz + oz * outR + tz * t1;
              pushShoreTriangle(shoreFoam, in0x, in0z, 0, 0, out0x, out0z, 0, 1, in1x, in1z, 1, 0, foamY);
              pushShoreTriangle(shoreFoam, in1x, in1z, 1, 0, out0x, out0z, 0, 1, out1x, out1z, 1, 1, foamY);
            }
          }

          // Smooth rounded quarter-arc foam at convex island corners
          const corners: Array<[number, number]> = [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ];
          for (const [sx, sz] of corners) {
            if (!isLand(c + sx, r) && !isLand(c, r + sz)) {
              const cx0 = wx + sx * inR;
              const cz0 = wz + sz * inR;
              const cornerSteps = 3;
              for (let i = 0; i < cornerSteps; i++) {
                const a0 = (i / cornerSteps) * (Math.PI * 0.5);
                const a1 = ((i + 1) / cornerSteps) * (Math.PI * 0.5);
                const p1x = cx0 + sx * Math.cos(a0) * foamW;
                const p1z = cz0 + sz * Math.sin(a0) * foamW;
                const p2x = cx0 + sx * Math.cos(a1) * foamW;
                const p2z = cz0 + sz * Math.sin(a1) * foamW;
                pushShoreTriangle(shoreFoam, cx0, cz0, 0, 0, p1x, p1z, a0, 1, p2x, p2z, a1, 1, foamY);
              }
            }
          }
        }
      }
    }

    const islandGeo = mergeTexturedParts(parts);
    applyContinuousGrassVariation(islandGeo, level.decorationSeed + 7919, ts);
    this.disposableGeometries.push(islandGeo);
    const islandMesh = new THREE.Mesh(islandGeo, materials.kenneyTerrain);
    islandMesh.castShadow = true;
    islandMesh.receiveShadow = true;
    this.group.add(islandMesh);

    if (shoreFoam.positions.length > 0) {
      const foamGeo = new THREE.BufferGeometry();
      foamGeo.setAttribute('position', new THREE.Float32BufferAttribute(shoreFoam.positions, 3));
      foamGeo.setAttribute('uv', new THREE.Float32BufferAttribute(shoreFoam.uvs, 2));
      foamGeo.setIndex(shoreFoam.indices);
      foamGeo.computeVertexNormals();
      this.disposableGeometries.push(foamGeo);
      const foamMesh = new THREE.Mesh(foamGeo, materials.shoreFoamMaterial);
      foamMesh.castShadow = false;
      foamMesh.receiveShadow = false;
      foamMesh.renderOrder = 2;
      this.group.add(foamMesh);
    }

    // Extended smooth-fading low-poly lagoon disc (keeps ambient islets tightly framed around main isle)
    const dioramaRadius = Math.hypot(level.cols * ts * 0.5, level.rows * ts * 0.5) + 4.4;
    const waterRadius = dioramaRadius + 72;
    materials.waterUniforms.uLagoonRadius.value = waterRadius;
    const waterGeo = this.createWaterDiscGeometry(waterRadius, 24, 56);
    this.disposableGeometries.push(waterGeo);

    const waterMesh = new THREE.Mesh(waterGeo, materials.waterMaterial);
    waterMesh.position.y = BALANCE.waterPlaneY;
    waterMesh.receiveShadow = true;
    waterMesh.castShadow = false;
    this.group.add(waterMesh);

    this.ambient.build(dioramaRadius, rng, materials, unitBox, unitCone, unitIco);
    this.groundDetails.build(level, materials);

    if (this.goalPos) {
      // Crisp faceted cyan sanctuary crystal spire flanked by Kenney crystal shards & gold halo ring
      const spireGeo = new THREE.OctahedronGeometry(0.42, 0);
      const miniShard = remapUvCell(assets.cloneGeometry('detail-crystal'), [2, 1], [0, 3]);
      const crystalRing = new THREE.CylinderGeometry(0.5, 0.5, 0.06, 8);
      const crystalGeo = mergeTexturedParts([
        {
          geometry: spireGeo,
          colorHex: 0x5be3ff,
          position: [0, 0.12, 0],
          scale: [0.88, 1.55, 0.88],
          forceWhiteUv: true,
        },
        {
          geometry: miniShard,
          colorHex: 0xccf7ff,
          position: [-0.26, -0.32, 0.14],
          rotation: [0.18, 0.4, 0.28],
          scale: [0.95, 1.15, 0.95],
        },
        {
          geometry: miniShard,
          colorHex: 0xccf7ff,
          position: [0.25, -0.32, -0.14],
          rotation: [-0.15, 2.1, -0.26],
          scale: [0.85, 1.05, 0.85],
        },
        {
          geometry: crystalRing,
          colorHex: PALETTE_HEX.gold,
          position: [0, -0.4, 0],
          forceWhiteUv: true,
        },
      ]);
      spireGeo.dispose();
      miniShard.dispose();
      crystalRing.dispose();
      this.disposableGeometries.push(crystalGeo);

      const crystalMesh = new THREE.Mesh(crystalGeo, materials.goalCrystal);
      crystalMesh.position.copy(this.goalPos);
      crystalMesh.castShadow = false;
      this.group.add(crystalMesh);
      this.goalCrystalMesh = crystalMesh;
    }

    unitBox.dispose();
    unitCone.dispose();
    unitIco.dispose();
    geoGrassInterior.dispose();
    for (const p of edgeGrassPatches) p.dispose();
    geoStraight.dispose();
    geoCorner.dispose();
    geoEnd.dispose();
    geoSpawnEnd.dispose();
    geoSplit.dispose();
    geoCrossing.dispose();
    geoBridgePier.dispose();
    geoTowerBase.dispose();
    geoSpawnPad.dispose();
    geoSpawnPillar.dispose();
    geoSpawnCap.dispose();
    geoSpawnBeam.dispose();
    geoSpawnCrystal.dispose();
    geoGoalPad.dispose();
    geoRocks.dispose();
    geoShrub.dispose();
    geoCrystalSmall.dispose();
  }

  private createWaterDiscGeometry(
    radius: number,
    rings: number,
    segments: number,
  ): THREE.BufferGeometry {
    const positions: number[] = [];
    const indices: number[] = [];

    positions.push(0, 0, 0);

    for (let r = 1; r <= rings; r++) {
      const t = r / rings;
      const rad = Math.pow(t, 1.45) * radius;
      for (let s = 0; s < segments; s++) {
        const theta = (s / segments) * Math.PI * 2;
        positions.push(Math.cos(theta) * rad, 0, Math.sin(theta) * rad);
      }
    }

    const rimBottomStart = positions.length / 3;
    const bottomRadius = radius * 0.96;
    for (let s = 0; s < segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      positions.push(Math.cos(theta) * bottomRadius, -0.26, Math.sin(theta) * bottomRadius);
    }

    for (let s = 0; s < segments; s++) {
      const next = (s + 1) % segments;
      indices.push(0, 1 + next, 1 + s);
    }

    for (let r = 1; r < rings; r++) {
      const innerStart = 1 + (r - 1) * segments;
      const outerStart = 1 + r * segments;
      for (let s = 0; s < segments; s++) {
        const next = (s + 1) % segments;
        const i0 = innerStart + s;
        const i1 = innerStart + next;
        const o0 = outerStart + s;
        const o1 = outerStart + next;
        indices.push(i0, i1, o1);
        indices.push(i0, o1, o0);
      }
    }

    const outerTopStart = 1 + (rings - 1) * segments;
    for (let s = 0; s < segments; s++) {
      const next = (s + 1) % segments;
      const t0 = outerTopStart + s;
      const t1 = outerTopStart + next;
      const b0 = rimBottomStart + s;
      const b1 = rimBottomStart + next;
      indices.push(t0, t1, b1);
      indices.push(t0, b1, b0);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  update(elapsedTime: number): void {
    if (this.materialsRef) {
      this.materialsRef.waterUniforms.uWaterTime.value = elapsedTime;
    }

    if (this.goalCrystalMesh && this.goalPos) {
      this.goalCrystalMesh.rotation.y = elapsedTime * 1.1;
      this.goalCrystalMesh.position.y = this.goalPos.y + Math.sin(elapsedTime * 2.2) * 0.14;
    }

    this.ambient.update(elapsedTime);
  }

  syncOccupiedTiles(towers: readonly TowerEntity[]): void {
    this.groundDetails.syncOccupiedTiles(towers);
  }

  dispose(): void {
    this.ambient.dispose();
    this.groundDetails.dispose();
    disposeInstancedMeshes(this.group);
    this.group.clear();
    for (let i = 0; i < this.disposableGeometries.length; i++) {
      this.disposableGeometries[i].dispose();
    }
    this.disposableGeometries.length = 0;
    this.materialsRef = null;
    this.goalPos = null;
    this.goalCrystalMesh = null;
  }
}
