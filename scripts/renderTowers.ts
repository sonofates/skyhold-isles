/**
 * Dev tool: software-renders every tower (all tiers) from the real Kenney GLBs + the game's recoloured
 * colormap to a PNG contact sheet, so tower looks can be reviewed without a GPU/browser.
 *   npx tsx scripts/renderTowers.ts [out.png] [yaw] [types,comma,separated]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { TOWER_TYPES } from '../src/data/towers.ts';
import { SWATCH_TINTS } from '../src/render/kenneyPalette.ts';
import { TowerGeometryCache } from '../src/render/towerGeometries.ts';
import { decodePng, encodePng, type RawImage } from './lib/png.ts';
import { KENNEY_DIR, loadNodeKenneyStore } from './lib/nodeKenneyStore.ts';

const outPath = process.argv[2] ?? '/tmp/skyscratch/towers.png';
const yaw = Number(process.argv[3] ?? '0.9');
const onlyTypes = process.argv[4] ? process.argv[4].split(',') : null;

function harmonizedColormap(): RawImage {
  const img = decodePng(readFileSync(new URL('Textures/colormap.png', KENNEY_DIR)));
  const { width, height, data } = img;
  const cellW = Math.floor(width / 8);
  const cellH = Math.floor(height / 4);
  const blend = (s: number, t: number, m: number): number => Math.max(0, Math.min(255, Math.round(s + (t - s) * m)));
  for (const sw of SWATCH_TINTS) {
    const lr = (sw.lightHex >> 16) & 255;
    const lg = (sw.lightHex >> 8) & 255;
    const lb = sw.lightHex & 255;
    const dr = (sw.darkHex >> 16) & 255;
    const dg = (sw.darkHex >> 8) & 255;
    const db = sw.darkHex & 255;
    for (let y = sw.cy * cellH; y < sw.cy * cellH + cellH; y++) {
      const f = (y - sw.cy * cellH) / Math.max(1, cellH - 1);
      for (let x = sw.cx * cellW; x < sw.cx * cellW + cellW; x++) {
        const bias = x - sw.cx * cellW >= cellW * 0.5 ? 0.92 : 1.02;
        const i = (y * width + x) * 4;
        data[i] = blend(data[i], (lr + (dr - lr) * f) * bias, sw.mix);
        data[i + 1] = blend(data[i + 1], (lg + (dg - lg) * f) * bias, sw.mix);
        data[i + 2] = blend(data[i + 2], (lb + (db - lb) * f) * bias, sw.mix);
      }
    }
  }
  for (let y = 0; y < cellH; y++) {
    for (let x = 7 * cellW; x < 8 * cellW; x++) {
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
    }
  }
  return img;
}

const tex = harmonizedColormap();
const CELL = 220;
const SCALE = 78;
const f = new THREE.Vector3(-1, -1, -1).normalize();
const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
const u = new THREE.Vector3().crossVectors(r, f).normalize();
const light = new THREE.Vector3(-0.45, 0.85, 0.35).normalize();

const store = await loadNodeKenneyStore();
const cache = new TowerGeometryCache(store);
const types = TOWER_TYPES.filter((t) => !onlyTypes || onlyTypes.includes(t));
const W = CELL * types.length;
const H = CELL * 3;
const color = new Uint8Array(W * H * 4);
const zbuf = new Float32Array(W * H).fill(-Infinity);
for (let i = 0; i < W * H; i++) {
  color[i * 4] = 0x1f;
  color[i * 4 + 1] = 0x2a;
  color[i * 4 + 2] = 0x3a;
  color[i * 4 + 3] = 255;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();

function drawGeometry(geo: THREE.BufferGeometry, m: THREE.Matrix4, ox: number, oy: number, flat?: [number, number, number]): void {
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const col = geo.getAttribute('color');
  const proj = (v: THREE.Vector3): [number, number, number] => [ox + v.dot(r) * SCALE, oy - v.dot(u) * SCALE, -v.dot(f)];
  for (let t = 0; t + 2 < pos.count; t += 3) {
    _a.fromBufferAttribute(pos, t).applyMatrix4(m);
    _b.fromBufferAttribute(pos, t + 1).applyMatrix4(m);
    _c.fromBufferAttribute(pos, t + 2).applyMatrix4(m);
    _n.crossVectors(_b.clone().sub(_a), _c.clone().sub(_a)).normalize();
    if (_n.dot(f) > 0.0) continue; // back face
    const shade = 0.55 + 0.6 * Math.max(0, _n.dot(light));
    const P = [proj(_a), proj(_b), proj(_c)];
    const minX = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
    const den = (P[1][1] - P[2][1]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][1] - P[2][1]);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const l0 = ((P[1][1] - P[2][1]) * (px - P[2][0]) + (P[2][0] - P[1][0]) * (py - P[2][1])) / den;
        const l1 = ((P[2][1] - P[0][1]) * (px - P[2][0]) + (P[0][0] - P[2][0]) * (py - P[2][1])) / den;
        const l2 = 1 - l0 - l1;
        if (l0 < -0.001 || l1 < -0.001 || l2 < -0.001) continue;
        const z = l0 * P[0][2] + l1 * P[1][2] + l2 * P[2][2];
        const zi = y * W + x;
        if (z <= zbuf[zi]) continue;
        let cr: number;
        let cg: number;
        let cb: number;
        if (flat) {
          [cr, cg, cb] = flat;
        } else {
          const uu = l0 * uv.getX(t) + l1 * uv.getX(t + 1) + l2 * uv.getX(t + 2);
          const vv = l0 * uv.getY(t) + l1 * uv.getY(t + 1) + l2 * uv.getY(t + 2);
          const tx = Math.min(tex.width - 1, Math.max(0, Math.floor(uu * tex.width)));
          const ty = Math.min(tex.height - 1, Math.max(0, Math.floor(vv * tex.height)));
          const ti = (ty * tex.width + tx) * 4;
          const vr = l0 * col.getX(t) + l1 * col.getX(t + 1) + l2 * col.getX(t + 2);
          const vg = l0 * col.getY(t) + l1 * col.getY(t + 1) + l2 * col.getY(t + 2);
          const vb = l0 * col.getZ(t) + l1 * col.getZ(t + 1) + l2 * col.getZ(t + 2);
          cr = tex.data[ti] * vr;
          cg = tex.data[ti + 1] * vg;
          cb = tex.data[ti + 2] * vb;
        }
        zbuf[zi] = z;
        const ci = zi * 4;
        color[ci] = Math.min(255, cr * shade);
        color[ci + 1] = Math.min(255, cg * shade);
        color[ci + 2] = Math.min(255, cb * shade);
      }
    }
  }
}

const tile = new THREE.BufferGeometry();
tile.setAttribute(
  'position',
  new THREE.BufferAttribute(new Float32Array([-1, 0, -1, -1, 0, 1, 1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0, -1]), 3),
);
const ident = new THREE.Matrix4();
types.forEach((type, ti) => {
  ([1, 2, 3] as const).forEach((tier, row) => {
    const ox = ti * CELL + CELL / 2;
    const oy = row * CELL + CELL * 0.78;
    drawGeometry(tile, ident, ox, oy, [0x7e, 0xc8, 0x50]);
    const pair = cache.get(type, tier);
    drawGeometry(pair.base, ident, ox, oy);
    const tm = new THREE.Matrix4()
      .makeTranslation(0, pair.turretAnchorY, 0)
      .multiply(new THREE.Matrix4().makeRotationY(pair.idleSpinTurret ? 0.3 : yaw));
    drawGeometry(pair.turret, tm, ox, oy);
  });
});
writeFileSync(outPath, encodePng({ width: W, height: H, data: color }));
console.log(`wrote ${outPath} (${W}x${H}) types: ${types.join(',')}`);
