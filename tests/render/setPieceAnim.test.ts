import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/data/levels/index.ts';
import type { KenneyAssetStore } from '../../src/render/kenneyAssets.ts';
import type { MaterialLibrary } from '../../src/render/materials.ts';
import { buildSetPiece, PieceBuilder } from '../../src/render/setPieceGeometry.ts';
import { SetPieces } from '../../src/render/setPieces.ts';
import { getIslandTheme } from '../../src/render/islandThemeTable.ts';

/** Kenney models are only needed by the crystal pieces; a box with UVs is enough for geometry tests. */
const assets = {
  cloneGeometry: () => new THREE.BoxGeometry(0.2, 0.4, 0.2),
} as unknown as KenneyAssetStore;

const materials = {
  kenneyTerrain: new THREE.MeshBasicMaterial(),
  goalCrystal: new THREE.MeshBasicMaterial(),
} as unknown as MaterialLibrary;

function animsOf(kind: Parameters<typeof buildSetPiece>[1], variant = 0): Array<{ family: string; param?: number }> {
  const pb = new PieceBuilder(assets);
  buildSetPiece(pb, kind, variant);
  const out = pb.anims.map((a) => ({ family: a.family, param: a.param }));
  pb.free();
  return out;
}

const count = (list: Array<{ family: string }>, family: string): number => list.filter((a) => a.family === family).length;

describe('late-island set-piece animation', () => {
  it('cabins puff chimney smoke, lamps keep fireflies, fountains jet water, obelisks and groves glimmer', () => {
    expect(count(animsOf('cabin'), 'smoke')).toBe(3);
    expect(count(animsOf('lamp'), 'mote')).toBe(2);
    expect(count(animsOf('fountain'), 'flow')).toBe(4);
    expect(count(animsOf('obelisk'), 'mote')).toBe(2);
    expect(count(animsOf('crystalGrove', 1), 'mote')).toBe(3);
  });

  it('fireflies orbit in both directions so they cross', () => {
    const motes = animsOf('lamp').filter((a) => a.family === 'mote');
    expect(Math.sign(motes[0].param ?? 0)).toBe(-Math.sign(motes[1].param ?? 0));
  });

  it('every island from Confluence Terraces on has at least one moving element', () => {
    const late = LEVELS.slice(9);
    expect(late).toHaveLength(7);
    for (const level of late) {
      const theme = getIslandTheme(level.id);
      let moving = 0;
      for (const spec of theme.setPieces) moving += animsOf(spec.kind, spec.variant ?? 0).length;
      expect(moving, level.id).toBeGreaterThan(3);
    }
  });

  it('keeps the instance count small (cheap on phones)', () => {
    for (const level of LEVELS.slice(9)) {
      const theme = getIslandTheme(level.id);
      let moving = 0;
      for (const spec of theme.setPieces) moving += animsOf(spec.kind, spec.variant ?? 0).length;
      expect(moving, level.id).toBeLessThan(80);
    }
  });

  it('updates run clean over time: finite matrices, bounded motes and smoke', () => {
    for (const id of ['lanternfall-hollow', 'moonwell-crossing', 'confluence-terraces', 'amberstone-mesa']) {
      const level = LEVELS.find((l) => l.id === id)!;
      const pieces = new SetPieces();
      pieces.build(level, materials, assets);
      const meshes = pieces.group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
      expect(meshes.length, id).toBeGreaterThan(0);
      // One extra draw call per family at most: static main + glow + families.
      expect(pieces.group.children.length, id).toBeLessThanOrEqual(2 + 10);
      for (const t of [0, 0.37, 1.9, 7.3, 31.1, 120.5]) {
        pieces.update(t);
        for (const mesh of meshes) {
          const arr = mesh.instanceMatrix.array;
          for (let i = 0; i < mesh.count * 16; i++) expect(Number.isFinite(arr[i]), `${id} t=${t}`).toBe(true);
          const m = new THREE.Matrix4();
          const s = new THREE.Vector3();
          for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, m);
            s.setFromMatrixScale(m);
            expect(s.x).toBeLessThan(4);
          }
        }
      }
      pieces.dispose();
    }
  });
});
