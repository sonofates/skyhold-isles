import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { LAYOUT_HEIGHT, LAYOUT_WIDTH } from '../../src/render2d/ambientFx.ts';
import {
  getMapLifeConfig,
  listMapLifeConfigs,
  MAX_BIRDS,
  MAX_CLOUDS,
  MAX_SWAY_STRENGTH_PX,
} from '../../src/render2d/mapLifeLayer.ts';

interface RawLevel2D {
  imageSize: [number, number];
  paths: [number, number][][];
  plots: [number, number][];
  plotRadiusPx?: number;
  goal?: [number, number];
  entrances?: { id: string; x: number; y: number }[];
}

const ALL_GROUP_C = ['i18', 'i19', 'i20', 'i21', 'i22', 'i23', 'i24', 'l1c'] as const;
const SWAY_GROUP_C = ['i19', 'i20', 'i21', 'i23', 'i24', 'l1c'] as const;
const NO_WIND_GROUP_C = ['i18', 'i22'] as const;

/**
 * Decoded copy of a shipped sway mask (tests/fixtures/<id>-sway-mask.gray.gz: "W H\n" + 8-bit pixels),
 * so the test needs no image library. Verifies sha256 against tests/fixtures/<id>-sway-mask.json.
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
    `${island}-sway.webp changed: regenerate tests/fixtures/${island}-sway-mask.* with tools/map-life/gen_sway_mask_c.py`,
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

function pointToSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 1e-6 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function loadRawLevel(island: string): RawLevel2D {
  const levelPath = resolve(process.cwd(), `src/data/levels2d/${island}.json`);
  return JSON.parse(readFileSync(levelPath, 'utf8')) as RawLevel2D;
}

describe('group C mapLife configs (i18..i24, l1c)', () => {
  it('loads valid configs for every group C island', () => {
    const listed = new Set(listMapLifeConfigs().map((c) => c.island));
    for (const id of ALL_GROUP_C) {
      const cfg = getMapLifeConfig(id);
      expect(cfg, `missing mapLife config for ${id}`).toBeDefined();
      expect(cfg?.island).toBe(id);
      expect(listed.has(id)).toBe(true);

      if (cfg?.wind) {
        expect(cfg.wind.mask).toBe(`life/${id}-sway.webp`);
        expect(cfg.wind.strength).toBeGreaterThan(0);
        expect(cfg.wind.strength).toBeLessThanOrEqual(2.25);
        expect(cfg.wind.strength).toBeLessThanOrEqual(MAX_SWAY_STRENGTH_PX);
      }
      if (cfg?.clouds) {
        expect(cfg.clouds.count).toBeGreaterThanOrEqual(1);
        expect(cfg.clouds.count).toBeLessThanOrEqual(MAX_CLOUDS);
        expect(cfg.clouds.alpha).toBeGreaterThanOrEqual(0.04);
        expect(cfg.clouds.alpha).toBeLessThanOrEqual(0.16);
      }
      if (cfg?.birds) {
        expect(cfg.birds.flockSize[0]).toBeGreaterThanOrEqual(1);
        expect(cfg.birds.flockSize[1]).toBeLessThanOrEqual(MAX_BIRDS);
        expect(cfg.birds.flockSize[0]).toBeLessThanOrEqual(cfg.birds.flockSize[1]);
      }
    }

    for (const id of NO_WIND_GROUP_C) {
      const cfg = getMapLifeConfig(id)!;
      expect(cfg.wind, `cavern island ${id} should deliberately omit wind sway`).toBeUndefined();
      expect(cfg.clouds || cfg.birds, `${id} should still have atmospheric map life`).toBeTruthy();
    }
  });

  it('places every butterfly zone centre strictly off paths and plots', () => {
    for (const id of ALL_GROUP_C) {
      const cfg = getMapLifeConfig(id)!;
      if (!cfg.butterflies) continue;
      expect(cfg.butterflies.count).toBeGreaterThan(0);
      expect(cfg.butterflies.zones.length).toBeGreaterThan(0);

      const level = loadRawLevel(id);
      const plotR = level.plotRadiusPx ?? 48;
      for (const zone of cfg.butterflies.zones) {
        let minPathDist = Infinity;
        for (const path of level.paths) {
          for (let i = 1; i < path.length; i++) {
            const d = pointToSegmentDist(
              zone.x,
              zone.y,
              path[i - 1][0],
              path[i - 1][1],
              path[i][0],
              path[i][1],
            );
            if (d < minPathDist) minPathDist = d;
          }
        }
        expect(
          minPathDist,
          `${id} butterfly zone (${zone.x},${zone.y}) is too close to a path (${minPathDist.toFixed(1)}px)`,
        ).toBeGreaterThanOrEqual(48);

        let minPlotDist = Infinity;
        for (const [px, py] of level.plots) {
          const d = Math.hypot(zone.x - px, zone.y - py);
          if (d < minPlotDist) minPlotDist = d;
        }
        expect(
          minPlotDist,
          `${id} butterfly zone (${zone.x},${zone.y}) is too close to a plot (${minPlotDist.toFixed(1)}px)`,
        ).toBeGreaterThanOrEqual(plotR * 1.25);
      }
    }
  });
});

describe('group C precomputed sway mask cleanliness', () => {
  for (const id of SWAY_GROUP_C) {
    it(`${id}: strictly zero on every path point, path midpoint, plot centre/rim, entrance and goal`, () => {
      const cfg = getMapLifeConfig(id)!;
      expect(cfg.wind, `${id} expected wind sway config`).toBeDefined();
      const maskPath = resolve(process.cwd(), 'public/art2d', cfg.wind!.mask);
      expect(existsSync(maskPath), `missing sway mask at ${maskPath}`).toBe(true);

      const level = loadRawLevel(id);
      const [iw, ih] = level.imageSize;
      expect(iw).toBe(LAYOUT_WIDTH);
      expect(ih).toBe(LAYOUT_HEIGHT);

      const { width, height, data } = decodeGrayscaleMask(id, maskPath);
      expect(width).toBeGreaterThan(200);
      expect(height).toBeGreaterThan(100);
      expect(width / height).toBeCloseTo(iw / ih, 2);

      const sampleAt = (lx: number, ly: number): number => {
        const mx = Math.max(0, Math.min(width - 1, Math.round((lx / iw) * width)));
        const my = Math.max(0, Math.min(height - 1, Math.round((ly / ih) * height)));
        return data[my * width + mx];
      };

      // Must cover genuine foliage area (not an empty mask).
      let nonZero = 0;
      for (let i = 0; i < data.length; i++) if (data[i] > 0) nonZero++;
      expect(nonZero / data.length).toBeGreaterThan(0.1);

      // Every path vertex and segment midpoint must be strictly 0.
      for (let pi = 0; pi < level.paths.length; pi++) {
        const path = level.paths[pi];
        for (let i = 0; i < path.length; i++) {
          const [x, y] = path[i];
          expect(sampleAt(x, y), `${id} path[${pi}][${i}] (${x},${y}) must have 0 sway`).toBe(0);
          if (i > 0) {
            const mx = (path[i - 1][0] + x) * 0.5;
            const my = (path[i - 1][1] + y) * 0.5;
            expect(sampleAt(mx, my), `${id} path[${pi}] midpoint (${mx},${my}) must have 0 sway`).toBe(0);
          }
        }
      }

      // Every plot centre and rim must be strictly 0.
      const r = level.plotRadiusPx ?? 48;
      for (let i = 0; i < level.plots.length; i++) {
        const [px, py] = level.plots[i];
        expect(sampleAt(px, py), `${id} plot[${i}] centre (${px},${py}) must have 0 sway`).toBe(0);
        expect(sampleAt(px - r * 0.85, py), `${id} plot[${i}] west rim must have 0 sway`).toBe(0);
        expect(sampleAt(px + r * 0.85, py), `${id} plot[${i}] east rim must have 0 sway`).toBe(0);
        expect(sampleAt(px, py - r * 0.55), `${id} plot[${i}] north rim must have 0 sway`).toBe(0);
        expect(sampleAt(px, py + r * 0.55), `${id} plot[${i}] south rim must have 0 sway`).toBe(0);
      }

      // Entrances and goal must be strictly 0.
      for (const ent of level.entrances ?? []) {
        expect(sampleAt(ent.x, ent.y), `${id} entrance ${ent.id} must have 0 sway`).toBe(0);
      }
      if (level.goal) {
        expect(sampleAt(level.goal[0], level.goal[1]), `${id} goal must have 0 sway`).toBe(0);
      }

      // Butterfly zone centres on swaying meadow islands must land on real grass/flower mask (> 0).
      if (cfg.butterflies) {
        for (const zone of cfg.butterflies.zones) {
          expect(
            sampleAt(zone.x, zone.y),
            `${id} butterfly zone (${zone.x},${zone.y}) should sit on swaying grass/flower patch`,
          ).toBeGreaterThan(0);
        }
      }
    });
  }
});
