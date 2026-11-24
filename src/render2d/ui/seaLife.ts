/**
 * The living sea under the world map's islands (owner request: alive with light, continuous motion,
 * calm and readable, no video).
 *
 * Layers, bottom to top, all under the route and the island medallions:
 * 1. water (seaWater.ts): the painted sea with a slow ripple displacement, swell light, drifting
 *    cloud shadows, foam on the crests and sun glints — one WebGL pass;
 * 2. life (a 2D canvas): soft clouds drifting with a parallax a little faster than the chart, gulls
 *    crossing now and then (with their shadow), and rarely a whale tail far from the islands —
 *    painted sprites from `paintedUi.sea` when they exist (seaSprites.ts), drawn stand-ins until then;
 * 3. on the islands (DOM + CSS): the medallions bob gently, the frontier island has a ripple ring,
 *    the frontier ship bobs and rocks with its pennant and sail fluttering.
 *
 * Both canvases sit inside the scrolling world, one viewport plus a margin wide, and are moved only
 * when the view leaves them, so native scrolling carries them with the chart (no lag on flings).
 *
 * Restraint: a calm mask keeps foam / glints / whale / gulls off the islands, their labels, the
 * title band and the hint; Settings → Reduced motion draws one still frame (no travel, no bob); the
 * low tier draws less at 30 fps; a hidden tab stops everything; with a sheet open the sea idles at 20 fps.
 * QA: window.__sea (stats, config); ?seawhale=1 brings the whale early and often; ?seaseed=N.
 */
import './seaLife.css';
import { isTouchDevice, loadSettings } from '../../platform/storage.ts';
import { detectSoftwareWebGL, qualityOverride } from '../renderResolution.ts';
import { anySheetOpen, el } from './dom.ts';
import { GRAPHICS_EVENT, loadGraphics } from './graphicsSettings.ts';
import type { WorldMapLayout } from './mapLayout.ts';
import {
  advanceClock,
  distToNodes,
  frameWindowSlow,
  gullFlight,
  nextGap,
  SEA_PERIOD,
  seaConfig,
  seaRng,
  stepDownTier,
  waterScale,
  whaleSpot,
  type Pt,
  type SeaConfig,
  type SeaInputs,
  type SeaView,
} from './seaMotion.ts';
import { cloudPuffs, drawGull, drawGullShadow, drawRipple, drawWhaleTail, frameRect, loadSeaSprites, paintCloud, seaTextureUrl, type SeaSprite, type SeaSprites } from './seaSprites.ts';
import { SeaWater, type WaterFrame } from './seaWater.ts';
import type { QualityTier } from '../renderResolution.ts';

declare global {
  interface Window {
    __sea?: { stats: () => SeaStats; resetStats: () => void; whaleNow: () => boolean };
  }
}

export interface SeaStats {
  tier: QualityTier;
  still: boolean;
  gl: boolean;
  waterPx: [number, number];
  lifePx: [number, number];
  frames: number;
  /** CPU ms per drawn frame (water uniforms + life canvas + DOM frames), mean / max. */
  drawMs: number;
  drawMaxMs: number;
  /** Drawn frames per second over the stats window. */
  fps: number;
  painted: string[];
  gulls: number;
  whales: number;
  clouds: number;
}

export interface SeaHandle {
  /** After every map layout: world size, island positions, the free band's top, the hint element. */
  layout(L: WorldMapLayout, h: number, top: number, hint: HTMLElement | null): void;
  /** Adds the bob phase (and the ripple ring on the frontier island) to an island button. */
  decorateNode(b: HTMLElement, i: number, frontier: boolean): void;
  /** The frontier ship (hull + fluttering pennant and sail, or the painted sail strip). */
  ship(): HTMLElement;
  /** Tints the water (the world map chapter's sea: rgb multipliers + saturation). */
  setGrade(g: readonly [number, number, number, number]): void;
}

interface Flight {
  x: number;
  y: number;
  vx: number;
  vy: number;
  count: number;
  span: number;
  seed: number;
}

interface Whale {
  x: number;
  y: number;
  size: number;
  age: number;
  tilt: number;
}

interface Cloud {
  sx: number;
  y: number;
  w: number;
  h: number;
  variant: number;
  alpha: number;
  speed: number;
}

interface Twinkle {
  x: number;
  y: number;
  age: number;
  life: number;
  size: number;
  variant: number;
}

const WHALE_LIFE = 7;
/** Minimum ms between water frames. */
const WATER_MIN_MS = 1000 / 30;
/** Clouds move this much faster than the chart when it pans (they are nearer the eye). */
const CLOUD_PARALLAX = 0.22;
const LIFE_PIXEL_BUDGET = 4_000_000;
const SHIP_URL = '/art2d/ui/ship.webp';

function readInputs(q: URLSearchParams): SeaInputs {
  const g = loadGraphics();
  const override = qualityOverride(q.get('quality'));
  const quality = loadSettings().quality;
  const auto = !override && (quality === 'auto' || quality === undefined);
  return {
    override,
    quality,
    reducedMotion: g.reducedMotion,
    effects: g.effects,
    fpsCap: g.fpsCap,
    touch: isTouchDevice(),
    // only probed when the tier is Auto (it opens a throwaway WebGL context)
    software: auto ? detectSoftwareWebGL() : false,
  };
}

export function mountSea(root: HTMLElement, world: HTMLElement, scroll: HTMLElement, manifest: unknown, q: URLSearchParams): SeaHandle {
  let inputs = readInputs(q);
  let tierNow: QualityTier | undefined;
  let cfg: SeaConfig = seaConfig(inputs);
  const rand = seaRng(Number(q.get('seaseed')) || (Date.now() & 0xffffff));
  const qaWhale = q.get('seawhale') === '1';
  // QA cost probes: ?seadebug=nowater,nolife,nobg
  const dbg = (q.get('seadebug') ?? '').split(',');

  const layer = el('div', 'pu-sea', { 'aria-hidden': 'true' });
  const water = new SeaWater((lost) => {
    root.classList.toggle('sea-live', !lost && water.ready);
    if (!lost) requestStill();
  });
  const lifeCanvas = document.createElement('canvas');
  lifeCanvas.className = 'pu-sea-life';
  if (!dbg.includes('nowater')) layer.append(water.canvas);
  if (!dbg.includes('nolife')) layer.append(lifeCanvas);
  root.classList.toggle('sea-nobg', dbg.includes('nobg'));
  world.prepend(layer);
  const g = lifeCanvas.getContext('2d');
  let waterInit = false;
  /** The governor turned the water off (Auto, already at the low tier and still slow). */
  let waterOff = false;
  const wantWater = (): boolean => cfg.water && !waterOff && !dbg.includes('nowater');

  let sprites: SeaSprites = {};
  let seaAspect = 2;
  const cloudArt: HTMLCanvasElement[] = [];
  const cloudShade: HTMLCanvasElement[] = [];

  // ---- layout state
  let L: WorldMapLayout | null = null;
  let worldW = 0;
  let viewH = 0;
  let topBand = 0;
  let hintEl: HTMLElement | null = null;
  const hintScreen: [number, number, number, number] = [-1e4, -1e4, -1e4, -1e4];
  let nodesPt: Pt[] = [];
  let anchor = -1;
  let cw = 0;
  let ws = 1;
  let ls = 1;

  // ---- time / life state
  let clock = 0;
  let life = 0;
  let gullTimer = 2.5 + rand() * 3;
  let whaleTimer = qaWhale ? 2 : 22 + rand() * 20;
  const flights: Flight[] = [];
  let whale: Whale | null = null;
  const clouds: Cloud[] = [];
  const twinkles: Twinkle[] = [];
  let twinkleTimer = 0;
  const dirtyPrev: number[] = [];
  const dirtyNext: number[] = [];

  // ---- stats
  const st = { frames: 0, drawMs: 0, drawMax: 0, t0: performance.now(), gulls: 0, whales: 0 };
  let govT0 = 0;
  let govFrames = 0;
  let govSum = 0;
  let govSlow = 0;
  let govSteps = 0;

  const wf: WaterFrame = { x0: 0, y0: 0, w: 0, h: 0, tileW: 0, tileH: 0, phase: 0, amp: 0, foam: 1, glint: 1, shadow: 1, hint: [-1e4, -1e4, -1e4, -1e4], top: 0 };

  // ---- DOM pieces on the islands
  const shipEls: { strip: HTMLElement | null; root: HTMLElement }[] = [];
  const rippleEls: HTMLElement[] = [];
  let lastShipFrame = -1;
  let lastRippleFrame = -1;

  const applyClasses = (): void => {
    root.classList.toggle('sea-anim', !cfg.still);
    root.classList.toggle('sea-still', cfg.still);
    root.classList.toggle('sea-lite', cfg.tier === 'low');
    root.classList.toggle('sea-bob', cfg.bob === 'all');
    root.classList.toggle('sea-bob-frontier', cfg.bob === 'frontier');
  };
  applyClasses();

  // ---- sizes
  const sizeCanvases = (): void => {
    if (!L || viewH <= 0) return;
    const vw = scroll.clientWidth || window.innerWidth;
    const margin = Math.round(vw * 0.2);
    cw = Math.min(worldW, vw + margin * 2);
    const dpr = window.devicePixelRatio || 1;
    ws = waterScale(cfg, dpr, viewH, water.seaTexH || 1024);
    ls = Math.max(0.5, Math.min(cfg.lifeMaxScale, dpr, Math.sqrt(LIFE_PIXEL_BUDGET / Math.max(1, cw * viewH))));
    layer.style.width = `${cw}px`;
    water.resize(Math.round(cw * ws), Math.round(viewH * ws));
    const lw = Math.round(cw * ls);
    const lh = Math.round(viewH * ls);
    if (lifeCanvas.width !== lw) lifeCanvas.width = lw;
    if (lifeCanvas.height !== lh) lifeCanvas.height = lh;
    dirtyPrev.length = 0;
    g?.setTransform(1, 0, 0, 1, 0, 0);
    g?.clearRect(0, 0, lw, lh);
    anchor = -1;
  };

  /** Moves the layer when the view left it; true when it moved (a still sea must redraw). */
  const ensureAnchor = (): boolean => {
    const sl = scroll.scrollLeft;
    const vw = scroll.clientWidth || window.innerWidth;
    if (anchor >= 0 && sl >= anchor - 0.5 && sl + vw <= anchor + cw + 0.5) return false;
    const margin = (cw - vw) / 2;
    anchor = Math.round(Math.max(0, Math.min(worldW - cw, sl - margin)));
    layer.style.transform = `translate3d(${anchor}px, 0, 0)`; // i18n-ignore (CSS)
    dirtyPrev.length = 0;
    if (g) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, lifeCanvas.width, lifeCanvas.height);
    }
    return true;
  };

  const view = (): SeaView => {
    const sl = scroll.scrollLeft;
    const vw = scroll.clientWidth || window.innerWidth;
    return { x0: sl, x1: sl + vw, top: topBand, bottom: Math.min(viewH, hintScreen[1] > 0 ? hintScreen[1] : viewH) - 8 };
  };

  // ---- calm mask: white = open sea; dark around islands, labels and (lightly) the route
  const buildCalm = (): void => {
    if (!L) return;
    const k = 1 / 8;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(worldW * k));
    c.height = Math.max(1, Math.ceil(viewH * k));
    const m = c.getContext('2d');
    if (!m) return;
    m.fillStyle = '#fff';
    m.fillRect(0, 0, c.width, c.height);
    m.scale(k, k);
    const d = L.nodeD;
    m.strokeStyle = 'rgba(0,0,0,0.45)';
    m.lineWidth = d * 0.22;
    m.lineJoin = 'round';
    m.beginPath();
    L.nodes.forEach((n, i) => (i ? m.lineTo(n.x, n.y) : m.moveTo(n.x, n.y)));
    m.stroke();
    for (const n of L.nodes) {
      const r = d * 1.02;
      const grd = m.createRadialGradient(n.x, n.y, 0, n.x, n.y, r);
      grd.addColorStop(0, 'rgba(0,0,0,1)');
      grd.addColorStop(0.62, 'rgba(0,0,0,0.92)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      m.fillStyle = grd;
      m.fillRect(n.x - r, n.y - r, r * 2, r * 2);
      // the name plaque under the island and the stars above it
      m.fillStyle = 'rgba(0,0,0,0.9)';
      m.fillRect(n.x - d * 0.8, n.y + d * 0.35, d * 1.6, d * 0.5);
      m.fillRect(n.x - d * 0.42, n.y - d * 0.78, d * 0.84, d * 0.3);
    }
    water.setCalm(c, worldW, viewH);
  };

  // ---- clouds
  const buildClouds = (): void => {
    clouds.length = 0;
    if (!L) return;
    const n = cfg.clouds;
    const { field } = cloudField();
    const painted = sprites.cloud?.length ?? 0;
    for (let i = 0; i < n; i++) {
      const w = Math.min(380, Math.max(96, viewH * (0.2 + rand() * 0.1)));
      clouds.push({
        sx: ((i + 0.15 + rand() * 0.7) / n) * field,
        y: topBand + (0.12 + rand() * 0.66) * Math.max(1, viewH - topBand),
        w,
        h: w * (150 / 360),
        variant: Math.floor(rand() * Math.max(1, painted || cloudArt.length)),
        alpha: 0.5 + rand() * 0.14,
        speed: (3.5 + rand() * 4) * Math.max(0.5, viewH / 900),
      });
    }
  };

  const cloudField = (): { field: number; maxW: number } => {
    const vw = scroll.clientWidth || window.innerWidth;
    const maxW = Math.min(380, Math.max(96, viewH * 0.3)) + (L?.nodeD ?? 0);
    return { field: vw + maxW * 2, maxW };
  };

  /** Is a point (with a margin) under one of the clouds right now? */
  const underCloud = (p: Pt, margin: number): boolean => {
    const sl = scroll.scrollLeft;
    const { field, maxW } = cloudField();
    for (const c of clouds) {
      const x = sl + ((((c.sx + c.speed * life - sl * CLOUD_PARALLAX) % field) + field) % field) - maxW;
      // the cloud drifts a little during the ~7 s the tail is up
      if (p.x > x - margin - c.speed * 8 && p.x < x + c.w + margin + c.speed * 8 && p.y > c.y - margin && p.y < c.y + c.h + margin * 2) return true;
    }
    return false;
  };

  // ---- drawing helpers
  const markDirty = (x: number, y: number, w: number, h: number): void => {
    dirtyNext.push(x - 2, y - 2, w + 4, h + 4);
  };

  const drawSprite = (s: SeaSprite, frame: number, cx: number, cy: number, w: number, alpha: number, flip: boolean): void => {
    if (!g) return;
    const [sx, sy, sw, sh] = frameRect(s.info, frame);
    const h = (w * sh) / sw;
    const ax = s.info.anchor ? (s.info.anchor[0] / sw) * w : w / 2;
    const ay = s.info.anchor ? (s.info.anchor[1] / sh) * h : h / 2;
    g.globalAlpha = alpha;
    if (flip) {
      g.save();
      g.translate(cx, cy);
      g.scale(-1, 1);
      g.drawImage(s.img, sx, sy, sw, sh, -ax, -ay, w, h);
      g.restore();
    } else g.drawImage(s.img, sx, sy, sw, sh, cx - ax, cy - ay, w, h);
    g.globalAlpha = 1;
    markDirty(cx - Math.max(ax, w - ax), cy - Math.max(ay, h - ay), Math.max(ax, w - ax) * 2, Math.max(ay, h - ay) * 2);
  };

  // ---- life update + draw (world coordinates)
  const updateLife = (dt: number): void => {
    if (!L || cfg.still) return;
    const v = view();
    const d = L.nodeD;
    // gulls
    gullTimer -= dt;
    if (cfg.gulls && gullTimer <= 0 && flights.length < 3) {
      const span = Math.max(14, Math.min(34, d * 0.2));
      const f = gullFlight(rand, v, span);
      flights.push({ ...f, span, seed: rand() * 10 });
      st.gulls++;
      gullTimer = nextGap(rand, 7, 18, cfg.density);
    }
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      const tail = f.span * 5;
      const gone = f.vx > 0 ? f.x - tail > v.x1 + 40 : f.x + tail < v.x0 - 40;
      if (gone || f.x < anchor - cw || f.x > anchor + cw * 2) flights.splice(i, 1);
    }
    // whale
    whaleTimer -= dt;
    if (cfg.whale && !whale && whaleTimer <= 0) {
      const size = Math.max(26, Math.min(70, d * 0.42));
      let p: Pt | null = null;
      for (let k = 0; k < 4 && !p; k++) {
        p = whaleSpot(rand, v, nodesPt, d * 1.25, Math.max(size, d * 0.45));
        if (p && underCloud(p, size)) p = null;
      }
      if (p) {
        whale = { x: p.x, y: p.y, size, age: 0, tilt: (rand() - 0.5) * 0.2 };
        st.whales++;
        whaleTimer = qaWhale ? 9 : nextGap(rand, 70, 140, 1);
      } else whaleTimer = 8;
    }
    if (whale) {
      whale.age += dt;
      if (whale.age > WHALE_LIFE) whale = null;
    }
    // painted foam / sparkles (the water draws its own until they exist)
    const foam = sprites.foam;
    const sparkle = sprites.sparkle;
    if (foam || sparkle) {
      twinkleTimer -= dt;
      const want = Math.round(((foam ? 6 : 0) + (sparkle ? 10 : 0)) * cfg.density);
      if (twinkleTimer <= 0 && twinkles.length < want) {
        twinkleTimer = 0.18;
        const p = { x: v.x0 + rand() * (v.x1 - v.x0), y: v.top + rand() * Math.max(1, v.bottom - v.top) };
        if (distToNodes(p, nodesPt) > d * 0.85) {
          const isFoam = !!foam && (!sparkle || rand() < 0.4);
          twinkles.push({ x: p.x, y: p.y, age: 0, life: isFoam ? 3.5 + rand() * 1.5 : 1.1 + rand() * 0.6, size: isFoam ? d * (0.25 + rand() * 0.2) : d * (0.08 + rand() * 0.05), variant: isFoam ? 0 : 1 });
        }
      }
      for (let i = twinkles.length - 1; i >= 0; i--) {
        twinkles[i].age += dt;
        if (twinkles[i].age >= twinkles[i].life) twinkles.splice(i, 1);
      }
    }
  };

  const drawLife = (): void => {
    if (!g || !L) return;
    g.setTransform(ls, 0, 0, ls, -anchor * ls, 0);
    dirtyNext.length = 0;
    const sl = scroll.scrollLeft;
    const d = L.nodeD;

    // painted foam / sparkles
    for (const t of twinkles) {
      const s = (t.variant === 0 ? sprites.foam : sprites.sparkle)?.[0];
      if (!s) continue;
      const p = t.age / t.life;
      const a = Math.sin(Math.PI * p);
      drawSprite(s, p * s.info.count, t.x, t.y, t.size, a * (t.variant === 0 ? 0.8 : 1), false);
    }
    // cloud shadows lie on the water (under the whale and the gulls): they pan with the chart,
    // the clouds a little faster, so a shadow slides under its cloud
    const { field, maxW } = cloudField();
    const paintedShadow = sprites.cloudShadow;
    for (const c of clouds) {
      const drift = c.sx + c.speed * life;
      const hx = sl + ((((drift + d * 0.35) % field) + field) % field) - maxW;
      const hy = c.y + d * 0.75;
      if (paintedShadow) drawSprite(paintedShadow[c.variant % paintedShadow.length], 0, hx + c.w / 2, hy + c.h / 2, c.w, 0.5, false);
      else {
        const sh = cloudShade[c.variant % Math.max(1, cloudShade.length)];
        if (sh) {
          g.globalAlpha = 0.16;
          g.drawImage(sh, hx, hy, c.w, c.h);
          g.globalAlpha = 1;
          markDirty(hx, hy, c.w, c.h);
        }
      }
    }
    // whale
    if (whale) {
      const w = whale;
      const a = w.age;
      const rise = a < 0.8 ? 0 : a < 2.4 ? 1 - (1 - (a - 0.8) / 1.6) ** 2 : a < 4 ? 1 : a < 5.3 ? 1 - ((a - 4) / 1.3) ** 2 : 0;
      const ringR = w.size * 1.25;
      const rp = sprites.ripple?.[0];
      for (const start of [0.3, 1.3, 2.4, 4.4, 5.2]) {
        const p = (a - start) / 2.2;
        if (p <= 0 || p >= 1) continue;
        if (rp) drawSprite(rp, rp.info.count > 1 ? p * rp.info.count : 0, w.x, w.y, ringR * 2 * (rp.info.count > 1 ? 1 : 0.3 + p * 0.7), 0.85 * (1 - p), false);
        else drawRipple(g, w.x, w.y, ringR, p, 1);
      }
      const painted = sprites.whale?.[0];
      if (painted) {
        const pp = Math.max(0, Math.min(0.999, (a - 0.8) / 4.5));
        if (painted.info.count > 1) drawSprite(painted, pp * painted.info.count, w.x, w.y, w.size * 1.25, a < 5.6 ? 1 : 0, false);
        else if (rise > 0.01) {
          g.save();
          g.beginPath();
          g.rect(w.x - w.size, w.y - w.size * 2, w.size * 2, w.size * 2);
          g.clip();
          drawSprite(painted, 0, w.x, w.y + w.size * (1 - rise) * 0.9, w.size * 1.25, 1, false);
          g.restore();
        }
      } else {
        drawWhaleTail(g, w.x, w.y, w.size, rise, w.tilt + (a > 4 ? (a - 4) * 0.12 : 0));
        if (rise > 0.02) {
          // foam where the tail leaves the water, and drips off the flukes while it hangs there
          g.fillStyle = 'rgba(236, 248, 242, 0.7)';
          g.beginPath();
          g.ellipse(w.x, w.y, w.size * (0.16 + rise * 0.08), w.size * 0.05, 0, 0, Math.PI * 2);
          g.fill();
          if (a > 2.2 && a < 4.6) {
            g.fillStyle = 'rgba(230, 246, 248, 0.8)';
            for (let k = 0; k < 4; k++) {
              const side = k % 2 ? 1 : -1;
              const fall = ((a * 1.7 + k * 0.37) % 1) * w.size * 0.8 * rise;
              g.beginPath();
              g.arc(w.x + side * w.size * (0.42 - k * 0.04), w.y - w.size * 0.82 * rise + fall, Math.max(0.8, w.size * 0.02), 0, Math.PI * 2);
              g.fill();
            }
          }
        }
        markDirty(w.x - w.size * 1.3, w.y - w.size * 1.1, w.size * 2.6, w.size * 1.6);
      }
      markDirty(w.x - ringR, w.y - ringR * 0.45, ringR * 2, ringR * 0.9);
    }
    // gulls: shadows first, then the birds
    const painted = sprites.gull;
    for (let pass = 0; pass < 2; pass++) {
      for (const f of flights) {
        const dir = f.vx > 0 ? 1 : -1;
        for (let b = 0; b < f.count; b++) {
          const x = f.x - dir * b * f.span * 1.35;
          const y = f.y + (b % 2 ? 1 : -1) * b * f.span * 0.45;
          // a few beats, then a glide
          const cyc = (life * 0.55 + f.seed + b * 0.21) % 1;
          const flap = cyc < 0.45 ? ((life * 2.6 + b * 0.3) % 1) : 0;
          if (pass === 0) {
            if (!painted) {
              drawGullShadow(g, x + f.span * 0.6, y + f.span * 1.5, f.span * 0.9, flap);
              markDirty(x + f.span * 0.1, y + f.span * 1.1, f.span * 1.1, f.span * 0.8);
            }
          } else if (painted) {
            const s = painted[b % painted.length];
            drawSprite(s, flap * s.info.count, x, y, f.span * 1.15, 1, dir < 0);
          } else {
            drawGull(g, x, y, f.span, flap, dir as 1 | -1);
            markDirty(x - f.span * 0.6, y - f.span * 0.4, f.span * 1.2, f.span * 0.8);
          }
        }
      }
    }
    // clouds, parallax: a little faster than the chart
    const paintedCloud = sprites.cloud;
    for (const c of clouds) {
      const drift = c.sx + c.speed * life;
      const sx = ((((drift - sl * CLOUD_PARALLAX) % field) + field) % field) - maxW;
      const x = sl + sx;
      if (paintedCloud) drawSprite(paintedCloud[c.variant % paintedCloud.length], 0, x + c.w / 2, c.y + c.h / 2, c.w, c.alpha + 0.2, false);
      else {
        const art = cloudArt[c.variant % Math.max(1, cloudArt.length)];
        if (art) {
          g.globalAlpha = c.alpha;
          g.drawImage(art, x, c.y, c.w, c.h);
          g.globalAlpha = 1;
          markDirty(x, c.y, c.w, c.h);
        }
      }
    }
  };

  /**
   * The life canvas only ever holds what the last frame drew, and every draw marks its rectangle
   * (markDirty), so clearing last frame's rectangles empties it — no full-canvas clear per frame.
   */
  const lifeFrame = (): void => {
    if (!g || !L) return;
    g.setTransform(ls, 0, 0, ls, -anchor * ls, 0);
    for (let i = 0; i < dirtyPrev.length; i += 4) g.clearRect(dirtyPrev[i] - 2, dirtyPrev[i + 1] - 2, dirtyPrev[i + 2] + 4, dirtyPrev[i + 3] + 4);
    drawLife();
    dirtyPrev.length = 0;
    for (const v of dirtyNext) dirtyPrev.push(v);
  };

  // ---- DOM strips (painted sail / ripple frames)
  const domFrames = (): void => {
    const sail = sprites.shipSail?.[0];
    if (sail && sail.info.count > 1) {
      const f = cfg.still ? 0 : Math.floor(life * sail.info.fps) % sail.info.count;
      if (f !== lastShipFrame) {
        lastShipFrame = f;
        for (const s of shipEls) if (s.strip) setStripFrame(s.strip, sail, f);
      }
    }
    const rp = sprites.ripple?.[0];
    if (rp && rp.info.count > 1) {
      const f = cfg.still ? 0 : Math.floor(life * rp.info.fps) % rp.info.count;
      if (f !== lastRippleFrame) {
        lastRippleFrame = f;
        for (const r of rippleEls) setStripFrame(r.firstElementChild as HTMLElement, rp, f);
      }
    }
  };

  // ---- one frame
  const drawWater = (): void => {
    if (!wantWater() || !water.ready || !L) return;
    wf.x0 = anchor;
    wf.y0 = 0;
    wf.w = cw;
    wf.h = viewH;
    wf.tileH = viewH;
    wf.tileW = viewH * seaAspect;
    wf.phase = clock / SEA_PERIOD;
    wf.amp = cfg.amp;
    wf.foam = sprites.foam ? 0 : 1;
    wf.glint = sprites.sparkle ? 0 : cfg.density;
    wf.shadow = sprites.cloudShadow ? 0 : 1;
    const sl = scroll.scrollLeft;
    wf.hint[0] = hintScreen[0] + sl;
    wf.hint[1] = hintScreen[1];
    wf.hint[2] = hintScreen[2] + sl;
    wf.hint[3] = hintScreen[3];
    wf.top = topBand;
    if (water.draw(wf) && !root.classList.contains('sea-live')) root.classList.add('sea-live');
  };

  let lastWater = -1e9;
  const frame = (dtMs: number): void => {
    const t0 = performance.now();
    if (!cfg.still) {
      clock = advanceClock(clock, dtMs);
      life += Math.min(Math.max(dtMs, 0), 100) / 1000;
    }
    // The water moves slowly: 30 fps is enough for it on every tier (half the GPU work on a 60 Hz
    // screen); gulls and clouds keep the display's rate. A moved layer must redraw at once.
    if (ensureAnchor() || cfg.still || t0 - lastWater >= WATER_MIN_MS - 3) {
      lastWater = t0;
      drawWater();
    }
    updateLife(Math.min(Math.max(dtMs, 0), 100) / 1000);
    lifeFrame();
    domFrames();
    const ms = performance.now() - t0;
    st.frames++;
    st.drawMs += ms;
    st.drawMax = Math.max(st.drawMax, ms);
  };

  // ---- loop
  let raf = 0;
  let lastDraw = 0;
  let running = false;
  const tick = (now: number): void => {
    raf = 0;
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const minMs = Math.max(cfg.minFrameMs, anySheetOpen() ? 50 : 0);
    if (lastDraw && now - lastDraw < minMs - 3) return;
    const dt = lastDraw ? now - lastDraw : 16.7;
    lastDraw = now;
    frame(dt);
    governor(now, dt);
  };
  const start = (): void => {
    if (cfg.still || document.hidden || !L) return;
    running = true;
    root.classList.remove('sea-paused');
    if (!raf) {
      lastDraw = 0;
      raf = requestAnimationFrame(tick);
    }
  };
  const stop = (): void => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  let stillQueued = false;
  function requestStill(): void {
    if (running || stillQueued) return;
    stillQueued = true;
    requestAnimationFrame(() => {
      stillQueued = false;
      if (!running && L) frame(0);
    });
  }

  const governor = (now: number, dt: number): void => {
    if (!cfg.auto || cfg.still || govSteps >= 2) return;
    if (!govT0) govT0 = now;
    govFrames++;
    govSum += dt;
    if (now - govT0 < 2000) return;
    const avg = govSum / Math.max(1, govFrames);
    govSlow = frameWindowSlow(avg, cfg.minFrameMs) ? govSlow + 1 : 0;
    govT0 = now;
    govFrames = 0;
    govSum = 0;
    if (govSlow >= 2) {
      const next = stepDownTier(cfg.tier);
      govSlow = 0;
      if (next) {
        govSteps++;
        tierNow = next;
        reconfigure();
      } else if (wantWater()) {
        govSteps++;
        waterOff = true;
        ensureWater();
      }
    }
  };

  const reconfigure = (): void => {
    const before = cfg;
    cfg = seaConfig(inputs, tierNow);
    applyClasses();
    if (before.clouds !== cfg.clouds) buildClouds();
    if (before.tier !== cfg.tier) sizeCanvases();
    if (cfg.still) {
      stop();
      flights.length = 0;
      whale = null;
      twinkles.length = 0;
      requestStill();
    } else start();
    ensureWater();
  };

  // ---- events
  scroll.addEventListener(
    'scroll',
    () => {
      if (!running && L && ensureAnchor()) requestStill();
    },
    { passive: true },
  );
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stop();
      root.classList.add('sea-paused');
    } else start();
  });
  window.addEventListener(GRAPHICS_EVENT, () => {
    inputs = readInputs(q);
    tierNow = undefined;
    govSteps = 0;
    reconfigure();
    sizeCanvases();
    requestStill();
  });

  // ---- assets
  /** Starts the water when wanted (first time: WebGL + the painting), hides it when not. */
  function ensureWater(): void {
    const on = wantWater();
    water.canvas.hidden = !on;
    if (!on) {
      root.classList.remove('sea-live');
      return;
    }
    if (waterInit) return;
    waterInit = true;
    if (!water.init()) return;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      seaAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
      water.uploadSea(img);
      sizeCanvases();
      if (running) return;
      start();
      requestStill();
    };
    img.src = seaTextureUrl(manifest, cfg.tier === 'low');
  }
  ensureWater();
  const cloudRand = seaRng(0xc10d);
  for (let i = 0; i < 3; i++) {
    const puffs = cloudPuffs(cloudRand, 360, 150);
    cloudArt.push(paintCloud(puffs, 360, 150));
    cloudShade.push(paintCloud(puffs, 360, 150, true));
  }
  void loadSeaSprites(manifest).then((s) => {
    sprites = s;
    buildClouds();
    for (const sh of shipEls) dressShip(sh);
    for (const r of rippleEls) dressRipple(r);
    lastShipFrame = lastRippleFrame = -1;
    requestStill();
  });

  const dressShip = (sh: { strip: HTMLElement | null; root: HTMLElement }): void => {
    const sail = sprites.shipSail?.[0];
    if (!sail || sh.strip) return;
    const strip = el('span', 'pu-ship-strip');
    setStripFrame(strip, sail, 0);
    sh.root.append(strip);
    sh.root.classList.add('painted-sail');
    sh.strip = strip;
  };
  const dressRipple = (r: HTMLElement): void => {
    const rp = sprites.ripple?.[0];
    if (!rp) return;
    r.classList.add('painted', rp.info.count > 1 ? 'strip' : 'still-art');
    for (const ring of Array.from(r.children) as HTMLElement[]) setStripFrame(ring, rp, 0);
  };

  window.__sea = {
    stats: (): SeaStats => {
      const secs = Math.max(0.001, (performance.now() - st.t0) / 1000);
      return {
        tier: cfg.tier,
        still: cfg.still,
        gl: water.ready && wantWater(),
        waterPx: [water.canvas.width, water.canvas.height],
        lifePx: [lifeCanvas.width, lifeCanvas.height],
        frames: st.frames,
        drawMs: +(st.drawMs / Math.max(1, st.frames)).toFixed(3),
        drawMaxMs: +st.drawMax.toFixed(2),
        fps: +(st.frames / secs).toFixed(1),
        painted: Object.keys(sprites),
        gulls: st.gulls,
        whales: st.whales,
        clouds: clouds.length,
      };
    },
    resetStats: () => {
      st.frames = 0;
      st.drawMs = 0;
      st.drawMax = 0;
      st.t0 = performance.now();
    },
    whaleNow: () => {
      whaleTimer = 0;
      return cfg.whale;
    },
  };

  return {
    layout(layout, h, top, hint) {
      L = layout;
      worldW = layout.worldW;
      viewH = h;
      topBand = top;
      hintEl = hint;
      const r = hintEl?.getBoundingClientRect();
      if (r && r.width > 0) {
        hintScreen[0] = r.left;
        hintScreen[1] = r.top;
        hintScreen[2] = r.right;
        hintScreen[3] = r.bottom;
      }
      nodesPt = layout.nodes.map((n) => ({ x: n.x, y: n.y }));
      sizeCanvases();
      buildCalm();
      buildClouds();
      flights.length = 0;
      twinkles.length = 0;
      whale = null;
      // the life layer runs at once; the water fades in over the CSS painting when it is ready
      // (no WebGL / water off: the painting simply stays)
      start();
      requestStill();
    },
    decorateNode(b, i, frontier) {
      b.style.setProperty('--bob', `${(-((i * 1.37) % 6.2)).toFixed(2)}s`);
      if (!frontier) return;
      const ring = el('span', 'pu-node-ripple', { 'aria-hidden': 'true' }, el('i', ''), el('i', ''));
      rippleEls.length = 0;
      rippleEls.push(ring);
      dressRipple(ring);
      b.prepend(ring);
    },
    ship() {
      const rootEl = el('span', 'pu-node-flag pu-ship', { 'aria-hidden': 'true' });
      const part = (cls: string): HTMLImageElement => {
        const im = document.createElement('img');
        im.src = SHIP_URL;
        im.alt = '';
        im.className = cls;
        im.draggable = false;
        return im;
      };
      const win = (cls: string): HTMLElement => el('span', `pu-ship-win ${cls}`, {}, part(''));
      rootEl.append(part('pu-ship-hull'), win('pu-ship-sail'), win('pu-ship-pennant'));
      const entry = { strip: null as HTMLElement | null, root: rootEl };
      shipEls.length = 0;
      shipEls.push(entry);
      dressShip(entry);
      lastShipFrame = -1;
      return rootEl;
    },
    setGrade(g) {
      water.setGrade(g);
      requestStill();
    },
  };
}

/** Shows frame `f` of a painted strip as an element's background (any grid). */
function setStripFrame(e: HTMLElement, s: SeaSprite, f: number): void {
  const [sx, sy, sw, sh] = frameRect(s.info, f);
  const iw = s.img.width;
  const ih = s.img.height;
  e.style.backgroundImage = `url("${s.url}")`;
  e.style.backgroundSize = `${((iw / sw) * 100).toFixed(3)}% ${((ih / sh) * 100).toFixed(3)}%`;
  const px = iw > sw ? (sx / (iw - sw)) * 100 : 0;
  const py = ih > sh ? (sy / (ih - sh)) * 100 : 0;
  e.style.backgroundPosition = `${px.toFixed(3)}% ${py.toFixed(3)}%`;
}
