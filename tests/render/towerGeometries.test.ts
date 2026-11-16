import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { TOWER_TYPES } from '../../src/data/towers.ts';
import type { KenneyAssetStore } from '../../src/render/kenneyAssets.ts';
import { KENNEY_MODEL_LIST } from '../../src/render/kenneyAssets.ts';
import { TowerGeometryCache } from '../../src/render/towerGeometries.ts';
import { getTowerPickHeight } from '../../src/render/towerPicking.ts';

/** Loads the real Kenney GLBs from /public in Node (textures are skipped) so tower assembly can be validated headlessly. */
async function loadStore(): Promise<KenneyAssetStore> {
  const g = globalThis as unknown as Record<string, unknown>;
  g.self ??= globalThis;
  const geos = new Map<string, THREE.BufferGeometry>();
  const root = new URL('../../public/models/kenney/', import.meta.url);
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = () => undefined;
  console.warn = () => undefined; // GLTFLoader complains it cannot load the colormap texture in Node
  try {
    for (const name of KENNEY_MODEL_LIST) {
      const buf = readFileSync(new URL(`${name}.glb`, root));
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      const scene = await new Promise<THREE.Group>((res, rej) => {
        new GLTFLoader().parse(ab, '', (x) => res(x.scene), rej);
      });
      scene.updateMatrixWorld(true);
      const parts: THREE.BufferGeometry[] = [];
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const a of Object.keys(geo.attributes)) {
          if (!['position', 'normal', 'uv', 'color'].includes(a)) geo.deleteAttribute(a);
        }
        geo.applyMatrix4(m.matrixWorld);
        const c = geo.getAttribute('position').count;
        if (!geo.hasAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(c * 2), 2));
        if (!geo.hasAttribute('color')) {
          geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(c * 3).fill(1), 3));
        }
        parts.push(geo);
      });
      geos.set(name, parts.length === 1 ? parts[0] : (mergeGeometries(parts, false) as THREE.BufferGeometry));
    }
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
  return { cloneGeometry: (n: string) => geos.get(n)!.clone() } as unknown as KenneyAssetStore;
}

describe('tower geometries (real Kenney modules)', () => {
  let cache: TowerGeometryCache;
  beforeAll(async () => {
    cache = new TowerGeometryCache(await loadStore());
  }, 30_000);

  for (const type of TOWER_TYPES) {
    for (const tier of [1, 2, 3] as const) {
      it(`${type} T${tier}: fits its tile, has geometry and a sane pick height`, () => {
        const pair = cache.get(type, tier);
        pair.base.computeBoundingBox();
        pair.turret.computeBoundingBox();
        const bb = pair.base.boundingBox!;
        const tb = pair.turret.boundingBox!;
        expect(pair.base.getAttribute('position').count).toBeGreaterThan(0);
        expect(pair.turret.getAttribute('position').count).toBeGreaterThan(0);
        // Tile is 2.0 wide: neither base nor turret may spill over into neighbours.
        expect(Math.max(bb.max.x, -bb.min.x, bb.max.z, -bb.min.z)).toBeLessThan(1.0);
        expect(Math.max(tb.max.x, -tb.min.x, tb.max.z, -tb.min.z)).toBeLessThan(1.0);
        const top = pair.turretAnchorY + tb.max.y;
        const pick = getTowerPickHeight(type, tier);
        expect(pick).toBeGreaterThanOrEqual(top - 0.2);
        expect(pick).toBeLessThanOrEqual(top + 0.7);
        // Turret must not float: its lowest point rests on or inside the base.
        expect(pair.turretAnchorY + tb.min.y).toBeLessThanOrEqual(bb.max.y + 0.05);
      });
    }
  }

  it('tiers grow taller for every tower', () => {
    for (const type of TOWER_TYPES) {
      const tops = ([1, 2, 3] as const).map((tier) => {
        const pair = cache.get(type, tier);
        pair.turret.computeBoundingBox();
        return pair.turretAnchorY + pair.turret.boundingBox!.max.y;
      });
      expect(tops[1]).toBeGreaterThan(tops[0]);
      expect(tops[2]).toBeGreaterThan(tops[1]);
    }
  });
});
