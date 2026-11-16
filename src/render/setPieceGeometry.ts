import * as THREE from 'three';
import { BALANCE } from '../data/balance.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import type { TexturedPart } from './geometryHelpers.ts';
import type { KenneyAssetStore } from './kenneyAssets.ts';
import { multiplyVertexTint, remapUvCell } from './kenneyPalette.ts';
import type { SetPieceKind } from './islandThemes.ts';
import { cabin, cairn, fountain, hut, parasol, pond, stall, statue, tent } from './setPieceExtras.ts';

/**
 * Procedural low-poly set pieces in piece-local space: origin = ground centre, +Y up, front = +Z.
 * 1 tile = BALANCE.tileSize (2) units. Builders only append parts; SetPieces merges and instances them.
 */

export type AnimFamily = 'blades' | 'cloth' | 'flow' | 'boat' | 'flame';

export interface AnimInstance {
  readonly family: AnimFamily;
  /** Local transform (pivot placement) relative to the piece origin. */
  readonly local: THREE.Matrix4;
  readonly phase: number;
  readonly color?: number;
}

const STONE_LIGHT = 0xb4bbc7;
const STONE_MID = 0xa1aab8;
const STONE_DARK = 0x8b95a5;
const WOOD = 0xb98a6a;
const WOOD_DARK = 0x7b5338;
const CREAM = PALETTE_HEX.cream;
const MOSS = 0x5f9a45;

export class PieceBuilder {
  readonly main: TexturedPart[] = [];
  readonly glow: TexturedPart[] = [];
  readonly anims: AnimInstance[] = [];
  private readonly owned: THREE.BufferGeometry[] = [];
  readonly assets: KenneyAssetStore;

  constructor(assets: KenneyAssetStore) {
    this.assets = assets;
  }

  private add(
    target: TexturedPart[],
    geo: THREE.BufferGeometry,
    color: number,
    pos: readonly [number, number, number],
    rot: readonly [number, number, number] | undefined,
    scale: readonly [number, number, number] | undefined,
  ): void {
    this.owned.push(geo);
    target.push({
      geometry: geo,
      colorHex: color,
      position: [pos[0], pos[1], pos[2]],
      rotation: rot ? [rot[0], rot[1], rot[2]] : undefined,
      scale: scale ? [scale[0], scale[1], scale[2]] : undefined,
      forceWhiteUv: true,
    });
  }

  box(
    color: number,
    size: readonly [number, number, number],
    pos: readonly [number, number, number],
    rot?: readonly [number, number, number],
  ): this {
    this.add(this.main, new THREE.BoxGeometry(size[0], size[1], size[2]), color, pos, rot, undefined);
    return this;
  }

  cyl(
    color: number,
    rTop: number,
    rBot: number,
    h: number,
    pos: readonly [number, number, number],
    seg = 8,
    rot?: readonly [number, number, number],
  ): this {
    this.add(this.main, new THREE.CylinderGeometry(rTop, rBot, h, seg), color, pos, rot, undefined);
    return this;
  }

  cone(
    color: number,
    r: number,
    h: number,
    pos: readonly [number, number, number],
    seg = 6,
    rot?: readonly [number, number, number],
    scale?: readonly [number, number, number],
  ): this {
    this.add(this.main, new THREE.ConeGeometry(r, h, seg), color, pos, rot, scale);
    return this;
  }

  ico(
    color: number,
    scale: readonly [number, number, number],
    pos: readonly [number, number, number],
    rot?: readonly [number, number, number],
  ): this {
    this.add(this.main, new THREE.IcosahedronGeometry(1, 0), color, pos, rot, scale);
    return this;
  }

  octa(
    color: number,
    scale: readonly [number, number, number],
    pos: readonly [number, number, number],
    glow = false,
    rot?: readonly [number, number, number],
  ): this {
    this.add(glow ? this.glow : this.main, new THREE.OctahedronGeometry(1, 0), color, pos, rot, scale);
    return this;
  }

  /** Kenney crystal geometry (recoloured), optionally in the glowing layer. */
  crystal(
    color: number,
    cell: readonly [number, number],
    large: boolean,
    pos: readonly [number, number, number],
    rotY: number,
    scale: number,
    tilt = 0,
  ): this {
    const geo = remapUvCell(this.assets.cloneGeometry(large ? 'detail-crystal-large' : 'detail-crystal'), [2, 1], [cell[0], cell[1]]);
    multiplyVertexTint(geo, color);
    this.owned.push(geo);
    this.glow.push({
      geometry: geo,
      position: [pos[0], pos[1], pos[2]],
      rotation: [tilt, rotY, tilt * 0.6],
      scale: [scale, scale, scale],
    });
    return this;
  }

  anim(family: AnimFamily, x: number, y: number, z: number, rotY = 0, phase = 0, color?: number): this {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    this.anims.push({ family, local: m, phase, color });
    return this;
  }

  free(): void {
    for (const g of this.owned) g.dispose();
    this.owned.length = 0;
  }
}

// ---------------------------------------------------------------- pieces

function windmill(pb: PieceBuilder, variant: number): void {
  const wall = variant === 1 ? 0xe9d3a6 : 0xf3e8cc;
  const roof = variant === 1 ? PALETTE_HEX.gold : PALETTE_HEX.coral;
  pb.cyl(STONE_MID, 0.6, 0.66, 0.22, [0, 0.11, 0], 8);
  pb.cyl(wall, 0.36, 0.52, 1.45, [0, 0.945, 0], 8);
  pb.cyl(WOOD, 0.46, 0.47, 0.07, [0, 0.62, 0], 8);
  pb.cyl(WOOD, 0.41, 0.42, 0.07, [0, 1.1, 0], 8);
  pb.cone(roof, 0.47, 0.62, [0, 1.98, 0], 8);
  pb.cyl(WOOD_DARK, 0.06, 0.06, 0.12, [0, 2.34, 0], 5);
  pb.box(WOOD_DARK, [0.22, 0.38, 0.06], [0, 0.43, 0.5]);
  pb.box(0xb7d4f6, [0.12, 0.15, 0.05], [0, 1.0, 0.42]);
  pb.box(WOOD_DARK, [0.15, 0.15, 0.13], [0, 1.55, 0.4]);
  // sacks by the door
  pb.ico(0xe9d3a6, [0.1, 0.12, 0.1], [0.34, 0.2, 0.52]);
  pb.ico(0xe9d3a6, [0.09, 0.1, 0.09], [0.44, 0.16, 0.42]);
  pb.anim('blades', 0, 1.55, 0.5, 0, variant * 0.9);
}

function cottage(pb: PieceBuilder, variant: number): void {
  const roof = variant === 1 ? PALETTE_HEX.indigo : PALETTE_HEX.coral;
  pb.box(STONE_DARK, [1.18, 0.1, 0.94], [0, 0.05, 0]);
  pb.box(0xf3e8cc, [1.1, 0.62, 0.86], [0, 0.41, 0]);
  pb.cone(roof, 0.86, 0.56, [0, 1.0, 0], 4, [0, Math.PI / 4, 0], [1, 1, 0.82]);
  pb.box(STONE_LIGHT, [0.16, 0.36, 0.16], [0.34, 1.0, -0.12]);
  pb.box(WOOD_DARK, [0.2, 0.36, 0.04], [0, 0.28, 0.44]);
  pb.box(0xb7d4f6, [0.16, 0.16, 0.04], [-0.33, 0.44, 0.44]);
  pb.box(0xb7d4f6, [0.16, 0.16, 0.04], [0.33, 0.44, 0.44]);
  pb.box(WOOD, [0.22, 0.05, 0.1], [-0.33, 0.33, 0.48]);
  pb.box(WOOD, [0.22, 0.05, 0.1], [0.33, 0.33, 0.48]);
  pb.ico(PALETTE_HEX.coral, [0.05, 0.04, 0.05], [-0.38, 0.38, 0.5]);
  pb.ico(PALETTE_HEX.gold, [0.05, 0.04, 0.05], [0.3, 0.38, 0.5]);
  // picket fence + flower bed
  for (let i = 0; i < 4; i++) {
    pb.box(CREAM, [0.05, 0.2, 0.03], [-0.55 + i * 0.16, 0.11, 0.78]);
  }
  pb.box(CREAM, [0.52, 0.04, 0.03], [-0.34, 0.17, 0.78]);
  for (let i = 0; i < 3; i++) pb.box(CREAM, [0.05, 0.2, 0.03], [0.18 + i * 0.16, 0.11, 0.78]);
  pb.box(CREAM, [0.4, 0.04, 0.03], [0.34, 0.17, 0.78]);
  // haystack
  pb.cone(0xe3b84a, 0.26, 0.4, [0.82, 0.2, -0.15], 6);
}

function lighthouse(pb: PieceBuilder): void {
  const waterY = BALANCE.waterPlaneY;
  const baseTop = waterY + 0.65;
  pb.cone(0x8b95a5, 1.25, 1.5, [0, waterY - 0.15, 0], 7, [Math.PI, 0.3, 0], [1, 1, 1]);
  pb.cyl(0x9aa4b0, 1.0, 1.2, 0.8, [0, waterY + 0.25, 0], 8);
  pb.cyl(0xe9d3a6, 0.95, 1.0, 0.14, [0, baseTop - 0.03, 0], 8);
  pb.ico(0x8b95a5, [0.34, 0.2, 0.3], [0.8, waterY + 0.2, 0.5]);
  pb.ico(0xa1aab8, [0.26, 0.16, 0.26], [-0.8, waterY + 0.18, 0.4]);
  pb.ico(0x8b95a5, [0.3, 0.2, 0.28], [-0.45, waterY + 0.2, -0.85]);
  const bands = [CREAM, PALETTE_HEX.coral, CREAM, PALETTE_HEX.coral, CREAM];
  const h = 0.52;
  let y = baseTop;
  for (let i = 0; i < bands.length; i++) {
    const rBot = 0.44 - i * 0.03;
    const rTop = rBot - 0.03;
    pb.cyl(bands[i], rTop, rBot, h, [0, y + h / 2, 0], 8);
    y += h;
  }
  pb.box(WOOD_DARK, [0.2, 0.34, 0.06], [0, baseTop + 0.2, 0.43]);
  pb.cyl(PALETTE_HEX.indigo, 0.46, 0.4, 0.1, [0, y + 0.05, 0], 8);
  pb.cyl(0xfff3b0, 0.2, 0.2, 0.34, [0, y + 0.27, 0], 8);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    pb.box(PALETTE_HEX.indigo, [0.05, 0.34, 0.05], [Math.cos(a) * 0.21, y + 0.27, Math.sin(a) * 0.21]);
  }
  pb.cone(PALETTE_HEX.coral, 0.3, 0.32, [0, y + 0.6, 0], 8);
  pb.ico(PALETTE_HEX.gold, [0.06, 0.06, 0.06], [0, y + 0.8, 0]);
}

function waterfall(pb: PieceBuilder): void {
  const waterY = BALANCE.waterPlaneY;
  const blue = 0x86d6f2;
  pb.box(blue, [0.95, 0.04, 1.0], [0, 0.015, 0.5]);
  pb.box(0xc9f0fb, [0.3, 0.045, 0.75], [-0.2, 0.02, 0.45]);
  pb.ico(STONE_DARK, [0.26, 0.2, 0.24], [-0.62, 0.1, 0.3]);
  pb.ico(STONE_MID, [0.22, 0.16, 0.22], [0.62, 0.08, 0.62]);
  pb.ico(STONE_DARK, [0.2, 0.14, 0.2], [0.66, 0.08, 0.1]);
  pb.ico(STONE_LIGHT, [0.18, 0.14, 0.2], [-0.5, 0.07, 0.85]);
  const fallTop = 0.0;
  const fallBot = waterY - 0.2;
  const hh = fallTop - fallBot;
  pb.box(blue, [0.95, hh, 0.1], [0, fallTop - hh / 2, 1.04]);
  pb.box(0xb4e8fa, [0.55, hh, 0.045], [0.08, fallTop - hh / 2, 1.11]);
  pb.box(blue, [1.0, 0.08, 0.16], [0, 0.0, 1.0]);
  for (const sx of [-0.32, -0.1, 0.12, 0.34]) pb.anim('flow', sx, fallTop - 0.2, 1.15, 0, (sx + 0.4) * 1.9);
  pb.ico(CREAM, [0.8, 0.12, 0.5], [0, waterY + 0.03, 1.3]);
  pb.ico(CREAM, [0.45, 0.1, 0.3], [-0.6, waterY + 0.02, 1.5]);
  pb.ico(CREAM, [0.4, 0.1, 0.28], [0.62, waterY + 0.02, 1.46]);
}

/** Tall snow-capped mountain rising from the sea (background silhouette). */
function peak(pb: PieceBuilder, variant: number): void {
  const waterY = BALANCE.waterPlaneY;
  const k = variant === 1 ? 0.8 : 1;
  pb.cone(0x7d8798, 1.9 * k, 5.4 * k, [0, waterY + 2.3 * k, 0], 6, [0, 0.3, 0]);
  pb.cone(0x8e98a8, 1.2 * k, 3.6 * k, [1.0 * k, waterY + 1.4 * k, 0.5 * k], 5, [0, 1.0, 0]);
  pb.cone(CREAM, 0.7 * k, 1.5 * k, [0, waterY + 4.35 * k, 0], 6, [0, 0.3, 0]);
  pb.cone(CREAM, 0.38 * k, 0.8 * k, [1.0 * k, waterY + 2.6 * k, 0.5 * k], 5, [0, 1.0, 0]);
  pb.cone(0x6e7889, 0.9 * k, 2.2 * k, [-1.2 * k, waterY + 0.9 * k, -0.4 * k], 5, [0, 0.4, 0]);
  pb.ico(CREAM, [1.6 * k, 0.1, 1.3 * k], [0, waterY + 0.03, 0]);
}

/** Half-submerged stone foundation so ruins can stand in open water (variant >= 2 on water pieces). */
function plinth(pb: PieceBuilder, w: number, d: number): void {
  const waterY = BALANCE.waterPlaneY;
  pb.box(STONE_DARK, [w, 1.15, d], [0, waterY + 0.2 - 0.05, 0]);
  pb.box(STONE_MID, [w + 0.1, 0.1, d + 0.1], [0, -0.05, 0]);
  pb.ico(MOSS, [0.3, 0.05, 0.22], [w * 0.3, 0.02, d * 0.2]);
  pb.ico(CREAM, [w * 0.6, 0.07, d * 0.6], [0, waterY + 0.03, 0]);
}

function arch(pb: PieceBuilder, variant: number): void {
  if (variant >= 2) plinth(pb, 1.9, 0.9);
  const broken = variant % 2 === 1;
  for (const sx of [-1, 1]) {
    const hgt = broken && sx === 1 ? 0.95 : 1.3;
    pb.box(STONE_DARK, [0.4, 0.14, 0.4], [sx * 0.66, 0.07, 0]);
    pb.box(STONE_LIGHT, [0.28, hgt, 0.28], [sx * 0.66, 0.14 + hgt / 2, 0]);
    pb.box(STONE_MID, [0.36, 0.1, 0.36], [sx * 0.66, 0.14 + hgt + 0.05, 0]);
    pb.ico(MOSS, [0.14, 0.06, 0.14], [sx * 0.7, 0.14, 0.17]);
  }
  const segs = 7;
  for (let i = 0; i < segs; i++) {
    if (broken && (i === 4 || i === 5)) continue;
    const a = (i / (segs - 1)) * Math.PI;
    const cx = Math.cos(a) * 0.66;
    const cy = 1.54 + Math.sin(a) * 0.5;
    pb.box(i % 2 === 0 ? STONE_LIGHT : STONE_MID, [0.27, 0.26, 0.32], [cx, cy, 0], [0, 0, a + Math.PI / 2]);
  }
  if (broken) {
    pb.box(STONE_MID, [0.3, 0.2, 0.26], [0.55, 0.1, 0.55], [0, 0.5, 0.1]);
    pb.box(STONE_LIGHT, [0.24, 0.18, 0.24], [0.1, 0.09, 0.7], [0.1, -0.3, 0]);
    pb.ico(MOSS, [0.2, 0.07, 0.18], [0.1, 0.2, 0.7]);
  }
}

function ruinWall(pb: PieceBuilder, variant: number): void {
  if (variant >= 2) plinth(pb, 2.1, 0.8);
  const heights = variant % 2 === 1 ? [0.6, 1.1, 0.8, 0.45] : [0.9, 0.7, 1.05, 0.55];
  for (let i = 0; i < heights.length; i++) {
    const x = -0.72 + i * 0.48;
    pb.box(i % 2 === 0 ? STONE_LIGHT : STONE_MID, [0.46, heights[i], 0.34], [x, heights[i] / 2, 0]);
    if (i % 2 === 1) pb.box(STONE_DARK, [0.3, 0.1, 0.38], [x, heights[i] + 0.04, 0]);
  }
  pb.ico(MOSS, [0.3, 0.07, 0.2], [-0.3, 0.9, 0.02]);
  pb.ico(MOSS, [0.2, 0.06, 0.16], [0.5, 0.5, 0.1]);
  pb.box(STONE_MID, [0.26, 0.18, 0.22], [0.9, 0.09, 0.42], [0, 0.4, 0]);
}

function pillars(pb: PieceBuilder, variant: number): void {
  if (variant >= 2) plinth(pb, 1.9, 1.1);
  const specs: Array<[number, number, number]> = [
    [-0.6, 0.2, 1.3],
    [0.1, -0.2, variant % 2 === 1 ? 0.7 : 1.4],
    [0.7, 0.3, 0.9],
  ];
  for (const [x, z, hgt] of specs) {
    pb.cyl(STONE_DARK, 0.2, 0.22, 0.12, [x, 0.06, z], 8);
    pb.cyl(STONE_LIGHT, 0.15, 0.17, hgt, [x, 0.12 + hgt / 2, z], 8);
    if (hgt > 1.2) pb.cyl(STONE_MID, 0.22, 0.17, 0.12, [x, 0.12 + hgt + 0.04, z], 8);
  }
  pb.cyl(STONE_LIGHT, 0.15, 0.15, 0.4, [0.4, 0.15, 0.75], 8, [0, 0, Math.PI / 2]);
  pb.ico(MOSS, [0.25, 0.06, 0.2], [-0.2, 0.1, 0.5]);
}

function banner(pb: PieceBuilder, variant: number): void {
  const colors = [PALETTE_HEX.coral, PALETTE_HEX.indigo, PALETTE_HEX.gold, CREAM];
  pb.cyl(WOOD_DARK, 0.035, 0.045, 1.7, [0, 0.85, 0], 5);
  pb.ico(PALETTE_HEX.gold, [0.07, 0.07, 0.07], [0, 1.74, 0]);
  pb.cyl(STONE_DARK, 0.12, 0.15, 0.14, [0, 0.07, 0], 6);
  pb.box(WOOD_DARK, [0.36, 0.035, 0.035], [0.18, 1.58, 0]);
  pb.anim('cloth', 0.02, 1.5, 0, 0, variant * 1.3, colors[variant % colors.length]);
}

function crystalGrove(pb: PieceBuilder, variant: number): void {
  const col = variant === 1 ? 0xc9a0ff : 0x7dffb8;
  pb.ico(STONE_DARK, [0.5, 0.18, 0.45], [0, 0.06, 0]);
  pb.ico(STONE_MID, [0.3, 0.15, 0.28], [0.45, 0.05, 0.25]);
  pb.octa(variant === 1 ? 0xb58cf2 : 0x3fe0a0, [0.26, 0.95, 0.26], [0, 0.95, 0], true, [0.06, 0.4, 0.05]);
  pb.crystal(col, [0, 3], true, [0.38, 0.06, 0.2], 0.5, 1.5, 0.14);
  pb.crystal(col, [0, 3], true, [-0.34, 0.04, 0.12], 2.2, 1.25, -0.16);
  pb.crystal(col, [0, 3], false, [0.1, 0.05, -0.38], 1.1, 2.3, 0.2);
  pb.crystal(col, [0, 3], false, [-0.3, 0.05, -0.22], 3.4, 1.9, -0.12);
  pb.crystal(col, [0, 3], false, [0.62, 0.05, -0.1], 0.2, 1.6, 0.18);
  pb.ico(MOSS, [0.26, 0.06, 0.22], [-0.55, 0.04, 0.35]);
}

function dock(pb: PieceBuilder, variant: number): void {
  const waterY = BALANCE.waterPlaneY;
  const len = 2.6;
  for (let i = 0; i < 9; i++) {
    pb.box(i % 2 === 0 ? WOOD : 0xa9795a, [0.78, 0.05, 0.27], [0, 0.0, 0.6 + i * 0.3]);
  }
  for (const sx of [-1, 1]) {
    pb.box(WOOD_DARK, [0.06, 0.08, len], [sx * 0.4, -0.04, 0.6 + len / 2 - 0.15]);
    for (const z of [0.9, 1.9, 3.0]) {
      pb.cyl(WOOD_DARK, 0.055, 0.065, 1.35, [sx * 0.42, 0.18 + waterY * 0.5 - 0.1, z], 5);
      pb.ico(CREAM, [0.05, 0.03, 0.05], [sx * 0.42, 0.24, z]);
    }
  }
  pb.box(WOOD, [0.34, 0.3, 0.34], [-0.2, 0.19, 1.4]);
  pb.box(0xa9795a, [0.28, 0.24, 0.28], [-0.22, 0.46, 1.42], [0, 0.4, 0]);
  pb.cyl(WOOD_DARK, 0.15, 0.15, 0.32, [0.22, 0.2, 2.0], 7);
  pb.cyl(0x8b95a5, 0.155, 0.155, 0.03, [0.22, 0.12, 2.0], 7);
  pb.cyl(0x8b95a5, 0.155, 0.155, 0.03, [0.22, 0.28, 2.0], 7);
  pb.anim('boat', variant === 1 ? 1.05 : -1.05, waterY + 0.02, 2.5, variant === 1 ? 0.1 : -0.08, variant * 2);
  // coiled rope
  pb.cyl(0xe9d3a6, 0.1, 0.1, 0.05, [0.2, 0.06, 0.95], 8);
}

function boat(pb: PieceBuilder, variant: number): void {
  pb.anim('boat', 0, BALANCE.waterPlaneY + 0.02, 0, 0, variant * 2.1);
}

function seaStack(pb: PieceBuilder, variant: number): void {
  const waterY = BALANCE.waterPlaneY;
  pb.cone(0x7d8798, 0.95, 2.4, [0, waterY + 0.85, 0], 6, [0, 0.4, 0]);
  pb.cone(0x8e98a8, 0.6, 1.7, [0.35, waterY + 0.9, 0.2], 6, [0, 1.1, 0]);
  if (variant === 2) {
    pb.cyl(0x6f9a8a, 0.28, 0.34, 0.12, [-0.02, waterY + 2.0, 0], 6);
    pb.crystal(0x7dffb8, [0, 3], true, [0.0, waterY + 2.05, 0.05], 0.7, 1.7, 0.1);
    pb.crystal(0x7dffb8, [0, 3], false, [0.2, waterY + 2.05, -0.12], 2.0, 2.2, -0.14);
    pb.octa(0x3fe0a0, [0.17, 0.75, 0.17], [-0.14, waterY + 2.6, 0.02], true, [0.05, 0.4, 0.05]);
  } else {
    pb.cyl(PALETTE_HEX.grass, 0.28, 0.34, 0.12, [-0.02, waterY + 2.0, 0], 6);
    pb.ico(PALETTE_HEX.foliageDark, [0.18, 0.2, 0.18], [0.05, waterY + 2.2, 0]);
    if (variant === 1) pb.cyl(WOOD_DARK, 0.03, 0.04, 0.3, [0.05, waterY + 2.1, 0], 5);
  }
  pb.ico(CREAM, [0.9, 0.08, 0.75], [0, waterY + 0.03, 0]);
  pb.ico(0x8b95a5, [0.25, 0.18, 0.22], [0.95, waterY + 0.08, 0.3]);
}

function watchtower(pb: PieceBuilder, variant: number): void {
  const stone = variant === 1 ? 0xcfd4dd : STONE_LIGHT;
  pb.cyl(STONE_DARK, 0.56, 0.62, 0.24, [0, 0.12, 0], 8);
  pb.cyl(stone, 0.44, 0.5, 1.5, [0, 0.99, 0], 8);
  pb.cyl(STONE_MID, 0.47, 0.47, 0.06, [0, 1.0, 0], 8);
  pb.cyl(STONE_MID, 0.52, 0.46, 0.2, [0, 1.84, 0], 8);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    pb.box(stone, [0.17, 0.2, 0.17], [Math.cos(a) * 0.49, 2.04, Math.sin(a) * 0.49], [0, -a, 0]);
  }
  pb.box(PALETTE_HEX.indigo, [0.08, 0.3, 0.05], [0, 1.2, 0.46]);
  pb.box(PALETTE_HEX.indigo, [0.08, 0.3, 0.05], [0.4, 1.0, -0.2], [0, 1.9, 0]);
  pb.box(WOOD_DARK, [0.24, 0.4, 0.06], [0, 0.44, 0.52]);
  pb.cyl(WOOD_DARK, 0.025, 0.03, 0.8, [0, 2.38, 0], 5);
  const colors = [PALETTE_HEX.coral, PALETTE_HEX.indigo, PALETTE_HEX.gold];
  pb.anim('cloth', 0.02, 2.62, 0, 0, variant * 1.7, colors[variant % colors.length]);
}

function hayBales(pb: PieceBuilder): void {
  const gold = 0xe3b84a;
  const band = 0xb88a2e;
  for (const [x, z, y] of [
    [-0.42, 0.1, 0.22],
    [0.18, 0.0, 0.22],
    [-0.1, -0.4, 0.22],
    [-0.12, -0.05, 0.62],
  ] as const) {
    pb.cyl(gold, 0.23, 0.23, 0.46, [x, y, z], 8, [0, 0, Math.PI / 2]);
    pb.cyl(band, 0.235, 0.235, 0.06, [x - 0.1, y, z], 8, [0, 0, Math.PI / 2]);
    pb.cyl(band, 0.235, 0.235, 0.06, [x + 0.1, y, z], 8, [0, 0, Math.PI / 2]);
  }
  pb.cone(gold, 0.22, 0.4, [0.7, 0.2, 0.4], 6);
}

function scarecrow(pb: PieceBuilder): void {
  pb.cyl(WOOD_DARK, 0.035, 0.04, 1.2, [0, 0.6, 0], 5);
  pb.box(WOOD_DARK, [0.8, 0.05, 0.05], [0, 0.95, 0]);
  pb.box(PALETTE_HEX.coral, [0.36, 0.4, 0.2], [0, 0.85, 0]);
  pb.ico(0xe9d3a6, [0.14, 0.15, 0.14], [0, 1.2, 0]);
  pb.cone(0xe3b84a, 0.28, 0.14, [0, 1.34, 0], 8);
  pb.cone(0xc99a35, 0.15, 0.22, [0, 1.46, 0], 8);
  pb.cone(0xe3b84a, 0.06, 0.2, [-0.45, 0.9, 0], 5, [0, 0, 1.4]);
  pb.cone(0xe3b84a, 0.06, 0.2, [0.45, 0.9, 0], 5, [0, 0, -1.4]);
}

function brazier(pb: PieceBuilder): void {
  pb.cyl(STONE_DARK, 0.18, 0.22, 0.1, [0, 0.05, 0], 6);
  pb.cyl(STONE_MID, 0.05, 0.07, 0.6, [0, 0.4, 0], 6);
  pb.cyl(0x484573, 0.28, 0.16, 0.22, [0, 0.8, 0], 8);
  pb.anim('flame', 0, 0.92, 0, 0, 0);
}

function obelisk(pb: PieceBuilder): void {
  pb.box(STONE_DARK, [0.8, 0.16, 0.8], [0, 0.08, 0]);
  pb.box(STONE_MID, [0.6, 0.14, 0.6], [0, 0.23, 0]);
  pb.cone(CREAM, 0.34, 1.7, [0, 1.15, 0], 4, [0, Math.PI / 4, 0]);
  pb.cone(PALETTE_HEX.gold, 0.09, 0.22, [0, 2.1, 0], 4, [0, Math.PI / 4, 0]);
  pb.box(PALETTE_HEX.gold, [0.48, 0.04, 0.48], [0, 0.34, 0], [0, 0.78, 0]);
}

function gatehouse(pb: PieceBuilder, variant: number): void {
  for (const sx of [-1, 1]) {
    pb.cyl(STONE_DARK, 0.5, 0.56, 0.2, [sx * 0.95, 0.1, 0], 8);
    pb.cyl(STONE_LIGHT, 0.4, 0.46, 1.5, [sx * 0.95, 0.95, 0], 8);
    pb.cone(variant === 1 ? PALETTE_HEX.gold : PALETTE_HEX.indigo, 0.5, 0.6, [sx * 0.95, 2.0, 0], 8);
    pb.box(0x484573, [0.07, 0.28, 0.05], [sx * 0.95, 1.2, 0.42]);
  }
  pb.box(STONE_MID, [1.5, 0.34, 0.5], [0, 1.55, 0]);
  pb.box(STONE_LIGHT, [1.5, 0.12, 0.56], [0, 1.78, 0]);
  for (let i = 0; i < 4; i++) pb.box(STONE_LIGHT, [0.2, 0.18, 0.5], [-0.55 + i * 0.37, 1.93, 0]);
  pb.anim('cloth', 0, 1.7, 0.3, 0, 0.5, PALETTE_HEX.gold);
}

const BUILDERS: Record<SetPieceKind, (pb: PieceBuilder, variant: number) => void> = {
  windmill,
  cottage,
  lighthouse: (pb) => lighthouse(pb),
  waterfall: (pb) => waterfall(pb),
  arch,
  ruinWall,
  pillars,
  banner,
  crystalGrove,
  dock,
  watchtower,
  hayBales: (pb) => hayBales(pb),
  scarecrow: (pb) => scarecrow(pb),
  brazier: (pb) => brazier(pb),
  seaStack,
  peak,
  boat,
  gatehouse,
  obelisk: (pb) => obelisk(pb),
  pond,
  stall,
  hut,
  parasol,
  tent,
  statue,
  cabin,
  cairn,
  fountain,
};

export function buildSetPiece(pb: PieceBuilder, kind: SetPieceKind, variant: number): void {
  BUILDERS[kind](pb, variant);
}
