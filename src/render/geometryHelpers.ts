import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WHITE_SWATCH_UV } from './kenneyPalette.ts';

export interface ColoredPart {
  geometry: THREE.BufferGeometry;
  colorHex: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

export interface TexturedPart {
  geometry: THREE.BufferGeometry;
  colorHex?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  forceWhiteUv?: boolean;
}

const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();

/**
 * Merges multiple transformed Three.js geometries into a single non-indexed BufferGeometry
 * using BufferGeometryUtils.mergeGeometries with baked vertex colors and flat normals.
 */
export function mergeColoredParts(parts: readonly ColoredPart[]): THREE.BufferGeometry {
  const prepared: THREE.BufferGeometry[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const nonIndexed = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();

    if (nonIndexed.hasAttribute('uv')) nonIndexed.deleteAttribute('uv');
    if (nonIndexed.hasAttribute('tangent')) nonIndexed.deleteAttribute('tangent');

    if (part.position || part.rotation || part.scale) {
      _pos.set(part.position?.[0] ?? 0, part.position?.[1] ?? 0, part.position?.[2] ?? 0);
      _euler.set(part.rotation?.[0] ?? 0, part.rotation?.[1] ?? 0, part.rotation?.[2] ?? 0);
      _quat.setFromEuler(_euler);
      _scale.set(part.scale?.[0] ?? 1, part.scale?.[1] ?? 1, part.scale?.[2] ?? 1);
      _mat4.compose(_pos, _quat, _scale);
      nonIndexed.applyMatrix4(_mat4);
    }

    nonIndexed.computeVertexNormals();
    const posAttr = nonIndexed.getAttribute('position');
    const colors = new Float32Array(posAttr.count * 3);
    _color.setHex(part.colorHex);
    for (let v = 0; v < posAttr.count; v++) {
      const dst = v * 3;
      colors[dst] = _color.r;
      colors[dst + 1] = _color.g;
      colors[dst + 2] = _color.b;
    }
    nonIndexed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    prepared.push(nonIndexed);
  }

  const merged = mergeGeometries(prepared, false) ?? new THREE.BufferGeometry();
  for (let i = 0; i < prepared.length; i++) {
    prepared[i].dispose();
  }
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

/**
 * Merges plain non-indexed geometries sharing a single material (no vertex color buffer).
 */
export function mergePlainGeometries(geos: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared: THREE.BufferGeometry[] = [];

  for (let i = 0; i < geos.length; i++) {
    const g = geos[i].index ? geos[i].toNonIndexed() : geos[i].clone();
    if (g.hasAttribute('uv')) g.deleteAttribute('uv');
    if (g.hasAttribute('tangent')) g.deleteAttribute('tangent');
    g.computeVertexNormals();
    prepared.push(g);
  }

  const merged = mergeGeometries(prepared, false) ?? new THREE.BufferGeometry();
  for (let i = 0; i < prepared.length; i++) {
    prepared[i].dispose();
  }
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

/**
 * Merges preloaded textured Kenney geometries and/or procedural parts into a single
 * non-indexed BufferGeometry carrying position, normal, uv, and color attributes.
 */
export function mergeTexturedParts(parts: readonly TexturedPart[]): THREE.BufferGeometry {
  const prepared: THREE.BufferGeometry[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const g = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();

    for (const attrName of Object.keys(g.attributes)) {
      if (attrName !== 'position' && attrName !== 'normal' && attrName !== 'uv' && attrName !== 'color') {
        g.deleteAttribute(attrName);
      }
    }

    if (part.position || part.rotation || part.scale) {
      _pos.set(part.position?.[0] ?? 0, part.position?.[1] ?? 0, part.position?.[2] ?? 0);
      _euler.set(part.rotation?.[0] ?? 0, part.rotation?.[1] ?? 0, part.rotation?.[2] ?? 0);
      _quat.setFromEuler(_euler);
      _scale.set(part.scale?.[0] ?? 1, part.scale?.[1] ?? 1, part.scale?.[2] ?? 1);
      _mat4.compose(_pos, _quat, _scale);
      g.applyMatrix4(_mat4);
    }

    if (!g.hasAttribute('normal')) {
      g.computeVertexNormals();
    }
    const posAttr = g.getAttribute('position');
    const count = posAttr.count;

    if (!g.hasAttribute('uv') || part.forceWhiteUv) {
      const uvArr = new Float32Array(count * 2);
      for (let k = 0; k < count; k++) {
        uvArr[k * 2] = WHITE_SWATCH_UV[0];
        uvArr[k * 2 + 1] = WHITE_SWATCH_UV[1];
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    }

    const existingCol = g.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (part.colorHex !== undefined) {
      _color.setHex(part.colorHex);
      if (existingCol) {
        for (let v = 0; v < count; v++) {
          existingCol.setXYZ(
            v,
            existingCol.getX(v) * _color.r,
            existingCol.getY(v) * _color.g,
            existingCol.getZ(v) * _color.b,
          );
        }
        existingCol.needsUpdate = true;
      } else {
        const colors = new Float32Array(count * 3);
        for (let v = 0; v < count; v++) {
          const dst = v * 3;
          colors[dst] = _color.r;
          colors[dst + 1] = _color.g;
          colors[dst + 2] = _color.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
    } else if (!existingCol) {
      const colors = new Float32Array(count * 3);
      colors.fill(1);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    prepared.push(g);
  }

  const merged = mergeGeometries(prepared, false) ?? new THREE.BufferGeometry();
  for (let i = 0; i < prepared.length; i++) {
    prepared[i].dispose();
  }
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

/**
 * Releases the GPU instance buffers (instanceMatrix / instanceColor) of every InstancedMesh under
 * `root`. Geometries and materials are NOT disposed here; owners handle those separately.
 * Call before `group.clear()` so the meshes are still reachable.
 */
export function disposeInstancedMeshes(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if ((obj as THREE.InstancedMesh).isInstancedMesh) {
      (obj as THREE.InstancedMesh).dispose();
    }
  });
}
