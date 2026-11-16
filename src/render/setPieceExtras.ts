import { BALANCE } from '../data/balance.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import type { PieceBuilder } from './setPieceGeometry.ts';

/**
 * Second batch of small themed props (ponds, stalls, huts, parasols, tents, statues, cabins, cairns, fountains).
 * Same conventions as setPieceGeometry.ts: piece-local space, origin on the ground, front = +Z.
 */

const STONE_LIGHT = 0xb4bbc7;
const STONE_MID = 0xa1aab8;
const STONE_DARK = 0x8b95a5;
const WOOD = 0xb98a6a;
const WOOD_DARK = 0x7b5338;
const CREAM = PALETTE_HEX.cream;
const CORAL = PALETTE_HEX.coral;
const MOSS = 0x5f9a45;

export function pond(pb: PieceBuilder, variant: number): void {
  const water = variant === 1 ? 0x6fd6c8 : 0x7ccbee;
  pb.cyl(0xe9d3a6, 0.9, 0.92, 0.03, [0, 0.005, 0], 8);
  pb.cyl(water, 0.74, 0.74, 0.05, [0, 0.02, 0], 8);
  pb.cyl(0xc9f0fb, 0.3, 0.3, 0.055, [-0.2, 0.022, 0.1], 7);
  pb.cyl(0x4fae45, 0.16, 0.16, 0.03, [0.3, 0.05, -0.2], 7);
  pb.ico(0xf7a9bb, [0.05, 0.04, 0.05], [0.3, 0.09, -0.2]);
  pb.cyl(0x4fae45, 0.12, 0.12, 0.03, [-0.35, 0.05, -0.3], 7);
  for (const [x, z] of [
    [0.62, 0.38],
    [0.7, 0.2],
    [-0.62, 0.45],
  ] as const) {
    pb.cyl(0x6f8a3a, 0.018, 0.022, 0.38, [x, 0.2, z], 4);
    pb.cyl(0x7a4a2c, 0.035, 0.035, 0.1, [x, 0.4, z], 5);
  }
  pb.ico(STONE_DARK, [0.17, 0.11, 0.15], [-0.78, 0.07, -0.1]);
  pb.ico(STONE_MID, [0.14, 0.1, 0.13], [0.76, 0.06, -0.4]);
}

export function stall(pb: PieceBuilder, variant: number): void {
  const a = variant === 1 ? PALETTE_HEX.indigo : CORAL;
  for (const [x, z] of [
    [-0.55, -0.3],
    [0.55, -0.3],
    [-0.55, 0.3],
    [0.55, 0.3],
  ] as const) {
    pb.cyl(WOOD_DARK, 0.035, 0.04, 1.05, [x, 0.52, z], 5);
  }
  for (let i = 0; i < 6; i++) {
    pb.box(i % 2 === 0 ? a : CREAM, [0.2, 0.05, 0.84], [-0.5 + i * 0.2, 1.1 - Math.abs(i - 2.5) * 0.015, 0], [0, 0, 0]);
  }
  pb.box(WOOD, [1.2, 0.3, 0.45], [0, 0.45, 0.05]);
  pb.box(WOOD_DARK, [1.24, 0.05, 0.5], [0, 0.62, 0.05]);
  pb.ico(PALETTE_HEX.gold, [0.09, 0.07, 0.09], [-0.3, 0.7, 0.05]);
  pb.ico(CORAL, [0.09, 0.07, 0.09], [-0.1, 0.7, 0.1]);
  pb.ico(0x7dd36a, [0.09, 0.07, 0.09], [0.15, 0.7, 0.0]);
  pb.ico(PALETTE_HEX.gold, [0.09, 0.07, 0.09], [0.35, 0.7, 0.08]);
  pb.box(WOOD, [0.3, 0.3, 0.3], [0.7, 0.15, 0.6]);
  pb.box(0xa9795a, [0.26, 0.24, 0.26], [0.72, 0.42, 0.6], [0, 0.4, 0]);
  pb.cyl(WOOD_DARK, 0.14, 0.14, 0.3, [-0.7, 0.15, 0.6], 7);
}

export function hut(pb: PieceBuilder, variant: number): void {
  const thatch = variant === 1 ? 0xe9c77a : 0xd9a85a;
  for (const [x, z] of [
    [-0.4, -0.3],
    [0.4, -0.3],
    [-0.4, 0.3],
    [0.4, 0.3],
  ] as const) {
    pb.cyl(WOOD_DARK, 0.045, 0.05, 0.4, [x, 0.2, z], 5);
  }
  pb.box(WOOD, [1.0, 0.06, 0.8], [0, 0.42, 0]);
  pb.box(0xf3e8cc, [0.8, 0.5, 0.6], [0, 0.7, 0]);
  pb.cone(thatch, 0.78, 0.6, [0, 1.25, 0], 4, [0, Math.PI / 4, 0], [1, 1, 0.85]);
  pb.box(0xb7d4f6, [0.14, 0.14, 0.04], [0.22, 0.75, 0.31]);
  pb.box(WOOD_DARK, [0.18, 0.34, 0.04], [-0.12, 0.64, 0.31]);
  pb.box(WOOD, [0.2, 0.05, 0.5], [-0.12, 0.3, 0.62], [0.45, 0, 0]);
}

export function parasol(pb: PieceBuilder, variant: number): void {
  const a = variant === 1 ? PALETTE_HEX.gold : CORAL;
  pb.cyl(WOOD, 0.025, 0.03, 1.2, [0, 0.6, 0], 5, [0, 0, 0.08]);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    pb.cone(i % 2 === 0 ? a : CREAM, 0.46, 0.22, [Math.cos(ang) * 0.02 + 0.05, 1.25, Math.sin(ang) * 0.02], 6, [0, ang, 0], [0.18, 1, 1]);
  }
  pb.cone(a, 0.5, 0.2, [0.05, 1.22, 0], 6);
  // towel + ball
  pb.box(variant === 1 ? 0x8fd6e8 : 0xf4a8b0, [0.5, 0.02, 0.8], [0.5, 0.015, 0.35], [0, 0.4, 0]);
  pb.ico(CREAM, [0.09, 0.09, 0.09], [0.9, 0.09, 0.2]);
}

export function tent(pb: PieceBuilder, variant: number): void {
  const a = variant === 1 ? PALETTE_HEX.indigo : CORAL;
  pb.cone(CREAM, 0.8, 1.0, [0, 0.5, 0], 4, [0, Math.PI / 4, 0], [1, 1, 0.8]);
  pb.cone(a, 0.81, 0.35, [0, 0.9, 0], 4, [0, Math.PI / 4, 0], [1, 0.9, 0.81]);
  pb.box(0x484573, [0.28, 0.42, 0.05], [0, 0.22, 0.46], [0, 0, 0]);
  pb.cyl(WOOD_DARK, 0.02, 0.025, 0.4, [0, 1.15, 0], 4);
  // campfire ring
  pb.ico(STONE_DARK, [0.1, 0.07, 0.1], [0.75, 0.04, 0.55]);
  pb.ico(STONE_MID, [0.1, 0.07, 0.1], [0.95, 0.04, 0.55]);
  pb.ico(STONE_DARK, [0.1, 0.07, 0.1], [0.85, 0.04, 0.72]);
  pb.ico(STONE_MID, [0.1, 0.07, 0.1], [0.85, 0.04, 0.38]);
  pb.anim('flame', 0.85, 0.06, 0.55, 0, 1.7);
}

export function statue(pb: PieceBuilder, variant: number): void {
  const waterY = BALANCE.waterPlaneY;
  if (variant >= 2) {
    pb.box(STONE_DARK, [1.3, 1.15, 1.3], [0, waterY + 0.18, 0]);
    pb.box(STONE_MID, [1.4, 0.1, 1.4], [0, -0.05, 0]);
    pb.ico(CREAM, [0.8, 0.07, 0.8], [0, waterY + 0.03, 0]);
  }
  pb.box(STONE_DARK, [0.7, 0.2, 0.7], [0, 0.1, 0]);
  pb.box(STONE_MID, [0.5, 0.35, 0.5], [0, 0.375, 0]);
  pb.cone(STONE_LIGHT, 0.26, 0.9, [0, 1.0, 0], 6);
  pb.box(STONE_LIGHT, [0.62, 0.12, 0.2], [0, 1.15, 0]);
  if (variant % 2 === 1) {
    pb.ico(STONE_LIGHT, [0.1, 0.12, 0.1], [0.4, 0.55, 0.3]);
  } else {
    pb.ico(STONE_LIGHT, [0.14, 0.15, 0.14], [0, 1.58, 0]);
  }
  pb.ico(MOSS, [0.24, 0.07, 0.2], [0.1, 0.2, 0.3]);
  pb.ico(MOSS, [0.16, 0.06, 0.14], [-0.15, 1.0, 0.12]);
}

export function cabin(pb: PieceBuilder, variant: number): void {
  const wall = variant === 1 ? 0x8a6a4e : 0x9c7050;
  pb.box(STONE_DARK, [1.2, 0.14, 0.94], [0, 0.07, 0]);
  for (let i = 0; i < 4; i++) pb.box(i % 2 === 0 ? wall : 0x86603c, [1.1, 0.16, 0.84], [0, 0.22 + i * 0.16, 0]);
  pb.cone(CREAM, 0.9, 0.52, [0, 1.0, 0], 4, [0, Math.PI / 4, 0], [1, 1, 0.82]);
  pb.cone(0x5a5e78, 0.87, 0.22, [0, 0.9, 0], 4, [0, Math.PI / 4, 0], [1.02, 1, 0.84]);
  pb.box(STONE_LIGHT, [0.16, 0.34, 0.16], [0.34, 1.0, -0.1]);
  pb.box(0xf6bd41, [0.14, 0.16, 0.04], [-0.32, 0.52, 0.43]);
  pb.box(WOOD_DARK, [0.22, 0.4, 0.04], [0.1, 0.34, 0.43]);
  pb.box(CREAM, [0.4, 0.06, 0.2], [0.1, 0.07, 0.6]);
}

export function cairn(pb: PieceBuilder, variant: number): void {
  const cols = [STONE_DARK, STONE_MID, STONE_LIGHT, STONE_MID];
  pb.ico(cols[0], [0.5, 0.18, 0.45], [0, 0.1, 0]);
  pb.ico(cols[1], [0.38, 0.15, 0.34], [0.03, 0.3, 0.02]);
  pb.ico(cols[2], [0.28, 0.13, 0.26], [-0.02, 0.46, 0]);
  pb.ico(cols[3], [0.18, 0.11, 0.17], [0.01, 0.6, 0.01]);
  pb.ico(CREAM, [0.1, 0.07, 0.1], [0, 0.72, 0]);
  // prayer-flag string
  pb.cyl(WOOD_DARK, 0.02, 0.025, 1.0, [0.8, 0.5, 0], 4);
  pb.cyl(WOOD_DARK, 0.02, 0.025, 1.0, [-0.8, 0.5, 0], 4);
  const flags = [CORAL, PALETTE_HEX.gold, CREAM, PALETTE_HEX.indigo, 0x5be3ff];
  for (let i = 0; i < 5; i++) {
    const x = -0.64 + i * 0.32;
    pb.box(flags[(i + variant) % flags.length], [0.16, 0.2, 0.02], [x, 0.82 - Math.sin((i / 4) * Math.PI) * 0.1, 0]);
  }
  pb.box(0xe9d3a6, [1.6, 0.012, 0.012], [0, 0.97, 0]);
}

export function fountain(pb: PieceBuilder, variant: number): void {
  const gold = variant === 1;
  pb.cyl(STONE_DARK, 0.9, 0.95, 0.14, [0, 0.07, 0], 8);
  pb.cyl(STONE_LIGHT, 0.82, 0.86, 0.18, [0, 0.23, 0], 8);
  pb.cyl(0x7ccbee, 0.7, 0.7, 0.05, [0, 0.3, 0], 8);
  pb.cyl(STONE_MID, 0.16, 0.2, 0.55, [0, 0.55, 0], 6);
  pb.cyl(STONE_LIGHT, 0.4, 0.3, 0.1, [0, 0.85, 0], 8);
  pb.cyl(0x7ccbee, 0.34, 0.34, 0.04, [0, 0.9, 0], 8);
  pb.cone(gold ? PALETTE_HEX.gold : 0xc9f0fb, 0.1, 0.34, [0, 1.12, 0], 5);
  pb.ico(gold ? PALETTE_HEX.coral : CREAM, [0.06, 0.06, 0.06], [0, 1.32, 0]);
}

export function sheep(pb: PieceBuilder, variant: number): void {
  const wool = variant === 1 ? 0xf1e4d0 : 0xfaf6ee;
  const spots: Array<[number, number, number, number]> = [
    [-0.35, 0.1, 0.5, 0.0],
    [0.3, -0.25, 2.3, 0.2],
    [0.25, 0.42, 4.0, -0.1],
  ];
  for (const [x, z, yaw, k] of spots) {
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    pb.ico(wool, [0.2, 0.17, 0.15], [x, 0.24 + k * 0.02, z], [0, yaw, 0]);
    pb.ico(0x4a4560, [0.07, 0.07, 0.07], [x + sn * 0.2, 0.3, z + c * 0.2]);
    for (const [lx, lz] of [
      [0.08, 0.06],
      [-0.08, 0.06],
      [0.08, -0.06],
      [-0.08, -0.06],
    ] as const) {
      pb.cyl(0x4a4560, 0.016, 0.016, 0.12, [x + lx * c + lz * sn, 0.06, z - lx * sn + lz * c], 4);
    }
  }
  // little pen
  for (let i = 0; i < 4; i++) {
    pb.cyl(WOOD, 0.02, 0.02, 0.2, [-0.8 + i * 0.5, 0.1, 0.85], 4);
  }
  pb.box(WOOD, [1.6, 0.03, 0.03], [0.0, 0.16, 0.85]);
}

export function lamp(pb: PieceBuilder, variant: number): void {
  const frame = variant === 1 ? PALETTE_HEX.gold : 0x484573;
  pb.cyl(STONE_DARK, 0.14, 0.17, 0.16, [0, 0.08, 0], 6);
  pb.cyl(frame, 0.03, 0.045, 1.25, [0, 0.78, 0], 5);
  pb.box(frame, [0.2, 0.04, 0.2], [0, 1.4, 0]);
  pb.cyl(0xfff3b0, 0.1, 0.1, 0.2, [0, 1.52, 0], 6);
  pb.cone(frame, 0.16, 0.14, [0, 1.69, 0], 6);
  pb.ico(PALETTE_HEX.gold, [0.04, 0.04, 0.04], [0, 1.8, 0]);
}
