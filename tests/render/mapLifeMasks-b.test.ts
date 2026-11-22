import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { LAYOUT_HEIGHT, LAYOUT_WIDTH } from '../../src/render2d/ambientFx.ts';
import { getMapLifeConfig, listMapLifeConfigs, MAX_SWAY_STRENGTH_PX } from '../../src/render2d/mapLifeLayer.ts';

interface RawLevel2D {
  imageSize: [number, number];
  paths: [number, number][][];
  plots: [number, number][];
  plotRadiusPx?: number;
  goal?: [number, number];
  entrances?: { id: string; x: number; y: number }[];
}

const ALL_ISLANDS_B = ['i09', 'i10', 'i11', 'i12', 'i13', 'i14', 'i15', 'i16'] as const;
const WIND_ISLANDS_B = ['i09', 'i10', 'i11', 'i12', 'i15'] as const;
const NO_WIND_ISLANDS_B = ['i13', 'i14', 'i16'] as const;

/**
 * Decodes a precomputed grayscale sway mask fixture (`tests/fixtures/<id>-sway-mask.gray.gz`:
 * `"W H\n"` + raw 8-bit pixels) and verifies its sha256 against the shipped `.webp`.
 * Regenerate with `python3 tools/map-life/gen_sway_mask_b.py --all --fixtures` if a mask changes.
 */
function decodeGrayscaleMask(island: string, filePath: string): { width: number; height: number; data: Uint8Array } {
  const metaPath = resolve(process.cwd(), `tests/fixtures/${island}-sway-mask.json`);
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { sha256: string };
  const shipped = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  expect(shipped, `${island}-sway.webp changed: regenerate tests/fixtures/${island}-sway-mask.*`).toBe(meta.sha256);

  const gzPath = resolve(process.cwd(), `tests/fixtures/${island}-sway-mask.gray.gz`);
  const out = gunzipSync(readFileSync(gzPath));
  const nl = out.indexOf(0x0a);
  const [wStr, hStr] = out.subarray(0, nl).toString('utf8').split(' ');
  const width = Number(wStr);
  const height = Number(hStr);
  const data = new Uint8Array(out.buffer, out.byteOffset + nl + 1, width * height);
  return { width, height, data };
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-6) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

describe('Group B (i09–i16) map-life configs', () => {
  it.each(ALL_ISLANDS_B)('loads valid map-life config for %s', (island) => {
    const cfg = getMapLifeConfig(island);
    expect(cfg, `missing src/data/mapLife/${island}.json`).toBeDefined();
    expect(cfg!.island).toBe(island);
    expect(listMapLifeConfigs().some((c) => c.island === island)).toBe(true);

    if (cfg!.wind) {
      expect(cfg!.wind.mask).toBe(`life/${island}-sway.webp`);
      expect(cfg!.wind.strength).toBeGreaterThan(0);
      expect(cfg!.wind.strength).toBeLessThanOrEqual(Math.min(2.25, MAX_SWAY_STRENGTH_PX));
    }
    if (cfg!.clouds) {
      expect(cfg!.clouds.count).toBeGreaterThanOrEqual(1);
      expect(cfg!.clouds.count).toBeLessThanOrEqual(4);
      expect(cfg!.clouds.alpha).toBeGreaterThanOrEqual(0.06);
      expect(cfg!.clouds.alpha).toBeLessThanOrEqual(0.16);
    }
    if (cfg!.birds) {
      expect(cfg!.birds.flockSize[0]).toBeGreaterThanOrEqual(1);
      expect(cfg!.birds.flockSize[1]).toBeLessThanOrEqual(7);
      expect(cfg!.birds.flockSize[0]).toBeLessThanOrEqual(cfg!.birds.flockSize[1]);
    }
  });

  it.each(NO_WIND_ISLANDS_B)('deliberately omits wind sway on barren/rock/sand/volcanic island %s', (island) => {
    const cfg = getMapLifeConfig(island)!;
    expect(cfg.wind).toBeUndefined();
    expect(cfg.clouds || cfg.birds || cfg.butterflies).toBeTruthy();
  });

  it.each(ALL_ISLANDS_B)('keeps butterfly zone centres off every path and plot on %s', (island) => {
    const cfg = getMapLifeConfig(island)!;
    if (!cfg.butterflies) return;

    const levelPath = resolve(process.cwd(), `src/data/levels2d/${island}.json`);
    const level = JSON.parse(readFileSync(levelPath, 'utf8')) as RawLevel2D;
    const plotR = level.plotRadiusPx ?? 48;
    const minRoadClearance = 44;

    expect(cfg.butterflies.count).toBeGreaterThan(0);
    expect(cfg.butterflies.zones.length).toBeGreaterThan(0);

    for (let zi = 0; zi < cfg.butterflies.zones.length; zi++) {
      const z = cfg.butterflies.zones[zi];
      expect(z.x).toBeGreaterThan(0);
      expect(z.x).toBeLessThan(level.imageSize[0]);
      expect(z.y).toBeGreaterThan(0);
      expect(z.y).toBeLessThan(level.imageSize[1]);

      for (let pi = 0; pi < level.paths.length; pi++) {
        const path = level.paths[pi];
        for (let i = 1; i < path.length; i++) {
          const d = distToSegment(z.x, z.y, path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
          expect(d, `${island} butterfly zone[${zi}] (${z.x},${z.y}) too close to path[${pi}]`).toBeGreaterThan(
            minRoadClearance,
          );
        }
      }

      for (let i = 0; i < level.plots.length; i++) {
        const [px, py] = level.plots[i];
        const d = Math.hypot(z.x - px, z.y - py);
        expect(d, `${island} butterfly zone[${zi}] (${z.x},${z.y}) overlaps plot[${i}] (${px},${py})`).toBeGreaterThan(
          plotR * 1.15,
        );
      }
    }
  });
});

describe('Group B precomputed sway mask cleanliness', () => {
  it.each(WIND_ISLANDS_B)(
    'is strictly zero on every path point, path midpoint, plot centre/rim, entrance and goal of %s',
    (island) => {
      const cfg = getMapLifeConfig(island)!;
      expect(cfg.wind, `expected wind config for ${island}`).toBeDefined();
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

      // Must cover genuine vegetation area (not an empty black mask).
      let nonZero = 0;
      for (let i = 0; i < data.length; i++) if (data[i] > 0) nonZero++;
      expect(nonZero / data.length).toBeGreaterThan(0.15);

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

      // Every plot centre (and ring perimeter points) must be strictly 0.
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
