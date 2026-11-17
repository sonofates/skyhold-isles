import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { KenneyAssetStore } from '../../src/render/kenneyAssets.ts';
import { KENNEY_MODEL_LIST } from '../../src/render/kenneyAssets.ts';

export const KENNEY_DIR = new URL('../../public/models/kenney/', import.meta.url);

/**
 * Loads the real Kenney GLBs from /public in Node (the embedded colormap texture is skipped) so tower assembly
 * can be validated and rendered headlessly. Returns an object with the same `cloneGeometry` contract as
 * `KenneyAssetStore`.
 */
export async function loadNodeKenneyStore(): Promise<KenneyAssetStore> {
  const g = globalThis as unknown as Record<string, unknown>;
  g.self ??= globalThis;
  const geos = new Map<string, THREE.BufferGeometry>();
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = () => undefined;
  console.warn = () => undefined; // GLTFLoader complains it cannot load the colormap texture in Node
  try {
    for (const name of KENNEY_MODEL_LIST) {
      const buf = readFileSync(new URL(`${name}.glb`, KENNEY_DIR));
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
