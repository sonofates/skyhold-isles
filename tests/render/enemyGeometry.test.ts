import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { EnemyType } from '../../src/core/types.ts';
import { ENEMY_DEFS, ENEMY_TYPES } from '../../src/data/enemies.ts';
import { EnemyRenderer } from '../../src/render/enemyMeshes.ts';

/** Generous per-figurine triangle budget: every enemy is one instanced draw call, but phones still pay per vertex. */
const MAX_TRIANGLES = 900;

function bounds(type: EnemyType): { size: THREE.Vector3; tris: number } {
  const geo = EnemyRenderer.buildEnemyGeometry(type);
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox!.getSize(size);
  const tris = geo.getAttribute('position').count / 3;
  geo.dispose();
  return { size, tris };
}

describe('enemy figurine geometry', () => {
  for (const type of ENEMY_TYPES) {
    it(`${type}: fits its sim height/radius and the triangle budget`, () => {
      const def = ENEMY_DEFS[type];
      const { size, tris } = bounds(type);
      expect(tris).toBeLessThanOrEqual(MAX_TRIANGLES);
      // HP bars sit at def.height above the feet; the model should be roughly that tall.
      // (The Sky Skimmer is a flat glider; its height is the hover offset of its HP bar.)
      if (type !== 'flyer') expect(size.y).toBeGreaterThan(def.height * 0.75);
      expect(size.y).toBeLessThan(def.height * 1.45);
      // Footprint should be in the same ballpark as the hit radius (readability + hover picking).
      const footprint = Math.max(size.x, size.z);
      expect(footprint).toBeGreaterThan(def.radius * 1.2);
      expect(footprint).toBeLessThan(def.radius * 4.5);
    });
  }

  it('keeps silhouettes readable by size class', () => {
    const h = (t: EnemyType): number => bounds(t).size.y;
    const w = (t: EnemyType): number => {
      const s = bounds(t).size;
      return Math.max(s.x, s.z);
    };
    expect(h('mite')).toBeLessThan(h('runner') * 0.7);
    expect(w('golem')).toBeGreaterThan(w('grunt') * 1.4);
    expect(h('tempest')).toBeGreaterThan(h('boss'));
    expect(h('burrower')).toBeLessThan(h('grunt'));
  });
});
