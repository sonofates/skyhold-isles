import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface ColoredPart {
  geometry: THREE.BufferGeometry;
  colorHex: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
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
