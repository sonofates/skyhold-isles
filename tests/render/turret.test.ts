import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ManifestError, parseManifest } from '../../src/render2d/manifest.ts';
import { fitOnRing, type RingSpec } from '../../src/render2d/towerFit.ts';
import {
  aimedSpriteMuzzle,
  bodyAimPose,
  cannonArcPx,
  DEFAULT_SECTOR,
  frameFor,
  launchBlend,
  mountPoint,
  parseTurretJson,
  pickSector,
  recoilCurve,
  recoilOffset,
  SECTOR_HYSTERESIS,
  SECTORS,
  sectorOf,
  sectorVector,
  spriteMuzzle,
  TURRET_DIRS,
  TurretSpecError,
  turretMuzzle,
  turretScale,
  yawToScreenAngle,
} from '../../src/render2d/turret.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const RAW = JSON.parse(readFileSync(resolve(ROOT, 'public/art2d/manifest.json'), 'utf8')) as Record<string, unknown>;
const M = parseManifest(RAW);
const DEG = Math.PI / 180;
const idx = (s: (typeof SECTORS)[number]): number => SECTORS.indexOf(s);

describe('turret direction: 8 screen sectors', () => {
  it('maps sim yaw (atan2(dx, dz)) to screen angles: +z is down the screen (S), +x is right (E)', () => {
    expect(sectorOf(yawToScreenAngle(0))).toBe(idx('S'));
    expect(sectorOf(yawToScreenAngle(Math.PI / 2))).toBe(idx('E'));
    expect(sectorOf(yawToScreenAngle(Math.PI))).toBe(idx('N'));
    expect(sectorOf(yawToScreenAngle(-Math.PI / 2))).toBe(idx('W'));
    expect(sectorOf(yawToScreenAngle(Math.atan2(1, 1)))).toBe(idx('SE'));
    expect(sectorOf(yawToScreenAngle(Math.atan2(-1, -1)))).toBe(idx('NW'));
  });

  it('picks the nearest sector for every compass angle, incl. the ±π wrap', () => {
    SECTORS.forEach((_, i) => {
      for (const jitter of [-20, 0, 20]) expect(sectorOf(i * 45 * DEG + jitter * DEG)).toBe(i);
    });
    expect(sectorOf(Math.PI)).toBe(idx('W'));
    expect(sectorOf(-Math.PI + 0.01)).toBe(idx('W'));
    expect(sectorOf(3 * Math.PI)).toBe(idx('W'));
    expect(sectorOf(-90 * DEG)).toBe(idx('N'));
  });

  it('mirrors W / SW / NW from E / SE / NE; the others use their own frame', () => {
    const dirs = SECTORS.map((_, i) => frameFor(i));
    expect(dirs.map((d) => `${TURRET_DIRS[d.frame]}${d.mirror ? '*' : ''}`)).toEqual(['E', 'SE', 'S', 'SE*', 'E*', 'NE*', 'N', 'NE']);
  });

  it('hysteresis: holds the current sector a little past its border, switches beyond it', () => {
    const border = 22.5 * DEG; // between E (0) and SE (1)
    const h = SECTOR_HYSTERESIS;
    expect(pickSector(border + h * 0.5, idx('E'))).toBe(idx('E'));
    expect(pickSector(border - h * 0.5, idx('SE'))).toBe(idx('SE'));
    expect(pickSector(border + h * 1.5, idx('E'))).toBe(idx('SE'));
    // Jitter across a border does not flicker.
    let s = idx('E');
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      s = pickSector(border + (i % 2 ? 1 : -1) * h * 0.6, s);
      seen.add(s);
    }
    expect([...seen]).toEqual([idx('E')]);
    // A big jump goes straight to the nearest sector.
    expect(pickSector(180 * DEG, idx('E'))).toBe(idx('W'));
    // No current sector yet: nearest.
    expect(pickSector(border + 0.001, -1)).toBe(idx('SE'));
  });

  it('hysteresis works across the ±π wrap (W sector)', () => {
    const w = idx('W');
    expect(pickSector(-180 * DEG + 25 * DEG, w)).toBe(w); // 25° past W toward NW, inside the hold band
    expect(pickSector(180 * DEG - 25 * DEG, w)).toBe(w);
    expect(pickSector(-180 * DEG + 40 * DEG, w)).toBe(idx('NW'));
  });

  it('idle default is SE', () => {
    expect(SECTORS[DEFAULT_SECTOR]).toBe('SE');
  });

  it('sector vectors are unit screen vectors (y down)', () => {
    expect(sectorVector(idx('E'))).toEqual({ x: 1, y: 0 });
    expect(sectorVector(idx('S'))).toEqual({ x: 0, y: 1 });
    expect(sectorVector(idx('N'))).toEqual({ x: 0, y: -1 });
    const se = sectorVector(idx('SE'));
    expect(Math.hypot(se.x, se.y)).toBeCloseTo(1, 9);
    expect(se.x).toBeGreaterThan(0);
    expect(se.y).toBeGreaterThan(0);
  });
});

describe('turret placement: mount, muzzle, scale, mirror', () => {
  const ring: RingSpec = { ringWidthPx: 300, ringBottomPx: 500, ringCenterXPx: 150 };
  const fit = fitOnRing({ cx: 1000, bottom: 600, width: 90 }, ring, 300, 512);

  it('the body mount goes through the body ring fit (and its pop scale)', () => {
    const m = mountPoint(fit, ring, [150, 100]);
    expect(m.x).toBeCloseTo(1000, 9);
    expect(m.y).toBeCloseTo(600 - 400 * fit.scale, 9);
    const popped = mountPoint(fit, ring, [180, 100], fit.scale * 1.05, fit.scale * 1.1);
    expect(popped.x).toBeCloseTo(1000 + 30 * fit.scale * 1.05, 9);
    expect(popped.y).toBeCloseTo(600 - 400 * fit.scale * 1.1, 9);
  });

  it('turret scale = body scale x the packed turret scale', () => {
    expect(turretScale(0.3, { scale: 1 })).toBe(0.3);
    expect(turretScale(0.3, { scale: 0.5 })).toBeCloseTo(0.15, 12);
  });

  it('muzzle: frame offset x scale from the mount; mirrored sectors flip x only; recoil offset added', () => {
    const spec = { muzzle: [[0, -10], [40, -20], [60, -50], [40, -80], [0, -100]] as const };
    const mount = { x: 500, y: 300 };
    expect(turretMuzzle(spec, idx('E'), mount, 0.5)).toEqual({ x: 530, y: 275 });
    expect(turretMuzzle(spec, idx('W'), mount, 0.5)).toEqual({ x: 470, y: 275 });
    expect(turretMuzzle(spec, idx('SE'), mount, 0.5)).toEqual({ x: 520, y: 290 });
    expect(turretMuzzle(spec, idx('SW'), mount, 0.5)).toEqual({ x: 480, y: 290 });
    expect(turretMuzzle(spec, idx('NW'), mount, 0.5)).toEqual({ x: 480, y: 260 });
    expect(turretMuzzle(spec, idx('N'), mount, 0.5)).toEqual({ x: 500, y: 250 });
    expect(turretMuzzle(spec, idx('S'), mount, 2, { x: 1, y: -2 })).toEqual({ x: 501, y: 278 });
  });

  it('sprite-relative muzzle (crystal tip, mortar mouth) maps through the tier fit', () => {
    const p = spriteMuzzle(fit, ring, [150, 20]);
    expect(p.x).toBeCloseTo(1000, 9);
    expect(p.y).toBeCloseTo(600 - 480 * fit.scale, 9);
    expect(spriteMuzzle(fit, ring, [250, 20]).x).toBeCloseTo(1000 + 100 * fit.scale, 9);
  });
});

describe('recoil and projectile launch (render-only)', () => {
  it('recoil kicks fast, peaks, eases back to rest and is 0 outside the shot', () => {
    const dur = 0.12;
    expect(recoilCurve(-0.01, dur)).toBe(0);
    expect(recoilCurve(0, dur)).toBe(0);
    expect(recoilCurve(dur * 0.2, dur)).toBeCloseTo(1, 9);
    expect(recoilCurve(dur, dur)).toBe(0);
    expect(recoilCurve(dur * 0.999, dur)).toBeLessThan(0.01);
    let prev = 1;
    for (let t = dur * 0.2; t < dur; t += dur / 50) {
      const k = recoilCurve(t, dur);
      expect(k).toBeLessThanOrEqual(prev + 1e-12);
      prev = k;
    }
    expect(recoilCurve(0.05, 0)).toBe(0);
  });

  it('recoil pushes opposite the aim', () => {
    const e = recoilOffset(idx('E'), 10);
    expect(e.x).toBeCloseTo(-10, 9);
    expect(e.y).toBeCloseTo(0, 9);
    const n = recoilOffset(idx('N'), 10);
    expect(n.y).toBeGreaterThan(0);
  });

  it('a shot starts at the muzzle and ends exactly on the sim position', () => {
    expect(launchBlend(100, 200, 12, -30, 0)).toEqual({ x: 112, y: 170 });
    expect(launchBlend(100, 200, 12, -30, 1)).toEqual({ x: 100, y: 200 });
    expect(launchBlend(100, 200, 12, -30, 0.5)).toEqual({ x: 106, y: 185 });
    expect(launchBlend(100, 200, 12, -30, 3)).toEqual({ x: 100, y: 200 });
  });

  it('cannonballs lob: 0 at both ends, highest mid-flight, bounded', () => {
    expect(cannonArcPx(0.4, 0)).toBe(0);
    expect(cannonArcPx(0.4, 1)).toBe(0);
    expect(cannonArcPx(0.4, 0.5)).toBeCloseTo(22, 9);
    expect(cannonArcPx(10, 0.5)).toBe(26);
    expect(cannonArcPx(0.01, 0.5)).toBe(6);
  });
});

describe('turret JSON + manifest entries', () => {
  const good = {
    image: 'cannon-1-turret.webp',
    frameW: 200,
    frameH: 180,
    count: 5,
    dirs: ['S', 'SE', 'E', 'NE', 'N'],
    pivot: [100, 170],
    muzzle: [[0, -60], [50, -40], [80, -70], [50, -120], [0, -150]],
    body: 'cannon-1-body.webp',
    bodyMount: [190, 100],
    bodyRing: { ringWidthPx: 369, ringBottomPx: 507, ringCenterXPx: 189.5 },
    scale: 1,
  };

  it('parses a packed turret JSON', () => {
    const t = parseTurretJson(good);
    expect(t.frameW).toBe(200);
    expect(t.pivot).toEqual([100, 170]);
    expect(t.muzzle[2]).toEqual([80, -70]);
    expect(t.body).toBe('cannon-1-body.webp');
    expect(t.bodyRing?.ringWidthPx).toBe(369);
    expect(t.placeholder).toBe(false);
    expect(parseTurretJson({ ...good, image: undefined }, 'x.webp').image).toBe('x.webp');
    expect(parseTurretJson({ ...good, pivot: undefined }).pivot).toEqual([100, 180]);
  });

  it('rejects broken turret JSON', () => {
    expect(() => parseTurretJson({ ...good, muzzle: good.muzzle.slice(0, 4) })).toThrow(TurretSpecError);
    expect(() => parseTurretJson({ ...good, dirs: ['N', 'NE', 'E', 'SE', 'S'] })).toThrow(TurretSpecError);
    expect(() => parseTurretJson({ ...good, frameW: 0 })).toThrow(TurretSpecError);
    expect(() => parseTurretJson({ ...good, bodyMount: [1] })).toThrow(TurretSpecError);
    expect(() => parseTurretJson({ ...good, image: undefined })).toThrow(TurretSpecError);
    expect(() => parseTurretJson([])).toThrow(TurretSpecError);
  });

  it('manifest: turret / body / muzzlePx per tier (string = every tier; missing = null)', () => {
    const raw = JSON.parse(JSON.stringify(RAW)) as { towers: Record<string, Record<string, unknown>> };
    raw.towers.archer.turret = ['turrets/a1.json', null, 'turrets/a3.json'];
    raw.towers.archer.body = 'turrets/body.webp';
    raw.towers.mortar.muzzlePx = [[1, 2], null, [5, 6]];
    delete raw.towers.frost.turret;
    const m = parseManifest(raw);
    expect(m.towers.archer?.turret).toEqual(['turrets/a1.json', null, 'turrets/a3.json']);
    expect(m.towers.archer?.body).toEqual(['turrets/body.webp', 'turrets/body.webp', 'turrets/body.webp']);
    expect(m.towers.mortar?.muzzlePx).toEqual([[1, 2], null, [5, 6]]);
    expect(m.towers.frost?.turret).toEqual([null, null, null]);
    raw.towers.mortar.muzzlePx = [[1, 'x']];
    expect(() => parseManifest(raw)).toThrow(ManifestError);
  });

  it('the shipped manifest: archer / cannon / ballista aim turrets at every tier; every turret JSON parses and its files exist', () => {
    for (const type of ['archer', 'cannon', 'ballista'] as const) {
      const art = M.towers[type]!;
      expect(art.attack, `${type}: no baked attack sheets`).toEqual([null, null, null]);
      art.turret.forEach((p, i) => {
        expect(p, `${type} T${i + 1}`).not.toBeNull();
        const file = resolve(ROOT, 'public/art2d', p!);
        const spec = parseTurretJson(JSON.parse(readFileSync(file, 'utf8')) as unknown);
        const dir = p!.replace(/[^/]+$/, '');
        expect(existsSync(resolve(ROOT, 'public/art2d', dir + spec.image)), spec.image).toBe(true);
        expect(spec.body).not.toBeNull();
        expect(existsSync(resolve(ROOT, 'public/art2d', dir + spec.body!)), spec.body!).toBe(true);
        expect(spec.bodyRing, `${p} bodyRing`).not.toBeNull();
        // The foot sits on the body's platform: inside the ring horizontally, above the ring bottom.
        const r = spec.bodyRing!;
        expect(Math.abs(spec.bodyMount[0] - r.ringCenterXPx)).toBeLessThan(r.ringWidthPx * 0.25);
        expect(spec.bodyMount[1]).toBeLessThan(r.ringBottomPx * 0.6);
        // The pivot is the horizontal centre of the frame (mirroring about it is exact).
        expect(spec.pivot[0]).toBeCloseTo(spec.frameW / 2, 6);
        // Muzzles point the right way: E/NE/SE to the right, N above, S/N centred.
        const [S, SE, E, NE, N] = spec.muzzle;
        expect(E[0]).toBeGreaterThan(0);
        expect(SE[0]).toBeGreaterThan(0);
        expect(NE[0]).toBeGreaterThan(0);
        expect(NE[1]).toBeLessThan(SE[1]);
        expect(N[1]).toBeLessThan(0);
        expect(Math.abs(S[0])).toBeLessThan(spec.frameW * 0.1);
        expect(Math.abs(N[0])).toBeLessThan(spec.frameW * 0.1);
      });
    }
  });

  it('the other shooters give a sprite-relative muzzle per tier', () => {
    for (const type of ['tesla', 'frost', 'mortar'] as const) {
      M.towers[type]!.muzzlePx.forEach((p, i) => expect(p, `${type} T${i + 1}`).not.toBeNull());
    }
  });
});

describe('mortar body aim fallback (mirror for west + slight pitch tilt)', () => {
  const mortar = M.towers.mortar!;
  const ring = mortar.ring[0] as RingSpec;
  const muzzlePx = mortar.muzzlePx[0]!;
  const fit = fitOnRing({ cx: 600, bottom: 400, width: 96 }, ring, 512, 512);

  it('mirrors west sectors (SW, W, NW) and keeps east sectors (NE, E, SE) unmirrored', () => {
    for (const east of ['E', 'SE', 'NE'] as const) {
      const p = bodyAimPose(idx(east) * 45 * DEG, -1);
      expect(p.sector).toBe(idx(east));
      expect(p.mirror).toBe(false);
    }
    for (const west of ['W', 'SW', 'NW'] as const) {
      const p = bodyAimPose(idx(west) * 45 * DEG, -1);
      expect(p.sector).toBe(idx(west));
      expect(p.mirror).toBe(true);
    }
  });

  it('negates rotation when mirrored so symmetric E/W sectors place the barrel mouth at equal y and mirrored x', () => {
    for (const [east, west] of [
      ['E', 'W'],
      ['SE', 'SW'],
      ['NE', 'NW'],
    ] as const) {
      const pe = bodyAimPose(idx(east) * 45 * DEG, -1);
      const pw = bodyAimPose(idx(west) * 45 * DEG, -1);
      expect(pw.rotation).toBeCloseTo(-pe.rotation, 9);
      const me = aimedSpriteMuzzle(fit, ring, muzzlePx, pe.mirror, pe.rotation);
      const mw = aimedSpriteMuzzle(fit, ring, muzzlePx, pw.mirror, pw.rotation);
      expect(me.x - fit.x).toBeGreaterThan(0);
      expect(mw.x - fit.x).toBeCloseTo(-(me.x - fit.x), 9);
      expect(mw.y).toBeCloseTo(me.y, 9);
    }
  });

  it('tilts barrel mouth steeper upward for north targets and lower forward for south targets', () => {
    const north = bodyAimPose(yawToScreenAngle(Math.PI), -1, false);
    const east = bodyAimPose(yawToScreenAngle(Math.PI / 2), -1, false);
    const south = bodyAimPose(yawToScreenAngle(0), -1, false);
    const mn = aimedSpriteMuzzle(fit, ring, muzzlePx, north.mirror, north.rotation);
    const me = aimedSpriteMuzzle(fit, ring, muzzlePx, east.mirror, east.rotation);
    const ms = aimedSpriteMuzzle(fit, ring, muzzlePx, south.mirror, south.rotation);
    expect(mn.y).toBeLessThan(me.y);
    expect(me.y).toBeLessThan(ms.y);
    expect(Math.abs(north.rotation)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(south.rotation)).toBeLessThanOrEqual(0.15);
  });

  it('holds previous mirror state near due N / S to prevent horizontal flip-flop', () => {
    // 92° (2° west of due S): cos ≈ -0.035 is inside the ±0.08 deadband, so prevMirror holds.
    const almostSouthWest = 92 * DEG;
    expect(bodyAimPose(almostSouthWest, idx('S'), false).mirror).toBe(false);
    expect(bodyAimPose(almostSouthWest, idx('S'), true).mirror).toBe(true);
    // 102° (12° west of due S): cos ≈ -0.208 crosses the deadband → mirrors west.
    expect(bodyAimPose(102 * DEG, idx('S'), false).mirror).toBe(true);
  });
});
