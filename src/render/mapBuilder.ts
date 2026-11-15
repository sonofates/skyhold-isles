import * as THREE from 'three';
import { BALANCE } from '../data/balance.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import { SeededRng } from '../core/rng.ts';
import { gridToWorldX, gridToWorldZ } from '../sim/grid.ts';
import type { LevelDef } from '../data/levels/index.ts';
import { parseLevelGrid } from '../data/levels/index.ts';
import { mergeColoredParts, type ColoredPart } from './geometryHelpers.ts';
import type { MaterialLibrary } from './materials.ts';
import { AmbientDiorama } from './ambientDiorama.ts';

export class MapBuilder {
  readonly group = new THREE.Group();
  private readonly ambient = new AmbientDiorama();
  private disposableGeometries: THREE.BufferGeometry[] = [];
  private materialsRef: MaterialLibrary | null = null;
  private goalPos: THREE.Vector3 | null = null;
  private goalCrystalMesh: THREE.Mesh | null = null;

  build(level: LevelDef, materials: MaterialLibrary): void {
    this.dispose();
    this.materialsRef = materials;
    this.group.add(this.ambient.group);

    const grid = parseLevelGrid(level);
    const rng = new SeededRng(level.decorationSeed + 7919);
    const ts = BALANCE.tileSize;
    const parts: ColoredPart[] = [];

    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const unitCone = new THREE.ConeGeometry(1, 1, 5);
    const unitIco = new THREE.IcosahedronGeometry(1, 0);

    const isLand = (c: number, r: number): boolean => {
      if (c < 0 || c >= level.cols || r < 0 || r >= level.rows) return false;
      return grid[r][c] !== 'empty';
    };

    for (let r = 0; r < level.rows; r++) {
      for (let c = 0; c < level.cols; c++) {
        const tile = grid[r][c];
        if (tile === 'empty') continue;

        const wx = gridToWorldX(c, level.cols);
        const wz = gridToWorldZ(r, level.rows);

        const edgeCount =
          (isLand(c - 1, r) ? 0 : 1) +
          (isLand(c + 1, r) ? 0 : 1) +
          (isLand(c, r - 1) ? 0 : 1) +
          (isLand(c, r + 1) ? 0 : 1);

        // 1. Tile top cap
        if (tile === 'path') {
          // Seamless sandy path slab (exact ts touch avoids both gaps and overlap z-fighting)
          parts.push({
            geometry: unitBox,
            colorHex: PALETTE_HEX.sand,
            position: [wx, -0.26, wz],
            scale: [ts, 0.32, ts],
          });
          if (rng.chance(0.5)) {
            const sx = wx + rng.range(-0.42, 0.42);
            const sz = wz + rng.range(-0.42, 0.42);
            parts.push({
              geometry: unitBox,
              colorHex: PALETTE_HEX.stone,
              position: [sx, -0.09, sz],
              rotation: [0, rng.range(0, Math.PI), 0],
              scale: [rng.range(0.28, 0.44), 0.04, rng.range(0.22, 0.36)],
            });
          }
        } else if (tile === 'spawn' || tile === 'goal') {
          parts.push({
            geometry: unitBox,
            colorHex: PALETTE_HEX.stone,
            position: [wx, -0.22, wz],
            scale: [ts * 0.99, 0.38, ts * 0.99],
          });
          parts.push({
            geometry: unitBox,
            colorHex: tile === 'goal' ? PALETTE_HEX.cream : PALETTE_HEX.sand,
            position: [wx, -0.015, wz],
            scale: [ts * 0.72, 0.05, ts * 0.72],
          });

          if (tile === 'spawn') {
            // Orient archway perpendicular to path exit direction
            const p0 = level.pathWaypoints[0];
            const p1 = level.pathWaypoints[1];
            const dirX = p1 ? p1.col - p0.col : 1;
            const dirZ = p1 ? p1.row - p0.row : 0;
            const alongX = Math.abs(dirX) >= Math.abs(dirZ);
            if (alongX) {
              parts.push(
                { geometry: unitBox, colorHex: PALETTE_HEX.indigo, position: [wx, 0.48, wz - 0.62], scale: [0.36, 0.92, 0.28] },
                { geometry: unitBox, colorHex: PALETTE_HEX.indigo, position: [wx, 0.48, wz + 0.62], scale: [0.36, 0.92, 0.28] },
                { geometry: unitBox, colorHex: PALETTE_HEX.stone, position: [wx, 1.0, wz], scale: [0.42, 0.24, 1.56] },
                { geometry: unitBox, colorHex: PALETTE_HEX.coral, position: [wx, 1.18, wz], scale: [0.24, 0.16, 0.42] },
              );
            } else {
              parts.push(
                { geometry: unitBox, colorHex: PALETTE_HEX.indigo, position: [wx - 0.62, 0.48, wz], scale: [0.28, 0.92, 0.36] },
                { geometry: unitBox, colorHex: PALETTE_HEX.indigo, position: [wx + 0.62, 0.48, wz], scale: [0.28, 0.92, 0.36] },
                { geometry: unitBox, colorHex: PALETTE_HEX.stone, position: [wx, 1.0, wz], scale: [1.56, 0.24, 0.42] },
                { geometry: unitBox, colorHex: PALETTE_HEX.coral, position: [wx, 1.18, wz], scale: [0.42, 0.16, 0.24] },
              );
            }
          } else {
            // Sanctuary skyhold shrine pedestal + gold trim
            parts.push(
              { geometry: unitBox, colorHex: PALETTE_HEX.stone, position: [wx, 0.2, wz], scale: [1.1, 0.36, 1.1] },
              { geometry: unitBox, colorHex: PALETTE_HEX.gold, position: [wx, 0.42, wz], scale: [0.76, 0.12, 0.76] },
              { geometry: unitBox, colorHex: PALETTE_HEX.indigo, position: [wx - 0.52, 0.42, wz - 0.52], scale: [0.2, 0.8, 0.2] },
              { geometry: unitBox, colorHex: PALETTE_HEX.indigo, position: [wx + 0.52, 0.42, wz - 0.52], scale: [0.2, 0.8, 0.2] },
              { geometry: unitBox, colorHex: PALETTE_HEX.indigo, position: [wx - 0.52, 0.42, wz + 0.52], scale: [0.2, 0.8, 0.2] },
              { geometry: unitBox, colorHex: PALETTE_HEX.indigo, position: [wx + 0.52, 0.42, wz + 0.52], scale: [0.2, 0.8, 0.2] },
            );
            this.goalPos = new THREE.Vector3(wx, 1.15, wz);
          }
        } else {
          // Grass or decor meadow cap with crisp tactile tile bevel
          const capColor =
            tile === 'decor' && rng.chance(0.35) ? PALETTE_HEX.foliageDark : PALETTE_HEX.grass;
          parts.push({
            geometry: unitBox,
            colorHex: capColor,
            position: [wx, -0.18, wz],
            scale: [ts * 0.982, 0.36, ts * 0.982],
          });
        }

        // 2. Upper dirt terrace rim beneath all tiles
        parts.push({
          geometry: unitBox,
          colorHex: PALETTE_HEX.dirt,
          position: [wx, -0.58, wz],
          scale: [ts * 1.002, 0.62, ts * 1.002],
        });

        // 3. Lower stone cliff strata & hanging inverted rocky spires
        const cliffDepth = edgeCount > 0 ? rng.range(1.1, 1.85) : rng.range(2.0, 3.4);
        parts.push({
          geometry: unitBox,
          colorHex: PALETTE_HEX.stone,
          position: [wx, -0.89 - cliffDepth * 0.5, wz],
          scale: [ts * (edgeCount > 0 ? 0.92 : 1.0), cliffDepth, ts * (edgeCount > 0 ? 0.92 : 1.0)],
        });

        if (edgeCount <= 2 && rng.chance(edgeCount === 0 ? 0.78 : 0.45)) {
          const spireH = rng.range(1.3, 2.7);
          const spireR = rng.range(0.65, 1.08);
          parts.push({
            geometry: unitCone,
            colorHex: rng.chance(0.68) ? PALETTE_HEX.stone : PALETTE_HEX.dirt,
            position: [
              wx + rng.range(-0.18, 0.18),
              -0.89 - cliffDepth - spireH * 0.45,
              wz + rng.range(-0.18, 0.18),
            ],
            rotation: [Math.PI, rng.range(0, Math.PI * 2), 0],
            scale: [spireR, spireH, spireR],
          });
        }

        // Shoreline foam strips around coastal edge tiles
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
            });
          }
        }
      }
    }

    const islandGeo = mergeColoredParts(parts);
    this.disposableGeometries.push(islandGeo);
    const islandMesh = new THREE.Mesh(islandGeo, materials.vertexColored);
    islandMesh.castShadow = true;
    islandMesh.receiveShadow = true;
    this.group.add(islandMesh);

    // Bounded low-poly lagoon disc + outer lip skirt around the floating island (1 draw call, vertex waves on GPU)
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
      const crystalOct = new THREE.OctahedronGeometry(0.36, 0);
      const crystalRing = new THREE.CylinderGeometry(0.45, 0.45, 0.06, 6);
      const crystalGeo = mergeColoredParts([
        { geometry: crystalOct, colorHex: PALETTE_HEX.water, position: [0, 0, 0], scale: [0.85, 1.3, 0.85] },
        { geometry: crystalRing, colorHex: PALETTE_HEX.gold, position: [0, -0.45, 0] },
      ]);
      crystalOct.dispose();
      crystalRing.dispose();
      this.disposableGeometries.push(crystalGeo);
      const crystalMesh = new THREE.Mesh(crystalGeo, materials.vertexColored);
      crystalMesh.position.copy(this.goalPos);
      crystalMesh.castShadow = false;
      this.group.add(crystalMesh);
      this.goalCrystalMesh = crystalMesh;
    }

    unitBox.dispose();
    unitCone.dispose();
    unitIco.dispose();
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

    // Outer tapered rim skirt ring (static at r >= radius*0.96 so GPU waveFalloff == 0)
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
