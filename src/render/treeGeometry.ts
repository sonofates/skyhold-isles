import * as THREE from 'three';
import { PALETTE_HEX } from '../data/palette.ts';
import { mergeTexturedParts, type TexturedPart } from './geometryHelpers.ts';

/**
 * Procedural low-poly tree silhouettes (white-swatch UVs + baked vertex colours, same recipe as the
 * existing broadleaf). Local height ≈ 0.55–0.75 so the DecorBuilder's 1.6–2.9× scales match Kenney trees.
 */

const TRUNK_BROWN = 0x795138;

function finish(parts: TexturedPart[], disposables: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeTexturedParts(parts);
  for (const d of disposables) d.dispose();
  return merged;
}

/** Layered conifer: three shrinking cones on a short trunk. `snow` caps the top tier in cream. */
export function createPineGeometry(snow = false): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.2, 5);
  const cone = new THREE.ConeGeometry(1, 1, 6);
  const parts: TexturedPart[] = [
    { geometry: trunk, colorHex: TRUNK_BROWN, position: [0, 0.1, 0], forceWhiteUv: true },
    {
      geometry: cone,
      colorHex: 0x2f7d3a,
      position: [0, 0.26, 0],
      rotation: [0, 0.3, 0],
      scale: [0.25, 0.28, 0.25],
      forceWhiteUv: true,
    },
    {
      geometry: cone,
      colorHex: 0x3a8c44,
      position: [0, 0.41, 0],
      rotation: [0, 0.9, 0],
      scale: [0.2, 0.25, 0.2],
      forceWhiteUv: true,
    },
    {
      geometry: cone,
      colorHex: snow ? PALETTE_HEX.cream : 0x4aa14e,
      position: [0, 0.55, 0],
      rotation: [0, 1.4, 0],
      scale: [0.145, 0.24, 0.145],
      forceWhiteUv: true,
    },
  ];
  return finish(parts, [trunk, cone]);
}

/** Leaning palm: segmented curved trunk, a crown of drooping fronds and two coconuts. */
export function createPalmGeometry(): THREE.BufferGeometry {
  const seg = new THREE.CylinderGeometry(0.026, 0.036, 0.15, 5);
  const frond = new THREE.BoxGeometry(0.3, 0.012, 0.075);
  const nut = new THREE.IcosahedronGeometry(0.03, 0);
  const parts: TexturedPart[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const lean = 0.12 + i * 0.05;
    parts.push({
      geometry: seg,
      colorHex: i % 2 === 0 ? 0x9a7348 : 0x86603c,
      position: [x, y + 0.075, 0],
      rotation: [0, 0, -lean],
      scale: [1 - i * 0.07, 1, 1 - i * 0.07],
      forceWhiteUv: true,
    });
    x += Math.sin(lean) * 0.15;
    y += Math.cos(lean) * 0.15;
  }
  const crownY = y + 0.02;
  const greens = [0x3fae4f, 0x58c25a, 0x2f9a47];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    parts.push({
      geometry: frond,
      colorHex: greens[k % greens.length],
      position: [x + Math.cos(a) * 0.14, crownY - 0.015, Math.sin(a) * 0.14],
      rotation: [0, -a, -0.38],
      forceWhiteUv: true,
    });
  }
  parts.push(
    { geometry: nut, colorHex: 0x6b4a2c, position: [x + 0.03, crownY - 0.035, 0.02], forceWhiteUv: true },
    { geometry: nut, colorHex: 0x5a3d24, position: [x - 0.025, crownY - 0.03, -0.03], forceWhiteUv: true },
    {
      geometry: frond,
      colorHex: greens[1],
      position: [x, crownY + 0.02, 0],
      rotation: [0, 0.4, 0.55],
      scale: [0.6, 1, 0.9],
      forceWhiteUv: true,
    },
  );
  return finish(parts, [seg, frond, nut]);
}

/**
 * Broadleaf with near-white crowns so per-instance tints (autumn oranges / blossom pinks) fully decide
 * the foliage colour. `crownScale` adjusts the silhouette between round (1) and tall (>1).
 */
export function createTintableBroadleafGeometry(crownScale = 1): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.05, 0.075, 0.4, 6);
  const crown = new THREE.IcosahedronGeometry(1, 0);
  const parts: TexturedPart[] = [
    { geometry: trunk, colorHex: 0xb98a6a, position: [0, 0.2, 0], forceWhiteUv: true },
    {
      geometry: crown,
      colorHex: 0xffffff,
      position: [0, 0.54, 0],
      rotation: [0.1, 0.4, 0],
      scale: [0.28, 0.24 * crownScale, 0.28],
      forceWhiteUv: true,
    },
    {
      geometry: crown,
      colorHex: 0xe8e8e8,
      position: [0.11, 0.47, -0.08],
      rotation: [-0.1, 1.2, 0.1],
      scale: [0.19, 0.17, 0.19],
      forceWhiteUv: true,
    },
    {
      geometry: crown,
      colorHex: 0xf4f4f4,
      position: [-0.1, 0.46, 0.09],
      rotation: [0.1, 2.2, -0.1],
      scale: [0.17, 0.15, 0.17],
      forceWhiteUv: true,
    },
  ];
  return finish(parts, [trunk, crown]);
}
