import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BALANCE } from '../data/balance.ts';
import type { LevelDef } from '../data/levels/index.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import { gridToWorldX, gridToWorldZ } from '../sim/grid.ts';
import { disposeInstancedMeshes, mergeTexturedParts, type TexturedPart } from './geometryHelpers.ts';
import type { SetPieceKind } from './islandThemes.ts';
import { getIslandTheme } from './islandThemeTable.ts';
import type { KenneyAssetStore } from './kenneyAssets.ts';
import type { MaterialLibrary } from './materials.ts';
import { buildSetPiece, PieceBuilder, type AnimFamily } from './setPieceGeometry.ts';

interface FamilyState {
  readonly family: AnimFamily;
  readonly mesh: THREE.InstancedMesh;
  readonly bases: THREE.Matrix4[];
  readonly phases: number[];
  readonly params: number[];
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Base size multiplier per piece kind (pieces are authored ~1 tile; landmarks read better a bit larger). */
const KIND_SCALE: Record<SetPieceKind, number> = {
  windmill: 1.45,
  cottage: 1.3,
  lighthouse: 1.25,
  waterfall: 1,
  arch: 1.25,
  ruinWall: 1.2,
  pillars: 1.2,
  banner: 1.25,
  crystalGrove: 1.3,
  dock: 1.05,
  watchtower: 1.3,
  hayBales: 1.3,
  scarecrow: 1.3,
  brazier: 1.3,
  seaStack: 1.2,
  peak: 1.3,
  boat: 1.2,
  sailboat: 1.2,
  kite: 1.3,
  windsock: 1.3,
  gatehouse: 1.2,
  obelisk: 1.3,
  pond: 1.05,
  stall: 1.3,
  hut: 1.3,
  parasol: 1.3,
  tent: 1.3,
  statue: 1.25,
  cabin: 1.3,
  cairn: 1.3,
  fountain: 1.05,
  sheep: 1.3,
  lamp: 1.25,
};

function familyGeometry(family: AnimFamily): THREE.BufferGeometry {
  const owned: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number): THREE.BufferGeometry => {
    const g = new THREE.BoxGeometry(w, h, d);
    owned.push(g);
    return g;
  };
  let parts: TexturedPart[] = [];
  switch (family) {
    case 'blades': {
      parts = [];
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        parts.push({
          geometry: box(0.07, 1.55, 0.035),
          colorHex: 0x7b5338,
          rotation: [0, 0, a],
          forceWhiteUv: true,
        });
        const dx = -Math.sin(a) * 0.17;
        const dy = Math.cos(a) * 0.4;
        parts.push({
          geometry: box(0.3, 0.64, 0.022),
          colorHex: 0xf8f4e8,
          position: [dx, dy, 0.03],
          rotation: [0, 0, a],
          forceWhiteUv: true,
        });
      }
      parts.push({ geometry: box(0.16, 0.16, 0.12), colorHex: 0xf6bd41, position: [0, 0, 0.03], forceWhiteUv: true });
      break;
    }
    case 'cloth':
      parts = [
        { geometry: box(0.34, 0.56, 0.02), colorHex: 0xffffff, position: [0.19, -0.3, 0], forceWhiteUv: true },
        { geometry: box(0.34, 0.07, 0.025), colorHex: 0xffe9a0, position: [0.19, -0.03, 0], forceWhiteUv: true },
        { geometry: box(0.12, 0.12, 0.02), colorHex: 0xffffff, position: [0.12, -0.62, 0], rotation: [0, 0, 0.7], forceWhiteUv: true },
        { geometry: box(0.12, 0.12, 0.02), colorHex: 0xffffff, position: [0.28, -0.62, 0], rotation: [0, 0, 0.7], forceWhiteUv: true },
      ];
      break;
    case 'flow':
      parts = [
        { geometry: box(0.07, 0.42, 0.03), colorHex: 0xffffff, forceWhiteUv: true },
        { geometry: box(0.05, 0.2, 0.03), colorHex: 0xd7f4ff, position: [0.08, -0.35, 0], forceWhiteUv: true },
      ];
      break;
    case 'boat':
    case 'sail':
      parts = [
        { geometry: box(0.5, 0.16, 1.0), colorHex: 0xb98a6a, position: [0, 0.08, 0], forceWhiteUv: true },
        { geometry: box(0.54, 0.05, 1.04), colorHex: PALETTE_HEX.coral, position: [0, 0.18, 0], forceWhiteUv: true },
        {
          geometry: new THREE.ConeGeometry(0.27, 0.42, 4),
          colorHex: 0xb98a6a,
          position: [0, 0.1, 0.7],
          rotation: [Math.PI / 2, Math.PI / 4, 0],
          scale: [1, 1, 0.55],
          forceWhiteUv: true,
        },
        { geometry: box(0.04, 0.95, 0.04), colorHex: 0x7b5338, position: [0, 0.66, -0.05], forceWhiteUv: true },
        {
          geometry: new THREE.ConeGeometry(0.34, 0.8, 3),
          colorHex: 0xf8f4e8,
          position: [0.0, 0.7, 0.02],
          rotation: [0, Math.PI / 2, 0],
          scale: [1, 1, 0.2],
          forceWhiteUv: true,
        },
      ];
      owned.push(parts[2].geometry, parts[4].geometry);
      break;
    case 'kite':
      parts = [
        { geometry: box(0.3, 0.3, 0.02), colorHex: 0xffffff, rotation: [0, 0, Math.PI / 4], forceWhiteUv: true },
        { geometry: box(0.025, 0.46, 0.03), colorHex: 0x7b5338, forceWhiteUv: true },
        { geometry: box(0.46, 0.025, 0.03), colorHex: 0x7b5338, forceWhiteUv: true },
        { geometry: box(0.1, 0.06, 0.02), colorHex: 0xf8f4e8, position: [0, -0.4, 0], rotation: [0, 0, 0.5], forceWhiteUv: true },
        { geometry: box(0.1, 0.06, 0.02), colorHex: 0xf8f4e8, position: [0.03, -0.55, 0], rotation: [0, 0, -0.5], forceWhiteUv: true },
        { geometry: box(0.1, 0.06, 0.02), colorHex: 0xf8f4e8, position: [0, -0.7, 0], rotation: [0, 0, 0.5], forceWhiteUv: true },
      ];
      break;
    case 'sock':
      // Tapered horizontal sleeve (cone along +X, wide end at the pole) with a white band.
      parts = [
        {
          geometry: new THREE.CylinderGeometry(0.17, 0.08, 0.34, 7, 1),
          colorHex: 0xffffff,
          position: [0.17, 0, 0],
          rotation: [0, 0, -Math.PI / 2],
          forceWhiteUv: true,
        },
        {
          geometry: new THREE.CylinderGeometry(0.125, 0.1, 0.12, 7, 1),
          colorHex: 0xf8f4e8,
          position: [0.17, 0, 0],
          rotation: [0, 0, -Math.PI / 2],
          forceWhiteUv: true,
        },
      ];
      owned.push(parts[0].geometry, parts[1].geometry);
      break;
    case 'ember':
      parts = [{ geometry: box(0.045, 0.045, 0.045), colorHex: 0xffffff, forceWhiteUv: true }];
      break;
    case 'flame':
      parts = [
        {
          geometry: new THREE.ConeGeometry(0.17, 0.38, 5),
          colorHex: 0xf28729,
          position: [0, 0.14, 0],
          forceWhiteUv: true,
        },
        {
          geometry: new THREE.ConeGeometry(0.09, 0.28, 5),
          colorHex: 0xf6bd41,
          position: [0, 0.12, 0],
          forceWhiteUv: true,
        },
      ];
      owned.push(parts[0].geometry, parts[1].geometry);
      break;
  }
  const merged = mergeTexturedParts(parts);
  for (const g of owned) g.dispose();
  return merged;
}

/**
 * Authored per-island landmarks (windmills, lighthouse, ruins, waterfalls, docks, banners...).
 * Static geometry is merged into one mesh (+ one emissive crystal mesh); animated parts are instanced per family.
 * Total cost is a handful of draw calls per island.
 */
export class SetPieces {
  readonly group = new THREE.Group();
  private disposableGeometries: THREE.BufferGeometry[] = [];
  private families: FamilyState[] = [];

  build(level: LevelDef, materials: MaterialLibrary, assets: KenneyAssetStore): void {
    this.dispose();
    const theme = getIslandTheme(level.id);
    if (theme.setPieces.length === 0) return;

    const mainGeos: THREE.BufferGeometry[] = [];
    const glowGeos: THREE.BufferGeometry[] = [];
    const famBases = new Map<AnimFamily, { bases: THREE.Matrix4[]; phases: number[]; colors: Array<number | undefined>; params: number[] }>();
    const placement = new THREE.Matrix4();

    for (const spec of theme.setPieces) {
      const pb = new PieceBuilder(assets);
      buildSetPiece(pb, spec.kind, spec.variant ?? 0);
      const wx = gridToWorldX(spec.col, level.cols);
      const wz = gridToWorldZ(spec.row, level.rows);
      const sc = (spec.scale ?? 1) * KIND_SCALE[spec.kind];
      placement.compose(
        _p.set(wx, BALANCE.tileGrassTopY, wz),
        _q.setFromEuler(_e.set(0, spec.yaw ?? 0, 0)),
        _s.set(sc, sc, sc),
      );
      if (pb.main.length > 0) {
        const g = mergeTexturedParts(pb.main);
        g.applyMatrix4(placement);
        mainGeos.push(g);
      }
      if (pb.glow.length > 0) {
        const g = mergeTexturedParts(pb.glow);
        g.applyMatrix4(placement);
        glowGeos.push(g);
      }
      for (const a of pb.anims) {
        let entry = famBases.get(a.family);
        if (!entry) {
          entry = { bases: [], phases: [], colors: [], params: [] };
          famBases.set(a.family, entry);
        }
        entry.bases.push(new THREE.Matrix4().multiplyMatrices(placement, a.local));
        entry.phases.push(a.phase);
        entry.colors.push(a.color);
        entry.params.push(a.param ?? 0);
      }
      pb.free();
    }

    const addStatic = (geos: THREE.BufferGeometry[], material: THREE.Material, cast: boolean): void => {
      if (geos.length === 0) return;
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) return;
      merged.computeBoundingSphere();
      this.disposableGeometries.push(merged);
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    addStatic(mainGeos, materials.kenneyTerrain, true);
    addStatic(glowGeos, materials.goalCrystal, false);

    const tint = new THREE.Color();
    for (const [family, entry] of famBases) {
      const geo = familyGeometry(family);
      this.disposableGeometries.push(geo);
      const mesh = new THREE.InstancedMesh(geo, materials.kenneyTerrain, entry.bases.length);
      mesh.castShadow = family !== 'flow' && family !== 'ember';
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      for (let i = 0; i < entry.bases.length; i++) {
        mesh.setMatrixAt(i, entry.bases[i]);
        const c = entry.colors[i];
        tint.setHex(c ?? 0xffffff);
        mesh.setColorAt(i, tint);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this.families.push({ family, mesh, bases: entry.bases, phases: entry.phases, params: entry.params });
    }
    this.update(0);
  }

  update(t: number): void {
    for (let f = 0; f < this.families.length; f++) {
      const fam = this.families[f];
      const n = fam.bases.length;
      for (let i = 0; i < n; i++) {
        const ph = fam.phases[i];
        const base = fam.bases[i];
        switch (fam.family) {
          case 'blades':
            _m2.makeRotationZ(t * 0.9 + ph);
            _m.multiplyMatrices(base, _m2);
            break;
          case 'cloth':
            _m2.makeRotationY(Math.sin(t * 2.1 + ph) * 0.32 + 0.1);
            _m.multiplyMatrices(base, _m2);
            break;
          case 'flow': {
            const frac = (t * 0.85 + ph) % 1;
            _m2.makeTranslation(0, -frac * 0.95, 0);
            _m.multiplyMatrices(base, _m2);
            break;
          }
          case 'boat': {
            _m2.compose(
              _p.set(0, Math.sin(t * 1.3 + ph) * 0.035, 0),
              _q.setFromEuler(_e.set(Math.sin(t * 0.9 + ph) * 0.03, Math.sin(t * 0.6 + ph) * 0.05, Math.sin(t * 1.1 + ph) * 0.04)),
              _s.set(1, 1, 1),
            );
            _m.multiplyMatrices(base, _m2);
            break;
          }
          case 'sail': {
            // Slow lap around the piece origin; bow follows the tangent, gentle roll like the moored boats.
            const r = fam.params[i];
            const dir = r < 0 ? -1 : 1;
            const a = dir * (t * 0.16) + ph;
            _m2.compose(
              _p.set(Math.abs(r) * Math.cos(a), Math.sin(t * 1.3 + ph) * 0.035, -Math.abs(r) * Math.sin(a)),
              _q.setFromEuler(
                _e.set(Math.sin(t * 0.9 + ph) * 0.03, a + (dir > 0 ? Math.PI : 0), Math.sin(t * 1.1 + ph) * 0.05),
              ),
              _s.set(1, 1, 1),
            );
            _m.multiplyMatrices(base, _m2);
            break;
          }
          case 'kite': {
            _m2.compose(
              _p.set(Math.sin(t * 0.8 + ph) * 0.06, Math.sin(t * 1.1 + ph * 2) * 0.08, 0),
              _q.setFromEuler(_e.set(0, Math.sin(t * 0.7 + ph) * 0.25, Math.sin(t * 1.4 + ph) * 0.14)),
              _s.set(1, 1, 1),
            );
            _m.multiplyMatrices(base, _m2);
            break;
          }
          case 'sock': {
            // Swings about the pole, drooping and lifting with gusts.
            _m2.compose(
              _p.set(0, 0, 0),
              _q.setFromEuler(_e.set(0, Math.sin(t * 0.55 + ph) * 0.5 + Math.sin(t * 1.3 + ph * 2) * 0.12, Math.sin(t * 2.2 + ph) * 0.12 - 0.12)),
              _s.set(1, 1, 1),
            );
            _m.multiplyMatrices(base, _m2);
            break;
          }
          case 'ember': {
            // Spark drifts up and sideways, shrinking to nothing; phase offsets decorrelate the three per brazier.
            const frac = (t * 0.45 + ph) % 1;
            const sc = frac < 0.1 ? frac / 0.1 : 1 - (frac - 0.1) / 0.9;
            _m2.compose(
              _p.set(Math.sin(t * 1.7 + ph * 11) * 0.1 * frac, frac * 0.85, Math.cos(t * 1.3 + ph * 7) * 0.08 * frac),
              _q.setFromEuler(_e.set(frac * 4, frac * 6, 0)),
              _s.set(sc, sc, sc),
            );
            _m.multiplyMatrices(base, _m2);
            break;
          }
          case 'flame': {
            const k = 1 + Math.sin(t * 9 + i * 1.7) * 0.18 + Math.sin(t * 15.5 + i) * 0.08;
            _m2.compose(_p.set(0, 0, 0), _q.identity(), _s.set(1 / Math.sqrt(k), k, 1 / Math.sqrt(k)));
            _m.multiplyMatrices(base, _m2);
            break;
          }
        }
        fam.mesh.setMatrixAt(i, _m);
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
