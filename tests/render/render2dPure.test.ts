import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alphaFeetAnchor } from '../../src/render2d/alphaBox.ts';
import { FrameStats } from '../../src/render2d/frameStats.ts';
import {
  enemyArtFor,
  ManifestError,
  parseManifest,
  parseSheetJson,
  towerTierIndex,
  withArtVariant,
} from '../../src/render2d/manifest.ts';
import { layoutRing, type RingPoint } from '../../src/render2d/ringLayout.ts';
import { computeMapFit } from '../../src/render2d/viewFit.ts';
import { cheapWalk, createAnimState, createPose, sheetSequence, sheetWalk } from '../../src/render2d/walkAnim.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const MANIFEST = JSON.parse(readFileSync(resolve(ROOT, 'public/art2d/manifest.json'), 'utf8')) as unknown;

describe('map fit (cover, never crop the safe area)', () => {
  const SAFE_WIDE = [166, 0, 1515, 852] as const; // L1c 19.5:9 map, centred 16:9 safe area

  it('covers a 16:9 desktop screen and crops only outside the safe area', () => {
    const f = computeMapFit(1600, 900, 1846, 852, SAFE_WIDE);
    expect(f.bandLeft + f.bandRight + f.bandTop + f.bandBottom).toBe(0);
    // Safe area on screen (cover may shave < 0.5 % off it instead of opening a hairline band).
    expect(f.offsetX + 166 * f.scale).toBeGreaterThanOrEqual(-8);
    expect(f.offsetX + (166 + 1515) * f.scale).toBeLessThanOrEqual(1600 + 8);
    expect(f.offsetY + 852 * f.scale).toBeGreaterThanOrEqual(900 - 1e-6);
  });

  it('shows the whole safe area on a phone (915x412) and fills width', () => {
    const f = computeMapFit(915, 412, 1846, 852, SAFE_WIDE);
    expect(f.offsetX + 166 * f.scale).toBeGreaterThanOrEqual(-1e-6);
    expect(f.offsetX + 1681 * f.scale).toBeLessThanOrEqual(915 + 1e-6);
    expect(f.offsetY).toBeGreaterThanOrEqual(-1e-6);
    expect(f.offsetY + 852 * f.scale).toBeLessThanOrEqual(412 + 1e-6);
  });

  it('letterboxes (bands > 0) when a full-image safe area cannot cover', () => {
    const f = computeMapFit(915, 412, 1600, 900, [0, 0, 1600, 900]);
    expect(f.scale).toBeCloseTo(412 / 900, 9);
    expect(f.bandLeft).toBeGreaterThan(80);
    expect(f.bandLeft).toBeCloseTo(f.bandRight, 6);
    expect(f.bandTop).toBe(0);
  });

  it('centres an off-centre safe area when possible', () => {
    const f = computeMapFit(1000, 500, 2000, 500, [1000, 0, 1000, 500]);
    expect(f.scale).toBe(1);
    expect(f.offsetX).toBe(-1000);
  });
});

describe('art manifest', () => {
  const m = parseManifest(MANIFEST);

  it('parses the shipped manifest with the P0 mapping', () => {
    expect(m.buildRing).toEqual(expect.arrayContaining(['archer', 'cannon', 'tesla']));
    expect(m.towers.tesla?.tiers[0]).toBe('tower-mage.png');
    expect(enemyArtFor(m, 'grunt', false).art).toBe('raider');
    expect(enemyArtFor(m, 'runner', false).art).toBe('runner');
    expect(enemyArtFor(m, 'brute', false).art).toBe('brute');
    expect(enemyArtFor(m, 'flyer', true).art).toBe('kite');
    expect(enemyArtFor(m, 'golem', false).art).toBe('golem');
    expect(enemyArtFor(m, 'carrier', true).art).toBe('carrier');
    expect(m.enemies.raider.mode).toBe('sheet');
    expect(m.enemies.raider.sheet?.facing).toBe('right');
    expect(m.enemies.raider.sheet?.facingUp).toBe('left');
    expect(m.enemies.brute.mode).toBe('cheap');
  });

  it('switches the raider variant by URL value and can force cheap mode', () => {
    expect(enemyArtFor(withArtVariant(m, 'raider', 'veo31q'), 'grunt', false).art).toBe('raider-veo31q');
    expect(enemyArtFor(withArtVariant(m, 'raider', 'nope'), 'grunt', false).art).toBe('raider');
    expect(withArtVariant(m, 'raider', 'cheap').enemies.raider.mode).toBe('cheap');
  });

  it('rejects broken manifests', () => {
    expect(() => parseManifest({ ...(MANIFEST as object), enemyMap: { grunt: 'nope', '*': 'raider' } })).toThrow(ManifestError);
    expect(() => parseManifest({ ...(MANIFEST as object), enemyMap: { grunt: 'raider' } })).toThrow(/fallback/);
  });

  it('falls back to the highest loaded earlier tier', () => {
    expect(towerTierIndex([true, false, false], 3)).toBe(0);
    expect(towerTierIndex([true, true, false], 3)).toBe(1);
    expect(towerTierIndex([true, true, true], 2)).toBe(1);
    expect(towerTierIndex([true], 3)).toBe(0);
  });

  it('parses grid sheets (px anchor, implicit image) and Pixi JSON-hash sheets', () => {
    const grid = parseSheetJson({ frameW: 280, frameH: 256, count: 16, cols: 8, fps: 12, anchor: [140, 251] }, 'a.png');
    expect(grid.image).toBe('a.png');
    expect(grid.frames).toHaveLength(16);
    expect(grid.frames[9]).toEqual({ x: 280, y: 256, w: 280, h: 256 });
    expect(grid.anchor![0]).toBeCloseTo(0.5, 9);
    expect(grid.anchor![1]).toBeCloseTo(251 / 256, 9);
    const hash = parseSheetJson({
      frames: { b: { frame: { x: 10, y: 0, w: 10, h: 10 } }, a: { frame: { x: 0, y: 0, w: 10, h: 10 } } },
      animations: { walk: ['a', 'b'] },
      meta: { image: 'w.png' },
      fps: 8,
    });
    expect(hash.image).toBe('w.png');
    expect(hash.frames.map((f) => f.x)).toEqual([0, 10]);
    expect(hash.fps).toBe(8);
  });

  it('every sheet referenced by the manifest exists with a parseable JSON', () => {
    for (const art of Object.values(m.enemies)) {
      if (!art.sheet) continue;
      for (const p of [art.sheet.down, art.sheet.up]) {
        if (!existsSync(resolve(ROOT, 'public/art2d', p))) continue; // art still on its way
        const raw = JSON.parse(readFileSync(resolve(ROOT, 'public/art2d', p), 'utf8')) as unknown;
        const sheet = parseSheetJson(raw, p.split('/').pop()!.replace('.json', '.png'));
        expect(sheet.frames.length).toBeGreaterThan(1);
      }
    }
  });
});

describe('walk animation', () => {
  const spec = { bob: 0.08, squash: 0.06, lean: 0.12, stride: 1, rock: 0.05 };

  it('cheap: hops twice per stride, flips with direction, leans into travel', () => {
    const st = createAnimState(0);
    const pose = createPose();
    let maxLift = 0;
    let contacts = 0;
    let prevLift = 0;
    for (let i = 0; i < 60; i++) {
      cheapWalk(st, spec, 1 / 60, 1, 1, 0, 1 / 60, 1, true, pose);
      maxLift = Math.max(maxLift, pose.lift);
      if (prevLift > 0.004 && pose.lift <= 0.004) contacts++;
      prevLift = pose.lift;
    }
    expect(maxLift).toBeGreaterThan(0.07);
    expect(contacts).toBe(2);
    expect(pose.flip).toBe(false);
    expect(st.lean).toBeGreaterThan(0.05);
    cheapWalk(st, spec, 0.02, 1, -1, 0, 1 / 60, 1, true, pose);
    expect(pose.flip).toBe(true);
  });

  it('cheap: leg frames advance with distance, not time; idle has no bob', () => {
    const st = createAnimState(0);
    const pose = createPose();
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      cheapWalk(st, spec, 0.025, 1, 1, 0, 1 / 60, 4, true, pose);
      seen.add(pose.frame);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    const frame = pose.frame;
    cheapWalk(st, spec, 0, 0, 0, 0, 1, 4, true, pose);
    expect(pose.frame).toBe(frame);
    expect(pose.lift).toBe(0);
  });

  it('sheet: picks down/up from vertical motion, keeps it on horizontal runs, mirrors left', () => {
    expect(sheetSequence(0, 0, -1)).toBe(1);
    expect(sheetSequence(1, 0, 1)).toBe(0);
    expect(sheetSequence(1, 1, 0.1)).toBe(1);
    const st = createAnimState(0);
    const pose = createPose();
    sheetWalk(st, 16, 12, undefined, 0.04, 1, -1, 0.05, 1 / 60, true, pose);
    expect(pose.flip).toBe(true);
    for (let i = 0; i < 30; i++) sheetWalk(st, 16, 12, undefined, 0.04, 1, 0, -1, 1 / 60, true, pose);
    expect(pose.seq).toBe(1);
    expect(pose.frame).toBe(Math.floor(12 * 31 * (1 / 60)) % 16);
  });
});

describe('build ring layout', () => {
  it('keeps tokens on screen and below the HUD band for top-row plots', () => {
    const out: RingPoint[] = [];
    layoutRing(40, 60, 3, 26, 915, 412, 70, out);
    expect(out).toHaveLength(3);
    for (const p of out) {
      expect(p.x - 26).toBeGreaterThanOrEqual(0);
      expect(p.y - 26).toBeGreaterThanOrEqual(70);
      expect(p.y + 26).toBeLessThanOrEqual(412);
    }
    expect(out[0].x).toBeLessThan(out[2].x);
    // Tokens do not overlap.
    expect(Math.hypot(out[0].x - out[1].x, out[0].y - out[1].y)).toBeGreaterThan(52);
  });

  it('fans above plots in the lower part of the screen', () => {
    const out: RingPoint[] = [];
    layoutRing(500, 700, 2, 40, 1600, 900, 80, out);
    expect(out.every((p) => p.y < 700)).toBe(true);
  });
});

describe('frame stats and alpha anchor', () => {
  it('reports fps over the window and p50/p95', () => {
    const s = new FrameStats(600, 5000);
    let t = 0;
    for (let i = 0; i < 400; i++) {
      const dt = i % 10 === 0 ? 33.3 : 16.7;
      t += dt;
      s.record(dt, t);
    }
    const snap = s.snapshot(t);
    expect(snap.p50).toBeCloseTo(16.7, 5);
    expect(snap.p95).toBeCloseTo(33.3, 5);
    expect(snap.fps).toBeGreaterThan(50);
    expect(snap.fps).toBeLessThan(60);
  });

  it('finds the bottom-centre of the opaque pixels', () => {
    const w = 10;
    const h = 8;
    const px = new Uint8Array(w * h * 4);
    for (let y = 2; y <= 5; y++) for (let x = 3; x <= 6; x++) px[(y * w + x) * 4 + 3] = 255;
    const [ax, ay] = alphaFeetAnchor(px, w, h);
    expect(ax).toBeCloseTo(0.5, 9);
    expect(ay).toBeCloseTo(6 / 8, 9);
  });
});
