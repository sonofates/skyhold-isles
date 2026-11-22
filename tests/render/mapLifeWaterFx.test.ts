import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Container, Texture } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { LAYOUT_HEIGHT, LAYOUT_WIDTH } from '../../src/render2d/ambientFx.ts';
import { WorldLayers } from '../../src/render2d/layers.ts';
import { mapAnimLayer } from '../../src/render2d/mapAnimLayer.ts';
import {
  clampedHazeStrength,
  clampedWaterStrength,
  effectiveDustCount,
  getMapLifeConfig,
  mapLifeAtlasRefCount,
  mapLifeLayer,
  MapLifeLayer,
  MAX_DUST_WISPS,
  MAX_HAZE_STRENGTH_PX,
  MAX_WATER_REGIONS,
  MAX_WATER_STRENGTH_PX,
  packWaterRegions,
} from '../../src/render2d/mapLifeLayer.ts';
import { MapView } from '../../src/render2d/mapView.ts';
import { parseLevel2D } from '../../src/data/levels2d/loader.ts';
import i10Raw from '../../src/data/levels2d/i10.json';
import i14Raw from '../../src/data/levels2d/i14.json';
import i15Raw from '../../src/data/levels2d/i15.json';

interface RawLevel2D {
  imageSize: [number, number];
  paths: [number, number][][];
  plots: [number, number][];
  plotRadiusPx?: number;
  goal?: [number, number];
  entrances?: { id: string; x: number; y: number }[];
}

interface RawMapAnim {
  elements: { id: string; rect: [number, number, number, number] }[];
}

function decodeSurfaceMask(
  island: string,
  stem: 'water' | 'haze',
  filePath: string,
): { width: number; height: number; data: Uint8Array } {
  const metaPath = resolve(process.cwd(), `tests/fixtures/${island}-${stem}-mask.json`);
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { sha256: string };
  const shipped = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  expect(shipped, `${island}-${stem}.webp changed: regenerate tests/fixtures/${island}-${stem}-mask.*`).toBe(meta.sha256);

  const gzPath = resolve(process.cwd(), `tests/fixtures/${island}-${stem}-mask.gray.gz`);
  const out = gunzipSync(readFileSync(gzPath));
  const nl = out.indexOf(0x0a);
  const [wStr, hStr] = out.subarray(0, nl).toString('utf8').split(' ');
  const width = Number(wStr);
  const height = Number(hStr);
  const data = new Uint8Array(out.buffer, out.byteOffset + nl + 1, width * height);
  return { width, height, data };
}

function installFakeDom(opts: { hidden?: boolean; reduced?: boolean; autoLoadImages?: boolean } = {}): {
  setHidden: (v: boolean) => void;
  setReduced: (v: boolean) => void;
  loadedSrcs: string[];
  restore: () => void;
} {
  const origDocument = globalThis.document;
  const origImage = globalThis.Image;
  let hidden = opts.hidden ?? false;
  let reduced = opts.reduced ?? false;
  const loadedSrcs: string[] = [];
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

  if (opts.autoLoadImages) {
    class FakeImage {
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      complete = false;
      naturalWidth = 0;
      naturalHeight = 0;
      width = 923;
      height = 426;
      private _src = '';
      get src(): string {
        return this._src;
      }
      set src(v: string) {
        this._src = v;
        loadedSrcs.push(v);
        this.complete = true;
        this.naturalWidth = 923;
        this.naturalHeight = 426;
        this.onload?.();
      }
    }
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage });
  }

  return {
    setHidden: (v: boolean) => {
      hidden = v;
    },
    setReduced: (v: boolean) => {
      reduced = v;
    },
    loadedSrcs,
    restore: () => {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: origDocument });
      Object.defineProperty(globalThis, 'Image', { configurable: true, value: origImage });
    },
  };
}

afterEach(() => {
  expect(mapLifeAtlasRefCount()).toBe(0);
});

describe('water, heat-haze & desert dust pure helpers and configs', () => {
  it('clamps water/haze strength, scales dust count by tier, and packs per-region flow vectors', () => {
    expect(clampedWaterStrength(1.25)).toBeCloseTo(1.25, 5);
    expect(clampedWaterStrength(5)).toBe(MAX_WATER_STRENGTH_PX);
    expect(clampedWaterStrength(-1)).toBe(0);
    expect(clampedWaterStrength(Number.NaN)).toBe(0);

    expect(clampedHazeStrength(0.62)).toBeCloseTo(0.62, 5);
    expect(clampedHazeStrength(4)).toBe(MAX_HAZE_STRENGTH_PX);
    expect(clampedHazeStrength(-0.5)).toBe(0);

    expect(effectiveDustCount(10, 'low')).toBe(0);
    expect(effectiveDustCount(10, 'med')).toBe(6);
    expect(effectiveDustCount(10, 'high')).toBe(10);
    expect(effectiveDustCount(99, 'high')).toBe(MAX_DUST_WISPS);
    expect(effectiveDustCount(0, 'high')).toBe(0);

    const packed = packWaterRegions(
      [
        { rect: [184.6, 85.2, 369.2, 170.4], dir: [3, 4], speedMul: 1.5, glintMul: 1.3 },
        { rect: [0, 0, 100, 100], dir: [0, 0], speedMul: 0, glintMul: 1.2 },
      ],
      1846,
      852,
    );
    expect(packed.count).toBe(2);
    expect(packed.rects[0]).toBeCloseTo(0.1, 4);
    expect(packed.rects[1]).toBeCloseTo(0.1, 4);
    expect(packed.rects[2]).toBeCloseTo(0.3, 4);
    expect(packed.rects[3]).toBeCloseTo(0.3, 4);
    expect(packed.vecs[0]).toBeCloseTo(0.6, 4);
    expect(packed.vecs[1]).toBeCloseTo(0.8, 4);
    expect(packed.vecs[2]).toBeCloseTo(1.5, 4);
    expect(packed.vecs[3]).toBeCloseTo(1.3, 4);
    // Still region preserves [0, 0] direction.
    expect(packed.vecs[4]).toBe(0);
    expect(packed.vecs[5]).toBe(0);
    expect(packed.vecs[6]).toBe(0);

    // Caps region count at MAX_WATER_REGIONS.
    const many = Array.from({ length: 10 }, () => ({ rect: [0, 0, 10, 10] as const, dir: [1, 0] as const }));
    expect(packWaterRegions(many, 1846, 852).count).toBe(MAX_WATER_REGIONS);
  });

  it('loads opt-in water/dust/haze configs for i10, i14, i15 without altering other islands', () => {
    const i10 = getMapLifeConfig('i10')!;
    expect(i10.wind?.mask).toBe('life/i10-sway.webp');
    expect(i10.water?.mask).toBe('life/i10-water.webp');
    expect(i10.water!.strength).toBeGreaterThan(0);
    expect(i10.water!.strength).toBeLessThanOrEqual(MAX_WATER_STRENGTH_PX);
    expect(i10.water!.flowSpeed).toBeGreaterThan(0);
    expect(i10.water!.regions?.length).toBeGreaterThanOrEqual(4);
    expect(i10.dust).toBeUndefined();

    const i14 = getMapLifeConfig('i14')!;
    expect(i14.wind).toBeUndefined();
    expect(i14.water).toBeUndefined();
    expect(i14.heatHaze?.mask).toBe('life/i14-haze.webp');
    expect(i14.heatHaze!.strength).toBeGreaterThan(0);
    expect(i14.heatHaze!.strength).toBeLessThanOrEqual(MAX_HAZE_STRENGTH_PX);
    expect(i14.dust?.count).toBeGreaterThanOrEqual(6);
    expect(i14.dust!.alpha).toBeLessThanOrEqual(0.18);
    expect(i14.clouds?.count).toBe(2);
    expect(i14.birds).toBeDefined();

    const i15 = getMapLifeConfig('i15')!;
    expect(i15.wind?.mask).toBe('life/i15-sway.webp');
    expect(i15.water?.mask).toBe('life/i15-water.webp');
    expect(i15.water!.strength).toBeGreaterThan(0);
    expect(i15.water!.strength).toBeLessThanOrEqual(MAX_WATER_STRENGTH_PX);
    expect(i15.water!.flowSpeed).toBe(0);
    expect(i15.dust).toBeUndefined();

    // Unrelated islands stay opt-out for water/dust/haze.
    const i17 = getMapLifeConfig('i17')!;
    expect(i17.water).toBeUndefined();
    expect(i17.heatHaze).toBeUndefined();
    expect(i17.dust).toBeUndefined();
  });
});

describe('i10, i14, i15 water & sand-haze mask cleanliness', () => {
  const CASES: readonly { island: 'i10' | 'i14' | 'i15'; stem: 'water' | 'haze'; minCoverage: number }[] = [
    { island: 'i10', stem: 'water', minCoverage: 0.003 },
    { island: 'i14', stem: 'haze', minCoverage: 0.12 },
    { island: 'i15', stem: 'water', minCoverage: 0.015 },
  ];

  it.each(CASES)(
    '$island $stem mask is strictly zero on every path vertex, path midpoint, plot centre/rim, entrance, goal, and mapAnim rect centre',
    ({ island, stem, minCoverage }) => {
      const cfg = getMapLifeConfig(island)!;
      const maskRel = stem === 'water' ? cfg.water!.mask : cfg.heatHaze!.mask;
      const maskPath = resolve(process.cwd(), 'public/art2d', maskRel);
      expect(existsSync(maskPath), `missing mask at ${maskPath}`).toBe(true);

      const level = JSON.parse(readFileSync(resolve(process.cwd(), `src/data/levels2d/${island}.json`), 'utf8')) as RawLevel2D;
      const [iw, ih] = level.imageSize;
      expect(iw).toBe(LAYOUT_WIDTH);
      expect(ih).toBe(LAYOUT_HEIGHT);

      const { width, height, data } = decodeSurfaceMask(island, stem, maskPath);
      expect(width).toBeGreaterThan(200);
      expect(height).toBeGreaterThan(100);
      expect(width / height).toBeCloseTo(iw / ih, 2);

      const sampleAt = (lx: number, ly: number): number => {
        const mx = Math.max(0, Math.min(width - 1, Math.round((lx / iw) * width)));
        const my = Math.max(0, Math.min(height - 1, Math.round((ly / ih) * height)));
        return data[my * width + mx];
      };

      let nonZero = 0;
      for (let i = 0; i < data.length; i++) if (data[i] > 0) nonZero++;
      expect(nonZero / data.length).toBeGreaterThan(minCoverage);

      // Every path vertex and segment midpoint must be strictly 0.
      for (let pi = 0; pi < level.paths.length; pi++) {
        const path = level.paths[pi];
        for (let i = 0; i < path.length; i++) {
          const [x, y] = path[i];
          expect(sampleAt(x, y), `${island} path[${pi}][${i}] (${x},${y}) must have 0 ${stem}`).toBe(0);
          if (i > 0) {
            const mx = (path[i - 1][0] + x) * 0.5;
            const my = (path[i - 1][1] + y) * 0.5;
            expect(sampleAt(mx, my), `${island} path[${pi}] midpoint (${mx},${my}) must have 0 ${stem}`).toBe(0);
          }
        }
      }

      // Every plot centre and rim points must be strictly 0.
      const r = level.plotRadiusPx ?? 48;
      for (let i = 0; i < level.plots.length; i++) {
        const [px, py] = level.plots[i];
        expect(sampleAt(px, py), `${island} plot[${i}] centre (${px},${py}) must have 0 ${stem}`).toBe(0);
        expect(sampleAt(px - r * 0.85, py), `${island} plot[${i}] west rim must have 0 ${stem}`).toBe(0);
        expect(sampleAt(px + r * 0.85, py), `${island} plot[${i}] east rim must have 0 ${stem}`).toBe(0);
        expect(sampleAt(px, py - r * 0.55), `${island} plot[${i}] north rim must have 0 ${stem}`).toBe(0);
        expect(sampleAt(px, py + r * 0.55), `${island} plot[${i}] south rim must have 0 ${stem}`).toBe(0);
      }

      // Entrances and goal must be strictly 0.
      for (const ent of level.entrances ?? []) {
        expect(sampleAt(ent.x, ent.y), `${island} entrance ${ent.id} must have 0 ${stem}`).toBe(0);
      }
      if (level.goal) {
        expect(sampleAt(level.goal[0], level.goal[1]), `${island} goal must have 0 ${stem}`).toBe(0);
      }

      // Existing mapAnim video-loop rects must be strictly 0 at their centres.
      const animPath = resolve(process.cwd(), `src/data/mapAnim/${island}.json`);
      if (existsSync(animPath)) {
        const anim = JSON.parse(readFileSync(animPath, 'utf8')) as RawMapAnim;
        for (const el of anim.elements) {
          const [rx, ry, rw, rh] = el.rect;
          expect(sampleAt(rx + rw * 0.5, ry + rh * 0.5), `${island} mapAnim ${el.id} must have 0 ${stem}`).toBe(0);
        }
      }
    },
  );
});

describe('MapLifeLayer water, haze & desert dust runtime lifecycle', () => {
  it('folds wind + water into ONE fullscreen mesh pass on i10 and i15, and haze-only into ONE pass on i14', () => {
    const dom = installFakeDom({ autoLoadImages: true });
    try {
      for (const [island, raw, expectSway, expectWater, expectHaze] of [
        ['i10', i10Raw, true, true, false],
        ['i14', i14Raw, false, false, true],
        ['i15', i15Raw, true, true, false],
      ] as const) {
        const layout = parseLevel2D(raw);
        const map = new MapView(Texture.EMPTY, layout);
        const layers = new WorldLayers(map.world);
        mapAnimLayer(map.world, island, '/art2d/');
        const life = mapLifeLayer(map.world, map, layers, island, '/art2d/')!;

        life.update(true, false, false, 1 / 60, 'high');
        const st = life.debug();
        expect(st.built).toBe(true);
        expect(st.enabled).toBe(true);
        expect(st.swayReady).toBe(expectSway);
        expect(st.waterReady).toBe(expectWater);
        expect(st.hazeReady).toBe(expectHaze);

        // Single full-map surface pass budget: swayHost -> swayRoot -> exactly 1 Mesh child!
        const swayHost = map.world.children[1] as Container;
        const swayRoot = swayHost.children[0] as Container;
        expect(swayRoot.children.length, `${island} must use at most 1 fullscreen surface Mesh`).toBe(1);

        if (island === 'i14') {
          expect(st.activeDust).toBe(10);
          // Medium tier trims dust wisps.
          life.update(true, false, true, 1 / 60, 'med');
          expect(life.debug().smallBake).toBe(true);
          expect(life.debug().activeDust).toBe(6);
        }

        // Clean teardown frees everything including atlas.
        map.world.destroy({ children: true });
        expect(mapLifeAtlasRefCount()).toBe(0);
      }
    } finally {
      dom.restore();
    }
  });

  it('respects low tier, reduced motion, hidden tab, pause, and destroy across i10, i14, i15', () => {
    const dom = installFakeDom();
    try {
      for (const island of ['i10', 'i14', 'i15'] as const) {
        const cfg = getMapLifeConfig(island)!;
        const layer = new MapLifeLayer(cfg, '/art2d/');

        // Low tier -> off & unbuilt.
        layer.update(true, false, false, 1 / 60, 'low');
        expect(layer.debug().built).toBe(false);
        expect(layer.debug().enabled).toBe(false);
        expect(layer.debug().activeDust).toBe(0);

        // Reduced motion -> off & unbuilt.
        dom.setReduced(true);
        layer.update(true, false, false, 1 / 60, 'high');
        expect(layer.debug().built).toBe(false);
        expect(layer.debug().enabled).toBe(false);
        dom.setReduced(false);

        // Hidden tab -> paused & unbuilt.
        dom.setHidden(true);
        layer.update(true, false, false, 1 / 60, 'high');
        expect(layer.debug().built).toBe(false);
        expect(layer.debug().paused).toBe(true);
        dom.setHidden(false);

        // High tier -> builds & warms.
        layer.update(true, false, false, 1 / 60, 'high');
        const warm = layer.debug();
        expect(warm.built).toBe(true);
        expect(warm.enabled).toBe(true);
        expect(warm.time).toBeCloseTo(0.5, 3);
        if (island === 'i14') expect(warm.activeDust).toBe(10);

        // Pause freezes time.
        const tBefore = warm.time;
        layer.update(true, true, false, 0.08, 'high');
        layer.update(true, true, false, 0.08, 'high');
        expect(layer.debug().paused).toBe(true);
        expect(layer.debug().time).toBe(tBefore);

        // Reduced motion mid-run disables immediately.
        dom.setReduced(true);
        layer.update(true, false, false, 1 / 60, 'high');
        expect(layer.debug().enabled).toBe(false);
        expect(layer.debug().activeDust).toBe(0);
        dom.setReduced(false);

        layer.destroy();
        expect(layer.swayRoot.destroyed).toBe(true);
        expect(layer.butterflyRoot.destroyed).toBe(true);
        expect(layer.skyRoot.destroyed).toBe(true);
        expect(mapLifeAtlasRefCount()).toBe(0);
      }
    } finally {
      dom.restore();
    }
  });
});
