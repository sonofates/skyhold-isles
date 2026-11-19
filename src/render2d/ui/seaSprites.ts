/**
 * Painted sea sprites for the world map (gull, whale, foam, cloud, cloudShadow, sparkle, ripple,
 * shipSail) and the procedural stand-ins drawn until they exist.
 *
 * The paintings are registered under `paintedUi.sea` in /art2d/manifest.json. The reader is
 * tolerant, because the set is being painted in parallel:
 * - `paintedUi.sea` = { gull: 'ui/sea/gull.webp', … } — a value may be an image path, a strip's
 *   `.json` path, an object `{ image | file | src, json | sheet, frameW, frameH, count, cols, fps }`,
 *   or an array of any of those (variants, e.g. three clouds);
 * - flat keys `sea-gull` / `sea/gull` / `sea-cloud-shadow` are read too.
 * Strip json follows the animation strips (public/art2d/anim/*.json):
 * `{ frameW, frameH, count, cols, fps, anchor?, image? }`; `frames: [{x,y,w,h} | {frame:{…}}]` works too.
 * An image without json is cut only when it is a row of ≥ 3 square frames (clouds never are).
 * When a key is missing the map draws its stand-in, so the paintings replace them with no code change.
 */

export const SEA_SPRITE_KEYS = ['gull', 'whale', 'foam', 'cloud', 'cloudShadow', 'sparkle', 'ripple', 'shipSail'] as const;
export type SeaSpriteKey = (typeof SEA_SPRITE_KEYS)[number];

export interface StripInfo {
  readonly frameW: number;
  readonly frameH: number;
  readonly count: number;
  readonly cols: number;
  readonly fps: number;
  /** Frame px of the sprite's pivot (the gull's body, the tail's water line), or null = centre. */
  readonly anchor: readonly [number, number] | null;
  /** Explicit frame rectangles (TexturePacker-like json), else the grid. */
  readonly rects: readonly (readonly [number, number, number, number])[] | null;
}

export interface SeaSpriteRef {
  readonly image: string | null;
  readonly json: string | null;
  readonly strip: Partial<StripInfo> | null;
}

export interface SeaSprite {
  readonly img: CanvasImageSource & { width: number; height: number };
  readonly url: string;
  readonly info: StripInfo;
}

export type SeaSprites = Partial<Record<SeaSpriteKey, readonly SeaSprite[]>>;

/** Default playback rates when a strip's json does not say. */
const DEFAULT_FPS: Readonly<Record<SeaSpriteKey, number>> = { gull: 10, whale: 8, foam: 8, cloud: 1, cloudShadow: 1, sparkle: 12, ripple: 10, shipSail: 8 };

const kebab = (k: string): string => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function resolve(path: string, base: string): string {
  return /^(\/|https?:|data:|blob:)/.test(path) ? path : base + path;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

function refOf(v: unknown, base: string): SeaSpriteRef | null {
  if (typeof v === 'string' && v) {
    return /\.json$/i.test(v) ? { image: null, json: resolve(v, base), strip: null } : { image: resolve(v, base), json: null, strip: null };
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) if (typeof o[k] === 'string' && o[k]) return o[k] as string;
    return null;
  };
  const image = pick('image', 'file', 'src', 'webp', 'png');
  const json = pick('json', 'sheet', 'data', 'meta');
  if (!image && !json) return null;
  const strip = stripFields(o);
  return { image: image ? resolve(image, base) : null, json: json ? resolve(json, base) : null, strip: Object.keys(strip).length ? strip : null };
}

function stripFields(o: Record<string, unknown>): Partial<StripInfo> {
  const out: { -readonly [K in keyof StripInfo]?: StripInfo[K] } = {};
  const fw = num(o.frameW) ?? num(o.frameWidth);
  const fh = num(o.frameH) ?? num(o.frameHeight);
  const count = num(o.count) ?? num(o.frameCount) ?? (typeof o.frames === 'number' ? num(o.frames) : undefined);
  if (fw) out.frameW = fw;
  if (fh) out.frameH = fh;
  if (count) out.count = Math.round(count);
  const cols = num(o.cols) ?? num(o.columns);
  if (cols) out.cols = Math.round(cols);
  const fps = num(o.fps);
  if (fps) out.fps = fps;
  if (Array.isArray(o.anchor) && o.anchor.length >= 2 && o.anchor.every((n) => typeof n === 'number')) out.anchor = [o.anchor[0] as number, o.anchor[1] as number];
  const frames = Array.isArray(o.frames) ? o.frames : o.frames && typeof o.frames === 'object' ? Object.values(o.frames as object) : null;
  if (frames && frames.length) {
    const rects: [number, number, number, number][] = [];
    for (const f of frames) {
      const r = (f && typeof f === 'object' && 'frame' in f ? (f as { frame: unknown }).frame : f) as Record<string, unknown> | null;
      if (!r || typeof r !== 'object') continue;
      const x = Number(r.x);
      const y = Number(r.y);
      const w = num(r.w) ?? num(r.width);
      const h = num(r.h) ?? num(r.height);
      if (Number.isFinite(x) && Number.isFinite(y) && w && h) rects.push([x, y, w, h]);
    }
    if (rects.length) {
      out.rects = rects;
      out.count = rects.length;
    }
  }
  return out;
}

/** Where the manifest names each sea sprite (empty when the set is not painted yet). */
export function seaSpriteRefs(manifest: unknown, base = '/art2d/'): Partial<Record<SeaSpriteKey, readonly SeaSpriteRef[]>> {
  const out: Partial<Record<SeaSpriteKey, readonly SeaSpriteRef[]>> = {};
  const pu = manifest && typeof manifest === 'object' ? (manifest as { paintedUi?: unknown }).paintedUi : undefined;
  if (!pu || typeof pu !== 'object') return out;
  const flat = pu as Record<string, unknown>;
  const group = flat.sea && typeof flat.sea === 'object' && !Array.isArray(flat.sea) ? (flat.sea as Record<string, unknown>) : {};
  for (const key of SEA_SPRITE_KEYS) {
    const raw = group[key] ?? group[kebab(key)] ?? flat[`sea-${kebab(key)}`] ?? flat[`sea/${key}`] ?? flat[`sea/${kebab(key)}`] ?? flat[`sea-${key}`];
    const list = (Array.isArray(raw) ? raw : [raw]).map((v) => refOf(v, base)).filter((r): r is SeaSpriteRef => r !== null);
    if (list.length) out[key] = list;
  }
  return out;
}

/** The sea texture itself: `paintedUi.sea` when it is still a plain path, else `paintedUi['sea-texture']`, else the file. */
export function seaTextureUrl(manifest: unknown, small: boolean, base = '/art2d/'): string {
  const pu = (manifest && typeof manifest === 'object' ? (manifest as { paintedUi?: Record<string, unknown> }).paintedUi : undefined) ?? {};
  const pickStr = (...keys: string[]): string | null => {
    for (const k of keys) if (typeof pu[k] === 'string' && pu[k]) return pu[k] as string;
    return null;
  };
  const path = small ? pickStr('sea@0.5x', 'sea-texture@0.5x') : pickStr('sea', 'sea-texture');
  return resolve(path ?? (small ? 'ui/sea@0.5x.webp' : 'ui/sea.webp'), base);
}

/** Keys whose paintings are never strips (a wide cloud is just a wide cloud). */
const STILL_KEYS: ReadonlySet<SeaSpriteKey> = new Set(['cloud', 'cloudShadow']);

/**
 * Frames of an unlabelled image: a row of square frames (width an exact multiple of the height,
 * at least 3 of them), else one frame.
 */
export function guessFrames(imgW: number, imgH: number): number {
  if (imgH <= 0) return 1;
  const n = Math.round(imgW / imgH);
  return n >= 3 && Math.abs(imgW - n * imgH) <= 1 ? n : 1;
}

/**
 * Frame layout of a sprite: the json (or inline fields) when given, else `guessFrames` (`still` =
 * never cut: clouds).
 */
export function parseStrip(raw: Partial<StripInfo> | null, imgW: number, imgH: number, fps: number, still = false): StripInfo {
  const r = raw ?? {};
  if (r.rects && r.rects.length) {
    const [, , w, h] = r.rects[0];
    return { frameW: w, frameH: h, count: r.rects.length, cols: r.rects.length, fps: r.fps ?? fps, anchor: r.anchor ?? null, rects: r.rects };
  }
  let frameW = r.frameW;
  let frameH = r.frameH;
  let count = r.count;
  if (!frameW || !frameH) {
    if (count && count > 1) {
      const cols = r.cols ?? count;
      frameW = imgW / cols;
      frameH = imgH / Math.ceil(count / cols);
    } else if (!still && guessFrames(imgW, imgH) > 1) {
      count = guessFrames(imgW, imgH);
      frameW = imgW / count;
      frameH = imgH;
    } else {
      frameW = imgW;
      frameH = imgH;
    }
  }
  const cols = Math.max(1, Math.min(r.cols ?? Math.floor(imgW / frameW + 1e-6), Math.floor(imgW / frameW + 1e-6) || 1));
  const rows = Math.max(1, Math.floor(imgH / frameH + 1e-6));
  count = Math.max(1, Math.min(count ?? cols * rows, cols * rows));
  return { frameW, frameH, count, cols, fps: r.fps ?? fps, anchor: r.anchor ?? null, rects: null };
}

/** Source rectangle of frame `i` (wraps). */
export function frameRect(info: StripInfo, i: number): readonly [number, number, number, number] {
  const k = ((Math.floor(i) % info.count) + info.count) % info.count;
  if (info.rects) return info.rects[k];
  return [(k % info.cols) * info.frameW, Math.floor(k / info.cols) * info.frameH, info.frameW, info.frameH];
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}

async function loadJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function loadOne(key: SeaSpriteKey, ref: SeaSpriteRef): Promise<SeaSprite | null> {
  let strip: Partial<StripInfo> = ref.strip ?? {};
  let image = ref.image;
  if (ref.json) {
    const j = await loadJson(ref.json);
    if (j) {
      strip = { ...stripFields(j), ...strip };
      if (!image && typeof j.image === 'string') image = resolve(j.image, ref.json.replace(/[^/]*$/, ''));
    }
  }
  if (!image) return null;
  const img = await loadImage(image);
  if (!img || !img.naturalWidth) return null;
  // A wide strip registered without its json: its json usually sits next to it.
  if (!ref.json && !ref.strip && !STILL_KEYS.has(key) && img.naturalWidth >= img.naturalHeight * 2) {
    const j = await loadJson(image.replace(/\.[a-z0-9]+(\?.*)?$/i, '.json'));
    if (j) strip = stripFields(j);
  }
  return { img, url: image, info: parseStrip(strip, img.naturalWidth, img.naturalHeight, DEFAULT_FPS[key], STILL_KEYS.has(key)) };
}

/** Loads every painted sea sprite the manifest names; missing / broken ones are simply absent. */
export async function loadSeaSprites(manifest: unknown): Promise<SeaSprites> {
  const refs = seaSpriteRefs(manifest);
  const out: { [K in SeaSpriteKey]?: SeaSprite[] } = {};
  await Promise.all(
    (Object.keys(refs) as SeaSpriteKey[]).map(async (key) => {
      const got = (await Promise.all((refs[key] ?? []).map((r) => loadOne(key, r)))).filter((s): s is SeaSprite => s !== null);
      if (got.length) out[key] = got;
    }),
  );
  return out;
}

// ---- procedural stand-ins -------------------------------------------------------------------

type G = CanvasRenderingContext2D;

/**
 * A gull seen from above, wings spread (an "m" in flight): `span` css px wide, `flap` 0..1 one
 * wing beat. Cream wings, dark tips, a soft outline so it reads on light and dark water.
 */
export function drawGull(g: G, x: number, y: number, span: number, flap: number, facing: 1 | -1): void {
  const s = span;
  const beat = Math.sin(flap * Math.PI * 2);
  const tip = beat * s * 0.2; // wing tips up (−) / down (+)
  const mid = -s * 0.13 - beat * s * 0.05;
  g.save();
  g.translate(x, y);
  g.scale(facing, 1);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(-s / 2, tip);
  g.quadraticCurveTo(-s * 0.24, mid, 0, s * 0.02);
  g.quadraticCurveTo(s * 0.24, mid, s / 2, tip);
  g.strokeStyle = 'rgba(38, 52, 62, 0.85)';
  g.lineWidth = Math.max(1.6, s * 0.12);
  g.stroke();
  g.strokeStyle = '#fbf6ea';
  g.lineWidth = Math.max(0.9, s * 0.07);
  g.stroke();
  // dark wing tips
  g.strokeStyle = 'rgba(52, 58, 66, 0.95)';
  g.lineWidth = Math.max(0.9, s * 0.07);
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(side * s * 0.5, tip);
    g.lineTo(side * s * 0.41, tip * 0.7 + mid * 0.25);
    g.stroke();
  }
  // body
  g.fillStyle = '#fffaf0';
  g.beginPath();
  g.ellipse(s * 0.03, s * 0.03, s * 0.09, s * 0.045, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** The gull's soft shadow on the water (drawn first, offset down-right). */
export function drawGullShadow(g: G, x: number, y: number, span: number, flap: number): void {
  const s = span;
  const tip = Math.sin(flap * Math.PI * 2) * s * 0.12;
  g.save();
  g.translate(x, y);
  g.beginPath();
  g.moveTo(-s / 2, tip);
  g.quadraticCurveTo(-s * 0.24, -s * 0.08, 0, s * 0.02);
  g.quadraticCurveTo(s * 0.24, -s * 0.08, s / 2, tip);
  g.strokeStyle = 'rgba(8, 40, 56, 0.16)';
  g.lineWidth = Math.max(1.4, s * 0.1);
  g.lineCap = 'round';
  g.stroke();
  g.restore();
}

/**
 * A whale tail rising out of the water: base on the water line at (x, y), `size` css px from fluke
 * tip to fluke tip, `rise` 0..1 how far out of the water it is.
 */
export function drawWhaleTail(g: G, x: number, y: number, size: number, rise: number, tilt: number): void {
  if (rise <= 0.01) return;
  const s = size;
  const h = s * 0.85 * rise;
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  g.beginPath();
  g.rect(-s, -s * 2, s * 2, s * 2 + s * 0.02); // only what is above the water line
  g.clip();
  g.beginPath();
  g.moveTo(-s * 0.1, s * 0.02);
  g.quadraticCurveTo(-s * 0.08, -h * 0.45, -s * 0.06, -h * 0.66);
  g.bezierCurveTo(-s * 0.24, -h * 0.7, -s * 0.44, -h * 0.84, -s * 0.52, -h * 1.03);
  g.bezierCurveTo(-s * 0.36, -h * 0.99, -s * 0.15, -h * 0.97, 0, -h * 0.84);
  g.bezierCurveTo(s * 0.15, -h * 0.97, s * 0.36, -h * 0.99, s * 0.52, -h * 1.03);
  g.bezierCurveTo(s * 0.44, -h * 0.84, s * 0.24, -h * 0.7, s * 0.06, -h * 0.66);
  g.quadraticCurveTo(s * 0.08, -h * 0.45, s * 0.1, s * 0.02);
  g.closePath();
  const grad = g.createLinearGradient(0, -h, 0, 0);
  grad.addColorStop(0, '#5d8aa1');
  grad.addColorStop(0.45, '#35576c');
  grad.addColorStop(1, '#203b4d');
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = 'rgba(18, 34, 46, 0.85)';
  g.lineWidth = Math.max(1.2, s * 0.03);
  g.stroke();
  // wet highlight along the upper edge of the flukes
  g.beginPath();
  g.moveTo(-s * 0.44, -h * 0.97);
  g.bezierCurveTo(-s * 0.3, -h * 0.95, -s * 0.13, -h * 0.93, -s * 0.03, -h * 0.85);
  g.moveTo(s * 0.44, -h * 0.97);
  g.bezierCurveTo(s * 0.3, -h * 0.95, s * 0.13, -h * 0.93, s * 0.03, -h * 0.85);
  g.strokeStyle = 'rgba(214, 238, 240, 0.55)';
  g.lineWidth = Math.max(0.8, s * 0.02);
  g.stroke();
  g.restore();
}

/** Expanding foam rings on the water (whale splash, frontier stand-in), `p` 0..1 through one ring. */
export function drawRipple(g: G, x: number, y: number, radius: number, p: number, alpha: number): void {
  if (p <= 0 || p >= 1 || alpha <= 0) return;
  const r = radius * (0.25 + p * 0.75);
  g.beginPath();
  g.ellipse(x, y, r, r * 0.38, 0, 0, Math.PI * 2);
  g.strokeStyle = `rgba(236, 248, 242, ${(alpha * (1 - p) * 0.7).toFixed(3)})`;
  g.lineWidth = Math.max(1, radius * 0.05 * (1 - p * 0.5));
  g.stroke();
}

/** Puff circles [x, y, r] of one cloud stand-in, all inside a w×h box (nothing is clipped). */
export function cloudPuffs(rand: () => number, w: number, h: number): [number, number, number][] {
  const pad = h * 0.14;
  const base = h * 0.66;
  const out: [number, number, number][] = [];
  const n = 9 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const t = rand();
    // a low, wide heap: bigger, higher puffs towards the middle
    const hump = Math.sin(t * Math.PI);
    const r = h * (0.1 + hump * 0.16 + rand() * 0.05);
    const x = w * (0.16 + t * 0.68);
    const y = base - r * (0.2 + hump * 0.75) + (rand() - 0.5) * h * 0.05;
    out.push([x, y, r]);
  }
  return out.map(([x, y, r]) => [x, y, Math.max(h * 0.06, Math.min(r, x - pad, w - pad - x, y - pad))]);
}

/**
 * A soft storybook cloud on its own canvas (built once per variant), and its shadow (`shadow` =
 * the same silhouette, dark and blurrier, drawn on the water below it).
 */
export function paintCloud(puffs: readonly [number, number, number][], w: number, h: number, shadow = false): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  const g = c.getContext('2d');
  if (!g) return c;
  g.filter = `blur(${(h * (shadow ? 0.07 : 0.035)).toFixed(1)}px)`; // i18n-ignore (CSS filter)
  g.fillStyle = shadow ? 'rgb(6, 38, 54)' : '#fbfcf6';
  g.beginPath();
  for (const [x, y, r] of puffs) {
    g.moveTo(x + r, y);
    g.arc(x, y, r, 0, Math.PI * 2);
  }
  g.fill();
  g.filter = 'none';
  if (shadow) return c;
  // a cool underside and a warm sunlit top
  g.globalCompositeOperation = 'source-atop';
  const shade = g.createLinearGradient(0, h * 0.25, 0, h * 0.75);
  shade.addColorStop(0, 'rgba(255, 246, 222, 0.35)');
  shade.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  shade.addColorStop(1, 'rgba(128, 160, 184, 0.6)');
  g.fillStyle = shade;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  return c;
}
