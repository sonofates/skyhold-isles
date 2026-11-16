import * as THREE from 'three';
import { SeededRng } from '../core/rng.ts';
import { BALANCE } from '../data/balance.ts';
import { parseLevelGrid, type LevelDef } from '../data/levels/index.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import { gridToWorldX, gridToWorldZ } from '../sim/grid.ts';
import { disposeInstancedMeshes, mergeColoredParts, type ColoredPart } from './geometryHelpers.ts';
import { getIslandTheme } from './islandThemeTable.ts';
import type { MaterialLibrary } from './materials.ts';

interface Floater {
  x: number;
  z: number;
  yaw: number;
  scale: number;
  phase: number;
  /** extra height above the mean water plane */
  lift: number;
}

const _dummy = new THREE.Object3D();

/** Same wave field as the water shader (matches `begin_vertex` replacement in materials.ts), centred on the map. */
function waveHeight(x: number, z: number, t: number, lagoonRadius: number): number {
  const rNorm = Math.min(1, Math.hypot(x, z) / Math.max(1, lagoonRadius));
  const falloff = Math.max(0, 1 - Math.pow(rNorm, 3.2));
  return (
    (Math.sin(x * 0.34 + t * 1.45) * 0.085 +
      Math.cos(z * 0.4 - t * 1.15) * 0.065 +
      Math.sin((x + z) * 0.24 + t * 0.85) * 0.04) *
    falloff
  );
}

function lilyGeometry(): THREE.BufferGeometry {
  const pad = new THREE.CylinderGeometry(0.24, 0.24, 0.025, 7);
  const bud = new THREE.IcosahedronGeometry(0.05, 0);
  const parts: ColoredPart[] = [
    { geometry: pad, colorHex: 0x4fae45, position: [0, 0, 0], scale: [1, 1, 1] },
    { geometry: pad, colorHex: 0x6cc455, position: [0.28, -0.005, 0.12], rotation: [0, 0.6, 0], scale: [0.62, 1, 0.62] },
    { geometry: bud, colorHex: PALETTE_HEX.cream, position: [0.02, 0.05, 0.02], scale: [1, 0.8, 1] },
    { geometry: bud, colorHex: 0xf7a9bb, position: [0.02, 0.075, 0.02], scale: [0.55, 0.7, 0.55] },
  ];
  const g = mergeColoredParts(parts);
  pad.dispose();
  bud.dispose();
  return g;
}

function buoyGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.1, 0.12, 0.16, 6);
  const band = new THREE.CylinderGeometry(0.105, 0.105, 0.05, 6);
  const mast = new THREE.CylinderGeometry(0.015, 0.015, 0.26, 4);
  const lamp = new THREE.IcosahedronGeometry(0.045, 0);
  const parts: ColoredPart[] = [
    { geometry: body, colorHex: PALETTE_HEX.coral, position: [0, 0.03, 0] },
    { geometry: band, colorHex: PALETTE_HEX.cream, position: [0, 0.04, 0] },
    { geometry: mast, colorHex: 0x484573, position: [0, 0.2, 0] },
    { geometry: lamp, colorHex: PALETTE_HEX.gold, position: [0, 0.35, 0] },
  ];
  const g = mergeColoredParts(parts);
  body.dispose();
  band.dispose();
  mast.dispose();
  lamp.dispose();
  return g;
}

function driftwoodGeometry(): THREE.BufferGeometry {
  const log = new THREE.CylinderGeometry(0.05, 0.065, 0.8, 5);
  const branch = new THREE.CylinderGeometry(0.02, 0.03, 0.26, 4);
  const parts: ColoredPart[] = [
    { geometry: log, colorHex: 0x9a7348, position: [0, 0.01, 0], rotation: [0, 0, Math.PI / 2] },
    { geometry: branch, colorHex: 0x86603c, position: [0.12, 0.08, 0.05], rotation: [0.3, 0, 0.9] },
    { geometry: log, colorHex: 0x7b5338, position: [-0.05, 0.005, 0.14], rotation: [0, 0.5, Math.PI / 2], scale: [0.6, 0.55, 0.6] },
  ];
  const g = mergeColoredParts(parts);
  log.dispose();
  branch.dispose();
  return g;
}

interface Family {
  mesh: THREE.InstancedMesh;
  items: Floater[];
  /** tilt amount (radians) of the bobbing animation */
  tilt: number;
  bob: number;
}

/**
 * Tiny floating props on the sea (lily pads, buoys, driftwood) placed on open water close to the island coast.
 * They ride the same sine wave field as the water shader so they bob with the surface.
 */
export class WaterDetails {
  readonly group = new THREE.Group();
  private disposableGeometries: THREE.BufferGeometry[] = [];
  private families: Family[] = [];
  private lagoonRadius = 22;

  build(level: LevelDef, materials: MaterialLibrary, lagoonRadius: number): void {
    this.dispose();
    this.lagoonRadius = lagoonRadius;
    const theme = getIslandTheme(level.id);
    const wanted = theme.waterDetails;
    if (wanted.lilies + wanted.buoys + wanted.driftwood === 0) return;

    const grid = parseLevelGrid(level);
    const rng = new SeededRng(level.decorationSeed + 5011);
    const isLand = (c: number, r: number): boolean =>
      c >= 0 && r >= 0 && c < level.cols && r < level.rows && grid[r][c] !== 'empty';

    // candidate water tiles touching the coast (kept off the route/bridges and clear of authored water pieces)
    const blockers = theme.setPieces.filter((p) => {
      const c = Math.round(p.col);
      const r = Math.round(p.row);
      return !isLand(c, r);
    });
    const candidates: Array<{ c: number; r: number }> = [];
    for (let r = -1; r <= level.rows; r++) {
      for (let c = -1; c <= level.cols; c++) {
        if (isLand(c, r)) continue;
        let near = false;
        for (let dr = -1; dr <= 1 && !near; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (isLand(c + dc, r + dr)) {
              near = true;
              break;
            }
          }
        }
        if (!near) continue;
        if (blockers.some((p) => Math.hypot(p.col - c, p.row - r) < 2.2)) continue;
        candidates.push({ c, r });
      }
    }
    if (candidates.length === 0) return;

    const place = (count: number, jitter: number): Floater[] => {
      const out: Floater[] = [];
      for (let i = 0; i < count; i++) {
        const cell = candidates[rng.int(0, candidates.length - 1)];
        out.push({
          x: gridToWorldX(cell.c, level.cols) + rng.range(-jitter, jitter),
          z: gridToWorldZ(cell.r, level.rows) + rng.range(-jitter, jitter),
          yaw: rng.range(0, Math.PI * 2),
          scale: rng.range(0.9, 1.25),
          phase: rng.range(0, Math.PI * 2),
          lift: 0,
        });
      }
      return out;
    };

    const addFamily = (geo: THREE.BufferGeometry, items: Floater[], tilt: number, bob: number): void => {
      if (items.length === 0) {
        geo.dispose();
        return;
      }
      this.disposableGeometries.push(geo);
      const mesh = new THREE.InstancedMesh(geo, materials.vertexColored, items.length);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.families.push({ mesh, items, tilt, bob });
    };
    addFamily(lilyGeometry(), place(wanted.lilies, 0.7), 0.02, 0.0);
    addFamily(buoyGeometry(), place(wanted.buoys, 0.6), 0.12, 0.03);
    addFamily(driftwoodGeometry(), place(wanted.driftwood, 0.6), 0.06, 0.015);
    this.update(0);
  }

  update(t: number): void {
    const baseY = BALANCE.waterPlaneY + 0.03;
    for (let f = 0; f < this.families.length; f++) {
      const fam = this.families[f];
      for (let i = 0; i < fam.items.length; i++) {
        const it = fam.items[i];
        const wave = waveHeight(it.x, it.z, t, this.lagoonRadius);
        _dummy.position.set(it.x, baseY + wave + it.lift + Math.sin(t * 1.7 + it.phase) * fam.bob, it.z);
        _dummy.rotation.set(
          Math.sin(t * 1.3 + it.phase) * fam.tilt,
          it.yaw + Math.sin(t * 0.4 + it.phase) * 0.15,
          Math.cos(t * 1.1 + it.phase) * fam.tilt,
        );
        _dummy.scale.setScalar(it.scale);
        _dummy.updateMatrix();
        fam.mesh.setMatrixAt(i, _dummy.matrix);
      }
      fam.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    disposeInstancedMeshes(this.group);
    this.group.clear();
    for (const g of this.disposableGeometries) g.dispose();
    this.disposableGeometries.length = 0;
    this.families = [];
  }
}
