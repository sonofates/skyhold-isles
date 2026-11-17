import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createHarmonizedColormapTexture } from './kenneyPalette.ts';

export const KENNEY_MODEL_LIST = [
  // Terrain tiles & bridges
  'tile-straight',
  'tile-corner-round',
  'tile-end-round',
  'tile-spawn-end-round',
  'tile-crossing',
  'tile-split',
  'spawn-square',
  'wood-structure-high',
  'wood-structure',
  // Nature & island props
  'detail-tree',
  'detail-tree-large',
  'detail-rocks',
  'detail-rocks-large',
  'detail-crystal',
  'detail-crystal-large',
  // Modular tower pieces
  'tower-round-base',
  'tower-round-bottom-a',
  'tower-round-bottom-b',
  'tower-round-bottom-c',
  'tower-round-middle-a',
  'tower-round-middle-b',
  'tower-round-middle-c',
  'tower-round-top-a',
  'tower-round-top-b',
  'tower-round-crystals',
  'tower-square-bottom-a',
  'tower-square-bottom-b',
  'tower-square-bottom-c',
  'tower-square-middle-a',
  'tower-square-middle-b',
  'tower-square-middle-c',
  'tower-square-top-a',
  'tower-square-top-b',
  'tower-square-top-c',
  // Weapons & projectiles
  'weapon-ballista',
  'weapon-cannon',
  'weapon-catapult',
  'weapon-ammo-arrow',
  'weapon-ammo-cannonball',
  'weapon-ammo-boulder',
] as const;

export type KenneyModelName = (typeof KENNEY_MODEL_LIST)[number];

function isIdentityMatrix(m: THREE.Matrix4): boolean {
  const e = m.elements;
  return (
    e[0] === 1 && e[1] === 0 && e[2] === 0 && e[3] === 0 &&
    e[4] === 0 && e[5] === 1 && e[6] === 0 && e[7] === 0 &&
    e[8] === 0 && e[9] === 0 && e[10] === 1 && e[11] === 0 &&
    e[12] === 0 && e[13] === 0 && e[14] === 0 && e[15] === 1
  );
}

/**
 * Strips extra attributes/indexes so every normalized GLB shares identical attribute layout:
 * non-indexed position (vec3), normal (vec3), uv (vec2), color (vec3).
 */
function normalizeMeshGeometry(src: THREE.BufferGeometry, worldMatrix: THREE.Matrix4): THREE.BufferGeometry {
  // Strip unused attributes (e.g. tangents) before toNonIndexed() so de-indexing never expands them.
  for (const attrName of Object.keys(src.attributes)) {
    if (attrName !== 'position' && attrName !== 'normal' && attrName !== 'uv' && attrName !== 'color') {
      src.deleteAttribute(attrName);
    }
  }
  const geo = src.index ? src.toNonIndexed() : src.clone();
  if (isIdentityMatrix(worldMatrix)) {
    // Preserve GLTFLoader's precomputed bounds so identity single-mesh models skip redundant vertex scans.
    if (src.boundingBox) geo.boundingBox = src.boundingBox.clone();
    if (src.boundingSphere) geo.boundingSphere = src.boundingSphere.clone();
  } else {
    geo.applyMatrix4(worldMatrix);
  }
  if (!geo.hasAttribute('normal')) {
    geo.computeVertexNormals();
  }
  const count = geo.getAttribute('position').count;
  if (!geo.hasAttribute('uv')) {
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  if (!geo.hasAttribute('color')) {
    const col = new Float32Array(count * 3);
    col.fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return geo;
}

function disposeSceneResources(root: THREE.Object3D, sharedDummyMaterial?: THREE.Material): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i] as (THREE.Material & { map?: THREE.Texture | null }) | undefined;
      if (!m || m === sharedDummyMaterial) continue;
      m.map?.dispose();
      m.dispose();
    }
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load texture: ${url}`));
    img.src = url;
  });
}

export function yieldMainThread(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof sched?.yield === 'function') {
    return sched.yield();
  }
  if (typeof MessageChannel === 'function') {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close?.();
        channel.port2.close?.();
        resolve();
      };
      channel.port2.postMessage(undefined);
    });
  }
  return new Promise((resolve) => {
    if (typeof setTimeout === 'function') {
      setTimeout(resolve, 0);
    } else {
      resolve();
    }
  });
}

/**
 * Holds preloaded Kenney Tower Defense Kit normalized geometries and the shared
 * palette-harmonized colormap texture.
 */
export class KenneyAssetStore {
  readonly colormapTexture: THREE.CanvasTexture;
  private readonly geometries: Map<KenneyModelName, THREE.BufferGeometry>;

  private constructor(
    colormapTexture: THREE.CanvasTexture,
    geometries: Map<KenneyModelName, THREE.BufferGeometry>,
  ) {
    this.colormapTexture = colormapTexture;
    this.geometries = geometries;
  }

  static async preload(
    onProgress?: (loaded: number, total: number, label: string) => void,
    models: readonly KenneyModelName[] = KENNEY_MODEL_LIST,
  ): Promise<KenneyAssetStore> {
    const envBase = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    const base = `${envBase}models/kenney/`;
    const total = models.length + 1;
    let completed = 0;

    onProgress?.(0, total, 'colormap & modular models…');

    // Fetch colormap.png in parallel with GLB models instead of blocking model requests on an RTT.
    const colormapPromise = loadImage(`${base}Textures/colormap.png`).then((img) => {
      const tex = createHarmonizedColormapTexture(img);
      completed++;
      onProgress?.(completed, total, 'colormap palette');
      return tex;
    });

    // Every Kenney GLB references Textures/colormap.png; skipping GLTF material/texture loads avoids
    // 40 redundant PNG fetches/ImageBitmap decodes and material allocations that are immediately disposed.
    const dummyMaterial = new THREE.MeshBasicMaterial();
    const loader = new GLTFLoader();
    loader.register(() => ({
      name: 'SKYHOLD_GEOMETRY_ONLY',
      loadMaterial: () => Promise.resolve(dummyMaterial),
    }));

    const geometries = new Map<KenneyModelName, THREE.BufferGeometry>();

    const concurrency = 10;
    let cursor = 0;
    let syncCpuMs = 0;
    let accountedUntilMs = 0;
    let pendingYield: Promise<void> | null = null;
    let aborted = false;
    const abortController = typeof AbortController === 'function' ? new AbortController() : null;

    const worker = async (): Promise<void> => {
      while (!aborted && cursor < models.length) {
        const idx = cursor++;
        const name = models[idx];
        const url = `${base}${name}.glb`;
        let gltf: GLTF;
        let cpuStartMs: number;
        if (typeof fetch === 'function') {
          const res = abortController
            ? await fetch(url, { signal: abortController.signal })
            : await fetch(url);
          if (aborted) return;
          if (!res.ok) {
            throw new Error(`Failed to load model "${name}" (${res.status})`);
          }
          const buf = await res.arrayBuffer();
          if (aborted) return;
          cpuStartMs = typeof performance !== 'undefined' ? performance.now() : 0;
          gltf = await loader.parseAsync(buf, base);
        } else {
          gltf = await loader.loadAsync(url);
          cpuStartMs = typeof performance !== 'undefined' ? performance.now() : 0;
        }
        if (aborted) {
          disposeSceneResources(gltf.scene, dummyMaterial);
          return;
        }
        gltf.scene.updateMatrixWorld(true);
        const parts: THREE.BufferGeometry[] = [];
        gltf.scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh && mesh.geometry) {
            parts.push(normalizeMeshGeometry(mesh.geometry, mesh.matrixWorld));
          }
        });
        disposeSceneResources(gltf.scene, dummyMaterial);

        let merged: THREE.BufferGeometry;
        if (parts.length === 0) {
          merged = new THREE.BufferGeometry();
        } else if (parts.length === 1) {
          merged = parts[0];
        } else {
          const combined = mergeGeometries(parts, false);
          if (combined) {
            merged = combined;
            for (let p = 0; p < parts.length; p++) {
              parts[p].dispose();
            }
          } else {
            merged = parts[0];
            for (let p = 1; p < parts.length; p++) {
              parts[p].dispose();
            }
          }
        }
        if (!merged.boundingBox) merged.computeBoundingBox();
        if (!merged.boundingSphere) merged.computeBoundingSphere();
        geometries.set(name, merged);

        completed++;
        onProgress?.(completed, total, name);

        if (typeof performance !== 'undefined') {
          const cpuEndMs = performance.now();
          // Integrate only non-overlapping main-thread parse/merge work across concurrent
          // workers so overlapping async parseAsync spans never multiply syncCpuMs by N.
          const effectiveStartMs = Math.max(cpuStartMs, accountedUntilMs);
          if (cpuEndMs > effectiveStartMs) {
            syncCpuMs += cpuEndMs - effectiveStartMs;
            accountedUntilMs = cpuEndMs;
          }
          if (syncCpuMs >= 10) {
            if (!pendingYield) {
              pendingYield = yieldMainThread().then(() => {
                syncCpuMs = 0;
                pendingYield = null;
              });
            }
            await pendingYield;
          }
        }
      }
    };

    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(concurrency, models.length); w++) {
      workers.push(worker());
    }

    try {
      const [colormapTexture] = await Promise.all([colormapPromise, Promise.all(workers)]);
      return new KenneyAssetStore(colormapTexture, geometries);
    } catch (err) {
      aborted = true;
      abortController?.abort();
      void colormapPromise.then(
        (tex) => tex.dispose(),
        () => {},
      );
      geometries.forEach((g) => g.dispose());
      geometries.clear();
      throw err;
    } finally {
      dummyMaterial.dispose();
    }
  }

  /**
   * Returns a cloned normalized BufferGeometry (position, normal, uv, color) ready for transforms.
   */
  cloneGeometry(name: KenneyModelName): THREE.BufferGeometry {
    const src = this.geometries.get(name);
    if (!src) {
      throw new Error(`Kenney model "${name}" was not preloaded`);
    }
    return src.clone();
  }

  has(name: KenneyModelName): boolean {
    return this.geometries.has(name);
  }

  dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.geometries.clear();
    this.colormapTexture.dispose();
  }
}
