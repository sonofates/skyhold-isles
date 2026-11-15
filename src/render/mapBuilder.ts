import * as THREE from 'three';
import { BALANCE } from '../data/balance.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import { SeededRng } from '../core/rng.ts';
import { gridToWorldX, gridToWorldZ } from '../sim/grid.ts';
import type { LevelDef } from '../data/levels/index.ts';
import { parseLevelGrid } from '../data/levels/index.ts';
import { mergeTexturedParts, type TexturedPart } from './geometryHelpers.ts';
import type { KenneyAssetStore } from './kenneyAssets.ts';
import { remapUvCell } from './kenneyPalette.ts';
import type { MaterialLibrary } from './materials.ts';
import { AmbientDiorama } from './ambientDiorama.ts';

// Cardinal neighbor bitmask for auto-tiling path geometry
const DIR_N = 1; // row - 1 (-Z)
const DIR_E = 2; // col + 1 (+X)
const DIR_S = 4; // row + 1 (+Z)
const DIR_W = 8; // col - 1 (-X)

const GRASS_TINTS = [0xffffff, 0xf4faee, 0xeaf6df, 0xfaf6ea, 0xe4f1d6] as const;
const PATH_TINTS = [0xffffff, 0xfcf6eb, 0xf6eedf] as const;

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

export class MapBuilder {
  readonly group = new THREE.Group();
  private readonly ambient = new AmbientDiorama();
  private disposableGeometries: THREE.BufferGeometry[] = [];
  private materialsRef: MaterialLibrary | null = null;
  private goalPos: THREE.Vector3 | null = null;
  private goalCrystalMesh: THREE.Mesh | null = null;

  build(level: LevelDef, materials: MaterialLibrary, assets: KenneyAssetStore): void {
    this.dispose();
    this.materialsRef = materials;
    this.group.add(this.ambient.group);

    const grid = parseLevelGrid(level);
    const rng = new SeededRng(level.decorationSeed + 7919);
    const ts = BALANCE.tileSize;
    const parts: TexturedPart[] = [];

    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const unitCone = new THREE.ConeGeometry(1, 1, 5);
    const unitIco = new THREE.IcosahedronGeometry(1, 0);

    // Clone reusable base Kenney geometries once per map build
    const geoGrassTile = assets.cloneGeometry('tile');
    const geoStraight = assets.cloneGeometry('tile-straight');
    const geoCorner = assets.cloneGeometry('tile-corner-round');
    const geoEnd = assets.cloneGeometry('tile-end-round');
    const geoSpawnEnd = assets.cloneGeometry('tile-spawn-end-round');
    const geoSplit = assets.cloneGeometry('tile-split');
    const geoCrossing = assets.cloneGeometry('tile-crossing');
    const geoBridgePier = assets.cloneGeometry('wood-structure-high');
    const geoTowerBase = assets.cloneGeometry('tower-round-base');
    const geoRocks = assets.cloneGeometry('detail-rocks');
    const geoShrub = assets.cloneGeometry('detail-rocks-large');
    const geoDirt = assets.cloneGeometry('detail-dirt');
    const geoCrystalSmall = remapUvCell(assets.cloneGeometry('detail-crystal'), [2, 1], [0, 3]);

    const isLand = (c: number, r: number): boolean => {
      if (c < 0 || c >= level.cols || r < 0 || r >= level.rows) return false;
      return grid[r][c] !== 'empty';
    };

    // Derive exact waypoint-order path connectivity per tile (immune to parallel road proximity)
    const pathMask = Array.from({ length: level.rows }, () => new Uint8Array(level.cols));
    for (let i = 0; i < level.pathWaypoints.length - 1; i++) {
      const a = level.pathWaypoints[i];
      const b = level.pathWaypoints[i + 1];
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

    for (let r = 0; r < level.rows; r++) {
      for (let c = 0; c < level.cols; c++) {
        const tile = grid[r][c];
        if (tile === 'empty') continue;

        const wx = gridToWorldX(c, level.cols);
        const wz = gridToWorldZ(r, level.rows);

        const mask = pathMask[r][c];
        const isPathLike = tile === 'path' || tile === 'spawn' || tile === 'goal';
        // Detect open-water bridges (e.g. Level 2 twin timber/stone bridges over water)
        const isBridge =
          tile === 'path' &&
          ((!isLand(c, r - 1) && !isLand(c, r + 1)) || (!isLand(c - 1, r) && !isLand(c + 1, r)));

        const edgeCount =
          (isLand(c - 1, r) ? 0 : 1) +
          (isLand(c + 1, r) ? 0 : 1) +
          (isLand(c, r - 1) ? 0 : 1) +
          (isLand(c, r + 1) ? 0 : 1);

        // 1. Tile top cap using Kenney modular terrain tiles (top Y = 0.00 grass, -0.10 road)
        if (tile === 'spawn') {
          const rotY = maskToSingleRotY(mask);
          parts.push({
            geometry: geoSpawnEnd,
            colorHex: 0xf7f5ef,
            position: [wx, -0.2, wz],
            rotation: [0, rotY, 0],
            scale: [ts, 1, ts],
          });

          // Flanking stone gateway pillars perpendicular to road exit
          const dirX = mask === DIR_E ? 1 : mask === DIR_W ? -1 : 0;
          const alongX = Math.abs(dirX) > 0;
          parts.push(
            {
              geometry: unitBox,
              colorHex: PALETTE_HEX.indigo,
              position: [wx + (alongX ? 0 : -0.76), 0.36, wz + (alongX ? -0.76 : 0)],
              scale: [0.3, 0.92, 0.3],
              forceWhiteUv: true,
            },
            {
              geometry: unitBox,
              colorHex: PALETTE_HEX.indigo,
              position: [wx + (alongX ? 0 : 0.76), 0.36, wz + (alongX ? 0.76 : 0)],
              scale: [0.3, 0.92, 0.3],
              forceWhiteUv: true,
            },
            {
              geometry: unitBox,
              colorHex: PALETTE_HEX.stone,
              position: [wx, 0.88, wz],
              scale: [alongX ? 0.34 : 1.82, 0.2, alongX ? 1.82 : 0.34],
              forceWhiteUv: true,
            },
            {
              geometry: unitBox,
              colorHex: PALETTE_HEX.coral,
              position: [wx, 1.04, wz],
              scale: [alongX ? 0.2 : 0.44, 0.14, alongX ? 0.44 : 0.2],
              forceWhiteUv: true,
            },
          );
        } else if (tile === 'goal') {
          const rotY = maskToSingleRotY(mask);
          parts.push({
            geometry: geoEnd,
            colorHex: 0xf8f6f0,
            position: [wx, -0.2, wz],
            rotation: [0, rotY, 0],
            scale: [ts, 1, ts],
          });
          // Shrine pedestal base
          parts.push({
            geometry: geoTowerBase,
            colorHex: 0xf0f4ff,
            position: [wx, -0.1, wz],
            scale: [1.35, 1.15, 1.35],
          });
          parts.push({
            geometry: unitBox,
            colorHex: PALETTE_HEX.gold,
            position: [wx, 0.16, wz],
            scale: [0.84, 0.1, 0.84],
            forceWhiteUv: true,
          });
          this.goalPos = new THREE.Vector3(wx, 0.82, wz);
        } else if (tile === 'path') {
          const { model, rotY } = resolvePathPiece(mask);
          const geoMap = {
            'tile-straight': geoStraight,
            'tile-corner-round': geoCorner,
            'tile-split': geoSplit,
            'tile-crossing': geoCrossing,
          } as const;
          const tint = PATH_TINTS[(r * 3 + c) % PATH_TINTS.length];
          parts.push({
            geometry: geoMap[model],
            colorHex: tint,
            position: [wx, -0.2, wz],
            rotation: [0, rotY, 0],
            scale: [ts, 1, ts],
          });
        } else {
          // Grass / decor tile: subtle deterministic elevation & shade variation breaks chessboard look
          const jitterY = tile === 'decor' ? rng.range(-0.02, 0.025) : rng.range(-0.022, 0.015);
          const tint =
            tile === 'decor' && rng.chance(0.42)
              ? 0xe0efd0
              : GRASS_TINTS[(c * 7 + r * 13 + (rng.chance(0.5) ? 1 : 0)) % GRASS_TINTS.length];
          parts.push({
            geometry: geoGrassTile,
            colorHex: tint,
            position: [wx, -0.2 + jitterY, wz],
            scale: [ts, 1, ts],
          });

          // Bake static rocks/shrubs/crystals directly into terrain mesh to keep draw calls minimal
          if (tile === 'decor') {
            if (rng.chance(0.28)) {
              parts.push({
                geometry: geoRocks,
                position: [wx + rng.range(-0.42, 0.42), jitterY - 0.02, wz + rng.range(-0.42, 0.42)],
                rotation: [0, rng.range(0, Math.PI * 2), 0],
                scale: [1.65, 1.65, 1.65],
              });
            }
            if (rng.chance(0.32)) {
              const sScale = rng.range(1.35, 1.8);
              parts.push({
                geometry: geoShrub,
                colorHex: rng.chance(0.5) ? 0xf2faea : 0xe4f1d8,
                position: [wx + rng.range(-0.38, 0.38), jitterY - 0.01, wz + rng.range(-0.38, 0.38)],
                rotation: [0, rng.range(0, Math.PI * 2), 0],
                scale: [sScale, sScale, sScale],
              });
            }
            if (rng.chance(0.14)) {
              parts.push({
                geometry: geoCrystalSmall,
                position: [wx + rng.range(-0.4, 0.4), jitterY, wz + rng.range(-0.4, 0.4)],
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

        // Solid island earth skirt + cliff strata (zero seam below tile y = -0.20)
        parts.push({
          geometry: unitBox,
          colorHex: PALETTE_HEX.dirt,
          position: [wx, -0.51, wz],
          scale: [ts * 1.002, 0.62, ts * 1.002],
          forceWhiteUv: true,
        });

        const cliffDepth = edgeCount > 0 ? rng.range(1.1, 1.85) : rng.range(2.0, 3.4);
        parts.push({
          geometry: unitBox,
          colorHex: PALETTE_HEX.stone,
          position: [wx, -0.82 - cliffDepth * 0.5, wz],
          scale: [ts * (edgeCount > 0 ? 0.92 : 1.0), cliffDepth, ts * (edgeCount > 0 ? 0.92 : 1.0)],
          forceWhiteUv: true,
        });

        if (edgeCount <= 2 && rng.chance(edgeCount === 0 ? 0.78 : 0.45)) {
          const spireH = rng.range(1.3, 2.7);
          const spireR = rng.range(0.65, 1.08);
          parts.push({
            geometry: unitCone,
            colorHex: rng.chance(0.68) ? PALETTE_HEX.stone : PALETTE_HEX.dirt,
            position: [
              wx + rng.range(-0.18, 0.18),
              -0.82 - cliffDepth - spireH * 0.45,
              wz + rng.range(-0.18, 0.18),
            ],
            rotation: [Math.PI, rng.range(0, Math.PI * 2), 0],
            scale: [spireR, spireH, spireR],
            forceWhiteUv: true,
          });
        }

        // Shoreline foam strips around exposed coastal tiles
        if (edgeCount > 0) {
          const foamOffsets: Array<[number, number, boolean]> = [
            [-1, 0, !isLand(c - 1, r)],
            [1, 0, !isLand(c + 1, r)],
            [0, -1, !isLand(c, r - 1)],
            [0, 1, !isLand(c, r + 1)],
          ];
          for (let k = 0; k < foamOffsets.length; k++) {
            const [ox, oz, exposed] = foamOffsets[k];
            if (!exposed) continue;
            parts.push({
              geometry: unitBox,
              colorHex: PALETTE_HEX.cream,
              position: [
                wx + ox * (ts * 0.56 + rng.range(0.02, 0.14)),
                BALANCE.waterPlaneY + 0.03,
                wz + oz * (ts * 0.56 + rng.range(0.02, 0.14)),
              ],
              rotation: [0, rng.range(-0.2, 0.2), 0],
              scale: [
                ox !== 0 ? rng.range(0.22, 0.36) : ts * rng.range(0.68, 0.92),
                0.06,
                oz !== 0 ? rng.range(0.22, 0.36) : ts * rng.range(0.68, 0.92),
              ],
              forceWhiteUv: true,
            });

            // Occasional coastal rock ledge right at water edge
            if (!isPathLike && rng.chance(0.18)) {
              parts.push({
                geometry: geoDirt,
                position: [
                  wx + ox * (ts * 0.46),
                  BALANCE.waterPlaneY + 0.1,
                  wz + oz * (ts * 0.46),
                ],
                rotation: [0, rng.range(0, Math.PI * 2), 0],
                scale: [1.1, 1.1, 1.1],
              });
            }
          }
        }
      }
    }

    const islandGeo = mergeTexturedParts(parts);
    this.disposableGeometries.push(islandGeo);
    const islandMesh = new THREE.Mesh(islandGeo, materials.kenneyTerrain);
    islandMesh.castShadow = true;
    islandMesh.receiveShadow = true;
    this.group.add(islandMesh);

    // Bounded low-poly lagoon disc (1 draw call, GPU waves)
    const lagoonRadius = Math.hypot(level.cols * ts * 0.5, level.rows * ts * 0.5) + 4.4;
    materials.waterUniforms.uLagoonRadius.value = lagoonRadius;
    const waterGeo = this.createWaterDiscGeometry(lagoonRadius, 14, 42);
    this.disposableGeometries.push(waterGeo);

    const waterMesh = new THREE.Mesh(waterGeo, materials.waterMaterial);
    waterMesh.position.y = BALANCE.waterPlaneY;
    waterMesh.receiveShadow = true;
    waterMesh.castShadow = false;
    this.group.add(waterMesh);

    this.ambient.build(lagoonRadius, rng, materials, unitBox, unitCone, unitIco);

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
    geoGrassTile.dispose();
    geoStraight.dispose();
    geoCorner.dispose();
    geoEnd.dispose();
    geoSpawnEnd.dispose();
    geoSplit.dispose();
    geoCrossing.dispose();
    geoBridgePier.dispose();
    geoTowerBase.dispose();
    geoRocks.dispose();
    geoShrub.dispose();
    geoDirt.dispose();
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
      const rad = (r / rings) * radius;
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

  dispose(): void {
    this.ambient.dispose();
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
