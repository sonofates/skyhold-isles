import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KenneyAssetStore } from '../../src/render/kenneyAssets.ts';

function installCanvasAndImageMock(failImage = false) {
  const fakeCtx = {
    clearRect: () => {},
    fillRect: () => {},
    drawImage: () => {},
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4).fill(128),
    }),
    putImageData: () => {},
    fillStyle: '',
  };

  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return { width: 64, height: 32, getContext: () => fakeCtx };
      }
      return {};
    },
  });

  const requestedUrls: string[] = [];
  class FakeImage {
    width = 64;
    height = 32;
    crossOrigin = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private _src = '';

    get src(): string {
      return this._src;
    }
    set src(url: string) {
      this._src = url;
      requestedUrls.push(url);
      queueMicrotask(() => {
        if (failImage) this.onerror?.();
        else this.onload?.();
      });
    }
  }

  vi.stubGlobal('Image', FakeImage);
  return { requestedUrls };
}

describe('KenneyAssetStore preload, normalization, and disposal', () => {
  beforeEach(() => {
    installCanvasAndImageMock(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('preloads GLBs concurrently, normalizes attributes/transforms, clones safely, and disposes resources', async () => {
    const disposedGeos: THREE.BufferGeometry[] = [];
    const disposedMats: THREE.Material[] = [];
    const disposedMaps: THREE.Texture[] = [];

    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      const orig = g.dispose.bind(g);
      g.dispose = () => {
        disposedGeos.push(g);
        orig();
      };
      return g;
    };

    const loadSpy = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async (url: string) => {
      const scene = new THREE.Group();
      if (url.endsWith('tile-straight.glb')) {
        // Multi-part: indexed box with extra 'tangent' attribute + non-indexed triangle without normals/uv/color
        const box = trackGeo(new THREE.BoxGeometry(1, 1, 1));
        const posCount = box.getAttribute('position').count;
        box.setAttribute('tangent', new THREE.BufferAttribute(new Float32Array(posCount * 4), 4));
        const m1 = new THREE.Mesh(box, new THREE.MeshBasicMaterial());
        m1.position.set(2, 0, 0);

        const tri = trackGeo(new THREE.BufferGeometry());
        tri.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
        );
        const m2 = new THREE.Mesh(tri, new THREE.MeshBasicMaterial());
        scene.add(m1, m2);
      } else if (url.endsWith('weapon-ballista.glb')) {
        // Single-part mesh with array material + texture map to test full disposal branch
        const box = trackGeo(new THREE.BoxGeometry(0.5, 0.5, 0.5));
        const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
        const origTexDispose = tex.dispose.bind(tex);
        tex.dispose = () => {
          disposedMaps.push(tex);
          origTexDispose();
        };
        const mat = new THREE.MeshBasicMaterial({ map: tex });
        const origMatDispose = mat.dispose.bind(mat);
        mat.dispose = () => {
          disposedMats.push(mat);
          origMatDispose();
        };
        scene.add(new THREE.Mesh(box, [mat]));
      }
      // 'detail-rocks.glb' stays an empty Group to test 0-part fallback
      return { scene } as unknown as Awaited<ReturnType<GLTFLoader['loadAsync']>>;
    });

    const progressLog: Array<[number, number, string]> = [];
    const store = await KenneyAssetStore.preload(
      (loaded, total, label) => progressLog.push([loaded, total, label]),
      ['tile-straight', 'weapon-ballista', 'detail-rocks'],
    );

    expect(loadSpy).toHaveBeenCalledTimes(3);
    expect(progressLog[0]).toEqual([0, 4, 'Loading colormap palette...']);
    expect(progressLog[1]).toEqual([1, 4, 'Loading modular models...']);
    expect(progressLog[progressLog.length - 1][0]).toBe(4);
    expect(progressLog[progressLog.length - 1][1]).toBe(4);

    // Source scene meshes, materials, and texture maps were disposed cleanly after normalization
    expect(disposedGeos.length).toBe(3);
    expect(disposedMats.length).toBe(1);
    expect(disposedMaps.length).toBe(1);

    expect(store.has('tile-straight')).toBe(true);
    expect(store.has('weapon-ballista')).toBe(true);
    expect(store.has('detail-rocks')).toBe(true);
    expect(store.has('detail-crystal')).toBe(false);

    const cloned = store.cloneGeometry('tile-straight');
    expect(cloned.index).toBeNull();
    expect(cloned.hasAttribute('position')).toBe(true);
    expect(cloned.hasAttribute('normal')).toBe(true);
    expect(cloned.hasAttribute('uv')).toBe(true);
    expect(cloned.hasAttribute('color')).toBe(true);
    expect(cloned.hasAttribute('tangent')).toBe(false);
    // Transformed mesh at x=2 pushes boundingBox max.x >= 2.49
    expect(cloned.boundingBox!.max.x).toBeGreaterThan(2.4);

    // Empty 0-part GLB yields empty valid BufferGeometry without throwing
    const emptyClone = store.cloneGeometry('detail-rocks');
    expect(emptyClone.getAttribute('position')).toBeUndefined();

    // Missing model throws descriptive error
    expect(() => store.cloneGeometry('detail-crystal')).toThrow(/was not preloaded/);

    const colormapDisposeSpy = vi.spyOn(store.colormapTexture, 'dispose');
    store.dispose();
    expect(colormapDisposeSpy).toHaveBeenCalledTimes(1);
    expect(store.has('tile-straight')).toBe(false);
    cloned.dispose();
    emptyClone.dispose();
  });

  it('rejects cleanly when colormap texture fails to load', async () => {
    installCanvasAndImageMock(true);
    await expect(KenneyAssetStore.preload(undefined, ['tile-straight'])).rejects.toThrow(
      /Failed to load texture/,
    );
  });
});
