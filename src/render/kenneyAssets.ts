import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createHarmonizedColormapTexture } from './kenneyPalette.ts';

export const KENNEY_MODEL_LIST = [
  // Terrain tiles & bridges
  'tile',
  'tile-straight',
  'tile-corner-round',
  'tile-end-round',
  'tile-spawn-end-round',
  'tile-crossing',
  'tile-split',
  'wood-structure-high',
  'wood-structure',
  // Nature & island props
  'detail-tree',
  'detail-tree-large',
  'detail-rocks',
  'detail-rocks-large',
  'detail-dirt',
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

/**
 * Strips extra attributes/indexes so every normalized GLB shares identical attribute layout:
 * non-indexed position (vec3), normal (vec3), uv (vec2), color (vec3).
 */
function normalizeMeshGeometry(src: THREE.BufferGeometry, worldMatrix: THREE.Matrix4): THREE.BufferGeometry {
  const geo = src.index ? src.toNonIndexed() : src.clone();
  for (const attrName of Object.keys(geo.attributes)) {
    if (attrName !== 'position' && attrName !== 'normal' && attrName !== 'uv' && attrName !== 'color') {
      geo.deleteAttribute(attrName);
    }
  }
  geo.applyMatrix4(worldMatrix);
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

function disposeSceneResources(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i] as THREE.Material & { map?: THREE.Texture | null };
      m?.map?.dispose();
      m?.dispose();
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
    const base = `${import.meta.env.BASE_URL}models/kenney/`;
    const total = models.length + 1;
    let completed = 0;

    onProgress?.(0, total, 'Loading colormap palette...');
    const img = await loadImage(`${base}Textures/colormap.png`);
    const colormapTexture = createHarmonizedColormapTexture(img);
    completed++;
    onProgress?.(completed, total, 'Loading modular models...');

    const loader = new GLTFLoader();
    const geometries = new Map<KenneyModelName, THREE.BufferGeometry>();

    // Load in bounded concurrent waves to avoid saturating browser/GPU memory
    const concurrency = 6;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < models.length) {
        const idx = cursor++;
        const name = models[idx];
        const gltf = await loader.loadAsync(`${base}${name}.glb`);
        gltf.scene.updateMatrixWorld(true);
        const parts: THREE.BufferGeometry[] = [];
        gltf.scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh && mesh.geometry) {
            parts.push(normalizeMeshGeometry(mesh.geometry, mesh.matrixWorld));
          }
        });
        disposeSceneResources(gltf.scene);

        let merged: THREE.BufferGeometry;
        if (parts.length === 0) {
          merged = new THREE.BufferGeometry();
        } else if (parts.length === 1) {
          merged = parts[0];
        } else {
          merged = mergeGeometries(parts, false) ?? parts[0];
          for (let p = 0; p < parts.length; p++) {
            parts[p].dispose();
          }
        }
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
        geometries.set(name, merged);

        completed++;
        onProgress?.(completed, total, name);
      }
    };

    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(concurrency, models.length); w++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    return new KenneyAssetStore(colormapTexture, geometries);
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
