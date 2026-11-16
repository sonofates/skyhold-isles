import { beforeAll, describe, expect, it } from 'vitest';
import { TOWER_TYPES } from '../../src/data/towers.ts';
import { TowerGeometryCache } from '../../src/render/towerGeometries.ts';
import { getTowerPickHeight } from '../../src/render/towerPicking.ts';
import { loadNodeKenneyStore } from '../../scripts/lib/nodeKenneyStore.ts';

describe('tower geometries (real Kenney modules)', () => {
  let cache: TowerGeometryCache;
  beforeAll(async () => {
    cache = new TowerGeometryCache(await loadNodeKenneyStore());
  }, 30_000);

  for (const type of TOWER_TYPES) {
    for (const tier of [1, 2, 3] as const) {
      it(`${type} T${tier}: fits its tile, has geometry and a sane pick height`, () => {
        const pair = cache.get(type, tier);
        pair.base.computeBoundingBox();
        pair.turret.computeBoundingBox();
        const bb = pair.base.boundingBox!;
        const tb = pair.turret.boundingBox!;
        expect(pair.base.getAttribute('position').count).toBeGreaterThan(0);
        expect(pair.turret.getAttribute('position').count).toBeGreaterThan(0);
        // Tile is 2.0 wide: neither base nor turret may spill over into neighbours.
        expect(Math.max(bb.max.x, -bb.min.x, bb.max.z, -bb.min.z)).toBeLessThan(1.0);
        expect(Math.max(tb.max.x, -tb.min.x, tb.max.z, -tb.min.z)).toBeLessThan(1.0);
        const top = pair.turretAnchorY + tb.max.y;
        const pick = getTowerPickHeight(type, tier);
        expect(pick).toBeGreaterThanOrEqual(top - 0.2);
        expect(pick).toBeLessThanOrEqual(top + 0.7);
        // Turret must not float: its lowest point rests on or inside the base.
        expect(pair.turretAnchorY + tb.min.y).toBeLessThanOrEqual(bb.max.y + 0.05);
      });
    }
  }

  it('tiers grow taller for every tower', () => {
    for (const type of TOWER_TYPES) {
      const tops = ([1, 2, 3] as const).map((tier) => {
        const pair = cache.get(type, tier);
        pair.turret.computeBoundingBox();
        return pair.turretAnchorY + pair.turret.boundingBox!.max.y;
      });
      expect(tops[1]).toBeGreaterThan(tops[0]);
      expect(tops[2]).toBeGreaterThan(tops[1]);
    }
  });
});
