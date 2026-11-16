import { deflateSync, inflateSync } from 'node:zlib';

export interface RawImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel */
  data: Uint8Array;
}

/** Minimal 8-bit PNG decoder (color types 2, 3 and 6, non-interlaced) — enough for Kenney's colormap. */
export function decodePng(buf: Uint8Array): RawImage {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat: Uint8Array[] = [];
  let palette: Uint8Array = new Uint8Array(0);
  while (pos < buf.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      colorType = buf[pos + 17];
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'IDAT') {
      idat.push(body);
    }
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : colorType === 3 ? 1 : 3;
  const stride = width * bpp;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v: number;
      switch (filter) {
        case 1:
          v = x + a;
          break;
        case 2:
          v = x + b;
          break;
        case 3:
          v = x + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          v = x;
      }
      cur[i] = v & 255;
    }
    for (let px = 0; px < width; px++) {
      if (colorType === 3) {
        const idx = cur[px] * 3;
        out[(y * width + px) * 4] = palette[idx];
        out[(y * width + px) * 4 + 1] = palette[idx + 1];
        out[(y * width + px) * 4 + 2] = palette[idx + 2];
        out[(y * width + px) * 4 + 3] = 255;
        continue;
      }
      out[(y * width + px) * 4] = cur[px * bpp];
      out[(y * width + px) * 4 + 1] = cur[px * bpp + 1];
      out[(y * width + px) * 4 + 2] = cur[px * bpp + 2];
      out[(y * width + px) * 4 + 3] = bpp === 4 ? cur[px * bpp + 3] : 255;
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encodes an RGBA image as PNG. */
export function encodePng(img: RawImage): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(img.data.buffer, img.data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
