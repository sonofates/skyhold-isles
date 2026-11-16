import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LEVELS, parseLevelGrid } from '../../src/data/levels/index.ts';
import { DecorBuilder } from '../../src/render/decorBuilder.ts';
import { claimedDecorTiles } from '../../src/render/islandThemes.ts';
import { getIslandTheme } from '../../src/render/islandThemeTable.ts';
import type { KenneyAssetStore } from '../../src/render/kenneyAssets.ts';
import { MapBuilder } from '../../src/render/mapBuilder.ts';
import type { MaterialLibrary } from '../../src/render/materials.ts';

function stubGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 0.4, 1).toNonIndexed();
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  col.fill(1);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function stubAssets(): KenneyAssetStore {
  return {
    cloneGeometry: () => stubGeometry(),
    has: () => true,
    colormapTexture: null,
  } as unknown as KenneyAssetStore;
}

function stubMaterials(): MaterialLibrary {
  const mk = (): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial();
  return {
    solid: { get: () => mk() },
    vertexColored: mk(),
    kenneyTerrain: mk(),
    goalCrystal: mk(),
    waterMaterial: mk(),
    shoreFoamMaterial: mk(),
    waterUniforms: { uWaterTime: { value: 0 }, uLagoonRadius: { value: 22 } },
  } as unknown as MaterialLibrary;
}

function countDraws(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n;
}

describe('island themes', () => {
  for (const level of LEVELS) {
    describe(level.name, () => {
      const theme = getIslandTheme(level.id);
      const grid = parseLevelGrid(level);

      it('only puts set pieces on decor tiles or open water', () => {
        for (const p of theme.setPieces) {
          const c = Math.round(p.col);
          const r = Math.round(p.row);
          const tile = grid[r]?.[c];
          if (tile === undefined) continue; // off-grid water
          expect(['decor', 'empty'], `${p.kind} at ${p.col},${p.row} sits on ${tile}`).toContain(tile);
        }
      });

      it('claims each decor tile at most once', () => {
        const seen = new Set<string>();
        for (const p of theme.setPieces) {
          const c = Math.round(p.col);
          const r = Math.round(p.row);
          if (grid[r]?.[c] !== 'decor') continue;
          const key = `${c},${r}`;
          expect(seen.has(key), `duplicate set piece on ${key}`).toBe(false);
          seen.add(key);
        }
        expect(claimedDecorTiles(level, theme).size).toBe(seen.size);
      });

      it('builds within the draw-call budget and disposes cleanly', () => {
        const materials = stubMaterials();
        const assets = stubAssets();
        const map = new MapBuilder();
        const decor = new DecorBuilder();
        map.build(level, materials, assets);
        decor.build(level, materials, assets);
        map.update(1.7);
        decor.update(1.7);
        const draws = countDraws(map.group) + countDraws(decor.group);
        expect(draws).toBeLessThan(40);
        map.dispose();
        decor.dispose();
        expect(countDraws(map.group)).toBe(0);
      });
    });
  }
});
