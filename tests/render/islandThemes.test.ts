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
    goalCrystal: new THREE.MeshStandardMaterial(),
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

      it('keeps sailboat orbits over open water', () => {
        for (const p of theme.setPieces) {
          if (p.kind !== 'sailboat') continue;
          const radiusTiles = (2.4 * (p.scale ?? 1) * 1.2) / 2 + 0.3; // orbit + hull half-length margin
          for (let k = 0; k < 24; k++) {
            const a = (k / 24) * Math.PI * 2;
            const c = Math.round(p.col + Math.cos(a) * radiusTiles);
            const r = Math.round(p.row + Math.sin(a) * radiusTiles);
            const tile = grid[r]?.[c];
            expect(tile === undefined || tile === 'empty', `sailboat orbit crosses ${tile} at ${c},${r}`).toBe(true);
          }
        }
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
        for (const root of [map.group, decor.group]) {
          root.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const pos = mesh.geometry.getAttribute('position');
            expect(pos.count).toBeGreaterThan(0);
            mesh.geometry.computeBoundingSphere();
            const r = mesh.geometry.boundingSphere?.radius ?? NaN;
            expect(Number.isFinite(r), `non-finite geometry in ${mesh.name || mesh.type}`).toBe(true);
          });
        }
        map.dispose();
        decor.dispose();
        expect(countDraws(map.group)).toBe(0);
      });
    });
  }
});

describe('theme fallback', () => {
  it('derives a deterministic position-free biome for levels without an authored theme', () => {
    const a = getIslandTheme('brand-new-island');
    const b = getIslandTheme('brand-new-island');
    expect(a).toBe(b);
    expect(a.setPieces).toHaveLength(0);
    expect(a.ground).toHaveLength(0);
    expect(a.grassZones).toHaveLength(0);
  });
});
