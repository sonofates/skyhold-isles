/**
 * The world map's water: one WebGL pass over the painted sea texture (ui/sea.webp, tiled east).
 * Per pixel: a slow two-layer noise displacement of the painting (never more than ~2.5 css px), a
 * soft swell light, drifting cloud shadows, foam that swells and fades on the crests, and sun glints
 * twinkling in open water. Everything is in world coordinates, so the water stays glued to the chart
 * while it pans; every periodic term completes whole cycles per `SEA_PERIOD`, so the loop is seamless.
 * A calm mask (white = open sea) keeps foam and glints away from the islands, their labels, the title
 * band and the hint. One draw call, no allocations per frame.
 */
const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Fragment shader source (exported for the seamless-loop test). */
export const SEA_FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uSea;
uniform sampler2D uNoise;
uniform sampler2D uRand;
uniform sampler2D uCalm;
uniform vec4 uView;
uniform vec2 uTile;
uniform float uPh;
uniform vec4 uFx;
uniform vec2 uCalmXf;
uniform vec4 uHint;
uniform float uTop;
varying vec2 vUv;
const float TAU = 6.2831853;
void main() {
  vec2 w = uView.xy + vUv * uView.zw;
  vec4 a = texture2D(uNoise, w / 640.0 + vec2(3.0, 1.0) * uPh);
  vec4 b = texture2D(uNoise, w / 290.0 + vec2(-5.0, 2.0) * uPh + 0.37);
  float calm = texture2D(uCalm, w * uCalmXf).r;
  vec2 hin = smoothstep(uHint.xy - 28.0, uHint.xy, w) * (1.0 - smoothstep(uHint.zw, uHint.zw + 28.0, w));
  calm *= (1.0 - hin.x * hin.y) * smoothstep(uTop * 0.75, uTop, w.y);
  vec4 f = texture2D(uNoise, w / 120.0 + vec2(6.0, -4.0) * uPh + 0.71);
  vec2 d = (a.rg - 0.5) + (b.gr - 0.5) * 0.8 + (f.gr - 0.5) * 0.55;
  vec2 uv = (w + d * uFx.x * (0.5 + 0.5 * calm)) / uTile;
  uv.y = clamp(uv.y, 0.001, 0.999);
  vec3 col = texture2D(uSea, uv).rgb;
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  float swell = (a.b - 0.5) * 0.6 + (b.b - 0.5) * 0.5;
  col *= 1.0 + swell * 0.05;
  if (uFx.w > 0.0) {
    float c = texture2D(uNoise, w / 1900.0 + vec2(2.0, 1.0) * uPh + 0.61).a;
    col *= 1.0 - smoothstep(0.52, 0.72, c) * 0.1 * uFx.w;
  }
  if (uFx.y > 0.0) {
    float crest = smoothstep(0.52, 0.72, lum + (a.r - 0.5) * 0.2);
    float fleck = texture2D(uNoise, w / 90.0 + vec2(-7.0, 4.0) * uPh).r;
    float pulse = 0.5 + 0.5 * sin(TAU * (uPh * 48.0 + b.b * 2.0));
    float foam = crest * smoothstep(0.5, 0.78, fleck) * pulse;
    col = mix(col, vec3(0.95, 0.98, 0.93), foam * 0.5 * calm * uFx.y);
  }
  if (uFx.z > 0.0) {
    vec2 cell = floor(w / 34.0);
    vec4 r = texture2D(uRand, (mod(cell, 64.0) + 0.5) / 64.0);
    vec2 q = w - (cell + 0.18 + 0.64 * r.rg) * 34.0;
    float k = floor(40.0 + r.b * 56.0);
    float tw = pow(max(sin(TAU * (uPh * k + r.a)), 0.0), 14.0) * step(fract(r.b * 13.0), 0.2 * uFx.z) * smoothstep(0.4, 0.68, a.b);
    float spot = exp(-dot(q, q) / 2.4) + 0.4 * (exp(-q.x * q.x / 0.45 - q.y * q.y / 16.0) + exp(-q.y * q.y / 0.45 - q.x * q.x / 16.0));
    col += vec3(1.0, 0.97, 0.86) * tw * spot * calm * smoothstep(0.3, 0.52, lum + swell * 0.3) * 0.9;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/** Per-frame input, reused by the caller (no allocation per frame). */
export interface WaterFrame {
  /** World rect (css px) the canvas covers. */
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** One tile of the sea painting, css px. */
  tileW: number;
  tileH: number;
  /** Loop phase 0..1. */
  phase: number;
  /** Displacement, css px. */
  amp: number;
  foam: number;
  glint: number;
  shadow: number;
  /** Screen-fixed calm rect (the hint), already in world px: x0, y0, x1, y1. */
  hint: [number, number, number, number];
  /** Calm above this world y (the title band). */
  top: number;
}

/** Tileable value noise: 4 channels of fractal noise on lattices that divide `size` (seamless). */
export function tileNoise(size: number, seed: number): Uint8Array {
  let s = seed >>> 0 || 1;
  const rnd = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const out = new Uint8Array(size * size * 4);
  const acc = new Float32Array(size * size);
  // channel → octaves [lattice cells per tile, weight]
  const plans: readonly (readonly [number, number])[][] = [
    [[4, 0.5], [8, 0.3], [16, 0.2]],
    [[4, 0.45], [8, 0.35], [16, 0.2]],
    [[2, 0.55], [4, 0.3], [8, 0.15]],
    [[2, 0.5], [4, 0.35], [8, 0.15]],
  ];
  for (let ch = 0; ch < 4; ch++) {
    acc.fill(0);
    for (const [cells, weight] of plans[ch]) {
      const lat = new Float32Array(cells * cells);
      for (let i = 0; i < lat.length; i++) lat[i] = rnd();
      for (let y = 0; y < size; y++) {
        const v = (y / size) * cells;
        const j0 = Math.floor(v);
        const fy = v - j0;
        const sy = fy * fy * (3 - 2 * fy);
        const j1 = (j0 + 1) % cells;
        for (let x = 0; x < size; x++) {
          const u = (x / size) * cells;
          const i0 = Math.floor(u);
          const fx = u - i0;
          const sx = fx * fx * (3 - 2 * fx);
          const i1 = (i0 + 1) % cells;
          const top = lat[j0 * cells + i0] * (1 - sx) + lat[j0 * cells + i1] * sx;
          const bot = lat[j1 * cells + i0] * (1 - sx) + lat[j1 * cells + i1] * sx;
          acc[y * size + x] += (top * (1 - sy) + bot * sy) * weight;
        }
      }
    }
    // stretch to the full range so thresholds in the shader mean the same on every seed
    let lo = 1;
    let hi = 0;
    for (const v of acc) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const k = hi > lo ? 255 / (hi - lo) : 0;
    for (let i = 0; i < acc.length; i++) out[i * 4 + ch] = Math.round((acc[i] - lo) * k);
  }
  return out;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[sea] shader', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

const isPot = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;
const potBelow = (n: number): number => 2 ** Math.max(0, Math.floor(Math.log2(Math.max(1, n))));

type Uniforms = Record<'uSea' | 'uNoise' | 'uRand' | 'uCalm' | 'uView' | 'uTile' | 'uPh' | 'uFx' | 'uCalmXf' | 'uHint' | 'uTop', WebGLUniformLocation | null>;

export class SeaWater {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private u: Uniforms | null = null;
  private tex: { sea: WebGLTexture | null; noise: WebGLTexture | null; rand: WebGLTexture | null; calm: WebGLTexture | null } = { sea: null, noise: null, rand: null, calm: null };
  private seaImg: TexImageSource | null = null;
  private calmSrc: { c: HTMLCanvasElement; worldW: number; worldH: number } | null = null;
  private lost = false;
  /** Height of the uploaded sea texture in texels (0 = not yet). */
  seaTexH = 0;

  private readonly onLost: (lost: boolean) => void;

  constructor(onLost: (lost: boolean) => void) {
    this.onLost = onLost;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pu-sea-water';
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.gl = null;
      this.onLost(true);
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      if (this.init()) {
        if (this.seaImg) this.uploadSea(this.seaImg);
        if (this.calmSrc) this.setCalm(this.calmSrc.c, this.calmSrc.worldW, this.calmSrc.worldH);
        this.onLost(false);
      }
    });
  }

  /** False when WebGL is not available (the CSS painting stays, still). */
  init(): boolean {
    const attrs: WebGLContextAttributes = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
    const gl = (this.canvas.getContext('webgl', attrs) ?? this.canvas.getContext('experimental-webgl', attrs)) as WebGLRenderingContext | null;
    if (!gl) return false;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, SEA_FRAGMENT_SHADER);
    if (!vs || !fs) return false;
    const prog = gl.createProgram();
    if (!prog) return false;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const names = ['uSea', 'uNoise', 'uRand', 'uCalm', 'uView', 'uTile', 'uPh', 'uFx', 'uCalmXf', 'uHint', 'uTop'] as const;
    const u = {} as Uniforms;
    for (const n of names) u[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(u.uSea, 0);
    gl.uniform1i(u.uNoise, 1);
    gl.uniform1i(u.uRand, 2);
    gl.uniform1i(u.uCalm, 3);
    this.gl = gl;
    this.u = u;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // noise (smooth, tileable) and per-cell randoms (white, nearest)
    this.tex.noise = this.texture(1, gl.REPEAT, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, tileNoise(128, 0x5ea51de));
    this.tex.rand = this.texture(2, gl.REPEAT, gl.NEAREST);
    const white = new Uint8Array(64 * 64 * 4);
    let s = 0x2545f491;
    for (let i = 0; i < white.length; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      white[i] = (s >>> 0) & 255;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, white);
    // calm mask: all open sea until the map lays out
    this.tex.calm = this.texture(3, gl.CLAMP_TO_EDGE, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this.tex.sea = null;
    return true;
  }

  private texture(unit: number, wrap: number, filter: number): WebGLTexture | null {
    const gl = this.gl;
    if (!gl) return null;
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    return t;
  }

  /** The sea painting; non-power-of-two paintings are resampled so they can repeat and mipmap. */
  uploadSea(img: TexImageSource): void {
    this.seaImg = img;
    const gl = this.gl;
    if (!gl) return;
    const w = (img as { width: number }).width;
    const h = (img as { height: number }).height;
    let src: TexImageSource = img;
    if (!isPot(w) || !isPot(h)) {
      const c = document.createElement('canvas');
      c.width = potBelow(w);
      c.height = potBelow(h);
      c.getContext('2d')?.drawImage(img as CanvasImageSource, 0, 0, c.width, c.height);
      src = c;
    }
    if (this.tex.sea) gl.deleteTexture(this.tex.sea);
    this.tex.sea = this.texture(0, gl.REPEAT, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.seaTexH = (src as { height: number }).height;
  }

  /** Calm mask (white = open sea) covering the world, any resolution. */
  setCalm(c: HTMLCanvasElement, worldW: number, worldH: number): void {
    this.calmSrc = { c, worldW, worldH };
    const gl = this.gl;
    if (!gl || !this.tex.calm) return;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.calm);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.uniform2f(this.u?.uCalmXf ?? null, 1 / Math.max(1, worldW), 1 / Math.max(1, worldH));
  }

  get ready(): boolean {
    return !!this.gl && !this.lost && !!this.tex.sea;
  }

  resize(pxW: number, pxH: number): void {
    if (this.canvas.width !== pxW) this.canvas.width = pxW;
    if (this.canvas.height !== pxH) this.canvas.height = pxH;
  }

  draw(f: WaterFrame): boolean {
    const gl = this.gl;
    const u = this.u;
    if (!gl || !u || this.lost || !this.tex.sea) return false;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform4f(u.uView, f.x0, f.y0, f.w, f.h);
    gl.uniform2f(u.uTile, f.tileW, f.tileH);
    gl.uniform1f(u.uPh, f.phase);
    gl.uniform4f(u.uFx, f.amp, f.foam, f.glint, f.shadow);
    gl.uniform4f(u.uHint, f.hint[0], f.hint[1], f.hint[2], f.hint[3]);
    gl.uniform1f(u.uTop, f.top);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  destroy(): void {
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.gl = null;
  }
}
