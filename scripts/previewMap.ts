/**
 * Dev tool: headless software rasteriser for the island diorama (no browser/GL needed).
 *
 *   npx tsx scripts/previewMap.ts <levelNumber|all> [outDir=/tmp/skyhold-preview] [yawQuarter=0] [width=1400] [col,row,halfWidth]
 *
 * Runs the real MapBuilder + DecorBuilder in Node with stub materials, then flat-shades every triangle
 * (Kenney colormap sampled from the raw PNG, vertex colours, instance matrices/colours) into a PNG.
 * It is an approximation (no shadows/AO/tone-mapping/water shader) meant for composition & scale checks.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, inflateSync, crc32 } from 'node:zlib';
import * as THREE from 'three';
import { LEVELS } from '../src/data/levels/index.ts';
import type { LevelDef } from '../src/data/levels/index.ts';
import { MapBuilder } from '../src/render/mapBuilder.ts';
import { DecorBuilder } from '../src/render/decorBuilder.ts';
import { KENNEY_MODEL_LIST, type KenneyAssetStore, type KenneyModelName } from '../src/render/kenneyAssets.ts';
import type { MaterialLibrary } from '../src/render/materials.ts';
import { BALANCE } from '../src/data/balance.ts';
import { gridToWorldX, gridToWorldZ } from '../src/sim/grid.ts';

const MODEL_DIR = new URL('../public/models/kenney/', import.meta.url).pathname;

// ---------- GLB parsing ----------
interface GltfJson {
  nodes: Array<{
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }>;
  scenes: Array<{ nodes: number[] }>;
  scene?: number;
  meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; indices?: number }> }>;
  accessors: Array<{ bufferView: number; componentType: number; count: number; type: string; byteOffset?: number }>;
  bufferViews: Array<{ byteOffset?: number; byteLength: number; byteStride?: number }>;
}

function readAccessor(json: GltfJson, bin: Buffer, idx: number): { data: number[]; size: number } {
  const acc = json.accessors[idx];
  const bv = json.bufferViews[acc.bufferView];
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type] ?? 1;
  const compBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType] ?? 4;
  const stride = bv.byteStride ?? size * compBytes;
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: number[] = [];
  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < size; k++) {
      const off = base + i * stride + k * compBytes;
      switch (acc.componentType) {
        case 5126:
          out.push(bin.readFloatLE(off));
          break;
        case 5125:
          out.push(bin.readUInt32LE(off));
          break;
        case 5123:
          out.push(bin.readUInt16LE(off));
          break;
        case 5121:
          out.push(bin.readUInt8(off));
          break;
        default:
          out.push(0);
      }
    }
  }
  return { data: out, size };
}

function loadGlbGeometry(name: string): THREE.BufferGeometry {
  const buf = readFileSync(`${MODEL_DIR}${name}.glb`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as GltfJson;
  const binStart = 20 + jsonLen + 8;
  const bin = buf.subarray(binStart);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  const visit = (nodeIdx: number, parent: THREE.Matrix4): void => {
    const n = json.nodes[nodeIdx];
    const m = new THREE.Matrix4();
    if (n.matrix) m.fromArray(n.matrix);
    else {
      const t = n.translation ?? [0, 0, 0];
      const r = n.rotation ?? [0, 0, 0, 1];
      const s = n.scale ?? [1, 1, 1];
      m.compose(new THREE.Vector3(...t), new THREE.Quaternion(...r), new THREE.Vector3(...s));
    }
    const world = parent.clone().multiply(m);
    if (n.mesh !== undefined) {
      const nm = new THREE.Matrix3().getNormalMatrix(world);
      for (const prim of json.meshes[n.mesh].primitives) {
        const pos = readAccessor(json, bin, prim.attributes.POSITION).data;
        const nor = prim.attributes.NORMAL !== undefined ? readAccessor(json, bin, prim.attributes.NORMAL).data : null;
        const uv = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(json, bin, prim.attributes.TEXCOORD_0).data : null;
        const idx =
          prim.indices !== undefined
            ? readAccessor(json, bin, prim.indices).data
            : Array.from({ length: pos.length / 3 }, (_, i) => i);
        const v = new THREE.Vector3();
        const nv = new THREE.Vector3();
        for (const i of idx) {
          v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(world);
          positions.push(v.x, v.y, v.z);
          if (nor) {
            nv.set(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]).applyMatrix3(nm).normalize();
            normals.push(nv.x, nv.y, nv.z);
          } else normals.push(0, 1, 0);
          uvs.push(uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0);
        }
      }
    }
    for (const c of n.children ?? []) visit(c, world);
  };
  const scene = json.scenes[json.scene ?? 0];
  for (const root of scene.nodes) visit(root, new THREE.Matrix4());

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const col = new Float32Array((positions.length / 3) * 3);
  col.fill(1);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// ---------- PNG decode (8-bit, non-interlaced, RGB/RGBA/palette) + encode ----------
interface Image8 {
  w: number;
  h: number;
  rgba: Uint8Array;
}

function decodePng(file: Buffer): Image8 {
  let pos = 8;
  let w = 0;
  let h = 0;
  let colorType = 0;
  let plte: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos < file.length) {
    const len = file.readUInt32BE(pos);
    const type = file.toString('ascii', pos + 4, pos + 8);
    const data = file.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = raw[rowIn + x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 0xff;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (colorType === 6) {
      for (let k = 0; k < 4; k++) rgba[i * 4 + k] = px[i * 4 + k];
    } else if (colorType === 2) {
      for (let k = 0; k < 3; k++) rgba[i * 4 + k] = px[i * 3 + k];
      rgba[i * 4 + 3] = 255;
    } else if (colorType === 3 && plte) {
      const pi = px[i];
      rgba[i * 4] = plte[pi * 3];
      rgba[i * 4 + 1] = plte[pi * 3 + 1];
      rgba[i * 4 + 2] = plte[pi * 3 + 2];
      rgba[i * 4 + 3] = trns && pi < trns.length ? trns[pi] : 255;
    } else {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = px[i * bpp];
      rgba[i * 4 + 3] = 255;
    }
  }
  return { w, h, rgba };
}

function encodePng(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- stub assets & materials ----------
const colormap = decodePng(readFileSync(`${MODEL_DIR}Textures/colormap.png`));
const SRGB_TO_LIN = new Float32Array(256).map((_, i) => Math.pow(i / 255, 2.2));

// Mirror of the in-game palette harmonisation (kenneyPalette.ts SWATCH_TINTS) so previews match colours.
const TINTS: Array<[number, number, number, number, number]> = [
  [3, 2, 0x8ae24b, 0x52ad42, 0.58],
  [7, 3, 0xe3c794, 0xa6744c, 0.48],
  [1, 2, 0xe6cfa3, 0xc29368, 0.34],
  [6, 2, 0xe85d5d, 0xc64444, 0.48],
  [1, 1, 0x67639f, 0x484573, 0.58],
  [5, 3, 0xb2bac8, 0x8b95a5, 0.25],
  [3, 3, 0x8b95a5, 0x636b7c, 0.28],
];
{
  const cw = Math.floor(colormap.w / 8);
  const ch = Math.floor(colormap.h / 4);
  for (const [cx, cy, light, dark, mix] of TINTS) {
    for (let y = cy * ch; y < (cy + 1) * ch; y++) {
      const f = (y - cy * ch) / Math.max(1, ch - 1);
      for (let x = cx * cw; x < (cx + 1) * cw; x++) {
        const i = (y * colormap.w + x) * 4;
        const bias = x - cx * cw >= cw * 0.5 ? 0.92 : 1.02;
        for (let k = 0; k < 3; k++) {
          const l = (light >> (16 - 8 * k)) & 255;
          const dk = (dark >> (16 - 8 * k)) & 255;
          const target = (l + (dk - l) * f) * bias;
          colormap.rgba[i + k] = Math.max(0, Math.min(255, Math.round(colormap.rgba[i + k] + (target - colormap.rgba[i + k]) * mix)));
        }
      }
    }
  }
  for (let y = 0; y < ch; y++) {
    for (let x = 7 * cw; x < 8 * cw; x++) {
      const i = (y * colormap.w + x) * 4;
      colormap.rgba[i] = colormap.rgba[i + 1] = colormap.rgba[i + 2] = 255;
    }
  }
}

function sampleColormap(u: number, v: number, out: [number, number, number]): void {
  const x = Math.min(colormap.w - 1, Math.max(0, Math.floor(u * colormap.w)));
  const y = Math.min(colormap.h - 1, Math.max(0, Math.floor(v * colormap.h)));
  const i = (y * colormap.w + x) * 4;
  out[0] = SRGB_TO_LIN[colormap.rgba[i]];
  out[1] = SRGB_TO_LIN[colormap.rgba[i + 1]];
  out[2] = SRGB_TO_LIN[colormap.rgba[i + 2]];
}

function makeAssets(): KenneyAssetStore {
  const cache = new Map<string, THREE.BufferGeometry>();
  for (const name of KENNEY_MODEL_LIST) cache.set(name, loadGlbGeometry(name));
  return {
    cloneGeometry: (n: KenneyModelName) => (cache.get(n) as THREE.BufferGeometry).clone(),
    has: (n: KenneyModelName) => cache.has(n),
    colormapTexture: null,
  } as unknown as KenneyAssetStore;
}

function tagged(name: string, color = 0xffffff): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color });
  m.name = name;
  return m;
}

function makeMaterials(): MaterialLibrary {
  const solid = new Map<string, THREE.MeshBasicMaterial>();
  const solidProxy = {
    get: (k: string) => {
      let m = solid.get(k);
      if (!m) {
        m = tagged(`solid:${k}`);
        solid.set(k, m);
      }
      return m;
    },
  };
  return {
    solid: solidProxy,
    vertexColored: tagged('vertexColored'),
    kenneyTerrain: tagged('kenneyTerrain'),
    kenneyTower: tagged('kenneyTerrain'),
    goalCrystal: Object.assign(new THREE.MeshStandardMaterial(), { name: 'goalCrystal' }),
    waterMaterial: tagged('water'),
    shoreFoamMaterial: tagged('foam'),
    waterUniforms: { uWaterTime: { value: 0 }, uLagoonRadius: { value: 22 } },
  } as unknown as MaterialLibrary;
}

// ---------- rasteriser ----------
interface Tri {
  p: Float64Array; // 9 world coords
  n: [number, number, number];
  col: [number, number, number]; // average linear colour
}

function collectTris(root: THREE.Object3D, tris: Tri[]): void {
  root.updateMatrixWorld(true);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const tmpM = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  const inst = new THREE.Color();
  const uvc: [number, number, number] = [1, 1, 1];

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const geo = mesh.geometry;
    const matName = (mesh.material as THREE.Material).name;
    if (matName === 'water') return;
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const col = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
    const index = geo.index;
    const triCount = index ? index.count / 3 : pos.count / 3;
    const im = mesh as THREE.InstancedMesh;
    const instances = im.isInstancedMesh ? im.count : 1;
    const baseColor = (mesh.material as THREE.MeshBasicMaterial).color;

    for (let inst_i = 0; inst_i < instances; inst_i++) {
      world.copy(mesh.matrixWorld);
      if (im.isInstancedMesh) {
        im.getMatrixAt(inst_i, tmpM);
        world.multiply(tmpM);
        if (im.instanceColor) im.getColorAt(inst_i, inst);
        else inst.setRGB(1, 1, 1);
      } else inst.setRGB(1, 1, 1);

      for (let t = 0; t < triCount; t++) {
        const i0 = index ? index.getX(t * 3) : t * 3;
        const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(world);
        b.fromBufferAttribute(pos, i1).applyMatrix4(world);
        c.fromBufferAttribute(pos, i2).applyMatrix4(world);
        if (!Number.isFinite(a.x + b.x + c.x)) continue;
        e1.subVectors(b, a);
        e2.subVectors(c, a);
        const n = e1.clone().cross(e2);
        if (n.lengthSq() < 1e-12) continue;
        n.normalize();
        let r = 0;
        let g = 0;
        let bl = 0;
        for (const vi of [i0, i1, i2]) {
          let cr = 1;
          let cg = 1;
          let cb = 1;
          if (col) {
            cr = col.getX(vi);
            cg = col.getY(vi);
            cb = col.getZ(vi);
          }
          if (matName === 'kenneyTerrain' && uv) {
            sampleColormap(uv.getX(vi), uv.getY(vi), uvc);
            cr *= uvc[0];
            cg *= uvc[1];
            cb *= uvc[2];
          } else if (matName.startsWith('solid:') || matName === 'goalCrystal' || matName === 'foam') {
            // Solid palette materials are flat-coloured by the stub material colour.
            if (matName === 'foam') {
              cr = cg = cb = 0.95;
            } else if (matName === 'goalCrystal') {
              cr *= 0.5;
              cg *= 0.95;
              cb *= 1.0;
            } else {
              cr *= baseColor.r;
              cg *= baseColor.g;
              cb *= baseColor.b;
            }
          }
          r += cr;
          g += cg;
          bl += cb;
        }
        tris.push({
          p: Float64Array.of(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z),
          n: [n.x, n.y, n.z],
          col: [(r / 3) * inst.r, (g / 3) * inst.g, (bl / 3) * inst.b],
        });
      }
    }
  });
}

function render(
  tris: Tri[],
  widthPx: number,
  yawQuarter: number,
  focus: { x: number; z: number; half: number } | null,
  ss = 2,
): { w: number; h: number; rgb: Uint8Array } {
  const yaw = Math.PI / 4 + (yawQuarter * Math.PI) / 2;
  const tilt = Math.asin(1 / Math.sqrt(3));
  const d = new THREE.Vector3(Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt), Math.cos(yaw) * Math.cos(tilt)); // toward camera
  const right = new THREE.Vector3(0, 1, 0).cross(d).normalize();
  const up = d.clone().cross(right).normalize();
  const light = new THREE.Vector3(22, 34, 18).normalize();

  // bounds
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const v = new THREE.Vector3();
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      v.set(t.p[k * 3], t.p[k * 3 + 1], t.p[k * 3 + 2]);
      if (v.y < -3.5) continue; // ignore deep underside when framing
      const sx = v.dot(right);
      const sy = v.dot(up);
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
  }
  const pad = 1.5;
  if (focus) {
    const fx = new THREE.Vector3(focus.x, 0, focus.z);
    const cx = fx.dot(right);
    const cy = fx.dot(up);
    minX = cx - focus.half;
    maxX = cx + focus.half;
    minY = cy - focus.half * 0.62;
    maxY = cy + focus.half * 0.62;
  }
  minX -= pad;
  maxX += pad;
  minY -= pad;
  maxY += pad;
  const W = widthPx * ss;
  const scale = W / (maxX - minX);
  const H = Math.ceil((maxY - minY) * scale);
  const zbuf = new Float32Array(W * H).fill(-1e9);
  const img = new Float32Array(W * H * 3);
  // sky + water background (water plane at y=waterPlaneY covers everything below horizon)
  for (let y = 0; y < H; y++) {
    const tY = y / H;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      img[i] = 0.42 - 0.12 * tY;
      img[i + 1] = 0.68 - 0.1 * tY;
      img[i + 2] = 0.86 - 0.04 * tY;
    }
  }

  const rasterTri = (
    sx: Float64Array,
    sy: Float64Array,
    sz: Float64Array,
    rgb: [number, number, number],
  ): void => {
    const x0 = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2])));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])));
    const y0 = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2])));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])));
    const den = (sy[1] - sy[2]) * (sx[0] - sx[2]) + (sx[2] - sx[1]) * (sy[0] - sy[2]);
    if (Math.abs(den) < 1e-9) return;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const l0 = ((sy[1] - sy[2]) * (px - sx[2]) + (sx[2] - sx[1]) * (py - sy[2])) / den;
        const l1 = ((sy[2] - sy[0]) * (px - sx[2]) + (sx[0] - sx[2]) * (py - sy[2])) / den;
        const l2 = 1 - l0 - l1;
        if (l0 < -0.001 || l1 < -0.001 || l2 < -0.001) continue;
        const z = l0 * sz[0] + l1 * sz[1] + l2 * sz[2];
        const zi = y * W + x;
        if (z <= zbuf[zi]) continue;
        zbuf[zi] = z;
        img[zi * 3] = rgb[0];
        img[zi * 3 + 1] = rgb[1];
        img[zi * 3 + 2] = rgb[2];
      }
    }
  };

  const sx = new Float64Array(3);
  const sy = new Float64Array(3);
  const sz = new Float64Array(3);

  // water plane as one big quad (two tris) so the sea reads as blue below the island
  const wy = BALANCE.waterPlaneY;
  const R = 90;
  const wq: Array<[number, number, number]> = [
    [-R, wy, -R],
    [R, wy, -R],
    [R, wy, R],
    [-R, wy, R],
  ];
  const waterCol: [number, number, number] = [0.07, 0.4, 0.6];
  for (const idx of [
    [0, 1, 2],
    [0, 2, 3],
  ]) {
    for (let k = 0; k < 3; k++) {
      v.set(...wq[idx[k]]);
      sx[k] = (v.dot(right) - minX) * scale;
      sy[k] = (maxY - v.dot(up)) * scale;
      sz[k] = v.dot(d);
    }
    rasterTri(sx, sy, sz, waterCol);
  }

  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      v.set(t.p[k * 3], t.p[k * 3 + 1], t.p[k * 3 + 2]);
      sx[k] = (v.dot(right) - minX) * scale;
      sy[k] = (maxY - v.dot(up)) * scale;
      sz[k] = v.dot(d);
    }
    const nd = t.n[0] * d.x + t.n[1] * d.y + t.n[2] * d.z;
    // draw both sides but flip normal toward camera for lighting
    const sign = nd >= 0 ? 1 : -1;
    const lam = Math.max(0, sign * (t.n[0] * light.x + t.n[1] * light.y + t.n[2] * light.z));
    const hemi = 0.5 + 0.5 * sign * t.n[1];
    const shade = 0.34 * (0.6 + 0.4 * hemi) + 0.82 * lam;
    rasterTri(sx, sy, sz, [t.col[0] * shade * 1.35, t.col[1] * shade * 1.35, t.col[2] * shade * 1.35]);
  }

  // downsample + gamma
  const w = Math.floor(W / ss);
  const h = Math.floor(H / ss);
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (let j = 0; j < ss; j++) {
          for (let i = 0; i < ss; i++) s += img[((y * ss + j) * W + x * ss + i) * 3 + k];
        }
        s /= ss * ss;
        rgb[(y * w + x) * 3 + k] = Math.round(Math.min(1, Math.pow(Math.max(0, s), 1 / 2.2)) * 255);
      }
    }
  }
  return { w, h, rgb };
}

function previewLevel(
  level: LevelDef,
  outDir: string,
  yawQuarter: number,
  width: number,
  assets: KenneyAssetStore,
  focus: { col: number; row: number; half: number } | null,
): string {
  const materials = makeMaterials();
  const map = new MapBuilder();
  map.build(level, materials, assets);
  const decor = new DecorBuilder();
  decor.build(level, materials, assets);
  map.update(0);
  decor.update(0);
  const tris: Tri[] = [];
  collectTris(map.group, tris);
  collectTris(decor.group, tris);
  const f = focus
    ? { x: gridToWorldX(focus.col, level.cols), z: gridToWorldZ(focus.row, level.rows), half: focus.half }
    : null;
  let draws = 0;
  map.group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) draws++;
  });
  decor.group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) draws++;
  });
  console.log(`  ${level.name}: ${tris.length} triangles (instances expanded), ${draws} map+decor draw calls`);
  const { w, h, rgb } = render(tris, width, yawQuarter, f);
  const file = `${outDir}/L${level.index + 1}-${level.id}-r${yawQuarter}${focus ? '-focus' : ''}.png`;
  writeFileSync(file, encodePng(w, h, rgb));
  map.dispose();
  decor.dispose();
  return file;
}

function main(): void {
  const which = process.argv[2] ?? 'all';
  const outDir = process.argv[3] ?? '/tmp/skyhold-preview';
  const yawQuarter = Number(process.argv[4] ?? 0);
  const width = Number(process.argv[5] ?? 1400);
  const fArg = process.argv[6]; // "col,row,halfWidthWorldUnits"
  const focus = fArg ? (() => { const [c, r, h] = fArg.split(',').map(Number); return { col: c, row: r, half: h }; })() : null;
  mkdirSync(outDir, { recursive: true });
  const assets = makeAssets();
  const list = which === 'all' ? LEVELS : [LEVELS[Number(which) - 1]];
  for (const lvl of list) {
    const t0 = Date.now();
    const f = previewLevel(lvl, outDir, yawQuarter, width, assets, focus);
    console.log(`${f} (${Date.now() - t0} ms)`);
  }
}

main();
