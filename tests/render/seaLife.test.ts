import { describe, expect, it } from 'vitest';
import { worldMapLayout } from '../../src/render2d/ui/mapLayout.ts';
import {
  advanceClock,
  distToNodes,
  distToRoute,
  frameWindowSlow,
  gullFlight,
  nextGap,
  SEA_PERIOD,
  seaConfig,
  seaRng,
  seaTier,
  stepDownTier,
  waterScale,
  whaleSpot,
  type SeaInputs,
} from '../../src/render2d/ui/seaMotion.ts';
import { frameRect, guessFrames, parseStrip, seaSpriteRefs, seaTextureUrl } from '../../src/render2d/ui/seaSprites.ts';
import { SEA_FRAGMENT_SHADER, tileNoise } from '../../src/render2d/ui/seaWater.ts';
import { NO_INSETS } from '../../src/render2d/uiLayout.ts';

const BASE: SeaInputs = { override: null, quality: 'auto', reducedMotion: false, effects: 'normal', fpsCap: 0, touch: false, software: false };

describe('sea: which motion a device gets', () => {
  it('tier: ?quality= wins, then the preset, then Auto (desktop high, phone med, software low)', () => {
    expect(seaTier({ ...BASE, override: 'low', quality: 'high' })).toEqual({ tier: 'low', auto: false });
    expect(seaTier({ ...BASE, quality: 'medium' })).toEqual({ tier: 'med', auto: false });
    expect(seaTier(BASE)).toEqual({ tier: 'high', auto: true });
    expect(seaTier({ ...BASE, touch: true })).toEqual({ tier: 'med', auto: true });
    expect(seaTier({ ...BASE, software: true })).toEqual({ tier: 'low', auto: true });
  });

  it('reduced motion: still, no gulls, no whale, no bob', () => {
    const c = seaConfig({ ...BASE, reducedMotion: true });
    expect(c.still).toBe(true);
    expect(c.gulls).toBe(false);
    expect(c.whale).toBe(false);
    expect(c.bob).toBe('none');
  });

  it('low tier: 30 fps, only the frontier bobs, fewer clouds; effects density scales the amount', () => {
    const low = seaConfig({ ...BASE, quality: 'low' });
    const high = seaConfig({ ...BASE, quality: 'high' });
    expect(low.minFrameMs).toBeCloseTo(1000 / 30);
    expect(high.minFrameMs).toBe(0);
    expect(low.bob).toBe('frontier');
    expect(high.bob).toBe('all');
    expect(low.clouds).toBeLessThanOrEqual(high.clouds);
    expect(low.waterMaxScale).toBeLessThan(high.waterMaxScale);
    expect(seaConfig({ ...BASE, effects: 'low' }).density).toBeLessThan(seaConfig(BASE).density);
    // a player's 30 fps cap holds on the high tier too
    expect(seaConfig({ ...BASE, quality: 'high', fpsCap: 30 }).minFrameMs).toBeCloseTo(1000 / 30);
  });

  it('governor steps high → med → low, then stops', () => {
    expect(stepDownTier('high')).toBe('med');
    expect(stepDownTier('med')).toBe('low');
    expect(stepDownTier('low')).toBeNull();
    expect(frameWindowSlow(16.7, 0)).toBe(false);
    expect(frameWindowSlow(30, 0)).toBe(true);
    expect(frameWindowSlow(34, 1000 / 30)).toBe(false);
  });

  it('water canvas density: no sharper than the device, the tier or the painting', () => {
    const high = seaConfig({ ...BASE, quality: 'high' });
    expect(waterScale(high, 2, 1080, 1024)).toBe(1); // 1080 css px tall: the painting has < 1 texel per px
    expect(waterScale(high, 3, 390, 1024)).toBe(2); // phone: tier cap
    expect(waterScale(seaConfig({ ...BASE, quality: 'low' }), 3, 390, 1024)).toBe(0.75);
    expect(waterScale(high, 1, 390, 1024)).toBe(1);
  });
});

describe('sea: the loop is seamless', () => {
  it('the clock wraps at SEA_PERIOD and never jumps more than 100 ms per frame', () => {
    expect(advanceClock(SEA_PERIOD - 0.01, 20)).toBeCloseTo(0.01);
    expect(advanceClock(5, 5000)).toBeCloseTo(5.1);
    expect(advanceClock(5, -10)).toBe(5);
  });

  it('every periodic term of the water shader completes whole cycles per loop', () => {
    const drifts = [...SEA_FRAGMENT_SHADER.matchAll(/vec2\(([-\d.]+), ([-\d.]+)\) \* uPh/g)];
    expect(drifts.length).toBeGreaterThanOrEqual(4);
    for (const m of drifts) {
      expect(Number.isInteger(Number(m[1])), m[0]).toBe(true);
      expect(Number.isInteger(Number(m[2])), m[0]).toBe(true);
    }
    for (const m of SEA_FRAGMENT_SHADER.matchAll(/uPh \* ([\d.]+)/g)) expect(Number.isInteger(Number(m[1])), m[0]).toBe(true);
    // the glint rate is floored to whole cycles
    expect(SEA_FRAGMENT_SHADER).toMatch(/float k = floor\(/);
  });

  it('the noise texture tiles: opposite edges continue each other', () => {
    const n = 64;
    const tex = tileNoise(n, 1234);
    for (let ch = 0; ch < 4; ch++) {
      let edge = 0;
      let inner = 0;
      for (let y = 0; y < n; y++) {
        edge += Math.abs(tex[(y * n + (n - 1)) * 4 + ch] - tex[(y * n + 0) * 4 + ch]);
        inner += Math.abs(tex[(y * n + 30) * 4 + ch] - tex[(y * n + 31) * 4 + ch]);
      }
      // the step across the wrap is no bigger than a step inside the tile (generous margin)
      expect(edge / n).toBeLessThan(Math.max(8, (inner / n) * 3));
    }
  });
});

describe('sea: life stays in open water', () => {
  const L = worldMapLayout(25, 1920, 1080, NO_INSETS, 130);
  const nodes = L.nodes;
  const d = L.nodeD;

  it('distance helpers', () => {
    expect(distToNodes({ x: 0, y: 0 }, [{ x: 3, y: 4 }])).toBe(5);
    expect(distToRoute({ x: 5, y: 3 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe(3);
  });

  it('the whale surfaces far from every island and off the route, inside the view', () => {
    const rand = seaRng(42);
    let found = 0;
    for (let sl = 0; sl < L.worldW - 1920; sl += 300) {
      const view = { x0: sl, x1: sl + 1920, top: 130, bottom: 1030 };
      for (let k = 0; k < 10; k++) {
        const p = whaleSpot(rand, view, nodes, d * 1.25, d * 0.45);
        if (!p) continue;
        found++;
        expect(distToNodes(p, nodes)).toBeGreaterThanOrEqual(d * 1.25);
        expect(distToRoute(p, nodes)).toBeGreaterThanOrEqual(d * 0.75);
        expect(p.x).toBeGreaterThanOrEqual(view.x0 + d * 0.45);
        expect(p.x).toBeLessThanOrEqual(view.x1 - d * 0.45);
        expect(p.y).toBeGreaterThanOrEqual(view.top);
        expect(p.y).toBeLessThanOrEqual(view.bottom);
      }
    }
    expect(found).toBeGreaterThan(20);
  });

  it('no water at all → no whale', () => {
    expect(whaleSpot(seaRng(1), { x0: 0, x1: 100, top: 0, bottom: 100 }, [{ x: 50, y: 50 }], 200, 10)).toBeNull();
  });

  it('gulls enter at an edge of the view and cross it, under the title band and above the hint', () => {
    const rand = seaRng(9);
    const view = { x0: 1000, x1: 2920, top: 130, bottom: 1000 };
    for (let k = 0; k < 50; k++) {
      const f = gullFlight(rand, view, 24);
      expect(f.vx > 0 ? f.x < view.x0 : f.x > view.x1).toBe(true);
      expect(f.y).toBeGreaterThanOrEqual(view.top);
      expect(f.y).toBeLessThanOrEqual(view.bottom);
      expect(Math.abs(f.vy)).toBeLessThan(Math.abs(f.vx) * 0.1);
      expect(f.count).toBeGreaterThanOrEqual(1);
      expect(f.count).toBeLessThanOrEqual(3);
    }
  });

  it('events are rarer at low effects density', () => {
    expect(nextGap(() => 0.5, 10, 20, 0.5)).toBeCloseTo(30);
    expect(nextGap(() => 0.5, 10, 20, 1)).toBeCloseTo(15);
  });
});

describe('sea: painted sprites from the manifest', () => {
  it('nothing registered → no sprites (the stand-ins draw); a plain sea path is the texture', () => {
    const m = { paintedUi: { sea: 'ui/sea.webp', 'sea@0.5x': 'ui/sea@0.5x.webp' } };
    expect(seaSpriteRefs(m)).toEqual({});
    expect(seaTextureUrl(m, false)).toBe('/art2d/ui/sea.webp');
    expect(seaTextureUrl(m, true)).toBe('/art2d/ui/sea@0.5x.webp');
    expect(seaSpriteRefs(null)).toEqual({});
  });

  it('paintedUi.sea as a group: paths, json-only, objects with inline frames, variant arrays', () => {
    const m = {
      paintedUi: {
        sea: {
          gull: 'ui/sea/gull.webp',
          ripple: 'ui/sea/ripple.json',
          whale: { image: 'ui/sea/whale.webp', json: 'ui/sea/whale.json' },
          shipSail: { file: 'ui/sea/ship-sail.webp', frameW: 160, frameH: 160, count: 6, fps: 8 },
          cloud: ['ui/sea/cloud-1.webp', 'ui/sea/cloud-2.webp'],
          'cloud-shadow': 'ui/sea/cloud-shadow.webp',
          nonsense: 'x.webp',
        },
      },
    };
    const r = seaSpriteRefs(m);
    expect(r.gull).toEqual([{ image: '/art2d/ui/sea/gull.webp', json: null, strip: null }]);
    expect(r.ripple).toEqual([{ image: null, json: '/art2d/ui/sea/ripple.json', strip: null }]);
    expect(r.whale?.[0]).toMatchObject({ image: '/art2d/ui/sea/whale.webp', json: '/art2d/ui/sea/whale.json' });
    expect(r.shipSail?.[0].strip).toMatchObject({ frameW: 160, frameH: 160, count: 6, fps: 8 });
    expect(r.cloud).toHaveLength(2);
    expect(r.cloudShadow?.[0].image).toBe('/art2d/ui/sea/cloud-shadow.webp');
    // the sea texture is no longer a plain path there: fall back to the file
    expect(seaTextureUrl(m, false)).toBe('/art2d/ui/sea.webp');
  });

  it('flat keys work too (sea-gull, sea/whale, sea-cloud-shadow)', () => {
    const r = seaSpriteRefs({ paintedUi: { 'sea-gull': 'ui/sea/gull.webp', 'sea/whale': 'ui/sea/whale.webp', 'sea-cloud-shadow': 'ui/sea/cs.webp', 'sea-texture': 'ui/sea-v2.webp' } });
    expect(Object.keys(r).sort()).toEqual(['cloudShadow', 'gull', 'whale']);
    expect(seaTextureUrl({ paintedUi: { 'sea-texture': 'ui/sea-v2.webp' } }, false)).toBe('/art2d/ui/sea-v2.webp');
  });

  it('strip json in the animation strips format', () => {
    const s = parseStrip({ frameW: 96, frameH: 48, count: 6, cols: 3, fps: 12 }, 288, 96, 10);
    expect(s).toMatchObject({ frameW: 96, frameH: 48, count: 6, cols: 3, fps: 12 });
    expect(frameRect(s, 0)).toEqual([0, 0, 96, 48]);
    expect(frameRect(s, 4)).toEqual([96, 48, 96, 48]);
    expect(frameRect(s, 7)).toEqual([96, 0, 96, 48]); // wraps
    expect(frameRect(s, 2.9)).toEqual([192, 0, 96, 48]);
  });

  it('count + cols without a frame size; explicit frame rects', () => {
    expect(parseStrip({ count: 4 }, 400, 100, 10)).toMatchObject({ frameW: 100, frameH: 100, count: 4, cols: 4 });
    const r = parseStrip({ rects: [[0, 0, 50, 40], [50, 0, 50, 40]] }, 100, 40, 10);
    expect(r.count).toBe(2);
    expect(frameRect(r, 1)).toEqual([50, 0, 50, 40]);
  });

  it('no json: only a row of >= 3 square frames is cut; clouds never', () => {
    expect(guessFrames(384, 64)).toBe(6);
    expect(guessFrames(300, 140)).toBe(1); // a wide painting, not a strip
    expect(guessFrames(256, 128)).toBe(1); // 2:1 is a wide ripple, not two frames
    expect(parseStrip(null, 384, 64, 8).count).toBe(6);
    expect(parseStrip(null, 384, 64, 8, true).count).toBe(1);
    expect(parseStrip(null, 300, 140, 1)).toMatchObject({ count: 1, frameW: 300, frameH: 140 });
  });
});
