import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../../src/data/balance.ts';
import {
  disposeInstancedMeshes,
  mergeColoredParts,
  mergePlainGeometries,
  mergeTexturedParts,
} from '../../src/render/geometryHelpers.ts';
import {
  createHarmonizedColormapTexture,
  multiplyVertexTint,
  remapUvCell,
  WHITE_SWATCH_UV,
} from '../../src/render/kenneyPalette.ts';
import { LightningArcPool } from '../../src/render/lightningPool.ts';

describe('geometryHelpers', () => {
  it('merges indexed & non-indexed parts with vertex colors, transforms, normals, and strips UVs', () => {
    const box = new THREE.BoxGeometry(1, 1, 1); // indexed with uv
    const tetra = new THREE.TetrahedronGeometry(0.5);
    const merged = mergeColoredParts([
      { geometry: box, colorHex: 0xff0000, position: [2, 1, 0] },
      { geometry: tetra, colorHex: 0x00ff00, scale: [2, 2, 2], rotation: [0, Math.PI / 2, 0] },
    ]);

    expect(merged.index).toBeNull();
    expect(merged.hasAttribute('position')).toBe(true);
    expect(merged.hasAttribute('normal')).toBe(true);
    expect(merged.hasAttribute('color')).toBe(true);
    expect(merged.hasAttribute('uv')).toBe(false);
    expect(merged.boundingBox).not.toBeNull();
    expect(merged.boundingSphere).not.toBeNull();
    // Box shifted to x=2 => max.x >= 2.49
    expect(merged.boundingBox!.max.x).toBeGreaterThan(2.4);

    // First vertex belongs to red box
    const col = merged.getAttribute('color');
    expect(col.getX(0)).toBeCloseTo(1, 3);
    expect(col.getY(0)).toBeCloseTo(0, 3);
    expect(col.getZ(0)).toBeCloseTo(0, 3);

    box.dispose();
    tetra.dispose();
    merged.dispose();
  });

  it('merges plain geometries stripping UVs and preserving vertex positions', () => {
    const a = new THREE.BoxGeometry(1, 1, 1);
    const b = new THREE.BoxGeometry(1, 1, 1).translate(3, 0, 0);
    const merged = mergePlainGeometries([a, b]);

    expect(merged.index).toBeNull();
    expect(merged.hasAttribute('position')).toBe(true);
    expect(merged.hasAttribute('normal')).toBe(true);
    expect(merged.hasAttribute('uv')).toBe(false);
    expect(merged.boundingBox!.max.x).toBeCloseTo(3.5, 4);

    a.dispose();
    b.dispose();
    merged.dispose();
  });

  it('merges textured parts preserving UVs, forcing white UV, and multiplying vertex tint', () => {
    const withUv = new THREE.BoxGeometry(1, 1, 1);
    const noUv = new THREE.BoxGeometry(1, 1, 1);
    noUv.deleteAttribute('uv');
    noUv.setAttribute('extraAttr', new THREE.BufferAttribute(new Float32Array(noUv.getAttribute('position').count), 1));

    // Pre-tint noUv to grey (0.5, 0.5, 0.5) so colorHex multiplies it
    const posCount = noUv.getAttribute('position').count;
    const grey = new Float32Array(posCount * 3).fill(0.5);
    noUv.setAttribute('color', new THREE.BufferAttribute(grey, 3));

    const merged = mergeTexturedParts([
      { geometry: withUv, forceWhiteUv: true },
      { geometry: noUv, colorHex: 0xff8040, position: [0, 2, 0] },
    ]);

    expect(merged.index).toBeNull();
    expect(merged.hasAttribute('uv')).toBe(true);
    expect(merged.hasAttribute('color')).toBe(true);
    expect(merged.hasAttribute('extraAttr')).toBe(false);

    const uv = merged.getAttribute('uv');
    expect(uv.getX(0)).toBeCloseTo(WHITE_SWATCH_UV[0], 5);
    expect(uv.getY(0)).toBeCloseTo(WHITE_SWATCH_UV[1], 5);

    // Check multiplied tint on final vertex (grey 0.5 * colorHex red 1.0 -> ~0.5 in sRGB/linear converted)
    const col = merged.getAttribute('color');
    const lastIdx = col.count - 1;
    expect(col.getX(lastIdx)).toBeGreaterThan(col.getZ(lastIdx));

    withUv.dispose();
    noUv.dispose();
    merged.dispose();
  });

  it('disposes nested InstancedMesh buffers cleanly', () => {
    const root = new THREE.Group();
    const child = new THREE.Group();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial();
    const inst = new THREE.InstancedMesh(geo, mat, 4);

    let disposedCalls = 0;
    const origDispose = inst.dispose.bind(inst);
    inst.dispose = () => {
      disposedCalls++;
      origDispose();
    };

    child.add(inst);
    root.add(child);
    disposeInstancedMeshes(root);
    expect(disposedCalls).toBe(1);

    geo.dispose();
    mat.dispose();
  });
});

describe('kenneyPalette UV and vertex tint helpers', () => {
  it('remaps only vertices belonging to fromCell and tints selectively by cell', () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    // Vertex 0 in cell (1, 2), Vertex 1 in cell (3, 1), Vertex 2 clamped edge in cell (7, 3)
    const uvs = new Float32Array([
      1.25 / 8, 2.5 / 4,
      3.5 / 8, 1.5 / 4,
      7.9 / 8, 3.9 / 4,
    ]);
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    remapUvCell(geo, [1, 2], [4, 0]);
    const uvAttr = geo.getAttribute('uv');
    expect(uvAttr.getX(0)).toBeCloseTo(4.25 / 8, 5);
    expect(uvAttr.getY(0)).toBeCloseTo(0.5 / 4, 5);
    // Untouched cell (3, 1)
    expect(uvAttr.getX(1)).toBeCloseTo(3.5 / 8, 5);
    expect(uvAttr.getY(1)).toBeCloseTo(1.5 / 4, 5);

    // Selective tint on cell (4, 0) only -> vertex 0 tinted, vertex 1 & 2 remain white (1,1,1)
    multiplyVertexTint(geo, 0x00ff00, [4, 0]);
    const col = geo.getAttribute('color');
    expect(col.getX(0)).toBeCloseTo(0, 4);
    expect(col.getY(0)).toBeCloseTo(1, 4);
    expect(col.getX(1)).toBeCloseTo(1, 4);
    expect(col.getY(1)).toBeCloseTo(1, 4);

    // Global tint without onlyCell multiplies every vertex
    multiplyVertexTint(geo, 0xff0000);
    expect(col.getY(0)).toBeCloseTo(0, 4);
    expect(col.getX(1)).toBeCloseTo(1, 4);
    expect(col.getY(1)).toBeCloseTo(0, 4);

    // remapUvCell on geometry missing 'uv' is a safe no-op
    const noUvGeo = new THREE.BufferGeometry();
    noUvGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    expect(remapUvCell(noUvGeo, [0, 0], [1, 1])).toBe(noUvGeo);
    expect(noUvGeo.hasAttribute('uv')).toBe(false);

    // multiplyVertexTint creates a 'color' attribute when missing
    expect(noUvGeo.hasAttribute('color')).toBe(false);
    multiplyVertexTint(noUvGeo, 0x00ff00);
    const createdCol = noUvGeo.getAttribute('color') as THREE.BufferAttribute;
    expect(createdCol).toBeDefined();
    expect(createdCol.getX(0)).toBeCloseTo(0, 4);
    expect(createdCol.getY(0)).toBeCloseTo(1, 4);
    expect(createdCol.getZ(0)).toBeCloseTo(0, 4);

    noUvGeo.dispose();
    geo.dispose();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createHarmonizedColormapTexture throws when 2D canvas context is unavailable', () => {
    vi.stubGlobal('document', {
      createElement: () => ({ width: 64, height: 32, getContext: () => null }),
    });
    expect(() =>
      createHarmonizedColormapTexture({ width: 64, height: 32 } as unknown as HTMLCanvasElement),
    ).toThrow('Could not create 2D canvas context');
  });
});

describe('LightningArcPool lifecycle and bounds', () => {
  it('spawns jittered arcs, expires after 0.16s, respects capacity & vertex caps, and clears cleanly', () => {
    const pool = new LightningArcPool();
    const lineSegs = pool.group.children[0] as THREE.LineSegments;
    expect(lineSegs.visible).toBe(false);

    // < 2 points is safely ignored
    pool.spawn([{ x: 0, y: 0, z: 0 }]);
    expect(lineSegs.visible).toBe(false);

    // 3 points => 2 jumps * 3 segments * 2 vertices = 12 vertices
    pool.spawn([
      { x: 0, y: 1, z: 0 },
      { x: 2, y: 1, z: 0 },
      { x: 4, y: 1, z: 2 },
    ]);
    expect(lineSegs.visible).toBe(true);
    expect(lineSegs.geometry.drawRange.count).toBe(12);

    // Update < 0.16s keeps active; >= 0.16s hides & resets drawRange
    pool.update(0.08);
    expect(lineSegs.visible).toBe(true);
    pool.update(0.1);
    expect(lineSegs.visible).toBe(false);
    expect(lineSegs.geometry.drawRange.count).toBe(0);

    // Exhaust pool capacity with oversized multi-jump arcs without throwing or overflowing buffer
    const manyPts = Array.from({ length: 12 }, (_, idx) => ({ x: idx, y: 1, z: 0 }));
    for (let i = 0; i < BALANCE.pools.maxLightningArcs + 5; i++) {
      pool.spawn(manyPts);
    }
    expect(lineSegs.visible).toBe(true);
    expect(lineSegs.geometry.drawRange.count).toBeLessThanOrEqual(
      BALANCE.pools.maxLightningArcs * 6 * 3 * 2,
    );

    pool.clear();
    expect(lineSegs.visible).toBe(false);
    expect(lineSegs.geometry.drawRange.count).toBe(0);
    pool.dispose();
  });
});
