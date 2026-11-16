import * as THREE from 'three';
import type { TowerType } from '../core/types.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import { mergeTexturedParts, type TexturedPart } from './geometryHelpers.ts';
import type { KenneyAssetStore, KenneyModelName } from './kenneyAssets.ts';
import { remapUvCell } from './kenneyPalette.ts';

export interface TowerTierGeometryPair {
  readonly base: THREE.BufferGeometry;
  readonly turret: THREE.BufferGeometry;
  readonly turretAnchorY: number;
  readonly idleSpinTurret: boolean;
  readonly bobTurret: boolean;
}

/**
 * Assembles modular 5x3 tower geometries from preloaded Kenney Tower Defense Kit GLBs
 * plus minimal geometric accents (such as brass Tesla coils and stone plinths), keeping
 * the static base and rotating turret split for the existing InstancedMesh pipeline.
 */
export class TowerGeometryCache {
  private readonly cache = new Map<string, TowerTierGeometryPair>();
  private readonly assets: KenneyAssetStore;

  constructor(assets: KenneyAssetStore) {
    this.assets = assets;
  }

  get(type: TowerType, tier: 1 | 2 | 3): TowerTierGeometryPair {
    const key = `${type}_${tier}`;
    let pair = this.cache.get(key);
    if (!pair) {
      pair = this.buildPair(type, tier);
      this.cache.set(key, pair);
    }
    return pair;
  }

  private buildPair(type: TowerType, tier: 1 | 2 | 3): TowerTierGeometryPair {
    const disposable: THREE.BufferGeometry[] = [];
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
    const torus = new THREE.TorusGeometry(1, 0.24, 6, 12);
    const oct = new THREE.OctahedronGeometry(1, 0);
    disposable.push(box, cyl, torus, oct);

    const grab = (
      name: KenneyModelName,
      uvRemaps?: ReadonlyArray<readonly [readonly [number, number], readonly [number, number]]>,
    ): THREE.BufferGeometry => {
      const g = this.assets.cloneGeometry(name);
      if (uvRemaps) {
        for (let i = 0; i < uvRemaps.length; i++) {
          remapUvCell(g, uvRemaps[i][0], uvRemaps[i][1]);
        }
      }
      disposable.push(g);
      return g;
    };

    const baseParts: TexturedPart[] = [];
    const turretParts: TexturedPart[] = [];
    let turretAnchorY: number;
    let idleSpinTurret = false;
    let bobTurret = false;

    switch (type) {
      case 'archer': {
        if (tier === 1) {
          turretAnchorY = 0.94;
          baseParts.push(
            { geometry: grab('wood-structure'), position: [0, 0, 0], scale: [1.14, 1.32, 1.14] },
            { geometry: grab('tower-round-base'), position: [0, 0.6, 0], scale: [1.16, 0.9, 1.16] },
            { geometry: grab('tower-round-top-a'), position: [0, 0.76, 0], scale: [1.06, 0.84, 1.06] },
            { geometry: cyl, colorHex: PALETTE_HEX.sand, position: [0, 0.85, 0], scale: [0.38, 0.18, 0.38], forceWhiteUv: true },
          );
          turretParts.push({
            geometry: grab('weapon-ballista'),
            position: [0, 0, 0],
            scale: [1.28, 1.28, 1.28],
          });
        } else if (tier === 2) {
          turretAnchorY = 1.08;
          baseParts.push(
            { geometry: grab('tower-round-base'), position: [0, 0, 0], scale: [1.38, 1.0, 1.38] },
            { geometry: grab('tower-round-bottom-a'), position: [0, 0.16, 0], scale: [1.3, 1.14, 1.3] },
            { geometry: grab('tower-round-top-b'), position: [0, 0.84, 0], scale: [1.26, 0.92, 1.26] },
            { geometry: cyl, colorHex: PALETTE_HEX.sand, position: [0, 0.96, 0], scale: [0.46, 0.24, 0.46], forceWhiteUv: true },
          );
          turretParts.push({
            geometry: grab('weapon-ballista'),
            colorHex: 0xfff5e4,
            position: [0, 0, 0],
            scale: [1.46, 1.46, 1.46],
          });
        } else {
          turretAnchorY = 1.68;
          baseParts.push(
            { geometry: grab('tower-round-base'), position: [0, 0, 0], scale: [1.56, 1.12, 1.56] },
            { geometry: grab('tower-round-bottom-b'), position: [0, 0.18, 0], scale: [1.48, 1.16, 1.48] },
            { geometry: grab('tower-round-middle-a'), position: [0, 0.87, 0], scale: [1.4, 1.06, 1.4] },
            { geometry: grab('tower-round-top-b'), position: [0, 1.5, 0], scale: [1.36, 0.88, 1.36] },
            { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 1.59, 0], scale: [0.5, 0.18, 0.5], forceWhiteUv: true },
          );
          turretParts.push(
            { geometry: grab('weapon-ballista'), position: [0, 0, 0], scale: [1.66, 1.66, 1.66] },
            { geometry: box, colorHex: PALETTE_HEX.gold, position: [0, 0.28, 0.34], scale: [0.74, 0.09, 0.12], forceWhiteUv: true },
          );
        }
        break;
      }

      case 'cannon': {
        if (tier === 1) {
          turretAnchorY = 0.72;
          baseParts.push(
            { geometry: grab('tower-round-base'), position: [0, 0, 0], scale: [1.36, 1.0, 1.36] },
            { geometry: grab('tower-round-bottom-c'), position: [0, 0.15, 0], scale: [1.3, 0.96, 1.3] },
          );
          turretParts.push(
            { geometry: grab('weapon-cannon'), position: [0, 0, 0], scale: [1.42, 1.42, 1.42] },
            { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 0.06, -0.02], scale: [0.34, 0.1, 0.34], forceWhiteUv: true },
          );
        } else if (tier === 2) {
          turretAnchorY = 1.32;
          baseParts.push(
            { geometry: grab('tower-round-base'), position: [0, 0, 0], scale: [1.5, 1.05, 1.5] },
            { geometry: grab('tower-round-bottom-c'), position: [0, 0.16, 0], scale: [1.44, 1.02, 1.44] },
            { geometry: grab('tower-round-middle-c'), position: [0, 0.77, 0], scale: [1.36, 0.92, 1.36] },
          );
          turretParts.push(
            { geometry: grab('weapon-cannon'), position: [0, 0, 0], scale: [1.66, 1.66, 1.66] },
            { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 0.07, -0.02], scale: [0.42, 0.13, 0.42], forceWhiteUv: true },
          );
        } else {
          turretAnchorY = 1.62;
          baseParts.push(
            {
              geometry: grab('tower-square-bottom-a', [[[1, 1], [3, 3]]]),
              position: [0, 0, 0],
              scale: [1.58, 0.9, 1.58],
            },
            { geometry: grab('tower-round-bottom-c'), position: [0, 0.44, 0], scale: [1.44, 0.96, 1.44] },
            { geometry: grab('tower-round-middle-b'), position: [0, 1.01, 0], scale: [1.38, 1.02, 1.38] },
          );
          const cannonGeo = grab('weapon-cannon');
          turretParts.push(
            { geometry: cannonGeo, position: [-0.22, 0, 0.03], scale: [1.34, 1.38, 1.46] },
            { geometry: cannonGeo, position: [0.22, 0, 0.03], scale: [1.34, 1.38, 1.46] },
            { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 0.08, -0.05], scale: [0.46, 0.16, 0.46], forceWhiteUv: true },
          );
        }
        break;
      }

      case 'frost': {
        idleSpinTurret = true;
        bobTurret = true;
        const frostBase = (name: KenneyModelName) =>
          grab(name, [
            [[6, 2], [0, 1]],
            [[1, 1], [7, 2]],
            [[2, 1], [0, 3]],
            [[3, 2], [0, 1]],
          ]);
        const frostShard = grab('detail-crystal-large', [
          [[2, 1], [0, 3]],
          [[3, 2], [0, 1]],
        ]);
        const frostMini = grab('detail-crystal', [
          [[2, 1], [0, 3]],
          [[3, 2], [0, 1]],
        ]);

        if (tier === 1) {
          turretAnchorY = 1.32;
          baseParts.push(
            { geometry: frostBase('tower-round-base'), colorHex: 0xeaf8ff, position: [0, 0, 0], scale: [1.3, 1.0, 1.3] },
            { geometry: frostBase('tower-round-bottom-a'), colorHex: 0xeaf8ff, position: [0, 0.16, 0], scale: [1.18, 0.96, 1.18] },
            { geometry: frostBase('tower-round-crystals'), colorHex: 0xf4fcff, position: [0, 0.72, 0], scale: [1.16, 1.16, 1.16] },
          );
          turretParts.push({
            geometry: frostShard,
            colorHex: 0xdff8ff,
            position: [0, -0.26, 0],
            scale: [1.08, 1.18, 1.08],
          });
        } else if (tier === 2) {
          turretAnchorY = 1.66;
          baseParts.push(
            { geometry: frostBase('tower-square-bottom-b'), colorHex: 0xeaf8ff, position: [0, 0, 0], scale: [1.4, 1.08, 1.4] },
            { geometry: frostBase('tower-square-middle-c'), colorHex: 0xeaf8ff, position: [0, 0.53, 0], scale: [1.3, 1.04, 1.3] },
            { geometry: frostBase('tower-round-crystals'), colorHex: 0xf4fcff, position: [0, 1.03, 0], scale: [1.32, 1.32, 1.32] },
          );
          turretParts.push(
            { geometry: frostShard, colorHex: 0xdff8ff, position: [0, -0.32, 0], scale: [1.26, 1.38, 1.26] },
            { geometry: frostMini, colorHex: 0xccf4ff, position: [-0.36, -0.14, 0], rotation: [0, 0, 0.35], scale: [1.0, 1.05, 1.0] },
            { geometry: frostMini, colorHex: 0xccf4ff, position: [0.36, -0.14, 0], rotation: [0, 0, -0.35], scale: [1.0, 1.05, 1.0] },
          );
        } else {
          turretAnchorY = 2.08;
          baseParts.push(
            { geometry: frostBase('tower-square-bottom-b'), colorHex: 0xeaf8ff, position: [0, 0, 0], scale: [1.58, 1.2, 1.58] },
            { geometry: frostBase('tower-square-middle-a'), colorHex: 0xeaf8ff, position: [0, 0.59, 0], scale: [1.44, 1.1, 1.44] },
            { geometry: frostBase('tower-square-top-b'), colorHex: 0xeaf8ff, position: [0, 1.14, 0], scale: [1.36, 0.92, 1.36] },
            { geometry: frostBase('tower-round-crystals'), colorHex: 0xf4fcff, position: [0, 1.38, 0], scale: [1.34, 1.34, 1.34] },
          );
          turretParts.push({
            geometry: frostShard,
            colorHex: 0xdff8ff,
            position: [0, -0.36, 0],
            scale: [1.45, 1.58, 1.45],
          });
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            turretParts.push({
              geometry: frostMini,
              colorHex: 0xccf4ff,
              position: [Math.cos(a) * 0.42, -0.1, Math.sin(a) * 0.42],
              rotation: [Math.sin(a) * 0.32, a, -Math.cos(a) * 0.32],
              scale: [1.08, 1.15, 1.08],
            });
          }
        }
        break;
      }

      case 'tesla': {
        const teslaSquare = (name: KenneyModelName) =>
          grab(name, [[[1, 1], [7, 2]]]);
        const copperHex = 0xd98a3a;
        const coilCyan = 0x8ef1ff;

        if (tier === 1) {
          turretAnchorY = 0.88;
          baseParts.push(
            { geometry: teslaSquare('tower-square-bottom-c'), position: [0, 0, 0], scale: [1.34, 1.1, 1.34] },
            { geometry: teslaSquare('tower-square-top-c'), position: [0, 0.54, 0], scale: [1.24, 0.9, 1.24] },
            { geometry: cyl, colorHex: PALETTE_HEX.indigo, position: [0, 0.78, 0], scale: [0.36, 0.16, 0.36], forceWhiteUv: true },
          );
          turretParts.push(
            { geometry: cyl, colorHex: PALETTE_HEX.indigo, position: [0, 0.08, 0], scale: [0.24, 0.16, 0.24], forceWhiteUv: true },
            { geometry: cyl, colorHex: copperHex, position: [0, 0.36, 0], scale: [0.1, 0.52, 0.1], forceWhiteUv: true },
            { geometry: torus, colorHex: PALETTE_HEX.gold, position: [0, 0.28, 0], rotation: [Math.PI / 2, 0, 0], scale: [0.24, 0.24, 0.24], forceWhiteUv: true },
            { geometry: torus, colorHex: PALETTE_HEX.gold, position: [0, 0.48, 0], rotation: [Math.PI / 2, 0, 0], scale: [0.19, 0.19, 0.19], forceWhiteUv: true },
            { geometry: oct, colorHex: coilCyan, position: [0, 0.68, 0], scale: [0.18, 0.2, 0.18], forceWhiteUv: true },
          );
        } else if (tier === 2) {
          turretAnchorY = 1.4;
          baseParts.push(
            { geometry: teslaSquare('tower-square-bottom-a'), position: [0, 0, 0], scale: [1.46, 1.15, 1.46] },
            { geometry: teslaSquare('tower-square-middle-b'), position: [0, 0.56, 0], scale: [1.38, 1.08, 1.38] },
            { geometry: teslaSquare('tower-square-top-c'), position: [0, 1.09, 0], scale: [1.28, 0.92, 1.28] },
            { geometry: cyl, colorHex: PALETTE_HEX.indigo, position: [0, 1.3, 0], scale: [0.42, 0.18, 0.42], forceWhiteUv: true },
          );
          turretParts.push(
            { geometry: cyl, colorHex: PALETTE_HEX.indigo, position: [0, 0.1, 0], scale: [0.28, 0.2, 0.28], forceWhiteUv: true },
            { geometry: cyl, colorHex: copperHex, position: [0, 0.44, 0], scale: [0.12, 0.68, 0.12], forceWhiteUv: true },
            { geometry: torus, colorHex: PALETTE_HEX.gold, position: [0, 0.3, 0], rotation: [Math.PI / 2, 0, 0], scale: [0.3, 0.3, 0.3], forceWhiteUv: true },
            { geometry: torus, colorHex: PALETTE_HEX.gold, position: [0, 0.5, 0], rotation: [Math.PI / 2, 0, 0], scale: [0.25, 0.25, 0.25], forceWhiteUv: true },
            { geometry: torus, colorHex: coilCyan, position: [0, 0.68, 0], rotation: [Math.PI / 2, 0, 0], scale: [0.19, 0.19, 0.19], forceWhiteUv: true },
            { geometry: box, colorHex: PALETTE_HEX.gold, position: [-0.24, 0.62, 0], rotation: [0, 0, 0.45], scale: [0.06, 0.24, 0.06], forceWhiteUv: true },
            { geometry: box, colorHex: PALETTE_HEX.gold, position: [0.24, 0.62, 0], rotation: [0, 0, -0.45], scale: [0.06, 0.24, 0.06], forceWhiteUv: true },
            { geometry: oct, colorHex: 0xc2f6ff, position: [0, 0.88, 0], scale: [0.21, 0.24, 0.21], forceWhiteUv: true },
          );
        } else {
          turretAnchorY = 1.72;
          const spireCollar = grab('tower-round-crystals', [
            [[2, 1], [4, 2]],
            [[3, 3], [7, 2]],
          ]);
          baseParts.push(
            { geometry: teslaSquare('tower-square-bottom-c'), position: [0, 0, 0], scale: [1.62, 1.18, 1.62] },
            { geometry: teslaSquare('tower-square-middle-a'), position: [0, 0.58, 0], scale: [1.5, 1.12, 1.5] },
            { geometry: teslaSquare('tower-square-top-a'), position: [0, 1.13, 0], scale: [1.4, 0.98, 1.4] },
            { geometry: spireCollar, position: [0, 1.42, 0], scale: [1.26, 1.26, 1.26] },
          );
          turretParts.push(
            { geometry: cyl, colorHex: PALETTE_HEX.indigo, position: [0, 0.1, 0], scale: [0.32, 0.22, 0.32], forceWhiteUv: true },
            { geometry: cyl, colorHex: copperHex, position: [0, 0.5, 0], scale: [0.14, 0.82, 0.14], forceWhiteUv: true },
            { geometry: torus, colorHex: PALETTE_HEX.gold, position: [0, 0.3, 0], rotation: [Math.PI / 2, 0, 0], scale: [0.35, 0.35, 0.35], forceWhiteUv: true },
            { geometry: torus, colorHex: PALETTE_HEX.gold, position: [0, 0.5, 0], rotation: [Math.PI / 2, 0, 0], scale: [0.29, 0.29, 0.29], forceWhiteUv: true },
            { geometry: torus, colorHex: coilCyan, position: [0, 0.68, 0], rotation: [Math.PI / 2, 0, 0], scale: [0.24, 0.24, 0.24], forceWhiteUv: true },
            { geometry: box, colorHex: PALETTE_HEX.gold, position: [-0.3, 0.72, 0], rotation: [0, 0, 0.42], scale: [0.07, 0.3, 0.07], forceWhiteUv: true },
            { geometry: box, colorHex: PALETTE_HEX.gold, position: [0.3, 0.72, 0], rotation: [0, 0, -0.42], scale: [0.07, 0.3, 0.07], forceWhiteUv: true },
            { geometry: box, colorHex: PALETTE_HEX.gold, position: [0, 0.72, -0.3], rotation: [-0.42, 0, 0], scale: [0.07, 0.3, 0.07], forceWhiteUv: true },
            { geometry: box, colorHex: PALETTE_HEX.gold, position: [0, 0.72, 0.3], rotation: [0.42, 0, 0], scale: [0.07, 0.3, 0.07], forceWhiteUv: true },
            { geometry: oct, colorHex: 0xdffaff, position: [0, 0.96, 0], scale: [0.25, 0.28, 0.25], forceWhiteUv: true },
          );
        }
        break;
      }

      case 'ballista': {
        const bolt = (z: number, len: number, y = 0.2) => [
          { geometry: box, colorHex: PALETTE_HEX.sand, position: [0, y, z] as [number, number, number], scale: [0.07, 0.07, len] as [number, number, number], forceWhiteUv: true },
          { geometry: oct, colorHex: PALETTE_HEX.coral, position: [0, y, z + len * 0.5 + 0.06] as [number, number, number], scale: [0.09, 0.09, 0.2] as [number, number, number], forceWhiteUv: true },
        ];
        if (tier === 1) {
          turretAnchorY = 0.94;
          baseParts.push(
            { geometry: grab('tower-square-bottom-b'), position: [0, 0, 0], scale: [1.38, 1.02, 1.38] },
            { geometry: grab('tower-square-top-b'), position: [0, 0.52, 0], scale: [1.3, 0.84, 1.3] },
          );
          turretParts.push(
            { geometry: grab('weapon-ballista'), position: [0, 0, 0], scale: [1.62, 1.62, 1.62] },
            ...bolt(0.1, 0.8),
          );
        } else if (tier === 2) {
          turretAnchorY = 1.47;
          baseParts.push(
            { geometry: grab('tower-square-bottom-b'), position: [0, 0, 0], scale: [1.46, 1.08, 1.46] },
            { geometry: grab('tower-square-middle-b'), position: [0, 0.55, 0], scale: [1.38, 1.0, 1.38] },
            { geometry: grab('tower-square-top-b'), position: [0, 1.04, 0], scale: [1.32, 0.86, 1.32] },
          );
          turretParts.push(
            { geometry: grab('weapon-ballista'), colorHex: 0xfff5e4, position: [0, 0, 0], scale: [1.76, 1.76, 1.76] },
            // Brass spyglass along the stock
            { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 0.34, -0.06], rotation: [Math.PI / 2, 0, 0], scale: [0.07, 0.5, 0.07], forceWhiteUv: true },
            ...bolt(0.12, 0.9, 0.2),
          );
        } else {
          turretAnchorY = 2.0;
          baseParts.push(
            { geometry: grab('tower-square-bottom-b'), position: [0, 0, 0], scale: [1.56, 1.14, 1.56] },
            { geometry: grab('tower-square-middle-b'), position: [0, 0.58, 0], scale: [1.48, 1.06, 1.48] },
            { geometry: grab('tower-square-middle-a'), position: [0, 1.1, 0], scale: [1.4, 1.0, 1.4] },
            { geometry: grab('tower-square-top-b'), position: [0, 1.6, 0], scale: [1.36, 0.88, 1.36] },
            { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 1.72, 0], scale: [0.5, 0.14, 0.5], forceWhiteUv: true },
          );
          turretParts.push(
            { geometry: grab('weapon-ballista'), position: [0, 0, 0], scale: [1.92, 1.92, 1.92] },
            { geometry: grab('weapon-ballista'), position: [0, 0.34, -0.1], scale: [1.4, 1.1, 1.4] },
            { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 0.46, -0.1], rotation: [Math.PI / 2, 0, 0], scale: [0.08, 0.58, 0.08], forceWhiteUv: true },
            ...bolt(0.14, 1.0, 0.2),
          );
        }
        break;
      }

      case 'beacon': {
        idleSpinTurret = true;
        bobTurret = true;
        const lantern = PALETTE_HEX.gold;
        const glow = 0xfff0b8;
        if (tier === 1) {
          turretAnchorY = 1.12;
          baseParts.push(
            { geometry: grab('tower-round-base'), position: [0, 0, 0], scale: [1.26, 0.96, 1.26] },
            { geometry: grab('tower-round-bottom-b'), position: [0, 0.15, 0], scale: [1.16, 0.92, 1.16] },
            { geometry: cyl, colorHex: PALETTE_HEX.stone, position: [0, 0.78, 0], scale: [0.22, 0.4, 0.22], forceWhiteUv: true },
          );
          turretParts.push(
            { geometry: oct, colorHex: lantern, position: [0, 0.18, 0], scale: [0.3, 0.38, 0.3], forceWhiteUv: true },
            { geometry: oct, colorHex: glow, position: [0, 0.18, 0], scale: [0.16, 0.2, 0.16], forceWhiteUv: true },
            { geometry: torus, colorHex: PALETTE_HEX.water, position: [0, 0.18, 0], rotation: [Math.PI / 2, 0, 0], scale: [0.34, 0.34, 0.34], forceWhiteUv: true },
          );
        } else if (tier === 2) {
          turretAnchorY = 1.5;
          baseParts.push(
            { geometry: grab('tower-round-base'), position: [0, 0, 0], scale: [1.38, 1.0, 1.38] },
            { geometry: grab('tower-round-bottom-b'), position: [0, 0.16, 0], scale: [1.3, 1.04, 1.3] },
            { geometry: grab('tower-round-middle-a'), position: [0, 0.78, 0], scale: [1.18, 0.9, 1.18] },
            { geometry: cyl, colorHex: PALETTE_HEX.stone, position: [0, 1.14, 0], scale: [0.2, 0.34, 0.2], forceWhiteUv: true },
          );
          turretParts.push(
            { geometry: oct, colorHex: lantern, position: [0, 0.2, 0], scale: [0.36, 0.46, 0.36], forceWhiteUv: true },
            { geometry: oct, colorHex: glow, position: [0, 0.2, 0], scale: [0.2, 0.26, 0.2], forceWhiteUv: true },
            { geometry: torus, colorHex: PALETTE_HEX.water, position: [0, 0.2, 0], rotation: [Math.PI / 2, 0, 0], scale: [0.44, 0.44, 0.44], forceWhiteUv: true },
            { geometry: torus, colorHex: PALETTE_HEX.gold, position: [0, 0.2, 0], rotation: [Math.PI / 2.8, 0.6, 0], scale: [0.56, 0.56, 0.56], forceWhiteUv: true },
          );
        } else {
          turretAnchorY = 2.0;
          baseParts.push(
            { geometry: grab('tower-round-base'), position: [0, 0, 0], scale: [1.5, 1.04, 1.5] },
            { geometry: grab('tower-round-bottom-b'), position: [0, 0.17, 0], scale: [1.42, 1.1, 1.42] },
            { geometry: grab('tower-round-middle-a'), position: [0, 0.84, 0], scale: [1.32, 1.0, 1.32] },
            { geometry: grab('tower-round-top-b'), position: [0, 1.36, 0], scale: [1.18, 0.82, 1.18] },
            { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 1.5, 0], scale: [0.34, 0.12, 0.34], forceWhiteUv: true },
          );
          turretParts.push(
            { geometry: oct, colorHex: lantern, position: [0, 0.22, 0], scale: [0.44, 0.58, 0.44], forceWhiteUv: true },
            { geometry: oct, colorHex: glow, position: [0, 0.22, 0], scale: [0.25, 0.34, 0.25], forceWhiteUv: true },
            { geometry: torus, colorHex: PALETTE_HEX.water, position: [0, 0.22, 0], rotation: [Math.PI / 2, 0, 0], scale: [0.54, 0.54, 0.54], forceWhiteUv: true },
            { geometry: torus, colorHex: PALETTE_HEX.gold, position: [0, 0.22, 0], rotation: [Math.PI / 2.8, 0.6, 0], scale: [0.68, 0.68, 0.68], forceWhiteUv: true },
          );
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
            turretParts.push({
              geometry: oct,
              colorHex: glow,
              position: [Math.cos(a) * 0.62, 0.22 + (i % 2) * 0.14, Math.sin(a) * 0.62],
              scale: [0.1, 0.14, 0.1],
              forceWhiteUv: true,
            });
          }
        }
        break;
      }

      case 'mortar':
      default: {
        const mortarSquare = (name: KenneyModelName) =>
          grab(name, [[[1, 1], [6, 2]]]);
        const catapult = () => grab('weapon-catapult');

        if (tier === 1) {
          turretAnchorY = 0.47;
          baseParts.push(
            { geometry: mortarSquare('tower-square-bottom-a'), position: [0, 0, 0], scale: [1.48, 0.96, 1.48] },
          );
          turretParts.push({
            geometry: catapult(),
            position: [0, 0, 0],
            scale: [1.46, 1.46, 1.46],
          });
        } else if (tier === 2) {
          turretAnchorY = 1.0;
          baseParts.push(
            { geometry: mortarSquare('tower-square-bottom-a'), position: [0, 0, 0], scale: [1.58, 1.04, 1.58] },
            { geometry: mortarSquare('tower-square-middle-c'), position: [0, 0.51, 0], scale: [1.46, 1.0, 1.46] },
          );
          turretParts.push({
            geometry: catapult(),
            colorHex: 0xfff0e0,
            position: [0, 0, 0],
            scale: [1.66, 1.66, 1.66],
          });
        } else {
          turretAnchorY = 1.38;
          baseParts.push(
            { geometry: mortarSquare('tower-square-bottom-b'), position: [0, 0, 0], scale: [1.68, 1.1, 1.68] },
            { geometry: mortarSquare('tower-square-middle-a'), position: [0, 0.54, 0], scale: [1.56, 1.04, 1.56] },
            { geometry: mortarSquare('tower-square-top-a'), position: [0, 1.05, 0], scale: [1.48, 0.9, 1.48] },
            { geometry: box, colorHex: PALETTE_HEX.stone, position: [0, 1.24, 0], scale: [0.9, 0.3, 0.9], forceWhiteUv: true },
          );
          turretParts.push(
            { geometry: catapult(), position: [0, 0, 0], scale: [1.82, 1.82, 1.82] },
            { geometry: grab('weapon-ammo-boulder'), colorHex: PALETTE_HEX.coral, position: [0, 0.42, -0.58], scale: [1.35, 1.35, 1.35] },
          );
        }
        break;
      }
    }

    const base = mergeTexturedParts(baseParts);
    const turret = mergeTexturedParts(turretParts);

    for (let i = 0; i < disposable.length; i++) {
      disposable[i].dispose();
    }

    return { base, turret, turretAnchorY, idleSpinTurret, bobTurret };
  }

  dispose(): void {
    this.cache.forEach((pair) => {
      pair.base.dispose();
      pair.turret.dispose();
    });
    this.cache.clear();
  }
}
