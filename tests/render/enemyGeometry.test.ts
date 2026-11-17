import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { EnemyType } from "../../src/core/types.ts";
import { ENEMY_DEFS, ENEMY_TYPES } from "../../src/data/enemies.ts";
import { PALETTE_HEX } from "../../src/data/palette.ts";
import { EnemyRenderer } from "../../src/render/enemyMeshes.ts";

/** Generous per-figurine triangle budget: every enemy is one instanced draw call, but phones still pay per vertex. */
const MAX_TRIANGLES = 900;

function bounds(type: EnemyType): { size: THREE.Vector3; tris: number } {
  const geo = EnemyRenderer.buildEnemyGeometry(type);
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox!.getSize(size);
  const tris = geo.getAttribute("position").count / 3;
  geo.dispose();
  return { size, tris };
}

describe("enemy figurine geometry", () => {
  for (const type of ENEMY_TYPES) {
    it(`${type}: fits its sim height/radius and the triangle budget`, () => {
      const def = ENEMY_DEFS[type];
      const { size, tris } = bounds(type);
      expect(tris).toBeLessThanOrEqual(MAX_TRIANGLES);
      // HP bars sit at def.height above the feet; the model should be roughly that tall.
      // (The Sky Skimmer is a flat glider; its height is the hover offset of its HP bar.)
      if (type !== "flyer") expect(size.y).toBeGreaterThan(def.height * 0.75);
      expect(size.y).toBeLessThan(def.height * 1.45);
      // Footprint should be in the same ballpark as the hit radius (readability + hover picking).
      const footprint = Math.max(size.x, size.z);
      expect(footprint).toBeGreaterThan(def.radius * 1.2);
      expect(footprint).toBeLessThan(def.radius * 4.5);
    });
  }

  it("newer archetypes stand out from grass from the iso camera (colour, not just shape)", () => {
    // CIELAB distance of each camera-facing triangle's vertex colour to grass / dark foliage,
    // weighted by area. ΔE > 25 is "clearly a different colour"; small accents (golem moss) may blend.
    const toLab = (c: THREE.Color): [number, number, number] => {
      const s = c.clone().convertLinearToSRGB();
      const lin = (v: number): number =>
        v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      const [r, g, b] = [lin(s.r), lin(s.g), lin(s.b)];
      const f = (t: number): number =>
        t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
      const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
      const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
      return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
    };
    const dE = (p: number[], q: number[]): number =>
      Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const greens = [
      toLab(new THREE.Color(PALETTE_HEX.grass)),
      toLab(new THREE.Color(PALETTE_HEX.foliageDark)),
    ];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const col = new THREE.Color();
    const NEW_TYPES: EnemyType[] = [
      "warden",
      "burrower",
      "carrier",
      "blinker",
      "golem",
      "mite",
      "hexer",
      "tempest",
    ];
    for (const type of NEW_TYPES) {
      const geo = EnemyRenderer.buildEnemyGeometry(type);
      const pos = geo.getAttribute("position");
      const colors = geo.getAttribute("color");
      let total = 0;
      let distinct = 0;
      for (let i = 0; i < pos.count; i += 3) {
        a.fromBufferAttribute(pos, i);
        b.fromBufferAttribute(pos, i + 1).sub(a);
        c.fromBufferAttribute(pos, i + 2).sub(a);
        b.cross(c);
        const area = b.length() / 2;
        if (area === 0 || b.y / (2 * area) < -0.3) continue; // underside: hidden from the iso camera
        col.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i));
        const lab = toLab(col);
        total += area;
        if (Math.min(dE(lab, greens[0]), dE(lab, greens[1])) > 25)
          distinct += area;
      }
      geo.dispose();
      expect(distinct / total, type).toBeGreaterThan(0.85);
    }
  });

  it("keeps silhouettes readable by size class", () => {
    const h = (t: EnemyType): number => bounds(t).size.y;
    const w = (t: EnemyType): number => {
      const s = bounds(t).size;
      return Math.max(s.x, s.z);
    };
    expect(h("mite")).toBeLessThan(h("runner") * 0.7);
    expect(w("golem")).toBeGreaterThan(w("grunt") * 1.4);
    expect(h("tempest")).toBeGreaterThan(h("boss"));
    expect(h("burrower")).toBeLessThan(h("grunt"));
  });
});
