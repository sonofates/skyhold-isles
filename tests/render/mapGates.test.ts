import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  behindFront,
  entranceFacing,
  facingFromDir,
  frontPlacement,
  GateParseError,
  goalFacing,
  parseGate,
  type GateFront,
} from '../../src/data/levels2d/gates.ts';
import { parseLevel2D, type Level2DJson } from '../../src/data/levels2d/loader.ts';
import { parseManifest } from '../../src/render2d/manifest.ts';
import { mapVariants, pickMapVariant, texelsPerLayoutPx } from '../../src/render2d/mapVariant.ts';
import { computeMapFit } from '../../src/render2d/viewFit.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const L1C = JSON.parse(readFileSync(resolve(ROOT, 'src/data/levels2d/l1c.json'), 'utf8')) as Level2DJson & {
  entrances: { id: string; x: number; y: number; gate?: { facing: string; front: GateFront } }[];
  goalGate?: { facing: string; front: GateFront };
};
const MANIFEST = parseManifest(JSON.parse(readFileSync(resolve(ROOT, 'public/art2d/manifest.json'), 'utf8')) as unknown);

describe('gate facing from the road direction (screen y down)', () => {
  it('quantises to the nearest axis', () => {
    expect(facingFromDir(10, 3)).toBe('E');
    expect(facingFromDir(-10, 3)).toBe('W');
    expect(facingFromDir(2, 9)).toBe('S');
    expect(facingFromDir(2, -9)).toBe('N');
  });

  it('gives exact diagonals to the horizontal facing', () => {
    expect(facingFromDir(5, 5)).toBe('E');
    expect(facingFromDir(-5, 5)).toBe('W');
    expect(facingFromDir(-5, -5)).toBe('W');
    expect(facingFromDir(5, -5)).toBe('E');
  });

  it('an entrance faces along its first segment, the goal back along the last one', () => {
    const path = [
      [100, 100],
      [100, 100], // degenerate repeat is skipped
      [100, 200],
      [300, 220],
      [310, 400],
    ];
    expect(entranceFacing(path)).toBe('S');
    expect(goalFacing(path)).toBe('N');
    expect(() => entranceFacing([[1, 1], [1, 1]])).toThrow();
  });

  it('matches what the map compositor wrote into l1c.json', () => {
    L1C.entrances.forEach((e, i) => {
      expect(e.gate?.facing).toBe(entranceFacing(L1C.paths[i]));
    });
    for (const p of L1C.paths) expect(L1C.goalGate?.facing).toBe(goalFacing(p));
    // L1c: both roads leave the caves eastward, the road arrives at the keep heading east-south-east
    expect(L1C.entrances.map((e) => e.gate?.facing)).toEqual(['E', 'E']);
    expect(L1C.goalGate?.facing).toBe('W');
  });
});

describe('gate front layers', () => {
  const front: GateFront = { art: 'x', rect: [100, 50, 80, 60], baseY: 104 };

  it('places the sprite at its rect with the front ground line as depth key', () => {
    expect(frontPlacement(front)).toEqual({ x: 100, y: 50, width: 80, height: 60, zIndex: 104 });
  });

  it('hides a walker standing inside the mouth, not one passing in front or beside it', () => {
    expect(behindFront(front, 150, 100)).toBe(true);
    expect(behindFront(front, 150, 110)).toBe(false); // in front of the gate's ground line
    expect(behindFront(front, 220, 100)).toBe(false); // beside it
  });

  it('parses optional gate objects and rejects broken ones', () => {
    expect(parseGate(undefined, 'goal', -1, 'g')).toBeNull();
    const g = parseGate({ prop: 'cave-e', facing: 'E', front: { art: 'a', rect: [1, 2, 3, 4], baseY: 5 } }, 'entrance', 0, 'g');
    expect(g).toEqual({ role: 'entrance', lane: 0, prop: 'cave-e', facing: 'E', front: { art: 'a', rect: [1, 2, 3, 4], baseY: 5 } });
    expect(parseGate({ prop: 'cave-e', facing: 'E' }, 'entrance', 0, 'g')?.front).toBeNull();
    expect(() => parseGate({ prop: 'cave-e', facing: 'NE' }, 'entrance', 0, 'g')).toThrow(GateParseError);
    expect(() => parseGate({ prop: 'cave-e', facing: 'E', front: { art: 'a', rect: [1, 2, 0, 4], baseY: 5 } }, 'entrance', 0, 'g')).toThrow(
      GateParseError,
    );
    expect(() => parseGate({ facing: 'E' }, 'entrance', 0, 'g')).toThrow(GateParseError);
  });

  it('L1c: every walker spawns behind its cave front and leaks behind the castle front', () => {
    const layout = parseLevel2D(L1C);
    const gates = layout.gates ?? [];
    expect(gates.map((g) => `${g.role}:${g.lane}`)).toEqual(['entrance:0', 'entrance:1', 'goal:-1']);
    for (const g of gates) {
      expect(g.front).not.toBeNull();
      const f = g.front!;
      // the front art is in the manifest and on disk
      expect(MANIFEST.overlays[f.art]).toBeDefined();
      expect(existsSync(resolve(ROOT, 'public/art2d', MANIFEST.overlays[f.art]))).toBe(true);
      const [px, py] = g.role === 'goal' ? L1C.goal : L1C.paths[g.lane][0];
      expect(behindFront(f, px, py)).toBe(true);
    }
    // the plots / paths the sim uses are untouched by the gate data
    expect(layout.plots).toHaveLength(24);
    expect(layout.paths.map((p) => p.length)).toEqual(L1C.paths.map((p) => p.length));
  });
});

describe('map resolution variants', () => {
  const maps = { m: 'm.webp', 'm@1x': 'a.webp', 'm@1.5x': 'b.webp', other: 'o.webp', 'other@1x': 'c.webp' };

  it('lists the variants of one key smallest first, the master last', () => {
    expect(mapVariants(maps, 'm')).toEqual([
      { key: 'm@1x', scale: 1 },
      { key: 'm@1.5x', scale: 1.5 },
      { key: 'm', scale: null },
    ]);
    expect(mapVariants({}, 'm')).toEqual([]);
  });

  it('picks the smallest bake that covers the device px per layout px', () => {
    expect(pickMapVariant(maps, 'm', 0.97)).toBe('m@1x'); // phone landscape DPR 2
    expect(pickMapVariant(maps, 'm', 1.01)).toBe('m@1x'); // within the 2 % slack
    expect(pickMapVariant(maps, 'm', 1.06)).toBe('m@1.5x'); // 1600x900 DPR 1
    expect(pickMapVariant(maps, 'm', 1.69)).toBe('m'); // 2560x1440 DPR 1 -> the 2x master
    expect(pickMapVariant({ m: 'm.webp' }, 'm', 0.5)).toBe('m');
    expect(pickMapVariant({ 'm@1x': 'a' }, 'm', 3)).toBe('m@1x');
    expect(pickMapVariant({}, 'm', 1)).toBeNull();
  });

  it('L1c: the shipped bakes cover 1600x900, 2560x1440 (DPR 1) and a DPR 2 phone without magnifying', () => {
    const [iw, ih] = L1C.imageSize;
    const safe = L1C.safeArea as [number, number, number, number];
    const cases: [number, number, number][] = [
      [1600, 900, 1],
      [2560, 1440, 1],
      [915, 412, 2],
      [1440, 900, 2],
    ];
    for (const [w, h, dpr] of cases) {
      const need = computeMapFit(w, h, iw, ih, safe).scale * dpr;
      const key = pickMapVariant(MANIFEST.maps, L1C.image, need)!;
      expect(existsSync(resolve(ROOT, 'public/art2d', MANIFEST.maps[key]))).toBe(true);
      const m = /@([\d.]+)x$/.exec(key);
      const scale = m ? Number(m[1]) : 2; // the master is baked at 2x the layout px
      expect(scale * 1.02).toBeGreaterThanOrEqual(need);
      // and never more than ~2x bigger than needed (texture memory / download on phones)
      if (m) expect(scale / need).toBeLessThan(2.1);
    }
    expect(texelsPerLayoutPx(3692, 1846)).toBe(2);
  });
});
