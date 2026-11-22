import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Container, Sprite, Texture } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { LAYOUT_HEIGHT, LAYOUT_WIDTH } from '../../src/render2d/ambientFx.ts';
import { WorldLayers } from '../../src/render2d/layers.ts';
import { mapAnimLayer } from '../../src/render2d/mapAnimLayer.ts';
import {
  clampedSwayStrength,
  effectiveBirdCap,
  effectiveButterflyCount,
  effectiveCloudCount,
  getMapLifeConfig,
  listMapLifeConfigs,
  mapLifeAtlasRefCount,
  mapLifeLayer,
  MapLifeLayer,
  MAX_SWAY_STRENGTH_PX,
  normalizeDir,
  wrapCoord,
} from '../../src/render2d/mapLifeLayer.ts';
import { MapView } from '../../src/render2d/mapView.ts';
import { parseLevel2D } from '../../src/data/levels2d/loader.ts';
import i17Raw from '../../src/data/levels2d/i17.json';

interface RawLevel2D {
  imageSize: [number, number];
  paths: [number, number][][];
  plots: [number, number][];
  plotRadiusPx?: number;
  goal?: [number, number];
  entrances?: { id: string; x: number; y: number }[];
}

function decodeGrayscaleMask(filePath: string): { width: number; height: number; data: Uint8Array } {
  const py = [
    'import sys',
    'from PIL import Image',
    'im = Image.open(sys.argv[1]).convert("L")',
    'sys.stdout.buffer.write(f"{im.width} {im.height}\\n".encode())',
    'sys.stdout.buffer.write(im.tobytes())',
  ].join('; ');
  const out = execFileSync('python3', ['-c', py, filePath], { maxBuffer: 8 * 1024 * 1024 });
  const nl = out.indexOf(0x0a);
  const [wStr, hStr] = out.subarray(0, nl).toString('utf8').split(' ');
  const width = Number(wStr);
  const height = Number(hStr);
  const data = new Uint8Array(out.buffer, out.byteOffset + nl + 1, width * height);
  return { width, height, data };
}

function installFakeDom(opts: { hidden?: boolean; reduced?: boolean } = {}): {
  setHidden: (v: boolean) => void;
  setReduced: (v: boolean) => void;
  restore: () => void;
} {
  const origDocument = globalThis.document;
  let hidden = opts.hidden ?? false;
  let reduced = opts.reduced ?? false;
  const noop = (): void => undefined;
  const fakeGrad = { addColorStop: noop };
  const fakeCtx = {
    save: noop,
    restore: noop,
    beginPath: noop,
    rect: noop,
    clip: noop,
    createRadialGradient: () => fakeGrad,
    createLinearGradient: () => fakeGrad,
    fillRect: noop,
    translate: noop,
    scale: noop,
    arc: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    moveTo: noop,
    lineTo: noop,
    bezierCurveTo: noop,
    quadraticCurveTo: noop,
    closePath: noop,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      get hidden() {
        return hidden;
      },
      documentElement: {
        classList: {
          contains: (cls: string) => cls === 'pu-reduce-motion' && reduced,
        },
      },
      createElement: (tag: string) =>
        tag === 'canvas' ? { width: 512, height: 256, getContext: () => fakeCtx } : {},
    },
  });
  return {
    setHidden: (v: boolean) => {
      hidden = v;
    },
    setReduced: (v: boolean) => {
      reduced = v;
    },
    restore: () => {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: origDocument });
    },
  };
}

afterEach(() => {
  expect(mapLifeAtlasRefCount()).toBe(0);
});

describe('mapLife pure helpers & config loading', () => {
  it('normalizes wind directions, clamps sway strength, scales tiers, and wraps coordinates', () => {
    const [dx, dy] = normalizeDir([3, 4]);
    expect(dx).toBeCloseTo(0.6, 5);
    expect(dy).toBeCloseTo(0.8, 5);
    expect(normalizeDir([0, 0])).toEqual([1, 0]);
    expect(normalizeDir(undefined)).toEqual([1, 0]);

    expect(clampedSwayStrength(2.1)).toBeCloseTo(2.1, 5);
    expect(clampedSwayStrength(99)).toBe(MAX_SWAY_STRENGTH_PX);
    expect(clampedSwayStrength(-2)).toBe(0);

    expect(effectiveCloudCount(3, 'low')).toBe(0);
    expect(effectiveCloudCount(3, 'med')).toBe(2);
    expect(effectiveCloudCount(3, 'high')).toBe(3);

    expect(effectiveBirdCap([4, 6], 'low')).toBe(0);
    expect(effectiveBirdCap([4, 6], 'med')).toBe(4);
    expect(effectiveBirdCap([4, 6], 'high')).toBe(6);

    expect(effectiveButterflyCount(7, 'low')).toBe(0);
    expect(effectiveButterflyCount(7, 'med')).toBe(0);
    expect(effectiveButterflyCount(7, 'high')).toBe(7);

    expect(wrapCoord(110, 0, 100)).toBeCloseTo(10, 5);
    expect(wrapCoord(-15, 0, 100)).toBeCloseTo(85, 5);
  });

  it('loads data-driven config for i17 and returns undefined for unconfigured islands', () => {
    const cfg = getMapLifeConfig('i17');
    expect(cfg).toBeDefined();
    expect(cfg?.island).toBe('i17');
    expect(cfg?.wind?.mask).toBe('life/i17-sway.webp');
    expect(cfg?.wind?.strength).toBeGreaterThan(0);
    expect(cfg?.wind?.strength).toBeLessThanOrEqual(MAX_SWAY_STRENGTH_PX);
    expect(cfg?.clouds?.count).toBeGreaterThanOrEqual(2);
    expect(cfg?.clouds?.count).toBeLessThanOrEqual(4);
    expect(cfg?.birds?.flockSize[0]).toBeGreaterThanOrEqual(3);
    expect(cfg?.birds?.flockSize[1]).toBeLessThanOrEqual(7);
    expect(cfg?.butterflies?.count).toBeGreaterThan(0);
    expect(cfg?.butterflies?.zones.length).toBeGreaterThan(0);

    expect(listMapLifeConfigs().some((c) => c.island === 'i17')).toBe(true);
    expect(getMapLifeConfig('i01')).toBeUndefined();
    expect(getMapLifeConfig('nonexistent')).toBeUndefined();

    // Islands without a config file get nothing (no behaviour change).
    const world = new Container();
    world.addChild(new Sprite(Texture.EMPTY));
    const layers = new WorldLayers(world);
    expect(mapLifeLayer(world, null, layers, 'i01', '/art2d/')).toBeUndefined();
    world.destroy({ children: true });
  });
});

describe('i17 precomputed sway mask cleanliness', () => {
  it('is strictly zero on every path point, path midpoint, and plot centre of i17', () => {
    const cfg = getMapLifeConfig('i17')!;
    const maskPath = resolve(process.cwd(), 'public/art2d', cfg.wind!.mask);
    expect(existsSync(maskPath), `missing sway mask at ${maskPath}`).toBe(true);

    const levelPath = resolve(process.cwd(), 'src/data/levels2d/i17.json');
    const level = JSON.parse(readFileSync(levelPath, 'utf8')) as RawLevel2D;
    const [iw, ih] = level.imageSize;
    expect(iw).toBe(LAYOUT_WIDTH);
    expect(ih).toBe(LAYOUT_HEIGHT);

    const { width, height, data } = decodeGrayscaleMask(maskPath);
    expect(width).toBeGreaterThan(200);
    expect(height).toBeGreaterThan(100);
    expect(width / height).toBeCloseTo(iw / ih, 2);

    const sampleAt = (lx: number, ly: number): number => {
      const mx = Math.max(0, Math.min(width - 1, Math.round((lx / iw) * width)));
      const my = Math.max(0, Math.min(height - 1, Math.round((ly / ih) * height)));
      return data[my * width + mx];
    };

    // Must cover substantial grass area (not an empty black mask).
    let nonZero = 0;
    for (let i = 0; i < data.length; i++) if (data[i] > 0) nonZero++;
    expect(nonZero / data.length).toBeGreaterThan(0.15);

    // Every path vertex and segment midpoint must be strictly 0.
    for (let pi = 0; pi < level.paths.length; pi++) {
      const path = level.paths[pi];
      for (let i = 0; i < path.length; i++) {
        const [x, y] = path[i];
        expect(sampleAt(x, y), `path[${pi}][${i}] (${x},${y}) must have 0 sway`).toBe(0);
        if (i > 0) {
          const mx = (path[i - 1][0] + x) * 0.5;
          const my = (path[i - 1][1] + y) * 0.5;
          expect(sampleAt(mx, my), `path[${pi}] midpoint (${mx},${my}) must have 0 sway`).toBe(0);
        }
      }
    }

    // Every plot centre (and ring perimeter points) must be strictly 0.
    const r = level.plotRadiusPx ?? 48;
    for (let i = 0; i < level.plots.length; i++) {
      const [px, py] = level.plots[i];
      expect(sampleAt(px, py), `plot[${i}] centre (${px},${py}) must have 0 sway`).toBe(0);
      expect(sampleAt(px - r * 0.85, py), `plot[${i}] west rim must have 0 sway`).toBe(0);
      expect(sampleAt(px + r * 0.85, py), `plot[${i}] east rim must have 0 sway`).toBe(0);
      expect(sampleAt(px, py - r * 0.55), `plot[${i}] north rim must have 0 sway`).toBe(0);
      expect(sampleAt(px, py + r * 0.55), `plot[${i}] south rim must have 0 sway`).toBe(0);
    }

    // Entrances and goal castle must be strictly 0.
    for (const ent of level.entrances ?? []) {
      expect(sampleAt(ent.x, ent.y), `entrance ${ent.id} must have 0 sway`).toBe(0);
    }
    if (level.goal) {
      expect(sampleAt(level.goal[0], level.goal[1]), 'goal must have 0 sway').toBe(0);
    }
  });
});

describe('MapLifeLayer runtime, tiers, pause, reduced motion, layering & destroy', () => {
  it('stays off on low tier / reduced motion, trims on med tier, freezes on pause, and spawns birds', () => {
    const dom = installFakeDom();
    try {
      const cfg = getMapLifeConfig('i17')!;
      const layer = new MapLifeLayer(cfg, '/art2d/');

      // Low tier: stays unbuilt and hidden.
      layer.update(true, false, false, 1 / 60, 'low');
      expect(layer.debug().built).toBe(false);
      expect(layer.debug().enabled).toBe(false);
      expect(layer.swayRoot.visible).toBe(false);
      expect(layer.skyRoot.visible).toBe(false);
      expect(layer.butterflyRoot.visible).toBe(false);
      expect(mapLifeAtlasRefCount()).toBe(0);

      // Reduced motion: stays unbuilt and hidden.
      dom.setReduced(true);
      layer.update(true, false, false, 1 / 60, 'high');
      expect(layer.debug().built).toBe(false);
      expect(layer.debug().enabled).toBe(false);
      expect(mapLifeAtlasRefCount()).toBe(0);

      // Hidden tab: stays unbuilt and hidden.
      dom.setReduced(false);
      dom.setHidden(true);
      layer.update(true, false, false, 1 / 60, 'high');
      expect(layer.debug().built).toBe(false);
      expect(layer.debug().paused).toBe(true);
      expect(mapLifeAtlasRefCount()).toBe(0);

      // High tier + visible + unpaused: builds lazily and warms.
      dom.setHidden(false);
      layer.update(true, false, false, 1 / 60, 'high');
      const warm = layer.debug();
      expect(warm.built).toBe(true);
      expect(warm.enabled).toBe(true);
      expect(warm.time).toBeCloseTo(0.5, 3);
      expect(warm.activeClouds).toBe(3);
      expect(warm.activeButterflies).toBe(7);
      expect(mapLifeAtlasRefCount()).toBe(1);

      // Pause freezes time completely.
      const tBefore = warm.time;
      layer.update(true, true, false, 0.05, 'high');
      layer.update(true, true, false, 0.05, 'high');
      expect(layer.debug().paused).toBe(true);
      expect(layer.debug().time).toBe(tBefore);

      // Medium tier trims clouds and disables butterflies.
      layer.update(true, false, true, 0.05, 'med');
      const med = layer.debug();
      expect(med.smallBake).toBe(true);
      expect(med.activeClouds).toBe(2);
      expect(med.activeButterflies).toBe(0);
      expect(med.time).toBeGreaterThan(tBefore);

      // Advance past initialDelay so a bird flock spawns and crosses.
      for (let i = 0; i < 40; i++) layer.step(0.1, 'high');
      const withBirds = layer.debug();
      expect(withBirds.flocksSpawned).toBeGreaterThanOrEqual(1);
      expect(withBirds.activeBirds).toBeGreaterThanOrEqual(3);
      expect(withBirds.activeBirds).toBeLessThanOrEqual(7);

      // Turning reduced motion ON disables immediately.
      dom.setReduced(true);
      layer.update(true, false, false, 1 / 60, 'high');
      expect(layer.debug().enabled).toBe(false);
      expect(layer.swayRoot.visible).toBe(false);
      expect(layer.skyRoot.visible).toBe(false);
      expect(layer.butterflyRoot.visible).toBe(false);

      layer.destroy();
      expect(layer.swayRoot.destroyed).toBe(true);
      expect(layer.butterflyRoot.destroyed).toBe(true);
      expect(layer.skyRoot.destroyed).toBe(true);
      expect(mapLifeAtlasRefCount()).toBe(0);
    } finally {
      dom.restore();
    }
  });

  it('mounts sway under ambient/plots, butterflies under plots, clouds+birds above units & below bars, and frees everything on destroy', () => {
    const dom = installFakeDom();
    try {
      const layout = parseLevel2D(i17Raw);
      const map = new MapView(Texture.EMPTY, layout);
      const layers = new WorldLayers(map.world);
      const ambient = mapAnimLayer(map.world, 'i17', '/art2d/')!;
      const life = mapLifeLayer(map.world, map, layers, 'i17', '/art2d/')!;

      // Verify exact child order in MapView.world:
      // [0] mapBase (edges + mapSprite)
      // [1] swayHost
      // [2] ambientHost (video loops + ambientFx stay visually on top of swaying map!)
      // [3] groundFx
      // [4] butterflyHost (above ground/ambient, strictly under plots & units)
      // [5] plots
      // ... shadows, actors, air, projectiles, fx ...
      // skyHost (clouds + birds: strictly above actors/air/projectiles/fx, strictly below bars & HUD)
      // bars (last)
      const kids = map.world.children;
      const groundFxIdx = kids.indexOf(layers.groundFx);
      const plotsIdx = kids.indexOf(layers.plots);
      const actorsIdx = kids.indexOf(layers.actors);
      const airIdx = kids.indexOf(layers.air);
      const fxIdx = kids.indexOf(layers.fx);
      const barsIdx = kids.indexOf(layers.bars);

      expect(groundFxIdx).toBe(3); // 0=mapBase, 1=swayHost, 2=ambientHost, 3=groundFx
      expect(plotsIdx).toBe(groundFxIdx + 2); // butterflyHost sits right before plots
      expect(barsIdx).toBe(fxIdx + 2); // skyHost sits right between fx and bars
      expect(barsIdx).toBeGreaterThan(airIdx);
      expect(barsIdx).toBeGreaterThan(actorsIdx);

      // Activating both ambient and life works cleanly.
      ambient.update(true, false, false, 1 / 60, 'high');
      life.update(true, false, false, 1 / 60, 'high');
      expect(life.debug().built).toBe(true);
      expect(mapLifeAtlasRefCount()).toBe(1);

      // Switching to low tier tears down runtime immediately and frees atlas.
      life.update(true, false, false, 1 / 60, 'low');
      expect(life.debug().built).toBe(false);
      expect(mapLifeAtlasRefCount()).toBe(0);

      // Re-enabling rebuilds cleanly.
      life.update(true, false, false, 1 / 60, 'high');
      expect(life.debug().built).toBe(true);
      expect(mapLifeAtlasRefCount()).toBe(1);

      const swayHost = kids[1];
      const butterflyHost = kids[plotsIdx - 1];
      const skyHost = kids[barsIdx - 1];

      // Destroying world (level change) destroys all hosts, sprites, and frees the shared atlas.
      map.world.destroy({ children: true });
      expect(swayHost.destroyed).toBe(true);
      expect(butterflyHost.destroyed).toBe(true);
      expect(skyHost.destroyed).toBe(true);
      expect(mapLifeAtlasRefCount()).toBe(0);
    } finally {
      dom.restore();
    }
  });
});
