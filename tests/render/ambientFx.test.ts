import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Container, Sprite, Texture } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AmbientFxLayer,
  effectiveParticleCap,
  effectiveRateScale,
  getAmbientFxConfig,
  GLOBAL_MAX_PARTICLES,
  hashSeed,
  LAYOUT_HEIGHT,
  LAYOUT_WIDTH,
  listAmbientFxConfigs,
  nextRand,
  parseHexColor,
  pointInPolygon,
  polylineLength,
  samplePolyline,
} from '../../src/render2d/ambientFx.ts';
import { setFxPrefs } from '../../src/render2d/fxLayer.ts';
import { WorldLayers } from '../../src/render2d/layers.ts';
import { mapAnimLayer } from '../../src/render2d/mapAnimLayer.ts';

const TARGET_LOW_LIFE_ISLANDS = [
  'i16',
  'i09',
  'i17',
  'i21',
  'i22',
  'i08',
  'i10',
  'i13',
  'i15',
  'i23',
  'i24',
  'l1c',
] as const;

interface RawLevel2D {
  plots?: ([number, number] | { x: number; y: number })[];
}

function loadLevelPlots(island: string): { x: number; y: number }[] {
  const file = resolve(process.cwd(), `src/data/levels2d/${island}.json`);
  const raw = JSON.parse(readFileSync(file, 'utf8')) as RawLevel2D;
  return (raw.plots ?? []).map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }));
}

afterEach(() => {
  setFxPrefs({ density: 1, reduceFlashes: false });
});

describe('ambientFx pure helpers', () => {
  it('parses 6-digit and 3-digit hex colors with fallback', () => {
    expect(parseHexColor('#ff4e14', 0)).toBe(0xff4e14);
    expect(parseHexColor('2ef2b2', 0)).toBe(0x2ef2b2);
    expect(parseHexColor('#f80', 0)).toBe(0xff8800);
    expect(parseHexColor('invalid', 0x123456)).toBe(0x123456);
    expect(parseHexColor(undefined, 0xabcdef)).toBe(0xabcdef);
  });

  it('produces deterministic PRNG sequences from island hashes', () => {
    const a = { s: hashSeed('i16') };
    const b = { s: hashSeed('i16') };
    const c = { s: hashSeed('i09') };
    expect(a.s).toBe(b.s);
    expect(a.s).not.toBe(c.s);
    const seqA = Array.from({ length: 8 }, () => nextRand(a));
    const seqB = Array.from({ length: 8 }, () => nextRand(b));
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('computes polyline length, sampling, and point-in-polygon accurately', () => {
    const line: readonly (readonly [number, number])[] = [
      [0, 0],
      [30, 0],
      [30, 40],
    ];
    expect(polylineLength(line)).toBeCloseTo(70, 5);
    const pt = { x: 0, y: 0 };
    samplePolyline(line, 0, pt);
    expect(pt).toEqual({ x: 0, y: 0 });
    samplePolyline(line, 30 / 70, pt);
    expect(pt.x).toBeCloseTo(30, 5);
    expect(pt.y).toBeCloseTo(0, 5);
    samplePolyline(line, 1, pt);
    expect(pt.x).toBeCloseTo(30, 5);
    expect(pt.y).toBeCloseTo(40, 5);

    const square: readonly (readonly [number, number])[] = [
      [10, 10],
      [50, 10],
      [50, 50],
      [10, 50],
    ];
    expect(pointInPolygon(25, 25, square)).toBe(true);
    expect(pointInPolygon(5, 25, square)).toBe(false);
  });

  it('scales particle caps and rates cleanly by quality tier and density', () => {
    expect(effectiveParticleCap(70, 'low', 1)).toBe(0);
    expect(effectiveRateScale('low', 1)).toBe(0);
    expect(effectiveParticleCap(70, 'med', 1)).toBe(Math.round(70 * 0.55));
    expect(effectiveParticleCap(70, 'high', 1)).toBe(70);
    expect(effectiveParticleCap(999, 'high', 1.35)).toBe(GLOBAL_MAX_PARTICLES);
    expect(effectiveRateScale('med', 0.5)).toBeCloseTo(0.3, 5);
  });
});

describe('ambientFx island anchor configs', () => {
  it('covers i16 and all 11 other low-element islands with valid layout-px anchors', () => {
    expect(listAmbientFxConfigs().length).toBeGreaterThanOrEqual(TARGET_LOW_LIFE_ISLANDS.length);

    for (const id of TARGET_LOW_LIFE_ISLANDS) {
      const cfg = getAmbientFxConfig(id);
      expect(cfg, `missing ambientFx config for ${id}`).toBeDefined();
      if (!cfg) continue;

      expect(cfg.island).toBe(id);
      expect(cfg.maxParticles ?? 56).toBeGreaterThan(0);
      expect(cfg.maxParticles ?? 56).toBeLessThanOrEqual(GLOBAL_MAX_PARTICLES);

      const featureCount =
        (cfg.cracks?.length ?? 0) + (cfg.flames?.length ?? 0) + (cfg.glows?.length ?? 0) + (cfg.zones?.length ?? 0);
      expect(featureCount, `${id} should have procedural ambient features`).toBeGreaterThanOrEqual(4);

      const plots = loadLevelPlots(id);

      for (const c of cfg.cracks ?? []) {
        expect(c.points.length, `${id}:${c.id}`).toBeGreaterThanOrEqual(2);
        expect(c.width ?? 12).toBeGreaterThan(0);
        for (const [x, y] of c.points) {
          expect(x, `${id}:${c.id} x`).toBeGreaterThanOrEqual(0);
          expect(x, `${id}:${c.id} x`).toBeLessThanOrEqual(LAYOUT_WIDTH);
          expect(y, `${id}:${c.id} y`).toBeGreaterThanOrEqual(0);
          expect(y, `${id}:${c.id} y`).toBeLessThanOrEqual(LAYOUT_HEIGHT);
          for (const p of plots) {
            expect(Math.hypot(x - p.x, y - p.y), `${id}:${c.id} must not overlap plot`).toBeGreaterThanOrEqual(22);
          }
        }
      }

      for (const f of cfg.flames ?? []) {
        expect(f.x).toBeGreaterThanOrEqual(0);
        expect(f.x).toBeLessThanOrEqual(LAYOUT_WIDTH);
        expect(f.y).toBeGreaterThanOrEqual(0);
        expect(f.y).toBeLessThanOrEqual(LAYOUT_HEIGHT);
        expect(f.size ?? 34).toBeGreaterThan(0);
        for (const p of plots) {
          expect(Math.hypot(f.x - p.x, f.y - p.y), `${id}:${f.id} must not sit on plot`).toBeGreaterThanOrEqual(24);
        }
      }

      for (const g of cfg.glows ?? []) {
        expect(g.x).toBeGreaterThanOrEqual(0);
        expect(g.x).toBeLessThanOrEqual(LAYOUT_WIDTH);
        expect(g.y).toBeGreaterThanOrEqual(0);
        expect(g.y).toBeLessThanOrEqual(LAYOUT_HEIGHT);
        expect(g.rx).toBeGreaterThan(0);
        expect(g.ry ?? g.rx).toBeGreaterThan(0);
      }

      for (const z of cfg.zones ?? []) {
        const [rx, ry, rw, rh] = z.rect;
        expect(rw, `${id}:${z.id} w`).toBeGreaterThan(0);
        expect(rh, `${id}:${z.id} h`).toBeGreaterThan(0);
        expect(rx).toBeGreaterThanOrEqual(0);
        expect(ry).toBeGreaterThanOrEqual(0);
        expect(rx + rw).toBeLessThanOrEqual(LAYOUT_WIDTH);
        expect(ry + rh).toBeLessThanOrEqual(LAYOUT_HEIGHT);
        expect(z.rate).toBeGreaterThan(0);
      }
    }
  });

  it('gives i16 rich volcanic coverage (lava cracks, braziers, furnace, rim, embers, smoke)', () => {
    const i16 = getAmbientFxConfig('i16');
    expect(i16).toBeDefined();
    expect(i16?.cracks?.length).toBeGreaterThanOrEqual(15);
    expect(i16?.flames?.length).toBeGreaterThanOrEqual(4);
    expect(i16?.glows?.some((g) => g.kind === 'shimmer')).toBe(true);
    expect(i16?.zones?.some((z) => z.kind === 'ember')).toBe(true);
    expect(i16?.zones?.some((z) => z.kind === 'smoke')).toBe(true);
  });
});

describe('AmbientFxLayer runtime and mapAnimLayer integration', () => {
  it('respects enabled/low-tier, pause, quality particle caps, and layer order', () => {
    const cfg = getAmbientFxConfig('i16')!;
    const layer = new AmbientFxLayer(cfg);

    // Starts hidden until enabled.
    expect(layer.root.visible).toBe(false);
    layer.update(false, false, 1 / 60, 'high');
    expect(layer.root.visible).toBe(false);
    expect(layer.debug().activeParticles).toBe(0);

    // Low quality tier disables procedural ambient even if enabled flag is true.
    layer.update(true, false, 1 / 60, 'low');
    expect(layer.root.visible).toBe(false);
    expect(layer.debug().activeParticles).toBe(0);

    // High tier pre-warms immediately so island feels alive on frame 1.
    layer.update(true, false, 1 / 60, 'high');
    const warm = layer.debug();
    expect(layer.root.visible).toBe(true);
    expect(warm.time).toBeGreaterThan(0);
    expect(warm.activeParticles).toBeGreaterThan(0);
    expect(warm.activeParticles).toBeLessThanOrEqual(warm.particleCap);
    expect(warm.particleCap).toBeLessThanOrEqual(GLOBAL_MAX_PARTICLES);

    // Paused freezes simulation time and particle count.
    const tBeforePause = warm.time;
    const activeBeforePause = warm.activeParticles;
    layer.update(true, true, 0.05, 'high');
    layer.update(true, true, 0.05, 'high');
    expect(layer.debug().time).toBe(tBeforePause);
    expect(layer.debug().activeParticles).toBe(activeBeforePause);

    // Medium tier enforces reduced particle cap.
    layer.update(true, false, 0.05, 'med');
    const medStats = layer.debug();
    expect(medStats.particleCap).toBe(effectiveParticleCap(cfg.maxParticles, 'med', 1));
    expect(medStats.activeParticles).toBeLessThanOrEqual(medStats.particleCap);

    // Turning off (reduced motion) hides and clears active particles cleanly.
    layer.update(false, false, 0.05, 'high');
    expect(layer.root.visible).toBe(false);
    expect(layer.debug().activeParticles).toBe(0);

    layer.destroy();
  });

  it('does not throw when High effects density asks for more particles than the pool holds (every island)', () => {
    setFxPrefs({ density: 1.35, reduceFlashes: false });
    for (const id of TARGET_LOW_LIFE_ISLANDS) {
      const layer = new AmbientFxLayer(getAmbientFxConfig(id)!);
      expect(() => {
        for (let i = 0; i < 600; i++) layer.update(true, false, 1 / 30, 'high');
      }).not.toThrow();
      const d = layer.debug();
      expect(d.activeParticles).toBeLessThanOrEqual(d.particleCap);
      layer.destroy();
    }
  });

  it('mounts ambient host strictly between mapSprite (0) and WorldLayers (2+) in world', () => {
    const world = new Container();
    const mapSprite = new Sprite(Texture.EMPTY);
    world.addChild(mapSprite);
    const layers = new WorldLayers(world);

    const controller = mapAnimLayer(world, 'i16', '/art2d/');
    expect(controller).toBeDefined();

    // Child 0: mapSprite, Child 1: ambient host, Child 2: groundFx, ..., last: bars.
    expect(world.children[0]).toBe(mapSprite);
    expect(world.children[2]).toBe(layers.groundFx);
    expect(world.getChildIndex(layers.plots)).toBeGreaterThan(1);
    expect(world.getChildIndex(layers.actors)).toBeGreaterThan(1);
    expect(world.getChildIndex(layers.bars)).toBeGreaterThan(1);

    const ambientHost = world.children[1] as Container;
    expect(ambientHost.eventMode).toBe('none');

    // Enabling procedural FX via controller works without touching gameplay layers.
    controller!.update(true, false, false, 1 / 60, 'high');
    const stats = controller!.debug();
    expect(stats?.island).toBe('i16');
    expect(stats?.enabled).toBe(true);
    expect(stats?.activeParticles).toBeGreaterThan(0);

    // Destroying world cleans up the ambient host cleanly.
    world.destroy({ children: true });
    expect(ambientHost.destroyed).toBe(true);
  });
});
