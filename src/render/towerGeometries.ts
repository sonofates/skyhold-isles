import * as THREE from 'three';
import type { TowerType } from '../core/types.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import { mergeColoredParts, type ColoredPart } from './geometryHelpers.ts';

export interface TowerTierGeometryPair {
  readonly base: THREE.BufferGeometry;
  readonly turret: THREE.BufferGeometry;
  readonly turretAnchorY: number;
  readonly idleSpinTurret: boolean;
  readonly bobTurret: boolean;
}

export class TowerGeometryCache {
  private readonly cache = new Map<string, TowerTierGeometryPair>();

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
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 6);
    const cone = new THREE.ConeGeometry(1, 1, 6);
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const oct = new THREE.OctahedronGeometry(1, 0);

    let baseParts: ColoredPart[] = [];
    let turretParts: ColoredPart[] = [];
    let turretAnchorY = 1.3;
    let idleSpinTurret = false;
    let bobTurret = false;

    switch (type) {
      case 'archer': {
        turretAnchorY = tier === 1 ? 1.25 : tier === 2 ? 1.48 : 1.72;
        baseParts = [
          { geometry: box, colorHex: PALETTE_HEX.stone, position: [0, 0.14, 0], scale: [1.34, 0.28, 1.34] },
          { geometry: box, colorHex: PALETTE_HEX.dirt, position: [-0.42, 0.68, -0.42], scale: [0.18, 0.9, 0.18] },
          { geometry: box, colorHex: PALETTE_HEX.dirt, position: [0.42, 0.68, -0.42], scale: [0.18, 0.9, 0.18] },
          { geometry: box, colorHex: PALETTE_HEX.dirt, position: [-0.42, 0.68, 0.42], scale: [0.18, 0.9, 0.18] },
          { geometry: box, colorHex: PALETTE_HEX.dirt, position: [0.42, 0.68, 0.42], scale: [0.18, 0.9, 0.18] },
          { geometry: box, colorHex: PALETTE_HEX.sand, position: [0, turretAnchorY - 0.1, 0], scale: [1.14, 0.16, 1.14] },
        ];
        if (tier >= 2) {
          baseParts.push(
            { geometry: box, colorHex: PALETTE_HEX.stone, position: [0, 0.56, 0], scale: [0.96, 0.62, 0.96] },
            { geometry: box, colorHex: PALETTE_HEX.foliageDark, position: [0, turretAnchorY + 0.04, -0.52], scale: [0.92, 0.18, 0.1] },
          );
        }
        if (tier === 3) {
          baseParts.push(
            { geometry: box, colorHex: PALETTE_HEX.gold, position: [0, 0.96, 0], scale: [1.22, 0.12, 1.22] },
            { geometry: cone, colorHex: PALETTE_HEX.coral, position: [-0.52, turretAnchorY + 0.35, -0.52], scale: [0.14, 0.45, 0.14] },
          );
        }
        // Rotating crossbow / ballista turret
        turretParts = [
          { geometry: box, colorHex: PALETTE_HEX.dirt, position: [0, 0.1, 0.06], scale: [0.22, 0.18, 0.72] },
          { geometry: box, colorHex: PALETTE_HEX.indigo, position: [0, 0.12, 0.28], rotation: [0, 0.25, 0], scale: [0.85, 0.09, 0.12] },
          { geometry: cone, colorHex: PALETTE_HEX.gold, position: [0, 0.16, 0.48], rotation: [Math.PI / 2, 0, 0], scale: [0.09, 0.28, 0.09] },
        ];
        if (tier >= 2) {
          turretParts.push(
            { geometry: box, colorHex: PALETTE_HEX.gold, position: [0, 0.14, 0.26], scale: [0.96, 0.07, 0.09] },
          );
        }
        if (tier === 3) {
          turretParts.push(
            { geometry: box, colorHex: PALETTE_HEX.gold, position: [-0.14, 0.2, 0.14], scale: [0.1, 0.12, 0.64] },
            { geometry: box, colorHex: PALETTE_HEX.gold, position: [0.14, 0.2, 0.14], scale: [0.1, 0.12, 0.64] },
            { geometry: oct, colorHex: PALETTE_HEX.coral, position: [0, 0.3, -0.15], scale: [0.13, 0.13, 0.13] },
          );
        }
        break;
      }
      case 'cannon': {
        turretAnchorY = tier === 1 ? 0.72 : tier === 2 ? 0.88 : 1.02;
        baseParts = [
          { geometry: cyl, colorHex: PALETTE_HEX.stone, position: [0, 0.34, 0], scale: [0.76, 0.68, 0.76] },
          { geometry: cyl, colorHex: PALETTE_HEX.indigo, position: [0, 0.68, 0], scale: [0.64, 0.1, 0.64] },
        ];
        if (tier >= 2) {
          baseParts.push(
            { geometry: box, colorHex: PALETTE_HEX.stone, position: [0, 0.42, 0], scale: [1.38, 0.42, 1.38] },
            { geometry: ico, colorHex: PALETTE_HEX.indigo, position: [0.56, 0.7, 0.42], scale: [0.14, 0.14, 0.14] },
            { geometry: ico, colorHex: PALETTE_HEX.indigo, position: [0.38, 0.7, 0.54], scale: [0.14, 0.14, 0.14] },
          );
        }
        if (tier === 3) {
          baseParts.push(
            { geometry: box, colorHex: PALETTE_HEX.gold, position: [0, 0.66, 0], scale: [1.26, 0.12, 1.26] },
            { geometry: box, colorHex: PALETTE_HEX.indigo, position: [-0.66, 0.45, -0.66], scale: [0.22, 0.7, 0.22] },
            { geometry: box, colorHex: PALETTE_HEX.indigo, position: [0.66, 0.45, 0.66], scale: [0.22, 0.7, 0.22] },
          );
        }
        turretParts = [
          { geometry: box, colorHex: PALETTE_HEX.dirt, position: [0, 0.14, 0], scale: [0.58, 0.28, 0.64] },
          { geometry: cyl, colorHex: PALETTE_HEX.indigo, position: [0, 0.28, 0.28], rotation: [Math.PI / 2 - 0.15, 0, 0], scale: [0.22, 0.92, 0.22] },
          { geometry: cyl, colorHex: PALETTE_HEX.stone, position: [0, 0.35, 0.66], rotation: [Math.PI / 2 - 0.15, 0, 0], scale: [0.26, 0.14, 0.26] },
        ];
        if (tier >= 2) {
          turretParts.push(
            { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 0.32, 0.48], rotation: [Math.PI / 2 - 0.15, 0, 0], scale: [0.25, 0.12, 0.25] },
          );
        }
        if (tier === 3) {
          turretParts.push(
            { geometry: cyl, colorHex: PALETTE_HEX.indigo, position: [-0.22, 0.28, 0.34], rotation: [Math.PI / 2 - 0.15, 0, 0], scale: [0.16, 0.95, 0.16] },
            { geometry: cyl, colorHex: PALETTE_HEX.indigo, position: [0.22, 0.28, 0.34], rotation: [Math.PI / 2 - 0.15, 0, 0], scale: [0.16, 0.95, 0.16] },
            { geometry: ico, colorHex: PALETTE_HEX.coral, position: [0, 0.42, -0.26], scale: [0.16, 0.16, 0.16] },
          );
        }
        break;
      }
      case 'frost': {
        turretAnchorY = tier === 1 ? 1.15 : tier === 2 ? 1.35 : 1.55;
        idleSpinTurret = true;
        bobTurret = true;
        baseParts = [
          { geometry: cyl, colorHex: PALETTE_HEX.stone, position: [0, 0.2, 0], scale: [0.74, 0.4, 0.74] },
          { geometry: cyl, colorHex: PALETTE_HEX.cream, position: [0, 0.58, 0], scale: [0.46, 0.44, 0.46] },
        ];
        if (tier >= 2) {
          baseParts.push(
            { geometry: cone, colorHex: PALETTE_HEX.water, position: [-0.52, 0.56, 0], scale: [0.18, 0.56, 0.18] },
            { geometry: cone, colorHex: PALETTE_HEX.water, position: [0.52, 0.56, 0], scale: [0.18, 0.56, 0.18] },
          );
        }
        if (tier === 3) {
          baseParts.push(
            { geometry: cone, colorHex: PALETTE_HEX.cream, position: [0, 0.62, -0.54], scale: [0.2, 0.68, 0.2] },
            { geometry: cone, colorHex: PALETTE_HEX.cream, position: [0, 0.62, 0.54], scale: [0.2, 0.68, 0.2] },
            { geometry: cyl, colorHex: PALETTE_HEX.water, position: [0, 0.88, 0], scale: [0.58, 0.1, 0.58] },
          );
        }
        turretParts = [
          { geometry: oct, colorHex: PALETTE_HEX.water, position: [0, 0.25, 0], scale: [0.34, 0.55, 0.34] },
          { geometry: oct, colorHex: PALETTE_HEX.cream, position: [0, 0.25, 0], rotation: [0, Math.PI / 4, 0], scale: [0.24, 0.62, 0.24] },
        ];
        if (tier >= 2) {
          turretParts.push(
            { geometry: oct, colorHex: PALETTE_HEX.cream, position: [-0.46, 0.15, 0], scale: [0.14, 0.24, 0.14] },
            { geometry: oct, colorHex: PALETTE_HEX.cream, position: [0.46, 0.15, 0], scale: [0.14, 0.24, 0.14] },
          );
        }
        if (tier === 3) {
          turretParts.push(
            { geometry: oct, colorHex: PALETTE_HEX.water, position: [0, 0.15, 0.48], scale: [0.15, 0.26, 0.15] },
            { geometry: oct, colorHex: PALETTE_HEX.water, position: [0, 0.15, -0.48], scale: [0.15, 0.26, 0.15] },
          );
        }
        break;
      }
      case 'tesla': {
        turretAnchorY = tier === 1 ? 1.2 : tier === 2 ? 1.48 : 1.72;
        idleSpinTurret = true;
        baseParts = [
          { geometry: box, colorHex: PALETTE_HEX.indigo, position: [0, 0.2, 0], scale: [1.34, 0.4, 1.34] },
          { geometry: cyl, colorHex: PALETTE_HEX.stone, position: [0, 0.62, 0], scale: [0.42, 0.48, 0.42] },
          { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 0.96, 0], scale: [0.54, 0.14, 0.54] },
        ];
        if (tier >= 2) {
          baseParts.push(
            { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 1.2, 0], scale: [0.48, 0.12, 0.48] },
            { geometry: cyl, colorHex: PALETTE_HEX.indigo, position: [-0.46, 0.8, 0], scale: [0.1, 0.85, 0.1] },
            { geometry: cyl, colorHex: PALETTE_HEX.indigo, position: [0.46, 0.8, 0], scale: [0.1, 0.85, 0.1] },
          );
        }
        if (tier === 3) {
          baseParts.push(
            { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 1.44, 0], scale: [0.42, 0.12, 0.42] },
            { geometry: cyl, colorHex: PALETTE_HEX.indigo, position: [0, 0.95, 0.48], scale: [0.11, 1.1, 0.11] },
            { geometry: cyl, colorHex: PALETTE_HEX.indigo, position: [0, 0.95, -0.48], scale: [0.11, 1.1, 0.11] },
          );
        }
        turretParts = [
          { geometry: ico, colorHex: PALETTE_HEX.water, position: [0, 0.28, 0], scale: [0.28, 0.28, 0.28] },
          { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 0.04, 0], scale: [0.36, 0.08, 0.36] },
        ];
        if (tier >= 2) {
          turretParts.push(
            { geometry: cone, colorHex: PALETTE_HEX.gold, position: [-0.3, 0.28, 0], rotation: [0, 0, 0.35], scale: [0.09, 0.34, 0.09] },
            { geometry: cone, colorHex: PALETTE_HEX.gold, position: [0.3, 0.28, 0], rotation: [0, 0, -0.35], scale: [0.09, 0.34, 0.09] },
          );
        }
        if (tier === 3) {
          turretParts.push(
            { geometry: oct, colorHex: PALETTE_HEX.cream, position: [0, 0.62, 0], scale: [0.18, 0.24, 0.18] },
          );
        }
        break;
      }
      case 'mortar': {
        turretAnchorY = tier === 1 ? 0.62 : tier === 2 ? 0.78 : 0.92;
        baseParts = [
          { geometry: box, colorHex: PALETTE_HEX.stone, position: [0, 0.28, 0], scale: [1.56, 0.56, 1.56] },
          { geometry: box, colorHex: PALETTE_HEX.dirt, position: [-0.66, 0.38, -0.66], scale: [0.28, 0.68, 0.28] },
          { geometry: box, colorHex: PALETTE_HEX.dirt, position: [0.66, 0.38, -0.66], scale: [0.28, 0.68, 0.28] },
          { geometry: box, colorHex: PALETTE_HEX.dirt, position: [-0.66, 0.38, 0.66], scale: [0.28, 0.68, 0.28] },
          { geometry: box, colorHex: PALETTE_HEX.dirt, position: [0.66, 0.38, 0.66], scale: [0.28, 0.68, 0.28] },
        ];
        if (tier >= 2) {
          baseParts.push(
            { geometry: box, colorHex: PALETTE_HEX.indigo, position: [0, 0.56, 0], scale: [1.32, 0.24, 1.32] },
          );
        }
        if (tier === 3) {
          baseParts.push(
            { geometry: box, colorHex: PALETTE_HEX.gold, position: [0, 0.72, 0], scale: [1.22, 0.12, 1.22] },
            { geometry: box, colorHex: PALETTE_HEX.coral, position: [-0.68, 0.65, 0], scale: [0.16, 0.34, 0.8] },
            { geometry: box, colorHex: PALETTE_HEX.coral, position: [0.68, 0.65, 0], scale: [0.16, 0.34, 0.8] },
          );
        }
        turretParts = [
          { geometry: box, colorHex: PALETTE_HEX.dirt, position: [0, 0.16, -0.05], scale: [0.68, 0.32, 0.72] },
          { geometry: cyl, colorHex: PALETTE_HEX.indigo, position: [0, 0.44, 0.16], rotation: [0.58, 0, 0], scale: [0.34, 0.86, 0.34] },
          { geometry: cyl, colorHex: PALETTE_HEX.coral, position: [0, 0.68, 0.34], rotation: [0.58, 0, 0], scale: [0.38, 0.14, 0.38] },
        ];
        if (tier >= 2) {
          turretParts.push(
            { geometry: cyl, colorHex: PALETTE_HEX.gold, position: [0, 0.48, 0.2], rotation: [0.58, 0, 0], scale: [0.37, 0.12, 0.37] },
          );
        }
        if (tier === 3) {
          turretParts.push(
            { geometry: cyl, colorHex: PALETTE_HEX.stone, position: [0, 0.78, 0.42], rotation: [0.58, 0, 0], scale: [0.42, 0.16, 0.42] },
            { geometry: ico, colorHex: PALETTE_HEX.gold, position: [0, 0.24, -0.44], scale: [0.22, 0.22, 0.22] },
          );
        }
        break;
      }
    }

    const base = mergeColoredParts(baseParts);
    const turret = mergeColoredParts(turretParts);

    box.dispose();
    cyl.dispose();
    cone.dispose();
    ico.dispose();
    oct.dispose();

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
