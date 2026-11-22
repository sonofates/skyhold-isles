import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { LAYOUT_HEIGHT, LAYOUT_WIDTH } from '../../src/render2d/ambientFx.ts';
import { getMapLifeConfig, MAX_SWAY_STRENGTH_PX } from '../../src/render2d/mapLifeLayer.ts';

interface RawLevel2D {
  imageSize: [number, number];
  paths: [number, number][][];
  plots: [number, number][];
  plotRadiusPx?: number;
  goal?: [number, number];
  entrances?: { id: string; x: number; y: number }[];
}

const GROUP_A_ISLANDS = ['i01', 'i02', 'i03', 'i04', 'i05', 'i06', 'i07', 'i08'] as const;
const WIND_ISLANDS = ['i01', 'i02', 'i04', 'i05', 'i07', 'i08'] as const;
const NO_WIND_ISLANDS = ['i03', 'i06'] as const;

/**
 * Decodes a precomputed grayscale sway-mask fixture (`tests/fixtures/<id>-sway-mask.gray.gz`:
 * "W H\n" + raw 8-bit pixels) and checks the sha256 of the shipped .webp against
 * `tests/fixtures/<id>-sway-mask.json`, so CI needs no image library.
 */
function decodeGrayscaleMask(
  island: string,
  filePath: string,
): { width: number; height: number; data: Uint8Array } {
  const metaPath = resolve(process.cwd(), `tests/fixtures/${island}-sway-mask.json`);
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { sha256: string };
  const shipped = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  expect(
    shipped,
    `${island}-sway.webp changed: regenerate tests/fixtures/${island}-sway-mask.* via tools/map-life/gen_fixtures_a.py`,
  ).toBe(meta.sha256);

  const gzPath = resolve(process.cwd(), `tests/fixtures/${island}-sway-mask.gray.gz`);
  const out = gunzipSync(readFileSync(gzPath));
  const nl = out.indexOf(0x0a);
  const [wStr, hStr] = out.subarray(0, nl).toString('utf8').split(' ');
  const width = Number(wStr);
  const height = Number(hStr);
  const data = new Uint8Array(out.buffer, out.byteOffset + nl + 1, width * height);
  return { width, height, data };
}

function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 1e-6 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

describe('group A (i01-i08) map-life configs', () => {
  it.each(GROUP_A_ISLANDS)('loads valid biome-tuned config for %s', (island) => {
    const cfg = getMapLifeConfig(island);
    expect(cfg, `missing config for ${island}`).toBeDefined();
    expect(cfg?.island).toBe(island);

    if (cfg?.wind) {
      expect(cfg.wind.mask).toBe(`life/${island}-sway.webp`);
      expect(cfg.wind.strength).toBeGreaterThan(0);
      expect(cfg.wind.strength).toBeLessThanOrEqual(2.25);
      expect(cfg.wind.strength).toBeLessThanOrEqual(MAX_SWAY_STRENGTH_PX);
      expect(cfg.wind.gustPeriod).toBeGreaterThanOrEqual(1.5);
    }

    if (cfg?.clouds) {
      expect(cfg.clouds.count).toBeGreaterThanOrEqual(1);
      expect(cfg.clouds.count).toBeLessThanOrEqual(4);
      expect(cfg.clouds.alpha).toBeGreaterThanOrEqual(0.04);
      expect(cfg.clouds.alpha).toBeLessThanOrEqual(0.16);
    }

    if (cfg?.birds) {
      expect(cfg.birds.flockSize[0]).toBeGreaterThanOrEqual(1);
      expect(cfg.birds.flockSize[1]).toBeLessThanOrEqual(7);
      expect(cfg.birds.flockSize[0]).toBeLessThanOrEqual(cfg.birds.flockSize[1]);
    }
  });

  it.each(NO_WIND_ISLANDS)('deliberately omits wind sway on %s (snow / beach sand) while enabling sky life', (island) => {
    const cfg = getMapLifeConfig(island)!;
    expect(cfg.wind).toBeUndefined();
    expect(cfg.clouds?.count).toBeGreaterThanOrEqual(2);
    expect(cfg.birds).toBeDefined();
  });

  it('places every butterfly zone centre off roads and plots', () => {
    for (const island of GROUP_A_ISLANDS) {
      const cfg = getMapLifeConfig(island)!;
      if (!cfg.butterflies) continue;

      const levelPath = resolve(process.cwd(), `src/data/levels2d/${island}.json`);
      const level = JSON.parse(readFileSync(levelPath, 'utf8')) as RawLevel2D;
      const plotR = level.plotRadiusPx ?? 48;

      expect(cfg.butterflies.count).toBeGreaterThan(0);
      expect(cfg.butterflies.zones.length).toBeGreaterThan(0);

      for (const z of cfg.butterflies.zones) {
        expect(z.x).toBeGreaterThan(40);
        expect(z.x).toBeLessThan(LAYOUT_WIDTH - 40);
        expect(z.y).toBeGreaterThan(40);
        expect(z.y).toBeLessThan(LAYOUT_HEIGHT - 40);

        for (let pi = 0; pi < level.paths.length; pi++) {
          const path = level.paths[pi];
          for (let i = 1; i < path.length; i++) {
            const dist = pointToSegmentDist(z.x, z.y, path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
            expect(dist, `${island} butterfly zone (${z.x},${z.y}) is too close to path[${pi}]`).toBeGreaterThan(55);
          }
        }

        for (let i = 0; i < level.plots.length; i++) {
          const [px, py] = level.plots[i];
          const dist = Math.hypot(z.x - px, z.y - py);
          expect(dist, `${island} butterfly zone (${z.x},${z.y}) overlaps plot[${i}] (${px},${py})`).toBeGreaterThan(
            plotR * 1.4,
          );
        }
      }
    }
  });
});

describe('group A precomputed sway mask cleanliness', () => {
  it.each(WIND_ISLANDS)(
    'is strictly zero on every path vertex, path midpoint, plot centre/rim, entrance, and goal of %s',
    (island) => {
      const cfg = getMapLifeConfig(island)!;
      expect(cfg.wind).toBeDefined();
      const maskPath = resolve(process.cwd(), 'public/art2d', cfg.wind!.mask);
      expect(existsSync(maskPath), `missing sway mask at ${maskPath}`).toBe(true);

      const levelPath = resolve(process.cwd(), `src/data/levels2d/${island}.json`);
      const level = JSON.parse(readFileSync(levelPath, 'utf8')) as RawLevel2D;
      const [iw, ih] = level.imageSize;
      expect(iw).toBe(LAYOUT_WIDTH);
      expect(ih).toBe(LAYOUT_HEIGHT);

      const { width, height, data } = decodeGrayscaleMask(island, maskPath);
      expect(width).toBeGreaterThan(200);
      expect(height).toBeGreaterThan(100);
      expect(width / height).toBeCloseTo(iw / ih, 2);

      const sampleAt = (lx: number, ly: number): number => {
        const mx = Math.max(0, Math.min(width - 1, Math.round((lx / iw) * width)));
        const my = Math.max(0, Math.min(height - 1, Math.round((ly / ih) * height)));
        return data[my * width + mx];
      };

      // Must contain actual swaying foliage pixels (i05 only sways tall wheat outside mapAnim).
      let nonZero = 0;
      for (let i = 0; i < data.length; i++) if (data[i] > 0) nonZero++;
      const minCov = island === 'i05' ? 0.02 : 0.1;
      expect(nonZero / data.length, `${island} mask coverage too small`).toBeGreaterThan(minCov);

      // Every path vertex and segment midpoint must be strictly 0.
      for (let pi = 0; pi < level.paths.length; pi++) {
        const path = level.paths[pi];
        for (let i = 0; i < path.length; i++) {
          const [x, y] = path[i];
          expect(sampleAt(x, y), `${island} path[${pi}][${i}] (${x},${y}) must have 0 sway`).toBe(0);
          if (i > 0) {
            const mx = (path[i - 1][0] + x) * 0.5;
            const my = (path[i - 1][1] + y) * 0.5;
            expect(sampleAt(mx, my), `${island} path[${pi}] midpoint (${mx},${my}) must have 0 sway`).toBe(0);
          }
        }
      }

      // Every plot centre and ring perimeter points must be strictly 0.
      const r = level.plotRadiusPx ?? 48;
      for (let i = 0; i < level.plots.length; i++) {
        const [px, py] = level.plots[i];
        expect(sampleAt(px, py), `${island} plot[${i}] centre (${px},${py}) must have 0 sway`).toBe(0);
        expect(sampleAt(px - r * 0.85, py), `${island} plot[${i}] west rim must have 0 sway`).toBe(0);
        expect(sampleAt(px + r * 0.85, py), `${island} plot[${i}] east rim must have 0 sway`).toBe(0);
        expect(sampleAt(px, py - r * 0.55), `${island} plot[${i}] north rim must have 0 sway`).toBe(0);
        expect(sampleAt(px, py + r * 0.55), `${island} plot[${i}] south rim must have 0 sway`).toBe(0);
      }

      // Entrances and goal castle must be strictly 0.
      for (const ent of level.entrances ?? []) {
        expect(sampleAt(ent.x, ent.y), `${island} entrance ${ent.id} must have 0 sway`).toBe(0);
      }
      if (level.goal) {
        expect(sampleAt(level.goal[0], level.goal[1]), `${island} goal must have 0 sway`).toBe(0);
      }
    },
  );
});
